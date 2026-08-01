import { execFile } from "node:child_process";
import { GitError } from "../lib/errors.js";

const MAX_BUFFER = 32 * 1024 * 1024;

export interface GitResult {
  stdout: string;
  stderr: string;
}

/**
 * Thin promisified wrapper over the git CLI.
 *
 * Reads run concurrently; mutations are serialized per working directory so
 * concurrent actions (user commit while an agent runs git) cannot interleave.
 */
export class GitService {
  private queues = new Map<string, Promise<unknown>>();

  async run(cwd: string, args: string[]): Promise<GitResult> {
    return this.exec(cwd, args);
  }

  /** Serialize through the per-directory mutation queue. */
  async runExclusive(cwd: string, args: string[]): Promise<GitResult> {
    const prev = this.queues.get(cwd) ?? Promise.resolve();
    const next = prev.then(
      () => this.exec(cwd, args),
      () => this.exec(cwd, args),
    );
    // Keep the chain alive regardless of this call's outcome.
    this.queues.set(
      cwd,
      next.catch(() => undefined),
    );
    return next;
  }

  private exec(cwd: string, args: string[]): Promise<GitResult> {
    return new Promise((resolve, reject) => {
      execFile(
        "git",
        args,
        { cwd, maxBuffer: MAX_BUFFER, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
        (error, stdout, stderr) => {
          if (error) {
            const exitCode = typeof error.code === "number" ? error.code : 1;
            reject(
              new GitError(
                stderr.trim() || error.message,
                exitCode,
                stderr,
                args,
                stdout,
              ),
            );
          } else {
            resolve({ stdout, stderr });
          }
        },
      );
    });
  }
}
