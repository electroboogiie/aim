// Журнал КП: список з пошуком і статусами (опитування, доки КП формується) та картка КП із завантаженням PDF/PPTX.
import type { Quote } from "../../../core/src/index.js";
import { formatDate, formatPct, formatRate, formatUah } from "../../../core/src/index.js";
import type { Child } from "../dom.js";
import { h, icon, mount } from "../dom.js";
import { ctx, isDemo } from "../app.js";
import type { FileKind, KpListItem, KpRecord } from "../api.js";
import { ApiError, clientName } from "../api.js";
import { DEMO_NO_FILES } from "../demo.js";
import { loadInput } from "../draft.js";
import type { View } from "../router.js";
import { navigate } from "../router.js";
import { android, heading, hud, isFinal, notice, saveBlob, statusBadge, toast } from "../ui.js";

const LIST_POLL_MS = 3000;
const DETAIL_POLL_MS = 2000;

function fmtDate(s: string | undefined | null): string {
  if (!s) return "";
  return formatDate(s.slice(0, 10)) || s;
}

export class JournalView implements View {
  private root!: HTMLElement;
  private q = "";
  private items: KpListItem[] | null = null;
  private error: string | null = null;
  private timer: number | undefined;
  private debounce: number | undefined;
  private alive = true;
  private seq = 0;

  mount(root: HTMLElement): void {
    this.root = root;
    mount(root,
      h("div", { class: "page" },
        hud("ЖУРНАЛ"),
        heading("ЖУРНАЛ", "КОМЕРЦІЙНИХ ПРОПОЗИЦІЙ.", "journal-title"),
        isDemo() ? notice("info", "Демо-журнал", ["Записи зберігаються лише в цьому браузері; PDF і PPTX не формуються."]) : null,
        h("div", { class: "searchbox" }, icon("search"),
          h("label", { class: "sr-only", for: "journal-search" }, "Пошук у журналі"),
          h("input", {
            id: "journal-search", type: "search", class: "input", placeholder: "Пошук: номер, клієнт, кран…", autocomplete: "off",
            oninput: (e: Event) => {
              this.q = (e.target as HTMLInputElement).value;
              window.clearTimeout(this.debounce);
              this.debounce = window.setTimeout(() => void this.load(), 250);
            },
          })),
        h("div", { id: "journal-list", "aria-live": "polite", "aria-busy": "true" }, h("p", { class: "muted" }, "Завантаження…"))));
    void this.load();
  }

  unmount(): void { this.alive = false; window.clearTimeout(this.timer); window.clearTimeout(this.debounce); }

  private async load(): Promise<void> {
    window.clearTimeout(this.timer);
    const seq = ++this.seq;
    try {
      const items = await ctx().api.listKp(this.q, 100);
      if (!this.alive || seq !== this.seq) return;
      this.items = items;
      this.error = null;
    } catch (e) {
      if (!this.alive || seq !== this.seq) return;
      this.error = e instanceof ApiError ? e.message : String(e);
    }
    this.renderList();
    if (this.items?.some((x) => !isFinal(x.status))) this.timer = window.setTimeout(() => void this.load(), LIST_POLL_MS);
  }

  private renderList(): void {
    const box = document.getElementById("journal-list");
    if (!box) return;
    box.setAttribute("aria-busy", "false");
    if (this.error) { mount(box, notice("err", "Журнал недоступний", [this.error])); return; }
    const items = this.items ?? [];
    if (!items.length) {
      mount(box, h("div", { class: "empty" },
        h("p", null, this.q ? "Нічого не знайдено." : "Ще немає жодної КП."),
        this.q ? null : h("a", { class: "btn btn--primary", href: "#/" }, "Створити КП", icon("arrow"))));
      return;
    }
    mount(box, h("ul", { class: "kplist" }, items.map((x) => h("li", null,
      h("a", { class: "card card--kp", href: `#/kp/${encodeURIComponent(x.id)}`, id: `kp-${x.id}` },
        h("span", { class: "kp__top" }, h("span", { class: "kp__no" }, `КП № ${x.number}`), statusBadge(x.status)),
        h("span", { class: "kp__client" }, clientName(x.client) || "без клієнта"),
        h("span", { class: "kp__title" }, x.title),
        h("span", { class: "kp__bottom" },
          h("span", { class: "muted" }, fmtDate(x.date)),
          h("span", { class: "kp__sum" }, typeof x.total_uah === "number" ? formatUah(x.total_uah) : "—")))))));
  }
}

export class KpDetailView implements View {
  private root!: HTMLElement;
  private rec: KpRecord | null = null;
  private error: string | null = null;
  private timer: number | undefined;
  private alive = true;
  private busy = "";
  private readonly id: string;

