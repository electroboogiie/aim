// Конфігуратор: 1 комплект або пресет → 2 позиції й параметри → 3 опції → 4 клієнт і ціна → 5 підсумок і «Сформувати КП».
import type { Accessory, Catalog, Item, KitType, Preset, Quote, QuoteRow, Selection, Slot } from "../../../core/src/index.js";
import {
  TEXT_IN_KIT, TEXT_ON_REQUEST, accessoryById, eurRate, formatDate, formatPct, formatRate, formatUah, itemById, itemPrice,
  kitAccessories, kitTitle, kitTypeById, presetById, presetSelection, priceRule, reconcileSelection, slotCandidates, todayIso,
  validateSelection,
} from "../../../core/src/index.js";
import type { Child } from "../dom.js";
import { h, icon, mount, clear } from "../dom.js";
import { ctx, isDemo, onCtxChange } from "../app.js";
import { ApiError } from "../api.js";
import { DEMO_NO_FILES } from "../demo.js";
import type { Preview } from "../draft.js";
import { STEPS, getDraft, preview, resetDraft, saveDraft, startKit, startPreset } from "../draft.js";
import { craneReadiness, itemName, kitShort, kpReadiness, selectionPhoto, specRows } from "../labels.js";
import { badge, dialog, field, heading, hud, notice, parseAmount, sectionTitle, thumb, toast } from "../ui.js";
import { KEYS, local } from "../storage.js";
import type { View } from "../router.js";
import { navigate } from "../router.js";

const STEP_HEAD: Record<number, [string, string, string]> = {
  1: ["01 — КОМПЛЕКТ", "ОБЕРІТЬ", "КОМПЛЕКТ."],
  2: ["02 — КОНФІГУРАЦІЯ", "ЗБЕРІТЬ", "ПІД ВАШУ ЗАДАЧУ."],
  3: ["03 — ОПЦІЇ", "ДОДАТКОВІ", "ОПЦІЇ."],
  4: ["04 — КЛІЄНТ", "КЛІЄНТ", "І УМОВИ."],
  5: ["05 — ВАРТІСТЬ", "ОДНА ЦІНА.", "ПОВНИЙ КОМПЛЕКТ."],
};

const GROUP_TITLES: Record<string, string> = { crane: "Для крана", trailer: "Для причепа" };

interface ServerQuote { key: string; quote: Quote | null; errors: string[]; loading: boolean }

export class ConfiguratorView implements View {
  private root!: HTMLElement;
  private unsub: (() => void) | null = null;
  private server: ServerQuote | null = null;
  private presetFilter = local.get(KEYS.presetFilter) ?? "all";
  private presetSearch = "";
  private showArchived = false;
  private focusHeading = false;
  private fieldErrors: Record<string, string> = {};
  private busy = false;

  mount(root: HTMLElement): void {
    this.root = root;
    this.unsub = onCtxChange(() => { this.server = null; this.render(); });
    this.render();
  }

  unmount(): void {
    this.unsub?.();
    const dock = document.getElementById("dock");
    if (dock) { clear(dock); dock.hidden = true; }
    document.body.classList.remove("has-dock");
  }

  // ------------------------------------------------------------------ render

  private render(): void {
    const d = getDraft();
    if (!d.kit_type && d.step !== 1) d.step = 1;
    const p = preview();
    const active = document.activeElement as HTMLElement | null;
    const focusId = active && this.root.contains(active) ? active.id : "";

    const [label, l1, l2] = STEP_HEAD[d.step]!;
    const content = this.stepContent(d.step, p);
    const kt = d.kit_type ? kitTypeById(ctx().catalog, d.kit_type) : undefined;

    mount(this.root,
      h("div", { class: "cfg" },
        h("div", { class: "cfg__head" },
          hud(label),
          heading(l1, l2, "step-title"),
          this.stepper(d.step, !!kt)),
        h("div", { class: kt && d.step > 1 ? "cfg__grid" : "cfg__grid cfg__grid--wide" },
          h("section", { class: "cfg__main", "aria-labelledby": "step-title" },
            content,
            kt ? this.stepNav(d.step, p) : null),
          kt && d.step > 1 ? this.aside(kt, p) : null)));

    this.renderDock(kt, p);
    if (this.focusHeading) {
      this.focusHeading = false;
      document.getElementById("step-title")?.focus({ preventScroll: true });
    } else if (focusId) {
      document.getElementById(focusId)?.focus({ preventScroll: true });
    }
    if (d.step === 5) this.ensureServerQuote(p);
  }

  /** Update the parts that depend on the quote only (typing in inputs must not rebuild the form). */
  private refreshTotals(): void {
    const d = getDraft();
    const kt = d.kit_type ? kitTypeById(ctx().catalog, d.kit_type) : undefined;
    const p = preview();
    this.renderDock(kt, p);
    const aside = this.root.querySelector(".cfg__aside");
    if (aside && kt) aside.replaceWith(this.aside(kt, p));
  }

