// Ukrainian number and date formatting. Thousands are separated by a no-break space (U+00A0) everywhere,
// so "1 978 000 ₴" never wraps inside the number and the template's Arial / Liberation Sans renders it
// exactly like a space.

export const NBSP = " ";
export const UAH = "₴";

function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** 1978000 -> "1 978 000" (no-break spaces). */
export function formatInt(n: number): string {
  const r = Math.round(n);
  const s = groupDigits(String(Math.abs(r)));
  return r < 0 ? "-" + s : s;
}

/** 48.1 -> "48,10" (digits after the comma), integer part grouped. */
export function formatDecimal(n: number, digits: number): string {
  const fixed = Math.abs(n).toFixed(digits);
  const [int, frac] = fixed.split(".");
  const s = groupDigits(int ?? "0") + (frac ? "," + frac : "");
  return n < 0 && Number(fixed) !== 0 ? "-" + s : s;
}

/** Up to `maxDigits` decimals without trailing zeros: 2.5 -> "2,5", 3 -> "3". */
export function formatNumber(n: number, maxDigits = 2): string {
  const s = formatDecimal(n, maxDigits);
  return s.includes(",") ? s.replace(/,?0+$/, "") : s;
}

/** 1978000 -> "1 978 000 ₴". */
export function formatUah(n: number): string {
  return formatInt(n) + NBSP + UAH;
}

/** EUR rate: 48.1 -> "48,10 ₴". */
export function formatRate(n: number): string {
  return formatDecimal(n, 2) + NBSP + UAH;
}

export function formatPct(n: number): string {
  return formatNumber(n, 2) + NBSP + "%";
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = ISO.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** "2026-10-18" -> "18.10.2026"; "" for an empty or invalid date. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso || !isIsoDate(iso)) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export function addDays(iso: string, days: number): string {
  const m = ISO.exec(iso);
  if (!m) throw new Error(`Невірна дата: ${iso}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

/** Local calendar date of `now` as ISO (the server runs with TZ=Europe/Kyiv). */
export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** ["a", "b", "c"] -> "a, b або c". */
export function joinUk(list: string[], conj = "або"): string {
  if (list.length <= 1) return list.join("");
  return list.slice(0, -1).join(", ") + ` ${conj} ` + list[list.length - 1];
}

/** Nearest multiple of `step` (whole hryvnias when step <= 0). */
export function roundTo(x: number, step: number): number {
  if (!(step > 0)) return Math.round(x);
  return Math.round(x / step) * step;
}

/** "{a} і {b}" with vars {a: "x"}; unknown keys stay as they are. */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([a-z0-9_]+)\}/gi, (all, key: string) => (key in vars ? vars[key]! : all));
}
