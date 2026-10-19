// /api routes without KP generation: health, catalog, settings, rate, quote, body validation.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ADMIN, ROOT, call, kit720, npl750, startTest } from "./helpers.js";
import type { TestServer } from "./helpers.js";

let t: TestServer;
before(async () => { t = await startTest(); });
after(async () => { await t.close(); });

const defaults = () => JSON.parse(readFileSync(join(ROOT, "catalog", "settings.default.json"), "utf8"));

test("GET /api/health", async () => {
  const r = await call(t, "GET", "/api/health");
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.match(r.json.version, /^\d+\.\d+\.\d+/);
  assert.equal(r.json.catalog_version, t.srv.ctx.catalog.version);
  assert.equal(r.json.auth_required, false);
  assert.equal(r.json.settings_editable, true);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.match(r.headers.get("content-type")!, /^application\/json; charset=utf-8/);
});

test("GET /api/catalog with ETag revalidation", async () => {
  const r = await call(t, "GET", "/api/catalog");
  assert.equal(r.status, 200);
  const file = JSON.parse(readFileSync(join(ROOT, "catalog", "catalog.json"), "utf8"));
  assert.deepEqual(r.json, file);
  const etag = r.headers.get("etag")!;
  assert.ok(etag);
  const again = await call(t, "GET", "/api/catalog", undefined, { "if-none-match": etag });
  assert.equal(again.status, 304);
  assert.equal(again.text, "");
});

test("GET /api/settings returns the defaults until PUT", async () => {
  const r = await call(t, "GET", "/api/settings");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, defaults());
});

test("PUT /api/settings: admin token, validation, persisted in KP_DATA_DIR/settings.json", async () => {
  const s = defaults();
  s.rounding_uah = 100;
  s.groups.bmf_cranes.markup_pct = 3;
  assert.equal((await call(t, "PUT", "/api/settings", s)).status, 401);
  const wrong = await call(t, "PUT", "/api/settings", s, { "x-admin-token": "nope" });
  assert.equal(wrong.status, 403);
  assert.match(wrong.json.error, /токен адміністратора/);

  const ok = await call(t, "PUT", "/api/settings", s, { "x-admin-token": ADMIN });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.rounding_uah, 100);
  assert.deepEqual((await call(t, "GET", "/api/settings")).json, s);
  assert.deepEqual(JSON.parse(readFileSync(join(t.dataDir, "settings.json"), "utf8")), s);

  const viaBearer = await call(t, "PUT", "/api/settings", defaults(), { authorization: `Bearer ${ADMIN}` });
  assert.equal(viaBearer.status, 200);

  const bad = { ...defaults(), vat_pct: "20", company_maker: "ghost", extra: 1 };
  const r = await call(t, "PUT", "/api/settings", bad, { "x-admin-token": ADMIN });
  assert.equal(r.status, 400);
  assert.ok(Array.isArray(r.json.errors));
  assert.match(r.json.errors.join(" "), /Невідоме поле налаштувань «extra»/);

  const r2 = await call(t, "PUT", "/api/settings", { ...defaults(), vat_pct: "20", company_maker: "ghost" }, { "x-admin-token": ADMIN });
  assert.equal(r2.status, 400);
  assert.match(r2.json.errors.join(" "), /vat_pct/);
  assert.match(r2.json.errors.join(" "), /невідома компанія «ghost»/);

  const partial = await call(t, "PUT", "/api/settings", { vat_pct: 20 }, { "x-admin-token": ADMIN });
  assert.equal(partial.status, 400);
  assert.match(partial.json.errors.join(" "), /бракує/);
  assert.deepEqual((await call(t, "GET", "/api/settings")).json, defaults());
});

test("GET /api/rate from the fake NBU endpoint", async () => {
  const r = await call(t, "GET", "/api/rate");
  assert.equal(r.status, 200);
  assert.equal(r.json.eur, 47.5);
  assert.equal(r.json.source, "nbu");
  assert.equal(r.json.date, "2026-10-18");
  assert.ok(r.json.fetched_at);
  assert.ok(existsSync(join(t.dataDir, "rates.json")));
});

