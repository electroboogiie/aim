// Ukrainian UI labels that the catalog does not carry (spec keys, short kit names).
import type { Catalog, Item, KitType, Selection } from "../../core/src/index.js";
import { SUPPORTED_PROFILES, itemById, modelName, selectedItems } from "../../core/src/index.js";

const KIT_SHORT: Record<string, string> = {
  crane_kit: "Кран + основа",
  npl_crane: "НПЛ-10 + кран",
  bmf_trailer_crane: "Причіп BMF + кран",
  truck_crane: "Вантажівка + кран",
  part: "Окремі позиції",
};
export function kitShort(kt: KitType): string { return KIT_SHORT[kt.id] ?? kt.title; }

export const SPEC_LABELS: Record<string, string> = {
  reach_m: "Максимальний виліт, м",
  torque_knm: "Підйомний момент, кНм",
  lift_4m_kg: "Вантажопідйомність на 4 м, кг",
  lift_full_kg: "На повному вильоті, кг",
  grapple_m2: "Захват, м²",
  rotator_t: "Ротатор, т",
  valve: "Гідророзподільник",
  valve_flow_l: "Потік розподільника, л",
  slew_knm: "Поворотний момент, кНм",
  slew_cyl: "Циліндри повороту",
  turn_deg: "Кут повороту, °",
  pressure_bar: "Робочий тиск, бар",
  pump_lpm: "Продуктивність насоса, л/хв",
  legs: "Тип опор",
  weight_kg: "Маса, кг",
  telescope: "Телескоп",
  wide_angle: "Широкий кут",
  gross_mass_kg: "Повна маса, кг",
  curb_mass_kg: "Маса без вантажу, кг",
  payload_kg: "Вантажопідйомність, кг",
  log_length_m: "Довжина колод, м",
  volume_m3: "Об’єм вантажу, м³",
  load_area_mm: "Вантажна площа, мм",
  dims_mm: "Габарити, мм",
  stakes: "Коники",
  frame_wall_mm: "Стінка рами, мм",
  frame_length_m: "Довжина рами, м",
  hub: "Маточини",
  wheels: "Колеса",
  wheels_qty: "Кількість коліс",
  suspension: "Підвіска",
  brakes: "Гальма",
  outriggers: "Аутригери",
  balancer: "Балансир",
  drawbar: "Дишло",
  coupling: "Зчіпний пристрій",
  guard_grid: "Захисна решітка",
  lights_plate: "Світло й номерна площадка",
  hydraulics: "Гідравліка",
  operator_seat: "Місце оператора",
  color: "Колір",
  cranes: "Сумісні крани",
  crane: "Під кран",
  headboard: "Щит",
  installation: "Монтаж",
};

export function specRows(item: Item): [string, string][] {
  return Object.entries(item.specs ?? {})
    .filter(([, v]) => v !== "" && v !== null && v !== undefined)
    .map(([k, v]) => [SPEC_LABELS[k] ?? k, String(v)] as [string, string]);
}

/** Short name for cards and hints: model, else title. */
export function itemName(item: Item): string { return modelName(item); }

export interface Readiness { ok: boolean; label: string; reasons: string[] }

/** Whether the KP_2_v3 generator has pages for the crane of this selection (before any quote is made). */
export function kpReadiness(c: Catalog, kt: KitType, selection: Selection): Readiness {
  const crane = selectedItems(c, kt, selection).map((x) => x.item).find((it) => it.kind === "crane");
  if (!crane) return { ok: false, label: "КП за шаблоном не будується", reasons: ["Шаблон KP_2_v3 будує КП лише для комплектів з краном-маніпулятором BMF."] };
  return craneReadiness(crane);
}

export function craneReadiness(crane: Item): Readiness {
  if (crane.kind !== "crane") return { ok: true, label: "", reasons: [] };
  if (!crane.kp_profile || !SUPPORTED_PROFILES.includes(crane.kp_profile)) {
    return { ok: false, label: "КП для цієї моделі ще не готова", reasons: [`Для ${modelName(crane)} ще немає сторінок КП.`] };
  }
  return { ok: true, label: "", reasons: [] };
}

/** First photo among the title slots (then any slot) of a selection: kit and preset card pictures. */
export function selectionPhoto(c: Catalog, kt: KitType, selection: Selection): string | null {
  const order = [...(kt.title_slots ?? []), ...kt.slots.map((s) => s.id)];
  for (const sid of order) {
    const id = selection.slots?.[sid];
    const it = id ? itemById(c, id) : undefined;
    if (it?.photo) return it.photo;
  }
  return null;
}
