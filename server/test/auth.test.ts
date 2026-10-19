// KP_ACCESS_TOKEN (bearer for /api except /api/health) and KP_ADMIN_TOKEN (PUT /api/settings).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { ADMIN, ROOT, call, makeKp, npl750, startTest } from "./helpers.js";

const settings = () => JSON.parse(readFileSync(join(ROOT, "catalog", "settings.default.json"), "utf8"));
const ACCESS = "access-token-for-managers";

test("with KP_ACCESS_TOKEN every /api call except health needs the bearer token", async () => {
  const t = await startTest({ config: { accessToken: ACCESS } });
  try {
    const h = await call(t, "GET", "/api/health");
    assert.equal(h.status, 200);
    assert.equal(h.json.auth_required, true);
    for (const [m, p, body] of [["GET", "/api/catalog"], ["GET", "/api/settings"], ["GET", "/api/rate"], ["POST", "/api/quote", npl750],
      ["GET", "/api/kp"], ["POST", "/api/kp", { quote_input: npl750, client: { name: "A" } }], ["GET", "/api/nope"]] as [string, string, unknown?][]) {
      const r = await call(t, m, p, body);
      assert.equal(r.status, 401, `${m} ${p}`);
      assert.match(r.json.error, /токен доступу/);
      assert.equal(r.headers.get("www-authenticate"), 'Bearer realm="kp"');
      const wrong = await call(t, m, p, body, { authorization: "Bearer wrong" });
      assert.equal(wrong.status, 401, `${m} ${p} wrong token`);
      assert.equal(wrong.json.error, "Невірний токен доступу.");
    }
    const ok = await call(t, "GET", "/api/catalog", undefined, { authorization: `Bearer ${ACCESS}` });
    assert.equal(ok.status, 200);
    assert.equal((await call(t, "GET", "/api/rate", undefined, { authorization: `bearer ${ACCESS}` })).status, 200);
    assert.equal((await call(t, "GET", "/api/settings", undefined, { authorization: `Bearer ${ADMIN}` })).status, 200, "admin token works as access");
    assert.equal((await call(t, "GET", "/api/settings", undefined, { "x-admin-token": ADMIN })).status, 200);

    const k = await makeKp(t, { quote_input: npl750, client: { name: "З токеном" } }, { authorization: `Bearer ${ACCESS}` });
    assert.equal(k.status, "ready");
    assert.equal((await call(t, "GET", k.files.pdf.url)).status, 401, "downloads need the token too");
    assert.equal((await call(t, "GET", k.files.pdf.url, undefined, { authorization: `Bearer ${ACCESS}` })).status, 200);

    // static app and media stay public: the page must load to ask for the token
    assert.equal((await fetch(t.url + "/")).status, 200);
    assert.equal((await fetch(t.url + "/media/bmf/650_b.jpg")).status, 200);

    // settings: the access token is not enough
    const put = await call(t, "PUT", "/api/settings", settings(), { authorization: `Bearer ${ACCESS}` });
    assert.equal(put.status, 401);
    assert.match(put.json.error, /токен адміністратора/);
    const put2 = await call(t, "PUT", "/api/settings", settings(), { authorization: `Bearer ${ACCESS}`, "x-admin-token": ADMIN });
    assert.equal(put2.status, 200);
    const put3 = await call(t, "PUT", "/api/settings", settings(), { authorization: `Bearer ${ADMIN}` });
    assert.equal(put3.status, 200);
    const put4 = await call(t, "PUT", "/api/settings", settings(), { authorization: `Bearer ${ACCESS}`, "x-admin-token": "bad" });
    assert.equal(put4.status, 403);
  } finally {
    await t.close();
  }
});

test("without KP_ADMIN_TOKEN settings are read-only: PUT answers 403 with an explanation", async () => {
  const t = await startTest({ config: { adminToken: null } });
  try {
    assert.equal((await call(t, "GET", "/api/health")).json.settings_editable, false);
    assert.equal((await call(t, "GET", "/api/settings")).status, 200);
    const r = await call(t, "PUT", "/api/settings", settings(), { "x-admin-token": "anything" });
    assert.equal(r.status, 403);
    assert.match(r.json.error, /KP_ADMIN_TOKEN/);
    assert.match(r.json.error, /лише для читання/);
    // no admin: a manual price beyond the limit is refused for everyone
    const q = await call(t, "POST", "/api/quote", { ...npl750, kit_price_uah: 1000 }, { "x-admin-token": "anything" });
    assert.equal(q.status, 400);
  } finally {
    await t.close();
  }
});

test("config: empty token values count as unset, numbers are checked", () => {
  const c = loadConfig({ KP_ACCESS_TOKEN: "", KP_ADMIN_TOKEN: "  ", PORT: "9000", KP_DATA_DIR: "rel/data" });
  assert.equal(c.accessToken, null);
  assert.equal(c.adminToken, null);
  assert.equal(c.port, 9000);
  assert.equal(c.dataDir, join(process.cwd(), "rel", "data"));
  assert.equal(c.kpgenBuild, join(process.cwd(), "rel", "data", "kpgen-build"));
  assert.equal(c.python, "python3");
  assert.equal(c.generatorTimeoutS, 300);
  assert.throws(() => loadConfig({ PORT: "abc" }), /PORT/);
  assert.throws(() => loadConfig({ KP_GENERATOR_TIMEOUT_S: "0" }), /KP_GENERATOR_TIMEOUT_S/);
  assert.equal(loadConfig({ KPGEN_BUILD: "/x/build" }).kpgenBuild, "/x/build");
  assert.equal(loadConfig({}).catalogFile, join(ROOT, "catalog", "catalog.json"));
});
