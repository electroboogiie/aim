import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  SUPPORTED_PROFILES, accessoryById, accessoryDesc, defaultSelection, findBundle, itemById, kitAccessories, kitTypeById,
  presetSelection, reconcileSelection, slotCandidates, validateCatalog, validateSelection, SUPPORTED_TRAILER_PROFILES } from "../src/index.js";
import type { Catalog, QuoteInput, Selection } from "../src/index.js";
import { loadCatalog } from "./helpers.js";

const c: Catalog = loadCatalog();
const assets = new URL("../../../generator/assets/", import.meta.url);

test("catalog.json passes validateCatalog", () => {
  assert.deepEqual(validateCatalog(c), []);
});

test("all ids are unique and all references resolve", () => {
  const all: [string, string[]][] = [
    ["companies", c.companies.map((x) => x.id)], ["items", c.items.map((x) => x.id)], ["kit_types", c.kit_types.map((x) => x.id)],
    ["presets", c.presets.map((x) => x.id)], ["accessories", c.accessories.map((x) => x.id)], ["bundles", c.bundles.map((x) => x.id)],
    ["terms", c.texts.terms.map((x) => x.id)],
  ];
  for (const [name, ids] of all) assert.equal(new Set(ids).size, ids.length, `${name}: duplicate ids`);
  const items = new Set(c.items.map((x) => x.id));
  const kits = new Set(c.kit_types.map((x) => x.id));
  const terms = new Set(c.texts.terms.map((x) => x.id));
  for (const kt of c.kit_types) {
    for (const s of kt.slots) for (const id of s.candidates) assert.ok(items.has(id), `${kt.id}.${s.id}: ${id}`);
    for (const t of kt.terms ?? []) assert.ok(terms.has(t), `${kt.id}: term ${t}`);
  }
  for (const it of c.items) for (const id of it.compatible ?? []) assert.ok(items.has(id), `${it.id}.compatible: ${id}`);
  for (const a of c.accessories) {
    for (const id of [...(a.compatible ?? []), ...(a.compatible_unconfirmed ?? [])]) assert.ok(items.has(id), `${a.id}: ${id}`);
    for (const v of a.variants ?? []) for (const id of v.compatible ?? []) assert.ok(items.has(id), `${a.id}/${v.id}: ${id}`);
  }
  for (const b of c.bundles) {
    assert.ok(kits.has(b.kit_type), b.id);
    for (const id of Object.values(b.slots)) assert.ok(items.has(id), `${b.id}: ${id}`);
  }
  for (const p of c.presets) assert.ok(kits.has(p.kit_type), p.id);
});

test("every preset validates against its kit type", () => {
  for (const p of c.presets) {
    assert.deepEqual(validateSelection(c, { kit_type: p.kit_type, selection: p.selection }), [], p.id);
    assert.deepEqual(validateSelection(c, { kit_type: p.kit_type, selection: presetSelection(p, c) }), [], p.id);
  }
});

test("default selection of every kit type validates", () => {
  for (const kt of c.kit_types) assert.deepEqual(validateSelection(c, { kit_type: kt.id, selection: defaultSelection(kt) }), [], kt.id);
});

test("every photo path exists in generator/assets", () => {
  const paths: string[] = [];
  for (const it of c.items) if (it.photo) paths.push(it.photo);
  for (const a of c.accessories) {
    if (a.photo) paths.push(a.photo);
    for (const v of a.variants ?? []) if (v.photo) paths.push(v.photo);
  }
  assert.ok(paths.length > 10);
  for (const p of paths) assert.ok(existsSync(new URL(p, assets)), p);
});

test("business rules: cranes come with rotator and grapple, KP profiles for 650/720/750/905 and BMF trailers", () => {
  const cranes = c.items.filter((x) => x.kind === "crane");
  assert.ok(cranes.length >= 5);
  for (const cr of cranes) {
    assert.ok(cr.includes?.some((x) => x.startsWith("ротатор")), cr.id);
    assert.ok(cr.includes?.some((x) => x.startsWith("захват")), cr.id);
    assert.match(cr.short, /ротатором.*захватом/, cr.id);
    const want = ["bmf650", "bmf720", "bmf750", "bmf905"].includes(cr.id) ? cr.id : null;
    assert.equal(cr.kp_profile ?? null, want, cr.id);
  }
  for (const it of c.items) {
    if (it.kind === "trailer" && it.family === "bmf_trailer") assert.ok(SUPPORTED_TRAILER_PROFILES.includes(it.kp_profile ?? ""), it.id);
    else if (it.kind !== "crane") assert.equal(it.kp_profile ?? null, null, it.id);
  }
  assert.deepEqual([...SUPPORTED_PROFILES], ["bmf650", "bmf720", "bmf750", "bmf905"]);
  // the approved KP_2_v3 values for the BMF 720 and the latest user KP values for 650 / 750
  assert.equal(itemById(c, "bmf720")!.specs!.weight_kg, "710");
  assert.equal(itemById(c, "bmf750")!.specs!.weight_kg, "1090");
  assert.equal(itemById(c, "bmf650")!.specs!.torque_knm, "60");
});

