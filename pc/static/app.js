// Конфігуратор КП (ПК): розрахунок у браузері ядром core/ (те саме, що й у веб-версії), генерація КП — на локальному сервері.
// «Налаштування» зберігають зміни каталогу як накладку (admin.catalog) поверх catalog.json: правки, власні позиції, гілки комплектів, вимкнені, порядок.
// Ціни: чернетка (вручну, € × коеф. × курс, з матеріалів, сума позицій) -> «Зафіксувати» -> admin.fixed, за якими рахуються КП.
import * as core from "./core/index.js";

const $ = (s, el = document) => el.querySelector(s);
const KB_NATIVE = new Set(["button", "a", "input", "select", "textarea", "label", "summary", "option"]);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") el.className = v; else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v; else if (k === "value" || k === "checked") continue;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  // clickable non-controls (tree nodes, cells) are reachable by keyboard: Tab to them, Enter or Space clicks
  if (attrs?.onclick && !KB_NATIVE.has(tag) && !el.hasAttribute("tabindex")) { el.tabIndex = 0; if (!el.hasAttribute("role")) el.setAttribute("role", "button"); }
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
const S = { kt: null, sel: null, manual: {}, kitPrice: null, discount: 0, qty: {}, historyId: null, preset: null, extras: [], itemized: false,
  edits: null, editLog: {}, basePreset: null };   // page editor: this KP's page edits, what each change is saved to, the ready kit it came from
const KINDS = { crane: "Крани BMF", trailer: "Причепи", component: "Комплектуючі", service: "Послуги" };
const KIT_SHORT = { crane_kit: "Кран у комплекті", npl_crane: "НПЛ-10 + кран", bmf_trailer_crane: "Причіп BMF + кран", truck_crane: "Вантажівка + кран" };
const GROUPS = { crane: "Для крана", trailer: "Для причепа", truck: "Для вантажівки" };

// ------------------------------------------------------------------ modal and lightbox
function modal(...content) {
  $(".modal-box").classList.remove("wide");
  $("#modalBody").innerHTML = ""; $("#modalBody").append(...content); $("#modal").hidden = false;
}
/** A KP's PDF inside the app: the browser's own viewer in a large window, with the PPTX and a new tab one click away. */
function pdfViewer(pdf, title, pptx) {
  const name = decodeURIComponent(pdf.split("/").pop() || "KP.pdf");
  // phones (Android Chrome, the installed app) have no PDF viewer inside a page: pages are drawn by pdf.js
  const own = navigator.pdfViewerEnabled === false || matchMedia("(pointer: coarse) and (max-width: 900px)").matches;
  const pages = own ? h("div", { class: "pdfv-pages" }, h("div", { class: "hint" }, "Відкриваю PDF…")) : null;
  modal(h("div", { class: "pdfv" },
    h("div", { class: "pdfv-h" }, h("h2", {}, title || "КП"),
      canShareFiles() ? h("button", { class: "sm primary", onclick: () => sharePdf(pdf, name, title) }, "Надіслати") : null,
      own ? null : h("a", { class: "btn sm", href: pdf, target: "_blank" }, "У новому вікні"),
      h("a", { class: "btn sm", href: pdf, download: name }, "Завантажити PDF"),
      pptx && !IS_PHONE ? h("a", { class: "btn sm", href: pptx }, "PPTX") : null),
    own ? pages : h("iframe", { src: pdf + "#view=FitH", title: "PDF: " + (title || name) })));
  $(".modal-box").classList.add("wide");
  if (own) drawPdf(pdf, pages);
}
async function drawPdf(url, box) {
  try {
    const pdfjs = await import("./vendor/pdfjs/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
    const doc = await pdfjs.getDocument({ url, isEvalSupported: false }).promise;
    box.innerHTML = "";
    const w = Math.min(box.clientWidth || innerWidth, 1100) * Math.min(devicePixelRatio || 1, 2);
    for (let i = 1; i <= doc.numPages; i++) {
      if (!box.isConnected) return;   // the window was closed
      const page = await doc.getPage(i), vp0 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: w / vp0.width });
      const c = h("canvas", { width: Math.round(vp.width), height: Math.round(vp.height), "aria-label": `Сторінка ${i}` });
      box.append(c);
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    }
  } catch (e) { box.innerHTML = ""; box.append(h("div", { class: "hint" }, "Не вдалося показати PDF: " + e.message + ". Натисніть «Завантажити PDF».")); }
}
const canShareFiles = () => !!(navigator.canShare && window.File && navigator.canShare({ files: [new File([""], "x.pdf", { type: "application/pdf" })] }));
/** Viber, Telegram, пошта…: the phone's own «Надіслати» with the KP's PDF attached. */
async function sharePdf(url, name, title) {
  try {
    const blob = await (await fetch(url)).blob();
    await navigator.share({ files: [new File([blob], name, { type: "application/pdf" })], title: title || name });
  } catch (e) { if (e.name !== "AbortError") toast("Не вдалося надіслати: " + e.message); }
}
function closeModal() { $("#modal").hidden = true; $("#modalBody").innerHTML = ""; }
function lightbox(views, caption) {
  const img = h("img", { src: views[0].src, alt: caption || "фото" });
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
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
  const t = e.target;
  if ((e.key === "Enter" || e.key === " ") && t.getAttribute?.("role") === "button" && !KB_NATIVE.has(t.tagName.toLowerCase())) { e.preventDefault(); t.click(); }
});
const lbImg = (src, views, attrs = {}) => h("img", { src, loading: "lazy", "data-lb": views ? JSON.stringify(views) : "", ...attrs });
function confirmBox(text, okText, onOk) {
  modal(h("div", { class: "form" }, h("h2", {}, text), h("div", { class: "acts" },
    h("button", { onclick: closeModal }, "Скасувати"), h("button", { class: "primary", onclick: async () => { closeModal(); await onOk(); } }, okText))));
}

// ------------------------------------------------------------------ settings -> effective catalog
function origUah(rule) { return rule && rule.mode === "ref" && typeof rule.uah === "number" ? rule.uah : null; }
const eurRate = () => num(admin.eur?.rate);
const fmtN = (n, d = 2) => (n == null ? "—" : Number(n).toLocaleString("uk-UA", { maximumFractionDigits: d }));
const PRICE_MODES = { manual: "вручну, ₴", eur: "€ × коеф. × курс", bom: "з калькуляції", sum: "сума позицій" };
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
const labMap = () => new Map((admin.labour || []).map((w) => [w.id, w]));
/** Calculations by the product name from 1C («Готовий виріб "Місце оператора в зборі"…»): such a row in another calculation is a sub-assembly. */
const specByName = () => new Map(Object.entries(admin.bom || {}).filter(([, b]) => b.title && b.rows?.length).map(([id, b]) => [normName(b.title), id]));
/**
 * Cost of an own-production position from its calculation: materials Σ qty × price (a sub-assembly row takes the cost of its own
 * calculation) + works Σ hours × rate, × coefficient, + other costs. ref = the calculation of another position is used.
 */
function bomCost(id, depth = 0) {
  let b = admin.bom?.[id], via = null;
  if (b?.ref && depth < 3) { via = b.ref; b = admin.bom?.[b.ref]; }
  if (!b?.rows?.length) return null;
  const mats = matMap(), works = labMap(), subs = depth < 3 ? specByName() : new Map();
  let mat = 0, work = 0, hours = 0; const miss = [], subUsed = [];
  for (const r of b.rows) {
    const q = num(r.qty) ?? 0;
    if (r.work) {
      const w = works.get(r.work), rate = num(w?.rate);
      if (rate == null) { miss.push(w?.name || "роботу видалено"); continue; }
      work += rate * q; hours += q; continue;
    }
    const m = mats.get(r.mat), sid = m ? subs.get(normName(m.name)) : null;
    if (sid && sid !== id && sid !== via) {
      const sc = bomCost(sid, depth + 1);
      if (sc) { mat += sc.total * q; subUsed.push({ id: sid, name: m.name, cost: sc.total, qty: q }); continue; }
    }
    const p = matUah(m);
    if (p == null) { miss.push(m?.name || "матеріал видалено"); continue; }
    mat += p * q;
  }
  const coef = num(b.coef) ?? 1, extra = num(b.extra) ?? 0, cost = mat + work;
  return { cost, mat, work, hours, coef, extra, total: cost * coef + extra, miss, subs: subUsed, via, n: b.rows.length };
}
const rawBundle = (id) => cat0.bundles.find((b) => b.id === id);
/**
 * Draft price of a position from the settings: base by mode (₴ by hand, € × coef × rate, materials, sum of the bundle's positions),
 * then markup, a final price by hand wins. lines = how it was calculated (shown under the row in the configurator).
 */
function priceOf(kind, id, rule, it, depth = 0, force = null) {
  const rec = admin.prices[kind]?.[id] || {};
  const step = settings.rounding_uah || 1, rate = eurRate();
  const mode = force || (kind === "bundles" ? (rec.mode === "sum" ? "sum" : "manual") : priceMode(rec, it));
  const lines = []; let base = null, eur = null, coef = null, fromEur = null;
  if (mode === "eur") {
    eur = num(rec.eur) ?? it?.price_eur ?? null; coef = num(rec.coef) ?? 1;
    if (eur != null && rate) { fromEur = core.roundTo(eur * coef * rate, step); base = fromEur; lines.push(`€ ${fmtN(eur)} × коеф. ${fmtN(coef, 3)} × курс ${fmtN(rate, 4)} = ${uah(base)}`); }
    else lines.push(eur == null ? "ціна в € не задана" : "курс € не задано");
  } else if (mode === "bom") {
    const b = bomCost(id);
    if (b) { base = core.roundTo(b.total, step);
      lines.push(`матеріали ${uah(Math.round(b.mat))}` + (b.work ? ` + роботи ${uah(Math.round(b.work))} (${fmtN(b.hours, 1)} год)` : "") + (b.coef !== 1 ? ` × коеф. ${fmtN(b.coef, 3)}` : "") + (b.extra ? ` + інші витрати ${uah(b.extra)}` : "") + ` = ${uah(base)}`);
      if (b.via) lines.push(`калькуляція виробу «${productTitle(ownProducts().find((x) => x.id === b.via))}»`);
      if (b.subs.length) lines.push(`вузли: ${b.subs.map((x) => `${x.name.replace(/^Готовий виріб\s*/i, "")} ${uah(Math.round(x.cost))}`).join(", ")}`);
      if (b.miss.length) lines.push(`без ціни: ${b.miss.slice(0, 4).join(", ")}${b.miss.length > 4 ? "…" : ""}`); }
    else lines.push("калькуляцію виробу не задано");
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
  for (const p of admin.page_presets || []) {   // base KPs changed or made in the page editor
    const i = c.presets.findIndex((x) => x.id === p.id);
    if (i >= 0) c.presets[i] = { ...c.presets[i], ...structuredClone(p) }; else c.presets.push(structuredClone(p));
  }
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
  let r;
  try { r = await fetch(path, opts); }
  catch (e) { netState(false); throw new Error("Немає зв’язку з комп’ютером: програма на ПК має бути запущена, а телефон — у тій самій Wi‑Fi або з інтернетом."); }
  netState(!r.headers.get("X-Kp-Offline"));
  if (r.status === 401 && IS_PHONE) { location.href = "/login"; throw new Error("Потрібен PIN"); }
  const j = r.headers.get("content-type")?.includes("json") ? await r.json() : null;
  if (!r.ok) throw new Error(j?.error || r.statusText);
  return j;
}
function normAdmin() {
  for (const k of ["styles", "photos", "prices", "texts", "catalog", "photo_history"]) admin[k] ??= {};
  for (const k of ["items", "accessories", "kits", "kinds", "kp_items", "pos"]) admin.photos[k] ??= {};
  admin.materials ??= { list: [], log: [] }; admin.materials.list ??= []; admin.materials.log ??= [];
  admin.bom ??= {}; admin.labour ??= [];
  for (const k of ["items", "bundles", "accessories"]) admin.prices[k] ??= {};
  admin.texts.terms ??= {}; admin.texts.cranes ??= {}; admin.texts.npl ??= {};
  admin.page_edits ??= { tpl: {}, preset: {} }; admin.page_edits.tpl ??= {}; admin.page_edits.preset ??= {};   // page editor: style templates, base KPs
  admin.page_presets ??= [];   // ready kits saved from the page editor (an id of catalog.json replaces that kit)
  admin.extras ??= [{ title: "Монтажні роботи", desc: "", price_uah: 100000, at: "2026-10-22" }];   // own positions offered for quick adding
}
/** Prices of the KPs of 22.10.2026 (owner): fixed once on the user's PC as well, the previous price kept for undo. */
const PRICE_UPDATES = { id: "2026-10-22", note: "ціни з КП 22.10.2026 (ЗІЛ + BMF 650, BMF 650 у комплекті)", list: [
  ["items", "bmf650", 652000], ["items", "tank", 20100], ["items", "seat", 33850], ["items", "truck_pyramid_outriggers", 180000],
  ["items", "zil_platform", 429375], ["items", "pto_kvp", 15000]] };
function applyPriceUpdates() {
  admin.applied_updates ??= [];
  if (admin.applied_updates.includes(PRICE_UPDATES.id) || !admin.fixed) return false;
  for (const [kind, id, price] of PRICE_UPDATES.list) setPrice(kind, id, price, PRICE_UPDATES.id, PRICE_UPDATES.note);
  admin.applied_updates.push(PRICE_UPDATES.id);
  return true;
}
/** A price set by hand (configurator page or update): the final price of the position in the settings and the KP price, dated. */
function setPrice(kind, id, price, at = core.todayIso(), note = "вручну на сторінці конфігуратора") {
  const rec = (admin.prices[kind] ??= {})[id] ??= {};
  rec.final = price;
  const F = ((admin.fixed ??= {})[kind] ??= {}), prev = F[id];
  F[id] = { price, at, lines: [`${note}: ${uah(price)}`], ...(prev ? { prev: { price: prev.price, at: prev.at, lines: prev.lines } } : {}) };
}
/** «ціна від 22.10.2026»: when the price that goes into KPs was last set. */
function priceDate(kind, id) {
  const fx = fixedOf(kind, id);
  if (fx?.at) return fx.at;
  const src = kind === "items" ? cat0.items.find((x) => x.id === id) : kind === "bundles" ? rawBundle(id) : cat0.accessories.find((x) => x.id === id);
  return src?.price?.date || null;
}
async function boot() {
  B = await api("/api/bootstrap");
  cat0 = B.catalog; settings = B.settings; admin = B.admin; normAdmin();
  if (migrateFixed()) await saveAdmin(true, "ціни зафіксовано як у КП (перший запуск)");
  if (applyPriceUpdates()) await saveAdmin(true, PRICE_UPDATES.note);
  cat = effCatalog();
  $$(".main-nav button").forEach((b) => b.onclick = () => tab(b.dataset.tab));
  $$("#adminNav button").forEach((b) => b.onclick = () => sub(b.dataset.sub));
  initTheme(); initConf(); initAdmin(); initEditor(); renderHist(); initPwa();
}

// ------------------------------------------------------------------ phone: PWA, access from the phone
/** Opened from a phone (the Wi‑Fi entrance or the internet address), not on the PC itself. */
const IS_PHONE = !["127.0.0.1", "localhost", "[::1]"].includes(location.hostname);
function netState(ok) { const el = $("#netOff"); if (el) el.hidden = ok; }
let installEvt = null;
function initPwa() {
  if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("sw.js").catch((e) => console.warn("sw", e));
  addEventListener("online", () => netState(true)); addEventListener("offline", () => netState(false));
  if (!navigator.onLine) netState(false);
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; $("#installBtn").hidden = false; });
  addEventListener("appinstalled", () => { installEvt = null; $("#installBtn").hidden = true; toast("Програму встановлено: шукайте значок «КП BMF»"); });
  $("#installBtn").onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $("#installBtn").hidden = true; };
  if (!IS_PHONE) { $("#phoneBtn").hidden = false; $("#phoneBtn").onclick = phoneDialog; }
}
function qrSvg(text) {
  const q = window.qrcode(0, "M"); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}
