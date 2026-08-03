import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AppPreferences, OpenKind, OpenTarget } from "sylva-shared";
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

/** Resolve the configured editor into a concrete argv. */
export function resolveArgv(prefs: AppPreferences, _kind: OpenKind, path: string): string[] {
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

export async function openExternal(
  path: string,
  prefs: AppPreferences,
  kind: OpenKind,
): Promise<OpenResult> {
  const [command, ...args] = resolveArgv(prefs, kind, path);
  if (!command) throw badRequest("No open command is configured — pick one in Settings");
  try {
    await run(command, args, { timeout: 10_000 });
    return { ok: true, ran: [command, ...args].join(" ") };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw badRequest(
        `\`${command}\` isn't on your PATH. Install its shell command, or choose a different target in Settings.`,
      );
    }
    throw badRequest(`\`${command}\` failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
