import { useMemo } from "react";
import "./sprite.css";

const cache = new Map<string, string>();

/**
 * Render a list of pixel frames into one horizontal sprite sheet as a data URI.
 * Frames are arrays of strings; each character indexes the palette.
 */
export function renderSheet(
  key: string,
  frames: string[][],
  palette: Record<string, string>,
  width: number,
  height: number,
): string {
  const cached = cache.get(key);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = width * frames.length;
  canvas.height = height;
  const cx = canvas.getContext("2d");
  if (!cx) return "";

  frames.forEach((rows, f) => {
    for (let y = 0; y < height; y++) {
      const row = rows[y] ?? "";
      for (let x = 0; x < width; x++) {
        const colour = palette[row[x] ?? "."];
        if (!colour || colour === "transparent") continue;
        cx.fillStyle = colour;
        cx.fillRect(f * width + x, y, 1, 1);
      }
    }
  });

  const uri = canvas.toDataURL("image/png");
  cache.set(key, uri);
  return uri;
}

interface PixelArtProps {
  cacheKey: string;
  frames: string[][];
  palette: Record<string, string>;
  width: number;
  height: number;
  scale?: number;
  /** Milliseconds per frame; omit for a still image. */
  speed?: number;
  className?: string;
}

/** Animated pixel art: an oversized strip slid one frame at a time. */
export function PixelArt({
  cacheKey,
  frames,
  palette,
  width,
  height,
  scale = 2,
  speed,
  className = "",
}: PixelArtProps) {
  const sheet = useMemo(
    () => renderSheet(cacheKey, frames, palette, width, height),
    [cacheKey, frames, palette, width, height],
  );
  const w = width * scale;
  const h = height * scale;

  return (
    <div className={`sprite ${className}`} style={{ width: w, height: h }} aria-hidden="true">
      <div
        className={speed ? "sprite-strip" : ""}
        style={{
          width: w * frames.length,
          height: h,
          backgroundImage: `url(${sheet})`,
          backgroundSize: `${w * frames.length}px ${h}px`,
          backgroundRepeat: "no-repeat",
          imageRendering: "pixelated",
          ...(speed
            ? {
                animationDuration: `${speed * frames.length}ms`,
                animationTimingFunction: `steps(${frames.length})`,
              }
            : {}),
        }}
      />
    </div>
  );
}
