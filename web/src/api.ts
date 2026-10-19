// Server API client (docs/CONTRACTS.md §7) and the interface the demo adapter implements too.
import type { Catalog, Quote, QuoteInput, RateInfo, Settings, KpSpec } from "../../core/src/index.js";
import { KEYS, local, session } from "./storage.js";

export type KpStatus = "queued" | "running" | "ready" | "error" | "demo";
export type FileKind = "pdf" | "pptx";

export interface RateResp extends RateInfo { eur: number | null; date?: string | null; source: string; fetched_at?: string | null }

export interface KpClient { name: string; contact?: string }

export interface KpCreateBody {
  quote_input: QuoteInput;
  client: KpClient;
  manager?: string;
  maker?: string;                       // Company id (CONTRACTS §7: optional, default settings.company_maker)
  terms?: string[];
}

export interface KpCreated { id: string; number: string; status: KpStatus }

export interface KpListItem {
  id: string;
  number: string;
  date: string;
  client: string | KpClient;
  title: string;
  total_uah: number | null;
  status: KpStatus;
}

/** GET /api/kp/:id — the web reads these fields when present and ignores the rest. */
export interface KpRecord extends KpListItem {
  quote_input?: QuoteInput;
  quote?: Quote;
  spec?: KpSpec;
  error?: string | null;
  files?: Record<string, unknown> | null;
  manager?: string | null;
  maker?: string | null;
  created_at?: string;
  rate?: RateResp | null;
}

