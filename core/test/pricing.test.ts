import { test } from "node:test";
import assert from "node:assert/strict";
import { QuoteError, eurRate, quote, refPoint, refRateDates, validateSettings } from "../src/index.js";
import type { PriceRef, QuoteInput } from "../src/index.js";
import { crane, item, loadCatalog, loadSettings, miniCatalog, ref, settings } from "./helpers.js";

const one = (a: string, b: string | null = null, c: string | null = null, extra: Partial<QuoteInput> = {}): QuoteInput => ({
  kit_type: "kit", selection: { slots: { a, b, c }, choices: {}, accessories: [] }, date: "2026-10-18", ...extra,
});

test("eur: eur × K × (1 + logistics) × (1 + markup) × (1 + VAT), rounded to 50", () => {
  const c = miniCatalog([item("x", { mode: "eur", eur: 1000, group: "g" })]);
  const s = settings({ groups: { g: { markup_pct: 10, logistics_pct: 5 } }, eur: { mode: "nbu", manual_rate: null, buffer_pct: 2 } });
  const q = quote(c, s, { eur: 48.1, source: "nbu" }, one("x"));
  const exact = 1000 * 48.1 * 1.02 * 1.05 * 1.1 * 1.2;          // 67 999,93
  assert.equal(q.rows[0]!.price_uah, Math.round(exact / 50) * 50);
  assert.equal(q.rows[0]!.price_uah, 68000);
  assert.equal(q.total_uah, 68000);
  assert.equal(q.eur_rate, 48.1);
  assert.equal(q.eur_rate_source, "nbu");
  assert.equal(q.eur_applied, true);
  assert.equal(q.complete, true);
});

test("eur without a rate: null row, warning, total of the rest", () => {
  const c = miniCatalog([item("x", { mode: "eur", eur: 1000, group: "g" }), item("y", ref(10000, "2026-01-01", 0, 0))]);
  const q = quote(c, settings(), { eur: null, source: "none" }, one("x", "y"));
  assert.equal(q.rows[0]!.price_uah, null);
  assert.equal(q.rows[0]!.price_text, "ціна за запитом");
  assert.equal(q.total_uah, 10000);
  assert.equal(q.complete, false);
  assert.equal(q.eur_rate, null);
  assert.equal(q.eur_rate_source, "none");
  assert.ok(q.warnings.some((w) => w.includes("Курс EUR НБУ недоступний")), q.warnings.join("\n"));
  assert.ok(q.warnings.some((w) => w.includes("немає курсу EUR")));
});

test("manual EUR mode uses manual_rate; unset manual rate warns", () => {
  const c = miniCatalog([item("x", { mode: "eur", eur: 100, group: "g" })]);
  const s = settings({ eur: { mode: "manual", manual_rate: 50, buffer_pct: 0 }, vat_pct: 0, rounding_uah: 0 });
  const q = quote(c, s, { eur: 48, source: "nbu" }, one("x"));
  assert.equal(q.rows[0]!.price_uah, 5000);
  assert.equal(q.eur_rate_source, "manual");
  const s2 = settings({ eur: { mode: "manual", manual_rate: null, buffer_pct: 0 } });
  const q2 = quote(c, s2, { eur: 48, source: "nbu" }, one("x"));
  assert.equal(q2.rows[0]!.price_uah, null);
  assert.ok(q2.warnings.some((w) => w.includes("Ручний курс EUR не задано")));
});

test("cost: metal + components in EUR + labour + paint, markup and VAT (no logistics)", () => {
  const c = miniCatalog([item("x", { mode: "cost", metal: [{ grade: "S355", kg: 100 }, { grade: "S235", kg: 50 }], components_eur: 100,
    hours: 10, paint_uah: 500, group: "g" })]);
  const s = settings({ metal: { index_uah_per_kg: null, ref_index_uah_per_kg: null, grades: { S355: 60, S235: 50 } }, labor_rate_uah: 400,
    groups: { g: { markup_pct: 25, logistics_pct: 99 } }, rounding_uah: 10 });
  const q = quote(c, s, { eur: 48, source: "nbu" }, one("x"));
  const base = 100 * 60 + 50 * 50 + 100 * 48 + 10 * 400 + 500;   // 17 800
  assert.equal(q.rows[0]!.price_uah, Math.round((base * 1.25 * 1.2) / 10) * 10);
  assert.equal(q.rows[0]!.price_uah, 26700);
});

