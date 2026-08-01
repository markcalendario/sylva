import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * One shared tooltip for the whole app, driven by `data-tip="…"` on any
 * element. A single floating node beats a wrapper component per control: it
 * costs one listener instead of hundreds of hover states, and annotating a
 * button stays a one-attribute edit.
 *
 * Native `title` was the alternative and loses on every count — a ~1s delay you
 * can't tune, OS chrome that ignores the theme, and no way to show it on
 * keyboard focus.
 */

/** Dwell before a hovered tip appears — long enough not to flicker while you cross the UI. */
const SHOW_DELAY = 320;
/** Gap between anchor and tip, and the minimum breathing room at the viewport edge. */
const GAP = 8;
const EDGE = 8;
const TOOLTIP_ID = "sylva-tooltip";

/** Popovers join the top layer, so tips clear open <dialog>s instead of hiding behind them. */
const SUPPORTS_POPOVER =
  typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype;

interface Tip {
  text: string;
  /** The anchor's box, captured when the tip opened. */
  rect: DOMRect;
}

function tipAnchor(node: unknown): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  const el = node.closest<HTMLElement>("[data-tip]");
  return el?.dataset.tip ? el : null;
}

export function TooltipLayer() {
  const ref = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const timer = useRef(0);
  const shown = useRef(false);
  const [tip, setTip] = useState<Tip | null>(null);

  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    anchor.current?.removeAttribute("aria-describedby");
    anchor.current = null;
    setTip(null);
  }, []);

  useEffect(() => {
    const open = (el: HTMLElement, instant: boolean) => {
      if (el === anchor.current) return;
      // Moving between annotated controls shouldn't re-serve the delay.
      const warm = shown.current;
      close();
      anchor.current = el;

      const reveal = () => {
        // React may have unmounted or recycled the anchor while we waited.
        if (anchor.current !== el || !el.isConnected) return;
        el.setAttribute("aria-describedby", TOOLTIP_ID);
        setTip({ text: el.dataset.tip ?? "", rect: el.getBoundingClientRect() });
      };

      if (instant || warm) reveal();
      else timer.current = window.setTimeout(reveal, SHOW_DELAY);
    };

    let frame = 0;
    const onMove = (e: PointerEvent) => {
      // Touch has no hover; a tip would just fight the tap.
      if (e.pointerType === "touch" || frame) return;
      const { clientX, clientY } = e;
      frame = requestAnimationFrame(() => {
        frame = 0;
        // Hit-testing rather than event delegation: disabled buttons swallow
        // pointer events, and "why is this greyed out?" is exactly the tip
        // worth reading. elementFromPoint still reports them.
        const el = tipAnchor(document.elementFromPoint(clientX, clientY));
        if (el) open(el, false);
        else if (anchor.current) close();
      });
    };

    const onFocusIn = (e: FocusEvent) => {
      const el = tipAnchor(e.target);
      // Keyboard focus only — you just clicked it, you know what it does.
      if (el?.matches(":focus-visible")) open(el, true);
      else if (anchor.current) close();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };

    // Scrolling moves the anchor, so the captured rect goes stale. Closing on
    // every scroll would be wrong here: the transcript auto-scrolls itself
    // while an agent streams, which would yank the tip away mid-read. Re-glue
    // it to the anchor instead, and only give up once the anchor is gone.
    let reflowFrame = 0;
    const reflow = () => {
      const el = anchor.current;
      if (!el || !shown.current || reflowFrame) return;
      reflowFrame = requestAnimationFrame(() => {
        reflowFrame = 0;
        if (!anchor.current || !anchor.current.isConnected) return close();
        const rect = anchor.current.getBoundingClientRect();
        setTip((prev) => (prev ? { ...prev, rect } : prev));
      });
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", close);
    document.addEventListener("keydown", onKeyDown, true);
    // Capture, so nested scroll containers report too — scroll doesn't bubble.
    document.addEventListener("scroll", reflow, { capture: true, passive: true });
    window.addEventListener("blur", close);
    window.addEventListener("resize", reflow, { passive: true });

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(reflowFrame);
      window.clearTimeout(timer.current);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", close);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", reflow, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", reflow);
    };
  }, [close]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (!tip) {
      // hidePopover() throws if it was never shown, and doesn't exist at all on
      // the CSS-only fallback path.
      if (shown.current && SUPPORTS_POPOVER) el.hidePopover();
      shown.current = false;
      return;
    }

    // Show before measuring so the node has layout; both happen before paint.
    if (SUPPORTS_POPOVER && !shown.current) el.showPopover();
    shown.current = true;

    const box = el.getBoundingClientRect();
    const above = tip.rect.top - box.height - GAP >= EDGE;
    const top = above ? tip.rect.top - box.height - GAP : tip.rect.bottom + GAP;
    const centred = tip.rect.left + tip.rect.width / 2 - box.width / 2;
    const left = Math.min(
      Math.max(EDGE, centred),
      Math.max(EDGE, window.innerWidth - box.width - EDGE),
    );

    el.style.top = `${Math.round(top)}px`;
    el.style.left = `${Math.round(left)}px`;
    el.dataset.placement = above ? "top" : "bottom";

    // Keep the caret under the anchor even when the tip is clamped to an edge.
    const caret = tip.rect.left + tip.rect.width / 2 - left;
    const clamped = Math.min(Math.max(10, caret), Math.max(10, box.width - 10));
    el.style.setProperty("--tip-arrow", `${Math.round(clamped)}px`);
  }, [tip]);

  return (
    <div
      ref={ref}
      id={TOOLTIP_ID}
      className="tooltip"
      role="tooltip"
      {...(SUPPORTS_POPOVER ? { popover: "manual" as const } : {})}
      {...(tip ? { "data-open": "" } : {})}
    >
      {tip?.text}
    </div>
  );
}
