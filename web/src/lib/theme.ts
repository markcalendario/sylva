import { useSyncExternalStore } from "react";
import { setSoundVoice } from "./audio";
import { restyleTerminals } from "./terminals";
import { VOCAB, type Words } from "./words";

const STORAGE_KEY = "sylva.theme";

/**
 * The two looks Sylva comes in.
 *
 * "forest" is the app as it was drawn: a night wood, amber light, pixel dryads
 * standing in a clearing. "professional" is the same app with the colour and
 * the characters taken out — greys, Inter, and a table where the map was. It
 * exists for the screen someone else is looking at.
 */
export type Theme = "forest" | "professional";

/* The default first: the picker is also a list of what you can have, and the
   one you already have belongs at the front of it. */
export const THEMES: readonly Theme[] = ["professional", "forest"];

export const DEFAULT_THEME: Theme = "professional";

/**
 * The theme the stylesheet is *written* in.
 *
 * tokens.css declares the forest on bare `:root`, and professional.css restates
 * the same names under [data-theme="professional"] — so the forest is the one
 * theme that carries no attribute. That is a fact about the CSS, not about
 * which theme Sylva starts in, and the two stopped being the same answer the
 * moment professional became the default. Kept apart deliberately: folded back
 * together, "the default" would quietly mean "no attribute", and picking the
 * default would hand you the forest.
 */
const UNMARKED_THEME: Theme = "forest";

/** What each theme is called, and what picking it does. */
export const THEME_LABEL: Record<Theme, string> = {
  forest: "Forest",
  professional: "Professional",
};

export const THEME_TIP: Record<Theme, string> = {
  forest: "The night wood — amber light, pixel dryads, the clearing map",
  professional:
    "Black and white, Inter, no forest — for a screen others can see. Where Sylva starts",
};

export function isTheme(value: unknown): value is Theme {
  return value === "forest" || value === "professional";
}

export function loadTheme(): Theme {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private windows and blocked site data both throw here. A theme is a
    // preference, not a fact worth failing a page load over.
  }
  return isTheme(raw) ? raw : DEFAULT_THEME;
}

/** The other one. There are two, so a switcher is a toggle rather than a menu. */
export function nextTheme(theme: Theme): Theme {
  return theme === "forest" ? "professional" : "forest";
}

/*
 * Subscribers. The theme is not in the zustand store on purpose: it is applied
 * to <html> before React exists, so React has to *read* it rather than own it,
 * and useSyncExternalStore over these two lines is the whole of that.
 */
let current: Theme = DEFAULT_THEME;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Put a theme on the document, remember it, and tell everyone.
 *
 * The forest is the bare `:root`, so it carries no attribute — which also means
 * a stylesheet that fails to load leaves the app in the theme it was drawn in
 * rather than in a half-applied other one.
 */
export function applyTheme(theme: Theme): Theme {
  current = theme;
  const root = document.documentElement;
  if (theme === UNMARKED_THEME) root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);

  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // As above: worth doing, not worth throwing over.
  }

  // Terminals paint into a canvas from a palette they were handed once, so a
  // theme reaches them only if it goes and tells them — the same reason the
  // text-size control has to. Sound is the same problem again: a forest at
  // night, and a chiptune blip when a turn lands, under a theme with no forest
  // in it is a soundtrack to a different app.
  restyleTerminals();
  setSoundVoice(theme === "forest" ? "forest" : "studio");

  for (const listener of listeners) listener();
  return theme;
}

/** Called before React mounts, so the app never flashes the wrong theme. */
export function initTheme(): Theme {
  return applyTheme(loadTheme());
}

/** The theme, in a component. Re-renders when it changes. */
export function useTheme(): Theme {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULT_THEME,
  );
}

/**
 * Whether the forest is part of this theme.
 *
 * Read as a question about the *theme* rather than about a component, because
 * six unrelated places ask it — the map, the landing scene, the dryad sprites,
 * the wordmark, the header's first destination — and each one answering it for
 * itself is how a second theme turns into a second app.
 */
export function useHasForest(): boolean {
  return useTheme() === "forest";
}

/**
 * The current theme's nouns — dryad or agent, Forest or Workspace.
 *
 * Beside useHasForest rather than in words.ts, so the vocabulary table itself
 * stays a plain object no component or test has to boot the app to read.
 */
export function useWords(): Words {
  return VOCAB[useTheme()];
}
