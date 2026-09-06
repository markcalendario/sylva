import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { FleetDigest, FleetEntry } from "sylva-shared";
import type { AppContext } from "../context.js";
import { badRequest } from "../lib/errors.js";
import { createPullRequest, currentPullRequest, listPullRequests } from "../services/pr.js";

const treeQuerySchema = z.object({ path: z.string().max(1000).optional() });
const fileQuerySchema = z.object({ path: z.string().min(1).max(1000) });
const blameQuerySchema = z.object({
  path: z.string().min(1).max(1000),
  line: z.coerce.number().int().min(1),
});
const searchQuerySchema = z.object({ q: z.string().max(200).optional() });
/** The cap matches what `fileContent` will read back, so a save can't truncate. */
const writeFileSchema = z.object({
  path: z.string().min(1).max(1000),
  content: z.string().max(256 * 1024),
});
const prSchema = z
  .object({
    draft: z.boolean().default(false),
    title: z.string().max(200).default(""),
    body: z.string().max(20_000).default(""),
  })
  .default({ draft: false, title: "", body: "" });

const pathsSchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ paths: z.array(z.string().min(1)).min(1) }),
]);
const commitSchema = z.object({ message: z.string() });
const commitManySchema = z.object({
  worktreeIds: z.array(z.string().min(1)).min(1).max(8),
  message: z.string(),
});
const pushSchema = z.object({ setUpstream: z.boolean().optional() }).default({});
const diffQuerySchema = z.object({
  path: z.string().min(1),
  staged: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

export function registerGitRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { gitOps, hub } = ctx;

  async function broadcastStatus(worktreeId: string): Promise<void> {
    const status = await ctx.gitOps.status(worktreeId);
    hub.broadcast({ type: "git.status", status });
  }

  app.get("/api/worktrees/:worktreeId/status", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    return gitOps.status(worktreeId);
  });

  /** Seeds the Files feed on focus, so the tab isn't blank on arrival. */
  app.get("/api/worktrees/:worktreeId/recent-files", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    return gitOps.recentFiles(worktreeId);
  });

  app.post("/api/worktrees/:worktreeId/commit-message", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    return ctx.commitMessages.generate(worktreeId);
  });

  app.get("/api/worktrees/:worktreeId/diff", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const query = diffQuerySchema.parse(req.query);
    return gitOps.diff(worktreeId, query.path, query.staged ?? false);
  });

  app.post("/api/worktrees/:worktreeId/stage", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const body = pathsSchema.parse(req.body);
    await gitOps.stage(worktreeId, "all" in body ? "all" : body.paths);
    await broadcastStatus(worktreeId);
    return { ok: true };
  });

  app.post("/api/worktrees/:worktreeId/unstage", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const body = pathsSchema.parse(req.body);
    await gitOps.unstage(worktreeId, "all" in body ? "all" : body.paths);
    await broadcastStatus(worktreeId);
    return { ok: true };
  });

  /**
   * Throw changes away. Nothing here is recoverable, which is why the client
   * asks first — but the check that matters is the one the caller has already
   * done: this route will do exactly what it is told.
   */
  app.post("/api/worktrees/:worktreeId/discard", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const body = pathsSchema.parse(req.body);
    await gitOps.discard(worktreeId, "all" in body ? "all" : body.paths);
    await broadcastStatus(worktreeId);
    return { ok: true };
  });

  app.post("/api/worktrees/:worktreeId/commit", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const body = commitSchema.parse(req.body);
    const result = await gitOps.commit(worktreeId, body.message);
    await broadcastStatus(worktreeId);
    return result;
  });

  /** One message, several worktrees; the result says what actually landed. */
  app.post("/api/worktrees/commit-many", async (req) => {
    const body = commitManySchema.parse(req.body);
    const result = await gitOps.commitMany(body.worktreeIds, body.message);
    for (const outcome of result.results) {
      if (outcome.ok) await broadcastStatus(outcome.worktreeId);
    }
    return result;
  });

  app.get("/api/repos/:repoId/branches", async (req) => {
    const { repoId } = req.params as { repoId: string };
    return gitOps.branches(repoId);
  });

  app.post("/api/worktrees/:worktreeId/push", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const body = pushSchema.parse(req.body ?? {});
    const result = await gitOps.push(worktreeId, body.setUpstream ?? false);
    await broadcastStatus(worktreeId);
    return result;
  });

  app.post("/api/worktrees/:worktreeId/pull", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const result = await gitOps.pull(worktreeId);
    await broadcastStatus(worktreeId);
    return result;
  });

  app.get("/api/worktrees/:worktreeId/graph", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    return gitOps.graph(worktreeId);
  });

  /** What one commit in the history actually changed. */
  app.get("/api/worktrees/:worktreeId/commits/:sha", async (req) => {
    const { worktreeId, sha } = req.params as { worktreeId: string; sha: string };
    return gitOps.commitDetail(worktreeId, sha);
  });

  app.get("/api/worktrees/:worktreeId/commits/:sha/diff", async (req) => {
    const { worktreeId, sha } = req.params as { worktreeId: string; sha: string };
    const { path } = fileQuerySchema.parse(req.query);
    return gitOps.commitDiff(worktreeId, sha, path);
  });

  app.get("/api/worktrees/:worktreeId/tree", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const { path } = treeQuerySchema.parse(req.query);
    return gitOps.tree(worktreeId, path ?? "");
  });

  app.get("/api/worktrees/:worktreeId/search-files", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const { q } = searchQuerySchema.parse(req.query);
    return gitOps.searchFiles(worktreeId, q ?? "");
  });

  app.get("/api/worktrees/:worktreeId/search-content", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const { q } = searchQuerySchema.parse(req.query);
    return gitOps.searchContent(worktreeId, q ?? "");
  });

  app.get("/api/worktrees/:worktreeId/file", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const { path } = fileQuerySchema.parse(req.query);
    return gitOps.fileContent(worktreeId, path);
  });

  /**
   * Save an edit made in the Files tab. Broadcasts status afterwards rather
   * than waiting on the watcher: the edit came from this app, so the change
   * list should already reflect it by the time the save returns.
   */
  app.put("/api/worktrees/:worktreeId/file", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const body = writeFileSchema.parse(req.body);
    const saved = await gitOps.writeFileContent(worktreeId, body.path, body.content);
    await broadcastStatus(worktreeId);
    return saved;
  });

  /** Who last touched one line — follows the caret in the Files tab. */
  app.get("/api/worktrees/:worktreeId/blame", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const { path, line } = blameQuerySchema.parse(req.query);
    return gitOps.blameLine(worktreeId, path, line);
  });

  /** Which lines of a file differ from the last commit, for the gutter. */
  app.get("/api/worktrees/:worktreeId/changed-lines", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const { path } = fileQuerySchema.parse(req.query);
    return gitOps.changedLines(worktreeId, path);
  });

  /**
   * Every registered worktree's status in one answer.
   *
   * Asked as one request rather than one per worktree because the whole point
   * of the digest is the shape of the fleet — thirty round trips arriving
   * separately would draw it a row at a time.
   */
  app.get("/api/fleet", async () => {
    const entries: FleetEntry[] = [];

    for (const repo of ctx.store.repos) {
      let worktrees: Awaited<ReturnType<typeof ctx.workspace.listWorktrees>>;
      try {
        worktrees = await ctx.workspace.listWorktrees(repo.id);
      } catch {
        // A repository that has moved or been deleted takes its worktrees with
        // it; the rest of the fleet is still worth reporting.
        continue;
      }

      for (const worktree of worktrees) {
        try {
          const status = await gitOps.status(worktree.id);
          entries.push({
            worktreeId: worktree.id,
            repoId: repo.id,
            repoName: repo.name,
            branch: worktree.branch,
            status,
            error: null,
          });
        } catch (err) {
          entries.push({
            worktreeId: worktree.id,
            repoId: repo.id,
            repoName: repo.name,
            branch: worktree.branch,
            status: null,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return { entries } satisfies FleetDigest;
  });

  /** Pull requests already open on this repository. */
  app.get("/api/worktrees/:worktreeId/pulls", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const { worktree } = await ctx.workspace.resolveWorktree(worktreeId);
    return listPullRequests(worktree.path, worktree.branch);
  });

  /**
   * The pull request for the branch this worktree is standing on — the one the
   * Git tab shows inline, so its state is visible without opening a dialog.
   */
  app.get("/api/worktrees/:worktreeId/pull", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const { worktree } = await ctx.workspace.resolveWorktree(worktreeId);
    return currentPullRequest(worktree.path, worktree.branch);
  });

  /**
   * Open a pull request. Pushes first when the branch has no upstream, since a
   * PR for commits GitHub has never seen is not a PR.
   */
  app.post("/api/worktrees/:worktreeId/pr", async (req) => {
    const { worktreeId } = req.params as { worktreeId: string };
    const body = prSchema.parse(req.body ?? {});
    const { worktree } = await ctx.workspace.resolveWorktree(worktreeId);
    const status = await gitOps.status(worktreeId);
    if (!status.branch) throw badRequest("Cannot open a pull request from a detached HEAD");
    if (!status.base) {
      throw badRequest("Couldn't work out which branch to merge into — no base branch found");
    }
    if (!status.upstream) {
      await gitOps.push(worktreeId, true);
      await broadcastStatus(worktreeId);
    }
    // The base arrives as "origin/main"; GitHub wants the branch name alone.
    const base = status.base.branch.replace(/^origin\//, "");
    return createPullRequest(worktree.path, {
      draft: body.draft,
      title: body.title || status.branch,
      body: body.body,
      base,
      head: status.branch,
    });
  });
}
