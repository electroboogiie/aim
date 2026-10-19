// Конфігуратор КП (ПК): розрахунок у браузері ядром core/ (те саме, що й у веб-версії), генерація КП — на локальному сервері.
// Адмінка зберігає зміни каталогу як накладку (admin.catalog) поверх catalog.json: правки, власні позиції, приховані, порядок.
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
    group: rule?.group || "admin", history: [] };
}
/** list + {custom, hidden, edits, order} -> list (custom entries appended, hidden removed, edits merged, sorted by order) */
function overlay(list, ov, key = "id") {
  if (!ov) return list;
  const hidden = new Set(ov.hidden || []);
  let out = [...list, ...(ov.custom || []).map((x) => structuredClone(x))].filter((x) => !hidden.has(x[key]));
  out = out.map((x) => (ov.edits?.[x[key]] ? { ...x, ...structuredClone(ov.edits[x[key]]) } : x));
  if (ov.order?.length) {
    const pos = new Map(ov.order.map((k, i) => [k, i]));
    const idx = new Map(out.map((x, i) => [x[key], i]));
    out.sort((a, b) => (pos.get(a[key]) ?? 1e6 + idx.get(a[key])) - (pos.get(b[key]) ?? 1e6 + idx.get(b[key])));
  }
  return out;
}
const CA = () => admin.catalog;
function effCatalog() {
  const c = structuredClone(cat0), A = CA(), P = admin.prices, F = admin.photos;
  for (const x of A.items?.custom || []) c.items.push({ family: "custom", price: { mode: "on_request" }, source: "адмінка", kind: "component", short: "", ...structuredClone(x) });
  for (const i of c.items) {
    const e = A.items?.edits?.[i.id];
    if (e?.title) i.title = e.title;
    if (e?.desc) { if (i.desc_template) i.desc_template = e.desc; else i.short = e.desc; }
    i.price = effRule(i.price, P.items?.[i.id]);
    if (F.items?.[i.id]) i.photo = F.items[i.id];
  }
  const has = new Set(c.items.map((i) => i.id));
  for (const kt of c.kit_types) {
    const k = A.kits?.[kt.id];
    if (k) kt.slots = overlay(kt.slots, k).map((s) => ({ ...s, candidates: s.candidates.filter((id) => has.has(id)) }))
      .filter((s) => s.candidates.length).map((s) => ({ ...s, default: s.default && s.candidates.includes(s.default) ? s.default : s.required ? s.candidates[0] : s.default ? s.candidates[0] : null }));
    kt.choices = kt.choices.filter((ch) => !ch.slot || kt.slots.some((s) => s.id === ch.slot)).map((ch) => effChoice(ch));
  }
  c.accessories = overlay(c.accessories, A.accs).map((a) => ({ ...a, price: effRule(a.price, P.accessories?.[a.id]), photo: F.accessories?.[a.id] || a.photo || "" }));
  for (const b of c.bundles) b.price = effRule(b.price, P.bundles?.[b.id]);
  for (const t of c.texts.terms) { const o = admin.texts?.terms?.[t.id]; if (o?.title) t.title = o.title; if (o?.text) t.text = o.text; }
  return c;
}
function effChoice(ch) {
  const e = CA().choices?.[ch.id];
  if (!e) return ch;
  const out = { ...ch, title: e.title || ch.title, options: overlay(ch.options, e, "value").map((o) => {
    const ed = e.edits?.[o.value] || {};
    const x = { ...o };
    if ("price" in ed) { if (ed.price == null) { delete x.price_uah; x.on_request = true; } else { x.price_uah = ed.price; delete x.on_request; } }
    if (!x.short && x.title) x.short = x.title;
    delete x.price;
    return x;
  }) };
  if (e.default && out.options.some((o) => o.value === e.default)) out.default = e.default;
  if (!out.options.some((o) => o.value === out.default)) out.default = out.options[0]?.value;
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
  admin.photos.items ??= {}; admin.photos.accessories ??= {};
  for (const k of ["items", "bundles", "accessories"]) admin.prices[k] ??= {};
  admin.texts.terms ??= {}; admin.texts.cranes ??= {}; admin.texts.npl ??= {};
}
async function boot() {
  B = await api("/api/bootstrap");
  cat0 = B.catalog; settings = B.settings; admin = B.admin; normAdmin();
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
  ({ "a-style": renderStyleCards, "a-bg": renderBg, "a-texts": renderTexts, "a-kits": renderKitEditor, "a-choices": renderChoiceEditor,
     "a-accs": renderAccEditor, "a-items": renderItemEditor, "a-prices": renderPrices, "a-versions": renderVersions })[id]?.();
}

