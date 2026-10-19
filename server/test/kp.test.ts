// KP journal and generator queue with the fake generator: create, list, files, numbering, recalc, failures, restart.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ADMIN, ROOT, call, kit720, makeKp, npl750, startTest } from "./helpers.js";
import type { TestServer } from "./helpers.js";

let t: TestServer;
before(async () => { t = await startTest(); });
after(async () => { await t.close(); });

const invocation = (dataDir: string, id: string) => JSON.parse(readFileSync(join(dataDir, "kp", id, "fake-invocation.json"), "utf8"));

test("POST /api/kp: 202 queued, the generator runs, the record becomes ready with files", async () => {
  const r = await call(t, "POST", "/api/kp", { quote_input: npl750, client: { name: "  ФГ «Поле»  ", contact: "Іван Петренко" },
    manager: { name: "Олена", phone: "+380671112233" } });
  assert.equal(r.status, 202, r.text);
  assert.equal(r.json.status, "queued");
  assert.match(r.json.number, /^\d{4}$/);
  assert.equal(r.json.title, "НПЛ-10 + BMF 750");
  assert.equal(r.headers.get("location"), `/api/kp/${r.json.id}`);
  await t.srv.ctx.queue.idle();

  const k = (await call(t, "GET", `/api/kp/${r.json.id}`)).json;
  assert.equal(k.status, "ready", k.error);
  assert.equal(k.error, null);
  assert.equal(k.number, r.json.number);
  assert.deepEqual(k.client, { name: "ФГ «Поле»", contact: "Іван Петренко" });
  assert.deepEqual(k.manager, { name: "Олена", phone: "+380671112233" });
  assert.equal(k.total_uah, 1978000);
  assert.equal(k.total_text, "1 978 000 ₴");
  assert.equal(k.catalog_version, t.srv.ctx.catalog.version);
  assert.equal(k.quote.total_uah, 1978000);
  assert.equal(k.spec.number, k.number);
  assert.equal(k.spec.client.name, "ФГ «Поле»");
  assert.equal(k.spec.maker.name, "ТОВ «ГІДМАН»");
  assert.equal(k.settings.vat_pct, 20);
  assert.equal(k.rate.eur, 47.5);
  assert.ok(Object.keys(k.rate.ref_rates).length > 0);
  assert.equal(k.quote_input.kit_type, "npl_crane");
  assert.equal(k.date, t.srv.ctx.today());
  assert.deepEqual(k.files.pdf, { name: `KP_${k.number}_test.pdf`, size: 17, url: `/api/kp/${k.id}/file/pdf` });
  assert.equal(k.files.pptx.url, `/api/kp/${k.id}/file/pptx`);
  assert.equal(k.files.pages, 11);
  assert.deepEqual(k.gen_warnings, ["фото для обкладинки не знайдено в generator/assets: 'x.jpg'; взято типове фото крана."]);
  assert.equal(k.seq, undefined);

  const dir = join(t.dataDir, "kp", k.id);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "spec.json"), "utf8")), k.spec);
  const inv = invocation(t.dataDir, k.id);
  assert.deepEqual(inv.args, ["-m", "kpgen", "--spec", join(dir, "spec.json"), "--out", dir]);
  assert.equal(inv.cwd, join(ROOT, "generator"));
  assert.equal(inv.kpgen_build, join(t.dataDir, "kpgen-build"));
  assert.equal(inv.has_admin_token, false, "tokens are not passed to the generator");
  assert.equal(inv.has_access_token, false);
  assert.ok(existsSync(join(dir, "generator.log")));
});

