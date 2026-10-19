// /api route handlers (docs/CONTRACTS.md §7). Prices are always computed here from the catalog, the settings
// and the rate; the client may only pass manual prices, within the rules of manualPriceErrors.
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { Catalog, KpMeta, Quote, QuoteInput, RateInfo, Selection, SelectionAccessory, Settings } from "../../core/src/index.js";
import {
  KpSpecError, QuoteError, TEXT_ON_REQUEST, buildKpSpec, formatPct, formatUah, itemById, itemPrice, kitTypeById,
  normalizeSelection, quote, validateSelection,
} from "../../core/src/index.js";
import { isAdmin, requireAccess, requireAdmin } from "./auth.js";
import type { Config } from "./config.js";
import type { Journal, KpClient, KpManager, KpOptions, KpRecord } from "./db.js";
import { GeneratorQueue, kpDir } from "./generator.js";
import { HttpError, isObject, parsePath, readJson, sendJson } from "./http.js";
import type { RateService } from "./rate.js";
import { SettingsError } from "./settings.js";
import type { SettingsStore } from "./settings.js";
import { findFile, sendFile } from "./static.js";

export interface AppContext {
  config: Config;
  catalog: Catalog;
  catalogJson: string;
  catalogEtag: string;
  version: string;
  settings: SettingsStore;
  rates: RateService;
  journal: Journal;
  queue: GeneratorQueue;
  refDates: string[];
  today: () => string;
  log: (msg: string) => void;
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE_TYPES = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
} as const;

function methodNotAllowed(allow: string): never {
  throw new HttpError(405, "Метод не підтримується для цього шляху.", undefined, { Allow: allow });
}

// ------------------------------------------------------------------ input parsing

function oneLine(v: unknown, field: string, max: number, errors: string[], required = false): string | undefined {
  if (v === undefined || v === null || v === "") {
    if (required) errors.push(`Не заповнено поле ${field}.`);
    return undefined;
  }
  if (typeof v !== "string") { errors.push(`${field} має бути рядком.`); return undefined; }
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) { if (required) errors.push(`Не заповнено поле ${field}.`); return undefined; }
  if (s.length > max) { errors.push(`${field}: не довше ${max} символів.`); return undefined; }
  return s;
}

function multiLine(v: unknown, field: string, max: number, errors: string[]): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") { errors.push(`${field} має бути рядком.`); return undefined; }
  const s = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").trim();
  if (s.length > max) { errors.push(`${field}: не довше ${max} символів.`); return undefined; }
  return s || undefined;
}

function parseClient(v: unknown, errors: string[]): KpClient {
  if (!isObject(v)) { errors.push("Вкажіть клієнта: client = {name, contact?}."); return { name: "" }; }
  const name = oneLine(v.name, "client.name (назва клієнта)", 200, errors, true) ?? "";
  const contact = oneLine(v.contact, "client.contact", 300, errors);
  return contact ? { name, contact } : { name };
}

function parseManager(v: unknown, errors: string[]): KpManager | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "string") { const name = oneLine(v, "manager", 200, errors); return name ? { name } : null; }
  if (!isObject(v)) { errors.push("manager має бути рядком або {name, phone, email}."); return null; }
  const out: KpManager = {};
  for (const k of ["name", "phone", "email"] as const) {
    const s = oneLine(v[k], `manager.${k}`, 200, errors);
    if (s) out[k] = s;
  }
  return Object.keys(out).length ? out : null;
}

