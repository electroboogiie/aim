// Server configuration from the environment (docs/CONTRACTS.md §7, §9).
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository / image root: build/server/src/config.js -> ../../.. */
export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const DEFAULT_NBU_URL = "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=EUR&json";

export interface Config {
  port: number;
  host: string | undefined;           // undefined = all interfaces
  dataDir: string;
  adminToken: string | null;
  accessToken: string | null;
  python: string;
  generatorDir: string;
  catalogFile: string;
  settingsDefaultFile: string;
  webDir: string;
  mediaDirs: string[];                // looked up in order for /media/<path> (UI thumbnails first, then generator assets)
  nbuUrl: string;
  generatorTimeoutS: number;
  kpgenBuild: string;                 // KPGEN_BUILD passed to every generator job
  maxBodyBytes: number;
}

export class ConfigError extends Error {}

type Env = Record<string, string | undefined>;

function str(env: Env, key: string): string | null {
  const v = env[key];
  return v === undefined || v.trim() === "" ? null : v.trim();
}

function path(env: Env, key: string, def: string): string {
  const v = str(env, key);
  if (v === null) return def;
  return isAbsolute(v) ? v : resolve(process.cwd(), v);
}

function int(env: Env, key: string, def: number, lo: number, hi: number): number {
  const v = str(env, key);
  if (v === null) return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new ConfigError(`${key}: очікується ціле число від ${lo} до ${hi}, отримано «${v}».`);
  return n;
}

/** Config from environment variables; relative paths are resolved against the current directory, defaults lie in APP_ROOT. */
export function loadConfig(env: Env = process.env): Config {
  const dataDir = path(env, "KP_DATA_DIR", join(APP_ROOT, "data"));
  const generatorDir = path(env, "KP_GENERATOR_DIR", join(APP_ROOT, "generator"));
  const catalogFile = path(env, "KP_CATALOG", join(APP_ROOT, "catalog", "catalog.json"));
  const webDir = path(env, "KP_WEB_DIR", join(APP_ROOT, "web", "dist"));
  return {
    port: int(env, "PORT", 8080, 0, 65535),
    host: str(env, "HOST") ?? undefined,
    dataDir,
    adminToken: str(env, "KP_ADMIN_TOKEN"),
    accessToken: str(env, "KP_ACCESS_TOKEN"),
    python: str(env, "KP_PYTHON") ?? "python3",
    generatorDir,
    catalogFile,
    settingsDefaultFile: path(env, "KP_SETTINGS_DEFAULT", join(dirname(catalogFile), "settings.default.json")),
    webDir,
    mediaDirs: [join(webDir, "media"), join(generatorDir, "assets")],   // web/media is copied to web/dist/media by build.sh
    nbuUrl: str(env, "KP_NBU_URL") ?? DEFAULT_NBU_URL,
    generatorTimeoutS: int(env, "KP_GENERATOR_TIMEOUT_S", 300, 5, 3600),
    kpgenBuild: path(env, "KPGEN_BUILD", join(dataDir, "kpgen-build")),
    maxBodyBytes: int(env, "KP_MAX_BODY_KB", 256, 1, 10240) * 1024,
  };
}