test("file downloads: Content-Disposition, content types, inline PDF, missing files", async () => {
  const k = await makeKp(t, { quote_input: kit720, client: { name: "ТОВ Ліс" } });
  const pdf = await fetch(t.url + k.files.pdf.url);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.equal(pdf.headers.get("content-disposition"), `attachment; filename="${k.files.pdf.name}"; filename*=UTF-8''${k.files.pdf.name}`);
  assert.equal(await pdf.text(), "%PDF-1.4 fake pdf");
  const pptx = await fetch(t.url + k.files.pptx.url);
  assert.equal(pptx.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  assert.match(pptx.headers.get("content-disposition")!, /^attachment; filename="KP_\d{4}_test\.pptx"/);
  await pptx.arrayBuffer();
  const inline = await fetch(t.url + k.files.pdf.url + "?inline=1");
  assert.match(inline.headers.get("content-disposition")!, /^inline;/);
  await inline.arrayBuffer();
  assert.equal((await call(t, "GET", `/api/kp/${k.id}/file/docx`)).status, 404);
  assert.equal((await call(t, "GET", `/api/kp/${k.id}/file/pdf/x`)).status, 404);
  assert.equal((await call(t, "GET", "/api/kp/00000000-0000-0000-0000-000000000000/file/pdf")).status, 404);
  assert.equal((await call(t, "GET", "/api/kp/not-an-id")).status, 404);
  assert.equal((await call(t, "GET", "/api/kp/..%2F..%2Fsettings.json/file/pdf")).status, 400);
});

test("journal list: newest first, search by words (Cyrillic, any case), limit and offset", async () => {
  await makeKp(t, { quote_input: npl750, client: { name: "Агрофірма Світанок", contact: "Петро" } });
  await makeKp(t, { quote_input: kit720, client: { name: "ДП Рівнеліс" }, manager: "Марія Коваль" });
  const all = (await call(t, "GET", "/api/kp")).json;
  assert.ok(all.length >= 2);
  assert.equal(all[0].client.name, "ДП Рівнеліс");
  assert.deepEqual(Object.keys(all[0]).sort(),
    ["client", "created_at", "date", "error", "id", "kit_type", "number", "status", "title", "total_text", "total_uah", "year"]);
  const s1 = (await call(t, "GET", `/api/kp?q=${encodeURIComponent("світанок")}`)).json;
  assert.equal(s1.length, 1);
  assert.equal(s1[0].title, "НПЛ-10 + BMF 750");
  const s2 = (await call(t, "GET", `/api/kp?q=${encodeURIComponent("РІВНЕЛІС bmf 720")}`)).json;
  assert.equal(s2.length, 1);
  assert.equal((await call(t, "GET", `/api/kp?q=${encodeURIComponent("коваль")}`)).json.length, 1);
  assert.equal((await call(t, "GET", `/api/kp?q=${encodeURIComponent("%")}`)).json.length, 0);
  assert.equal((await call(t, "GET", `/api/kp?q=${s1[0].number}`)).json.some((x: { id: string }) => x.id === s1[0].id), true);
  const one = (await call(t, "GET", "/api/kp?limit=1&offset=1")).json;
  assert.equal(one.length, 1);
  assert.equal(one[0].id, all[1].id);
  assert.equal((await call(t, "GET", "/api/kp?limit=0")).status, 400);
  assert.equal((await call(t, "GET", "/api/kp?limit=201")).status, 400);
});

test("POST /api/kp validation: client, selection, blocked kits, company, terms, photos", async () => {
  const noClient = await call(t, "POST", "/api/kp", { quote_input: npl750 });
  assert.equal(noClient.status, 400);
  assert.match(noClient.json.errors.join(" "), /клієнта/);
  const blank = await call(t, "POST", "/api/kp", { quote_input: npl750, client: { name: "   " } });
  assert.equal(blank.status, 400);
  const long = await call(t, "POST", "/api/kp", { quote_input: npl750, client: { name: "x".repeat(201) } });
  assert.equal(long.status, 400);
  const noInput = await call(t, "POST", "/api/kp", { client: { name: "A" } });
  assert.equal(noInput.status, 400);
  assert.match(noInput.json.errors[0], /quote_input/);

  const badSel = await call(t, "POST", "/api/kp", { quote_input: { kit_type: "npl_crane", selection: { slots: { crane: "bmf750" }, choices: {}, accessories: [] } },
    client: { name: "A" } });
  assert.equal(badSel.status, 400);
  assert.match(badSel.json.errors.join(" "), /обов’язкову позицію/);

  const blocked = await call(t, "POST", "/api/kp", { quote_input: { kit_type: "crane_kit", selection: { slots: { crane: "bmf905" }, choices: {}, accessories: [] } },
    client: { name: "A" } });
  assert.equal(blocked.status, 422);
  assert.match(blocked.json.errors.join(" "), /BMF 905/);
  const part = await call(t, "POST", "/api/kp", { quote_input: { kit_type: "part", selection: { slots: { item: "valf_s58" }, choices: {}, accessories: [] } },
    client: { name: "A" } });
  assert.equal(part.status, 422);

  const maker = await call(t, "POST", "/api/kp", { quote_input: npl750, client: { name: "A" }, maker: "ghost" });
  assert.equal(maker.status, 422);
  assert.match(maker.json.errors[0], /Невідома компанія «ghost»/);

  const terms = await call(t, "POST", "/api/kp", { quote_input: npl750, client: { name: "A" }, terms: ["payment", "nope"] });
  assert.equal(terms.status, 422);
  assert.match(terms.json.errors.join(" "), /Невідома умова співпраці «nope»/);
  const termsShape = await call(t, "POST", "/api/kp", { quote_input: npl750, client: { name: "A" }, terms: [{ title: "Оплата" }, 5] });
  assert.equal(termsShape.status, 400);

  const photo = await call(t, "POST", "/api/kp", { quote_input: npl750, client: { name: "A" }, photos: { cover: "../catalog/catalog.json" } });
  assert.equal(photo.status, 400);
  assert.match(photo.json.errors[0], /photos\.cover/);
  const focus = await call(t, "POST", "/api/kp", { quote_input: npl750, client: { name: "A" }, photos: { cover: "bmf/650_a.jpg", cover_focus: [2, 0] } });
  assert.equal(focus.status, 400);

  const list = (await call(t, "GET", "/api/kp?limit=200")).json;
  assert.ok(!list.some((x: { client: { name: string } }) => x.client.name === "A"), "rejected requests create no KP");
});

test("options: the legal entity is selectable, literal terms, photos, cover text; the KP date is always today", async () => {
  const k = await makeKp(t, {
    quote_input: { ...npl750, date: "2024-01-01" }, client: { name: "ФОП Клієнт" }, maker: "fop_debelyi",
    terms: ["payment", { title: "Гарантія", text: "12 місяців." }], photos: { cover: "bmf/650_a.jpg", cover_focus: [0.5, 0.3] },
    cover_text: "Комплект для лісозаготівлі.", accessories_note: "Ціни опцій — за запитом.",
  });
  assert.equal(k.status, "ready", k.error);
  assert.equal(k.spec.maker.name, "ФОП Дебелий Володимир Миколайович");
  assert.equal(k.spec.terms.length, 2);
  assert.deepEqual(k.spec.terms[1], { title: "Гарантія", text: "12 місяців." });
  assert.deepEqual(k.spec.photos, { cover: "bmf/650_a.jpg", cover_focus: [0.5, 0.3] });
  assert.equal(k.spec.cover_text, "Комплект для лісозаготівлі.");
  assert.equal(k.date, t.srv.ctx.today());
  assert.equal(k.quote_input.date, t.srv.ctx.today());
  assert.equal(k.options.maker, "fop_debelyi");
});

test("POST /api/kp/:id/recalc: a new KP from the stored input with today's rate", async () => {
  const k = await makeKp(t, { quote_input: npl750, client: { name: "Перерахунок", contact: "Тарас" }, maker: "fop_debelyi" });
  t.srv.ctx.rates["cache"].current!.eur = 52.25;     // the rate moved since
  const r = await call(t, "POST", `/api/kp/${k.id}/recalc`);
  assert.equal(r.status, 202, r.text);
  assert.notEqual(r.json.id, k.id);
  assert.equal(Number(r.json.number), Number(k.number) + 1);
  assert.equal(r.json.recalc_of, k.id);
  await t.srv.ctx.queue.idle();
  const n = (await call(t, "GET", `/api/kp/${r.json.id}`)).json;
  assert.equal(n.status, "ready");
  assert.equal(n.recalc_of, k.id);
  assert.deepEqual(n.client, k.client);
  assert.equal(n.spec.maker.name, k.spec.maker.name);
  assert.equal(n.rate.eur, 52.25);
  assert.ok(n.total_uah > k.total_uah, `${n.total_uah} > ${k.total_uah}`);
  assert.deepEqual(n.quote_input.selection, k.quote_input.selection);
  const old = (await call(t, "GET", `/api/kp/${k.id}`)).json;
  assert.equal(old.total_uah, k.total_uah, "the old KP keeps its snapshot");
  t.srv.ctx.rates["cache"].current!.eur = 47.5;

  assert.equal((await call(t, "POST", "/api/kp/00000000-0000-0000-0000-000000000000/recalc")).status, 404);
  assert.equal((await call(t, "GET", `/api/kp/${k.id}/recalc`)).status, 405);
  const withBody = await call(t, "POST", `/api/kp/${k.id}/recalc`, "{bad", { "content-type": "application/json" });
  assert.equal(withBody.status, 400);
});

test("manual prices in a KP follow the quote rules; admin may go lower", async () => {
  const low = { quote_input: { ...npl750, kit_price_uah: 1500000 }, client: { name: "Знижка" } };
  assert.equal((await call(t, "POST", "/api/kp", low)).status, 400);
  const k = await makeKp(t, low, { "x-admin-token": ADMIN });
  assert.equal(k.total_uah, 1500000);
  assert.equal(k.quote_input.kit_price_uah, 1500000);
});

test("generator failure: status error with kpgen's message, no traceback", async () => {
  const k = await makeKp(t, { quote_input: npl750, client: { name: "Помилка", contact: "fake:fail" } });
  assert.equal(k.status, "error");
  assert.equal(k.error, "помилка генерації КП: тестова помилка");
  assert.equal(k.files, null);
  assert.equal((await call(t, "GET", `/api/kp/${k.id}/file/pdf`)).status, 404);
  assert.match(readFileSync(join(t.dataDir, "kp", k.id, "generator.log"), "utf8"), /Traceback/);
});

test("exit 3 (no PDF): error, the PPTX stays downloadable", async () => {
  const k = await makeKp(t, { quote_input: npl750, client: { name: "Без PDF", contact: "fake:nopdf" } });
  assert.equal(k.status, "error");
  assert.match(k.error, /^PDF не створено: LibreOffice не створив PDF/);
  assert.equal(k.files.pdf, null);
  assert.ok(k.files.pptx);
  assert.equal((await fetch(t.url + k.files.pptx.url)).status, 200);
  const pdf = await call(t, "GET", `/api/kp/${k.id}/file/pdf`);
  assert.equal(pdf.status, 404);
});

test("unusable result lines: no JSON, or files outside the KP folder", async () => {
  const g = await makeKp(t, { quote_input: npl750, client: { name: "Сміття", contact: "fake:garbage" } });
  assert.equal(g.status, "error");
  assert.match(g.error, /не повідомив/);
  const e = await makeKp(t, { quote_input: npl750, client: { name: "Втеча", contact: "fake:escape" } });
  assert.equal(e.status, "error");
  assert.equal(e.files, null);
});

test("one job at a time, in order; queue position while waiting", async () => {
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await call(t, "POST", "/api/kp", { quote_input: npl750, client: { name: `Черга ${i}`, contact: "fake:sleep150" } });
    ids.push(r.json.id);
  }
  const waiting = (await call(t, "GET", `/api/kp/${ids[2]}`)).json;
  assert.ok(waiting.status === "queued" || waiting.status === "running");
  assert.ok(waiting.queue_position >= 1, String(waiting.queue_position));
  await t.srv.ctx.queue.idle();
  const runs = ids.map((id) => invocation(t.dataDir, id));
  for (let i = 1; i < runs.length; i++) assert.ok(runs[i].started >= runs[i - 1].finished, "jobs must not overlap");
  for (const id of ids) assert.equal((await call(t, "GET", `/api/kp/${id}`)).json.status, "ready");
});

