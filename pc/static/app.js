// Конфігуратор КП (ПК): розрахунок у браузері ядром core/ (те саме, що й у веб-версії), генерація КП — на локальному сервері.
import * as core from "./core/index.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v; else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v; else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
};
const esc = (s) => String(s ?? "");
const toast = (t) => { const el = $("#toast"); el.textContent = t; el.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("on"), 2600); };
const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
const uah = (n) => (n == null ? "—" : core.formatUah(n));

let B, cat0, settings, admin, cat;
const S = { kt: null, sel: null, manual: {}, kitPrice: null, discount: 0 };
const KINDS = { crane: "Крани BMF", trailer: "Причепи", component: "Комплектуючі", service: "Послуги" };

// ------------------------------------------------------------------ admin -> effective catalog
function origUah(rule) { return rule && rule.mode === "ref" && typeof rule.uah === "number" ? rule.uah : null; }
function priceOf(rec, rule) {
  const base = num(rec?.base) ?? origUah(rule);
  const mk = num(rec?.markup) ?? 0;
  const step = settings.rounding_uah || 1;
  const calc = base == null ? null : mk ? core.roundTo(base * (1 + mk / 100), step) : base;
  const fin = num(rec?.final);
  return { base, mk, calc, price: fin ?? calc, fin };
}
function effRule(rule, rec) {
  if (!rec) return rule;
  const p = priceOf(rec, rule);
  if (p.price == null) return rule;
  return { mode: "ref", uah: p.price, date: core.todayIso(), eur_rate_ref: null, metal_index_ref: null, eur_share: 0, metal_share: 0,
    group: rule?.group, history: [] };
}
function effCatalog() {
  const c = structuredClone(cat0);
  const P = admin.prices || {}, F = admin.photos || {};
  for (const i of c.items) { i.price = effRule(i.price, P.items?.[i.id]); if (F.items?.[i.id]) i.photo = F.items[i.id]; }
  for (const b of c.bundles) b.price = effRule(b.price, P.bundles?.[b.id]);
  for (const a of c.accessories) { a.price = effRule(a.price, P.accessories?.[a.id]); if (F.accessories?.[a.id]) a.photo = F.accessories[a.id]; }
  for (const t of c.texts.terms) { const o = admin.texts?.terms?.[t.id]; if (o?.title) t.title = o.title; if (o?.text) t.text = o.text; }
  return c;
}

// ------------------------------------------------------------------ boot
async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  const j = r.headers.get("content-type")?.includes("json") ? await r.json() : null;
  if (!r.ok) throw new Error(j?.error || r.statusText);
  return j;
}
async function boot() {
  B = await api("/api/bootstrap");
  cat0 = B.catalog; settings = B.settings; admin = B.admin;
  for (const k of ["styles", "photos", "prices", "texts"]) admin[k] ??= {};
  admin.photos.items ??= {}; admin.photos.accessories ??= {};
  admin.prices.items ??= {}; admin.prices.bundles ??= {}; admin.prices.accessories ??= {};
  admin.texts.terms ??= {}; admin.texts.cranes ??= {}; admin.texts.npl ??= {};
  cat = effCatalog();
  $$("header nav button").forEach((b) => b.onclick = () => tab(b.dataset.tab));
  $$(".sub button").forEach((b) => b.onclick = () => sub(b.dataset.sub));
  initConf(); initAdmin(); renderHist(B.history);
}
function tab(id) {
  $$("header nav button").forEach((b) => b.classList.toggle("on", b.dataset.tab === id));
  $$(".tab").forEach((t) => t.classList.toggle("on", t.id === "tab-" + id));
  if (id === "conf") { cat = effCatalog(); renderConf(); fillStyles(); }
}
function sub(id) {
  $$(".sub button").forEach((b) => b.classList.toggle("on", b.dataset.sub === id));
  $$(".subtab").forEach((t) => t.classList.toggle("on", t.id === id));
  if (id === "a-texts") renderTexts();
}

