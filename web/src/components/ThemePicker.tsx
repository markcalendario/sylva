import { applyTheme, THEME_LABEL, THEME_TIP, THEMES, useTheme } from "../lib/theme";

/**
 * Picking a theme, in Settings.
 *
 * It used to be a pill floating in the bottom-right corner of every screen — a
 * control you pass a hundred times and touch twice, taking up a permanent seat
 * in the one corner the status strip already wanted. Appearance is where
 * someone looks for it, and Settings is where appearance lives.
 *
 * Both themes are listed rather than toggled, so the control says what you can
 * have as well as what you are in — a toggle labelled with the *other* theme
 * has to be read twice before you know which one you're looking at.
 */
export function ThemePicker() {
  const theme = useTheme();

  return (
    <div className="seg" role="group" aria-label="Theme">
      {THEMES.map((option) => (
        <button
          key={option}
          type="button"
          className={theme === option ? "seg-on" : ""}
          onClick={() => applyTheme(option)}
          aria-pressed={theme === option}
          data-tip={THEME_TIP[option]}
        >
          {THEME_LABEL[option]}
        </button>
      ))}
    </div>
  );
}
