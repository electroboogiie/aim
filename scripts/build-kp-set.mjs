// Builds one KP per distinct preset of catalog/catalog.json through core + generator.
// Usage: node scripts/build-kp-set.mjs OUT_DIR [--dry: specs only] [--only id,id] [--date YYYY-MM-DD]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = await import(join(root, "build/core/src/index.js"));
const args = process.argv.slice(2);
const out = resolve(args.find((a) => !a.startsWith("--")) ?? join(root, "data/kp-set"));
const dry = args.includes("--dry");
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const only = opt("--only")?.split(",");
const date = opt("--date") ?? new Date().toISOString().slice(0, 10);

const catalog = JSON.parse(readFileSync(join(root, "catalog/catalog.json"), "utf8"));
const settings = JSON.parse(readFileSync(join(root, "catalog/settings.default.json"), "utf8"));
const rate = { eur: null, source: "none" };

const seen = new Map();
const report = [];
let n = 0;
for (const p of catalog.presets) {
  if (p.archived || (only && !only.includes(p.id))) continue;
  const input = { kit_type: p.kit_type ?? p.selection.kit_type, selection: core.presetSelection(p, catalog), date };
  const key = JSON.stringify(input.selection);
  if (seen.has(key)) { report.push({ id: p.id, same_as: seen.get(key) }); continue; }
  seen.set(key, p.id);
  const errs = core.validateSelection(catalog, input);
  const q = core.quote(catalog, settings, rate, input);
  const row = { id: p.id, title: p.title, total: q.total_uah ?? q.kit_price_uah ?? null, source_total: p.source?.total_uah ?? null,
    warnings: q.warnings, errors: errs };
  report.push(row);
  if (errs.length) continue;
  let spec;
  try {
    spec = core.buildKpSpec(catalog, settings, q, { number: String(++n).padStart(4, "0"), client: { name: "Назва замовника" }, offer_accessories: true });
  } catch (e) { row.errors = e.errors ?? [String(e)]; continue; }
  const dir = join(out, p.id); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "spec.json"), JSON.stringify(spec, null, 1));
  if (dry) continue;
  const r = spawnSync(process.env.KP_PYTHON ?? "python3", ["-m", "kpgen", "--spec", join(dir, "spec.json"), "--out", dir],
    { cwd: join(root, "generator"), encoding: "utf8", env: { ...process.env, KPGEN_BUILD: process.env.KPGEN_BUILD ?? join(out, ".build") } });
  const last = r.stdout.trim().split("\n").pop();
  row.result = r.status === 0 ? JSON.parse(last) : { exit: r.status, stderr: r.stderr.trim().split("\n").slice(-3) };
  console.error(`${p.id}: ${r.status === 0 ? "ok" : "exit " + r.status}`);
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
