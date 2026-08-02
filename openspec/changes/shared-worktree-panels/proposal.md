# Proposal: One pane for a shared dryad

## Why

A circle is one dryad tending several worktrees. The chat already works that
way — one conversation, one memory, reaching into every member. The other three
tabs do not.

Files, Git and Run each address exactly one worktree, so the pane grew a member
switcher in its header: pick which worktree the lower half is about. That makes
the pane a *toggle between two worktrees* rather than one view of a shared
piece of work. It also means the thing you most want to see when migrating an
old system to a new one — both sides changing at once — is the one thing the
layout cannot show you. You watch half of it and take the other half on trust.

The switcher was the cheap answer to a real constraint: a commit belongs to one
repository, a diff belongs to one worktree, a dev server runs in one directory.
None of that changes. What changes is who does the splitting: today the *user*
splits their attention by flipping a switch, and instead the *panel* should
split the work and show both halves at once.

## What Changes

- **Panels take a set of worktrees, not one.** `AgentPanel` already addresses
  the circle; `FilesPanel`, `GitPanel` and `RunPanel` start taking the member
  list. For an ordinary worktree that list has one entry and every panel renders
  exactly as it does today.
- **The member switcher goes.** Nothing in the pane header chooses a worktree
  any more, because nothing below it is about only one.
- **Git becomes sectioned.** One scrolling column with a section per worktree —
  its branch, its divergence, its own staged/changed/untracked groups, its own
  commit box, its own pull and push. One diff pane on the right serves all of
  them.
- **Commit across worktrees.** When more than one member has something staged,
  a single message can commit them all. A coordinated change to an old system
  and a new one is one change that happens to land in two repositories, and
  typing the message twice is how the two commits drift apart.
- **Files merges.** One feed across every member, newest first, each row saying
  which worktree it came from. Browse gets a synthetic root whose top level is
  the worktrees themselves. Name and text search fan out and group by worktree.
- **Run stacks.** A compact control row per worktree — command, start/stop,
  status, URL — over one merged log where each line carries the worktree it came
  from, so an old system and a new one boot side by side. Run all and stop all.
- **Selection carries its worktree.** The selected diff becomes
  `{ worktreeId, path, staged }` rather than a bare path, because a path alone
  is ambiguous the moment two worktrees are in view.

## Capabilities

### New Capabilities

- `shared-git`: Status, staging, committing, history and diffs across every
  worktree a shared dryad tends, in one panel.
- `shared-files`: One file feed, one browse tree and one search across every
  worktree in a circle.
- `shared-runner`: Start, stop and read the output of every member's run
  command from a single tab.

### Modified Capabilities

None. `mission-control-ui` keeps its tab strip and its worktree panel; what
changes is what the panels are given, not what the shell does.

## Impact

- **Server: almost nothing.** Every endpoint is already per-worktree and the
  client fans out across two or three members — well within what the existing
  routes handle. No new endpoints, no new events. The one addition worth making
  is a batched commit so a multi-worktree commit either happens everywhere or
  is reported per worktree, rather than half-succeeding silently from three
  separate calls.
- **Web:** `GitPanel` is restructured into a toolbar plus a section per
  worktree; `FilesPanel` and `RunPanel` gain a merged mode; `WorktreePane` loses
  the switcher; `Pane.memberId` is replaced by `Pane.diff`.
- **Risk:** `GitPanel` is the largest component in the app and this is its
  second restructure. Mitigated by making the one-worktree case the same code
  path rather than a special case — if a single worktree renders correctly, the
  sections are the same component repeated.
- **No new dependencies.**
