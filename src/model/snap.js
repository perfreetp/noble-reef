/**
 * Pure snapping math shared by the viewport and tests.
 * Positions are element origins (footprint centre, on the ground).
 */

export function snapScalar(value, step) {
  const s = Number(step) || 0;
  if (s <= 0) return Math.round(value * 1e4) / 1e4;
  // Round again after scaling so 3.8000000000000003 becomes exactly 3.8.
  return Math.round(Math.round(value / s) * s * 1e6) / 1e6;
}

export function snapVec(vec, step) {
  return [snapScalar(vec[0], step), Math.max(0, snapScalar(vec[1], step)), snapScalar(vec[2], step)];
}

/**
 * Snap a centre on one axis so that one of its faces/centre lines up with a
 * neighbouring element's face/centre.
 *
 * @param axis 'x' | 'z'
 * @param center proposed centre coordinate
 * @param size footprint extent along that axis
 * @param others array of AABBs ({min:[x,y,z], max:[x,y,z]})
 * @param tolerance max distance to snap
 */
export function edgeSnapAxis({ axis, center, size, others, tolerance }) {
  const i = axis === 'x' ? 0 : 2;
  const half = size / 2;
  let best = null;
  for (const b of others) {
    const min = b.min[i];
    const max = b.max[i];
    // Candidate centres: our right/left face onto their left/right face,
    // or our centre onto their centre.
    const candidates = [max + half, min - half, (min + max) / 2];
    for (const c of candidates) {
      const d = Math.abs(c - center);
      if (d <= tolerance && (best === null || d < best.d)) best = { c, d };
    }
  }
  return best ? best.c : center;
}
