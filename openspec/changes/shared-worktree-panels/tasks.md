# Tasks: One pane for a shared dryad

Group 1 is the shape everything else depends on. Groups 2–4 are independent of
each other once it lands.

## 1. Panels take a set of worktrees

- [ ] 1.1 `WorktreePane` resolves `members = circleMembers(target) ?? [target]` and drops the member switcher from the header
- [ ] 1.2 `Pane.memberId` removed; `Pane.diffPath` becomes `Pane.diff: { worktreeId, path, staged } | null`, with the stored layout migrated on load
- [ ] 1.3 `FilesPanel`, `GitPanel`, `RunPanel` take `members: string[]`; single-member rendering is byte-for-byte what it is today
- [ ] 1.4 `MainPanel`/`App` already expand circles for the watch set — confirm no other call site assumes a pane holds one worktree

## 2. Shared git (spec: shared-git)

- [ ] 2.1 Extract today's status groups, commit box and per-branch actions into `<GitSection worktreeId>` — one section, unchanged for a single worktree
- [ ] 2.2 `GitPanel` becomes a toolbar plus a section list plus the shared diff pane
- [ ] 2.3 Section headers carry branch, upstream, divergence, pull and push; sections with nothing staged or changed start collapsed
- [ ] 2.4 Diff selection carries its worktree; the diff pane keys on all three fields
- [ ] 2.5 Toolbar: pull all, push all, open PRs across members
- [ ] 2.6 `POST /api/worktrees/commit-many` — commits each worktree in turn, returns a per-worktree result, never pretends to be atomic
- [ ] 2.7 Shared commit box appears only when two or more members have staged files; reports which worktrees landed and which didn't
- [ ] 2.8 History stacks a lane per worktree, each labelled

## 3. Shared files (spec: shared-files)

- [ ] 3.1 Changes feed merges every member's events, newest first, each row labelled with its worktree
- [ ] 3.2 Browse gains a synthetic root listing the members; a single member skips the root entirely
- [ ] 3.3 Name search fans out and groups by worktree, with per-worktree truncation notices
- [ ] 3.4 Text search likewise; opening a result still lands on the matching line
- [ ] 3.5 Opening a diff from the feed carries the worktree it belongs to

## 4. Shared runner (spec: shared-runner)

- [ ] 4.1 One control row per member: command, start/stop, status, exit code, URL
- [ ] 4.2 Merged log ordered by each line's timestamp, with a coloured gutter naming the worktree
- [ ] 4.3 Run all and stop all
- [ ] 4.4 A member with no runner configured shows a row saying so rather than being hidden

## 5. Verification

- [ ] 5.1 A single worktree is unchanged in all four tabs — the regression that matters most
- [ ] 5.2 Two worktrees with the same relative path in both: selecting each shows the right diff
- [ ] 5.3 A shared commit where one worktree's hook rejects: the result names which landed
- [ ] 5.4 Build and tests clean across all three workspaces; README updated
