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
    if (!worktreeId) {
      watchers.setFocused(null, null);
      return;
    }
    void workspace.tryResolveWorktree(worktreeId).then((resolved) => {
      watchers.setFocused(worktreeId, resolved?.worktree.path ?? null);
    });
  };

  const sessions = new SessionManager(store, workspace, watchers, hub);
  return { store, git, hub, workspace, gitOps, watchers, sessions };
}
