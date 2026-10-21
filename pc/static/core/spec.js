import { SUPPORTED_PROFILES, SUPPORTED_TRAILER_PROFILES, accessoryDesc, choiceIsStandard, accessoryStatus, companyById, itemById, kitTitle, kitTypeById, modelName, termById } from "./catalog.js";
import { fillTemplate, formatDate, formatPct, formatRate, formatUah, joinUk } from "./format.js";
import { TEXT_ON_REQUEST, eurRate, priceRule } from "./pricing.js";
/** Crane spec keys the generator prints (§2.1 plus telescope). */
export const CRANE_SPEC_KEYS = ["reach_m", "torque_knm", "lift_4m_kg", "lift_full_kg", "grapple_m2", "rotator_t", "valve",
    "valve_flow_l", "slew_knm", "slew_cyl", "turn_deg", "pressure_bar", "pump_lpm", "legs", "weight_kg", "telescope"];
export const REQUIRED_CRANE_SPECS = ["reach_m", "torque_knm", "lift_4m_kg", "lift_full_kg", "grapple_m2", "rotator_t", "turn_deg"];
export const MAX_KP_ROWS = 8;
export const MAX_KP_TERMS = 7;
export const MAX_KP_CARDS = 9;
export class KpSpecError extends Error {
    errors;
    constructor(errors) {
        super(errors.join(" "));
        this.name = "KpSpecError";
        this.errors = errors;
    }
}
function craneOf(c, q) {
    for (const r of q.rows) {
        const it = itemById(c, r.item_id);
        if (it?.kind === "crane")
            return it;
    }
    return undefined;
}
/** Price table rows of the KP: the kit positions, then (itemized kits only) priced choices and accessories. */
export function kpRows(q) {
    const rows = q.rows.map((r) => {
        const out = { no: 0, title: r.title, desc: r.desc, qty: r.qty, price_text: r.price_text, item_id: r.item_id };
        if (r.kind)
            out.kind = r.kind;
        if (r.photo)
            out.photo = r.photo;
        return out;
    });
    if (q.price_display === "itemized") {
        for (const ch of q.choices) {
            if (ch.price_uah > 0)
                rows.push({ no: 0, title: `${ch.title}: ${ch.value_title}`, desc: "", qty: 1, price_text: formatUah(ch.price_uah) });
        }
        for (const a of q.accessories) {
            if (a.price_uah === null)
                continue;
            const out = { no: 0, title: a.title, desc: a.desc, qty: a.qty, price_text: a.price_text, item_id: a.item_id, kind: "accessory" };
            if (a.photo)
                out.photo = a.photo;
            rows.push(out);
        }
    }
    rows.forEach((r, i) => { r.no = i + 1; });
    return rows;
}
/**
 * Options page cards: the chosen accessories, then (offer) the kit's other compatible accessories that have a photo,
 * with their catalog price (else on request), bmf.rv.ua first, up to MAX_KP_CARDS.
 */