// ------------------------------------------------------------------ configurator
function kitTypes() { return cat.kit_types.filter((k) => k.id !== "part"); }
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
  for (const k of kitTypes()) box.append(h("button", { class: S.kt?.id === k.id ? "on" : "", onclick: () => setKit(k.id) }, KIT_SHORT[k.id] || k.title));
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
    if (!ts) { base.push(tnode({ photo: core.itemById(cat, "base_outriggers_720")?.photo || "prod/tile_base.png", title: "Кран у комплекті", sub: "без причепа, на основі", on: kt.id === k.id, onclick: () => switchBase(k.id) })); continue; }
    for (const id of ts.candidates) {
      const it = core.itemById(cat, id); if (!it) continue;
      base.push(tnode({ photo: it.photo, title: it.model || it.title, sub: KIT_SHORT[k.id], mark: k.price_display === "bundle" ? "" : itemPriceText(it),
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
      return tnode({ photo: o.photo, title: o.title.replace(/ — .*$/, ""), sub: o.title.includes(" — ") ? o.title.replace(/^.*? — /, "") : "", mark: m, markCls: mc, on: cur === o.value, onclick: () => setChoice(ch.id, o.value) }); });
    cols.push([ch.title.replace(/ \(.*\)$/, "").replace(/ крана$/, ""), nodes]);
  }
  // 4. extras: optional positions (toggle) with their own choices under them, then the kit's other choices
  const extras = [];
  for (const s of markSlots(kt)) {
    const cur = sel.slots[s.id];
    const it = core.itemById(cat, cur || s.default || s.candidates[0]);
    const cands = core.slotCandidates(cat, kt.id, s.id, sel);
    const pick = (cands.find((c) => c.allowed && c.id === s.default) || cands.find((c) => c.allowed))?.id;
    const node = tnode({ photo: it?.photo, title: s.title, sub: cur && it?.unit ? `${S.qty[it.id] ?? it.unit.default} ${it.unit.name}` : "", mark: cur ? "✓ в комплекті" : "+ " + itemPriceText(it), markCls: cur ? "std" : "",
      on: !!cur, dis: !pick && !cur, cls: "tog", onclick: () => setSlot(s.id, cur ? null : pick) });
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
  return h("div", { class: "mini" }, ch.options.filter((o) => core.choiceOptionFits(cat, o, items)).map((o) => h("button", { class: cur === o.value ? "on" : "", title: o.price_uah ? "+" + uah(o.price_uah) : o.on_request && !core.choiceIsStandard(o, items) ? "доплата за запитом" : "",
    onclick: (e) => { e.stopPropagation(); setChoice(ch.id, o.value); } }, o.photo ? h("img", { src: asset(o.photo), alt: "" }) : null, o.title)));
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
    const sel = cands.length > 1 ? h("select", { onchange: (e) => setSlot(slot.id, e.target.value) },
      cands.map((c) => h("option", { value: c.id, disabled: !c.allowed }, (c.item?.title || c.id) + (c.allowed ? "" : " (несумісний)")))) : null;
    if (sel) sel.value = cur || "";
    const unit = it?.unit;
    const qty = unit && on ? h("label", { class: "inline", style: "margin:0" }, h("input", { type: "number", class: "qty", min: unit.min || 1, max: unit.max || "", value: S.qty[it.id] ?? unit.default,
      onchange: (e) => { S.qty[it.id] = num(e.target.value); renderQuote(); } }), unit.name) : null;
    box.append(h("div", { class: "slot" + (on ? " on" : "") }, cbx,
      it?.photo ? lbImg(asset(it.photo), null, { alt: it.title }) : h("span"),
      h("div", {}, h("div", { class: "t" }, slot.title, slot.priced ? h("span", { class: "badge gray" }, "ціна окремо") : null), h("small", {}, it ? core.itemDesc(S.kt, it, S.sel) : "")),
      h("div", { class: "inline", style: "margin:0" }, sel && on ? sel : null, qty)));
  }
  // choices of the kit (захват, розподільник, місце оператора, гальма…)
  const chb = $("#choices"); chb.innerHTML = "";
  const items = core.selectedItems(cat, S.kt, S.sel).map((x) => x.item);
  for (const ch of S.kt.choices) {
    if (ch.slot && !S.sel.slots[ch.slot]) continue;
    const opts = ch.options.filter((o) => core.choiceOptionFits(cat, o, items));
    const sel = h("select", { onchange: (e) => { S.sel = { ...S.sel, choices: { ...S.sel.choices, [ch.id]: e.target.value } }; S.preset = null; renderConf(); renderFeatured(); } },
      opts.map((o) => h("option", { value: o.value }, o.title + (core.choiceIsStandard(o, items) ? " — базовий" : o.price_uah ? ` (+${core.formatUah(o.price_uah)})` : o.on_request ? " — доплата за запитом" : ""))));
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
        h("div", {}, h("b", {}, a.title), (a.base_for || []).includes(S.kt.id) ? h("span", { class: "badge" }, "базова") : null, h("small", {}, ka.desc), on && vs ? vs : null,
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
    const inp = inKit ? h("small", {}, "у комплекті") : h("input", { type: "number", placeholder: "як у адмінці", value: S.manual[r.item_id] ?? "",
      onchange: (e) => { S.manual[r.item_id] = num(e.target.value); renderQuote(); } });
    tb.append(h("tr", {}, h("td", {}, h("b", {}, r.title), h("small", {}, r.desc)), h("td", { class: "num" }, inKit ? "—" : (S.manual[r.item_id] != null ? h("s", {}, admRowPrice(r.item_id)) : r.price_text)), h("td", { class: "num" }, inp)));
  }
  for (const c of q.choices.filter((c) => c.price_uah)) tb.append(h("tr", {}, h("td", {}, h("b", {}, c.title), h("small", {}, c.value_title)), h("td", { class: "num" }, uah(c.price_uah)), h("td")));
  for (const r of q.accessories) tb.append(h("tr", {}, h("td", {}, h("b", {}, r.title), h("small", {}, "опція")), h("td", { class: "num" }, r.price_text), h("td", { class: "num" }, h("small", {}, "у списку опцій"))));
  if (bundle) {
    $("#kitPriceBox").append(h("label", { class: "inline" }, "Ціна комплекту в адмінці: " + uah(q.kit_price_uah ?? null) + ". Фінальна, ₴:",
      h("input", { type: "number", value: S.kitPrice ?? "", placeholder: "як у адмінці", style: "width:140px", onchange: (e) => { S.kitPrice = num(e.target.value); renderQuote(); } })));
  }
  $("#total").textContent = !q.total_uah ? "за запитом" : q.complete === false ? uah(q.total_uah) + " *" : uah(q.total_uah);
  if (q.complete === false) warn.append(h("li", {}, "* не всі позиції мають ціну — сума неповна"));
  for (const w of q.warnings.filter((w) => !/Курс EUR|індекс металу|опорн/i.test(w))) warn.append(h("li", {}, w));
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

async function generate(asNew) {
  if (!lastQuote) return toast("Спершу виправте комплект");
  const qi = quoteInput();
  const errs = core.validateSelection(cat, qi);
  if (errs.length) return toast(errs[0]);
  let spec;
  try {
    spec = core.buildKpSpec(cat, settings, lastQuote, { number: $("#kpNumber").value || "0001",
      client: { name: $("#client").value.trim() || "Назва замовника", contact: $("#clientContact").value.trim() },
      offer_accessories: $("#offerAcc").checked });
  } catch (e) { return toast((e.errors || [String(e)])[0]); }
  for (const r of spec.rows) if (r.item_id && admin.photos.items[r.item_id]) { r.photo = admin.photos.items[r.item_id]; r.photo_force = true; }
  const lead = admin.texts.cranes?.[spec.crane?.profile];
  if (spec.crane && lead?.lead) spec.crane.lead = lead.lead;
  if (spec.crane && lead?.lead2) spec.crane.lead2 = lead.lead2;
  if (spec.npl) { if (admin.texts.npl?.lead) spec.npl.lead = admin.texts.npl.lead; if (admin.texts.npl?.lead2) spec.npl.lead2 = admin.texts.npl.lead2; }
  if (admin.texts.price_note) spec.price_note = admin.texts.price_note;
  spec.style = $("#styleChips").dataset.v || "dark";
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
          h("button", { class: "sm", onclick: () => editHist(x) }, "Дані"),
          h("button", { class: "sm danger", onclick: () => confirmBox(`Видалити КП № ${x.number} (${x.client || "без замовника"})? Файли PPTX і PDF теж буде видалено.`, "Видалити",
            async () => { await api("/api/history/" + x.id, { method: "DELETE" }); toast("КП видалено"); renderHist(); }) }, "Видалити")))));
  }
  if (!shown.length) box.append(h("div", { class: "empty" }, list.length ? "Нічого не знайдено." : "Ще немає КП. Створіть першу в конфігураторі."));
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

