import { readFileSync } from "node:fs";
import type { Catalog, Item, KitType, PriceRule, Settings } from "../src/index.js";

const root = new URL("../../../", import.meta.url);   // build/core/test -> repo root

export function loadCatalog(): Catalog {
  return JSON.parse(readFileSync(new URL("catalog/catalog.json", root), "utf8")) as Catalog;
}

export function loadSettings(): Settings {
  return JSON.parse(readFileSync(new URL("catalog/settings.default.json", root), "utf8")) as Settings;
}

export function settings(over: Partial<Settings> = {}): Settings {
  return {
    eur: { mode: "nbu", manual_rate: null, buffer_pct: 0 },
    metal: { index_uah_per_kg: null, ref_index_uah_per_kg: null, grades: {} },
    labor_rate_uah: null,
    groups: { g: { markup_pct: 0, logistics_pct: 0 } },
    vat_pct: 20,
    rounding_uah: 50,
    validity_days: 7,
    max_discount_pct: 5,
    company_maker: "co",
    kp_number_prefix: "КП",
    ...over,
  };
}

export function item(id: string, price: PriceRule, over: Partial<Item> = {}): Item {
  return { id, kind: "component", family: "test", title: `Виріб ${id}`, short: `опис ${id}`, price, source: "тест", ...over };
}

export function crane(id: string, price: PriceRule, over: Partial<Item> = {}): Item {
  return item(id, price, {
    kind: "crane", family: "bmf_crane", title: `Кран-маніпулятор ${id.toUpperCase()}`, model: id.toUpperCase(),
    short: "у комплекті з ротатором 4 т і захватом 0,24 м²", includes: ["ротатор 4 т", "захват 0,24 м²"],
    specs: { reach_m: "7,2", torque_knm: "60", lift_4m_kg: "1100", lift_full_kg: "580", grapple_m2: "0,24", rotator_t: "4", turn_deg: "370" },
    kp_profile: "bmf720", ...over,
  });
}

/** Small catalog: one itemized kit (crane + up to 3 parts) and one bundle kit (trailer + crane). */
export function miniCatalog(items: Item[], extra: Partial<Catalog> = {}): Catalog {
  const ids = items.map((x) => x.id);
  const kits: KitType[] = [
    {
      id: "kit", title: "Комплект", price_display: "itemized", generator: "kp_v3", accessory_groups: ["crane"],
      title_slots: ["a"],
      slots: [
        { id: "a", title: "Позиція A", candidates: ids, required: true, default: ids[0] ?? null },
        { id: "b", title: "Позиція B", candidates: ids, required: false, default: null },
        { id: "c", title: "Позиція C", candidates: ids, required: false, default: null },
      ],
      choices: [{ id: "opt", title: "Опція", default: "x", options: [{ value: "x", title: "звичайна" }, { value: "y", title: "посилена", price_uah: 1000 }] }],
      terms: ["t1"], maker_line: "Виробник: {maker}",
    },
    {
      id: "pair", title: "Пара", price_display: "bundle", generator: "kp_v3", accessory_groups: ["crane", "trailer"],
      title_slots: ["trailer", "crane"],
      slots: [
        { id: "trailer", title: "Причіп", candidates: ids, required: true, default: ids[0] ?? null },
        { id: "crane", title: "Кран", candidates: ids, required: true, default: ids[0] ?? null },
      ],
      choices: [{ id: "brakes", title: "Гальма", default: "h", options: [
        { value: "h", title: "гідравлічна", short: "гідравлічні гальма" },
        { value: "p", title: "пневматична", short: "пневматичні гальма", on_request: true },
        { value: "v", title: "посилені", price_uah: 500 }] }],
    },
  ];
  return {
    version: "test",
    companies: [{ id: "co", name: "ТОВ «Тест»", short: "Тест", address: "вул. Перша 1, м. Сарни, Рівненська обл.", phones: ["(+380) 1"],
      email: "a@b.c", sites: ["bmf.rv.ua"], role: "both" }],
    items,
    kit_types: kits,
    presets: [],
    accessories: [],
    bundles: [],
    texts: { terms: [{ id: "t1", title: "Оплата", text: "Повна оплата." }, { id: "eur_rate", title: "Курс EUR", text: "Ціна прив’язана до курсу EUR." }],
      advantages: [], notes: {} },
    ...extra,
  };
}

export const ref = (uah: number, date: string, eur_share = 1, metal_share = 0, more: Record<string, unknown> = {}): PriceRule =>
  ({ mode: "ref", uah, date, eur_rate_ref: null, metal_index_ref: null, eur_share, metal_share, group: "g", ...more }) as PriceRule;