// ------------------------------------------------------------------ configurator
function kitTypes() { return cat.kit_types.filter((k) => k.id !== "part"); }
function initConf() {
  const kt = $("#kitType");
  for (const k of kitTypes()) kt.append(h("option", { value: k.id }, k.title));
  kt.onchange = () => setKit(kt.value);
  $("#preset").onchange = (e) => {
    const p = cat.presets.find((x) => x.id === e.target.value); if (!p) return;
    S.sel = core.presetSelection(p, cat); S.manual = {}; S.kitPrice = null; renderConf();
  };
  $("#discount").oninput = (e) => { S.discount = num(e.target.value) || 0; renderQuote(); };
  $("#offerAcc").onchange = () => {};
  $("#kpDate").value = core.todayIso();
  $("#kpNumber").value = String(admin.kp_counter || 1).padStart(4, "0");
  $("#gen").onclick = generate;
  fillStyles();
  setKit(kitTypes()[0].id);
}
function fillStyles() {
  const sel = $("#style"), cur = sel.value || admin.style || "dark";
  sel.innerHTML = "";
  for (const s of B.styles) {
    const ok = !s.kits.length || s.kits.includes(S.kt?.id);
    sel.append(h("option", { value: s.id, disabled: !ok }, s.title + (ok ? "" : " — лише НПЛ-10 + кран")));
  }
  const pick = B.styles.find((s) => s.id === cur && (!s.kits.length || s.kits.includes(S.kt?.id))) ? cur : "dark";
  sel.value = pick;
}
function setKit(id) {
  S.kt = core.kitTypeById(cat, id); S.sel = core.defaultSelection(S.kt); S.manual = {}; S.kitPrice = null;
  $("#kitType").value = id;
  const ps = $("#preset"); ps.innerHTML = ""; ps.append(h("option", { value: "" }, "— обрати —"));
  for (const p of cat.presets.filter((p) => p.kit_type === id && !p.archived)) ps.append(h("option", { value: p.id }, p.title));
  fillStyles(); renderConf();
}
function renderConf() {
  if (!S.kt) return;
  S.kt = core.kitTypeById(cat, S.kt.id);
  const box = $("#slots"); box.innerHTML = "";
  for (const slot of S.kt.slots) {
    const sel = h("select", { onchange: (e) => {
      S.sel = core.reconcileSelection(cat, S.kt.id, { ...S.sel, slots: { ...S.sel.slots, [slot.id]: e.target.value || null } }, slot.id);
      renderConf();
    } });
    if (!slot.required) sel.append(h("option", { value: "" }, "— немає —"));
    for (const c of core.slotCandidates(cat, S.kt.id, slot.id, S.sel))
      sel.append(h("option", { value: c.id, disabled: !c.allowed, title: c.reason || "" }, (c.item?.title || c.id) + (c.allowed ? "" : " (несумісний)")));
    sel.value = S.sel.slots[slot.id] || "";
    box.append(h("label", {}, slot.title + (slot.required ? " *" : ""), sel));
  }
  const cb = $("#choices"); cb.innerHTML = "";
  for (const ch of S.kt.choices || []) {
    const sel = h("select", { onchange: (e) => { S.sel = { ...S.sel, choices: { ...S.sel.choices, [ch.id]: e.target.value } }; renderQuote(); } });
    for (const o of ch.options) sel.append(h("option", { value: o.value }, o.title + (o.price_uah ? ` (+${core.formatUah(o.price_uah)})` : o.on_request ? " (доплата за запитом)" : "")));
    sel.value = S.sel.choices?.[ch.id] ?? ch.default;
    cb.append(h("label", {}, ch.title, sel));
  }
  renderAccs(); renderQuote();
}
function renderAccs() {
  const box = $("#accs"); box.innerHTML = "";
  const chosen = new Map(S.sel.accessories.map((a) => [a.id, a]));
  for (const ka of core.kitAccessories(cat, S.kt.id, S.sel)) {
    const a = ka.accessory, on = chosen.get(a.id), bad = ka.status === "incompatible";
    const p = a.price?.mode === "ref" ? a.price.uah : null;
    const upd = (patch) => {
      const list = S.sel.accessories.filter((x) => x.id !== a.id);
      const cur = { id: a.id, ...(on || {}), ...patch };
      if (cur.on !== false) list.push({ id: cur.id, variant: cur.variant ?? null, price_uah: cur.price_uah ?? null });
      S.sel = { ...S.sel, accessories: list }; renderAccs(); renderQuote();
    };
    const cbx = h("input", { type: "checkbox", disabled: bad, onchange: (e) => upd({ on: e.target.checked }) }); cbx.checked = !!on;
    const vs = ka.variants.length ? h("select", { onchange: (e) => upd({ variant: e.target.value || null }) },
      h("option", { value: "" }, "варіант…"), ka.variants.map((v) => h("option", { value: v.id }, v.title))) : null;
    if (vs && on) vs.value = on.variant || "";
    const pin = h("input", { type: "number", placeholder: p ? String(p) : "ціна, ₴", value: on?.price_uah ?? "",
      onchange: (e) => upd({ price_uah: num(e.target.value) }) });
    box.append(h("div", { class: "acc" + (bad ? " bad" : "") }, cbx,
      a.photo ? h("img", { src: "/assets/" + a.photo, loading: "lazy" }) : h("span"),
      h("div", {}, h("b", {}, a.title), h("small", {}, ka.desc), on && vs ? vs : null,
        ka.status === "unconfirmed" ? h("small", {}, "сумісність не підтверджена") : null),
      h("div", {}, on ? pin : h("small", {}, p ? uah(p) : "за запитом"))));
  }
}
function quoteInput() {
  const manual = Object.fromEntries(Object.entries(S.manual).filter(([, v]) => v != null));
  return { kit_type: S.kt.id, selection: S.sel, discount_pct: S.discount, manual_prices: manual, kit_price_uah: S.kitPrice,
    date: $("#kpDate").value || core.todayIso() };
}
let lastQuote = null;
function renderQuote() {
  const tb = $("#rows"); tb.innerHTML = ""; const warn = $("#warnings"); warn.innerHTML = ""; $("#kitPriceBox").innerHTML = "";
  let q;
  try { q = core.quote(cat, settings, { eur: null, source: "none" }, quoteInput()); }
  catch (e) { lastQuote = null; $("#total").textContent = "—"; for (const m of e.errors || [String(e)]) warn.append(h("li", {}, m)); return; }
  lastQuote = q;
  const bundle = q.price_display === "bundle";
  for (const r of q.rows) {
    const inp = bundle ? h("small", {}, "у комплекті") : h("input", { type: "number", placeholder: "як у адмінці", value: S.manual[r.item_id] ?? "",
      onchange: (e) => { S.manual[r.item_id] = num(e.target.value); renderQuote(); } });
    tb.append(h("tr", {}, h("td", {}, h("b", {}, r.title), h("small", {}, r.desc)), h("td", {}, bundle ? "—" : (S.manual[r.item_id] != null ? h("s", {}, admRowPrice(r.item_id)) : r.price_text)), h("td", {}, inp)));
  }
  for (const r of q.accessories) tb.append(h("tr", {}, h("td", {}, h("b", {}, r.title), h("small", {}, "опція")), h("td", {}, r.price_text), h("td", {}, h("small", {}, "ціна — у списку опцій"))));
  for (const c of q.choices.filter((c) => c.price_uah)) tb.append(h("tr", {}, h("td", {}, c.title + ": " + c.value_title), h("td", {}, uah(c.price_uah)), h("td")));
  if (bundle) {
    $("#kitPriceBox").append(h("label", { class: "inline" }, "Ціна комплекту в адмінці: " + uah(q.kit_price_uah ?? null) + ". Фінальна ціна комплекту, ₴:",
      h("input", { type: "number", value: S.kitPrice ?? "", placeholder: "як у адмінці", onchange: (e) => { S.kitPrice = num(e.target.value); renderQuote(); } })));
  }
  $("#total").textContent = q.complete === false ? uah(q.total_uah) + " (не всі позиції мають ціну)" : uah(q.total_uah);
  for (const w of q.warnings.filter((w) => !/Курс EUR|індекс металу|опорн/i.test(w))) warn.append(h("li", {}, w));
}
function admRowPrice(itemId) { const it = core.itemById(cat, itemId); return it?.price?.mode === "ref" ? uah(it.price.uah) : "—"; }

