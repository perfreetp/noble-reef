import { createBuiltinGeometry } from '../src/geometry/modelLibrary';
import { runPipeline } from '../src/geometry/pipeline';
import type { DocumentState } from '../src/types';

const geometry = createBuiltinGeometry('builtin-neko');
const base = {
  step: 'tenon',
  modelId: 'builtin-neko',
  modelName: 'smoke',
  modelSource: 'builtin',
  format: 'proc',
  triangleCount: geometry.attributes.position.count / 3,
  minY: 0,
  maxY: 128,
  sizeX: 80,
  sizeZ: 60,
  contour: [],
  contourClosed: true,
  cutHeight: 60,
  cutReady: true,
  explode: 0,
  showSection: true,
  tenon: { count: 5, radius: 3.2, depth: 8, clearance: 0.35, side: 'lower', gridPadding: 5, minCover: 1.6 },
  wall: { enabled: true, thickness: 3, thinThreshold: 4.2, autoThicken: true },
  showConflictOnly: false,
  showInnerShell: true,
} as unknown as DocumentState;

const t0 = performance.now();
const result = runPipeline(geometry, base);
console.log(JSON.stringify({
  ms: result.durationMs,
  totalMs: performance.now() - t0,
  loops: result.sectionLoops.length,
  loopPoints: result.sectionLoops.map(l => l.length),
  tenons: result.tenons.map(t => ({ x: t.x.toFixed(1), z: t.z.toFixed(1), conflict: t.conflict, thin: t.thin, gap: Number.isFinite(t.minOppositeGap) ? t.minOppositeGap.toFixed(1) : null })),
  warnings: result.warnings,
  stats: result.stats,
  thinWarnings: result.thinWarnings.length,
  lowerPositions: result.lowerGeometry?.attributes.position.count,
  upperPositions: result.upperGeometry?.attributes.position.count,
}, null, 2));
