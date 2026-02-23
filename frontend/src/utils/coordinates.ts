/** Shared 2D coordinate transform utilities. */

/** Rotate a 2D point (x,y) by `angle` degrees around (cx,cy). */
export function rotatePoint(
  x: number, y: number, angle: number, cx: number, cy: number,
): [number, number] {
  if (angle === 0) return [x, y];
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

/** Get the axis-aligned bounding rect of a rotated BB. */
export function rotatedAABB(
  bbX: number, bbY: number, angle: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const cx = bbX / 2;
  const cy = bbY / 2;
  const corners = [
    rotatePoint(0, 0, angle, cx, cy),
    rotatePoint(bbX, 0, angle, cx, cy),
    rotatePoint(bbX, bbY, angle, cx, cy),
    rotatePoint(0, bbY, angle, cx, cy),
  ];
  return {
    minX: Math.min(...corners.map((c) => c[0])),
    minY: Math.min(...corners.map((c) => c[1])),
    maxX: Math.max(...corners.map((c) => c[0])),
    maxY: Math.max(...corners.map((c) => c[1])),
  };
}

/**
 * Transform outline coords (BB-min-local) to sheet-space.
 * Outlines are relative to BB min (0,0), so: rotate around (bb.x/2, bb.y/2),
 * then add placement offset.
 */
export function outlineToSheet(
  coords: [number, number][],
  rotation: number,
  rcx: number,
  rcy: number,
  placeX: number,
  placeY: number,
): [number, number][] {
  if (rotation !== 0) {
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return coords.map(([lx, ly]) => {
      const dx = lx - rcx;
      const dy = ly - rcy;
      return [rcx + dx * cos - dy * sin + placeX, rcy + dx * sin + dy * cos + placeY];
    });
  }
  return coords.map(([lx, ly]) => [lx + placeX, ly + placeY]);
}