test("business rules: НПЛ-10 kit has 2 positions priced as a bundle, no autonomous hydraulics in row texts", () => {
  const npl = kitTypeById(c, "npl_crane")!;
  assert.equal(npl.price_display, "bundle");
  assert.deepEqual(npl.slots.filter((s) => !s.priced).map((s) => s.id), ["trailer", "crane"]);   // the bundle: 2 rows «у комплекті»
  assert.ok(npl.slots.filter((s) => s.priced).every((s) => !s.required && !s.default), "extras priced on their own are not in the base kit");
  for (const it of c.items) {
    for (const t of [it.title, it.short, it.desc_template ?? ""]) assert.doesNotMatch(t, /автономн\S*\s+гідравл/i, it.id);
  }
  assert.ok(!npl.slots.some((s) => s.candidates.includes("seat")), "operator seat is a characteristic, not a position");
  assert.equal(c.texts.notes.target_customers, "+ ЛІСОГОСПОДАРСТВА · + ФЕРМЕРИ · + ДЕРЕВООБРОБНИКИ");
});

test("accessories: the ones the user's KPs mention most come first, on request", () => {
  const uses = c.accessories.map((a) => a.kp_uses ?? 0);
  assert.deepEqual(uses, [...uses].sort((a, b) => b - a));
  // priced from the warehouse (21.10.2026): the truck options; the rest is on request
  for (const a of c.accessories) assert.equal(a.price.mode, a.group === "truck" ? "ref" : "on_request", a.id);
});

test("companies: both legal entities selectable, default maker is the one KP_2_v3 prints", () => {
  assert.deepEqual(c.companies.map((x) => x.id).sort(), ["fop_debelyi", "gidman"]);
  assert.equal(c.companies.find((x) => x.id === "gidman")!.name, "ТОВ «ГІДМАН»");
});

const sel = (slots: Record<string, string | null>, more: Partial<Selection> = {}): Selection => ({ slots, choices: {}, accessories: [], ...more });
const errs = (input: QuoteInput) => validateSelection(c, input);

test("validateSelection: unknown ids, required slots, candidates", () => {
  assert.deepEqual(errs({ kit_type: "x", selection: sel({}) }), ["Невідомий тип комплекту «x»."]);
  assert.deepEqual(errs({ kit_type: "crane_kit", selection: sel({ crane: null }) }), ["Не обрано обов’язкову позицію «Кран-маніпулятор»."]);
  assert.deepEqual(errs({ kit_type: "crane_kit", selection: sel({ crane: "bmf720", wheels: "x" }) }),
    ["Невідома позиція «wheels» для комплекту «Кран-маніпулятор BMF у комплекті»."]);
  assert.deepEqual(errs({ kit_type: "crane_kit", selection: sel({ crane: "bmf999" }) }), ["Позиція «Кран-маніпулятор»: невідомий виріб «bmf999»."]);
  assert.deepEqual(errs({ kit_type: "npl_crane", selection: sel({ trailer: "npl10", crane: "bmf905" }) }),
    ["Позиція «Кран-маніпулятор»: «Кран-маніпулятор BMF 905» не можна обрати в комплекті «Напівпричіп-лісовоз НПЛ-10 з краном-маніпулятором BMF»."]);
});

test("validateSelection: incompatible items", () => {
  assert.deepEqual(errs({ kit_type: "crane_kit", selection: sel({ crane: "bmf720", base: "base_outriggers_650" }) }),
    ["Позиція «Платформа з аутригерами»: «Платформа з аутригерами» підходить лише до BMF 650, а в комплекті BMF 720."]);
  assert.deepEqual(errs({ kit_type: "bmf_trailer_crane", selection: sel({ trailer: "bmf8t2", crane: "bmf750" }) }),
    ["Позиція «Причіп BMF»: «Лісовозний тракторний причіп BMF 8T2» підходить лише до BMF 650 і BMF 720, а в комплекті BMF 750."]);
});

