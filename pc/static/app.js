// Конфігуратор КП (ПК): розрахунок у браузері ядром core/ (те саме, що й у веб-версії), генерація КП — на локальному сервері.
// «Налаштування» зберігають зміни каталогу як накладку (admin.catalog) поверх catalog.json: правки, власні позиції, гілки комплектів, вимкнені, порядок.
// Ціни: чернетка (вручну, € × коеф. × курс, з матеріалів, сума позицій) -> «Зафіксувати» -> admin.fixed, за якими рахуються КП.
import * as core from "./core/index.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") el.className = v; else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v; else if (k === "value" || k === "checked") continue;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  if ("value" in (attrs || {})) el.value = attrs.value ?? "";   // after the options of a select exist
  if ("checked" in (attrs || {})) el.checked = !!attrs.checked;
  return el;
};
const toast = (t) => { const el = $("#toast"); el.textContent = t; el.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("on"), 2800); };
const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
const uah = (n) => (n == null ? "—" : core.formatUah(n));
const nowStr = () => new Date().toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const asset = (p) => (p ? "/assets/" + p : "");
const qs = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

let B, cat0, settings, admin, cat;
const S = { kt: null, sel: null, manual: {}, kitPrice: null, discount: 0, qty: {}, historyId: null, preset: null };
const KINDS = { crane: "Крани BMF", trailer: "Причепи", component: "Комплектуючі", service: "Послуги" };
const KIT_SHORT = { crane_kit: "Кран у комплекті", npl_crane: "НПЛ-10 + кран", bmf_trailer_crane: "Причіп BMF + кран", truck_crane: "КРАЗ + кран" };
const GROUPS = { crane: "Для крана", trailer: "Для причепа" };

// ------------------------------------------------------------------ modal and lightbox
function modal(...content) {
  $("#modalBody").innerHTML = ""; $("#modalBody").append(...content); $("#modal").hidden = false;
}
function closeModal() { $("#modal").hidden = true; $("#modalBody").innerHTML = ""; }
function lightbox(views, caption) {
  const img = h("img", { src: views[0].src });
  const seg = views.length > 1 ? h("div", { class: "seg" }, views.map((v, i) => h("button", { class: i ? "" : "on", onclick: (e) => {
    img.src = v.src; $$("button", seg).forEach((b) => b.classList.toggle("on", b === e.target)); } }, v.label))) : null;
  modal(h("div", { class: "lb" }, seg, img, caption ? h("div", { class: "cap" }, caption) : null));
}
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.id === "modal" || t.id === "modalX") return closeModal();
  if (t.tagName === "IMG" && t.dataset.lb !== undefined) {
    e.preventDefault(); e.stopPropagation();
    const views = t.dataset.lb ? JSON.parse(t.dataset.lb) : [{ src: t.src, label: "" }];
    lightbox(views, t.dataset.cap || t.alt || "");
  }
}, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
const lbImg = (src, views, attrs = {}) => h("img", { src, loading: "lazy", "data-lb": views ? JSON.stringify(views) : "", ...attrs });
function confirmBox(text, okText, onOk) {
  modal(h("div", { class: "form" }, h("h2", {}, text), h("div", { class: "acts" },
    h("button", { onclick: closeModal }, "Скасувати"), h("button", { class: "primary", onclick: async () => { closeModal(); await onOk(); } }, okText))));
}

// ------------------------------------------------------------------ settings -> effective catalog
function origUah(rule) { return rule && rule.mode === "ref" && typeof rule.uah === "number" ? rule.uah : null; }
const eurRate = () => num(admin.eur?.rate);
const fmtN = (n, d = 2) => (n == null ? "—" : Number(n).toLocaleString("uk-UA", { maximumFractionDigits: d }));
const PRICE_MODES = { manual: "вручну, ₴", eur: "€ × коеф. × курс", bom: "з матеріалів", sum: "сума позицій" };
const PKINDS = ["items", "bundles", "accessories"];
/** Price mode of a position: set in the settings, else € for positions with a price in €, else manual. */
function priceMode(rec, it) { return rec?.mode || (num(rec?.eur) != null || it?.price_eur != null ? "eur" : "manual"); }
/** Material price in ₴ (prices in € go by the current rate). */
function matUah(m) {
  const p = num(m?.price); if (p == null) return null;
  if (m.cur === "EUR") { const r = eurRate(); return r ? p * r : null; }
  return p;
}
const matMap = () => new Map((admin.materials?.list || []).map((m) => [m.id, m]));
/** Cost of an own-production position from its materials list: Σ qty × price, × coefficient, + other costs. */
function bomCost(id) {
  const b = admin.bom?.[id]; if (!b?.rows?.length) return null;
  const mats = matMap(); let cost = 0; const miss = [];
  for (const r of b.rows) {
    const m = mats.get(r.mat), p = matUah(m);
    if (p == null) { miss.push(m?.name || "матеріал видалено"); continue; }
    cost += p * (num(r.qty) ?? 0);
  }
  const coef = num(b.coef) ?? 1, extra = num(b.extra) ?? 0;
  return { cost, coef, extra, total: cost * coef + extra, miss, n: b.rows.length };
}
const rawBundle = (id) => cat0.bundles.find((b) => b.id === id);
/**
 * Draft price of a position from the settings: base by mode (₴ by hand, € × coef × rate, materials, sum of the bundle's positions),
 * then markup, a final price by hand wins. lines = how it was calculated (shown under the row in the configurator).
 */
function priceOf(kind, id, rule, it, depth = 0) {
  const rec = admin.prices[kind]?.[id] || {};
  const step = settings.rounding_uah || 1, rate = eurRate();
  const mode = kind === "bundles" ? (rec.mode === "sum" ? "sum" : "manual") : priceMode(rec, it);
  const lines = []; let base = null, eur = null, coef = null, fromEur = null;
  if (mode === "eur") {
    eur = num(rec.eur) ?? it?.price_eur ?? null; coef = num(rec.coef) ?? 1;
    if (eur != null && rate) { fromEur = core.roundTo(eur * coef * rate, step); base = fromEur; lines.push(`€ ${fmtN(eur)} × коеф. ${fmtN(coef, 3)} × курс ${fmtN(rate, 4)} = ${uah(base)}`); }
    else lines.push(eur == null ? "ціна в € не задана" : "курс € не задано");
  } else if (mode === "bom") {
    const b = bomCost(id);
    if (b) { base = core.roundTo(b.total, step);
      lines.push(`матеріали ${uah(Math.round(b.cost))} (${b.n} поз.)` + (b.coef !== 1 ? ` × коеф. ${fmtN(b.coef, 3)}` : "") + (b.extra ? ` + інші витрати ${uah(b.extra)}` : "") + ` = ${uah(base)}`);
      if (b.miss.length) lines.push(`без ціни: ${b.miss.slice(0, 4).join(", ")}${b.miss.length > 4 ? "…" : ""}`); }
    else lines.push("розкладку матеріалів не задано");
  } else if (mode === "sum" && depth < 2) {
    const b = rawBundle(id); let sum = 0, ok = !!b;
    for (const iid of Object.values(b?.slots || {})) {
      const i0 = cat0.items.find((x) => x.id === iid) || (CA().items?.custom || []).find((x) => x.id === iid);
      const p = i0 ? priceOf("items", iid, i0.price, i0, depth + 1).price : null;
      lines.push(`${core.modelName(i0 || { title: iid })}: ${p == null ? "без ціни" : uah(p)}`);
      if (p == null) ok = false; else sum += p;
    }
    const extra = num(rec.extra) ?? 0;
    if (extra) lines.push(`доплата за комплект ${uah(extra)}`);
    base = ok ? core.roundTo(sum + extra, step) : null;
  } else {
    base = num(rec.base) ?? origUah(rule);
    if (base != null) lines.push(num(rec.base) != null ? `базова ${uah(base)}` : `базова ${uah(base)} — з КП${rule?.date ? " від " + core.formatDate(rule.date) : ""}`);
  }
  const mk = num(rec.markup) ?? 0;
  const calc = base == null ? null : mk ? core.roundTo(base * (1 + mk / 100), step) : base;
  if (mk && calc != null) lines.push(`націнка ${fmtN(mk)} % → ${uah(calc)}`);
  const fin = num(rec.final);
  if (fin != null) lines.push(`фінальна вручну ${uah(fin)}`);
  return { mode, base, mk, calc, price: fin ?? calc, fin, eur, coef, fromEur, lines };
}
/** Price that goes into KPs: the fixed one (settings → «Зафіксувати»), else the draft. */
function fixedOf(kind, id) { return admin.fixed?.[kind]?.[id]; }
function effRule(kind, id, rule, it) {
  const fx = fixedOf(kind, id);
  const price = fx ? fx.price : (admin.prices[kind]?.[id] || it?.price_eur != null ? priceOf(kind, id, rule, it).price : undefined);
  if (price === undefined) return rule;
  if (price == null) return fx ? { mode: "on_request" } : rule;
  return { mode: "ref", uah: price, date: core.todayIso(), eur_rate_ref: null, metal_index_ref: null, eur_share: 0, metal_share: 0,
    group: rule?.group || "admin", history: [] };
}
/** Every position with a price: [{kind, id, title, rule, it}] (custom items too). */
function pricedPositions() {
  const out = [];
  const items = [...cat0.items, ...(CA().items?.custom || []).map((x) => ({ price: { mode: "on_request" }, ...x }))];
  for (const it of items) out.push({ kind: "items", id: it.id, title: it.title, rule: it.price, it });
  for (const b of cat0.bundles) out.push({ kind: "bundles", id: b.id, title: bundleTitle(b), rule: b.price });
  for (const a of [...cat0.accessories, ...(CA().accs?.custom || [])]) out.push({ kind: "accessories", id: a.id, title: a.title, rule: a.price });
  return out;
}
/** Positions whose draft price differs from the fixed one. */
function pendingFix() {
  const out = [];
  for (const p of pricedPositions()) {
    const d = priceOf(p.kind, p.id, p.rule, p.it), fx = fixedOf(p.kind, p.id);
    const old = fx ? fx.price : origUah(p.rule);
    if (!fx && d.price == null) continue;
    if ((fx ? fx.price : undefined) !== d.price) out.push({ ...p, old, now: d.price, lines: d.lines, mode: d.mode });
  }
  return out;
}
function fixPrices(list, note) {
  admin.fixed ??= {};
  const at = core.todayIso();
  for (const p of list) {
    const F = (admin.fixed[p.kind] ??= {}), prev = F[p.id];
    F[p.id] = { price: p.now, at, lines: p.lines, ...(prev ? { prev: { price: prev.price, at: prev.at, lines: prev.lines } } : {}) };
  }
  return saveAdmin(true, note);
}
/** First start with this version: the prices that the KPs use now become the fixed ones. */
function migrateFixed() {
  if (admin.fixed) return false;
  admin.fixed = {};
  for (const p of pricedPositions()) {
    const d = priceOf(p.kind, p.id, p.rule, p.it);
    if (d.price != null) (admin.fixed[p.kind] ??= {})[p.id] = { price: d.price, at: core.todayIso(), lines: d.lines };
  }
  return true;
}
/** list + {custom, hidden, edits, order} -> list (custom entries appended, hidden removed, edits merged, sorted by order) */
function overlay(list, ov, key = "id", keepHidden = false) {
  if (!ov) return list;
  const hidden = new Set(ov.hidden || []);
  let out = [...list, ...(ov.custom || []).map((x) => structuredClone(x))].filter((x) => keepHidden || !hidden.has(x[key]));
  out = out.map((x) => {
    const y = ov.edits?.[x[key]] ? { ...x, ...structuredClone(ov.edits[x[key]]) } : x;
    return keepHidden && hidden.has(x[key]) ? { ...y, _off: true } : y;
  });
  if (ov.order?.length) {
    const pos = new Map(ov.order.map((k, i) => [k, i]));
    const idx = new Map(out.map((x, i) => [x[key], i]));
    out.sort((a, b) => (pos.get(a[key]) ?? 1e6 + idx.get(a[key])) - (pos.get(b[key]) ?? 1e6 + idx.get(b[key])));
  }
  return out;
}
const CA = () => admin.catalog;
/** Kit types with the settings' copies (branches) and titles; disabled ones keep disabled: true. */
function effKitTypes(c) {
  const KT = CA().kit_types || {};
  return overlay(c.kit_types, KT).map((k) => ({ ...k }));
}
const kitName = (k) => (k ? CA().kit_types?.edits?.[k.id]?.title || (k.copy_of ? k.title : KIT_SHORT[k.id] || k.title) : "");
function effCatalog() {
  const c = structuredClone(cat0), A = CA(), F = admin.photos;
  for (const x of A.items?.custom || []) c.items.push({ family: "custom", price: { mode: "on_request" }, source: "налаштування", kind: "component", short: "", ...structuredClone(x) });
  for (const i of c.items) {
    const e = A.items?.edits?.[i.id];
    if (e?.title) i.title = e.title;
    if (e?.desc) { if (i.desc_template) i.desc_template = e.desc; else i.short = e.desc; }
    if (e?.specs) i.specs = { ...(i.specs || {}), ...e.specs };
    i.price = effRule("items", i.id, i.price, i);
    if (F.items?.[i.id]) i.photo = F.items[i.id];
    if (!i.photo && F.kinds?.[i.kind]) i.photo = F.kinds[i.kind];   // category photo for positions without their own
  }
  const has = new Set(c.items.map((i) => i.id));
  c.kit_types = effKitTypes(c);
  for (const kt of c.kit_types) {   // bundles (one kit price) of a copied kit: the source kit's, same prices
    if (!kt.copy_of) continue;
    for (const b of c.bundles.filter((x) => x.kit_type === kt.copy_of)) c.bundles.push({ ...structuredClone(b), id: b.id + "@" + kt.id, kit_type: kt.id, price_of: b.price_of || b.id });
  }
  for (const kt of c.kit_types) {
    const k = A.kits?.[kt.id];
    if (k) kt.slots = overlay(kt.slots, k).map((s) => ({ ...s, candidates: s.candidates.filter((id) => has.has(id)) }))
      .filter((s) => s.candidates.length).map((s) => ({ ...s, default: s.default && s.candidates.includes(s.default) ? s.default : s.required ? s.candidates[0] : s.default ? s.candidates[0] : null }));
    kt.choices = overlay(kt.choices, k?.choice_ov).filter((ch) => !ch.slot || kt.slots.some((s) => s.id === ch.slot)).map((ch) => effChoice(ch));
  }
  c.accessories = overlay(c.accessories, A.accs).map((a) => ({ ...a, price: effRule("accessories", a.id, a.price), photo: F.accessories?.[a.id] || a.photo || "" }));
  for (const b of c.bundles) b.price = effRule("bundles", b.price_of || b.id, b.price);
  for (const t of c.texts.terms) { const o = admin.texts?.terms?.[t.id]; if (o?.title) t.title = o.title; if (o?.text) t.text = o.text; }
  return c;
}
/** Choice with the settings: title, default, options (switched-off ones dropped unless keepOff), option edits. */
function effChoice(ch, keepOff = false) {
  const e = CA().choices?.[ch.id];
  if (!e) return ch;
  const out = { ...ch, title: e.title || ch.title, options: overlay(ch.options, e, "value", keepOff).map((o) => {
    const ed = e.edits?.[o.value] || {};
    const x = { ...o };
    if ("price" in ed) { if (ed.price == null) { delete x.price_uah; x.on_request = true; } else { x.price_uah = ed.price; delete x.on_request; } }
    if (!x.short && x.title) x.short = x.title;
    delete x.price;
    return x;
  }) };
  if (e.default && out.options.some((o) => o.value === e.default && !o._off)) out.default = e.default;
  if (!out.options.some((o) => o.value === out.default && !o._off)) out.default = out.options.find((o) => !o._off)?.value;
  return out;
}

// ------------------------------------------------------------------ boot
async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  const j = r.headers.get("content-type")?.includes("json") ? await r.json() : null;
  if (!r.ok) throw new Error(j?.error || r.statusText);
  return j;
}
function normAdmin() {
  for (const k of ["styles", "photos", "prices", "texts", "catalog", "photo_history"]) admin[k] ??= {};
  for (const k of ["items", "accessories", "kits", "kinds", "kp_items", "pos"]) admin.photos[k] ??= {};
  admin.materials ??= { list: [], log: [] }; admin.materials.list ??= []; admin.materials.log ??= [];
  admin.bom ??= {};
  for (const k of ["items", "bundles", "accessories"]) admin.prices[k] ??= {};
  admin.texts.terms ??= {}; admin.texts.cranes ??= {}; admin.texts.npl ??= {};
}
async function boot() {
  B = await api("/api/bootstrap");
  cat0 = B.catalog; settings = B.settings; admin = B.admin; normAdmin();
  if (migrateFixed()) await saveAdmin(true, "ціни зафіксовано як у КП (перший запуск)");
  cat = effCatalog();
  $$(".main-nav button").forEach((b) => b.onclick = () => tab(b.dataset.tab));
  $$("#adminNav button").forEach((b) => b.onclick = () => sub(b.dataset.sub));
  initConf(); initAdmin(); renderHist();
}
function tab(id) {
  $$(".main-nav button").forEach((b) => b.classList.toggle("on", b.dataset.tab === id));
  $$(".tab").forEach((t) => t.classList.toggle("on", t.id === "tab-" + id));
  if (id === "conf") { cat = effCatalog(); renderKitTabs(); renderFeatured(); renderConf(); }
  if (id === "hist") renderHist();
  window.scrollTo(0, 0);
}
function sub(id) {
  $$("#adminNav button").forEach((b) => b.classList.toggle("on", b.dataset.sub === id));
  $$(".subtab").forEach((t) => t.classList.toggle("on", t.id === id));
  ({ "a-style": renderStyleCards, "a-bg": renderBg, "a-texts": renderTexts, "a-layout": renderLayout, "a-kits": renderKitEditor, "a-choices": renderChoiceEditor,
     "a-accs": renderAccEditor, "a-items": renderItemEditor, "a-prices": renderPrices, "a-own": renderOwn, "a-fix": renderFix, "a-versions": renderVersions })[id]?.();
  fixBadge();
}

