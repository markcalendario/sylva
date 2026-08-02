import { appendFile, mkdir, readFile } from "node:fs/promises";
import { relative } from "node:path";
import {
  query,
  type CanUseTool,
  type Options,
  type PermissionUpdate,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  circleMembers,
  GROVE_ID,
  type AgentAvailability,
  type AgentEvent,
  type PermissionAnswer,
  type PermissionRequest,
  type AgentSettings,
  type QueuedPrompt,
  type SessionInfo,
  type WorktreeOverrides,
  type WorktreeSettings,
} from "sylva-shared";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { freshId, now } from "../lib/id.js";
import type { Store } from "./store.js";
import type { WatcherManager } from "./watcher.js";
import type { Workspace } from "./workspace.js";
import type { WsHub } from "../ws/hub.js";

const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;

/** Pushable async iterable feeding the SDK's streaming input. */
class InputStream implements AsyncIterable<SDKUserMessage> {
  private buffer: SDKUserMessage[] = [];
  private waiter: ((m: SDKUserMessage | null) => void) | null = null;
  private ended = false;

  push(message: SDKUserMessage): void {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(message);
    } else {
      this.buffer.push(message);
    }
  }

  end(): void {
    this.ended = true;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(null);
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (true) {
      const buffered = this.buffer.shift();
      if (buffered) {
        yield buffered;
        continue;
      }
      if (this.ended) return;
      const next = await new Promise<SDKUserMessage | null>((res) => {
        this.waiter = res;
      });
      if (next === null) return;
      yield next;
    }
  }
}

interface PendingPermission {
  request: PermissionRequest;
  resolve: (answer: PermissionAnswer | "timeout") => void;
  suggestions: PermissionUpdate[] | undefined;
  timer: NodeJS.Timeout;
}

/**
 * Where a session runs. Sessions used to resolve a worktree directly, which
 * made "an agent you can talk to without picking a worktree first" impossible
 * to express. Resolving a *target* instead leaves every map in this class keyed
 * by the same string it was keyed by before — only what that string resolves to
 * changed.
 */
interface SessionTarget {
  id: string;
  cwd: string;
  /** Branch for a worktree; null for the grove, which is on no branch. */
  label: string | null;
  repoId: string;
  isGrove: boolean;
  /**
   * Worktrees this session can reach beyond its cwd. Empty for an ordinary
   * worktree; the rest of the circle for a shared one.
   */
  extraDirs: string[];
  /** Worktree ids to keep watched while this session lives. */
  watch: { worktreeId: string; path: string }[];
  /** Appended to the system prompt when the session needs explaining. */
  brief: string | null;
}

interface ActiveSession {
  info: SessionInfo;
  worktreePath: string;
  repoId: string;
  isGrove: boolean;
  watch: { worktreeId: string; path: string }[];
  input: InputStream;
  q: Query | null;
  alwaysAllow: Set<string>;
  pendingPermissions: Map<string, PendingPermission>;
  loopDone: Promise<void> | null;
}

/** Agents habitually prefix commands with `cd "<worktree>" &&`; that's noise here. */
const CD_PREFIX = /^\s*cd\s+(?:"[^"]*"|'[^']*'|[^\s&|;]+)\s*&&\s*/;

function stripCdPrefixes(command: string): string {
  let out = command;
  while (CD_PREFIX.test(out)) out = out.replace(CD_PREFIX, "");
  return out.replace(/\s*\n\s*/g, " ").trim();
}

/** Absolute paths inside the worktree read better as repo-relative ones. */
function relativize(path: string, root: string): string {
  if (!path || !root) return path;
  const rel = relative(root, path);
  return rel && !rel.startsWith("..") ? rel : path;
}