// ------------------------------------------------------------------ admin: saving, photo versions
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

// ------------------------------------------------------------------ admin: look of the KP
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

// ------------------------------------------------------------------ admin: catalog — kit positions
let edKit = "crane_kit";
const ovOf = (root, id) => { const r = (CA()[root] ??= {}); return id === undefined ? r : (r[id] ??= {}); };
function moveIn(ovObj, ids, id, dir) {
  const order = [...ids]; const i = order.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]]; ovObj.order = order;
}
/** Photo cell: thumbnail (click = view), ✎ uploads a new photo (the old one goes to versions), ↺ opens versions. */
function photoCell({ key, path, title, set, kind = "tile", rerender }) {
  const nh = (admin.photo_history[key] || []).length;
  const pv = (p) => `/api/preview/item?${qs({ style: admin.style || "dark", path: p, kind })}`;
  return h("div", { class: "pcell" + (path ? "" : " empty") },
    path ? lbImg(asset(path), [{ src: asset(path), label: "Оригінал" }, { src: pv(path), label: "Як у КП" }], { alt: title })
      : h("button", { class: "add", title: "Додати фото", onclick: () => filePick((p) => { set(p); saveAdmin(); rerender(); }) }, "＋ фото"),
    path ? h("div", { class: "pc-acts" },
      h("button", { title: "Інше фото", onclick: () => filePick((p) => { remember(key, { path }); set(p); saveAdmin(); rerender(); }) }, "✎"),
      nh ? h("button", { title: "Версії фото", onclick: () => versionsDialog(`${title}: версії фото`, key, { path }, (v) => pv(v.path), (v) => { set(v.path); rerender(); }) }, "↺" + nh) : null) : null);
}
function itemThumb(it, kind = "tile") {
  if (!it?.photo) return h("div", { class: "thumb none" }, "без фото");
  const pv = `/api/preview/item?${qs({ style: admin.style || "dark", path: it.photo, kind })}`;
  return lbImg(asset(it.photo), [{ src: pv, label: "Як у КП" }, { src: asset(it.photo), label: "Оригінал" }], { class: "thumb", alt: it.title });
}
function renderKitEditor() {
  cat = effCatalog();
  const seg = $("#kitSeg"); seg.innerHTML = "";
  for (const k of kitTypes()) seg.append(h("button", { class: edKit === k.id ? "on" : "", onclick: () => { edKit = k.id; renderKitEditor(); } }, KIT_SHORT[k.id] || k.title));
  const kt0 = core.kitTypeById(cat0, edKit), kt = core.kitTypeById(cat, edKit), K = ovOf("kits", edKit);
  const box = $("#kitEditor"); box.innerHTML = "";
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
        h("div", { class: "chips" }, s.candidates.map((id) => h("span", { class: "chip" + (id === s.default ? " on" : "") }, core.itemById(cat, id)?.title || id))),
        s.priced ? h("small", { class: "hint", style: "margin:0" }, "ціна окремо, додається до ціни комплекту") : null),
      h("div", { class: "ed-side" },
        h("label", { class: "toggle", title: s.required ? "обов’язкова позиція" : "" }, h("input", { type: "checkbox", checked: base, disabled: s.required,
          onchange: (e) => set({ default: e.target.checked ? (kt0.slots.find((x) => x.id === s.id)?.default || s.candidates[0]) : null }) }), base ? "базова" : "додаткова"),
        s.required || isTitle ? h("small", { class: "hint", style: "margin:0" }, "обов’язкова") :
          h("button", { class: "sm danger", onclick: () => confirmBox(`Прибрати позицію «${s.title}» з комплекту «${KIT_SHORT[edKit]}»?`, "Прибрати", () => {
            if (custom) { K.custom = K.custom.filter((x) => x.id !== s.id); } else (K.hidden ??= []).push(s.id);
            saveAdmin(); renderKitEditor(); }) }, custom ? "Видалити" : "Прибрати"))));
  }
  const hiddenSlots = (K.hidden || []).map((id) => kt0.slots.find((s) => s.id === id)).filter(Boolean);
  box.append(h("div", { class: "sec-card" }, h("div", { class: "head" }, h("h2", {}, KIT_SHORT[edKit] || kt.title, h("small", {}, `${kt.slots.length} позицій · ${kt.price_display === "bundle" ? "одна ціна комплекту" : "ціна по рядках"}`)),
    h("button", { class: "primary sm", onclick: () => addPositionDialog(kt) }, "＋ Додати позицію")), list,
    hiddenSlots.length ? h("div", { class: "inline", style: "margin-top:12px" }, h("span", { class: "hint", style: "margin:0" }, "Прибрані:"),
      hiddenSlots.map((s) => h("button", { class: "sm", onclick: () => { K.hidden = K.hidden.filter((x) => x !== s.id); saveAdmin(); renderKitEditor(); } }, `↩ ${s.title}`))) : null));
}
function addPositionDialog(kt) {
  const f = {}; let photo = null;
  const ph = h("div", { class: "inline" }, h("button", { class: "sm", onclick: () => filePick((p) => { photo = p; ph.querySelector("span").textContent = "✓ фото завантажено"; }) }, "Завантажити фото"), h("span", { class: "hint", style: "margin:0" }, "необов’язково"));
  modal(h("div", { class: "form" }, h("h2", {}, `Нова позиція: ${KIT_SHORT[kt.id] || kt.title}`),
    h("label", {}, "Назва (як у рядку КП)", f.title = h("input", { placeholder: "Напр. Ящик для інструменту" })),
    h("label", {}, "Опис", f.desc = h("textarea", { rows: 2 })),
    h("label", {}, "Базова ціна, ₴ (порожньо — за запитом)", f.price = h("input", { type: "number" })),
    h("label", { class: "toggle" }, f.base = h("input", { type: "checkbox", checked: true }), "базова — одразу в комплекті"),
    ph, kt.price_display === "bundle" ? h("p", { class: "hint" }, "У цьому комплекті одна ціна: нова позиція матиме свою ціну і додасться до ціни комплекту.") : null,
    h("div", { class: "acts" }, h("button", { onclick: closeModal }, "Скасувати"), h("button", { class: "primary", onclick: () => {
      const title = f.title.value.trim(); if (!title) return toast("Вкажіть назву");
      const id = "u_" + Date.now().toString(36);
      const I = ovOf("items"); (I.custom ??= []).push({ id, kind: "component", title, short: f.desc.value.trim() || title });
      if (num(f.price.value) != null) admin.prices.items[id] = { base: num(f.price.value) };
      if (photo) admin.photos.items[id] = photo;
      const K = ovOf("kits", kt.id);
      (K.custom ??= []).push({ id, title, candidates: [id], required: false, default: f.base.checked ? id : null, ...(kt.price_display === "bundle" ? { priced: true } : {}) });
      saveAdmin(); closeModal(); renderKitEditor(); toast("Позицію додано");
    } }, "Додати"))));
}