export class ApiError extends Error {
  readonly status: number;
  readonly errors: string[];
  constructor(status: number, message: string, errors: string[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors.length ? errors : [message];
  }
  /** No server answered (network error, offline, static host without the API). */
  get unreachable(): boolean { return this.status === 0 || this.status === 404 || this.status === 502 || this.status === 503 || this.status === 504; }
}

export interface Api {
  readonly mode: "server" | "demo";
  health(): Promise<{ ok: boolean; version?: string }>;
  catalog(): Promise<Catalog>;
  settings(): Promise<Settings>;
  saveSettings(s: Settings, adminToken: string): Promise<Settings>;
  rate(): Promise<RateResp>;
  quote(input: QuoteInput): Promise<Quote>;
  createKp(body: KpCreateBody): Promise<KpCreated>;
  listKp(q: string, limit: number): Promise<KpListItem[]>;
  getKp(id: string): Promise<KpRecord>;
  recalc(id: string): Promise<KpCreated>;
  download(id: string, kind: FileKind): Promise<{ blob: Blob; fileName: string }>;
  fileUrl(id: string, kind: FileKind): string;
}

export function clientName(c: KpListItem["client"] | undefined | null): string {
  if (!c) return "";
  return typeof c === "string" ? c : c.name ?? "";
}

export function accessToken(): string { return local.get(KEYS.accessToken) ?? ""; }
export function setAccessToken(t: string): void { if (t) local.set(KEYS.accessToken, t); else local.remove(KEYS.accessToken); }
export function adminToken(): string { return session.get(KEYS.adminToken) ?? ""; }
export function setAdminToken(t: string): void { if (t) session.set(KEYS.adminToken, t); else session.remove(KEYS.adminToken); }

/** "attachment; filename*=UTF-8''KP_0007.pdf" -> "KP_0007.pdf" */
export function dispositionName(h: string | null): string | null {
  if (!h) return null;
  const star = /filename\*\s*=\s*([^']*)''([^;]+)/i.exec(h);
  if (star) { try { return decodeURIComponent(star[2]!.trim().replace(/^"|"$/g, "")); } catch { /* fall through */ } }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(h);
  return plain ? (plain[2] ?? plain[1]!).trim() : null;
}

type Listener = () => void;
const authListeners: Listener[] = [];
const netListeners: ((ok: boolean) => void)[] = [];
/** Called when the API answers 401 (access token missing or wrong). */
export function onAuthRequired(fn: Listener): void { authListeners.push(fn); }
/** Called with false after a network failure and with true after the next answer. */
export function onNetwork(fn: (ok: boolean) => void): void { netListeners.push(fn); }

export class ServerApi implements Api {
  readonly mode = "server" as const;

  private url(path: string): string { return new URL(path.replace(/^\//, ""), document.baseURI).toString(); }

  private headers(extra?: Record<string, string>): Headers {
    const hd = new Headers({ Accept: "application/json", ...(extra ?? {}) });
    const t = accessToken();
    if (t && !hd.has("Authorization")) hd.set("Authorization", `Bearer ${t}`);
    return hd;
  }

  private async send(path: string, init: RequestInit = {}, extra?: Record<string, string>, notifyAuth = true): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(this.url(path), { ...init, headers: this.headers(extra), cache: "no-store" });
    } catch {
      for (const fn of netListeners) fn(false);
      throw new ApiError(0, "Сервер недоступний. Перевірте з’єднання з мережею.");
    }
    for (const fn of netListeners) fn(res.status !== 503 || !res.headers.get("x-kp-offline"));
    if (res.status === 401 && notifyAuth) {
      for (const fn of authListeners) fn();
      throw new ApiError(401, "Потрібен токен доступу.");
    }
    return res;
  }

  private async json<T>(path: string, init: RequestInit = {}, extra?: Record<string, string>, notifyAuth = true): Promise<T> {
    const res = await this.send(path, init, extra, notifyAuth);
    const type = res.headers.get("content-type") ?? "";
    let body: unknown = null;
    if (type.includes("json")) { try { body = await res.json(); } catch { body = null; } }
    if (!res.ok) {
      const b = (body ?? {}) as { error?: unknown; errors?: unknown };
      const errors = Array.isArray(b.errors) ? b.errors.map(String) : [];
      const msg = typeof b.error === "string" && b.error ? b.error
        : errors.length ? errors.join(" ")
        : res.status === 404 ? "Сервер не знайшов запитаний ресурс."
        : `Помилка сервера (${res.status}).`;
      throw new ApiError(res.status, msg, errors);
    }
    if (body === null) throw new ApiError(404, "Сервер відповів не JSON: API недоступне за цією адресою.");
    return body as T;
  }

  private post<T>(path: string, body: unknown, extra?: Record<string, string>, method = "POST", notifyAuth = true): Promise<T> {
    return this.json<T>(path, { method, body: JSON.stringify(body) }, { "Content-Type": "application/json", ...(extra ?? {}) }, notifyAuth);
  }

  health() { return this.json<{ ok: boolean; version?: string }>("api/health"); }
  catalog() { return this.json<Catalog>("api/catalog"); }
  settings() { return this.json<Settings>("api/settings"); }
  rate() { return this.json<RateResp>("api/rate"); }
  quote(input: QuoteInput) { return this.post<Quote>("api/quote", input); }
  createKp(body: KpCreateBody) { return this.post<KpCreated>("api/kp", body); }
  recalc(id: string) { return this.post<KpCreated>(`api/kp/${encodeURIComponent(id)}/recalc`, {}); }
  getKp(id: string) { return this.json<KpRecord>(`api/kp/${encodeURIComponent(id)}`); }

  saveSettings(s: Settings, admin: string) {
    // X-Admin-Token always; without an access token the admin token also goes as the bearer (CONTRACTS §7).
    const extra: Record<string, string> = { "X-Admin-Token": admin };
    if (!accessToken()) extra.Authorization = `Bearer ${admin}`;
    // 401/403 here mean the admin token was refused: no access-token screen for that.
    return this.post<Settings>("api/settings", s, extra, "PUT", false);
  }

  async listKp(q: string, limit: number): Promise<KpListItem[]> {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    qs.set("limit", String(limit));
    const r = await this.json<KpListItem[] | { items?: KpListItem[] }>(`api/kp?${qs}`);
    return Array.isArray(r) ? r : r.items ?? [];
  }

  fileUrl(id: string, kind: FileKind): string { return this.url(`api/kp/${encodeURIComponent(id)}/file/${kind}`); }

  async download(id: string, kind: FileKind): Promise<{ blob: Blob; fileName: string }> {
    const res = await this.send(`api/kp/${encodeURIComponent(id)}/file/${kind}`, {}, { Accept: "*/*" });
    if (!res.ok) {
      let msg = `Файл недоступний (${res.status}).`;
      try { const b = await res.json() as { error?: string }; if (b?.error) msg = b.error; } catch { /* not json */ }
      throw new ApiError(res.status, msg);
    }
    const blob = await res.blob();
    return { blob, fileName: dispositionName(res.headers.get("content-disposition")) ?? `KP_${id}.${kind}` };
  }
}