async function parseOptions(ctx: AppContext, body: Record<string, unknown>, errors: string[]): Promise<KpOptions> {
  const o: KpOptions = {};
  const maker = oneLine(body.maker, "maker", 64, errors);
  if (maker) o.maker = maker;
  if (body.terms !== undefined && body.terms !== null) {
    if (!Array.isArray(body.terms) || body.terms.length > 20) errors.push("terms має бути списком (до 7 умов).");
    else {
      o.terms = [];
      body.terms.forEach((t: unknown, i: number) => {
        if (typeof t === "string") { const id = oneLine(t, `terms[${i}]`, 64, errors, true); if (id) o.terms!.push(id); }
        else if (isObject(t)) {
          const title = oneLine(t.title, `terms[${i}].title`, 120, errors, true);
          const text = multiLine(t.text, `terms[${i}].text`, 2000, errors);
          if (title && text) o.terms!.push({ title, text });
          else if (title && !text) errors.push(`Не заповнено поле terms[${i}].text.`);
        } else errors.push(`terms[${i}]: умова має бути id або {title, text}.`);
      });
    }
  }
  const note = multiLine(body.accessories_note, "accessories_note", 1000, errors);
  if (note) o.accessories_note = note;
  const cover = multiLine(body.cover_text, "cover_text", 1000, errors);
  if (cover) o.cover_text = cover;
  if (body.photos !== undefined && body.photos !== null) {
    if (!isObject(body.photos)) errors.push("photos має бути об’єктом {cover?, end?, cover_focus?, end_focus?}.");
    else {
      const p: NonNullable<KpOptions["photos"]> = {};
      const assets = join(ctx.config.generatorDir, "assets");
      for (const k of ["cover", "end"] as const) {
        const v = body.photos[k];
        if (v === undefined || v === null || v === "") continue;
        const segs = typeof v === "string" && v.length <= 300 ? parsePath("/" + v) : null;
        if (!segs || !segs.length || !(await findFile([assets], segs))) { errors.push(`photos.${k}: фото «${String(v)}» не знайдено.`); continue; }
        p[k] = segs.join("/");
      }
      for (const k of ["cover_focus", "end_focus"] as const) {
        const v = body.photos[k];
        if (v === undefined || v === null) continue;
        if (!Array.isArray(v) || v.length !== 2 || !v.every((x) => typeof x === "number" && x >= 0 && x <= 1)) {
          errors.push(`photos.${k} має бути парою чисел від 0 до 1.`);
          continue;
        }
        p[k] = [v[0] as number, v[1] as number];
      }
      if (Object.keys(p).length) o.photos = p;
    }
  }
  return o;
}

/** Only the QuoteInput fields; core.validateSelection checks their content. */
function toQuoteInput(v: unknown): QuoteInput {
  if (!isObject(v)) throw new HttpError(400, "Запит на розрахунок має бути JSON-об’єктом {kit_type, selection, …}.");
  const input = { kit_type: v.kit_type, selection: v.selection } as QuoteInput;
  if (v.discount_pct !== undefined && v.discount_pct !== null) input.discount_pct = v.discount_pct as number;
  if (v.manual_prices !== undefined && v.manual_prices !== null) input.manual_prices = v.manual_prices as Record<string, number>;
  if (v.kit_price_uah !== undefined && v.kit_price_uah !== null) input.kit_price_uah = v.kit_price_uah as number;
  if (v.date !== undefined && v.date !== null) input.date = v.date as string;
  return input;
}

/** After validateSelection: the selection with known keys only (stored in the journal). */
function cleanInput(input: QuoteInput): QuoteInput {
  const sel = input.selection;
  const accessories: SelectionAccessory[] = (sel.accessories ?? []).map((a) => {
    const out: SelectionAccessory = { id: a.id };
    if (a.variant) out.variant = a.variant;
    if (typeof a.price_uah === "number") out.price_uah = a.price_uah;
    return out;
  });
  const out: QuoteInput = { ...input, selection: { slots: { ...(sel.slots ?? {}) }, choices: { ...(sel.choices ?? {}) }, accessories } };
  if (input.manual_prices && !Object.keys(input.manual_prices).length) delete out.manual_prices;
  if (!input.discount_pct) delete out.discount_pct;
  return out;
}

// ------------------------------------------------------------------ manual prices

