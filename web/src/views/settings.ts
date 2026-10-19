// Налаштування: поточні налаштування цін і курс; редагування — лише з токеном адміністратора (sessionStorage).
import type { Settings } from "../../../core/src/index.js";
import { formatDate, formatNumber, formatPct, formatRate, validateSettings } from "../../../core/src/index.js";
import type { Child } from "../dom.js";
import { h, icon, mount } from "../dom.js";
import { ctx, ctxChanged, isDemo } from "../app.js";
import { ApiError, adminToken, setAdminToken } from "../api.js";
import type { View } from "../router.js";
import { field, heading, hud, notice, parseAmount, toast } from "../ui.js";

const GROUP_TITLES: Record<string, string> = {
  bmf_cranes: "Крани BMF", bmf_trailers: "Причепи BMF", own_production: "Власне виробництво", accessories: "Додаткові опції",
};

interface FormState {
  values: Record<string, string>;
  mode: "nbu" | "manual";
  company: string;
  prefix: string;
  grades: { name: string; price: string }[];
  groups: string[];
}

const num = (n: number | null | undefined) => (typeof n === "number" ? String(n).replace(".", ",") : "");

function usedGroups(): string[] {
  const { catalog, settings } = ctx();
  const out = new Set(Object.keys(settings.groups));
  for (const r of [...catalog.items.map((x) => x.price), ...catalog.bundles.map((x) => x.price), ...catalog.accessories.map((x) => x.price)]) {
    if ("group" in r && r.group) out.add(r.group);
  }
  return [...out];
}

export class SettingsView implements View {
  private root!: HTMLElement;
  private editing = false;
  private form: FormState | null = null;
  private errors: string[] = [];
  private saving = false;
  private alive = true;

  mount(root: HTMLElement): void {
    this.root = root;
    this.render();
    void this.refreshRate();
  }

  unmount(): void { this.alive = false; }

  private async refreshRate(): Promise<void> {
    try {
      const rate = await ctx().api.rate();
      if (!this.alive) return;
      ctx().rate = rate;
      if (!this.editing) this.render();
    } catch { /* keep the rate loaded at start */ }
  }

  private render(): void {
    mount(this.root, h("div", { class: "page" },
      hud("НАЛАШТУВАННЯ"),
      heading("НАЛАШТУВАННЯ", "ЦІН І КП.", "settings-title"),
      isDemo() ? notice("info", "Демо-режим", ["Зміни зберігаються лише в цьому браузері; підійде будь-який токен адміністратора."]) : null,
      this.rateCard(),
      this.editing && this.form ? this.editor(this.form) : [this.readOnly(), this.adminGate()]));
  }

  private rateCard(): HTMLElement {
    const { rate, settings } = ctx();
    const src = rate.source === "demo" ? "демо-курс (не НБУ)" : rate.source === "manual" ? "ручний" : rate.source === "cache" ? "НБУ (збережений)" : rate.source === "nbu" ? "НБУ" : "недоступний";
    const manual = settings.eur.mode === "manual";
    const value = manual ? settings.eur.manual_rate : rate.eur;
    return h("div", { class: "ratebox ratebox--big" + (rate.source === "demo" ? " ratebox--demo" : "") },
      h("span", { class: "ratebox__label" }, "Курс EUR"),
      h("span", { class: "ratebox__value" }, typeof value === "number" ? formatRate(value) : "—"),
      h("span", { class: "ratebox__src" }, manual ? "ручний курс з налаштувань" : `${src}${rate.date ? " · на " + (formatDate(rate.date) || rate.date) : ""}`),
      h("span", { class: "ratebox__note" },
        rate.fetched_at ? `Оновлено: ${new Date(rate.fetched_at).toLocaleString("uk-UA")}. ` : "",
        settings.eur.buffer_pct ? `Запас до курсу: ${formatPct(settings.eur.buffer_pct)}.` : "Запас до курсу: 0 %."));
  }

