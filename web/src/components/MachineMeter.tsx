import type { MachineLoad } from "sylva-shared";
import { useMachineLoad } from "../lib/queries";

/** Where a number stops being background information and starts being news. */
const WARN_AT = 75;
const DANGER_AT = 90;

/**
 * What the laptop is doing, in two numbers.
 *
 * Sylva spends its day starting processes on your behalf — agents, dev servers,
 * a terminal per worktree — and it is the only window that knows how many of
 * them are running. So when a turn crawls, the question "is Claude thinking or
 * is my machine full" gets answered here rather than in Activity Monitor.
 *
 * Deliberately plain: no bars. The plan window next door already spends one,
 * and three bars in a row would turn a status strip into a dashboard. These sit
 * grey until one of them is the reason your afternoon is slow, and go amber and
 * then red when it is.
 */
export function MachineMeter() {
  const load = useMachineLoad();
  const data = load.data;
  if (!data) return null;

  const ram = data.memoryTotal > 0 ? (data.memoryUsed / data.memoryTotal) * 100 : null;
  if (data.cpu === null && ram === null) return null;

  return (
    <span className="machine" role="status">
      {data.cpu !== null && (
        <span className={`machine-stat machine-${tone(data.cpu)}`} data-tip={cpuTip(data)}>
          <span className="machine-label">cpu</span>
          <span className="tabular">{Math.round(data.cpu)}%</span>
        </span>
      )}
      {ram !== null && (
        <span className={`machine-stat machine-${tone(ram)}`} data-tip={ramTip(data, ram)}>
          <span className="machine-label">ram</span>
          <span className="tabular">{Math.round(ram)}%</span>
        </span>
      )}
    </span>
  );
}

function tone(percent: number): string {
  return percent >= DANGER_AT ? "danger" : percent >= WARN_AT ? "warn" : "calm";
}

/**
 * The percentage is across every core, which is the only reading that means
 * anything on a strip — but it is also why a single pegged core looks calm, so
 * the tooltip says how many cores it was averaged over.
 */
function cpuTip(load: MachineLoad): string {
  const busy = Math.round(load.cpu ?? 0);
  return `${busy}% of this machine's ${load.cores} cores are busy — everything running, not just Sylva`;
}

function ramTip(load: MachineLoad, percent: number): string {
  return (
    `${gib(load.memoryUsed)} of ${gib(load.memoryTotal)} memory in use (${Math.round(percent)}%)\n` +
    `Counted the way your system monitor counts it — cache the machine would give back doesn't show as used`
  );
}

function gib(bytes: number): string {
  const value = bytes / 1024 ** 3;
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} GB`;
}