test("POST /api/quote: server-side prices, rate and reference rates applied", async () => {
  const r = await call(t, "POST", "/api/quote", npl750);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.price_display, "bundle");
  assert.equal(r.json.total_uah, 1978000);         // current rate = reference rate: the KP price as printed
  assert.equal(r.json.eur_rate, 47.5);
  assert.equal(r.json.eur_rate_source, "nbu");
  assert.equal(r.json.eur_applied, true);
  assert.equal(r.json.date, t.srv.ctx.today());
  assert.ok(r.json.rows.every((x: { price_text: string }) => x.price_text === "у комплекті"));

  t.nbu.rate = 50;                                 // the cache keeps 47.5 for 6 h
  assert.equal((await call(t, "POST", "/api/quote", npl750)).json.eur_rate, 47.5);
  t.nbu.rate = 47.5;

  const dated = await call(t, "POST", "/api/quote", { ...kit720, date: "2025-08-24" });
  assert.equal(dated.status, 200);
  assert.equal(dated.json.date, "2025-08-24");
  assert.equal(dated.json.total_uah, 686000 + 155000);
});

test("POST /api/quote ignores client prices outside the input shape", async () => {
  const r = await call(t, "POST", "/api/quote", { ...kit720, total_uah: 1, rows: [{ price_uah: 1 }], date: "2025-08-24" });
  assert.equal(r.status, 200);
  assert.equal(r.json.total_uah, 841000);
});

test("POST /api/quote: invalid selection -> 400 {error, errors}", async () => {
  const r = await call(t, "POST", "/api/quote", { kit_type: "npl_crane", selection: { slots: { trailer: "npl10", crane: "bmf905" }, choices: {}, accessories: [] } });
  assert.equal(r.status, 400);
  assert.ok(r.json.error);
  assert.ok(r.json.errors.length >= 1);
  assert.match(r.json.errors.join(" "), /BMF 905|не можна обрати/);

  const unknownKit = await call(t, "POST", "/api/quote", { kit_type: "ghost", selection: {} });
  assert.equal(unknownKit.status, 400);
  assert.match(unknownKit.json.errors[0], /Невідомий тип комплекту/);

  const discount = await call(t, "POST", "/api/quote", { ...kit720, discount_pct: 7 });
  assert.equal(discount.status, 400);
  assert.match(discount.json.errors.join(" "), /перевищує дозволену/);

  const notObj = await call(t, "POST", "/api/quote", [1, 2]);
  assert.equal(notObj.status, 400);
});

