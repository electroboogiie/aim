// Catalog rules: lookups, default and preset selections, compatibility, selection and catalog validation.
// All messages are Ukrainian (they reach the manager or the admin as they are).
import type {
  Accessory, AccessoryVariant, Bundle, Catalog, Choice, ChoiceOption, Company, Item, KitType, PriceRule, Preset,
  QuoteInput, Selection, Slot, Term,
} from "./types.js";
import { fillTemplate, isIsoDate, joinUk } from "./format.js";

/** Crane visual profiles the KP generator supports (generator/kpgen/profiles.py). */
export const SUPPORTED_PROFILES: readonly string[] = ["bmf650", "bmf720", "bmf750"];
/** BMF trailer profiles of the generator (drawings and photos for the trailer pages). */
export const SUPPORTED_TRAILER_PROFILES: readonly string[] = ["bmf8t2", "bmf10t2", "bmf14t2", "bmf17t2"];

const ITEM_KINDS = ["crane", "trailer", "component", "service"];
const ACCESSORY_GROUPS = ["crane", "trailer"];
const ROLES = ["maker", "distributor", "both"];

export function itemById(c: Catalog, id: string): Item | undefined { return c.items.find((x) => x.id === id); }
export function kitTypeById(c: Catalog, id: string): KitType | undefined { return c.kit_types.find((x) => x.id === id); }
export function accessoryById(c: Catalog, id: string): Accessory | undefined { return c.accessories.find((x) => x.id === id); }
export function companyById(c: Catalog, id: string): Company | undefined { return c.companies.find((x) => x.id === id); }
export function termById(c: Catalog, id: string): Term | undefined { return c.texts.terms.find((x) => x.id === id); }
export function presetById(c: Catalog, id: string): Preset | undefined { return c.presets.find((x) => x.id === id); }

/** Short name for titles and messages: "BMF 750", "НПЛ-10"; the full title when there is none. */
export function modelName(item: Item): string { return item.model || item.title; }

export function choiceOption(choice: Choice, value: string | undefined): ChoiceOption | undefined {
  return choice.options.find((o) => o.value === value);
}

export function defaultSelection(kitType: KitType): Selection {
  const slots: Record<string, string | null> = {};
  for (const s of kitType.slots) slots[s.id] = s.default;
  const choices: Record<string, string> = {};
  for (const ch of kitType.choices) choices[ch.id] = ch.default;
  return { slots, choices, accessories: [] };
}

function cloneSelection(s: Selection): Selection {
  return {
    slots: { ...(s.slots ?? {}) },
    choices: { ...(s.choices ?? {}) },
    accessories: (s.accessories ?? []).map((a) => ({ ...a })),
  };
}

/** Every slot present (missing ones are empty), missing choices get their default. */
export function normalizeSelection(kitType: KitType, selection: Selection): Selection {
  const s = cloneSelection(selection);
  const slots: Record<string, string | null> = {};
  for (const slot of kitType.slots) slots[slot.id] = s.slots[slot.id] ?? null;
  const choices: Record<string, string> = {};
  for (const ch of kitType.choices) choices[ch.id] = s.choices[ch.id] ?? ch.default;
  return { slots, choices, accessories: s.accessories };
}

/** A copy of the preset's selection; with the catalog it is also normalized for its kit type. */
export function presetSelection(preset: Preset, catalog?: Catalog): Selection {
  const s = cloneSelection(preset.selection);
  const kt = catalog ? kitTypeById(catalog, preset.kit_type) : undefined;
  return kt ? normalizeSelection(kt, s) : s;
}

export interface SelectedItem { slot: Slot; item: Item }

/** Items chosen in the kit's slots, in slot order (unknown ids are skipped). */
export function selectedItems(c: Catalog, kitType: KitType, selection: Selection): SelectedItem[] {
  const out: SelectedItem[] = [];
  for (const slot of kitType.slots) {
    const id = selection.slots?.[slot.id];
    const item = id ? itemById(c, id) : undefined;
    if (item) out.push({ slot, item });
  }
  return out;
}

