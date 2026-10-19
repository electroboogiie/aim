// EUR rate (GET /api/rate and every quote): NBU via the global fetch, so NODE_USE_ENV_PROXY=1 + HTTPS_PROXY
// route it through a proxy. Cached for 6 h within the same day, last good value kept in $KP_DATA_DIR/rates.json
// for offline use, manual rate from the settings. Reference-date rates (core refRateDates) come from the NBU
// archive once and are kept forever. Nothing here throws to the caller.
import { existsSync, readFileSync } from "node:fs";
import type { RateInfo, Settings } from "../../core/src/index.js";
import { formatDate, isIsoDate, todayIso } from "../../core/src/index.js";
import { writeFileAtomic } from "./fsutil.js";
import { isObject } from "./http.js";

export interface RateState {
  eur: number | null;
  date: string | null;                 // ISO date the rate is set for
  source: "nbu" | "manual" | "cache" | "none";
  fetched_at: string | null;
  stale?: boolean;                     // true: NBU did not answer, this is the last saved rate
  message?: string;                    // Ukrainian note for the UI when the rate is not fresh
}

interface CacheFile {
  current?: { eur: number; date: string; fetched_at: string };
  ref: Record<string, number>;
}

export interface RateOptions {
  url: string;
  file: string;                        // cache file
  ttlMs?: number;
  timeoutMs?: number;
  retryMs?: number;                    // after a failed fetch of the current rate, wait before the next try
  refRetryMs?: number;
  now?: () => Date;
  fetchFn?: typeof fetch;
  log?: (msg: string) => void;
}

export const HOUR = 3600_000;

/** The NBU URL for one date: "date=YYYYMMDD" replaced or appended. */
export function nbuUrlForDate(url: string, iso: string): string {
  const d = iso.replaceAll("-", "");
  if (/[?&]date=[^&]*/.test(url)) return url.replace(/([?&])date=[^&]*/, `$1date=${d}`);
  return url + (url.includes("?") ? "&" : "?") + `date=${d}`;
}

/** {eur, date} from an NBU answer: [{"r030":978,"cc":"EUR","rate":48.1,"exchangedate":"18.10.2026"}]. */
export function parseNbu(data: unknown): { eur: number; date: string } {
  if (!Array.isArray(data)) throw new Error("відповідь НБУ не є списком");
  const row = data.find((x) => isObject(x) && (x.cc === "EUR" || x.r030 === 978));
  if (!isObject(row)) throw new Error("у відповіді НБУ немає курсу EUR");
  const eur = typeof row.rate === "number" ? row.rate : Number(row.rate);
  if (!Number.isFinite(eur) || eur <= 0 || eur > 10000) throw new Error(`невірний курс у відповіді НБУ: ${String(row.rate)}`);
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(row.exchangedate ?? ""));
  const date = m ? `${m[3]}-${m[2]}-${m[1]}` : "";
  if (!isIsoDate(date)) throw new Error(`невірна дата у відповіді НБУ: ${String(row.exchangedate)}`);
  return { eur, date };
}

export class RateService {
  private readonly o: Required<Omit<RateOptions, "log" | "fetchFn">> & Pick<RateOptions, "log" | "fetchFn">;
  private cache: CacheFile = { ref: {} };
  private inflight: Promise<void> | null = null;
  private lastFail = -Infinity;
  private lastError = "";
  private refInflight: Promise<void> | null = null;
  private refLastFail = -Infinity;

  constructor(opts: RateOptions) {
    this.o = { ttlMs: 6 * HOUR, timeoutMs: 8000, retryMs: 60_000, refRetryMs: 10 * 60_000, now: () => new Date(), ...opts };
    this.cache = this.read();
  }

  private log(msg: string): void { this.o.log?.(msg); }

  private read(): CacheFile {
    try {
      if (!existsSync(this.o.file)) return { ref: {} };
      const raw = JSON.parse(readFileSync(this.o.file, "utf8")) as unknown;
      if (!isObject(raw)) return { ref: {} };
      const out: CacheFile = { ref: {} };
      const c = raw.current;
      if (isObject(c) && typeof c.eur === "number" && c.eur > 0 && isIsoDate(c.date) && typeof c.fetched_at === "string"
          && !Number.isNaN(Date.parse(c.fetched_at))) {
        out.current = { eur: c.eur, date: c.date, fetched_at: c.fetched_at };
      }
      if (isObject(raw.ref)) {
        for (const [d, v] of Object.entries(raw.ref)) if (isIsoDate(d) && typeof v === "number" && v > 0) out.ref[d] = v;
      }
      return out;
    } catch (e) {
      this.log(`курс EUR: кеш ${this.o.file} не прочитано (${(e as Error).message}), починаємо з порожнього`);
      return { ref: {} };
    }
  }

