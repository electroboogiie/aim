// Tiny DOM helpers: elements are always built with createElement / textContent, never from data as HTML.

export type Child = Node | string | number | null | undefined | false | Child[];
export type Props = Record<string, unknown>;

const PROPS = new Set(["value", "checked", "disabled", "selected", "hidden", "indeterminate", "readOnly", "required", "multiple"]);

function append(el: Node, child: Child): void {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) { for (const c of child) append(el, c); return; }
  el.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
}

/** h("button", {class: "btn", onclick: fn, "aria-label": "…"}, "text", child, [more]) */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || (v === false && !PROPS.has(k))) continue;
      if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
      else if (k === "class") el.className = String(v);
      else if (k === "for") (el as HTMLLabelElement).htmlFor = String(v);
      else if (PROPS.has(k)) (el as unknown as Record<string, unknown>)[k] = v;
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function clear(el: Element): void { while (el.firstChild) el.removeChild(el.firstChild); }

export function mount(el: Element, ...children: Child[]): void { clear(el); append(el, children); }

export function frag(...children: Child[]): DocumentFragment {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

let uid = 0;
export function nextId(prefix: string): string { uid += 1; return `${prefix}-${uid}`; }

const SVG_NS = "http://www.w3.org/2000/svg";

/** Inline icons (static paths, 24×24, stroke = currentColor). */
const ICONS: Record<string, string[]> = {
  kit: ["M3 17h18", "M5 17V9l5-4 5 4v8", "M15 13h4l2 4", "M8 17v-4h4v4"],
  list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  gear: ["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"],
  arrow: ["M5 12h14", "M13 6l6 6-6 6"],
  back: ["M19 12H5", "M11 18l-6-6 6-6"],
  check: ["M5 12l5 5 9-10"],
  download: ["M12 4v11", "M7 10l5 5 5-5", "M5 20h14"],
  share: ["M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M8.6 13.5l6.8 4", "M15.4 6.5l-6.8 4"],
  refresh: ["M21 12a9 9 0 1 1-2.6-6.4", "M21 4v5h-5"],
  search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M21 21l-4.3-4.3"],
  warn: ["M12 3l10 18H2z", "M12 10v4", "M12 17.5v.5"],
  info: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 11v6", "M12 7.5v.5"],
  lock: ["M6 11h12v10H6z", "M8 11V7a4 4 0 0 1 8 0v4"],
  plus: ["M12 5v14", "M5 12h14"],
  x: ["M6 6l12 12", "M18 6L6 18"],
  edit: ["M4 20h4L19 9l-4-4L4 16z", "M13 7l4 4"],
  photo: ["M3 6h18v13H3z", "M3 16l5-5 4 4 3-3 6 6", "M16 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"],
  open: ["M14 4h6v6", "M20 4l-9 9", "M18 14v6H4V6h6"],
  offline: ["M2 8.5a15 15 0 0 1 20 0", "M5.5 12a10 10 0 0 1 13 0", "M9 15.5a5 5 0 0 1 6 0", "M12 19h.01", "M3 3l18 18"],
};

export function icon(name: keyof typeof ICONS | string, cls = "ic"): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of ICONS[name] ?? []) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  }
  return svg;
}
