import { useCallback, useEffect, useRef } from "react";

/** Long enough not to fire on a normal click, short enough not to feel stuck. */
const HOLD_MS = 450;
/** Moving further than this is a scroll, not a hold. */
const SLOP = 8;

/**
 * Press and hold. Used where an ordinary click already means something — a
 * worktree row opens it — so holding is how you say you meant the other thing.
 *
 * The click that follows a completed hold is swallowed, or letting go would
 * immediately do the very thing you held down to avoid.
 */
export function useLongPress(onLongPress: () => void) {
  const timer = useRef(0);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    window.clearTimeout(timer.current);
    origin.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  return {
    onPointerDown: (e: React.PointerEvent) => {
      // Only a primary press; a right-click is somebody else's gesture.
      if (e.button !== 0) return;
      fired.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        fired.current = true;
        origin.current = null;
        onLongPress();
      }, HOLD_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const from = origin.current;
      if (!from) return;
      if (Math.abs(e.clientX - from.x) > SLOP || Math.abs(e.clientY - from.y) > SLOP) cancel();
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onClickCapture: (e: React.MouseEvent) => {
      if (!fired.current) return;
      // The hold already did the work; don't also do the click's job.
      e.preventDefault();
      e.stopPropagation();
      fired.current = false;
    },
    onContextMenu: (e: React.MouseEvent) => {
      // Touch devices raise a context menu on hold; it isn't wanted here.
      if (fired.current) e.preventDefault();
    },
  };
}