  private go(step: number): void {
    const d = getDraft();
    if (step < 1 || step > STEPS.length || (step > 1 && !d.kit_type)) return;
    d.step = step;
    saveDraft();
    this.focusHeading = true;
    this.render();
    window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  private stepper(step: number, hasKit: boolean): HTMLElement {
    return h("nav", { class: "stepper", "aria-label": "Кроки розрахунку" },
      h("ol", null, STEPS.map((s) => {
        const state = s.no === step ? "is-current" : s.no < step ? "is-done" : "";
        return h("li", { class: state },
          h("button", {
            type: "button", class: "stepper__btn", disabled: s.no > 1 && !hasKit,
            "aria-current": s.no === step ? "step" : undefined, onclick: () => this.go(s.no),
          }, h("span", { class: "stepper__no" }, String(s.no).padStart(2, "0")), h("span", { class: "stepper__label" }, s.title)));
      })));
  }

  private stepNav(step: number, p: Preview): HTMLElement {
    return h("div", { class: "stepnav" },
      step > 1 ? h("button", { type: "button", class: "btn btn--ghost", onclick: () => this.go(step - 1) }, icon("back"), "Назад") : h("span"),
      step < STEPS.length
        ? h("button", { type: "button", class: "btn btn--primary", onclick: () => this.go(step + 1) }, "Далі: " + STEPS[step]!.title.toLowerCase(), icon("arrow"))
        : this.submitButton(p, "stepnav-submit"));
  }

  private submitButton(p: Preview, id: string): HTMLElement {
    const blocked = !p.quote || p.blockers.length > 0;
    return h("button", {
      type: "button", id, class: "btn btn--primary btn--lg", "aria-disabled": blocked ? "true" : undefined,
      onclick: () => void this.submit(),
    }, "Сформувати КП", icon("arrow"));
  }

  private stepContent(step: number, p: Preview): Child {
    switch (step) {
      case 1: return this.stepKit();
      case 2: return this.stepSlots(p);
      case 3: return this.stepOptions(p);
      case 4: return this.stepClient(p);
      default: return this.stepSummary(p);
    }
  }

  // ------------------------------------------------------------------ step 1: kit type or preset

  private stepKit(): Child {
    const { catalog } = ctx();
    const d = getDraft();
    const kt = d.kit_type ? kitTypeById(catalog, d.kit_type) : undefined;
    const resume = kt ? notice("info", "Поточний розрахунок", [kitTitle(catalog, kt, d.selection) + (d.client.name ? ` · ${d.client.name}` : "")],
      h("div", { class: "row-actions" },
        h("button", { type: "button", class: "btn btn--primary", onclick: () => this.go(2) }, "Продовжити", icon("arrow")),
        h("button", { type: "button", class: "btn btn--ghost", onclick: () => { resetDraft(); this.render(); toast("Почато новий розрахунок."); } }, "Почати новий"))) : null;

    const kitCards = catalog.kit_types.map((k, i) => {
      const sel = reconcileSelection(catalog, k.id, { slots: Object.fromEntries(k.slots.map((s) => [s.id, s.default])), choices: {}, accessories: [] });
      const crane = k.slots.find((s) => s.id === "crane") ?? k.slots[0]!;
      const models = crane.candidates.map((id) => itemById(catalog, id)).filter((x): x is Item => !!x).map(itemName);
      return h("li", null,
        h("button", { type: "button", class: "card card--kit", id: `kit-${k.id}`, onclick: () => { startKit(k.id); this.focusHeading = true; this.render(); window.scrollTo(0, 0); } },
          thumb(selectionPhoto(catalog, k, sel), ""),
          h("span", { class: "card__body" },
            h("span", { class: "card__kicker" }, `ТИП ${String(i + 1).padStart(2, "0")} · ${k.price_display === "bundle" ? "ціна комплектом" : "ціна по позиціях"}`),
            h("span", { class: "card__title" }, k.title),
            h("span", { class: "card__meta" }, models.join(" · ")),
            h("span", { class: "card__cta" }, "Зібрати", icon("arrow")))));
    });

    const archivedCount = catalog.presets.filter((pr) => pr.archived).length;
    const filters = [["all", "Усі"], ...catalog.kit_types.filter((k) => catalog.presets.some((pr) => pr.kit_type === k.id)).map((k) => [k.id, kitShort(k)])];
    const filterBar = h("div", { class: "chips", role: "radiogroup", "aria-label": "Тип комплекту" },
      filters.map(([id, title]) => h("button", {
        type: "button", class: this.presetFilter === id ? "chip is-on" : "chip", role: "radio", "aria-checked": this.presetFilter === id ? "true" : "false",
        id: `pf-${id}`, onclick: () => { this.presetFilter = id!; local.set(KEYS.presetFilter, id!); this.render(); },
      }, title)));

    const search = h("input", {
      id: "preset-search", type: "search", class: "input", placeholder: "Пошук: BMF 750, НПЛ-10, 2026…", value: this.presetSearch,
      autocomplete: "off", oninput: (e: Event) => { this.presetSearch = (e.target as HTMLInputElement).value; this.renderPresetList(); },
    });

    const list = h("ul", { class: "grid grid--presets", id: "preset-list" });
    this.fillPresets(list, this.filteredPresets());

    return [
      resume,
      sectionTitle("Тип комплекту"),
      h("ul", { class: "grid grid--kits" }, kitCards),
      h("div", { class: "section-head" },
        sectionTitle("Готові комплекти з КП"),
        h("p", { class: "muted" }, "Склад і ціни — з комерційних пропозицій, які вже надсилали клієнтам. Сума — як надруковано в КП-джерелі.")),
      filterBar,
      h("div", { class: "searchbox" }, icon("search"), h("label", { class: "sr-only", for: "preset-search" }, "Пошук готового комплекту"), search),
      list,
      archivedCount ? h("button", {
        type: "button", class: "btn btn--ghost btn--sm", id: "toggle-archived", "aria-pressed": this.showArchived ? "true" : "false",
        onclick: () => { this.showArchived = !this.showArchived; this.render(); },
      }, this.showArchived ? "Сховати архівні" : `Показати архівні (${archivedCount})`) : null,
    ];
  }

  private filteredPresets(): Preset[] {
    const { catalog } = ctx();
    const needle = this.presetSearch.trim().toLowerCase();
    return catalog.presets
      .filter((pr) => (this.showArchived || !pr.archived) && (this.presetFilter === "all" || pr.kit_type === this.presetFilter)
        && (!needle || pr.title.toLowerCase().includes(needle)))
      .sort((a, b) => (b.source.date || "").localeCompare(a.source.date || ""));
  }

  private renderPresetList(): void {
    const ul = document.getElementById("preset-list");
    if (ul) this.fillPresets(ul, this.filteredPresets());
  }

  private fillPresets(ul: HTMLElement, list: Preset[]): void {
    const { catalog } = ctx();
    clear(ul);
    if (!list.length) { ul.append(h("li", { class: "empty" }, "Нічого не знайдено.")); return; }
    for (const pr of list) {
      const kt = kitTypeById(catalog, pr.kit_type);
      if (!kt) continue;
      const sel = presetSelection(pr, catalog);
      const ready = kpReadiness(catalog, kt, sel);
      const total = pr.source.total_uah;
      const date = pr.source.date ? `КП від ${formatDate(pr.source.date)}` : "КП без дати";
      ul.append(h("li", null,
        h("button", { type: "button", class: "card card--preset", id: `preset-${pr.id}`, onclick: () => { startPreset(pr.id); this.focusHeading = true; this.render(); window.scrollTo(0, 0); } },
          thumb(selectionPhoto(catalog, kt, sel), ""),
          h("span", { class: "card__body" },
            h("span", { class: "card__kicker" }, kitShort(kt), pr.archived ? " · архів" : ""),
            h("span", { class: "card__title" }, pr.title),
            h("span", { class: "card__meta" }, date),
            h("span", { class: "card__price" },
              total === null ? h("span", { class: "muted" }, "ціни в гривнях у КП немає")
                : [formatUah(total), h("small", null, pr.source.vat_included === false ? " без ПДВ" : " з ПДВ")]),
            ready.ok ? null : badge(ready.label, "warn", ready.reasons.join(" "))))));
    }
  }

  // ------------------------------------------------------------------ step 2: slots and choices

  private stepSlots(p: Preview): Child {
    const { catalog } = ctx();
    const d = getDraft();
    const kt = kitTypeById(catalog, d.kit_type!)!;
    const preset = d.preset_id ? presetById(catalog, d.preset_id) : undefined;
    const out: Child[] = [];
    out.push(h("p", { class: "lead" }, kt.title, kt.price_display === "bundle" ? " — ціна комплектом: у рядках «у комплекті», ціну має лише разом." : " — ціна по позиціях."));
    if (preset) {
      out.push(notice("info", "Основа — готовий комплект", [
        preset.title,
        preset.source.total_uah !== null ? `У КП-джерелі: ${formatUah(preset.source.total_uah)}${preset.source.vat_included === false ? " без ПДВ" : ""}${preset.source.date ? `, ${formatDate(preset.source.date)}` : ""}.` : "У КП-джерелі немає суми в гривнях.",
      ]));
    }
    if (p.errors.length) out.push(notice("err", "Комплект не можна розрахувати", p.errors));
    for (const slot of kt.slots) out.push(this.slotBlock(catalog, kt, slot, d.selection));
    for (const ch of kt.choices) {
      const value = d.selection.choices[ch.id] ?? ch.default;
      out.push(h("fieldset", { class: "block" },
        h("legend", { class: "block__title" }, ch.title),
        h("div", { class: "pills" }, ch.options.map((o) => {
          const id = `ch-${ch.id}-${o.value}`;
          const extra = o.price_uah ? `+ ${formatUah(o.price_uah)}` : o.on_request ? "доплата за запитом" : "";
          return h("label", { class: "pill", for: id },
            h("input", {
              type: "radio", class: "sr-only", id, name: `ch-${ch.id}`, value: o.value, checked: value === o.value,
              onchange: () => { d.selection.choices[ch.id] = o.value; saveDraft(); this.render(); },
            }),
            h("span", { class: "pill__box" }, h("span", null, o.title), extra ? h("small", null, extra) : null));
        }))));
    }
    const kitInfo = this.kitCharacteristics(catalog, kt, d.selection);
    if (kitInfo) out.push(kitInfo);
    return out;
  }

  /** Candidates that can be chosen (directly or after other slots are adjusted), with what else would change. */
  private options(catalog: Catalog, kt: KitType, slot: Slot, sel: Selection) {
    return slotCandidates(catalog, kt.id, slot.id, sel).map((cand) => {
      if (!cand.item) return null;
      if (cand.allowed) return { item: cand.item, changes: [] as string[] };
      const next = reconcileSelection(catalog, kt.id, { ...sel, slots: { ...sel.slots, [slot.id]: cand.id } }, slot.id);
      if (next.slots[slot.id] !== cand.id || validateSelection(catalog, { kit_type: kt.id, selection: next }).length) return null;
      const changes = kt.slots.filter((s) => s.id !== slot.id && next.slots[s.id] !== sel.slots[s.id]).map((s) => {
        const it = next.slots[s.id] ? itemById(catalog, next.slots[s.id]!) : undefined;
        return it ? `${s.title}: ${itemName(it)}` : `${s.title}: без позиції`;
      });
      return { item: cand.item, changes };
    }).filter((x): x is { item: Item; changes: string[] } => !!x);
  }

  private slotBlock(catalog: Catalog, kt: KitType, slot: Slot, sel: Selection): HTMLElement {
    const { settings, rate } = ctx();
    const current = sel.slots[slot.id] ?? null;
    const opts = this.options(catalog, kt, slot, sel);
    const bundle = kt.price_display === "bundle";
    const name = `slot-${slot.id}`;
    const cards: Child[] = opts.map(({ item, changes }) => {
      const id = `${name}-${item.id}`;
      const ready = craneReadiness(item);
      const price = bundle ? TEXT_IN_KIT : itemPrice(catalog, settings, rate, item.id)?.text ?? TEXT_ON_REQUEST;
      return h("label", { class: "opt", for: id },
        h("input", { type: "radio", class: "sr-only", id, name, value: item.id, checked: current === item.id, onchange: () => this.pickSlot(kt, slot.id, item.id) }),
        h("span", { class: "opt__box" },
          thumb(item.photo, "", "opt__thumb"),
          h("span", { class: "opt__body" },
            h("span", { class: "opt__title" }, item.title),
            h("span", { class: "opt__desc" }, item.short),
            item.includes?.length && item.kind === "crane" ? h("span", { class: "tags" }, item.includes.map((x) => h("span", { class: "tag" }, x))) : null,
            changes.length ? h("span", { class: "opt__hint" }, "Також зміниться — " + changes.join("; ")) : null,
            ready.ok ? null : badge(ready.label, "warn")),
          h("span", { class: "opt__price" }, price)));
    });
    if (!slot.required) {
      const id = `${name}-none`;
      cards.push(h("label", { class: "opt opt--none", for: id },
        h("input", { type: "radio", class: "sr-only", id, name, value: "", checked: !current, onchange: () => this.pickSlot(kt, slot.id, null) }),
        h("span", { class: "opt__box" }, h("span", { class: "opt__body" }, h("span", { class: "opt__title" }, "Без цієї позиції")))));
    }
    const chosen = current ? itemById(catalog, current) : undefined;
    return h("fieldset", { class: "block" },
      h("legend", { class: "block__title" }, slot.title, slot.required ? null : h("span", { class: "block__opt" }, "необов’язково")),
      h("div", { class: "opts" }, cards),
      chosen?.kind === "crane" ? this.craneExtras(chosen) : null);
  }

  private craneExtras(crane: Item): HTMLElement {
    const { catalog } = ctx();
    const rows = specRows(crane);
    return h("div", { class: "extras" },
      crane.includes?.length ? h("p", { class: "included" },
        h("span", { class: "included__label" }, catalog.texts.notes.crane_included_title ?? "Вже в ціні крана"),
        " ", crane.includes.join(" + ")) : null,
      rows.length ? h("details", { class: "specs" },
        h("summary", null, `Характеристики ${itemName(crane)}`),
        h("dl", null, rows.map(([k, v]) => [h("dt", null, k), h("dd", null, v)])),
        crane.needs_confirmation?.length ? h("p", { class: "muted small" }, "Потребує підтвердження: ", crane.needs_confirmation.join("; ")) : null) : null);
  }

  private kitCharacteristics(catalog: Catalog, kt: KitType, sel: Selection): HTMLElement | null {
    const trailerId = sel.slots.trailer ?? sel.slots.conversion ?? null;
    const it = trailerId ? itemById(catalog, trailerId) : undefined;
    if (!it || !it.specs) return null;
    const rows = specRows(it);
    if (!rows.length) return null;
    return h("details", { class: "specs block" },
      h("summary", null, `Характеристики: ${itemName(it)}`),
      h("dl", null, rows.map(([k, v]) => [h("dt", null, k), h("dd", null, v)])));
  }

  private pickSlot(kt: KitType, slotId: string, itemId: string | null): void {
    const { catalog } = ctx();
    const d = getDraft();
    const before = d.selection;
    const next = reconcileSelection(catalog, kt.id, { ...before, slots: { ...before.slots, [slotId]: itemId } }, slotId);
    const changed = kt.slots.filter((s) => s.id !== slotId && next.slots[s.id] !== before.slots[s.id]).map((s) => s.title);
    const dropped = before.accessories.filter((a) => !next.accessories.some((b) => b.id === a.id)).map((a) => accessoryById(catalog, a.id)?.title ?? a.id);
    d.selection = next;
    saveDraft();
    this.render();
    const msgs: string[] = [];
    if (changed.length) msgs.push(`Під обраний виріб змінено: ${changed.join(", ")}.`);
    if (dropped.length) msgs.push(`Прибрано несумісні опції: ${dropped.join(", ")}.`);
    if (msgs.length) toast(msgs.join(" "));
  }

  // ------------------------------------------------------------------ step 3: accessories

  private stepOptions(p: Preview): Child {
    const { catalog, settings, rate } = ctx();
    const d = getDraft();
    const kt = kitTypeById(catalog, d.kit_type!)!;
    const all = kitAccessories(catalog, kt.id, d.selection).filter((x) => x.status !== "incompatible");
    if (!kt.accessory_groups.length || !all.length) {
      return [h("p", { class: "lead" }, "Для цього комплекту додаткових опцій немає."), p.errors.length ? notice("err", "Помилки", p.errors) : null];
    }
    const out: Child[] = [h("p", { class: "lead" }, catalog.texts.notes.accessories ?? "Додаткові опції — за запитом.")];
    for (const g of kt.accessory_groups) {
      const items = all.filter((x) => x.accessory.group === g);
      if (!items.length) continue;
      out.push(h("section", { class: "block", "aria-labelledby": `acc-group-${g}` },
        h("h2", { class: "block__title", id: `acc-group-${g}` }, GROUP_TITLES[g] ?? g, h("span", { class: "block__opt" }, `${items.length}`)),
        h("ul", { class: "accs" }, items.map((ka) => {
          const a = ka.accessory;
          const picked = d.selection.accessories.find((x) => x.id === a.id);
          const id = `acc-${a.id}`;
          const priceText = this.accessoryAutoPrice(p, a);
          const err = this.fieldErrors[`${id}-price`];
          return h("li", { class: picked ? "acc is-on" : "acc" },
            h("div", { class: "acc__head" },
              h("input", { type: "checkbox", class: "check", id, checked: !!picked, onchange: (e: Event) => this.toggleAccessory(a.id, (e.target as HTMLInputElement).checked) }),
              h("label", { for: id, class: "acc__title" }, a.title),
              h("span", { class: "acc__price" }, picked && typeof picked.price_uah === "number" ? formatUah(picked.price_uah) : priceText)),
            h("div", { class: "acc__body" },
              thumb(a.photo || ka.variants.find((v) => v.photo)?.photo, "", "acc__thumb"),
              h("div", null,
                h("p", { class: "acc__desc" }, ka.desc),
                ka.status === "unconfirmed" ? badge("сумісність з комплектом не підтверджена", "warn") : null,
                picked ? h("div", { class: "acc__controls" },
                  ka.variants.length ? field("Варіант", h("select", {
                    id: `${id}-variant`, class: "input",
                    onchange: (e: Event) => { picked.variant = (e.target as HTMLSelectElement).value || null; if (!picked.variant) delete picked.variant; saveDraft(); this.refreshTotals(); },
                  },
                    h("option", { value: "" }, "не обрано (уточнити)"),
                    ka.variants.map((v) => h("option", { value: v.id, selected: picked.variant === v.id }, v.title)))) : null,
                  field("Ціна, ₴ (необов’язково)", h("input", {
                    id: `${id}-price`, class: "input", inputmode: "decimal", autocomplete: "off",
                    placeholder: priceText, value: typeof picked.price_uah === "number" ? String(picked.price_uah) : "",
                    oninput: (e: Event) => this.accessoryPrice(a.id, (e.target as HTMLInputElement).value, false),
                    onchange: (e: Event) => this.accessoryPrice(a.id, (e.target as HTMLInputElement).value, true),
                  }), "Порожньо — «ціна за запитом», у суму не входить.", err)) : null)));
        }))));
    }
    return out;
  }

  /** Price of an accessory by its catalog rule (most are "ціна за запитом"). */
  private accessoryAutoPrice(p: Preview, a: Accessory): string {
    const row = p.quote?.accessories.find((r) => r.item_id === a.id);
    if (row && row.price_uah !== null && typeof getDraft().selection.accessories.find((x) => x.id === a.id)?.price_uah !== "number") return row.price_text;
    if (a.price.mode === "on_request") return TEXT_ON_REQUEST;
    const { settings, rate } = ctx();
    const r = priceRule(a.price, { settings, eur: eurRate(settings, rate), rate, date: todayIso() }, a.title);
    return r.price !== null ? r.text : TEXT_ON_REQUEST;
  }

  private toggleAccessory(id: string, on: boolean): void {
    const d = getDraft();
    d.selection.accessories = d.selection.accessories.filter((a) => a.id !== id);
    if (on) d.selection.accessories.push({ id });
    delete this.fieldErrors[`acc-${id}-price`];
    saveDraft();
    this.render();
  }

  private accessoryPrice(id: string, raw: string, commit: boolean): void {
    const d = getDraft();
    const a = d.selection.accessories.find((x) => x.id === id);
    if (!a) return;
    const v = parseAmount(raw);
    const key = `acc-${id}-price`;
    if (v === null) { delete a.price_uah; delete this.fieldErrors[key]; }
    else if (Number.isNaN(v)) { delete a.price_uah; this.fieldErrors[key] = "Введіть суму числом, наприклад 25 000."; }
    else { a.price_uah = v; delete this.fieldErrors[key]; }
    saveDraft();
    if (commit) this.render(); else this.refreshTotals();
  }

  // ------------------------------------------------------------------ step 4: client, manager, price

  private stepClient(p: Preview): Child {
    const { catalog, settings } = ctx();
    const d = getDraft();
    const kt = kitTypeById(catalog, d.kit_type!)!;
    const text = (id: string, value: string, set: (v: string) => void, extra: Record<string, unknown> = {}) => h("input", {
      id, class: "input", value, autocomplete: "off", ...extra,
      oninput: (e: Event) => { set((e.target as HTMLInputElement).value); delete this.fieldErrors[id]; saveDraft(); this.refreshTotals(); },
    });
    const money = (id: string, value: number | null | undefined, placeholder: string, set: (v: number | null) => void) => h("input", {
      id, class: "input", inputmode: "decimal", autocomplete: "off", placeholder, value: typeof value === "number" ? String(value) : "",
      oninput: (e: Event) => {
        const v = parseAmount((e.target as HTMLInputElement).value);
        if (v !== null && Number.isNaN(v)) { this.fieldErrors[id] = "Введіть суму числом, наприклад 686 000."; set(null); }
        else { delete this.fieldErrors[id]; set(v); }
        saveDraft(); this.refreshTotals();
      },
      onchange: () => this.render(),
    });
    const makerId = d.maker || settings.company_maker;
    const company = catalog.companies.find((x) => x.id === makerId);

    const discountErr = this.fieldErrors["f-discount"] ?? (d.discount_pct > settings.max_discount_pct ? `Максимум ${formatPct(settings.max_discount_pct)}.` : null);
    const discount = h("input", {
      id: "f-discount", class: "input input--short", inputmode: "decimal", autocomplete: "off", value: d.discount_pct ? String(d.discount_pct).replace(".", ",") : "",
      placeholder: "0",
      oninput: (e: Event) => {
        const v = parseAmount((e.target as HTMLInputElement).value);
        if (v !== null && Number.isNaN(v)) { this.fieldErrors["f-discount"] = "Введіть число відсотків."; d.discount_pct = 0; }
        else { delete this.fieldErrors["f-discount"]; d.discount_pct = v ?? 0; }
        saveDraft(); this.refreshTotals();
      },
      onchange: () => this.render(),
    });

    const overrides: Child[] = [];
    if (kt.price_display === "bundle") {
      const kitPrice = p.quote?.kit_price_uah;
      overrides.push(field("Ціна комплекту вручну, ₴", money("f-kit-price", d.kit_price_uah, kitPrice != null ? formatUah(kitPrice) : TEXT_ON_REQUEST, (v) => { d.kit_price_uah = v; }),
        "Порожньо — ціна з каталогу (комплектна ціна з КП). Рядки КП покажуть «у комплекті».", this.fieldErrors["f-kit-price"]));
    } else {
      for (const r of p.quote?.rows ?? []) {
        const id = `f-price-${r.item_id}`;
        overrides.push(field(`${r.title}, ₴`, money(id, d.manual_prices[r.item_id], r.price_uah !== null && d.manual_prices[r.item_id] === undefined ? r.price_text : TEXT_ON_REQUEST,
          (v) => { if (v === null) delete d.manual_prices[r.item_id]; else d.manual_prices[r.item_id] = v; }), undefined, this.fieldErrors[id]));
      }
    }

    return [
      h("fieldset", { class: "block form" },
        h("legend", { class: "block__title" }, "Клієнт"),
        field("Назва або ПІБ клієнта *", text("f-client", d.client.name, (v) => { d.client.name = v; }, { required: true, autocomplete: "organization" }),
          "Друкується на обкладинці КП.", this.fieldErrors["f-client"]),
        field("Контакт", text("f-contact", d.client.contact, (v) => { d.client.contact = v; }, { inputmode: "text", placeholder: "телефон, e-mail або особа" }),
          "Третій рядок під назвою клієнта на обкладинці.")),
      h("fieldset", { class: "block form" },
        h("legend", { class: "block__title" }, "Менеджер і юрособа"),
        field("Менеджер", text("f-manager", d.manager, (v) => { d.manager = v; }, { autocomplete: "name" }), "Запам’ятовується на цьому пристрої."),
        field("Юрособа у КП (виробник)", h("select", {
          id: "f-maker", class: "input",
          onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; d.maker = v === settings.company_maker ? "" : v; saveDraft(); this.render(); },
        }, catalog.companies.map((co) => h("option", { value: co.id, selected: co.id === makerId }, co.name + (co.id === settings.company_maker ? " (типово)" : "")))),
        ["Питання відкрите: ТОВ «ГІДМАН» чи ФОП Дебелий В. М. Типово — як у затвердженій KP_2_v3 (налаштування).",
          company?.address ? h("br") : null, company?.address ? `Адреса в КП: ${company.address}` : null])),
      h("fieldset", { class: "block form" },
        h("legend", { class: "block__title" }, "Ціна"),
        field(`Знижка, % (до ${formatPct(settings.max_discount_pct)})`, discount, "Застосовується до суми й округлюється.", discountErr),
        overrides.length ? h("div", { class: "overrides" },
          h("p", { class: "field__label" }, "Ручні ціни (необов’язково)"),
          h("p", { class: "field__hint" }, "Ручна ціна замінює розрахунок для позиції; порожньо — за правилами каталогу."),
          overrides) : null),
    ];
  }