// ------------------------------------------------------------------ admin: catalog — choices (захват, розподільник…)
const CRANES = () => cat.items.filter((i) => i.kind === "crane").sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || a.id.localeCompare(b.id));
function renderChoiceEditor() {
  cat = effCatalog();
  const box = $("#choiceEditor"); box.innerHTML = "";
  const byId = new Map();
  for (const kt of cat0.kit_types) for (const ch of kt.choices) { if (!byId.has(ch.id)) byId.set(ch.id, { ch, kits: [] }); byId.get(ch.id).kits.push(kt.id); }
  for (const [id, { ch: ch0, kits }] of byId) {
    const E = ovOf("choices", id);
    const ch = effChoice(ch0);
    const craneBound = ch0.slot === "crane";
    const cranes = CRANES();
    const values = ch.options.map((o) => o.value);
    const ed = (v) => ((E.edits ??= {})[v] ??= {});
    const custom = (v) => (E.custom || []).some((x) => x.value === v);
    const tbl = h("table", { class: "opt-table" }, h("thead", {}, h("tr", {}, h("th", {}), h("th", {}, "Фото"), h("th", {}, "Варіант"), h("th", {}, "Текст в описі КП"), h("th", { class: "num" }, "Доплата, ₴"),
      craneBound ? cranes.map((c) => h("th", { class: "cr" }, c.model)) : h("th", { class: "cr" }, "Базовий"), h("th"))));
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
        Object.assign(ed(o.value), { compatible: comp, default_for: df });
        saveAdmin(); renderChoiceEditor();
      };
      tb.append(h("tr", {},
        h("td", {}, h("div", { class: "ord" }, h("button", { class: "icon sm", onclick: () => { moveIn(E, values, o.value, -1); saveAdmin(); renderChoiceEditor(); } }, "▲"), h("button", { class: "icon sm", onclick: () => { moveIn(E, values, o.value, 1); saveAdmin(); renderChoiceEditor(); } }, "▼"))),
        h("td", {}, photoCell({ key: `ch:${id}:${o.value}`, path: o.photo, title: o.title, kind: "card", set: (p) => { if (custom(o.value)) E.custom.find((x) => x.value === o.value).photo = p; else ed(o.value).photo = p; }, rerender: renderChoiceEditor })),
        h("td", {}, h("input", { value: o.title, onchange: (e) => { ed(o.value).title = e.target.value; saveAdmin(); } })),
        h("td", {}, h("input", { value: o.short || "", onchange: (e) => { ed(o.value).short = e.target.value; saveAdmin(); } })),
        h("td", { class: "num" }, h("input", { type: "number", value: o.price_uah ?? "", placeholder: o.on_request ? "за запитом" : "0", style: "width:110px",
          onchange: (e) => { ed(o.value).price = num(e.target.value); saveAdmin(); } })),
        craneBound ? cranes.map((c) => { const v = stateFor(c); return h("td", { class: "cr" }, h("select", { class: "sm", value: v, style: v === "std" ? "border-color:var(--ok);color:var(--ok);font-weight:600" : v === "no" ? "color:var(--mut2)" : "",
            onchange: (e) => setState(c, e.target.value) }, h("option", { value: "std" }, "★ базовий"), h("option", { value: "ok" }, "✓ так"), h("option", { value: "no" }, "— ні"))); })
          : h("td", { class: "cr" }, h("input", { type: "radio", name: "def_" + id, checked: ch.default === o.value, onchange: () => { E.default = o.value; saveAdmin(); } })),
        h("td", {}, h("button", { class: "sm danger", disabled: ch.options.length < 2, onclick: () => {
          if (custom(o.value)) E.custom = E.custom.filter((x) => x.value !== o.value); else (E.hidden ??= []).push(o.value);
          saveAdmin(); renderChoiceEditor(); } }, custom(o.value) ? "Видалити" : "Прибрати"))));
    }
    const hiddenOpts = (E.hidden || []).map((v) => ch0.options.find((o) => o.value === v)).filter(Boolean);
    box.append(h("div", { class: "sec-card" }, h("div", { class: "head" },
      h("div", { class: "inline", style: "margin:0" }, h("input", { value: ch.title, style: "font-weight:700;font-size:15px;width:260px", onchange: (e) => { E.title = e.target.value; saveAdmin(); } }),
        h("span", { class: "hint", style: "margin:0" }, "у комплектах: " + kits.map((k) => KIT_SHORT[k] || k).join(", "))),
      h("button", { class: "sm primary", onclick: () => {
        const v = "u_" + Date.now().toString(36);
        (E.custom ??= []).push({ value: v, title: "Новий варіант", short: craneBound && id === "grapple" ? "захватом …" : "Новий варіант", on_request: true, ...(craneBound ? { compatible: cranes.map((c) => c.id) } : {}),
          ...(id === "valve" ? { crane_note: "розподільник …" } : {}) });
        saveAdmin(); renderChoiceEditor(); } }, "＋ Додати варіант")),
      h("div", { class: "tbl-wrap" }, tbl), craneBound ? h("p", { class: "hint", style: "margin:8px 0 0" }, "★ базовий — стоїть у крані за замовчуванням, без доплати і без примітки в КП; ✓ — можна обрати; — — не підходить до цього крана.") : null,
      hiddenOpts.length ? h("div", { class: "inline" }, h("span", { class: "hint", style: "margin:0" }, "Прибрані:"), hiddenOpts.map((o) => h("button", { class: "sm", onclick: () => { E.hidden = E.hidden.filter((x) => x !== o.value); saveAdmin(); renderChoiceEditor(); } }, "↩ " + o.title))) : null));
  }
}

