import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PullRequestResult } from "sylva-shared";
import { badRequest } from "../lib/errors.js";

const run = promisify(execFile);

export interface PrOptions {
  draft: boolean;
  title: string;
  body: string;
  /** Branch the PR merges into, without any remote prefix. */
  base: string;
  head: string;
}

/**
 * Turn a git remote into an https URL. Handles the two forms git actually
 * emits — scp-style ssh and https — and gives up on anything else rather than
 * guessing, because a wrong URL here sends someone to a stranger's repository.
 */
export function remoteToHttps(remote: string): string | null {
  const trimmed = remote.trim().replace(/\.git$/, "");
  const ssh = /^git@([^:]+):(.+)$/.exec(trimmed);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  const sshUrl = /^ssh:\/\/git@([^/]+)\/(.+)$/.exec(trimmed);
  if (sshUrl) return `https://${sshUrl[1]}/${sshUrl[2]}`;
  if (/^https?:\/\//.test(trimmed)) return trimmed;
  return null;
}

/** The URL of GitHub's "open a pull request" form, pre-filled. */
export function compareUrl(remoteHttps: string, base: string, head: string, draft: boolean): string {
  const params = new URLSearchParams({ expand: "1" });
  if (draft) params.set("draft", "1");
  return `${remoteHttps}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?${params}`;
}

/**
 * Open a pull request for a worktree.
 *
 * Prefers `gh`, which creates the PR outright. Without it — not installed, not
 * logged in, not GitHub — we fall back to handing back the compare URL, which
 * is a worse experience but never a dead end.
 */
export async function createPullRequest(
  cwd: string,
  opts: PrOptions,
): Promise<PullRequestResult> {
  const args = [
    "pr",
    "create",
    "--base",
    opts.base,
    "--head",
    opts.head,
    "--title",
    opts.title,
    "--body",
    opts.body,
  ];
  if (opts.draft) args.push("--draft");

  try {
    const { stdout } = await run("gh", args, { cwd, timeout: 60_000 });
    const url = /https:\/\/\S+/.exec(stdout)?.[0];
    if (url) return { url, via: "gh", draft: opts.draft };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A PR that already exists is not a failure worth falling back for.
    const existing = /https:\/\/\S*\/pull\/\d+/.exec(message)?.[0];
    if (existing) return { url: existing, via: "gh", draft: opts.draft };
  }

  const { stdout: remote } = await run("git", ["remote", "get-url", "origin"], { cwd }).catch(
    () => ({ stdout: "" }),
  );
  const https = remote ? remoteToHttps(remote) : null;
  if (!https) {
    throw badRequest(
      "Couldn't open a pull request: `gh` isn't available and this worktree has no recognisable origin remote.",
    );
  }
  return { url: compareUrl(https, opts.base, opts.head, opts.draft), via: "compare", draft: opts.draft };
}
