# Design: One pane for a shared dryad

## Context

The circle already works where it matters: `SessionManager` resolves a target to
several worktrees, hands the SDK a working directory plus additional roots, and
the dryad reads and writes across all of them with one memory. That part needed
server work and got it.

The panels are a different problem, and a smaller one than it looks. Every git,
file and runner endpoint is already addressed by worktree id. Nothing on the
server needs to learn about circles. What is missing is entirely on the client:
the panels take a `worktreeId: string` and therefore can only ever be about one.

The member switcher was the cheapest way to reconcile that, and it is wrong for
a reason worth naming: it moves the work of splitting attention onto the person.
A shared dryad exists so you can stop thinking about which repository you are in.
A switch that asks exactly that question, in the header, undoes it.

## Goals / Non-Goals

**Goals**

- One pane that shows a shared piece of work whole, without a control that asks
  which half you meant.
- A single worktree keeps rendering exactly as it does now — same components,
  same layout, not a special case bolted beside a new one.
- Make the coordinated commit — one message, two repositories — a first-class
  action, since that is the thing the whole feature is for.

**Non-Goals**

- Not a merged git index. A commit belongs to one repository; nothing here
  pretends otherwise. What is shared is the *view* and the *message*, never the
  history.
- Not cross-repository staging. You cannot stage a file from one worktree into
  another's commit, because that isn't a thing.
- Not one dev server for several projects. Each worktree runs its own command;
  what is shared is the tab and the log.
- No new server endpoints beyond the batched commit.

## Decisions

### D1 — Panels take `members: string[]`, and one member is the ordinary case

`FilesPanel`, `GitPanel` and `RunPanel` change signature from
`worktreeId: string` to `members: string[]`. `WorktreePane` resolves the pane's
target once:

```
const members = circleMembers(pane.worktreeId) ?? [pane.worktreeId]
```

Every panel then maps over that list. With one entry the output is what it
renders today — one section, no worktree labels, no "all" controls. This is what
keeps the change honest: there is no second code path to keep in step, so a
regression in the shared case is a regression in the single case too, and gets
caught immediately.

*Alternative rejected:* a `SharedGitPanel` beside `GitPanel`. Two components
that must agree about staging, diffs and commits, diverging the first time one
is fixed and the other isn't.

### D2 — Git is a section per worktree, sharing one diff pane

```
┌ toolbar: 2 worktrees · [Pull all] [Push all] [Open PRs] ┐
│ ┌──────────────────────────────────────┐               │
│ │ old-system / feat-legacy   ↑2 ↓0  ⋯  │  ← section     │   diff for
│ │   staged (1)                          │     header    │   whatever
│ │   changes (3)                         │               │   is selected
│ │   [commit message        ] [Commit]   │               │
│ ├──────────────────────────────────────┤               │
│ │ new-system / feat-rewrite  ↑5 ↓1  ⋯  │               │
│ │   staged (2)                          │               │
│ │   [commit message        ] [Commit]   │               │
│ └──────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────┘
```

Each section owns its branch, divergence, file groups, commit box, pull and
push — because each of those is a per-repository fact and pretending otherwise
would be lying. The toolbar above holds only what genuinely spans them:
pull-all, push-all, open PRs, and the shared commit.

The diff pane is shared and unsectioned. A diff is a diff; which worktree it
came from is already stated by the section you clicked in, and repeating it in
a second place is noise.

*Alternative rejected:* tabs per worktree inside the Git panel. That is the
member switcher again, moved one level down.

### D3 — Selection becomes `{ worktreeId, path, staged }`

`Pane.diffPath: string | null` becomes `Pane.diff: DiffSelection | null`. A bare
path is ambiguous the moment two worktrees are open — both may have a
`src/index.ts`, and today the wrong one would render with no way to tell.

This also fixes a latent bug in the current single-worktree code: `GitPanel` is
keyed on `pane.diffPath`, so opening a diff for the same path in a different
worktree does not remount and shows stale data.

### D4 — One message, several commits, reported per worktree

When two or more members have staged files, the toolbar offers a single message
and a "Commit in N worktrees" action. It posts to a new
`POST /api/worktrees/commit-many { commits: [{worktreeId, message}] }` which
commits each in turn and returns a per-worktree result.

Why a route rather than three calls from the client: three calls can half-fail,
and the client would have to invent its own story about what happened. One call
returns one answer — "committed in old-system, failed in new-system: hook
rejected" — which is the truth, and can be shown as such.

It is deliberately *not* atomic. Git has no cross-repository transaction and
faking one with resets would be far more dangerous than a clear partial result.

*Alternative rejected:* committing every worktree that has staged files without
asking which. Staging is how you choose; a button that ignores it is a footgun.

### D5 — Files merges the feed and roots the tree at the worktrees

The change feed is the easy half: merge every member's events, sort by time,
prefix each row with its worktree. It is strictly better than the switcher,
because "what just changed" across a migration is one question.

Browse gets a synthetic root: the top level is the member worktrees, and
expanding one enters the existing tree component unchanged. With a single member
the root is skipped entirely, so nothing changes for the ordinary case.

Name and text search fan out across members concurrently and group results by
worktree, with each group carrying its own truncation notice — a cap reached in
one worktree says nothing about the others.

### D6 — Run stacks the controls and merges the log

Each worktree keeps its own runner; the server already keys them that way and
none of that changes. The tab gains a control row per member — command,
start/stop, status, URL — and one log below, merged by the `at` timestamp each
line already carries, with a coloured gutter naming the worktree.

Merged rather than stacked panes, because the interesting moment is an old
system and a new one booting together and one of them failing. Two separate
scrolling logs put that on the user to correlate.

Run all and stop all sit in the header. A member with no runner configured is
shown as a row that says so, rather than being hidden — an absent dev server is
usually a mistake, not a preference.

## Risks / Trade-offs

- **`GitPanel`'s second restructure.** It is the largest component in the app.
  D1 is the mitigation: one worktree renders through the same path, so the
  common case is continuously exercised.
- **Fan-out cost.** Two or three members means two or three status, search and
  tree calls. Everything is already debounced or triggered by a live event, and
  git status on a worktree is milliseconds. Not worth batching until it hurts.
- **A section per worktree is taller.** With two worktrees the Git panel is
  roughly twice the height it was, so sections collapse — and a section with
  nothing staged and nothing changed starts collapsed.
- **Partial commits will happen.** Deliberate, per D4, and the result names
  exactly which worktrees landed.

## Open Questions

- Should the shared commit offer to push afterwards? Leaning no: push-all is
  already in the toolbar, and bundling them hides a network operation behind a
  local one.
- Should History interleave commits from several worktrees by date? Probably
  not — two branches with unrelated bases produce a timeline that implies a
  relationship that isn't there. Stacked per-worktree lanes for now.