test("cost with an unknown grade or labour rate: null and warning", () => {
  const c = miniCatalog([item("x", { mode: "cost", metal: [{ grade: "S700", kg: 10 }], group: "g" }),
    item("y", { mode: "cost", metal: [], hours: 2, group: "g" })]);
  const q = quote(c, settings(), null, one("x", "y"));
  assert.equal(q.rows[0]!.price_uah, null);
  assert.equal(q.rows[1]!.price_uah, null);
  assert.ok(q.warnings.some((w) => w.includes("S700")));
  assert.ok(q.warnings.some((w) => w.includes("нормо-години")));
});

test("ref: unknown references keep the price exactly (no rounding), with warnings", () => {
  const c = miniCatalog([item("x", ref(59140, "2026-05-25", 1, 0)), item("y", ref(18500, "2026-10-02", 0.3, 0.5))]);
  const q = quote(c, settings(), { eur: 48.1, source: "nbu" }, one("x", "y"));
  assert.equal(q.rows[0]!.price_uah, 59140);        // 59 140 is not a multiple of 50 and stays as printed
  assert.equal(q.rows[1]!.price_uah, 18500);
  assert.equal(q.total_uah, 77640);
  assert.equal(q.eur_applied, false);
  assert.ok(q.warnings.some((w) => w.startsWith("Не задано курс EUR на дату ціни") && w.includes("Виріб x (25.05.2026)")), q.warnings.join("\n"));
  assert.ok(q.warnings.some((w) => w.startsWith("Не задано індекс металу") && w.includes("Виріб y")));
});

test("ref: EUR and metal ratios, buffer applied to both K and K_ref, rounding", () => {
  const rule = ref(100000, "2026-01-10", 0.6, 0.3, { eur_rate_ref: 40, metal_index_ref: 50 });
  const c = miniCatalog([item("x", rule)]);
  const s = settings({ eur: { mode: "nbu", manual_rate: null, buffer_pct: 3 }, metal: { index_uah_per_kg: 55, ref_index_uah_per_kg: 99, grades: {} } });
  const q = quote(c, s, { eur: 44, source: "nbu" }, one("x"));
  const factor = 0.6 * (44 / 40) + 0.3 * (55 / 50) + 0.1;     // buffer cancels: (44·1,03)/(40·1,03)
  assert.equal(q.rows[0]!.price_uah, Math.round((100000 * factor) / 50) * 50);
  assert.equal(q.rows[0]!.price_uah, 109000);
  assert.equal(q.eur_applied, true);
  assert.equal(q.warnings.length, 0, q.warnings.join("\n"));
});

test("ref: metal reference falls back to settings.metal.ref_index_uah_per_kg; one known ratio only", () => {
  const c = miniCatalog([item("x", ref(10000, "2026-01-10", 0.5, 0.5))]);
  const s = settings({ metal: { index_uah_per_kg: 60, ref_index_uah_per_kg: 50, grades: {} }, rounding_uah: 1 });
  const q = quote(c, s, { eur: 44, source: "nbu" }, one("x"));
  // EUR ratio unknown (no reference rate) -> 1; metal 60/50
  assert.equal(q.rows[0]!.price_uah, 11000);   // 10 000 × (1 + 0,5 × (60 / 50 − 1))
  assert.ok(q.warnings.some((w) => w.startsWith("Не задано курс EUR на дату ціни")));
  assert.ok(!q.warnings.some((w) => w.startsWith("Не задано індекс металу")));
});

test("ref: RateInfo.ref_rates supplies the reference rate by date", () => {
  const c = miniCatalog([item("x", ref(100000, "2026-03-04", 1, 0))]);
  const q = quote(c, settings(), { eur: 50, source: "nbu", ref_rates: { "2026-03-04": 40 } }, one("x"));
  assert.equal(q.rows[0]!.price_uah, 125000);
  const same = quote(c, settings(), { eur: 40, source: "nbu", ref_rates: { "2026-03-04": 40 } }, one("x"));
  assert.equal(same.rows[0]!.price_uah, 100000);
  assert.deepEqual(refRateDates(c), ["2026-03-04"]);
});

