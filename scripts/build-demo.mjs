#!/usr/bin/env node
// Demo build: web/dist-demo/ is the web app plus demo-data.js (catalog, settings and a fixed demo EUR rate),
// so it runs from any static host without the server (CONTRACTS §1, web demo mode). scripts/build.sh is untouched.
// Usage: node scripts/build-demo.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "web", "dist-demo");
// Demo EUR rate: a fixed round value, shown in the UI as «демо-курс (не НБУ)». Not a real NBU rate.
const DEMO_EUR_RATE = 50;

function tscBin() {
  const local = path.join(root, "node_modules", ".bin", "tsc");
  return fs.existsSync(local) ? local : "tsc";
}

function copy(rel, toRel = rel) {
  const src = path.join(root, "web", rel);
  if (!fs.existsSync(src)) throw new Error(`build-demo: немає web/${rel}`);
  fs.cpSync(src, path.join(out, toRel), { recursive: true });
}

function listJs(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listJs(p, base) : e.name.endsWith(".js") ? [path.relative(base, p).split(path.sep).join("/")] : [];
  });
}

/** The service worker precache list must name every compiled module (types.js is never requested). */
export function checkShell(swSource, jsDir) {
  const listed = new Set([...swSource.matchAll(/"(js\/[^"]+\.js)"/g)].map((m) => m[1]));
  const built = new Set(listJs(jsDir).map((f) => "js/" + f).filter((f) => !f.endsWith("/types.js")));
  const missing = [...built].filter((f) => !listed.has(f));
  const extra = [...listed].filter((f) => !built.has(f));
  return { missing, extra };
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
execFileSync(tscBin(), ["-p", "tsconfig.web.json", "--outDir", path.join(out, "js")], { cwd: root, stdio: "inherit" });

const indexSrc = fs.readFileSync(path.join(root, "web", "index.html"), "utf8");
const moduleTag = '<script type="module" src="js/web/src/main.js"></script>';
if (!indexSrc.includes(moduleTag)) throw new Error("build-demo: у web/index.html немає тегу main.js");
fs.writeFileSync(path.join(out, "index.html"), indexSrc.replace(moduleTag, `<script defer src="demo-data.js"></script>\n  ${moduleTag}`));

const swSrc = fs.readFileSync(path.join(root, "web", "sw.js"), "utf8");
if (!swSrc.includes("/* demo-shell */")) throw new Error("build-demo: у web/sw.js немає мітки /* demo-shell */");
const shell = checkShell(swSrc, path.join(out, "js"));
if (shell.missing.length || shell.extra.length) {
  throw new Error(`build-demo: список SHELL у web/sw.js не збігається зі збіркою. Бракує: ${shell.missing.join(", ") || "—"}; зайві: ${shell.extra.join(", ") || "—"}`);
}
fs.writeFileSync(path.join(out, "sw.js"), swSrc.replace("/* demo-shell */", '"demo-data.js", "catalog.json",'));

for (const f of ["styles.css", "manifest.webmanifest", "icons", "media"]) copy(f);

const catalog = JSON.parse(fs.readFileSync(path.join(root, "catalog", "catalog.json"), "utf8"));
const settings = JSON.parse(fs.readFileSync(path.join(root, "catalog", "settings.default.json"), "utf8"));
fs.copyFileSync(path.join(root, "catalog", "catalog.json"), path.join(out, "catalog.json"));
const data = {
  catalog,
  settings,
  rate: { eur: DEMO_EUR_RATE, date: null, source: "demo", fetched_at: null },
  built_at: new Date().toISOString(),
};
fs.writeFileSync(path.join(out, "demo-data.js"),
  "// Demo data for the web app (scripts/build-demo.mjs): catalog/catalog.json, catalog/settings.default.json, demo EUR rate.\n"
  + `window.KP_DEMO_DATA = ${JSON.stringify(data)};\n`);

const size = (p) => fs.statSync(path.join(out, p)).size;
console.log(`build-demo: ${path.relative(root, out)} (demo-data.js ${Math.round(size("demo-data.js") / 1024)} KB, catalog ${catalog.version}, демо-курс ${DEMO_EUR_RATE})`);
