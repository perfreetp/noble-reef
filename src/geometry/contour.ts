import * as THREE from 'three';
import type { TenonReportItem, TenonSettings, Vec3 } from '../types';
import { ensureBVH } from './bvh';

export function projectContour(points: Vec3[], height: number, closed: boolean): Vec3[] {
  const projected = points.map((p) => ({ x: p.x, y: height, z: p.z }));
  if (!closed || projected.length < 3) return projected;

  const curve = new THREE.CatmullRomCurve3(
    projected.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
    true,
    'centripetal',
    0.35,
  );
  const samples = Math.min(240, Math.max(projected.length * 10, 48));
  return curve.getPoints(samples).map((p) => ({ x: p.x, y: height, z: p.z }));
}

export function polygonAreaXZ(loop: Vec3[]): number {
  let area = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    area += a.x * b.z - b.x * a.z;
  }
  return Math.abs(area) * 0.5;
}

export function largestLoop(loops: Vec3[][]): Vec3[] | null {
  if (!loops.length) return null;
  return loops.reduce((best, loop) => (polygonAreaXZ(loop) > polygonAreaXZ(best) ? loop : best), loops[0]);
}

export function pointInPolygonXZ(x: number, z: number, loop: Vec3[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const xi = loop[i].x;
    const zi = loop[i].z;
    const xj = loop[j].x;
    const zj = loop[j].z;
    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function distanceToLoopXZ(x: number, z: number, loop: Vec3[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const vx = b.x - a.x;
    const vz = b.z - a.z;
    const wx = x - a.x;
    const wz = z - a.z;
    const len2 = vx * vx + vz * vz || 1e-9;
    const t = THREE.MathUtils.clamp((wx * vx + wz * vz) / len2, 0, 1);
    const px = a.x + vx * t;
    const pz = a.z + vz * t;
    min = Math.min(min, Math.hypot(x - px, z - pz));
  }
  return min;
}

interface PlannedPoint {
  x: number;
  z: number;
  boundaryClearance: number;
  score: number;
}

function boundsOf(loop: Vec3[]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of loop) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ };
}

function chooseGridDims(count: number, width: number, depth: number) {
  const aspect = Math.max(0.2, width / Math.max(depth, 1));
  let best = { cols: Math.ceil(Math.sqrt(count)), rows: Math.ceil(count / Math.ceil(Math.sqrt(count))), penalty: Infinity };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const gridAspect = cols / rows;
    const penalty = Math.abs(Math.log(gridAspect / aspect)) + (cols * rows - count) * 0.35;
    if (penalty < best.penalty) best = { cols, rows, penalty };
  }
  return best;
}

function evaluatePoint(
  x: number,
  z: number,
  loop: Vec3[],
  selected: PlannedPoint[],
  radius: number,
): PlannedPoint | null {
  if (!pointInPolygonXZ(x, z, loop)) return null;
  const boundaryClearance = distanceToLoopXZ(x, z, loop);
  if (boundaryClearance < radius * 0.55) return null;
  let separation = Infinity;
  for (const p of selected) separation = Math.min(separation, Math.hypot(x - p.x, z - p.z));
  return {
    x,
    z,
    boundaryClearance,
    score: boundaryClearance + Math.min(separation, radius * 5) * 0.12,
  };
}

export function estimateLocalChord(bvh: ReturnType<typeof ensureBVH>, x: number, y: number, z: number): number {
  const origin = new THREE.Vector3(x, y, z);
  let minChord = Number.POSITIVE_INFINITY;
  const dir = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI;
    dir.set(Math.cos(a), 0, Math.sin(a));
    const positive = bvh.raycastFirst(new THREE.Ray(origin, dir), THREE.DoubleSide, 0.01, 220)?.distance ?? Infinity;
    const negative = bvh.raycastFirst(new THREE.Ray(origin, dir.clone().negate()), THREE.DoubleSide, 0.01, 220)?.distance ?? Infinity;
    if (Number.isFinite(positive) && Number.isFinite(negative)) minChord = Math.min(minChord, positive + negative);
  }
  return minChord;
}

