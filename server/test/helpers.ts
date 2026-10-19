// Test server: temp KP_DATA_DIR, fake generator (fixtures/fake-python.mjs), fake NBU endpoint, temp web/dist.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";
import type { Config } from "../src/config.js";
import { startServer } from "../src/main.js";
import type { RunningServer, ServerOptions } from "../src/main.js";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));   // build/server/test -> repo root
export const FAKE_PYTHON = join(ROOT, "server", "test", "fixtures", "fake-python.mjs");
export const ADMIN = "admin-secret-token";
export const NBU_PATH = "/NBUStatService/v1/statdirectory/exchange?valcode=EUR&json";

export interface FakeNbu {
  url: string;                         // full endpoint URL (KP_NBU_URL)
  requests: string[];
  rate: number;                        // current rate
  refRate: number;                     // rate for every ?date= request
  fail: boolean;                       // answer 503
  body: string | null;                 // raw answer instead of the JSON (bad payload tests)
  close(): Promise<void>;
}

export async function fakeNbu(rate = 47.5, refRate = rate): Promise<FakeNbu> {
  const state: Omit<FakeNbu, "url" | "close"> = { requests: [], rate, refRate, fail: false, body: null };
  const srv = createServer((req, res) => {
    state.requests.push(req.url ?? "");
    const u = new URL(req.url ?? "/", "http://x");
    if (state.fail || u.pathname !== "/NBUStatService/v1/statdirectory/exchange" || u.searchParams.get("valcode") !== "EUR") {
      res.writeHead(state.fail ? 503 : 404).end("no");
      return;
    }
    if (state.body !== null) { res.writeHead(200, { "content-type": "application/json" }).end(state.body); return; }
    const d = u.searchParams.get("date");
    const date = d ? `${d.slice(6, 8)}.${d.slice(4, 6)}.${d.slice(0, 4)}` : "18.10.2026";
    const body = [{ r030: 978, txt: "Євро", rate: d ? state.refRate : state.rate, cc: "EUR", exchangedate: date }];
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as AddressInfo).port;
  const out = state as FakeNbu;
  out.url = `http://127.0.0.1:${port}${NBU_PATH}`;
  out.close = () => new Promise((r) => { srv.closeAllConnections(); srv.close(() => r()); });
  return out;
}

export function makeWebDir(root: string): string {
  const web = join(root, "web-dist");
  mkdirSync(join(web, "js", "web", "src"), { recursive: true });
  mkdirSync(join(web, "icons"), { recursive: true });
  mkdirSync(join(web, "media", "bmf"), { recursive: true });
  writeFileSync(join(web, "index.html"), "<!doctype html><title>Конструктор КП</title><script type=module src=./js/web/src/main.js></script>");
  writeFileSync(join(web, "js", "web", "src", "main.js"), "console.log('app');\n");
  writeFileSync(join(web, "styles.css"), "body{}\n");
  writeFileSync(join(web, "sw.js"), "self.addEventListener('fetch',()=>{});\n");
  writeFileSync(join(web, "manifest.webmanifest"), JSON.stringify({ name: "КП" }));
  writeFileSync(join(web, "icons", "icon-192.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(web, "media", "bmf", "650_a.jpg"), "thumbnail");      // overrides generator/assets/bmf/650_a.jpg
  writeFileSync(join(web, ".env"), "SECRET=1");
  writeFileSync(join(root, "outside.txt"), "outside the web root");
  return web;
}

export interface TestServer {
  url: string;
  dataDir: string;
  root: string;
  nbu: FakeNbu;
  srv: RunningServer;
  config: Config;
  close(): Promise<void>;
  /** Stops the HTTP server only (data dir and fake NBU stay) — for restart tests. */
  stop(): Promise<void>;
}

export interface StartOptions {
  config?: Partial<Config>;
  server?: ServerOptions;
  nbu?: FakeNbu;
  dataDir?: string;
  root?: string;
}

export async function startTest(o: StartOptions = {}): Promise<TestServer> {
  chmodSync(FAKE_PYTHON, 0o755);
  const root = o.root ?? mkdtempSync(join(tmpdir(), "kp-server-test-"));
  const dataDir = o.dataDir ?? join(root, "data");
  const nbu = o.nbu ?? (await fakeNbu());
  const webDir = join(root, "web-dist");
  makeWebDir(root);
  const config: Config = {
    ...loadConfig({}),
    port: 0, host: "127.0.0.1", dataDir, python: FAKE_PYTHON, generatorDir: join(ROOT, "generator"),
    webDir, mediaDirs: [join(webDir, "media"), join(ROOT, "generator", "assets")], nbuUrl: nbu.url,
    kpgenBuild: join(dataDir, "kpgen-build"), adminToken: ADMIN, accessToken: null, generatorTimeoutS: 20,
    ...o.config,
  };
  const srv = await startServer(config, { log: () => undefined, ...o.server });
  let stopped = false;
  const stop = async () => { if (!stopped) { stopped = true; await srv.close(); } };
  return {
    url: srv.url, dataDir, root, nbu, srv, config, stop,
    async close() {
      await stop();
      if (!o.nbu) await nbu.close();
      if (!o.root) rmSync(root, { recursive: true, force: true });
    },
  };
}

export interface Res { status: number; headers: Headers; json: any; text: string }

export async function call(t: { url: string }, method: string, path: string, body?: unknown,
  headers: Record<string, string> = {}): Promise<Res> {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] ??= "application/json";
  }
  const r = await fetch(t.url + path, init);
  const text = await r.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: r.status, headers: r.headers, json, text };
}

/** Raw request without URL normalisation (fetch would resolve "..", here the path goes out as written). */
export async function rawGet(t: { url: string }, path: string): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  const { request } = await import("node:http");
  const u = new URL(t.url);
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, path, method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8"), headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

export const npl750 = { kit_type: "npl_crane", selection: { slots: { trailer: "npl10", crane: "bmf750" }, choices: {}, accessories: [] } };
export const kit720 = { kit_type: "crane_kit", selection: { slots: { crane: "bmf720", base: "base_outriggers_720" }, choices: {}, accessories: [] } };

/** Creates a KP and waits until the generator queue is idle; returns the final record. */
export async function makeKp(t: TestServer, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<any> {
  const r = await call(t, "POST", "/api/kp", body, headers);
  if (r.status !== 202) throw new Error(`POST /api/kp: ${r.status} ${r.text}`);
  await t.srv.ctx.queue.idle();
  return (await call(t, "GET", `/api/kp/${r.json.id}`, undefined, headers)).json;
}
