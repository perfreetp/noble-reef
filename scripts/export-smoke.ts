import { writeFileSync, mkdirSync } from 'node:fs';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import * as THREE from 'three';
import { createBuiltinGeometry } from '../src/geometry/modelLibrary';
import { runPipeline } from '../src/geometry/pipeline';
import type { DocumentState } from '../src/types';

mkdirSync('scripts/downloads', { recursive: true });
const geometry = createBuiltinGeometry('builtin-mecha');
const state = {
  modelId: 'builtin-mecha', cutHeight: 62, cutReady: true,
  tenon: { count: 8, radius: 4.8, depth: 12, clearance: 0.35, side: 'lower', gridPadding: 3, minCover: 2.2 },
  wall: { enabled: true, thickness: 4, thinThreshold: 5, autoThicken: true },
  contour: [], contourClosed: true,
} as unknown as DocumentState;
const result = runPipeline(geometry, state);
console.log('conflicts', result.tenons.map(t => t.conflict), result.warnings);
const exporter = new STLExporter();
for (const side of ['lower', 'upper'] as const) {
  const g = side === 'lower' ? result.lowerGeometry! : result.upperGeometry!;
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
  const data = exporter.parse(mesh, { binary: true }) as DataView;
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  writeFileSync(`scripts/downloads/${side}.stl`, buf);
  const triangles = buf.readUInt32LE(80);
  console.log(side, 'bytes', buf.length, 'stlTriangles', triangles, 'expected', Math.round((g.index?.count ?? g.attributes.position.count) / 3));
}