  // ------------------------------------------------------------------ step 5: summary

  private stepSummary(p: Preview): Child {
    const { catalog } = ctx();
    const d = getDraft();
    const kt = kitTypeById(catalog, d.kit_type!)!;
    const sq = this.server && p.input && this.server.key === JSON.stringify(p.input) ? this.server : null;
    const q = sq?.quote ?? p.quote;
    const errors = sq && !sq.loading && sq.errors.length ? sq.errors : p.errors;
    const out: Child[] = [];
    if (errors.length) out.push(notice("err", "Комплект не можна розрахувати", errors));
    if (!q) return out;

    out.push(this.quoteCard(kt, q, !isDemo() && (!sq || sq.loading) ? "попередній розрахунок у браузері" : !isDemo() ? "розраховано сервером" : "розрахунок у браузері (демо)"));
    out.push(this.priceChips(q));
    out.push(this.rateBox(q));
    if (q.warnings.length) out.push(notice("warn", "Зверніть увагу", q.warnings));
    if (p.blockers.length) out.push(notice("err", "КП за шаблоном KP_2_v3 не сформується", p.blockers,
      h("p", { class: "small" }, "Розрахунок можна показати клієнту, але файл КП для цієї моделі ще не підготовлено.")));
    const preset = d.preset_id ? presetById(catalog, d.preset_id) : undefined;
    if (preset && preset.source.total_uah !== null) {
      const same = preset.source.total_uah === q.total_uah;
      out.push(h("p", { class: same ? "compare compare--same" : "compare" },
        `КП-джерело «${preset.title}»: ${formatUah(preset.source.total_uah)}${preset.source.vat_included === false ? " без ПДВ" : ""}`,
        same ? " — збігається." : ` — різниця ${formatUah(q.total_uah - preset.source.total_uah)}.`));
    }

    const makerId = d.maker || ctx().settings.company_maker;
    const company = catalog.companies.find((x) => x.id === makerId);
    out.push(h("div", { class: "block" },
      h("h2", { class: "block__title" }, "Для КП"),
      h("dl", { class: "kv" },
        h("dt", null, "Клієнт"), h("dd", null, d.client.name || h("span", { class: "err-text" }, "не вказано"), " ",
          h("button", { type: "button", class: "link", onclick: () => this.go(4) }, "змінити")),
        d.client.contact ? [h("dt", null, "Контакт"), h("dd", null, d.client.contact)] : null,
        d.manager ? [h("dt", null, "Менеджер"), h("dd", null, d.manager)] : null,
        h("dt", null, "Юрособа"), h("dd", null, company?.name ?? makerId),
        h("dt", null, "Назва КП"), h("dd", null, kitTitle(catalog, kt, d.selection)))));
    out.push(h("div", { class: "submit-row" }, this.submitButton(p, "summary-submit"),
      isDemo() ? h("p", { class: "small muted" }, "Демо: PDF формує лише сервер; тут розрахунок збережеться в демо-журнал.") : null));
    return out;
  }

