# Proposal: Expand mission control

## Why

Sylva does the worktree-and-agent part well, but everything around it still sends you back to a terminal or leaves you squinting at a panel that was designed for one worktree at a time.

- Every session starts with the same ritual: open a terminal, `cd` to the worktree, `npm run dev`. Sylva already knows the path and already runs processes.
- Repositories can only be *registered*, never *started*. Beginning something new means leaving Sylva to run `git init`.
- The only way to talk to a dryad is to first pick a worktree. Questions that span repositories — "which of these two does auth better?" — have nowhere to go.
- The app assumes a single worktree at a time. Migrating an old system to a new one means two repos open at once, and today that is a lot of clicking back and forth.
- Settings live in a modal that has grown four sections deep. Modals are for decisions, not for configuration you scroll through.
- Two flows still use the browser's `confirm()`. It looks nothing like the rest of the app, it cannot be styled, and it blocks the whole page.
- Browsing a worktree means expanding folders by hand. There is no way to jump to a file by name.
- Git history shows a subject and a relative date; the author, the body and the size of a commit are all a terminal away.
- The Git tab and the chat header have accumulated controls without ever being laid out on purpose.

## What Changes

- **Runner.** A stored shell command per repository (default `npm run dev`) that starts with one click in the focused worktree, with a Run tab streaming its output live, a stop control, and the served URL detected from the log and made clickable.
- **Create repo.** Create and register a brand-new git repository from inside Sylva: pick a parent folder, name it, and get an initialized repo with a first commit — ready for worktrees immediately.
- **Global dryad.** An agent session bound to no worktree at all, reachable from the nav bar, running in its own scratch workspace and told where every registered repository lives so it can read across all of them.
- **Split view.** The main area splits into two panes, each holding its own worktree with its own Agent / Files / Git / Run tabs, so an old system and a new one can be worked on side by side. Both panes stay live: file watching and agent streaming follow every open pane, not just one.
- **Settings page.** A dedicated full-page view with a section rail (Appearance, Sound, Workflow, Runner, Agent defaults, Repositories, About) replacing the settings modal.
- **File search.** A search box in the Files → Browse tab that finds files by name anywhere in the worktree, with results that open straight into the preview.
- **Rich commit details.** Git history commits gain a hover card with the full subject and body, author and committer with dates, the full sha, and the diffstat.
- **No native dialogs.** `alert()`, `confirm()` and `prompt()` are removed from the codebase and replaced with a Sylva confirm dialog. Dialog internals are re-spaced against a single scale so every dialog reads the same.
- **Redesigned nav bar, chat header and Git tab.** Three deliberate layouts rather than three accumulations.

## Capabilities

### New Capabilities

- `runner`: Start, stop, watch and configure a long-running project command per worktree, with live output streaming.
- `global-dryad`: An agent session not scoped to any worktree, aware of every registered repository.
- `workspace-panes`: Two side-by-side panes, each focused on its own worktree, with per-pane tab state and multi-worktree liveness.
- `settings-page`: Settings as a first-class page with a section rail, replacing the settings modal.
- `file-search`: Search a worktree's files by name from the Browse tab.
- `dialog-system`: One dialog vocabulary for the whole app — confirms included — with consistent internal spacing and no native browser dialogs.

### Modified Capabilities

- `repo-registry`: Adds creating a new repository on disk in addition to registering an existing one.
- `git-essentials`: Commit records carry author, committer, dates, body and diffstat so history can be inspected without leaving Sylva.
- `mission-control-ui`: Nav bar, chat header and Git tab are redesigned; the tab strip gains Run; the shell learns panes and a settings view.

## Impact

- **Server.** New `RunnerService` (child processes, output ring buffer, WS streaming) and its routes. `Workspace` gains repo creation. `SessionManager` is generalized from "one session per worktree" to "one session per target", where a target is a worktree *or* the grove. `WatcherManager.setFocused` becomes a set of watched worktrees. `GitOps.graph` returns richer commits; a new file-search method walks the worktree.
- **Shared.** New types for runner state/config, richer `GraphCommit`, file-search results, pane state, and two new `ServerEvent` variants (`runner.state`, `runner.output`).
- **Web.** New `RunPanel`, `SettingsPage`, `GlobalDryadView`, `ConfirmDialog` + confirm store, `HoverCard`, `FileSearch`. Rewrites of `TopBar`, `GitPanel`, the chat header and `MainPanel` (panes). `GlobalSettingsDialog` is retired in favour of the settings page.
- **Risk.** The runner executes an arbitrary user-configured command; it is spawned in the worktree with the user's own permissions, never from remote input, and is killed by process group on stop and on server shutdown. Panes multiply live watchers and sessions — watcher count is bounded by open panes plus active sessions, which is what it already was, only now with a set of two rather than one.
- **No new runtime dependencies.**