// ------------------------------------------------------------------ configurator
function kitTypes() { return cat.kit_types.filter((k) => k.id !== "part" && !k.disabled); }
function allKitTypes() { return cat.kit_types.filter((k) => k.id !== "part"); }
const craneSlot = () => S.kt.slots.find((s) => s.id === "crane");
function initConf() {
  $("#preset").onchange = (e) => { const p = cat.presets.find((x) => x.id === e.target.value); if (p) applyPreset(p); };
  $("#discount").oninput = (e) => { S.discount = num(e.target.value) || 0; renderQuote(); };
  $("#kpDate").value = core.todayIso();
  $("#kpNumber").value = String(admin.kp_counter || 1).padStart(4, "0");
  $("#gen").onclick = () => generate(false);
  $("#genNew").onclick = () => generate(true);
  setKit(kitTypes()[0].id);
}
function renderKitTabs() {
  const box = $("#kitTabs"); box.innerHTML = "";
  for (const k of kitTypes()) box.append(h("button", { class: S.kt?.id === k.id ? "on" : "", onclick: () => setKit(k.id) },
    admin.photos.kits?.[k.id] ? h("img", { src: asset(admin.photos.kits[k.id]), alt: "" }) : null, kitName(k)));
}
function setKit(id) {
  S.kt = core.kitTypeById(cat, id); S.sel = core.defaultSelection(S.kt, cat); S.manual = {}; S.kitPrice = null; S.qty = {}; S.preset = null;
  S.sel = core.reconcileSelection(cat, id, S.sel);
  S.sel.accessories = baseAccessories();
  renderKitTabs(); renderFeatured(); renderConf();
}
function baseAccessories() {
  return core.kitAccessories(cat, S.kt.id, S.sel).filter((ka) => ka.status === "ok" && (ka.accessory.base_for || []).includes(S.kt.id))
    .map((ka) => ({ id: ka.accessory.id, variant: null, price_uah: null }));
}
function applyPreset(p) {
  S.kt = core.kitTypeById(cat, p.kit_type);
  S.sel = core.reconcileSelection(cat, p.kit_type, core.presetSelection(p, cat));
  S.manual = {}; S.kitPrice = null; S.qty = {}; S.preset = p.id;
  renderKitTabs(); renderFeatured(); renderConf();
}
function presetKey(p) { const sl = p.selection.slots; return [sl.crane, sl.trailer, sl.conversion].join("|"); }
function presetTotal(p) {
  try { const q = core.quote(cat, settings, { eur: null, source: "none" }, { kit_type: p.kit_type, selection: core.presetSelection(p, cat), date: core.todayIso() });
    return q.total_uah ? (q.complete === false ? uah(q.total_uah) + " *" : uah(q.total_uah)) : null; }
  catch { return null; }
}
// ready kits: grouped by crane (and trailer), inside a group from the base kit to the fullest; marks show which positions each has
const SLOT_SHORT = { base: "Основа", tank: "Бак", oil: "Олива", seat: "Місце", heat_exchanger: "Тепло", pump: "Насос" };
const markSlots = (kt) => kt.slots.filter((s) => !s.required && !(kt.title_slots || []).includes(s.id));
function presetExtras(p, kt) {
  const sel = p.selection, items = core.selectedItems(cat, kt, core.presetSelection(p, cat)).map((x) => x.item);
  let n = markSlots(kt).filter((s) => sel.slots[s.id]).length + (sel.accessories || []).length;
  for (const ch of kt.choices) { const v = sel.choices?.[ch.id]; if (v && v !== core.choiceDefault(cat, ch, items)) n++; }
  return n;
}
function choiceMarks(p, kt) {
  const items = core.selectedItems(cat, kt, core.presetSelection(p, cat)).map((x) => x.item);
  return kt.choices.filter((ch) => !ch.slot || p.selection.slots[ch.slot]).map((ch) => {
    const v = p.selection.choices?.[ch.id] ?? core.choiceDefault(cat, ch, items);
    const o = ch.options.find((x) => x.value === v);
    return o && v !== core.choiceDefault(cat, ch, items) ? o.title : null;
  }).filter(Boolean);
}
function renderFeatured() {
  const box = $("#ready"); box.innerHTML = "";
  const kt = S.kt;
  const list = cat.presets.filter((p) => p.kit_type === kt.id && !p.archived);
  const marks = markSlots(kt);
  const groups = new Map();
  for (const p of list) { const k = presetKey(p); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  const crOf = (p) => core.itemById(cat, p.selection.slots.crane);
  const gl = [...groups.values()].sort((a, b) => (crOf(b[0])?.featured ? 1 : 0) - (crOf(a[0])?.featured ? 1 : 0)
    || (crOf(a[0])?.model || "").localeCompare(crOf(b[0])?.model || "") || (a[0].selection.slots.trailer || "").localeCompare(b[0].selection.slots.trailer || ""));
  for (const g of gl) {
    g.forEach((p) => (p._n = presetExtras(p, kt)));
    g.sort((a, b) => a._n - b._n || (b.source.date || "").localeCompare(a.source.date || ""));
    const latest = [...g].sort((a, b) => (b.source.date || "").localeCompare(a.source.date || ""))[0];
    const cr = crOf(g[0]), tr = core.itemById(cat, g[0].selection.slots.trailer || g[0].selection.slots.conversion || "");
    const photo = kt.id === "crane_kit" ? cr?.photo : tr?.photo || cr?.photo;
    const head = h("div", { class: "rg-head" + (cr?.featured ? " main" : "") }, photo ? lbImg(asset(photo), null, { alt: cr?.model || "" }) : h("span"),
      h("b", {}, [tr?.model, cr?.model].filter(Boolean).join(" + ") || "без крана"), cr?.featured ? h("span", { class: "badge" }, "основний кран") : null);
    const rows = h("div", { class: "rg-rows" });
    if (marks.length) rows.append(h("div", { class: "rg-marks-h" }, h("span"), h("div", { class: "marks" }, marks.map((s) => h("i", { title: s.title }, SLOT_SHORT[s.id] || s.title.split(" ")[0]))), h("span")));
    for (const p of g) {
      const t = presetTotal(p), cm = choiceMarks(p, kt);
      rows.append(h("button", { class: "rg-row" + (S.preset === p.id ? " on" : ""), onclick: () => applyPreset(p) },
        h("span", { class: "lvl", title: "кількість допів" }, p._n ? "+" + p._n : "база"),
        h("div", { class: "rg-mid" },
          marks.length ? h("div", { class: "marks" }, marks.map((s) => h("i", { class: p.selection.slots[s.id] ? "y" : "", title: s.title + (p.selection.slots[s.id] ? ": є" : ": немає") }, p.selection.slots[s.id] ? "✓" : "·"))) : null,
          h("div", { class: "meta" }, h("small", {}, (p.source.date ? "КП " + core.formatDate(p.source.date) : "без дати") + (cm.length ? " · " + cm.join(", ") : "")),
            p === latest && cr?.featured ? h("span", { class: "tag" }, "основна") : null)),
        h("b", { class: "price", title: t?.endsWith("*") ? "частина позицій — за запитом" : "" }, t || "за запитом")));
    }
    box.append(h("div", { class: "rgroup" }, head, rows));
  }
  if (!gl.length) box.append(h("p", { class: "hint" }, "Готових КП для цього комплекту ще немає — зберіть його гілками праворуч."));
  const ps = $("#preset"); ps.innerHTML = ""; ps.append(h("option", { value: "" }, "— обрати —"));
  for (const p of cat.presets.filter((x) => x.kit_type === kt.id && x.archived)) ps.append(h("option", { value: p.id }, p.title));
  ps.value = S.preset && cat.presets.find((x) => x.id === S.preset)?.archived ? S.preset : "";
  ps.parentElement.hidden = ps.options.length < 2;
}

// ------------------------------------------------------------------ branch tree: base -> crane -> grapple -> valve -> extras
function itemPriceText(it) {
  if (!it) return "";
  if (it.price?.mode !== "ref") return "за запитом";
  return it.unit ? `${uah(it.price.uah)} / ${it.unit.per} ${it.unit.name}` : uah(it.price.uah);
}
function switchBase(ktId, slotId, itemId) {
  const prev = S.sel, prevKt = S.kt;
  if (prevKt.id !== ktId) {
    S.kt = core.kitTypeById(cat, ktId);
    let sel = core.defaultSelection(S.kt, cat);
    const cs = S.kt.slots.find((s) => s.id === "crane");
    if (cs && prev.slots.crane && cs.candidates.includes(prev.slots.crane)) sel.slots.crane = prev.slots.crane;
    for (const ch of S.kt.choices) if (prev.choices?.[ch.id] && ch.options.some((o) => o.value === prev.choices[ch.id])) sel.choices[ch.id] = prev.choices[ch.id];
    S.sel = sel; S.manual = {}; S.kitPrice = null; S.qty = {};
  }
  if (slotId) S.sel = { ...S.sel, slots: { ...S.sel.slots, [slotId]: itemId } };
  S.sel = core.reconcileSelection(cat, ktId, S.sel, slotId || "crane");
  if (prevKt.id !== ktId) S.sel.accessories = baseAccessories();
  S.preset = null;
  renderKitTabs(); renderFeatured(); renderConf();
}
function tnode({ photo, title, sub, mark, markCls = "", on, dis, why, onclick, cls = "" }) {
  return h("div", { class: `tnode ${cls}` + (on ? " on" : "") + (dis ? " dis" : ""), title: why || title, onclick: dis ? null : onclick },
    photo ? lbImg(asset(photo), null, { alt: title }) : h("div", { class: "ph" }, "фото"),
    h("div", { class: "tt" }, h("b", {}, title), sub ? h("small", {}, sub) : null, mark ? h("span", { class: "mk " + markCls }, mark) : null));
}
function renderTree() {
  const box = $("#tree"); if (!box) return; box.innerHTML = "";
  const kt = S.kt, sel = S.sel;
  const items = core.selectedItems(cat, kt, sel).map((x) => x.item);
  const cols = [];
  // 1. base: own trailers / BMF trailers / truck / crane kit without trailer
  const base = [];
  for (const k of kitTypes()) {
    const ts = k.slots.find((s) => s.id === "trailer" || s.id === "conversion");
    if (!ts) { base.push(tnode({ photo: admin.photos.kits?.[k.id] || core.itemById(cat, "base_outriggers_720")?.photo || "prod/tile_base.png", title: kitName(k), sub: "без причепа, на основі", on: kt.id === k.id, onclick: () => switchBase(k.id) })); continue; }
    for (const id of ts.candidates) {
      const it = core.itemById(cat, id); if (!it) continue;
      base.push(tnode({ photo: it.photo, title: it.model || it.title, sub: kitName(k), mark: k.price_display === "bundle" ? "" : itemPriceText(it),
        on: kt.id === k.id && sel.slots[ts.id] === id, onclick: () => switchBase(k.id, ts.id, id) }));
    }
  }
  cols.push(["Основа", base]);
  // 2. crane
  const cs = craneSlot();
  if (cs) {
    const cands = core.slotCandidates(cat, kt.id, "crane", sel).map((c) => {
      const t = core.reconcileSelection(cat, kt.id, { ...sel, slots: { ...sel.slots, crane: c.id } }, "crane");
      const errs = core.validateSelection(cat, { kit_type: kt.id, selection: t });
      return { ...c, allowed: !errs.length, reason: errs[0] || "" };
    }).sort((a, b) => (b.item?.featured ? 1 : 0) - (a.item?.featured ? 1 : 0));
    const nodes = cands.map((c) => tnode({ photo: c.item?.photo, title: c.item?.model || c.id, sub: c.item?.featured ? "основний" : "", mark: kt.price_display === "bundle" ? "" : itemPriceText(c.item),
      on: sel.slots.crane === c.id, dis: !c.allowed, why: c.reason, onclick: () => setSlot("crane", c.id) }));
    if (!cs.required) nodes.push(tnode({ title: "без крана", on: !sel.slots.crane, onclick: () => setSlot("crane", null) }));
    cols.push(["Кран", nodes]);
  }
  // 3. crane-bound choices (захват, розподільник)
  const setChoice = (id, v) => { S.sel = { ...S.sel, choices: { ...S.sel.choices, [id]: v } }; S.preset = null; renderConf(); renderFeatured(); };
  const optMark = (o) => core.choiceIsStandard(o, items) ? ["★ базовий", "std"] : o.price_uah ? ["+" + uah(o.price_uah), ""] : o.on_request ? ["доплата за запитом", "req"] : ["без доплати", ""];
  const restChoices = [];
  for (const ch of kt.choices) {
    if (ch.slot && !sel.slots[ch.slot]) continue;
    if (ch.slot !== "crane") { restChoices.push(ch); continue; }
    const cur = sel.choices?.[ch.id] ?? core.choiceDefault(cat, ch, items);
    const nodes = ch.options.filter((o) => core.choiceOptionFits(cat, o, items)).map((o) => { const [m, mc] = optMark(o);
      const why = core.choiceOptionBlock(cat, kt, o, sel, items);
      return tnode({ photo: o.photo, title: o.title.replace(/ — .*$/, ""), sub: o.title.includes(" — ") ? o.title.replace(/^.*? — /, "") : "", mark: m, markCls: mc, on: cur === o.value,
        dis: !!why && cur !== o.value, why, onclick: () => setChoice(ch.id, o.value) }); });
    cols.push([ch.title.replace(/ \(.*\)$/, "").replace(/ крана$/, ""), nodes]);
  }
  // 4. extras: optional positions (toggle) with their own choices under them, then the kit's other choices
  const extras = [];
  for (const s of markSlots(kt)) {
    const cur = sel.slots[s.id];
    const it = core.itemById(cat, cur || s.default || s.candidates[0]);
    const cands = core.slotCandidates(cat, kt.id, s.id, sel);
    const pick = (cands.find((c) => c.allowed && c.id === s.default) || cands.find((c) => c.allowed))?.id;
    const node = tnode({ photo: it?.photo, title: s.title, mark: cur ? "✓ в комплекті" : "+ " + itemPriceText(it), markCls: cur ? "std" : "",
      on: !!cur, dis: !pick && !cur, cls: "tog", onclick: () => setSlot(s.id, cur ? null : pick) });
    if (it?.unit) node.querySelector(".tt").append(h("label", { class: "tq", onclick: (e) => e.stopPropagation() }, h("input", { type: "number", min: it.unit.min || 1, max: it.unit.max || "", value: S.qty[it.id] ?? it.unit.default,
      onchange: (e) => { S.qty[it.id] = num(e.target.value); if (!cur) setSlot(s.id, it.id); else { renderConf(); } } }), it.unit.name));
    const subs = restChoices.filter((ch) => ch.slot === s.id);
    extras.push(subs.length && cur ? h("div", { class: "tgrp" }, node, subs.map((ch) => miniChoice(ch, items, setChoice))) : node);
  }
  for (const ch of restChoices.filter((c) => !c.slot || !markSlots(kt).some((s) => s.id === c.slot))) extras.push(h("div", { class: "tgrp solo" }, h("div", { class: "tg-t" }, ch.title), miniChoice(ch, items, setChoice)));
  if (extras.length) cols.push(["Допи", extras]);
  for (const [title, nodes] of cols) box.append(h("div", { class: "tcol" }, h("div", { class: "tc-h" }, title), h("div", { class: "tc-b" }, nodes)));
  requestAnimationFrame(drawTreeLinks);
}
function miniChoice(ch, items, setChoice) {
  const cur = S.sel.choices?.[ch.id] ?? core.choiceDefault(cat, ch, items);
  return h("div", { class: "mini" }, ch.options.filter((o) => core.choiceOptionFits(cat, o, items)).map((o) => {
    const why = core.choiceOptionBlock(cat, S.kt, o, S.sel, items);
    return h("button", { class: cur === o.value ? "on" : "", disabled: !!why && cur !== o.value,
      title: why || (o.price_uah ? "+" + uah(o.price_uah) : o.on_request && !core.choiceIsStandard(o, items) ? "доплата за запитом" : ""),
      onclick: (e) => { e.stopPropagation(); setChoice(ch.id, o.value); } }, o.photo ? h("img", { src: asset(o.photo), alt: "" }) : null, o.title); }));
}
function drawTreeLinks() {
  const box = $("#tree"); if (!box) return;
  const old = box.querySelector("svg"); if (old) old.remove();
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", box.scrollWidth); svg.setAttribute("height", box.scrollHeight);
  const r0 = box.getBoundingClientRect();
  const cols = $$(".tcol", box);
  const anchor = (el, side) => { const r = el.getBoundingClientRect(); return [side === "r" ? r.right - r0.left : r.left - r0.left, r.top - r0.top + Math.min(r.height / 2, 28)]; };
  for (let i = 0; i < cols.length - 1; i++) {
    const from = $(".tc-b > .tnode.on", cols[i]); if (!from) continue;
    const [x1, y1] = anchor(from, "r");
    for (const to of $$(".tc-b > .tnode, .tc-b > .tgrp", cols[i + 1])) {
      if (to.classList.contains("dis")) continue;
      const on = to.classList.contains("on") || to.classList.contains("solo") || !!to.querySelector(":scope > .tnode.on");
      const [x2, y2] = anchor(to, "l"), mx = (x1 + x2) / 2;
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
      p.setAttribute("class", on ? "on" : "off");
      svg.append(p);
    }
  }
  box.append(svg);
}
window.addEventListener("resize", () => requestAnimationFrame(drawTreeLinks));
function setSlot(slotId, val) {
  S.sel = core.reconcileSelection(cat, S.kt.id, { ...S.sel, slots: { ...S.sel.slots, [slotId]: val || null } }, slotId);
  S.preset = null; renderConf(); renderFeatured();
}
function renderConf() {
  if (!S.kt) return;
  S.kt = core.kitTypeById(cat, S.kt.id);
  // crane picker: main cranes as cards, others as chips
  const cb = $("#craneBox"); cb.innerHTML = "";
  const cs = craneSlot();
  if (cs) {
    const cands = core.slotCandidates(cat, S.kt.id, "crane", S.sel).map((c) => {
      const t = core.reconcileSelection(cat, S.kt.id, { ...S.sel, slots: { ...S.sel.slots, crane: c.id } }, "crane");
      const errs = core.validateSelection(cat, { kit_type: S.kt.id, selection: t });
      return { ...c, allowed: !errs.length, reason: errs[0] || "" };
    });
    const main = cands.filter((c) => c.item?.featured), other = cands.filter((c) => !c.item?.featured);
    cb.append(h("div", { class: "label" }, cs.title + (cs.required ? "" : " (необов’язково)")),
      h("div", { class: "cranes" }, main.map((c) => h("button", { class: "crane" + (S.sel.slots.crane === c.id ? " on" : ""), disabled: !c.allowed, title: c.reason || "", onclick: () => setSlot("crane", c.id) },
        c.item.photo ? h("img", { src: asset(c.item.photo), loading: "lazy" }) : h("div", { style: "height:86px;background:#222" }),
        h("div", { class: "cb" }, h("b", {}, c.item.model || c.item.title), h("small", {}, c.item.short))))),
      h("div", { class: "cranes-other" }, "Інші:", other.map((c) => h("button", { class: "sm" + (S.sel.slots.crane === c.id ? " primary" : ""), disabled: !c.allowed, title: c.reason || "", onclick: () => setSlot("crane", c.id) }, c.item?.model || c.id)),
        cs.required ? null : h("button", { class: "sm" + (!S.sel.slots.crane ? " primary" : ""), onclick: () => setSlot("crane", null) }, "без крана")));
  }
  // other positions
  const box = $("#slots"); box.innerHTML = "";
  for (const slot of S.kt.slots.filter((s) => s.id !== "crane")) {
    const cur = S.sel.slots[slot.id];
    const cands = core.slotCandidates(cat, S.kt.id, slot.id, S.sel);
    const it = core.itemById(cat, cur || slot.default || slot.candidates[0]);
    const on = !!cur;
    const cbx = h("input", { type: "checkbox", checked: on, disabled: slot.required, onchange: (e) => setSlot(slot.id, e.target.checked ? (cands.find((c) => c.allowed && c.id === slot.default) || cands.find((c) => c.allowed))?.id : null) });
    const ok = cands.filter((c) => c.allowed || c.id === cur);   // incompatible variants (e.g. a base for another crane) are not offered
    const sel = ok.length > 1 ? h("select", { onchange: (e) => setSlot(slot.id, e.target.value) },
      ok.map((c) => h("option", { value: c.id }, itemLabel(c.item, ok.map((x) => x.item)) || c.id))) : null;
    if (sel) sel.value = cur || "";
    const unit = it?.unit;
    // litres (or other units) are always editable; typing a quantity also adds the position
    const qty = unit ? h("label", { class: "inline", style: "margin:0", title: "кількість, " + unit.name }, h("input", { type: "number", class: "qty", min: unit.min || 1, max: unit.max || "", step: 1, value: S.qty[it.id] ?? unit.default,
      onchange: (e) => { S.qty[it.id] = num(e.target.value); if (!on) setSlot(slot.id, it.id); else { renderQuote(); renderTree(); } } }), unit.name) : null;
    box.append(h("div", { class: "slot" + (on ? " on" : "") }, cbx,
      it?.photo ? lbImg(asset(it.photo), null, { alt: it.title }) : h("span"),
      h("div", {}, h("div", { class: "t" }, slot.title, slot.priced ? h("span", { class: "badge gray" }, "ціна окремо") : null), h("small", {}, it ? core.itemDesc(S.kt, it, S.sel) : "")),
      h("div", { class: "inline", style: "margin:0;flex-wrap:nowrap" }, sel && on ? sel : null, qty)));
  }
  // choices of the kit (захват, розподільник, місце оператора, гальма…)
  const chb = $("#choices"); chb.innerHTML = "";
  const items = core.selectedItems(cat, S.kt, S.sel).map((x) => x.item);
  for (const ch of S.kt.choices) {
    if (ch.slot && !S.sel.slots[ch.slot]) continue;
    const opts = ch.options.filter((o) => core.choiceOptionFits(cat, o, items));
    const sel = h("select", { onchange: (e) => { S.sel = core.reconcileSelection(cat, S.kt.id, { ...S.sel, choices: { ...S.sel.choices, [ch.id]: e.target.value } }); S.preset = null; renderConf(); renderFeatured(); } },
      opts.map((o) => { const why = core.choiceOptionBlock(cat, S.kt, o, S.sel, items);
        return h("option", { value: o.value, disabled: !!why && (S.sel.choices?.[ch.id] ?? ch.default) !== o.value },
          o.title + (core.choiceIsStandard(o, items) ? " — базовий" : o.price_uah ? ` (+${core.formatUah(o.price_uah)})` : o.on_request ? " — доплата за запитом" : "") + (why ? ` (${why})` : "")); }));
    sel.value = S.sel.choices?.[ch.id] ?? ch.default;
    chb.append(h("label", {}, ch.title, sel));
  }
  renderAccs(); renderQuote(); renderStyleChips(); renderTree();
}
function renderAccs() {
  const box = $("#accs"); box.innerHTML = "";
  const chosen = new Map(S.sel.accessories.map((a) => [a.id, a]));
  const all = core.kitAccessories(cat, S.kt.id, S.sel);
  for (const g of ["crane", "trailer"]) {
    const list = all.filter((x) => x.accessory.group === g);
    if (!list.length) continue;
    box.append(h("div", { class: "acc-grp" }, GROUPS[g]));
    for (const ka of list) {
      const a = ka.accessory, on = chosen.get(a.id), bad = ka.status === "incompatible";
      const p = a.price?.mode === "ref" ? a.price.uah : null;
      const upd = (patch) => {
        const list2 = S.sel.accessories.filter((x) => x.id !== a.id);
        const cur = { id: a.id, ...(on || {}), ...patch };
        if (cur.on !== false) list2.push({ id: cur.id, variant: cur.variant ?? null, price_uah: cur.price_uah ?? null });
        S.sel = { ...S.sel, accessories: list2 }; renderAccs(); renderQuote();
      };
      const vs = ka.variants.length ? h("select", { onchange: (e) => upd({ variant: e.target.value || null }) },
        h("option", { value: "" }, "варіант…"), ka.variants.map((v) => h("option", { value: v.id }, v.title))) : null;
      if (vs && on) vs.value = on.variant || "";
      const pin = h("input", { type: "number", placeholder: p ? String(p) : "ціна, ₴", value: on?.price_uah ?? "", onchange: (e) => upd({ price_uah: num(e.target.value) }) });
      box.append(h("div", { class: "acc" + (bad ? " bad" : "") }, h("input", { type: "checkbox", disabled: bad, checked: !!on, onchange: (e) => upd({ on: e.target.checked }) }),
        a.photo ? lbImg(asset(a.photo), null, { alt: a.title }) : h("span"),
        h("div", {}, h("b", {}, a.title), (a.base_for || []).includes(S.kt.id) ? h("span", { class: "badge" }, "базова") : null, a.kp_uses ? h("span", { class: "badge gray", title: "скільки ваших КП згадують цю опцію" }, `у ${a.kp_uses} КП`) : null, h("small", {}, ka.desc), on && vs ? vs : null,
          ka.status === "unconfirmed" ? h("small", {}, "сумісність не підтверджена") : null),
        h("div", { class: "num" }, on ? pin : h("small", {}, p ? uah(p) : "за запитом"))));
    }
  }
}
function quoteInput() {
  const manual = Object.fromEntries(Object.entries(S.manual).filter(([, v]) => v != null));
  const quantities = Object.fromEntries(Object.entries(S.qty).filter(([id, v]) => v != null && core.itemById(cat, id)?.unit));
  return { kit_type: S.kt.id, selection: S.sel, discount_pct: S.discount, manual_prices: manual, kit_price_uah: S.kitPrice, quantities,
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
    const inKit = bundle && r.price_uah == null && r.price_text === "у комплекті";
    const inp = inKit ? h("small", {}, "у комплекті") : h("input", { type: "number", placeholder: "як у налаштуваннях", value: S.manual[r.item_id] ?? "",
      onchange: (e) => { S.manual[r.item_id] = num(e.target.value); renderQuote(); } });
    tb.append(h("tr", {}, h("td", {}, h("b", {}, r.title), h("small", {}, r.desc), inKit ? null : priceInfo("items", r.item_id, S.manual[r.item_id])),
      h("td", { class: "num" }, inKit ? "—" : (S.manual[r.item_id] != null ? h("s", {}, admRowPrice(r.item_id)) : r.price_text)), h("td", { class: "num" }, inp)));
  }
  for (const c of q.choices.filter((c) => c.price_uah)) tb.append(h("tr", {}, h("td", {}, h("b", {}, c.title), h("small", {}, c.value_title)), h("td", { class: "num" }, uah(c.price_uah)), h("td")));
  for (const r of q.accessories) tb.append(h("tr", {}, h("td", {}, h("b", {}, r.title), h("small", {}, "опція"), priceInfo("accessories", r.item_id || r.id)), h("td", { class: "num" }, r.price_text), h("td", { class: "num" }, h("small", {}, "у списку опцій"))));
  if (bundle) {
    const bid = cat.bundles.find((b) => b.id === q.bundle_id);
    $("#kitPriceBox").append(h("label", { class: "inline" }, "Ціна комплекту в налаштуваннях: " + uah(q.kit_price_uah ?? null) + ". Фінальна, ₴:",
      h("input", { type: "number", value: S.kitPrice ?? "", placeholder: "як у налаштуваннях", style: "width:140px", onchange: (e) => { S.kitPrice = num(e.target.value); renderQuote(); } })),
      bid ? priceInfo("bundles", bid.price_of || bid.id, S.kitPrice) : null);
  }
  $("#total").textContent = !q.total_uah ? "за запитом" : q.complete === false ? uah(q.total_uah) + " *" : uah(q.total_uah);
  if (q.complete === false) warn.append(h("li", {}, "* не всі позиції мають ціну — сума неповна"));
  for (const w of q.warnings.filter((w) => !/Курс EUR|індекс металу|опорн/i.test(w))) warn.append(h("li", {}, w));
}
/** «Як рахується ціна»: the fixed price's calculation, its date, and a newer draft price if there is one. */
function priceInfo(kind, id, manual) {
  if (!id) return null;
  const fx = fixedOf(kind, id);
  const src = kind === "items" ? cat0.items.find((x) => x.id === id) || (CA().items?.custom || []).find((x) => x.id === id)
    : kind === "bundles" ? rawBundle(id) : cat0.accessories.find((x) => x.id === id) || (CA().accs?.custom || []).find((x) => x.id === id);
  const d = priceOf(kind, id, src?.price, kind === "items" ? src : null);
  const lines = [...(fx ? fx.lines || [] : d.lines)];
  if (fx) lines.push(`зафіксовано ${core.formatDate(fx.at)}: ${fx.price == null ? "за запитом" : uah(fx.price)}`);
  if (fx && d.price !== fx.price) lines.push(`у налаштуваннях нова ціна ${d.price == null ? "—" : uah(d.price)}, ще не зафіксована`);
  if (manual != null) lines.push(`у цій КП вписано вручну: ${uah(manual)}`);
  if (!lines.length) return null;
  return h("details", { class: "pinfo" }, h("summary", {}, "як рахується ціна"), h("ul", {}, lines.map((l) => h("li", {}, l))));
}
function admRowPrice(itemId) { const it = core.itemById(cat, itemId); return it?.price?.mode === "ref" ? uah(it.price.uah) : "—"; }
function renderStyleChips() {
  const box = $("#styleChips"); const cur = box.dataset.v || admin.style || "dark"; box.innerHTML = "";
  const ok = (s) => !s.kits.length || s.kits.includes(S.kt?.id);
  const pick = B.styles.find((s) => s.id === cur && ok(s)) ? cur : (ok(B.styles.find((s) => s.id === admin.style) || {}) ? admin.style : "dark");
  box.dataset.v = pick;
  for (const s of B.styles) box.append(h("button", { class: "style-chip" + (s.id === pick ? " on" : ""), disabled: !ok(s), title: ok(s) ? s.title : "лише для НПЛ-10 + кран",
    onclick: () => { box.dataset.v = s.id; renderStyleChips(); } }, h("img", { src: `previews/${s.id}.jpg` }), s.title));
}

const CHIP_TEXT = { brakes: "Гальма на вибір", wheels: "Колеса на вибір", drawbar: "Дишло на вибір", pump_type: "Насос на вибір", stakes: "Кількість коників",
  stakes_ext: "Нарощування коників", seat_pos: "Місце оператора" };
/** KpSpec of a quote with the settings: KP photos and their framing, texts, generator layout of copied kits. */
function specFrom(q, meta, style) {
  const spec = core.buildKpSpec(cat, settings, q, meta);
  for (const r of spec.rows) {
    if (!r.item_id) continue;
    const kp = admin.photos.kp_items?.[r.item_id] || admin.photos.items[r.item_id];
    if (kp) { r.photo = kp; r.photo_force = true; }
    const pos = admin.photos.pos?.[r.item_id];
    if (pos && pos.zoom > 1) r.photo_pos = pos;
  }
  const lead = admin.texts.cranes?.[spec.crane?.profile];
  if (spec.crane && lead?.lead) spec.crane.lead = lead.lead;
  if (spec.crane && lead?.lead2) spec.crane.lead2 = lead.lead2;
  if (spec.npl) { if (admin.texts.npl?.lead) spec.npl.lead = admin.texts.npl.lead; if (admin.texts.npl?.lead2) spec.npl.lead2 = admin.texts.npl.lead2; }
  if (admin.texts.price_note) spec.price_note = admin.texts.price_note;
  const kt = core.kitTypeById(cat, q.kit_type);
  if (kt?.extends) spec.kit_type = kt.extends;   // a kit copied in the settings is laid out like its source
  if (spec.kit_type === "npl_crane" && kt) {     // «+ опції для апгрейду» on the configuration page: the kit's choices as set in the settings
    const chips = kt.choices.filter((ch) => ch.slot !== "crane" && ch.options.length > 1).map((ch) => CHIP_TEXT[ch.id] || ch.title);
    chips.push("Колір на замовлення");
    if (spec.accessories?.length) chips.push("Опції для крана: с. {opt}", "Опції для причепа: с. {opt}");
    spec.upgrade_chips = chips.length > 8 ? [...chips.slice(0, 8 - (spec.accessories?.length ? 2 : 0)), ...(spec.accessories?.length ? chips.slice(-2) : [])] : chips;
  }
  spec.style = style;
  return spec;
}
async function generate(asNew) {
  if (!lastQuote) return toast("Спершу виправте комплект");
  const qi = quoteInput();
  const errs = core.validateSelection(cat, qi);
  if (errs.length) return toast(errs[0]);
  let spec;
  try {
    spec = specFrom(lastQuote, { number: $("#kpNumber").value || "0001",
      client: { name: $("#client").value.trim() || "Назва замовника", contact: $("#clientContact").value.trim() },
      offer_accessories: $("#offerAcc").checked }, $("#styleChips").dataset.v || "dark");
  } catch (e) { return toast((e.errors || [String(e)])[0]); }
  const state = { kit_type: S.kt.id, selection: S.sel, manual: S.manual, kitPrice: S.kitPrice, discount: S.discount, qty: S.qty, preset: S.preset,
    number: $("#kpNumber").value, date: $("#kpDate").value, client: $("#client").value, contact: $("#clientContact").value, style: spec.style, offerAcc: $("#offerAcc").checked };
  const btn = $("#gen"), res = $("#genResult");
  btn.disabled = true; $("#genNew").disabled = true; btn.innerHTML = '<span class="spin"></span>Створюю КП… (PDF — до хвилини)'; res.innerHTML = "";
  try {
    const r = await api("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spec, state, history_id: asNew ? null : S.historyId }) });
    const ok = r.pptx;
    res.append(h("div", { class: "result" + (ok ? "" : " err") },
      ok ? h("div", {}, r.pdf ? h("a", { href: r.pdf, target: "_blank" }, "Відкрити PDF") : "PDF не створено (немає LibreOffice?)",
        h("a", { href: r.pptx }, "Завантажити PPTX"), h("small", {}, `${r.pages} стор.`)) : h("b", {}, "КП не створено"),
      ...(r.messages || []).map((m) => h("div", {}, h("small", {}, m.replace(/^kpgen: /, ""))))));
    if (ok) {
      if (!S.historyId || asNew) {
        admin.kp_counter = (parseInt($("#kpNumber").value, 10) || admin.kp_counter || 1) + 1;
        await saveAdmin(true);
      }
      if (S.historyId && !asNew) S.historyId = r.history_id; else endEdit(true);
      editBanner();
    }
  } catch (e) { res.append(h("div", { class: "result err" }, e.message)); }
  btn.disabled = false; $("#genNew").disabled = false; editBanner();
}
function editBanner() {
  const b = $("#editBanner");
  b.hidden = !S.historyId; $("#genNew").hidden = !S.historyId;
  $("#gen").textContent = S.historyId ? "Оновити цю КП (PPTX + PDF)" : "Створити КП (PPTX + PDF)";
  if (S.historyId) { b.innerHTML = ""; b.append(h("span", {}, `Редагуєте КП № ${$("#kpNumber").value}. «Оновити» замінить її в історії, «Зберегти як нову» — створить окрему.`), h("button", { class: "sm", onclick: () => endEdit(false) }, "Скасувати редагування")); }
}
function endEdit(keepForm) {
  S.historyId = null;
  if (!keepForm) { $("#client").value = ""; $("#clientContact").value = ""; $("#kpDate").value = core.todayIso(); $("#genResult").innerHTML = ""; }
  $("#kpNumber").value = String(admin.kp_counter || 1).padStart(4, "0");
  editBanner();
}
function loadState(entry) {
  const st = entry.state;
  if (!core.kitTypeById(cat, st.kit_type)) return toast("Такого комплекту вже немає в каталозі");
  S.kt = core.kitTypeById(cat, st.kit_type);
  S.sel = core.reconcileSelection(cat, st.kit_type, st.selection);
  Object.assign(S, { manual: st.manual || {}, kitPrice: st.kitPrice ?? null, discount: st.discount || 0, qty: st.qty || {}, preset: st.preset || null, historyId: entry.id });
  $("#kpNumber").value = st.number || entry.number || ""; $("#kpDate").value = st.date || core.todayIso();
  $("#client").value = st.client || ""; $("#clientContact").value = st.contact || ""; $("#discount").value = S.discount;
  $("#offerAcc").checked = st.offerAcc !== false; $("#styleChips").dataset.v = st.style || entry.style; $("#genResult").innerHTML = "";
  tab("conf"); editBanner();
}

// ------------------------------------------------------------------ history
async function renderHist() {
  let list;
  try { list = await api("/api/history"); } catch (e) { list = B.history || []; }
  const st = Object.fromEntries(B.styles.map((s) => [s.id, s.title]));
  const box = $("#histList"); const qv = ($("#histSearch").value || "").toLowerCase();
  $("#histSearch").oninput = () => renderHist();
  box.innerHTML = "";
  const shown = list.filter((x) => !qv || JSON.stringify([x.number, x.client, x.title, x.kit, x.contact, x.note]).toLowerCase().includes(qv));
  for (const x of shown) {
    const cover = x.cover || `previews/${x.style}.jpg`;
    box.append(h("div", { class: "hcard" },
      lbImg(cover, x.cover ? [{ src: x.cover, label: "Титулка" }] : null, { class: "cover", alt: `КП № ${x.number}` }),
      h("div", {}, h("div", { class: "no" }, `КП № ${x.number || "—"} · ${x.date || x.time}`),
        h("div", { class: "tt" }, x.title || ""),
        h("div", { class: "client" }, x.client || "—", x.contact ? h("span", { class: "meta" }, " · " + x.contact) : null),
        x.kit?.length ? h("ul", {}, x.kit.slice(0, 6).map((k) => h("li", {}, k)), x.options?.length ? h("li", {}, `опції: ${x.options.length}`) : null) : null,
        x.note ? h("div", { class: "meta" }, x.note) : null,
        h("div", { class: "meta" }, `${st[x.style] || x.style} · створено ${x.time}` + (x.edited_from ? ` (оновлено)` : "")),
        h("div", { class: "sum" }, x.total || ""),
        h("div", { class: "acts" },
          x.pdf ? h("a", { href: x.pdf, target: "_blank" }, h("button", { class: "sm primary" }, "PDF")) : null,
          x.pptx ? h("a", { href: x.pptx }, h("button", { class: "sm" }, "PPTX")) : null,
          h("button", { class: "sm", disabled: !x.state, title: x.state ? "" : "КП з першої версії програми: відкрити для редагування не можна", onclick: () => loadState(x) }, "Редагувати"),
          h("button", { class: "sm", disabled: !x.state, onclick: () => recalcDialog(x) }, "Перерахувати"),
          h("button", { class: "sm", onclick: () => editHist(x) }, "Дані"),
          h("button", { class: "sm danger", onclick: () => confirmBox(`Видалити КП № ${x.number} (${x.client || "без замовника"})? Файли PPTX і PDF теж буде видалено.`, "Видалити",
            async () => { await api("/api/history/" + x.id, { method: "DELETE" }); toast("КП видалено"); renderHist(); }) }, "Видалити")))));
  }
  if (!shown.length) box.append(h("div", { class: "empty" }, list.length ? "Нічого не знайдено." : "Ще немає КП. Створіть першу в конфігураторі."));
}
/** Preview of a history KP with today's fixed prices; «Оновити» regenerates it in place. */
function recalcDialog(x) {
  cat = effCatalog();
  const r = recalcEntry(x);
  if (!r.q) return toast("Не вдалося перерахувати: " + r.err);
  const d = r.oldTotal != null && r.newTotal != null ? r.newTotal - r.oldTotal : null;
  const st = h("p", { class: "hint" });
  modal(h("div", { class: "form" }, h("h2", {}, `КП № ${x.number}: нові ціни`),
    h("table", { class: "prices" }, h("tbody", {}, r.q.rows.map((row) => h("tr", {}, h("td", {}, row.title), h("td", { class: "num" }, row.price_text))),
      r.q.kit_price_uah != null ? h("tr", {}, h("td", {}, "Ціна комплекту"), h("td", { class: "num" }, uah(r.q.kit_price_uah))) : null,
      h("tr", {}, h("td", {}, h("b", {}, "Було в КП")), h("td", { class: "num" }, x.total || "—")),
      h("tr", {}, h("td", {}, h("b", {}, "Стане")), h("td", { class: "num" }, h("b", {}, r.newText), d ? h("small", { class: d > 0 ? "plus" : "minus", style: "display:block" }, (d > 0 ? "+" : "−") + core.formatUah(Math.abs(d))) : null)))),
    st, h("div", { class: "acts" }, h("button", { onclick: closeModal }, "Закрити"), h("button", { class: "primary", onclick: async (e) => {
      e.target.disabled = true; st.textContent = "Оновлюю КП… PDF — до хвилини";
      try { await regenerateEntry(x, r.q, r.sel); closeModal(); toast("КП оновлено"); renderHist(); } catch (err) { st.textContent = err.message; e.target.disabled = false; }
    } }, "Оновити КП за новими цінами"))));
}
function editHist(x) {
  const f = {};
  const field = (k, label, type = "text") => h("label", {}, label, f[k] = h(type === "area" ? "textarea" : "input", { type: type === "area" ? null : type, value: x[k] || "" }));
  modal(h("div", { class: "form" }, h("h2", {}, `Дані КП № ${x.number}`), field("client", "Замовник"), field("contact", "Контакт"), field("number", "Номер"),
    field("date", "Дата (як у КП)"), field("note", "Примітка", "area"),
    h("p", { class: "hint" }, "Ці дані змінюються в історії. Щоб змінити саму КП (склад, ціни, замовника у файлі), натисніть «Редагувати»."),
    h("div", { class: "acts" }, h("button", { onclick: closeModal }, "Скасувати"), h("button", { class: "primary", onclick: async () => {
      const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
      await api("/api/history/" + x.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      closeModal(); toast("Збережено"); renderHist(); } }, "Зберегти"))));
}

// ------------------------------------------------------------------ settings: saving, photo versions
let saveT;
async function saveAdmin(now = false, note = "") {
  clearTimeout(saveT);
  const go = async () => {
    await api("/api/admin", { method: "PUT", headers: { "Content-Type": "application/json", ...(note ? { "X-Snapshot-Note": encodeURIComponent(note) } : {}) }, body: JSON.stringify(admin) });
    $("#savedMark").textContent = "✓ Збережено " + new Date().toLocaleTimeString("uk-UA").slice(0, 5);
    cat = effCatalog();
  };
  if (now) return go();
  saveT = setTimeout(go, 500);
}
async function upload(file) {
  const r = await api("/api/upload", { method: "POST", headers: { "X-Filename": encodeURIComponent(file.name) }, body: file });
  return r.path;
}
function filePick(cb) {
  const i = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", style: "display:none" });
  i.onchange = async () => { if (i.files[0]) { try { toast("Завантажую фото…"); await cb(await upload(i.files[0])); } catch (e) { toast(e.message); } } };
  document.body.append(i); i.click(); setTimeout(() => i.remove(), 60000);
}
/** Previous values of a photo slot (newest first); the value being replaced goes in. */
function remember(key, old) {
  if (!old || !(old.path || typeof old === "string")) return;
  const v = typeof old === "string" ? { path: old } : structuredClone(old);
  const hist = (admin.photo_history[key] ??= []);
  if (hist[0] && hist[0].path === v.path) return;
  hist.unshift({ ...v, at: nowStr() });
  if (hist.length > 15) hist.length = 15;
}
/** Versions dialog: current + previous photos, «Повернути» swaps them. thumb(v) -> preview url. */
function versionsDialog(title, key, current, thumb, restore) {
  const hist = admin.photo_history[key] || [];
  modal(h("h2", {}, title), h("p", { class: "hint" }, "Попередні фото цієї позиції. «Повернути» ставить фото назад, а поточне переходить у версії."),
    h("div", { class: "vers" },
      h("div", { class: "v cur" }, current ? lbImg(thumb(current), [{ src: thumb(current), label: "Як у КП" }, { src: asset(current.path), label: "Оригінал" }]) : h("div", { class: "thumb none", style: "width:100%;height:120px" }, "фото шаблону"), h("b", {}, "Зараз")),
      hist.map((v, i) => h("div", { class: "v" }, lbImg(thumb(v), [{ src: thumb(v), label: "Як у КП" }, { src: asset(v.path), label: "Оригінал" }]), v.at || "",
        h("div", { class: "inline", style: "justify-content:center" }, h("button", { class: "sm primary", onclick: () => {
          hist.splice(i, 1); if (current) remember(key, current); restore(v); saveAdmin(); closeModal(); toast("Фото повернуто"); } }, "Повернути"),
          h("button", { class: "sm danger", title: "Видалити з версій", onclick: () => { hist.splice(i, 1); saveAdmin(); versionsDialog(title, key, current, thumb, restore); } }, "×"))))),
    hist.length ? null : h("p", { class: "hint" }, "Попередніх фото ще немає."));
}

// ------------------------------------------------------------------ settings: look of the KP
const stAdm = (style) => (admin.styles[style] ??= { bg: {}, texts: {} });
let admStyle = null;
function initAdmin() {
  admStyle = admin.style || "dark";
  renderStyleCards();
}
function styleSeg(onPick) {
  for (const box of $$(".admStyle")) {
    box.innerHTML = "";
    for (const s of B.styles) box.append(h("button", { class: admStyle === s.id ? "on" : "", onclick: () => { admStyle = s.id; onPick(); } }, s.title));
  }
}
function renderStyleCards() {
  const box = $("#styleCards"); box.innerHTML = "";
  for (const s of B.styles) box.append(h("div", { class: "stylecard" + (admin.style === s.id ? " on" : "") },
    lbImg(`previews/${s.id}.jpg`, null, { alt: s.title }), h("b", {}, s.title), h("small", {}, s.kits.length ? "лише НПЛ-10 + кран" : "усі комплекти з краном"),
    h("button", { class: "use" + (admin.style === s.id ? " primary" : ""), onclick: () => { admin.style = s.id; $("#styleChips").dataset.v = ""; saveAdmin(); renderStyleCards(); renderStyleChips(); } },
      admin.style === s.id ? "✓ За замовчуванням" : "Зробити основним")));
}
function bgPreview(style, page, o) {
  return `/api/preview/page?${qs({ style, page, path: o.path, fx: o.fx ?? 0.5, fy: o.fy ?? 0.45, opacity: o.opacity ?? 0.18 })}`;
}
function renderBg() {
  styleSeg(renderBg);
  const style = admStyle, st = B.styles.find((s) => s.id === style), A = stAdm(style);
  const box = $("#bgList"); box.innerHTML = "";
  for (const p of st.pages) {
    const o = A.bg[p.key], key = `bg:${style}:${p.key}`;
    const src = o?.path ? bgPreview(style, p.key, o) : `/api/bg?style=${style}&page=${p.key}`;
    const busy = h("div", { class: "busy", hidden: true }, "обробляю фото…");
    const img = lbImg(src, o?.path ? [{ src, label: "Як у КП" }, { src: asset(o.path), label: "Оригінал" }] : null, { alt: p.title });
    img.onload = () => (busy.hidden = true);
    const refresh = () => { busy.hidden = false; const s2 = bgPreview(style, p.key, o); img.src = s2; img.dataset.lb = JSON.stringify([{ src: s2, label: "Як у КП" }, { src: asset(o.path), label: "Оригінал" }]); };
    const slider = (k, lab, min, max, def, fmt) => {
      const out = h("span", {}, fmt(o[k] ?? def));
      return h("div", { class: "row" }, h("span", { style: "width:92px" }, lab), h("input", { type: "range", min, max, step: 0.05, value: o[k] ?? def,
        oninput: (e) => { o[k] = Number(e.target.value); out.textContent = fmt(o[k]); }, onchange: () => { saveAdmin(); refresh(); } }), out);
    };
    const pct = (v) => Math.round(v * 100) + " %";
    const rows = o?.path ? [p.hero ? null : slider("opacity", "видимість фото", 0.05, 1, 0.18, pct), slider("fx", "фокус ↔", 0, 1, 0.5, pct), slider("fy", "фокус ↕", 0, 1, 0.45, pct)] : [];
    const nh = (admin.photo_history[key] || []).length;
    box.append(h("div", { class: "bgitem" }, h("div", { class: "pv" }, img, o?.path ? lbImg(asset(o.path), null, { class: "orig", alt: "оригінал" }) : null, busy),
      h("div", { class: "ttl" }, p.title, o?.path ? h("span", { class: "badge" }, "своє фото") : null),
      h("small", {}, p.hero ? "фото на всю сторінку, обробка під стиль" : "фото вплітається у фон сторінки"),
      h("div", { class: "row" }, h("button", { class: "sm primary", onclick: () => filePick((path) => { remember(key, o); A.bg[p.key] = { path, opacity: o?.opacity ?? (p.hero ? 0.18 : 0.3), fx: 0.5, fy: 0.45 }; saveAdmin(); renderBg(); }) }, o?.path ? "Інше фото" : "Завантажити фото"),
        h("button", { class: "sm", disabled: !nh && !o?.path, onclick: () => versionsDialog(`${p.title}: версії фото`, key, o?.path ? o : null, (v) => bgPreview(style, p.key, v), (v) => { A.bg[p.key] = { path: v.path, opacity: v.opacity, fx: v.fx, fy: v.fy }; renderBg(); }) }, `Версії${nh ? ` (${nh})` : ""}`),
        o?.path ? h("button", { class: "sm danger", onclick: () => { remember(key, o); delete A.bg[p.key]; saveAdmin(); renderBg(); } }, "Скинути") : null), ...rows));
  }
}
const textsCache = {};
async function renderTexts() {
  styleSeg(renderTexts);
  const style = admStyle, A = stAdm(style), box = $("#textsBox");
  if (!textsCache[style]) {
    box.innerHTML = "<p class='hint'>Читаю шаблон стилю (перший раз до 30 с)…</p>";
    try { textsCache[style] = await api("/api/texts?style=" + style); } catch (e) { box.textContent = e.message; return; }
  }
  if (admStyle !== style) return;
  box.innerHTML = "";
  for (const [key, pg] of Object.entries(textsCache[style])) {
    if (!pg.texts.length) continue;
    const ov = (A.texts[key] ??= {});
    const n = Object.values(ov).filter(Boolean).length;
    box.append(h("details", { class: "page-texts" }, h("summary", {}, pg.title, n ? h("span", { class: "badge" }, `змінено: ${n}`) : h("span", { class: "badge gray" }, `${pg.texts.length} текст.`)),
      pg.texts.map((t) => h("div", { class: "tx" }, h("pre", {}, t.text),
        h("textarea", { placeholder: "як у шаблоні", rows: Math.min(4, t.text.split("\n").length + 1), oninput: (e) => {
          if (e.target.value.trim()) ov[t.id] = e.target.value; else delete ov[t.id]; saveAdmin(); } }, ov[t.id] || "")))));
  }
  renderTermsLeads();
}
function renderTermsLeads() {
  const tb = $("#termsBox"); tb.innerHTML = "";
  for (const t of cat0.texts.terms) {
    const o = (admin.texts.terms[t.id] ??= {});
    tb.append(h("div", { class: "term" }, h("input", { value: o.title || "", placeholder: t.title, oninput: (e) => { o.title = e.target.value; saveAdmin(); } }),
      h("textarea", { placeholder: t.text, oninput: (e) => { o.text = e.target.value; saveAdmin(); } }, o.text || "")));
  }
  const lb = $("#leadsBox"); lb.innerHTML = "";
  const block = (title, d, o) => h("div", { class: "card" }, h("h3", {}, title),
    [["lead", "Головний опис"], ["lead2", "Додатковий опис"]].map(([k, lab]) => h("label", {}, lab,
      h("textarea", { rows: 3, placeholder: d[k], oninput: (e) => { o[k] = e.target.value; saveAdmin(); } }, o[k] || ""))));
  for (const [prof, d] of Object.entries(B.defaults.cranes)) lb.append(block(prof.toUpperCase().replace("BMF", "BMF "), d, (admin.texts.cranes[prof] ??= {})));
  lb.append(block("НПЛ-10", B.defaults.npl, admin.texts.npl));
}

// ------------------------------------------------------------------ settings: labels, switches, cover sight
const PAGE_W = 8.27, PAGE_H = 11.69;
let coversCache = null, sightCover = null;
function layoutAdm() {
  admin.layout ??= {};
  for (const k of ["show", "text", "sight", "contacts"]) admin.layout[k] ??= {};
  return admin.layout;
}
async function renderLayout() {
  const L = layoutAdm(), D = B.defaults.layout, box = $("#layoutBox");
  box.innerHTML = "";
  const sw = (k, label) => h("label", { class: "chk" }, h("input", { type: "checkbox", checked: L.show[k] ?? D.show[k],
    onchange: (e) => { if (e.target.checked === D.show[k]) delete L.show[k]; else L.show[k] = e.target.checked; saveAdmin(); if (k === "sight") drawSight(); } }), label);
  const tx = (k, label, multi) => h("label", {}, label, h(multi ? "textarea" : "input", { rows: multi ? 2 : undefined, value: L.text[k] || "",
    placeholder: D.text[k], oninput: (e) => { if (e.target.value.trim()) L.text[k] = e.target.value; else delete L.text[k]; saveAdmin(); if (k === "sight_title") drawSight(); } }));
  const card = (title, ...kids) => h("div", { class: "card lay-card" }, h("h2", {}, title), ...kids);
  const sws = (...x) => h("div", { class: "lay-sw" }, ...x);

  const stage = h("div", { class: "sight-stage", id: "sightStage" });
  const sel = h("select", { id: "sightCover", onchange: (e) => { sightCover = e.target.value; drawSight(); } });
  const nums = h("div", { class: "sight-nums", id: "sightNums" });
  box.append(card("Титулка",
    sws(sw("kp_no", "№ КП"), sw("kp_date", "Дата"), sw("frames", "Рамки по кутах"), sw("sight", "Приціл"), sw("client", "«Підготовлено для»")),
    tx("kp_title", "Заголовок над номером"), tx("cover_kicker", "Мітка зверху (кран)"), tx("cover_kicker_trailer", "Мітка зверху (НПЛ-10, причепи)"),
    tx("sight_title", "Напис прицілу"), tx("client_label", "Напис над замовником")));
  box.append(card("Приціл на титулці",
    h("p", { class: "hint" }, "Тягніть рамку, щоб пересунути; тягніть край чи кут, щоб розтягнути. Помаранчевий круг у центрі лишається того ж розміру. Положення своє для кожного фото титулки."),
    h("label", {}, "Фото титулки", sel), h("div", { class: "sight-wrap" }, stage, h("div", {}, nums,
      h("div", { class: "row" }, h("button", { class: "sm", onclick: () => { const b = curSight(); L.sight = { "*": b }; saveAdmin(); drawSight(); toast("Приціл однаковий на всіх титулках"); } }, "На всі титулки"),
        h("button", { class: "sm", onclick: () => { delete L.sight[sightCover]; saveAdmin(); drawSight(); } }, "Скинути"))))));
  box.append(card("Низ сторінок",
    sws(sw("footer", "Сайт і телефон"), sw("footer_label", "Підпис справа")),
    tx("footer", "Сайт і телефон ({сайт}, {телефон} підставляються з контактів)"), tx("footer_label", "Підпис справа на сторінках крана")));
  box.append(card("Назви розділів (номер «// 01 —» ставиться сам)", h("div", { class: "lay-cols" },
    tx("sec_manifest", "Кран: маніфест"), tx("sec_crane_in_kit", "Кран у комплекті з причепом"), tx("sec_anatomy", "Конструкція"),
    tx("sec_passport", "Технічний паспорт"), tx("sec_passport_in_kit", "Паспорт крана в комплекті з причепом"),
    tx("sec_trailer_npl", "НПЛ-10"), tx("sec_trailer", "Причіп BMF"), tx("sec_trailer_spec", "Габарити причепа"),
    tx("sec_config", "Конфігурація"), tx("sec_options", "Додаткові опції"), tx("sec_price", "Вартість"),
    tx("sec_maker", "Виробник BMF"), tx("sec_own", "Власне виробництво"))));
  box.append(card("Підписи",
    sws(sw("module", "«Модуль 01» на плитках"), sw("term", "Номери умов «T-01»")),
    tx("module", "Підпис плиток (номер додається)"), tx("term", "Префікс номера умови"),
    tx("passport_note", "Примітка під паспортом ({вага} — вага крана)", true), tx("anatomy_note", "Примітка на сторінці конструкції"),
    tx("maker_badge", "Мітка на фото виробника BMF"), tx("own_badge", "Мітка на фото власного виробництва"),
    tx("maker_gallery", "Підпис галереї BMF"), tx("own_gallery", "Підпис галереї власного виробництва")));
  const co = cat0.companies?.find((c) => c.id === settings.company_maker) || cat0.companies?.[0] || {};
  const ct = (k, label, multi, def) => h("label", {}, label, h(multi ? "textarea" : "input", { rows: multi ? 2 : undefined, value: L.contacts[k] || "",
    placeholder: def, oninput: (e) => { if (e.target.value.trim()) L.contacts[k] = e.target.value; else delete L.contacts[k]; saveAdmin(); } }));
  box.append(card("Контакти (остання сторінка, усі стилі)",
    h("div", { class: "lay-2" }, tx("lbl_phone", "Підпис"), ct("phones", "Телефони (кожен з нового рядка)", true, (co.phones || []).join("\n"))),
    h("div", { class: "lay-2" }, tx("lbl_email", "Підпис"), ct("email", "E-mail", false, co.email || "")),
    h("div", { class: "lay-2" }, tx("lbl_site", "Підпис"), ct("sites", "Сайти (кожен з нового рядка)", true, (co.sites || []).join("\n"))),
    h("div", { class: "lay-2" }, tx("lbl_address", "Підпис"), ct("address", "Адреса (новий рядок — перенос)", true, co.address || "")),
    h("div", { class: "lay-2" }, tx("lbl_socials", "Підпис"), ct("socials", "Соцмережі (кожна з нового рядка)", true, (co.socials || []).join("\n"))),
    h("div", { class: "lay-2" }, tx("lbl_production", "Підпис"), tx("production", "Текст (до 3 рядків)", true))));
  if (!coversCache) { try { coversCache = await api("/api/covers"); } catch (e) { coversCache = []; } }
  sel.innerHTML = "";
  for (const c of coversCache) sel.append(h("option", { value: c.key }, c.title + (L.sight[c.key] ? " ✎" : "")));
  if (!coversCache.some((c) => c.key === sightCover)) sightCover = coversCache[0]?.key || "template";
  sel.value = sightCover;
  drawSight();
}
function curSight() {
  const L = layoutAdm(), d = B.defaults.layout.sight;
  return { ...(L.sight[sightCover] || L.sight["*"] || d) };
}
function drawSight() {
  const stage = $("#sightStage"); if (!stage) return;
  const L = layoutAdm(), D = B.defaults.layout, c = (coversCache || []).find((x) => x.key === sightCover);
  const style = ["dark", "light_v3"].includes(admin.style) ? admin.style : "dark";
  const src = !c || !c.path ? `/api/bg?style=${style}&page=cover` : `/api/preview/page?style=${style}&page=cover&path=${encodeURIComponent(c.path)}&fx=${c.fx}&fy=${c.fy}`;
  stage.innerHTML = "";
  stage.append(h("img", { src, alt: "титулка", draggable: false }));
  const on = L.show.sight ?? D.show.sight;
  const b = curSight();
  const frame = h("div", { class: "sight-frame" + (on ? "" : " off") }, h("i", { class: "ring" }),
    ...["tl", "tr", "bl", "br"].map((k) => h("b", { class: "c " + k })),
    ...["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((k) => h("span", { class: "hd " + k, "data-dir": k })));
  const label = h("div", { class: "sight-label" + (on ? "" : " off") }, h("b", {}, L.text.sight_title || D.text.sight_title), h("small", {}, "BMF 720 · 7,2 M · 60 KNM"));
  stage.append(frame, label);
  const place = () => {
    const pct = (v, W) => (v / W * 100) + "%";
    Object.assign(frame.style, { left: pct(b.x, PAGE_W), top: pct(b.y, PAGE_H), width: pct(b.w, PAGE_W), height: pct(b.h, PAGE_H) });
    const rw = 1.77, right = b.x + b.w + 0.25 + rw <= PAGE_W - 0.2;
    const lx = right ? b.x + b.w + 0.25 : Math.max(0.2, b.x - 0.25 - rw);
    Object.assign(label.style, { left: pct(lx, PAGE_W), top: pct(b.y + 0.02, PAGE_H), width: pct(rw, PAGE_W) });
    const cm = (v) => (v * 2.54).toFixed(1).replace(".", ",");
    $("#sightNums").innerHTML = `<small>Ліворуч ${cm(b.x)} см · зверху ${cm(b.y)} см<br>Ширина ${cm(b.w)} см · висота ${cm(b.h)} см</small>`;
  };
  place();
  if (!on) return;
  const clamp = () => {
    b.w = Math.max(0.4, Math.min(b.w, PAGE_W - 0.4)); b.h = Math.max(0.4, Math.min(b.h, PAGE_H - 0.4));
    b.x = Math.max(0.2, Math.min(b.x, PAGE_W - 0.2 - b.w)); b.y = Math.max(0.2, Math.min(b.y, PAGE_H - 0.2 - b.h));
  };
  frame.onpointerdown = (ev) => {
    ev.preventDefault(); frame.setPointerCapture(ev.pointerId);
    const dir = ev.target.dataset?.dir || "move", r = stage.getBoundingClientRect(), k = PAGE_W / r.width;
    const sx = ev.clientX, sy = ev.clientY, o = { ...b };
    frame.onpointermove = (e) => {
      const dx = (e.clientX - sx) * k, dy = (e.clientY - sy) * k;
      if (dir === "move") { b.x = o.x + dx; b.y = o.y + dy; }
      else {
        if (dir.includes("e")) b.w = o.w + dx;
        if (dir.includes("s")) b.h = o.h + dy;
        if (dir.includes("w")) { b.w = o.w - dx; b.x = o.x + dx; if (b.w < 0.4) { b.x -= 0.4 - b.w; } }
        if (dir.includes("n")) { b.h = o.h - dy; b.y = o.y + dy; if (b.h < 0.4) { b.y -= 0.4 - b.h; } }
      }
      clamp(); place();
    };
    frame.onpointerup = () => {
      frame.onpointermove = frame.onpointerup = null;
      const r2 = (v) => Math.round(v * 100) / 100;
      L.sight[sightCover] = { x: r2(b.x), y: r2(b.y), w: r2(b.w), h: r2(b.h) }; saveAdmin();
      const opt = $("#sightCover")?.selectedOptions[0]; if (opt && !opt.textContent.endsWith(" ✎")) opt.textContent += " ✎";
    };
  };
}

// ------------------------------------------------------------------ settings: catalog — kits and branches
let edKit = "crane_kit";
const ovOf = (root, id) => { const r = (CA()[root] ??= {}); return id === undefined ? r : (r[id] ??= {}); };
function moveIn(ovObj, ids, id, dir) {
  const order = [...ids]; const i = order.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]]; ovObj.order = order;
}
/** Item title; items that share a title (a base per crane) get the crane they fit. */
function itemLabel(it, list) {
  if (!it) return "";
  if (list.filter((x) => x?.title === it.title).length < 2) return it.title;
  const fits = (it.compatible || []).map((id) => core.itemById(cat, id)?.model).filter(Boolean);
  return fits.length ? `${it.title} · для ${fits.join(", ")}` : `${it.title} · ${it.id}`;
}
/** Photo cell: thumbnail (click = view), ✎ uploads a new photo (the old one goes to versions), ↺ opens versions, × clears (when clear given). */
function photoCell({ key, path, title, set, kind = "tile", rerender, clear, label }) {
  const nh = (admin.photo_history[key] || []).length;
  const pv = (p) => `/api/preview/item?${qs({ style: admin.style || "dark", path: p, kind })}`;
  return h("div", { class: "pcell" + (path ? "" : " empty") },
    label ? h("span", { class: "pc-l" }, label) : null,
    path ? lbImg(asset(path), [{ src: asset(path), label: "Оригінал" }, { src: pv(path), label: "Як у КП" }], { alt: title })
      : h("button", { class: "add", title: "Додати фото", onclick: () => filePick((p) => { set(p); saveAdmin(); rerender(); }) }, "＋ фото"),
    path ? h("div", { class: "pc-acts" },
      h("button", { title: "Інше фото", onclick: () => filePick((p) => { remember(key, { path }); set(p); saveAdmin(); rerender(); }) }, "✎"),
      nh ? h("button", { title: "Версії фото", onclick: () => versionsDialog(`${title}: версії фото`, key, { path }, (v) => pv(v.path), (v) => { set(v.path); rerender(); }) }, "↺" + nh) : null,
      clear ? h("button", { title: "Прибрати своє фото", onclick: () => { remember(key, { path }); clear(); saveAdmin(); rerender(); } }, "×") : null) : null);
}
const rawKit = (id) => cat0.kit_types.find((k) => k.id === id) || (CA().kit_types?.custom || []).find((k) => k.id === id);
const KTov = () => (CA().kit_types ??= {});
function setKitEdit(id, patch) {
  const K = KTov(), custom = (K.custom || []).find((k) => k.id === id);
  if (custom) Object.assign(custom, patch); else Object.assign(((K.edits ??= {})[id] ??= {}), patch);
}
/** Raw choices of a kit with its settings (added, switched off with _off, order). */
function kitChoicesRaw(id) {
  const raw = rawKit(id); if (!raw) return [];
  return overlay(raw.choices, CA().kits?.[id]?.choice_ov, "id", true);
}
function renderKitEditor() {
  cat = effCatalog();
  const kits = allKitTypes();
  if (!kits.some((k) => k.id === edKit)) edKit = kits[0].id;
  const seg = $("#kitSeg"); seg.innerHTML = "";
  for (const k of kits) seg.append(h("button", { class: (edKit === k.id ? "on" : "") + (k.disabled ? " off" : ""), title: k.disabled ? "вимкнено" : "",
    onclick: () => { edKit = k.id; renderKitEditor(); } }, kitName(k), k.copy_of ? h("i", { class: "cp" }, "гілка") : null));
  const kt0 = rawKit(edKit), kt = core.kitTypeById(cat, edKit), K = ovOf("kits", edKit);
  const box = $("#kitEditor"); box.innerHTML = "";
  // the kit itself: photo of the category, name, on/off, copy into a new branch
  const src = kt.copy_of ? allKitTypes().find((x) => x.id === kt.copy_of) : null;
  const root = cat0.kit_types.find((x) => x.id === (kt.extends || kt.id));
  box.append(h("div", { class: "sec-card kit-head" },
    photoCell({ key: "kit:" + edKit, path: admin.photos.kits[edKit], title: kitName(kt), label: "фото комплекту", set: (p) => { admin.photos.kits[edKit] = p; },
      clear: () => { delete admin.photos.kits[edKit]; }, rerender: renderKitEditor }),
    h("div", { class: "ed-main" },
      h("input", { value: kitName(kt), style: "font-weight:700;font-size:16px", onchange: (e) => { setKitEdit(edKit, { title: e.target.value.trim() || kt.title }); saveAdmin(); renderKitEditor(); } }),
      h("small", { class: "hint", style: "margin:0" }, `${kt.slots.length} позицій · ${kt.choices.length} виборів · ${kt.price_display === "bundle" ? "одна ціна комплекту" : "ціна по рядках"}`
        + (kt.copy_of ? ` · гілка з «${kitName(src) || kt.copy_of}», КП будується як «${kitName(root)}»` : "")),
      h("p", { class: "hint", style: "margin:4px 0 0" }, "Фото комплекту показується на вкладці комплекту в конфігураторі та в «Збірці гілками».")),
    h("div", { class: "ed-side" },
      h("label", { class: "toggle" }, h("input", { type: "checkbox", checked: !kt.disabled, onchange: (e) => { setKitEdit(edKit, { disabled: !e.target.checked }); saveAdmin(); renderKitEditor(); } }),
        kt.disabled ? "вимкнено" : "увімкнено"),
      h("button", { class: "sm primary", onclick: () => copyKitDialog(kt) }, "⎘ Копіювати в нову гілку"),
      kt.copy_of ? h("button", { class: "sm danger", onclick: () => confirmBox(`Видалити гілку «${kitName(kt)}»? Створені в ній КП лишаться в історії.`, "Видалити", () => {
        const KO = KTov(); KO.custom = (KO.custom || []).filter((x) => x.id !== edKit); delete CA().kits?.[edKit]; delete admin.photos.kits[edKit];
        saveAdmin(true, "видалено гілку " + kitName(kt)); edKit = "crane_kit"; renderKitEditor(); }) }, "Видалити гілку") : null)));

  // positions
  const ids = kt.slots.map((s) => s.id);
  const list = h("div", { class: "ed-list" });
  for (const s of kt.slots) {
    const it = core.itemById(cat, s.default || s.candidates[0]);
    const custom = (K.custom || []).some((x) => x.id === s.id);
    const isTitle = (kt0.title_slots || []).includes(s.id);
    const base = !!s.default || s.required;
    const set = (patch) => { const e = ((K.edits ??= {})[s.id] ??= {}); Object.assign(e, patch); if (custom) Object.assign(K.custom.find((x) => x.id === s.id), patch); saveAdmin(); renderKitEditor(); };
    list.append(h("div", { class: "ed-row" + (base ? "" : " off") },
      h("div", { class: "ord" }, h("button", { title: "вище", onclick: () => { moveIn(K, ids, s.id, -1); saveAdmin(); renderKitEditor(); } }, "▲"), h("button", { title: "нижче", onclick: () => { moveIn(K, ids, s.id, 1); saveAdmin(); renderKitEditor(); } }, "▼")),
      photoCell({ key: "item:" + it?.id, path: it?.photo, title: s.title, set: (p) => { for (const id of s.candidates) if (core.itemById(cat, id)?.title === it.title) admin.photos.items[id] = p; }, rerender: renderKitEditor }),
      h("div", { class: "ed-main" }, h("input", { value: s.title, onchange: (e) => set({ title: e.target.value || s.title }) }),
        h("div", { class: "chips" }, s.candidates.map((id) => h("span", { class: "chip" + (id === s.default ? " on" : "") }, itemLabel(core.itemById(cat, id), s.candidates.map((x) => core.itemById(cat, x))) || id))),
        s.priced ? h("small", { class: "hint", style: "margin:0" }, "ціна окремо, додається до ціни комплекту") : null),
      h("div", { class: "ed-side" },
        h("label", { class: "toggle", title: s.required ? "обов’язкова позиція" : "" }, h("input", { type: "checkbox", checked: base, disabled: s.required,
          onchange: (e) => set({ default: e.target.checked ? (kt0.slots.find((x) => x.id === s.id)?.default || s.candidates[0]) : null }) }), base ? "базова" : "додаткова"),
        s.required || isTitle ? h("small", { class: "hint", style: "margin:0" }, "обов’язкова") :
          h("button", { class: "sm danger", onclick: () => confirmBox(`Прибрати позицію «${s.title}» з комплекту «${kitName(kt)}»?`, "Прибрати", () => {
            if (custom) { K.custom = K.custom.filter((x) => x.id !== s.id); } else (K.hidden ??= []).push(s.id);
            saveAdmin(); renderKitEditor(); }) }, custom ? "Видалити" : "Прибрати"))));
  }
  const hiddenSlots = (K.hidden || []).map((id) => kt0.slots.find((s) => s.id === id)).filter(Boolean);
  box.append(h("div", { class: "sec-card" }, h("div", { class: "head" }, h("h2", {}, "Позиції", h("small", {}, "порядок = порядок рядків у КП")),
    h("button", { class: "primary sm", onclick: () => addPositionDialog(kt) }, "＋ Додати позицію")), list,
    hiddenSlots.length ? h("div", { class: "inline", style: "margin-top:12px" }, h("span", { class: "hint", style: "margin:0" }, "Прибрані:"),
      hiddenSlots.map((s) => h("button", { class: "sm", onclick: () => { K.hidden = K.hidden.filter((x) => x !== s.id); saveAdmin(); renderKitEditor(); } }, `↩ ${s.title}`))) : null));

  // choices (variants and options) of this kit
  const CO = (K.choice_ov ??= {});
  const chs = kitChoicesRaw(edKit), chIds = chs.map((c) => c.id);
  const clist = h("div", { class: "ed-list" });
  for (const c0 of chs) {
    const ch = effChoice(c0, true), off = !!c0._off;
    const own = (CO.custom || []).some((x) => x.id === c0.id);
    const slot = c0.slot ? kt.slots.find((s) => s.id === c0.slot) : null;
    clist.append(h("div", { class: "ed-row nophoto" + (off ? " off" : "") },
      h("div", { class: "ord" }, h("button", { onclick: () => { moveIn(CO, chIds, c0.id, -1); saveAdmin(); renderKitEditor(); } }, "▲"), h("button", { onclick: () => { moveIn(CO, chIds, c0.id, 1); saveAdmin(); renderKitEditor(); } }, "▼")),
      h("div", { class: "ed-main" }, h("b", {}, ch.title),
        h("div", { class: "chips" }, ch.options.map((o) => h("span", { class: "chip" + (o.value === ch.default ? " on" : "") + (o._off ? " gone" : ""), title: o._off ? "варіант вимкнено" : "" },
          o.title + (o.price_uah ? ` · +${core.formatUah(o.price_uah)}` : o.on_request && o.value !== ch.default ? " · за запитом" : "")))),
        h("small", { class: "hint", style: "margin:0" }, (c0.slot ? `показується, коли в комплекті є «${slot?.title || c0.slot}»` : "завжди") + (own ? " · додано в налаштуваннях" : ""))),
      h("div", { class: "ed-side" },
        h("label", { class: "toggle" }, h("input", { type: "checkbox", checked: !off, onchange: (e) => {
          CO.hidden = (CO.hidden || []).filter((x) => x !== c0.id); if (!e.target.checked) CO.hidden.push(c0.id); saveAdmin(); renderKitEditor(); } }), off ? "вимкнено" : "увімкнено"),
        h("button", { class: "sm", onclick: () => { sub("a-choices"); setTimeout(() => document.getElementById("ch-" + c0.id)?.scrollIntoView({ block: "start" }), 50); } }, "Варіанти, ціни, зв’язки →"),
        own ? h("button", { class: "sm danger", onclick: () => confirmBox(`Прибрати вибір «${ch.title}» з комплекту «${kitName(kt)}»?`, "Прибрати", () => {
          CO.custom = CO.custom.filter((x) => x.id !== c0.id); saveAdmin(); renderKitEditor(); }) }, "Прибрати") : null)));
  }
  const others = new Map();
  for (const k of allKitTypes()) for (const c of kitChoicesRaw(k.id)) if (!chIds.includes(c.id) && !others.has(c.id)) others.set(c.id, { c, k });
  const pick = h("select", { class: "sm" }, h("option", { value: "" }, "вибір з іншого комплекту…"), [...others.values()].map(({ c, k }) => h("option", { value: c.id }, `${effChoice(c).title} (${kitName(k)})`)));
  box.append(h("div", { class: "sec-card" }, h("div", { class: "head" }, h("h2", {}, "Вибори і варіанти", h("small", {}, "дишло, насос, коники, гальма…; варіанти з базовим і доплатами")),
    h("div", { class: "inline", style: "margin:0" }, pick, h("button", { class: "sm", onclick: () => {
      const o = others.get(pick.value); if (!o) return toast("Оберіть вибір зі списку");
      const c = structuredClone(o.c); delete c._off; if (c.slot && !kt.slots.some((s) => s.id === c.slot)) delete c.slot;
      (CO.custom ??= []).push(c); saveAdmin(); renderKitEditor(); toast("Вибір додано"); } }, "＋ Додати"),
      h("button", { class: "sm primary", onclick: () => newChoiceDialog(kt) }, "＋ Новий вибір"))), clist,
    h("p", { class: "hint", style: "margin:8px 0 0" }, "Вимкнений вибір не показується в конфігураторі цього комплекту. Варіанти, доплати, базовий варіант і взаємозв’язки (лише разом з / не разом з) — у «Варіанти вибору»; вони спільні для всіх комплектів, де є цей вибір.")));
}
function copyKitDialog(kt) {
  const f = {};
  modal(h("div", { class: "form" }, h("h2", {}, `Нова гілка з «${kitName(kt)}»`),
    h("p", { class: "hint" }, "Копіюються позиції, вибори, порядок і фото комплекту. Далі гілку можна змінювати окремо: додавати й прибирати позиції, вибори, вмикати й вимикати. Ціни позицій і комплектів спільні з основою."),
    h("label", {}, "Назва гілки (вкладка в конфігураторі)", f.title = h("input", { value: kitName(kt) + " (копія)" })),
    h("div", { class: "acts" }, h("button", { onclick: closeModal }, "Скасувати"), h("button", { class: "primary", onclick: () => {
      const title = f.title.value.trim(); if (!title) return toast("Вкажіть назву");
      const raw = rawKit(kt.id), id = "u_" + Date.now().toString(36);
      const copy = { ...structuredClone(raw), id, title, extends: raw.extends || raw.id, copy_of: kt.id };
      delete copy.disabled;
      (KTov().custom ??= []).push(copy);
      if (CA().kits?.[kt.id]) CA().kits[id] = structuredClone(CA().kits[kt.id]);
      if (admin.photos.kits[kt.id]) admin.photos.kits[id] = admin.photos.kits[kt.id];
      saveAdmin(true, "нова гілка " + title); closeModal(); edKit = id; renderKitEditor(); toast("Гілку створено");
    } }, "Створити"))));
}
function newChoiceDialog(kt) {
  const f = {};
  modal(h("div", { class: "form" }, h("h2", {}, `Новий вибір: ${kitName(kt)}`),
    h("label", {}, "Назва вибору", f.title = h("input", { placeholder: "Напр. Дишло" })),
    h("label", {}, "Показувати", f.slot = h("select", {}, h("option", { value: "" }, "завжди"), kt.slots.filter((s) => !s.required).map((s) => h("option", { value: s.id }, `коли в комплекті є «${s.title}»`)))),
    h("label", {}, "Варіанти: кожен з нового рядка, «назва ; доплата ₴». Перший — базовий (без доплати). Без доплати — «за запитом».",
      f.opts = h("textarea", { rows: 5, placeholder: "поворотне\nнеповоротне ; 12000" })),
    h("div", { class: "acts" }, h("button", { onclick: closeModal }, "Скасувати"), h("button", { class: "primary", onclick: () => {
      const title = f.title.value.trim(); if (!title) return toast("Вкажіть назву");
      const lines = f.opts.value.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) return toast("Потрібно щонайменше два варіанти");
      const id = "u_" + Date.now().toString(36);
      const options = lines.map((l, i) => {
        const [t, p] = l.split(";").map((x) => x.trim());
        const o = { value: "v" + (i + 1), title: t, short: t };
        if (i) { o.note = `${title.toLowerCase()}: ${t}`; const pr = num((p || "").replace(/\s/g, "").replace(",", ".")); if (pr != null) o.price_uah = pr; else o.on_request = true; }
        return o;
      });
      const ch = { id, title, default: "v1", options, ...(f.slot.value ? { slot: f.slot.value } : {}) };
      (ovOf("kits", kt.id).choice_ov ??= {}).custom ??= [];
      CA().kits[kt.id].choice_ov.custom.push(ch);
      saveAdmin(); closeModal(); renderKitEditor(); toast("Вибір додано");
    } }, "Додати"))));
}
function addPositionDialog(kt) {
  const f = {}; let photo = null;
  const ph = h("div", { class: "inline" }, h("button", { class: "sm", onclick: () => filePick((p) => { photo = p; ph.querySelector("span").textContent = "✓ фото завантажено"; }) }, "Завантажити фото"), h("span", { class: "hint", style: "margin:0" }, "необов’язково"));
  const exist = h("select", {}, h("option", { value: "" }, "— нова позиція —"), cat.items.filter((i) => !kt.slots.some((s) => s.candidates.includes(i.id))).map((i) => h("option", { value: i.id }, i.title + (i.model ? " · " + i.model : ""))));
  modal(h("div", { class: "form" }, h("h2", {}, `Нова позиція: ${kitName(kt)}`),
    h("label", {}, "Взяти позицію з каталогу", exist),
    h("label", {}, "або назва нової (як у рядку КП)", f.title = h("input", { placeholder: "Напр. Ящик для інструменту" })),
    h("label", {}, "Опис", f.desc = h("textarea", { rows: 2 })),
    h("label", {}, "Базова ціна, ₴ (порожньо — за запитом)", f.price = h("input", { type: "number" })),
    h("label", { class: "toggle" }, f.base = h("input", { type: "checkbox", checked: true }), "базова — одразу в комплекті"),
    ph, kt.price_display === "bundle" ? h("p", { class: "hint" }, "У цьому комплекті одна ціна: нова позиція матиме свою ціну і додасться до ціни комплекту.") : null,
    h("div", { class: "acts" }, h("button", { onclick: closeModal }, "Скасувати"), h("button", { class: "primary", onclick: () => {
      let id = exist.value, title;
      if (id) title = core.itemById(cat, id).title;
      else {
        title = f.title.value.trim(); if (!title) return toast("Вкажіть назву або оберіть позицію");
        id = "u_" + Date.now().toString(36);
        const I = ovOf("items"); (I.custom ??= []).push({ id, kind: "component", title, short: f.desc.value.trim() || title });
        if (num(f.price.value) != null) admin.prices.items[id] = { base: num(f.price.value) };
        if (photo) admin.photos.items[id] = photo;
      }
      const K = ovOf("kits", kt.id);
      (K.custom ??= []).push({ id: "s_" + Date.now().toString(36), title, candidates: [id], required: false, default: f.base.checked ? id : null, ...(kt.price_display === "bundle" ? { priced: true } : {}) });
      saveAdmin(); closeModal(); renderKitEditor(); toast("Позицію додано");
    } }, "Додати"))));
}

// ------------------------------------------------------------------ settings: relations («лише разом з» / «не разом з»)
/** Every reference a relation can name in these kits: other choices' variants, optional positions, cranes and trailers, options. */
function relationRefs(kitIds, selfChoice) {
  const groups = new Map(); const add = (g, ref, label) => { if (!groups.has(g)) groups.set(g, new Map()); groups.get(g).set(ref, label); };
  for (const kid of kitIds) {
    const kt = core.kitTypeById(cat, kid); if (!kt) continue;
    for (const ch of kt.choices) if (ch.id !== selfChoice) for (const o of ch.options) add(ch.title, `${ch.id}=${o.value}`, o.title);
    for (const s of kt.slots) {
      if (!s.required) add("Позиції комплекту", `slot:${s.id}`, `є «${s.title}»`);
      if (["crane", "trailer", "conversion"].includes(s.id)) for (const id of s.candidates) { const it = core.itemById(cat, id); if (it) add(s.title, `item:${id}`, core.modelName(it)); }
    }
    for (const ka of core.kitAccessories(cat, kid, core.defaultSelection(kt, cat))) add("Додаткові опції", `acc:${ka.accessory.id}`, ka.accessory.title);
  }
  return groups;
}
function relationText(x, kitIds) {
  const kt = core.kitTypeById(cat, kitIds[0]); if (!kt) return "";
  const lab = (r) => { for (const k of kitIds) { const t = core.kitTypeById(cat, k); const l = t ? core.relationLabel(cat, t, r) : r; if (l !== r) return l; } return r; };
  return [(x.requires || []).length ? "лише з: " + x.requires.map(lab).join(", ") : "", (x.excludes || []).length ? "не з: " + x.excludes.map(lab).join(", ") : ""].filter(Boolean).join(" · ");
}
function relDialog(title, x, kitIds, selfChoice, save) {
  const req = new Set(x.requires || []), exc = new Set(x.excludes || []);
  const groups = relationRefs(kitIds, selfChoice);
  const col = (set, other, head, hint) => h("div", { class: "rel-col" }, h("h3", {}, head), h("p", { class: "hint", style: "margin:0 0 6px" }, hint),
    [...groups].map(([g, refs]) => h("div", { class: "rel-g" }, h("div", { class: "sm-l" }, g), [...refs].map(([ref, label]) => h("label", { class: "chk" },
      h("input", { type: "checkbox", checked: set.has(ref), onchange: (e) => { if (e.target.checked) { set.add(ref); other.delete(ref); } else set.delete(ref); renderBoxes(); } }), label)))));
  const wrap = h("div", { class: "rel-wrap" });
  const renderBoxes = () => { wrap.innerHTML = ""; wrap.append(col(req, exc, "Доступний лише разом з", "усі позначені мають бути в комплекті"), col(exc, req, "Недоступний разом з", "жоден з позначених не може бути в комплекті")); };
  renderBoxes();
  modal(h("div", { class: "form wide" }, h("h2", {}, `Зв’язки: ${title}`),
    h("p", { class: "hint" }, "Конфігуратор не дасть обрати варіант чи опцію, якщо зв’язок не виконано, і підкаже чому. Якщо обране раніше перестає підходити, вибір повертається до базового."),
    wrap, h("div", { class: "acts" }, h("button", { onclick: () => { req.clear(); exc.clear(); renderBoxes(); } }, "Очистити"), h("button", { onclick: closeModal }, "Скасувати"),
      h("button", { class: "primary", onclick: () => { save({ requires: [...req], excludes: [...exc] }); closeModal(); } }, "Зберегти"))));
}

// ------------------------------------------------------------------ settings: catalog — choices (захват, розподільник, дишло…)
const CRANES = () => cat.items.filter((i) => i.kind === "crane").sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || a.id.localeCompare(b.id));
const DESC_CHOICES = new Set(["grapple", "seat_pos", "brakes", "stakes", "wheels"]);   // their «short» text goes into an item description template
function renderChoiceEditor() {
  cat = effCatalog();
  const box = $("#choiceEditor"); box.innerHTML = "";
  const byId = new Map();
  for (const kt of allKitTypes()) for (const ch of kitChoicesRaw(kt.id)) { if (!byId.has(ch.id)) byId.set(ch.id, { ch, kits: [] }); byId.get(ch.id).kits.push(kt.id); }
  for (const [id, { ch: ch0, kits }] of byId) {
    const E = ovOf("choices", id);
    const ch = effChoice(ch0, true);
    const craneBound = ch0.slot === "crane";
    const cranes = CRANES();
    const values = ch.options.map((o) => o.value);
    const ed = (v) => ((E.edits ??= {})[v] ??= {});
    const custom = (v) => (E.custom || []).some((x) => x.value === v);
    const setO = (o, patch) => { if (custom(o.value)) Object.assign(E.custom.find((x) => x.value === o.value), patch); else Object.assign(ed(o.value), patch); saveAdmin(); };
    const descText = DESC_CHOICES.has(id);
    const tbl = h("table", { class: "opt-table" }, h("thead", {}, h("tr", {}, h("th", {}), h("th", {}, "Увімк."), h("th", {}, "Фото"), h("th", {}, "Варіант"),
      h("th", {}, descText ? "Текст в описі КП" : "Примітка в рядку КП"), h("th", { class: "num" }, "Доплата, ₴"),
      craneBound ? cranes.map((c) => h("th", { class: "cr" }, c.model)) : h("th", { class: "cr" }, "Базовий"), h("th", {}, "Зв’язки"), h("th"))));
    const tb = h("tbody"); tbl.append(tb);
    for (const o of ch.options) {
      const stateFor = (c) => (o.default_for || []).includes(c.id) ? "std" : !o.compatible || o.compatible.includes(c.id) ? "ok" : "no";
      const setState = (c, v) => {
        const all = cranes.map((x) => x.id);
        let comp = o.compatible ? [...o.compatible] : [...all];
        let df = [...(o.default_for || [])];
        if (v === "no") { comp = comp.filter((x) => x !== c.id); df = df.filter((x) => x !== c.id); }
        else { if (!comp.includes(c.id)) comp.push(c.id); if (v === "std") { if (!df.includes(c.id)) df.push(c.id); } else df = df.filter((x) => x !== c.id); }
        if (v === "std") for (const other of ch.options) if (other.value !== o.value && (other.default_for || []).includes(c.id)) ed(other.value).default_for = other.default_for.filter((x) => x !== c.id);
        setO(o, { compatible: comp, default_for: df }); renderChoiceEditor();
      };
      const rel = relationText(o, kits);
      tb.append(h("tr", { class: o._off ? "off" : "" },
        h("td", {}, h("div", { class: "ord" }, h("button", { class: "icon sm", onclick: () => { moveIn(E, values, o.value, -1); saveAdmin(); renderChoiceEditor(); } }, "▲"), h("button", { class: "icon sm", onclick: () => { moveIn(E, values, o.value, 1); saveAdmin(); renderChoiceEditor(); } }, "▼"))),
        h("td", {}, h("input", { type: "checkbox", checked: !o._off, title: o._off ? "вимкнено: не пропонується" : "увімкнено", onchange: (e) => {
          E.hidden = (E.hidden || []).filter((x) => x !== o.value); if (!e.target.checked) E.hidden.push(o.value); saveAdmin(); renderChoiceEditor(); } })),
        h("td", {}, photoCell({ key: `ch:${id}:${o.value}`, path: o.photo, title: o.title, kind: "card", set: (p) => setO(o, { photo: p }), rerender: renderChoiceEditor })),
        h("td", {}, h("input", { value: o.title, onchange: (e) => setO(o, { title: e.target.value }) })),
        h("td", {}, descText ? h("input", { value: o.short || "", onchange: (e) => setO(o, { short: e.target.value }) })
          : h("input", { value: o.note || "", placeholder: o.value === ch.default ? "базовий: без примітки" : "напр. неповоротне дишло", onchange: (e) => setO(o, { note: e.target.value.trim() || undefined }) })),
        h("td", { class: "num" }, h("input", { type: "number", value: o.price_uah ?? "", placeholder: o.on_request ? "за запитом" : "0", style: "width:110px",
          onchange: (e) => { if (custom(o.value)) { const v = num(e.target.value); setO(o, v == null ? { price_uah: undefined, on_request: true } : { price_uah: v, on_request: undefined }); } else { ed(o.value).price = num(e.target.value); saveAdmin(); } } })),
        craneBound ? cranes.map((c) => { const v = stateFor(c); return h("td", { class: "cr" }, h("select", { class: "sm", value: v, style: v === "std" ? "border-color:var(--ok);color:var(--ok);font-weight:600" : v === "no" ? "color:var(--mut2)" : "",
            onchange: (e) => setState(c, e.target.value) }, h("option", { value: "std" }, "★ базовий"), h("option", { value: "ok" }, "✓ так"), h("option", { value: "no" }, "— ні"))); })
          : h("td", { class: "cr" }, h("input", { type: "radio", name: "def_" + id, checked: ch.default === o.value, onchange: () => { E.default = o.value; saveAdmin(); } })),
        h("td", { class: "rel" }, rel ? h("small", {}, rel) : null, h("button", { class: "sm", onclick: () => relDialog(`${ch.title} — ${o.title}`, o, kits, id, (r) => {
          setO(o, { requires: r.requires.length ? r.requires : undefined, excludes: r.excludes.length ? r.excludes : undefined }); renderChoiceEditor(); }) }, rel ? "✎" : "＋ зв’язок")),
        h("td", {}, custom(o.value) ? h("button", { class: "sm danger", disabled: ch.options.length < 3, onclick: () => { E.custom = E.custom.filter((x) => x.value !== o.value); saveAdmin(); renderChoiceEditor(); } }, "Видалити") : null)));
    }
    box.append(h("div", { class: "sec-card", id: "ch-" + id }, h("div", { class: "head" },
      h("div", { class: "inline", style: "margin:0" }, h("input", { value: ch.title, style: "font-weight:700;font-size:15px;width:260px", onchange: (e) => { E.title = e.target.value; saveAdmin(); } }),
        h("span", { class: "hint", style: "margin:0" }, "у комплектах: " + kits.map((k) => kitName(allKitTypes().find((x) => x.id === k)) || k).join(", "))),
      h("button", { class: "sm primary", onclick: () => {
        const v = "u_" + Date.now().toString(36);
        (E.custom ??= []).push({ value: v, title: "Новий варіант", short: craneBound && id === "grapple" ? "захватом …" : "Новий варіант", on_request: true, ...(craneBound ? { compatible: cranes.map((c) => c.id) } : { note: "" }),
          ...(id === "valve" ? { crane_note: "розподільник …" } : {}) });
        saveAdmin(); renderChoiceEditor(); } }, "＋ Додати варіант")),
      h("div", { class: "tbl-wrap" }, tbl),
      h("p", { class: "hint", style: "margin:8px 0 0" }, craneBound ? "★ базовий — стоїть у крані за замовчуванням, без доплати і без примітки в КП; ✓ — можна обрати; — — не підходить до цього крана. " : "",
        "Вимкнений варіант не пропонується, але лишається в налаштуваннях. Небазовий варіант дописується приміткою в опис позиції в КП; доплата додається окремим рядком (у комплекті з однією ціною — до ціни комплекту).")));
  }
}

// ------------------------------------------------------------------ settings: catalog — options (accessories)
function renderAccEditor() {
  cat = effCatalog();
  $("#addAcc").onclick = () => addAccDialog();
  const box = $("#accEditor"); box.innerHTML = "";
  const A = ovOf("accs");
  const ids = cat.accessories.map((a) => a.id);
  const targets = cat.items.filter((i) => i.kind === "crane" || i.kind === "trailer");
  const offList = h("div", { class: "ed-list" });
  for (const g of ["crane", "trailer"]) {
    const list = h("div", { class: "ed-list" });
    const inG = cat.accessories.filter((a) => a.group === g);
    for (const a of inG) {
      const custom = (A.custom || []).some((x) => x.id === a.id);
      const ed = () => ((A.edits ??= {})[a.id] ??= {});
      const set = (patch, rerender = true) => { Object.assign(custom ? A.custom.find((x) => x.id === a.id) : ed(), patch); saveAdmin(); if (rerender) renderAccEditor(); };
      const move = (dir) => { const sib = inG.map((x) => x.id); const i = sib.indexOf(a.id), j = i + dir; if (j < 0 || j >= sib.length) return;
        const order = [...ids]; const a1 = order.indexOf(sib[i]), b1 = order.indexOf(sib[j]); [order[a1], order[b1]] = [order[b1], order[a1]]; A.order = order; saveAdmin(); renderAccEditor(); };
      const comp = a.compatible;
      const price = a.price?.mode === "ref" ? uah(a.price.uah) : "за запитом";
      const key = "acc:" + a.id;
      const kitsOfG = allKitTypes().filter((k) => k.accessory_groups.includes(g)).map((k) => k.id);
      const rel = relationText(a, kitsOfG);
      const row = h("div", { class: "ed-row" + (a.disabled ? " off" : "") },
        h("div", { class: "ord" }, h("button", { onclick: () => move(-1) }, "▲"), h("button", { onclick: () => move(1) }, "▼")),
        photoCell({ key, path: a.photo, title: a.title, kind: "card", set: (p) => { admin.photos.accessories[a.id] = p; }, rerender: renderAccEditor }),
        h("div", { class: "ed-main" },
          h("div", { class: "inline", style: "margin:0;flex-wrap:nowrap" }, h("input", { value: a.title, style: "font-weight:600;flex:1", onchange: (e) => set({ title: e.target.value }, false) }),
            a.kp_uses ? h("span", { class: "badge gray", title: "скільки ваших КП згадують цю опцію" }, `у ${a.kp_uses} КП`) : h("span", { class: "badge gray" }, "не було в КП")),
          h("textarea", { rows: 2, onchange: (e) => set({ desc: e.target.value }, false) }, a.desc),
          a.variants?.length ? h("div", { class: "chips" }, h("span", { class: "hint", style: "margin:0" }, "варіанти:"), a.variants.map((v) => h("span", { class: "chip" }, v.title))) : null,
          h("div", { class: "sm-l" }, "Підходить до"),
          h("div", { class: "chips" }, targets.map((t) => { const on = !comp || comp.includes(t.id); return h("label", { class: "chip" + (on ? " on" : "") },
            h("input", { type: "checkbox", checked: on, onchange: (e) => { const cur = comp ? [...comp] : targets.map((x) => x.id);
              set({ compatible: e.target.checked ? [...new Set([...cur, t.id])] : cur.filter((x) => x !== t.id) }); } }), t.model || t.title); })),
          h("div", { class: "sm-l" }, "Базова (одразу позначена) для комплектів"),
          h("div", { class: "chips" }, allKitTypes().filter((k) => k.accessory_groups.includes(g)).map((k) => { const on = (a.base_for || []).includes(k.id); return h("label", { class: "chip" + (on ? " std" : "") },
            h("input", { type: "checkbox", checked: on, onchange: (e) => { const cur = a.base_for || []; set({ base_for: e.target.checked ? [...cur, k.id] : cur.filter((x) => x !== k.id) }); } }), kitName(k)); })),
          h("div", { class: "sm-l" }, "Зв’язки"), h("div", { class: "inline", style: "margin:0" }, rel ? h("small", {}, rel) : h("small", { class: "hint", style: "margin:0" }, "немає"),
            h("button", { class: "sm", onclick: () => relDialog(a.title, a, kitsOfG, null, (r) => set({ requires: r.requires.length ? r.requires : undefined, excludes: r.excludes.length ? r.excludes : undefined })) }, "✎ Зв’язки"))),
        h("div", { class: "ed-side" },
          h("label", { class: "toggle" }, h("input", { type: "checkbox", checked: !a.disabled, onchange: (e) => set({ disabled: !e.target.checked }) }), a.disabled ? "вимкнено" : "увімкнено"),
          h("b", {}, price), h("button", { class: "sm", onclick: () => sub("a-prices") }, "Ціна"),
          h("select", { class: "sm", value: a.group, onchange: (e) => set({ group: e.target.value }) }, Object.entries(GROUPS).map(([k, t]) => h("option", { value: k }, t))),
          custom ? h("button", { class: "sm danger", onclick: () => confirmBox(`Видалити опцію «${a.title}»?`, "Видалити", () => {
            A.custom = A.custom.filter((x) => x.id !== a.id); saveAdmin(); renderAccEditor(); }) }, "Видалити") : null));
      (a.disabled ? offList : list).append(row);
    }
    box.append(h("div", { class: "sec-card" }, h("div", { class: "head" }, h("h2", {}, GROUPS[g], h("small", {}, `${inG.filter((a) => !a.disabled).length} увімкнено`))), list));
  }
  if (offList.children.length) box.append(h("div", { class: "sec-card" }, h("div", { class: "head" }, h("h2", {}, "Вимкнені опції", h("small", {}, "не пропонуються в конфігураторі й не друкуються в КП; увімкнути — перемикачем"))), offList));
  const hidden = (A.hidden || []).map((id) => cat0.accessories.find((a) => a.id === id)).filter(Boolean);
  if (hidden.length) box.append(h("div", { class: "inline" }, h("span", { class: "hint", style: "margin:0" }, "Прибрані опції:"),
    hidden.map((a) => h("button", { class: "sm", onclick: () => { A.hidden = A.hidden.filter((x) => x !== a.id); saveAdmin(); renderAccEditor(); } }, "↩ " + a.title))));
}
function addAccDialog() {
  const f = {}; let photo = null;
  const ph = h("div", { class: "inline" }, h("button", { class: "sm", onclick: () => filePick((p) => { photo = p; ph.querySelector("span").textContent = "✓ фото завантажено"; }) }, "Завантажити фото"), h("span", { class: "hint", style: "margin:0" }, ""));
  modal(h("div", { class: "form" }, h("h2", {}, "Нова опція"),
    h("label", {}, "Назва", f.title = h("input")), h("label", {}, "Опис", f.desc = h("textarea", { rows: 2 })),
    h("label", {}, "Група", f.group = h("select", {}, Object.entries(GROUPS).map(([k, t]) => h("option", { value: k }, t)))),
    h("label", {}, "Базова ціна, ₴ (порожньо — за запитом)", f.price = h("input", { type: "number" })), ph,
    h("div", { class: "acts" }, h("button", { onclick: closeModal }, "Скасувати"), h("button", { class: "primary", onclick: () => {
      const title = f.title.value.trim(); if (!title) return toast("Вкажіть назву");
      const id = "u_" + Date.now().toString(36);
      (ovOf("accs").custom ??= []).push({ id, group: f.group.value, title, desc: f.desc.value.trim() || title, photo: "", price: { mode: "on_request" }, source: "налаштування" });
      if (num(f.price.value) != null) admin.prices.accessories[id] = { base: num(f.price.value) };
      if (photo) admin.photos.accessories[id] = photo;
      saveAdmin(); closeModal(); renderAccEditor(); toast("Опцію додано");
    } }, "Додати"))));
}

// ------------------------------------------------------------------ settings: positions and photos
const SPEC_LABELS = { reach_m: "Виліт, м", torque_knm: "Момент, кНм", lift_4m_kg: "Вантаж на 4 м, кг", lift_full_kg: "Вантаж на повному вильоті, кг", grapple_m2: "Захват, м²",
  rotator_t: "Ротатор, т", valve: "Розподільник", valve_flow_l: "Потік розподільника, л/хв", slew_knm: "Поворот, кНм", slew_cyl: "Циліндри повороту", turn_deg: "Кут повороту, °",
  pressure_bar: "Тиск, бар", pump_lpm: "Насос, л/хв", legs: "Опори", weight_kg: "Вага, кг", telescope: "Телескоп", wide_angle: "Ширококутний механізм",
  gross_mass_kg: "Повна маса, кг", curb_mass_kg: "Власна маса, кг", payload_kg: "Вантажопідйомність, кг", log_length_m: "Довжина сортименту, м", volume_m3: "Об’єм, м³",
  load_area_mm: "Вантажна площа, мм", dims_mm: "Габарити, мм", stakes: "Коники", frame_wall_mm: "Стінка рами, мм", hub: "Маточина", wheels: "Колеса", wheels_qty: "Кількість коліс",
  suspension: "Підвіска", brakes: "Гальма", outriggers: "Аутригери", balancer: "Балансир", drawbar: "Дишло", coupling: "Зчіпний пристрій", guard_grid: "Захисна решітка",
  lights_plate: "Світло і номер", hydraulics: "Гідравліка", operator_seat: "Місце оператора", color: "Колір", cranes: "Крани", crane: "Кран" };
let itemStyle = null;
function sameGroups(list) {
  const groups = new Map();
  for (const i of list) { const k = i.kind + "|" + i.title; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
  return [...groups.values()];
}
function framingDialog(it, grp) {
  const P = admin.photos, path = P.kp_items[it.id] || it.photo;
  if (!path) return toast("Спершу додайте фото");
  const pos = { zoom: 1, fx: 0.5, fy: 0.5, ...(P.pos[it.id] || {}) };
  const img = h("img", { class: "frame-pv", alt: "як у КП" });
  const show = () => { img.src = `/api/preview/item?${qs({ style: itemStyle || admin.style || "dark", path, kind: "tile", zoom: pos.zoom, fx: pos.fx, fy: pos.fy })}`; };
  const sl = (k, lab, min, max, step) => { const out = h("span", {}, String(pos[k])); return h("div", { class: "row" }, h("span", { style: "width:110px" }, lab),
    h("input", { type: "range", min, max, step, value: pos[k], oninput: (e) => { pos[k] = Number(e.target.value); out.textContent = k === "zoom" ? "×" + pos[k] : Math.round(pos[k] * 100) + " %"; }, onchange: show }), out); };
  show();
  modal(h("div", { class: "form" }, h("h2", {}, `Положення фото в КП: ${it.title}`),
    h("p", { class: "hint" }, "Збільшення обрізає фото навколо точки фокусу, а плитка сторінки «Конфігурація» показує обрізане фото цілим. ×1 — фото як є."),
    img, sl("zoom", "збільшення", 1, 3, 0.05), sl("fx", "фокус ↔", 0, 1, 0.05), sl("fy", "фокус ↕", 0, 1, 0.05),
    h("div", { class: "acts" }, h("button", { onclick: () => { for (const x of grp) delete P.pos[x.id]; saveAdmin(); closeModal(); renderItemEditor(); } }, "Скинути"),
      h("button", { onclick: closeModal }, "Скасувати"),
      h("button", { class: "primary", onclick: () => { for (const x of grp) { if (pos.zoom > 1) P.pos[x.id] = { ...pos }; else delete P.pos[x.id]; } saveAdmin(); closeModal(); renderItemEditor(); } }, "Зберегти"))));
}
function renderItemEditor() {
  cat = effCatalog();
  itemStyle ??= admin.style || "dark";
  const seg = $("#itemStyleSeg"); seg.innerHTML = "";
  for (const s of B.styles.filter((s) => s.id !== "npl_label")) seg.append(h("button", { class: itemStyle === s.id ? "on" : "", onclick: () => { itemStyle = s.id; renderItemEditor(); } }, s.title));
  const box = $("#itemEditor"); box.innerHTML = "";
  const customIds = new Set((CA().items?.custom || []).map((x) => x.id));
  const sections = [...Object.entries(KINDS).map(([k, t]) => [k, t, cat.items.filter((i) => i.kind === k && !customIds.has(i.id))]), ["custom", "Власні позиції (додані в налаштуваннях)", cat.items.filter((i) => customIds.has(i.id))]];
  const P = admin.photos;
  for (const [kind, title, list0] of sections) {
    if (!list0.length) continue;
    const list = [...list0].sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
    const grid = h("div", { class: "items-grid" });
    for (const grp of sameGroups(list)) {
      const it = grp[0], key = "item:" + it.id;
      const own = P.items[it.id], kpOwn = P.kp_items[it.id], pos = P.pos[it.id];
      const kpPath = kpOwn || it.photo;
      const pv = kpPath ? `/api/preview/item?${qs({ style: itemStyle, path: kpPath, kind: "tile", ...(pos ? { zoom: pos.zoom, fx: pos.fx, fy: pos.fy } : {}) })}` : null;
      const E = ovOf("items");
      const setAll = (patch) => { for (const x of grp) { if (customIds.has(x.id)) Object.assign(E.custom.find((c) => c.id === x.id), patch.title ? { title: patch.title } : {}, patch.desc ? { short: patch.desc } : {}); else Object.assign(((E.edits ??= {})[x.id] ??= {}), patch); } saveAdmin(); };
      const descVal = it.desc_template || it.short || "";
      const specs = grp.length === 1 ? Object.entries(it.specs || {}) : [];
      const setSpec = (k, v) => { const e = ((E.edits ??= {})[it.id] ??= {}); e.specs = { ...(e.specs || {}), [k]: v }; saveAdmin(); };
      grid.append(h("div", { class: "icard" },
        h("div", { class: "pv" }, pv ? lbImg(pv, [{ src: pv, label: "Як у КП" }, { src: asset(kpPath), label: "Оригінал" }], { class: "big", alt: it.title }) : h("div", { class: "none" }, "без фото"),
          h("small", { class: "pv-l" }, "як у КП" + (pos ? ` · ×${pos.zoom}` : ""))),
        h("div", {}, h("div", {}, h("span", { class: "t" }, it.model || ""), it.featured ? h("span", { class: "badge" }, "основний") : null, own ? h("span", { class: "badge ok" }, "своє фото") : null,
          kpOwn ? h("span", { class: "badge ok" }, "окреме фото в КП") : null),
          grp.length > 1 ? h("small", {}, "для " + grp.map((x) => x.specs?.crane || x.id).join(" · ")) : null,
          h("input", { value: it.title, onchange: (e) => setAll({ title: e.target.value }) }),
          h("textarea", { rows: 2, title: it.desc_template ? "{grapple} — обраний захват, {seat_pos} — місце оператора, {brakes}, {stakes} — параметри НПЛ-10" : "", onchange: (e) => setAll({ desc: e.target.value }) }, descVal),
          h("div", { class: "photos2" },
            photoCell({ key, path: it.photo, title: it.title + " (конфігуратор)", label: "у конфігураторі", set: (p) => { for (const x of grp) P.items[x.id] = p; },
              clear: own ? () => { for (const x of grp) delete P.items[x.id]; } : null, rerender: renderItemEditor }),
            photoCell({ key: "kp:" + it.id, path: kpOwn, title: it.title + " (КП)", label: "у КП", set: (p) => { for (const x of grp) P.kp_items[x.id] = p; },
              clear: () => { for (const x of grp) delete P.kp_items[x.id]; }, rerender: renderItemEditor })),
          h("div", { class: "acts" }, h("button", { class: "sm", disabled: !kpPath, onclick: () => framingDialog(it, grp) }, "⌖ Положення в КП"),
            customIds.has(it.id) ? h("button", { class: "sm danger", onclick: () => confirmBox(`Видалити позицію «${it.title}» з каталогу і комплектів?`, "Видалити", () => {
              E.custom = E.custom.filter((x) => x.id !== it.id);
              for (const K of Object.values(CA().kits || {})) K.custom = (K.custom || []).filter((s) => !s.candidates.includes(it.id));
              saveAdmin(); renderItemEditor(); }) }, "Видалити") : null),
          specs.length ? h("details", { class: "specs" }, h("summary", {}, `Характеристики (${specs.length})`),
            h("div", { class: "spec-grid" }, specs.map(([k, v]) => h("label", {}, SPEC_LABELS[k] || k, h("input", { value: v ?? "", onchange: (e) => setSpec(k, e.target.value) }))))) : null)));
    }
    const head = h("div", { class: "kind-head" },
      kind !== "custom" ? photoCell({ key: "kind:" + kind, path: P.kinds[kind], title, label: "фото категорії", set: (p) => { P.kinds[kind] = p; }, clear: () => { delete P.kinds[kind]; }, rerender: renderItemEditor }) : null,
      h("h2", { class: "sec" }, title, h("small", {}, ` ${list0.length}`)));
    box.append(head, grid);
  }
}

// ------------------------------------------------------------------ settings: prices of positions
function priceTitle(x, list) {
  const dup = list.filter((y) => y.title === x.title).length > 1;
  return dup ? `${x.title} — ${x.specs?.crane || x.model || x.id}` : x.title;
}
function bundleTitle(b) {
  return Object.values(b.slots).map((id) => core.modelName(core.itemById(cat0, id) || { title: id })).join(" + ");
}
function fixBadge() {
  const n = pendingFix().length, b = $("#fixCount");
  if (b) { b.textContent = n ? String(n) : ""; b.hidden = !n; }
}
let ownProduct = null;
function renderPrices() {
  cat = effCatalog();
  $("#roundStep").textContent = settings.rounding_uah || 1;
  const own = new Set(["own_component", "npl", "truck_conversion", "custom"]);
  const items = [...cat0.items, ...(CA().items?.custom || []).map((x) => ({ price: { mode: "on_request" }, family: "custom", kind: "component", ...x }))];
  const groups = [...Object.entries(KINDS).map(([k, t]) => ({ key: "items:" + k, title: t, kind: "items",
      list: items.filter((i) => i.kind === k).sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0)).map((x, _, l) => ({ ...x, title: priceTitle(x, l), own: own.has(x.family) })) })),
    { key: "bundles", title: "Комплекти з однією ціною (НПЛ-10, причепи BMF, КРАЗ)", kind: "bundles", list: cat0.bundles.map((b) => ({ ...b, title: bundleTitle(b) })) },
    { key: "accessories", title: "Додаткові опції", kind: "accessories", list: [...cat0.accessories, ...(CA().accs?.custom || [])] }];
  const pend = pendingFix();
  const pb = $("#pendBanner"); pb.innerHTML = "";
  if (pend.length) pb.append(h("div", { class: "banner" }, h("span", {}, `Нових цін, ще не зафіксованих для КП: ${pend.length}. КП рахуються за зафіксованими цінами.`),
    h("button", { class: "sm primary", onclick: () => sub("a-fix") }, "Переглянути і зафіксувати")));
  const bg = $("#bulkGroup"); bg.innerHTML = ""; groups.forEach((g) => bg.append(h("option", { value: g.key }, g.title)));
  $("#bulkApply").onclick = () => {
    const g = groups.find((x) => x.key === bg.value), pct = num($("#bulkPct").value);
    if (pct == null) return toast("Вкажіть націнку");
    for (const x of g.list) { const r = (admin.prices[g.kind][x.id] ??= {}); r.markup = pct; }
    saveAdmin(); renderPrices(); toast("Націнку застосовано — зафіксуйте нові ціни");
  };
  // EUR rate
  $$(".roundStep2").forEach((e) => (e.textContent = settings.rounding_uah || 1));
  const er = $("#eurRate"); er.value = admin.eur?.rate ?? "";
  $("#eurInfo").textContent = admin.eur?.rate ? `${admin.eur.source === "nbu" ? "НБУ" : "вручну"}${admin.eur.date ? ", " + core.formatDate(admin.eur.date) : ""}` : "курс не задано";
  er.onchange = () => { const v = num(er.value); admin.eur = v ? { rate: v, date: core.todayIso(), source: "manual" } : null; saveAdmin(true, "курс € " + (v ?? "—")).then(renderPrices); };
  $("#eurNbu").onclick = async () => {
    try { const r = await api("/api/eur"); admin.eur = { rate: r.rate, date: r.date, source: "nbu" }; await saveAdmin(true, "курс € НБУ " + r.rate); renderPrices(); toast(`Курс НБУ: ${r.rate} ₴ за €`); }
    catch (e) { toast("Курс НБУ недоступний: " + e.message + ". Впишіть курс вручну."); }
  };
  $("#eurFill").onclick = () => {
    const rate = eurRate(); if (!rate) return toast("Спершу задайте курс €");
    let n = 0;
    for (const it of cat0.items.filter((i) => i.kind === "crane")) {
      const rec = (admin.prices.items[it.id] ??= {});
      if (num(rec.eur) != null || it.price_eur != null) { rec.mode = "eur"; continue; }
      const uahNow = num(rec.base) ?? origUah(it.price);
      if (uahNow == null) continue;
      rec.eur = Math.round(uahNow / rate); rec.coef ??= 1; rec.mode = "eur"; delete rec.base; n++;
    }
    saveAdmin(true, "ціни кранів у €").then(renderPrices); toast(n ? `Переведено в €: ${n}` : "Нічого переводити");
  };
  const box = $("#priceTables"); box.innerHTML = "";
  for (const g of groups) {
    if (!g.list.length) continue;
    const heads = ["Позиція", "Спосіб", "Дані для розрахунку", "Базова, ₴", "Націнка, %", "Розрахункова", "Фінальна вручну, ₴", "Нова ціна", "У КП зараз", "Додана вартість"];
    const tbl = h("table", { class: "prices" }, h("thead", {}, h("tr", {}, heads.map((t, i) => h("th", { class: i > 2 ? "num" : "" }, t)))));
    const tb = h("tbody"); tbl.append(tb);
    for (const x of g.list) tb.append(priceRow(g.kind, x));
    box.append(h("div", { class: "sec-card" }, h("div", { class: "head" }, h("h2", {}, g.title, h("small", {}, `${g.list.length}`))), h("div", { class: "tbl-wrap" }, tbl)));
  }
}
function priceRow(kind, x) {
  const it = kind === "items" ? x : null;
  const rec = () => admin.prices[kind][x.id] || {};
  const tr = h("tr");
  const draw = () => {
    const r = rec(), p = priceOf(kind, x.id, x.price, it), fx = fixedOf(kind, x.id);
    const set = (k, isNum = true) => (e) => { const R = (admin.prices[kind][x.id] ??= {}); const v = isNum ? num(e.target.value) : e.target.value;
      if (v == null || v === "") delete R[k]; else R[k] = v; if (!Object.keys(R).length) delete admin.prices[kind][x.id]; saveAdmin(); draw(); fixBadge(); };
    const modes = kind === "bundles" ? ["manual", "sum"] : kind === "items" ? ["manual", "eur", "bom"] : ["manual", "eur"];
    const modeSel = h("select", { class: "sm", value: p.mode, onchange: set("mode", false) }, modes.map((m) => h("option", { value: m }, PRICE_MODES[m])));
    let data;
    if (p.mode === "eur") data = h("div", { class: "inline", style: "margin:0;flex-wrap:nowrap" }, "€", h("input", { type: "number", value: r.eur ?? "", placeholder: x.price_eur ?? "—", style: "width:90px", onchange: set("eur") }),
      "× коеф.", h("input", { type: "number", step: 0.01, value: r.coef ?? "", placeholder: "1", style: "width:64px", onchange: set("coef") }));
    else if (p.mode === "bom") { const b = bomCost(x.id);
      data = h("div", { class: "inline", style: "margin:0" }, h("small", {}, b ? `матеріали ${uah(Math.round(b.cost))}, ${b.n} поз.` + (b.miss.length ? `, без ціни: ${b.miss.length}` : "") : "розкладки ще немає"),
        h("button", { class: "sm", onclick: () => { ownProduct = x.id; ownTab = "bom"; sub("a-own"); } }, "Розкладка")); }
    else if (p.mode === "sum") data = h("div", {}, h("small", {}, p.lines.filter((l) => !l.startsWith("доплата")).join(" + ")),
      h("div", { class: "inline", style: "margin:0" }, "доплата, ₴", h("input", { type: "number", value: r.extra ?? "", placeholder: "0", style: "width:90px", onchange: set("extra") })));
    else data = h("input", { type: "number", value: r.base ?? "", placeholder: origUah(x.price) ?? "—", style: "width:110px", title: "порожньо — ціна з останньої КП", onchange: set("base") });
    const changed = (fx ? fx.price : origUah(x.price)) !== p.price && !(fx == null && p.price == null);
    const d = p.price != null && p.base != null ? p.price - p.base : null;
    tr.className = changed ? "pending" : "";
    tr.innerHTML = "";
    tr.append(h("td", {}, x.title, x.unit ? ` (за ${x.unit.per} ${x.unit.name})` : "", x.featured ? h("span", { class: "badge" }, "основний") : null, x.own ? h("span", { class: "badge gray" }, "власне вир-во") : null,
        x.price?.date ? h("small", { style: "display:block;color:#6B727B" }, "з КП " + core.formatDate(x.price.date)) : null),
      h("td", {}, modeSel), h("td", {}, data),
      h("td", { class: "num" }, uah(p.base)),
      h("td", { class: "num" }, h("input", { type: "number", step: 0.5, value: r.markup ?? "", placeholder: "0", style: "width:64px", onchange: set("markup") })),
      h("td", { class: "num" }, uah(p.calc)),
      h("td", { class: "num" }, h("input", { type: "number", value: r.final ?? "", placeholder: "—", style: "width:110px", onchange: set("final") })),
      h("td", { class: "num" }, h("b", {}, p.price == null ? "за запитом" : uah(p.price))),
      h("td", { class: "num" }, fx ? h("span", { title: "зафіксовано " + core.formatDate(fx.at) }, fx.price == null ? "за запитом" : uah(fx.price)) : h("small", {}, "не зафіксовано"),
        changed ? h("small", { class: "chg" }, "≠ нова") : null),
      h("td", { class: "num" }, d != null ? h("span", { class: d >= 0 ? "plus" : "minus" }, (d >= 0 ? "+" : "−") + core.formatUah(Math.abs(d)) + (p.base ? ` (${(d / p.base * 100).toFixed(1).replace(".", ",")} %)` : "")) : ""));
  };
  draw();
  return tr;
}