  private quoteCard(kt: KitType, q: Quote, origin: string): HTMLElement {
    const bundle = q.price_display === "bundle";
    const row = (r: QuoteRow, no: string) => h("tr", null,
      h("td", { class: "q__no" }, no),
      h("td", { class: "q__pos" }, h("span", { class: "q__title" }, r.title), r.desc ? h("span", { class: "q__desc" }, r.desc) : null),
      h("td", { class: "q__qty" }, String(r.qty)),
      h("td", { class: r.price_uah === null ? "q__price q__price--text" : "q__price" }, r.price_text));
    const pricedChoices = q.choices.filter((c) => c.price_uah > 0);
    const totalText = bundle && (q.kit_price_uah === null || q.kit_price_uah === undefined) && q.total_uah === 0 ? TEXT_ON_REQUEST : formatUah(q.total_uah);
    return h("div", { class: "qcard", "aria-live": "polite" },
      h("div", { class: "qcard__head" }, h("span", { class: "qcard__title" }, kitTitle(ctx().catalog, kt, getDraft().selection)), h("span", { class: "qcard__origin" }, origin)),
      h("div", { class: "table-wrap" },
        h("table", { class: "q" },
          h("caption", { class: "sr-only" }, "Позиції комерційної пропозиції"),
          h("thead", null, h("tr", null, h("th", { scope: "col" }, h("span", { class: "sr-only" }, "№")), h("th", { scope: "col" }, "Позиція"), h("th", { scope: "col", class: "q__qty" }, "К-сть"), h("th", { scope: "col", class: "q__price" }, "Ціна, ₴"))),
          h("tbody", null,
            q.rows.map((r, i) => row(r, String(i + 1).padStart(2, "0"))),
            pricedChoices.map((c, i) => h("tr", null, h("td", { class: "q__no" }, String(q.rows.length + i + 1).padStart(2, "0")),
              h("td", { class: "q__pos" }, h("span", { class: "q__title" }, `${c.title}: ${c.value_title}`)), h("td", { class: "q__qty" }, "1"), h("td", { class: "q__price" }, formatUah(c.price_uah)))),
            q.accessories.length ? h("tr", { class: "q__group" }, h("td", { colspan: "4" }, "Додаткові опції")) : null,
            q.accessories.map((r) => row(r, "+"))))),
      q.choices.length ? h("p", { class: "qcard__choices" }, q.choices.map((c, i) => [i ? " · " : "", h("span", null, `${c.title}: `), h("b", null, c.value_title)])) : null,
      h("div", { class: "qcard__total" },
        h("div", null, h("span", { class: "qcard__label" }, "Разом"),
          h("span", { class: "qcard__sub" }, bundle ? "комплект під ключ" : "сума позицій"),
          q.discount_pct > 0 ? h("span", { class: "qcard__sub" }, `без знижки ${formatUah(q.subtotal_uah)} · знижка ${formatPct(q.discount_pct)}`) : null,
          q.complete === false ? h("span", { class: "qcard__sub warn-text" }, "не всі ціни відомі — сума неповна") : null),
        h("output", { class: "qcard__sum", id: "summary-total" }, totalText)));
  }

