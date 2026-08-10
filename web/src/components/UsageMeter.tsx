import type { PlanUsage, UsageWindow } from "sylva-shared";
import { usePlanUsage } from "../lib/queries";

/** Where a window stops being background information and starts being news. */
const WARN_AT = 75;
const DANGER_AT = 90;

/**
 * How much of the week's Claude allowance is gone.
 *
 * Sylva used to show what a session had cost in dollars. On a subscription that
 * figure is trivia — nothing bills against it, and nobody has ever changed what
 * they were doing because a turn cost eleven cents. What actually stops the
 * work is the weekly window running out, usually on a Thursday afternoon with
 * no warning, so that is the number the status strip carries instead.
 *
 * The five-hour window is real too, but it refills by dinner; it lives in the
 * tooltip, where it can be read by anyone who has just been cut off and wants
 * to know how long for.
 */
export function UsageMeter() {
  const usage = usePlanUsage();
  const data = usage.data;

  // Nothing to say on an API key, a Bedrock login, or before the first read.
  if (!data || !data.available || !data.sevenDay) return null;

  const pct = data.sevenDay.utilization;
  if (pct === null) return null;

  const tone = pct >= DANGER_AT ? "danger" : pct >= WARN_AT ? "warn" : "calm";
  const filled = Math.max(0, Math.min(100, pct));

  return (
    <span className={`usage usage-${tone}`} data-tip={describe(data)} role="status">
      <span className="usage-bar" aria-hidden>
        <span className="usage-fill" style={{ width: `${filled}%` }} />
      </span>
      <span className="usage-pct tabular">{Math.round(pct)}%</span>
      <span className="usage-unit">wk</span>
    </span>
  );
}

/** The whole picture, for the tooltip: both windows, and when each refills. */
function describe(usage: PlanUsage): string {
  const lines: string[] = [];
  const plan = usage.subscription ? `Claude ${usage.subscription}` : "Your Claude plan";
  lines.push(`${plan} — how much of each limit is spent`);

  const week = line("This week", usage.sevenDay);
  if (week) lines.push(week);
  const hours = line("Past 5 hours", usage.fiveHour);
  if (hours) lines.push(hours);

  for (const model of usage.models) {
    const detail = line(model.name, { utilization: model.utilization, resetsAt: model.resetsAt });
    if (detail) lines.push(detail);
  }

  return lines.join("\n");
}

function line(label: string, window: UsageWindow | null): string | null {
  if (!window || window.utilization === null) return null;
  return `${label}: ${Math.round(window.utilization)}% used${resets(window.resetsAt)}`;
}

/**
 * When a window refills, said the way a person would.
 *
 * "Resets Thu 09:00" is what you want when it's days away; "resets in 40m" is
 * what you want when you are waiting for it, and the two are never both right.
 */
function resets(at: string | null): string {
  if (!at) return "";
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return "";

  const minutes = Math.round((when.getTime() - Date.now()) / 60_000);
  if (minutes <= 0) return " · resetting now";
  if (minutes < 60) return ` · resets in ${minutes}m`;
  if (minutes < 60 * 12) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return ` · resets in ${hours}h${rest ? ` ${rest}m` : ""}`;
  }
  return ` · resets ${when.toLocaleString([], {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}
