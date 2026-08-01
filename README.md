# Sylva 🌲

A local mission control for git worktrees and Claude agents — a forest at night, tended by pixel dryads.

Each registered repository is part of your forest. Each worktree is a tree with a resident dryad sprite that idles when quiet, types furiously while its agent works, celebrates on commits, and panics on errors. Prompt a Claude agent in any worktree, watch files change live, and do everyday git — all from one glanceable dashboard.

## Requirements

- Node.js ≥ 20 and npm
- git on your PATH
- [Claude Code](https://claude.com/claude-code) authenticated on this machine (run `claude` once and log in) — agent features use the Claude Agent SDK with your existing credentials

## Run it

```bash
npm install
npm run dev        # backend on :4611, UI on http://localhost:5173
```

Production-style (single port):

```bash
npm run build
npm start          # everything on http://localhost:4611
```

## Using Sylva

1. **Register a repo** — sidebar → "+ Register repo", paste an absolute path.
2. **New task** — the amber button: name a task, write a prompt, and Sylva creates a worktree, focuses it, and sets an agent working in one step.
3. **Talk to the dryad** — the Agent tab streams text, tool calls, and results. Permission requests appear inline (Allow / Allow always this session / Deny). Prompts sent mid-turn queue up. Costs show per session.
4. **Watch the forest** — Files tab is a live feed of changes; sprites and badges show background-agent activity in unfocused worktrees; browser notifications fire when a background agent finishes.
5. **Git** — status groups, diff viewer, stage/unstage, commit, branches, push/pull (with `--set-upstream` offer).

Sessions survive restarts: transcripts persist to `~/.sylva/sessions/`, and conversations resume via the Agent SDK after the server restarts.

## Architecture

npm workspaces monorepo:

- `server/` — Fastify (localhost-only, Origin/Host-validated) + WebSocket hub. Git via the real `git` CLI with per-worktree operation queues; file watching via chokidar; agents via `@anthropic-ai/claude-agent-sdk` streaming sessions (one active session per worktree).
- `web/` — Vite + React. Zustand for live WS-fed state, TanStack Query for REST. Sprites are hand-authored 16×16 pixel matrices compiled to sprite-sheet PNGs at runtime and animated with CSS `steps()`.
- `shared/` — TypeScript contract for REST payloads and WS events.

State lives in `~/.sylva/` (`registry.json`, `sessions/*.jsonl`). Override with `SYLVA_HOME`; port with `SYLVA_PORT`.

Specs and design docs live in `openspec/`.

```bash
npm test           # server test suite (parsers, git queue, store)
```
