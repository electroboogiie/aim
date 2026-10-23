import { fillTemplate, isIsoDate, joinUk } from "./format.js";
/** Crane visual profiles the KP generator supports (generator/kpgen/profiles.py). */
export const SUPPORTED_PROFILES = ["bmf650", "bmf720", "bmf750", "bmf905"];
/** BMF trailer profiles of the generator (drawings and photos for the trailer pages). */
export const SUPPORTED_TRAILER_PROFILES = ["bmf8t2", "bmf10t2", "bmf14t2", "bmf17t2"];
const ITEM_KINDS = ["crane", "trailer", "component", "service"];
const ACCESSORY_GROUPS = ["crane", "trailer", "truck"];
const ROLES = ["maker", "distributor", "both"];
export function itemById(c, id) { return c.items.find((x) => x.id === id); }
export function kitTypeById(c, id) { return c.kit_types.find((x) => x.id === id); }
export function accessoryById(c, id) { return c.accessories.find((x) => x.id === id); }
export function companyById(c, id) { return c.companies.find((x) => x.id === id); }
export function termById(c, id) { return c.texts.terms.find((x) => x.id === id); }
export function presetById(c, id) { return c.presets.find((x) => x.id === id); }
/** Short name for titles and messages: "BMF 750", "НПЛ-10"; the full title when there is none. */
export function modelName(item) { return item.model || item.title; }
export function choiceOption(choice, value) {
    return choice.options.find((o) => o.value === value);
}
export function defaultSelection(kitType, catalog) {
    const slots = {};
    for (const s of kitType.slots)
        slots[s.id] = s.default;
    const choices = {};
    const items = catalog ? selectedItems(catalog, kitType, { slots, choices: {}, accessories: [] }).map((x) => x.item) : [];
    for (const ch of kitType.choices)
        choices[ch.id] = catalog ? choiceDefault(catalog, ch, items) : ch.default;
    return { slots, choices, accessories: [] };
}
/** True when a choice option fits the selected items (an option without a list fits everything). */
export function choiceOptionFits(c, o, items) {
    if (!o.compatible)
        return true;
    const rel = relevant(c, o.compatible, items);
    return rel.length === 0 || rel.every((x) => o.compatible.includes(x.id));
}
/** Whether a relation reference holds for the selection (see Relation). */
export function relationHolds(ref, selection, items) {
    const eq = ref.indexOf("=");
    if (eq > 0)
        return selection.choices?.[ref.slice(0, eq)] === ref.slice(eq + 1);
    const [kind, id] = [ref.slice(0, ref.indexOf(":")), ref.slice(ref.indexOf(":") + 1)];
    if (kind === "slot")
        return !!selection.slots?.[id];
    if (kind === "item")
        return items.some((x) => x.id === id);
    if (kind === "acc")
        return (selection.accessories ?? []).some((a) => a.id === id);
    return false;
}
/** Relations of an option or accessory that do not hold: unmet requires and present excludes (empty = allowed). */
export function relationProblems(x, selection, items) {
    return [...(x.requires ?? []).filter((r) => !relationHolds(r, selection, items)).map((r) => "+" + r),
        ...(x.excludes ?? []).filter((r) => relationHolds(r, selection, items)).map((r) => "-" + r)];
}
/** Human text of a relation reference: "Гальма: пневматичні", "Насос", "BMF 750". */
export function relationLabel(c, kitType, ref) {
    const eq = ref.indexOf("=");
    if (eq > 0) {
        const ch = kitType.choices.find((x) => x.id === ref.slice(0, eq));
        const o = ch?.options.find((x) => x.value === ref.slice(eq + 1));
        return ch ? `${ch.title}: ${o?.title ?? ref.slice(eq + 1)}` : ref;
    }
    const id = ref.slice(ref.indexOf(":") + 1);
    if (ref.startsWith("slot:"))
        return kitType.slots.find((x) => x.id === id)?.title ?? id;
    if (ref.startsWith("item:")) {
        const it = itemById(c, id);
        return it ? modelName(it) : id;
    }
    if (ref.startsWith("acc:"))
        return accessoryById(c, id)?.title ?? id;
    return ref;
}
/** Why the option cannot be chosen with this selection ("" = it can): its items or its relations. */
export function choiceOptionBlock(c, kitType, o, selection, items) {
    if (!choiceOptionFits(c, o, items))
        return `не підходить до ${joinUk(items.map(modelName), "і")}`;
    const p = relationProblems(o, selection, items);
    if (!p.length)
        return "";
    const req = p.filter((x) => x[0] === "+").map((x) => relationLabel(c, kitType, x.slice(1)));
    const exc = p.filter((x) => x[0] === "-").map((x) => relationLabel(c, kitType, x.slice(1)));
    return [req.length ? `потрібно: ${joinUk(req, "і")}` : "", exc.length ? `не разом з: ${joinUk(exc, "і")}` : ""].filter(Boolean).join("; ");
}
/** The option that is standard with the selected items (ChoiceOption.default_for), else Choice.default. */
export function choiceDefault(c, ch, items) {
    const std = ch.options.find((o) => o.default_for && items.some((i) => o.default_for.includes(i.id)));
    if (std)
        return std.value;
    const d = choiceOption(ch, ch.default);
    if (d && choiceOptionFits(c, d, items))
        return ch.default;
    return (ch.options.find((o) => choiceOptionFits(c, o, items)) ?? d ?? ch.options[0]).value;
}
/** The option is the standard one for the selected items (no surcharge, nothing printed). */
export function choiceIsStandard(o, items) {
    return !!o.default_for && items.some((i) => o.default_for.includes(i.id));
}
function cloneSelection(s) {
    return {
        slots: { ...(s.slots ?? {}) },
        choices: { ...(s.choices ?? {}) },
        accessories: (s.accessories ?? []).map((a) => ({ ...a })),
        ...(Array.isArray(s.into) && s.into.length ? { into: [...s.into] } : {}),
    };
}
/** Slots that can go inside the conversion row: optional positions of a kit that has one (not the crane). */
export function intoSlots(kitType) {
    if (!kitType.slots.some((x) => x.id === "conversion"))
        return [];
    return kitType.slots.filter((x) => !x.required && x.id !== "crane" && x.id !== "conversion").map((x) => x.id);
}
/** Every slot present (missing ones are empty), missing choices get their default (with the catalog: for the items). */
export function normalizeSelection(kitType, selection, catalog) {
    const s = cloneSelection(selection);
    const slots = {};
    for (const slot of kitType.slots)
        slots[slot.id] = s.slots[slot.id] ?? null;
    const items = catalog ? selectedItems(catalog, kitType, { slots, choices: {}, accessories: [] }).map((x) => x.item) : [];
    const choices = {};
    for (const ch of kitType.choices)
        choices[ch.id] = s.choices[ch.id] ?? (catalog ? choiceDefault(catalog, ch, items) : ch.default);
    const ok = intoSlots(kitType);
    const into = (s.into ?? []).filter((x, i, a) => ok.includes(x) && !!slots[x] && a.indexOf(x) === i);
    return { slots, choices, accessories: s.accessories, ...(into.length ? { into } : {}) };
}
/** A copy of the preset's selection; with the catalog it is also normalized for its kit type. */
export function presetSelection(preset, catalog) {
    const s = cloneSelection(preset.selection);
    const kt = catalog ? kitTypeById(catalog, preset.kit_type) : undefined;
    return kt ? normalizeSelection(kt, s, catalog) : s;
}
/** Items chosen in the kit's slots, in slot order (unknown ids are skipped). */
export function selectedItems(c, kitType, selection) {
    const out = [];
    for (const slot of kitType.slots) {
        const id = selection.slots?.[slot.id];
        const item = id ? itemById(c, id) : undefined;
        if (item)
            out.push({ slot, item });
    }
    return out;
}
function kindsOf(c, ids) {
    const kinds = new Set();
    for (const id of ids) {
        const it = itemById(c, id);
        if (it)
            kinds.add(it.kind);
    }
    return kinds;
}
/** Items among `others` that a compatibility list speaks about (same kind as the listed ids). */
function relevant(c, list, others) {
    const kinds = kindsOf(c, list);
    return others.filter((o) => kinds.has(o.kind));
}
/**
 * Item.compatible: every other selected item of a kind the list names must be in the list.
 * Nothing of that kind selected (e.g. no crane yet) is not a conflict.
 */
