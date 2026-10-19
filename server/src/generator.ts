// KP generator queue: one job at a time. Each job writes $KP_DATA_DIR/kp/<id>/spec.json and runs
// `KP_PYTHON -m kpgen --spec spec.json --out <dir>` (args array, no shell, cwd KP_GENERATOR_DIR, CONTRACTS §6).
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Journal, KpFile, KpFiles } from "./db.js";
import { isInside, writeFileAtomic } from "./fsutil.js";
import { isObject } from "./http.js";

export interface GeneratorOptions {
  journal: Journal;
  dataDir: string;
  python: string;
  generatorDir: string;
  timeoutS: number;
  kpgenBuild: string;
  env?: NodeJS.ProcessEnv;
  log?: (msg: string) => void;
}

export function kpDir(dataDir: string, id: string): string { return join(dataDir, "kp", id); }

const TAIL = 256 * 1024;

interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  stopped: boolean;
  spawnError: Error | null;
}

/** The error line kpgen printed (stderr "kpgen: …"), without warnings and timings. */
export function kpgenMessage(stderr: string): string {
  const lines = stderr.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.startsWith("kpgen:"))
    .map((s) => s.slice("kpgen:".length).trim())
    .filter((s) => s && !s.startsWith("увага:") && !/^pptx [\d.]+ s/.test(s));
  const last = lines[lines.length - 1] ?? "";
  return last.length > 600 ? last.slice(0, 600) + "…" : last;
}

export function kpgenWarnings(stderr: string): string[] {
  return stderr.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.startsWith("kpgen: увага:"))
    .map((s) => s.slice("kpgen: увага:".length).trim()).slice(0, 50);
}

function fileInfo(dir: string, p: unknown, ext: string): KpFile | null {
  if (typeof p !== "string" || !p) return null;
  const full = resolve(dir, p);
  if (!full.toLowerCase().endsWith(ext) || !isInside(dir, full) || !existsSync(full)) return null;
  try {
    if (!isInside(realpathSync(dir), realpathSync(full))) return null;
    const st = statSync(full);
    return st.isFile() ? { name: basename(full), size: st.size } : null;
  } catch {
    return null;
  }
}

/** The last stdout line: {"pptx": "<abs path>", "pdf": "<abs path>|null", "pages": N}; files must lie in `dir`. */
export function parseResult(stdout: string, dir: string): KpFiles | null {
  const lines = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  let r: unknown;
  try { r = JSON.parse(lines[lines.length - 1] ?? ""); } catch { return null; }
  if (!isObject(r)) return null;
  const pptx = fileInfo(dir, r.pptx, ".pptx");
  if (!pptx) return null;
  const pdf = r.pdf === null || r.pdf === undefined ? null : fileInfo(dir, r.pdf, ".pdf");
  if (r.pdf && !pdf) return null;
  const pages = typeof r.pages === "number" && Number.isInteger(r.pages) && r.pages >= 0 ? r.pages : null;
  return { pptx, pdf, pages };
}

