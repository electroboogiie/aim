// Shapes shared by catalog/, core/, server/, web/ and the generator input (docs/CONTRACTS.md §2–§5).
// Optional fields not named in the original contract are documented in CONTRACTS.md §2.2 and §4.1.

export interface Catalog {
  version: string;
  companies: Company[];
  items: Item[];
  kit_types: KitType[];
  presets: Preset[];
  accessories: Accessory[];
  bundles: Bundle[];
  texts: { terms: Term[]; advantages: string[]; notes: Record<string, string> };
}

export interface Company {
  id: string;
  name: string;
  short: string;
  address: string;
  phones: string[];
  email: string;
  sites: string[];
  role: "maker" | "distributor" | "both";
  socials?: string[];
  source?: string;
  needs_confirmation?: string[];
}

export type ItemKind = "crane" | "trailer" | "component" | "service";

export interface Item {
  id: string;
  kind: ItemKind;
  family: string;
  title: string;
  short: string;
  model?: string;                       // short model name for KP titles: "BMF 750", "НПЛ-10"
  desc_template?: string;               // row text with {choice_id} placeholders (option short/title)
  includes?: string[];
  specs?: Record<string, string | number>;
  price: PriceRule;
  photo?: string;
  kp_profile?: string | null;
  compatible?: string[];                // item ids this item fits (e.g. a base or trailer -> crane ids)
  source: string;
  needs_confirmation?: string[];
}

export interface PriceEur { mode: "eur"; eur: number; group: string }
export interface PriceCost {
  mode: "cost";
  metal: { grade: string; kg: number }[];
  components_eur?: number;
  hours?: number;
  paint_uah?: number;
  group: string;
}
export interface RefPoint {
  uah: number;
  date: string;
  eur_rate_ref?: number | null;
  metal_index_ref?: number | null;
  source?: string;
}
export interface PriceRef extends RefPoint {
  mode: "ref";
  eur_share: number;
  metal_share: number;
  group: string;
  history?: RefPoint[];                 // older reference points from earlier KPs
}
export interface PriceOnRequest { mode: "on_request" }
export interface PriceIncluded { mode: "included" }
export type PriceRule = PriceEur | PriceCost | PriceRef | PriceOnRequest | PriceIncluded;

export interface KitType {
  id: string;
  title: string;
  price_display: "itemized" | "bundle";
  slots: Slot[];
  choices: Choice[];
  accessory_groups: string[];
  generator: "kp_v3";
  title_slots?: string[];               // slots whose item models form the KP title, joined by " + "
  terms?: string[];                     // Term ids printed on the KP by default
  maker_line?: string;                  // "Виробник: {maker}"
}

export interface Slot { id: string; title: string; candidates: string[]; required: boolean; default: string | null }

export interface ChoiceOption {
  value: string;
  title: string;
  price_uah?: number;
  short?: string;                       // text for Item.desc_template
  on_request?: boolean;                 // surcharge not known yet: selecting it adds a warning
}
export interface Choice { id: string; title: string; default: string; options: ChoiceOption[] }

export interface PresetSourceRow { title: string; price_uah: number }
export interface Preset {
  id: string;
  title: string;
  kit_type: string;
  selection: Selection;
  archived?: boolean;                   // a newer preset has the same selection
  source: {
    file: string;
    date: string;                       // ISO date or "" when the KP has none
    total_uah: number | null;
    vat_included?: boolean;             // false: total_uah is printed without VAT
    rows?: PresetSourceRow[];           // price rows as printed in the KP
    note?: string;
  };
}

export interface AccessoryVariant {
  id: string;
  title: string;
  desc?: string;
  photo?: string;
  photo_url?: string;
  compatible?: string[];
  needs_confirmation?: string[];
}

export interface Accessory {
  id: string;
  group: "crane" | "trailer";
  title: string;
  desc: string;
  photo: string;
  price: PriceRule;
  compatible?: string[];
  compatible_unconfirmed?: string[];    // offered with these items too, with a warning
  variants?: AccessoryVariant[];
  origin?: string;
  photo_url?: string;
  notes?: string;
  needs_confirmation?: string[];
  source: string;
}

export interface Term { id: string; title: string; text: string }

