import * as THREE from 'three';

function latheModel(profile: Array<[number, number]>, segments = 72): THREE.BufferGeometry {
  const points = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const geometry = new THREE.LatheGeometry(points, segments);
  geometry.computeVertexNormals();
  return geometry;
}

/** Elegant standing figure / chess-piece silhouette, closed on the axis. */
export function makeStarFigure(): THREE.BufferGeometry {
  return latheModel([
    [0, 0], [34, 0], [38, 4], [38, 9], [31, 13], [27, 18],
    [23, 28], [20, 42], [18, 55], [20, 66], [24, 74],
    [22, 82], [16, 88], [14, 94], [18, 99], [21, 106],
    [20, 114], [16, 121], [9, 126], [0, 128],
  ], 80);
}

/** Stepped hard-surface profile; the sharp radius changes read as armor rings. */
export function makeSentinel(): THREE.BufferGeometry {
  return latheModel([
    [0, 0], [40, 0], [42, 6], [42, 12], [34, 14], [34, 30],
    [27, 32], [27, 45], [33, 48], [33, 68], [38, 71],
    [38, 82], [29, 85], [27, 94], [23, 97], [23, 108],
    [17, 112], [15, 121], [8, 126], [0, 128],
  ], 72);
}

/** Round friendly creature / dino-bird silhouette with a broad belly. */
export function makeBubbleDino(): THREE.BufferGeometry {
  return latheModel([
    [0, 0], [25, 2], [34, 9], [40, 22], [42, 39], [39, 56],
    [32, 70], [24, 80], [22, 91], [25, 101], [23, 111],
    [17, 119], [9, 124], [0, 126],
  ], 84);
}
