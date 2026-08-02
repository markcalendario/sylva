# Tasks: Expand mission control

Ordered so the shared contract lands first, then the server, then the web app.
Groups 1–3 unblock everything else; groups 4–11 are independent of each other and
can be done in any order once 3 is in.

## 1. Shared contract (spec: all)

- [ ] 1.1 `RunnerConfig` (`defaultCommand`, `byRepo: Record<repoId, string>`) added to `AppPreferences`, with defaults; `RunnerState` (`worktreeId`, `status: "idle" | "running" | "exited"`, `command`, `pid`, `startedAt`, `exitCode`, `url`) and `RunnerLine`
- [ ] 1.2 `ServerEvent` gains `runner.state` and `runner.output`
- [ ] 1.3 `GraphCommit` gains optional `body`, `authorEmail`, `authorDate`, `committer`, `committerEmail`, `committerDate`, `stats: { files, insertions, deletions }`
- [ ] 1.4 `FileSearchResult` / `FileSearchResponse` (`results`, `truncated`) types
- [ ] 1.5 `CreateRepoRequest` (`parentPath`, `name`) type
- [ ] 1.6 `GROVE_ID = "grove"` constant exported from shared, so server and web agree on the reserved id

## 2. Server: relax the single-focus assumptions (specs: workspace-panes, global-dryad)

- [ ] 2.1 `WatcherManager`: replace `setFocused(id, path)` with `setWatched(entries)`, keeping the `"focus"` reason per id; add/drop watchers by diffing against the previous set
- [ ] 2.2 `Workspace`: add `openWorktrees: Set<string>` alongside `focused`; `setOpen(ids)` resolves each and pushes the resulting set to the watcher; `focused` remains the primary and keeps firing `focus.changed`
- [ ] 2.3 `POST /api/open-worktrees` route accepting `{ worktreeIds: string[] }`, capped at a small number, ignoring ids that no longer resolve
- [ ] 2.4 `SessionManager`: extract `resolveTarget(targetId): SessionTarget` and use it in `create()` in place of `workspace.resolveWorktree`; every map stays keyed by the same string
- [ ] 2.5 `resolveTarget("grove")` returns the grove workspace (`$SYLVA_HOME/grove`, created on demand, `repoId: ""`, `isGrove: true`); skip `watchers.addSessionWatch` for it
- [ ] 2.6 Grove system prompt: append the absolute path of every registered repository, rebuilt at session creation so newly registered repos are picked up
- [ ] 2.7 Verify grove transcript, persistence, resume, permissions, queueing, interrupt and cost accounting all work through the existing code paths unchanged

## 3. Server: runner (spec: runner)

- [ ] 3.1 `RunnerService`: one child per worktree in a `Map`; `start(worktreeId)` resolves the command (repo override → default), spawns with `{ shell: true, cwd, detached: true }`, records pid and start time
- [ ] 3.2 Output capture into a 2000-line ring buffer, split on newlines, tagged stdout/stderr; batched broadcast as `runner.output` on a ~100 ms debounce
- [ ] 3.3 URL detection: scan lines for `https?://(localhost|127\.0\.0\.1|0\.0\.0\.0):\d+`, keep the most recent, include it in `runner.state`
- [ ] 3.4 `stop(worktreeId)` kills the process group (`process.kill(-pid)`), falling back to `kill(pid)`; exit handler records the exit code, keeps the buffer, broadcasts `runner.state`
- [ ] 3.5 Routes: `GET /api/worktrees/:id/runner` (state + retained output), `POST …/runner/start`, `POST …/runner/stop`; starting an already-running runner is a conflict
- [ ] 3.6 Stop every runner in the app's `onClose` hook; register the service in `AppContext`
- [ ] 3.7 Runner config read/written through `Store.preferences`

## 4. Server: create repo (spec: repo-registry)

- [ ] 4.1 `Workspace.createRepo(parentPath, name)`: validate the name (non-empty, no separators, no leading dash), reject an existing target, `mkdir`, `git init -b main`
- [ ] 4.2 Write a `README.md` and make an initial commit so HEAD is not unborn and worktrees can be created immediately
- [ ] 4.3 Register the result and return it; clean up the created directory if any step after `mkdir` fails
- [ ] 4.4 `POST /api/repos/create` route with zod validation

## 5. Server: file search + rich commits (specs: file-search, git-essentials)

- [ ] 5.1 `GitOps.searchFiles(worktreeId, query)`: breadth-first walk honouring `isIgnored`, capped at 20k visited entries and 200 results
- [ ] 5.2 Scoring: exact name > name prefix > name substring > path substring > subsequence; ties broken by shorter path; report `truncated`
- [ ] 5.3 `GET /api/worktrees/:id/search-files?q=` route
- [ ] 5.4 Extend `GitOps.log`'s format with `%b %ae %aI %cn %ce %cI` and add `--shortstat`; parse the stat line into `{ files, insertions, deletions }`
- [ ] 5.5 Confirm `graph()` still returns in one git invocation per range and that subjects/bodies containing the delimiters cannot break parsing

## 6. Web: dialog system (spec: dialog-system)

