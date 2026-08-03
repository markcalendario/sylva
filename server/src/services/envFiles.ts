import { constants } from "node:fs";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { GitService } from "./git.js";

/**
 * Carrying `.env` files into a new worktree.
 *
 * `git worktree add` checks out tracked files and nothing else, which is
 * correct and also exactly wrong for env files: they are gitignored precisely
 * because they hold secrets, so every new worktree arrives unable to run the
 * app until you remember which of six directories to copy them out of.
 */

/** `.env`, `.env.local`, `.env.production.local` — but not `environment.ts`. */
const ENV_FILE = /^\.env(\..+)?$/;

/** A stray huge file matching the pattern is not an env file worth copying. */
const MAX_BYTES = 1024 * 1024;

/** Enough for a monorepo with a config per package; a lid on pathological trees. */
const MAX_FILES = 64;

/**
 * Every env file in the source tree that git isn't already carrying, as paths
 * relative to its root.
 *
 * git is asked rather than the filesystem walked, and that is the whole trick.
 * `ls-files --directory` collapses a wholly-ignored directory to one entry, so
 * `node_modules/` comes back as a single line instead of eighty thousand — the
 * scan can't wander into it, cost nothing to bound, and honours whatever the
 * repository's own .gitignore says. Tracked files are excluded because the
 * checkout already brought those.
 */
export async function findEnvFiles(git: GitService, sourceDir: string): Promise<string[]> {
  const lists = await Promise.all([
    // Ignored — where a .env almost always is.
    git
      .run(sourceDir, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"])
      .then((r) => r.stdout),
    // Untracked but not ignored: a .env in a repository with no rule for it.
    git.run(sourceDir, ["ls-files", "--others", "--exclude-standard"]).then((r) => r.stdout),
  ]);

  const found = new Set<string>();
  for (const line of lists.join("\n").split("\n")) {
    const path = line.trim();
    // A trailing slash is a collapsed directory, not a file to copy.
    if (!path || path.endsWith("/")) continue;
    if (!ENV_FILE.test(path.slice(path.lastIndexOf("/") + 1))) continue;
    found.add(path);
  }
  return [...found].sort().slice(0, MAX_FILES);
}

/**
 * Copy the source tree's env files into a fresh worktree, and say which landed.
 *
 * Nothing already in the target is touched: a tracked `.env.example` came with
 * the checkout and is the version that branch means, and overwriting it with
 * whatever the main worktree happens to hold right now would be a change nobody
 * asked for. Individual failures are skipped rather than raised — the worktree
 * exists either way, and losing it over an unreadable file would be the worse
 * outcome by far.
 */
export async function copyEnvFiles(
  git: GitService,
  sourceDir: string,
  targetDir: string,
): Promise<string[]> {
  const candidates = await findEnvFiles(git, sourceDir);
  const copied: string[] = [];

  for (const relative of candidates) {
    const from = join(sourceDir, relative);
    const to = join(targetDir, relative);
    try {
      const info = await stat(from);
      if (!info.isFile() || info.size > MAX_BYTES) continue;
      await mkdir(dirname(to), { recursive: true });
      // EXCL is what makes "don't overwrite" a property of the copy itself,
      // rather than a check that something could slip between.
      await copyFile(from, to, constants.COPYFILE_EXCL);
      copied.push(relative);
    } catch {
      // Already there, unreadable, or vanished mid-copy. Any of those is a file
      // to leave alone, not a reason to fail the worktree.
    }
  }

  return copied;
}