/**
 * Manual prices (manual_prices, kit_price_uah, accessory price_uah) must belong to the selected kit, and together
 * with the discount they must not take the total more than max_discount_pct below the computed one. A manual price
 * for a position without a computed price (on request) only fills the gap. The admin token lifts the limit.
 */
export function manualPriceErrors(c: Catalog, s: Settings, rate: RateInfo, input: QuoteInput, admin: boolean): string[] {
  const errors: string[] = [];
  const kt = kitTypeById(c, input.kit_type)!;
  const sel = normalizeSelection(kt, input.selection);
  const chosen = new Set(Object.values(sel.slots).filter((x): x is string => !!x));
  const manual = input.manual_prices ?? {};
  for (const id of Object.keys(manual)) {
    if (!chosen.has(id)) errors.push(`Ручна ціна для «${itemById(c, id)?.title ?? id}»: цього виробу немає в комплекті.`);
  }
  if (errors.length || admin) return errors;
  const accManual = sel.accessories.some((a) => typeof a.price_uah === "number");
  if (!Object.keys(manual).length && typeof input.kit_price_uah !== "number" && !accManual) return errors;

  const strip = (keep: (a: SelectionAccessory, i: number) => boolean): Selection => ({
    ...sel,
    accessories: sel.accessories.map((a, i) => {
      if (keep(a, i)) return a;
      const { price_uah: _drop, ...rest } = a;
      return rest;
    }),
  });
  const base = quote(c, s, rate, { ...input, manual_prices: {}, kit_price_uah: null, discount_pct: 0, selection: strip(() => false) });
  const refManual: Record<string, number> = {};
  for (const [id, v] of Object.entries(manual)) if (itemPrice(c, s, rate, id, base.date)?.price_uah == null) refManual[id] = v;
  const reference = quote(c, s, rate, {
    ...input, discount_pct: 0, manual_prices: refManual,
    kit_price_uah: typeof input.kit_price_uah === "number" && (base.kit_price_uah ?? null) === null ? input.kit_price_uah : null,
    selection: strip((_, i) => base.accessories[i]?.price_uah === null),
  });
  const final = quote(c, s, rate, input);
  const floor = reference.total_uah * (1 - s.max_discount_pct / 100) - Math.max(1, s.rounding_uah);
  if (final.total_uah < floor) {
    errors.push(`З ручними цінами${final.discount_pct ? " і знижкою" : ""} сума ${formatUah(final.total_uah)} нижча за розрахункову `
      + `${formatUah(reference.total_uah)} більш ніж на ${formatPct(s.max_discount_pct)}. Таку ціну може задати лише адміністратор.`);
  }
  return errors;
}

// ------------------------------------------------------------------ quoting

async function computeQuote(ctx: AppContext, req: IncomingMessage, input: QuoteInput): Promise<{ q: Quote; input: QuoteInput; settings: Settings; rate: RateInfo }> {
  const settings = ctx.settings.get();
  const verr = validateSelection(ctx.catalog, input);
  if (verr.length) throw new HttpError(400, "Невірний вибір комплекту.", verr);
  const clean = cleanInput(input);
  const rate = await ctx.rates.info(settings, ctx.refDates);
  try {
    const merr = manualPriceErrors(ctx.catalog, settings, rate, clean, isAdmin(req, ctx.config));
    if (merr.length) throw new HttpError(400, "Ручні ціни не прийнято.", merr);
    return { q: quote(ctx.catalog, settings, rate, clean), input: clean, settings, rate };
  } catch (e) {
    if (e instanceof QuoteError) throw new HttpError(400, "Невірний запит на розрахунок.", e.errors);
    throw e;
  }
}