async function phoneDialog() {
  let info;
  try { info = await api("/api/phone"); } catch (e) { return toast(e.message); }
  const set = async (body) => { try { info = await api("/api/phone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); draw(); } catch (e) { toast(e.message); } };
  let mode = info.tunnel.want ? "net" : "wifi";
  const box = h("div", { class: "phone" });
  let poll = null;
  const draw = () => {
    clearTimeout(poll);
    const T = info.tunnel, wifiUrl = info.urls[0] ? info.urls[0] : "", netUrl = T.state === "on" ? T.url + "/" : "";
    const url = mode === "net" ? netUrl : (info.lan ? wifiUrl : "");
    const qr = h("div", { class: "qr" + (url ? "" : " off") });
    if (url) qr.innerHTML = qrSvg(url + "login?pin=" + info.pin);
    else qr.append(mode === "net" ? (T.state === "download" ? "Завантажую cloudflared (≈ 20 МБ, лише раз)…" : T.state === "start" ? "Отримую адресу в Cloudflare…" : "Інтернет-адресу вимкнено")
      : info.lan ? "Не знайдено адресу комп’ютера в мережі: чи під’єднано його до Wi‑Fi або кабелю?" : "Доступ з телефону вимкнено");
    const seg = h("div", { class: "seg" },
      h("button", { class: mode === "wifi" ? "on" : "", onclick: () => { mode = "wifi"; draw(); } }, "Wi‑Fi в офісі"),
      h("button", { class: mode === "net" ? "on" : "", onclick: () => { mode = "net"; draw(); } }, "Через інтернет (HTTPS)"));
    const side = mode === "wifi" ? [
      h("p", { class: "hint" }, "Телефон у тій самій Wi‑Fi, що й комп’ютер. Комп’ютер і програма на ньому мають бути ввімкнені."),
      h("div", { class: "acts" }, info.lan ? h("button", { onclick: () => set({ lan: false, tunnel: false }) }, "Вимкнути доступ з телефону")
        : h("button", { class: "primary", onclick: () => set({ lan: true }) }, "Увімкнути доступ з телефону")),
      info.lan_error ? h("p", { class: "result err" }, info.lan_error) : null,
      info.lan ? [h("h3", {}, "Адреса"), h("div", { class: "url" }, info.urls.join("  ·  ") || `порт ${info.port}`)] : null,
      h("h3", {}, "Як відкрити"),
      h("ol", {}, h("li", {}, "Наведіть камеру телефону на QR-код і відкрийте посилання."),
        h("li", {}, "Вхід відбудеться сам (PIN є в QR-коді); телефон запам’ятає його."),
        h("li", {}, "Chrome: меню ⋮ → «Додати на головний екран». iPhone: «Поділитися» → «На початковий екран»."),
        h("li", {}, "Якщо Windows спитає про брандмауер для Python — дозвольте для приватних мереж.")),
      h("p", { class: "hint" }, "У Wi‑Fi адреса без HTTPS: значок на екрані є, але без роботи офлайн і кнопки «Надіслати». Повний застосунок — вкладка «Через інтернет»."),
    ] : [
      h("p", { class: "hint" }, "Захищена адреса https://…trycloudflare.com: телефон працює з програмою на ПК звідусіль (мобільний інтернет, у клієнта), ставить її як застосунок, відкриває останні дані без зв’язку і надсилає PDF у Viber/Telegram."),
      h("div", { class: "acts" }, T.want ? h("button", { onclick: () => set({ tunnel: false }) }, "Вимкнути інтернет-адресу")
        : h("button", { class: "primary", onclick: () => set({ tunnel: true }) }, "Увімкнути інтернет-адресу")),
      T.error ? h("p", { class: "result err" }, T.error) : null,
      netUrl ? [h("h3", {}, "Адреса"), h("div", { class: "url" }, netUrl)] : null,
      h("h3", {}, "Як встановити"),
      h("ol", {}, h("li", {}, "Скануйте QR-код телефоном, вхід відбудеться сам."),
        h("li", {}, "Угорі натисніть «Встановити» (або меню ⋮ → «Встановити застосунок»; iPhone: «Поділитися» → «На початковий екран»).")),
      h("p", { class: "hint" }, "Ця адреса діє, доки програма на ПК запущена. Після перезапуску ПК адреса нова: скануйте QR ще раз і встановіть заново (стара іконка перестане відкриватися). Постійну адресу можна зробити на вашому акаунті Cloudflare з власним доменом."),
    ];
    box.innerHTML = "";
    box.append(h("div", {}, qr, h("div", { class: "hint" }, "PIN для входу"), h("div", { class: "pin" }, info.pin),
      h("button", { class: "sm", onclick: () => confirmBox("Новий PIN: усі телефони вийдуть і ввійдуть з новим PIN. Продовжити?", "Змінити PIN", () => set({ new_pin: true }).then(phoneDialog)) }, "Змінити PIN")),
      h("div", {}, h("h2", {}, "Програма на телефоні"), seg, side));
    if (mode === "net" && T.want && T.state !== "on" && !T.error) poll = setTimeout(async () => { if (!box.isConnected) return; try { info = await api("/api/phone"); } catch (e) { return; } draw(); }, 1500);
  };
  modal(box); draw();
}
// ------------------------------------------------------------------ theme: light, dark or as the system (remembered on this PC)
const ICO = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const THEMES = [["light", ICO('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'), "Світла тема"],
  ["dark", ICO('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'), "Темна тема"],
  ["auto", ICO('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'), "Тема як у системі"]];
function applyTheme(pick) {
  try { localStorage.setItem("kp_theme", pick); } catch (e) {}
  const dark = pick === "dark" || (pick === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light"; document.documentElement.dataset.themePick = pick;
  const t = THEMES.find((x) => x[0] === pick) || THEMES[2], b = $("#themeBtn");
  if (b) { b.innerHTML = t[1]; b.title = t[2] + " · клік — наступна"; b.setAttribute("aria-label", t[2]); }
  requestAnimationFrame(() => typeof drawTreeLinks === "function" && drawTreeLinks());
}
function initTheme() {
  const cur = () => document.documentElement.dataset.themePick || "auto";
  $("#themeBtn").onclick = () => applyTheme(THEMES[(THEMES.findIndex((x) => x[0] === cur()) + 1) % THEMES.length][0]);
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => cur() === "auto" && applyTheme("auto"));
  applyTheme(cur());
}
function tab(id) {
  $$(".main-nav button").forEach((b) => b.classList.toggle("on", b.dataset.tab === id));
  $$(".tab").forEach((t) => t.classList.toggle("on", t.id === "tab-" + id));
  if (id === "conf") { cat = effCatalog(); renderKitTabs(); renderFeatured(); renderConf(); }
  if (id === "hist") renderHist();
  if (id === "edit") showEditor();
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
  $("#orderReset").onclick = () => { S.order = null; renderQuote(); };
  initSumBar();
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
  S.extras = []; S.itemized = false; S.order = null; S.edits = null; S.editLog = {}; S.basePreset = null; S.confirmed = new Set(); S.cellOpen = null; editorBadge();
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
  S.manual = {}; S.kitPrice = null; S.qty = { ...(p.quantities || {}) }; S.preset = p.id;
  S.extras = structuredClone(p.extras || []); S.itemized = !!p.itemized; S.order = p.order || null; S.edits = null; S.editLog = {}; S.basePreset = p.id; S.cellOpen = null; editorBadge();
  confirmAll();   // a kit from a KP: its positions were chosen there
  renderKitTabs(); renderFeatured(); renderConf();
}
function presetKey(p) { const sl = p.selection.slots; return [sl.crane, sl.trailer, sl.conversion].join("|"); }
function presetTotal(p) {
  try { const q = core.quote(cat, settings, { eur: null, source: "none" }, { kit_type: p.kit_type, selection: core.presetSelection(p, cat), date: core.todayIso(),
      extras: p.extras || [], itemized: !!p.itemized, quantities: p.quantities || {} });
    return q.total_uah ? (q.complete === false ? uah(q.total_uah) + " *" : uah(q.total_uah)) : null; }
  catch { return null; }
}
// ready kits: grouped by crane (and trailer), inside a group from the base kit to the fullest; marks show which positions each has
const SLOT_SHORT = { base: "База", tank: "Бак", oil: "Олива", seat: "Місце", heat_exchanger: "Тепло", pump: "Насос", frame: "Рама", pto: "КВП", cardan: "Вал" };
const markSlots = (kt) => kt.slots.filter((s) => !s.required && !(kt.title_slots || []).includes(s.id));
function presetExtras(p, kt) {
  const sel = p.selection, items = core.selectedItems(cat, kt, core.presetSelection(p, cat)).map((x) => x.item);
  let n = markSlots(kt).filter((s) => sel.slots[s.id]).length + (sel.accessories || []).length + (p.extras || []).length;
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
/** Cells of the kit being built: ticked as positions are chosen anywhere, the price on the right; a position with
 *  variants opens its picks under the cells, a confirmed pick (or a position with one variant) gets the other frame. */
function liveRow(marks) {
  const sel = S.sel, keyOf = (s) => "slot:" + s.id, open = S.cellOpen && marks.some((s) => keyOf(s) === S.cellOpen) ? S.cellOpen : null;
  const cell = (s) => {
    const k = keyOf(s), on = !!sel.slots[s.id], many = on && hasVariants(k), ok = on && (!many || S.confirmed?.has(k)), inn = intoOf().includes(s.id);
    const pick = slotPick(s);
    return h("i", { class: [on ? "y" : "", ok ? "ok" : on ? "ask" : "", open === k ? "open" : "", !on && !pick ? "no" : ""].join(" "),
      title: `${s.title}: ` + (on ? (inn ? "у складі дообладнання" : "є") + (many ? (ok ? " · вибір підтверджено" : " · оберіть варіант") : "") : pick ? "немає — клік додає" : "не підходить до комплекту"),
      onclick: () => {
        if (!on) { if (!pick) return; S.cellOpen = hasVariantsAfter(s, pick) ? k : null; setSlot(s.id, pick, false); return; }
        if (many) { S.cellOpen = open === k ? null : k; renderFeatured(); return; }
        setSlot(s.id, null);
      } }, on ? "✓" : "·");
  };
  const total = lastQuote ? (lastQuote.total_uah ? uah(lastQuote.total_uah) + (lastQuote.complete === false ? " *" : "") : "за запитом") : "—";
  const slot = open && marks.find((s) => keyOf(s) === open);
  const panel = slot ? h("div", { class: "cell-pick" }, h("div", { class: "cp-h" }, h("b", {}, slot.title),
    h("button", { class: "sm", onclick: () => { S.cellOpen = null; setSlot(slot.id, null); } }, "прибрати"),
    h("button", { class: "sm", onclick: () => { S.cellOpen = null; confirmPos(open); renderFeatured(); renderTree(); } }, "так, як є")),
    variantGroups(posVariants(open), () => { S.cellOpen = null; renderFeatured(); })) : null;
  return h("div", { class: "rg-row live" + (S.preset ? "" : " on") },
    h("span", { class: "lvl", title: "комплект, який ви зараз збираєте" }, "зараз"),
    h("div", { class: "rg-mid" }, h("div", { class: "marks" }, marks.map(cell)),
      h("div", { class: "meta" }, h("small", {}, S.preset ? "як у вибраному КП" : "поточний вибір · клік по клітинці — додати, варіант або прибрати"))),
    h("b", { class: "price", title: lastQuote?.complete === false ? "частина позицій — за запитом" : "" }, total), panel);
}
function hasVariantsAfter(s, pick) {   // would the position, once added, have something to choose
  const was = S.sel; S.sel = core.reconcileSelection(cat, S.kt.id, { ...was, slots: { ...was.slots, [s.id]: pick } }, s.id);
  try { return hasVariants("slot:" + s.id); } finally { S.sel = was; }
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
  // the current kit: a live row of cells at the top of its group (a group of its own when no KP has this crane and base)
  const curKey = [S.sel.slots.crane, S.sel.slots.trailer, S.sel.slots.conversion].join("|");
  if (!groups.has(curKey)) gl.unshift([{ _live: true, selection: { slots: { ...S.sel.slots } }, source: {} }]);
  else gl.sort((a, b) => (presetKey(b[0]) === curKey ? 1 : 0) - (presetKey(a[0]) === curKey ? 1 : 0));
  for (const g of gl) {
    const ref = g[0], live = ref._live ? !!g.splice(0, 1) : presetKey(ref) === curKey;
    g.forEach((p) => (p._n = presetExtras(p, kt)));
    g.sort((a, b) => a._n - b._n || (b.source.date || "").localeCompare(a.source.date || ""));
    const latest = [...g].sort((a, b) => (b.source.date || "").localeCompare(a.source.date || ""))[0];
    const cr = crOf(ref), tr = core.itemById(cat, ref.selection.slots.trailer || ref.selection.slots.conversion || "");
    const photo = kt.id === "crane_kit" ? cr?.photo : tr?.photo || cr?.photo;
    const head = h("div", { class: "rg-head" + (cr?.featured ? " main" : "") }, photo ? lbImg(asset(photo), null, { alt: cr?.model || "" }) : h("span"),
      h("b", {}, [tr?.model, cr?.model].filter(Boolean).join(" + ") || "без крана"), live && !g.length ? h("span", { class: "badge gray" }, "ще немає КП") : cr?.featured ? h("span", { class: "badge" }, "основний кран") : null);
    const rows = h("div", { class: "rg-rows" });
    if (marks.length) rows.append(h("div", { class: "rg-marks-h" }, h("span"), h("div", { class: "marks" }, marks.map((s) => h("i", { title: s.title }, SLOT_SHORT[s.id] || s.title.split(" ")[0]))), h("span")));
    if (live) rows.append(liveRow(marks));
    for (const p of g) {
      const t = presetTotal(p), cm = choiceMarks(p, kt);
      rows.append(h("button", { class: "rg-row" + (S.preset === p.id ? " on" : ""), onclick: () => applyPreset(p) },
        h("span", { class: "lvl", title: "кількість опцій" }, p._n ? "+" + p._n : "база"),
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
  return h("div", { class: `tnode ${cls}` + (on ? " on" : "") + (dis ? " dis" : ""), title: why || title, onclick: dis ? null : onclick,
    "aria-pressed": onclick && !dis ? String(!!on) : null, "aria-disabled": dis ? "true" : null },
    photo ? lbImg(asset(photo), null, { alt: title }) : h("div", { class: "ph" }, "фото"),
    h("div", { class: "tt" }, h("b", {}, title), sub ? h("small", {}, sub) : null, mark ? h("span", { class: "mk " + markCls }, mark) : null));
}
// variants of the chosen positions: the tree's «Варіанти» column and the cells of the current kit offer the same picks
const CONV_CHOICE = (ch) => ch.slot === "conversion" && ch.options.some((o) => o.value === "conv");   // old per-position «у складі» switches: S.sel.into now
const UNIT_PRESETS = { oil_90l: [90, 80] };
const intoOf = () => S.sel.into || [];
function confirmPos(key) { if (key) (S.confirmed ??= new Set()).add(key); }
function confirmAll() {
  S.confirmed = new Set([...markSlots(S.kt).filter((s) => S.sel.slots[s.id]).map((s) => "slot:" + s.id), ...S.sel.accessories.map((a) => "acc:" + a.id)]);
}
function changed() { S.preset = null; renderConf(); renderFeatured(); }
function setSlot(slotId, val, conf) {
  S.sel = core.reconcileSelection(cat, S.kt.id, { ...S.sel, slots: { ...S.sel.slots, [slotId]: val || null } }, slotId);
  if (!val) S.confirmed?.delete("slot:" + slotId); else if (conf) confirmPos("slot:" + slotId);
  changed();
}
function setChoice(id, v, key) { S.sel = { ...S.sel, choices: { ...S.sel.choices, [id]: v } }; confirmPos(key); changed(); }
function setQty(itemId, v, key) { S.qty[itemId] = v; confirmPos(key); changed(); }
function setInto(slotId, inside) {
  const into = intoOf().filter((x) => x !== slotId);
  if (inside) into.push(slotId);
  const choices = { ...S.sel.choices };   // an old switch of this position back to «окремим рядком»: its price is not counted twice
  for (const ch of S.kt.choices) if (CONV_CHOICE(ch) && choices[ch.id] === "conv" && ch.options.find((o) => o.value === "conv")?.excludes?.includes("slot:" + slotId)) choices[ch.id] = "row";
  S.sel = { ...S.sel, choices, into }; confirmPos("slot:" + slotId); changed();
}
function setAcc(id, patch) {
  const list = S.sel.accessories.filter((x) => x.id !== id), cur = S.sel.accessories.find((x) => x.id === id);
  if (patch) list.push({ id, variant: null, price_uah: null, ...(cur || {}), ...patch });
  S.sel = { ...S.sel, accessories: list };
  if (patch) confirmPos("acc:" + id); else S.confirmed?.delete("acc:" + id);
  changed();
}
const slotPick = (s) => { const cands = core.slotCandidates(cat, S.kt.id, s.id, S.sel); return (cands.find((c) => c.allowed && c.id === s.default) || cands.find((c) => c.allowed))?.id; };
const shortLabel = (it, all) => { const t = it?.title || ""; const common = all.length > 1 ? commonPrefix(all.map((c) => c.item?.title || "")) : ""; return (common.length > 6 && t.length > common.length ? t.slice(common.length).trim() : itemLabel(it, all.map((c) => c.item))) || t; };
function commonPrefix(list) { let p = list[0] || ""; for (const s of list) while (!s.startsWith(p)) p = p.slice(0, p.lastIndexOf(" ") > 0 ? p.lastIndexOf(" ") : p.length - 1); return p; }
function choicePriceMark(o, items) { return core.choiceIsStandard(o, items) ? "базовий" : o.price_uah ? "+" + uah(o.price_uah) : o.on_request ? "доплата за запитом" : ""; }
/** Groups of picks of a position ("slot:<id>" or "acc:<id>"): its variants, its choices, quantity, inside the conversion or separate. */
function posVariants(key) {
  const kt = S.kt, sel = S.sel, items = core.selectedItems(cat, kt, sel).map((x) => x.item), out = [];
  if (key.startsWith("acc:")) {
    const id = key.slice(4), a = core.accessoryById(cat, id), cur = sel.accessories.find((x) => x.id === id);
    if (!a || !cur) return out;
    const vs = core.accessoryVariants(cat, a, items);
    if (vs.length > 1) out.push({ title: "Варіант", opts: vs.map((v) => ({ label: v.title, on: cur.variant === v.id, pick: () => setAcc(id, { variant: v.id }) })) });
    if (a.max_qty > 1) out.push({ title: "Кількість", opts: Array.from({ length: a.max_qty }, (_, i) => ({ label: `${i + 1} шт`, on: (cur.qty || 1) === i + 1, pick: () => setAcc(id, { qty: i + 1 }) })) });
    return out;
  }
  const sid = key.slice(5), cur = sel.slots[sid], slot = kt.slots.find((s) => s.id === sid);
  if (!slot || !cur) return out;
  let cands = core.slotCandidates(cat, kt.id, sid, sel).filter((c) => c.allowed || c.id === cur);
  // a type choice of the position (насос: аксіально-поршневий / шестеренний): the models are variants of its base type,
  // so one list: «аксіально-поршневий PBF20TH.63», «… PBF20TH.80», «шестеренний»
  const typeCh = kt.choices.find((c) => c.slot === sid && /_type$/.test(c.id));
  if (typeCh) {
    const tv = sel.choices?.[typeCh.id] ?? core.choiceDefault(cat, typeCh, items), base = typeCh.options.find((o) => o.value === (typeCh.default || typeCh.options[0].value));
    const models = cands.filter((c) => c.id === cur || !cands.some((x) => x !== c && x.item?.title.startsWith(c.item?.title + " ")));   // a generic «Насос аксіально-поршневий» gives way to its models
    const name = (it) => { const t = (it?.title || "").replace(new RegExp(`^${slot.title}\\s*`, "i"), ""); const n = t.toLowerCase().startsWith(base.title.toLowerCase()) ? t : `${base.title} ${t}`.trim(); return n === base.title ? `${n}, модель у комплекті` : n; };
    const opts = models.map((c) => ({ label: name(c.item), hint: itemPriceText(c.item),
      on: c.id === cur && tv === base.value, pick: () => { S.sel = { ...S.sel, choices: { ...S.sel.choices, [typeCh.id]: base.value } }; setSlot(sid, c.id, true); } }));
    for (const o of typeCh.options.filter((o) => o !== base && core.choiceOptionFits(cat, o, items))) {
      const why = core.choiceOptionBlock(cat, kt, o, sel, items);
      opts.push({ label: o.title, hint: choicePriceMark(o, items), on: tv === o.value, dis: !!why && tv !== o.value, why, pick: () => setChoice(typeCh.id, o.value, key) });
    }
    if (opts.length > 1) out.push({ title: typeCh.title, opts });
    cands = [];
  }
  if (cands.length > 1) out.push({ title: "Варіант", opts: cands.map((c) => ({ label: shortLabel(c.item, cands), hint: itemPriceText(c.item), on: c.id === cur, pick: () => setSlot(sid, c.id, true) })) });
  for (const ch of kt.choices.filter((c) => c.slot === sid && !CONV_CHOICE(c) && c !== typeCh)) {
    const v = sel.choices?.[ch.id] ?? core.choiceDefault(cat, ch, items);
    const opts = ch.options.filter((o) => core.choiceOptionFits(cat, o, items));
    if (opts.length < 2) continue;
    out.push({ title: ch.title, opts: opts.map((o) => { const why = core.choiceOptionBlock(cat, kt, o, sel, items);
      return { label: o.title, hint: choicePriceMark(o, items), on: v === o.value, dis: !!why && v !== o.value, why, pick: () => setChoice(ch.id, o.value, key) }; }) });
  }
  const it = core.itemById(cat, cur);
  if (it?.unit) {
    const q = S.qty[it.id] ?? it.unit.default, pre = [...new Set([it.unit.default, ...(UNIT_PRESETS[it.id] || [])])];
    out.push({ title: "Кількість", opts: pre.map((v) => ({ label: `${v} ${it.unit.name}`, on: q === v, pick: () => setQty(it.id, v, key) })),
      input: { value: pre.includes(q) ? "" : q, unit: it.unit, set: (v) => setQty(it.id, v, key) } });
  }
  if (core.intoSlots(kt).includes(sid) && sel.slots.conversion) {
    const inn = intoOf().includes(sid);
    out.push({ title: "Як у КП", opts: [{ label: "окремо", on: !inn, pick: () => setInto(sid, false) }, { label: "у складі дообладнання", on: inn, pick: () => setInto(sid, true) }] });
  }
  return out;
}
/** Kit-level choices (brakes, wheels, drawbar…) and choices of required positions other than the crane. */
function kitChoices() {
  const kt = S.kt, items = core.selectedItems(cat, kt, S.sel).map((x) => x.item);
  const opt = new Set(markSlots(kt).map((s) => s.id));
  return kt.choices.filter((ch) => ch.slot !== "crane" && !CONV_CHOICE(ch) && !(ch.slot && opt.has(ch.slot)) && (!ch.slot || S.sel.slots[ch.slot])).map((ch) => {
    const v = S.sel.choices?.[ch.id] ?? core.choiceDefault(cat, ch, items);
    return { title: ch.title, opts: ch.options.filter((o) => core.choiceOptionFits(cat, o, items)).map((o) => { const why = core.choiceOptionBlock(cat, kt, o, S.sel, items);
      return { label: o.title, hint: choicePriceMark(o, items), on: v === o.value, dis: !!why && v !== o.value, why, pick: () => setChoice(ch.id, o.value) }; }) };
  }).filter((g) => g.opts.length > 1);
}
const hasVariants = (key) => posVariants(key).some((g) => g.opts.length > 1 || g.input);
function variantGroups(groups, after) {
  return groups.map((g) => h("div", { class: "vg" }, h("small", {}, g.title),
    h("div", { class: "mini" }, g.opts.map((o) => h("button", { class: o.on ? "on" : "", disabled: o.dis, title: o.why || o.hint || "",
      onclick: (e) => { e.stopPropagation(); o.pick(); after?.(); } }, o.label)),
      g.input ? h("label", { class: "own", onclick: (e) => e.stopPropagation() }, h("input", { type: "number", min: g.input.unit.min || 1, max: g.input.unit.max || "", placeholder: "своє", value: g.input.value,
        onchange: (e) => { const v = num(e.target.value); if (v) { g.input.set(v); after?.(); } } }), g.input.unit.name) : null)));
}

// ------------------------------------------------------------------ branch tree: base -> crane -> grapple and valve -> options -> variants
function renderTree() {
  const box = $("#tree"); if (!box) return;
  const fa = document.activeElement, fk = box.contains(fa) && fa.classList.contains("tnode") ? fa.textContent : null;   // keyboard focus survives the redraw
  box.innerHTML = "";
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
  // 3. crane-bound choices in one column: захват, under it розподільник
  const optMark = (o) => core.choiceIsStandard(o, items) ? ["★ базовий", "std"] : o.price_uah ? ["+" + uah(o.price_uah), ""] : o.on_request ? ["доплата за запитом", "req"] : ["без доплати", ""];
  const craneCh = kt.choices.filter((ch) => ch.slot === "crane" && sel.slots.crane);
  if (craneCh.length) {
    const nodes = [];
    craneCh.forEach((ch, i) => {
      if (i) nodes.push(h("div", { class: "tc-sub" }, ch.title.replace(/ \(.*\)$/, "").replace(/ крана$/, "")));
      const cur = sel.choices?.[ch.id] ?? core.choiceDefault(cat, ch, items);
      for (const o of ch.options.filter((o) => core.choiceOptionFits(cat, o, items))) {
        const [m, mc] = optMark(o), why = core.choiceOptionBlock(cat, kt, o, sel, items);
        nodes.push(tnode({ photo: o.photo, title: o.title.replace(/ — .*$/, ""), sub: o.title.includes(" — ") ? o.title.replace(/^.*? — /, "") : "", mark: m, markCls: mc, on: cur === o.value,
          dis: !!why && cur !== o.value, why, onclick: () => setChoice(ch.id, o.value) }));
      }
    });
    cols.push([craneCh.map((ch) => ch.title.replace(/ \(.*\)$/, "").replace(/ крана$/, "")).join(" · "), nodes]);
  }
  // 4. options: optional positions (toggle) and chosen accessories; in truck kits the ones «у складі дообладнання» in its group on top
  const opts = [], keys = [], into = intoOf(), conv = core.itemById(cat, sel.slots.conversion || "");
  const optNode = (s) => {
    const cur = sel.slots[s.id], it = core.itemById(cat, cur || s.default || s.candidates[0]), pick = slotPick(s), inn = into.includes(s.id);
    const node = tnode({ photo: it?.photo, title: s.title, mark: inn ? "✓ у складі дообладнання" : cur ? (s.priced ? "✓ " + itemPriceText(it) + " окремо" : "✓ в комплекті") : "+ " + itemPriceText(it),
      markCls: cur ? "std" : "", on: !!cur, dis: !pick && !cur, cls: "tog", onclick: () => setSlot(s.id, cur ? null : pick, true) });
    node.dataset.key = "slot:" + s.id;
    if (cur) keys.push("slot:" + s.id);
    return node;
  };
  if (conv && into.length) {
    const inside = markSlots(kt).filter((s) => into.includes(s.id) && sel.slots[s.id]);
    opts.push(h("div", { class: "tgrp conv" }, h("div", { class: "tg-t" }, "Дообладнання: " + (conv.model || conv.title)), inside.map(optNode)));
  }
  for (const s of markSlots(kt).filter((s) => !into.includes(s.id) || !sel.slots[s.id])) opts.push(optNode(s));
  for (const a of sel.accessories) {
    const def = core.accessoryById(cat, a.id); if (!def) continue;
    const node = tnode({ photo: def.photo, title: def.title, mark: "✓ " + (a.price_uah ? uah(a.price_uah) : def.price?.mode === "ref" ? uah(def.price.uah) : "за запитом"), markCls: "std", on: true, cls: "tog",
      why: "опція: клік — прибрати", onclick: () => setAcc(a.id, null) });
    node.dataset.key = "acc:" + a.id; keys.push("acc:" + a.id); opts.push(node);
  }
  if (opts.length) cols.push(["Опції", opts]);
  // 5. variants of what is chosen in the options, then the kit's own choices
  const vars = [];
  for (const k of keys) {
    const g = posVariants(k); if (!g.length) continue;
    const title = k.startsWith("acc:") ? core.accessoryById(cat, k.slice(4))?.title : kt.slots.find((s) => "slot:" + s.id === k)?.title;
    vars.push(h("div", { class: "vcard" + (S.confirmed?.has(k) ? " ok" : ""), "data-for": k }, h("div", { class: "tg-t" }, title), variantGroups(g)));
  }
  const kc = kitChoices();
  if (kc.length) vars.push(h("div", { class: "vcard kit" }, h("div", { class: "tg-t" }, "Комплект"), variantGroups(kc)));
  if (vars.length) cols.push(["Варіанти", vars]);
  for (const [title, nodes] of cols) box.append(h("div", { class: "tcol" + (title === "Варіанти" ? " vars" : "") }, h("div", { class: "tc-h" }, title), h("div", { class: "tc-b" }, nodes)));
  if (fk != null) $$(".tnode", box).find((n) => n.textContent === fk)?.focus({ preventScroll: true });
  requestAnimationFrame(drawTreeLinks);
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
  const link = (a, b, on) => {
    const [x1, y1] = anchor(a, "r"), [x2, y2] = anchor(b, "l"), mx = (x1 + x2) / 2;
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`); p.setAttribute("class", on ? "on" : "off"); svg.append(p);
  };
  for (let i = 0; i < cols.length - 1; i++) {
    if (cols[i + 1].classList.contains("vars")) {   // each chosen option to its own variants
      for (const v of $$(".vcard[data-for]", cols[i + 1])) { const n = $(`.tnode[data-key="${v.dataset.for}"]`, cols[i]); if (n) link(n, v, true); }
      const kit = $(".vcard.kit", cols[i + 1]), last = $$(".tc-b .tnode.on", cols[i]).pop();
      if (kit && last && !$$(".vcard[data-for]", cols[i + 1]).length) link(last, kit, true);
      continue;
    }
    const from = $$(".tc-b > .tnode.on", cols[i]).pop(); if (!from) continue;
    for (const to of $$(".tc-b > .tnode, .tc-b > .tgrp", cols[i + 1])) {
      if (to.classList.contains("dis")) continue;
      link(from, to, to.classList.contains("on") || to.classList.contains("conv") || !!to.querySelector(":scope > .tnode.on"));
    }
  }
  box.append(svg);
}
window.addEventListener("resize", () => requestAnimationFrame(drawTreeLinks));
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
        c.item.photo ? h("img", { src: asset(c.item.photo), loading: "lazy", alt: "" }) : h("div", { style: "height:86px;background:var(--img)" }),
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
    const cbx = h("input", { type: "checkbox", "aria-label": slot.title, checked: on, disabled: slot.required, onchange: (e) => setSlot(slot.id, e.target.checked ? (cands.find((c) => c.allowed && c.id === slot.default) || cands.find((c) => c.allowed))?.id : null) });
    const ok = cands.filter((c) => c.allowed || c.id === cur);   // incompatible variants (e.g. a base for another crane) are not offered
    const sel = ok.length > 1 ? h("select", { "aria-label": slot.title + ": варіант", onchange: (e) => setSlot(slot.id, e.target.value, true) },
      ok.map((c) => h("option", { value: c.id }, itemLabel(c.item, ok.map((x) => x.item)) || c.id))) : null;
    if (sel) sel.value = cur || "";
    const unit = it?.unit;
    // litres (or other units) are always editable; typing a quantity also adds the position
    const qty = unit ? h("label", { class: "inline", style: "margin:0", title: "кількість, " + unit.name }, h("input", { type: "number", class: "qty", min: unit.min || 1, max: unit.max || "", step: 1, value: S.qty[it.id] ?? unit.default,
      onchange: (e) => { S.qty[it.id] = num(e.target.value); confirmPos("slot:" + slot.id); if (!on) setSlot(slot.id, it.id); else changed(); } }), unit.name) : null;
    box.append(h("div", { class: "slot" + (on ? " on" : "") }, cbx,
      it?.photo ? lbImg(asset(it.photo), null, { alt: it.title }) : h("span"),
      h("div", {}, h("div", { class: "t" }, slot.title, slot.priced ? h("span", { class: "badge gray" }, "ціна окремо") : null), h("small", {}, it ? core.itemDesc(S.kt, it, S.sel) : "")),
      h("div", { class: "inline", style: "margin:0;flex-wrap:nowrap" }, sel && on ? sel : null, qty)));
  }
  // choices of the kit (захват, розподільник, місце оператора, гальма…)
  const chb = $("#choices"); chb.innerHTML = "";
  const items = core.selectedItems(cat, S.kt, S.sel).map((x) => x.item);
  for (const ch of S.kt.choices) {
    if ((ch.slot && !S.sel.slots[ch.slot]) || CONV_CHOICE(ch)) continue;   // «у складі дообладнання»: the switch of each position
    const opts = ch.options.filter((o) => core.choiceOptionFits(cat, o, items));
    const sel = h("select", { onchange: (e) => { S.sel = core.reconcileSelection(cat, S.kt.id, { ...S.sel, choices: { ...S.sel.choices, [ch.id]: e.target.value } }); if (ch.slot) confirmPos("slot:" + ch.slot); changed(); } },
      opts.map((o) => { const why = core.choiceOptionBlock(cat, S.kt, o, S.sel, items);
        return h("option", { value: o.value, disabled: !!why && (S.sel.choices?.[ch.id] ?? ch.default) !== o.value },
          o.title + (core.choiceIsStandard(o, items) ? " — базовий" : o.price_uah ? ` (+${core.formatUah(o.price_uah)})` : o.on_request ? " — доплата за запитом" : "") + (why ? ` (${why})` : "")); }));
    sel.value = S.sel.choices?.[ch.id] ?? ch.default;
    chb.append(h("label", {}, ch.title, sel));
  }
  renderAccs(); renderExtras(); renderQuote(); renderStyleChips(); renderTree();
}
function renderAccs() {
  const box = $("#accs"); box.innerHTML = "";
  const chosen = new Map(S.sel.accessories.map((a) => [a.id, a]));
  const all = core.kitAccessories(cat, S.kt.id, S.sel);
  const hid = hiddenOpts(S.kt.id), hidden = [];
  const hideBtn = (key) => h("button", { class: "sm ghost hide-opt", title: "сховати зі списку й зі сторінки «Додаткові опції» в КП (можна повернути внизу)", onclick: () => hideOpt(key, true) }, "сховати");
  // positions of the kit not chosen in the branches or the kit card: offered here too (and on the KP options page)
  const into = intoOf();
  const free = markSlots(S.kt).filter((sl) => !S.sel.slots[sl.id] && !into.includes(sl.id));
  const shown = free.filter((sl) => !hid.includes("slot:" + sl.id));
  free.filter((sl) => hid.includes("slot:" + sl.id)).forEach((sl) => hidden.push({ key: "slot:" + sl.id, title: sl.title }));
  if (shown.length) box.append(h("div", { class: "acc-grp" }, "Позиції комплекту (не обрані)"));
  for (const sl of shown) {
    const pick = slotPick(sl), it = core.itemById(cat, pick || sl.default || sl.candidates[0]);
    box.append(h("div", { class: "acc" + (pick ? "" : " bad") }, h("input", { type: "checkbox", "aria-label": sl.title, disabled: !pick, onchange: () => setSlot(sl.id, pick, true) }),
      it?.photo ? lbImg(asset(it.photo), null, { alt: sl.title }) : h("span"),
      h("div", {}, h("b", {}, sl.title), h("small", {}, it ? core.itemDesc(S.kt, it, S.sel) || it.title : ""), pick ? null : h("small", {}, "не підходить до цього комплекту")),
      h("div", { class: "num" }, h("small", {}, itemPriceText(it)), hideBtn("slot:" + sl.id))));
  }
  for (const g of Object.keys(GROUPS)) {
    const list = all.filter((x) => x.accessory.group === g && !(hid.includes(x.accessory.id) && !chosen.has(x.accessory.id) && hidden.push({ key: x.accessory.id, title: x.accessory.title })));
    if (!list.length) continue;
    box.append(h("div", { class: "acc-grp" }, GROUPS[g]));
    for (const ka of list) {
      const a = ka.accessory, on = chosen.get(a.id), bad = ka.status === "incompatible";
      const p = a.price?.mode === "ref" ? a.price.uah : null;
      const upd = (patch) => {
        const list2 = S.sel.accessories.filter((x) => x.id !== a.id);
        const cur = { id: a.id, ...(on || {}), ...patch };
        if (cur.on !== false) list2.push({ id: cur.id, variant: cur.variant ?? null, price_uah: cur.price_uah ?? null, ...(cur.qty > 1 ? { qty: cur.qty } : {}) });
        S.sel = { ...S.sel, accessories: list2 }; if (cur.on !== false) confirmPos("acc:" + a.id); renderAccs(); renderQuote(); renderTree();
      };
      const vs = ka.variants.length ? h("select", { onchange: (e) => upd({ variant: e.target.value || null }) },
        h("option", { value: "" }, "варіант…"), ka.variants.map((v) => h("option", { value: v.id }, v.title))) : null;
      if (vs && on) vs.value = on.variant || "";
      const qs = a.max_qty > 1 ? h("label", { class: "inline", style: "margin:4px 0 0" }, "Кількість",
        h("select", { class: "sm", onchange: (e) => upd({ qty: Number(e.target.value) }) }, Array.from({ length: a.max_qty }, (_, i) => h("option", { value: i + 1 }, `${i + 1} шт`)))) : null;
      if (qs) qs.querySelector("select").value = String(on?.qty || 1);
      const pin = h("input", { type: "number", "aria-label": "Ціна, ₴: " + a.title, placeholder: p ? String(p) : "ціна, ₴", value: on?.price_uah ?? "", onchange: (e) => upd({ price_uah: num(e.target.value) }) });
      box.append(h("div", { class: "acc" + (bad ? " bad" : "") }, h("input", { type: "checkbox", "aria-label": a.title, disabled: bad, checked: !!on, onchange: (e) => upd({ on: e.target.checked }) }),
        a.photo ? lbImg(asset(a.photo), null, { alt: a.title }) : h("span"),
        h("div", {}, h("b", {}, a.title), (a.base_for || []).includes(S.kt.id) ? h("span", { class: "badge" }, "базова") : null, a.kp_uses ? h("span", { class: "badge gray", title: "скільки ваших КП згадують цю опцію" }, `у ${a.kp_uses} КП`) : null, h("small", {}, ka.desc), on && vs ? vs : null, on && qs ? qs : null,
          ka.status === "unconfirmed" ? h("small", {}, "сумісність не підтверджена") : null),
        h("div", { class: "num" }, on ? pin : h("small", {}, p ? uah(p) + (a.max_qty > 1 ? " / шт" : "") : "за запитом"), on ? null : hideBtn(a.id))));
    }
  }
  if (hidden.length) box.append(h("details", { class: "acc-hidden" }, h("summary", {}, `Приховані опції (${hidden.length})`),
    hidden.map((x) => h("div", { class: "acc-h" }, h("span", {}, x.title), h("button", { class: "sm", onclick: () => hideOpt(x.key, false) }, "повернути")))));
}
/** Options page of the KP: on or off, prices or «за запитом» (to choose from), without the options hidden for this kit. */
function offerMeta(on, prices, ktId) { return { offer_accessories: on, offer_prices: prices, offer_hidden: hiddenOpts(ktId) }; }
const hiddenOpts = (ktId) => admin.hidden_opts?.[ktId] || [];
async function hideOpt(key, hide) {
  const H = (admin.hidden_opts ??= {}), list = (H[S.kt.id] || []).filter((x) => x !== key);
  if (hide) list.push(key);
  H[S.kt.id] = list; renderAccs();
  await saveAdmin(true, (hide ? "сховано опцію: " : "повернуто опцію: ") + key);
}
function quoteInput() {
  const manual = Object.fromEntries(Object.entries(S.manual).filter(([, v]) => v != null));
  const quantities = Object.fromEntries(Object.entries(S.qty).filter(([id, v]) => v != null && core.itemById(cat, id)?.unit));
  return { kit_type: S.kt.id, selection: S.sel, discount_pct: S.discount, manual_prices: manual, kit_price_uah: S.itemized ? null : S.kitPrice, quantities,
    extras: S.extras.filter((x) => x.title?.trim()), itemized: S.itemized, date: $("#kpDate").value || core.todayIso() };
}
let lastQuote = null;
/** «ціна від 22.10.2026» next to a price; with a price typed in for this KP also «Зберегти як нову ціну». */
function priceTools(kind, id, typed, toStored = (v) => v, unitNote = "") {
  const at = priceDate(kind, id);
  const save = typed != null ? h("button", { class: "sm", title: "Ця ціна піде в усі нові КП; попередню видно в «Ціни» → «Зафіксувати» (можна відкотити)",
    onclick: async () => {
      const v = Math.round(toStored(typed));
      setPrice(kind, id, v);
      if (kind === "items") delete S.manual[id]; else if (kind === "bundles") S.kitPrice = null;
      else S.sel = { ...S.sel, accessories: S.sel.accessories.map((a) => (a.id === id ? { ...a, price_uah: null } : a)) };
      await saveAdmin(true, `нова ціна ${uah(v)}${unitNote}: ${id}`);
      toast(`Ціну збережено: ${uah(v)}${unitNote}, від ${core.formatDate(core.todayIso())}`); renderConf();
    } }, "Зберегти як нову ціну") : null;
  return h("div", { class: "pdate" }, at ? h("small", { title: "коли востаннє змінено ціну, що йде в КП" }, "ціна від " + core.formatDate(at)) : null, save);
}
/** Positions in the order the user dragged them to (the price page of the KP follows it); new positions keep their place. */
function byOrder(list, key, order = S.order) {
  if (!order?.length) return list;
  const idx = new Map(order.map((k, i) => [k, i]));
  const known = list.filter((x) => idx.has(key(x))).sort((a, b) => idx.get(key(a)) - idx.get(key(b)));
  let k = 0;
  return list.map((x) => (idx.has(key(x)) ? known[k++] : x));
}
const rowKey = (r) => (r.kind === "extra" || !r.item_id ? "x:" + r.title : r.item_id);
/** «Вартість»: rows dragged by ⠿ (mouse) or moved with ↑ ↓ (phone, keyboard). */
function orderRows(tb, out) {
  const list = byOrder(out, (x) => x.key), keys = list.map((x) => x.key);
  const move = (from, to) => {
    if (to < 0 || to >= keys.length || from === to) return;
    const k = [...keys]; k.splice(to, 0, k.splice(from, 1)[0]); S.order = k; S.preset = null; renderQuote();
  };
  list.forEach(({ tr }, i) => {
    const grip = h("span", { class: "grip", title: "Перетягніть, щоб змінити порядок у КП", "aria-hidden": "true" }, "⠿");
    grip.onmousedown = () => { tr.draggable = true; };
    tr.ondragstart = (e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); tr.classList.add("dragging"); };
    tr.ondragend = () => { tr.draggable = false; tr.classList.remove("dragging"); };
    tr.ondragover = (e) => { e.preventDefault(); tr.classList.add("drop"); };
    tr.ondragleave = () => tr.classList.remove("drop");
    tr.ondrop = (e) => { e.preventDefault(); tr.classList.remove("drop"); move(+e.dataTransfer.getData("text/plain"), i); };
    const arrows = h("span", { class: "ord" },
      h("button", { class: "sm ghost", disabled: i === 0, "aria-label": "Вище в списку КП", onclick: () => move(i, i - 1) }, "↑"),
      h("button", { class: "sm ghost", disabled: i === list.length - 1, "aria-label": "Нижче в списку КП", onclick: () => move(i, i + 1) }, "↓"));
    tr.firstChild.prepend(h("div", { class: "ord-tools" }, grip, arrows));
    tb.append(tr);
  });
  const reset = $("#orderReset");
  if (reset) reset.hidden = !S.order?.length;
}
function renderQuote() {
  const tb = $("#rows"); tb.innerHTML = ""; const warn = $("#warnings"); warn.innerHTML = ""; $("#kitPriceBox").innerHTML = "";
  let q;
  try { q = core.quote(cat, settings, { eur: null, source: "none" }, quoteInput()); }
  catch (e) { lastQuote = null; $("#total").textContent = "—"; for (const m of e.errors || [String(e)]) warn.append(h("li", {}, m)); renderSumBar(null); return; }
  lastQuote = q;
  const lp = $(".rg-row.live .price"); if (lp) lp.textContent = q.total_uah ? uah(q.total_uah) + (q.complete === false ? " *" : "") : "за запитом";
  const bundle = q.price_display === "bundle";
  const out = [], add = (key, tr) => out.push({ key, tr });
  for (const r of q.rows) {
    if (r.kind === "extra") {   // own positions: edited in their block under the options
      add("x:" + r.title, h("tr", { class: "extra" }, h("td", {}, h("b", {}, r.title), h("small", {}, r.desc || "своя позиція")), h("td", { class: "num" }, r.price_text), h("td", { class: "num" }, h("small", {}, "у «Своїх позиціях»"))));
      continue;
    }
    const inKit = bundle && r.price_uah == null && r.price_text === "у комплекті";
    const it = core.itemById(cat, r.item_id), unit = it?.unit, qty = unit ? (S.qty[it.id] ?? unit.default) : 1;
    const inp = inKit ? h("small", {}, "у комплекті") : h("input", { type: "number", "aria-label": "Нова ціна, ₴: " + r.title, placeholder: "нова ціна, ₴", value: S.manual[r.item_id] ?? "",
      onchange: (e) => { S.manual[r.item_id] = num(e.target.value); renderQuote(); } });
    const tools = inKit ? null : priceTools("items", r.item_id, S.manual[r.item_id], unit ? (v) => v * unit.per / qty : undefined, unit ? ` за ${unit.per} ${unit.name}` : "");
    add(r.item_id || "x:" + r.title, h("tr", {}, h("td", {}, h("b", {}, r.title), h("small", {}, r.desc), inKit ? null : priceInfo("items", r.item_id, S.manual[r.item_id])),
      h("td", { class: "num" }, inKit ? "—" : (S.manual[r.item_id] != null ? h("s", {}, admRowPrice(r.item_id, qty)) : r.price_text)), h("td", { class: "num" }, inp, tools)));
  }
  for (const c of q.choices.filter((c) => c.price_uah)) add(`x:${c.title}: ${c.value_title}`, h("tr", {}, h("td", {}, h("b", {}, c.title), h("small", {}, c.value_title)), h("td", { class: "num" }, uah(c.price_uah)), h("td")));
  for (const r of q.accessories) {
    const id = r.item_id || r.id, typed = S.sel.accessories.find((a) => a.id === id)?.price_uah ?? null;
    add(id, h("tr", {}, h("td", {}, h("b", {}, r.title), h("small", {}, "опція"), priceInfo("accessories", id)), h("td", { class: "num" }, r.price_text),
      h("td", { class: "num" }, h("small", {}, "ціна — у списку опцій"), priceTools("accessories", id, typed))));
  }
  orderRows(tb, out);
  const kt0 = core.kitTypeById(cat, q.kit_type);
  if (kt0?.price_display === "bundle") {   // a kit with one price can also be priced position by position (as the ЗІЛ KP of 22.10.2026)
    $("#kitPriceBox").append(h("label", { class: "chk", title: "кожна позиція зі своєю ціною в таблиці «Вартість», без однієї ціни комплекту" },
      h("input", { type: "checkbox", checked: S.itemized, onchange: (e) => { S.itemized = e.target.checked; S.preset = null; renderQuote(); renderFeatured(); } }), "ціни по позиціях"));
  }
  if (bundle) {
    const bid = cat.bundles.find((b) => b.id === q.bundle_id), pid = bid ? bid.price_of || bid.id : null;
    $("#kitPriceBox").append(h("label", { class: "inline" }, "Ціна комплекту в налаштуваннях: " + uah(q.kit_price_uah ?? null) + ". Фінальна, ₴:",
      h("input", { type: "number", value: S.kitPrice ?? "", placeholder: "як у налаштуваннях", style: "width:140px", onchange: (e) => { S.kitPrice = num(e.target.value); renderQuote(); } })),
      pid ? priceTools("bundles", pid, S.kitPrice) : null, bid ? priceInfo("bundles", pid, S.kitPrice) : null);
  }
  $("#total").textContent = !q.total_uah ? "за запитом" : q.complete === false ? uah(q.total_uah) + " *" : uah(q.total_uah);
  if (q.complete === false) warn.append(h("li", {}, "* не всі позиції мають ціну — сума неповна"));
  for (const w of q.warnings.filter((w) => !/Курс EUR|індекс металу|опорн/i.test(w))) warn.append(h("li", {}, w));
  renderSumBar(q);
}
/** The «Разом» bar pinned to the bottom of the configurator: what is being built, the total and «Створити КП», wherever the page is scrolled. */
function renderSumBar(q) {
  const bar = $("#sumBar"); if (!bar) return;
  const cr = core.itemById(cat, S.sel?.slots.crane || ""), n = q ? q.rows.length + q.accessories.length : 0;
  const notes = [n ? `${n} ${n === 1 ? "позиція" : n < 5 ? "позиції" : "позицій"}` : null, S.discount ? `знижка ${S.discount}%` : null,
    q?.complete === false ? "* частина — за запитом" : null, !q ? "комплект не зібрано" : null].filter(Boolean);
  $("#sbKit").textContent = [cr?.model, KIT_SHORT[S.kt?.id] || S.kt?.title].filter(Boolean).join(" · ");
  $("#sbNote").textContent = notes.join(" · ");
  $("#sbTotal").textContent = $("#total").textContent;
  $("#sbGen").textContent = S.historyId ? "Оновити КП" : "Створити КП";
  $("#sbGen").disabled = !q || $("#gen").disabled;
}
function initSumBar() {
  $("#sbCost").onclick = () => $("#total").closest(".card").scrollIntoView({ behavior: "smooth", block: "center" });
  $("#sbGen").onclick = () => { $("#gen").click(); $(".gen-row").scrollIntoView({ behavior: "smooth", block: "center" }); };
  // the bar steps aside while the cost card's own total or the create button is on screen
  const seen = new Set(), bar = $("#sumBar");
  const io = new IntersectionObserver((es) => { for (const e of es) e.isIntersecting ? seen.add(e.target) : seen.delete(e.target); bar.classList.toggle("away", seen.size > 0); }, { threshold: 0.6 });
  io.observe($("#tab-conf .total")); io.observe($(".gen-row"));
}
/** Own positions (not in the catalog) under the options: name, description, price, pieces; remembered ones are one click away. */
function renderExtras() {
  const box = $("#extras"); if (!box) return; box.innerHTML = "";
  const remember = (x) => {
    const t = x.title?.trim(); if (!t) return;
    const list = admin.extras.filter((y) => y.title.trim().toLowerCase() !== t.toLowerCase());
    list.unshift({ title: t, desc: x.desc || "", price_uah: x.price_uah ?? null, at: core.todayIso() });
    admin.extras = list.slice(0, 30); saveAdmin();
  };
  const upd = (i, patch, keep = true) => { S.extras = S.extras.map((x, j) => (j === i ? { ...x, ...patch } : x)); if (keep) remember(S.extras[i]); renderQuote(); renderExtras(); };
  S.extras.forEach((x, i) => box.append(h("div", { class: "extra-row" },
    h("input", { "aria-label": "Назва позиції", value: x.title || "", placeholder: "назва, напр. Монтажні роботи", onchange: (e) => upd(i, { title: e.target.value }) }),
    h("input", { "aria-label": "Опис позиції", value: x.desc || "", placeholder: "опис (необов’язково)", onchange: (e) => upd(i, { desc: e.target.value }) }),
    h("input", { type: "number", "aria-label": "Ціна, ₴", value: x.price_uah ?? "", placeholder: "ціна, ₴", onchange: (e) => upd(i, { price_uah: num(e.target.value) }) }),
    h("input", { type: "number", class: "qty", min: 1, value: x.qty || 1, title: "кількість, шт", onchange: (e) => upd(i, { qty: Math.max(1, num(e.target.value) || 1) }, false) }),
    h("button", { class: "sm ghost", title: "прибрати з цієї КП", onclick: () => { S.extras = S.extras.filter((_, j) => j !== i); renderQuote(); renderExtras(); } }, "✕"))));
  const t = h("input", { "aria-label": "Назва нової позиції", placeholder: "назва, напр. Монтажні роботи" }), d = h("input", { "aria-label": "Опис нової позиції", placeholder: "опис (необов’язково)" }), p = h("input", { type: "number", "aria-label": "Ціна нової позиції, ₴", placeholder: "ціна, ₴" });
  const add = () => {
    if (!t.value.trim()) return toast("Вкажіть назву позиції");
    const x = { title: t.value.trim(), desc: d.value.trim(), price_uah: num(p.value), qty: 1 };
    S.extras = [...S.extras, x]; remember(x); S.preset = null; renderQuote(); renderExtras();
  };
  box.append(h("div", { class: "extra-row new" }, t, d, p, h("span"), h("button", { class: "sm primary", onclick: add }, "Додати")));
  const used = new Set(S.extras.map((x) => x.title.trim().toLowerCase()));
  const saved = admin.extras.filter((x) => !used.has(x.title.trim().toLowerCase()));
  if (saved.length) box.append(h("div", { class: "extra-saved" }, h("small", {}, "Раніше додані:"), saved.map((x) => h("span", { class: "chip" },
    h("button", { class: "sm", title: x.desc || "", onclick: () => { S.extras = [...S.extras, { title: x.title, desc: x.desc, price_uah: x.price_uah, qty: 1 }]; S.preset = null; renderQuote(); renderExtras(); } },
      "+ " + x.title + (x.price_uah != null ? " · " + uah(x.price_uah) : "") + (x.at ? " · від " + core.formatDate(x.at) : "")),
    h("button", { class: "sm ghost", title: "забути", onclick: () => { admin.extras = admin.extras.filter((y) => y !== x); saveAdmin(); renderExtras(); } }, "✕")))));
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
function admRowPrice(itemId, qty = 1) { const it = core.itemById(cat, itemId); return it?.price?.mode === "ref" ? uah(it.unit ? Math.round(it.price.uah * qty / it.unit.per) : it.price.uah) : "—"; }
function renderStyleChips() {
  const box = $("#styleChips"); const cur = box.dataset.v || admin.style || "dark"; box.innerHTML = "";
  const ok = (s) => !s.kits.length || s.kits.includes(S.kt?.extends || S.kt?.id);
  const pick = B.styles.find((s) => s.id === cur && ok(s)) ? cur : (ok(B.styles.find((s) => s.id === admin.style) || {}) ? admin.style : "dark");
  box.dataset.v = pick;
  for (const s of B.styles) box.append(h("button", { class: "style-chip" + (s.id === pick ? " on" : ""), disabled: !ok(s), title: ok(s) ? s.title : "лише для: " + (s.kits_title || s.kits.join(", ")),
    onclick: () => { box.dataset.v = s.id; renderStyleChips(); } }, h("img", { src: `previews/${s.id}.jpg`, alt: "" }), s.title));
}

const CHIP_TEXT = { brakes: "Гальма на вибір", wheels: "Колеса на вибір", drawbar: "Дишло на вибір", pump_type: "Насос на вибір", stakes: "Кількість коників",
  stakes_ext: "Нарощування коників", seat_pos: "Місце оператора", pump_flow: "Гідробак, насос 63 / 80" };
/** KpSpec of a quote with the settings: KP photos and their framing, texts, generator layout of copied kits. */
function specFrom(q, meta, style) {
  const noClient = !meta.client?.name || meta.client.name === "Назва замовника" || meta.show_client === false;
  const spec = core.buildKpSpec(cat, settings, q, { ...meta, client: { ...meta.client, name: meta.client?.name || "Назва замовника" } });
  if (noClient) ((spec.overrides ??= {}).layout ??= { show: {} }).show = { ...(spec.overrides.layout.show || {}), client: false };
  // the options page only when asked: chosen options with a price are rows of the price table anyway (bundle kits keep their cards)
  if (!meta.offer_accessories && q.price_display === "itemized") spec.accessories = [];
  for (const r of [...spec.rows, ...(spec.config_rows || [])]) {
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
    const chips = kt.choices.filter((ch) => ch.slot !== "crane" && ch.options.length > 1 && !(ch.slot && q.rows.some((r) => r.slot === ch.slot))).map((ch) => CHIP_TEXT[ch.id] || ch.title);
    chips.push("Колір на замовлення");
    if (spec.accessories?.length) chips.push("Опції для крана: с. {opt}", "Опції для причепа: с. {opt}");
    spec.upgrade_chips = chips.length > 8 ? [...chips.slice(0, 8 - (spec.accessories?.length ? 2 : 0)), ...(spec.accessories?.length ? chips.slice(-2) : [])] : chips;
  }
  if (meta.order?.length) { spec.rows = byOrder(spec.rows, rowKey, meta.order); spec.rows.forEach((r, i) => { r.no = i + 1; }); }
  spec.style = style;
  applyPageEdits(spec, meta);
  return spec;
}
// ------------------------------------------------------------------ page editor: edit layers (style template -> base KP -> this KP)
const EMPTY_EDITS = () => ({ pages: {}, shapes: {}, rows: {}, heroes: {} });
const tplKey = (style, kit) => `${style}:${kit}`;
function mergeEdits(...layers) {
  const o = EMPTY_EDITS();
  for (const e of layers) {
    if (!e) continue;
    Object.assign(o.pages, e.pages || {}); Object.assign(o.shapes, e.shapes || {}); Object.assign(o.heroes, e.heroes || {});
    for (const [k, v] of Object.entries(e.rows || {})) o.rows[k] = { ...(o.rows[k] || {}), ...v };
  }
  return o;
}
function layersOf(style, kit, base, kp) {
  return [admin.page_edits?.tpl?.[tplKey(style, kit)], base ? admin.page_edits?.preset?.[base] : null, kp];
}
/** Page edits into the generator spec: pages off, texts / photos / hidden elements, position names and photos, page photos. */
function applyPageEdits(spec, meta) {
  const E = mergeEdits(...layersOf(spec.style, spec.kit_type, meta.base, meta.edits));
  for (const r of [...spec.rows, ...(spec.config_rows || [])]) {
    const e = r.item_id && E.rows[r.item_id];
    if (!e) continue;
    if (e.title) r.title = e.title;
    if ("desc" in e && e.desc != null) r.desc = e.desc;
    if (e.photo) { r.photo = e.photo; r.photo_force = true; }
  }
  const bg = Object.fromEntries(Object.entries(E.heroes).filter(([, v]) => v?.path));
  if (Object.keys(bg).length) (spec.overrides ??= {}).bg = { ...(spec.overrides.bg || {}), ...bg };
  const hide = Object.entries(E.pages).filter(([k, v]) => v === false && k !== "cover").map(([k]) => k);
  const shapes = Object.values(E.shapes).filter((x) => x?.was);
  if (hide.length || shapes.length) spec.edit = { hide_pages: hide, shapes };
}
async function generate(asNew) {
  if (!lastQuote) return toast("Спершу виправте комплект");
  const qi = quoteInput();
  const errs = core.validateSelection(cat, qi);
  if (errs.length) return toast(errs[0]);
  let spec;
  try {
    spec = specFrom(lastQuote, { number: $("#kpNumber").value || "0001",
      client: { name: $("#client").value.trim(), contact: $("#clientContact").value.trim() }, show_client: $("#clientShow").checked,
      ...offerMeta($("#offerAcc").checked, !!$("#offerPrices").value, S.kt.id), edits: S.edits, base: S.basePreset, order: S.order }, $("#styleChips").dataset.v || "dark");
  } catch (e) { return toast((e.errors || [String(e)])[0]); }
  const state = { kit_type: S.kt.id, selection: S.sel, manual: S.manual, kitPrice: S.kitPrice, discount: S.discount, qty: S.qty, preset: S.preset,
    number: $("#kpNumber").value, date: $("#kpDate").value, client: $("#client").value, contact: $("#clientContact").value, style: spec.style, offerAcc: $("#offerAcc").checked, offerPrices: !!$("#offerPrices").value, clientShow: $("#clientShow").checked,
    extras: S.extras.filter((x) => x.title?.trim()), itemized: S.itemized, edits: S.edits, editLog: S.editLog, basePreset: S.basePreset, order: S.order || null };
  const btn = $("#gen"), res = $("#genResult");
  btn.disabled = true; $("#genNew").disabled = true; btn.innerHTML = '<span class="spin"></span>Створюю КП… (PDF — до хвилини)'; res.innerHTML = "";
  const ttl = `КП № ${$("#kpNumber").value || "—"}` + ($("#client").value.trim() ? " · " + $("#client").value.trim() : "");
  renderSumBar(lastQuote); $("#sbGen").innerHTML = '<span class="spin"></span>Створюю КП…';
  try {
    const r = await api("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spec, state, history_id: asNew ? null : S.historyId }) });
    const ok = r.pptx;
    res.append(h("div", { class: "result" + (ok ? "" : " err") },
      ok ? h("div", {}, r.pdf ? h("button", { class: "sm primary", onclick: () => pdfViewer(r.pdf, ttl, r.pptx) }, "Переглянути PDF") : "PDF не створено (немає LibreOffice?)",
        r.pdf ? h("a", { href: r.pdf, target: "_blank" }, "Відкрити в новому вікні") : null,
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
  const pv = $("#genResult .result button.primary"); if (pv) pv.click();   // the new KP opens in the viewer at once
}
function editBanner() {
  const b = $("#editBanner");
  b.hidden = !S.historyId; $("#genNew").hidden = !S.historyId;
  $("#gen").textContent = S.historyId ? "Оновити цю КП (PPTX + PDF)" : "Створити КП (PPTX + PDF)";
  renderSumBar(lastQuote);
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
  Object.assign(S, { manual: st.manual || {}, kitPrice: st.kitPrice ?? null, discount: st.discount || 0, qty: st.qty || {}, preset: st.preset || null, historyId: entry.id,
    extras: structuredClone(st.extras || []), itemized: !!st.itemized, edits: structuredClone(st.edits || null), editLog: structuredClone(st.editLog || {}),
    basePreset: st.basePreset || st.preset || null, cellOpen: null, order: st.order || null });
  confirmAll();
  $("#kpNumber").value = st.number || entry.number || ""; $("#kpDate").value = st.date || core.todayIso();
  $("#client").value = st.client || ""; $("#clientContact").value = st.contact || ""; $("#discount").value = S.discount;
  $("#offerAcc").checked = st.offerAcc === true; $("#offerPrices").value = st.offerPrices ? "1" : ""; $("#clientShow").checked = st.clientShow !== false; $("#styleChips").dataset.v = st.style || entry.style; $("#genResult").innerHTML = "";
  tab("conf"); editBanner(); editorBadge();
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
          x.pdf ? h("button", { class: "sm primary", onclick: () => pdfViewer(x.pdf, `КП № ${x.number || "—"}` + (x.client ? " · " + x.client : ""), x.pptx) }, "Переглянути PDF") : null,
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
    lbImg(`previews/${s.id}.jpg`, null, { alt: s.title }), h("b", {}, s.title), h("small", {}, s.kits.length ? s.kits_title || "не для всіх комплектів" : "усі комплекти з краном"),
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
    sws(sw("kp_no", "№ КП"), sw("kp_date", "Дата"), sw("frames", "Рамки по кутах"), sw("sight", "Приціл")),
    tx("kp_title", "Заголовок над номером"), tx("cover_kicker", "Мітка зверху (кран)"), tx("cover_kicker_trailer", "Мітка зверху (НПЛ-10, причепи)"),
    tx("sight_title", "Напис прицілу")));
  box.append(card("Замовник на титулці (усі стилі)",
    h("p", { class: "hint" }, "Вимкнено — замовника немає в жодній КП. Увімкнено — він є лише тоді, коли в КП вписано назву замовника (порожнє поле в конфігураторі — рядка немає)."),
    sws(sw("client", "Показувати замовника")),
    h("label", {}, "Напис перед назвою", h("input", { value: L.text.client_label || "", placeholder: "як у стилі: «ПІДГОТОВЛЕНО ДЛЯ», в Ultra і Heavy Label — «ДЛЯ»",
      oninput: (e) => { if (e.target.value.trim()) L.text.client_label = e.target.value; else delete L.text.client_label; saveAdmin(); } }))));
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
  for (const g of Object.keys(GROUPS)) {
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
          h("b", {}, price + (a.max_qty > 1 ? " / шт" : "")), h("button", { class: "sm", onclick: () => sub("a-prices") }, "Ціна"),
          h("label", { class: "inline", style: "margin:0", title: "скільки штук можна вибрати в конфігураторі" }, "до", h("input", { type: "number", min: 1, max: 9, value: a.max_qty || 1, style: "width:52px",
            onchange: (e) => set({ max_qty: Math.max(1, Math.min(9, Math.round(num(e.target.value) || 1))) }) }), "шт"),
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
    const modes = kind === "bundles" ? ["manual", "sum"] : ["manual", "eur", "bom"];
    const modeSel = h("select", { class: "sm", value: p.mode, onchange: set("mode", false) }, modes.map((m) => h("option", { value: m }, PRICE_MODES[m])));
    let data;
    if (p.mode === "eur") data = h("div", { class: "inline", style: "margin:0;flex-wrap:nowrap" }, "€", h("input", { type: "number", value: r.eur ?? "", placeholder: x.price_eur ?? "—", style: "width:90px", onchange: set("eur") }),
      "× коеф.", h("input", { type: "number", step: 0.01, value: r.coef ?? "", placeholder: "1", style: "width:64px", onchange: set("coef") }));
    else if (p.mode === "bom") { const b = bomCost(x.id);
      data = h("div", { class: "inline", style: "margin:0" }, h("small", {}, b ? `собівартість ${uah(Math.round(b.total))}` + (b.work ? ` (роботи ${fmtN(b.hours, 1)} год)` : "") + (b.miss.length ? `, без ціни: ${b.miss.length}` : "") : "калькуляції ще немає"),
        h("button", { class: "sm", onclick: () => { ownProduct = x.id; ownTab = "bom"; sub("a-own"); } }, "Калькуляція")); }
    else if (p.mode === "sum") data = h("div", {}, h("small", {}, p.lines.filter((l) => !l.startsWith("доплата")).join(" + ")),
      h("div", { class: "inline", style: "margin:0" }, "доплата, ₴", h("input", { type: "number", value: r.extra ?? "", placeholder: "0", style: "width:90px", onchange: set("extra") })));
    else data = h("input", { type: "number", value: r.base ?? "", placeholder: origUah(x.price) ?? "—", style: "width:110px", title: "порожньо — ціна з останньої КП", onchange: set("base") });
    const changed = (fx ? fx.price : origUah(x.price)) !== p.price && !(fx == null && p.price == null);
    const d = p.price != null && p.base != null ? p.price - p.base : null;
    tr.className = changed ? "pending" : "";
    tr.innerHTML = "";
    tr.append(h("td", {}, x.title, x.unit ? ` (за ${x.unit.per} ${x.unit.name})` : "", x.featured ? h("span", { class: "badge" }, "основний") : null, x.own ? h("span", { class: "badge gray" }, "власне вир-во") : null,
        x.price?.date ? h("small", { style: "display:block;color:var(--mut)" }, "з КП " + core.formatDate(x.price.date)) : null),
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
      : h("p", { class: "hint" }, "Тут з’являються ціни, що змінилися в «Ціни позицій» чи «Розрахунок ціни» (курс €, коефіцієнти, калькуляції, націнка, фінальна ціна). До фіксації КП рахуються за попередніми цінами.")));
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
      kit_price_uah: st.itemized ? null : st.kitPrice ?? null, quantities, extras: st.extras || [], itemized: !!st.itemized, date: st.date || core.todayIso() });
    return { q, sel, oldTotal: totalNum(e.total), newTotal: q.total_uah || null, newText: !q.total_uah ? "за запитом" : uah(q.total_uah) + (q.complete === false ? " *" : "") };
  } catch (err) { return { err: (err.errors || [String(err)])[0], oldTotal: totalNum(e.total) }; }
}
async function regenerateEntry(e, q, sel) {
  const st = e.state;
  const spec = specFrom(q, { number: st.number || e.number || "0001", client: { name: st.client || e.client || "", contact: st.contact || e.contact || "" },
    show_client: st.clientShow !== false, ...offerMeta(st.offerAcc === true, !!st.offerPrices, st.kit_type), edits: st.edits || null, base: st.basePreset || null, order: st.order || null }, st.style || e.style || admin.style || "dark");
  const r = await api("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spec, state: { ...st, selection: sel || st.selection }, history_id: e.id }) });
  if (!r.pptx) throw new Error((r.messages || ["КП не створено"]).slice(-1)[0]);
  return r;
}

// ------------------------------------------------------------------ settings: price calculation — products, works, materials, import, result, log
let ownProduct = null, ownTab = "specs", matQuery = "", matGroup = "", importState = null;
const M = () => admin.materials;
const newMatId = () => "m_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const newWorkId = () => "w_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const normName = (s) => String(s ?? "").toLowerCase().replace(/[«»"'`’]/g, "").replace(/[\s ]+/g, " ").trim();
const normCode = (s) => String(s ?? "").replace(/[\s ]+/g, "").toLowerCase();
/** Work name without the 1C suffix «(операція)». */
const workName = (s) => String(s ?? "").replace(/\s*\(операція\)\s*$/i, "").trim();
function parsePrice(v) {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/[\s ₴€грнuahUAHEUR]/g, "").replace(",", ".");
  return s && !isNaN(Number(s)) ? Number(s) : null;
}
const curOf = (v) => (/eur|€|євро/i.test(String(v ?? "")) ? "EUR" : "UAH");
const curSign = (c) => (c === "EUR" ? "€" : "₴");
/**
 * Change log entry: changes = [{id, name, kind?: "work", old: {price, cur} | null (created), new: {price, cur} | null (deleted)}]
 * (for works price = rate), bom = [{product, old, new}], prices = [{kind, id, old, new}] (settings price records).
 */
function logChange(note, changes, bom = [], prices = []) {
  if (!changes.length && !bom.length && !prices.length) return;
  M().log.unshift({ id: "l_" + Date.now().toString(36), at: nowStr(), note, changes, bom, prices });
  if (M().log.length > 200) M().log.length = 200;
}
const usedIn = (id) => Object.entries(admin.bom).filter(([, b]) => (b.rows || []).some((r) => r.mat === id)).map(([p]) => p);
const workUsedIn = (id) => Object.entries(admin.bom).filter(([, b]) => (b.rows || []).some((r) => r.work === id)).map(([p]) => p);
const ACC_IDS = () => new Set([...cat0.accessories, ...(CA().accs?.custom || [])].map((a) => a.id));
/** kind in admin.prices / admin.fixed of a product: options (accessories) or positions (items). */
const prodKind = (id) => (ACC_IDS().has(id) ? "accessories" : "items");
function ownProducts() {
  const own = new Set(["own_component", "npl", "truck_conversion", "custom"]);
  const all = [...cat0.items, ...(CA().items?.custom || []).map((x) => ({ family: "custom", kind: "component", ...x }))];
  const accs = [...cat0.accessories, ...(CA().accs?.custom || [])].map((a) => ({ ...a, family: "acc", kind: "accessory" }));
  return [...all.filter((i) => own.has(i.family)), ...accs.filter((a) => !a.disabled || admin.bom[a.id]?.rows?.length),
    ...all.filter((i) => !own.has(i.family) && i.kind !== "crane")];
}
const productTitle = (p) => p ? (p.title + (p.specs?.crane ? ` — для ${p.specs.crane}` : p.model && !p.title.includes(p.model) ? ` ${p.model}` : "") + (p.family === "acc" ? " (опція)" : "")) : "";
const prodById = (id) => ownProducts().find((x) => x.id === id);
const prodPrice = (id, force = null) => { const p = prodById(id); return priceOf(prodKind(id), id, p?.price, p, 0, force); };
const kpPrice = (kind, id, rule) => { const fx = fixedOf(kind, id); return fx ? fx.price : origUah(rule); };
const hasCalc = (id) => !!(admin.bom[id]?.rows?.length || admin.bom[id]?.ref);
function prodOptions(sel, filter = () => true) {
  const prods = ownProducts().filter(filter);
  const grp = (t, list) => list.length ? h("optgroup", { label: t }, list.map((x) => h("option", { value: x.id, selected: x.id === sel }, productTitle(x) + (hasCalc(x.id) ? " ✓" : "")))) : null;
  return [grp("Власне виробництво", prods.filter((x) => x.family !== "acc" && ["own_component", "npl", "truck_conversion", "custom"].includes(x.family))),
    grp("Опції", prods.filter((x) => x.family === "acc")), grp("Інші позиції", prods.filter((x) => x.family !== "acc" && !["own_component", "npl", "truck_conversion", "custom"].includes(x.family)))];
}
function renderOwn() {
  const seg = $("#ownSeg"); seg.innerHTML = "";
  const tabs = [["specs", "Вироби"], ["bom", "Калькуляція виробу"], ["labour", "Розцінки робіт"], ["mats", "Матеріали і ціни"], ["import", "Імпорт з Excel"], ["result", "Результат оновлення"], ["log", "Журнал і відкат"]];
  for (const [k, t] of tabs) seg.append(h("button", { class: ownTab === k ? "on" : "", onclick: () => { ownTab = k; renderOwn(); } }, t, k === "result" && admin.calc_result?.rows?.length ? h("b", { class: "cnt" }, String(admin.calc_result.rows.length)) : null));
  const box = $("#ownBox"); box.innerHTML = "";
  ({ specs: ownSpecs, bom: ownBom, labour: ownLabour, mats: ownMaterials, import: ownImport, result: ownResult, log: ownLog })[ownTab](box);
}
const openCalc = (id) => { ownProduct = id; ownTab = "bom"; renderOwn(); };

// ---- products overview
function ownSpecs(box) {
  const prods = ownProducts().filter((p) => hasCalc(p.id));
  box.append(h("div", { class: "card" }, h("div", { class: "inline", style: "margin:0" }, h("b", {}, "Завантажити калькуляцію виробу з 1С"),
    importFileInput("spec"), h("span", { class: "hint", style: "margin:0" }, "Файл «Специфікація» (.xlsx або .xls): матеріали з кількістю і тех. операції з годинами. Виріб визначиться за назвою, його можна змінити перед застосуванням.")),
    h("div", { class: "inline" }, h("b", {}, "Оновити ціни матеріалів"), importFileInput("prices"), h("span", { class: "hint", style: "margin:0" }, "Файл складу «Найменування — ціна»: після імпорту видно, як змінилась собівартість і ціна кожного виробу.")),
    h("div", { class: "inline" }, h("b", {}, "Готові ціни позицій КП"), importFileInput("ready"), h("span", { class: "hint", style: "margin:0" }, "Файл «Найменування — ціна» з фінальними цінами (крани, осі, гальма…): позиції КП знаходяться за назвою, кожну можна змінити."))));
  if (!prods.length) { box.append(h("p", { class: "hint" }, "Калькуляцій ще немає. Завантажте файл калькуляції з 1С або відкрийте «Калькуляція виробу» і додайте матеріали й роботи вручну.")); return; }
  const tb = h("tbody");
  for (const p of prods) {
    const kind = prodKind(p.id), b = bomCost(p.id), pr = prodPrice(p.id), calc = prodPrice(p.id, "bom"), inKp = kpPrice(kind, p.id, p.price);
    const B = admin.bom[p.id];
    tb.append(h("tr", { class: pr.mode === "bom" && inKp !== pr.price ? "pending" : "" },
      h("td", {}, h("b", {}, productTitle(p)), h("small", { style: "display:block" }, B.ref ? `калькуляція виробу «${productTitle(prodById(B.ref))}»` : (B.title || "") + (B.at ? ` · ${B.at}` : ""))),
      h("td", { class: "num" }, b ? uah(Math.round(b.mat)) : "—"),
      h("td", { class: "num" }, b?.work ? `${uah(Math.round(b.work))}` : "—", b?.hours ? h("small", { style: "display:block" }, `${fmtN(b.hours, 1)} год`) : null),
      h("td", { class: "num" }, h("b", {}, b ? uah(Math.round(b.total)) : "—"), b?.miss.length ? h("small", { class: "minus", style: "display:block" }, `без ціни: ${b.miss.length}`) : null),
      h("td", { class: "num" }, calc.price == null ? "—" : uah(calc.price), calc.mk ? h("small", { style: "display:block" }, `націнка ${fmtN(calc.mk)} %`) : null),
      h("td", { class: "num" }, inKp == null ? "за запитом" : uah(inKp), h("small", { style: "display:block" }, pr.mode === "bom" ? (pr.fin != null ? "фінальна вручну" : "з калькуляції") : "ціна вручну")),
      h("td", {}, h("button", { class: "sm", onclick: () => openCalc(p.id) }, "Відкрити"))));
  }
  box.append(h("div", { class: "sec-card" }, h("div", { class: "tbl-wrap" }, h("table", { class: "prices" },
    h("thead", {}, h("tr", {}, ["Виріб", "Матеріали", "Роботи", "Собівартість", "Ціна з калькуляції", "У КП зараз", ""].map((t, i) => h("th", { class: i && i < 6 ? "num" : "" }, t)))), tb))));
}

// ---- one product: materials, works, totals, price
function ownBom(box) {
  const prods = ownProducts();
  if (!prods.some((p) => p.id === ownProduct)) ownProduct = prods.find((p) => hasCalc(p.id))?.id || prods[0]?.id;
  const p = prodById(ownProduct), kind = prodKind(ownProduct);
  const B0 = (admin.bom[ownProduct] ??= { rows: [], coef: 1, extra: 0 });
  const mats = matMap(), list = M().list, works = admin.labour, subs = specByName();
  const R = () => (admin.prices[kind][ownProduct] ??= {});
  const pr = prodPrice(ownProduct), calc = prodPrice(ownProduct, "bom"), bc = bomCost(ownProduct), fx = fixedOf(kind, ownProduct);
  const label = (m) => (m.code ? m.code + " · " : "") + m.name;
  const byLabel = new Map(list.map((m) => [label(m), m]));
  const save = (rerender = true) => { saveAdmin(); if (rerender) renderOwn(); fixBadge(); };
  const logBom = (note, old) => { M().log.unshift({ id: "l_" + Date.now().toString(36), at: nowStr(), note, changes: [], bom: [{ product: ownProduct, old, new: structuredClone(admin.bom[ownProduct]) }] }); };
  const refSel = h("select", { class: "sm", onchange: (e) => { const old = structuredClone(B0); if (e.target.value) B0.ref = e.target.value; else delete B0.ref; logBom(`калькуляція «${productTitle(p)}»: ${B0.ref ? "як у " + productTitle(prodById(B0.ref)) : "своя"}`, old); save(); } },
    h("option", { value: "" }, "своя калькуляція"), prods.filter((x) => x.id !== ownProduct && admin.bom[x.id]?.rows?.length && !admin.bom[x.id].ref).map((x) => h("option", { value: x.id, selected: B0.ref === x.id }, "як у: " + productTitle(x))));
  box.append(h("div", { class: "card" }, h("div", { class: "inline", style: "margin:0" }, h("b", {}, "Виріб"),
    h("select", { onchange: (e) => openCalc(e.target.value) }, prodOptions(ownProduct)), refSel,
    h("span", {}, "Завантажити з 1С:"), importFileInput("spec", ownProduct)),
    B0.title || B0.file ? h("p", { class: "hint", style: "margin:6px 0 0" }, `У 1С: ${B0.title || "—"}` + (B0.file ? ` · файл «${B0.file}»` : "") + (B0.at ? `, ${B0.at}` : "")) : null));
  if (B0.ref) {
    box.append(h("p", { class: "hint" }, `Ціна рахується за калькуляцією виробу «${productTitle(prodById(B0.ref))}». Щоб мати окрему, оберіть «своя калькуляція».`),
      h("button", { class: "sm", onclick: () => openCalc(B0.ref) }, "Відкрити ту калькуляцію"));
  } else {
    // materials
    const tb = h("tbody");
    B0.rows.forEach((r, i) => {
      if (r.work) return;
      const m = mats.get(r.mat), sid = m ? subs.get(normName(m.name)) : null, sc = sid && sid !== ownProduct ? bomCost(sid) : null;
      const pu = sc ? sc.total : matUah(m), q = num(r.qty) ?? 0;
      const inp = h("input", { list: "matList", value: m ? label(m) : "", placeholder: "почніть вводити назву чи код", style: "min-width:280px;width:100%", onchange: (e) => {
        const mm = byLabel.get(e.target.value) || list.find((x) => normName(x.name) === normName(e.target.value));
        if (!mm) return toast("Такого матеріалу немає в довіднику — додайте його у «Матеріали і ціни»");
        r.mat = mm.id; save(); } });
      tb.append(h("tr", { class: pu != null ? "" : "pending" }, h("td", {}, inp, sc ? h("small", { style: "display:block" }, "вузол: ціна з калькуляції ", h("a", { href: "#", onclick: (e) => { e.preventDefault(); openCalc(sid); } }, productTitle(prodById(sid)))) : null),
        h("td", { class: "num" }, h("input", { type: "text", inputmode: "decimal", value: r.qty ?? "", style: "width:72px", onchange: (e) => { r.qty = parsePrice(e.target.value); save(); } })),
        h("td", {}, m?.unit || ""), h("td", { class: "num" }, sc ? uah(Math.round(sc.total)) : m ? (m.price == null ? "без ціни" : `${fmtN(m.price)} ${curSign(m.cur)}`) : "—"),
        h("td", { class: "num" }, pu == null ? "—" : uah(Math.round(pu * q))),
        h("td", {}, h("button", { class: "sm danger", onclick: () => { B0.rows.splice(i, 1); save(); } }, "×"))));
    });
    const nMat = B0.rows.filter((r) => !r.work).length, nWork = B0.rows.length - nMat;
    box.append(h("datalist", { id: "matList" }, list.map((m) => h("option", { value: label(m) }))),
      h("div", { class: "sec-card" }, h("div", { class: "head" }, h("h2", {}, "Матеріали і комплектуючі", h("small", {}, `${nMat} рядків · ${bc ? uah(Math.round(bc.mat)) : "—"}`)),
        h("button", { class: "sm primary", disabled: !list.length, title: list.length ? "" : "спершу додайте матеріали", onclick: () => { B0.rows.push({ mat: list[0].id, qty: 1 }); save(); } }, "＋ Матеріал")),
        nMat ? h("div", { class: "tbl-wrap" }, h("table", { class: "prices" }, h("thead", {}, h("tr", {}, ["Матеріал чи комплектуючий", "К-сть", "Од.", "Ціна", "Сума", ""].map((t, i) => h("th", { class: i === 1 || i === 3 || i === 4 ? "num" : "" }, t)))), tb))
          : h("p", { class: "hint" }, "Немає матеріалів. Завантажте калькуляцію з 1С або додайте рядки.")));
    // works
    const tw = h("tbody");
    B0.rows.forEach((r, i) => {
      if (!r.work) return;
      const w = works.find((x) => x.id === r.work), q = num(r.qty) ?? 0, rate = num(w?.rate);
      tw.append(h("tr", { class: rate != null ? "" : "pending" },
        h("td", {}, h("select", { onchange: (e) => { r.work = e.target.value; save(); } }, works.map((x) => h("option", { value: x.id, selected: x.id === r.work }, x.name)))),
        h("td", { class: "num" }, h("input", { type: "text", inputmode: "decimal", value: r.qty ?? "", style: "width:72px", onchange: (e) => { r.qty = parsePrice(e.target.value); save(); } })),
        h("td", { class: "num" }, rate == null ? "—" : uah(rate)), h("td", { class: "num" }, rate == null ? "—" : uah(Math.round(rate * q))),
        h("td", {}, h("button", { class: "sm danger", onclick: () => { B0.rows.splice(i, 1); save(); } }, "×"))));
    });
    box.append(h("div", { class: "sec-card" }, h("div", { class: "head" }, h("h2", {}, "Роботи (години)", h("small", {}, `${nWork} рядків · ${bc ? `${fmtN(bc.hours, 1)} год · ${uah(Math.round(bc.work))}` : "—"}`)),
      h("button", { class: "sm primary", disabled: !works.length, title: works.length ? "" : "спершу додайте розцінки робіт", onclick: () => { B0.rows.push({ work: works[0].id, qty: 1 }); save(); } }, "＋ Робота")),
      nWork ? h("div", { class: "tbl-wrap" }, h("table", { class: "prices" }, h("thead", {}, h("tr", {}, ["Робота", "Години", "Розцінка, ₴/год", "Сума", ""].map((t, i) => h("th", { class: i && i < 4 ? "num" : "" }, t)))), tw))
        : h("p", { class: "hint" }, works.length ? "Робіт немає." : "Розцінок робіт ще немає: вони з’являться після імпорту калькуляції або їх можна додати у «Розцінки робіт».")));
  }
  // totals and price
  const auto = pr.mode === "bom" && pr.fin == null;
  const fin = h("input", { type: "number", value: R().final ?? "", placeholder: calc.calc ?? "", style: "width:120px" });
  box.append(h("div", { class: "sec-card" }, h("div", { class: "head" }, h("h2", {}, "Собівартість і ціна")),
    h("div", { class: "bom-sum" },
      h("div", {}, "Матеріали: ", h("b", {}, bc ? uah(Math.round(bc.mat)) : "—"), " · роботи: ", h("b", {}, bc ? uah(Math.round(bc.work)) : "—"), bc?.miss.length ? h("small", { class: "minus" }, ` без ціни: ${bc.miss.slice(0, 3).join(", ")}${bc.miss.length > 3 ? "…" : ""}`) : null),
      B0.ref ? null : h("label", { class: "inline", style: "margin:0" }, "× коефіцієнт", h("input", { type: "number", step: 0.01, value: B0.coef ?? 1, style: "width:80px", onchange: (e) => { B0.coef = num(e.target.value) ?? 1; save(); } })),
      B0.ref ? null : h("label", { class: "inline", style: "margin:0" }, "+ інші витрати, ₴", h("input", { type: "number", value: B0.extra ?? 0, style: "width:110px", onchange: (e) => { B0.extra = num(e.target.value) ?? 0; save(); } })),
      h("div", {}, "Собівартість: ", h("b", {}, bc ? uah(core.roundTo(bc.total, settings.rounding_uah || 1)) : "—")),
      h("label", { class: "inline", style: "margin:0" }, "Націнка, %", h("input", { type: "number", step: 0.5, value: R().markup ?? "", placeholder: "0", style: "width:72px", onchange: (e) => { const v = num(e.target.value); if (v == null) delete R().markup; else R().markup = v; save(); } })),
      h("div", {}, "Ціна з калькуляції: ", h("b", {}, calc.calc == null ? "—" : uah(calc.calc)))),
    h("div", { class: "price-pick" },
      h("label", { class: "chk" }, h("input", { type: "radio", name: "pp", checked: auto, onchange: () => { R().mode = "bom"; delete R().final; save(); } }), h("span", {}, h("b", {}, "Автоматично"), " — ціна в КП = ціна з калькуляції, змінюється разом з цінами матеріалів і робіт")),
      h("label", { class: "chk" }, h("input", { type: "radio", name: "pp", checked: pr.mode === "bom" && pr.fin != null, onchange: () => { R().mode = "bom"; R().final = num(fin.value) ?? calc.calc; save(); } }), h("span", {}, h("b", {}, "Вручну"), " — фінальна ціна, ₴ "), fin),
      h("label", { class: "chk" }, h("input", { type: "radio", name: "pp", checked: pr.mode !== "bom", onchange: () => { delete R().mode; delete R().final; save(); } }), h("span", {}, h("b", {}, "Як була"), ` — ціна вручну з «Ціни позицій» (${uah(priceOf(kind, ownProduct, p?.price, p, 0, "manual").price)}), калькуляція лише для довідки`))),
    h("div", { class: "inline" }, h("span", {}, "У КП зараз: ", h("b", {}, kpPrice(kind, ownProduct, p?.price) == null ? "за запитом" : uah(kpPrice(kind, ownProduct, p?.price)))), h("span", {}, " → нова: ", h("b", {}, pr.price == null ? "за запитом" : uah(pr.price))),
      h("button", { class: "primary sm", disabled: pr.price == null || pr.price === kpPrice(kind, ownProduct, p?.price), onclick: async () => {
        await fixPrices([{ kind, id: ownProduct, now: pr.price, lines: pr.lines }], `ціна «${productTitle(p)}» ${pr.price}`); toast("Ціну зафіксовано — нові КП рахуються з нею"); renderOwn(); fixBadge(); } }, "Зафіксувати для КП"),
      h("button", { class: "sm", onclick: () => sub("a-fix") }, "Усі зміни цін і перерахунок КП →"))));
  fin.onchange = () => { R().mode = "bom"; const v = num(fin.value); if (v == null) delete R().final; else R().final = v; save(); };
}

// ---- labour rates
function ownLabour(box) {
  const L = admin.labour;
  const coef = h("input", { type: "number", step: 0.01, placeholder: "1,1", style: "width:80px" });
  box.append(h("div", { class: "card" }, h("p", { class: "hint", style: "margin:0 0 8px" }, "Розцінка — гривень за годину роботи. Калькуляції беруть години з файлу 1С, а розцінку звідси: змінили розцінку — змінилась собівартість усіх виробів з цією роботою."),
    h("div", { class: "inline", style: "margin:0" }, h("button", { class: "sm primary", onclick: () => { L.push({ id: newWorkId(), name: "Нова робота", rate: null }); logChange("додано роботу", [{ id: L.at(-1).id, kind: "work", name: "Нова робота", old: null, new: { price: null } }]); saveAdmin(); renderOwn(); } }, "＋ Робота"),
      h("b", {}, "Усі розцінки ×"), coef, h("button", { class: "sm", onclick: () => { const k = num(String(coef.value).replace(",", ".")); if (!k) return toast("Вкажіть коефіцієнт");
        const ch = []; for (const w of L) { if (num(w.rate) == null) continue; const old = w.rate; w.rate = Math.round(w.rate * k * 100) / 100; ch.push({ id: w.id, kind: "work", name: w.name, old: { price: old }, new: { price: w.rate } }); }
        snapResult(`розцінки робіт × ${k}`, () => logChange(`розцінки робіт × ${k}`, ch)); } }, "Застосувати"))));
  const tb = h("tbody");
  for (const w of L) {
    const u = workUsedIn(w.id);
    tb.append(h("tr", {}, h("td", {}, h("input", { value: w.name, style: "min-width:420px;width:100%", onchange: (e) => { w.name = e.target.value.trim(); saveAdmin(); } })),
      h("td", { class: "num" }, h("input", { type: "text", inputmode: "decimal", value: w.rate ?? "", style: "width:100px", onchange: (e) => { const old = w.rate; const v = parsePrice(e.target.value);
        snapResult(`розцінка «${w.name}»`, () => { w.rate = v; logChange(`розцінка: ${w.name}`, [{ id: w.id, kind: "work", name: w.name, old: { price: old }, new: { price: v } }]); }); } })),
      h("td", {}, u.length ? h("small", { title: u.map((x) => productTitle(prodById(x))).join(", ") }, `у ${u.length} вир.`) : h("small", { class: "hint", style: "margin:0" }, "—")),
      h("td", {}, h("button", { class: "sm danger", onclick: () => confirmBox(`Видалити роботу «${w.name}»?` + (u.length ? ` Вона є в ${u.length} калькуляціях — там рядок лишиться без розцінки.` : ""), "Видалити", () => {
        admin.labour = admin.labour.filter((x) => x !== w); logChange("видалено роботу", [{ id: w.id, kind: "work", name: w.name, old: { price: w.rate, row: structuredClone(w) }, new: null }]); saveAdmin(); renderOwn(); }) }, "×"))));
  }
  box.append(h("div", { class: "sec-card" }, L.length ? h("div", { class: "tbl-wrap" }, h("table", { class: "prices" }, h("thead", {}, h("tr", {}, ["Робота", "₴ за годину", "Де", ""].map((t, i) => h("th", { class: i === 1 ? "num" : "" }, t)))), tb))
    : h("p", { class: "hint" }, "Розцінок ще немає: вони додадуться з першої калькуляції 1С (тех. операції) або кнопкою «＋ Робота».")));
}

// ---- materials directory
function ownMaterials(box) {
  const list = M().list, rate = eurRate();
  const groups = [...new Set(list.map((m) => m.group || "").filter(Boolean))].sort();
  const q = normName(matQuery);
  const shown = list.filter((m) => (!matGroup || (m.group || "") === matGroup) && (!q || normName(m.name + " " + (m.code || "")).includes(q)));
  const gsel = (v, on) => h("select", { class: "sm", value: v, onchange: on }, h("option", { value: "" }, "усі групи"), groups.map((g) => h("option", { value: g, selected: g === v }, g)));
  const coef = h("input", { type: "number", step: 0.01, placeholder: "1,05", style: "width:80px" });
  const bulkScope = () => list.filter((m) => !matGroup || (m.group || "") === matGroup);
  const bulk = (note, fn) => snapResult(note, () => {
    const ch = [];
    for (const m of bulkScope()) { const old = { price: m.price, cur: m.cur }; if (fn(m) === false) continue; if (old.price !== m.price || old.cur !== m.cur) ch.push({ id: m.id, name: m.name, old, new: { price: m.price, cur: m.cur } }); }
    logChange(note + (matGroup ? ` (група «${matGroup}»)` : " (усі)"), ch); toast(`Змінено: ${ch.length}`);
  });
  box.append(h("div", { class: "card" },
    h("div", { class: "inline", style: "margin:0" }, h("input", { type: "search", placeholder: "Пошук: назва чи код", value: matQuery, oninput: (e) => { matQuery = e.target.value; renderOwnSoon(); } }),
      gsel(matGroup, (e) => { matGroup = e.target.value; renderOwn(); }), h("span", { class: "hint", style: "margin:0" }, `${shown.length} з ${list.length}`),
      h("button", { class: "sm primary", onclick: () => { list.push({ id: newMatId(), code: "", name: "Новий матеріал", unit: "шт", group: matGroup || "", price: null, cur: "UAH" });
        logChange("додано матеріал", [{ id: list.at(-1).id, name: "Новий матеріал", old: null, new: { price: null, cur: "UAH" } }]); saveAdmin(); renderOwn(); } }, "＋ Матеріал"),
      h("span", {}, "Оновити ціни з файлу складу:"), importFileInput("prices")),
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
      if (k === "price" || k === "cur") return snapResult("вручну: " + m.name, () => { m[k] = v; logChange("вручну: " + m.name, [{ id: m.id, name: m.name, old, new: { price: m.price, cur: m.cur } }]); });
      m[k] = v; saveAdmin(); if (k === "group" || k === "unit") renderOwn();
    };
    const u = usedIn(m.id);
    tb.append(h("tr", {}, h("td", {}, h("input", { value: m.code || "", style: "width:90px", onchange: set("code") })),
      h("td", {}, h("input", { value: m.name, style: "min-width:260px", onchange: set("name") })),
      h("td", {}, h("input", { value: m.unit || "", style: "width:56px", onchange: set("unit") })),
      h("td", {}, h("input", { value: m.group || "", style: "width:120px", list: "matGroups", onchange: set("group") })),
      h("td", { class: "num" }, h("input", { type: "text", inputmode: "decimal", value: m.price ?? "", style: "width:100px", onchange: set("price") })),
      h("td", {}, h("select", { class: "sm", onchange: set("cur") }, h("option", { value: "UAH", selected: m.cur !== "EUR" }, "₴"), h("option", { value: "EUR", selected: m.cur === "EUR" }, "€"))),
      h("td", { class: "num" }, m.cur === "EUR" ? uah(matUah(m) == null ? null : Math.round(matUah(m))) : ""),
      h("td", {}, u.length ? h("small", { title: u.map((p) => productTitle(prodById(p))).join(", ") }, `у ${u.length} вир.`) : h("small", { class: "hint", style: "margin:0" }, "—")),
      h("td", {}, h("button", { class: "sm danger", onclick: () => confirmBox(`Видалити «${m.name}»?` + (u.length ? ` Він є в калькуляції ${u.length} виробів — там рядок лишиться без ціни.` : ""), "Видалити", () => {
        M().list = M().list.filter((x) => x !== m); logChange("видалено матеріал", [{ id: m.id, name: m.name, old: { price: m.price, cur: m.cur, row: structuredClone(m) }, new: null }]);
        saveAdmin(); renderOwn(); }) }, "×"))));
  }
  box.append(h("datalist", { id: "matGroups" }, groups.map((g) => h("option", { value: g }))),
    h("div", { class: "sec-card" }, list.length ? h("div", { class: "tbl-wrap" }, h("table", { class: "prices mats" }, h("thead", {}, h("tr", {}, ["Код", "Назва", "Од.", "Група", "Ціна", "Вал.", "у ₴", "Де", ""].map((t, i) => h("th", { class: i === 4 || i === 6 ? "num" : "" }, t)))), tb))
      : h("p", { class: "hint" }, "Матеріалів ще немає. Вони додаються з калькуляцій 1С, з файлу складу (вкладка «Імпорт з Excel») або кнопкою «＋ Матеріал»."),
      shown.length > 400 ? h("p", { class: "hint" }, "Показано перші 400 — уточніть пошук.") : null));
}
let ownT;
function renderOwnSoon() { clearTimeout(ownT); ownT = setTimeout(() => { const a = document.activeElement, pos = a?.selectionStart; renderOwn(); const s = $("#ownBox input[type=search]"); if (s) { s.focus(); try { s.setSelectionRange(pos, pos); } catch {} } }, 250); }

// ---- result of a price update: cost before → after for every product with a calculation, the new KP price automatically or by hand
/** Prices of everything a calculation feeds: products (own price records) and the bundles they are part of. */
function calcSnapshot() {
  const out = new Map();
  for (const p of ownProducts().filter((x) => hasCalc(x.id))) {
    const b = bomCost(p.id);
    out.set("p:" + p.id, { cost: b ? b.total : null, calc: prodPrice(p.id, "bom").calc });
  }
  return out;
}
/** Runs a change of materials / works prices, then shows what it did to the products («Результат оновлення»). */
function snapResult(note, fn) {
  const before = calcSnapshot();
  fn();
  const after = calcSnapshot(), rows = [];
  for (const [k, a] of after) {
    const b = before.get(k);
    if (!b || (b.cost === a.cost && b.calc === a.calc)) continue;
    const id = k.slice(2), p = prodById(id), kind = prodKind(id);
    rows.push({ kind, id, title: productTitle(p), oldCost: b.cost, newCost: a.cost, calc: a.calc, inKp: kpPrice(kind, id, p?.price), pick: "auto", manual: null });
  }
  if (rows.length) { admin.calc_result = { at: nowStr(), note, rows, bundles: [] }; ownTab = "result"; }
  saveAdmin(true, note);
  renderOwn(); fixBadge();
  if (rows.length) toast(`Змінилась собівартість ${rows.length} виробів — оберіть нові ціни`);
}
function bundlesWith(itemIds) {
  return cat0.bundles.filter((b) => Object.values(b.slots || {}).some((x) => itemIds.has(x)));
}
function ownResult(box) {
  const R = admin.calc_result;
  if (!R?.rows.length) { box.append(h("p", { class: "hint" }, "Тут з’являється результат після оновлення цін матеріалів чи розцінок: як змінилась собівартість кожного виробу і яку ціну поставити в КП.")); return; }
  const tb = h("tbody");
  const newOf = (r) => r.pick === "auto" ? r.calc : r.pick === "manual" ? r.manual : r.inKp;
  for (const r of R.rows) {
    const man = h("input", { type: "number", value: r.manual ?? "", placeholder: r.calc ?? "", style: "width:110px", onchange: (e) => { r.manual = num(e.target.value); r.pick = "manual"; renderOwn(); } });
    const radio = (v, t) => h("label", { class: "chk", style: "margin:0" }, h("input", { type: "radio", name: "pk_" + r.id, checked: r.pick === v, onchange: () => { r.pick = v; if (v === "manual" && r.manual == null) r.manual = r.calc; renderOwn(); } }), t);
    tb.append(h("tr", { class: newOf(r) !== r.inKp ? "pending" : "" },
      h("td", {}, h("a", { href: "#", onclick: (e) => { e.preventDefault(); openCalc(r.id); } }, r.title)),
      h("td", { class: "num" }, uah(r.oldCost == null ? null : Math.round(r.oldCost))), h("td", { class: "num" }, uah(r.newCost == null ? null : Math.round(r.newCost))), diffCell(r.oldCost, r.newCost),
      h("td", { class: "num" }, r.inKp == null ? "за запитом" : uah(r.inKp)),
      h("td", {}, h("div", { class: "pick" }, radio("auto", `${r.ready ? "з файлу" : "автоматично"} ${uah(r.calc)}`), h("span", { class: "inline", style: "margin:0" }, radio("manual", "вручну"), man), radio("keep", "не міняти"))),
      h("td", { class: "num" }, h("b", {}, newOf(r) == null ? "за запитом" : uah(newOf(r))))));
  }
  // bundles with a changed product: their price as the sum of positions
  const ids = new Set(R.rows.filter((r) => r.kind === "items").map((r) => r.id));
  const bl = bundlesWith(ids).map((b) => {
    let sum = 0, ok = true;
    for (const iid of Object.values(b.slots)) {
      const rr = R.rows.find((r) => r.id === iid), i0 = cat0.items.find((x) => x.id === iid);
      const p = rr ? newOf(rr) : kpPrice("items", iid, i0?.price);
      if (p == null) ok = false; else sum += p;
    }
    const rec = admin.prices.bundles[b.id] || {};
    const total = ok ? core.roundTo(sum + (num(rec.extra) ?? 0), settings.rounding_uah || 1) : null;
    const st = (R.bundles.find((x) => x.id === b.id) || (R.bundles.push({ id: b.id, pick: "keep" }), R.bundles.at(-1)));
    return { b, total, inKp: kpPrice("bundles", b.id, b.price), st };
  });
  box.append(h("div", { class: "sec-card" }, h("div", { class: "head" }, h("h2", {}, "Результат: " + R.note, h("small", {}, R.at)),
    h("div", { class: "inline", style: "margin:0" }, h("button", { class: "sm", onclick: () => { R.rows.forEach((r) => (r.pick = "auto")); renderOwn(); } }, "Усім автоматично"),
      h("button", { class: "sm", onclick: () => { R.rows.forEach((r) => (r.pick = "keep")); renderOwn(); } }, "Усім не міняти"))),
    h("div", { class: "tbl-wrap" }, h("table", { class: "prices" }, h("thead", {}, h("tr", {}, ["Виріб", "Собівартість була", "Стала", "Різниця", "У КП зараз", "Нова ціна в КП", ""].map((t, i) => h("th", { class: i && i !== 5 ? "num" : "" }, t)))), tb)),
    h("p", { class: "hint" }, "«Автоматично» — ціна з калькуляції (собівартість × коефіцієнт + інші витрати, з націнкою виробу) і далі рухатиметься разом з цінами; «вручну» — ваша фінальна ціна; «не міняти» — у КП лишається поточна.")));
  if (bl.length) {
    const tb2 = h("tbody");
    for (const x of bl) {
      const radio = (v, t) => h("label", { class: "chk", style: "margin:0" }, h("input", { type: "radio", name: "pb_" + x.b.id, checked: x.st.pick === v, onchange: () => { x.st.pick = v; renderOwn(); } }), t);
      tb2.append(h("tr", {}, h("td", {}, bundleTitle(x.b)), h("td", { class: "num" }, x.inKp == null ? "за запитом" : uah(x.inKp)),
        h("td", { class: "num" }, x.total == null ? "не всі позиції мають ціну" : uah(x.total)), diffCell(x.inKp, x.total),
        h("td", {}, h("div", { class: "pick" }, radio("sum", "сума позицій"), radio("keep", "не міняти")))));
    }
    box.append(h("div", { class: "sec-card" }, h("div", { class: "head" }, h("h2", {}, "Комплекти з однією ціною, де є ці вироби")),
      h("div", { class: "tbl-wrap" }, h("table", { class: "prices" }, h("thead", {}, h("tr", {}, ["Комплект", "У КП зараз", "Сума позицій з новими цінами", "Різниця", ""].map((t, i) => h("th", { class: i && i < 4 ? "num" : "" }, t)))), tb2))));
  }
  box.append(h("div", { class: "inline" }, h("button", { class: "primary", onclick: () => applyResult(R, bl) }, "Застосувати і зафіксувати для КП"),
    h("button", { onclick: () => { admin.calc_result = null; saveAdmin(); renderOwn(); } }, "Закрити без змін цін")));
}
async function applyResult(R, bl) {
  const fix = [], recs = [];
  const recOf = (kind, id) => { const old = structuredClone(admin.prices[kind][id] ?? null); recs.push({ kind, id, old }); return (admin.prices[kind][id] ??= {}); };
  for (const r of R.rows) {
    if (r.pick === "keep") continue;
    const rec = recOf(r.kind, r.id);
    if (!r.ready) rec.mode = "bom";   // ready prices (гот) stay a price by hand
    if (r.pick === "manual" && r.manual != null) rec.final = r.manual; else delete rec.final;
  }
  for (const x of bl) if (x.st.pick === "sum") { const rec = recOf("bundles", x.b.id); rec.mode = "sum"; delete rec.final; }
  for (const q of recs) q.new = structuredClone(admin.prices[q.kind][q.id]);
  for (const r of R.rows) if (r.pick !== "keep") { const p = prodById(r.id), d = priceOf(r.kind, r.id, p?.price, p); fix.push({ kind: r.kind, id: r.id, now: d.price, lines: d.lines }); }
  for (const x of bl) if (x.st.pick === "sum") { const d = priceOf("bundles", x.b.id, x.b.price); fix.push({ kind: "bundles", id: x.b.id, now: d.price, lines: d.lines }); }
  if (!fix.length) return toast("Нічого не обрано");
  logChange("нові ціни виробів: " + R.note, [], [], recs);
  await fixPrices(fix, "нові ціни виробів: " + R.note);
  admin.calc_result = null; await saveAdmin(true); ownTab = "specs"; renderOwn(); fixBadge();
  toast(`Зафіксовано цін: ${fix.length}. Перерахувати вже створені КП — у «Фіксація цін і КП».`);
}

// ---- import: file -> sheet -> columns -> preview with statuses -> apply (logged, rollback in the log)
const COLS = { code: ["код", "артикул", "code", "sku"], name: ["назва", "найменування", "номенклатура", "товар", "матеріал", "name"],
  price: ["облікова ціна", "ціна", "вартість", "price", "грн", "сума за од"], cur: ["валюта", "currency"], unit: ["од.", "одиниц", "unit", "виміру"], group: ["група", "категор", "розділ", "group"],
  qty: ["кількість", "к-сть", "кол", "qty"] };
const COL_T = { code: "Код", name: "Назва", price: "Ціна", cur: "Валюта", unit: "Од. виміру", group: "Група", qty: "Кількість (для складу виробу)" };
function guessHeader(rows) {
  let best = 0, bi = 0;
  rows.slice(0, 15).forEach((r, i) => { const n = r.filter((c) => typeof c === "string" && Object.values(COLS).flat().some((w) => c.toLowerCase().includes(w))).length; if (n > best) { best = n; bi = i; } });
  const head = rows[bi] || [];
  const map = {};
  for (const [k, words] of Object.entries(COLS)) {
    let i = -1;
    for (const w of words) { i = head.findIndex((c, j) => typeof c === "string" && c.toLowerCase().includes(w) && !Object.values(map).includes(j)); if (i >= 0) break; }
    if (i >= 0) map[k] = i;
  }
  return { headerRow: bi, map };
}
/** 1C «Специфікація»: sections «Матеріали» and «Тех. операції», the first row of «Матеріали» with no price is the product itself. */
function parseSpec(rows) {
  const hi = rows.findIndex((r) => r.some((c) => /^номенклатура$/i.test(String(c).trim())) && r.some((c) => /кількість/i.test(String(c))));
  if (hi < 0 || !rows.some((r) => /^(матеріали|тех\. ?операції)$/i.test(String(r[0]).trim()))) return null;
  const head = rows[hi], col = (re) => head.findIndex((c) => re.test(String(c)));
  const cName = Math.max(0, col(/^номенклатура$/i)), cUnit = col(/од\./i), cQty = col(/кількість/i), cPrice = col(/ціна/i);
  let sec = null, title = "";
  const mats = [], works = [];
  for (const r of rows.slice(hi + 1)) {
    const name = String(r[cName] ?? "").trim();
    if (!name) continue;
    if (/^матеріали$/i.test(name)) { sec = "mat"; continue; }
    if (/^тех\. ?операції$/i.test(name)) { sec = "work"; continue; }
    if (/^разом$/i.test(name)) { sec = null; continue; }
    const qty = parsePrice(r[cQty]), price = parsePrice(r[cPrice]);
    if (sec === "mat") {
      if (!title && price == null) { title = name; continue; }
      mats.push({ name, unit: String(r[cUnit] ?? "").trim(), qty, price });
    } else if (sec === "work") works.push({ name: workName(name), qty, price });
  }
  return { title, mats, works };
}
const tokens = (s) => normName(s).replace(/[^a-zа-яіїєґ0-9]+/gi, " ").split(" ").filter((w) => w.length > 1 || /\d/.test(w)).map((w) => (/\d/.test(w) ? w : w.slice(0, 5)));
function nameScore(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b)); if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  const nums = [...A].filter((w) => /\d/.test(w)); if (nums.some((w) => !B.has(w))) return 0;   // «BMF 720» never matches «BMF 750»
  return n / Math.max(A.size, B.size);
}
/** Product of a 1C calculation by its name: the share of the product title's words found in it («Місце оператора» in «Місце оператора в зборі BMF650/720»). */
function guessProduct(title) {
  const A = new Set(tokens(title));
  let best = null, bs = 0;
  for (const p of ownProducts()) {
    const B = tokens(p.title); if (!B.length) continue;
    const s = B.filter((w) => A.has(w)).length / B.length;
    if (s > bs || (s === bs && best && hasCalc(best) && !hasCalc(p.id))) { bs = s; best = p.id; }
  }
  return bs >= 0.5 ? best : null;
}
/** File picker that reads the table and opens the import with the right mode (spec / prices / ready). */
function importFileInput(want, product = null) {
  const file = h("input", { type: "file", accept: ".xlsx,.xls,.csv,.txt", onchange: async () => {
    const f = file.files[0]; if (!f) return;
    try { toast("Читаю файл…"); const r = await api("/api/import", { method: "POST", headers: { "X-Filename": encodeURIComponent(f.name) }, body: f });
      startImport(r, want, product); } catch (e) { toast(e.message); } } });
  return file;
}
function startImport(r, want, product) {
  const sh = Math.max(0, r.sheets.findIndex((s) => s.rows.length > 1));
  const rows = r.sheets[sh]?.rows || [], spec = parseSpec(rows), g = guessHeader(rows);
  const mode = spec ? "spec" : want === "spec" ? "bom" : want || "prices";
  const guess = product || (spec ? guessProduct(spec.title) : null);
  importState = { name: r.name, sheets: r.sheets, sheet: sh, ...g, mode, spec, cur: "UAH", addNew: mode !== "prices", updPrices: false, updRates: false, preview: null,
    product: guess || ownProduct || ownProducts()[0]?.id, guessed: !!guess };
  if (mode === "spec" || mode === "prices" || mode === "ready") importState.preview = importPreview(importState);
  ownTab = "import"; renderOwn();
}
function ownImport(box) {
  const S2 = importState;
  box.append(h("div", { class: "card" }, h("h2", {}, "Імпорт з Excel"),
    h("p", { class: "hint" }, "Калькуляція виробу з 1С (матеріали й години), файл складу з цінами матеріалів або готові ціни позицій КП. .xlsx, .xls (через LibreOffice) або .csv. Перед застосуванням видно, що зміниться, які ціни без змін і що не розпізнано; кожен імпорт можна відкотити в «Журнал і відкат»."),
    h("div", { class: "inline" }, importFileInput(S2?.mode || "prices"), S2 ? h("span", {}, "Файл: ", h("b", {}, S2.name)) : null)));
  if (!S2) return;
  const sheet = S2.sheets[S2.sheet] || { rows: [] };
  const head = sheet.rows[S2.headerRow] || [];
  const reprev = () => { S2.preview = S2.mode === "bom" ? null : importPreview(S2); renderOwn(); };
  const colSel = (k) => h("label", {}, COL_T[k], h("select", { onchange: (e) => { if (e.target.value === "") delete S2.map[k]; else S2.map[k] = Number(e.target.value); reprev(); } },
    h("option", { value: "" }, "—"), head.map((c, i) => h("option", { value: i, selected: S2.map[k] === i }, `${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ""}: ${String(c).slice(0, 30)}`))));
  const modeSel = h("label", {}, "Що це за файл", h("select", { onchange: (e) => { S2.mode = e.target.value; if (S2.mode === "spec" && !S2.spec) S2.spec = parseSpec(sheet.rows); reprev(); } },
    [["spec", "Калькуляція виробу з 1С (матеріали + години)"], ["prices", "Ціни матеріалів (склад)"], ["ready", "Готові ціни позицій КП"], ["bom", "Склад виробу: матеріали + кількість"]]
      .filter(([v]) => v !== "spec" || parseSpec(sheet.rows)).map(([v, t]) => h("option", { value: v, selected: S2.mode === v }, t))));
  const prodSel = h("label", {}, "Виріб", h("select", { onchange: (e) => { S2.product = e.target.value; S2.guessed = true; reprev(); } }, prodOptions(S2.product)));
  box.append(h("div", { class: "sec-card" }, h("div", { class: "lay-cols" },
    h("label", {}, "Аркуш", h("select", { onchange: (e) => { S2.sheet = Number(e.target.value); Object.assign(S2, guessHeader(S2.sheets[S2.sheet].rows)); S2.spec = parseSpec(S2.sheets[S2.sheet].rows); reprev(); } },
      S2.sheets.map((s, i) => h("option", { value: i, selected: S2.sheet === i }, `${s.name} (${s.rows.length} рядків)`)))),
    modeSel, S2.mode === "spec" || S2.mode === "bom" ? prodSel : null,
    ...(S2.mode === "spec" ? [] : [h("label", {}, "Рядок заголовків", h("input", { type: "number", min: 1, value: S2.headerRow + 1, onchange: (e) => { S2.headerRow = Math.max(0, (num(e.target.value) || 1) - 1); reprev(); } })),
      ...Object.keys(COLS).filter((k) => S2.mode === "bom" || k !== "qty").map(colSel),
      h("label", {}, "Валюта, якщо немає колонки", h("select", { onchange: (e) => { S2.cur = e.target.value; reprev(); } }, h("option", { value: "UAH", selected: S2.cur === "UAH" }, "₴ гривня"), h("option", { value: "EUR", selected: S2.cur === "EUR" }, "€ євро")))])),
    S2.mode === "spec" ? h("div", {}, h("p", { class: "hint", style: "margin:6px 0" }, `У файлі: «${S2.spec.title || "без назви"}», матеріалів ${S2.spec.mats.length}, робіт ${S2.spec.works.length}.`,
        S2.guessed ? "" : h("b", { class: "minus" }, " Виріб за назвою не визначено — оберіть його вище.")),
      h("label", { class: "chk" }, h("input", { type: "checkbox", checked: S2.updPrices, onchange: (e) => { S2.updPrices = e.target.checked; renderOwn(); } }), "Ціни матеріалів, що вже є в довіднику, замінити цінами з цього файлу (інакше лишаються ціни довідника)"),
      h("label", { class: "chk" }, h("input", { type: "checkbox", checked: S2.updRates, onchange: (e) => { S2.updRates = e.target.checked; renderOwn(); } }), "Розцінки робіт, що вже є, замінити розцінками з файлу (інакше лишаються розцінки з налаштувань)"))
      : S2.mode === "prices" ? h("label", { class: "chk" }, h("input", { type: "checkbox", checked: S2.addNew, onchange: (e) => { S2.addNew = e.target.checked; renderOwn(); } }), "Нерозпізнані позиції додати в довідник як нові")
      : null,
    S2.mode === "bom" ? h("div", { class: "inline" }, h("button", { class: "primary", onclick: () => { if (S2.map.name == null && S2.map.code == null) return toast("Оберіть колонку з назвою або кодом"); S2.preview = importPreview(S2); renderOwn(); } }, "Переглянути зміни")) : null));
  if (S2.preview) importPreviewView(box, S2);
}
function importPreview(S2) {
  const list = M().list;
  const byCode = new Map(list.filter((m) => m.code).map((m) => [normCode(m.code), m]));
  const byName = new Map(list.map((m) => [normName(m.name), m]));
  const find = (code, name) => (code && byCode.get(normCode(code))) || (name && byName.get(normName(name))) || null;
  if (S2.mode === "spec") {
    const subs = specByName(), byWork = new Map(admin.labour.map((w) => [normName(w.name), w]));
    const rows = S2.spec.mats.map((r) => {
      const m = find("", r.name), sid = subs.get(normName(r.name));
      const st = sid && sid !== S2.product ? "sub" : !m ? "new" : r.price == null || num(m.price) === r.price ? "same" : "diff";
      return { ...r, m, sid, st, t: "mat" };
    });
    const works = S2.spec.works.map((r) => { const w = byWork.get(normName(r.name)); return { ...r, w, t: "work", st: !w ? "new" : num(w.rate) === r.price || r.price == null ? "same" : "diff" }; });
    return { rows: [...rows, ...works] };
  }
  const rows = S2.sheets[S2.sheet].rows.slice(S2.headerRow + 1);
  const out = [], seen = new Set();
  const positions = S2.mode === "ready" ? pricedPositions().filter((p) => p.kind !== "bundles") : [];
  for (const r of rows) {
    const g = (k) => (S2.map[k] == null ? "" : r[S2.map[k]]);
    const code = String(g("code") ?? "").trim(), name = String(g("name") ?? "").trim();
    if (!code && !name) continue;
    const price = parsePrice(g("price")), cur = S2.map.cur != null ? curOf(g("cur")) : S2.cur;
    const m = find(code, name);
    if (S2.mode === "ready") {
      let best = null, bs = 0;
      for (const p of positions) { const sc = Math.max(nameScore(name, p.title), p.it ? nameScore(name, productTitle(p.it)) : 0); if (sc > bs) { bs = sc; best = p; } }
      out.push({ name, price, cur, m, target: bs >= 0.6 ? best.kind + ":" + best.id : "", score: bs });
      continue;
    }
    if (m) seen.add(m.id);
    const st = !m ? "new" : price == null ? "noprice" : (num(m.price) === price && (m.cur || "UAH") === cur) ? "same" : "changed";
    out.push({ code, name: name || m?.name || code, unit: String(g("unit") ?? "").trim(), group: String(g("group") ?? "").trim(), price, cur, qty: parsePrice(g("qty")), m, st });
  }
  if (S2.mode === "ready") {   // a position takes only its best row: «BMF 750 (Wireles)» does not overwrite «BMF 750»
    const best = new Map();
    for (const r of out) if (r.target && (!best.has(r.target) || best.get(r.target).score < r.score)) best.set(r.target, r);
    for (const r of out) if (r.target && best.get(r.target) !== r) r.target = "";
  }
  return { rows: out, missing: S2.mode === "prices" ? list.filter((m) => !seen.has(m.id)) : [] };
}
let impFilter = "";
function readyStatus(r) {
  if (!r.target) return !r.m ? "new" : num(r.m.price) === r.price ? "same" : "mat";
  const [kind, id] = r.target.split(":"), p = pricedPositions().find((x) => x.kind === kind && x.id === id);
  return kpPrice(kind, id, p?.rule) === r.price ? "same" : "changed";
}
function importPreviewView(box, S2) {
  const P = S2.preview;
  if (S2.mode === "spec") return specPreviewView(box, S2);
  if (S2.mode === "ready") P.rows.forEach((r) => (r.st = readyStatus(r)));
  const cnt = (s) => P.rows.filter((r) => r.st === s).length;
  const ST = { changed: ["змінилась", "chg"], same: ["без змін", "same"], new: [S2.mode === "prices" ? "немає в довіднику" : "не розпізнано", "new"], noprice: ["без ціни у файлі", "same"] };
  if (S2.mode === "ready") { delete ST.noprice; ST.mat = ["ціна матеріалу", "chg"]; }
  const shown = P.rows.filter((r) => !impFilter || r.st === impFilter);
  const posList = pricedPositions().filter((p) => p.kind !== "bundles");
  const tbody = h("tbody");
  for (const r of shown.slice(0, 500)) {
    if (S2.mode === "ready") {
      const [kind, id] = (r.target || ":").split(":"), pos = posList.find((x) => x.kind === kind && x.id === id);
      tbody.append(h("tr", { class: "st-" + r.st }, h("td", {}, h("span", { class: "stl " + ST[r.st][1] }, ST[r.st][0])), h("td", {}, r.name),
        h("td", {}, h("select", { class: "sm", style: "max-width:260px", onchange: (e) => { r.target = e.target.value; renderOwn(); } }, h("option", { value: "" }, "— не оновлювати позицію —"),
          posList.map((x) => h("option", { value: x.kind + ":" + x.id, selected: r.target === x.kind + ":" + x.id }, (x.it ? productTitle(x.it) : x.title) + (x.kind === "accessories" ? " (опція)" : "")))),
          r.m ? h("small", { style: "display:block" }, r.target ? "і ціна в довіднику матеріалів" : "оновиться ціна в довіднику матеріалів") : null),
        h("td", { class: "num" }, pos ? uah(kpPrice(kind, id, pos.rule)) : "—"), h("td", { class: "num" }, h("b", {}, uah(r.price)))));
      continue;
    }
    tbody.append(h("tr", { class: "st-" + r.st }, h("td", {}, h("span", { class: "stl " + ST[r.st][1] }, ST[r.st][0])), h("td", {}, r.code), h("td", {}, r.name),
      h("td", {}, r.m ? r.m.name : S2.addNew || S2.mode === "bom" ? h("small", {}, "буде додано в довідник") : h("small", { class: "minus" }, "не додається")),
      h("td", { class: "num" }, r.m && r.m.price != null ? `${fmtN(r.m.price)} ${curSign(r.m.cur)}` : "—"),
      h("td", { class: "num" }, r.price != null ? h("b", {}, `${fmtN(r.price)} ${curSign(r.cur)}`) : "—"),
      h("td", { class: "num" }, S2.mode === "bom" ? fmtN(r.qty) : "")));
  }
  const heads = S2.mode === "ready" ? ["Стан", "Назва у файлі", "Позиція КП", "У КП зараз", "Ціна з файлу"] : ["Стан", "Код", "Назва у файлі", "У довіднику", "Було", "Стане", S2.mode === "bom" ? "К-сть" : ""];
  box.append(h("div", { class: "sec-card" }, h("div", { class: "head" }, h("h2", {}, "Перегляд", h("small", {}, `${P.rows.length} рядків у файлі`)),
    h("div", { class: "seg" }, h("button", { class: impFilter ? "" : "on", onclick: () => { impFilter = ""; renderOwn(); } }, "усі"),
      Object.entries(ST).map(([k, [t]]) => h("button", { class: impFilter === k ? "on" : "", onclick: () => { impFilter = k; renderOwn(); } }, `${t}: ${cnt(k)}`)))),
    h("div", { class: "tbl-wrap" }, h("table", { class: "prices imp" }, h("thead", {}, h("tr", {}, heads.map((t, i) => h("th", { class: (S2.mode === "ready" ? i >= 3 : i >= 4) ? "num" : "" }, t)))), tbody)),
    P.missing.length ? h("p", { class: "hint" }, `У довіднику є ще ${P.missing.length} позицій, яких немає у файлі: їхні ціни не зміняться.`) : null,
    S2.mode === "ready" ? h("p", { class: "hint" }, "Ціна з файлу стає ціною позиції вручну (без націнки); кран з ціною в € переходить на ціну в ₴. Далі на сторінці результату оберете для кожної: поставити в КП чи ні.") : null,
    h("div", { class: "inline" }, h("button", { class: "primary", onclick: () => applyImport(S2) },
      S2.mode === "bom" ? "Застосувати: склад виробу" : S2.mode === "ready" ? `Застосувати (позицій КП: ${cnt("changed")}, матеріалів: ${P.rows.filter((r) => r.m && num(r.m.price) !== r.price).length})` : `Застосувати зміни (${cnt("changed")}${S2.addNew ? ` + нових ${cnt("new")}` : ""})`),
      h("button", { onclick: () => { importState = null; renderOwn(); } }, "Скасувати"))));
}
function specPreviewView(box, S2) {
  const P = S2.preview, p = prodById(S2.product);
  const ST = { same: ["є в довіднику", "same"], diff: ["ціна інша", "chg"], new: ["новий", "new"], sub: ["вузол", "same"] };
  const tb = h("tbody");
  let sumFile = 0;
  for (const r of P.rows) {
    const now = r.t === "work" ? (r.w ? num(r.w.rate) : null) : r.sid ? bomCost(r.sid)?.total : r.m ? matUah(r.m) : null;
    const used = r.st === "new" || (r.st === "diff" && (r.t === "work" ? S2.updRates : S2.updPrices)) ? r.price : now ?? r.price;
    sumFile += (used ?? 0) * (r.qty ?? 0);
    tb.append(h("tr", { class: "st-" + r.st }, h("td", {}, h("span", { class: "stl " + ST[r.st][1] }, r.t === "work" ? { same: "розцінка є", diff: "розцінка інша", new: "нова робота" }[r.st] : ST[r.st][0])),
      h("td", {}, r.name, r.sid ? h("small", { style: "display:block" }, "ціна з калькуляції «" + productTitle(prodById(r.sid)) + "»") : null),
      h("td", { class: "num" }, fmtN(r.qty), r.t === "work" ? " год" : r.unit ? " " + r.unit : ""), h("td", { class: "num" }, r.price == null ? "—" : fmtN(r.price)),
      h("td", { class: "num" }, now == null ? "—" : fmtN(Math.round(now * 100) / 100)), h("td", { class: "num" }, uah(Math.round((used ?? 0) * (r.qty ?? 0))))));
  }
  const old = bomCost(S2.product);
  box.append(h("div", { class: "sec-card" }, h("div", { class: "head" }, h("h2", {}, `Калькуляція → ${productTitle(p)}`, h("small", {}, `${P.rows.length} рядків`))),
    h("div", { class: "tbl-wrap" }, h("table", { class: "prices imp" }, h("thead", {}, h("tr", {}, ["Стан", "Назва", "К-сть", "Ціна у файлі", "Зараз у налаштуваннях", "Сума"].map((t, i) => h("th", { class: i >= 2 ? "num" : "" }, t)))), tb)),
    h("p", {}, "Собівартість з цією калькуляцією: ", h("b", {}, uah(Math.round(sumFile))), old ? ` (зараз ${uah(Math.round(old.total))})` : "",
      admin.bom[S2.product]?.rows?.length ? h("small", { class: "minus" }, " — поточна калькуляція виробу буде замінена") : null),
    h("div", { class: "inline" }, h("button", { class: "primary", onclick: () => applySpec(S2) }, "Застосувати калькуляцію"), h("button", { onclick: () => { importState = null; renderOwn(); } }, "Скасувати"))));
}
function applySpec(S2) {
  snapResult(`калькуляція «${S2.spec.title || S2.name}» → ${productTitle(prodById(S2.product))}`, () => {
    const list = M().list, changes = [], rows = [];
    for (const r of S2.preview.rows) {
      if (r.t === "work") {
        let w = r.w;
        if (!w) { w = { id: newWorkId(), name: r.name, rate: r.price }; admin.labour.push(w); changes.push({ id: w.id, kind: "work", name: w.name, old: null, new: { price: w.rate } }); }
        else if (S2.updRates && r.st === "diff") { changes.push({ id: w.id, kind: "work", name: w.name, old: { price: w.rate }, new: { price: r.price } }); w.rate = r.price; }
        rows.push({ work: w.id, qty: r.qty ?? 0 });
        continue;
      }
      let m = r.m;
      if (!m) { m = { id: newMatId(), code: "", name: r.name, unit: r.unit || "шт", group: /^готовий виріб/i.test(r.name) ? "Вузли" : "", price: r.price, cur: "UAH" }; list.push(m); changes.push({ id: m.id, name: m.name, old: null, new: { price: m.price, cur: "UAH" } }); }
      else if (S2.updPrices && r.st === "diff") { changes.push({ id: m.id, name: m.name, old: { price: m.price, cur: m.cur }, new: { price: r.price, cur: "UAH" } }); m.price = r.price; m.cur = "UAH"; }
      rows.push({ mat: m.id, qty: r.qty ?? 0 });
    }
    const old = structuredClone(admin.bom[S2.product] || { rows: [], coef: 1, extra: 0 });
    admin.bom[S2.product] = { coef: old.coef ?? 1, extra: old.extra ?? 0, rows, title: S2.spec.title, file: S2.name, at: nowStr() };
    logChange(`калькуляція «${S2.name}» → ${productTitle(prodById(S2.product))}`, changes, [{ product: S2.product, old, new: structuredClone(admin.bom[S2.product]) }]);
  });
  ownProduct = S2.product; importState = null;
  if (ownTab !== "result") { ownTab = "bom"; renderOwn(); }
  toast("Калькуляцію застосовано");
}
function applyImport(S2) {
  const P = S2.preview;
  if (S2.mode === "ready") return applyReady(S2);
  const note = `імпорт «${S2.name}»` + (S2.mode === "bom" ? ` → склад: ${productTitle(prodById(S2.product))}` : "");
  let nCh = 0, nNew = 0;
  snapResult(note, () => {
    const list = M().list, changes = [], ids = new Map();
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
      admin.bom[S2.product] = { ...old, rows: P.rows.filter((r) => ids.get(r)).map((r) => ({ mat: ids.get(r), qty: r.qty ?? 1 })), file: S2.name, at: nowStr() };
      delete admin.bom[S2.product].ref;
      bom.push({ product: S2.product, old, new: structuredClone(admin.bom[S2.product]) });
    }
    nCh = changes.filter((c) => c.old).length; nNew = changes.length - nCh;
    logChange(note, changes, bom);
  });
  if (S2.mode === "bom") { ownProduct = S2.product; if (ownTab !== "result") ownTab = "bom"; }
  else if (ownTab !== "result") ownTab = "log";
  importState = null; renderOwn();
  toast(`Імпорт застосовано: змін цін ${nCh}, нових ${nNew}`);
}
/** Ready final prices (гот): the position's price by hand = the file price, then the result page decides what goes into the KP. */
function applyReady(S2) {
  const rows = S2.preview.rows.filter((r) => r.target && r.price != null), res = [], note = `готові ціни «${S2.name}»`;
  snapResult(note, () => {
    const recs = [], changes = [];
    for (const r of S2.preview.rows.filter((x) => x.m && x.price != null && num(x.m.price) !== x.price)) {
      changes.push({ id: r.m.id, name: r.m.name, old: { price: r.m.price, cur: r.m.cur }, new: { price: r.price, cur: "UAH" } }); r.m.price = r.price; r.m.cur = "UAH";
    }
    for (const r of rows) {
      const [kind, id] = r.target.split(":"), pos = pricedPositions().find((x) => x.kind === kind && x.id === id);
      const inKp = kpPrice(kind, id, pos?.rule);
      const old = structuredClone(admin.prices[kind][id] ?? null);
      const R = (admin.prices[kind][id] = { ...(old || {}), base: r.price });
      delete R.mode; delete R.markup; delete R.final; delete R.eur;
      recs.push({ kind, id, old, new: structuredClone(R) });
      if (inKp !== r.price) res.push({ kind, id, title: pos?.it ? productTitle(pos.it) : pos?.title || id, oldCost: null, newCost: null, calc: r.price, inKp, pick: "auto", manual: null, ready: true });
    }
    logChange(note, changes, [], recs);
  });
  if (res.length) { const R0 = admin.calc_result; admin.calc_result = { at: nowStr(), note, rows: [...res, ...(R0?.note === note ? R0.rows.filter((x) => !res.some((y) => y.id === x.id)) : [])], bundles: [] }; ownTab = "result"; saveAdmin(true, note); }
  importState = null; renderOwn();
  toast(`Оновлено позицій: ${rows.length}; нових цін для КП: ${res.length}`);
}
function ownLog(box) {
  const log = M().log;
  if (!log.length) { box.append(h("p", { class: "hint" }, "Змін ще не було.")); return; }
  for (const e of log) {
    const n = e.changes.length + (e.bom || []).length + (e.prices || []).length;
    box.append(h("div", { class: "ver" + (e.undone ? " off" : "") }, h("b", {}, e.at), h("span", { class: "n" }, e.note, h("small", {}, ` · змін: ${n}`)),
      h("details", { class: "pinfo" }, h("summary", {}, "деталі"), h("ul", {}, e.changes.slice(0, 200).map((c) => h("li", {}, (c.kind === "work" ? "робота " : "") + c.name + ": ",
        c.old ? `${c.old.price ?? "—"} ${c.kind === "work" ? "₴/год" : curSign(c.old.cur)}` : "новий", " → ", c.new ? `${c.new.price ?? "—"} ${c.kind === "work" ? "₴/год" : curSign(c.new.cur)}` : "видалено")),
        (e.bom || []).map((b) => h("li", {}, `калькуляція «${productTitle(prodById(b.product))}»: ${b.old.rows?.length ?? 0} → ${b.new.rows?.length ?? 0} рядків`)),
        (e.prices || []).map((p) => h("li", {}, `спосіб ціни: ${p.kind === "bundles" ? bundleTitle(rawBundle(p.id) || { id: p.id }) : productTitle(prodById(p.id)) || p.id}`)))),
      e.undone ? h("span", { class: "badge gray" }, "відкочено") : h("button", { class: "sm", onclick: () => confirmBox(`Відкотити «${e.note}»? Ціни повернуться до попередніх.`, "Відкотити", () => undoLog(e)) }, "↶ Відкотити")));
  }
}
function undoLog(e) {
  const back = [];
  snapResult("відкат: " + e.note, () => {
    for (const c of [...e.changes].reverse()) {
      const L = c.kind === "work" ? admin.labour : M().list, m = L.find((x) => x.id === c.id);
      const setL = (v) => { if (c.kind === "work") admin.labour = v; else M().list = v; };
      if (!c.old) { if (m && !(c.kind === "work" ? workUsedIn(m.id) : usedIn(m.id)).length) { setL(L.filter((x) => x !== m)); back.push({ id: c.id, kind: c.kind, name: c.name, old: { price: c.kind === "work" ? m.rate : m.price, cur: m.cur }, new: null }); } continue; }
      if (!c.new) { if (!m && c.old.row) { L.push(c.old.row); back.push({ id: c.id, kind: c.kind, name: c.name, old: null, new: { price: c.old.price, cur: c.old.cur } }); } continue; }
      if (!m) continue;
      if (c.kind === "work") { back.push({ id: m.id, kind: "work", name: m.name, old: { price: m.rate }, new: { price: c.old.price } }); m.rate = c.old.price; }
      else { back.push({ id: m.id, name: m.name, old: { price: m.price, cur: m.cur }, new: { ...c.old } }); m.price = c.old.price; m.cur = c.old.cur; }
    }
    const bom = [], prices = [];
    for (const b of e.bom || []) { bom.push({ product: b.product, old: structuredClone(admin.bom[b.product] || { rows: [] }), new: structuredClone(b.old) }); admin.bom[b.product] = structuredClone(b.old); }
    for (const p of e.prices || []) {
      prices.push({ kind: p.kind, id: p.id, old: structuredClone(admin.prices[p.kind][p.id] ?? null), new: structuredClone(p.old) });
      if (p.old == null) delete admin.prices[p.kind][p.id]; else admin.prices[p.kind][p.id] = structuredClone(p.old);
    }
    e.undone = true;
    logChange("відкат: " + e.note, back, bom, prices);
  });
  toast("Відкочено");
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

// ------------------------------------------------------------------ page editor («Редактор КП»): page images, editable zones, changes by scope
// Each page is a PNG from the server (/api/pages); zones say where positions, texts and photos are. A change goes into this KP's
// edits (S.edits) at once and the pages are rebuilt; on saving, each change can also go into the style template or the base KP.
const ED = { meta: null, key: "cover", sel: null, seq: 0, busy: false, thumbs: {}, gallery: null, spec: null, timer: null };
const edits = () => (S.edits ??= EMPTY_EDITS());
const edStyle = () => $("#styleChips").dataset.v || admin.style || "dark";
const edStyleInfo = () => B.styles.find((s) => s.id === edStyle());
function edMeta() {
  return { number: $("#kpNumber").value || "0001", client: { name: $("#client").value.trim(), contact: $("#clientContact").value.trim() },
    show_client: $("#clientShow").checked, ...offerMeta($("#offerAcc").checked, !!$("#offerPrices").value, S.kt.id), edits: S.edits, base: S.basePreset };
}
function edCount() { return Object.keys(S.editLog || {}).length; }
function editorBadge() {
  const b = $("#editPages"); if (!b) return;
  const n = edCount();
  b.textContent = n ? `Редагувати сторінки (змін: ${n})` : "Редагувати сторінки";
}
async function openEditor() {
  renderQuote();
  if (!lastQuote) return toast("Спершу оберіть комплект");
  if (edStyleInfo()?.engine === "d6") return toast("Редактор сторінок працює зі стилями KP_2_v3 (темний і світлі) та Ultra. Оберіть один із них у картці «КП».");
  tab("edit");
}
function edStatus(text, cls = "") { const el = $("#edStatus"); if (el) { el.className = "ed-status " + cls; el.textContent = text; } }
function refreshPages(now = false) {
  clearTimeout(ED.timer);
  ED.timer = setTimeout(() => loadPages(), now ? 0 : 700);
  edStatus("Оновлюю сторінки…", "busy");
}
async function loadPages() {
  const seq = ++ED.seq;
  renderQuote();
  if (!lastQuote) { edStatus("Комплект не зібрано: поверніться до конфігуратора", "err"); return; }
  let spec;
  try { spec = specFrom(lastQuote, edMeta(), edStyle()); } catch (e) { edStatus((e.errors || [String(e)])[0], "err"); return; }
  edStatus("Оновлюю сторінки… (перший раз — до пів хвилини)", "busy");
  try {
    const r = await api("/api/pages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spec }) });
    if (seq !== ED.seq) return;
    ED.meta = r; ED.spec = spec;
    for (const p of r.pages) ED.thumbs[p.key] = p.png;
    if (!r.pages.some((p) => p.key === ED.key)) ED.key = r.pages[0]?.key;
    edStatus(`Сторінок: ${r.pages.length}` + (edCount() ? ` · змін: ${edCount()}` : ""));
    renderEditor();
  } catch (e) { if (seq === ED.seq) edStatus("Не вдалося оновити сторінки: " + e.message, "err"); }
}
/** Remembers a change for the save dialog: what it is and where else it may go (style template, base KP). */
function edLog(key, label, can = { tpl: true, base: true }) {
  const old = S.editLog[key];
  S.editLog[key] = { label, can, tpl: old?.tpl || false, base: old?.base || false };
  editorBadge();
}
function edDrop(key) { delete S.editLog[key]; editorBadge(); }

function renderEditor() {
  const thumbs = $("#edThumbs"), page = $("#edPage"), side = $("#edSide");
  $("#edTitle").textContent = lastQuote ? `КП № ${$("#kpNumber").value || "—"} · ${ED.spec?.title || ""} · ${edStyleInfo()?.title || edStyle()}` : "";
  if (!ED.meta) { thumbs.innerHTML = ""; page.innerHTML = ""; side.innerHTML = ""; if (!ED.timer) refreshPages(true); return; }
  // left: pages with a switch each (the cover stays); switched-off pages stay in the list, dimmed
  thumbs.innerHTML = "";
  const list = [...ED.meta.pages.map((p, i) => ({ ...p, no: i + 1, on: true })), ...(ED.meta.hidden || []).map((p) => ({ ...p, on: false, png: ED.thumbs[p.key] }))];
  for (const p of list) {
    const sw = h("input", { type: "checkbox", checked: p.on, disabled: p.key === "cover", title: p.key === "cover" ? "титулка є завжди" : "сторінка в КП",
      onclick: (e) => e.stopPropagation(), onchange: (e) => setPage(p, e.target.checked) });
    thumbs.append(h("div", { class: "ed-thumb" + (p.key === ED.key && p.on ? " on" : "") + (p.on ? "" : " off"), onclick: () => { if (p.on) { ED.key = p.key; ED.sel = null; renderEditor(); } } },
      p.png ? h("img", { src: p.png, alt: p.title }) : h("div", { class: "ph" }, p.title),
      h("div", { class: "cap" }, h("label", { class: "chk" }, sw, h("span", {}, p.on ? `${String(p.no).padStart(2, "0")} · ${p.title}` : `${p.title} — вимкнено`)))));
  }
  const P = ED.meta.pages.find((p) => p.key === ED.key) || ED.meta.pages[0];
  // centre: the page and its zones
  page.innerHTML = "";
  const img = h("img", { src: P.png, alt: P.title, draggable: "false" });
  const over = h("div", { class: "ed-over" });
  const zs = [...P.zones].sort((a, b) => (b.full ? 1 : 0) - (a.full ? 1 : 0) || b.box[2] * b.box[3] - a.box[2] * a.box[3]);
  for (const z of zs) {
    if (z.kind === "add") continue;
    const target = z.row || z.id;
    over.append(h("div", { class: `zone k-${z.kind}` + (z.full ? " full" : "") + (ED.sel === target ? " sel" : ""), "data-z": target,
      style: `left:${z.box[0] * 100}%;top:${z.box[1] * 100}%;width:${z.box[2] * 100}%;height:${z.box[3] * 100}%`,
      title: z.kind === "text" ? z.text.slice(0, 80) : z.kind === "pic" ? "фото" : "позиція",
      onclick: (e) => { e.stopPropagation(); ED.sel = target; renderEditor(); },
      onmouseenter: () => hl(target, true), onmouseleave: () => hl(target, false) }));
  }
  page.append(h("div", { class: "ed-sheet" }, img, over));
  side.innerHTML = "";
  const place = () => layoutSide(P, img, side);
  if (img.complete) place(); else img.onload = place;
}
function hl(id, on) { $$(`[data-z="${CSS.escape(id)}"]`).forEach((el) => el.classList.toggle("hot", on)); }

/** Right column: a field level with each zone (pushed down when the one above is taller). */
function layoutSide(P, img, side) {
  const H = img.clientHeight, E = mergeEdits(...layersOf(edStyle(), ED.spec.kit_type, S.basePreset, S.edits));
  const fields = [];
  for (const z of P.zones) {
    if (z.kind === "row" || z.kind === "tile") fields.push([z, rowCard(z, P)]);
    else if (z.kind === "add") fields.push([z, addCard(z)]);
    else if (z.row) continue;
    else if (z.kind === "text" && (z.pt >= 12 || z.text.length >= 40 || z.edited || ED.sel === z.id)) fields.push([z, textCard(z, P)]);
    else if (z.kind === "pic" && (z.hero || ED.sel === z.id || (!z.full && z.box[2] * z.box[3] >= 0.06))) fields.push([z, picCard(z, P)]);
  }
  fields.sort((a, b) => a[0].box[1] - b[0].box[1]);
  let y = 0;
  for (const [z, el] of fields) {
    const target = z.row || z.id;
    el.dataset.z = target; el.classList.add("ed-field");
    if (ED.sel === target) el.classList.add("sel");
    el.onmouseenter = () => hl(target, true); el.onmouseleave = () => hl(target, false);
    el.onclick = (e) => {
      if (ED.sel === target) return;
      ED.sel = target;
      // a position card opens (description, variant, photo) on a click outside its fields; a field click only marks it
      if ((z.kind === "row" || z.kind === "tile") && !/^(INPUT|SELECT|TEXTAREA|BUTTON|OPTION)$/.test(e.target.tagName)) return renderEditor();
      $$(".zone.sel, .ed-field.sel").forEach((x) => x.classList.remove("sel")); $$(`[data-z="${CSS.escape(target)}"]`).forEach((x) => x.classList.add("sel"));
    };
    side.append(el);
    const top = Math.max(y, Math.round(z.box[1] * H) - 4);
    el.style.top = top + "px";
    y = top + el.offsetHeight + 6;
  }
  const gone = Object.entries(E.shapes).filter(([, e]) => (e.page === P.key || e.page === "*") && e.hide);
  if (gone.length) {
    const el = h("div", { class: "ed-field ed-gone" }, h("b", {}, "Сховано на цій сторінці"),
      gone.map(([k, e]) => h("div", { class: "row" }, h("span", {}, e.label || (e.was.startsWith("pic:") ? "фото" : e.was.slice(0, 40))),
        h("button", { class: "sm", onclick: () => { setShape(e.page, { sid: e.sid, was: e.was }, null, e.label); } }, "Повернути"))));
    side.append(el); el.style.top = y + "px"; y += el.offsetHeight + 6;
  }
  side.style.minHeight = Math.max(H, y) + "px";
}
function scopeBox(key) {
  const L = S.editLog[key]; if (!L) return null;
  const chk = (f, label) => L.can[f] ? h("label", { class: "chk" }, h("input", { type: "checkbox", checked: L[f], onchange: (e) => { L[f] = e.target.checked; } }), label) : null;
  return h("div", { class: "scope" }, h("small", {}, "Ця КП ✓ · також:"), chk("tpl", "у шаблон стилю"), chk("base", S.basePreset ? "у базову КП" : "у нову базову КП"));
}

// ---- texts, photos, elements of a page (matched by their original text / picture: spec.edit.shapes)
const shapeKey = (page, was) => `${page}|${was}`;
function setShape(page, z, patch, label) {
  const k = shapeKey(page, z.was), E = edits();
  if (!patch) delete E.shapes[k]; else E.shapes[k] = { page, sid: z.sid, was: z.was, label, ...patch };
  if (!patch) edDrop("shape:" + k); else edLog("shape:" + k, label);
  refreshPages();
}
function textCard(z, P) {
  // a text that is on several pages (the KP title in the headers) changes on all of them unless unticked
  const pagesWith = ED.meta.pages.filter((p) => p.zones.some((x) => x.was === z.was)).length;
  const allKey = shapeKey("*", z.was), every = pagesWith > 1 && (S.edits?.shapes?.[allKey] || !S.edits?.shapes?.[shapeKey(P.key, z.was)]);
  const pg = every ? "*" : P.key;
  const k = shapeKey(pg, z.was), e = S.edits?.shapes?.[k];
  const orig = z.was.startsWith("hl:") ? z.was.slice(3) : z.was;   // Ultra headlines are pictures: their text is in the id
  const short = orig.replace(/\s+/g, " ").slice(0, 34) + (orig.length > 34 ? "…" : "");
  const multi = z.text.includes("\n") || z.text.length > 50;
  const inp = h(multi ? "textarea" : "input", { value: z.text, rows: multi ? Math.min(6, Math.max(2, Math.ceil(z.text.length / 46) + z.text.split("\n").length - 1)) : null,
    onchange: (ev) => {
      const v = ev.target.value;
      if (pg === "*") delete edits().shapes[shapeKey(P.key, z.was)];
      if (v === orig) setShape(pg, z, null); else setShape(pg, z, { text: v }, `Напис «${short}» → «${v.replace(/\s+/g, " ").slice(0, 40)}»` + (pg === "*" ? " (усі сторінки)" : ""));
    } });
  const allBox = pagesWith > 1 ? h("label", { class: "chk all-p" }, h("input", { type: "checkbox", checked: every, onchange: (ev) => {
    const E = edits(), from = shapeKey(ev.target.checked ? P.key : "*", z.was), to = shapeKey(ev.target.checked ? "*" : P.key, z.was);
    if (E.shapes[from]) {
      E.shapes[to] = { ...E.shapes[from], page: ev.target.checked ? "*" : P.key }; delete E.shapes[from];
      S.editLog["shape:" + to] = S.editLog["shape:" + from]; delete S.editLog["shape:" + from];
      refreshPages();
    } else if (!ev.target.checked) { E.shapes[to] = { page: P.key, sid: z.sid, was: z.was, text: z.text, label: "" }; }
    renderEditor();
  } }), `на всіх сторінках, де є цей напис (${pagesWith})`) : null;
  return h("div", { class: "card-f" }, h("div", { class: "fh" }, h("small", {}, z.was.startsWith("hl:") ? "Заголовок" : "Напис"),
      e ? h("button", { class: "sm ghost", title: "як було", onclick: () => setShape(pg, z, null) }, "↺") : null,
      h("button", { class: "sm ghost", title: pg === "*" ? "прибрати з усіх сторінок" : "прибрати з цієї сторінки", onclick: () => setShape(pg, z, { hide: true }, `Сховати напис «${short}»` + (pg === "*" ? " (усі сторінки)" : "")) }, "Сховати")),
    inp, allBox, scopeBox("shape:" + k));
}
function gallerySelect(cur, onpick, firstLabel = "— як зараз —") {
  const groups = new Map();
  for (const g of ED.gallery || []) { if (!groups.has(g.group)) groups.set(g.group, []); groups.get(g.group).push(g.path); }
  const sel = h("select", { onchange: (e) => { if (e.target.value === "__up") return upload(); onpick(e.target.value || null); } },
    h("option", { value: "" }, firstLabel), h("option", { value: "__up" }, "⬆ Завантажити своє фото…"),
    [...groups].map(([g, ps]) => h("optgroup", { label: g }, ps.map((p) => h("option", { value: p }, p.split("/").pop())))));
  sel.value = cur || "";
  function upload() {
    const f = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", onchange: async () => {
      const file = f.files[0]; if (!file) return;
      try {
        const r = await api("/api/upload", { method: "POST", headers: { "X-Filename": encodeURIComponent(file.name) }, body: file });
        ED.gallery = [{ path: r.path, group: "Завантажені" }, ...(ED.gallery || [])];
        onpick(r.path);
      } catch (e) { toast(e.message); }
    } });
    f.click(); sel.value = cur || "";
  }
  return sel;
}
function picCard(z, P) {
  const thumb = (p) => p ? h("img", { class: "pv", src: asset(p), alt: "" }) : null;
  if (z.hero) {   // page photo: cropped and toned by the style, as in «Налаштування» → «Фото сторінок»
    const cur = S.edits?.heroes?.[z.hero]?.path;
    const k = "hero:" + z.hero;
    return h("div", { class: "card-f" }, h("div", { class: "fh" }, h("small", {}, z.full ? "Фото сторінки (фон)" : "Фото сторінки"),
        cur ? h("button", { class: "sm ghost", title: "як було", onclick: () => { delete edits().heroes[z.hero]; edDrop(k); refreshPages(); } }, "↺") : null),
      h("div", { class: "pic-row" }, thumb(cur), gallerySelect(cur, (p) => {
        if (!p) { delete edits().heroes[z.hero]; edDrop(k); } else { edits().heroes[z.hero] = { path: p, fx: 0.5, fy: 0.45 }; edLog(k, `Фото сторінки «${P.title}» → ${p.split("/").pop()}`); }
        refreshPages();
      })), scopeBox(k));
  }
  const k = shapeKey(P.key, z.was), cur = S.edits?.shapes?.[k]?.path;
  return h("div", { class: "card-f" }, h("div", { class: "fh" }, h("small", {}, "Фото"),
      cur ? h("button", { class: "sm ghost", onclick: () => setShape(P.key, z, null) }, "↺") : null,
      h("button", { class: "sm ghost", onclick: () => setShape(P.key, z, { hide: true }, `Сховати фото на сторінці «${P.title}»`) }, "Сховати")),
    h("div", { class: "pic-row" }, thumb(cur), gallerySelect(cur, (p) => p ? setShape(P.key, z, { path: p }, `Фото на сторінці «${P.title}» → ${p.split("/").pop()}`) : setShape(P.key, z, null))),
    scopeBox("shape:" + k));
}

// ---- pages on / off
function setPage(p, on) {
  const E = edits(), lower = mergeEdits(...layersOf(edStyle(), ED.spec.kit_type, S.basePreset, null)).pages[p.key];
  if (on && lower !== false) delete E.pages[p.key]; else E.pages[p.key] = on;
  const k = "page:" + p.key;
  if (E.pages[p.key] === undefined) edDrop(k); else edLog(k, `Сторінка «${p.title}»: ${on ? "увімкнено" : "вимкнено"}`);
  if (!on && ED.key === p.key) ED.key = "cover";
  refreshPages(true);
}

// ---- positions: rows of the price page, tiles of the configuration / kit page
function rowOf(z) {
  const rows = z.kind === "tile" ? ED.spec.config_rows || ED.spec.rows : ED.spec.rows;
  const sr = (z.item && rows.find((r) => r.item_id === z.item)) || rows[z.n];
  if (!sr) return null;
  const id = sr.item_id;
  if (sr.kind === "extra" || /^extra_\d+$/.test(id || "")) {
    const live = S.extras.map((x, i) => [x, i]).filter(([x]) => x.title?.trim());
    const i = live[Number(id.slice(6)) - 1]?.[1];
    return { sr, type: "extra", i, x: S.extras[i] };
  }
  if (sr.kind === "accessory") return { sr, type: "acc", acc: S.sel.accessories.find((a) => a.id === id), qr: lastQuote.accessories.find((a) => (a.item_id || a.id) === id) };
  const qr = id && lastQuote.rows.find((r) => r.item_id === id);
  if (!qr) return { sr, type: "fixed" };
  return { sr, type: "item", qr, slot: S.kt.slots.find((s) => s.id === qr.slot) };
}
function posChanged(label) {
  S.preset = null;
  edLog("pos:" + Date.now().toString(36), label, { tpl: false, base: true });
  renderQuote(); refreshPages(true);
}
function rowEdit(id, field, v, orig, label) {
  const E = edits(), r = { ...(E.rows[id] || {}) };
  if (v === orig || (field === "photo" && !v)) delete r[field]; else r[field] = v;
  if (Object.keys(r).length) E.rows[id] = r; else delete E.rows[id];
  const k = `row:${id}:${field}`;
  if (r[field] === undefined) edDrop(k); else edLog(k, label);
  refreshPages();
}
function rowCard(z, P) {
  const R = rowOf(z);
  if (!R) return h("div", { class: "card-f row-f" }, h("small", {}, "позиція"));
  const { sr } = R, open = ED.sel === z.id, tile = z.kind === "tile";
  const card = h("div", { class: "card-f row-f" + (open ? " open" : "") });
  const n = h("span", { class: "no" }, String(z.n + 1).padStart(2, "0"));
  if (R.type === "fixed") { card.append(h("div", { class: "line" }, n, h("span", { class: "t" }, sr.title), h("small", {}, "змінюється у виборі комплекту"))); return card; }
  if (R.type === "extra") {
    const x = R.x, upd = (patch, label) => { Object.assign(x, patch); posChanged(label); };
    card.append(h("div", { class: "line" }, n,
      h("input", { class: "t", value: x.title, onchange: (e) => upd({ title: e.target.value }, `Своя позиція: назва «${e.target.value}»`) }),
      h("input", { class: "p", type: "number", value: x.price_uah ?? "", placeholder: "ціна", onchange: (e) => upd({ price_uah: num(e.target.value) }, `Своя позиція «${x.title}»: ціна ${uah(num(e.target.value))}`) }),
      h("button", { class: "sm ghost", title: "прибрати з КП", onclick: () => { S.extras.splice(R.i, 1); posChanged(`Прибрано: ${x.title}`); } }, "✕")));
    if (open) card.append(h("textarea", { rows: 2, value: x.desc || "", placeholder: "опис", onchange: (e) => upd({ desc: e.target.value }, `Своя позиція «${x.title}»: опис`) }));
    return card;
  }
  const id = sr.item_id, orig = R.type === "acc" ? R.qr : R.qr;
  const ot = orig?.title ?? sr.title, od = orig?.desc ?? sr.desc;
  const E = S.edits?.rows?.[id] || {};
  const bundleIn = !R.acc && lastQuote.price_display === "bundle" && R.qr?.price_uah == null && R.qr?.price_text === "у комплекті";
  let price = null;
  if (R.type === "acc") price = h("input", { class: "p", type: "number", value: R.acc?.price_uah ?? "", placeholder: R.qr?.price_uah != null ? String(R.qr.price_uah) : "ціна",
    onchange: (e) => { S.sel = { ...S.sel, accessories: S.sel.accessories.map((a) => (a.id === id ? { ...a, price_uah: num(e.target.value) } : a)) }; posChanged(`Ціна «${ot}» у цій КП: ${uah(num(e.target.value))}`); } });
  else if (!bundleIn) price = h("input", { class: "p", type: "number", value: S.manual[id] ?? "", placeholder: R.qr?.price_uah != null ? String(R.qr.price_uah) : "ціна",
    title: "ціна в цій КП (нову ціну для всіх КП — у конфігураторі, «Зберегти як нову ціну»)",
    onchange: (e) => { S.manual[id] = num(e.target.value); edLog("price:" + id, `Ціна «${ot}» у цій КП: ${uah(num(e.target.value))}`, { tpl: false, base: false }); renderQuote(); refreshPages(true); } });
  const canDrop = R.type === "acc" || (R.slot && !R.slot.required);
  card.append(h("div", { class: "line" }, n,
    h("input", { class: "t", value: E.title ?? ot, title: "назва в КП", onchange: (e) => rowEdit(id, "title", e.target.value, ot, `Назва «${ot}» → «${e.target.value}»`) }),
    price || h("small", { class: "p" }, "у комплекті"),
    h("button", { class: "sm ghost", title: open ? "згорнути" : "опис, варіант" + (tile ? ", фото" : ""), onclick: (e) => { e.stopPropagation(); ED.sel = open ? null : z.id; renderEditor(); } }, open ? "▴" : "⋯"),
    h("button", { class: "sm ghost", disabled: !canDrop, title: canDrop ? "прибрати з КП" : "обов’язкова позиція: її можна замінити варіантом",
      onclick: () => {
        if (R.type === "acc") S.sel = { ...S.sel, accessories: S.sel.accessories.filter((a) => a.id !== id) };
        else S.sel = core.reconcileSelection(cat, S.kt.id, { ...S.sel, slots: { ...S.sel.slots, [R.slot.id]: null } });
        posChanged(`Прибрано: ${ot}`);
      } }, "✕")));
  if (!open) { card.title = "клік — опис, варіант" + (tile ? ", фото" : ""); return card; }
  card.append(h("textarea", { rows: 2, value: E.desc ?? od ?? "", placeholder: "опис", onchange: (e) => rowEdit(id, "desc", e.target.value, od, `Опис «${ot}»`) }));
  if (R.slot && R.slot.candidates.length > 1) {
    card.append(h("label", { class: "inline" }, "Варіант", h("select", { value: id, onchange: (e) => {
      S.sel = core.reconcileSelection(cat, S.kt.id, { ...S.sel, slots: { ...S.sel.slots, [R.slot.id]: e.target.value } }, R.slot.id);
      posChanged(`${R.slot.title}: ${core.itemById(cat, e.target.value)?.title || e.target.value}`);
    } }, R.slot.candidates.map((c) => h("option", { value: c }, core.itemById(cat, c)?.title || c)))));
  }
  if (R.slot) {
    const items = core.selectedItems(cat, S.kt, S.sel).map((x) => x.item);
    for (const ch of S.kt.choices.filter((c) => c.slot === R.slot.id && c.options.length > 1)) {
      const v = S.sel.choices?.[ch.id] ?? core.choiceDefault(cat, ch, items);
      card.append(h("label", { class: "inline" }, ch.title, h("select", { value: v, onchange: (e) => {
        S.sel = core.reconcileSelection(cat, S.kt.id, { ...S.sel, choices: { ...S.sel.choices, [ch.id]: e.target.value } });
        posChanged(`${ch.title}: ${ch.options.find((o) => o.value === e.target.value)?.title || e.target.value}`);
      } }, ch.options.map((o) => h("option", { value: o.value }, o.title + (o.price_uah ? ` (+${uah(o.price_uah)})` : ""))))));
    }
  }
  if (tile) card.append(h("div", { class: "pic-row" }, h("small", {}, "Фото"), gallerySelect(E.photo, (p) => rowEdit(id, "photo", p, null, `Фото «${ot}» → ${p ? p.split("/").pop() : "як у каталозі"}`), "— як у каталозі —")));
  card.append(scopeBox(`row:${id}:title`) || scopeBox(`row:${id}:desc`) || scopeBox(`row:${id}:photo`) || h("span"));
  return card;
}
function addCard() {
  const kt = S.kt, sel = S.sel;
  const slots = kt.slots.filter((s) => !s.required && !sel.slots[s.id]);
  const accs = core.kitAccessories(cat, kt.id, sel).filter((ka) => ka.status === "ok" && !sel.accessories.some((a) => a.id === ka.accessory.id));
  const used = new Set(S.extras.map((x) => (x.title || "").trim().toLowerCase()));
  const saved = admin.extras.filter((x) => !used.has(x.title.trim().toLowerCase()));
  const s = h("select", { onchange: (e) => {
    const v = e.target.value; if (!v) return;
    if (v === "new") return newExtra();
    const [kind, a, b] = v.split("|");
    if (kind === "slot") { S.sel = core.reconcileSelection(cat, kt.id, { ...sel, slots: { ...sel.slots, [a]: b } }, a); posChanged(`Додано: ${core.itemById(cat, b)?.title || b}`); }
    if (kind === "acc") {
      const acc = cat.accessories.find((x) => x.id === a), title = acc?.title || a;
      const put = (price) => { S.sel = { ...sel, accessories: [...sel.accessories, { id: a, variant: null, price_uah: price }] }; posChanged(`Додано опцію: ${title}`); };
      if (acc?.price?.mode === "ref" && acc.price.uah) return put(null);
      // an option without a price is not a row of the price table: ask for its price in this KP
      const pin = h("input", { type: "number", placeholder: "ціна, ₴" });
      modal(h("div", { class: "form" }, h("h2", {}, `${title}: ціна в цій КП`),
        h("p", { class: "hint" }, "Без ціни опція не стає рядком у вартості (лише картка на сторінці «Додаткові опції», якщо її увімкнено)."), pin,
        h("div", { class: "acts" }, h("button", { onclick: () => { closeModal(); put(null); } }, "Без ціни"),
          h("button", { class: "primary", onclick: () => { closeModal(); put(num(pin.value)); } }, "Додати з ціною"))));
      setTimeout(() => pin.focus(), 50);
    }
    if (kind === "ext") { const x = saved[Number(a)]; S.extras = [...S.extras, { title: x.title, desc: x.desc, price_uah: x.price_uah, qty: 1 }]; posChanged(`Додано: ${x.title}`); }
  } }, h("option", { value: "" }, "+ Додати позицію…"),
    slots.length ? h("optgroup", { label: "Позиції комплекту" }, slots.flatMap((sl) => sl.candidates.map((c) => h("option", { value: `slot|${sl.id}|${c}` }, `${sl.title}: ${core.itemById(cat, c)?.title || c}`)))) : null,
    accs.length ? h("optgroup", { label: "Опції" }, accs.map((ka) => h("option", { value: `acc|${ka.accessory.id}` },
      ka.accessory.title + (ka.accessory.price?.mode === "ref" && ka.accessory.price.uah ? " · " + uah(ka.accessory.price.uah) : " · ціна за запитом")))) : null,
    h("optgroup", { label: "Свої позиції" }, saved.map((x, i) => h("option", { value: `ext|${i}` }, x.title + (x.price_uah != null ? " · " + uah(x.price_uah) : ""))),
      h("option", { value: "new" }, "Нова своя позиція…")));
  return h("div", { class: "card-f add-f" }, s);
}
function newExtra() {
  const t = h("input", { "aria-label": "Назва нової позиції", placeholder: "назва, напр. Монтажні роботи" }), d = h("input", { "aria-label": "Опис нової позиції", placeholder: "опис (необов’язково)" }), p = h("input", { type: "number", "aria-label": "Ціна нової позиції, ₴", placeholder: "ціна, ₴" });
  modal(h("div", { class: "form" }, h("h2", {}, "Своя позиція в КП"), t, d, p, h("div", { class: "acts" }, h("button", { onclick: () => { closeModal(); renderEditor(); } }, "Скасувати"),
    h("button", { class: "primary", onclick: () => {
      if (!t.value.trim()) return toast("Вкажіть назву позиції");
      const x = { title: t.value.trim(), desc: d.value.trim(), price_uah: num(p.value), qty: 1 };
      S.extras = [...S.extras, x];
      admin.extras = [{ ...x, at: core.todayIso() }, ...admin.extras.filter((y) => y.title.trim().toLowerCase() !== x.title.toLowerCase())].slice(0, 30); saveAdmin();
      closeModal(); posChanged(`Додано: ${x.title}`);
    } }, "Додати"))));
  setTimeout(() => t.focus(), 50);
}

// ---- saving: this KP always; each change also into the style template and / or the base KP (ready kit), as ticked
function copyChange(key, dst, tplStyle) {
  const E = S.edits || EMPTY_EDITS(), set = (o, k, v) => { if (v === undefined) delete o[k]; else o[k] = structuredClone(v); };
  if (key.startsWith("shape:")) { dst.shapes ??= {}; set(dst.shapes, key.slice(6), E.shapes[key.slice(6)]); }
  else if (key.startsWith("page:")) { dst.pages ??= {}; set(dst.pages, key.slice(5), E.pages[key.slice(5)]); }
  else if (key.startsWith("row:")) {
    const [, id, f] = key.split(":"); dst.rows ??= {};
    const r = { ...(dst.rows[id] || {}) }; set(r, f, E.rows[id]?.[f]);
    if (Object.keys(r).length) dst.rows[id] = r; else delete dst.rows[id];
  } else if (key.startsWith("hero:")) {
    const k = key.slice(5), v = E.heroes[k];
    if (tplStyle) {   // the style template's page photo is the settings' «Фото сторінок»
      const st = ((admin.styles[tplStyle] ??= {}).bg ??= {});
      if (v?.path) st[k] = { ...(st[k] || {}), path: v.path, fx: v.fx ?? 0.5, fy: v.fy ?? 0.45 }; else delete st[k];
    } else { dst.heroes ??= {}; set(dst.heroes, k, v); }
  }
}
function saveDialog() {
  const keys = Object.keys(S.editLog);
  if (!keys.length) return toast("Змін ще немає");
  const base = S.basePreset && cat.presets.find((p) => p.id === S.basePreset);
  const all = (f, v) => { for (const k of keys) if (S.editLog[k].can[f]) S.editLog[k][f] = v; saveDialog(); };
  modal(h("div", { class: "form ed-save" }, h("h2", {}, "Зберегти зміни сторінок"),
    h("p", { class: "hint" }, `Усі зміни вже в цій КП. Позначте, що піде також у шаблон стилю «${edStyleInfo()?.title || edStyle()}» для «${kitName(S.kt)}» (усі нові КП цього комплекту в цьому стилі)`
      + ` і в базову КП ${base ? "«" + base.title + "»" : "(буде створено нову готову КП з цим складом)"}.`),
    h("table", { class: "prices" }, h("thead", {}, h("tr", {}, h("th", {}, "Зміна"), h("th", {}, "Ця КП"),
      h("th", {}, "Шаблон ", h("button", { class: "sm ghost", onclick: () => all("tpl", !keys.every((k) => !S.editLog[k].can.tpl || S.editLog[k].tpl)) }, "усі")),
      h("th", {}, "Базова КП ", h("button", { class: "sm ghost", onclick: () => all("base", !keys.every((k) => !S.editLog[k].can.base || S.editLog[k].base)) }, "усі")))),
      h("tbody", {}, keys.map((k) => { const L = S.editLog[k]; const c = (f) => L.can[f] ? h("input", { type: "checkbox", checked: L[f], onchange: (e) => { L[f] = e.target.checked; } }) : h("small", {}, "—");
        return h("tr", {}, h("td", {}, L.label), h("td", {}, "✓"), h("td", {}, c("tpl")), h("td", {}, c("base"))); }))),
    h("div", { class: "acts" }, h("button", { onclick: closeModal }, "Закрити"),
      h("button", { onclick: () => commitEdits(false) }, "Зберегти"),
      h("button", { class: "primary", onclick: () => commitEdits(true) }, S.historyId ? "Зберегти й оновити КП (PDF)" : "Зберегти й створити КП (PDF)"))));
}
async function commitEdits(andGenerate) {
  const keys = Object.keys(S.editLog), style = edStyle(), kit = ED.spec?.kit_type || S.kt.extends || S.kt.id;
  const tk = tplKey(style, kit), notes = [];
  if (keys.some((k) => S.editLog[k].tpl)) {
    const dst = (admin.page_edits.tpl[tk] ??= EMPTY_EDITS());
    for (const k of keys.filter((k) => S.editLog[k].tpl)) copyChange(k, dst, k.startsWith("hero:") ? style : null);
    notes.push("шаблон " + tk);
  }
  if (keys.some((k) => S.editLog[k].base)) {
    let id = S.basePreset;
    const orig = id && cat.presets.find((p) => p.id === id);
    const posChange = keys.some((k) => k.startsWith("pos:") && S.editLog[k].base);
    if (!orig || posChange) {   // the base KP keeps its composition unless positions were changed and ticked for it
      id = orig ? id : "kp_" + Date.now().toString(36);
      const p = { id, kit_type: S.kt.id, itemized: S.itemized, quantities: { ...S.qty }, extras: S.extras.filter((x) => x.title?.trim()).map((x) => ({ ...x })),
        selection: structuredClone(S.sel), title: orig?.title || `${ED.spec?.title || kitName(S.kt)} (з редактора, ${core.formatDate(core.todayIso())})`,
        source: { ...(orig?.source || {}), date: core.todayIso(), edited: "редактор сторінок", total_uah: lastQuote?.total_uah ?? null } };
      admin.page_presets = [...admin.page_presets.filter((x) => x.id !== id), p];
    }
    const dst = (admin.page_edits.preset[id] ??= EMPTY_EDITS());
    for (const k of keys.filter((k) => S.editLog[k].base && !k.startsWith("pos:"))) copyChange(k, dst, null);
    S.basePreset = id; notes.push("базова КП " + id);
  }
  for (const k of keys) S.editLog[k].saved = { tpl: !!S.editLog[k].tpl, base: !!S.editLog[k].base };
  if (notes.length) await saveAdmin(true, "редактор сторінок: " + notes.join(", "));
  closeModal(); toast(notes.length ? "Збережено: ця КП, " + notes.join(", ") : "Збережено для цієї КП");
  if (andGenerate) {
    edStatus("Створюю КП (PPTX + PDF)…", "busy");
    await generate(false);
    const res = $("#genResult").cloneNode(true); res.id = "";
    $("#edResult").replaceChildren(...res.childNodes);
    edStatus("КП збережено в історії");
  }
}
function resetEdits() {
  confirmBox("Скинути всі правки сторінок цієї КП? Шаблон і базова КП не зміняться.", "Скинути", async () => {
    S.edits = null; S.editLog = {}; editorBadge(); refreshPages(true);
  });
}
function initEditor() {
  $("#editPages").onclick = openEditor;
  $("#edBack").onclick = () => tab("conf");
  $("#edSave").onclick = saveDialog;
  $("#edReset").onclick = resetEdits;
  $("#edReload").onclick = () => refreshPages(true);
  editorBadge();
}
async function showEditor() {
  renderQuote();
  if (!lastQuote) { edStatus("Спершу оберіть комплект у конфігураторі", "err"); return; }
  if (edStyleInfo()?.engine === "d6") { edStatus("Редактор сторінок працює зі стилями KP_2_v3 і Ultra: оберіть один із них у картці «КП»", "err"); return; }
  if (!ED.gallery) ED.gallery = await api("/api/gallery").catch(() => []);
  ED.meta = null; ED.sel = null; $("#edResult").innerHTML = "";
  renderEditor();
  refreshPages(true);
}

boot().catch((e) => { document.body.prepend(h("div", { class: "result err" }, "Помилка запуску: " + e.message)); console.error(e); });
