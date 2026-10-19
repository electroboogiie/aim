// Pricing settings: catalog/settings.default.json, overridden by $KP_DATA_DIR/settings.json (written by PUT /api/settings).
import { existsSync, readFileSync } from "node:fs";
import type { Catalog, Settings } from "../../core/src/index.js";
import { validateSettings } from "../../core/src/index.js";
import { isObject, parseJson } from "./http.js";
import { writeFileAtomic } from "./fsutil.js";

const KNOWN_KEYS = ["eur", "metal", "labor_rate_uah", "groups", "vat_pct", "rounding_uah", "validity_days", "max_discount_pct",
  "company_maker", "kp_number_prefix"];

export class SettingsError extends Error {
  readonly errors: string[];
  constructor(message: string, errors: string[]) {
    super(message);
    this.errors = errors;
  }
}

function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)) as T; }

/** Stored settings on top of the defaults: price groups or keys added to the defaults later get their default value. */
function overlay(defaults: Settings, stored: Record<string, unknown>): Settings {
  const out = clone(defaults) as unknown as Record<string, unknown>;
  const allowed = new Set([...KNOWN_KEYS, ...Object.keys(defaults)]);
  for (const [k, v] of Object.entries(stored)) {
    if (!allowed.has(k)) continue;
    const d = out[k];
    out[k] = isObject(d) && isObject(v) && (k === "groups" || k === "eur" || k === "metal") ? { ...d, ...v } : v;
  }
  return out as unknown as Settings;
}

export class SettingsStore {
  private current: Settings;
  readonly defaults: Settings;

  constructor(private readonly file: string, defaultsFile: string, private readonly catalog: Catalog) {
    let defaults: unknown;
    try { defaults = parseJson(readFileSync(defaultsFile, "utf8")); } catch (e) {
      throw new SettingsError(`Не вдалося прочитати типові налаштування ${defaultsFile}: ${(e as Error).message}`, []);
    }
    if (!isObject(defaults)) throw new SettingsError(`Типові налаштування ${defaultsFile} мають бути JSON-об’єктом.`, []);
    const derr = validateSettings(defaults as unknown as Settings, catalog);
    if (derr.length) throw new SettingsError(`Типові налаштування ${defaultsFile} невірні.`, derr);
    this.defaults = defaults as unknown as Settings;
    this.current = this.load();
  }

  private load(): Settings {
    if (!existsSync(this.file)) return clone(this.defaults);
    let stored: unknown;
    try { stored = parseJson(readFileSync(this.file, "utf8")); } catch (e) {
      throw new SettingsError(`Файл налаштувань ${this.file} пошкоджено: ${(e as Error).message}. Виправте або видаліть його `
        + "(тоді діятимуть типові налаштування).", []);
    }
    if (!isObject(stored)) throw new SettingsError(`Файл налаштувань ${this.file} має містити JSON-об’єкт.`, []);
    const s = overlay(this.defaults, stored);
    const errors = validateSettings(s, this.catalog);
    if (errors.length) throw new SettingsError(`Файл налаштувань ${this.file} не відповідає каталогу. Виправте його через `
      + "PUT /api/settings або вручну.", errors);
    return s;
  }

  get(): Settings { return clone(this.current); }

  /** Errors of a PUT body (Ukrainian); [] = it can be saved. */
  check(body: unknown): string[] {
    if (!isObject(body)) return ["Налаштування мають бути JSON-об’єктом."];
    const allowed = new Set([...KNOWN_KEYS, ...Object.keys(this.defaults)]);
    const unknown = Object.keys(body).filter((k) => !allowed.has(k));
    const errors = unknown.map((k) => `Невідоме поле налаштувань «${k}».`);
    const missing = [...allowed].filter((k) => !(k in body));
    if (missing.length) errors.push(`Потрібні всі налаштування; бракує: ${missing.join(", ")}.`);
    if (errors.length) return errors;
    errors.push(...validateSettings(body as unknown as Settings, this.catalog));
    if (typeof body.kp_number_prefix === "string" && body.kp_number_prefix.length > 20) errors.push("kp_number_prefix: не довше 20 символів.");
    return errors;
  }

  save(body: unknown): Settings {
    const errors = this.check(body);
    if (errors.length) throw new SettingsError("Налаштування не збережено: є помилки.", errors);
    const s = clone(body) as Settings;
    writeFileAtomic(this.file, JSON.stringify(s, null, 2) + "\n");
    this.current = s;
    return clone(s);
  }
}
