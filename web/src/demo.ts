// Demo adapter: the same Api, served in the browser from embedded data (scripts/build-demo.mjs) and core.
// The EUR rate is a fixed demo value, the journal lives in localStorage and no PDF/PPTX is ever produced.
import type { Catalog, QuoteInput, Settings } from "../../core/src/index.js";
import { KpSpecError, QuoteError, buildKpSpec, quote, todayIso, validateSettings } from "../../core/src/index.js";
import type { Api, FileKind, KpCreateBody, KpCreated, KpListItem, KpRecord, RateResp } from "./api.js";
import { ApiError, clientName } from "./api.js";
import { KEYS, local } from "./storage.js";

export interface DemoData {
  catalog: Catalog;
  settings: Settings;
  rate: RateResp;                       // source "demo"
  built_at?: string;
}

declare global {
  interface Window {
    KP_DEMO_DATA?: DemoData;
    KpAndroid?: { postMessage(msg: string): void };
  }
}

export const DEMO_NO_FILES = "У демо-режимі PDF і PPTX не формуються: КП генерує сервер (шаблон KP_2_v3, python-pptx і LibreOffice). Розрахунок збережено в демо-журналі цього браузера.";
const MAX_RECORDS = 100;

interface Journal { seq: Record<string, number>; records: KpRecord[] }

function rid(): string { return "demo-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

export class DemoApi implements Api {
  readonly mode = "demo" as const;
  private readonly data: DemoData;

  constructor(data: DemoData) { this.data = data; }

  private journal(): Journal {
    const j = local.getJson<Journal>(KEYS.demoJournal);
    return j && Array.isArray(j.records) && j.seq && typeof j.seq === "object" ? j : { seq: {}, records: [] };
  }

  private saveJournal(j: Journal): void {
    j.records = j.records.slice(0, MAX_RECORDS);
    if (!local.setJson(KEYS.demoJournal, j)) throw new ApiError(507, "Не вдалося зберегти демо-журнал у браузері (сховище недоступне або заповнене).");
  }

  private currentSettings(): Settings { return local.getJson<Settings>(KEYS.demoSettings) ?? this.data.settings; }

  async health() { return { ok: true, version: "demo" }; }
  async catalog() { return this.data.catalog; }
  async settings() { return structuredClone(this.currentSettings()); }
  async rate() { return { ...this.data.rate }; }

  async saveSettings(s: Settings, admin: string): Promise<Settings> {
    if (!admin) throw new ApiError(403, "Потрібен токен адміністратора.");
    const errors = validateSettings(s, this.data.catalog);
    if (errors.length) throw new ApiError(400, errors.join(" "), errors);
    if (!local.setJson(KEYS.demoSettings, s)) throw new ApiError(507, "Не вдалося зберегти налаштування в браузері.");
    return structuredClone(s);
  }

  async quote(input: QuoteInput) {
    try {
      return quote(this.data.catalog, this.currentSettings(), this.data.rate, input);
    } catch (e) {
      if (e instanceof QuoteError) throw new ApiError(400, e.message, e.errors);
      throw e;
    }
  }

  async createKp(body: KpCreateBody): Promise<KpCreated> {
    const name = body.client?.name?.trim();
    if (!name) throw new ApiError(400, "Вкажіть клієнта.");
    const q = await this.quote(body.quote_input);
    const j = this.journal();
    const year = q.date.slice(0, 4);
    const n = (j.seq[year] ?? 0) + 1;
    const number = String(n).padStart(4, "0");
    const settings = this.currentSettings();
    const client = body.client.contact ? { name, contact: body.client.contact } : { name };
    let spec;
    try {
      spec = buildKpSpec(this.data.catalog, settings, q, {
        number, client, ...(body.maker ? { maker: body.maker } : {}), ...(body.terms ? { terms: body.terms } : {}),
      });
    } catch (e) {
      if (e instanceof KpSpecError) throw new ApiError(400, e.message, e.errors);
      throw e;
    }
    const rec: KpRecord = {
      id: rid(), number, date: q.date, client, title: spec.title, total_uah: q.total_uah, status: "demo",
      quote_input: body.quote_input, quote: q, spec, manager: body.manager ?? null, maker: body.maker ?? settings.company_maker,
      created_at: new Date().toISOString(), rate: { ...this.data.rate }, files: null,
      error: null,
    };
    j.seq[year] = n;
    j.records.unshift(rec);
    this.saveJournal(j);
    return { id: rec.id, number, status: rec.status };
  }

  async listKp(q: string, limit: number): Promise<KpListItem[]> {
    const needle = q.trim().toLowerCase();
    return this.journal().records
      .filter((r) => !needle || [r.number, clientName(r.client), r.title, r.date].join(" ").toLowerCase().includes(needle))
      .slice(0, limit)
      .map(({ id, number, date, client, title, total_uah, status }) => ({ id, number, date, client, title, total_uah, status }));
  }

  async getKp(id: string): Promise<KpRecord> {
    const r = this.journal().records.find((x) => x.id === id);
    if (!r) throw new ApiError(404, "КП не знайдено в демо-журналі.");
    return r;
  }

  async recalc(id: string): Promise<KpCreated> {
    const r = await this.getKp(id);
    if (!r.quote_input) throw new ApiError(400, "У записі немає вихідних даних розрахунку.");
    const { date: _old, ...input } = r.quote_input;
    const client = typeof r.client === "string" ? { name: r.client } : r.client;
    return this.createKp({
      quote_input: { ...input, date: todayIso() }, client,
      ...(r.manager ? { manager: r.manager } : {}), ...(r.maker ? { maker: r.maker } : {}),
    });
  }

  async download(_id: string, _kind: FileKind): Promise<{ blob: Blob; fileName: string }> {
    throw new ApiError(501, DEMO_NO_FILES);
  }

  fileUrl(): string { return ""; }
}
