# Proposal: Build Sylva

## Why

Working across multiple git worktrees with AI coding agents today means juggling terminal tabs, losing track of which branch is where, and having no visual overview of what each agent is doing. A local web app that unifies worktree management, agent prompting, live file activity, and everyday git operations turns that juggling act into a single glanceable dashboard — and makes parallel agent-driven development genuinely pleasant.

## What Changes

- Build a brand-new local-first web application ("Sylva") from scratch in this empty project.
- Backend: Node.js + Fastify server exposing a REST + WebSocket API over the local filesystem, git CLI, and Claude Agent SDK.
- Frontend: Vite + React single-page app with a polished, playful UI featuring pixel-art sprites that visualize repo/worktree/agent state at a glance.
- Register multiple git repositories on the machine; list, create, switch between, and remove worktrees per repo.
- Prompt a Claude Code agent (via `@anthropic-ai/claude-agent-sdk`) inside any worktree and stream its messages, tool calls, and file edits into the UI in real time.
- Watch worktree filesystems live (chokidar) and surface files being added/changed/deleted as they happen.
- Git essentials per worktree: status, diff viewer, stage/unstage, commit, branch list, push/pull.
- In-UI approval flow for agent tool-permission requests (e.g., Bash commands), with per-session "always allow".
- "New task" quick-start: one action creates a worktree and launches an agent in it with the user's prompt.
- Browser notifications when agents finish in unfocused worktrees; per-session token/cost display.
- Agent sessions resume across server restarts (persisted SDK session IDs); prompts typed mid-turn are queued.
- Localhost hardening: Origin/Host validation on REST and WebSocket endpoints.
- All dependencies installed via `npm install` (no hand-written lockfiles or vendored packages).

## Capabilities

### New Capabilities

- `repo-registry`: Register, list, and remove local git repositories the app manages; persist the registry across restarts.
- `worktree-management`: List, create, switch focus between, and remove git worktrees for a registered repo.
- `agent-sessions`: Start, prompt, stream, and stop Claude Agent SDK sessions scoped to a worktree; persist session transcripts.
- `file-activity`: Watch the active worktree's filesystem and stream add/change/delete events to the UI in real time.
- `git-essentials`: Status, diff, stage/unstage, commit, branch listing, and push/pull operations per worktree.
- `mission-control-ui`: The web UI shell — repo/worktree navigation, agent chat panel, live file tree, diff viewer, and sprite-based state visualization.

### Modified Capabilities

None — this is a greenfield project with no existing specs.

## Impact

- New codebase: `server/` (Fastify + Agent SDK + git/watcher services) and `web/` (Vite + React app), plus shared types.
- New dependencies: `fastify`, `@fastify/websocket`, `@anthropic-ai/claude-agent-sdk`, `simple-git` (or git CLI via child_process), `chokidar`, `react`, `vite`, `xterm`-free (no terminal in v1).
- Requires: git installed on the machine, Node.js ≥ 20, Claude Code credentials available to the Agent SDK.
- Security posture: server binds to localhost only; it executes git commands and agent sessions with the user's own permissions.
