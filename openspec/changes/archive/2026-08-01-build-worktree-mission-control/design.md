# Design: Sylva

## Context

Greenfield project in an empty directory. The app is a local-first developer tool: a Node backend with full access to the user's filesystem, git binary, and Claude Code credentials, plus a browser UI. One user, one machine, no multi-tenancy, no auth. The user's chosen stack: Vite + React frontend, Fastify backend, Claude Agent SDK for prompting, git CLI for worktree operations, npm for all installs.

## Goals / Non-Goals

**Goals:**

- Single glanceable dashboard for multiple repos, their worktrees, and the agents working in them.
- Prompt Claude Code agents per worktree with rich streamed output (messages, tool calls, file edits).
- Real-time visibility: file changes appear as they happen; git status stays fresh.
- Git essentials: status, diff, stage/unstage, commit, branches, push/pull, worktree CRUD.
- A UI with personality: pixel-art sprites that encode state (idle / working / success / error) so status is readable at a glance.

**Non-Goals (v1):**

- Embedded terminal (xterm.js) — SDK sessions only; terminal can be a later change.
- Advanced git: rebase/merge UI, stash, conflict resolution, history graph, PR creation.
- Hosting, remote access, auth, or multi-user anything.
- Windows support (target macOS/Linux; nothing should preclude Windows later).

## Decisions

### D1 — Monorepo layout: npm workspaces with `server/` and `web/`

One repo, `package.json` workspaces: `server` (Fastify, TypeScript, run with `tsx`), `web` (Vite + React + TypeScript), `shared` (TypeScript types for API payloads and WS events). Root scripts: `npm run dev` starts both via `concurrently`. Alternative — separate repos — rejected: pointless friction for a personal tool sharing types.

### D2 — Backend: Fastify + @fastify/websocket, localhost-only

REST for request/response operations (git commands, worktree CRUD, registry). One WebSocket endpoint multiplexing typed events (`agent.*`, `file.*`, `git.*`) with a channel/topic field, so the frontend keeps a single connection. Server binds `127.0.0.1` only. Alternative — SSE — rejected: we also need client→server streaming later (e.g., interrupting an agent) and one WS is simpler than SSE + POST hybrid.

### D3 — Agent engine: `@anthropic-ai/claude-agent-sdk` `query()` per session

Each agent session wraps the SDK's `query()` with `cwd` set to the worktree path, streaming `SDKMessage`s. Messages are normalized into our own event shape (`assistant-text`, `tool-use`, `tool-result`, `result`, `error`) and both broadcast over WS and appended to a JSONL transcript on disk so sessions survive page reloads. Session lifecycle: one active session per worktree at a time (v1 simplification); `interrupt()` supported for stop. Alternative — spawning the `claude` CLI and scraping output — rejected: the SDK gives structured messages natively.

**Permissions:** mode defaults to `acceptEdits`; everything else routes through the SDK's `canUseTool` callback, which the server converts into a `permission.request` WS event. The UI renders an approval card inline in the chat (Allow / Allow always this session / Deny); the server resolves the callback with the user's answer and remembers per-session "always allow" rules keyed by tool name. Unanswered requests time out after a few minutes as denied so sessions never hang forever.

**Resume:** the SDK session ID from the `init` message is persisted alongside the transcript; after a server restart, the next prompt for that worktree resumes via the SDK's `resume` option, so conversation context survives backend restarts, not just page reloads.

**Prompt queueing:** prompts submitted mid-turn are appended to a per-session FIFO queue and dispatched when the current turn completes; the UI shows queued prompts as pending and allows removing them before they are sent.

### D4 — Git: shell out to the `git` CLI via a thin promisified wrapper

Use `child_process.execFile("git", [...], { cwd })` wrapped in a small service — not `simple-git`, not `isomorphic-git`. Rationale: worktree commands, porcelain-v2 status parsing, and diff output are straightforward to call directly; a wrapper library adds a dependency without covering worktrees well, and `execFile` avoids shell-injection risk. Diffs are parsed from `git diff --patch` into structured hunks server-side (small parser) so the frontend renders them without a heavy diff library.

### D5 — File watching: chokidar per *focused* worktree, not all worktrees

Watching every worktree of every repo would explode inotify/FSEvents handles. The frontend declares which worktree is focused; the server maintains a watcher for that worktree (plus any worktree with an active agent session, so background agents remain visible), ignoring `.git/`, `node_modules/`, and gitignored paths (via `git check-ignore` batching or a static ignore list in v1). Events are debounced (~100 ms) and batched. A file-change batch also triggers a lightweight `git status --porcelain=v2` refresh pushed on the same WS.

