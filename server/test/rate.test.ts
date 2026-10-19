// RateService: NBU parsing, 6 h cache, offline -> last cached value, manual rate, reference-date rates.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Settings } from "../../core/src/index.js";
import { HOUR, RateService, nbuUrlForDate, parseNbu } from "../src/rate.js";
import { NBU_PATH, ROOT, call, fakeNbu, npl750, startTest } from "./helpers.js";
import type { FakeNbu } from "./helpers.js";

const settings = (): Settings => JSON.parse(readFileSync(join(ROOT, "catalog", "settings.default.json"), "utf8"));
let nbu: FakeNbu;
let dir: string;
before(async () => { nbu = await fakeNbu(48.1, 45); dir = mkdtempSync(join(tmpdir(), "kp-rate-")); });
after(async () => { await nbu.close(); rmSync(dir, { recursive: true, force: true }); });

function service(file: string, clock: { now: Date }) {
  return new RateService({ url: nbu.url, file, now: () => clock.now, retryMs: 60_000, refRetryMs: 60_000 });
}

test("parseNbu and the date URL", () => {
  assert.deepEqual(parseNbu([{ r030: 978, txt: "Євро", rate: 48.0911, cc: "EUR", exchangedate: "17.10.2026" }]), { eur: 48.0911, date: "2026-10-17" });
  assert.deepEqual(parseNbu([{ cc: "USD", rate: 41 }, { cc: "EUR", rate: "47.2", exchangedate: "01.02.2026" }]), { eur: 47.2, date: "2026-02-01" });
  assert.throws(() => parseNbu({}), /не є списком/);
  assert.throws(() => parseNbu([]), /немає курсу EUR/);
  assert.throws(() => parseNbu([{ cc: "EUR", rate: -1, exchangedate: "01.02.2026" }]), /невірний курс/);
  assert.throws(() => parseNbu([{ cc: "EUR", rate: 47, exchangedate: "2026-02-01" }]), /невірна дата/);
  assert.equal(nbuUrlForDate("https://x/exchange?valcode=EUR&json", "2026-03-04"), "https://x/exchange?valcode=EUR&json&date=20260304");
  assert.equal(nbuUrlForDate("https://x/exchange?date=20200101&valcode=EUR", "2026-03-04"), "https://x/exchange?date=20260304&valcode=EUR");
  assert.equal(nbuUrlForDate("https://x/eur", "2026-03-04"), "https://x/eur?date=20260304");
});

test("cache: 6 h within the same day, then a new fetch; offline keeps the last value; never throws", async () => {
  const clock = { now: new Date(2026, 9, 18, 9, 0) };
  const file = join(dir, "a.json");
  const s = service(file, clock);
  nbu.requests.length = 0;
  const r1 = await s.current(settings());
  assert.deepEqual([r1.eur, r1.source, r1.date], [48.1, "nbu", "2026-10-18"]);
  assert.equal(r1.fetched_at, clock.now.toISOString());
  assert.equal(nbu.requests.length, 1);
  assert.equal(nbu.requests[0], NBU_PATH);

  clock.now = new Date(2026, 9, 18, 14, 59);
  nbu.rate = 49;
  assert.equal((await s.current(settings())).eur, 48.1, "cached within 6 h");
  assert.equal(nbu.requests.length, 1);

  clock.now = new Date(2026, 9, 18, 15, 1);
  assert.equal((await s.current(settings())).eur, 49, "refreshed after 6 h");
  assert.equal(nbu.requests.length, 2);

  clock.now = new Date(2026, 9, 19, 0, 30);
  nbu.rate = 49.5;
  assert.equal((await s.current(settings())).eur, 49.5, "a new day refreshes at once");

  clock.now = new Date(2026, 9, 19, 8, 0);
  nbu.fail = true;
  const off = await s.current(settings());
  assert.deepEqual([off.eur, off.source, off.stale], [49.5, "cache", true]);
  assert.match(off.message!, /недоступний/);
  const n = nbu.requests.length;
  await s.current(settings());
  assert.equal(nbu.requests.length, n, "no retry within retryMs");
  nbu.fail = false;

  const fromDisk = service(file, { now: new Date(2026, 9, 19, 8, 30) });
  const d = await fromDisk.current(settings());
  assert.equal(d.eur, 49.5);
  assert.equal(d.source, "nbu", "a fresh value from the cache file");

  nbu.body = "<html>maintenance</html>";
  const bad = await service(join(dir, "b.json"), { now: new Date() }).current(settings());
  assert.deepEqual([bad.eur, bad.source], [null, "none"]);
  nbu.body = null;
});

