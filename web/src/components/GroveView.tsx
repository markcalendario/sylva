import { GROVE_ID } from "sylva-shared";
import { useRepos } from "../lib/queries";
import { useWords } from "../lib/theme";
import { Sprite } from "../sprites/Sprite";
import { spriteStateFor, useSylva } from "../state/store";
import { AgentPanel } from "./AgentPanel";

/**
 * The dryad that belongs to no worktree.
 *
 * Every other conversation starts by picking a worktree, which leaves nowhere
 * to ask the questions that span all of them — "which of these two handles auth
 * better", "what did I call that helper". This is that somewhere.
 */
export function GroveView() {
  const words = useWords();
  const repos = useRepos();
  const spriteState = useSylva((s) => spriteStateFor(s, GROVE_ID));
  const available = (repos.data ?? []).filter((r) => r.available);

  return (
    <div className="pane grove-pane">
      <div className="wt-header">
        <Sprite state={spriteState} scale={2} />
        <div className="wt-header-text">
          <div className="wt-header-branch" data-tip="An agent that belongs to no worktree">
            the {words.grove.toLowerCase()}
          </div>
          <div className="wt-header-sub">
            <span
              className="grove-scope"
              data-tip={
                available.length
                  ? available.map((r) => r.path).join("\n")
                  : `Register a repository and the ${words.grove.toLowerCase()} will be able to read it`
              }
            >
              {available.length === 0
                ? "no repositories registered yet"
                : available.length === 1
                  ? "can read 1 repository"
                  : `can read ${available.length} repositories`}
            </span>
            <span
              className="wt-header-state"
              data-tip={`The ${words.grove.toLowerCase()} works in a scratch folder of its own`}
            >
              works outside your repos
            </span>
          </div>
        </div>
      </div>

      <AgentPanel worktreeId={GROVE_ID} />
    </div>
  );
}
