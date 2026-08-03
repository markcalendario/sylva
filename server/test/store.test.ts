import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "../src/services/store.js";

describe("Store", () => {
  it("persists repos across instances", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sylva-store-"));
    const a = new Store(dir);
    await a.init();
    await a.addRepo({ id: "r1", name: "repo", path: "/x/repo" });

    const b = new Store(dir);
    await b.init();
    expect(b.repos).toEqual([{ id: "r1", name: "repo", path: "/x/repo" }]);
  });

  it("removing a repo drops its sessions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sylva-store-"));
    const store = new Store(dir);
    await store.init();
    await store.addRepo({ id: "r1", name: "repo", path: "/x/repo" });
    await store.upsertSession({
      id: "s1",
      worktreeId: "w1",
      worktreePath: "/x/repo",
      repoId: "r1",
      sdkSessionId: "sdk-1",
      totalCostUsd: 1,
      totalTokens: 2,
      createdAt: "2026-01-01T00:00:00Z",
    });
    await store.removeRepo("r1");
    expect(store.sessions).toEqual([]);
  });

  it("settings live in settings.json, not in the repository", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sylva-store-"));
    const store = new Store(dir);
    await store.init();
    await store.setPreferences({
      editorTarget: "cursor",
      editorCommand: "",
      terminalShell: "/bin/fish",
      copyEnvFiles: false,
      savedPrompts: [{ id: "p1", label: "Ship it", text: "Run the tests, then commit." }],
    });
    await store.setGlobalSettings({ bypassPermissions: false, model: "claude-opus-5", effort: null });

    const { readFile } = await import("node:fs/promises");
    const written = JSON.parse(await readFile(join(dir, "settings.json"), "utf8"));
    expect(written.preferences.editorTarget).toBe("cursor");
    expect(written.preferences.terminalShell).toBe("/bin/fish");
    expect(written.preferences.savedPrompts[0].label).toBe("Ship it");
    expect(written.globalSettings.model).toBe("claude-opus-5");

    const reopened = new Store(dir);
    await reopened.init();
    expect(reopened.preferences.savedPrompts[0]?.text).toBe("Run the tests, then commit.");
    expect(reopened.globalSettings.model).toBe("claude-opus-5");
  });

  it("carries settings over from an old registry.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sylva-store-"));
    const { writeFile, readFile } = await import("node:fs/promises");
    // The shape Sylva wrote before settings had their own file.
    await writeFile(
      join(dir, "registry.json"),
      JSON.stringify({
        repos: [{ id: "r1", name: "repo", path: "/x/repo" }],
        sessions: [],
        prefs: { w1: { model: "claude-haiku-4-5" } },
        globalSettings: { bypassPermissions: true, model: "claude-sonnet-5", effort: "high" },
      }),
      "utf8",
    );

    const store = new Store(dir);
    await store.init();
    expect(store.repos).toEqual([{ id: "r1", name: "repo", path: "/x/repo" }]);
    expect(store.globalSettings.model).toBe("claude-sonnet-5");
    expect(store.overridesFor("w1")).toEqual({ model: "claude-haiku-4-5" });
    // Migration is written out, so the next start reads the new file.
    const migrated = JSON.parse(await readFile(join(dir, "settings.json"), "utf8"));
    expect(migrated.globalSettings.effort).toBe("high");
  });

  it("survives a corrupt registry file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sylva-store-"));
    const a = new Store(dir);
    await a.init();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, "registry.json"), "{not json", "utf8");
    const b = new Store(dir);
    await b.init();
    expect(b.repos).toEqual([]);
  });

  it("upsert updates in place", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sylva-store-"));
    const store = new Store(dir);
    await store.init();
    const base = {
      id: "s1",
      worktreeId: "w1",
      worktreePath: "/x",
      repoId: "r1",
      sdkSessionId: null,
      totalCostUsd: 0,
      totalTokens: 0,
      createdAt: "2026-01-01T00:00:00Z",
    };
    await store.upsertSession(base);
    await store.upsertSession({ ...base, sdkSessionId: "sdk-9", totalCostUsd: 3 });
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0]).toMatchObject({ sdkSessionId: "sdk-9", totalCostUsd: 3 });
  });
});