async function generate() {
  if (!lastQuote) return toast("Спершу виправте комплект");
  const errs = core.validateSelection(cat, quoteInput());
  if (errs.length) return toast(errs[0]);
  let spec;
  try {
    spec = core.buildKpSpec(cat, settings, lastQuote, { number: $("#kpNumber").value || "0001",
      client: { name: $("#client").value.trim() || "Назва замовника", contact: $("#clientContact").value.trim() },
      offer_accessories: $("#offerAcc").checked });
  } catch (e) { return toast((e.errors || [String(e)])[0]); }
  // admin: item photos and descriptions
  for (const r of spec.rows) if (r.item_id && admin.photos.items[r.item_id]) { r.photo = admin.photos.items[r.item_id]; r.photo_force = true; }
  const lead = admin.texts.cranes?.[spec.crane?.profile];
  if (spec.crane && lead?.lead) spec.crane.lead = lead.lead;
  if (spec.crane && lead?.lead2) spec.crane.lead2 = lead.lead2;
  if (spec.npl) { if (admin.texts.npl?.lead) spec.npl.lead = admin.texts.npl.lead; if (admin.texts.npl?.lead2) spec.npl.lead2 = admin.texts.npl.lead2; }
  if (admin.texts.price_note) spec.price_note = admin.texts.price_note;
  spec.style = $("#style").value;
  const btn = $("#gen"), res = $("#genResult");
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Створюю КП… (PDF — до хвилини)'; res.innerHTML = "";
  try {
    const r = await api("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec) });
    const ok = r.pptx;
    res.append(h("div", { class: "result" + (ok ? "" : " err") },
      ok ? h("div", {}, r.pdf ? h("a", { href: r.pdf, target: "_blank" }, "Відкрити PDF") : "PDF не створено (немає LibreOffice?)",
        h("a", { href: r.pptx }, "Завантажити PPTX"), h("small", {}, `${r.pages} стор.`)) : h("b", {}, "КП не створено"),
      ...(r.messages || []).map((m) => h("div", {}, h("small", {}, m.replace(/^kpgen: /, ""))))));
    if (ok) {
      admin.kp_counter = (parseInt($("#kpNumber").value, 10) || admin.kp_counter || 1) + 1;
      $("#kpNumber").value = String(admin.kp_counter).padStart(4, "0"); await saveAdmin(true);
      B = await api("/api/bootstrap"); renderHist(B.history);
    }
  } catch (e) { res.append(h("div", { class: "result err" }, e.message)); }
  btn.disabled = false; btn.textContent = "Створити КП (PPTX + PDF)";
}
function renderHist(list) {
  const tb = $("#histRows"); tb.innerHTML = "";
  const st = Object.fromEntries(B.styles.map((s) => [s.id, s.title]));
  for (const x of list || []) tb.append(h("tr", {}, h("td", {}, x.time), h("td", {}, x.number), h("td", {}, x.title), h("td", {}, x.client),
    h("td", {}, st[x.style] || x.style), h("td", {}, x.total), h("td", {}, x.pdf ? h("a", { href: x.pdf, target: "_blank" }, "PDF") : "", x.pptx ? h("a", { href: x.pptx }, "PPTX") : "")));
  if (!list?.length) tb.append(h("tr", {}, h("td", { colspan: 7 }, "Ще немає КП.")));
}

// ------------------------------------------------------------------ admin
let saveT;
async function saveAdmin(now = false) {
  clearTimeout(saveT);
  const go = async () => {
    await api("/api/admin", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(admin) });
    $("#savedMark").textContent = "Збережено " + new Date().toLocaleTimeString("uk-UA").slice(0, 5);
    cat = effCatalog();
  };
  if (now) return go();
  saveT = setTimeout(go, 500);
}
const stAdm = (style) => (admin.styles[style] ??= { bg: {}, texts: {} });