test("ref history: the point on or before the quote date, else the earliest", () => {
  const rule = ref(686000, "2026-07-17", 1, 0, { history: [{ uah: 657920, date: "2026-03-04" }, { uah: 686000, date: "2025-08-24" }] }) as PriceRef;
  assert.equal(refPoint(rule, "2026-10-18").uah, 686000);
  assert.equal(refPoint(rule, "2026-03-04").uah, 657920);
  assert.equal(refPoint(rule, "2026-05-01").uah, 657920);
  assert.equal(refPoint(rule, "2025-12-31").date, "2025-08-24");
  assert.equal(refPoint(rule, "2020-01-01").date, "2025-08-24");
  const c = miniCatalog([item("x", rule)]);
  assert.equal(quote(c, settings(), null, one("x", null, null, { date: "2026-03-10" })).total_uah, 657920);
});

test("included and on_request rows", () => {
  const c = miniCatalog([item("x", ref(1000, "2026-01-01", 0, 0)), item("y", { mode: "included" }), item("z", { mode: "on_request" })]);
  const q = quote(c, settings(), null, one("x", "y", "z"));
  assert.equal(q.rows[1]!.price_uah, 0);
  assert.equal(q.rows[1]!.price_text, "входить у комплект");
  assert.equal(q.rows[2]!.price_uah, null);
  assert.equal(q.rows[2]!.price_text, "ціна за запитом");
  assert.equal(q.total_uah, 1000);
  assert.equal(q.complete, false);
  assert.ok(q.warnings.some((w) => w.includes("«Виріб z» — ціна за запитом")));
});

test("manual prices override the rule and are not rounded", () => {
  const c = miniCatalog([item("x", { mode: "on_request" }), item("y", ref(1000, "2026-01-01", 0, 0))]);
  const q = quote(c, settings(), null, one("x", "y", null, { manual_prices: { x: 12345 } }));
  assert.equal(q.rows[0]!.price_uah, 12345);
  assert.equal(q.rows[0]!.breakdown, "ціна вказана вручну");
  assert.equal(q.total_uah, 13345);
  assert.equal(q.complete, true);
});

test("rounding: nearest multiple of rounding_uah, whole hryvnias with 0", () => {
  const c = miniCatalog([item("x", { mode: "eur", eur: 1, group: "g" })]);
  const s = settings({ vat_pct: 0 });
  assert.equal(quote(c, s, { eur: 1024.9, source: "nbu" }, one("x")).total_uah, 1000);
  assert.equal(quote(c, s, { eur: 1025, source: "nbu" }, one("x")).total_uah, 1050);
  assert.equal(quote(c, settings({ vat_pct: 0, rounding_uah: 0 }), { eur: 1024.6, source: "nbu" }, one("x")).total_uah, 1025);
});

test("discount up to max_discount_pct, total rounded again; above the limit is an error", () => {
  const c = miniCatalog([item("x", ref(887250, "2025-08-24", 0, 0))]);
  const q = quote(c, settings(), null, one("x", null, null, { discount_pct: 3 }));
  assert.equal(q.subtotal_uah, 887250);
  assert.equal(q.discount_pct, 3);
  assert.equal(q.total_uah, Math.round((887250 * 0.97) / 50) * 50);
  assert.equal(q.total_uah, 860650);
  assert.equal(quote(c, settings(), null, one("x", null, null, { discount_pct: 5 })).total_uah, 842900);
  assert.throws(() => quote(c, settings(), null, one("x", null, null, { discount_pct: 5.5 })), (e: unknown) => {
    assert.ok(e instanceof QuoteError);
    assert.match(e.errors[0]!, /Знижка 5,5 % перевищує дозволену \(5 %\)/);
    return true;
  });
  assert.throws(() => quote(c, settings(), null, one("x", null, null, { discount_pct: -1 })), QuoteError);
});

test("choice deltas are added on top; dates and validity", () => {
  const c = miniCatalog([item("x", ref(1000, "2026-01-01", 0, 0))]);
  const q = quote(c, settings(), null, { ...one("x"), selection: { slots: { a: "x" }, choices: { opt: "y" }, accessories: [] } });
  assert.deepEqual(q.choices, [{ id: "opt", title: "Опція", value: "y", value_title: "посилена", price_uah: 1000 }]);
  assert.equal(q.total_uah, 2000);
  assert.equal(q.date, "2026-10-18");
  assert.equal(q.valid_until, "2026-10-25");
});