// ------------------------------------------------------------------ admin: catalog — options (accessories)
function renderAccEditor() {
  cat = effCatalog();
  $("#addAcc").onclick = () => addAccDialog();
  const box = $("#accEditor"); box.innerHTML = "";
  const A = ovOf("accs");
  const ids = cat.accessories.map((a) => a.id);
  const targets = cat.items.filter((i) => i.kind === "crane" || i.kind === "trailer");
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
      const nh = (admin.photo_history[key] || []).length;
      list.append(h("div", { class: "ed-row" },
        h("div", { class: "ord" }, h("button", { onclick: () => move(-1) }, "▲"), h("button", { onclick: () => move(1) }, "▼")),
        a.photo ? lbImg(asset(a.photo), [{ src: `/api/preview/item?${qs({ style: admin.style || "dark", path: a.photo, kind: "card" })}`, label: "Як у КП" }, { src: asset(a.photo), label: "Оригінал" }], { class: "thumb", alt: a.title }) : h("div", { class: "thumb none" }, "без фото"),
        h("div", { class: "ed-main" },
          h("input", { value: a.title, style: "font-weight:600", onchange: (e) => set({ title: e.target.value }, false) }),
          h("textarea", { rows: 2, onchange: (e) => set({ desc: e.target.value }, false) }, a.desc),
          a.variants?.length ? h("div", { class: "chips" }, h("span", { class: "hint", style: "margin:0" }, "варіанти:"), a.variants.map((v) => h("span", { class: "chip" }, v.title))) : null,
          h("div", { class: "sm-l" }, "Підходить до"),
          h("div", { class: "chips" }, targets.map((t) => { const on = !comp || comp.includes(t.id); return h("label", { class: "chip" + (on ? " on" : "") },
            h("input", { type: "checkbox", checked: on, onchange: (e) => { const cur = comp ? [...comp] : targets.map((x) => x.id);
              set({ compatible: e.target.checked ? [...new Set([...cur, t.id])] : cur.filter((x) => x !== t.id) }); } }), t.model || t.title); })),
          h("div", { class: "sm-l" }, "Базова (одразу позначена) для комплектів"),
          h("div", { class: "chips" }, kitTypes().filter((k) => k.accessory_groups.includes(g)).map((k) => { const on = (a.base_for || []).includes(k.id); return h("label", { class: "chip" + (on ? " std" : "") },
            h("input", { type: "checkbox", checked: on, onchange: (e) => { const cur = a.base_for || []; set({ base_for: e.target.checked ? [...cur, k.id] : cur.filter((x) => x !== k.id) }); } }), KIT_SHORT[k.id] || k.title); }))),
        h("div", { class: "ed-side" }, h("b", {}, price), h("button", { class: "sm", onclick: () => sub("a-prices") }, "Ціна"),
          h("select", { class: "sm", value: a.group, onchange: (e) => set({ group: e.target.value }) }, Object.entries(GROUPS).map(([k, t]) => h("option", { value: k }, t))),
          h("button", { class: "sm", onclick: () => filePick((p) => { remember(key, admin.photos.accessories[a.id] ? { path: admin.photos.accessories[a.id] } : null); admin.photos.accessories[a.id] = p; saveAdmin(); renderAccEditor(); }) }, a.photo ? "Інше фото" : "Додати фото"),
          h("button", { class: "sm", disabled: !nh, onclick: () => versionsDialog(`${a.title}: версії фото`, key, a.photo ? { path: a.photo } : null,
            (v) => `/api/preview/item?${qs({ style: admin.style || "dark", path: v.path, kind: "card" })}`, (v) => { admin.photos.accessories[a.id] = v.path; renderAccEditor(); }) }, `Версії${nh ? ` (${nh})` : ""}`),
          h("button", { class: "sm danger", onclick: () => confirmBox(`${custom ? "Видалити" : "Прибрати"} опцію «${a.title}»?`, custom ? "Видалити" : "Прибрати", () => {
            if (custom) A.custom = A.custom.filter((x) => x.id !== a.id); else (A.hidden ??= []).push(a.id); saveAdmin(); renderAccEditor(); }) }, custom ? "Видалити" : "Прибрати"))));
    }
    box.append(h("div", { class: "sec-card" }, h("div", { class: "head" }, h("h2", {}, GROUPS[g], h("small", {}, `${inG.length} опцій`))), list));
  }
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
      (ovOf("accs").custom ??= []).push({ id, group: f.group.value, title, desc: f.desc.value.trim() || title, photo: "", price: { mode: "on_request" }, source: "адмінка" });
      if (num(f.price.value) != null) admin.prices.accessories[id] = { base: num(f.price.value) };
      if (photo) admin.photos.accessories[id] = photo;
      saveAdmin(); closeModal(); renderAccEditor(); toast("Опцію додано");
    } }, "Додати"))));
}

