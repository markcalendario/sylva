import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** How long the tick stays up before the button goes back to offering. */
const HELD_MS = 1400;

/**
 * Put text on the clipboard, whatever the page is being served over.
 *
 * `navigator.clipboard` needs a secure context, which localhost is — but Sylva
 * is also opened at a LAN address from a second machine now and then, and there
 * the modern API simply isn't there. The old selection trick still is.
 */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied or unavailable; fall through to the copy that doesn't ask.
  }

  try {
    const holder = document.createElement("textarea");
    holder.value = text;
    // Off screen rather than hidden: a field with no layout can't be selected.
    holder.style.position = "fixed";
    holder.style.top = "-1000px";
    holder.setAttribute("readonly", "");
    document.body.appendChild(holder);
    holder.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(holder);
    return ok;
  } catch {
    return false;
  }
}

/**
 * A copy control, everywhere anything is worth copying.
 *
 * It says what it did rather than firing a toast: the tick is where your eyes
 * already are, and a notification for something this small is noise. Failure
 * has to be visible too — a button that silently does nothing is worse than no
 * button, because you paste the wrong thing believing it worked.
 */
export function CopyButton({
  text,
  className = "",
  tip = "Copy to the clipboard",
  label,
}: {
  text: string;
  className?: string;
  tip?: string;
  /** Shown beside the icon. Omitted, the button is the icon alone. */
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = async (e: React.MouseEvent) => {
    // Bubbling would open the file, jump the transcript, or whatever else the
    // row this sits in does when clicked.
    e.stopPropagation();
    e.preventDefault();
    const ok = await writeClipboard(text);
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), HELD_MS);
  };

  return (
    <button
      type="button"
      className={`copy-btn ${state === "copied" ? "copy-btn-done" : ""} ${
        state === "failed" ? "copy-btn-failed" : ""
      } ${className}`}
      onClick={(e) => void copy(e)}
      aria-label={label ? undefined : state === "copied" ? "Copied" : "Copy"}
      data-tip={state === "failed" ? "Your browser wouldn't let Sylva reach the clipboard" : tip}
    >
      {state === "copied" ? <Check size={12} /> : <Copy size={12} />}
      {label && <span>{state === "copied" ? "Copied" : state === "failed" ? "Blocked" : label}</span>}
    </button>
  );
}