function kindsOf(c: Catalog, ids: string[]): Set<string> {
  const kinds = new Set<string>();
  for (const id of ids) { const it = itemById(c, id); if (it) kinds.add(it.kind); }
  return kinds;
}

/** Items among `others` that a compatibility list speaks about (same kind as the listed ids). */
function relevant(c: Catalog, list: string[], others: Item[]): Item[] {
  const kinds = kindsOf(c, list);
  return others.filter((o) => kinds.has(o.kind));
}

/**
 * Item.compatible: every other selected item of a kind the list names must be in the list.
 * Nothing of that kind selected (e.g. no crane yet) is not a conflict.
 */
export function itemFits(c: Catalog, item: Item, others: Item[]): boolean {
  if (!item.compatible) return true;
  return relevant(c, item.compatible, others.filter((o) => o.id !== item.id)).every((o) => item.compatible!.includes(o.id));
}

function fitMessage(c: Catalog, slot: Slot, item: Item, others: Item[]): string {
  const list = (item.compatible ?? []).map((id) => itemById(c, id)).filter((x): x is Item => !!x).map(modelName);
  const bad = relevant(c, item.compatible ?? [], others).filter((o) => !item.compatible!.includes(o.id)).map(modelName);
  return `Позиція «${slot.title}»: «${item.title}» підходить лише до ${joinUk(list, "і")}, а в комплекті ${joinUk(bad, "і")}.`;
}

export interface Candidate { id: string; item: Item | undefined; allowed: boolean; reason?: string }

/** Candidates of a slot with what the rest of the selection allows (for pickers in the UI). */
export function slotCandidates(c: Catalog, kitTypeId: string, slotId: string, selection: Selection): Candidate[] {
  const kt = kitTypeById(c, kitTypeId);
  const slot = kt?.slots.find((s) => s.id === slotId);
  if (!kt || !slot) return [];
  const others = selectedItems(c, kt, selection).filter((x) => x.slot.id !== slotId).map((x) => x.item);
  return slot.candidates.map((id) => {
    const item = itemById(c, id);
    if (!item) return { id, item, allowed: false, reason: `Невідомий виріб «${id}».` };
    if (itemFits(c, item, others) && others.every((o) => itemFits(c, o, [item]))) return { id, item, allowed: true };
    const blocker = !itemFits(c, item, others) ? fitMessage(c, slot, item, others)
      : `«${item.title}» не сумісний з обраним комплектом.`;
    return { id, item, allowed: false, reason: blocker };
  });
}

export type AccessoryStatus = "ok" | "unconfirmed" | "incompatible";

/** Compatibility of an accessory with the selected items (see CONTRACTS §2.2). */
export function accessoryStatus(c: Catalog, acc: Accessory, items: Item[]): AccessoryStatus {
  if (!acc.compatible) return "ok";
  const rel = relevant(c, acc.compatible, items);
  if (rel.length && rel.every((o) => acc.compatible!.includes(o.id))) return "ok";
  const unconf = acc.compatible_unconfirmed ?? [];
  const relU = items.filter((o) => unconf.includes(o.id));
  if (relU.length && rel.every((o) => acc.compatible!.includes(o.id) || unconf.includes(o.id))) return "unconfirmed";
  return "incompatible";
}

/** Variants that fit the selected items (a variant without a list fits everything). */
export function accessoryVariants(c: Catalog, acc: Accessory, items: Item[]): AccessoryVariant[] {
  return (acc.variants ?? []).filter((v) => variantFits(c, v, items));
}

function variantFits(c: Catalog, v: AccessoryVariant, items: Item[]): boolean {
  if (!v.compatible) return true;
  const rel = relevant(c, v.compatible, items);
  return rel.length === 0 || rel.some((o) => v.compatible!.includes(o.id));
}

const MAX_LISTED_VARIANTS = 6;

/**
 * Card / row text of an accessory: its desc plus the variants that fit the kit
 * ("Для BMF 750: C20, C24 або C27."), or all variants when the kit does not narrow them.
 */
