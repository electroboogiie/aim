// The configurator draft: what the manager has picked so far. Kept in localStorage so a reload loses nothing.
import type { Catalog, KitType, Quote, QuoteInput, Selection } from "../../core/src/index.js";
import {
  QuoteError, defaultSelection, itemById, kitTypeById, kpBlockers, presetById, presetSelection, quote, reconcileSelection,
  selectedItems, todayIso, validateSelection,
} from "../../core/src/index.js";
import { ctx } from "./app.js";
import { KEYS, local } from "./storage.js";

export const STEPS = [
  { no: 1, id: "kit", title: "Комплект" },
  { no: 2, id: "slots", title: "Позиції" },
  { no: 3, id: "options", title: "Опції" },
  { no: 4, id: "client", title: "Клієнт" },
  { no: 5, id: "summary", title: "Підсумок" },
] as const;

export interface Draft {
  v: 1;
  step: number;
  kit_type: string | null;
  preset_id: string | null;
  selection: Selection;
  client: { name: string; contact: string };
  manager: string;
  maker: string;                          // Company id; "" = settings.company_maker
  discount_pct: number;
  manual_prices: Record<string, number>;  // item id -> UAH
  kit_price_uah: number | null;           // bundle kits only
}

function empty(): Draft {
  return {
    v: 1, step: 1, kit_type: null, preset_id: null, selection: { slots: {}, choices: {}, accessories: [] },
    client: { name: "", contact: "" }, manager: local.get(KEYS.manager) ?? "", maker: "", discount_pct: 0,
    manual_prices: {}, kit_price_uah: null,
  };
}

let draft: Draft = empty();

export function getDraft(): Draft { return draft; }

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;

/** Restore the saved draft, dropping whatever no longer exists in the catalog. */
export function loadDraft(c: Catalog): Draft {
  const raw = local.getJson<Partial<Draft>>(KEYS.draft);
  const d = empty();
  if (raw && raw.v === 1) {
    const kt = typeof raw.kit_type === "string" ? kitTypeById(c, raw.kit_type) : undefined;
    if (kt) {
      d.kit_type = kt.id;
      d.preset_id = typeof raw.preset_id === "string" && presetById(c, raw.preset_id) ? raw.preset_id : null;
      d.selection = sanitizeSelection(c, kt, raw.selection);
      d.step = typeof raw.step === "number" && raw.step >= 1 && raw.step <= STEPS.length ? Math.round(raw.step) : 2;
      if (raw.manual_prices && typeof raw.manual_prices === "object") {
        for (const [id, v] of Object.entries(raw.manual_prices)) if (itemById(c, id) && isNum(v)) d.manual_prices[id] = v;
      }
      d.kit_price_uah = kt.price_display === "bundle" && isNum(raw.kit_price_uah) ? raw.kit_price_uah : null;
    }
    if (raw.client && typeof raw.client === "object") {
      d.client = { name: String(raw.client.name ?? ""), contact: String(raw.client.contact ?? "") };
    }
    if (typeof raw.manager === "string") d.manager = raw.manager;
    if (typeof raw.maker === "string" && c.companies.some((x) => x.id === raw.maker)) d.maker = raw.maker;
    if (isNum(raw.discount_pct)) d.discount_pct = raw.discount_pct;
  }
  draft = d;
  return d;
}

function sanitizeSelection(c: Catalog, kt: KitType, s: unknown): Selection {
  const sel = (s && typeof s === "object" ? s : {}) as Partial<Selection>;
  const base: Selection = {
    slots: sel.slots && typeof sel.slots === "object" ? { ...sel.slots } : {},
    choices: sel.choices && typeof sel.choices === "object" ? { ...sel.choices } : {},
    accessories: Array.isArray(sel.accessories) ? sel.accessories.filter((a) => a && typeof a.id === "string") : [],
  };
  let out = reconcileSelection(c, kt.id, base);
  if (validateSelection(c, { kit_type: kt.id, selection: out }).length) out = reconcileSelection(c, kt.id, defaultSelection(kt));
  return out;
}