// ------------------------------------------------------------------ settings: fixing prices and recalculating KPs
function diffCell(a, b) {
  if (a == null || b == null) return h("td", { class: "num" }, "—");
  const d = b - a;
  return h("td", { class: "num" }, h("span", { class: d > 0 ? "plus" : d < 0 ? "minus" : "" }, (d > 0 ? "+" : d < 0 ? "−" : "") + core.formatUah(Math.abs(d)) + (a ? ` (${(d / a * 100).toFixed(1).replace(".", ",")} %)` : "")));
}
const totalNum = (t) => { const m = String(t || "").replace(/\s| | /g, "").match(/\d+/); return m ? Number(m[0]) : null; };
async function renderFix() {
  cat = effCatalog();
  const box = $("#fixBox"); box.innerHTML = "";
  // 1. new prices to fix
  const pend = pendingFix();
  const pick = new Set(pend.map((p) => p.kind + ":" + p.id));
  const tb = h("tbody");
  for (const p of pend) {
    const k = p.kind + ":" + p.id;
    tb.append(h("tr", {}, h("td", {}, h("input", { type: "checkbox", checked: true, onchange: (e) => { if (e.target.checked) pick.add(k); else pick.delete(k); } })),
      h("td", {}, p.title, h("small", { style: "display:block" }, { items: "позиція", bundles: "комплект", accessories: "опція" }[p.kind] + " · " + PRICE_MODES[p.mode])),
      h("td", { class: "num" }, p.old == null ? "за запитом" : uah(p.old)), h("td", { class: "num" }, h("b", {}, p.now == null ? "за запитом" : uah(p.now))), diffCell(p.old, p.now),
      h("td", {}, h("small", {}, p.lines.join("; ")))));
  }
  box.append(h("div", { class: "sec-card" }, h("div", { class: "head" }, h("h2", {}, "1. Нові ціни для КП", h("small", {}, pend.length ? `${pend.length} змін` : "усі ціни зафіксовано")),
    pend.length ? h("button", { class: "primary", onclick: async () => {
      const list = pend.filter((p) => pick.has(p.kind + ":" + p.id)); if (!list.length) return toast("Нічого не обрано");
      await fixPrices(list, `зафіксовано цін: ${list.length}`); toast(`Зафіксовано: ${list.length}. Перевірте КП з історії нижче.`); renderFix(); fixBadge();
    } }, "Зафіксувати вибрані") : null),
    pend.length ? h("div", { class: "tbl-wrap" }, h("table", { class: "prices" }, h("thead", {}, h("tr", {}, ["", "Позиція", "Зараз у КП", "Стане", "Різниця", "Як рахується"].map((t, i) => h("th", { class: i > 1 && i < 5 ? "num" : "" }, t)))), tb))
      : h("p", { class: "hint" }, "Тут з’являються ціни, що змінилися в «Ціни позицій» чи «Власне виробництво» (курс €, коефіцієнти, матеріали, націнка, фінальна ціна). До фіксації КП рахуються за попередніми цінами.")));
  // 2. fixed prices with a previous value: undo
  const withPrev = [];
  for (const kind of PKINDS) for (const [id, f] of Object.entries(admin.fixed?.[kind] || {})) if (f.prev) withPrev.push({ kind, id, f, title: pricedPositions().find((p) => p.kind === kind && p.id === id)?.title || id });
  withPrev.sort((a, b) => (b.f.at || "").localeCompare(a.f.at || ""));
  if (withPrev.length) box.append(h("div", { class: "sec-card" }, h("div", { class: "head" }, h("h2", {}, "2. Відкат фіксації", h("small", {}, "повернути попередню зафіксовану ціну"))),
    h("div", { class: "tbl-wrap" }, h("table", { class: "prices" }, h("thead", {}, h("tr", {}, ["Позиція", "Зараз", "Зафіксовано", "Попередня", ""].map((t, i) => h("th", { class: i && i < 4 ? "num" : "" }, t)))),
      h("tbody", {}, withPrev.slice(0, 60).map((x) => h("tr", {}, h("td", {}, x.title), h("td", { class: "num" }, uah(x.f.price)), h("td", { class: "num" }, core.formatDate(x.f.at)),
        h("td", { class: "num" }, uah(x.f.prev.price), h("small", { style: "display:block" }, core.formatDate(x.f.prev.at))),
        h("td", {}, h("button", { class: "sm", onclick: async () => { const F = admin.fixed[x.kind]; const cur = F[x.id];
          F[x.id] = { ...cur.prev, prev: { price: cur.price, at: cur.at, lines: cur.lines } }; await saveAdmin(true, "відкат ціни " + x.title); renderFix(); fixBadge(); } }, "↶ Повернути")))))))));
  // 3. KPs in the history with the fixed prices
  const kpBox = h("div", {}, h("p", { class: "hint" }, "Рахую КП з історії…"));
  box.append(h("div", { class: "sec-card" }, h("div", { class: "head" }, h("h2", {}, "3. КП з історії за новими цінами", h("small", {}, "попередній перегляд; оновлена КП замінює стару в історії"))), kpBox));
  let list = [];
  try { list = await api("/api/history"); } catch (e) { list = []; }
  kpBox.innerHTML = "";
  const rows = [];
  for (const e of list.filter((x) => x.state)) {
    const r = recalcEntry(e);
    rows.push({ e, ...r });
  }
  if (!rows.length) { kpBox.append(h("p", { class: "hint" }, "В історії ще немає КП, які можна перерахувати.")); return; }
  const sel = new Set(rows.filter((r) => r.q && r.newTotal !== r.oldTotal).map((r) => r.e.id));
  const tb3 = h("tbody");
  for (const r of rows) {
    tb3.append(h("tr", { class: r.q && r.newTotal !== r.oldTotal ? "pending" : "" },
      h("td", {}, r.q ? h("input", { type: "checkbox", checked: sel.has(r.e.id), onchange: (ev) => { if (ev.target.checked) sel.add(r.e.id); else sel.delete(r.e.id); } }) : null),
      h("td", {}, `КП № ${r.e.number || "—"}`, h("small", { style: "display:block" }, `${r.e.client || "—"} · ${r.e.date || r.e.time}`)),
      h("td", {}, h("small", {}, r.e.title || "")),
      h("td", { class: "num" }, r.e.total || "—"), h("td", { class: "num" }, r.q ? h("b", {}, r.newText) : h("small", {}, r.err)), diffCell(r.oldTotal, r.newTotal),
      h("td", {}, r.q ? h("details", { class: "pinfo" }, h("summary", {}, "рядки"), h("ul", {}, r.q.rows.map((x) => h("li", {}, `${x.title}: ${x.price_text}`)),
        r.q.kit_price_uah != null ? h("li", {}, `ціна комплекту: ${uah(r.q.kit_price_uah)}`) : null)) : null),
      h("td", { class: "st" })));
  }
  const status = h("span", { class: "hint", style: "margin:0" });
  kpBox.append(h("div", { class: "tbl-wrap" }, h("table", { class: "prices" }, h("thead", {}, h("tr", {}, ["", "КП", "Комплект", "Було", "Стане", "Різниця", "", ""].map((t, i) => h("th", { class: i > 2 && i < 6 ? "num" : "" }, t)))), tb3)),
    h("div", { class: "inline" }, h("button", { class: "primary", onclick: async (ev) => {
      const todo = rows.filter((r) => sel.has(r.e.id) && r.q); if (!todo.length) return toast("Нічого не обрано");
      ev.target.disabled = true; let n = 0;
      for (const r of todo) {
        status.textContent = `Оновлюю КП № ${r.e.number} (${++n} з ${todo.length})… PDF — до хвилини на КП`;
        try { await regenerateEntry(r.e, r.q, r.sel); } catch (e) { toast(`КП № ${r.e.number}: ${e.message}`); }
      }
      status.textContent = `Оновлено КП: ${n}.`; ev.target.disabled = false; renderFix();
    } }, "Оновити вибрані КП (PPTX + PDF)"), status));
}
/** Quote of a history entry with today's settings: {q, oldTotal, newTotal, newText, err}. */
function recalcEntry(e) {
  const st = e.state;
  if (!core.kitTypeById(cat, st.kit_type)) return { err: "комплекту вже немає", oldTotal: totalNum(e.total) };
  try {
    const sel = core.reconcileSelection(cat, st.kit_type, st.selection);
    const manual = Object.fromEntries(Object.entries(st.manual || {}).filter(([, v]) => v != null));
    const quantities = Object.fromEntries(Object.entries(st.qty || {}).filter(([id, v]) => v != null && core.itemById(cat, id)?.unit));
    const q = core.quote(cat, settings, { eur: null, source: "none" }, { kit_type: st.kit_type, selection: sel, discount_pct: st.discount || 0, manual_prices: manual,
      kit_price_uah: st.kitPrice ?? null, quantities, date: st.date || core.todayIso() });
    return { q, sel, oldTotal: totalNum(e.total), newTotal: q.total_uah || null, newText: !q.total_uah ? "за запитом" : uah(q.total_uah) + (q.complete === false ? " *" : "") };
  } catch (err) { return { err: (err.errors || [String(err)])[0], oldTotal: totalNum(e.total) }; }
}
async function regenerateEntry(e, q, sel) {
  const st = e.state;
  const spec = specFrom(q, { number: st.number || e.number || "0001", client: { name: st.client || e.client || "Назва замовника", contact: st.contact || e.contact || "" },
    offer_accessories: st.offerAcc !== false }, st.style || e.style || admin.style || "dark");
  const r = await api("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spec, state: { ...st, selection: sel || st.selection }, history_id: e.id }) });
  if (!r.pptx) throw new Error((r.messages || ["КП не створено"]).slice(-1)[0]);
  return r;
}

// ------------------------------------------------------------------ settings: own production — materials, product lists, import, log
let ownTab = "mats", matQuery = "", matGroup = "", importState = null;
const M = () => admin.materials;
const newMatId = () => "m_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const normName = (s) => String(s ?? "").toLowerCase().replace(/[«»"'`’]/g, "").replace(/[\s ]+/g, " ").trim();
const normCode = (s) => String(s ?? "").replace(/[\s ]+/g, "").toLowerCase();
function parsePrice(v) {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/[\s ₴€грнuahUAHEUR]/g, "").replace(",", ".");
  return s && !isNaN(Number(s)) ? Number(s) : null;
}
const curOf = (v) => (/eur|€|євро/i.test(String(v ?? "")) ? "EUR" : "UAH");
const curSign = (c) => (c === "EUR" ? "€" : "₴");
/** Change log entry: changes = [{id, name, old: {price, cur} | null (created), new: {price, cur} | null (deleted)}], bom = [{product, old, new}]. */
function logChange(note, changes, bom = []) {
  if (!changes.length && !bom.length) return;
  M().log.unshift({ id: "l_" + Date.now().toString(36), at: nowStr(), note, changes, bom });
  if (M().log.length > 200) M().log.length = 200;
}
const usedIn = (id) => Object.entries(admin.bom).filter(([, b]) => (b.rows || []).some((r) => r.mat === id)).map(([p]) => p);
function ownProducts() {
  const own = new Set(["own_component", "npl", "truck_conversion", "custom"]);
  const all = [...cat0.items, ...(CA().items?.custom || []).map((x) => ({ family: "custom", kind: "component", ...x }))];
  return [...all.filter((i) => own.has(i.family)), ...all.filter((i) => !own.has(i.family) && i.kind !== "crane")];
}
const productTitle = (p) => p ? (p.title + (p.specs?.crane ? ` — для ${p.specs.crane}` : p.model && !p.title.includes(p.model) ? ` ${p.model}` : "")) : "";
function renderOwn() {
  const seg = $("#ownSeg"); seg.innerHTML = "";
  for (const [k, t] of [["mats", "Матеріали і ціни"], ["bom", "Розкладка виробів"], ["import", "Імпорт з Excel"], ["log", "Журнал і відкат"]])
    seg.append(h("button", { class: ownTab === k ? "on" : "", onclick: () => { ownTab = k; renderOwn(); } }, t));
  const box = $("#ownBox"); box.innerHTML = "";
  ({ mats: ownMaterials, bom: ownBom, import: ownImport, log: ownLog })[ownTab](box);
}
function ownMaterials(box) {
  const list = M().list, rate = eurRate();
  const groups = [...new Set(list.map((m) => m.group || "").filter(Boolean))].sort();
  const q = normName(matQuery);
  const shown = list.filter((m) => (!matGroup || (m.group || "") === matGroup) && (!q || normName(m.name + " " + (m.code || "")).includes(q)));
  const gsel = (v, on) => h("select", { class: "sm", value: v, onchange: on }, h("option", { value: "" }, "усі групи"), groups.map((g) => h("option", { value: g }, g)));
  const coef = h("input", { type: "number", step: 0.01, placeholder: "1,05", style: "width:80px" });
  const bulkScope = () => list.filter((m) => !matGroup || (m.group || "") === matGroup);
  const bulk = (note, fn) => {
    const ch = [];
    for (const m of bulkScope()) { const old = { price: m.price, cur: m.cur }; if (fn(m) === false) continue; if (old.price !== m.price || old.cur !== m.cur) ch.push({ id: m.id, name: m.name, old, new: { price: m.price, cur: m.cur } }); }
    logChange(note + (matGroup ? ` (група «${matGroup}»)` : " (усі)"), ch); saveAdmin(true, note); renderOwn(); fixBadge(); toast(`Змінено: ${ch.length}. Нові ціни виробів — у «Фіксація цін і КП».`);
  };
  box.append(h("div", { class: "card" },
    h("div", { class: "inline", style: "margin:0" }, h("input", { type: "search", placeholder: "Пошук: назва чи код", value: matQuery, oninput: (e) => { matQuery = e.target.value; renderOwnSoon(); } }),
      gsel(matGroup, (e) => { matGroup = e.target.value; renderOwn(); }), h("span", { class: "hint", style: "margin:0" }, `${shown.length} з ${list.length}`),
      h("button", { class: "sm primary", onclick: () => { list.push({ id: newMatId(), code: "", name: "Новий матеріал", unit: "шт", group: matGroup || "", price: null, cur: "UAH" });
        logChange("додано матеріал", [{ id: list.at(-1).id, name: "Новий матеріал", old: null, new: { price: null, cur: "UAH" } }]); saveAdmin(); renderOwn(); } }, "＋ Матеріал")),
    h("div", { class: "inline" }, h("b", {}, "Для " + (matGroup ? `групи «${matGroup}»` : "усіх матеріалів") + ":"),
      "ціни ×", coef, h("button", { class: "sm", onclick: () => { const k = num(String(coef.value).replace(",", ".")); if (!k) return toast("Вкажіть коефіцієнт");
        bulk(`ціни × ${k}`, (m) => { if (num(m.price) == null) return false; m.price = Math.round(m.price * k * 100) / 100; }); } }, "Застосувати"),
      h("button", { class: "sm", title: "ціни в ₴ перевести в € за поточним курсом: далі ціни рухаються за курсом", onclick: () => { if (!rate) return toast("Спершу задайте курс € у «Ціни позицій»");
        bulk(`переведено в € за курсом ${rate}`, (m) => { if (m.cur === "EUR" || num(m.price) == null) return false; m.price = Math.round(m.price / rate * 100) / 100; m.cur = "EUR"; }); } }, "Перевести в €"),
      h("button", { class: "sm", onclick: () => { if (!rate) return toast("Спершу задайте курс €");
        bulk(`переведено в ₴ за курсом ${rate}`, (m) => { if (m.cur !== "EUR" || num(m.price) == null) return false; m.price = Math.round(m.price * rate * 100) / 100; m.cur = "UAH"; }); } }, "Перевести в ₴"),
      h("span", { class: "hint", style: "margin:0" }, rate ? `курс € ${fmtN(rate, 4)}` : "курс € не задано"))));
  const tb = h("tbody");
  for (const m of shown.slice(0, 400)) {
    const set = (k) => (e) => {
      const v = k === "price" ? parsePrice(e.target.value) : e.target.value.trim();
      const old = { price: m.price, cur: m.cur };
      m[k] = v;
      if (k === "price" || k === "cur") logChange("вручну: " + m.name, [{ id: m.id, name: m.name, old, new: { price: m.price, cur: m.cur } }]);
      saveAdmin(); if (k !== "name" && k !== "code") { renderOwn(); fixBadge(); }
    };
    const u = usedIn(m.id);
    tb.append(h("tr", {}, h("td", {}, h("input", { value: m.code || "", style: "width:90px", onchange: set("code") })),
      h("td", {}, h("input", { value: m.name, style: "min-width:220px", onchange: set("name") })),
      h("td", {}, h("input", { value: m.unit || "", style: "width:56px", onchange: set("unit") })),
      h("td", {}, h("input", { value: m.group || "", style: "width:120px", list: "matGroups", onchange: set("group") })),
      h("td", { class: "num" }, h("input", { type: "text", inputmode: "decimal", value: m.price ?? "", style: "width:100px", onchange: set("price") })),
      h("td", {}, h("select", { class: "sm", value: m.cur || "UAH", onchange: set("cur") }, h("option", { value: "UAH" }, "₴"), h("option", { value: "EUR" }, "€"))),
      h("td", { class: "num" }, m.cur === "EUR" ? uah(matUah(m) == null ? null : Math.round(matUah(m))) : ""),
      h("td", {}, u.length ? h("small", { title: u.map((p) => productTitle(ownProducts().find((x) => x.id === p))).join(", ") }, `у ${u.length} вир.`) : h("small", { class: "hint", style: "margin:0" }, "—")),
      h("td", {}, h("button", { class: "sm danger", onclick: () => confirmBox(`Видалити «${m.name}»?` + (u.length ? ` Він є в розкладці ${u.length} виробів — там рядок лишиться без ціни.` : ""), "Видалити", () => {
        M().list = M().list.filter((x) => x !== m); logChange("видалено матеріал", [{ id: m.id, name: m.name, old: { price: m.price, cur: m.cur, row: structuredClone(m) }, new: null }]);
        saveAdmin(); renderOwn(); }) }, "×"))));
  }
  box.append(h("datalist", { id: "matGroups" }, groups.map((g) => h("option", { value: g }))),
    h("div", { class: "sec-card" }, list.length ? h("div", { class: "tbl-wrap" }, h("table", { class: "prices mats" }, h("thead", {}, h("tr", {}, ["Код", "Назва", "Од.", "Група", "Ціна", "Вал.", "у ₴", "Де", ""].map((t, i) => h("th", { class: i === 4 || i === 6 ? "num" : "" }, t)))), tb))
      : h("p", { class: "hint" }, "Матеріалів ще немає. Імпортуйте їх з Excel (вкладка «Імпорт з Excel») або додайте кнопкою «＋ Матеріал»."),
      shown.length > 400 ? h("p", { class: "hint" }, "Показано перші 400 — уточніть пошук.") : null));
}
let ownT;
function renderOwnSoon() { clearTimeout(ownT); ownT = setTimeout(() => { const a = document.activeElement, pos = a?.selectionStart; renderOwn(); const s = $("#ownBox input[type=search]"); if (s) { s.focus(); try { s.setSelectionRange(pos, pos); } catch {} } }, 250); }
function ownBom(box) {
  const prods = ownProducts();
  if (!prods.some((p) => p.id === ownProduct)) ownProduct = prods[0]?.id;
  const p = prods.find((x) => x.id === ownProduct);
  const B0 = (admin.bom[ownProduct] ??= { rows: [], coef: 1, extra: 0 });
  const mats = matMap(), list = M().list;
  const rec = admin.prices.items[ownProduct] || {};
  const pr = priceOf("items", ownProduct, p?.price, p);
  const label = (m) => (m.code ? m.code + " · " : "") + m.name;
  const byLabel = new Map(list.map((m) => [label(m), m]));
  const bc = bomCost(ownProduct);
  const save = (rerender = true) => { saveAdmin(); if (rerender) renderOwn(); fixBadge(); };
  const copyFrom = h("select", { class: "sm" }, h("option", { value: "" }, "скопіювати розкладку з…"), prods.filter((x) => x.id !== ownProduct && admin.bom[x.id]?.rows?.length).map((x) => h("option", { value: x.id }, productTitle(x))));
  box.append(h("div", { class: "card" }, h("div", { class: "inline", style: "margin:0" }, h("b", {}, "Виріб"),
    h("select", { value: ownProduct, onchange: (e) => { ownProduct = e.target.value; renderOwn(); } }, prods.map((x) => h("option", { value: x.id }, productTitle(x) + (admin.bom[x.id]?.rows?.length ? ` (${admin.bom[x.id].rows.length})` : "")))),
    copyFrom, h("button", { class: "sm", onclick: () => { const src = admin.bom[copyFrom.value]; if (!src) return toast("Оберіть виріб");
      const old = structuredClone(B0); admin.bom[ownProduct] = structuredClone(src); M().log.unshift({ id: "l_" + Date.now().toString(36), at: nowStr(), note: `розкладку скопійовано: ${productTitle(p)}`, changes: [], bom: [{ product: ownProduct, old, new: structuredClone(src) }] }); save(); } }, "Копіювати")),
    h("p", { class: "hint", style: "margin:6px 0 0" }, `Спосіб ціни виробу зараз: ${PRICE_MODES[pr.mode]}.`, pr.mode !== "bom" ? " Розкладка рахується, але ціна виробу береться з неї лише в способі «з матеріалів»." : "")));
  const tb = h("tbody");
  B0.rows.forEach((r, i) => {
    const m = mats.get(r.mat), pu = matUah(m), q = num(r.qty) ?? 0;
    const inp = h("input", { list: "matList", value: m ? label(m) : "", placeholder: "почніть вводити назву чи код", style: "min-width:260px", onchange: (e) => {
      const mm = byLabel.get(e.target.value) || list.find((x) => normName(x.name) === normName(e.target.value));
      if (!mm) return toast("Такого матеріалу немає в довіднику — додайте його у «Матеріали і ціни»");
      r.mat = mm.id; save(); } });
    tb.append(h("tr", { class: m && pu != null ? "" : "pending" }, h("td", {}, inp),
      h("td", { class: "num" }, h("input", { type: "text", inputmode: "decimal", value: r.qty ?? "", style: "width:80px", onchange: (e) => { r.qty = parsePrice(e.target.value); save(); } })),
      h("td", {}, m?.unit || ""), h("td", { class: "num" }, m ? (m.price == null ? "без ціни" : `${fmtN(m.price)} ${curSign(m.cur)}`) : "—"),
      h("td", { class: "num" }, pu == null ? "—" : uah(Math.round(pu * q))),
      h("td", {}, h("button", { class: "sm danger", onclick: () => { B0.rows.splice(i, 1); save(); } }, "×"))));
  });
  box.append(h("datalist", { id: "matList" }, list.map((m) => h("option", { value: label(m) }))),
    h("div", { class: "sec-card" }, h("div", { class: "head" }, h("h2", {}, "Склад: " + productTitle(p), h("small", {}, `${B0.rows.length} рядків`)),
      h("button", { class: "sm primary", disabled: !list.length, title: list.length ? "" : "спершу додайте матеріали", onclick: () => { B0.rows.push({ mat: list[0].id, qty: 1 }); save(); } }, "＋ Рядок")),
      B0.rows.length ? h("div", { class: "tbl-wrap" }, h("table", { class: "prices" }, h("thead", {}, h("tr", {}, ["Матеріал чи комплектуючий", "К-сть", "Од.", "Ціна", "Сума", ""].map((t, i) => h("th", { class: i === 1 || i === 3 || i === 4 ? "num" : "" }, t)))), tb))
        : h("p", { class: "hint" }, list.length ? "Додайте рядки або імпортуйте склад виробу з Excel (вкладка «Імпорт з Excel», режим «Склад виробу»)." : "Спершу додайте або імпортуйте матеріали."),
      h("div", { class: "bom-sum" },
        h("div", {}, "Матеріали: ", h("b", {}, bc ? uah(Math.round(bc.cost)) : "—"), bc?.miss.length ? h("small", { class: "minus" }, ` без ціни: ${bc.miss.length}`) : null),
        h("label", { class: "inline", style: "margin:0" }, "× коефіцієнт виробу", h("input", { type: "number", step: 0.01, value: B0.coef ?? 1, style: "width:80px", onchange: (e) => { B0.coef = num(e.target.value) ?? 1; save(); } })),
        h("label", { class: "inline", style: "margin:0" }, "+ інші витрати (робота, фарба…), ₴", h("input", { type: "number", value: B0.extra ?? 0, style: "width:110px", onchange: (e) => { B0.extra = num(e.target.value) ?? 0; save(); } })),
        h("div", {}, "Собівартість (база ціни): ", h("b", {}, bc ? uah(core.roundTo(bc.total, settings.rounding_uah || 1)) : "—")),
        h("div", {}, "Ціна виробу: ", h("b", {}, pr.price == null ? "за запитом" : uah(pr.price)), rec.markup ? h("small", {}, ` (націнка ${fmtN(rec.markup)} %)`) : null,
          " · у КП: ", h("b", {}, fixedOf("items", ownProduct)?.price != null ? uah(fixedOf("items", ownProduct).price) : origUah(p?.price) != null ? uah(origUah(p.price)) : "за запитом"))),
      h("div", { class: "inline" },
        pr.mode !== "bom" ? h("button", { class: "primary sm", disabled: !B0.rows.length, onclick: () => { (admin.prices.items[ownProduct] ??= {}).mode = "bom"; save(); toast("Ціна виробу тепер рахується з матеріалів — зафіксуйте її"); } }, "Рахувати ціну виробу з матеріалів")
          : h("button", { class: "sm", onclick: () => { delete admin.prices.items[ownProduct].mode; save(); } }, "Повернути ціну вручну"),
        h("button", { class: "sm", onclick: () => sub("a-prices") }, "Націнка і фінальна ціна →"), h("button", { class: "sm", onclick: () => sub("a-fix") }, "Зафіксувати для КП →"))));
}