/** Commands read from the front; paths read from the end. */
function clampHead(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function clampTail(text: string, max: number): string {
  return text.length <= max ? text : `…${text.slice(text.length - max + 1)}`;
}

interface ToolLabel {
  summary: string;
  detail?: string;
}

/** Build the one-line label shown for a tool call in the chat. */
export function describeTool(
  tool: string,
  input: Record<string, unknown>,
  root: string,
): ToolLabel {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const filePath = str(input.file_path) || str(input.path);

  switch (tool) {
    case "Bash": {
      const command = stripCdPrefixes(str(input.command));
      if (!command) return { summary: "(empty command)" };
      return { summary: clampHead(command, 120), detail: command };
    }
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit": {
      const rel = relativize(filePath, root);
      return { summary: clampTail(rel, 80), detail: filePath };
    }
    case "Glob":
      return { summary: clampHead(str(input.pattern), 80) };
    case "Grep": {
      const where = filePath ? ` in ${clampTail(relativize(filePath, root), 40)}` : "";
      return { summary: clampHead(`${str(input.pattern)}${where}`, 100) };
    }
    case "WebFetch":
      return { summary: clampHead(str(input.url), 90), detail: str(input.url) };
    case "WebSearch":
      return { summary: clampHead(str(input.query), 90) };
    case "Task":
    case "Agent": {
      const text = str(input.description) || str(input.prompt);
      return { summary: clampHead(text, 100), detail: text };
    }
    case "TodoWrite":
      return { summary: "updated the task list" };
    default: {
      const candidate =
        str(input.command) || filePath || str(input.pattern) || str(input.url) || str(input.prompt);
      const text = candidate || JSON.stringify(input);
      return { summary: clampHead(text, 100), detail: text };
    }
  }
}

function differs(a: AgentSettings, b: AgentSettings): boolean {
  return (
    a.bypassPermissions !== b.bypassPermissions || a.model !== b.model || a.effort !== b.effort
  );
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : ""))
      .join("");
  }
  return "";
}

/** Runs Claude Agent SDK sessions, one active per worktree. */
export class SessionManager {
  private sessions = new Map<string, ActiveSession>(); // sessionId -> state
  private byWorktree = new Map<string, string>(); // worktreeId -> sessionId
  private availability: AgentAvailability = { available: true };

  constructor(
    private store: Store,
    private workspace: Workspace,
    private watchers: WatcherManager,
    private hub: WsHub,
  ) {}

  getAvailability(): AgentAvailability {
    return this.availability;
  }