async function createKp(ctx: AppContext, req: IncomingMessage, res: ServerResponse, input: QuoteInput, client: KpClient,
  manager: KpManager | null, options: KpOptions, recalcOf: string | null): Promise<void> {
  const { q, input: clean, settings, rate } = await computeQuote(ctx, req, input);
  const meta = (number: string): KpMeta => ({ number, client, ...options });
  try {
    buildKpSpec(ctx.catalog, settings, q, meta("0000"));
  } catch (e) {
    if (e instanceof KpSpecError) throw new HttpError(422, "Для цього комплекту КП не можна згенерувати.", e.errors);
    throw e;
  }
  const id = randomUUID();
  const rec = ctx.journal.create(
    { id, date: q.date, kit_type: q.kit_type, client, manager, quote_input: clean, quote: q, settings, rate,
      catalog_version: ctx.catalog.version, options, recalc_of: recalcOf },
    (number) => buildKpSpec(ctx.catalog, settings, q, meta(number)),
    (spec) => (spec.total_text === TEXT_ON_REQUEST ? null : q.total_uah),
  );
  ctx.queue.enqueue(id);
  ctx.log(`КП ${rec.number}/${rec.year} (${rec.title}, ${client.name}) у черзі${recalcOf ? `, перерахунок ${recalcOf}` : ""}`);
  const out: Record<string, unknown> = { id, number: rec.number, year: rec.year, status: "queued", title: rec.title };
  if (recalcOf) out.recalc_of = recalcOf;
  sendJson(res, 202, out, { Location: `/api/kp/${id}` });
}

function recordOut(ctx: AppContext, r: KpRecord): Record<string, unknown> {
  const file = (kind: "pdf" | "pptx") => {
    const f = r.files?.[kind];
    return f ? { name: f.name, size: f.size, url: `/api/kp/${r.id}/file/${kind}` } : null;
  };
  const { seq: _seq, ...rest } = r;
  const out: Record<string, unknown> = {
    ...rest,
    files: r.files ? { pptx: file("pptx"), pdf: file("pdf"), pages: r.files.pages } : null,
  };
  const pos = ctx.queue.position(r.id);
  if (pos !== null && (r.status === "queued" || r.status === "running")) out.queue_position = pos;
  return out;
}

function intParam(q: URLSearchParams, name: string, def: number, lo: number, hi: number): number {
  const v = q.get(name);
  if (v === null || v === "") return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new HttpError(400, `Параметр ${name} має бути цілим числом від ${lo} до ${hi}.`);
  return n;
}

