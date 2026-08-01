import { appendFile, readFile } from "node:fs/promises";
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
import type {
  AgentAvailability,
  AgentEvent,
  PermissionAnswer,
  PermissionRequest,
  QueuedPrompt,
  SessionInfo,
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

interface ActiveSession {
  info: SessionInfo;
  worktreePath: string;
  repoId: string;
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

  private async create(worktreeId: string): Promise<ActiveSession> {
    if (this.byWorktree.has(worktreeId)) {
      throw conflict("A session is already active in this worktree");
    }
    const { repo, worktree } = await this.workspace.resolveWorktree(worktreeId);
    const persisted = this.store.sessions.find((s) => s.worktreeId === worktreeId);

    const info: SessionInfo = {
      id: persisted?.id ?? freshId(),
      worktreeId,
      status: "idle",
      sdkSessionId: persisted?.sdkSessionId ?? null,
      totalCostUsd: persisted?.totalCostUsd ?? 0,
      totalTokens: persisted?.totalTokens ?? 0,
      queuedPrompts: [],
      createdAt: persisted?.createdAt ?? now(),
    };

    const session: ActiveSession = {
      info,
      worktreePath: worktree.path,
      repoId: repo.id,
      input: new InputStream(),
      q: null,
      alwaysAllow: new Set(),
      pendingPermissions: new Map(),
      loopDone: null,
    };
    this.sessions.set(info.id, session);
    this.byWorktree.set(worktreeId, info.id);

    const options: Options = {
      cwd: worktree.path,
      permissionMode: "acceptEdits",
      canUseTool: this.makeCanUseTool(session),
      ...(info.sdkSessionId ? { resume: info.sdkSessionId } : {}),
    };

    session.q = query({ prompt: session.input, options });
    session.loopDone = this.runLoop(session).catch(() => {});
    this.watchers.addSessionWatch(worktreeId, worktree.path);
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
      this.watchers.removeSessionWatch(session.info.worktreeId);
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
