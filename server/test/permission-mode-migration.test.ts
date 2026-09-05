import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "../src/services/store.js";

/**
 * Permissions used to be a boolean. Every settings.json in existence carries
 * `bypassPermissions`, and reading one wrong is the worst kind of bug here:
 * silently promoting a careful setup to "ask nothing" is not something the
 * user would find out about until it had already run something.
 */
async function storeWith(settings: unknown) {
  const home = await mkdtemp(join(tmpdir(), "sylva-home-"));
  await mkdir(home, { recursive: true });
  await writeFile(join(home, "settings.json"), JSON.stringify(settings), "utf8");
  const store = new Store(home);
  await store.init();
  return { store, home };
}

describe("settings written before permission modes", () => {
  it("reads bypassPermissions: true as full access", async () => {
    const { store } = await storeWith({
      globalSettings: { bypassPermissions: true, model: null, effort: null },
    });
    expect(store.globalSettings.permissionMode).toBe("full");
  });

  it("reads bypassPermissions: false as what it actually did", async () => {
    // The old `false` branch ran the SDK in acceptEdits, not in its default
    // mode — so reading it as "supervised" would quietly start asking about
    // every file write in setups that never did before.
    const { store } = await storeWith({
      globalSettings: { bypassPermissions: false, model: "claude-opus-5", effort: "high" },
    });
    expect(store.globalSettings.permissionMode).toBe("acceptEdits");
    expect(store.globalSettings.model).toBe("claude-opus-5");
    expect(store.globalSettings.effort).toBe("high");
  });

  it("migrates a worktree's override too", async () => {
    const { store } = await storeWith({
      globalSettings: { bypassPermissions: false, model: null, effort: null },
      prefs: { abc123: { bypassPermissions: true }, def456: { model: "claude-haiku-4-5" } },
    });
    expect(store.overridesFor("abc123").permissionMode).toBe("full");
    // A worktree that only overrode the model must not acquire a permission
    // mode it never asked for — an absent key is how "inherit" is spelled.
    expect(store.overridesFor("def456").permissionMode).toBeUndefined();
    expect(store.overridesFor("def456").model).toBe("claude-haiku-4-5");
  });

  it("drops the old key once it has been written back", async () => {
    const { store, home } = await storeWith({
      globalSettings: { bypassPermissions: true, model: null, effort: null },
    });
    await store.setGlobalSettings({ ...store.globalSettings });
    const written = JSON.parse(await readFile(join(home, "settings.json"), "utf8"));
    expect(written.globalSettings.bypassPermissions).toBeUndefined();
    expect(written.globalSettings.permissionMode).toBe("full");
  });

  it("takes the cautious reading of a value it doesn't understand", async () => {
    const { store } = await storeWith({
      globalSettings: { permissionMode: "whatever", model: null, effort: null },
    });
    expect(store.globalSettings.permissionMode).toBe("supervised");
  });
});
