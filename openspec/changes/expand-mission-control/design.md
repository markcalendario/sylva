# Design: Expand mission control

## Context

Sylva today is built around one strong assumption: **exactly one worktree is focused, and everything hangs off it.** `Workspace.focused` is a single nullable id, `WatcherManager` watches the focused worktree plus session worktrees, `SessionManager` maps `worktreeId → sessionId`, and `MainPanel` renders one header and one tab strip for that one worktree.

Four of the eleven changes push directly against that assumption: split view wants two focused worktrees, the global dryad wants a session with no worktree, the runner wants a process attached to a worktree independent of focus, and the settings page wants the main area to show something that is not a worktree at all.

The rest are contained: create-repo is one route plus a dialog mode, file search is one route plus an input, rich commit details is a wider `git log` format plus a hover card, and the three redesigns plus the dialog cleanup are presentation.

So the plan is to relax the single-focus assumption in three narrow places first, then build features on top of the relaxed model.

## Goals / Non-Goals

**Goals**

- Remove the ritual of dropping to a terminal to start a project, initialize a repo, or read a commit.
- Support two worktrees open at once without doubling the code that renders a worktree.
- Keep every existing single-pane flow working exactly as it does now — one pane is the default, and it should be indistinguishable from today.
- One dialog vocabulary, one spacing scale, no native browser dialogs anywhere.

**Non-Goals**

- Not a terminal emulator. The runner streams one command's output; it is not interactive and takes no stdin.
- Not more than two panes. Two answers the stated need (old system / new system); N panes is a layout problem with a much worse ratio of complexity to value.
- Not a general process manager. One runner per worktree, not a task matrix.
- No router or URL state. Sylva stays a single-screen app driven by store state.
- The global dryad is not a supervisor. It has no special authority over worktree sessions and cannot drive them.

## Decisions

### D1 — Focus becomes a set, but the API keeps a primary

`Workspace.focused` stays as the primary focus (pane A) so every existing endpoint, the `focus.changed` event, and quick-start keep working unchanged. A parallel `Workspace.openWorktrees: Set<string>` records everything any pane holds, and `WatcherManager.setFocused(id, path)` becomes `setWatched(entries: {id, path}[])` with the `"focus"` reason keyed per id.

The client is the source of truth for pane layout (it is a view concern), and tells the server what it has open via `POST /api/open-worktrees { worktreeIds }`. The server watches that set. If the client disconnects, the set is left alone until the next connect resyncs it — a stale watcher is cheap and self-corrects.

*Alternative rejected:* making focus itself an array. It changes the shape of `focus.changed` and every consumer of it for no gain — panes are a client layout, and the server only ever needed the watch set.

### D2 — Sessions key on a *target*, not a worktree

`SessionManager` currently does `workspace.resolveWorktree(worktreeId)` inside `create()`. That becomes `resolveTarget(targetId)`:

```
type SessionTarget = { id: string; cwd: string; label: string | null; repoId: string; isGrove: boolean }
```

For a normal id this resolves through `Workspace.resolveWorktree` exactly as before. For the reserved id `"grove"` it returns the grove workspace (`$SYLVA_HOME/grove`, created on demand) with `repoId: ""`. Everything downstream — the transcript file, persistence, permissions, queued prompts, cost accounting, WS events — is already keyed by that id and needs no change. `watchers.addSessionWatch` is skipped when `isGrove`.

`"grove"` is a reserved id: worktree ids are content-hashes of paths (`pathId`), so it cannot collide.

*Alternative rejected:* a separate `GroveSession` class. It would duplicate the permission plumbing, the queue, the transcript writer and the availability handling — the entire class minus the cwd.

### D3 — The grove knows where the repos are, and nothing more

The grove session runs with `cwd` = its own scratch directory and a system prompt appended listing every registered repository path. That makes cross-repo questions answerable ("compare how these two handle auth") while keeping writes out of anyone's repo by default — the agent must be explicitly asked to go into a repo path, and permission prompts still gate it.

*Alternative rejected:* running the grove with `cwd` at the user's home directory. It makes every stray `ls` enormous and every relative path ambiguous.

### D4 — The runner is one child per worktree, spawned through a shell

`spawn(command, { shell: true, cwd: worktreePath, detached: true })`, output captured from stdout and stderr into a shared ring buffer (2000 lines), broadcast as `runner.output` batches on the same ~100 ms debounce the file watcher already uses. Stopping kills the **process group** (`process.kill(-pid)`) because `npm run dev` reliably spawns children that outlive a bare `kill(pid)`. Server shutdown stops every runner.

The command is per-repository with a global default (`npm run dev`), stored in `settings.json`. It is user-authored configuration executed locally with the user's own permissions — the same trust level as the `custom` open-target command Sylva already supports — and never derives from remote input.

