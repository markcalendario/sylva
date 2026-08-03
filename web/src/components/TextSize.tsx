import { useState } from "react";
import {
  applyScale,
  DEFAULT_SCALE,
  loadScale,
  MAX_SCALE,
  MIN_SCALE,
  STEP,
} from "../lib/textScale";
import { restyleTerminals } from "../lib/terminals";

/** Text size stepper. Persists across reloads; click the percentage to reset. */
export function TextSize() {
  const [scale, setScale] = useState(loadScale);

  const set = (next: number) => {
    setScale(applyScale(next));
    // Terminals size themselves in a canvas, outside CSS: they only learn the
    // text scale moved if they are told.
    restyleTerminals();
  };

  return (
    <div className="textsize" role="group" aria-label="Text size">
      <button
        className="textsize-btn"
        onClick={() => set(scale - STEP)}
        disabled={scale <= MIN_SCALE}
        aria-label="Smaller text"
        data-tip="Shrink every piece of text in Sylva"
      >
        A
      </button>
      <button
        className="textsize-value"
        onClick={() => set(DEFAULT_SCALE)}
        data-tip="Current text scale — click to reset to 100%"
      >
        {Math.round(scale * 100)}%
      </button>
      <button
        className="textsize-btn textsize-btn-lg"
        onClick={() => set(scale + STEP)}
        disabled={scale >= MAX_SCALE}
        aria-label="Larger text"
        data-tip="Enlarge every piece of text in Sylva"
      >
        A
      </button>
    </div>
  );
}
