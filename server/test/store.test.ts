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
