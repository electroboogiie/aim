// Entry point: picks the server API or the demo adapter, loads catalog/settings/rate, renders the routed view.
import type { Api, RateResp } from "./api.js";
import { ApiError, ServerApi, accessToken, onAuthRequired, onNetwork } from "./api.js";
import { ctx, hasCtx, setCtx } from "./app.js";
import type { DemoData } from "./demo.js";
import { DemoApi } from "./demo.js";
import { h, icon, mount } from "./dom.js";
import { loadDraft } from "./draft.js";
import type { Route, View } from "./router.js";
import { parseRoute } from "./router.js";
import { android, heading, hud, notice, toast } from "./ui.js";
import { ConfiguratorView } from "./views/configurator.js";
import { JournalView, KpDetailView } from "./views/journal.js";
import { SettingsView } from "./views/settings.js";
import { renderTokenScreen } from "./views/token.js";

const main = document.getElementById("main") as HTMLElement;
let view: View | null = null;
let authScreen = false;

const NAV: { route: Route["name"]; href: string; label: string; icon: string }[] = [
  { route: "configurator", href: "#/", label: "Конфігуратор", icon: "kit" },
  { route: "journal", href: "#/journal", label: "Журнал КП", icon: "list" },
  { route: "settings", href: "#/settings", label: "Налаштування", icon: "gear" },
];

function renderNav(active: Route["name"] | null): void {
  const nav = document.getElementById("nav");
  if (!nav) return;
  const current = active === "kp" ? "journal" : active;
  mount(nav, NAV.map((n) => h("a", { href: n.href, class: "tab", "aria-current": n.route === current ? "page" : undefined, id: `tab-${n.route}` },
    icon(n.icon), h("span", null, n.label))));
}

function renderBanners(): void {
  const box = document.getElementById("banners");
  if (!box || !hasCtx()) return;
  const c = ctx();
  const items: HTMLElement[] = [];
  if (c.api.mode === "demo") {
    items.push(h("div", { class: "banner banner--demo", role: "status" },
      h("b", null, "ДЕМО"),
      h("span", null, c.demoReason === "fallback" ? "Сервер недоступний — відкрито демо: " : "Демо-режим: ",
        "каталог вбудовано, курс EUR — демо-курс, журнал лише в цьому браузері, PDF не формується.")));
  }
  mount(box, items);
}

function setOffline(off: boolean): void {
  const el = document.getElementById("offline");
  if (!el) return;
  el.hidden = !off;
  document.body.classList.toggle("is-offline", off);
}

function route(): void {
  if (!hasCtx() || authScreen) return;
  const r = parseRoute(location.hash);
  view?.unmount?.();
  view = r.name === "journal" ? new JournalView()
    : r.name === "kp" ? new KpDetailView(r.id)
    : r.name === "settings" ? new SettingsView()
    : new ConfiguratorView();
  renderNav(r.name);
  view.mount(main);
  document.title = (r.name === "journal" || r.name === "kp" ? "Журнал КП" : r.name === "settings" ? "Налаштування" : "Конфігуратор") + " · Конструктор КП";
}

function fatal(title: string, messages: string[], retry: boolean): void {
  view?.unmount?.();
  view = null;
  renderNav(null);
  mount(main, h("div", { class: "page page--narrow" },
    hud("ПОМИЛКА"),
    heading(title, "", "fatal-title"),
    notice("err", "Не вдалося запустити конструктор", messages),
    retry ? h("button", { type: "button", class: "btn btn--primary", id: "retry", onclick: () => void boot() }, icon("refresh"), "Спробувати ще раз") : null));
}

function showToken(): void {
  authScreen = true;
  view?.unmount?.();
  view = null;
  renderNav(null);
  renderTokenScreen(main, () => { authScreen = false; void boot(); });
}

function loadScript(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve(true);
    s.onerror = () => { s.remove(); resolve(false); };
    document.head.append(s);
  });
}

const NO_RATE: RateResp = { eur: null, date: null, source: "none", fetched_at: null };

async function boot(): Promise<void> {
  mount(main, h("div", { class: "page" }, hud("ЗАВАНТАЖЕННЯ"), h("p", { class: "muted" }, "Завантаження каталогу…")));
  const wantDemo = new URLSearchParams(location.search).get("demo") === "1";
  let api: Api | null = null;
  let demoReason: "param" | "fallback" | null = null;
  let version = "";

  if (wantDemo) {
    if (!window.KP_DEMO_DATA) await loadScript("demo-data.js");
    if (window.KP_DEMO_DATA) { api = new DemoApi(window.KP_DEMO_DATA as DemoData); demoReason = "param"; version = "demo"; }
    else toast("Демо-дані не вбудовано в цю збірку — відкрито звичайний режим.", "info");
  }
  if (!api) {
    const server = new ServerApi();
    try {
      const hl = await server.health();
      version = hl.version ?? "";
      api = server;
    } catch (e) {
      const unreachable = !(e instanceof ApiError) || e.unreachable;
      if (unreachable && window.KP_DEMO_DATA) { api = new DemoApi(window.KP_DEMO_DATA); demoReason = "fallback"; version = "demo"; }
      else if (e instanceof ApiError && e.status === 401) { showToken(); return; }
      else { fatal("СЕРВЕР НЕДОСТУПНИЙ.", [e instanceof Error ? e.message : String(e)], true); return; }
    }
  }

  try {
    const [catalog, settings] = await Promise.all([api.catalog(), api.settings()]);
    let rate = NO_RATE;
    try { rate = await api.rate(); } catch (e) { if (e instanceof ApiError && e.status === 401) throw e; }
    setCtx({ api, catalog, settings, rate, version, demoReason });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) { showToken(); return; }
    fatal("КАТАЛОГ НЕДОСТУПНИЙ.", [e instanceof Error ? e.message : String(e)], true);
    return;
  }
  loadDraft(ctx().catalog);
  const token = accessToken();
  if (token) android("auth", { authorization: `Bearer ${token}` });
  renderBanners();
  route();
}

window.addEventListener("hashchange", route);
window.addEventListener("online", () => setOffline(false));
window.addEventListener("offline", () => setOffline(true));
onNetwork((ok) => setOffline(!ok));
onAuthRequired(() => { if (!authScreen && hasCtx() && ctx().api.mode === "server") showToken(); });
setOffline(navigator.onLine === false);

if ("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname))) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => { /* the app works without it */ });
  });
}

void boot();