export interface Bundle {
  id: string;
  kit_type: string;
  slots: Record<string, string>;
  price: PriceRule;
  source: string;
  needs_confirmation?: string[];
}

export interface Settings {
  eur: { mode: "nbu" | "manual"; manual_rate: number | null; buffer_pct: number };
  metal: { index_uah_per_kg: number | null; ref_index_uah_per_kg: number | null; grades: Record<string, number> };
  labor_rate_uah: number | null;
  groups: Record<string, { markup_pct: number; logistics_pct: number }>;
  vat_pct: number;
  rounding_uah: number;
  validity_days: number;
  max_discount_pct: number;
  company_maker: string;
  kp_number_prefix: string;
}

export interface SelectionAccessory { id: string; variant?: string | null; price_uah?: number | null }
export interface Selection {
  slots: Record<string, string | null>;
  choices: Record<string, string>;
  accessories: SelectionAccessory[];
}

export interface QuoteInput {
  kit_type: string;
  selection: Selection;
  discount_pct?: number;
  manual_prices?: Record<string, number>;
  kit_price_uah?: number | null;        // bundle kits: manual kit price, overrides bundle / sum
  date?: string;
}

/** Current EUR rate as the server knows it (GET /api/rate) plus optional rates for reference dates. */
export interface RateInfo {
  eur: number | null;
  date?: string | null;
  source: string;                       // "nbu" | "manual" | "cache" | "none"
  fetched_at?: string | null;
  ref_rates?: Record<string, number>;   // ISO date -> rate, used when a reference point has no eur_rate_ref
}

export interface QuoteRow {
  no: number;
  item_id: string;
  title: string;
  desc: string;
  qty: number;
  price_uah: number | null;
  price_text: string;
  breakdown: string;
  kind?: string;
  slot?: string;
  group?: string;
  photo?: string;
  variant?: string;
}

export interface QuoteChoice { id: string; title: string; value: string; value_title: string; price_uah: number }

export interface Quote {
  kit_type: string;
  rows: QuoteRow[];
  choices: QuoteChoice[];
  accessories: QuoteRow[];
  subtotal_uah: number;
  discount_pct: number;
  total_uah: number;
  eur_rate: number | null;
  eur_rate_source: string;
  date: string;
  valid_until: string;
  warnings: string[];
  price_display: "itemized" | "bundle";
  kit_price_uah?: number | null;        // bundle kits: price of the kit before choices and accessories
  bundle_id?: string | null;
  kit_breakdown?: string;               // how the kit price was found (bundle, manual or sum of items)
  complete?: boolean;                   // false: some price is missing, the total is partial
  eur_applied?: boolean;                // the current EUR rate entered at least one counted price
}

export interface KpSpecRow {
  no: number;
  title: string;
  desc: string;
  qty: number;
  price_text: string;
  item_id?: string;
  kind?: string;
  photo?: string;
}

export interface KpSpec {
  template: "kp_v3";
  number: string;
  date: string;
  valid_until: string;
  client: { name: string; contact?: string };
  kit_type: string;
  title: string;
  crane: { id: string; model: string; profile: string; specs: Record<string, string>; lead?: string; lead2?: string } | null;
  npl: { brakes: string; wheels: string; stakes: string } | null;
  rows: KpSpecRow[];
  accessories: { group: string; title: string; desc: string; photo: string; price_text: string }[];
  total_text: string;
  price_note: string;
  maker: { name: string; line: string };
  contacts: { phones: string[]; email: string; sites: string[]; address: string; socials?: string[] };
  terms: { title: string; text: string }[];
  photos?: { cover?: string; end?: string; cover_focus?: [number, number]; end_focus?: [number, number] };
  price_date?: string;
  cover_text?: string;
  upgrade_chips?: string[];
  price_tags?: string[];
  accessories_note?: string;
  file?: string;
}

/** What buildKpSpec needs besides the quote (POST /api/kp body + the number the server assigns). */
export interface KpMeta {
  number: string;
  client: { name: string; contact?: string };
  maker?: string;                       // Company id; default settings.company_maker
  terms?: (string | { title: string; text: string })[];   // Term ids or literal terms; default KitType.terms
  photos?: KpSpec["photos"];
  accessories_note?: string;
  cover_text?: string;
  file?: string;
}