// import: file -> sheet -> columns -> preview with statuses -> apply (logged, rollback in the log)
const COLS = { code: ["код", "артикул", "code", "sku", "номенклатурний"], name: ["назва", "найменування", "номенклатура", "товар", "матеріал", "name"],
  price: ["ціна", "вартість", "price", "грн", "сума за од"], cur: ["валюта", "currency"], unit: ["од", "одиниц", "unit", "виміру"], group: ["група", "категор", "розділ", "group"],
  qty: ["кількість", "к-сть", "кол", "qty", "норма"] };
const COL_T = { code: "Код", name: "Назва", price: "Ціна", cur: "Валюта", unit: "Од. виміру", group: "Група", qty: "Кількість (для складу виробу)" };
function guessHeader(rows) {
  let best = 0, bi = 0;
  rows.slice(0, 15).forEach((r, i) => { const n = r.filter((c) => typeof c === "string" && Object.values(COLS).flat().some((w) => c.toLowerCase().includes(w))).length; if (n > best) { best = n; bi = i; } });
  const head = rows[bi] || [];
  const map = {};
  for (const [k, words] of Object.entries(COLS)) {
    const i = head.findIndex((c, j) => typeof c === "string" && words.some((w) => c.toLowerCase().includes(w)) && !Object.values(map).includes(j));
    if (i >= 0) map[k] = i;
  }
  return { headerRow: bi, map };
}
function ownImport(box) {
  const S2 = importState;
  const file = h("input", { type: "file", accept: ".xlsx,.csv,.txt", onchange: async () => {
    const f = file.files[0]; if (!f) return;
    try { toast("Читаю файл…"); const r = await api("/api/import", { method: "POST", headers: { "X-Filename": encodeURIComponent(f.name) }, body: f });
      const sh = r.sheets.findIndex((s) => s.rows.length > 1); const g = guessHeader(r.sheets[Math.max(0, sh)]?.rows || []);
      importState = { name: r.name, sheets: r.sheets, sheet: Math.max(0, sh), ...g, mode: "prices", product: ownProduct || ownProducts()[0]?.id, cur: "UAH", addNew: false, preview: null };
      renderOwn(); } catch (e) { toast(e.message); } } });
  box.append(h("div", { class: "card" }, h("h2", {}, "Імпорт номенклатури і цін"),
    h("p", { class: "hint" }, "Excel (.xlsx) або CSV. Позиції шукаються в довіднику матеріалів за кодом, а без коду — за назвою. Перед застосуванням видно, які ціни змінилися, які ні, і які позиції не розпізнано. Кожен імпорт можна відкотити в «Журнал і відкат»."),
    h("div", { class: "inline" }, file, S2 ? h("span", {}, "Файл: ", h("b", {}, S2.name)) : null)));
  if (!S2) return;
  const sheet = S2.sheets[S2.sheet] || { rows: [] };
  const head = sheet.rows[S2.headerRow] || [];
  const colSel = (k) => h("label", {}, COL_T[k], h("select", { value: S2.map[k] ?? "", onchange: (e) => { if (e.target.value === "") delete S2.map[k]; else S2.map[k] = Number(e.target.value); S2.preview = null; renderOwn(); } },
    h("option", { value: "" }, "—"), head.map((c, i) => h("option", { value: i }, `${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ""}: ${String(c).slice(0, 30)}`))));
  box.append(h("div", { class: "sec-card" }, h("div", { class: "lay-cols" },
    h("label", {}, "Аркуш", h("select", { value: S2.sheet, onchange: (e) => { S2.sheet = Number(e.target.value); Object.assign(S2, guessHeader(S2.sheets[S2.sheet].rows)); S2.preview = null; renderOwn(); } },
      S2.sheets.map((s, i) => h("option", { value: i }, `${s.name} (${s.rows.length} рядків)`)))),
    h("label", {}, "Рядок заголовків", h("input", { type: "number", min: 1, value: S2.headerRow + 1, onchange: (e) => { S2.headerRow = Math.max(0, (num(e.target.value) || 1) - 1); S2.preview = null; renderOwn(); } })),
    ...Object.keys(COLS).map(colSel),
    h("label", {}, "Валюта, якщо немає колонки", h("select", { value: S2.cur, onchange: (e) => { S2.cur = e.target.value; S2.preview = null; } }, h("option", { value: "UAH" }, "₴ гривня"), h("option", { value: "EUR" }, "€ євро"))),
    h("label", {}, "Що зробити", h("select", { value: S2.mode, onchange: (e) => { S2.mode = e.target.value; S2.preview = null; renderOwn(); } },
      h("option", { value: "prices" }, "Оновити ціни в довіднику матеріалів"), h("option", { value: "bom" }, "Склад виробу (матеріали + кількість)"))),
    S2.mode === "bom" ? h("label", {}, "Виріб", h("select", { value: S2.product, onchange: (e) => { S2.product = e.target.value; S2.preview = null; } }, ownProducts().map((x) => h("option", { value: x.id }, productTitle(x))))) : null),
    h("label", { class: "chk" }, h("input", { type: "checkbox", checked: S2.addNew, onchange: (e) => { S2.addNew = e.target.checked; if (S2.preview) renderOwn(); } }), "Нерозпізнані позиції додати в довідник як нові"),
    h("div", { class: "inline" }, h("button", { class: "primary", onclick: () => { if (S2.map.name == null && S2.map.code == null) return toast("Оберіть колонку з назвою або кодом");
      if (S2.map.price == null && S2.mode === "prices") return toast("Оберіть колонку з ціною"); S2.preview = importPreview(S2); renderOwn(); } }, "Переглянути зміни"))));
  if (S2.preview) importPreviewView(box, S2);
}
function importPreview(S2) {
  const rows = S2.sheets[S2.sheet].rows.slice(S2.headerRow + 1);
  const list = M().list;
  const byCode = new Map(list.filter((m) => m.code).map((m) => [normCode(m.code), m]));
  const byName = new Map(list.map((m) => [normName(m.name), m]));
  const out = [], seen = new Set();
  for (const r of rows) {
    const g = (k) => (S2.map[k] == null ? "" : r[S2.map[k]]);
    const code = String(g("code") ?? "").trim(), name = String(g("name") ?? "").trim();
    if (!code && !name) continue;
    const price = parsePrice(g("price")), cur = S2.map.cur != null ? curOf(g("cur")) : S2.cur;
    const m = (code && byCode.get(normCode(code))) || (name && byName.get(normName(name))) || null;
    if (m) seen.add(m.id);
    const st = !m ? "new" : price == null ? "noprice" : (num(m.price) === price && (m.cur || "UAH") === cur) ? "same" : "changed";
    out.push({ code, name: name || m?.name || code, unit: String(g("unit") ?? "").trim(), group: String(g("group") ?? "").trim(), price, cur, qty: parsePrice(g("qty")), m, st });
  }
  return { rows: out, missing: list.filter((m) => !seen.has(m.id)) };
}
let impFilter = "";
function importPreviewView(box, S2) {
  const P = S2.preview, cnt = (s) => P.rows.filter((r) => r.st === s).length;
  const ST = { changed: ["змінилась", "chg"], same: ["без змін", "same"], new: ["не розпізнано", "new"], noprice: ["без ціни у файлі", "same"] };
  const shown = P.rows.filter((r) => !impFilter || r.st === impFilter);
  box.append(h("div", { class: "sec-card" }, h("div", { class: "head" }, h("h2", {}, "Перегляд", h("small", {}, `${P.rows.length} рядків у файлі`)),
    h("div", { class: "seg" }, h("button", { class: impFilter ? "" : "on", onclick: () => { impFilter = ""; renderOwn(); } }, "усі"),
      Object.entries(ST).map(([k, [t]]) => h("button", { class: impFilter === k ? "on" : "", onclick: () => { impFilter = k; renderOwn(); } }, `${t}: ${cnt(k)}`)))),
    h("div", { class: "tbl-wrap" }, h("table", { class: "prices imp" }, h("thead", {}, h("tr", {}, ["Стан", "Код", "Назва у файлі", "У довіднику", "Було", "Стане", S2.mode === "bom" ? "К-сть" : ""].map((t, i) => h("th", { class: i === 4 || i === 5 || i === 6 ? "num" : "" }, t)))),
      h("tbody", {}, shown.slice(0, 500).map((r) => h("tr", { class: "st-" + r.st }, h("td", {}, h("span", { class: "stl " + ST[r.st][1] }, ST[r.st][0])), h("td", {}, r.code), h("td", {}, r.name),
        h("td", {}, r.m ? r.m.name : S2.addNew || S2.mode === "bom" ? h("small", {}, "буде додано в довідник") : h("small", { class: "minus" }, "пропущено")),
        h("td", { class: "num" }, r.m && r.m.price != null ? `${fmtN(r.m.price)} ${curSign(r.m.cur)}` : "—"),
        h("td", { class: "num" }, r.price != null ? h("b", {}, `${fmtN(r.price)} ${curSign(r.cur)}`) : "—"),
        h("td", { class: "num" }, S2.mode === "bom" ? fmtN(r.qty) : "")))))),
    P.missing.length && S2.mode === "prices" ? h("p", { class: "hint" }, `У довіднику є ще ${P.missing.length} позицій, яких немає у файлі: їхні ціни не зміняться.`) : null,
    h("div", { class: "inline" }, h("button", { class: "primary", onclick: () => applyImport(S2) }, S2.mode === "bom" ? "Застосувати: ціни і склад виробу" : `Застосувати зміни (${cnt("changed")}${S2.addNew ? ` + нових ${cnt("new")}` : ""})`),
      h("button", { onclick: () => { importState = null; renderOwn(); } }, "Скасувати"))));
}
function applyImport(S2) {
  const P = S2.preview, list = M().list, changes = [];
  const ids = new Map();
  for (const r of P.rows) {
    if (r.m) {
      ids.set(r, r.m.id);
      if (r.st === "changed") { const old = { price: r.m.price, cur: r.m.cur }; r.m.price = r.price; r.m.cur = r.cur; changes.push({ id: r.m.id, name: r.m.name, old, new: { price: r.price, cur: r.cur } }); }
      if (!r.m.code && r.code) r.m.code = r.code;
    } else if (S2.addNew || S2.mode === "bom") {
      const m = { id: newMatId(), code: r.code, name: r.name, unit: r.unit || "шт", group: r.group || "", price: r.price, cur: r.cur };
      list.push(m); ids.set(r, m.id); changes.push({ id: m.id, name: m.name, old: null, new: { price: m.price, cur: m.cur } });
    }
  }
  const bom = [];
  if (S2.mode === "bom") {
    const old = structuredClone(admin.bom[S2.product] || { rows: [], coef: 1, extra: 0 });
    const rows = P.rows.filter((r) => ids.get(r)).map((r) => ({ mat: ids.get(r), qty: r.qty ?? 1 }));
    admin.bom[S2.product] = { ...old, rows };
    bom.push({ product: S2.product, old, new: structuredClone(admin.bom[S2.product]) });
  }
  logChange(`імпорт «${S2.name}»` + (S2.mode === "bom" ? ` → склад: ${productTitle(ownProducts().find((x) => x.id === S2.product))}` : ""), changes, bom);
  saveAdmin(true, "імпорт " + S2.name);
  if (S2.mode === "bom") { ownProduct = S2.product; ownTab = "bom"; }
  else ownTab = "log";
  importState = null; renderOwn(); fixBadge();
  toast(`Імпорт застосовано: змін цін ${changes.filter((c) => c.old).length}, нових ${changes.filter((c) => !c.old).length}`);
}
function ownLog(box) {
  const log = M().log;
  if (!log.length) { box.append(h("p", { class: "hint" }, "Змін ще не було.")); return; }
  for (const e of log) {
    const n = e.changes.length + (e.bom || []).length;
    box.append(h("div", { class: "ver" + (e.undone ? " off" : "") }, h("b", {}, e.at), h("span", { class: "n" }, e.note, h("small", {}, ` · змін: ${n}`)),
      h("details", { class: "pinfo" }, h("summary", {}, "деталі"), h("ul", {}, e.changes.slice(0, 200).map((c) => h("li", {}, c.name + ": ",
        c.old ? `${c.old.price ?? "—"} ${curSign(c.old.cur)}` : "новий", " → ", c.new ? `${c.new.price ?? "—"} ${curSign(c.new.cur)}` : "видалено")),
        (e.bom || []).map((b) => h("li", {}, `склад виробу: ${b.old.rows.length} → ${b.new.rows.length} рядків`)))),
      e.undone ? h("span", { class: "badge gray" }, "відкочено") : h("button", { class: "sm", onclick: () => confirmBox(`Відкотити «${e.note}»? Ціни повернуться до попередніх.`, "Відкотити", () => undoLog(e)) }, "↶ Відкотити")));
  }
}
function undoLog(e) {
  const list = M().list, back = [];
  for (const c of [...e.changes].reverse()) {
    const m = list.find((x) => x.id === c.id);
    if (!c.old) { if (m && !usedIn(m.id).length) { M().list = M().list.filter((x) => x !== m); back.push({ id: c.id, name: c.name, old: { price: m.price, cur: m.cur }, new: null }); } continue; }
    if (!c.new) { if (!m && c.old.row) { M().list.push(c.old.row); back.push({ id: c.id, name: c.name, old: null, new: { price: c.old.price, cur: c.old.cur } }); } continue; }
    if (m) { back.push({ id: m.id, name: m.name, old: { price: m.price, cur: m.cur }, new: { ...c.old } }); m.price = c.old.price; m.cur = c.old.cur; }
  }
  const bom = [];
  for (const b of e.bom || []) { bom.push({ product: b.product, old: structuredClone(admin.bom[b.product] || { rows: [] }), new: structuredClone(b.old) }); admin.bom[b.product] = structuredClone(b.old); }
  e.undone = true;
  logChange("відкат: " + e.note, back, bom);
  saveAdmin(true, "відкат: " + e.note); renderOwn(); fixBadge(); toast("Відкочено");
}