- [ ] 6.1 `ConfirmDialog` component built on the existing `Dialog`, with title, body, confirm label, and `tone: "normal" | "danger"`
- [ ] 6.2 Promise-based `confirm()` backed by a small store slice, with a `<ConfirmHost />` mounted beside `<TooltipLayer />` in `App`
- [ ] 6.3 Replace the `confirm()` in `Sidebar.tsx` (remove repository) and in `GitPanel.tsx` (push `--set-upstream`)
- [ ] 6.4 Normalize dialog spacing in `app.css`: one flow gap on `.dialog-inner`, and `.field`, `.field-hint`, `.settings-section`, `.dialog-hint`, `.dialog-actions` all on the `--pad-*` scale; remove the ad-hoc margins
- [ ] 6.5 Audit every dialog against the new scale — register-repo, new-worktree, remove-worktree, agent-settings, about, help — and fix the outliers
- [ ] 6.6 Escape and backdrop-close verified on all dialogs; primary action last in every action row
- [ ] 6.7 Guard: grep the web source for global `alert(` / `confirm(` / `prompt(` and confirm none remain

## 7. Web: panes (spec: workspace-panes)

- [ ] 7.1 Store: `panes: Pane[]` (`{ id, worktreeId, tab, diffPath }`), `activePaneId`, plus `setPaneWorktree`, `setPaneTab`, `splitPane`, `closePane`, `setActivePane`
- [ ] 7.2 Persist pane layout to `localStorage` and restore it on load
- [ ] 7.3 Extract today's worktree body from `MainPanel` into `WorktreePane` verbatim, taking a pane; `MainPanel` becomes the layout that renders one or two panes plus the splitter
- [ ] 7.4 Route sidebar and forest-map selection to the active pane; clicking within a pane makes it active; visually mark the active pane only when two are open
- [ ] 7.5 Split and close controls in the worktree header
- [ ] 7.6 Push the open-worktree set to `POST /api/open-worktrees` whenever panes change, and again on WS reconnect
- [ ] 7.7 Load transcript/session/status/recent-files per pane worktree, not once for a single focus

## 8. Web: runner (specs: runner, mission-control-ui)

- [ ] 8.1 Store slice for runner state and output buffer per worktree, fed by the two new WS events
- [ ] 8.2 `RunPanel`: command line shown, start/stop control, exit code, detected URL as a link, output view with follow-the-bottom that releases when the user scrolls up, and a clear control
- [ ] 8.3 Add Run to the tab strip with a running indicator; fetch state and retained output on tab open
- [ ] 8.4 Per-repository command editing on the settings page's Runner section

## 9. Web: global dryad (spec: global-dryad)

- [ ] 9.1 `view: "workspace" | "settings" | "grove"` in the store; nav bar switches it; panes persist behind the other views
- [ ] 9.2 `GroveView` reusing `AgentPanel` with the reserved grove id, with its own header explaining what the grove is and which repositories it can see
- [ ] 9.3 Grove agent-settings control, reusing the per-worktree overrides UI
- [ ] 9.4 Include the grove in the blocked-agents count in the nav bar

## 10. Web: file search + git history details (specs: file-search, git-essentials)

- [ ] 10.1 Search input above the Browse tree, debounced ~150 ms, with clear-to-return-to-tree
- [ ] 10.2 Results list with the matched path, selection opening the existing preview, empty and truncated states
- [ ] 10.3 `HoverCard` component for rich hover content, sharing the tooltip layer's positioning and edge-flipping
- [ ] 10.4 Commit rows in `CommitGraph` gain the hover card: full subject and body, author and committer with dates, full sha, diffstat; reachable by keyboard focus

## 11. Web: redesigns and the settings page (specs: mission-control-ui, settings-page)

- [ ] 11.1 Nav bar rebuilt into identity / destinations / state zones, with glyph collapse at narrow widths
- [ ] 11.2 Chat header rebuilt: dryad and state, model and effort, cost and tokens, session controls
- [ ] 11.3 Git tab rebuilt: toolbar, segmented Changes/History, grouped file lists, sticky commit box, diff pane with its own header
- [ ] 11.4 `SettingsPage` with a section rail: Appearance, Sound, Workflow, Runner, Agent defaults, Repositories, About — reusing the existing field components
- [ ] 11.5 Repositories section: list with paths and availability, register / create / remove
- [ ] 11.6 Unsaved-changes guard on leaving the settings page, using the new confirm
- [ ] 11.7 Delete `GlobalSettingsDialog` and point the nav bar's settings control at the page
- [ ] 11.8 Create-repo mode in the repo dialog: parent-folder browse plus a name field

## 12. Verification

- [ ] 12.1 `npm run build` clean across `shared`, `web` and `server`
- [ ] 12.2 `npm run test -w server` passing; add coverage for repo creation, file-search ranking, runner lifecycle, and grove target resolution
- [ ] 12.3 Manual pass: split two worktrees from different repositories, confirm both stream live; start a runner in each and confirm neither is disturbed by focus changes
- [ ] 12.4 Manual pass: every dialog against the spacing scale, Escape and backdrop close, no native dialogs anywhere
- [ ] 12.5 Update `README.md` — features list, the new Run tab, the grove, split view, and the settings page