test("unreachable NBU without any cache: source none; manual mode needs no network", async () => {
  const s = new RateService({ url: "http://127.0.0.1:1/x", file: join(dir, "c.json"), timeoutMs: 2000 });
  const r = await s.current(settings());
  assert.deepEqual([r.eur, r.source, r.fetched_at], [null, "none", null]);
  const manual = settings();
  manual.eur = { mode: "manual", manual_rate: 51.2, buffer_pct: 0 };
  const m = await s.current(manual);
  assert.deepEqual([m.eur, m.source], [51.2, "manual"]);
  assert.deepEqual(await s.refRates(["2026-01-14"]), {});
  writeFileSync(join(dir, "d.json"), "{broken");
  const broken = new RateService({ url: "http://127.0.0.1:1/x", file: join(dir, "d.json"), timeoutMs: 500 });
  assert.equal((await broken.current(settings())).source, "none");
});

test("reference-date rates come from the NBU archive once and stay in the cache file", async () => {
  const clock = { now: new Date(2026, 9, 18, 9, 0) };
  const file = join(dir, "e.json");
  const s = service(file, clock);
  nbu.requests.length = 0;
  const ref = await s.refRates(["2026-01-14", "2026-05-18", "2030-01-01"]);
  assert.deepEqual(ref, { "2026-01-14": 45, "2026-05-18": 45 });
  assert.ok(nbu.requests.some((u) => u.endsWith("&date=20260114")));
  assert.ok(!nbu.requests.some((u) => u.includes("20300101")), "future dates are not asked");
  const before = nbu.requests.length;
  await s.refRates(["2026-01-14", "2026-05-18"]);
  assert.equal(nbu.requests.length, before);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).ref, { "2026-01-14": 45, "2026-05-18": 45 });

  nbu.fail = true;
  const s2 = service(join(dir, "f.json"), clock);
  assert.deepEqual(await s2.refRates(["2026-01-14"]), {});
  const n = nbu.requests.length;
  assert.deepEqual(await s2.refRates(["2026-01-14"]), {});
  assert.equal(nbu.requests.length, n, "failed reference dates are retried later, not on every quote");
  nbu.fail = false;
  clock.now = new Date(clock.now.getTime() + 2 * HOUR);
  assert.deepEqual(await s2.refRates(["2026-01-14"]), { "2026-01-14": 45 });
});

test("quotes use the reference rates: current 48.10 vs 45.00 raises EUR-bound prices", async () => {
  const t = await startTest({ nbu });
  try {
    const q = (await call(t, "POST", "/api/quote", npl750)).json;
    assert.equal(q.eur_rate, 48.1);
    assert.equal(q.eur_applied, true);
    // bundle НПЛ-10 + BMF 750: 1 978 000 × (1 + 0.6 × (48.1 / 45 − 1)), rounded to 50
    assert.equal(q.total_uah, Math.round(1978000 * (1 + 0.6 * (48.1 / 45 - 1)) / 50) * 50);
    const rate = (await call(t, "GET", "/api/rate")).json;
    assert.deepEqual(Object.keys(rate).sort(), ["date", "eur", "fetched_at", "source"]);
    assert.ok(existsSync(join(t.dataDir, "rates.json")));
  } finally {
    await t.close();
  }
});
