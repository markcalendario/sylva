import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

const GAP = 8;
const EDGE = 8;
const SHOW_DELAY = 220;

/** Popovers join the top layer, so cards clear open <dialog>s. */
const SUPPORTS_POPOVER =
  typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype;

/**
 * A tooltip that can hold structure.
 *
 * The shared `data-tip` layer takes a string and nothing else, which is right
 * for "what does this button do" and useless for a commit — where the whole
 * point is a heading, a body, two identities and a stat line, laid out.
 * Same positioning behaviour: flips above when there's no room below, clamps
 * to the viewport, and opens on keyboard focus as well as hover.
 */
export function HoverCard({
  card,
  children,
  className,
  placement = "below",
}: {
  card: ReactNode;
  children: ReactNode;
  className?: string;
  /**
   * Where the card prefers to sit. "below" suits a button — the card appears
   * under the thing you pointed at. "beside" suits a list: rows are full-width
   * and stacked, so a card below one covers the next three, while the space to
   * the right of the list is empty.
   */
  placement?: "below" | "beside";
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const shown = useRef(false);
  const [open, setOpen] = useState(false);

  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), SHOW_DELAY);
  };

  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };

  useLayoutEffect(() => {
    const el = cardRef.current;
    const anchor = anchorRef.current;
    if (!el) return;

    if (!open || !anchor) {
      // hidePopover() throws if it was never shown.
      if (shown.current && SUPPORTS_POPOVER) el.hidePopover();
      shown.current = false;
      return;
    }

    // Show before measuring so the node has layout; both happen before paint.
    if (SUPPORTS_POPOVER && !shown.current) el.showPopover();
    shown.current = true;

    const rect = anchor.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const clamp = (value: number, extent: number, limit: number) =>
      Math.min(Math.max(EDGE, value), Math.max(EDGE, limit - extent - EDGE));

    let top: number;
    let left: number;
    if (placement === "beside") {
      // Right of the anchor, flipping to its left only when there is no room —
      // and vertically aligned with the row, clamped so a card taller than the
      // space below it rides up rather than running off the bottom.
      const fitsRight = rect.right + GAP + box.width <= window.innerWidth - EDGE;
      left = fitsRight ? rect.right + GAP : Math.max(EDGE, rect.left - box.width - GAP);
      top = clamp(rect.top, box.height, window.innerHeight);
    } else {
      const below = rect.bottom + GAP + box.height <= window.innerHeight - EDGE;
      top = below ? rect.bottom + GAP : Math.max(EDGE, rect.top - box.height - GAP);
      left = clamp(rect.left, box.width, window.innerWidth);
    }

    el.style.top = `${Math.round(top)}px`;
    el.style.left = `${Math.round(left)}px`;
  }, [open, placement]);

  return (
    <div
      ref={anchorRef}
      className={className}
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={() => setOpen(true)}
      onBlur={hide}
    >
      {children}
      <div
        ref={cardRef}
        className="hovercard"
        role="tooltip"
        {...(SUPPORTS_POPOVER ? { popover: "manual" as const } : {})}
        {...(open ? { "data-open": "" } : {})}
      >
        {open && card}
      </div>
    </div>
  );
}
