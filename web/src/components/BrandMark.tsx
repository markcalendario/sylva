import { useHasForest } from "../lib/theme";

/**
 * The Sylva mark: a conifer drawn on an 11×11 pixel grid, with one firefly
 * lit in its canopy.
 *
 * Drawn rather than set in a font, and pixel rather than smooth, because the
 * whole app is pixel art — the dryads, the forest map, the sprites. A mark that
 * anti-aliases would be the one thing on screen pretending to be from somewhere
 * else. `shapeRendering="crispEdges"` keeps the grid honest at every size.
 *
 * Except in a theme with no forest, where the same reasoning runs the other
 * way: a pixel conifer beside Inter and a grey palette would be the one thing
 * on screen from somewhere else. That theme gets PanelMark below.
 */

/** One canopy row: y, first x, width. */
const CANOPY: [number, number, number][] = [
  [0, 5, 1],
  [1, 4, 3],
  [2, 3, 5],
  [3, 4, 3],
  [4, 3, 5],
  [5, 2, 7],
  [6, 4, 3],
  [7, 3, 5],
  [8, 2, 7],
];

export function BrandMark({ size = 20 }: { size?: number }) {
  const hasForest = useHasForest();
  if (!hasForest) return <PanelMark size={size} />;

  return (
    <svg
      className="brandmark"
      width={size}
      height={size}
      viewBox="0 0 11 11"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {CANOPY.map(([y, x, width]) => (
        <rect
          key={y}
          x={x}
          y={y}
          width={width}
          height={1}
          // Alternate rows sit a shade back, which is what gives a flat
          // silhouette its depth at eleven pixels tall.
          className={y % 2 === 0 ? "brandmark-canopy" : "brandmark-canopy-dark"}
        />
      ))}
      <rect x={5} y={9} width={1} height={2} className="brandmark-trunk" />
      {/* The firefly. One lit pixel is the whole animation. */}
      <rect x={7} y={4} width={1} height={1} className="brandmark-firefly" />
    </svg>
  );
}

/**
 * The mark for a theme with no forest: two panes and a divider, which is what
 * Sylva actually puts on your screen once the metaphor is gone. Stroked in
 * currentColor so it takes the wordmark's own weight rather than carrying a
 * palette of its own, and smooth, because nothing around it is a grid any more.
 */
function PanelMark({ size }: { size: number }) {
  return (
    <svg
      className="brandmark"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1.7" y="2.7" width="12.6" height="10.6" rx="1.6" />
      <path d="M6.4 2.7v10.6" />
    </svg>
  );
}