### D6 — Registry persistence: JSON file in `~/.sylva/`

`registry.json` (repo paths + display metadata) and `sessions/<id>.jsonl` transcripts. No database. Alternative — SQLite — rejected for v1: nothing here is relational or high-volume.

### D7 — Frontend: Vite + React + TypeScript, Zustand state, TanStack Query for REST

Zustand holds live state fed by the WS (agent events, file events, git status); TanStack Query wraps REST calls with invalidation triggered by WS pushes. Layout: left sidebar (repos → worktrees, each with its sprite), center tabbed panel (Agent chat / Files / Diff), bottom or side status strip (branch, ahead/behind, dirty count). Alternative — Redux — rejected: heavier than needed.

### D8 — Sprites and visual design: pixel-art sprite sheets + CSS `steps()` animation

Each worktree gets a sprite character whose animation encodes state: **idle** (breathing/blinking), **working** (typing furiously while an agent runs), **success** (brief celebration on commit/agent completion), **error/conflict** (panic). Implementation: PNG sprite sheets (frames in a row) animated with CSS `animation: steps(n)`; `image-rendering: pixelated` for crispness. Sprites are generated as embedded assets (data-URI or static PNGs authored during implementation) so there is no external asset pipeline. The overall theme: modern dark UI (clean typography, generous spacing) with pixel accents — sprites, pixel progress bars, subtle scanline flourishes — rather than a full retro takeover; load the `frontend-design` skill when building it. Alternative — Lottie/SVG animation — rejected: sprites are the requested aesthetic and cheaper to author consistently.

### D9 — Localhost hardening: Origin/Host validation

Any website open in the user's browser can issue requests to `localhost` (CSRF / DNS-rebinding), and this server executes git commands and spawns agents. Mitigation: the server rejects REST requests and WS upgrades whose `Origin` header is present but not the app's own origin (Vite dev origin or the served origin), and rejects `Host` headers that are not localhost. This is enforced in a single Fastify hook. Alternative — bearer token handshake — deferred; header validation is sufficient for a single-user localhost tool and adds zero UX friction.

### D10 — Notifications and cost

The frontend requests browser Notification permission on first agent use; when a turn completes (or errors) in a worktree that is not focused or when the tab is hidden, a browser notification fires. The SDK's `result` messages carry usage/cost; per-session cumulative token counts and USD cost render in the agent panel header.

### D11 — "New task" quick-start

A single dialog (task name + prompt + base ref) chains existing capabilities server-side: create worktree (branch named from the task) → focus it → start an agent session with the prompt. Implemented as one endpoint that reuses the worktree and session services, so failures mid-chain roll back cleanly (a failed session start leaves the worktree in place but reports the partial result honestly).

### D12 — Process model: one dev command, two processes

`npm run dev`: Fastify on `:4611`, Vite dev server on `:5173` proxying `/api` and `/ws` to Fastify. Production-ish mode (`npm run build && npm start`) serves the built `web/dist` from Fastify so the app is a single `localhost:4611`. All scaffolding via official generators (`npm create vite@latest`) and `npm install` — no hand-written package manifests beyond scripts.

## Risks / Trade-offs

- [Agent SDK auth not configured on the machine] → Server surfaces a clear "agent unavailable" state with setup instructions; git/worktree features work independently.
- [Watcher misses or floods events on huge repos] → Debounce + batch; ignore heavy directories; git status refresh is the source of truth, watcher events are advisory UI signals.
- [Concurrent git operations racing (agent commits while user stages)] → Per-worktree operation queue on the server; git status refreshed after every mutation.
- [One-session-per-worktree limit feels restrictive] → Acceptable v1 trade-off; the session model (keyed by worktree) can widen to N sessions later without API breakage.
- [Sprite art quality varies when authored in-code] → Keep sprites small (16–32 px, limited palette) where hand-authoring pixel data is tractable; states are few and reusable across characters.
- [localhost server executes arbitrary git/agent commands] → Bind 127.0.0.1 only; validate repo paths against the registry; never accept absolute paths from the client for git operations (only registry IDs + relative paths).

## Open Questions

- None blocking. Agent permission-mode configurability (e.g., plan mode, bypass) can be a UI toggle added during implementation if trivial, else deferred.
