import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  ChecksState,
  CurrentPullRequest,
  CurrentPullRequestResponse,
  PullRequestResult,
} from "sylva-shared";
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

/** One entry in gh's status check rollup. The two shapes GitHub actually emits. */
interface RollupEntry {
  /** Check runs: "COMPLETED", "IN_PROGRESS", "QUEUED". */
  status?: string;
  /** Check runs: "SUCCESS", "FAILURE", "NEUTRAL", "SKIPPED", "CANCELLED". */
  conclusion?: string;
  /** Commit statuses, which have no separate status field: "SUCCESS", "PENDING". */
  state?: string;
}

/**
 * Roll a list of checks up to one word.
 *
 * Failure wins over everything: one red check is the whole answer, and burying
 * it under "12 passing" is how a broken branch gets merged. Anything still
 * running comes next, because "passing so far" is not passing.
 */
export function rollUpChecks(entries: RollupEntry[]): {
  checks: ChecksState;
  passed: number;
  failed: number;
  pending: number;
} {
  let passed = 0;
  let failed = 0;
  let pending = 0;

  for (const entry of entries) {
    // A check run that hasn't completed has no conclusion yet; a commit status
    // says the same thing in its state. Read whichever one this entry has.
    const verdict = (entry.conclusion || entry.state || "").toUpperCase();
    const running = entry.status !== undefined && entry.status !== "COMPLETED";

    if (running || verdict === "PENDING" || verdict === "") pending++;
    else if (verdict === "SUCCESS" || verdict === "NEUTRAL" || verdict === "SKIPPED") passed++;
    else failed++;
  }

  const checks: ChecksState =
    entries.length === 0 ? "none" : failed > 0 ? "failing" : pending > 0 ? "pending" : "passing";
  return { checks, passed, failed, pending };
}

/**
 * The pull request for the branch this worktree is on, if there is one.
 *
 * `gh pr view` without an argument answers for the current branch, which is
 * exactly the question — no matching against a list, and no ambiguity when two
 * PRs share a head name across forks. A branch with no PR is not a failure, so
 * it comes back as a null pull with a compare URL rather than an error.
 */
export async function currentPullRequest(
  cwd: string,
  branch: string | null,
): Promise<CurrentPullRequestResponse> {
  const { stdout: remote } = await run("git", ["remote", "get-url", "origin"], { cwd }).catch(
    () => ({ stdout: "" }),
  );
  const https = remote ? remoteToHttps(remote) : null;

  try {
    const { stdout } = await run(
      "gh",
      [
        "pr",
        "view",
        "--json",
        [
          "number",
          "title",
          "url",
          "isDraft",
          "state",
          "headRefName",
          "baseRefName",
          "author",
          "updatedAt",
          "additions",
          "deletions",
          "changedFiles",
          "statusCheckRollup",
          "reviewDecision",
          "mergeable",
          "comments",
        ].join(","),
      ],
      { cwd, timeout: 30_000 },
    );

    const raw = JSON.parse(stdout || "{}") as {
      number?: number;
      title?: string;
      url?: string;
      isDraft?: boolean;
      state?: string;
      headRefName?: string;
      baseRefName?: string;
      author?: { login?: string };
      updatedAt?: string;
      additions?: number;
      deletions?: number;
      changedFiles?: number;
      statusCheckRollup?: RollupEntry[] | null;
      reviewDecision?: string | null;
      mergeable?: string | null;
      comments?: unknown[] | null;
    };

    if (!raw.number || !raw.url) {
      return { pull: null, reason: null, createUrl: compareFor(https, branch) };
    }

    const rollup = rollUpChecks(raw.statusCheckRollup ?? []);
    const pull: CurrentPullRequest = {
      number: raw.number,
      title: raw.title ?? "",
      url: raw.url,
      draft: raw.isDraft ?? false,
      state: raw.state ?? "OPEN",
      branch: raw.headRefName ?? (branch ?? ""),
      baseBranch: raw.baseRefName ?? "",
      author: raw.author?.login ?? "",
      updatedAt: raw.updatedAt ?? "",
      additions: raw.additions ?? 0,
      deletions: raw.deletions ?? 0,
      changedFiles: raw.changedFiles ?? 0,
      checks: rollup.checks,
      checksPassed: rollup.passed,
      checksFailed: rollup.failed,
      checksPending: rollup.pending,
      reviewDecision: raw.reviewDecision || null,
      mergeable: raw.mergeable || null,
      commentCount: raw.comments?.length ?? 0,
    };
    return { pull, reason: null, createUrl: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const createUrl = compareFor(https, branch);

    // "no pull requests found" is the ordinary answer for a branch you haven't
    // opened one for yet, and reporting it as a problem would be noise on every
    // branch before its PR exists.
    if (/no pull requests found|no open pull requests/i.test(message)) {
      return { pull: null, reason: null, createUrl };
    }
    const reason = /ENOENT|command not found|spawn gh/i.test(message)
      ? "`gh` isn't installed, so Sylva can't read this branch's pull request."
      : /auth|login|gh auth/i.test(message)
        ? "`gh` isn't logged in — run `gh auth login`."
        : /no git remote|none of the git remotes|not a git repository|could not determine/i.test(
              message,
            )
          ? "This repository has no GitHub remote."
          : null;
    return { pull: null, reason, createUrl };
  }
}

/** The "open a PR for this branch" page, when we know enough to build one. */
function compareFor(https: string | null, branch: string | null): string | null {
  if (!https || !branch) return null;
  return `${https}/compare/${encodeURIComponent(branch)}?expand=1`;
}