// ------------------------------------------------------------------ settings: versions
async function renderVersions() {
  const box = $("#verList"); box.innerHTML = "<p class='hint'>Читаю версії…</p>";
  $("#verSave").onclick = async () => { const n = $("#verNote").value.trim() || "збережено вручну"; await saveAdmin(true, n); $("#verNote").value = ""; toast("Версію збережено"); renderVersions(); };
  const list = await api("/api/versions");
  box.innerHTML = "";
  list.forEach((v, i) => box.append(h("div", { class: "ver" }, h("b", {}, v.time), h("span", { class: "n" }, v.note || (i === 0 ? "поточний стан" : "автозбереження")),
    i === 0 && !v.note ? h("span", { class: "badge ok" }, "зараз") : h("button", { class: "sm", onclick: () => confirmBox(`Відновити всі налаштування станом на ${v.time}?`, "Відновити", async () => {
      const r = await api("/api/versions/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: v.id }) });
      admin = r.admin; normAdmin(); cat = effCatalog(); toast("Відновлено"); renderVersions(); renderStyleCards(); }) }, "Відновити"))));
  if (!list.length) box.append(h("p", { class: "hint" }, "Версій ще немає: вони з’являться після першої зміни в адмінці."));
}

boot().catch((e) => { document.body.prepend(h("div", { class: "result err" }, "Помилка запуску: " + e.message)); console.error(e); });