function pairCatalog() {
  const items = [
    item("t1", { mode: "on_request" }, { kind: "trailer", family: "npl", model: "НПЛ-10", desc_template: "10 т · {brakes}" }),
    item("t2", ref(300000, "2026-01-01", 0, 1), { kind: "trailer", model: "T2" }),
    crane("c1", ref(600000, "2026-01-01", 1, 0)),
    crane("c2", { mode: "on_request" }),
  ];
  return miniCatalog(items, {
    bundles: [{ id: "b1", kit_type: "pair", slots: { trailer: "t1", crane: "c1" }, price: ref(1709100, "2026-05-18", 0.56, 0.31), source: "тест" }],
  });
}
const pair = (trailer: string, craneId: string, extra: Partial<QuoteInput> = {}): QuoteInput => ({
  kit_type: "pair", selection: { slots: { trailer, crane: craneId }, choices: {}, accessories: [] }, date: "2026-10-18", ...extra,
});

test("bundle kit: matching bundle gives the kit price, rows say «у комплекті»", () => {
  const q = quote(pairCatalog(), settings(), null, pair("t1", "c1"));
  assert.equal(q.price_display, "bundle");
  assert.equal(q.bundle_id, "b1");
  assert.equal(q.kit_price_uah, 1709100);
  assert.equal(q.total_uah, 1709100);
  assert.deepEqual(q.rows.map((r) => [r.price_uah, r.price_text]), [[null, "у комплекті"], [null, "у комплекті"]]);
  assert.equal(q.rows[0]!.desc, "10 т · гідравлічні гальма");
  // the trailer alone is on request, but the bundle covers it: no warning about it
  assert.ok(!q.warnings.some((w) => w.includes("Виріб t1")), q.warnings.join("\n"));
  assert.equal(q.complete, true);
});

test("bundle kit without a bundle: sum of item prices, else null with a warning", () => {
  const sum = quote(pairCatalog(), settings(), null, pair("t2", "c1"));
  assert.equal(sum.bundle_id, null);
  assert.equal(sum.kit_price_uah, 900000);
  assert.equal(sum.total_uah, 900000);
  assert.match(sum.kit_breakdown ?? "", /сума цін позицій/);
  const none = quote(pairCatalog(), settings(), null, pair("t1", "c2"));
  assert.equal(none.kit_price_uah, null);
  assert.equal(none.total_uah, 0);
  assert.equal(none.complete, false);
  assert.ok(none.warnings.some((w) => w.startsWith("Ціну комплекту не визначено")), none.warnings.join("\n"));
  const manual = quote(pairCatalog(), settings(), null, pair("t1", "c2", { kit_price_uah: 2000000 }));
  assert.equal(manual.kit_price_uah, 2000000);
  assert.equal(manual.total_uah, 2000000);
});

test("bundle kit: choice deltas and priced accessories on top, on_request option warns", () => {
  const c = pairCatalog();
  c.accessories = [{ id: "acc", group: "crane", title: "Опція", desc: "опис", photo: "", price: { mode: "on_request" }, source: "тест" },
    { id: "acc2", group: "crane", title: "Опція 2", desc: "опис", photo: "", price: { mode: "on_request" }, source: "тест" }];
  const q = quote(c, settings(), null, {
    ...pair("t1", "c1"),
    selection: { slots: { trailer: "t1", crane: "c1" }, choices: { brakes: "v" }, accessories: [{ id: "acc", price_uah: 20000 }, { id: "acc2" }] },
  });
  assert.equal(q.subtotal_uah, 1709100 + 500 + 20000);
  assert.equal(q.accessories[0]!.price_uah, 20000);
  assert.equal(q.accessories[1]!.price_text, "ціна за запитом");
  assert.ok(q.warnings.some((w) => w.includes("Опції за запитом") && w.includes("Опція 2")));
  const p = quote(c, settings(), null, { ...pair("t1", "c1"), selection: { slots: { trailer: "t1", crane: "c1" }, choices: { brakes: "p" }, accessories: [] } });
  assert.equal(p.total_uah, 1709100);
  assert.equal(p.complete, false);
  assert.ok(p.warnings.some((w) => w.includes("Доплату за «пневматична»")));
  assert.equal(p.rows[0]!.desc, "10 т · пневматичні гальма");
});