  private priceChips(q: Quote): HTMLElement {
    const { catalog, settings } = ctx();
    return h("ul", { class: "chips chips--static", "aria-label": "Умови ціни" },
      h("li", { class: "chip" }, (catalog.texts.notes.vat ?? "З урахуванням ПДВ").toUpperCase()),
      settings.validity_days > 0 ? h("li", { class: "chip" }, `ДІЙСНА ДО ${formatDate(q.valid_until)}`) : null,
      h("li", { class: "chip" }, `ЦІНИ СТАНОМ НА ${formatDate(q.date)}`));
  }

  private rateBox(q: Quote): HTMLElement {
    const { rate } = ctx();
    const src = q.eur_rate_source;
    const srcText = src === "demo" ? "демо-курс (не НБУ)" : src === "manual" ? "ручний курс з налаштувань" : src === "nbu" ? "НБУ" : src === "cache" ? "НБУ, збережений" : "недоступний";
    const date = src === "manual" ? "" : rate.date ? ` на ${formatDate(rate.date) || rate.date}` : "";
    return h("div", { class: src === "demo" ? "ratebox ratebox--demo" : "ratebox" },
      h("span", { class: "ratebox__label" }, "Курс EUR"),
      h("span", { class: "ratebox__value" }, q.eur_rate !== null ? formatRate(q.eur_rate) : "—"),
      h("span", { class: "ratebox__src" }, srcText + date),
      h("span", { class: "ratebox__note" }, q.eur_applied ? "Курс враховано в цінах." : "Ціни взято з КП-джерел; поточний курс на них поки не впливає (немає курсу на дату ціни або ціна не прив’язана до EUR)."));
  }

