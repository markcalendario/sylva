const STORAGE_KEY = "sylva.text-scale";

export const MIN_SCALE = 0.8;
export const MAX_SCALE = 1.5;
export const STEP = 0.05;
export const DEFAULT_SCALE = 1;

function clamp(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value * 100) / 100));
}

export function loadScale(): number {
  const raw = localStorage.getItem(STORAGE_KEY);
  const parsed = raw === null ? NaN : Number(raw);
  return Number.isFinite(parsed) ? clamp(parsed) : DEFAULT_SCALE;
}

/** Applied to :root so every --text-* token recomputes. */
export function applyScale(scale: number): number {
  const next = clamp(scale);
  document.documentElement.style.setProperty("--text-scale", String(next));
  localStorage.setItem(STORAGE_KEY, String(next));
  return next;
}

/** Called before React mounts so text never flashes at the wrong size. */
export function initTextScale(): void {
  document.documentElement.style.setProperty("--text-scale", String(loadScale()));
}
