import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NBSP, addDays, fillTemplate, formatDate, formatDecimal, formatInt, formatNumber, formatPct, formatRate, formatUah,
  isIsoDate, joinUk, roundTo, todayIso,
} from "../src/index.js";

const NB = " ";

test("money: no-break spaces between thousands and before ₴", () => {
  assert.equal(NBSP, NB);
  assert.equal(formatUah(1978000), `1${NB}978${NB}000${NB}₴`);
  assert.equal(formatUah(59140), `59${NB}140${NB}₴`);
  assert.equal(formatUah(950), `950${NB}₴`);
  assert.equal(formatUah(0), `0${NB}₴`);
  assert.equal(formatInt(-1234567.4), `-1${NB}234${NB}567`);
  assert.equal(formatInt(999.5), `1${NB}000`);
  assert.doesNotMatch(formatUah(1863792), / /);   // never a plain space
});

test("decimals, rates and percentages use a comma", () => {
  assert.equal(formatDecimal(48.1, 2), "48,10");
  assert.equal(formatDecimal(12345.678, 1), `12${NB}345,7`);
  assert.equal(formatDecimal(-0.001, 2), "0,00");
  assert.equal(formatNumber(2.5), "2,5");
  assert.equal(formatNumber(3), "3");
  assert.equal(formatNumber(0.24, 2), "0,24");
  assert.equal(formatRate(48.1), `48,10${NB}₴`);
  assert.equal(formatPct(5), `5${NB}%`);
  assert.equal(formatPct(5.5), `5,5${NB}%`);
});

test("dates: ISO in, dd.mm.yyyy out", () => {
  assert.equal(formatDate("2026-10-18"), "18.10.2026");
  assert.equal(formatDate(""), "");
  assert.equal(formatDate(null), "");
  assert.equal(formatDate("2026-02-30"), "");
  assert.ok(isIsoDate("2024-02-29"));
  assert.ok(!isIsoDate("2025-02-29"));
  assert.ok(!isIsoDate("18.10.2026"));
  assert.ok(!isIsoDate(20261018));
  assert.equal(addDays("2026-10-18", 7), "2026-10-25");
  assert.equal(addDays("2026-12-28", 7), "2027-01-04");
  assert.equal(addDays("2026-03-27", 3), "2026-03-30");   // across the DST switch
  assert.equal(addDays("2026-10-18", 0), "2026-10-18");
  assert.throws(() => addDays("18.10.2026", 1));
  assert.equal(todayIso(new Date(2026, 9, 18, 23, 59)), "2026-10-18");
});

test("joinUk, roundTo, fillTemplate", () => {
  assert.equal(joinUk([]), "");
  assert.equal(joinUk(["C20"]), "C20");
  assert.equal(joinUk(["C20", "C24", "C27"]), "C20, C24 або C27");
  assert.equal(joinUk(["BMF 650", "BMF 720"], "і"), "BMF 650 і BMF 720");
  assert.equal(roundTo(798974, 50), 798950);
  assert.equal(roundTo(798975, 50), 799000);
  assert.equal(roundTo(1234.5, 0), 1235);
  assert.equal(roundTo(1234.4, -1), 1234);
  assert.equal(roundTo(67999.93, 50), 68000);
  assert.equal(fillTemplate("Виробник: {maker}", { maker: "ТОВ «ГІДМАН»" }), "Виробник: ТОВ «ГІДМАН»");
  assert.equal(fillTemplate("{a} · {b}", { a: "10 т" }), "10 т · {b}");
});
