// File helpers shared by the journal, settings, rate cache and generator.
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";

/** Writes via a temp file + rename, so a crash never leaves a half-written file. */
export function writeFileAtomic(file: string, data: string | Buffer): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/** True when `p` is `root` itself or lies below it (both resolved). */
export function isInside(root: string, p: string, allowRoot = false): boolean {
  const rel = relative(resolve(root), resolve(p));
  if (rel === "") return allowRoot;
  return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}