test("validateSelection: choices", () => {
  assert.deepEqual(errs({ kit_type: "npl_crane", selection: sel({ trailer: "npl10", crane: "bmf750" }, { choices: { color: "red" } }) }),
    ["Невідомий параметр «color» для комплекту «Напівпричіп-лісовоз НПЛ-10 з краном-маніпулятором BMF»."]);
  assert.deepEqual(errs({ kit_type: "npl_crane", selection: sel({ trailer: "npl10", crane: "bmf750" }, { choices: { brakes: "air" } }) }),
    ["Невідоме значення «air» для параметра «Гальмівна система»."]);
});

test("validateSelection: accessories", () => {
  const k = (accessories: Selection["accessories"], kit = "crane_kit", slots: Record<string, string | null> = { crane: "bmf750" }) =>
    errs({ kit_type: kit, selection: sel(slots, { accessories }) });
  assert.deepEqual(k([{ id: "nope" }]), ["Невідома опція «nope»."]);
  assert.deepEqual(k([{ id: "rv_wheels" }]), ["Опція «Колеса» недоступна для комплекту «Кран-маніпулятор BMF у комплекті»."]);
  assert.deepEqual(k([{ id: "rv_leg_a" }]), ["Опція «Опора крана типу А» несумісна з BMF 750."]);
  assert.deepEqual(k([{ id: "rv_grapples" }, { id: "rv_grapples" }]), ["Опцію «Грейфери Hardox» додано двічі."]);
  assert.deepEqual(k([{ id: "rv_grapples", variant: "c99" }]), ["Опція «Грейфери Hardox»: невідомий варіант «c99»."]);
  assert.deepEqual(k([{ id: "rv_grapples", variant: "grapple_c15" }]), ["Опція «Грейфери Hardox»: варіант «C15» не підходить до цього комплекту."]);
  assert.deepEqual(k([{ id: "rv_grapples", variant: "grapple_c27", price_uah: -5 }]), ["Опція «Грейфери Hardox»: ціна має бути невід’ємним числом."]);
  assert.deepEqual(k([{ id: "rv_grapples", variant: "grapple_c27", price_uah: 15000 }]), []);
  // trailer options for the НПЛ-10: allowed, compatibility is confirmed on order (a quote warning)
  assert.deepEqual(k([{ id: "rv_lights" }], "npl_crane", { trailer: "npl10", crane: "bmf750" }), []);
  assert.deepEqual(k([{ id: "rv_wheels" }], "npl_crane", { trailer: "npl10", crane: "bmf750" }), ["Опція «Колеса» несумісна з НПЛ-10 і BMF 750."]);
});

test("validateSelection: manual prices, kit price, discount and date", () => {
  const base = { kit_type: "crane_kit", selection: sel({ crane: "bmf720" }) };
  assert.deepEqual(errs({ ...base, manual_prices: { zzz: 1 } }), ["Ручна ціна для невідомого виробу «zzz»."]);
  assert.deepEqual(errs({ ...base, manual_prices: { bmf720: -1 } }), ["Ручна ціна для «Кран-маніпулятор BMF 720» має бути невід’ємним числом."]);
  assert.deepEqual(errs({ ...base, kit_price_uah: 1 }), ["Ручна ціна комплекту можлива лише для комплектів з єдиною ціною."]);
  assert.deepEqual(errs({ ...base, discount_pct: -2 }), ["Знижка має бути невід’ємним числом відсотків."]);
  assert.deepEqual(errs({ ...base, date: "18.10.2026" }), ["Невірна дата «18.10.2026» (потрібно РРРР-ММ-ДД)."]);
  assert.deepEqual(errs({ kit_type: "npl_crane", selection: sel({ trailer: "npl10", crane: "bmf850" }), kit_price_uah: 2100000 }), []);
});

test("slot candidates follow compatibility", () => {
  const base = slotCandidates(c, "crane_kit", "base", sel({ crane: "bmf750" }));
  assert.deepEqual(base.filter((x) => x.allowed).map((x) => x.id), ["base_outriggers_750", "truck_pyramid_outriggers"]);
  const trailers = slotCandidates(c, "bmf_trailer_crane", "trailer", sel({ crane: "bmf905" }));
  assert.deepEqual(trailers.filter((x) => x.allowed).map((x) => x.id), ["bmf14t2_pro_l", "bmf17t2"]);
  const cranes = slotCandidates(c, "bmf_trailer_crane", "crane", sel({ trailer: "bmf8t2" }));
  assert.deepEqual(cranes.filter((x) => x.allowed).map((x) => x.id), ["bmf650", "bmf720"]);
});