function initAdmin() {
  for (const sel of $$(".admStyle")) {
    for (const s of B.styles) sel.append(h("option", { value: s.id }, s.title));
    sel.value = admin.style || "dark";
    sel.onchange = () => { $$(".admStyle").forEach((x) => x.value = sel.value); renderBg(); renderTexts(); };
  }
  renderStyleCards(); renderBg(); renderTermsLeads(); renderPhotos(); renderPrices();
}
function renderStyleCards() {
  const box = $("#styleCards"); box.innerHTML = "";
  for (const s of B.styles) box.append(h("button", { class: "stylecard" + (admin.style === s.id ? " on" : ""), onclick: () => {
    admin.style = s.id; saveAdmin(); renderStyleCards(); fillStyles();
  } }, h("img", { src: `previews/${s.id}.jpg` }), h("b", {}, s.title), h("small", {}, s.kits.length ? "лише НПЛ-10 + кран" : "усі комплекти з краном")));
}
async function upload(file) {
  const r = await api("/api/upload", { method: "POST", headers: { "X-Filename": encodeURIComponent(file.name) }, body: file });
  return r.path;
}
function filePick(cb) {
  const i = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", style: "display:none" });
  i.onchange = async () => { if (i.files[0]) { try { await cb(await upload(i.files[0])); } catch (e) { toast(e.message); } } };
  document.body.append(i); i.click(); setTimeout(() => i.remove(), 60000);
}
function renderBg() {
  const style = $(".admStyle").value, st = B.styles.find((s) => s.id === style), A = stAdm(style);
  const box = $("#bgList"); box.innerHTML = "";
  for (const p of st.pages) {
    const o = A.bg[p.key];
    const img = h("img", { src: o?.path ? "/assets/" + o.path : `/api/bg?style=${style}&page=${p.key}`, loading: "lazy" });
    const rows = [];
    if (o?.path) {
      if (p.hero) {
        for (const [k, lab] of [["fx", "фокус ↔"], ["fy", "фокус ↕"]]) rows.push(h("div", { class: "row" }, lab,
          h("input", { type: "range", min: 0, max: 1, step: 0.05, value: o[k] ?? (k === "fx" ? 0.5 : 0.45), oninput: (e) => { o[k] = Number(e.target.value); saveAdmin(); } })));
      } else {
        const lab = h("span", {}, Math.round((o.opacity ?? 0.18) * 100) + " %");
        rows.push(h("div", { class: "row" }, "видимість фото", h("input", { type: "range", min: 0.05, max: 1, step: 0.05, value: o.opacity ?? 0.18,
          oninput: (e) => { o.opacity = Number(e.target.value); lab.textContent = Math.round(o.opacity * 100) + " %"; saveAdmin(); } }), lab));
      }
    }
    box.append(h("div", { class: "bgitem" }, img, h("div", {}, h("b", {}, p.title), o?.path ? h("span", { class: "badge" }, "своє фото") : null,
      h("small", { style: "display:block;color:#6B727B" }, p.hero ? "фото під стиль" : "накладання на фон")),
      h("div", { class: "row" }, h("button", { onclick: () => filePick((path) => { A.bg[p.key] = { path, opacity: 0.18, fx: 0.5, fy: 0.45 }; saveAdmin(); renderBg(); }) }, "Завантажити фото"),
        o?.path ? h("button", { onclick: () => { delete A.bg[p.key]; saveAdmin(); renderBg(); } }, "Скинути") : null), ...rows));
  }
}
const textsCache = {};
async function renderTexts() {
  const style = $(".admStyle").value, A = stAdm(style), box = $("#textsBox");
  if (!textsCache[style]) {
    box.innerHTML = "<p class='hint'>Читаю шаблон стилю (перший раз до 30 с)…</p>";
    try { textsCache[style] = await api("/api/texts?style=" + style); } catch (e) { box.textContent = e.message; return; }
  }
  if ($(".admStyle").value !== style) return;
  box.innerHTML = "";
  for (const [key, pg] of Object.entries(textsCache[style])) {
    if (!pg.texts.length) continue;
    const ov = (A.texts[key] ??= {});
    const n = Object.values(ov).filter(Boolean).length;
    box.append(h("details", { class: "page-texts" }, h("summary", {}, pg.title, n ? h("span", { class: "badge" }, `змінено: ${n}`) : null),
      pg.texts.map((t) => h("div", { class: "tx" }, h("pre", {}, t.text),
        h("textarea", { placeholder: "як у шаблоні", rows: Math.min(4, t.text.split("\n").length + 1), oninput: (e) => {
          if (e.target.value.trim()) ov[t.id] = e.target.value; else delete ov[t.id]; saveAdmin(); } }, ov[t.id] || "")))));
  }
}
function renderTermsLeads() {
  const tb = $("#termsBox"); tb.innerHTML = "";
  for (const t of cat0.texts.terms) {
    const o = (admin.texts.terms[t.id] ??= {});
    tb.append(h("div", { class: "term" }, h("input", { value: o.title || "", placeholder: t.title, oninput: (e) => { o.title = e.target.value; saveAdmin(); } }),
      h("textarea", { placeholder: t.text, oninput: (e) => { o.text = e.target.value; saveAdmin(); } }, o.text || "")));
  }
  const lb = $("#leadsBox"); lb.innerHTML = "";
  for (const [prof, d] of Object.entries(B.defaults.cranes)) {
    const o = (admin.texts.cranes[prof] ??= {});
    lb.append(h("h4", {}, prof.toUpperCase().replace("BMF", "BMF ")),
      ["lead", "lead2"].map((k) => h("textarea", { placeholder: d[k], oninput: (e) => { o[k] = e.target.value; saveAdmin(); } }, o[k] || "")));
  }
  lb.append(h("h4", {}, "НПЛ-10"), ["lead", "lead2"].map((k) => h("textarea", { placeholder: B.defaults.npl[k], oninput: (e) => { admin.texts.npl[k] = e.target.value; saveAdmin(); } }, admin.texts.npl[k] || "")));
}
function renderPhotos() {
  const box = $("#photoList"); box.innerHTML = "";
  const card = (kind, x) => {
    const p = admin.photos[kind][x.id] || x.photo;
    return h("div", { class: "ph" }, p ? h("img", { src: "/assets/" + p, loading: "lazy" }) : h("div", { class: "hint" }, "без фото"),
      h("div", {}, h("div", { class: "t" }, x.title), h("small", {}, admin.photos[kind][x.id] ? "своє фото" : kind === "items" ? KINDS[x.kind] || x.kind : "опція"),
        h("div", { class: "acts" }, h("button", { onclick: () => filePick((path) => { admin.photos[kind][x.id] = path; saveAdmin(); renderPhotos(); }) }, "Змінити"),
          admin.photos[kind][x.id] ? h("button", { onclick: () => { delete admin.photos[kind][x.id]; saveAdmin(); renderPhotos(); } }, "Скинути") : null)));
  };
  cat0.items.forEach((x) => box.append(card("items", x)));
  cat0.accessories.forEach((x) => box.append(card("accessories", x)));
}
function renderPrices() {
  $("#roundStep").textContent = settings.rounding_uah || 1;
  const groups = [...Object.entries(KINDS).map(([k, t]) => ({ key: "items:" + k, title: t, kind: "items", list: cat0.items.filter((i) => i.kind === k) })),
    { key: "bundles", title: "Комплекти з однією ціною (НПЛ-10, причепи BMF, КРАЗ)", kind: "bundles", list: cat0.bundles.map((b) => ({ ...b, title: bundleTitle(b) })) },
    { key: "accessories", title: "Додаткові опції", kind: "accessories", list: cat0.accessories }];
  const bg = $("#bulkGroup"); bg.innerHTML = ""; groups.forEach((g) => bg.append(h("option", { value: g.key }, g.title)));
  $("#bulkApply").onclick = () => {
    const g = groups.find((x) => x.key === bg.value), pct = num($("#bulkPct").value);
    if (pct == null) return toast("Вкажіть націнку");
    for (const x of g.list) { const r = (admin.prices[g.kind][x.id] ??= {}); r.markup = pct; }
    saveAdmin(); renderPrices(); toast("Націнку застосовано");
  };
  const box = $("#priceTables"); box.innerHTML = "";
  const tbl = h("table", { class: "prices" }, h("thead", {}, h("tr", {}, ["Позиція", "Базова ціна, ₴", "Націнка, %", "Розрахункова", "Фінальна, ₴", "У КП", "Додана вартість"].map((t) => h("th", {}, t)))));
  const tb = h("tbody"); tbl.append(tb);
  for (const g of groups) {
    if (!g.list.length) continue;
    tb.append(h("tr", { class: "grp" }, h("td", { colspan: 7 }, g.title)));
    for (const x of g.list) {
      const rec = admin.prices[g.kind][x.id] || {};
      const p = priceOf(rec, x.price);
      const set = (k) => (e) => { const r = (admin.prices[g.kind][x.id] ??= {}); const v = num(e.target.value); if (v == null) delete r[k]; else r[k] = v;
        if (!Object.keys(r).length) delete admin.prices[g.kind][x.id]; saveAdmin(); upd(); };
      const calc = h("td", { class: "num" }), fin = h("td", { class: "num" }), add = h("td", { class: "num" });
      const upd = () => {
        const q = priceOf(admin.prices[g.kind][x.id] || {}, x.price);
        calc.textContent = uah(q.calc); fin.innerHTML = ""; fin.append(h("b", {}, q.price == null ? "за запитом" : uah(q.price)));
        const d = q.price != null && q.base != null ? q.price - q.base : null;
        add.innerHTML = ""; if (d != null) add.append(h("span", { class: d >= 0 ? "plus" : "minus" }, (d >= 0 ? "+" : "−") + core.formatUah(Math.abs(d)) + (q.base ? ` (${(d / q.base * 100).toFixed(1).replace(".", ",")} %)` : "")));
      };
      tb.append(h("tr", {}, h("td", {}, x.title, x.price?.date ? h("small", { style: "display:block;color:#6B727B" }, "з КП " + core.formatDate(x.price.date)) : null),
        h("td", {}, h("input", { type: "number", value: rec.base ?? "", placeholder: p.base ?? "—", onchange: set("base") })),
        h("td", {}, h("input", { type: "number", step: 0.5, value: rec.markup ?? "", placeholder: "0", style: "width:70px", onchange: set("markup") })),
        calc, h("td", {}, h("input", { type: "number", value: rec.final ?? "", placeholder: "—", onchange: set("final") })), fin, add));
      upd();
    }
  }
  box.append(tbl);
}
function bundleTitle(b) {
  return Object.values(b.slots).map((id) => core.modelName(core.itemById(cat0, id) || { title: id })).join(" + ");
}

boot().catch((e) => { document.body.prepend(h("div", { class: "result err" }, "Помилка запуску: " + e.message)); });