export function itemFits(c, item, others) {
    if (!item.compatible)
        return true;
    return relevant(c, item.compatible, others.filter((o) => o.id !== item.id)).every((o) => item.compatible.includes(o.id));
}
function fitMessage(c, slot, item, others) {
    const list = (item.compatible ?? []).map((id) => itemById(c, id)).filter((x) => !!x).map(modelName);
    const bad = relevant(c, item.compatible ?? [], others).filter((o) => !item.compatible.includes(o.id)).map(modelName);
    return `Позиція «${slot.title}»: «${item.title}» підходить лише до ${joinUk(list, "і")}, а в комплекті ${joinUk(bad, "і")}.`;
}
/** Candidates of a slot with what the rest of the selection allows (for pickers in the UI). */
export function slotCandidates(c, kitTypeId, slotId, selection) {
    const kt = kitTypeById(c, kitTypeId);
    const slot = kt?.slots.find((s) => s.id === slotId);
    if (!kt || !slot)
        return [];
    const others = selectedItems(c, kt, selection).filter((x) => x.slot.id !== slotId).map((x) => x.item);
    return slot.candidates.map((id) => {
        const item = itemById(c, id);
        if (!item)
            return { id, item, allowed: false, reason: `Невідомий виріб «${id}».` };
        if (itemFits(c, item, others) && others.every((o) => itemFits(c, o, [item])))
            return { id, item, allowed: true };
        const blocker = !itemFits(c, item, others) ? fitMessage(c, slot, item, others)
            : `«${item.title}» не сумісний з обраним комплектом.`;
        return { id, item, allowed: false, reason: blocker };
    });
}
/** Compatibility of an accessory with the selected items (see CONTRACTS §2.2). */
export function accessoryStatus(c, acc, items) {
    if (!acc.compatible)
        return "ok";
    const rel = relevant(c, acc.compatible, items);
    if (rel.length && rel.every((o) => acc.compatible.includes(o.id)))
        return "ok";
    const unconf = acc.compatible_unconfirmed ?? [];
    const relU = items.filter((o) => unconf.includes(o.id));
    if (relU.length && rel.every((o) => acc.compatible.includes(o.id) || unconf.includes(o.id)))
        return "unconfirmed";
    return "incompatible";
}
/** Variants that fit the selected items (a variant without a list fits everything). */
export function accessoryVariants(c, acc, items) {
    return (acc.variants ?? []).filter((v) => variantFits(c, v, items));
}
function variantFits(c, v, items) {
    if (!v.compatible)
        return true;
    const rel = relevant(c, v.compatible, items);
    return rel.length === 0 || rel.some((o) => v.compatible.includes(o.id));
}
const MAX_LISTED_VARIANTS = 6;
/**
 * Card / row text of an accessory: its desc plus the variants that fit the kit
 * ("Для BMF 750: C20, C24 або C27."), or all variants when the kit does not narrow them.
 */
