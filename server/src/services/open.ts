import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { AppPreferences, OpenKind, OpenTarget, TerminalTarget } from "sylva-shared";
import { badRequest } from "../lib/errors.js";

const run = promisify(execFile);

/**
 * Argv templates, never shell strings. Everything here goes to execFile with
 * an argument array, so a worktree path containing spaces, quotes or a
 * semicolon is an argument and nothing else — there is no shell to reinterpret
 * it, and a command template can therefore only ever launch one program.
 */
const PRESETS: Partial<Record<OpenTarget, string[]>> = {
  vscode: ["code", "{path}"],
  cursor: ["cursor", "{path}"],
  zed: ["zed", "{path}"],
};

/**
 * Split a custom template into argv. Handles quoted segments so a path in the
 * template ("/Applications/My Editor") survives, but deliberately understands
 * nothing else — no pipes, no substitution, no chaining.
 */
export function splitCommand(template: string): string[] {
  const out: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(template)) !== null) {
    out.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return out;
}

/**
 * The desktop's own file browser, per platform.
 *
 * Not configurable, and not meant to be: every desktop has exactly one of
 * these, and it is the one thing the OS is guaranteed to know how to do with a
 * directory. Argv again, never a shell string, for the same reason as above.
 */
function revealArgv(path: string, platform: NodeJS.Platform): string[] {
  if (platform === "darwin") return ["open", path];
  if (platform === "win32") return ["explorer.exe", path];
  return ["xdg-open", path];
}

/**
 * The name macOS knows each terminal by.
 *
 * `open -a` takes an application, not a binary, because that is how a Mac
 * starts a program that already has a window open — asking for the binary
 * gives you a second copy of the app instead of a new window in the one
 * that's running.
 */
const MAC_TERMINAL_APPS: Partial<Record<TerminalTarget, string>> = {
  system: "Terminal",
  iterm: "iTerm",
  warp: "Warp",
  ghostty: "Ghostty",
  kitty: "kitty",
};

/**
 * The binary each terminal installs on everything else.
 *
 * No working-directory flag, because they don't agree on one: every terminal
 * here opens in the directory it was launched from, and openExternal launches
 * it from the worktree. `x-terminal-emulator` is the alternatives-system name
 * for "whichever one this desktop picked", which is the closest thing Linux
 * has to a default terminal.
 */
const UNIX_TERMINAL_BINS: Partial<Record<TerminalTarget, string>> = {
  system: "x-terminal-emulator",
  warp: "warp-terminal",
  ghostty: "ghostty",
  kitty: "kitty",
};

/**
 * Resolve "open a terminal here" into an argv.
 *
 * Only macOS is told the path: `open` starts the app detached, so it has no
 * working directory to inherit and has to be handed one. Everywhere else the
 * terminal is spawned from the worktree and inherits it, which is both simpler
 * and the only thing all of these agree on.
 */
function terminalArgv(prefs: AppPreferences, path: string, platform: NodeJS.Platform): string[] {
  const target = prefs.terminalApp;
  if (target === "none") {
    throw badRequest("Opening a terminal is switched off in Settings");
  }
  if (target === "custom") {
    const template = splitCommand(prefs.terminalAppCommand);
    if (template.length === 0) {
      throw badRequest("No terminal command is configured — set one in Settings");
    }
    return template.map((part) => part.replaceAll("{path}", path));
  }
  if (platform === "darwin") {
    const app = MAC_TERMINAL_APPS[target];
    if (!app) throw badRequest(`Sylva can't open ${target} on a Mac — set a custom command`);
    return ["open", "-a", app, path];
  }
  if (platform === "win32") {
    // Windows Terminal is the one every current Windows has, and the only one
    // of these with an argument for the directory to start in.
    if (target !== "system") {
      throw badRequest(
        `Sylva only knows how to open the system terminal on Windows — set a custom command for ${target}`,
      );
    }
    return ["wt.exe", "-d", path];
  }
  const bin = UNIX_TERMINAL_BINS[target];
  if (!bin) {
    throw badRequest(`iTerm2 only exists on macOS — pick another terminal in Settings`);
  }
  return [bin];
}

/** Resolve an open request into a concrete argv. */
export function resolveArgv(
  prefs: AppPreferences,
  kind: OpenKind,
  path: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (kind === "reveal") return revealArgv(path, platform);
  if (kind === "terminal") return terminalArgv(prefs, path, platform);
  const target = prefs.editorTarget;
  if (target === "none") {
    throw badRequest("Opening an editor is switched off in Settings");
  }
  const template = target === "custom" ? splitCommand(prefs.editorCommand) : PRESETS[target];
  if (!template || template.length === 0) {
    throw badRequest("No editor command is configured — pick one in Settings");
  }
  const argv = template.map((part) => part.replaceAll("{path}", path));
  // A template with no {path} would open the editor on nothing useful.
  if (!template.some((part) => part.includes("{path}"))) argv.push(path);
  return argv;
}

export interface OpenResult {
  ok: true;
  /** What was run, for the toast and for debugging a misconfigured command. */
  ran: string;
}

/**
 * Start a program and stop caring about it.
 *
 * A terminal emulator is not a command that finishes — outside macOS, where
 * `open` hands the app to the window server and returns, the process launched
 * here lives as long as the window does. Awaiting it would hang, and the
 * timeout that saved us from hanging would then close the window ten seconds
 * after it opened. So it is detached, unparented, and given no streams to keep
 * alive; the only thing waited on is whether it started at all.
 */
function launchDetached(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export async function openExternal(
  path: string,
  prefs: AppPreferences,
  kind: OpenKind,
): Promise<OpenResult> {
  const [command, ...args] = resolveArgv(prefs, kind, path);
  if (!command) throw badRequest("No open command is configured — pick one in Settings");
  try {
    // `open -a` on a Mac hands the app to the window server and returns, so it
    // can be waited on and its complaints ("Unable to find application named
    // 'Warp'") reported. Every other way of starting a terminal — including a
    // custom command on a Mac — is the terminal itself, which does not return
    // until its window closes, and so has to be let go of.
    const letGo = kind === "terminal" && !(process.platform === "darwin" && command === "open");
    if (letGo) {
      await launchDetached(command, args, path);
    } else {
      await run(command, args, { timeout: 10_000 });
    }
    return { ok: true, ran: [command, ...args].join(" ") };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // Explorer opens the window and then exits 1 anyway — it has done that for
    // twenty years. Only a missing binary is a real failure here.
    if (kind === "reveal" && process.platform === "win32" && code !== "ENOENT") {
      return { ok: true, ran: [command, ...args].join(" ") };
    }
    if (code === "ENOENT") {
      throw badRequest(
        kind === "reveal"
          ? `\`${command}\` isn't on your PATH, so Sylva can't ask this machine to show the folder.`
          : kind === "terminal"
            ? `\`${command}\` isn't on your PATH. Install that terminal, or pick a different one in Settings.`
            : `\`${command}\` isn't on your PATH. Install its shell command, or choose a different target in Settings.`,
      );
    }
    throw badRequest(`\`${command}\` failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