The served URL is detected by scanning output lines for `https?://(localhost|127\.0\.0\.1|0\.0\.0\.0):\d+` and keeping the most recent match, which covers Vite, Next, CRA, Rails and Django without per-framework knowledge.

*Alternative rejected:* parsing `package.json` to offer a script picker. More UI for a value the user answered directly: they want a stored command that runs.

### D5 — Panes are client state; the pane component is the existing one

`useSylva` gains `panes: [Pane, Pane?]` where `Pane = { id: string; worktreeId: string | null; tab: Tab; diffPath: string | null }`, plus `activePaneId`. The worktree body that `MainPanel` renders today is extracted verbatim into `<WorktreePane pane={…} />`; `MainPanel` becomes a layout that renders one or two of them plus a splitter. Everything below (`AgentPanel`, `GitPanel`, `FilesPanel`, `RunPanel`) already takes a `worktreeId` prop and needs no change at all.

The sidebar's click sets the **active** pane's worktree, so single-pane behaviour is untouched. Splitting copies the current pane and leaves the new one empty.

*Alternative rejected:* rendering two `MainPanel`s. The tab state, diff path and header are per-pane, and `MainPanel` also owns the no-focus landing and the settings view, which are not per-pane.

### D6 — The main area gets a `view`, not a router

`useSylva.view: "workspace" | "settings" | "grove"`. The nav bar switches it. No URL, no router dependency, consistent with how the app already works. Panes persist behind the settings and grove views, so leaving settings returns you exactly where you were.

### D7 — Confirms are a promise-returning store, not prop-drilled state

```
const ok = await confirm({ title, body, confirmLabel, tone: "danger" | "normal" })
```

backed by a small Zustand slice and one `<ConfirmHost />` mounted next to `<TooltipLayer />`. This is what makes deleting `confirm()` a two-line change at each call site rather than a state-management exercise, and it is the shape any future call site will want.

Dialog spacing is fixed by giving `.dialog-inner` a single flow gap and normalizing `.field`, `.settings-section`, `.dialog-actions` and `.dialog-hint` to the existing `--pad-*` tokens instead of the ad-hoc margins they carry today.

### D8 — Rich commit details come from one wider `git log`, plus a hover card

`GitOps.log` already uses `\x1f`/`\x1e` delimiters, so adding `%ae %aI %cn %ce %cI %b` is free. The diffstat costs `--shortstat`, which git appends per commit in the same invocation — still one process, not one per commit. `GraphCommit` gains those fields as optional so nothing that reads it today breaks.

The existing `Tooltip` is text-only (`data-tip`), so a `HoverCard` component is added for rich content, sharing the same positioning approach and the same layer.

### D9 — File search walks the worktree once, server-side

`GET /api/worktrees/:id/search-files?q=` does a breadth-first walk honouring the same `isIgnored` list the watcher uses, capped at 20k visited entries and 200 results, scoring exact-name > prefix > substring > subsequence so `apnl` finds `AgentPanel.tsx`. Cheap enough to run per keystroke behind a 150 ms debounce, and it needs no index to keep fresh.

*Alternative rejected:* `git ls-files`. It misses untracked files, which are exactly the ones a running agent has just created.

### D10 — Redesigns are CSS-and-layout, not new abstractions

The nav bar, chat header and Git tab are rebuilt in place against the existing token set. No design-system introduction, no component library, no new dependencies. The Git tab in particular keeps `GitPanel`'s data flow entirely and changes only its structure: a toolbar row, a segmented Changes/History control, grouped file lists, a sticky commit box, and a diff pane with its own header.

## Risks / Trade-offs

- **A runner outliving Sylva.** Mitigated by process-group kill on stop and an `onClose` hook that stops every runner. A `SIGKILL` of the server itself can still orphan a dev server; the Run tab reports "not running" and starting again is safe, since the user's own port conflict message is clearer than anything Sylva could invent.
- **Two live panes double the streaming.** Two agent sessions already ran concurrently before this change (any worktree with a session streams); panes only make it visible. Watcher count is unchanged in kind.
- **Generalizing `SessionManager` touches the most delicate file in the server.** Contained by keeping every map keyed by the same string it is keyed by today — only the *resolution* of that string changes.
- **Retiring the settings modal is a visible change** for anyone used to it. The nav bar's ⚙ goes to the page instead; nothing is lost.

## Open Questions

- Should the runner auto-start when a worktree is first focused? Deferred: explicit for now, and a "start automatically" checkbox is a small follow-up once the command is stored anyway.
- Should the grove get its own dryad sprite state on the forest map? Deferred — it has no worktree to stand in.