test("KP numbers are sequential per year", async () => {
  let clock = new Date(2026, 11, 31, 12, 0, 0);
  const s = await startTest({ server: { now: () => clock } });
  try {
    const a = await makeKp(s, { quote_input: npl750, client: { name: "A" } });
    const b = await makeKp(s, { quote_input: npl750, client: { name: "B" } });
    assert.deepEqual([a.number, a.year, b.number, b.year], ["0001", 2026, "0002", 2026]);
    assert.equal(a.date, "2026-12-31");
    clock = new Date(2027, 0, 2, 9, 0, 0);
    const c = await makeKp(s, { quote_input: npl750, client: { name: "C" } });
    assert.deepEqual([c.number, c.year, c.date], ["0001", 2027, "2027-01-02"]);
    const d = await makeKp(s, { quote_input: npl750, client: { name: "D" } });
    assert.equal(d.number, "0002");
    clock = new Date(2026, 11, 31, 18, 0, 0);
    const e = await makeKp(s, { quote_input: npl750, client: { name: "E" } });
    assert.deepEqual([e.number, e.year], ["0003", 2026]);
    assert.equal((await call(s, "GET", `/api/kp?q=${encodeURIComponent("0001/2027")}`)).json.length, 1);
  } finally {
    await s.close();
  }
});

