// Static web app, SPA fallback, /media lookup order, content types, cache headers and path traversal attempts.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { parsePath } from "../src/http.js";
import { rawGet, startTest } from "./helpers.js";
import type { TestServer } from "./helpers.js";

let t: TestServer;
before(async () => {
  t = await startTest();
  symlinkSync(join(t.root, "outside.txt"), join(t.config.webDir, "link.txt"));
  symlinkSync("/etc/hostname", join(t.config.webDir, "media", "host.png"));
});
after(async () => { await t.close(); });

test("index, assets and content types", async () => {
  const cases: [string, string, string][] = [
    ["/", "text/html; charset=utf-8", "no-cache"],
    ["/index.html", "text/html; charset=utf-8", "no-cache"],
    ["/js/web/src/main.js", "text/javascript; charset=utf-8", "no-cache"],
    ["/styles.css", "text/css; charset=utf-8", "no-cache"],
    ["/sw.js", "text/javascript; charset=utf-8", "no-cache"],
    ["/manifest.webmanifest", "application/manifest+json; charset=utf-8", "no-cache"],
    ["/icons/icon-192.png", "image/png", "public, max-age=604800"],
  ];
  for (const [path, type, cache] of cases) {
    const r = await fetch(t.url + path);
    assert.equal(r.status, 200, path);
    assert.equal(r.headers.get("content-type"), type, path);
    assert.equal(r.headers.get("cache-control"), cache, path);
    assert.ok(r.headers.get("etag"), path);
    await r.arrayBuffer();
  }
  const r = await fetch(t.url + "/js/web/src/main.js");
  const etag = r.headers.get("etag")!;
  await r.arrayBuffer();
  const again = await fetch(t.url + "/js/web/src/main.js", { headers: { "if-none-match": etag } });
  assert.equal(again.status, 304);
  const head = await fetch(t.url + "/styles.css", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "7");
  assert.equal(await head.text(), "");
});

test("SPA fallback for client routes, 404 for missing files", async () => {
  for (const path of ["/journal", "/kp/123", "/settings/"]) {
    const r = await fetch(t.url + path);
    assert.equal(r.status, 200, path);
    assert.match(await r.text(), /Конструктор КП/, path);
  }
  const missing = await fetch(t.url + "/missing.js");
  assert.equal(missing.status, 404);
  assert.equal((await missing.json() as { error: string }).error, "Файл не знайдено.");
  const post = await fetch(t.url + "/", { method: "POST" });
  assert.equal(post.status, 405);
  await post.arrayBuffer();
});

test("/media: web/media first, then generator/assets, images only", async () => {
  const thumb = await fetch(t.url + "/media/bmf/650_a.jpg");
  assert.equal(thumb.status, 200);
  assert.equal(await thumb.text(), "thumbnail");
  assert.equal(thumb.headers.get("cache-control"), "public, max-age=86400");
  const asset = await fetch(t.url + "/media/bmf/650_b.jpg");
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get("content-type"), "image/jpeg");
  assert.ok((await asset.arrayBuffer()).byteLength > 10000);
  const png = await fetch(t.url + "/media/npl/npl10_cutout.png");
  assert.equal(png.headers.get("content-type"), "image/png");
  await png.arrayBuffer();
  for (const path of ["/media/bmf/none.jpg", "/media/bmf", "/media/", "/media/../catalog/catalog.json", "/media/kp/spec.json"]) {
    const r = await fetch(t.url + path);
    assert.equal(r.status, 404, path);
    assert.doesNotMatch(await r.text(), /"kit_types"/, path);
  }
});

test("path traversal and odd paths are refused", async () => {
  const attempts = [
    "/media/../../catalog/catalog.json",
    "/media/%2e%2e/%2e%2e/catalog/catalog.json",
    "/media/..%2f..%2fcatalog%2fcatalog.json",
    "/media/..%5c..%5ccatalog%5ccatalog.json",
    "/media/bmf/..%2F..%2F..%2Fpackage.json",
    "/media/%00.jpg",
    "/media/bmf%00/650_a.jpg",
    "/media/C:/Windows/win.ini",
    "/media//etc/passwd",
    "/../outside.txt",
    "/%2e%2e/outside.txt",
    "/..%2foutside.txt",
    "/.env",
    "/media/.hidden.png",
    "/js/../../outside.txt",
    "/%E0%A4%A.png",
    "/media\\..\\..\\package.json",
  ];
  for (const path of attempts) {
    const r = await rawGet(t, path);
    assert.ok([400, 404].includes(r.status), `${path} -> ${r.status}`);
    assert.doesNotMatch(r.body, /outside the web root|SECRET|"kit_types"|"name": "kp-configurator"/, path);
    assert.match(String(r.headers["content-type"]), /application\/json/, path);
  }
  assert.equal((await rawGet(t, "/link.txt")).status, 404, "symlink out of the web root");
  assert.equal((await rawGet(t, "/media/host.png")).status, 404, "symlink out of the media root");
});

test("parsePath", () => {
  assert.deepEqual(parsePath("/"), []);
  assert.deepEqual(parsePath("/api/kp/"), ["api", "kp"]);
  assert.deepEqual(parsePath("/media/npl/npl10%20cut.png"), ["media", "npl", "npl10 cut.png"]);
  assert.deepEqual(parsePath("/%D0%BA%D0%BF"), ["кп"]);
  for (const bad of ["", "api", "/a/../b", "/a/%2e%2e/b", "/a/./b", "/a//b", "/a%2fb", "/a%5cb", "/a\\b", "/a%00", "/c:", "/%ZZ", "/a\u0001"]) {
    assert.equal(parsePath(bad), null, bad);
  }
});
