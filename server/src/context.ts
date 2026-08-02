import { CommitMessageService } from "./services/commitMessage.js";
import { GitService } from "./services/git.js";
import { GitOps } from "./services/gitOps.js";
import { SessionManager } from "./services/sessions.js";
import { Store } from "./services/store.js";
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
  return { store, git, hub, workspace, gitOps, watchers, sessions, commitMessages };
}
