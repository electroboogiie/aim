import { test } from "node:test";
import assert from "node:assert/strict";
import { KpSpecError, MAX_KP_ROWS, buildKpSpec, kpBlockers, presetById, presetSelection, quote } from "../src/index.js";
import type { Catalog, KpMeta, QuoteInput, RateInfo, Settings } from "../src/index.js";
import { loadCatalog, loadSettings } from "./helpers.js";

const c = loadCatalog();
const s = loadSettings();
const NB = " ";
const noRate: RateInfo = { eur: null, source: "none" };
const meta: KpMeta = { number: "0007", client: { name: "ФГ «Поле»", contact: "Іван Петренко" } };
const npl750: QuoteInput = { kit_type: "npl_crane", date: "2026-10-18",
  selection: { slots: { trailer: "npl10", crane: "bmf750" }, choices: {}, accessories: [] } };

function specErrors(fn: () => unknown): string[] {
  try { fn(); } catch (e) { if (e instanceof KpSpecError) return e.errors; throw e; }
  assert.fail("KpSpecError expected");
}

test("НПЛ-10 kit: two rows «у комплекті», one total, НПЛ block, default maker", () => {
  const q = quote(c, s, noRate, npl750);
  const spec = buildKpSpec(c, s, q, meta);
  assert.equal(spec.template, "kp_v3");
  assert.equal(spec.title, "НПЛ-10 + BMF 750");
  assert.equal(spec.rows.length, 2);
  assert.deepEqual(spec.rows.map((r) => [r.no, r.item_id, r.price_text]), [[1, "npl10", "у комплекті"], [2, "bmf750", "у комплекті"]]);
  assert.equal(spec.rows[0]!.desc, "10 т · 4 коники · гідравлічні гальма · пряме (заднє) місце оператора");
  assert.equal(spec.total_text, `1${NB}978${NB}000${NB}₴`);
  assert.deepEqual(spec.npl, { brakes: "гідравлічна", wheels: "500/45-22,5", stakes: "4" });
  assert.equal(spec.crane?.profile, "bmf750");
  assert.equal(spec.crane?.specs.weight_kg, "1090");
  assert.equal(spec.maker.name, "ТОВ «ГІДМАН»");
  assert.equal(spec.maker.line, "Виробник НПЛ-10: ТОВ «ГІДМАН»");
  assert.deepEqual(spec.client, meta.client);
  assert.equal(spec.contacts.phones[0], "(+380) 67 363 0629");
  assert.ok(spec.contacts.socials?.length);
  assert.deepEqual(spec.terms.map((t) => t.title).length, 5);
  for (const r of spec.rows) assert.doesNotMatch(`${r.title} ${r.desc}`, /автономн\S*\s+гідравл/i);
  assert.deepEqual(spec.accessories, []);
});

test("the legal entity is selectable: meta.maker or settings.company_maker", () => {
  const q = quote(c, s, noRate, npl750);
  assert.equal(buildKpSpec(c, s, q, { ...meta, maker: "fop_debelyi" }).maker.line, "Виробник НПЛ-10: ФОП Дебелий Володимир Миколайович");
  const s2: Settings = { ...s, company_maker: "fop_debelyi" };
  assert.equal(buildKpSpec(c, s2, q, meta).maker.name, "ФОП Дебелий Володимир Миколайович");
  assert.deepEqual(specErrors(() => buildKpSpec(c, s, q, { ...meta, maker: "ghost" })), ["Невідома компанія «ghost» (виробник у КП)."]);
});

test("itemized crane kit: priced rows, KP_2_v3 total, dates dd.mm.yyyy", () => {
  const p = presetById(c, "kp2v3_bmf720_kit")!;
  const q = quote(c, s, noRate, { kit_type: p.kit_type, selection: presetSelection(p, c), date: p.source.date });
  const spec = buildKpSpec(c, s, q, meta);
  assert.equal(spec.title, "BMF 720");
  assert.deepEqual(spec.rows.map((r) => r.price_text), [`686${NB}000${NB}₴`, `155${NB}000${NB}₴`, `18${NB}500${NB}₴`, `27${NB}750${NB}₴`]);
  assert.equal(spec.total_text, `887${NB}250${NB}₴`);
  assert.equal(spec.npl, null);
  assert.equal(spec.date, "24.08.2025");
  assert.equal(spec.valid_until, "31.08.2025");
  assert.equal(spec.price_date, "24.08.2025");
  assert.equal(spec.maker.line, "Виробник: ТОВ «ГІДМАН»");
  assert.equal(spec.crane?.specs.weight_kg, "710");
  assert.equal(spec.crane?.specs.telescope, "так");
  assert.ok(!/\s{2}/.test(spec.total_text));
  assert.equal(buildKpSpec(c, { ...s, validity_days: 0 }, q, meta).valid_until, "");
});

