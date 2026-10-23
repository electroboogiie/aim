import { accessoryById, accessoryDesc, accessoryStatus, choiceIsStandard, choiceOption, companyById, findBundle, itemById, itemDesc, kitTitle, kitTypeById, modelName, normalizeSelection, selectedItems, validateSelection, } from "./catalog.js";
import { addDays, fillTemplate, formatDate, formatNumber, formatPct, formatRate, formatUah, isIsoDate, joinUk, roundTo, todayIso } from "./format.js";
export const TEXT_ON_REQUEST = "ціна за запитом";
export const TEXT_INCLUDED = "входить у комплект";
export const TEXT_IN_KIT = "у комплекті";
export class QuoteError extends Error {
    errors;
    constructor(errors) {
        super(errors.join(" "));
        this.name = "QuoteError";
        this.errors = errors;
    }
}
/** K of §4: the rate of the configured mode with the buffer. */
export function eurRate(settings, rate) {
    const manual = settings.eur.mode === "manual";
    const raw = manual ? settings.eur.manual_rate : rate?.eur ?? null;
    const ok = typeof raw === "number" && Number.isFinite(raw) && raw > 0;
    const source = manual ? "manual" : ok ? rate?.source || "nbu" : "none";
    return { rate: ok ? raw : null, k: ok ? raw * (1 + settings.eur.buffer_pct / 100) : null, source };
}
/** Reference point of a ref price for a date: the latest one on or before it, else the earliest. */
export function refPoint(rule, date) {
    const pts = [rule, ...(rule.history ?? [])].slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let best;
    for (const p of pts)
        if (p.date <= date)
            best = p;
    return best ?? pts[0];
}
function groupOf(settings, group, label, warnings) {
    const g = settings.groups[group];
    if (!g)
        warnings.push(`Група цін «${group}» (${label}) не задана в налаштуваннях: націнку й логістику не враховано.`);
    return { markup: (g?.markup_pct ?? 0) / 100, logistics: (g?.logistics_pct ?? 0) / 100 };
}
/** Price of one rule. `label` names the position in warnings. */
export function priceRule(rule, ctx, label) {
    const { settings, eur } = ctx;
    const vat = settings.vat_pct / 100;
    const round = (x) => roundTo(x, settings.rounding_uah);
    const warnings = [];
    switch (rule.mode) {
        case "included":
            return { price: 0, text: TEXT_INCLUDED, breakdown: TEXT_INCLUDED, warnings };
        case "on_request":
            return { price: null, text: TEXT_ON_REQUEST, breakdown: "ціна не задана в каталозі", warnings };
        case "eur": {
            const g = groupOf(settings, rule.group, label, warnings);
            if (eur.k === null) {
                warnings.push(`«${label}»: немає курсу EUR — ціну не розраховано.`);
                return { price: null, text: TEXT_ON_REQUEST, breakdown: `€ ${formatNumber(rule.eur)} × курс EUR (невідомий)`, warnings, needsRate: true };
            }
            const price = round(rule.eur * eur.k * (1 + g.logistics) * (1 + g.markup) * (1 + vat));
            const breakdown = `€ ${formatNumber(rule.eur)} × ${formatRate(eur.k)} · логістика ${formatPct(g.logistics * 100)} · `
                + `націнка ${formatPct(g.markup * 100)} · ПДВ ${formatPct(settings.vat_pct)}`;
            return { price, text: formatUah(price), breakdown, warnings, usedRate: true };
        }
        case "cost": {
            const g = groupOf(settings, rule.group, label, warnings);
            let sum = 0;
            const parts = [];
            let missing = false;
            for (const m of rule.metal) {
                const unit = settings.metal.grades[m.grade];
                if (typeof unit !== "number") {
                    warnings.push(`«${label}»: немає ціни металу марки «${m.grade}» — ціну не розраховано.`);
                    missing = true;
                    continue;
                }
                sum += m.kg * unit;
                parts.push(`${formatNumber(m.kg)} кг ${m.grade} × ${formatNumber(unit)} ₴`);
            }
            let needsRate = false;
            if (rule.components_eur) {
                if (eur.k === null) {
                    warnings.push(`«${label}»: немає курсу EUR для комплектуючих — ціну не розраховано.`);
                    missing = true;
                    needsRate = true;
                }
                else {
                    sum += rule.components_eur * eur.k;
                    parts.push(`€ ${formatNumber(rule.components_eur)} × ${formatRate(eur.k)}`);
                }
            }
            if (rule.hours) {
                if (settings.labor_rate_uah === null) {
                    warnings.push(`«${label}»: не задано вартість нормо-години — ціну не розраховано.`);
                    missing = true;
                }
                else {
                    sum += rule.hours * settings.labor_rate_uah;
                    parts.push(`${formatNumber(rule.hours)} год × ${formatNumber(settings.labor_rate_uah)} ₴`);
                }
            }
            if (rule.paint_uah) {
                sum += rule.paint_uah;
                parts.push(`фарбування ${formatNumber(rule.paint_uah)} ₴`);
            }
            const breakdown = `(${parts.join(" + ") || "0"}) · націнка ${formatPct(g.markup * 100)} · ПДВ ${formatPct(settings.vat_pct)}`;
            if (missing)
                return { price: null, text: TEXT_ON_REQUEST, breakdown, warnings, needsRate };
            const price = round(sum * (1 + g.markup) * (1 + vat));
            return { price, text: formatUah(price), breakdown, warnings, usedRate: !!rule.components_eur };
        }
        case "ref": {
            const pt = refPoint(rule, ctx.date);
            const buf = 1 + settings.eur.buffer_pct / 100;
            const refRate = pt.eur_rate_ref ?? ctx.rate?.ref_rates?.[pt.date] ?? null;
            const kRef = typeof refRate === "number" && refRate > 0 ? refRate * buf : null;
            let eurRatio = 1;
            const res = { price: null, text: "", breakdown: "", warnings };
            const notes = [];
            if (rule.eur_share > 0) {
                if (eur.k !== null && kRef !== null) {
                    eurRatio = eur.k / kRef;
                    res.usedRate = true;
                    notes.push(`EUR ${formatRate(eur.k)} / ${formatRate(kRef)} × ${formatPct(rule.eur_share * 100)}`);
                }
                else {
                    if (eur.k === null)
                        res.needsRate = true;
                    else
                        res.noEurRef = `${label} (${formatDate(pt.date)})`;
                    notes.push(eur.k === null ? "курс EUR невідомий" : "курс EUR на дату ціни не задано");
                }
            }
            let metalRatio = 1;
            if (rule.metal_share > 0) {
                const M = settings.metal.index_uah_per_kg;
                const Mref = pt.metal_index_ref ?? settings.metal.ref_index_uah_per_kg;
                if (typeof M === "number" && M > 0 && typeof Mref === "number" && Mref > 0) {
                    metalRatio = M / Mref;
                    notes.push(`метал ${formatNumber(M)} / ${formatNumber(Mref)} × ${formatPct(rule.metal_share * 100)}`);
                }
                else {
                    res.noMetal = true;
                    notes.push("індекс металу не задано");
                }
            }
            const factor = 1 + rule.eur_share * (eurRatio - 1) + rule.metal_share * (metalRatio - 1);
            // A reference price at its own reference conditions is the KP price as printed: not rounded.
            const price = factor === 1 ? pt.uah : round(pt.uah * factor);
            res.price = price;
            res.text = formatUah(price);
            res.breakdown = `${formatUah(pt.uah)} станом на ${formatDate(pt.date)} × ${formatNumber(factor, 4)}`
                + (notes.length ? ` (${notes.join("; ")})` : "");
            return res;
        }
    }
}
/** Pieces of an accessory: 1 unless it allows several (max_qty). */
export function accessoryQty(def, v) {
    const max = def.max_qty ?? 1;
    return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(1, Math.round(v))) : 1;
}
/** Quantity of a unit item: the manager's value within [min, max], else the default. */
export function unitQty(unit, v) {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0)
        return unit.default;
    return Math.min(unit.max ?? Infinity, Math.max(unit.min ?? 0, v));
}
function absorb(acc, p, label) {
    acc.warnings.push(...p.warnings);
    if (p.noEurRef)
        acc.noEurRef.push(p.noEurRef);
    if (p.noMetal)
        acc.noMetal.push(label);
    if (p.needsRate)
        acc.needsRate = true;
    if (p.usedRate)
        acc.usedRate = true;
}
function merge(acc, other) {
    acc.warnings.push(...other.warnings);
    acc.noEurRef.push(...other.noEurRef);
    acc.noMetal.push(...other.noMetal);
    acc.needsRate ||= other.needsRate;
    acc.usedRate ||= other.usedRate;
}
function uniq(list) { return [...new Set(list)]; }
function needsRateItem(rule) {
    return rule.mode === "eur" || (rule.mode === "cost" && !!rule.components_eur) || (rule.mode === "ref" && rule.eur_share > 0);
}
/**
 * Quote of a kit (§4). Throws QuoteError with Ukrainian messages for an invalid selection or a discount above
 * settings.max_discount_pct; missing prices or rates give null rows and warnings instead.
 */
