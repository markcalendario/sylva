# Tasks: Sylva

## 1. Project Scaffolding

- [x] 1.1 Initialize git repo and root package.json with npm workspaces (`server`, `web`, `shared`); add root `dev`, `build`, `start` scripts using `concurrently`
- [x] 1.2 Scaffold `web/` with `npm create vite@latest` (React + TypeScript) and install frontend deps via npm (`zustand`, `@tanstack/react-query`)
- [x] 1.3 Scaffold `server/` (TypeScript, `tsx` for dev) and install backend deps via npm (`fastify`, `@fastify/websocket`, `@anthropic-ai/claude-agent-sdk`, `chokidar`, `zod`)
- [x] 1.4 Create `shared/` package with API/WS event TypeScript types; wire path aliases in both apps
- [x] 1.5 Configure Vite dev proxy for `/api` and `/ws` to Fastify (port 4611); verify `npm run dev` boots both processes

## 2. Backend Foundation

- [x] 2.1 Fastify server bound to 127.0.0.1 with error handling, zod request validation, a `/api/health` route, and an Origin/Host validation hook covering REST and WS upgrades
- [x] 2.2 Git service: promisified `execFile` wrapper with per-worktree mutation queue and typed errors
- [x] 2.3 Config/persistence service: `~/.sylva/` bootstrap, `registry.json` load/save
- [x] 2.4 WebSocket hub: single `/ws` endpoint, typed multiplexed events, heartbeat, broadcast helper

## 3. Repo Registry & Worktrees (specs: repo-registry, worktree-management)

- [x] 3.1 Registry endpoints: register (validate git repo, reject dupes), list (with availability), remove; persistence across restart
- [x] 3.2 Worktree list endpoint parsing `git worktree list --porcelain` (branch, main-flag, detached)
- [x] 3.3 Worktree create endpoint (new branch from base ref, or existing branch; default sibling `<repo>-worktrees/<branch>` path) with git errors surfaced verbatim
- [x] 3.4 Worktree remove endpoint (refuse main worktree; dirty requires explicit force)
- [x] 3.5 Focus endpoint/state: track focused worktree, switch watcher target on change

## 4. Git Essentials (spec: git-essentials)

- [x] 4.1 Status endpoint parsing `--porcelain=v2 --branch` into staged/unstaged/untracked + branch + ahead/behind
- [x] 4.2 Diff endpoint: unified diff parsed into structured hunks; binary detection; staged vs unstaged modes
- [x] 4.3 Stage/unstage endpoints (single file and all)
- [x] 4.4 Commit endpoint (reject empty message/nothing staged; surface hook failures)
- [x] 4.5 Branch list endpoint with worktree-checkout annotations
- [x] 4.6 Push/pull endpoints with no-upstream detection and `--set-upstream` confirmation flow

## 5. File Activity (spec: file-activity)

- [x] 5.1 Chokidar watcher manager: watch focused worktree + worktrees with active sessions; ignore `.git/`, `node_modules/`, gitignored paths
- [x] 5.2 Debounce/batch events (~100 ms) and broadcast `file.*` WS events
- [x] 5.3 Trigger git status refresh after each batch and broadcast `git.status` updates

## 6. Agent Sessions (spec: agent-sessions)

- [x] 6.1 Session manager wrapping Agent SDK `query()`: create per worktree (`cwd`), enforce one active session per worktree, `acceptEdits` permission mode
- [x] 6.2 Normalize SDK messages to typed WS events (assistant-text, tool-use, tool-result, result, error) and broadcast
- [x] 6.3 JSONL transcript persistence + replay endpoint for page reload
- [x] 6.4 Prompt endpoint (follow-up turns keep context) and interrupt endpoint
- [x] 6.5 Credential/SDK failure detection surfaced as an "agent unavailable" state with setup guidance
- [x] 6.6 `canUseTool` permission bridge: `permission.request` WS events, answer endpoint, per-session always-allow rules, deny-on-timeout
- [x] 6.7 Prompt queue per session (FIFO, dispatch on turn end, remove-before-send endpoint)
- [x] 6.8 Persist SDK session IDs; resume sessions via SDK `resume` after server restart
- [x] 6.9 Accumulate usage/cost from result messages and expose per-session totals
- [x] 6.10 Quick-start endpoint: create worktree → focus → start session as one chained flow with honest partial-failure reporting

## 7. Frontend Foundation

- [x] 7.1 WS client with auto-reconnect/backoff, resync on reconnect, and connection indicator; Zustand stores fed by WS events
- [x] 7.2 TanStack Query API layer over REST with WS-triggered invalidation
- [x] 7.3 App shell: sidebar (repos → worktrees), tabbed main panel (Agent / Files / Diff), status strip

## 8. Visual Design & Sprites (spec: mission-control-ui) — load the frontend-design skill first

- [x] 8.1 Design system: dark theme tokens (palette, typography, spacing), base components, hover/focus states
- [x] 8.2 Author pixel-art sprite sheets (idle, working, success, error/panic) as PNG assets; CSS `steps()` animation component with `image-rendering: pixelated`
- [x] 8.3 Wire sprite states to live data: agent activity → working, commit/agent success → celebration, errors/conflicts → panic; visible in sidebar and main panel
- [x] 8.4 Designed empty/loading/error states (sprite-featuring welcome screen with register-repo CTA)

## 9. Feature UI

- [x] 9.1 Repo registration flow (path input, validation errors, duplicate handling) and repo/worktree sidebar with availability states
- [x] 9.2 Worktree create/remove dialogs (branch pickers, force-remove confirmation)
- [x] 9.3 Agent chat panel: streaming text, collapsible tool-call entries, stick-to-bottom scroll, prompt input, Stop button, transcript replay on reload
- [x] 9.3a Inline permission approval cards (Allow / Allow always / Deny), queued-prompt list with remove, session cost readout in panel header
- [x] 9.3b "New task" dialog (name, prompt, base ref) wired to the quick-start endpoint; browser notifications on background agent completion (permission requested on first agent use, click-to-focus)
- [x] 9.4 File activity feed (newest-first, click-through to diff) and background-activity badges on unfocused worktrees
- [x] 9.5 Git panel: grouped status, diff viewer with line highlighting, stage/unstage, commit form, branch list, push/pull with upstream prompt

## 10. Hardening & Verification

- [x] 10.1 Tests for git parsers (status porcelain-v2, worktree porcelain, diff hunks) and the mutation queue
- [x] 10.2 Tests for registry service and session manager normalization (SDK messages → WS events)
- [x] 10.3 Production mode: `npm run build` + Fastify serving `web/dist` on a single port; verify end-to-end
- [x] 10.4 Manual walkthrough of every spec scenario; fix gaps; README with setup instructions
