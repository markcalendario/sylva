import { execFileSync } from "node:child_process";
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
/** Finished terminals kept per worktree, so their output can still be read. */
const KEEP_EXITED = 6;
/** How long a hung-up shell is given to go before it is killed outright. */
const GOODBYE_MS = 500;
/**
 * Process groups remembered per run, at most.
 *
 * Only a bound on the worst case — a day of opening and closing terminals
 * shouldn't grow a list forever — and the oldest go first, being the ones
 * least likely to still be running anything.
 */
const REMEMBERED_GROUPS = 256;
/**
 * How often to look at what the live shells have started.
 *
 * A job's process group can only be found while something still points at it,
 * and once the shell exits its children reparent to init and the trail is
 * gone. So the tree is read while it is still a tree. Ten seconds is far
 * inside the lifetime of anything worth catching — a dev server, a watch
 * build — and one `ps` at that rate costs nothing measurable.
 */
const SAMPLE_MS = 10_000;
/**
 * How long after a command is entered to go looking for what it started.
 *
 * Pressing return is the one moment worth watching: it is when a job appears,
 * and a second is long enough for `pnpm dev` to have become a process group
 * and short enough that nobody could have exited the shell yet. Debounced, so
 * holding return down is still one `ps`.
 */
const HARVEST_DEBOUNCE_MS = 1000;

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

interface Session {
  info: TerminalInfo;
  pty: IPty | null;
  /**
   * Everything said so far, capped — replayed to whoever attaches next.
   *
   * Held as the chunks it arrived in rather than one growing string. A pty
   * emits thousands of small writes a second under a build, and `buffer +=
   * data` followed by a `slice` copies the whole quarter-megabyte each time,
   * which turns a noisy terminal into a busy CPU.
   */
  chunks: string[];
  /** Total length of `chunks`, so the cap costs no scanning to enforce. */
  bufferLength: number;
  /** Monotonic per chunk broadcast, so a late attach can dedupe. */
  seq: number;
  pending: string;
  timer: NodeJS.Timeout | null;
  /**
   * Every process group seen under this terminal, the shell's own included.
   *
   * One group is not enough. An interactive shell gives each job a group of
   * its own, so the shell's group holds the shell and almost nothing else —
   * signalling only that reaches the prompt and leaves the dev server it was
   * running perfectly untouched.
   */
  groups: Set<number>;
  /**
   * The pty's own terminal, as `ps` names it — `ttys004` and the like.
   *
   * The one identifier that holds. A process group can only be found by
   * walking down from the shell, and that walk stops working the moment the
   * shell exits and its children are reparented to init. The controlling
   * terminal they were started on is carried by every one of them, reparented
   * or not, for as long as they run.
   */
  tty: string | null;
}

