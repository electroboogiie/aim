// KP configurator server: node:http, zero runtime dependencies (docs/CONTRACTS.md §7, §9).
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Catalog } from "../../core/src/index.js";
import { refRateDates, todayIso, validateCatalog } from "../../core/src/index.js";
import { handleApi } from "./api.js";
import type { AppContext } from "./api.js";
import { APP_ROOT, ConfigError, loadConfig } from "./config.js";
import type { Config } from "./config.js";
import { Journal } from "./db.js";
import { GeneratorQueue } from "./generator.js";
import { HttpError, parseJson, parsePath, securityHeaders, sendError, splitUrl } from "./http.js";
import { RateService } from "./rate.js";
import { SettingsError, SettingsStore } from "./settings.js";
import { serveMedia, serveStatic } from "./static.js";

export interface ServerOptions {
  now?: () => Date;                    // clock for KP dates and the rate cache (tests)
  log?: (msg: string) => void;
  fetchFn?: typeof fetch;
  rateTtlMs?: number;
  rateRetryMs?: number;
}

export interface RunningServer {
  url: string;
  port: number;
  server: Server;
  ctx: AppContext;
  close(): Promise<void>;
}

export class StartupError extends Error {
  readonly errors: string[];
  constructor(message: string, errors: string[] = []) {
    super(message);
    this.errors = errors;
  }
}

function defaultLog(msg: string): void { console.log(`${new Date().toISOString()} ${msg}`); }

function loadCatalog(file: string): { catalog: Catalog; json: string } {
  let json: string;
  let catalog: unknown;
  try {
    json = readFileSync(file, "utf8");
    catalog = parseJson(json);
  } catch (e) {
    throw new StartupError(`Не вдалося прочитати каталог ${file}: ${(e as Error).message}`);
  }
  const errors = validateCatalog(catalog as Catalog);
  if (errors.length) throw new StartupError(`Каталог ${file} містить помилки.`, errors);
  return { catalog: catalog as Catalog, json: JSON.stringify(catalog) };
}

function appVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function handle(ctx: AppContext, req: IncomingMessage, res: ServerResponse): Promise<void> {
  securityHeaders(res);
  const { path, query } = splitUrl(req.url);
  const segs = parsePath(path);
  if (!segs) throw new HttpError(400, "Невірний шлях запиту.");
  if (segs[0] === "api") { await handleApi(ctx, req, res, segs.slice(1), query); return; }
  if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Метод не підтримується.", undefined, { Allow: "GET, HEAD" });
  if (segs[0] === "media") { await serveMedia(req, res, segs.slice(1), ctx.config.mediaDirs); return; }
  await serveStatic(req, res, segs, ctx.config.webDir);
}

/** Starts the server; resolves once it listens. Throws StartupError for a broken catalog or settings file. */
export async function startServer(config: Config, opts: ServerOptions = {}): Promise<RunningServer> {
  const log = opts.log ?? defaultLog;
  const now = opts.now ?? (() => new Date());
  mkdirSync(config.dataDir, { recursive: true });
  const { catalog, json } = loadCatalog(config.catalogFile);
  let settings: SettingsStore;
  try {
    settings = new SettingsStore(join(config.dataDir, "settings.json"), config.settingsDefaultFile, catalog);
  } catch (e) {
    if (e instanceof SettingsError) throw new StartupError(e.message, e.errors);
    throw e;
  }
  const journal = new Journal(join(config.dataDir, "journal.sqlite"));
  const rates = new RateService({
    url: config.nbuUrl, file: join(config.dataDir, "rates.json"), now, log,
    ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}),
    ...(opts.rateTtlMs !== undefined ? { ttlMs: opts.rateTtlMs } : {}),
    ...(opts.rateRetryMs !== undefined ? { retryMs: opts.rateRetryMs, refRetryMs: opts.rateRetryMs } : {}),
  });
  const queue = new GeneratorQueue({
    journal, dataDir: config.dataDir, python: config.python, generatorDir: config.generatorDir,
    timeoutS: config.generatorTimeoutS, kpgenBuild: config.kpgenBuild, log,
  });
  const ctx: AppContext = {
    config, catalog, catalogJson: json, catalogEtag: `"${createHash("sha1").update(json).digest("hex").slice(0, 20)}"`,
    version: appVersion(), settings, rates, journal, queue, refDates: refRateDates(catalog), today: () => todayIso(now()), log,
  };

  const server = createServer((req, res) => {
    handle(ctx, req, res).catch((e: unknown) => {
      if (e instanceof HttpError) { sendError(res, e.status, e.message, e.errors, e.headers); return; }
      log(`помилка ${req.method} ${req.url}: ${(e as Error)?.stack ?? String(e)}`);
      sendError(res, 500, "Внутрішня помилка сервера.");
    });
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 20_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;
  server.on("clientError", (_err, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    else socket.destroy();
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => { server.off("error", reject); resolveListen(); });
  });
  queue.resume();
  void rates.info(settings.get(), ctx.refDates).catch(() => undefined);

  const port = (server.address() as AddressInfo).port;
  const host = config.host && config.host !== "0.0.0.0" && config.host !== "::" ? config.host : "127.0.0.1";
  let closing: Promise<void> | null = null;
  return {
    url: `http://${host.includes(":") ? `[${host}]` : host}:${port}`,
    port,
    server,
    ctx,
    close(): Promise<void> {
      closing ??= (async () => {
        const closed = new Promise<void>((r) => server.close(() => r()));
        server.closeIdleConnections();
        await queue.stop();
        const force = setTimeout(() => server.closeAllConnections(), 5000);
        force.unref();
        await closed;
        clearTimeout(force);
        journal.close();
      })();
      return closing;
    },
  };
}

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) { console.error(`Помилка налаштування: ${e.message}`); process.exit(1); }
    throw e;
  }
  process.on("unhandledRejection", (e) => defaultLog(`необроблена помилка: ${(e as Error)?.stack ?? String(e)}`));
  let running: RunningServer;
  try {
    running = await startServer(config);
  } catch (e) {
    if (e instanceof StartupError) {
      console.error(`Сервер не запущено: ${e.message}`);
      for (const err of e.errors) console.error(`  - ${err}`);
    } else {
      console.error(`Сервер не запущено: ${(e as Error)?.message ?? String(e)}`);
    }
    process.exit(1);
  }
  const where = config.host ?? "усі інтерфейси";
  defaultLog(`Конструктор КП ${running.ctx.version}: порт ${running.port} (${where}), дані ${config.dataDir}, каталог ${running.ctx.catalog.version}`);
  defaultLog(`токен доступу: ${config.accessToken ? "увімкнено" : "вимкнено (API відкритий)"}; налаштування: `
    + (config.adminToken ? "змінює адміністратор" : "лише читання (KP_ADMIN_TOKEN не задано)"));
  if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
    defaultLog("курс EUR: задано HTTPS_PROXY, але не NODE_USE_ENV_PROXY=1 — запити до НБУ йдуть без проксі");
  }
  let stopping = false;
  const stop = (sig: string) => {
    if (stopping) return;
    stopping = true;
    defaultLog(`${sig}: зупинка сервера…`);
    setTimeout(() => process.exit(1), 10_000).unref();
    running.close().then(() => process.exit(0), (e: unknown) => {
      defaultLog(`помилка під час зупинки: ${(e as Error)?.message ?? String(e)}`);
      process.exit(1);
    });
  };
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
