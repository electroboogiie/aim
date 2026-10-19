// Tokens: KP_ACCESS_TOKEN (optional, every /api call except /api/health) and KP_ADMIN_TOKEN (PUT /api/settings,
// manual prices beyond the discount limit). The admin token also works as an access token.
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { HttpError } from "./http.js";

function digest(s: string): Buffer { return createHash("sha256").update(s, "utf8").digest(); }

export function tokenEquals(given: string | null | undefined, expected: string | null): boolean {
  if (!given || !expected) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

export function bearerToken(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (typeof h !== "string") return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(h);
  return m ? m[1]! : null;
}

function adminHeader(req: IncomingMessage): string | null {
  const h = req.headers["x-admin-token"];
  return typeof h === "string" && h.trim() ? h.trim() : null;
}

export interface Tokens { accessToken: string | null; adminToken: string | null }

export function isAdmin(req: IncomingMessage, t: Tokens): boolean {
  return tokenEquals(adminHeader(req), t.adminToken) || tokenEquals(bearerToken(req), t.adminToken);
}

/** Throws 401 when KP_ACCESS_TOKEN is set and the request carries neither it nor the admin token. */
export function requireAccess(req: IncomingMessage, t: Tokens): void {
  if (!t.accessToken) return;
  if (tokenEquals(bearerToken(req), t.accessToken) || isAdmin(req, t)) return;
  throw new HttpError(401, bearerToken(req) ? "Невірний токен доступу." : "Потрібен токен доступу (заголовок Authorization: Bearer …).",
    undefined, { "WWW-Authenticate": 'Bearer realm="kp"' });
}

/** Admin-only actions; without KP_ADMIN_TOKEN on the server they are switched off (403). */
export function requireAdmin(req: IncomingMessage, t: Tokens): void {
  if (!t.adminToken) {
    throw new HttpError(403, "Зміна налаштувань вимкнена: на сервері не задано KP_ADMIN_TOKEN, тому налаштування доступні лише "
      + "для читання. Задайте KP_ADMIN_TOKEN у файлі .env і перезапустіть сервер.");
  }
  if (isAdmin(req, t)) return;
  const given = adminHeader(req) ?? bearerToken(req);
  if (given && !tokenEquals(given, t.accessToken)) throw new HttpError(403, "Невірний токен адміністратора.");
  throw new HttpError(401, "Потрібен токен адміністратора (заголовок X-Admin-Token або Authorization: Bearer …).",
    undefined, { "WWW-Authenticate": 'Bearer realm="kp-admin"' });
}