// ------------------------------------------------------------------ admin: items and photos
let itemStyle = null;
function sameGroups(list) {
  const groups = new Map();
  for (const i of list) { const k = i.kind + "|" + i.title; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
  return [...groups.values()];
}
function renderItemEditor() {
  cat = effCatalog();
  itemStyle ??= admin.style || "dark";
  const seg = $("#itemStyleSeg"); seg.innerHTML = "";
  for (const s of B.styles.filter((s) => s.id !== "npl_label")) seg.append(h("button", { class: itemStyle === s.id ? "on" : "", onclick: () => { itemStyle = s.id; renderItemEditor(); } }, s.title));
  const box = $("#itemEditor"); box.innerHTML = "";
  const customIds = new Set((CA().items?.custom || []).map((x) => x.id));
  const sections = [...Object.entries(KINDS).map(([k, t]) => [t, cat.items.filter((i) => i.kind === k && !customIds.has(i.id))]), ["Власні позиції (додані в адмінці)", cat.items.filter((i) => customIds.has(i.id))]];
  for (const [title, list0] of sections) {
    if (!list0.length) continue;
    const list = [...list0].sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
    const grid = h("div", { class: "items-grid" });
    for (const grp of sameGroups(list)) {
      const it = grp[0], key = "item:" + it.id, nh = (admin.photo_history[key] || []).length;
      const own = admin.photos.items[it.id];
      const pv = it.photo ? `/api/preview/item?${qs({ style: itemStyle, path: it.photo, kind: "tile" })}` : null;
      const E = ovOf("items"); const ed = () => ((E.edits ??= {})[it.id] ??= {});
      const setAll = (patch) => { for (const x of grp) { if (customIds.has(x.id)) Object.assign(E.custom.find((c) => c.id === x.id), patch.title ? { title: patch.title } : {}, patch.desc ? { short: patch.desc } : {}); else Object.assign(((E.edits ??= {})[x.id] ??= {}), patch); } saveAdmin(); };
      const descVal = it.desc_template || it.short || "";
      grid.append(h("div", { class: "icard" },
        h("div", { class: "pv" }, pv ? lbImg(pv, [{ src: pv, label: "Як у КП" }, { src: asset(it.photo), label: "Оригінал" }], { class: "big", alt: it.title }) : h("div", { class: "none" }, "без фото"),
          it.photo ? lbImg(asset(it.photo), null, { class: "orig", alt: "оригінал" }) : null),
        h("div", {}, h("div", {}, h("span", { class: "t" }, it.model || ""), it.featured ? h("span", { class: "badge" }, "основний") : null, own ? h("span", { class: "badge ok" }, "своє фото") : null),
          grp.length > 1 ? h("small", {}, "для " + grp.map((x) => x.specs?.crane || x.id).join(" · ")) : null,
          h("input", { value: it.title, onchange: (e) => setAll({ title: e.target.value }) }),
          h("textarea", { rows: 2, title: it.desc_template ? "{grapple} — обраний захват, {seat_pos} — місце оператора, {brakes}, {stakes} — параметри НПЛ-10" : "", onchange: (e) => setAll({ desc: e.target.value }) }, descVal),
          h("div", { class: "acts" },
            h("button", { class: "sm primary", onclick: () => filePick((p) => { remember(key, own ? { path: own } : (it.photo ? { path: it.photo } : null)); for (const x of grp) admin.photos.items[x.id] = p; saveAdmin(); renderItemEditor(); }) }, it.photo ? "Інше фото" : "Додати фото"),
            h("button", { class: "sm", disabled: !nh, onclick: () => versionsDialog(`${it.title}: версії фото`, key, it.photo ? { path: it.photo } : null,
              (v) => `/api/preview/item?${qs({ style: itemStyle, path: v.path, kind: "tile" })}`, (v) => { for (const x of grp) admin.photos.items[x.id] = v.path; renderItemEditor(); }) }, `Версії${nh ? ` (${nh})` : ""}`),
            own ? h("button", { class: "sm", onclick: () => { remember(key, { path: own }); for (const x of grp) delete admin.photos.items[x.id]; saveAdmin(); renderItemEditor(); } }, "Фото каталогу") : null,
            customIds.has(it.id) ? h("button", { class: "sm danger", onclick: () => confirmBox(`Видалити позицію «${it.title}» з каталогу і комплектів?`, "Видалити", () => {
              E.custom = E.custom.filter((x) => x.id !== it.id);
              for (const K of Object.values(CA().kits || {})) K.custom = (K.custom || []).filter((s) => !s.candidates.includes(it.id));
              saveAdmin(); renderItemEditor(); }) }, "Видалити") : null))));
    }
    box.append(h("h2", { class: "sec" }, title), grid);
  }
}

// ------------------------------------------------------------------ admin: prices
function priceTitle(x, list) {
  const dup = list.filter((y) => y.title === x.title).length > 1;
  return dup ? `${x.title} — ${x.specs?.crane || x.model || x.id}` : x.title;
}
function renderPrices() {
  cat = effCatalog();
  $("#roundStep").textContent = settings.rounding_uah || 1;
  const items = cat.items.map((i) => ({ ...i, price: cat0.items.find((o) => o.id === i.id)?.price || { mode: "on_request" } }));
  const groups = [...Object.entries(KINDS).map(([k, t]) => ({ key: "items:" + k, title: t, kind: "items",
      list: items.filter((i) => i.kind === k).sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0)).map((x, _, l) => ({ ...x, title: priceTitle(x, l) })) })),
    { key: "bundles", title: "Комплекти з однією ціною (НПЛ-10, причепи BMF, КРАЗ)", kind: "bundles", list: cat0.bundles.map((b) => ({ ...b, title: bundleTitle(b) })) },
    { key: "accessories", title: "Додаткові опції", kind: "accessories", list: cat.accessories.map((a) => ({ ...a, price: cat0.accessories.find((o) => o.id === a.id)?.price || { mode: "on_request" } })) }];
  const bg = $("#bulkGroup"); bg.innerHTML = ""; groups.forEach((g) => bg.append(h("option", { value: g.key }, g.title)));
  $("#bulkApply").onclick = () => {
    const g = groups.find((x) => x.key === bg.value), pct = num($("#bulkPct").value);
    if (pct == null) return toast("Вкажіть націнку");
    for (const x of g.list) { const r = (admin.prices[g.kind][x.id] ??= {}); r.markup = pct; }
    saveAdmin(); renderPrices(); toast("Націнку застосовано");
  };
  const box = $("#priceTables"); box.innerHTML = "";
  for (const g of groups) {
    if (!g.list.length) continue;
    const tbl = h("table", { class: "prices" }, h("thead", {}, h("tr", {}, ["Позиція", "Базова, ₴", "Націнка, %", "Розрахункова", "Фінальна, ₴", "У КП", "Додана вартість"].map((t, i) => h("th", { class: i ? "num" : "" }, t)))));
    const tb = h("tbody"); tbl.append(tb);
    for (const x of g.list) {
      const rec = admin.prices[g.kind][x.id] || {};
      const p = priceOf(rec, x.price);
      const calc = h("td", { class: "num" }), fin = h("td", { class: "num" }), add = h("td", { class: "num" });
      const upd = () => {
        const q = priceOf(admin.prices[g.kind][x.id] || {}, x.price);
        calc.textContent = uah(q.calc); fin.innerHTML = ""; fin.append(h("b", {}, q.price == null ? "за запитом" : uah(q.price)));
        const d = q.price != null && q.base != null ? q.price - q.base : null;
        add.innerHTML = ""; if (d != null) add.append(h("span", { class: d >= 0 ? "plus" : "minus" }, (d >= 0 ? "+" : "−") + core.formatUah(Math.abs(d)) + (q.base ? ` (${(d / q.base * 100).toFixed(1).replace(".", ",")} %)` : "")));
      };
      const set = (k) => (e) => { const r = (admin.prices[g.kind][x.id] ??= {}); const v = num(e.target.value); if (v == null) delete r[k]; else r[k] = v;
        if (!Object.keys(r).length) delete admin.prices[g.kind][x.id]; saveAdmin(); upd(); };
      const unit = x.unit ? ` (за ${x.unit.per} ${x.unit.name})` : "";
      tb.append(h("tr", {}, h("td", {}, x.title + unit, x.featured ? h("span", { class: "badge" }, "основний") : null, x.price?.date ? h("small", { style: "display:block;color:#6B727B" }, "з КП " + core.formatDate(x.price.date)) : null),
        h("td", { class: "num" }, h("input", { type: "number", value: rec.base ?? "", placeholder: p.base ?? "—", onchange: set("base") })),
        h("td", { class: "num" }, h("input", { type: "number", step: 0.5, value: rec.markup ?? "", placeholder: "0", style: "width:70px", onchange: set("markup") })),
        calc, h("td", { class: "num" }, h("input", { type: "number", value: rec.final ?? "", placeholder: "—", onchange: set("final") })), fin, add));
      upd();
    }
    box.append(h("div", { class: "sec-card" }, h("div", { class: "head" }, h("h2", {}, g.title, h("small", {}, `${g.list.length}`))), tbl));
  }
}
function bundleTitle(b) {
  return Object.values(b.slots).map((id) => core.modelName(core.itemById(cat0, id) || { title: id })).join(" + ");
}