export function accessoryDesc(c: Catalog, acc: Accessory, items: Item[], variantId?: string | null): string {
  const all = acc.variants ?? [];
  if (variantId) {
    const v = all.find((x) => x.id === variantId);
    if (v) return v.desc || acc.desc;
  }
  if (!all.length) return acc.desc;
  const fit = accessoryVariants(c, acc, items);
  const narrowed = fit.length < all.length;
  if (!fit.length || (!narrowed && all.length > MAX_LISTED_VARIANTS)) return acc.desc;
  const listed = all.filter((v) => v.compatible);
  const subject = narrowed && listed.length
    ? items.filter((o) => listed.some((v) => relevant(c, v.compatible!, [o]).length > 0)).map(modelName)
    : [];
  const head = narrowed && subject.length ? `Для ${joinUk(subject, "і")}` : "Варіанти";
  return `${acc.desc} ${head}: ${joinUk(fit.map((v) => v.title))}.`;
}

export interface KitAccessory { accessory: Accessory; status: AccessoryStatus; variants: AccessoryVariant[]; desc: string }

/** Accessories offered for the kit (its accessory groups), with compatibility against the selection. */
export function kitAccessories(c: Catalog, kitTypeId: string, selection: Selection): KitAccessory[] {
  const kt = kitTypeById(c, kitTypeId);
  if (!kt) return [];
  const items = selectedItems(c, kt, selection).map((x) => x.item);
  return c.accessories
    .filter((a) => kt.accessory_groups.includes(a.group))
    .map((a) => ({ accessory: a, status: accessoryStatus(c, a, items), variants: accessoryVariants(c, a, items),
                   desc: accessoryDesc(c, a, items) }));
}

/** Bundle of the kit type whose slots equal the non-empty selected slots exactly. */
export function findBundle(c: Catalog, kitTypeId: string, slots: Record<string, string | null>): Bundle | undefined {
  const chosen = Object.entries(slots).filter(([, v]) => !!v) as [string, string][];
  return c.bundles.find((b) => {
    if (b.kit_type !== kitTypeId) return false;
    const keys = Object.keys(b.slots);
    return keys.length === chosen.length && chosen.every(([k, v]) => b.slots[k] === v);
  });
}

/** Kit name from the models in KitType.title_slots: "НПЛ-10 + BMF 750"; the kit type title when there are none. */
export function kitTitle(c: Catalog, kitType: KitType, selection: Selection): string {
  const parts = (kitType.title_slots ?? [])
    .map((id) => selection.slots?.[id])
    .map((id) => (id ? itemById(c, id) : undefined))
    .filter((x): x is Item => !!x)
    .map(modelName);
  return parts.length ? parts.join(" + ") : kitType.title;
}

/** Row text of an item: desc_template filled with the chosen options (short or title), else short. */
export function itemDesc(kitType: KitType, item: Item, selection: Selection): string {
  if (!item.desc_template) return item.short;
  const vars: Record<string, string> = {};
  for (const ch of kitType.choices) {
    const o = choiceOption(ch, selection.choices?.[ch.id] ?? ch.default);
    if (o) vars[ch.id] = o.short ?? o.title;
  }
  return fillTemplate(item.desc_template, vars);
}

/**
 * After the manager changed one slot: items in other slots that no longer fit are replaced by the slot default
 * or the first candidate that fits (optional slots are emptied when none fits); accessories that became
 * incompatible and variants that no longer fit are dropped. Choices get defaults.
 */
