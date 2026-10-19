// KP journal in SQLite (node:sqlite): every KP with the full input snapshot, numbered per year.
import { DatabaseSync } from "node:sqlite";
import type { KpSpec, Quote, QuoteInput, RateInfo, Settings } from "../../core/src/index.js";

export type KpStatus = "queued" | "running" | "ready" | "error";

export interface KpFile { name: string; size: number }
export interface KpFiles { pptx: KpFile | null; pdf: KpFile | null; pages: number | null }

export interface KpClient { name: string; contact?: string }
export interface KpManager { name?: string; phone?: string; email?: string }

/** What POST /api/kp passed besides the quote input (kept for recalc). */
export interface KpOptions {
  maker?: string;
  terms?: (string | { title: string; text: string })[];
  photos?: KpSpec["photos"];
  accessories_note?: string;
  cover_text?: string;
}

export interface KpRecord {
  id: string;
  year: number;
  seq: number;
  number: string;
  created_at: string;
  updated_at: string;
  date: string;
  kit_type: string;
  client: KpClient;
  manager: KpManager | null;
  title: string;
  total_uah: number | null;
  total_text: string;
  status: KpStatus;
  error: string | null;
  quote_input: QuoteInput;
  quote: Quote;
  spec: KpSpec;
  settings: Settings;
  rate: RateInfo;
  catalog_version: string;
  files: KpFiles | null;
  options: KpOptions;
  recalc_of: string | null;
  gen_warnings: string[];
  started_at: string | null;
  finished_at: string | null;
}

export interface KpListItem {
  id: string; number: string; year: number; date: string; created_at: string; client: KpClient; title: string;
  total_uah: number | null; total_text: string; status: KpStatus; kit_type: string; error: string | null;
}

