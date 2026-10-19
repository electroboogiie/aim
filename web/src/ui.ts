// Shared UI pieces in the KP_2_v3 look: HUD labels, two-line headings, thumbnails, badges, toasts, dialogs.
import type { Child } from "./dom.js";
import { h, icon } from "./dom.js";
import type { KpStatus } from "./api.js";

/** "// 01 — КОМПЛЕКТ" */
export function hud(text: string, extra = ""): HTMLElement {
  return h("p", { class: `hud ${extra}`.trim() }, "// " + text);
}

/** Large bold caps heading: first line light, second line orange (as in the KP). */
export function heading(line1: string, line2: string, id?: string): HTMLHeadingElement {
  return h("h1", { class: "title", id, tabindex: "-1" }, h("span", null, line1), " ", h("span", { class: "accent" }, line2));
}

export function sectionTitle(text: string): HTMLElement { return h("h2", { class: "section-title" }, text); }

/** Thumbnail path for a catalog photo (scripts/thumbs.py writes web/media/<path>.jpg). */
export function thumbSrc(photo: string): string { return "media/" + photo.replace(/\.[a-z0-9]+$/i, "") + ".jpg"; }

export function thumb(photo: string | undefined | null, alt: string, cls = "thumb"): HTMLElement {
  if (!photo) return h("div", { class: `${cls} thumb--empty`, "aria-hidden": "true" }, icon("photo"));
  const img = h("img", { src: thumbSrc(photo), alt, loading: "lazy", decoding: "async", width: "320", height: "240" });
  return h("div", { class: cls }, img);
}

export type Tone = "accent" | "ok" | "warn" | "err" | "muted" | "info";
export function badge(text: string, tone: Tone = "muted", title?: string): HTMLElement {
  return h("span", { class: `badge badge--${tone}`, title }, text);
}

export const STATUS_TITLES: Record<string, string> = {
  queued: "в черзі", running: "формується", ready: "готово", error: "помилка", demo: "демо · без PDF",
};
const STATUS_TONES: Record<string, Tone> = { queued: "info", running: "accent", ready: "ok", error: "err", demo: "muted" };
export function isFinal(s: KpStatus | string): boolean { return s !== "queued" && s !== "running"; }
export function statusBadge(s: KpStatus | string): HTMLElement {
  const b = badge(STATUS_TITLES[s] ?? s, STATUS_TONES[s] ?? "muted");
  if (!isFinal(s)) b.prepend(h("span", { class: "spinner", "aria-hidden": "true" }));
  return b;
}

/** Alert box: list of messages. */
export function notice(tone: "warn" | "err" | "info" | "ok", title: string, items: Child[], extra?: Child): HTMLElement {
  return h("div", { class: `notice notice--${tone}`, role: tone === "err" ? "alert" : undefined },
    h("p", { class: "notice__title" }, icon(tone === "ok" ? "check" : tone === "info" ? "info" : "warn"), title),
    items.length ? h("ul", null, items.map((x) => h("li", null, x))) : null,
    extra ?? null);
}

/** "686 000", "686000", "1 978 000,50 ₴" -> number; "" -> null; NaN when not a number. */
export function parseAmount(s: string): number | null {
  const t = s.replace(/[\s  ₴%]/g, "").replace(",", ".");
  if (!t) return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return Number.NaN;
  return Number(t);
}

let toastTimer: number | undefined;
export function toast(message: string, tone: "ok" | "err" | "info" = "info"): void {
  const el = document.getElementById("toast");
  if (!el) return;
  el.className = `toast toast--${tone} is-on`;
  el.textContent = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.className = "toast"; }, tone === "err" ? 7000 : 4000);
}

/** Modal dialog with buttons; resolves with the id of the pressed button ("" when dismissed). */
export function dialog(title: string, body: Child, buttons: { id: string; label: string; primary?: boolean }[]): Promise<string> {
  return new Promise((resolve) => {
    const dlg = h("dialog", { class: "dialog", "aria-labelledby": "dlg-title" });
    const close = (id: string) => { dlg.close(); dlg.remove(); android("refresh", { enabled: true }); resolve(id); };
    dlg.append(
      h("div", { class: "dialog__frame" },
        h("h2", { id: "dlg-title", class: "dialog__title" }, title),
        h("div", { class: "dialog__body" }, body),
        h("div", { class: "dialog__actions" },
          buttons.map((b) => h("button", { type: "button", class: b.primary ? "btn btn--primary" : "btn", onclick: () => close(b.id) }, b.label)))),
    );
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(""); });
    document.body.append(dlg);
    android("refresh", { enabled: false });
    dlg.showModal();
    (dlg.querySelector(".btn--primary") as HTMLElement | null ?? dlg.querySelector("button"))?.focus();
  });
}

/** Message to the Android wrapper (CONTRACTS §8); no-op in a browser. */
export function android(type: string, fields: Record<string, unknown> = {}): boolean {
  try {
    if (!window.KpAndroid) return false;
    window.KpAndroid.postMessage(JSON.stringify({ type, ...fields }));
    return true;
  } catch {
    return false;
  }
}

/** Save a blob as a file (works in browsers and in the Android app, §8). */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function field(label: string, control: HTMLElement, hint?: Child, error?: string | null): HTMLElement {
  const id = control.id;
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const described = [hintId, errId].filter(Boolean).join(" ");
  if (described) control.setAttribute("aria-describedby", described);
  if (error) control.setAttribute("aria-invalid", "true");
  return h("div", { class: error ? "field field--error" : "field" },
    h("label", { class: "field__label", for: id }, label),
    control,
    hint ? h("p", { class: "field__hint", id: hintId }, hint) : null,
    error ? h("p", { class: "field__error", id: errId }, error) : null);
}