function kpCards(c, settings, kt, q, offer) {
    const cards = q.accessories.map((a) => ({
        group: a.group ?? "crane", title: a.qty > 1 ? `${a.title} — ${a.qty} шт` : a.title, desc: a.desc, photo: a.photo ?? "",
        price_text: a.price_uah === null ? TEXT_ON_REQUEST : a.price_text,
    }));
    if (!offer)
        return cards;
    const items = q.rows.map((r) => itemById(c, r.item_id)).filter((x) => !!x);
    const chosen = new Set(q.accessories.map((a) => a.item_id));
    const rank = (a) => (a.origin === "bmf.ee" ? 1 : 0);
    const ctx = { settings, eur: eurRate(settings, { eur: q.eur_rate, source: q.eur_rate_source }), rate: null, date: q.date };
    const offerPrice = (a) => priceRule(a.price, ctx, a.title).price;
    const extra = c.accessories
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => !a.disabled && kt.accessory_groups.includes(a.group) && !chosen.has(a.id) && !!a.photo && accessoryStatus(c, a, items) === "ok")
        .sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i)
        .slice(0, Math.max(0, MAX_KP_CARDS - cards.length))
        .map(({ a }) => ({ group: a.group, title: a.title, desc: accessoryDesc(c, a, items), photo: a.photo ?? "",
        price_text: ((p) => (p === null ? TEXT_ON_REQUEST : formatUah(p)))(offerPrice(a)) }));
    const order = (g) => (g === "crane" ? 0 : 1);
    return [...cards, ...extra].sort((x, y) => order(x.group) - order(y.group));
}
/** Why the KP_2_v3 generator cannot build a KP for this quote (empty = it can). */
export function kpBlockers(c, q) {
    const out = [];
    const kt = kitTypeById(c, q.kit_type);
    if (!kt)
        return [`Невідомий тип комплекту «${q.kit_type}».`];
    if (kt.generator !== "kp_v3")
        out.push(`Для комплекту «${kt.title}» немає шаблону КП.`);
    const crane = craneOf(c, q);
    const supported = joinUk(SUPPORTED_PROFILES.map((p) => p.replace(/^bmf/, "BMF ")), "і");
    if (!crane)
        out.push("Шаблон KP_2_v3 будує КП лише для комплектів з краном-маніпулятором BMF.");
    else if (!crane.kp_profile || !SUPPORTED_PROFILES.includes(crane.kp_profile)) {
        out.push(`Для ${modelName(crane)} ще немає сторінок КП (є для ${supported}).`);
    }
    else {
        const lack = REQUIRED_CRANE_SPECS.filter((k) => crane.specs?.[k] === undefined || crane.specs?.[k] === "");
        if (lack.length)
            out.push(`У характеристиках ${modelName(crane)} бракує: ${lack.join(", ")}.`);
    }
    const trailer = trailerOf(c, q);
    if (trailer && trailer.family !== "npl" && (!trailer.kp_profile || !SUPPORTED_TRAILER_PROFILES.includes(trailer.kp_profile))) {
        out.push(`Для причепа ${modelName(trailer)} ще немає сторінок КП.`);
    }
    const n = kpRows(q).length;
    if (!n)
        out.push("У КП немає жодної позиції.");
    if (n > MAX_KP_ROWS)
        out.push(`Забагато позицій для сторінки «Вартість»: ${n} (максимум ${MAX_KP_ROWS}).`);
    return out;
}
function kpTitle(c, kt, q) {
    const slots = {};
    for (const r of q.rows)
        if (r.slot)
            slots[r.slot] = r.item_id;
    return kitTitle(c, kt, { slots, choices: {}, accessories: [] });
}
function trailerOf(c, q) {
    return q.rows.map((r) => itemById(c, r.item_id)).find((it) => it?.kind === "trailer");
}
/** BMF trailer kits: what the generator prints on the trailer pages (specs as in the catalog). */
function trailerBlock(c, q) {
    const t = trailerOf(c, q);
    if (!t || t.family === "npl" || !t.kp_profile)
        return null;
    const specs = {};
    for (const [k, v] of Object.entries(t.specs ?? {}))
        if (v !== null && v !== undefined && v !== "")
            specs[k] = String(v);
    return { id: t.id, model: modelName(t), title: t.title, short: t.short, profile: t.kp_profile, specs };
}
function nplBlock(c, q) {
    const npl = q.rows.map((r) => itemById(c, r.item_id)).find((it) => it?.family === "npl");
    if (!npl)
        return null;
    const ch = (id) => q.choices.find((x) => x.id === id);
    const spec = (k) => (npl.specs?.[k] !== undefined ? String(npl.specs[k]) : "");
    return {
        brakes: ch("brakes")?.value_title ?? spec("brakes"),
        wheels: ch("wheels")?.value_title ?? spec("wheels"),
        stakes: ch("stakes")?.value ?? spec("stakes"),
    };
}
/**
 * KpSpec for the generator. Throws KpSpecError (Ukrainian messages) when the KP cannot be built:
 * see kpBlockers, unknown company or terms, more than 7 terms.
 */
