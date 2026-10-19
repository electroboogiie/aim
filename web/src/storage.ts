// localStorage / sessionStorage that never throws (private mode, blocked site data, quota).

function backend(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function make(kind: "local" | "session") {
  return {
    get(key: string): string | null {
      try { return backend(kind)?.getItem(key) ?? null; } catch { return null; }
    },
    set(key: string, value: string): boolean {
      try { backend(kind)?.setItem(key, value); return true; } catch { return false; }
    },
    remove(key: string): void {
      try { backend(kind)?.removeItem(key); } catch { /* ignore */ }
    },
    getJson<T>(key: string): T | null {
      const raw = this.get(key);
      if (raw === null) return null;
      try { return JSON.parse(raw) as T; } catch { return null; }
    },
    setJson(key: string, value: unknown): boolean {
      try { return this.set(key, JSON.stringify(value)); } catch { return false; }
    },
  };
}

export const local = make("local");
export const session = make("session");

export const KEYS = {
  draft: "kp.draft.v1",
  manager: "kp.manager",
  accessToken: "kp.access_token",
  adminToken: "kp.admin_token",          // sessionStorage
  presetFilter: "kp.preset_filter",
  demoJournal: "kp.demo.journal.v1",
  demoSettings: "kp.demo.settings.v1",
} as const;
