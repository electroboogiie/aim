// Shared runtime context: the API in use, the loaded catalog/settings/rate and small UI services.
import type { Catalog, Settings } from "../../core/src/index.js";
import type { Api, RateResp } from "./api.js";

export interface AppCtx {
  api: Api;
  catalog: Catalog;
  settings: Settings;
  rate: RateResp;
  version: string;
  demoReason: "param" | "fallback" | null;   // why the demo adapter is used
}

let current: AppCtx | null = null;

export function ctx(): AppCtx {
  if (!current) throw new Error("app context is not ready");
  return current;
}
export function setCtx(c: AppCtx): void { current = c; }
export function hasCtx(): boolean { return current !== null; }

export function isDemo(): boolean { return current?.api.mode === "demo"; }

type Hook = () => void;
const changeHooks: Hook[] = [];
/** Views subscribe to settings / rate changes (e.g. after saving settings). */
export function onCtxChange(fn: Hook): () => void {
  changeHooks.push(fn);
  return () => { const i = changeHooks.indexOf(fn); if (i >= 0) changeHooks.splice(i, 1); };
}
export function ctxChanged(): void { for (const fn of [...changeHooks]) fn(); }
