import { accessSync, chmodSync, constants, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { IPty } from "node-pty";
import { spawn } from "node-pty";
import type { ClientEvent, TerminalBuffer, TerminalInfo } from "sylva-shared";
import { badRequest, notFound } from "../lib/errors.js";
import { freshId, now } from "../lib/id.js";
import type { Store } from "./store.js";
import type { Workspace } from "./workspace.js";
import type { WsHub } from "../ws/hub.js";

/** Matches the file watcher's debounce, for the same reason: fewer, fuller frames. */
const FLUSH_MS = 16;
/**
 * Retained output per terminal, in characters. Enough to scroll back through a
 * failed build; small enough that a runaway `yes` can't eat the process.
 */
const MAX_BUFFER = 256_000;
const MAX_PER_WORKTREE = 12;

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

interface Session {
  info: TerminalInfo;
  pty: IPty | null;
  /** Everything said so far, capped — replayed to whoever attaches next. */
  buffer: string;
  /** Monotonic per chunk broadcast, so a late attach can dedupe. */
  seq: number;
  pending: string;
  timer: NodeJS.Timeout | null;
}

/**
 * npm ships node-pty's prebuilt `spawn-helper` without its executable bit, and
 * a helper that can't be executed fails every spawn with "posix_spawnp failed"
 * — a message that says nothing about the cause. Put the bit back before the
 * first spawn rather than asking every user to.
 */
function ensureSpawnHelper(): void {
  if (process.platform === "win32") return;
  try {
    const require = createRequire(import.meta.url);
    const root = dirname(require.resolve("node-pty/package.json"));
    const helper = join(root, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
    const mode = statSync(helper).mode;
    if ((mode & 0o111) === 0) chmodSync(helper, mode | 0o755);
  } catch {
    // Built from source, or a layout we don't recognise — node-pty will say so
    // far more accurately than a guess from here would.
  }
}

/** The shell to run: what the user chose, what they log in with, or a fallback. */
function defaultShell(configured: string): string {
  const chosen = configured.trim();
  if (chosen) return chosen;
  if (process.platform === "win32") return process.env.COMSPEC ?? "powershell.exe";
  return process.env.SHELL ?? "/bin/zsh";
}

/**
 * Real terminals, in the worktree.
 *
 * The old runner was one command per worktree, with its output piped and read
 * only. This is a pty: what is on screen is what a terminal would show, `git
 * rebase -i` opens its editor, ^C reaches the process group, and there can be
 * as many of them as the work needs.
 */
export class TerminalService {
  private sessions = new Map<string, Session>();
  private helperReady = false;

  constructor(
    private store: Store,
    private workspace: Workspace,
    private hub: WsHub,
  ) {}

  /** Every live terminal in a worktree, oldest first — the order they're tabbed in. */
  list(worktreeId: string): TerminalInfo[] {
    return [...this.sessions.values()]
      .filter((s) => s.info.worktreeId === worktreeId)
      .map((s) => s.info);
  }

  all(): TerminalInfo[] {
    return [...this.sessions.values()].map((s) => s.info);
  }

  async create(
    worktreeId: string,
    opts: { cols?: number; rows?: number; command?: string } = {},
  ): Promise<TerminalInfo> {
    const { repo, worktree } = await this.workspace.resolveWorktree(worktreeId);
    if (this.list(worktreeId).length >= MAX_PER_WORKTREE) {
      throw badRequest(`That's ${MAX_PER_WORKTREE} terminals in one worktree — close one first`);
    }
    if (!this.helperReady) {
      ensureSpawnHelper();
      this.helperReady = true;
    }

    const shell = defaultShell(this.store.preferences.terminalShell);
    const cols = clamp(opts.cols ?? DEFAULT_COLS, 2, 500);
    const rows = clamp(opts.rows ?? DEFAULT_ROWS, 2, 300);
    const command = opts.command?.trim() ?? "";

    // A pty that can't exec its shell doesn't fail loudly — it opens and dies
    // an instant later, leaving a blank terminal and no reason. Check first, so
    // a typo in the Settings shell says what's wrong.
    if (shell.includes("/") || shell.includes("\\")) {
      try {
        accessSync(shell, constants.X_OK);
      } catch {
        throw badRequest(
          `Couldn't start \`${shell}\` — no such program, or it isn't executable. Pick a shell in Settings.`,
        );
      }
    }

    let pty: IPty;
    try {
      pty = spawn(shell, [], {
        name: "xterm-256color",
        cwd: worktree.path,
        cols,
        rows,
        env: {
          ...(process.env as Record<string, string>),
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          // Tells anything that asks — a prompt, a script — where it is running.
          SYLVA_WORKTREE: worktree.path,
        },
      });
    } catch (err) {
      throw badRequest(
        `Couldn't start ${shell}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const session: Session = {
      info: {
        id: freshId(),
        worktreeId,
        repoId: repo.id,
        title: command || basename(shell),
        shell,
        cwd: worktree.path,
        status: "running",
        exitCode: null,
        cols,
        rows,
        startedAt: now(),
        exitedAt: null,
      },
      pty,
      buffer: "",
      seq: 0,
      pending: "",
      timer: null,
    };
    this.sessions.set(session.info.id, session);

    pty.onData((data) => this.ingest(session, data));
    pty.onExit(({ exitCode, signal }) => {
      this.flush(session);
      session.info.status = "exited";
      session.info.exitCode = signal ? -signal : exitCode;
      session.info.exitedAt = now();
      session.pty = null;
      this.hub.broadcast({ type: "terminal.state", info: { ...session.info } });
    });

    // Typed rather than passed as argv: the point of the Run button is that you
    // end up in a shell that has run it, with its history and its cwd, and can
    // then type the next thing.
    if (command) pty.write(`${command}\r`);

    this.hub.broadcast({ type: "terminal.state", info: { ...session.info } });
    return session.info;
  }

  buffer(terminalId: string): TerminalBuffer {
    const session = this.require(terminalId);
    // Flush first: anything still pending would otherwise arrive as a live
    // chunk numbered below the sequence this buffer claims to end at.
    this.flush(session);
    return { info: { ...session.info }, data: session.buffer, seq: session.seq };
  }

  write(terminalId: string, data: string): void {
    const session = this.sessions.get(terminalId);
    session?.pty?.write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const session = this.sessions.get(terminalId);
    if (!session?.pty) return;
    const nextCols = clamp(cols, 2, 500);
    const nextRows = clamp(rows, 2, 300);
    if (nextCols === session.info.cols && nextRows === session.info.rows) return;
    try {
      session.pty.resize(nextCols, nextRows);
    } catch {
      // The child died between the check and the call; its exit is on its way.
      return;
    }
    session.info.cols = nextCols;
    session.info.rows = nextRows;
  }

  /** Close a terminal for good: kill whatever is in it, then forget it. */
  close(terminalId: string): void {
    const session = this.require(terminalId);
    if (session.timer) clearTimeout(session.timer);
    this.killPty(session);
    this.sessions.delete(terminalId);
    this.hub.broadcast({ type: "terminal.closed", terminalId });
  }

  /** Input from the socket. Unknown ids are dropped — the terminal is gone. */
  handleClientEvent(event: ClientEvent): void {
    if (event.type === "terminal.input") this.write(event.terminalId, event.data);
    else if (event.type === "terminal.resize") {
      this.resize(event.terminalId, event.cols, event.rows);
    }
  }

  /** Nothing Sylva started should outlive it, as far as it can help that. */
  async closeAll(): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.timer) clearTimeout(session.timer);
      this.killPty(session);
    }
    this.sessions.clear();
  }

  private require(terminalId: string): Session {
    const session = this.sessions.get(terminalId);
    if (!session) throw notFound("Terminal");
    return session;
  }

  /**
   * Take the whole session down, not just the shell.
   *
   * node-pty signals the shell's pid alone. A shell running `npm run dev` is
   * then killed while vite keeps the port — exactly the mess that closing a
   * terminal is supposed to clear up. The shell is a session leader, so the
   * negative pid reaches everything it started.
   */
  private killPty(session: Session): void {
    const pty = session.pty;
    if (!pty) return;
    session.pty = null;
    try {
      process.kill(-pty.pid, "SIGHUP");
    } catch {
      try {
        pty.kill();
      } catch {
        // Already gone; nothing left to signal.
      }
    }
  }

  /**
   * Batch output on a short timer. A pty emits a chunk per keystroke echoed,
   * and a frame per chunk would spend the whole socket on `ls`.
   */
  private ingest(session: Session, data: string): void {
    session.buffer += data;
    if (session.buffer.length > MAX_BUFFER) {
      session.buffer = session.buffer.slice(session.buffer.length - MAX_BUFFER);
    }
    session.pending += data;
    if (!session.timer) {
      session.timer = setTimeout(() => this.flush(session), FLUSH_MS);
    }
  }

  private flush(session: Session): void {
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }
    if (session.pending.length === 0) return;
    const data = session.pending;
    session.pending = "";
    session.seq += 1;
    this.hub.broadcast({
      type: "terminal.output",
      terminalId: session.info.id,
      seq: session.seq,
      data,
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
