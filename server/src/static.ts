// Static web app (web/dist, SPA fallback to index.html) and /media images (web/media, then generator/assets).
// Paths arrive as segments from http.parsePath (no ".", "..", encoded slashes, NUL...); here hidden names are
// refused, the joined path must stay inside the root, also after resolving symlinks.
import { createReadStream } from "node:fs";
import type { Stats } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { isInside } from "./fsutil.js";
import { sendError } from "./http.js";

export const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

const IMAGE_EXT = new Set([".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".ico"]);
const REVALIDATE = new Set([".html", ".js", ".mjs", ".css", ".json", ".map", ".webmanifest", ".txt"]);

export interface Found { file: string; stat: Stats }

/** The first root that has the file; null when none has it or the path is not allowed. */
export async function findFile(roots: string[], segs: string[]): Promise<Found | null> {
  if (!segs.length || segs.some((s) => s.startsWith(".") || s.length > 255)) return null;
  for (const root of roots) {
    const full = join(root, ...segs);
    if (!isInside(root, full)) continue;
    try {
      const st = await stat(full);
      if (!st.isFile()) continue;
      const [real, realRoot] = await Promise.all([realpath(full), realpath(root)]);
      if (!isInside(realRoot, real)) continue;
      return { file: real, stat: st };
    } catch {
      continue;
    }
  }
  return null;
}

function etagOf(st: Stats): string { return `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`; }

export function sendFile(req: IncomingMessage, res: ServerResponse, f: Found, type: string, cacheControl: string,
  extra: Record<string, string> = {}): void {
  const etag = etagOf(f.stat);
  const headers: Record<string, string> = { ETag: etag, "Last-Modified": f.stat.mtime.toUTCString(), "Cache-Control": cacheControl, ...extra };
  const inm = req.headers["if-none-match"];
  if (typeof inm === "string" && inm.split(",").map((s) => s.trim()).some((t) => t === etag || t === "*")) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  res.writeHead(200, { ...headers, "Content-Type": type, "Content-Length": String(f.stat.size) });
  if (req.method === "HEAD") { res.end(); return; }
  const s = createReadStream(f.file);
  s.on("error", () => res.destroy());
  s.pipe(res);
}

/** GET /* from web/dist; a path without extension that is not a file gets index.html (client-side routes). */
export async function serveStatic(req: IncomingMessage, res: ServerResponse, segs: string[], webDir: string): Promise<void> {
  const last = segs[segs.length - 1] ?? "";
  const ext = extname(last).toLowerCase();
  const type = CONTENT_TYPES[ext];
  if (segs.length && type) {
    const f = await findFile([webDir], segs);
    if (f) {
      sendFile(req, res, f, type, REVALIDATE.has(ext) ? "no-cache" : "public, max-age=604800");
      return;
    }
  }
  if (segs.length && last.includes(".")) { sendError(res, 404, "Файл не знайдено."); return; }
  const index = await findFile([webDir], ["index.html"]);
  if (!index) { sendError(res, 404, "Веб-застосунок не зібрано: виконайте npm run build."); return; }
  sendFile(req, res, index, CONTENT_TYPES[".html"]!, "no-cache");
}

/** GET /media/<path>: images only. */
export async function serveMedia(req: IncomingMessage, res: ServerResponse, segs: string[], roots: string[]): Promise<void> {
  const ext = extname(segs[segs.length - 1] ?? "").toLowerCase();
  const f = IMAGE_EXT.has(ext) ? await findFile(roots, segs) : null;
  if (!f) { sendError(res, 404, "Зображення не знайдено."); return; }
  // an SVG opened directly must not run scripts in this origin
  const extra: Record<string, string> = ext === ".svg" ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {};
  sendFile(req, res, f, CONTENT_TYPES[ext]!, "public, max-age=86400", extra);
}