  private persist(): void {
    try { writeFileAtomic(this.o.file, JSON.stringify(this.cache, null, 1) + "\n"); } catch (e) {
      this.log(`курс EUR: не вдалося записати кеш ${this.o.file}: ${(e as Error).message}`);
    }
  }

  private async fetchJson(url: string): Promise<{ eur: number; date: string }> {
    const f = this.o.fetchFn ?? fetch;
    const r = await f(url, { signal: AbortSignal.timeout(this.o.timeoutMs), headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`НБУ відповів HTTP ${r.status}`);
    const text = await r.text();
    if (text.length > 1_000_000) throw new Error("завелика відповідь НБУ");
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new Error("відповідь НБУ не є JSON"); }
    return parseNbu(data);
  }

  private fresh(): boolean {
    const c = this.cache.current;
    if (!c) return false;
    const now = this.o.now();
    const at = new Date(c.fetched_at);
    return now.getTime() - at.getTime() < this.o.ttlMs && now.getTime() >= at.getTime() && todayIso(at) === todayIso(now);
  }

  private refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const r = await this.fetchJson(this.o.url);
        this.cache.current = { eur: r.eur, date: r.date, fetched_at: this.o.now().toISOString() };
        this.lastError = "";
        this.persist();
      } catch (e) {
        this.lastFail = this.o.now().getTime();
        const msg = errorText(e);
        if (msg !== this.lastError) this.log(`курс EUR: НБУ недоступний (${msg})`);
        this.lastError = msg;
      }
    })().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  /** The rate a quote uses now (GET /api/rate). */
  async current(settings: Settings): Promise<RateState> {
    try {
      if (settings.eur.mode === "manual") {
        const eur = settings.eur.manual_rate;
        return { eur: typeof eur === "number" && eur > 0 ? eur : null, date: todayIso(this.o.now()), source: "manual", fetched_at: null };
      }
      if (!this.fresh() && this.o.now().getTime() - this.lastFail >= this.o.retryMs) await this.refresh();
      const c = this.cache.current;
      if (this.fresh() && c) return { eur: c.eur, date: c.date, source: "nbu", fetched_at: c.fetched_at };
      if (c) {
        return { eur: c.eur, date: c.date, source: "cache", fetched_at: c.fetched_at, stale: true,
          message: `Курс НБУ зараз недоступний: використано останній отриманий курс на ${formatDate(c.date)}.` };
      }
      return { eur: null, date: null, source: "none", fetched_at: null,
        message: "Курс EUR НБУ недоступний і збереженого курсу немає: ціни, прив’язані до EUR, не перераховано." };
    } catch (e) {
      this.log(`курс EUR: ${errorText(e)}`);
      return { eur: null, date: null, source: "none", fetched_at: null };
    }
  }

  /** NBU rates for reference dates (fetched once, kept in the cache file). */
  async refRates(dates: string[]): Promise<Record<string, number>> {
    try {
      const today = todayIso(this.o.now());
      const missing = dates.filter((d) => isIsoDate(d) && d <= today && !(d in this.cache.ref));
      if (missing.length && !this.refInflight && this.o.now().getTime() - this.refLastFail >= this.o.refRetryMs) {
        this.refInflight = this.fetchRefs(missing).finally(() => { this.refInflight = null; });
      }
      if (this.refInflight) await this.refInflight;
    } catch (e) {
      this.log(`курс EUR на дати цін: ${errorText(e)}`);
    }
    const out: Record<string, number> = {};
    for (const d of dates) if (this.cache.ref[d] !== undefined) out[d] = this.cache.ref[d]!;
    return out;
  }

  private async fetchRefs(dates: string[]): Promise<void> {
    let failed = 0;
    let lastErr = "";
    const queue = [...dates];
    const worker = async () => {
      for (let d = queue.shift(); d !== undefined; d = queue.shift()) {
        try {
          const r = await this.fetchJson(nbuUrlForDate(this.o.url, d));
          this.cache.ref[d] = r.eur;
        } catch (e) {
          failed++;
          lastErr = errorText(e);
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (failed) {
      this.refLastFail = this.o.now().getTime();
      this.log(`курс EUR на дати цін: не отримано ${failed} з ${dates.length} (${lastErr})`);
    }
    if (failed < dates.length) this.persist();
  }

  /** RateInfo for core.quote: the current rate plus the reference-date rates. */
  async info(settings: Settings, refDates: string[]): Promise<RateInfo & RateState> {
    const [cur, ref] = await Promise.all([this.current(settings), this.refRates(refDates)]);
    return { ...cur, ref_rates: ref };
  }
}

function errorText(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === "TimeoutError" || e.name === "AbortError") return "немає відповіді (тайм-аут)";
    const cause = (e as Error & { cause?: unknown }).cause;
    return cause instanceof Error ? `${e.message}: ${cause.message}` : e.message;
  }
  return String(e);
}
