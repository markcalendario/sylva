/**
 * The Sylva mark: a conifer drawn on an 11×11 pixel grid, with one firefly
 * lit in its canopy.
 *
 * Drawn rather than set in a font, and pixel rather than smooth, because the
 * whole app is pixel art — the dryads, the forest map, the sprites. A mark that
 * anti-aliases would be the one thing on screen pretending to be from somewhere
 * else. `shapeRendering="crispEdges"` keeps the grid honest at every size.
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