export function planTenonPositions(
  count: number,
  loops: Vec3[][],
  settings: TenonSettings,
  wallThickness: number,
  bodyBVH?: ReturnType<typeof ensureBVH>,
  cutHeight = 0,
): TenonReportItem[] {
  const loop = largestLoop(loops);
  if (!loop) {
    return Array.from({ length: count }, (_, i) => ({
      index: i,
      x: 0,
      z: 0,
      score: 0,
      boundaryClearance: 0,
      minOppositeGap: 0,
      intersects: false,
      thin: true,
      conflict: true,
      reason: '未找到闭合截面',
    }));
  }

  const b = boundsOf(loop);
  const pad = settings.radius + settings.gridPadding;
  const innerW = Math.max(settings.radius * 2, b.width - pad * 2);
  const innerD = Math.max(settings.radius * 2, b.depth - pad * 2);
  const { cols, rows } = chooseGridDims(count, b.width, b.depth);
  const spacingX = cols > 1 ? innerW / (cols - 1) : 0;
  const spacingZ = rows > 1 ? innerD / (rows - 1) : 0;
  const centerX = (b.minX + b.maxX) / 2;
  const centerZ = (b.minZ + b.maxZ) / 2;
  const selected: PlannedPoint[] = [];

  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const rowStart = row * cols;
    const rowCount = Math.min(cols, count - rowStart);
    const colInRow = i - rowStart;
    const rowXs = Array.from({ length: rowCount }, (_, c) => {
      const offset = rowCount === cols ? c - (cols - 1) / 2 : c - (rowCount - 1) / 2;
      return centerX + offset * spacingX;
    });
    const nominalX = rowXs[colInRow] ?? centerX;
    const nominalZ = rows === 1 ? centerZ : b.minZ + pad + (row / (rows - 1)) * innerD;

    let best: PlannedPoint | null = null;
    const searchStep = 1.25;
    const maxRadius = Math.min(spacingX * 0.42 || 8, spacingZ * 0.42 || 8, 10);
    for (let r = 0; r <= maxRadius; r += searchStep) {
      const rings = r === 0 ? 1 : Math.max(8, Math.floor(r * 5));
      for (let k = 0; k < rings; k++) {
        const a = (k / rings) * Math.PI * 2;
        const candidate = evaluatePoint(
          nominalX + Math.cos(a) * r,
          nominalZ + Math.sin(a) * r,
          loop,
          selected,
          settings.radius,
        );
        if (candidate && (!best || candidate.score > best.score)) best = candidate;
      }
      if (best && r > 2) break;
    }

    if (!best) {
      const clearance = distanceToLoopXZ(nominalX, nominalZ, loop);
      best = { x: nominalX, z: nominalZ, boundaryClearance: clearance, score: 0 };
    }
    selected.push(best);
  }

  const requiredCover = Math.max(1.4, wallThickness * 0.72);
  return selected.map((p, index) => {
    const chord = bodyBVH ? estimateLocalChord(bodyBVH, p.x, cutHeight, p.z) : p.boundaryClearance * 2;
    const radialCover = p.boundaryClearance - settings.radius - settings.clearance;
    const thin =
      p.boundaryClearance < settings.radius + settings.clearance + requiredCover ||
      (Number.isFinite(chord) && chord < settings.radius * 2 + wallThickness * 1.4);
    return {
      index,
      x: p.x,
      z: p.z,
      score: p.score,
      boundaryClearance: p.boundaryClearance,
      minOppositeGap: Number.POSITIVE_INFINITY,
      intersects: false,
      thin,
      conflict: thin,
      reason: thin ? `局部余量 ${radialCover.toFixed(1)}mm，低于建议 ${requiredCover.toFixed(1)}mm` : '网格点位余量充足',
    };
  });
}

export function createPostGeometry(x: number, h: number, z: number, radius: number, depth: number, side: 'lower' | 'upper') {
  const dir = side === 'lower' ? 1 : -1;
  const height = depth + 0.6;
  const g = new THREE.CylinderGeometry(radius * 0.985, radius, height, 28, 1, false);
  g.translate(x, h + dir * (depth - 0.4) * 0.5, z);
  return g;
}

export function createSocketCutterGeometry(x: number, h: number, z: number, radius: number, depth: number, clearance: number, side: 'lower' | 'upper') {
  const dir = side === 'lower' ? 1 : -1;
  const r = radius + clearance;
  const height = depth + 0.7;
  const g = new THREE.CylinderGeometry(r, r, height, 28, 1, false);
  g.translate(x, h + dir * (depth + 0.1) * 0.5, z);
  return g;
}

export function createBossGeometry(x: number, h: number, z: number, radius: number, depth: number, wallThickness: number, side: 'lower' | 'upper') {
  const dir = side === 'lower' ? 1 : -1;
  const bossRadius = radius + Math.max(2.2, wallThickness * 0.75);
  const height = depth + wallThickness + 1.5;
  // Extends from just outside/inside the inner cap toward the model interior.
  const centerOffset = -(wallThickness + 0.55) - height / 2;
  const g = new THREE.CylinderGeometry(bossRadius, bossRadius * 1.08, height, 28, 1, false);
  g.translate(x, h + dir * centerOffset, z);
  return g;
}
