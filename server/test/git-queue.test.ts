import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GitError } from "../src/lib/errors.js";
import { GitService } from "../src/services/git.js";

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sylva-test-"));
  const git = new GitService();
  await git.run(dir, ["init", "-b", "main"]);
  await git.run(dir, ["config", "user.email", "t@t"]);
  await git.run(dir, ["config", "user.name", "t"]);
  return dir;
}

describe("GitService", () => {
  it("runs commands and returns stdout", async () => {
    const dir = await makeRepo();
    const git = new GitService();
    const { stdout } = await git.run(dir, ["symbolic-ref", "--short", "HEAD"]);
    expect(stdout.trim()).toBe("main");
  });

  it("throws GitError with stderr on failure", async () => {
    const dir = await makeRepo();
    const git = new GitService();
    await expect(git.run(dir, ["checkout", "does-not-exist"])).rejects.toThrowError(GitError);
  });

  it("serializes exclusive operations per directory", async () => {
    const dir = await makeRepo();
    const git = new GitService();
    const order: number[] = [];
    // Two slow-ish mutations racing; the queue must run them one at a time.
    const a = git.runExclusive(dir, ["commit", "--allow-empty", "-m", "one"]).then(() => order.push(1));
    const b = git.runExclusive(dir, ["commit", "--allow-empty", "-m", "two"]).then(() => order.push(2));
    await Promise.all([a, b]);
    expect(order).toEqual([1, 2]);
    const { stdout } = await git.run(dir, ["log", "--oneline"]);
    expect(stdout.trim().split("\n")).toHaveLength(2);
  });

  it("keeps the queue alive after a failed mutation", async () => {
    const dir = await makeRepo();
    const git = new GitService();
    await expect(git.runExclusive(dir, ["commit", "-m", "no changes"])).rejects.toThrow();
    await expect(
      git.runExclusive(dir, ["commit", "--allow-empty", "-m", "after failure"]),
    ).resolves.toBeDefined();
  });
});
