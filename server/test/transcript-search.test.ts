import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "sylva-shared";
import { Store } from "../src/services/store.js";
import { searchTranscripts } from "../src/services/transcriptSearch.js";

/**
 * Searching every dryad's memory at once. Both of the cases pinned hardest here
 * were found by running this against a real ~/.sylva rather than against
 * fixtures — which is why they are here rather than not.
 */

let store: Store;

/** Write a transcript, optionally registering the session it belongs to. */
async function transcript(
  id: string,
  events: AgentEvent[],
  owner?: { worktreeId: string; repoId: string },
): Promise<void> {
  await writeFile(
    store.transcriptPath(id),
    events.map((e) => `${JSON.stringify(e)}\n`).join(""),
    "utf8",
  );
  if (owner) {
    await store.upsertSession({
      id,
      worktreeId: owner.worktreeId,
      worktreePath: "/tmp/wt",
      repoId: owner.repoId,
      sdkSessionId: null,
      totalCostUsd: 0,
      totalTokens: 0,
      createdAt: "2026-08-01T00:00:00.000Z",
    });
  }
}

function toolUse(over: Partial<Extract<AgentEvent, { kind: "tool-use" }>>): AgentEvent {
  return {
    kind: "tool-use",
    toolUseId: `t${Math.round(over.at ? 1 : 0)}`,
    tool: "Edit",
    summary: "src/a.ts",
    at: "2026-08-01T10:00:00.000Z",
    ...over,
  } as AgentEvent;
}

beforeEach(async () => {
  store = new Store(await mkdtemp(join(tmpdir(), "sylva-tsearch-")));
  await store.init();
});

describe("searching for a file", () => {
  it("finds the steps that touched it", async () => {
    await transcript(
      "s1",
      [
        toolUse({ tool: "Edit", summary: "web/src/App.tsx" }),
        toolUse({ tool: "Read", summary: "web/src/other.ts" }),
      ],
      { worktreeId: "wt-a", repoId: "r1" },
    );

    const res = await searchTranscripts(store, "App.tsx", "file");
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]?.summary).toBe("web/src/App.tsx");
    expect(res.hits[0]?.worktreeId).toBe("wt-a");
  });

  it("prefers the resolved reference over the label", async () => {
    await transcript(
      "s1",
      [toolUse({ tool: "Edit", summary: "…/store.ts", file: { worktreeId: "wt-b", path: "src/state/store.ts" } })],
      { worktreeId: "wt-a", repoId: "r1" },
    );

    const res = await searchTranscripts(store, "state/store.ts", "file");
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]?.file).toEqual({ worktreeId: "wt-b", path: "src/state/store.ts" });
  });

  /**
   * The noisiest bug this feature had. Matching a path against every tool's
   * text meant one `git add` naming six files buried the four real edits.
   */
  it("ignores a bash command that merely names the path", async () => {
    await transcript(
      "s1",
      [
        toolUse({ tool: "Bash", summary: "git add package.json src/a.ts", detail: "git add package.json" }),
        toolUse({ tool: "Edit", summary: "src/a.ts" }),
      ],
      { worktreeId: "wt-a", repoId: "r1" },
    );

    const byFile = await searchTranscripts(store, "package.json", "file");
    expect(byFile.hits).toHaveLength(0);

    // Still findable where commands belong.
    const byText = await searchTranscripts(store, "package.json", "text");
    expect(byText.hits).toHaveLength(1);
  });

  it("says nothing for an empty query rather than everything", async () => {
    await transcript("s1", [toolUse({})], { worktreeId: "wt-a", repoId: "r1" });
    const res = await searchTranscripts(store, "   ", "file");
    expect(res.hits).toHaveLength(0);
    expect(res.sessionsSearched).toBe(0);
  });
});

describe("searching for something said", () => {
  it("finds prompts and answers", async () => {
    await transcript(
      "s1",
      [
        { kind: "user-prompt", text: "why is the watcher leaking descriptors", at: "2026-08-01T10:00:00.000Z" },
        { kind: "assistant-text", text: "Because chokidar watches per file.", at: "2026-08-01T10:01:00.000Z" },
        { kind: "assistant-text", text: "Unrelated.", at: "2026-08-01T10:02:00.000Z" },
      ],
      { worktreeId: "wt-a", repoId: "r1" },
    );

    const res = await searchTranscripts(store, "watcher", "text");
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]?.kind).toBe("user-prompt");
  });

  it("matches regardless of case", async () => {
    await transcript(
      "s1",
      [{ kind: "user-prompt", text: "Fix the WATCHER", at: "2026-08-01T10:00:00.000Z" }],
      { worktreeId: "wt-a", repoId: "r1" },
    );
    expect((await searchTranscripts(store, "watcher", "text")).hits).toHaveLength(1);
  });
});

/**
 * The registry drops a session when its repo is forgotten or its worktree
 * removed; the transcript file stays. On a real machine a third of the
 * conversations were orphaned this way, including the one holding the answer.
 */
describe("conversations the registry has forgotten", () => {
  it("reads them anyway", async () => {
    await transcript("orphan", [toolUse({ tool: "Edit", summary: "web/src/App.tsx" })]);

    const res = await searchTranscripts(store, "App.tsx", "file");
    expect(res.hits).toHaveLength(1);
    expect(res.sessionsSearched).toBe(1);
  });

  it("marks them as having nowhere to jump to", async () => {
    await transcript("orphan", [toolUse({ tool: "Edit", summary: "a.ts" })]);
    const res = await searchTranscripts(store, "a.ts", "file");
    expect(res.hits[0]?.worktreeId).toBe("");
  });

  it("doesn't read a registered session twice", async () => {
    await transcript("s1", [toolUse({ tool: "Edit", summary: "a.ts" })], {
      worktreeId: "wt-a",
      repoId: "r1",
    });
    const res = await searchTranscripts(store, "a.ts", "file");
    expect(res.hits).toHaveLength(1);
    expect(res.sessionsSearched).toBe(1);
  });
});

describe("the shape of the answer", () => {
  it("puts the newest first, across sessions", async () => {
    await transcript(
      "s1",
      [toolUse({ tool: "Edit", summary: "a.ts", at: "2026-08-01T10:00:00.000Z" })],
      { worktreeId: "wt-a", repoId: "r1" },
    );
    await transcript(
      "s2",
      [toolUse({ tool: "Edit", summary: "a.ts", at: "2026-08-03T10:00:00.000Z" })],
      { worktreeId: "wt-b", repoId: "r1" },
    );

    const res = await searchTranscripts(store, "a.ts", "file");
    expect(res.hits.map((h) => h.worktreeId)).toEqual(["wt-b", "wt-a"]);
  });

  it("survives a corrupt line without abandoning the conversation", async () => {
    await writeFile(
      store.transcriptPath("s1"),
      `{"kind":"tool-use","toolUseId":"t","tool":"Edit","summary":"a.ts","at":"2026-08-01T10:00:00.000Z"}\nnot json at all\n`,
      "utf8",
    );
    const res = await searchTranscripts(store, "a.ts", "file");
    expect(res.hits).toHaveLength(1);
  });

  it("counts what it read, so no hits can be told from nothing to read", async () => {
    const res = await searchTranscripts(store, "anything", "file");
    expect(res.sessionsSearched).toBe(0);
    expect(res.hits).toHaveLength(0);
  });
});