test("generator timeout and a missing interpreter give an error status", async () => {
  const s = await startTest({ config: { generatorTimeoutS: 1 } });
  try {
    const k = await makeKp(s, { quote_input: npl750, client: { name: "Повільно", contact: "fake:hang" } });
    assert.equal(k.status, "error");
    assert.equal(k.error, "Генератор КП не встиг за 1 с.");
    const inv = (await call(s, "GET", `/api/kp/${k.id}`)).json;
    assert.equal(inv.status, "error");
  } finally {
    await s.close();
  }
  const m = await startTest({ config: { python: "/nonexistent/python3" } });
  try {
    const k = await makeKp(m, { quote_input: npl750, client: { name: "Без Python" } });
    assert.equal(k.status, "error");
    assert.match(k.error, /Не вдалося запустити генератор КП/);
    const next = await makeKp(m, { quote_input: npl750, client: { name: "Ще раз" } });
    assert.equal(next.status, "error", "the queue keeps working after a failed job");
  } finally {
    await m.close();
  }
});

test("graceful shutdown leaves an interrupted job queued; the next start runs it", async () => {
  const s = await startTest();
  try {
    const r = await call(s, "POST", "/api/kp", { quote_input: npl750, client: { name: "Рестарт", contact: "fake:hang-once" } });
    assert.equal(r.status, 202);
    const marker = join(s.dataDir, "kp", r.json.id, "hang-once.marker");
    for (let i = 0; i < 200 && !existsSync(marker); i++) await new Promise((x) => setTimeout(x, 25));
    assert.ok(existsSync(marker), "the job started");
    await s.stop();
    const again = await startTest({ dataDir: s.dataDir, root: s.root, nbu: s.nbu });
    try {
      await new Promise((x) => setTimeout(x, 50));
      await again.srv.ctx.queue.idle();
      const k = (await call(again, "GET", `/api/kp/${r.json.id}`)).json;
      assert.equal(k.status, "ready", k.error);
      assert.equal(k.number, r.json.number);
      const n = await makeKp(again, { quote_input: npl750, client: { name: "Після рестарту" } });
      assert.equal(Number(n.number), Number(k.number) + 1);
    } finally {
      await again.stop();
    }
  } finally {
    await s.close();
  }
});