test("bundle matching needs the exact set of non-empty slots", () => {
  const c = pairCatalog();
  c.bundles.push({ id: "b2", kit_type: "kit", slots: { a: "c1" }, price: ref(5, "2026-01-01", 0, 0), source: "тест" });
  const q = quote(c, settings(), null, pair("t1", "c1"));
  assert.equal(q.bundle_id, "b1");
  // b2 belongs to another kit type and an itemized one: never used for prices there
  assert.equal(quote(c, settings(), null, one("c1")).total_uah, 600000);
});

test("invalid selection throws QuoteError with Ukrainian messages", () => {
  const c = miniCatalog([item("x", ref(1, "2026-01-01", 0, 0))]);
  assert.throws(() => quote(c, settings(), null, { kit_type: "nope", selection: { slots: {}, choices: {}, accessories: [] } }), (e: unknown) => {
    assert.ok(e instanceof QuoteError);
    assert.deepEqual(e.errors, ["Невідомий тип комплекту «nope»."]);
    return true;
  });
});

test("eurRate: buffer and sources", () => {
  const s = settings({ eur: { mode: "nbu", manual_rate: null, buffer_pct: 2 } });
  assert.deepEqual(eurRate(s, { eur: 50, source: "cache" }), { rate: 50, k: 51, source: "cache" });
  assert.deepEqual(eurRate(s, { eur: null, source: "none" }), { rate: null, k: null, source: "none" });
  assert.deepEqual(eurRate(s, null), { rate: null, k: null, source: "none" });
});

test("default settings are valid for the catalog; bad settings are reported", () => {
  const c = loadCatalog();
  const s = loadSettings();
  assert.deepEqual(validateSettings(s, c), []);
  assert.equal(s.eur.mode, "nbu");
  assert.equal(s.vat_pct, 20);
  assert.equal(s.rounding_uah, 50);
  assert.equal(s.validity_days, 7);
  assert.equal(s.max_discount_pct, 5);
  assert.deepEqual(Object.keys(s.groups).sort(), ["accessories", "bmf_cranes", "bmf_trailers", "own_production"]);
  for (const g of Object.values(s.groups)) assert.deepEqual(g, { markup_pct: 0, logistics_pct: 0 });
  assert.equal(s.metal.index_uah_per_kg, null);
  assert.equal(s.company_maker, "gidman");
  const bad = validateSettings({ ...s, eur: { mode: "x" as "nbu", manual_rate: -1, buffer_pct: 100 }, vat_pct: -1, validity_days: 1.5,
    company_maker: "nobody" }, c);
  assert.ok(bad.length >= 5, bad.join("\n"));
  assert.ok(bad.some((e) => e.includes("невідома компанія «nobody»")));
});

test("own positions typed in by hand: priced rows after the kit, × qty, unpriced ones leave the total incomplete", () => {
  const c = miniCatalog([item("x", ref(10000, "2026-01-01", 0, 0))]);
  const q = quote(c, settings(), null, one("x", null, null, {
    extras: [{ title: "Монтажні роботи", price_uah: 100000 }, { title: "  " , price_uah: 5 }, { title: "Ящик", desc: "для інструмента", price_uah: 2000, qty: 2 }, { title: "Доставка", price_uah: null }],
  }));
  assert.deepEqual(q.rows.map((r) => [r.title, r.price_uah, r.kind ?? null]), [
    ["Виріб x", 10000, "component"], ["Монтажні роботи", 100000, "extra"], ["Ящик — 2 шт", 4000, "extra"], ["Доставка", null, "extra"]]);
  assert.equal(q.rows[2]!.desc, "для інструмента");
  assert.equal(q.total_uah, 114000);
  assert.equal(q.complete, false);
  assert.ok(q.warnings.some((w) => w.includes("«Доставка» — ціна за запитом")), q.warnings.join("\n"));
});

test("bundle kit priced position by position (itemized): own prices, no kit price, rows in the KP", () => {
  const q = quote(pairCatalog(), settings(), null, pair("t2", "c1", { itemized: true, extras: [{ title: "Монтаж", price_uah: 1000 }] }));
  assert.equal(q.price_display, "itemized");
  assert.equal(q.kit_price_uah, undefined);
  assert.deepEqual(q.rows.map((r) => r.price_uah), [300000, 600000, 1000]);
  assert.equal(q.total_uah, 901000);
});