export interface NewKp {
  id: string;
  date: string;
  kit_type: string;
  client: KpClient;
  manager: KpManager | null;
  quote_input: QuoteInput;
  quote: Quote;
  settings: Settings;
  rate: RateInfo;
  catalog_version: string;
  options: KpOptions;
  recalc_of: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kp (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  number TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  date TEXT NOT NULL,
  kit_type TEXT NOT NULL,
  client TEXT NOT NULL,
  manager TEXT,
  title TEXT NOT NULL,
  total_uah REAL,
  total_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  error TEXT,
  quote_input TEXT NOT NULL,
  quote TEXT NOT NULL,
  spec TEXT NOT NULL,
  settings TEXT NOT NULL,
  rate TEXT NOT NULL,
  catalog_version TEXT NOT NULL,
  files TEXT,
  options TEXT NOT NULL DEFAULT '{}',
  recalc_of TEXT,
  gen_warnings TEXT NOT NULL DEFAULT '[]',
  started_at TEXT,
  finished_at TEXT,
  search TEXT NOT NULL DEFAULT '',
  UNIQUE (year, seq)
);
CREATE INDEX IF NOT EXISTS kp_status ON kp (status);
`;

type Row = Record<string, unknown>;

const j = <T>(v: unknown, def: T): T => (typeof v === "string" && v ? (JSON.parse(v) as T) : def);

function searchText(parts: (string | number | null | undefined)[]): string {
  return parts.filter((x) => x !== null && x !== undefined && x !== "").join(" ").toLocaleLowerCase("uk");
}

function likeEscape(s: string): string { return s.replace(/[\\%_]/g, (m) => "\\" + m); }

export class Journal {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
    this.db.exec("PRAGMA user_version = 1");
  }

  close(): void { if (this.db.isOpen) this.db.close(); }

  /**
   * Inserts a KP with the next number of its year. `spec` is built with the number inside the same
   * transaction, so numbers have no gaps from failed builds and never repeat.
   */
  create(kp: NewKp, spec: (number: string) => KpSpec, totalOf: (spec: KpSpec) => number | null): KpRecord {
    const year = Number(kp.date.slice(0, 4));
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM kp WHERE year = ?").get(year) as Row;
      const seq = Number(row.m) + 1;
      const number = String(seq).padStart(4, "0");
      const s = spec(number);
      const total = totalOf(s);
      this.db.prepare(`INSERT INTO kp (id, year, seq, number, created_at, updated_at, date, kit_type, client, manager, title,
          total_uah, total_text, status, error, quote_input, quote, spec, settings, rate, catalog_version, files, options,
          recalc_of, gen_warnings, search)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?, '[]', ?)`).run(
        kp.id, year, seq, number, now, now, kp.date, kp.kit_type, JSON.stringify(kp.client),
        kp.manager ? JSON.stringify(kp.manager) : null, s.title, total, s.total_text, JSON.stringify(kp.quote_input),
        JSON.stringify(kp.quote), JSON.stringify(s), JSON.stringify(kp.settings), JSON.stringify(kp.rate), kp.catalog_version,
        JSON.stringify(kp.options), kp.recalc_of,
        searchText([number, `${number}/${year}`, kp.client.name, kp.client.contact, s.title, kp.manager?.name, kp.manager?.phone]),
      );
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return this.get(kp.id)!;
  }

  get(id: string): KpRecord | null {
    const r = this.db.prepare("SELECT * FROM kp WHERE id = ?").get(id) as Row | undefined;
    return r ? toRecord(r) : null;
  }

  /** Newest first; every word of `q` must occur in the number, client, title or manager. */
  list(q: string, limit: number, offset: number): KpListItem[] {
    const words = q.toLocaleLowerCase("uk").split(/\s+/).filter(Boolean).slice(0, 8);
    const where = words.map(() => "search LIKE ? ESCAPE '\\'").join(" AND ");
    const sql = `SELECT id, number, year, date, created_at, client, title, total_uah, total_text, status, kit_type, error
      FROM kp ${where ? "WHERE " + where : ""} ORDER BY rowid DESC LIMIT ? OFFSET ?`;
    const rows = this.db.prepare(sql).all(...words.map((w) => `%${likeEscape(w)}%`), limit, offset) as Row[];
    return rows.map((r) => ({
      id: String(r.id), number: String(r.number), year: Number(r.year), date: String(r.date), created_at: String(r.created_at),
      client: j<KpClient>(r.client, { name: "" }), title: String(r.title), total_uah: r.total_uah === null ? null : Number(r.total_uah),
      total_text: String(r.total_text ?? ""), status: r.status as KpStatus, kit_type: String(r.kit_type),
      error: r.error === null ? null : String(r.error),
    }));
  }

  /** Ids of jobs that have to run (queued or interrupted while running), oldest first. */
  pending(): string[] {
    const rows = this.db.prepare("SELECT id FROM kp WHERE status IN ('queued', 'running') ORDER BY rowid").all() as Row[];
    return rows.map((r) => String(r.id));
  }

  setQueued(id: string): void {
    this.db.prepare("UPDATE kp SET status = 'queued', started_at = NULL, updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  setRunning(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE kp SET status = 'running', error = NULL, started_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
  }

  finish(id: string, status: "ready" | "error", error: string | null, files: KpFiles | null, warnings: string[]): void {
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE kp SET status = ?, error = ?, files = ?, gen_warnings = ?, finished_at = ?, updated_at = ?
      WHERE id = ?`).run(status, error, files ? JSON.stringify(files) : null, JSON.stringify(warnings), now, now, id);
  }
}

function toRecord(r: Row): KpRecord {
  return {
    id: String(r.id), year: Number(r.year), seq: Number(r.seq), number: String(r.number), created_at: String(r.created_at),
    updated_at: String(r.updated_at), date: String(r.date), kit_type: String(r.kit_type), client: j<KpClient>(r.client, { name: "" }),
    manager: j<KpManager | null>(r.manager, null), title: String(r.title), total_uah: r.total_uah === null ? null : Number(r.total_uah),
    total_text: String(r.total_text ?? ""), status: r.status as KpStatus, error: r.error === null ? null : String(r.error),
    quote_input: j<QuoteInput>(r.quote_input, { kit_type: "", selection: { slots: {}, choices: {}, accessories: [] } }),
    quote: j<Quote>(r.quote, {} as Quote), spec: j<KpSpec>(r.spec, {} as KpSpec), settings: j<Settings>(r.settings, {} as Settings),
    rate: j<RateInfo>(r.rate, { eur: null, source: "none" }), catalog_version: String(r.catalog_version),
    files: j<KpFiles | null>(r.files, null), options: j<KpOptions>(r.options, {}), recalc_of: r.recalc_of === null ? null : String(r.recalc_of),
    gen_warnings: j<string[]>(r.gen_warnings, []), started_at: r.started_at === null ? null : String(r.started_at),
    finished_at: r.finished_at === null ? null : String(r.finished_at),
  };
}