  listSessions(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => s.info);
  }

  getByWorktree(worktreeId: string): SessionInfo | null {
    const id = this.byWorktree.get(worktreeId);
    return id ? (this.sessions.get(id)?.info ?? null) : null;
  }

  async transcript(worktreeId: string): Promise<AgentEvent[]> {
    const persisted = this.store.sessions.find((s) => s.worktreeId === worktreeId);
    const sessionId = this.byWorktree.get(worktreeId) ?? persisted?.id;
    if (!sessionId) return [];
    try {
      const raw = await readFile(this.store.transcriptPath(sessionId), "utf8");
      return raw
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as AgentEvent);
    } catch {
      return [];
    }
  }

  /** Send a prompt: create/reuse the worktree's session; queue if a turn is running. */
  async prompt(worktreeId: string, text: string): Promise<SessionInfo> {
    if (!text.trim()) throw badRequest("Prompt must not be empty");
    let session = this.activeByWorktree(worktreeId);
    if (!session) session = await this.create(worktreeId);

    if (session.info.status === "running") {
      const queued: QueuedPrompt = { id: freshId(), text, queuedAt: now() };
      session.info.queuedPrompts.push(queued);
      this.broadcastSession(session);
      return session.info;
    }
    this.dispatch(session, text);
    return session.info;
  }

  async interrupt(worktreeId: string): Promise<SessionInfo> {
    const session = this.requireActive(worktreeId);
    if (session.q) await session.q.interrupt().catch(() => {});
    session.info.status = "interrupted";
    this.appendEvent(session, { kind: "result", outcome: "interrupted", at: now() });
    this.broadcastSession(session);
    return session.info;
  }

  removeQueuedPrompt(worktreeId: string, promptId: string): SessionInfo {
    const session = this.requireActive(worktreeId);
    const before = session.info.queuedPrompts.length;
    session.info.queuedPrompts = session.info.queuedPrompts.filter((p) => p.id !== promptId);
    if (session.info.queuedPrompts.length === before) throw notFound("queued prompt");
    this.broadcastSession(session);
    return session.info;
  }

  answerPermission(requestId: string, answer: PermissionAnswer): void {
    for (const session of this.sessions.values()) {
      const pending = session.pendingPermissions.get(requestId);
      if (pending) {
        if (answer === "allow-always") session.alwaysAllow.add(pending.request.tool);
        clearTimeout(pending.timer);
        session.pendingPermissions.delete(requestId);
        pending.resolve(answer);
        this.hub.broadcast({ type: "permission.resolved", requestId, answer });
        return;
      }
    }
    throw notFound("permission request");
  }

  pendingPermissions(worktreeId: string): PermissionRequest[] {
    const session = this.activeByWorktree(worktreeId);
    if (!session) return [];
    return [...session.pendingPermissions.values()].map((p) => p.request);
  }

  /**
   * Every request waiting on an answer, across all sessions. The web app asks
   * for this on connect: permission.request events only arrive while the page
   * is open, so a reload would otherwise lose track of an agent that is
   * already blocked and show it as merrily working.
   */
  allPendingPermissions(): PermissionRequest[] {
    return [...this.sessions.values()].flatMap((s) =>
      [...s.pendingPermissions.values()].map((p) => p.request),
    );
  }

  getSettings(worktreeId: string): WorktreeSettings {
    return {
      overrides: this.store.overridesFor(worktreeId),
      effective: this.store.effectiveFor(worktreeId),
      global: this.store.globalSettings,
    };
  }

  /**
   * Model, effort and permission mode are all fixed when the SDK query starts,
   * so changing any of them tears the session down. The next prompt reopens it
   * — resuming by SDK session id, so the conversation carries over.
   */
  async setOverrides(
    worktreeId: string,
    overrides: WorktreeOverrides,
  ): Promise<WorktreeSettings> {
    const before = this.store.effectiveFor(worktreeId);
    await this.store.setOverrides(worktreeId, overrides);
    if (differs(before, this.store.effectiveFor(worktreeId))) {
      await this.restart(worktreeId);
    }
    return this.getSettings(worktreeId);
  }

  /** Global changes touch every worktree that hasn't overridden the field. */
  async setGlobalSettings(settings: AgentSettings): Promise<AgentSettings> {
    const before = new Map(
      [...this.byWorktree.keys()].map((id) => [id, this.store.effectiveFor(id)]),
    );
    await this.store.setGlobalSettings(settings);
    for (const [worktreeId, previous] of before) {
      if (differs(previous, this.store.effectiveFor(worktreeId))) {
        await this.restart(worktreeId);
      }
    }
    return settings;
  }

  /** End the SDK query so the next prompt reopens it with current settings. */
  private async restart(worktreeId: string): Promise<void> {
    const session = this.activeByWorktree(worktreeId);
    if (!session) return;
    if (session.q) await session.q.interrupt().catch(() => {});
    session.input.end();
  }

  // ---------- internals ----------

  private activeByWorktree(worktreeId: string): ActiveSession | null {
    const id = this.byWorktree.get(worktreeId);
    return id ? (this.sessions.get(id) ?? null) : null;
  }

  private requireActive(worktreeId: string): ActiveSession {
    const session = this.activeByWorktree(worktreeId);
    if (!session) throw notFound("session");
    return session;
  }

  /**
   * A worktree id resolves to its worktree, as it always did. The one reserved
   * id resolves to the grove: a workspace of its own, belonging to no
   * repository, so there is somewhere to ask a question that spans all of them.
   */
  private async resolveTarget(targetId: string): Promise<SessionTarget> {
    if (targetId === GROVE_ID) {
      const cwd = this.store.groveDir;
      await mkdir(cwd, { recursive: true });
      return {
        id: targetId,
        cwd,
        label: null,
        repoId: "",
        isGrove: true,
        extraDirs: [],
        watch: [],
        brief: await this.groveBrief(),
      };
    }

    const members = circleMembers(targetId);
    if (members) return this.resolveCircle(targetId, members);

    const { repo, worktree } = await this.workspace.resolveWorktree(targetId);
    return {
      id: targetId,
      cwd: worktree.path,
      label: worktree.branch,
      repoId: repo.id,
      isGrove: false,
      extraDirs: [],
      watch: [{ worktreeId: targetId, path: worktree.path }],
      brief: null,
    };
  }

  /**
   * One dryad across several worktrees. The first is the working directory and
   * the rest are handed over as additional roots, which is what lets it read
   * the old system and write the new one in the same turn — the whole reason
   * for sharing a session rather than running two.
   */
  private async resolveCircle(targetId: string, memberIds: string[]): Promise<SessionTarget> {
    const resolved = [];
    for (const id of memberIds) {
      const found = await this.workspace.tryResolveWorktree(id);
      // A circle is defined by its members; silently dropping one would give
      // the agent a quietly different job from the one you asked for.
      if (!found) throw notFound(`worktree ${id} in this circle`);
      resolved.push(found);
    }

    const [primary, ...rest] = resolved;
    if (!primary) throw badRequest("A shared dryad needs at least two worktrees");

    const describe = resolved
      .map(({ repo, worktree }) => `- ${repo.name} / ${worktree.branch ?? "detached"}: ${worktree.path}`)
      .join("\n");

    return {
      id: targetId,
      cwd: primary.worktree.path,
      label: resolved.map(({ worktree }) => worktree.branch ?? "detached").join(" + "),
      repoId: primary.repo.id,
      isGrove: false,
      extraDirs: rest.map(({ worktree }) => worktree.path),
      watch: resolved.map(({ worktree }) => ({ worktreeId: worktree.id, path: worktree.path })),
      brief: [
        `You are working across ${resolved.length} git worktrees at once, so that what you learn in one can be carried into another.`,
        `Your working directory is ${primary.worktree.path}. These are all available to you:`,
        describe,
        "Use absolute paths when working outside the working directory. Say which worktree you are changing when you change one.",
      ].join("\n\n"),
    };
  }

  /**
   * The grove has no repository of its own, so it is told where everyone else's
   * are. Built fresh at session creation, which is also what makes a repository
   * registered mid-conversation visible to the next turn.
   */
  private async groveBrief(): Promise<string> {
    const repos = (await this.workspace.listRepos()).filter((r) => r.available);
    const lines = repos.map((r) => `- ${r.name}: ${r.path}`).join("\n");
    return [
      "You are the grove dryad in Sylva, a mission control for git worktrees.",
      "You are not working inside any one repository — your working directory is a scratch workspace of your own.",
      repos.length
        ? `These repositories are registered on this machine, and you may read across all of them:\n${lines}`
        : "No repositories are registered on this machine yet.",
      "Prefer absolute paths when reading from those repositories. Do not modify files inside them unless the user asks you to.",
    ].join("\n\n");
  }

  private async create(worktreeId: string): Promise<ActiveSession> {
    if (this.byWorktree.has(worktreeId)) {
      throw conflict("A session is already active in this worktree");
    }
    const target = await this.resolveTarget(worktreeId);
    const persisted = this.store.sessions.find((s) => s.worktreeId === worktreeId);

    const prefs = this.store.effectiveFor(worktreeId);
    const info: SessionInfo = {
      id: persisted?.id ?? freshId(),
      worktreeId,
      branch: target.label,
      status: "idle",
      settings: prefs,
      sdkSessionId: persisted?.sdkSessionId ?? null,
      totalCostUsd: persisted?.totalCostUsd ?? 0,
      totalTokens: persisted?.totalTokens ?? 0,
      queuedPrompts: [],
      createdAt: persisted?.createdAt ?? now(),
    };

    const session: ActiveSession = {
      info,
      worktreePath: target.cwd,
      repoId: target.repoId,
      isGrove: target.isGrove,
      watch: target.watch,
      input: new InputStream(),
      q: null,
      alwaysAllow: new Set(),
      pendingPermissions: new Map(),
      loopDone: null,
    };
    this.sessions.set(info.id, session);
    this.byWorktree.set(worktreeId, info.id);

    // Unset model/effort are omitted rather than sent as null, so Claude Code's
    // own defaults apply.
    const tuning = {
      ...(prefs.model ? { model: prefs.model } : {}),
      ...(prefs.effort ? { effort: prefs.effort } : {}),
      ...(info.sdkSessionId ? { resume: info.sdkSessionId } : {}),
      // Reaching beyond cwd is what makes one dryad across two worktrees work
      // at all; without it the extra roots are simply invisible to it.
      ...(target.extraDirs.length ? { additionalDirectories: target.extraDirs } : {}),
      ...(target.brief
        ? {
            systemPrompt: {
              type: "preset" as const,
              preset: "claude_code" as const,
              append: target.brief,
            },
          }
        : {}),
    };

    // Bypass mode skips every check, so there is nothing for canUseTool to ask
    // about; wiring it up anyway would imply approvals that never happen.
    const options: Options = prefs.bypassPermissions
      ? {
          cwd: target.cwd,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          ...tuning,
        }
      : {
          cwd: target.cwd,
          permissionMode: "acceptEdits",
          canUseTool: this.makeCanUseTool(session),
          ...tuning,
        };

    session.q = query({ prompt: session.input, options });
    session.loopDone = this.runLoop(session).catch(() => {});
    // A session keeps every worktree it can touch live — one for an ordinary
    // session, all of them for a circle, none for the grove.
    for (const entry of target.watch) {
      this.watchers.addSessionWatch(entry.worktreeId, entry.path);
    }
    await this.persist(session);
    return session;
  }

  private dispatch(session: ActiveSession, text: string): void {
    session.info.status = "running";
    this.appendEvent(session, { kind: "user-prompt", text, at: now() });
    session.input.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      session_id: session.info.sdkSessionId ?? "",
    } as SDKUserMessage);
    this.broadcastSession(session);
  }

  private async runLoop(session: ActiveSession): Promise<void> {
    try {
      for await (const message of session.q as AsyncIterable<SDKMessage>) {
        this.handleMessage(session, message);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      session.info.status = "errored";
      this.appendEvent(session, { kind: "error", message: msg, at: now() });
      if (/auth|login|api key|credential|billing/i.test(msg)) {
        this.availability = { available: false, reason: msg };
        this.hub.broadcast({ type: "agent.availability", availability: this.availability });
      }
      this.broadcastSession(session);
    } finally {
      // Process exited: tear down so the next prompt creates a fresh query (with resume).
      for (const pending of session.pendingPermissions.values()) {
        clearTimeout(pending.timer);
        pending.resolve("timeout");
      }
      session.pendingPermissions.clear();
      for (const entry of session.watch) this.watchers.removeSessionWatch(entry.worktreeId);
      this.sessions.delete(session.info.id);
      this.byWorktree.delete(session.info.worktreeId);
      await this.persist(session);
    }
  }

  private handleMessage(session: ActiveSession, message: SDKMessage): void {
    switch (message.type) {
      case "system": {
        if (message.subtype === "init") {
          session.info.sdkSessionId = message.session_id;
          void this.persist(session);
          this.broadcastSession(session);
        }
        break;
      }
      case "assistant": {
        for (const block of message.message.content) {
          if (block.type === "text" && block.text.trim()) {
            this.appendEvent(session, { kind: "assistant-text", text: block.text, at: now() });
          } else if (block.type === "tool_use") {
            const label = describeTool(
              block.name,
              (block.input ?? {}) as Record<string, unknown>,
              session.worktreePath,
            );
            this.appendEvent(session, {
              kind: "tool-use",
              toolUseId: block.id,
              tool: block.name,
              summary: label.summary,
              ...(label.detail && label.detail !== label.summary ? { detail: label.detail } : {}),
              at: now(),
            });
          }
        }
        break;
      }
      case "user": {
        const content = message.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (typeof block === "object" && block?.type === "tool_result") {
              const text = contentToText(block.content);
              this.appendEvent(session, {
                kind: "tool-result",
                toolUseId: block.tool_use_id,
                isError: block.is_error ?? false,
                summary: text.length > 200 ? `${text.slice(0, 197)}…` : text,
                at: now(),
              });
            }
          }
        }
        break;
      }
      case "result": {
        const isError = message.subtype !== "success";
        if (message.subtype === "success" || "total_cost_usd" in message) {
          session.info.totalCostUsd += message.total_cost_usd ?? 0;
          const usage = message.usage;
          if (usage) {
            session.info.totalTokens +=
              (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
          }
        }
        this.appendEvent(session, {
          kind: "result",
          outcome: isError ? "error" : "success",
          costUsd: "total_cost_usd" in message ? message.total_cost_usd : undefined,
          durationMs: "duration_ms" in message ? message.duration_ms : undefined,
          at: now(),
        });
        void this.persist(session);

        // Turn over: dispatch the next queued prompt or go idle.
        const nextPrompt = session.info.queuedPrompts.shift();
        if (nextPrompt) {
          this.dispatch(session, nextPrompt.text);
        } else {
          session.info.status = "idle";
          this.broadcastSession(session);
        }
        break;
      }
      default:
        break;
    }
  }

  private makeCanUseTool(session: ActiveSession): CanUseTool {
    return async (toolName, input, { suggestions, title, requestId }) => {
      if (session.alwaysAllow.has(toolName)) {
        return { behavior: "allow", updatedInput: input };
      }
      const request: PermissionRequest = {
        id: requestId,
        sessionId: session.info.id,
        worktreeId: session.info.worktreeId,
        tool: toolName,
        summary: title ?? `${toolName}: ${describeTool(toolName, input, session.worktreePath).summary}`,
        input,
        requestedAt: now(),
      };

      const answer = await new Promise<PermissionAnswer | "timeout">((resolve) => {
        const timer = setTimeout(() => {
          session.pendingPermissions.delete(requestId);
          this.hub.broadcast({ type: "permission.resolved", requestId, answer: "timeout" });
          resolve("timeout");
        }, PERMISSION_TIMEOUT_MS);
        session.pendingPermissions.set(requestId, { request, resolve, suggestions, timer });
        this.hub.broadcast({ type: "permission.request", request });
      });

      if (answer === "allow" || answer === "allow-always") {
        const updatedPermissions =
          answer === "allow-always" && suggestions?.length ? { updatedPermissions: suggestions } : {};
        return { behavior: "allow", updatedInput: input, ...updatedPermissions };
      }
      return {
        behavior: "deny",
        message:
          answer === "timeout"
            ? "Permission request timed out in Sylva"
            : "Denied by the user in Sylva",
      };
    };
  }

  private appendEvent(session: ActiveSession, event: AgentEvent): void {
    this.hub.broadcast({
      type: "agent.event",
      sessionId: session.info.id,
      worktreeId: session.info.worktreeId,
      event,
    });
    void appendFile(this.store.transcriptPath(session.info.id), `${JSON.stringify(event)}\n`, "utf8");
  }

  private broadcastSession(session: ActiveSession): void {
    this.hub.broadcast({ type: "agent.session", session: session.info });
  }

  private async persist(session: ActiveSession): Promise<void> {
    await this.store.upsertSession({
      id: session.info.id,
      worktreeId: session.info.worktreeId,
      worktreePath: session.worktreePath,
      repoId: session.repoId,
      sdkSessionId: session.info.sdkSessionId,
      totalCostUsd: session.info.totalCostUsd,
      totalTokens: session.info.totalTokens,
      createdAt: session.info.createdAt,
    });
  }

  async shutdown(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.input.end();
      if (session.q) await session.q.interrupt().catch(() => {});
    }
  }
}
