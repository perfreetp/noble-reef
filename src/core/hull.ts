/** Convex hull (Andrew monotone chain), returned counter-clockwise in the (x, z) plane. */
export function convexHull2D(points: readonly [number, number][]): [number, number][] {
  if (points.length <= 2) return points.map((p) => [p[0], p[1]]);
  const pts = points.slice().sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  // Dedupe so collinear duplicates do not survive the <= test below.
  const uniq: [number, number][] = [];
  for (const p of pts) {
    const last = uniq[uniq.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 1e-9 || Math.abs(last[1] - p[1]) > 1e-9) uniq.push(p);
  }
  if (uniq.length <= 2) return uniq;
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-12) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-12) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  return signedArea(hull) < 0 ? hull.reverse() : hull;
}

/** Shoelace area; positive means counter-clockwise in (x, z). */
export function signedArea(poly: readonly [number, number][]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/**
 * Signed distance from (x, z) to the nearest hull edge; positive inside.
 * The hull must be counter-clockwise in (x, z), which convexHull2D guarantees.
 */
export function supportMargin(hull: readonly [number, number][], x: number, z: number): number {
  if (hull.length < 3) return -Infinity;
  let inside = true;
  let minDist = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const len = Math.hypot(ex, ez) || 1;
    const d = (ex * (z - a[1]) - ez * (x - a[0])) / len;
    if (d < 0) inside = false;
    minDist = Math.min(minDist, d);
  }
  return inside ? minDist : -Math.abs(minDist);
}

export function hullCentroid(hull: readonly [number, number][]): [number, number] {
  if (!hull.length) return [0, 0];
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i];
    const q = hull[(i + 1) % hull.length];
    const c = p[0] * q[1] - q[0] * p[1];
    a += c;
    cx += (p[0] + q[0]) * c;
    cz += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < 1e-12) {
    let sx = 0;
    let sz = 0;
    for (const p of hull) {
      sx += p[0];
      sz += p[1];
    }
    return [sx / hull.length, sz / hull.length];
  }
  return [cx / (3 * a), cz / (3 * a)];
}

export function pointInHull(hull: readonly [number, number][], x: number, z: number): boolean {
  return supportMargin(hull, x, z) >= 0;
}

/** Radius from the hull's centroid to its farthest vertex, for framing and scaling. */
export function hullRadius(hull: readonly [number, number][]): number {
  const [cx, cz] = hullCentroid(hull);
  let r = 0;
  for (const [x, z] of hull) r = Math.max(r, Math.hypot(x - cx, z - cz));
  return r;
}