test("price note: EUR rate sentence when a rate was applied, discount sentence", () => {
  const rate: RateInfo = { eur: 48.1, date: "2026-10-18", source: "nbu", ref_rates: { "2026-07-17": 48.1, "2026-10-02": 48.1 } };
  const q = quote(c, s, rate, { kit_type: "crane_kit", date: "2026-10-18", discount_pct: 5,
    selection: { slots: { crane: "bmf720", base: "base_outriggers_720" }, choices: {}, accessories: [] } });
  assert.equal(q.eur_applied, true);
  const spec = buildKpSpec(c, s, q, meta);
  assert.ok(spec.price_note.startsWith(`Ціни розраховано за курсом EUR 48,10${NB}₴ на 18.10.2026.`), spec.price_note);
  assert.ok(spec.price_note.includes(`зі знижкою 5${NB}%`), spec.price_note);
  assert.equal(spec.total_text, `798${NB}950${NB}₴`);   // (686 000 + 155 000) × 0,95 = 798 950, a multiple of 50
});

test("bundle kit without a price: «ціна за запитом» as the total", () => {
  const c2: Catalog = { ...c, bundles: c.bundles.filter((b) => b.id !== "npl10_bmf750") };
  const q = quote(c2, s, noRate, npl750);
  assert.equal(q.kit_price_uah, null);
  assert.equal(buildKpSpec(c2, s, q, meta).total_text, "ціна за запитом");
});

test("terms: ids or literal terms, unknown id and more than 7 are errors", () => {
  const q = quote(c, s, noRate, npl750);
  const spec = buildKpSpec(c, s, q, { ...meta, terms: ["payment", { title: "Гарантія", text: "12 місяців." }] });
  assert.deepEqual(spec.terms.map((t) => t.title), ["Оплата", "Гарантія"]);
  assert.deepEqual(specErrors(() => buildKpSpec(c, s, q, { ...meta, terms: ["ghost"] })), ["Невідома умова співпраці «ghost»."]);
  const many = Array.from({ length: 8 }, (_, i) => ({ title: `Умова ${i}`, text: "." }));
  assert.deepEqual(specErrors(() => buildKpSpec(c, s, q, { ...meta, terms: many })), ["Забагато умов співпраці: 8 (максимум 7)."]);
  assert.deepEqual(specErrors(() => buildKpSpec(c, s, q, { ...meta, number: "" })), ["Не задано номер КП."]);
});

test("blockers: cranes without KP pages, kits without a crane, more than 8 rows", () => {
  const q850 = quote(c, s, noRate, { kit_type: "npl_crane", date: "2026-10-18",
    selection: { slots: { trailer: "npl10", crane: "bmf850" }, choices: {}, accessories: [] } });
  assert.deepEqual(kpBlockers(c, q850), ["Для BMF 850 ще немає сторінок КП (є для BMF 650, BMF 720, BMF 750 і BMF 905)."]);
  assert.throws(() => buildKpSpec(c, s, q850, meta), KpSpecError);

  const part = quote(c, s, noRate, { kit_type: "part", date: "2026-10-18", selection: { slots: { item: "valf_s58" }, choices: {}, accessories: [] } });
  assert.deepEqual(kpBlockers(c, part), ["Шаблон KP_2_v3 будує КП лише для комплектів з краном-маніпулятором BMF."]);

  const kt = c.kit_types.find((k) => k.id === "crane_kit")!;
  const slots = Object.fromEntries(kt.slots.map((sl) => [sl.id, sl.candidates.find((id) => id.endsWith("750")) ?? sl.candidates[0]!]));
  const accs = c.accessories.filter((a) => a.group === "crane" && (!a.compatible || a.compatible.includes("bmf750"))).slice(0, 3);
  const big = quote(c, s, noRate, { kit_type: "crane_kit", date: "2026-10-18",
    selection: { slots, choices: {}, accessories: accs.map((a) => ({ id: a.id, price_uah: 1000 })) } });
  const n = big.rows.length + accs.length;
  assert.ok(n > MAX_KP_ROWS, String(n));
  assert.ok(kpBlockers(c, big).includes(`Забагато позицій для сторінки «Вартість»: ${n} (максимум ${MAX_KP_ROWS}).`), kpBlockers(c, big).join("\n"));
  // unpriced accessories stay off the price table and go to the options page
  const fine = quote(c, s, noRate, { kit_type: "crane_kit", date: "2026-10-18", selection: { slots, choices: {}, accessories: accs.map((a) => ({ id: a.id })) } });
  const spec = buildKpSpec(c, s, fine, meta);
  assert.equal(spec.rows.length, fine.rows.length);
  assert.deepEqual(spec.accessories.map((a) => a.price_text), accs.map(() => "ціна за запитом"));
});

