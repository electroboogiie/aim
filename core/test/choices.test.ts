import { test } from "node:test";
import assert from "node:assert/strict";
import { buildKpSpec, defaultSelection, kitTypeById, presetById, presetSelection, quote, reconcileSelection, validateSelection } from "../src/index.js";
import type { Catalog, KpMeta, QuoteInput, RateInfo } from "../src/index.js";
import { loadCatalog, loadSettings } from "./helpers.js";

const c = loadCatalog();
const s = loadSettings();
const noRate: RateInfo = { eur: null, source: "none" };
const meta: KpMeta = { number: "0001", client: { name: "Замовник" } };

test("grapple and valve: the crane's standard option by default, no surcharge, nothing printed", () => {
  const sel = presetSelection(presetById(c, "bmf750_kit_2026-10-02")!, c);
  assert.equal(sel.choices.grapple, "c27");
  assert.equal(sel.choices.valve, "v48xyz");
  const q = quote(c, s, noRate, { kit_type: "crane_kit", selection: sel, date: "2026-10-02" });
  assert.equal(q.complete, true);
  assert.ok(!q.warnings.some((w) => /Доплату/.test(w)));
  const spec = buildKpSpec(c, s, q, meta);
  assert.equal(spec.rows[0]!.desc, "у комплекті з ротатором 4 т і захватом C27 (0,27 м²)");
  assert.equal(spec.crane?.specs.grapple_m2, "0,27");
  assert.equal(spec.crane?.specs.valve, "4/8 XYZ");
});

test("changing the crane resets crane-bound choices to its standard; incompatible options are rejected", () => {
  const kt = kitTypeById(c, "crane_kit")!;
  const sel = defaultSelection(kt, c);
  assert.equal(sel.slots.crane, "bmf720");
  assert.equal(sel.choices.grapple, "c24");
  const to750 = reconcileSelection(c, kt.id, { ...sel, slots: { ...sel.slots, crane: "bmf750", base: "base_outriggers_750" } }, "crane");
  assert.equal(to750.choices.grapple, "c27");
  const to650 = reconcileSelection(c, kt.id, { ...to750, slots: { ...to750.slots, crane: "bmf650", base: "base_outriggers_650" } }, "crane");
  assert.equal(to650.choices.grapple, "c24");
  const bad: QuoteInput = { kit_type: kt.id, selection: { ...to650, choices: { ...to650.choices, grapple: "c27" } } };
  assert.match(validateSelection(c, bad).join(" "), /C27 — 0,27 м²» не підходить до BMF 650/);
});

test("non-standard grapple: surcharge on request, the KP shows the chosen grapple", () => {
  const sel = presetSelection(presetById(c, "kp2v3_bmf720_kit")!, c);
  const q = quote(c, s, noRate, { kit_type: "crane_kit", selection: { ...sel, choices: { ...sel.choices, grapple: "c20" } } });
  assert.equal(q.complete, false);
  assert.ok(q.warnings.some((w) => /Доплату за «C20/.test(w)));
  const spec = buildKpSpec(c, s, q, meta);
  assert.equal(spec.crane?.specs.grapple_m2, "0,2");
  assert.match(spec.rows[0]!.desc, /захватом C20 \(0,2 м²\)/);
});

test("oil by the litre: the manager's litres set the title and the price", () => {
  const kt = kitTypeById(c, "crane_kit")!;
  const sel = defaultSelection(kt, c);
  sel.slots.oil = "oil_90l";
  const q = quote(c, s, noRate, { kit_type: kt.id, selection: sel, quantities: { oil_90l: 120 } });
  const row = q.rows.find((r) => r.item_id === "oil_90l")!;
  assert.equal(row.title, "Олива гідравлічна 120 л");
  assert.equal(row.price_uah, 120 * 180);
  const def = quote(c, s, noRate, { kit_type: kt.id, selection: sel });
  assert.equal(def.rows.find((r) => r.item_id === "oil_90l")!.price_uah, 16200);
  assert.ok(validateSelection(c, { kit_type: kt.id, selection: sel, quantities: { bmf720: 2 } }).length);
});

test("operator seat: side or rear placement in the row text", () => {
  const kt = kitTypeById(c, "crane_kit")!;
  const sel = defaultSelection(kt, c);
  const q = quote(c, s, noRate, { kit_type: kt.id, selection: { ...sel, choices: { ...sel.choices, seat_pos: "side" } } });
  assert.match(q.rows.find((r) => r.item_id === "seat")!.desc, /^Бокове розташування/);
});

test("bundle kit: a position priced on its own is added on top of the bundle price", () => {
  const cc = structuredClone(c) as Catalog;
  const kt = kitTypeById(cc, "npl_crane")!;
  kt.slots.push({ id: "oil", title: "Олива", candidates: ["oil_90l"], required: false, default: "oil_90l", priced: true });
  const sel = defaultSelection(kt, cc);
  const q = quote(cc, s, noRate, { kit_type: kt.id, selection: sel });
  assert.equal(q.bundle_id, "npl10_bmf720");
  assert.equal(q.total_uah, 1799000 + 16200);
  assert.equal(q.rows.find((r) => r.item_id === "oil_90l")!.price_uah, 16200);
});