export function accessoryDesc(c, acc, items, variantId) {
    const all = acc.variants ?? [];
    if (variantId) {
        const v = all.find((x) => x.id === variantId);
        if (v)
            return v.desc || acc.desc;
    }
    if (!all.length)
        return acc.desc;
    const fit = accessoryVariants(c, acc, items);
    const narrowed = fit.length < all.length;
    if (!fit.length || (!narrowed && all.length > MAX_LISTED_VARIANTS))
        return acc.desc;
    const listed = all.filter((v) => v.compatible);
    const subject = narrowed && listed.length
        ? items.filter((o) => listed.some((v) => relevant(c, v.compatible, [o]).length > 0)).map(modelName)
        : [];
    const head = narrowed && subject.length ? `Для ${joinUk(subject, "і")}` : "Варіанти";
    return `${acc.desc} ${head}: ${joinUk(fit.map((v) => v.title))}.`;
}
/** Accessories offered for the kit (its accessory groups), with compatibility against the selection. */
export function kitAccessories(c, kitTypeId, selection) {
    const kt = kitTypeById(c, kitTypeId);
    if (!kt)
        return [];
    const items = selectedItems(c, kt, selection).map((x) => x.item);
    return c.accessories
        .filter((a) => !a.disabled && kt.accessory_groups.includes(a.group))
        .map((a) => ({ accessory: a, status: accessoryStatus(c, a, items), variants: accessoryVariants(c, a, items),
        desc: accessoryDesc(c, a, items) }));
}
/** Bundle of the kit type whose slots equal the non-empty selected slots exactly. */
export function findBundle(c, kitTypeId, slots) {
    const chosen = Object.entries(slots).filter(([, v]) => !!v);
    return c.bundles.find((b) => {
        if (b.kit_type !== kitTypeId)
            return false;
        const keys = Object.keys(b.slots);
        return keys.length === chosen.length && chosen.every(([k, v]) => b.slots[k] === v);
    });
}
/** Kit name from the models in KitType.title_slots: "НПЛ-10 + BMF 750"; the kit type title when there are none. */
export function kitTitle(c, kitType, selection) {
    const parts = (kitType.title_slots ?? [])
        .map((id) => selection.slots?.[id])
        .map((id) => (id ? itemById(c, id) : undefined))
        .filter((x) => !!x)
        .map(modelName);
    return parts.length ? parts.join(" + ") : kitType.title;
}
/** Row text of an item: desc_template filled with the chosen options (short or title), else short. */
export function itemDesc(kitType, item, selection) {
    if (!item.desc_template)
        return item.short;
    const vars = {};
    for (const ch of kitType.choices) {
        const o = choiceOption(ch, selection.choices?.[ch.id] ?? ch.default);
        if (o)
            vars[ch.id] = o.short ?? o.title;
    }
    // a choice switched off in this kit (settings) leaves its placeholder: drop it with its separator
    return fillTemplate(item.desc_template, vars).replace(/\s*·\s*\{\w+\}/g, "").replace(/\{\w+\}\s*·\s*/g, "").replace(/\{\w+\}/g, "").trim();
}
/**
 * After the manager changed one slot: items in other slots that no longer fit are replaced by the slot default
 * or the first candidate that fits (optional slots are emptied when none fits); accessories that became
 * incompatible and variants that no longer fit are dropped. Choices get defaults.
 */
