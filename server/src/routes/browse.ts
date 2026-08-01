import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DirEntry, DirListing } from "sylva-shared";
import type { AppContext } from "../context.js";
import { badRequest } from "../lib/errors.js";

const browseSchema = z.object({ path: z.string().optional() });

/** Directories that are never worth showing in a repo picker. */
const SKIP = new Set(["node_modules", ".Trash", "Library"]);

async function isGitRepo(path: string): Promise<boolean> {
  try {
    await stat(join(path, ".git"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Directory listing for the repo picker. A browser file input cannot give an
 * absolute path, so choosing a folder has to be done against the server's own
 * filesystem. This lists directory names only — it never reads file contents —
 * and is reachable only from the app's own origin (see security.ts).
 */
export function registerBrowseRoutes(app: FastifyInstance, _ctx: AppContext): void {
  app.get("/api/browse", async (req) => {
    const query = browseSchema.parse(req.query);
    const target = query.path ? resolve(query.path) : homedir();
    if (!isAbsolute(target)) throw badRequest("Path must be absolute");

    let info;
    try {
      info = await stat(target);
    } catch {
      throw badRequest(`Cannot open ${target}`);
    }
    if (!info.isDirectory()) throw badRequest(`Not a directory: ${target}`);

    let dirents;
    try {
      dirents = await readdir(target, { withFileTypes: true });
    } catch {
      throw badRequest(`Cannot read ${target} — check permissions`);
    }

    const entries: DirEntry[] = [];
    for (const dirent of dirents) {
      if (!dirent.isDirectory() || SKIP.has(dirent.name)) continue;
      const path = join(target, dirent.name);
      entries.push({
        name: dirent.name,
        path,
        isRepo: await isGitRepo(path),
        hidden: dirent.name.startsWith("."),
      });
    }

    // Repos first (that's what you came for), then plain folders, hidden last.
    entries.sort((a, b) => {
      if (a.isRepo !== b.isRepo) return a.isRepo ? -1 : 1;
      if (a.hidden !== b.hidden) return a.hidden ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    const parent = dirname(target);
    const listing: DirListing = {
      path: target,
      parent: parent === target ? null : parent,
      isRepo: await isGitRepo(target),
      entries,
    };
    return listing;
  });

  app.get("/api/browse/home", async () => ({ path: homedir() }));
}