  private readOnly(): HTMLElement {
    const { settings: s, catalog } = ctx();
    const company = catalog.companies.find((x) => x.id === s.company_maker);
    const val = (n: number | null) => (n === null ? h("span", { class: "muted" }, "не задано") : formatNumber(n));
    const rows: [string, Child][] = [
      ["Курс EUR", s.eur.mode === "manual" ? `ручний: ${s.eur.manual_rate !== null ? formatRate(s.eur.manual_rate) : "не задано"}` : "НБУ"],
      ["Запас до курсу", formatPct(s.eur.buffer_pct)],
      ["Індекс металу зараз, ₴/кг", val(s.metal.index_uah_per_kg)],
      ["Індекс металу на дату цін, ₴/кг", val(s.metal.ref_index_uah_per_kg)],
      ["Ціни марок металу", Object.keys(s.metal.grades).length ? Object.entries(s.metal.grades).map(([g, v]) => `${g}: ${formatNumber(v)} ₴/кг`).join("; ") : h("span", { class: "muted" }, "не задано")],
      ["Нормо-година, ₴", val(s.labor_rate_uah)],
      ...Object.entries(s.groups).map(([g, v]) => [`${GROUP_TITLES[g] ?? g}`, `націнка ${formatPct(v.markup_pct)} · логістика ${formatPct(v.logistics_pct)}`] as [string, Child]),
      ["ПДВ", formatPct(s.vat_pct)],
      ["Округлення", `${formatNumber(s.rounding_uah)} ₴`],
      ["Термін дії КП", `${s.validity_days} дн.`],
      ["Максимальна знижка", formatPct(s.max_discount_pct)],
      ["Юрособа у КП (типово)", company?.name ?? s.company_maker],
      ["Префікс номера КП", s.kp_number_prefix || "—"],
    ];
    return h("dl", { class: "kv block" }, rows.map(([k, v]) => [h("dt", null, k), h("dd", null, v)]));
  }

  private adminGate(): HTMLElement {
    if (adminToken()) {
      return h("div", { class: "row-actions" },
        h("button", { type: "button", class: "btn btn--primary", id: "settings-edit", onclick: () => this.startEdit() }, icon("edit"), "Редагувати"),
        h("button", { type: "button", class: "btn btn--ghost", id: "admin-logout", onclick: () => { setAdminToken(""); this.render(); toast("Режим адміністратора вимкнено."); } }, "Вийти з режиму адміністратора"));
    }
    const input = h("input", { id: "admin-token", type: "password", class: "input", autocomplete: "current-password", placeholder: "KP_ADMIN_TOKEN" });
    const form = h("form", {
      class: "block form admin-gate",
      onsubmit: (e: Event) => {
        e.preventDefault();
        const t = input.value.trim();
        if (!t) { input.focus(); return; }
        setAdminToken(t);
        this.startEdit();
      },
    },
      h("p", { class: "block__title" }, icon("lock"), " Редагування — для адміністратора"),
      field("Токен адміністратора", input, "Вводиться один раз і зберігається до закриття вкладки."),
      h("button", { type: "submit", class: "btn btn--primary", id: "admin-login" }, "Увійти"));
    return form;
  }

  private startEdit(): void {
    const s = ctx().settings;
    const values: Record<string, string> = {
      "s-eur-manual": num(s.eur.manual_rate), "s-eur-buffer": num(s.eur.buffer_pct),
      "s-metal-index": num(s.metal.index_uah_per_kg), "s-metal-ref": num(s.metal.ref_index_uah_per_kg),
      "s-labor": num(s.labor_rate_uah), "s-vat": num(s.vat_pct), "s-rounding": num(s.rounding_uah),
      "s-validity": num(s.validity_days), "s-discount": num(s.max_discount_pct),
    };
    const groups = usedGroups();
    for (const g of groups) {
      values[`s-g-${g}-markup`] = num(s.groups[g]?.markup_pct ?? 0);
      values[`s-g-${g}-logistics`] = num(s.groups[g]?.logistics_pct ?? 0);
    }
    this.form = {
      values, mode: s.eur.mode, company: s.company_maker, prefix: s.kp_number_prefix,
      grades: Object.entries(s.metal.grades).map(([name, v]) => ({ name, price: num(v) })), groups,
    };
    this.errors = [];
    this.editing = true;
    this.render();
    document.getElementById("s-eur-nbu")?.focus();
  }