export function reconcileSelection(c: Catalog, kitTypeId: string, selection: Selection, changedSlot?: string): Selection {
  const kt = kitTypeById(c, kitTypeId);
  if (!kt) return cloneSelection(selection);
  const s = normalizeSelection(kt, selection);
  const order = kt.slots.filter((x) => x.id !== changedSlot);
  for (const slot of order) {
    const id = s.slots[slot.id];
    const item = id ? itemById(c, id) : undefined;
    if (!item) continue;
    const others = () => selectedItems(c, kt, s).filter((x) => x.slot.id !== slot.id).map((x) => x.item);
    const fits = (it: Item) => itemFits(c, it, others()) && others().every((o) => itemFits(c, o, [it]));
    if (fits(item)) continue;
    const pool = [slot.default, ...slot.candidates].filter((x): x is string => !!x);
    const repl = pool.map((x) => itemById(c, x)).find((it): it is Item => !!it && fits(it));
    if (repl) s.slots[slot.id] = repl.id;
    else if (!slot.required) s.slots[slot.id] = null;
  }
  const items = selectedItems(c, kt, s).map((x) => x.item);
  s.accessories = s.accessories
    .filter((a) => {
      const acc = accessoryById(c, a.id);
      return !!acc && kt.accessory_groups.includes(acc.group) && accessoryStatus(c, acc, items) !== "incompatible";
    })
    .map((a) => {
      const acc = accessoryById(c, a.id)!;
      if (a.variant && !accessoryVariants(c, acc, items).some((v) => v.id === a.variant)) return { ...a, variant: null };
      return a;
    });
  return s;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isMoney = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;

/** Errors of a quote input against the catalog (unknown ids, slots, choices, accessories, manual prices). */
export function validateSelection(c: Catalog, input: QuoteInput): string[] {
  const errors: string[] = [];
  if (!isObj(input)) return ["Запит на розрахунок має бути об’єктом."];
  const kt = typeof input.kit_type === "string" ? kitTypeById(c, input.kit_type) : undefined;
  if (!kt) return [`Невідомий тип комплекту «${String(input.kit_type ?? "")}».`];
  const sel = input.selection as unknown;
  if (!isObj(sel)) return ["Не передано вибір комплекту (selection)."];
  const slots = sel.slots ?? {};
  const choices = sel.choices ?? {};
  const accs = sel.accessories ?? [];
  if (!isObj(slots)) errors.push("selection.slots має бути об’єктом.");
  if (!isObj(choices)) errors.push("selection.choices має бути об’єктом.");
  if (!Array.isArray(accs)) errors.push("selection.accessories має бути списком.");
  if (errors.length) return errors;
  const sl = slots as Record<string, unknown>;
  const chs = choices as Record<string, unknown>;

  for (const key of Object.keys(sl)) {
    if (!kt.slots.some((s) => s.id === key)) errors.push(`Невідома позиція «${key}» для комплекту «${kt.title}».`);
  }
  const picked: SelectedItem[] = [];
  for (const slot of kt.slots) {
    const v = sl[slot.id];
    if (v === undefined || v === null || v === "") {
      if (slot.required) errors.push(`Не обрано обов’язкову позицію «${slot.title}».`);
      continue;
    }
    if (typeof v !== "string") { errors.push(`Позиція «${slot.title}»: id виробу має бути рядком.`); continue; }
    const item = itemById(c, v);
    if (!item) { errors.push(`Позиція «${slot.title}»: невідомий виріб «${v}».`); continue; }
    if (!slot.candidates.includes(v)) {
      errors.push(`Позиція «${slot.title}»: «${item.title}» не можна обрати в комплекті «${kt.title}».`);
      continue;
    }
    picked.push({ slot, item });
  }
  for (const p of picked) {
    const others = picked.filter((x) => x !== p).map((x) => x.item);
    if (!itemFits(c, p.item, others)) errors.push(fitMessage(c, p.slot, p.item, others));
  }

  for (const key of Object.keys(chs)) {
    const ch = kt.choices.find((x) => x.id === key);
    if (!ch) { errors.push(`Невідомий параметр «${key}» для комплекту «${kt.title}».`); continue; }
    const v = chs[key];
    if (typeof v !== "string" || !choiceOption(ch, v)) errors.push(`Невідоме значення «${String(v)}» для параметра «${ch.title}».`);
  }

  const items = picked.map((x) => x.item);
  const seen = new Set<string>();
  for (const raw of accs as unknown[]) {
    if (!isObj(raw) || typeof raw.id !== "string") { errors.push("Опція має містити id."); continue; }
    const acc = accessoryById(c, raw.id);
    if (!acc) { errors.push(`Невідома опція «${raw.id}».`); continue; }
    if (seen.has(acc.id)) { errors.push(`Опцію «${acc.title}» додано двічі.`); continue; }
    seen.add(acc.id);
    if (!kt.accessory_groups.includes(acc.group)) {
      errors.push(`Опція «${acc.title}» недоступна для комплекту «${kt.title}».`);
      continue;
    }
    if (accessoryStatus(c, acc, items) === "incompatible") {
      const names = items.length ? joinUk(items.map(modelName), "і") : "порожнім комплектом";
      errors.push(`Опція «${acc.title}» несумісна з ${names}.`);
      continue;
    }
    if (raw.variant !== undefined && raw.variant !== null && raw.variant !== "") {
      const v = (acc.variants ?? []).find((x) => x.id === raw.variant);
      if (!v) errors.push(`Опція «${acc.title}»: невідомий варіант «${String(raw.variant)}».`);
      else if (!variantFits(c, v, items)) errors.push(`Опція «${acc.title}»: варіант «${v.title}» не підходить до цього комплекту.`);
    }
    if (raw.price_uah !== undefined && raw.price_uah !== null && !isMoney(raw.price_uah)) {
      errors.push(`Опція «${acc.title}»: ціна має бути невід’ємним числом.`);
    }
  }

  if (input.discount_pct !== undefined && input.discount_pct !== null) {
    const d = input.discount_pct as unknown;
    if (typeof d !== "number" || !Number.isFinite(d) || d < 0) errors.push("Знижка має бути невід’ємним числом відсотків.");
  }
  if (input.manual_prices !== undefined && input.manual_prices !== null) {
    if (!isObj(input.manual_prices)) errors.push("manual_prices має бути об’єктом «id виробу → ціна».");
    else {
      for (const [id, v] of Object.entries(input.manual_prices)) {
        const it = itemById(c, id);
        if (!it) errors.push(`Ручна ціна для невідомого виробу «${id}».`);
        else if (!isMoney(v)) errors.push(`Ручна ціна для «${it.title}» має бути невід’ємним числом.`);
      }
    }
  }
  if (input.kit_price_uah !== undefined && input.kit_price_uah !== null) {
    if (kt.price_display !== "bundle") errors.push("Ручна ціна комплекту можлива лише для комплектів з єдиною ціною.");
    else if (!isMoney(input.kit_price_uah)) errors.push("Ціна комплекту має бути невід’ємним числом.");
  }
  if (input.date !== undefined && input.date !== null && !isIsoDate(input.date)) {
    errors.push(`Невірна дата «${String(input.date)}» (потрібно РРРР-ММ-ДД).`);
  }
  return errors;
}

// ------------------------------------------------------------------ catalog validation

function checkPrice(p: PriceRule | undefined, where: string, errors: string[]): void {
  if (!isObj(p)) { errors.push(`${where}: немає правила ціни.`); return; }
  const num = (v: unknown, name: string, opt = false) => {
    if (opt && (v === undefined || v === null)) return;
    if (!isMoney(v)) errors.push(`${where}: price.${name} має бути невід’ємним числом.`);
  };
  const group = (g: unknown) => { if (typeof g !== "string" || !g) errors.push(`${where}: price.group порожня.`); };
  switch (p.mode) {
    case "eur": num(p.eur, "eur"); group(p.group); break;
    case "cost":
      if (!Array.isArray(p.metal)) errors.push(`${where}: price.metal має бути списком.`);
      else p.metal.forEach((m, i) => {
        if (!m || typeof m.grade !== "string" || !m.grade) errors.push(`${where}: price.metal[${i}].grade порожній.`);
        num(m?.kg, `metal[${i}].kg`);
      });
      num(p.components_eur, "components_eur", true); num(p.hours, "hours", true); num(p.paint_uah, "paint_uah", true);
      group(p.group);
      break;
    case "ref": {
      const pt = (x: { uah: unknown; date: unknown; eur_rate_ref?: unknown; metal_index_ref?: unknown }, name: string) => {
        if (!isMoney(x.uah)) errors.push(`${where}: ${name}.uah має бути невід’ємним числом.`);
        if (!isIsoDate(x.date)) errors.push(`${where}: ${name}.date має бути датою РРРР-ММ-ДД.`);
        for (const k of ["eur_rate_ref", "metal_index_ref"] as const) {
          const v = x[k];
          if (v !== undefined && v !== null && !(typeof v === "number" && v > 0)) errors.push(`${where}: ${name}.${k} має бути додатним числом або null.`);
        }
      };
      pt(p, "price");
      (p.history ?? []).forEach((h, i) => pt(h, `price.history[${i}]`));
      const share = (v: unknown, n: string) => {
        if (typeof v !== "number" || !(v >= 0 && v <= 1)) errors.push(`${where}: price.${n} має бути від 0 до 1.`);
      };
      share(p.eur_share, "eur_share"); share(p.metal_share, "metal_share");
      if (p.eur_share + p.metal_share > 1 + 1e-9) errors.push(`${where}: eur_share + metal_share більше 1.`);
      group(p.group);
      break;
    }
    case "on_request": case "included": break;
    default: errors.push(`${where}: невідомий режим ціни «${String((p as { mode?: unknown }).mode)}».`);
  }
}

function dupes(ids: string[]): string[] {
  const seen = new Set<string>(); const out = new Set<string>();
  for (const id of ids) { if (seen.has(id)) out.add(id); seen.add(id); }
  return [...out];
}

/** Structural and referential checks of catalog.json; every preset must pass validateSelection. */
export function validateCatalog(c: Catalog): string[] {
  const errors: string[] = [];
  if (!isObj(c)) return ["Каталог має бути JSON-об’єктом."];
  for (const k of ["companies", "items", "kit_types", "presets", "accessories", "bundles"] as const) {
    if (!Array.isArray(c[k])) errors.push(`Каталог: поле ${k} має бути списком.`);
  }
  if (!isObj(c.texts) || !Array.isArray(c.texts.terms) || !Array.isArray(c.texts.advantages) || !isObj(c.texts.notes)) {
    errors.push("Каталог: texts має містити terms, advantages і notes.");
  }
  if (errors.length) return errors;
  if (typeof c.version !== "string" || !c.version) errors.push("Каталог: не задано version.");

  const coll: [string, { id: string }[]][] = [["companies", c.companies], ["items", c.items], ["kit_types", c.kit_types],
    ["presets", c.presets], ["accessories", c.accessories], ["bundles", c.bundles], ["texts.terms", c.texts.terms]];
  for (const [name, list] of coll) {
    list.forEach((x, i) => { if (!x || typeof x.id !== "string" || !x.id) errors.push(`${name}[${i}]: немає id.`); });
    for (const d of dupes(list.map((x) => x?.id))) errors.push(`${name}: id «${d}» повторюється.`);
  }

  for (const co of c.companies) {
    const w = `Компанія «${co.id}»`;
    for (const k of ["name", "short", "address", "email"] as const) if (typeof co[k] !== "string" || !co[k]) errors.push(`${w}: порожнє поле ${k}.`);
    if (!Array.isArray(co.phones) || !co.phones.length) errors.push(`${w}: немає телефонів.`);
    if (!Array.isArray(co.sites) || !co.sites.length) errors.push(`${w}: немає сайтів.`);
    if (!ROLES.includes(co.role)) errors.push(`${w}: невідома роль «${co.role}».`);
  }

  const itemIds = new Set(c.items.map((x) => x.id));
  const refItems = (list: unknown, where: string) => {
    if (list === undefined) return;
    if (!Array.isArray(list)) { errors.push(`${where}: має бути списком id.`); return; }
    for (const id of list) if (!itemIds.has(id)) errors.push(`${where}: невідомий виріб «${String(id)}».`);
  };
  const photoOk = (p: unknown, where: string) => {
    if (p === undefined || p === "") return;
    if (typeof p !== "string" || p.startsWith("/") || p.split("/").includes("..") || p.includes("\\")) {
      errors.push(`${where}: шлях до фото має бути відносним шляхом у generator/assets.`);
    }
  };

  for (const it of c.items) {
    const w = `Виріб «${it.id}»`;
    if (!ITEM_KINDS.includes(it.kind)) errors.push(`${w}: невідомий kind «${it.kind}».`);
    for (const k of ["family", "title", "short", "source"] as const) if (typeof it[k] !== "string" || !it[k]) errors.push(`${w}: порожнє поле ${k}.`);
    checkPrice(it.price, w, errors);
    refItems(it.compatible, `${w}, compatible`);
    photoOk(it.photo, w);
    if (it.specs !== undefined && !isObj(it.specs)) errors.push(`${w}: specs має бути об’єктом.`);
    if (it.kp_profile !== undefined && it.kp_profile !== null) {
      if (it.kind === "trailer") {
        if (!SUPPORTED_TRAILER_PROFILES.includes(it.kp_profile)) errors.push(`${w}: генератор не має профілю причепа «${it.kp_profile}».`);
      } else {
        if (!SUPPORTED_PROFILES.includes(it.kp_profile)) errors.push(`${w}: генератор не має профілю «${it.kp_profile}».`);
        if (it.kind !== "crane") errors.push(`${w}: kp_profile задається лише для кранів і причепів BMF.`);
        for (const k of ["reach_m", "torque_knm", "lift_4m_kg", "lift_full_kg", "grapple_m2", "rotator_t", "turn_deg"]) {
          if (!it.specs || it.specs[k] === undefined || it.specs[k] === "") errors.push(`${w}: для КП бракує характеристики ${k}.`);
        }
      }
    }
    for (const t of [it.title, it.short, it.desc_template]) {
      if (typeof t === "string" && /автономн\S*\s+гідравл/i.test(t)) errors.push(`${w}: «автономна гідравліка» не пишеться в описі позиції (лише в характеристиках).`);
    }
    if (it.kind === "crane" && (!it.includes || !it.includes.some((x) => x.startsWith("ротатор")) || !it.includes.some((x) => x.startsWith("захват")))) {
      errors.push(`${w}: кран BMF постачається з ротатором і захватом (includes).`);
    }
  }

  const termIds = new Set(c.texts.terms.map((t) => t.id));
  for (const kt of c.kit_types) {
    const w = `Тип комплекту «${kt.id}»`;
    if (kt.price_display !== "itemized" && kt.price_display !== "bundle") errors.push(`${w}: невідомий price_display.`);
    if (kt.generator !== "kp_v3") errors.push(`${w}: невідомий generator «${String(kt.generator)}».`);
    if (!Array.isArray(kt.slots) || !kt.slots.length) { errors.push(`${w}: немає позицій (slots).`); continue; }
    for (const d of dupes(kt.slots.map((s) => s.id))) errors.push(`${w}: позиція «${d}» повторюється.`);
    for (const s of kt.slots) {
      refItems(s.candidates, `${w}, позиція «${s.id}»`);
      if (s.default !== null && !s.candidates.includes(s.default)) errors.push(`${w}, позиція «${s.id}»: default не серед кандидатів.`);
      if (s.required && s.default === null) errors.push(`${w}, позиція «${s.id}»: обов’язкова позиція без default.`);
    }
    for (const d of dupes(kt.choices.map((x) => x.id))) errors.push(`${w}: параметр «${d}» повторюється.`);
    for (const ch of kt.choices) {
      for (const d of dupes(ch.options.map((o) => o.value))) errors.push(`${w}, параметр «${ch.id}»: значення «${d}» повторюється.`);
      if (!choiceOption(ch, ch.default)) errors.push(`${w}, параметр «${ch.id}»: default не серед значень.`);
      for (const o of ch.options) if (o.price_uah !== undefined && !isMoney(o.price_uah)) errors.push(`${w}, «${ch.id}=${o.value}»: price_uah має бути невід’ємним числом.`);
    }
    for (const g of kt.accessory_groups) if (!ACCESSORY_GROUPS.includes(g)) errors.push(`${w}: невідома група опцій «${g}».`);
    for (const s of kt.title_slots ?? []) if (!kt.slots.some((x) => x.id === s)) errors.push(`${w}: title_slots — невідома позиція «${s}».`);
    for (const t of kt.terms ?? []) if (!termIds.has(t)) errors.push(`${w}: невідома умова «${t}».`);
    if (kt.price_display === "bundle" && kt.id === "npl_crane" && kt.slots.length !== 2) errors.push(`${w}: комплект НПЛ-10 має рівно 2 позиції.`);
    const def = defaultSelection(kt);
    for (const e of validateSelection(c, { kit_type: kt.id, selection: def })) errors.push(`${w}, вибір за замовчуванням: ${e}`);
  }

  const bundleKeys = new Set<string>();
  for (const b of c.bundles) {
    const w = `Комплект-ціна «${b.id}»`;
    const kt = kitTypeById(c, b.kit_type);
    if (!kt) { errors.push(`${w}: невідомий тип комплекту «${b.kit_type}».`); continue; }
    if (kt.price_display !== "bundle") errors.push(`${w}: тип «${kt.id}» не має єдиної ціни (price_display).`);
    if (!isObj(b.slots) || !Object.keys(b.slots).length) { errors.push(`${w}: порожні slots.`); continue; }
    for (const [sid, iid] of Object.entries(b.slots)) {
      const slot = kt.slots.find((s) => s.id === sid);
      if (!slot) errors.push(`${w}: невідома позиція «${sid}».`);
      else if (!slot.candidates.includes(iid)) errors.push(`${w}: «${iid}» не є кандидатом позиції «${sid}».`);
    }
    const errs = validateSelection(c, { kit_type: kt.id, selection: { slots: b.slots, choices: {}, accessories: [] } });
    for (const e of errs) errors.push(`${w}: ${e}`);
    const key = kt.id + "|" + JSON.stringify(Object.entries(b.slots).sort());
    if (bundleKeys.has(key)) errors.push(`${w}: такий самий набір позицій уже має іншу ціну.`);
    bundleKeys.add(key);
    checkPrice(b.price, w, errors);
    if (typeof b.source !== "string" || !b.source) errors.push(`${w}: не вказано джерело.`);
  }

  for (const a of c.accessories) {
    const w = `Опція «${a.id}»`;
    if (!ACCESSORY_GROUPS.includes(a.group)) errors.push(`${w}: невідома група «${a.group}».`);
    for (const k of ["title", "desc", "source"] as const) if (typeof a[k] !== "string" || !a[k]) errors.push(`${w}: порожнє поле ${k}.`);
    if (typeof a.photo !== "string") errors.push(`${w}: photo має бути рядком (порожній — без фото).`);
    photoOk(a.photo, w);
    checkPrice(a.price, w, errors);
    refItems(a.compatible, `${w}, compatible`);
    refItems(a.compatible_unconfirmed, `${w}, compatible_unconfirmed`);
    for (const d of dupes((a.variants ?? []).map((v) => v.id))) errors.push(`${w}: варіант «${d}» повторюється.`);
    for (const v of a.variants ?? []) { refItems(v.compatible, `${w}, варіант «${v.id}»`); photoOk(v.photo, `${w}, варіант «${v.id}»`); }
  }

  for (const p of c.presets) {
    const w = `Пресет «${p.id}»`;
    const kt = kitTypeById(c, p.kit_type);
    if (!kt) { errors.push(`${w}: невідомий тип комплекту «${p.kit_type}».`); continue; }
    for (const e of validateSelection(c, { kit_type: p.kit_type, selection: p.selection })) errors.push(`${w}: ${e}`);
    const s = p.source;
    if (!isObj(s) || typeof s.file !== "string" || !s.file) errors.push(`${w}: не вказано файл-джерело.`);
    else {
      if (s.date !== "" && !isIsoDate(s.date)) errors.push(`${w}: source.date має бути РРРР-ММ-ДД або "".`);
      if (s.total_uah !== null && !isMoney(s.total_uah)) errors.push(`${w}: source.total_uah має бути числом або null.`);
      for (const r of s.rows ?? []) if (!r || typeof r.title !== "string" || !isMoney(r.price_uah)) errors.push(`${w}: невірний рядок source.rows.`);
    }
  }
  return errors;
}
