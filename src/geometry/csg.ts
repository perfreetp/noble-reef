import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION } from 'three-bvh-csg';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

let sharedEvaluator: Evaluator | null = null;

function evaluator(): Evaluator {
  if (!sharedEvaluator) {
    sharedEvaluator = new Evaluator();
    sharedEvaluator.useGroups = false;
    sharedEvaluator.consolidateMaterials = true;
  }
  return sharedEvaluator;
}

function toBrush(geometry: THREE.BufferGeometry): Brush {
  // CSG expects normal/uv attributes to exist on common builds.
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  if (!geometry.attributes.uv) {
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
  }
  const brush = new Brush(geometry, new THREE.MeshStandardMaterial());
  brush.updateMatrixWorld(true);
  return brush;
}

export function csgOperation(
  base: THREE.BufferGeometry,
  tool: THREE.BufferGeometry,
  operation: typeof ADDITION | typeof SUBTRACTION,
): THREE.BufferGeometry {
  const a = toBrush(base);
  const b = toBrush(tool);
  const result = evaluator().evaluate(a, b, operation);
  const geometry = result.geometry.clone();
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function mergeTools(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!geometries.length) return null;
  const prepared = geometries.map((g) => {
    const copy = g.index ? g : g;
    if (!copy.attributes.normal) copy.computeVertexNormals();
    if (!copy.attributes.uv) {
      copy.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(copy.attributes.position.count * 2), 2));
    }
    return copy;
  });
  if (prepared.length === 1) return prepared[0];
  return mergeGeometries(prepared, false);
}

export function geometryIsFinite(g: THREE.BufferGeometry): boolean {
  const attr = g.attributes.position as THREE.BufferAttribute | undefined;
  if (!attr) return false;
  const array = attr.array as Float32Array;
  for (let i = 0; i < array.length; i++) {
    if (!Number.isFinite(array[i])) return false;
  }
  g.computeBoundingBox();
  return !!g.boundingBox && Number.isFinite(g.boundingBox.min.x + g.boundingBox.max.x);
}

export function safeCsg(
  base: THREE.BufferGeometry,
  tools: THREE.BufferGeometry[],
  operation: 'add' | 'subtract',
): { geometry: THREE.BufferGeometry; ok: boolean; error?: string } {
  const tool = mergeTools(tools);
  if (!tool) return { geometry: base, ok: true };
  try {
    const result = csgOperation(base, tool, operation === 'add' ? ADDITION : SUBTRACTION);
    if (!geometryIsFinite(result)) {
      result.dispose();
      return { geometry: base, ok: false, error: 'CSG 结果包含非有限顶点' };
    }
    return { geometry: result, ok: true };
  } catch (error) {
    return { geometry: base, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