  constructor(id: string) { this.id = id; }

  mount(root: HTMLElement): void {
    this.root = root;
    mount(root, h("div", { class: "page" }, hud("ЖУРНАЛ · КП"), h("p", { class: "muted" }, "Завантаження…")));
    void this.load();
  }

  unmount(): void { this.alive = false; window.clearTimeout(this.timer); }

  private async load(): Promise<void> {
    window.clearTimeout(this.timer);
    try {
      const rec = await ctx().api.getKp(this.id);
      if (!this.alive) return;
      const was = this.rec?.status;
      this.rec = rec;
      this.error = null;
      if (was && !isFinal(was) && rec.status === "ready") toast(`КП № ${rec.number} готова.`, "ok");
      if (was && !isFinal(was) && rec.status === "error") toast(`КП № ${rec.number}: помилка формування.`, "err");
    } catch (e) {
      if (!this.alive) return;
      this.error = e instanceof ApiError ? e.message : String(e);
    }
    this.render();
    if (this.rec && !isFinal(this.rec.status)) this.timer = window.setTimeout(() => void this.load(), DETAIL_POLL_MS);
  }

  private fileReady(kind: FileKind): boolean {
    const r = this.rec;
    if (!r || r.status !== "ready" || isDemo()) return false;
    if (!r.files || typeof r.files !== "object") return true;
    return !!r.files[kind];
  }

  private render(): void {
    const r = this.rec;
    const back = h("a", { class: "btn btn--ghost btn--sm", href: "#/journal" }, icon("back"), "До журналу");
    if (!r) {
      mount(this.root, h("div", { class: "page" }, hud("ЖУРНАЛ · КП"), back, notice("err", "КП недоступна", [this.error ?? "Невідома помилка."])));
      return;
    }
    const q = r.quote;
    const client = typeof r.client === "string" ? { name: r.client } : r.client;
    const company = r.maker ? ctx().catalog.companies.find((x) => x.id === r.maker)?.name ?? r.maker : null;
    const statusLine: Child = r.status === "queued" ? "КП чекає в черзі генератора. Сторінка оновиться сама."
      : r.status === "running" ? "Генератор складає PPTX і PDF — зазвичай до хвилини (перша КП крана довше)."
      : r.status === "ready" ? "Файли готові." : r.status === "error" ? "КП не сформовано." : DEMO_NO_FILES;

    const fileBtn = (kind: FileKind, label: string) => h("button", {
      type: "button", class: kind === "pdf" ? "btn btn--primary" : "btn", id: `dl-${kind}`,
      disabled: !this.fileReady(kind) || !!this.busy, onclick: () => void this.download(kind),
    }, icon("download"), this.busy === kind ? "Завантаження…" : label);

    mount(this.root,
      h("div", { class: "page page--kp" },
        back,
        hud(`ЖУРНАЛ · КП № ${r.number}`),
        heading(`КП № ${r.number}`, (r.title || "") + ".", "kp-title"),
        h("div", { class: "kp-status" }, statusBadge(r.status), h("span", { class: "muted" }, statusLine)),
        r.status === "error" && r.error ? notice("err", "Помилка генератора", [r.error]) : null,
        h("div", { class: "actions" },
          fileBtn("pdf", "PDF"),
          fileBtn("pptx", "PPTX"),
          h("button", { type: "button", class: "btn", id: "kp-share", disabled: !!this.busy, onclick: () => void this.share() }, icon("share"), "Поділитися"),
          h("button", { type: "button", class: "btn", id: "kp-recalc", disabled: !!this.busy || !r.quote_input, onclick: () => void this.recalc() },
            icon("refresh"), this.busy === "recalc" ? "Перерахунок…" : "Перерахувати за сьогоднішнім курсом"),
          h("button", { type: "button", class: "btn btn--ghost", id: "kp-open", disabled: !r.quote_input, onclick: () => this.openInConfigurator() }, icon("edit"), "Відкрити в конфігураторі")),
        isDemo() ? h("p", { class: "small muted" }, "Демо: кнопки PDF і PPTX працюють лише на сервері.") : null,
        h("dl", { class: "kv block" },
          h("dt", null, "Дата"), h("dd", null, fmtDate(r.date)),
          h("dt", null, "Клієнт"), h("dd", null, client?.name || "—"),
          client && "contact" in client && client.contact ? [h("dt", null, "Контакт"), h("dd", null, client.contact)] : null,
          r.manager ? [h("dt", null, "Менеджер"), h("dd", null, r.manager)] : null,
          company ? [h("dt", null, "Юрособа"), h("dd", null, company)] : null,
          h("dt", null, "Сума"), h("dd", { class: "kv__sum" }, typeof r.total_uah === "number" ? formatUah(r.total_uah) : "—"),
          q ? [h("dt", null, "Курс EUR"), h("dd", null, rateText(q))] : null,
          q?.valid_until ? [h("dt", null, "Дійсна до"), h("dd", null, fmtDate(q.valid_until))] : null),
        q ? this.rows(q) : null,
        q?.warnings.length ? notice("warn", "Попередження розрахунку", q.warnings) : null));
  }

