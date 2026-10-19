// HTTP helpers: security headers, JSON responses and request bodies, strict path parsing.
import type { IncomingMessage, ServerResponse } from "node:http";

export class HttpError extends Error {
  readonly status: number;
  readonly errors: string[] | undefined;
  readonly headers: Record<string, string>;
  constructor(status: number, message: string, errors?: string[], headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.errors = errors;
    this.headers = headers;
  }
}

export const CSP = "default-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'self'; "
  + "form-action 'self'; frame-ancestors 'none'";

export function securityHeaders(res: ServerResponse): void {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const data = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(data.length),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(data);
}

export function sendError(res: ServerResponse, status: number, message: string, errors?: string[], headers: Record<string, string> = {}): void {
  if (res.headersSent) { res.destroy(); return; }
  sendJson(res, status, errors ? { error: message, errors } : { error: message }, headers);
}

export function sendEmpty(res: ServerResponse, status: number, headers: Record<string, string> = {}): void {
  res.writeHead(status, headers);
  res.end();
}

const decoder = new TextDecoder("utf-8", { fatal: true });

/** Request body as a Buffer, at most `limit` bytes (413 above). */
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
      req.resume();
      reject(new HttpError(413, `Запит завеликий (більше ${Math.round(limit / 1024)} КБ).`));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        req.resume();
        reject(new HttpError(413, `Запит завеликий (більше ${Math.round(limit / 1024)} КБ).`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on("error", (e) => { if (!done) { done = true; reject(e); } });
  });
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Parses JSON text; keys that could reach Object.prototype are dropped. */
export function parseJson(text: string): unknown {
  return JSON.parse(text, (k, v: unknown) => (FORBIDDEN_KEYS.has(k) ? undefined : v));
}

/**
 * JSON body of a POST/PUT request. `optional`: an empty body gives `undefined`.
 * Requires Content-Type application/json whenever a body is sent (this also keeps plain HTML forms out).
 */
export async function readJson(req: IncomingMessage, limit: number, optional = false): Promise<unknown> {
  const buf = await readBody(req, limit);
  if (buf.length === 0) {
    if (optional) return undefined;
    throw new HttpError(400, "Порожнє тіло запиту: очікується JSON.");
  }
  const type = String(req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json") throw new HttpError(415, "Потрібен заголовок Content-Type: application/json.");
  let text: string;
  try { text = decoder.decode(buf); } catch { throw new HttpError(400, "Тіло запиту не в кодуванні UTF-8."); }
  try { return parseJson(text); } catch { throw new HttpError(400, "Невірний JSON у тілі запиту."); }
}

export function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * Path segments of a raw request path, decoded one by one. null for anything suspicious: no leading "/",
 * "." / ".." segments (also percent-encoded), encoded "/" or "\", backslashes, NUL and other control
 * characters, ":" (drive letters, alternate streams), empty segments inside the path.
 * A trailing "/" gives no extra segment.
 */
export function parsePath(raw: string): string[] | null {
  if (!raw.startsWith("/") || raw.includes("\\")) return null;
  const parts = raw.slice(1).split("/");
  if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  if (parts.length === 1 && parts[0] === "") return [];
  const out: string[] = [];
  for (const p of parts) {
    let s: string;
    try { s = decodeURIComponent(p); } catch { return null; }
    if (s === "" || s === "." || s === ".." || s.includes("/") || s.includes("\\") || s.includes(":") || CONTROL.test(s)) return null;
    out.push(s);
  }
  return out;
}

/** Splits req.url into the raw path and its query parameters. */
export function splitUrl(url: string | undefined): { path: string; query: URLSearchParams } {
  const u = url ?? "/";
  const i = u.indexOf("?");
  const hash = u.indexOf("#");
  const end = hash >= 0 ? hash : u.length;
  return i >= 0 && i < end
    ? { path: u.slice(0, i), query: new URLSearchParams(u.slice(i + 1, end)) }
    : { path: u.slice(0, end), query: new URLSearchParams() };
}