export function saveDraft(): void {
  local.setJson(KEYS.draft, draft);
  local.set(KEYS.manager, draft.manager);
}

export function resetDraft(): Draft {
  const keep = { manager: draft.manager, maker: draft.maker };
  draft = { ...empty(), ...keep };
  saveDraft();
  return draft;
}

export function startKit(kitTypeId: string): void {
  const { catalog } = ctx();
  const kt = kitTypeById(catalog, kitTypeId);
  if (!kt) return;
  draft.kit_type = kt.id;
  draft.preset_id = null;
  draft.selection = reconcileSelection(catalog, kt.id, defaultSelection(kt));
  draft.manual_prices = {};
  draft.kit_price_uah = null;
  draft.discount_pct = 0;
  draft.step = 2;
  saveDraft();
}

export function startPreset(presetId: string): void {
  const { catalog } = ctx();
  const p = presetById(catalog, presetId);
  const kt = p ? kitTypeById(catalog, p.kit_type) : undefined;
  if (!p || !kt) return;
  draft.kit_type = kt.id;
  draft.preset_id = p.id;
  draft.selection = reconcileSelection(catalog, kt.id, presetSelection(p, catalog));
  draft.manual_prices = {};
  draft.kit_price_uah = null;
  draft.discount_pct = 0;
  draft.step = 2;
  saveDraft();
}

/** Manual prices only for the items that are in the kit now. */
function activeManual(c: Catalog, kt: KitType): Record<string, number> {
  const ids = new Set(selectedItems(c, kt, draft.selection).map((x) => x.item.id));
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(draft.manual_prices)) if (ids.has(id)) out[id] = v;
  return out;
}

export function quoteInput(): QuoteInput | null {
  const { catalog } = ctx();
  const kt = draft.kit_type ? kitTypeById(catalog, draft.kit_type) : undefined;
  if (!kt) return null;
  const input: QuoteInput = { kit_type: kt.id, selection: draft.selection, date: todayIso() };
  if (draft.discount_pct > 0) input.discount_pct = draft.discount_pct;
  if (kt.price_display === "itemized") {
    const m = activeManual(catalog, kt);
    if (Object.keys(m).length) input.manual_prices = m;
  } else if (draft.kit_price_uah !== null) input.kit_price_uah = draft.kit_price_uah;
  return input;
}

export interface Preview {
  input: QuoteInput | null;
  quote: Quote | null;
  errors: string[];         // invalid selection or discount
  blockers: string[];       // why the KP_2_v3 generator cannot build this KP
}

/** Live quote in the browser (core), same rules as the server. */
export function preview(): Preview {
  const input = quoteInput();
  if (!input) return { input: null, quote: null, errors: [], blockers: [] };
  const { catalog, settings, rate } = ctx();
  try {
    const q = quote(catalog, settings, rate, input);
    return { input, quote: q, errors: [], blockers: kpBlockers(catalog, q) };
  } catch (e) {
    if (e instanceof QuoteError) return { input, quote: null, errors: e.errors, blockers: [] };
    return { input, quote: null, errors: [e instanceof Error ? e.message : String(e)], blockers: [] };
  }
}

/** Load a stored quote input into the configurator (journal → «Відкрити в конфігураторі»). */
export function loadInput(input: QuoteInput, client?: { name: string; contact?: string }, maker?: string | null): boolean {
  const { catalog } = ctx();
  const kt = kitTypeById(catalog, input.kit_type);
  if (!kt) return false;
  draft.kit_type = kt.id;
  draft.preset_id = null;
  draft.selection = sanitizeSelection(catalog, kt, input.selection);
  draft.manual_prices = { ...(input.manual_prices ?? {}) };
  draft.kit_price_uah = typeof input.kit_price_uah === "number" ? input.kit_price_uah : null;
  draft.discount_pct = input.discount_pct ?? 0;
  if (client) draft.client = { name: client.name ?? "", contact: client.contact ?? "" };
  if (maker && catalog.companies.some((x) => x.id === maker)) draft.maker = maker;
  draft.step = 5;
  saveDraft();
  return true;
}