  private editor(f: FormState): HTMLElement {
    const { catalog } = ctx();
    const input = (id: string, label: string, hint?: string, extra: Record<string, unknown> = {}) => field(label, h("input", {
      id, class: "input input--short", inputmode: "decimal", autocomplete: "off", value: f.values[id] ?? "", ...extra,
      oninput: (e: Event) => { f.values[id] = (e.target as HTMLInputElement).value; },
    }), hint);
    const radio = (value: "nbu" | "manual", label: string) => h("label", { class: "pill", for: `s-eur-${value}` },
      h("input", { type: "radio", class: "sr-only", id: `s-eur-${value}`, name: "s-eur-mode", value, checked: f.mode === value, onchange: () => { f.mode = value; this.render(); } }),
      h("span", { class: "pill__box" }, h("span", null, label)));

    return h("form", { class: "settings-form", onsubmit: (e: Event) => { e.preventDefault(); void this.save(); }, novalidate: true },
      this.errors.length ? notice("err", "Налаштування не збережено", this.errors) : null,
      h("fieldset", { class: "block form" },
        h("legend", { class: "block__title" }, "Курс EUR"),
        h("div", { class: "pills", role: "radiogroup", "aria-label": "Джерело курсу" }, radio("nbu", "Курс НБУ"), radio("manual", "Ручний курс")),
        f.mode === "manual" ? input("s-eur-manual", "Ручний курс, ₴ за 1 €") : null,
        input("s-eur-buffer", "Запас до курсу, %", "Наприклад 2 — курс × 1,02 (курс купівлі банку вищий за НБУ).")),
      h("fieldset", { class: "block form" },
        h("legend", { class: "block__title" }, "Метал"),
        input("s-metal-index", "Індекс ціни металу зараз, ₴/кг"),
        input("s-metal-ref", "Індекс на дату цін з КП, ₴/кг", "Без обох індексів металозалежна частка цін не перераховується."),
        h("div", { class: "grades" },
          h("p", { class: "field__label" }, "Ціни марок металу, ₴/кг (для собівартості)"),
          f.grades.map((g, i) => h("div", { class: "grade-row" },
            h("label", { class: "sr-only", for: `s-grade-${i}-name` }, `Марка ${i + 1}`),
            h("input", { id: `s-grade-${i}-name`, class: "input", value: g.name, placeholder: "марка, напр. S355", oninput: (e: Event) => { g.name = (e.target as HTMLInputElement).value; } }),
            h("label", { class: "sr-only", for: `s-grade-${i}-price` }, `Ціна марки ${i + 1}, ₴/кг`),
            h("input", { id: `s-grade-${i}-price`, class: "input input--short", inputmode: "decimal", value: g.price, placeholder: "₴/кг", oninput: (e: Event) => { g.price = (e.target as HTMLInputElement).value; } }),
            h("button", { type: "button", class: "btn btn--icon", "aria-label": `Видалити марку ${g.name || i + 1}`, onclick: () => { f.grades.splice(i, 1); this.render(); } }, icon("x")))),
          h("button", { type: "button", class: "btn btn--ghost btn--sm", id: "s-grade-add", onclick: () => { f.grades.push({ name: "", price: "" }); this.render(); document.getElementById(`s-grade-${f.grades.length - 1}-name`)?.focus(); } }, icon("plus"), "Додати марку")),
        input("s-labor", "Нормо-година, ₴")),
      h("fieldset", { class: "block form" },
        h("legend", { class: "block__title" }, "Націнка і логістика за групами"),
        h("p", { class: "field__hint" }, "Діють на ціни в EUR і собівартість; на ціни з КП (режим «ref») не діють."),
        h("div", { class: "groups" }, f.groups.map((g) => h("div", { class: "group-row" },
          h("p", { class: "group-row__title" }, GROUP_TITLES[g] ?? g, h("span", { class: "muted small" }, ` · ${g}`)),
          input(`s-g-${g}-markup`, "Націнка, %"),
          input(`s-g-${g}-logistics`, "Логістика, %"))))),
      h("fieldset", { class: "block form" },
        h("legend", { class: "block__title" }, "КП"),
        input("s-vat", "ПДВ, %"),
        input("s-rounding", "Округлення, ₴", "0 — до гривні."),
        input("s-validity", "Термін дії КП, днів", "0 — без «Дійсна до».", { inputmode: "numeric" }),
        input("s-discount", "Максимальна знижка, %"),
        field("Юрособа у КП (типово)", h("select", { id: "s-company", class: "input", onchange: (e: Event) => { f.company = (e.target as HTMLSelectElement).value; } },
          catalog.companies.map((co) => h("option", { value: co.id, selected: co.id === f.company }, co.name))),
          "Відкрите питання: ТОВ «ГІДМАН» чи ФОП Дебелий В. М.; менеджер може змінити для окремої КП."),
        field("Префікс номера КП", h("input", { id: "s-prefix", class: "input input--short", value: f.prefix, oninput: (e: Event) => { f.prefix = (e.target as HTMLInputElement).value; } }))),
      h("div", { class: "row-actions sticky-actions" },
        h("button", { type: "submit", class: "btn btn--primary", id: "settings-save", disabled: this.saving }, icon("check"), this.saving ? "Збереження…" : "Зберегти"),
        h("button", { type: "button", class: "btn btn--ghost", id: "settings-cancel", onclick: () => { this.editing = false; this.form = null; this.errors = []; this.render(); } }, "Скасувати")));
  }

