#!/usr/bin/env node
// Fake KP_PYTHON for the server tests: takes `-m kpgen --spec FILE --out DIR` like the real generator (CONTRACTS §6),
// writes dummy files and prints the result line. The behaviour is picked by spec.client.contact ("fake:fail", ...).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
if (args[0] !== "-m" || args[1] !== "kpgen") {
  console.error("fake: очікується -m kpgen");
  process.exit(9);
}
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const out = resolve(arg("--out"));
const spec = JSON.parse(readFileSync(arg("--spec"), "utf8"));
const mode = String(spec.client?.contact ?? "");
const started = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function record() {
  writeFileSync(join(out, "fake-invocation.json"), JSON.stringify({
    args, cwd: process.cwd(), kpgen_build: process.env.KPGEN_BUILD ?? null, pdf_timeout: process.env.KPGEN_PDF_TIMEOUT ?? null,
    has_admin_token: "KP_ADMIN_TOKEN" in process.env, has_access_token: "KP_ACCESS_TOKEN" in process.env,
    number: spec.number, title: spec.title, started, finished: Date.now(),
  }));
}

async function main() {
  mkdirSync(out, { recursive: true });
  const m = /^fake:sleep(\d+)$/.exec(mode);
  if (m) await sleep(Number(m[1]));
  if (mode === "fake:hang") await sleep(60_000);
  if (mode === "fake:hang-once") {
    const marker = join(out, "hang-once.marker");
    if (!existsSync(marker)) { writeFileSync(marker, "1"); await sleep(60_000); }
  }
  if (mode === "fake:fail") {
    record();
    console.error("Traceback (most recent call last):\n  File \"build.py\", line 1\nValueError: boom");
    console.error("kpgen: помилка генерації КП: тестова помилка");
    process.exit(1);
  }
  const base = `KP_${spec.number}_test`;
  writeFileSync(join(out, base + ".pptx"), "PK\u0003\u0004 fake pptx");
  if (mode === "fake:nopdf") {
    record();
    console.error("kpgen: LibreOffice не створив PDF (код 1): тест");
    process.exit(3);
  }
  writeFileSync(join(out, base + ".pdf"), "%PDF-1.4 fake pdf");
  record();
  console.error("kpgen: увага: фото для обкладинки не знайдено в generator/assets: 'x.jpg'; взято типове фото крана.");
  console.error("kpgen: pptx 0.1 s, pdf 0.1 s");
  if (mode === "fake:garbage") { console.log("not json"); return; }
  if (mode === "fake:escape") { console.log(JSON.stringify({ pptx: "/etc/passwd", pdf: null, pages: 1 })); return; }
  console.log("engine noise before the result line");
  console.log(JSON.stringify({ pptx: join(out, base + ".pptx"), pdf: join(out, base + ".pdf"), pages: 11 }));
}

main();
