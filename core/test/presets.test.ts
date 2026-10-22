// Presets from the user's KPs: quoting them at the KP date with the reference rate must give the KP total.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatUah, quote, refRateDates } from "../src/index.js";
import type { Preset, Quote, RateInfo } from "../src/index.js";
import { loadCatalog, loadSettings } from "./helpers.js";

const c = loadCatalog();
const s = loadSettings();

/** Presets that cannot reproduce the KP total from catalog prices, and why. */
const KNOWN_GAPS: Record<string, string> = {
  "bmf720_kit_2026-03-04": "KP prints base + operator seat as one row (169 270 UAH); catalog base 155 000 + seat 27 750 = 182 750.",
  "bmf720_kit_2024-10-09": "2024 KP prints only a total (776 000 UAH, oil 80 l); all catalog prices are 2025-2026, the earliest point is used.",
  "bmf650_kit_2026-03-17": "KP prints base + tank as one row (174 500 UAH); catalog base 160 000 + tank 18 500 = 178 500.",
  "bmf650_kit_2026-02-25": "KP prints base + tank + oil + pump + seat as one row (223 266 UAH); the pump has no price in the catalog.",
  "bmf720_kit_2025-08-07": "KP prints base + tank + oil 90 l + pump + seat as one row (213 100 UAH); the pump has no price in the catalog and the other parts are 2026 prices.",
  "bmf750_kit_2026-05-20": "KP row 242 525 UAH also contains a pump and a mounting kit, which have no catalog price.",
};

const known = c.presets.filter((p) => p.source.total_uah !== null && p.source.date !== "");
const expected = (p: Preset) => Math.round(p.source.total_uah! * (p.source.vat_included === false ? 1 + s.vat_pct / 100 : 1));
const run = (p: Preset, rate: RateInfo) => quote(c, s, rate, { kit_type: p.kit_type, selection: p.selection, date: p.source.date,
  ...(p.extras ? { extras: p.extras } : {}), ...(p.itemized ? { itemized: true } : {}), ...(p.quantities ? { quantities: p.quantities } : {}) });

const noRate: RateInfo = { eur: null, source: "none" };
const refDates = refRateDates(c);
// the current rate equals the rate of every reference date: every EUR ratio is exactly 1
const sameRate: RateInfo = { eur: 47.5, date: "2026-10-18", source: "nbu", ref_rates: Object.fromEntries(refDates.map((d) => [d, 47.5])) };

test("catalog has presets with known totals and the gap list names real presets", () => {
  assert.ok(known.length >= 20, String(known.length));
  for (const id of Object.keys(KNOWN_GAPS)) assert.ok(known.some((p) => p.id === id), id);
});

test("printed KP rows add up to the printed total", () => {
  for (const p of c.presets) {
    const rows = p.source.rows;
    if (!rows?.length || p.source.total_uah === null) continue;
    assert.equal(rows.reduce((a, r) => a + r.price_uah, 0), p.source.total_uah, p.id);
  }
});

for (const [name, rate] of [["no EUR rate", noRate], ["current rate = reference rate", sameRate]] as const) {
  test(`presets reproduce the KP total at the KP date (${name})`, (t) => {
    const ok: string[] = [];
    for (const p of known) {
      const q: Quote = run(p, rate);
      const want = expected(p);
      if (KNOWN_GAPS[p.id]) {
        assert.notEqual(q.total_uah, want, `${p.id} reproduces now: remove it from KNOWN_GAPS`);
        t.diagnostic(`gap ${p.id}: quote ${formatUah(q.total_uah)} vs KP ${formatUah(want)} - ${KNOWN_GAPS[p.id]}`);
        continue;
      }
      assert.equal(q.total_uah, want, `${p.id}: ${q.total_uah} != ${want}\n${q.warnings.join("\n")}`);
      // an option "за запитом" (e.g. pneumatic brakes) has no surcharge yet: the KP total holds, the quote says it is partial
      const onRequest = q.warnings.some((w) => w.startsWith("Доплату за"));
      assert.equal(q.complete, !onRequest, p.id);
      ok.push(p.id);
    }
    t.diagnostic(`reproduced ${ok.length} of ${known.length}: ${ok.join(", ")}`);
  });
}

test("the crane row of every itemized KP matches the crane price printed in that KP", () => {
  for (const p of known) {
    const printed = p.source.rows?.find((r) => r.title.startsWith("Гідравлічний кран-маніпулятор"));
    if (!printed) continue;
    const q = run(p, noRate);
    const row = q.rows.find((r) => r.slot === "crane");
    assert.equal(row?.price_uah, printed.price_uah, p.id);
  }
});

test("bundle presets use their bundle; archived presets repeat a newer one", () => {
  for (const p of known.filter((x) => x.kit_type === "npl_crane" || x.kit_type === "bmf_trailer_crane")) {
    assert.ok(run(p, noRate).bundle_id, p.id);
  }
  for (const p of c.presets.filter((x) => x.archived)) {
    const same = c.presets.filter((x) => !x.archived && x.kit_type === p.kit_type && JSON.stringify(x.selection) === JSON.stringify(p.selection));
    assert.ok(same.some((x) => x.source.date > p.source.date), p.id);
  }
});

test("presets without a printed total quote without errors", () => {
  for (const p of c.presets.filter((x) => x.source.total_uah === null)) {
    const q = quote(c, s, noRate, { kit_type: p.kit_type, selection: p.selection, date: p.source.date || "2026-10-18" });
    assert.equal(q.complete, false, p.id);
    assert.ok(q.warnings.length > 0, p.id);
  }
});
