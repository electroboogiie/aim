// Hash routes, so the page is always index.html (no server-side SPA fallback needed, works under a sub-path).

export interface View {
  mount(root: HTMLElement): void;
  unmount?(): void;
}

export type Route =
  | { name: "configurator" }
  | { name: "journal" }
  | { name: "kp"; id: string }
  | { name: "settings" };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "");
  if (path.startsWith("/journal")) return { name: "journal" };
  if (path.startsWith("/settings")) return { name: "settings" };
  const m = /^\/kp\/([^/?#]+)/.exec(path);
  if (m) { try { return { name: "kp", id: decodeURIComponent(m[1]!) }; } catch { return { name: "journal" }; } }
  return { name: "configurator" };
}

export function navigate(hash: string): void {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = hash;
}