  private async ensureServerQuote(p: Preview): Promise<void> {
    if (isDemo() || !p.input) return;
    const key = JSON.stringify(p.input);
    if (this.server && this.server.key === key) return;
    this.server = { key, quote: null, errors: [], loading: true };
    try {
      const q = await ctx().api.quote(p.input);
      if (this.server?.key !== key) return;
      this.server = { key, quote: q, errors: [], loading: false };
    } catch (e) {
      if (this.server?.key !== key) return;
      this.server = { key, quote: null, errors: e instanceof ApiError && e.status === 400 ? e.errors : [], loading: false };
      if (!(e instanceof ApiError && e.status === 400)) toast("Сервер не розрахував КП — показано розрахунок у браузері.", "info");
    }
    if (getDraft().step === 5) this.render();
  }

  // ------------------------------------------------------------------ live summary: desktop aside and phone dock

  private aside(kt: KitType, p: Preview): HTMLElement {
    const { catalog } = ctx();
    const d = getDraft();
    const q = p.quote;
    return h("aside", { class: "cfg__aside", "aria-label": "Поточний розрахунок" },
      h("div", { class: "live" },
        hud("ВАРТІСТЬ", "hud--sm"),
        h("p", { class: "live__title" }, kitTitle(catalog, kt, d.selection)),
        q ? h("ul", { class: "live__rows" },
          q.rows.map((r) => h("li", null, h("span", null, r.title), h("span", { class: "live__price" }, r.price_text))),
          q.accessories.map((r) => h("li", null, h("span", null, "+ " + r.title), h("span", { class: "live__price" }, r.price_text)))) : null,
        h("div", { class: "live__total" },
          h("span", { class: "qcard__label" }, "Разом"),
          h("output", { class: "live__sum", id: "aside-total" }, q ? totalLabel(q) : "—")),
        q && q.warnings.length ? h("p", { class: "live__warn" }, icon("warn"), `Попереджень: ${q.warnings.length}`) : null,
        p.blockers.length ? h("p", { class: "live__warn live__warn--err" }, icon("warn"), "КП за шаблоном не сформується") : null,
        p.errors.length ? h("p", { class: "live__warn live__warn--err" }, icon("warn"), p.errors[0]!) : null));
  }

