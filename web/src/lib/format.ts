/**
 * Token counts, short enough for a one-line strip.
 *
 * Exact numbers belong in a tooltip: at a glance the only questions are the
 * order of magnitude and whether it is still climbing.
 */
export function compactTokens(n: number): string {
  if (n < 1000) return `${n} tokens`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k tokens`;
  return `${(n / 1_000_000).toFixed(1)}M tokens`;
}
