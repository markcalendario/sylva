import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PREFERENCE_DEFAULTS, TERMINAL_SCROLLBACK_MAX } from "sylva-shared";
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
      terminalApp: "ghostty",
      terminalAppCommand: "",
      terminalScrollback: 2_500,
      copyEnvFiles: false,
      pullBeforeWorktree: false,
    });
    await store.setGlobalSettings({
      permissionMode: "acceptEdits",
      model: "claude-opus-5",
      effort: null,
    });

    const { readFile } = await import("node:fs/promises");
    const written = JSON.parse(await readFile(join(dir, "settings.json"), "utf8"));
    expect(written.preferences.editorTarget).toBe("cursor");
    expect(written.preferences.terminalShell).toBe("/bin/fish");
    expect(written.preferences.terminalApp).toBe("ghostty");
    expect(written.globalSettings.model).toBe("claude-opus-5");

    const reopened = new Store(dir);
    await reopened.init();
    expect(reopened.preferences.terminalScrollback).toBe(2_500);
    expect(reopened.globalSettings.model).toBe("claude-opus-5");
  });

  /**
   * A settings.json written before these existed must still open. Absent keys
   * take the default rather than arriving as undefined — a preference nobody
   * has ever set is not the same as one set to nothing.
   */
  it("fills in preferences an older settings file never had", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sylva-store-"));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(dir, "settings.json"),
      JSON.stringify({
        globalSettings: { permissionMode: "acceptEdits", model: null, effort: null },
        preferences: { editorTarget: "zed", editorCommand: "", terminalShell: "" },
        prefs: {},
      }),
      "utf8",
    );

    const store = new Store(dir);
    await store.init();
    expect(store.preferences.editorTarget).toBe("zed");
    expect(store.preferences.copyEnvFiles).toBe(PREFERENCE_DEFAULTS.copyEnvFiles);
    expect(store.preferences.terminalApp).toBe(PREFERENCE_DEFAULTS.terminalApp);
    expect(store.preferences.terminalScrollback).toBe(PREFERENCE_DEFAULTS.terminalScrollback);
  });

  it("keeps a stored scrollback inside the range a terminal accepts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sylva-store-"));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(dir, "settings.json"),
      JSON.stringify({ preferences: { terminalScrollback: 10_000_000 } }),
      "utf8",
    );

    const store = new Store(dir);
    await store.init();
    expect(store.preferences.terminalScrollback).toBe(TERMINAL_SCROLLBACK_MAX);
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
        globalSettings: { permissionMode: "full", model: "claude-sonnet-5", effort: "high" },
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
