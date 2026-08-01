import { GitService } from "./services/git.js";
import { Store } from "./services/store.js";
import { WsHub } from "./ws/hub.js";

/** Shared service container passed to all route modules. */
export interface AppContext {
  store: Store;
  git: GitService;
  hub: WsHub;
}

export async function createContext(baseDir?: string): Promise<AppContext> {
  const store = new Store(baseDir);
  await store.init();
  return {
    store,
    git: new GitService(),
    hub: new WsHub(),
  };
}