test("reconcileSelection replaces items that no longer fit", () => {
  const kt = kitTypeById(c, "crane_kit")!;
  const s = defaultSelection(kt);
  s.slots.crane = "bmf750";
  s.accessories = [{ id: "rv_leg_a" }, { id: "rv_grapples", variant: "grapple_c15" }];
  const r = reconcileSelection(c, "crane_kit", s, "crane");
  assert.equal(r.slots.base, "base_outriggers_750");
  assert.deepEqual(r.accessories, [{ id: "rv_grapples", variant: null }]);
  const r2 = reconcileSelection(c, "crane_kit", { ...s, slots: { ...s.slots, crane: "bmf905" } }, "crane");
  assert.equal(r2.slots.base, null);
  assert.deepEqual(validateSelection(c, { kit_type: "crane_kit", selection: r2 }), []);
  const t = reconcileSelection(c, "bmf_trailer_crane", sel({ trailer: "bmf8t2", crane: "bmf750" }), "crane");
  assert.equal(t.slots.trailer, "bmf10t2");
});

test("bundles match the exact slot set", () => {
  assert.equal(findBundle(c, "npl_crane", { trailer: "npl10", crane: "bmf750" })?.id, "npl10_bmf750");
  assert.equal(findBundle(c, "npl_crane", { trailer: "npl10", crane: "bmf850" }), undefined);
  assert.equal(findBundle(c, "truck_crane", { conversion: "kamaz_platform", crane: "bmf750" }), undefined);
  // pump and PTO are priced slots: they sit on top of the bundle and are not part of its slot set
  assert.equal(findBundle(c, "truck_crane", { conversion: "kamaz_platform", crane: "bmf750", base: "truck_pyramid_outriggers", tank: "tank", oil: "oil_90l" })?.id, "kamaz_bmf750");
  assert.equal(findBundle(c, "truck_crane", { conversion: "zil_platform", crane: "bmf650", base: "truck_pyramid_outriggers", tank: "tank", oil: "oil_90l" })?.id, "zil_bmf650");
});

test("kit accessories: statuses and variant texts for the kit", () => {
  const npl = kitAccessories(c, "npl_crane", sel({ trailer: "npl10", crane: "bmf750" }));
  const st = Object.fromEntries(npl.map((x) => [x.accessory.id, x.status]));
  assert.equal(st.rv_grapples, "ok");
  assert.equal(st.rv_leg_a, "incompatible");
  assert.equal(st.rv_lights, "unconfirmed");
  assert.equal(st.rv_wheels, "incompatible");
  assert.equal(st.rv_poles, "ok");
  const g = accessoryById(c, "rv_grapples")!;
  assert.equal(accessoryDesc(c, g, [itemById(c, "bmf750")!]), "Сталь Hardox (SSAB); штатний захват уже в ціні крана. Для BMF 750: C20, C24 або C27.");
  assert.equal(accessoryDesc(c, g, [itemById(c, "bmf750")!], "grapple_c24"), g.variants!.find((v) => v.id === "grapple_c24")!.desc);
  const w = accessoryById(c, "rv_wheels")!;
  assert.match(accessoryDesc(c, w, [itemById(c, "bmf8t2")!]), /Для BMF 8T2: 400\/60-15,5 \(SG\), 500\/50-17 \(SG\) або 520\/50-17 \(SG\)\.$/);
});

test("validateCatalog reports broken references and duplicates", () => {
  const bad: Catalog = JSON.parse(JSON.stringify(c));
  bad.items.push({ ...bad.items[0]!, short: "автономна гідравліка" });
  bad.kit_types[0]!.slots[0]!.candidates.push("ghost");
  bad.presets[0]!.selection.slots.crane = "ghost";
  bad.accessories[0]!.compatible = ["ghost"];
  const e = validateCatalog(bad);
  assert.ok(e.some((x) => x.includes("id «bmf650» повторюється")), e.join("\n"));
  assert.ok(e.some((x) => x.includes("невідомий виріб «ghost»")));
  assert.ok(e.some((x) => x.startsWith("Пресет «kp2v3_bmf720_kit»")));
  assert.ok(e.some((x) => x.includes("автономна гідравліка")));
});
