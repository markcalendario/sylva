import type { Theme } from "./theme";

/**
 * The nouns Sylva uses for itself.
 *
 * The forest theme calls a session a dryad and the whole-workspace view a
 * forest, because there is a wood on screen to back that up. A theme with no
 * wood in it cannot use those words: a tooltip promising a dryad, beside a grey
 * ring that is plainly not one, is worse than plain English would have been.
 *
 * So the vocabulary is a theme's, the same way the palette is — one table read
 * through a hook, rather than twenty components each deciding for themselves
 * what to call the thing they are showing.
 */
export interface Words {
  /** One agent, mid-sentence: "the {agent} is working". */
  agent: string;
  /** More than one: "{count} {agents} are waiting". */
  agents: string;
  /** Belonging to all of them: "search the {agentsPossessive} memory". */
  agentsPossessive: string;
  /** The everything-at-once view. Title case; it is a destination's label. */
  workspace: string;
  /** The session that belongs to no worktree. Title case, as above. */
  grove: string;
  /** What the looping background sound is called. */
  ambience: string;
}

/** Every theme's nouns. Exported so a test can hold them to the theme's promise. */
export const VOCAB: Record<Theme, Words> = {
  forest: {
    agent: "dryad",
    agents: "dryads",
    agentsPossessive: "dryads'",
    workspace: "Forest",
    grove: "Grove",
    ambience: "forest ambience",
  },
  professional: {
    agent: "agent",
    agents: "agents",
    agentsPossessive: "agents'",
    workspace: "Workspace",
    grove: "Assistant",
    ambience: "ambience",
  },
};