  private renderDock(kt: KitType | undefined, p: Preview): void {
    const dock = document.getElementById("dock");
    if (!dock) return;
    const d = getDraft();
    if (!kt || d.step === 1) { clear(dock); dock.hidden = true; document.body.classList.remove("has-dock"); return; }
    dock.hidden = false;
    document.body.classList.add("has-dock");
    const q = p.quote;
    const next = d.step < STEPS.length
      ? h("button", { type: "button", class: "btn btn--primary", id: "dock-next", onclick: () => this.go(d.step + 1) }, "Далі", icon("arrow"))
      : this.submitButton(p, "dock-submit");
    mount(dock,
      h("div", { class: "dock__inner" },
        h("button", { type: "button", class: "btn btn--icon", id: "dock-back", "aria-label": "Назад", onclick: () => this.go(d.step - 1) }, icon("back")),
        h("div", { class: "dock__total" },
          h("span", { class: "dock__label" }, `Крок ${d.step}/${STEPS.length} · разом`),
          h("output", { class: "dock__sum", id: "dock-total", "aria-live": "polite" }, q ? totalLabel(q) : p.errors.length ? "помилка" : "—")),
        next));
  }

  // ------------------------------------------------------------------ submit

  private async submit(): Promise<void> {
    if (this.busy) return;
    const d = getDraft();
    const p = preview();
    if (!p.quote) { this.go(2); toast(p.errors[0] ?? "Комплект не можна розрахувати.", "err"); return; }
    if (p.blockers.length) {
      await dialog("КП не сформується", h("div", null, h("p", null, "Шаблон KP_2_v3 не може побудувати КП для цього комплекту:"), h("ul", null, p.blockers.map((b) => h("li", null, b)))),
        [{ id: "ok", label: "Зрозуміло", primary: true }]);
      return;
    }
    if (!d.client.name.trim()) {
      this.fieldErrors["f-client"] = "Вкажіть клієнта: його назва друкується на обкладинці КП.";
      d.step = 4; saveDraft(); this.render();
      document.getElementById("f-client")?.focus();
      return;
    }
    if (isDemo()) {
      const choice = await dialog("PDF формує сервер", h("div", null,
        h("p", null, DEMO_NO_FILES),
        h("p", null, "Щоб отримати PDF і PPTX, відкрийте конструктор на сервері компанії.")),
        [{ id: "cancel", label: "Скасувати" }, { id: "save", label: "Зберегти в демо-журнал", primary: true }]);
      if (choice !== "save") return;
    }
    this.busy = true;
    try {
      const { api, catalog } = ctx();
      const body = {
        quote_input: p.input!,
        client: d.client.contact.trim() ? { name: d.client.name.trim(), contact: d.client.contact.trim() } : { name: d.client.name.trim() },
        ...(d.manager.trim() ? { manager: d.manager.trim() } : {}),
        ...(d.maker ? { maker: d.maker } : {}),
      };
      const res = await api.createKp(body);
      const kt = kitTypeById(catalog, d.kit_type!)!;
      toast(isDemo() ? `Розрахунок КП № ${res.number} збережено в демо-журналі.` : `КП № ${res.number} поставлено в чергу: ${kitTitle(catalog, kt, d.selection)}.`, "ok");
      navigate(`#/kp/${encodeURIComponent(res.id)}`);
    } catch (e) {
      const errs = e instanceof ApiError ? e.errors : [String(e)];
      await dialog("КП не створено", h("ul", null, errs.map((x) => h("li", null, x))), [{ id: "ok", label: "Закрити", primary: true }]);
    } finally {
      this.busy = false;
    }
  }
}

function totalLabel(q: Quote): string {
  if (q.price_display === "bundle" && (q.kit_price_uah === null || q.kit_price_uah === undefined) && q.total_uah === 0) return TEXT_ON_REQUEST;
  return formatUah(q.total_uah) + (q.complete === false ? " *" : "");
}