// ------------------------------------------------------------------ admin: versions
async function renderVersions() {
  const box = $("#verList"); box.innerHTML = "<p class='hint'>Читаю версії…</p>";
  $("#verSave").onclick = async () => { const n = $("#verNote").value.trim() || "збережено вручну"; await saveAdmin(true, n); $("#verNote").value = ""; toast("Версію збережено"); renderVersions(); };
  const list = await api("/api/versions");
  box.innerHTML = "";
  list.forEach((v, i) => box.append(h("div", { class: "ver" }, h("b", {}, v.time), h("span", { class: "n" }, v.note || (i === 0 ? "поточний стан" : "автозбереження")),
    i === 0 && !v.note ? h("span", { class: "badge ok" }, "зараз") : h("button", { class: "sm", onclick: () => confirmBox(`Відновити налаштування адмінки станом на ${v.time}?`, "Відновити", async () => {
      const r = await api("/api/versions/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: v.id }) });
      admin = r.admin; normAdmin(); cat = effCatalog(); toast("Відновлено"); renderVersions(); renderStyleCards(); }) }, "Відновити"))));
  if (!list.length) box.append(h("p", { class: "hint" }, "Версій ще немає: вони з’являться після першої зміни в адмінці."));
}

boot().catch((e) => { document.body.prepend(h("div", { class: "result err" }, "Помилка запуску: " + e.message)); console.error(e); });
