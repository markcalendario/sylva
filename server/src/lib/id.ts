import { createHash, randomUUID } from "node:crypto";

/** Stable short ID derived from an absolute path (repos, worktrees). */
export function pathId(absPath: string): string {
  return createHash("sha256").update(absPath).digest("hex").slice(0, 12);
}

export function freshId(): string {
  return randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}
