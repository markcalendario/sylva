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

export interface OpenPullRequest {
  number: number;
  title: string;
  url: string;
  draft: boolean;
  branch: string;
  author: string;
  updatedAt: string;
  /** True when this PR is the one for the branch you're standing on. */
  isCurrent: boolean;
}

export interface OpenPullRequests {
  /** Null when `gh` couldn't answer; `fallbackUrl` is then the way through. */
  pulls: OpenPullRequest[] | null;
  /** The repository's pull request page, when the remote is recognisable. */
  fallbackUrl: string | null;
  /** Why the list is missing, in a sentence, when it is. */
  reason: string | null;
}

/**
 * Open pull requests for this worktree's repository.
 *
 * Needs `gh` to list them — the compare URL trick works for *creating* a PR
 * without an API, but there is no way to read a list out of a plain git remote.
 * So when `gh` can't answer, this hands back the page instead of nothing.
 */
export async function listPullRequests(cwd: string, branch: string | null): Promise<OpenPullRequests> {
  const { stdout: remote } = await run("git", ["remote", "get-url", "origin"], { cwd }).catch(
    () => ({ stdout: "" }),
  );
  const https = remote ? remoteToHttps(remote) : null;
  const fallbackUrl = https ? `${https}/pulls` : null;

  try {
    const { stdout } = await run(
      "gh",
      [
        "pr",
        "list",
        "--state",
        "open",
        "--limit",
        "30",
        "--json",
        "number,title,url,isDraft,headRefName,author,updatedAt",
      ],
      { cwd, timeout: 30_000 },
    );
    const raw = JSON.parse(stdout || "[]") as {
      number: number;
      title: string;
      url: string;
      isDraft: boolean;
      headRefName: string;
      author?: { login?: string };
      updatedAt: string;
    }[];

    const pulls = raw.map((pr) => ({
      number: pr.number,
      title: pr.title,
      url: pr.url,
      draft: pr.isDraft,
      branch: pr.headRefName,
      author: pr.author?.login ?? "",
      updatedAt: pr.updatedAt,
      isCurrent: branch !== null && pr.headRefName === branch,
    }));
    // Yours first: you opened this panel from a worktree, and the PR for the
    // branch you're on is the one you came to look at.
    pulls.sort((a, b) =>
      a.isCurrent === b.isCurrent ? b.updatedAt.localeCompare(a.updatedAt) : a.isCurrent ? -1 : 1,
    );
    return { pulls, fallbackUrl, reason: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Order matters: gh's "not logged in" advice appears in the output of
    // several unrelated failures, so the more specific causes are tested first.
    const reason = /ENOENT|command not found|spawn gh/i.test(message)
      ? "`gh` isn't installed, so Sylva can't read the list."
      : /no git remote|none of the git remotes|not a git repository|could not determine/i.test(
            message,
          )
        ? "This repository has no GitHub remote."
        : /auth|login|gh auth/i.test(message)
          ? "`gh` isn't logged in — run `gh auth login`."
          : "Couldn't read pull requests from this repository.";
    return { pulls: null, fallbackUrl, reason };
  }
}