  private rows(q: Quote): HTMLElement {
    return h("div", { class: "table-wrap block" },
      h("table", { class: "q" },
        h("caption", { class: "sr-only" }, "Позиції КП"),
        h("thead", null, h("tr", null, h("th", { scope: "col" }, h("span", { class: "sr-only" }, "№")), h("th", { scope: "col" }, "Позиція"), h("th", { scope: "col", class: "q__price" }, "Ціна, ₴"))),
        h("tbody", null,
          q.rows.map((r, i) => h("tr", null, h("td", { class: "q__no" }, String(i + 1).padStart(2, "0")),
            h("td", { class: "q__pos" }, h("span", { class: "q__title" }, r.title), r.desc ? h("span", { class: "q__desc" }, r.desc) : null),
            h("td", { class: "q__price" }, r.price_text))),
          q.accessories.map((r) => h("tr", null, h("td", { class: "q__no" }, "+"),
            h("td", { class: "q__pos" }, h("span", { class: "q__title" }, r.title)), h("td", { class: "q__price" }, r.price_text))),
          h("tr", { class: "q__totalrow" }, h("td"), h("td", null, "Разом" + (q.discount_pct > 0 ? ` (знижка ${formatPct(q.discount_pct)})` : "")),
            h("td", { class: "q__price" }, formatUah(q.total_uah))))));
  }

  private async download(kind: FileKind): Promise<void> {
    if (!this.rec) return;
    this.busy = kind; this.render();
    try {
      const { blob, fileName } = await ctx().api.download(this.rec.id, kind);
      saveBlob(blob, fileName);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не вдалося завантажити файл.", "err");
    } finally {
      this.busy = ""; if (this.alive) this.render();
    }
  }

  private async share(): Promise<void> {
    const r = this.rec;
    if (!r) return;
    const text = `КП № ${r.number} · ${r.title}${clientName(r.client) ? " · " + clientName(r.client) : ""}${typeof r.total_uah === "number" ? " · " + formatUah(r.total_uah) : ""}`;
    if (this.fileReady("pdf") && window.KpAndroid) {
      android("download", { url: ctx().api.fileUrl(r.id, "pdf"), action: "share" });
      return;
    }
    try {
      if (this.fileReady("pdf") && typeof navigator.share === "function") {
        this.busy = "share"; this.render();
        const { blob, fileName } = await ctx().api.download(r.id, "pdf");
        const file = new File([blob], fileName, { type: blob.type || "application/pdf" });
        if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: text, text }); return; }
      }
      if (typeof navigator.share === "function") { await navigator.share({ title: text, text, url: location.href }); return; }
      await navigator.clipboard.writeText(`${text}\n${location.href}`);
      toast("Опис і посилання скопійовано в буфер обміну.", "ok");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      toast(e instanceof ApiError ? e.message : "Поділитися не вдалося: цей браузер не підтримує надсилання.", "err");
    } finally {
      if (this.busy === "share") { this.busy = ""; if (this.alive) this.render(); }
    }
  }

  private async recalc(): Promise<void> {
    const r = this.rec;
    if (!r) return;
    this.busy = "recalc"; this.render();
    try {
      const res = await ctx().api.recalc(r.id);
      toast(`Створено КП № ${res.number} за сьогоднішнім курсом.`, "ok");
      navigate(`#/kp/${encodeURIComponent(res.id)}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.errors.join(" ") : String(e), "err");
      this.busy = ""; if (this.alive) this.render();
    }
  }

  private openInConfigurator(): void {
    const r = this.rec;
    if (!r?.quote_input) return;
    const client = typeof r.client === "string" ? { name: r.client } : r.client;
    if (!loadInput(r.quote_input, client, r.maker)) { toast("Тип комплекту цієї КП більше немає в каталозі.", "err"); return; }
    toast(`Розрахунок КП № ${r.number} відкрито в конфігураторі.`);
    navigate("#/");
  }
}

function rateText(q: Quote): string {
  if (q.eur_rate === null) return "недоступний";
  const src = q.eur_rate_source === "demo" ? "демо-курс" : q.eur_rate_source === "manual" ? "ручний" : "НБУ";
  return `${formatRate(q.eur_rate)} · ${src}${q.eur_applied ? "" : " · на ціни не вплинув"}`;
}