test("manual prices: only for selected items, at most max_discount_pct below the computed total unless admin", async () => {
  const base = { ...kit720, date: "2025-08-24" };          // 686 000 + 155 000 = 841 000
  const notInKit = await call(t, "POST", "/api/quote", { ...base, manual_prices: { seat: 1000 } });
  assert.equal(notInKit.status, 400);
  assert.match(notInKit.json.errors[0], /немає в комплекті/);

  const tooLow = await call(t, "POST", "/api/quote", { ...base, manual_prices: { bmf720: 600000 } });
  assert.equal(tooLow.status, 400);
  assert.match(tooLow.json.errors[0], /нижча за розрахункову/);

  const admin = await call(t, "POST", "/api/quote", { ...base, manual_prices: { bmf720: 600000 } }, { "x-admin-token": ADMIN });
  assert.equal(admin.status, 200);
  assert.equal(admin.json.total_uah, 755000);

  const within = await call(t, "POST", "/api/quote", { ...base, manual_prices: { bmf720: 660000 } });
  assert.equal(within.status, 200);
  assert.equal(within.json.total_uah, 815000);

  const combined = await call(t, "POST", "/api/quote", { ...base, manual_prices: { bmf720: 660000 }, discount_pct: 5 });
  assert.equal(combined.status, 400, "a manual price and the full discount together exceed the limit");

  const higher = await call(t, "POST", "/api/quote", { ...base, manual_prices: { bmf720: 700000 }, discount_pct: 5 });
  assert.equal(higher.status, 200);

  // a position without a catalog price: the manual price fills the gap
  const pump = await call(t, "POST", "/api/quote", { kit_type: "crane_kit", date: "2025-08-24",
    selection: { slots: { crane: "bmf720", base: "base_outriggers_720", pump: "pump" }, choices: {}, accessories: [] }, manual_prices: { pump: 30000 } });
  assert.equal(pump.status, 200, pump.text);
  assert.equal(pump.json.total_uah, 871000);

  const bundleLow = await call(t, "POST", "/api/quote", { ...npl750, kit_price_uah: 1800000 });
  assert.equal(bundleLow.status, 400);
  const bundleOk = await call(t, "POST", "/api/quote", { ...npl750, kit_price_uah: 1900000 });
  assert.equal(bundleOk.status, 200);
  assert.equal(bundleOk.json.total_uah, 1900000);

  const accessory = await call(t, "POST", "/api/quote", { kit_type: "crane_kit", date: "2025-08-24",
    selection: { slots: { crane: "bmf720" }, choices: {}, accessories: [{ id: "rv_leg_fd", price_uah: 12000 }] } });
  assert.equal(accessory.status, 200, accessory.text);
  assert.equal(accessory.json.total_uah, 698000);

  const negative = await call(t, "POST", "/api/quote", { ...base, manual_prices: { bmf720: -1 } });
  assert.equal(negative.status, 400);
});

test("request bodies: invalid JSON, wrong content type, too large, prototype keys", async () => {
  const bad = await call(t, "POST", "/api/quote", "{not json", { "content-type": "application/json" });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, "Невірний JSON у тілі запиту.");

  const form = await call(t, "POST", "/api/quote", "kit_type=x", { "content-type": "application/x-www-form-urlencoded" });
  assert.equal(form.status, 415);

  const empty = await call(t, "POST", "/api/quote", "", { "content-type": "application/json" });
  assert.equal(empty.status, 400);

  const big = await call(t, "POST", "/api/quote", JSON.stringify({ pad: "x".repeat(300 * 1024) }));
  assert.equal(big.status, 413);

  const proto = await call(t, "POST", "/api/quote", '{"__proto__": {"polluted": 1}, "kit_type": "crane_kit", "selection": {"slots": {"crane": "bmf720"}, "choices": {}, "accessories": []}}');
  assert.equal(proto.status, 200);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);

  const badUtf8 = await fetch(t.url + "/api/quote", { method: "POST", headers: { "content-type": "application/json" }, body: Buffer.from([0x7b, 0xff, 0x7d]) });
  assert.equal(badUtf8.status, 400);
});

test("unknown API paths and methods are JSON errors without internals", async () => {
  const r = await call(t, "GET", "/api/nope");
  assert.equal(r.status, 404);
  assert.equal(r.json.error, "Невідомий шлях API.");
  const m = await call(t, "DELETE", "/api/settings");
  assert.equal(m.status, 405);
  assert.equal(m.headers.get("allow"), "GET, HEAD, PUT");
  const q = await call(t, "GET", "/api/quote");
  assert.equal(q.status, 405);
  const lim = await call(t, "GET", "/api/kp?limit=abc");
  assert.equal(lim.status, 400);
  assert.doesNotMatch(lim.text, /at .*\.js|stack/i);
  const head = await fetch(t.url + "/api/health", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

test("security headers on API, static and error responses", async () => {
  for (const path of ["/api/health", "/", "/api/nope", "/media/bmf/650_b.jpg"]) {
    const r = await fetch(t.url + path);
    await r.arrayBuffer();
    const csp = r.headers.get("content-security-policy") ?? "";
    assert.match(csp, /default-src 'self'/, path);
    assert.match(csp, /img-src 'self' data: blob:/, path);
    assert.match(csp, /frame-ancestors 'none'/, path);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff", path);
    assert.equal(r.headers.get("referrer-policy"), "no-referrer", path);
  }
});