function contentDisposition(name: string, inline: boolean): string {
  const ascii = name.replace(/[^A-Za-z0-9._-]+/g, "_") || "KP";
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

// ------------------------------------------------------------------ router

export async function handleApi(ctx: AppContext, req: IncomingMessage, res: ServerResponse, segs: string[], query: URLSearchParams): Promise<void> {
  const method = req.method === "HEAD" ? "GET" : req.method ?? "GET";
  const limit = ctx.config.maxBodyBytes;
  const [a, b, c, d, ...more] = segs;

  if (a === "health" && segs.length === 1) {
    if (method !== "GET") methodNotAllowed("GET, HEAD");
    sendJson(res, 200, { ok: true, version: ctx.version, catalog_version: ctx.catalog.version,
      auth_required: !!ctx.config.accessToken, settings_editable: !!ctx.config.adminToken });
    return;
  }
  requireAccess(req, ctx.config);

  if (a === "catalog" && segs.length === 1) {
    if (method !== "GET") methodNotAllowed("GET, HEAD");
    const inm = req.headers["if-none-match"];
    const headers = { ETag: ctx.catalogEtag, "Cache-Control": "no-cache" };
    if (typeof inm === "string" && inm.split(",").map((s) => s.trim()).includes(ctx.catalogEtag)) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    const data = Buffer.from(ctx.catalogJson, "utf8");
    res.writeHead(200, { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Length": String(data.length) });
    res.end(data);
    return;
  }

  if (a === "settings" && segs.length === 1) {
    if (method === "GET") { sendJson(res, 200, ctx.settings.get()); return; }
    if (method !== "PUT") methodNotAllowed("GET, HEAD, PUT");
    requireAdmin(req, ctx.config);
    const body = await readJson(req, limit);
    try {
      const saved = ctx.settings.save(body);
      ctx.log("налаштування змінено адміністратором");
      sendJson(res, 200, saved);
    } catch (e) {
      if (e instanceof SettingsError) throw new HttpError(400, e.message, e.errors);
      throw e;
    }
    return;
  }

  if (a === "rate" && segs.length === 1) {
    if (method !== "GET") methodNotAllowed("GET, HEAD");
    sendJson(res, 200, await ctx.rates.current(ctx.settings.get()));
    return;
  }

  if (a === "quote" && segs.length === 1) {
    if (method !== "POST") methodNotAllowed("POST");
    const input = toQuoteInput(await readJson(req, limit));
    if (input.date === undefined) input.date = ctx.today();
    const { q } = await computeQuote(ctx, req, input);
    sendJson(res, 200, q);
    return;
  }

  if (a === "kp" && segs.length === 1) {
    if (method === "GET") {
      const q = (query.get("q") ?? "").trim();
      if (q.length > 200) throw new HttpError(400, "Параметр q: не довше 200 символів.");
      sendJson(res, 200, ctx.journal.list(q, intParam(query, "limit", 50, 1, 200), intParam(query, "offset", 0, 0, 1_000_000)));
      return;
    }
    if (method !== "POST") methodNotAllowed("GET, HEAD, POST");
    const body = await readJson(req, limit);
    if (!isObject(body)) throw new HttpError(400, "Тіло запиту має бути JSON-об’єктом {quote_input, client, …}.");
    const errors: string[] = [];
    if (!isObject(body.quote_input)) errors.push("Не передано quote_input (вибір комплекту).");
    const client = parseClient(body.client, errors);
    const manager = parseManager(body.manager, errors);
    const options = await parseOptions(ctx, body, errors);
    if (errors.length) throw new HttpError(400, "Невірні дані для КП.", errors);
    const input = toQuoteInput(body.quote_input);
    input.date = ctx.today();                   // a KP is always dated today
    await createKp(ctx, req, res, input, client, manager, options, null);
    return;
  }

  if (a === "kp" && b !== undefined) {
    const rec = ID.test(b) ? ctx.journal.get(b) : null;
    if (segs.length === 2) {
      if (method !== "GET") methodNotAllowed("GET, HEAD");
      if (!rec) throw new HttpError(404, "КП не знайдено.");
      sendJson(res, 200, recordOut(ctx, rec));
      return;
    }
    if (c === "file" && d !== undefined && segs.length === 4 && !more.length) {
      if (method !== "GET") methodNotAllowed("GET, HEAD");
      if (!rec) throw new HttpError(404, "КП не знайдено.");
      if (d !== "pdf" && d !== "pptx") throw new HttpError(404, "Невідомий тип файлу: можна pdf або pptx.");
      const f = rec.files?.[d];
      if (!f) {
        if (rec.status === "queued" || rec.status === "running") throw new HttpError(409, "КП ще генерується, спробуйте за хвилину.");
        throw new HttpError(404, d === "pdf" ? "PDF для цієї КП не створено." : "PPTX для цієї КП не створено.");
      }
      const found = await findFile([kpDir(ctx.config.dataDir, rec.id)], [f.name]);
      if (!found) throw new HttpError(404, "Файл КП не знайдено на сервері.");
      const inline = d === "pdf" && query.get("inline") === "1";
      sendFile(req, res, found, FILE_TYPES[d], "private, no-cache", { "Content-Disposition": contentDisposition(f.name, inline) });
      return;
    }
    if (c === "recalc" && segs.length === 3) {
      if (method !== "POST") methodNotAllowed("POST");
      if (!rec) throw new HttpError(404, "КП не знайдено.");
      await readJson(req, limit, true);
      const input: QuoteInput = { ...rec.quote_input, date: ctx.today() };
      await createKp(ctx, req, res, input, rec.client, rec.manager, rec.options, rec.id);
      return;
    }
  }
  throw new HttpError(404, "Невідомий шлях API.");
}
