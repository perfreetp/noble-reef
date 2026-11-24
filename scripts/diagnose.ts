import * as THREE from 'three';
import { createBuiltinGeometry } from '../src/geometry/modelLibrary';
import { runPipeline } from '../src/geometry/pipeline';
import type { DocumentState } from '../src/types';

const origWarn = console.warn;
console.warn = (...args) => {
  const msg = String(args[0] ?? '');
  if (msg.includes('NaN values')) return;
  origWarn(...args);
};

const geometry = createBuiltinGeometry('builtin-mecha');
const state = {
  modelId: 'builtin-mecha', cutHeight: 62, cutReady: true,
  tenon: { count: 8, radius: 4.8, depth: 12, clearance: 0.35, side: 'lower', gridPadding: 3, minCover: 2.2 },
  wall: { enabled: true, thickness: 4, thinThreshold: 5, autoThicken: true },
  contour: [], contourClosed: true,
} as unknown as DocumentState;
const result = runPipeline(geometry, state);
const finite = (g: THREE.BufferGeometry | null) => {
  if (!g) return false;
  const a = g.attributes.position.array as Float32Array;
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
  return true;
};
console.log('tenons', result.tenons.map(t => ({ x: t.x, z: t.z, c: t.conflict })));
console.log('warnings', result.warnings);
console.log('stats', result.stats);
console.log('finite lower/upper', finite(result.lowerGeometry), finite(result.upperGeometry));
console.log('counts', result.lowerGeometry?.index?.count, result.lowerGeometry?.attributes.position.count, result.upperGeometry?.index?.count);