export function quote(c, settings, rate, input) {
    const errors = validateSelection(c, input);
    const discount = input.discount_pct ?? 0;
    if (!errors.length && discount > settings.max_discount_pct) {
        errors.push(`Знижка ${formatPct(discount)} перевищує дозволену (${formatPct(settings.max_discount_pct)}).`);
    }
    if (errors.length)
        throw new QuoteError(errors);
    const kt = kitTypeById(c, input.kit_type);
    const sel = normalizeSelection(kt, input.selection, c);
    const date = input.date ?? todayIso();
    const eur = eurRate(settings, rate);
    const ctx = { settings, eur, rate, date };
    const bundleKit = kt.price_display === "bundle" && !input.itemized;
    const manual = input.manual_prices ?? {};
    const itemAcc = { warnings: [], noEurRef: [], noMetal: [], needsRate: false, usedRate: false };
    const extraAcc = { warnings: [], noEurRef: [], noMetal: [], needsRate: false, usedRate: false };
    const picked = selectedItems(c, kt, sel);
    const items = picked.map((x) => x.item);
    const itemPrices = [];
    const qtys = input.quantities ?? {};
    // bundle kits: slots priced on their own sit on top of the kit price and are not part of the bundle
    const ownPrice = (slotPriced) => !bundleKit || !!slotPriced;
    const rows = picked.map(({ slot, item }, i) => {
        let p;
        const unit = item.unit;
        const qty = unit ? unitQty(unit, qtys[item.id]) : 1;
        if (typeof manual[item.id] === "number") {
            const v = manual[item.id];
            p = { price: v, text: formatUah(v), breakdown: "ціна вказана вручну", warnings: [] };
        }
        else {
            p = priceRule(item.price, ctx, item.title);
            if (unit && p.price !== null) {
                const v = Math.round(p.price * qty / unit.per);
                p = { ...p, price: v, text: formatUah(v), breakdown: `${p.breakdown} × ${formatNumber(qty)} ${unit.name} / ${formatNumber(unit.per)} ${unit.name}` };
            }
            if (item.price.mode === "on_request")
                p.warnings.push(`«${item.title}» — ${TEXT_ON_REQUEST}, у суму не входить.`);
        }
        const own = ownPrice(slot.priced);
        absorb(own && bundleKit ? extraAcc : itemAcc, p, item.title);
        itemPrices.push(own && bundleKit ? null : p.price);
        const title = unit ? fillTemplate(unit.title, { qty: formatNumber(qty) }) : item.title;
        const row = {
            no: i + 1, item_id: item.id, title, desc: itemDesc(kt, item, sel), qty: 1,
            price_uah: own ? p.price : null, price_text: own ? p.text : TEXT_IN_KIT, breakdown: p.breakdown,
            kind: item.kind, slot: slot.id,
        };
        if (item.photo)
            row.photo = item.photo;
        return row;
    });
    // truck kits: positions marked «у складі дообладнання» are one row with the conversion (its text names them, its price includes them)
    const host = rows.find((r) => r.slot === "conversion");
    const folded = new Set();
    let foldedKit = 0, foldOpen = false; // bundle kits: priced positions folded into a conversion row that is «у комплекті» add to the kit price
    if (host && sel.into?.length) {
        for (const r of rows) {
            if (r === host || !r.slot || !sel.into.includes(r.slot))
                continue;
            folded.add(r);
            const t = r.title.charAt(0).toLowerCase() + r.title.slice(1);
            host.desc = host.desc ? `${host.desc.replace(/[.;]\s*$/, "")}, ${t}` : t;
            if (r.price_uah === null)
                continue;
            if (host.price_uah !== null) {
                host.price_uah += r.price_uah;
                host.price_text = formatUah(host.price_uah);
                host.breakdown = `${host.breakdown} + ${r.title} ${formatUah(r.price_uah)}`;
            }
            else if (bundleKit)
                foldedKit += r.price_uah;
            else {
                foldOpen = true;
                itemAcc.warnings.push(`«${r.title}» у складі дообладнання: ціну дообладнання не визначено.`);
            }
        }
    }
    const extras = rows.filter((r, i) => !folded.has(r) && bundleKit && ownPrice(picked[i].slot.priced));
    const inKit = (r, i) => !extras.includes(r) && !(folded.has(r) && ownPrice(picked[i].slot.priced));
    const kitRows = rows.filter(inKit);
    const kitPrices = itemPrices.filter((_, i) => inKit(rows[i], i));
    const acc = { warnings: [], noEurRef: [], noMetal: [], needsRate: false, usedRate: false };
    let kitPrice = null;
    let bundleId = null;
    let kitBreakdown = "";
    let complete = !foldOpen;
    if (bundleKit) {
        const bundleSlots = { ...sel.slots };
        for (const s of kt.slots)
            if (s.priced)
                delete bundleSlots[s.id];
        const bundle = findBundle(c, kt.id, bundleSlots);
        if (typeof input.kit_price_uah === "number") {
            kitPrice = input.kit_price_uah;
            kitBreakdown = "ціна комплекту вказана вручну";
        }
        else if (bundle) {
            bundleId = bundle.id;
            const label = `комплект ${kitTitle(c, kt, sel)}`;
            const p = priceRule(bundle.price, ctx, label);
            absorb(acc, p, label);
            kitPrice = p.price;
            kitBreakdown = p.breakdown;
            if (kitPrice === null)
                acc.warnings.push(`Ціна: ${label} — за запитом. Вкажіть ціну комплекту вручну.`);
        }
        else if (kitPrices.length && kitPrices.every((x) => x !== null)) {
            merge(acc, itemAcc);
            kitPrice = kitPrices.reduce((a, b) => a + b, 0);
            kitBreakdown = "сума цін позицій: " + kitRows.map((r, i) => `${r.title} ${formatUah(kitPrices[i])}`).join(" + ");
        }
        else {
            const missing = kitRows.filter((_, i) => kitPrices[i] === null).map((r) => `«${r.title}»`);
            acc.warnings.push(`Ціну комплекту не визначено: немає ціни для ${joinUk(missing, "і")}. Вкажіть ціну комплекту вручну.`);
        }
        if (kitPrice !== null && foldedKit) {
            kitPrice += foldedKit;
            kitBreakdown += ` + у складі дообладнання ${formatUah(foldedKit)}`;
        }
        if (kitPrice === null)
            complete = false;
        merge(acc, extraAcc);
        if (extras.some((r) => r.price_uah === null))
            complete = false;
    }
    else {
        merge(acc, itemAcc);
        if (itemPrices.some((x) => x === null))
            complete = false;
    }
    const choices = kt.choices.map((ch) => {
        const value = sel.choices[ch.id] ?? ch.default;
        const o = choiceOption(ch, value);
        const std = choiceIsStandard(o, items);
        const slotEmpty = !!ch.slot && !sel.slots[ch.slot];
        if (o.on_request && o.price_uah === undefined && !std && !slotEmpty) {
            complete = false;
            acc.warnings.push(`Доплату за «${o.title}» (${ch.title}) не визначено — уточніть ціну.`);
        }
        return { id: ch.id, title: ch.title, value, value_title: o.title, price_uah: std || slotEmpty ? 0 : o.price_uah ?? 0 };
    });
    if (folded.size) {
        for (const r of folded)
            rows.splice(rows.indexOf(r), 1);
        rows.forEach((r, i) => { r.no = i + 1; });
    }
    const onRequestAcc = [];
    const accessories = sel.accessories.map((a, i) => {
        const def = accessoryById(c, a.id);
        const variant = a.variant ? (def.variants ?? []).find((v) => v.id === a.variant) : undefined;
        const title = variant ? `${def.title}: ${variant.title}` : def.title;
        const qty = accessoryQty(def, a.qty);
        let p;
        if (typeof a.price_uah === "number")
            p = { price: a.price_uah, text: formatUah(a.price_uah), breakdown: "ціна вказана вручну", warnings: [] };
        else
            p = priceRule(def.price, ctx, title);
        if (qty > 1 && p.price !== null) {
            const v = p.price * qty;
            p = { ...p, price: v, text: formatUah(v), breakdown: `${p.breakdown} × ${qty} шт` };
        }
        absorb(acc, p, title);
        if (p.price === null)
            onRequestAcc.push(title);
        if (accessoryStatus(c, def, items) === "unconfirmed") {
            const with_ = items.filter((o) => def.compatible_unconfirmed?.includes(o.id)).map(modelName);
            acc.warnings.push(`Сумісність опції «${def.title}» з ${joinUk(with_, "і")} не підтверджена виробником — уточніть під замовлення.`);
        }
        const row = {
            no: i + 1, item_id: def.id, title, desc: accessoryDesc(c, def, items, a.variant), qty, price_uah: p.price,
            price_text: p.text, breakdown: p.breakdown, group: def.group,
        };
        const photo = variant?.photo || def.photo;
        if (photo)
            row.photo = photo;
        if (variant)
            row.variant = variant.id;
        return row;
    });
    if (onRequestAcc.length)
        acc.warnings.push(`Опції за запитом (у суму не входять): ${onRequestAcc.join(", ")}.`);
    if (acc.needsRate && eur.k === null) {
        acc.warnings.unshift(settings.eur.mode === "manual"
            ? "Ручний курс EUR не задано в налаштуваннях: ціни, прив’язані до EUR, не перераховано."
            : "Курс EUR НБУ недоступний: ціни, прив’язані до EUR, не перераховано.");
    }
    if (acc.noEurRef.length) {
        acc.warnings.push(`Не задано курс EUR на дату ціни, тому ці ціни не перераховано за поточним курсом: ${uniq(acc.noEurRef).join(", ")}.`);
    }
    if (acc.noMetal.length) {
        acc.warnings.push(`Не задано індекс металу: металозалежну частку цін не перераховано (${uniq(acc.noMetal).join(", ")}).`);
    }
    // own positions typed in on the configurator page: after the kit positions, each with its own price
    (input.extras ?? []).forEach((x, i) => {
        const title = String(x.title ?? "").trim();
        if (!title)
            return;
        const qty = typeof x.qty === "number" && x.qty > 1 ? Math.round(x.qty) : 1;
        const price = typeof x.price_uah === "number" && Number.isFinite(x.price_uah) ? x.price_uah * qty : null;
        if (price === null) {
            complete = false;
            acc.warnings.push(`«${title}» — ${TEXT_ON_REQUEST}, у суму не входить.`);
        }
        rows.push({ no: rows.length + 1, item_id: `extra_${i + 1}`, title: qty > 1 ? `${title} — ${qty} шт` : title, desc: String(x.desc ?? "").trim(),
            qty: 1, price_uah: price, price_text: price === null ? TEXT_ON_REQUEST : formatUah(price), breakdown: "позиція вписана вручну", kind: "extra" });
    });
    const base = (bundleKit ? kitPrice ?? 0 : 0) + rows.reduce((s, r) => s + (r.price_uah ?? 0), 0);
    const subtotal = base + choices.reduce((s, x) => s + x.price_uah, 0) + accessories.reduce((s, r) => s + (r.price_uah ?? 0), 0);
    const total = discount > 0 ? roundTo(subtotal * (1 - discount / 100), settings.rounding_uah) : subtotal;
    const q = {
        kit_type: kt.id, rows, choices, accessories, subtotal_uah: subtotal, discount_pct: discount, total_uah: total,
        eur_rate: eur.rate, eur_rate_source: eur.source, date, valid_until: addDays(date, settings.validity_days),
        warnings: uniq(acc.warnings), price_display: bundleKit || kt.price_display !== "bundle" ? kt.price_display : "itemized", complete, eur_applied: acc.usedRate,
    };
    if (bundleKit) {
        q.kit_price_uah = kitPrice;
        q.bundle_id = bundleId;
    }
    if (kitBreakdown)
        q.kit_breakdown = kitBreakdown;
    if (folded.size)
        q.folded = [...folded].map((r) => r.slot);
    return q;
}
/** Reference dates whose EUR rate is still unknown (the server may fetch them into RateInfo.ref_rates). */
export function refRateDates(c) {
    const dates = new Set();
    const add = (rule) => {
        if (rule.mode !== "ref" || !(rule.eur_share > 0))
            return;
        for (const p of [rule, ...(rule.history ?? [])])
            if (p.eur_rate_ref == null && isIsoDate(p.date))
                dates.add(p.date);
    };
    for (const it of c.items)
        add(it.price);
    for (const b of c.bundles)
        add(b.price);
    for (const a of c.accessories)
        add(a.price);
    return [...dates].sort();
}
/** True when some item, bundle or accessory price moves with the EUR rate. */
export function catalogNeedsRate(c) {
    return [...c.items.map((x) => x.price), ...c.bundles.map((x) => x.price), ...c.accessories.map((x) => x.price)].some(needsRateItem);
}
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
/** Errors of a settings object (PUT /api/settings); with the catalog also company and price groups. */
export function validateSettings(s, c) {
    const e = [];
    const o = s;
    if (typeof o !== "object" || o === null)
        return ["Налаштування мають бути JSON-об’єктом."];
    const eurS = s.eur;
    if (!eurS || typeof eurS !== "object")
        e.push("eur: потрібен об’єкт {mode, manual_rate, buffer_pct}.");
    else {
        if (eurS.mode !== "nbu" && eurS.mode !== "manual")
            e.push("eur.mode має бути «nbu» або «manual».");
        if (eurS.manual_rate !== null && !(isNum(eurS.manual_rate) && eurS.manual_rate > 0))
            e.push("eur.manual_rate має бути додатним числом або null.");
        if (eurS.mode === "manual" && eurS.manual_rate === null)
            e.push("Для ручного курсу EUR задайте eur.manual_rate.");
        if (!isNum(eurS.buffer_pct) || eurS.buffer_pct < 0 || eurS.buffer_pct > 50)
            e.push("eur.buffer_pct має бути числом від 0 до 50.");
    }
    const m = s.metal;
    if (!m || typeof m !== "object")
        e.push("metal: потрібен об’єкт {index_uah_per_kg, ref_index_uah_per_kg, grades}.");
    else {
        for (const k of ["index_uah_per_kg", "ref_index_uah_per_kg"]) {
            if (m[k] !== null && !(isNum(m[k]) && m[k] > 0))
                e.push(`metal.${k} має бути додатним числом або null.`);
        }
        if (typeof m.grades !== "object" || m.grades === null || Array.isArray(m.grades))
            e.push("metal.grades має бути об’єктом «марка → ₴/кг».");
        else
            for (const [g, v] of Object.entries(m.grades))
                if (!(isNum(v) && v > 0))
                    e.push(`metal.grades.${g} має бути додатним числом.`);
    }
    if (s.labor_rate_uah !== null && !(isNum(s.labor_rate_uah) && s.labor_rate_uah > 0))
        e.push("labor_rate_uah має бути додатним числом або null.");
    if (typeof s.groups !== "object" || s.groups === null || Array.isArray(s.groups))
        e.push("groups має бути об’єктом.");
    else {
        for (const [g, v] of Object.entries(s.groups)) {
            if (!v || !isNum(v.markup_pct) || v.markup_pct < 0 || !isNum(v.logistics_pct) || v.logistics_pct < 0) {
                e.push(`groups.${g}: markup_pct і logistics_pct мають бути невід’ємними числами.`);
            }
        }
    }
    const range = (k, lo, hi, int = false) => {
        const v = s[k];
        if (!isNum(v) || v < lo || v > hi || (int && !Number.isInteger(v)))
            e.push(`${k} має бути ${int ? "цілим " : ""}числом від ${lo} до ${hi}.`);
    };
    range("vat_pct", 0, 100);
    range("rounding_uah", 0, 100000);
    range("validity_days", 0, 365, true);
    range("max_discount_pct", 0, 100);
    if (typeof s.company_maker !== "string" || !s.company_maker)
        e.push("company_maker: не задано компанію.");
    if (typeof s.kp_number_prefix !== "string")
        e.push("kp_number_prefix має бути рядком.");
    if (c) {
        if (typeof s.company_maker === "string" && s.company_maker && !companyById(c, s.company_maker))
            e.push(`company_maker: невідома компанія «${s.company_maker}».`);
        if (s.groups && typeof s.groups === "object") {
            const used = new Set();
            for (const r of [...c.items.map((x) => x.price), ...c.bundles.map((x) => x.price), ...c.accessories.map((x) => x.price)]) {
                if ((r.mode === "eur" || r.mode === "cost") && r.group)
                    used.add(r.group);
            }
            for (const g of used)
                if (!s.groups[g])
                    e.push(`groups: немає групи «${g}», яку використовує каталог.`);
        }
    }
    return e;
}
/** Item lookup helper for UIs: the price of one item alone under the current settings and rate. */
export function itemPrice(c, settings, rate, itemId, date) {
    const it = itemById(c, itemId);
    if (!it)
        return null;
    const ctx = { settings, eur: eurRate(settings, rate), rate, date: date ?? todayIso() };
    const p = priceRule(it.price, ctx, it.title);
    return { price_uah: p.price, text: p.text, breakdown: p.breakdown };
}