export function buildKpSpec(c, settings, q, meta) {
    const errors = kpBlockers(c, q);
    const kt = kitTypeById(c, q.kit_type);
    const companyId = meta.maker ?? settings.company_maker;
    const company = companyById(c, companyId);
    if (!company)
        errors.push(`Невідома компанія «${companyId}» (виробник у КП).`);
    if (!meta.number)
        errors.push("Не задано номер КП.");
    const terms = [];
    for (const t of meta.terms ?? kt?.terms ?? []) {
        if (typeof t === "string") {
            const term = termById(c, t);
            if (term)
                terms.push({ title: term.title, text: term.text });
            else
                errors.push(`Невідома умова співпраці «${t}».`);
        }
        else if (t && typeof t.title === "string" && typeof t.text === "string")
            terms.push({ title: t.title, text: t.text });
        else
            errors.push("Умова співпраці має бути id або {title, text}.");
    }
    if (terms.length > MAX_KP_TERMS)
        errors.push(`Забагато умов співпраці: ${terms.length} (максимум ${MAX_KP_TERMS}).`);
    if (errors.length || !kt || !company)
        throw new KpSpecError(errors);
    const crane = craneOf(c, q);
    const specs = {};
    for (const k of CRANE_SPEC_KEYS) {
        const v = crane.specs?.[k];
        if (v !== undefined && v !== "")
            specs[k] = String(v);
    }
    const rows = kpRows(q);
    const kitItems = q.rows.map((r) => itemById(c, r.item_id)).filter((x) => !!x);
    const addNote = (row, note) => { if (row && !row.desc.includes(note))
        row.desc = row.desc ? `${row.desc}; ${note}` : note; };
    for (const ch of q.choices) {
        const def = kt.choices.find((x) => x.id === ch.id);
        const opt = def?.options.find((o) => o.value === ch.value);
        if (!def || !opt || choiceIsStandard(opt, kitItems))
            continue;
        if (def.slot && !q.rows.some((r) => r.slot === def.slot))
            continue; // its position is not in the kit
        Object.assign(specs, opt.crane_specs ?? {});
        if (opt.crane_note)
            addNote(rows.find((r) => r.item_id === crane.id), opt.crane_note);
        // other options print their KP text on the row of their slot (the first row when the choice has no slot)
        if (opt.note) {
            const slotItem = def.slot ? q.rows.find((r) => r.slot === def.slot)?.item_id : undefined;
            addNote(slotItem ? rows.find((r) => r.item_id === slotItem) : rows[0], opt.note);
        }
    }
    const unpriced = q.price_display === "bundle" ? q.kit_price_uah === null || q.kit_price_uah === undefined
        : rows.every((r) => r.price_text === TEXT_ON_REQUEST);
    const notes = [];
    if (q.eur_applied && q.eur_rate !== null)
        notes.push(`Ціни розраховано за курсом EUR ${formatRate(q.eur_rate)} на ${formatDate(q.date)}.`);
    if (q.discount_pct > 0 && !unpriced)
        notes.push(`Вартість зі знижкою ${formatPct(q.discount_pct)} (без знижки ${formatUah(q.subtotal_uah)}).`);
    const eurTerm = termById(c, "eur_rate");
    if (eurTerm)
        notes.push(eurTerm.text);
    const spec = {
        template: "kp_v3",
        number: meta.number,
        date: formatDate(q.date),
        valid_until: settings.validity_days > 0 ? formatDate(q.valid_until) : "",
        client: meta.client.contact ? { name: meta.client.name, contact: meta.client.contact } : { name: meta.client.name },
        kit_type: q.kit_type,
        title: kpTitle(c, kt, q),
        crane: { id: crane.id, model: modelName(crane), profile: crane.kp_profile, specs },
        npl: nplBlock(c, q),
        trailer: trailerBlock(c, q),
        rows,
        accessories: kpCards(c, settings, kt, q, meta.offer_accessories === true),
        total_text: unpriced ? TEXT_ON_REQUEST : formatUah(q.total_uah),
        price_note: notes.join(" "),
        price_date: formatDate(q.date),
        maker: { name: company.name, line: fillTemplate(kt.maker_line ?? "Виробник: {maker}", { maker: company.name }) },
        contacts: {
            phones: [...company.phones], email: company.email, sites: [...company.sites], address: company.address,
            ...(company.socials?.length ? { socials: [...company.socials] } : {}),
        },
        terms,
    };
    if (meta.photos)
        spec.photos = meta.photos;
    if (meta.accessories_note)
        spec.accessories_note = meta.accessories_note;
    if (meta.cover_text)
        spec.cover_text = meta.cover_text;
    if (meta.file)
        spec.file = meta.file;
    return spec;
}