test("offer_accessories: chosen options first, then compatible ones on request, crane before trailer, at most 9", () => {
  const input: QuoteInput = { kit_type: "npl_crane", date: "2026-10-18",
    selection: { slots: { trailer: "npl10", crane: "bmf750" }, choices: {}, accessories: [{ id: "rv_poles", price_uah: 12000 }] } };
  const spec = buildKpSpec(c, s, quote(c, s, noRate, input), { ...meta, offer_accessories: true });
  assert.ok(spec.accessories.length > 1 && spec.accessories.length <= 9);
  const groups = spec.accessories.map((a) => a.group);
  assert.deepEqual(groups, [...groups].sort((a, b) => (a === "crane" ? 0 : 1) - (b === "crane" ? 0 : 1)));
  const poles = spec.accessories.find((a) => a.title === c.accessories.find((x) => x.id === "rv_poles")!.title)!;
  assert.match(poles.price_text, /12\s000/);
  assert.equal(spec.accessories.filter((a) => a.title === poles.title).length, 1);
  for (const a of spec.accessories) if (a !== poles) assert.equal(a.price_text, "ціна за запитом");
  const leg = c.accessories.find((x) => x.id === "rv_leg_a")!;
  assert.ok(!spec.accessories.some((a) => a.title === leg.title), "A-type leg does not fit BMF 750");
  assert.equal(buildKpSpec(c, s, quote(c, s, noRate, npl750), meta).accessories.length, 0);
});

test("BMF trailer kit: trailer block for the generator, Parker option adds the valve to the crane row", () => {
  const p = presetById(c, "bmf8t2_bmf650_bt_2026-04-02")!;
  const q = quote(c, s, noRate, { kit_type: p.kit_type, selection: presetSelection(p, c), date: p.source.date });
  const spec = buildKpSpec(c, s, q, meta);
  assert.equal(spec.trailer?.profile, "bmf8t2");
  assert.equal(spec.npl, null);
  assert.equal(spec.total_text, `1${NB}614${NB}400${NB}₴`);
  assert.equal(spec.crane?.specs.valve, "Parker P70 Wireless");
  assert.match(spec.rows.find((r) => r.item_id === spec.crane?.id)!.desc, /Parker P70/);
});

test("toolbox: 1 or 2 pieces, price × pieces, the card says how many", () => {
  const sel = (qty?: number) => ({ kit_type: "npl_crane", date: "2026-10-18",
    selection: { slots: { trailer: "npl10", crane: "bmf750" }, choices: {}, accessories: [{ id: "ee_toolbox", price_uah: 10000, ...(qty ? { qty } : {}) }] } });
  const one = quote(c, s, noRate, sel()), two = quote(c, s, noRate, sel(2)), many = quote(c, s, noRate, sel(5));
  assert.equal(one.accessories[0].price_uah, 10000);
  assert.equal(two.accessories[0].price_uah, 20000);
  assert.equal(two.accessories[0].qty, 2);
  assert.equal(many.accessories[0].qty, 2, "no more than max_qty");
  assert.equal(two.total_uah - one.total_uah, 10000);
  assert.match(buildKpSpec(c, s, two, meta).accessories[0].title, /— 2 шт$/);
});
