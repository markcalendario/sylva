import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ServerEvent } from "sylva-shared";
import { RunnerService } from "../src/services/runner.js";
import type { Store } from "../src/services/store.js";
import type { Workspace } from "../src/services/workspace.js";
import type { WsHub } from "../src/ws/hub.js";

/**
 * The runner is mostly a conversation with a real child process, so these drive
 * a real one rather than a mock of one — chunk boundaries and exit codes are
 * exactly the parts a mock would get politely wrong.
 */
async function harness(command: string) {
  const cwd = await mkdtemp(join(tmpdir(), "sylva-runner-"));
  const events: ServerEvent[] = [];

  const store = {
    preferences: { runner: { defaultCommand: command, byRepo: {} } },
  } as unknown as Store;
  const workspace = {
    resolveWorktree: async () => ({ repo: { id: "r1" }, worktree: { path: cwd } }),
  } as unknown as Workspace;
  const hub = { broadcast: (e: ServerEvent) => events.push(e) } as unknown as WsHub;

  return { runners: new RunnerService(store, workspace, hub), events, cwd };
}

/** Wait for the runner to report it has exited, or give up. */
async function settled(events: ServerEvent[], timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const exited = events.some((e) => e.type === "runner.state" && e.state.status === "exited");
    if (exited) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("runner never reported an exit");
}

function linesFrom(events: ServerEvent[]): string[] {
  return events.flatMap((e) => (e.type === "runner.output" ? e.lines.map((l) => l.text) : []));
}

describe("runner", () => {
  it("reports the configured command before anything is started", async () => {
    const { runners } = await harness("npm run dev");
    const snapshot = await runners.snapshot("wt1");
    expect(snapshot.state.status).toBe("idle");
    expect(snapshot.state.command).toBe("npm run dev");
    expect(snapshot.lines).toEqual([]);
  });

  it("prefers a repository's own command over the default", async () => {
    const { runners } = await harness("npm run dev");
    // Reach into the same preferences object the service reads.
    const store = (runners as unknown as { store: { preferences: { runner: { byRepo: Record<string, string> } } } }).store;
    store.preferences.runner.byRepo.r1 = "pnpm dev --port 3001";
    expect((await runners.snapshot("wt1")).state.command).toBe("pnpm dev --port 3001");
  });

  it("streams output as whole lines and records a clean exit", async () => {
    const { runners, events } = await harness("printf 'one\\ntwo\\nthree\\n'");
    await runners.start("wt1");
    await settled(events);

    expect(linesFrom(events)).toEqual(["one", "two", "three"]);
    const snapshot = await runners.snapshot("wt1");
    expect(snapshot.state.status).toBe("exited");
    expect(snapshot.state.exitCode).toBe(0);
    // Output survives the process, so you can read why it stopped.
    expect(snapshot.lines.map((l) => l.text)).toEqual(["one", "two", "three"]);
  });

  it("keeps a failing command's output and its exit code", async () => {
    const { runners, events } = await harness("echo 'it broke' >&2; exit 3");
    await runners.start("wt1");
    await settled(events);

    const snapshot = await runners.snapshot("wt1");
    expect(snapshot.state.exitCode).toBe(3);
    expect(snapshot.lines[0]?.stream).toBe("stderr");
    expect(snapshot.lines[0]?.text).toBe("it broke");
  });

  it("finds the served URL in the output", async () => {
    const { runners, events } = await harness(
      "printf '  \\033[32m➜\\033[0m  Local:   http://localhost:5173/\\n'",
    );
    await runners.start("wt1");
    await settled(events);
    expect((await runners.snapshot("wt1")).state.url).toBe("http://localhost:5173/");
  });

  it("leaves the URL null when the command prints none", async () => {
    const { runners, events } = await harness("echo building");
    await runners.start("wt1");
    await settled(events);
    expect((await runners.snapshot("wt1")).state.url).toBeNull();
  });

  it("refuses to start a second command over a running one", async () => {
    const { runners } = await harness("sleep 5");
    await runners.start("wt1");
    await expect(runners.start("wt1")).rejects.toThrow(/already running/i);
    await runners.stop("wt1");
  });

  it("stops a running command", async () => {
    const { runners, events } = await harness("sleep 30");
    const started = await runners.start("wt1");
    expect(started.status).toBe("running");
    expect(started.pid).toBeTypeOf("number");

    await runners.stop("wt1");
    await settled(events);
    expect((await runners.snapshot("wt1")).state.status).toBe("exited");
  });

  it("refuses to stop what isn't running", async () => {
    const { runners } = await harness("echo hi");
    await expect(runners.stop("wt1")).rejects.toThrow(/nothing is running/i);
  });

  it("stops everything on shutdown", async () => {
    const { runners, events } = await harness("sleep 30");
    await runners.start("wt1");
    await runners.stopAll();
    await settled(events);
    expect((await runners.snapshot("wt1")).state.status).toBe("exited");
  });
});