/** A row of the process table, as much of it as any of this needs. */
interface Proc {
  pid: number;
  ppid: number;
  pgid: number;
  tty: string;
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
  /**
   * Every process group Sylva has started a shell in, this run.
   *
   * The session map is not enough to find them by. A terminal that exits is
   * kept only until `reapExited` needs the room, and closing one drops it at
   * once — but neither says anything about what the shell had running, which
   * carries on in that group with its parent gone and no terminal attached.
   * Once the session is forgotten there is nothing left in Sylva that knows
   * the group existed, and nothing in Activity Monitor that says it came from
   * a worktree. So the numbers outlive the sessions, and `closeAll` sweeps
   * them: whatever else it does, Sylva doesn't leave its children behind.
   *
   * Group ids are pids, and pids are eventually reused. A number here can in
   * principle come to mean some unrelated group by the time we sweep it. The
   * window is one Sylva run against the whole pid space, and the alternative
   * is leaving gigabytes running, so it is left at that.
   */
  private spawnedGroups = new Set<number>();
  private sampler: NodeJS.Timeout | null = null;
  private harvestTimer: NodeJS.Timeout | null = null;

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
    // Only live ones count. An exited terminal is a tab holding what it said,
    // not a shell — refusing to open a thirteenth because twelve have already
    // finished would be counting gravestones.
    const running = this.list(worktreeId).filter((t) => t.status === "running");
    if (running.length >= MAX_PER_WORKTREE) {
      throw badRequest(`That's ${MAX_PER_WORKTREE} terminals in one worktree — close one first`);
    }
    this.reapExited(worktreeId);
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
      chunks: [],
      bufferLength: 0,
      seq: 0,
      pending: "",
      timer: null,
      groups: new Set([pty.pid]),
      tty: null,
    };
    this.sessions.set(session.info.id, session);
    this.remember(pty.pid);
    this.startSampling();
    this.scheduleHarvest();

    pty.onData((data) => this.ingest(session, data));
    pty.onExit(({ exitCode, signal }) => {
      this.flush(session);
      session.info.status = "exited";
      session.info.exitCode = signal ? -signal : exitCode;
      session.info.exitedAt = now();
      session.pty = null;
      // Whatever the shell left behind is left behind, exactly as it would be
      // in any other terminal: a shell hangs up its own jobs when it is hung
      // up on, and one that was asked to background something with `&` and
      // then told to exit deliberately doesn't. Sweeping the group from here
      // would reach only a shell without job control — every interactive one
      // puts each job in a group of its own — while breaking a rule every
      // terminal on this machine keeps.
      //
      // Left behind for now, that is. The group is remembered in
      // `spawnedGroups`, so what the shell left running outlives the terminal
      // but not Sylva.
      this.hub.broadcast({ type: "terminal.state", info: { ...session.info } });
    });

    // Typed rather than passed as argv: the point of the Run button is that you
    // end up in a shell that has run it, with its history and its cwd, and can
    // then type the next thing.
    if (command) {
      pty.write(`${command}\r`);
      this.scheduleHarvest();
    }

    this.hub.broadcast({ type: "terminal.state", info: { ...session.info } });
    return session.info;
  }

  buffer(terminalId: string): TerminalBuffer {
    const session = this.require(terminalId);
    // Flush first: anything still pending would otherwise arrive as a live
    // chunk numbered below the sequence this buffer claims to end at.
    this.flush(session);
    return { info: { ...session.info }, data: session.chunks.join(""), seq: session.seq };
  }

  write(terminalId: string, data: string): void {
    const session = this.sessions.get(terminalId);
    if (!session?.pty) return;
    session.pty.write(data);
    // Something was entered — in a moment there may be a job to take note of.
    if (data.includes("\r") || data.includes("\n")) this.scheduleHarvest();
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

  /**
   * Close a terminal for good: kill whatever is in it, then forget it — output
   * and all.
   *
   * The retained output is dropped explicitly rather than left for the
   * collector. Closing a terminal is how you say you are done with what was in
   * it, and a quarter-megabyte of somebody's `.env` echoed into a shell should
   * stop existing at that moment, not whenever the heap next happens to be
   * swept.
   */
  close(terminalId: string): void {
    const session = this.require(terminalId);
    if (session.timer) clearTimeout(session.timer);
    this.killPty(session);
    this.forget(session);
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

  /**
   * Every terminal in a worktree, gone — shells included.
   *
   * Called when the worktree itself is about to be: once it is off the list,
   * its terminals can't be reached from anywhere in Sylva, and a shell nobody
   * can see sitting in a directory that no longer exists is the worst of both.
   * It runs before the removal rather than after, so a build holding the
   * directory open is out of the way when git comes to delete it.
   */
  closeForWorktree(worktreeId: string): void {
    for (const info of this.list(worktreeId)) this.close(info.id);
  }

  /** The same, for every worktree of a repository being forgotten. */
  closeForRepo(repoId: string): void {
    const ids = [...this.sessions.values()]
      .filter((s) => s.info.repoId === repoId)
      .map((s) => s.info.id);
    for (const id of ids) this.close(id);
  }

  /**
   * Let go of terminals that have been dead a while.
   *
   * An exited terminal is kept so its output can still be read, and the tab
   * that holds it is closed by hand. Nothing closes the tabs of someone who
   * shut the browser instead — so a long-lived server accumulates a quarter of
   * a megabyte per shell that ever finished, for nobody. The most recent few
   * are the ones anyone comes back to.
   */
  private reapExited(worktreeId: string): void {
    const dead = this.list(worktreeId).filter((t) => t.status === "exited");
    for (const info of dead.slice(0, Math.max(0, dead.length - KEEP_EXITED))) {
      this.close(info.id);
    }
  }

  /**
   * Nothing Sylva started should outlive it, as far as it can help that.
   *
   * A hangup is a request, and a shell in the middle of something can decline
   * it — which used to be the end of the matter, because this returned the
   * instant the signals were sent and the process exited a moment later. So
   * the groups are watched for as long as it is reasonable to hold up a
   * shutdown, and whatever is still standing is killed rather than left.
   *
   * Live sessions are only half of it. The expensive things — a dev server, a
   * watch build — are exactly the ones that outlast the terminal they were
   * typed into, and by the time Sylva stops, the session that started them is
   * usually long forgotten. So every group this run ever spawned is swept,
   * not just the ones still on screen.
   */
  async closeAll(): Promise<void> {
    this.stopSampling();
    // Everything still running under every live shell, before any of it is
    // signalled and the tree stops being readable.
    this.harvest();

    const groups: number[] = [];
    for (const session of this.sessions.values()) {
      if (session.timer) clearTimeout(session.timer);
      groups.push(...this.killPty(session));
      this.forget(session);
    }
    this.sessions.clear();

    // And the ones with no session left to find them by: terminals that exited
    // on their own, or were closed while something they started kept running.
    // A group that is already gone refuses the signal and is skipped.
    for (const pid of this.spawnedGroups) {
      if (!groups.includes(pid) && sweepGroup(pid)) groups.push(pid);
    }
    this.spawnedGroups.clear();
    if (groups.length === 0) return;

    const deadline = Date.now() + GOODBYE_MS;
    while (Date.now() < deadline && groups.some(groupAlive)) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    for (const pid of groups) {
      if (groupAlive(pid)) sweepGroup(pid, "SIGKILL");
    }
  }

  /**
   * Note a process group as ours, for `closeAll` to sweep later.
   *
   * Kept even after the group has been swept once. A sweep reaches the shell's
   * own group, and an interactive shell puts each job in a group of its own —
   * so the shell going quietly is no promise that what it started did, and the
   * number is worth holding on to either way. Sweeping a group that has long
   * since gone costs one failed signal.
   */
  /**
   * Read the process table once, as pid -> ppid/pgid.
   *
   * Empty on anything that can't answer — Windows has no process groups to
   * ask about, and a `ps` that fails is not a reason to fail a close.
   */
  private snapshot(): Proc[] {
    if (process.platform === "win32") return [];
    let out: string;
    try {
      out = execFileSync("ps", ["-Ao", "pid=,ppid=,pgid=,tty="], {
        encoding: "utf8",
        timeout: 2000,
        maxBuffer: 8 * 1024 * 1024,
      });
    } catch {
      return [];
    }
    const procs: Proc[] = [];
    for (const line of out.split("\n")) {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 4) continue;
      const [pid, ppid, pgid] = fields.map(Number) as [number, number, number];
      if (!Number.isFinite(pid) || !Number.isFinite(ppid) || !Number.isFinite(pgid)) continue;
      procs.push({ pid, ppid, pgid, tty: fields[3] as string });
    }
    return procs;
  }

  /**
   * Note the process groups under every live shell, so they can be signalled
   * once the shell that would have named them is gone.
   *
   * Walks down from each pty rather than up from each process: what we have is
   * the shell's pid, and what we want is everything descended from it however
   * many wrappers deep — `pnpm` starting `turbo` starting `node` is three
   * generations and three groups before anything interesting is reached.
   */
  private harvest(procs = this.snapshot()): void {
    if (procs.length === 0) return;
    const rows = new Map<number, Proc>();
    const byTty = new Map<string, number[]>();
    const children = new Map<number, number[]>();
    for (const proc of procs) {
      rows.set(proc.pid, proc);
      const siblings = children.get(proc.ppid);
      if (siblings) siblings.push(proc.pid);
      else children.set(proc.ppid, [proc.pid]);
      if (!proc.tty || proc.tty === "??" || proc.tty === "-") continue;
      const sharing = byTty.get(proc.tty);
      if (sharing) sharing.push(proc.pgid);
      else byTty.set(proc.tty, [proc.pgid]);
    }

    for (const session of this.sessions.values()) {
      const root = session.pty?.pid;
      // A pty can take a moment to show up in the process table, so a terminal
      // that had no tty to record at spawn gets another chance at every look.
      if (!session.tty && root !== undefined) session.tty = rows.get(root)?.tty || null;

      const found = new Set<number>(session.tty ? byTty.get(session.tty) : undefined);
      // The tree as well as the terminal. Neither alone is enough: a job that
      // has detached from the terminal is still a descendant, and a descendant
      // several wrappers deep — `pnpm` starting `turbo` starting `node` — is
      // reached faster by its terminal than by the walk.
      if (root !== undefined) {
        const queue = [root];
        const seen = new Set<number>();
        while (queue.length > 0) {
          const pid = queue.pop() as number;
          if (seen.has(pid)) continue;
          seen.add(pid);
          const pgid = rows.get(pid)?.pgid;
          if (pgid !== undefined) found.add(pgid);
          for (const child of children.get(pid) ?? []) queue.push(child);
        }
      }

      for (const pgid of found) {
        session.groups.add(pgid);
        this.remember(pgid);
      }
    }
  }

  /** Look shortly, and once, however many times this is called meanwhile. */
  private scheduleHarvest(): void {
    if (this.harvestTimer) return;
    this.harvestTimer = setTimeout(() => {
      this.harvestTimer = null;
      this.harvest();
    }, HARVEST_DEBOUNCE_MS);
    this.harvestTimer.unref?.();
  }

  /** Sample while there is anything to sample, and not a moment longer. */
  private startSampling(): void {
    if (this.sampler) return;
    this.sampler = setInterval(() => {
      if (this.sessions.size === 0) {
        this.stopSampling();
        return;
      }
      this.harvest();
    }, SAMPLE_MS);
    // Never a reason to keep the process alive.
    this.sampler.unref?.();
  }

  private stopSampling(): void {
    if (this.harvestTimer) {
      clearTimeout(this.harvestTimer);
      this.harvestTimer = null;
    }
    if (!this.sampler) return;
    clearInterval(this.sampler);
    this.sampler = null;
  }

  private remember(pid: number): void {
    this.spawnedGroups.add(pid);
    while (this.spawnedGroups.size > REMEMBERED_GROUPS) {
      const oldest = this.spawnedGroups.values().next();
      if (oldest.done) break;
      this.spawnedGroups.delete(oldest.value);
    }
  }

  /** Drop what a terminal said. Called the moment it stops being one. */
  private forget(session: Session): void {
    // The output is what is being forgotten. What the terminal started is not:
    // the numbers go to `spawnedGroups`, which outlives every session.
    for (const pgid of session.groups) this.remember(pgid);
    session.chunks.length = 0;
    session.bufferLength = 0;
    session.pending = "";
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
  private killPty(session: Session): number[] {
    const pty = session.pty;
    // A last look either way. The shell being gone is no reason to skip it:
    // the terminal it was attached to still names everything it started, which
    // is exactly the case where something was left behind.
    this.harvest();
    if (!pty) return [...session.groups].filter((pgid) => sweepGroup(pgid));
    session.pty = null;
    const swept = [...session.groups].filter((pgid) => sweepGroup(pgid));
    if (swept.length > 0) return swept;
    try {
      pty.kill();
    } catch {
      // Already gone; nothing left to signal.
    }
    return [];
  }

  /**
   * Batch output on a short timer. A pty emits a chunk per keystroke echoed,
   * and a frame per chunk would spend the whole socket on `ls`.
   */
  private ingest(session: Session, data: string): void {
    this.retain(session, data);
    session.pending += data;
    if (!session.timer) {
      session.timer = setTimeout(() => this.flush(session), FLUSH_MS);
    }
  }

  /**
   * Keep the last MAX_BUFFER characters, dropping whole chunks off the front
   * and trimming only the one that straddles the cap. Nothing is copied that
   * isn't being thrown away.
   */
  private retain(session: Session, data: string): void {
    session.chunks.push(data);
    session.bufferLength += data.length;
    if (session.bufferLength <= MAX_BUFFER) return;

    let excess = session.bufferLength - MAX_BUFFER;
    while (excess > 0) {
      const first = session.chunks[0];
      if (first === undefined) break;
      if (first.length <= excess) {
        session.chunks.shift();
        excess -= first.length;
      } else {
        session.chunks[0] = first.slice(excess);
        excess = 0;
      }
    }
    session.bufferLength = MAX_BUFFER;
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

/**
 * Hang up on a whole process group.
 *
 * Windows has no process groups to signal, and a negative pid there is simply
 * an error — so it says it couldn't, and the caller falls back to killing the
 * one process node-pty knows about.
 */
function sweepGroup(pid: number, signal: NodeJS.Signals = "SIGHUP"): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * Is anything still in this process group?
 *
 * Signal 0 asks without sending. EPERM is an answer too — something is there,
 * it simply isn't ours to signal.
 */
function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