  private collect(f: FormState): { settings: Settings | null; errors: string[] } {
    const errors: string[] = [];
    const read = (id: string, label: string, opt: boolean): number | null => {
      const v = parseAmount(f.values[id] ?? "");
      if (v === null) { if (!opt) errors.push(`${label}: задайте значення.`); return null; }
      if (Number.isNaN(v)) { errors.push(`${label}: введіть число.`); return null; }
      return v;
    };
    const grades: Record<string, number> = {};
    for (const g of f.grades) {
      if (!g.name.trim() && !g.price.trim()) continue;
      const v = parseAmount(g.price);
      if (!g.name.trim()) errors.push("Ціна металу: вкажіть марку.");
      else if (v === null || Number.isNaN(v)) errors.push(`Марка ${g.name}: введіть ціну числом.`);
      else grades[g.name.trim()] = v;
    }
    const groups: Settings["groups"] = {};
    for (const g of f.groups) {
      groups[g] = {
        markup_pct: read(`s-g-${g}-markup`, `${GROUP_TITLES[g] ?? g}: націнка`, false) ?? 0,
        logistics_pct: read(`s-g-${g}-logistics`, `${GROUP_TITLES[g] ?? g}: логістика`, false) ?? 0,
      };
    }
    const s: Settings = {
      eur: { mode: f.mode, manual_rate: read("s-eur-manual", "Ручний курс", f.mode !== "manual"), buffer_pct: read("s-eur-buffer", "Запас до курсу", false) ?? 0 },
      metal: { index_uah_per_kg: read("s-metal-index", "Індекс металу", true), ref_index_uah_per_kg: read("s-metal-ref", "Індекс металу на дату цін", true), grades },
      labor_rate_uah: read("s-labor", "Нормо-година", true),
      groups,
      vat_pct: read("s-vat", "ПДВ", false) ?? 0,
      rounding_uah: read("s-rounding", "Округлення", false) ?? 0,
      validity_days: read("s-validity", "Термін дії", false) ?? 0,
      max_discount_pct: read("s-discount", "Максимальна знижка", false) ?? 0,
      company_maker: f.company,
      kp_number_prefix: f.prefix.trim(),
    };
    return { settings: errors.length ? null : s, errors };
  }

  private async save(): Promise<void> {
    const f = this.form;
    if (!f || this.saving) return;
    const { settings, errors } = this.collect(f);
    const all = settings ? validateSettings(settings, ctx().catalog) : errors;
    if (all.length || !settings) { this.errors = all; this.render(); this.root.querySelector(".notice")?.scrollIntoView({ block: "center" }); return; }
    this.saving = true;
    this.render();
    try {
      const saved = await ctx().api.saveSettings(settings, adminToken());
      ctx().settings = saved;
      try { ctx().rate = await ctx().api.rate(); } catch { /* keep */ }
      this.editing = false;
      this.form = null;
      this.errors = [];
      ctxChanged();
      toast("Налаштування збережено. Розрахунки використовують нові значення.", "ok");
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) { setAdminToken(""); this.editing = false; this.form = null; toast("Токен адміністратора не прийнято.", "err"); }
      else this.errors = e instanceof ApiError ? e.errors : [String(e)];
    } finally {
      this.saving = false;
      if (this.alive) this.render();
    }
  }
}