export function reconcileSelection(c, kitTypeId, selection, changedSlot) {
    const kt = kitTypeById(c, kitTypeId);
    if (!kt)
        return cloneSelection(selection);
    const s = normalizeSelection(kt, selection, c);
    const order = kt.slots.filter((x) => x.id !== changedSlot);
    for (const slot of order) {
        const id = s.slots[slot.id];
        const item = id ? itemById(c, id) : undefined;
        if (!item)
            continue;
        const others = () => selectedItems(c, kt, s).filter((x) => x.slot.id !== slot.id).map((x) => x.item);
        const fits = (it) => itemFits(c, it, others()) && others().every((o) => itemFits(c, o, [it]));
        if (fits(item))
            continue;
        const pool = [slot.default, ...slot.candidates].filter((x) => !!x);
        const repl = pool.map((x) => itemById(c, x)).find((it) => !!it && fits(it));
        if (repl)
            s.slots[slot.id] = repl.id;
        else if (!slot.required)
            s.slots[slot.id] = null;
    }
    const items = selectedItems(c, kt, s).map((x) => x.item);
    for (const ch of kt.choices) {
        const o = choiceOption(ch, s.choices[ch.id]);
        const slotChanged = !!changedSlot && ch.slot === changedSlot && ch.options.some((x) => x.default_for);
        if (!o || !choiceOptionFits(c, o, items) || slotChanged)
            s.choices[ch.id] = choiceDefault(c, ch, items);
    }
    // relations: an option whose requirements no longer hold falls back to the default, then to the first allowed one
    for (let pass = 0; pass < 3; pass++) {
        for (const ch of kt.choices) {
            const o = choiceOption(ch, s.choices[ch.id]);
            if (!o || !relationProblems(o, s, items).length)
                continue;
            const d = choiceOption(ch, choiceDefault(c, ch, items));
            const ok = [d, ...ch.options].find((x) => x && choiceOptionFits(c, x, items) && !relationProblems(x, s, items).length);
            if (ok)
                s.choices[ch.id] = ok.value;
        }
    }
    s.accessories = s.accessories
        .filter((a) => {
        const acc = accessoryById(c, a.id);
        return !!acc && !acc.disabled && kt.accessory_groups.includes(acc.group) && accessoryStatus(c, acc, items) !== "incompatible"
            && !relationProblems(acc, s, items).length;
    })
        .map((a) => {
        const acc = accessoryById(c, a.id);
        if (a.variant && !accessoryVariants(c, acc, items).some((v) => v.id === a.variant))
            return { ...a, variant: null };
        return a;
    });
    return s;
}
const isObj = (x) => typeof x === "object" && x !== null && !Array.isArray(x);
const isMoney = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0;
/** Errors of a quote input against the catalog (unknown ids, slots, choices, accessories, manual prices). */
export function validateSelection(c, input) {
    const errors = [];
    if (!isObj(input))
        return ["Запит на розрахунок має бути об’єктом."];
    const kt = typeof input.kit_type === "string" ? kitTypeById(c, input.kit_type) : undefined;
    if (!kt)
        return [`Невідомий тип комплекту «${String(input.kit_type ?? "")}».`];
    const sel = input.selection;
    if (!isObj(sel))
        return ["Не передано вибір комплекту (selection)."];
    const slots = sel.slots ?? {};
    const choices = sel.choices ?? {};
    const accs = sel.accessories ?? [];
    if (!isObj(slots))
        errors.push("selection.slots має бути об’єктом.");
    if (!isObj(choices))
        errors.push("selection.choices має бути об’єктом.");
    if (!Array.isArray(accs))
        errors.push("selection.accessories має бути списком.");
    if (errors.length)
        return errors;
    const sl = slots;
    const chs = choices;
    for (const key of Object.keys(sl)) {
        if (!kt.slots.some((s) => s.id === key))
            errors.push(`Невідома позиція «${key}» для комплекту «${kt.title}».`);
    }
    const picked = [];
    for (const slot of kt.slots) {
        const v = sl[slot.id];
        if (v === undefined || v === null || v === "") {
            if (slot.required)
                errors.push(`Не обрано обов’язкову позицію «${slot.title}».`);
            continue;
        }
        if (typeof v !== "string") {
            errors.push(`Позиція «${slot.title}»: id виробу має бути рядком.`);
            continue;
        }
        const item = itemById(c, v);
        if (!item) {
            errors.push(`Позиція «${slot.title}»: невідомий виріб «${v}».`);
            continue;
        }
        if (!slot.candidates.includes(v)) {
            errors.push(`Позиція «${slot.title}»: «${item.title}» не можна обрати в комплекті «${kt.title}».`);
            continue;
        }
        picked.push({ slot, item });
    }
    for (const p of picked) {
        const others = picked.filter((x) => x !== p).map((x) => x.item);
        if (!itemFits(c, p.item, others))
            errors.push(fitMessage(c, p.slot, p.item, others));
    }
    for (const key of Object.keys(chs)) {
        const ch = kt.choices.find((x) => x.id === key);
        if (!ch) {
            errors.push(`Невідомий параметр «${key}» для комплекту «${kt.title}».`);
            continue;
        }
        const v = chs[key];
        const o = typeof v === "string" ? choiceOption(ch, v) : undefined;
        if (!o)
            errors.push(`Невідоме значення «${String(v)}» для параметра «${ch.title}».`);
        else if (!choiceOptionFits(c, o, picked.map((x) => x.item))) {
            errors.push(`${ch.title}: «${o.title}» не підходить до ${joinUk(picked.map((x) => modelName(x.item)), "і")}.`);
        }
        else {
            const why = choiceOptionBlock(c, kt, o, sel, picked.map((x) => x.item));
            if (why)
                errors.push(`${ch.title}: «${o.title}» — ${why}.`);
        }
    }
    const items = picked.map((x) => x.item);
    const seen = new Set();
    for (const raw of accs) {
        if (!isObj(raw) || typeof raw.id !== "string") {
            errors.push("Опція має містити id.");
            continue;
        }
        const acc = accessoryById(c, raw.id);
        if (!acc) {
            errors.push(`Невідома опція «${raw.id}».`);
            continue;
        }
        if (seen.has(acc.id)) {
            errors.push(`Опцію «${acc.title}» додано двічі.`);
            continue;
        }
        seen.add(acc.id);
        if (!kt.accessory_groups.includes(acc.group)) {
            errors.push(`Опція «${acc.title}» недоступна для комплекту «${kt.title}».`);
            continue;
        }
        if (acc.disabled) {
            errors.push(`Опцію «${acc.title}» вимкнено в налаштуваннях.`);
            continue;
        }
        const rel = relationProblems(acc, sel, items);
        if (rel.length) {
            const req = rel.filter((x) => x[0] === "+").map((x) => relationLabel(c, kt, x.slice(1)));
            const exc = rel.filter((x) => x[0] === "-").map((x) => relationLabel(c, kt, x.slice(1)));
            errors.push(`Опція «${acc.title}»: ${[req.length ? `потрібно: ${joinUk(req, "і")}` : "", exc.length ? `не разом з: ${joinUk(exc, "і")}` : ""].filter(Boolean).join("; ")}.`);
            continue;
        }
        if (accessoryStatus(c, acc, items) === "incompatible") {
            const names = items.length ? joinUk(items.map(modelName), "і") : "порожнім комплектом";
            errors.push(`Опція «${acc.title}» несумісна з ${names}.`);
            continue;
        }
        if (raw.variant !== undefined && raw.variant !== null && raw.variant !== "") {
            const v = (acc.variants ?? []).find((x) => x.id === raw.variant);
            if (!v)
                errors.push(`Опція «${acc.title}»: невідомий варіант «${String(raw.variant)}».`);
            else if (!variantFits(c, v, items))
                errors.push(`Опція «${acc.title}»: варіант «${v.title}» не підходить до цього комплекту.`);
        }
        if (raw.price_uah !== undefined && raw.price_uah !== null && !isMoney(raw.price_uah)) {
            errors.push(`Опція «${acc.title}»: ціна має бути невід’ємним числом.`);
        }
    }
    if (input.discount_pct !== undefined && input.discount_pct !== null) {
        const d = input.discount_pct;
        if (typeof d !== "number" || !Number.isFinite(d) || d < 0)
            errors.push("Знижка має бути невід’ємним числом відсотків.");
    }
    if (input.manual_prices !== undefined && input.manual_prices !== null) {
        if (!isObj(input.manual_prices))
            errors.push("manual_prices має бути об’єктом «id виробу → ціна».");
        else {
            for (const [id, v] of Object.entries(input.manual_prices)) {
                const it = itemById(c, id);
                if (!it)
                    errors.push(`Ручна ціна для невідомого виробу «${id}».`);
                else if (!isMoney(v))
                    errors.push(`Ручна ціна для «${it.title}» має бути невід’ємним числом.`);
            }
        }
    }
    if (input.kit_price_uah !== undefined && input.kit_price_uah !== null) {
        if (kt.price_display !== "bundle")
            errors.push("Ручна ціна комплекту можлива лише для комплектів з єдиною ціною.");
        else if (!isMoney(input.kit_price_uah))
            errors.push("Ціна комплекту має бути невід’ємним числом.");
    }
    if (input.quantities !== undefined && input.quantities !== null) {
        if (!isObj(input.quantities))
            errors.push("quantities має бути об’єктом «id виробу → кількість».");
        else {
            for (const [id, v] of Object.entries(input.quantities)) {
                const it = itemById(c, id);
                if (!it)
                    errors.push(`Кількість для невідомого виробу «${id}».`);
                else if (!it.unit)
                    errors.push(`«${it.title}» не продається на кількість.`);
                else if (!(typeof v === "number" && Number.isFinite(v) && v > 0))
                    errors.push(`Кількість «${it.title}» має бути додатним числом.`);
            }
        }
    }
    if (input.date !== undefined && input.date !== null && !isIsoDate(input.date)) {
        errors.push(`Невірна дата «${String(input.date)}» (потрібно РРРР-ММ-ДД).`);
    }
    return errors;
}
// ------------------------------------------------------------------ catalog validation
function checkPrice(p, where, errors) {
    if (!isObj(p)) {
        errors.push(`${where}: немає правила ціни.`);
        return;
    }
    const num = (v, name, opt = false) => {
        if (opt && (v === undefined || v === null))
            return;
        if (!isMoney(v))
            errors.push(`${where}: price.${name} має бути невід’ємним числом.`);
    };
    const group = (g) => { if (typeof g !== "string" || !g)
        errors.push(`${where}: price.group порожня.`); };
    switch (p.mode) {
        case "eur":
            num(p.eur, "eur");
            group(p.group);
            break;
        case "cost":
            if (!Array.isArray(p.metal))
                errors.push(`${where}: price.metal має бути списком.`);
            else
                p.metal.forEach((m, i) => {
                    if (!m || typeof m.grade !== "string" || !m.grade)
                        errors.push(`${where}: price.metal[${i}].grade порожній.`);
                    num(m?.kg, `metal[${i}].kg`);
                });
            num(p.components_eur, "components_eur", true);
            num(p.hours, "hours", true);
            num(p.paint_uah, "paint_uah", true);
            group(p.group);
            break;
        case "ref": {
            const pt = (x, name) => {
                if (!isMoney(x.uah))
                    errors.push(`${where}: ${name}.uah має бути невід’ємним числом.`);
                if (!isIsoDate(x.date))
                    errors.push(`${where}: ${name}.date має бути датою РРРР-ММ-ДД.`);
                for (const k of ["eur_rate_ref", "metal_index_ref"]) {
                    const v = x[k];
                    if (v !== undefined && v !== null && !(typeof v === "number" && v > 0))
                        errors.push(`${where}: ${name}.${k} має бути додатним числом або null.`);
                }
            };
            pt(p, "price");
            (p.history ?? []).forEach((h, i) => pt(h, `price.history[${i}]`));
            const share = (v, n) => {
                if (typeof v !== "number" || !(v >= 0 && v <= 1))
                    errors.push(`${where}: price.${n} має бути від 0 до 1.`);
            };
            share(p.eur_share, "eur_share");
            share(p.metal_share, "metal_share");
            if (p.eur_share + p.metal_share > 1 + 1e-9)
                errors.push(`${where}: eur_share + metal_share більше 1.`);
            group(p.group);
            break;
        }
        case "on_request":
        case "included": break;
        default: errors.push(`${where}: невідомий режим ціни «${String(p.mode)}».`);
    }
}
function dupes(ids) {
    const seen = new Set();
    const out = new Set();
    for (const id of ids) {
        if (seen.has(id))
            out.add(id);
        seen.add(id);
    }
    return [...out];
}
/** Structural and referential checks of catalog.json; every preset must pass validateSelection. */
export function validateCatalog(c) {
    const errors = [];
    if (!isObj(c))
        return ["Каталог має бути JSON-об’єктом."];
    for (const k of ["companies", "items", "kit_types", "presets", "accessories", "bundles"]) {
        if (!Array.isArray(c[k]))
            errors.push(`Каталог: поле ${k} має бути списком.`);
    }
    if (!isObj(c.texts) || !Array.isArray(c.texts.terms) || !Array.isArray(c.texts.advantages) || !isObj(c.texts.notes)) {
        errors.push("Каталог: texts має містити terms, advantages і notes.");
    }
    if (errors.length)
        return errors;
    if (typeof c.version !== "string" || !c.version)
        errors.push("Каталог: не задано version.");
    const coll = [["companies", c.companies], ["items", c.items], ["kit_types", c.kit_types],
        ["presets", c.presets], ["accessories", c.accessories], ["bundles", c.bundles], ["texts.terms", c.texts.terms]];
    for (const [name, list] of coll) {
        list.forEach((x, i) => { if (!x || typeof x.id !== "string" || !x.id)
            errors.push(`${name}[${i}]: немає id.`); });
        for (const d of dupes(list.map((x) => x?.id)))
            errors.push(`${name}: id «${d}» повторюється.`);
    }
    for (const co of c.companies) {
        const w = `Компанія «${co.id}»`;
        for (const k of ["name", "short", "address", "email"])
            if (typeof co[k] !== "string" || !co[k])
                errors.push(`${w}: порожнє поле ${k}.`);
        if (!Array.isArray(co.phones) || !co.phones.length)
            errors.push(`${w}: немає телефонів.`);
        if (!Array.isArray(co.sites) || !co.sites.length)
            errors.push(`${w}: немає сайтів.`);
        if (!ROLES.includes(co.role))
            errors.push(`${w}: невідома роль «${co.role}».`);
    }
    const itemIds = new Set(c.items.map((x) => x.id));
    const refItems = (list, where) => {
        if (list === undefined)
            return;
        if (!Array.isArray(list)) {
            errors.push(`${where}: має бути списком id.`);
            return;
        }
        for (const id of list)
            if (!itemIds.has(id))
                errors.push(`${where}: невідомий виріб «${String(id)}».`);
    };
    const photoOk = (p, where) => {
        if (p === undefined || p === "")
            return;
        if (typeof p !== "string" || p.startsWith("/") || p.split("/").includes("..") || p.includes("\\")) {
            errors.push(`${where}: шлях до фото має бути відносним шляхом у generator/assets.`);
        }
    };
    for (const it of c.items) {
        const w = `Виріб «${it.id}»`;
        if (!ITEM_KINDS.includes(it.kind))
            errors.push(`${w}: невідомий kind «${it.kind}».`);
        for (const k of ["family", "title", "short", "source"])
            if (typeof it[k] !== "string" || !it[k])
                errors.push(`${w}: порожнє поле ${k}.`);
        checkPrice(it.price, w, errors);
        refItems(it.compatible, `${w}, compatible`);
        photoOk(it.photo, w);
        if (it.unit !== undefined) {
            const u = it.unit;
            if (!isObj(u) || typeof u.name !== "string" || !u.name || typeof u.title !== "string" || !u.title.includes("{qty}")
                || !(typeof u.per === "number" && u.per > 0) || !(typeof u.default === "number" && u.default > 0)) {
                errors.push(`${w}: unit має містити name, per > 0, default > 0 і title з {qty}.`);
            }
        }
        if (it.specs !== undefined && !isObj(it.specs))
            errors.push(`${w}: specs має бути об’єктом.`);
        if (it.kp_profile !== undefined && it.kp_profile !== null) {
            if (it.kind === "trailer") {
                if (!SUPPORTED_TRAILER_PROFILES.includes(it.kp_profile))
                    errors.push(`${w}: генератор не має профілю причепа «${it.kp_profile}».`);
            }
            else {
                if (!SUPPORTED_PROFILES.includes(it.kp_profile))
                    errors.push(`${w}: генератор не має профілю «${it.kp_profile}».`);
                if (it.kind !== "crane")
                    errors.push(`${w}: kp_profile задається лише для кранів і причепів BMF.`);
                for (const k of ["reach_m", "torque_knm", "lift_4m_kg", "lift_full_kg", "grapple_m2", "rotator_t", "turn_deg"]) {
                    if (!it.specs || it.specs[k] === undefined || it.specs[k] === "")
                        errors.push(`${w}: для КП бракує характеристики ${k}.`);
                }
            }
        }
        for (const t of [it.title, it.short, it.desc_template]) {
            if (typeof t === "string" && /автономн\S*\s+гідравл/i.test(t))
                errors.push(`${w}: «автономна гідравліка» не пишеться в описі позиції (лише в характеристиках).`);
        }
        if (it.kind === "crane" && (!it.includes || !it.includes.some((x) => x.startsWith("ротатор")) || !it.includes.some((x) => x.startsWith("захват")))) {
            errors.push(`${w}: кран BMF постачається з ротатором і захватом (includes).`);
        }
    }
    const termIds = new Set(c.texts.terms.map((t) => t.id));
    for (const kt of c.kit_types) {
        const w = `Тип комплекту «${kt.id}»`;
        if (kt.price_display !== "itemized" && kt.price_display !== "bundle")
            errors.push(`${w}: невідомий price_display.`);
        if (kt.generator !== "kp_v3")
            errors.push(`${w}: невідомий generator «${String(kt.generator)}».`);
        if (!Array.isArray(kt.slots) || !kt.slots.length) {
            errors.push(`${w}: немає позицій (slots).`);
            continue;
        }
        for (const d of dupes(kt.slots.map((s) => s.id)))
            errors.push(`${w}: позиція «${d}» повторюється.`);
        for (const s of kt.slots) {
            refItems(s.candidates, `${w}, позиція «${s.id}»`);
            if (s.default !== null && !s.candidates.includes(s.default))
                errors.push(`${w}, позиція «${s.id}»: default не серед кандидатів.`);
            if (s.required && s.default === null)
                errors.push(`${w}, позиція «${s.id}»: обов’язкова позиція без default.`);
        }
        for (const d of dupes(kt.choices.map((x) => x.id)))
            errors.push(`${w}: параметр «${d}» повторюється.`);
        for (const ch of kt.choices)
            if (ch.slot !== undefined && !kt.slots.some((x) => x.id === ch.slot))
                errors.push(`${w}, параметр «${ch.id}»: невідома позиція «${ch.slot}».`);
        for (const s of kt.slots)
            if (s.priced && kt.price_display !== "bundle")
                errors.push(`${w}, позиція «${s.id}»: priced лише для комплектів з єдиною ціною.`);
        for (const ch of kt.choices) {
            for (const d of dupes(ch.options.map((o) => o.value)))
                errors.push(`${w}, параметр «${ch.id}»: значення «${d}» повторюється.`);
            if (!choiceOption(ch, ch.default))
                errors.push(`${w}, параметр «${ch.id}»: default не серед значень.`);
            for (const o of ch.options)
                if (o.price_uah !== undefined && !isMoney(o.price_uah))
                    errors.push(`${w}, «${ch.id}=${o.value}»: price_uah має бути невід’ємним числом.`);
            for (const o of ch.options) {
                refItems(o.compatible, `${w}, «${ch.id}=${o.value}» compatible`);
                refItems(o.default_for, `${w}, «${ch.id}=${o.value}» default_for`);
            }
        }
        for (const g of kt.accessory_groups)
            if (!ACCESSORY_GROUPS.includes(g))
                errors.push(`${w}: невідома група опцій «${g}».`);
        for (const s of kt.title_slots ?? [])
            if (!kt.slots.some((x) => x.id === s))
                errors.push(`${w}: title_slots — невідома позиція «${s}».`);
        for (const t of kt.terms ?? [])
            if (!termIds.has(t))
                errors.push(`${w}: невідома умова «${t}».`);
        if (kt.price_display === "bundle" && kt.id === "npl_crane" && kt.slots.filter((x) => !x.priced).length !== 2)
            errors.push(`${w}: комплект НПЛ-10 має рівно 2 позиції.`);
        const def = defaultSelection(kt, c);
        for (const e of validateSelection(c, { kit_type: kt.id, selection: def }))
            errors.push(`${w}, вибір за замовчуванням: ${e}`);
    }
    const bundleKeys = new Set();
    for (const b of c.bundles) {
        const w = `Комплект-ціна «${b.id}»`;
        const kt = kitTypeById(c, b.kit_type);
        if (!kt) {
            errors.push(`${w}: невідомий тип комплекту «${b.kit_type}».`);
            continue;
        }
        if (kt.price_display !== "bundle")
            errors.push(`${w}: тип «${kt.id}» не має єдиної ціни (price_display).`);
        if (!isObj(b.slots) || !Object.keys(b.slots).length) {
            errors.push(`${w}: порожні slots.`);
            continue;
        }
        for (const [sid, iid] of Object.entries(b.slots)) {
            const slot = kt.slots.find((s) => s.id === sid);
            if (!slot)
                errors.push(`${w}: невідома позиція «${sid}».`);
            else if (!slot.candidates.includes(iid))
                errors.push(`${w}: «${iid}» не є кандидатом позиції «${sid}».`);
        }
        const errs = validateSelection(c, { kit_type: kt.id, selection: { slots: b.slots, choices: {}, accessories: [] } });
        for (const e of errs)
            errors.push(`${w}: ${e}`);
        const key = kt.id + "|" + JSON.stringify(Object.entries(b.slots).sort());
        if (bundleKeys.has(key))
            errors.push(`${w}: такий самий набір позицій уже має іншу ціну.`);
        bundleKeys.add(key);
        checkPrice(b.price, w, errors);
        if (typeof b.source !== "string" || !b.source)
            errors.push(`${w}: не вказано джерело.`);
    }
    for (const a of c.accessories) {
        const w = `Опція «${a.id}»`;
        if (!ACCESSORY_GROUPS.includes(a.group))
            errors.push(`${w}: невідома група «${a.group}».`);
        for (const k of ["title", "desc", "source"])
            if (typeof a[k] !== "string" || !a[k])
                errors.push(`${w}: порожнє поле ${k}.`);
        if (typeof a.photo !== "string")
            errors.push(`${w}: photo має бути рядком (порожній — без фото).`);
        photoOk(a.photo, w);
        checkPrice(a.price, w, errors);
        refItems(a.compatible, `${w}, compatible`);
        refItems(a.compatible_unconfirmed, `${w}, compatible_unconfirmed`);
        for (const d of dupes((a.variants ?? []).map((v) => v.id)))
            errors.push(`${w}: варіант «${d}» повторюється.`);
        for (const v of a.variants ?? []) {
            refItems(v.compatible, `${w}, варіант «${v.id}»`);
            photoOk(v.photo, `${w}, варіант «${v.id}»`);
        }
    }
    for (const p of c.presets) {
        const w = `Пресет «${p.id}»`;
        const kt = kitTypeById(c, p.kit_type);
        if (!kt) {
            errors.push(`${w}: невідомий тип комплекту «${p.kit_type}».`);
            continue;
        }
        for (const e of validateSelection(c, { kit_type: p.kit_type, selection: p.selection }))
            errors.push(`${w}: ${e}`);
        const s = p.source;
        if (!isObj(s) || typeof s.file !== "string" || !s.file)
            errors.push(`${w}: не вказано файл-джерело.`);
        else {
            if (s.date !== "" && !isIsoDate(s.date))
                errors.push(`${w}: source.date має бути РРРР-ММ-ДД або "".`);
            if (s.total_uah !== null && !isMoney(s.total_uah))
                errors.push(`${w}: source.total_uah має бути числом або null.`);
            for (const r of s.rows ?? [])
                if (!r || typeof r.title !== "string" || !isMoney(r.price_uah))
                    errors.push(`${w}: невірний рядок source.rows.`);
        }
    }
    return errors;
}
