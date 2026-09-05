import { CommandsService } from "./services/commands.js";
import { CommitMessageService } from "./services/commitMessage.js";
import { GitService } from "./services/git.js";
import { GitOps } from "./services/gitOps.js";
import { TerminalService } from "./services/terminals.js";
import { SessionManager } from "./services/sessions.js";
import { Store } from "./services/store.js";
import { UsageService } from "./services/usage.js";
import { WatcherManager } from "./services/watcher.js";
import { Workspace } from "./services/workspace.js";
import { WsHub } from "./ws/hub.js";

/** Shared service container passed to all route modules. */
export interface AppContext {
  store: Store;
  git: GitService;
  hub: WsHub;
  workspace: Workspace;
  gitOps: GitOps;
  watchers: WatcherManager;
  sessions: SessionManager;
  commitMessages: CommitMessageService;
  commands: CommandsService;
  terminals: TerminalService;
  usage: UsageService;
}

export async function createContext(baseDir?: string): Promise<AppContext> {
  const store = new Store(baseDir);
  await store.init();
  const git = new GitService();
  const hub = new WsHub();
  const workspace = new Workspace(store, git);
  const gitOps = new GitOps(git, workspace);
  const watchers = new WatcherManager(hub, gitOps);

  workspace.onFocusChange = (worktreeId) => {
    // Announce every focus change here, whatever caused it — an explicit
    // switch, a quick-start, or the focused worktree being removed.
    hub.broadcast({ type: "focus.changed", worktreeId });
  };

  // What the panes hold is what gets watched. Focus is one of those worktrees,
  // but it is no longer the only one, so watching follows the set instead.
  workspace.onOpenChange = (entries) => watchers.setWatched(entries);

  const sessions = new SessionManager(store, workspace, watchers, hub);
  const commitMessages = new CommitMessageService(git, workspace, store);
  const terminals = new TerminalService(store, workspace, hub);
  // The socket carries keystrokes as well as events; terminals are the only
  // thing a client ever sends up it.
  hub.onClientEvent = (event) => terminals.handleClientEvent(event);

  // Plan limits belong to the login, not to any worktree, so one reader serves
  // the whole app — and it borrows a running agent's process when there is one
  // rather than starting its own.
  const usage = new UsageService();
  usage.borrowQuery = () => sessions.anyLiveQuery();

  // What `/` offers is a property of the directory, so this asks the session
  // that runs there — borrowing its process when a turn already has one up.
  const commands = new CommandsService(
    (targetId) => sessions.cwdFor(targetId),
    (targetId) => sessions.liveQueryFor(targetId),
  );

  return {
    store,
    git,
    hub,
    workspace,
    gitOps,
    watchers,
    sessions,
    commitMessages,
    commands,
    terminals,
    usage,
  };
}