function newestFile(dir: string, ext: string): KpFile | null {
  try {
    const names = readdirSync(dir).filter((n) => n.toLowerCase().endsWith(ext));
    const infos = names.map((n) => ({ n, t: statSync(join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t);
    return infos.length ? fileInfo(dir, infos[0]!.n, ext) : null;
  } catch {
    return null;
  }
}

export class GeneratorQueue {
  private queue: string[] = [];
  private running: { id: string; child: ChildProcess | null; reason: "timeout" | "stop" | null } | null = null;
  private stopping = false;
  private waiters: (() => void)[] = [];
  private current: Promise<void> | null = null;

  constructor(private readonly o: GeneratorOptions) {}

  private log(msg: string): void { this.o.log?.(msg); }

  /** Re-queues jobs that were queued or interrupted by a restart. */
  resume(): void {
    for (const id of this.o.journal.pending()) {
      this.o.journal.setQueued(id);
      this.enqueue(id);
    }
  }

  enqueue(id: string): void {
    if (this.stopping || this.queue.includes(id) || this.running?.id === id) return;
    this.queue.push(id);
    this.kick();
  }

  /** 0 = running now, n = n-th in line, null = not in the queue. */
  position(id: string): number | null {
    if (this.running?.id === id) return 0;
    const i = this.queue.indexOf(id);
    return i < 0 ? null : i + 1;
  }

  /** Resolves when nothing is running or waiting (tests). */
  idle(): Promise<void> {
    if (!this.running && !this.queue.length) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }

  /** Graceful shutdown: no new jobs; a running job is killed and stays queued for the next start. */
  async stop(): Promise<void> {
    this.stopping = true;
    this.queue = [];
    if (this.running) this.kill("stop");
    await this.current;
  }

  private kick(): void {
    if (this.running || this.stopping) return;
    const id = this.queue.shift();
    if (!id) {
      const w = this.waiters; this.waiters = [];
      for (const r of w) r();
      return;
    }
    this.running = { id, child: null, reason: null };
    this.current = this.run(id)
      .catch((e: unknown) => {
        this.log(`генератор: КП ${id}: внутрішня помилка: ${(e as Error)?.stack ?? String(e)}`);
        try { this.o.journal.finish(id, "error", "Внутрішня помилка сервера під час генерації КП.", null, []); } catch { /* journal closed */ }
      })
      .finally(() => {
        this.running = null;
        this.current = null;
        this.kick();
      });
  }

  private kill(reason: "timeout" | "stop"): void {
    const r = this.running;
    if (!r?.child || r.child.exitCode !== null || r.child.signalCode !== null) { if (r) r.reason = reason; return; }
    r.reason = reason;
    const child = r.child;
    const signal = (sig: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch { /* already gone */ }
    };
    signal("SIGTERM");
    const t = setTimeout(() => signal("SIGKILL"), 3000);
    t.unref();
    child.once("close", () => clearTimeout(t));
  }

  private async run(id: string): Promise<void> {
    const { journal } = this.o;
    const rec = journal.get(id);
    if (!rec) return;
    const dir = kpDir(this.o.dataDir, id);
    mkdirSync(dir, { recursive: true });
    for (const n of readdirSync(dir)) if (/\.(pptx|pdf)$/i.test(n)) rmSync(join(dir, n), { force: true });
    const specFile = join(dir, "spec.json");
    writeFileAtomic(specFile, JSON.stringify(rec.spec, null, 2) + "\n");
    mkdirSync(this.o.kpgenBuild, { recursive: true });
    journal.setRunning(id);
    const t0 = Date.now();
    const res = await this.spawn(specFile, dir);
    try { writeFileAtomic(join(dir, "generator.log"), `exit ${res.code ?? res.signal}\n--- stderr\n${res.stderr}\n--- stdout\n${res.stdout}`); } catch { /* best effort */ }
    if (res.stopped) {
      journal.setQueued(id);
      this.log(`генератор: КП ${rec.number}/${rec.year} перервано зупинкою сервера, лишається в черзі`);
      return;
    }
    const warnings = kpgenWarnings(res.stderr);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (res.spawnError) {
      const e = res.spawnError as NodeJS.ErrnoException;
      const why = e.code === "ENOENT" ? "команду не знайдено" : e.message;
      journal.finish(id, "error", `Не вдалося запустити генератор КП («${this.o.python}»): ${why}.`, null, warnings);
      this.log(`генератор: КП ${rec.number}/${rec.year}: запуск «${this.o.python}» не вдався: ${e.message}`);
      return;
    }
    if (res.timedOut) {
      const pptx = newestFile(dir, ".pptx");
      journal.finish(id, "error", `Генератор КП не встиг за ${this.o.timeoutS} с.`, pptx ? { pptx, pdf: null, pages: null } : null, warnings);
      this.log(`генератор: КП ${rec.number}/${rec.year}: тайм-аут ${this.o.timeoutS} с`);
      return;
    }
    if (res.code === 0) {
      const files = parseResult(res.stdout, dir);
      if (files) {
        journal.finish(id, "ready", null, files, warnings);
        this.log(`генератор: КП ${rec.number}/${rec.year} готова за ${secs} с`);
      } else {
        journal.finish(id, "error", "Генератор КП не повідомив, які файли створено.", null, warnings);
        this.log(`генератор: КП ${rec.number}/${rec.year}: нечитаний результат: ${res.stdout.slice(-300)}`);
      }
      return;
    }
    const msg = kpgenMessage(res.stderr);
    if (res.code === 3) {
      const pptx = newestFile(dir, ".pptx");
      journal.finish(id, "error", `PDF не створено${msg ? `: ${msg}` : "."}${pptx ? " Файл PPTX доступний." : ""}`,
        pptx ? { pptx, pdf: null, pages: null } : null, warnings);
    } else {
      journal.finish(id, "error", msg || `Генератор КП завершився з помилкою (код ${res.code ?? res.signal}).`, null, warnings);
    }
    this.log(`генератор: КП ${rec.number}/${rec.year}: код ${res.code ?? res.signal}: ${msg}`);
  }

  private spawn(specFile: string, dir: string): Promise<RunResult> {
    const env: NodeJS.ProcessEnv = { ...(this.o.env ?? process.env) };
    delete env.KP_ADMIN_TOKEN;
    delete env.KP_ACCESS_TOKEN;
    env.KPGEN_BUILD = this.o.kpgenBuild;
    env.PYTHONIOENCODING ??= "utf-8";
    // let LibreOffice time out inside kpgen (which then cleans it up) before the server's own timeout
    env.KPGEN_PDF_TIMEOUT ??= String(Math.max(10, Math.min(180, this.o.timeoutS - 30)));
    return new Promise((resolveRun) => {
      const out: RunResult = { code: null, signal: null, stdout: "", stderr: "", timedOut: false, stopped: false, spawnError: null };
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const reason = this.running?.reason;
        out.timedOut = reason === "timeout";
        out.stopped = reason === "stop";
        resolveRun(out);
      };
      let child: ChildProcess;
      try {
        child = spawn(this.o.python, ["-m", "kpgen", "--spec", specFile, "--out", dir], {
          cwd: this.o.generatorDir, env, stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true,
          detached: process.platform !== "win32",
        });
      } catch (e) {
        out.spawnError = e as Error;
        settled = true;
        resolveRun(out);
        return;
      }
      if (this.running) this.running.child = child;
      const timer = setTimeout(() => this.kill("timeout"), this.o.timeoutS * 1000);
      const keep = (prev: string, chunk: Buffer) => { const s = prev + chunk.toString("utf8"); return s.length > TAIL ? s.slice(-TAIL) : s; };
      child.stdout!.on("data", (c: Buffer) => { out.stdout = keep(out.stdout, c); });
      child.stderr!.on("data", (c: Buffer) => { out.stderr = keep(out.stderr, c); });
      child.on("error", (e) => { out.spawnError = e; if (child.pid === undefined) done(); });
      child.on("close", (code, signal) => { out.code = code; out.signal = signal; done(); });
      if (this.running?.reason === "stop") this.kill("stop");
    });
  }
}
