import * as THREE from 'three';
import type { DocumentState, PipelineResult, TenonReportItem } from '../types';
import { splitGeometryAtY } from './clipPlane';
import { ensureBVH } from './bvh';
import {
  createBossGeometry,
  createPostGeometry,
  createSocketCutterGeometry,
  planTenonPositions,
  projectContour,
} from './contour';
import { buildShellCavityGeometry, detectThinCorners } from './shell';
import { safeCsg } from './csg';
import { geometryTriangleCount, geometryVolumeMm3 } from './stats';

const IDENTITY = new THREE.Matrix4();

function applyCollisionChecks(items: TenonReportItem[], oppositeBody: THREE.BufferGeometry, h: number, state: DocumentState) {
  const bvh = ensureBVH(oppositeBody);
  const dir = state.tenon.side === 'lower' ? 1 : -1;
  const target = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };

  for (const item of items) {
    const probe = new THREE.CylinderGeometry(state.tenon.radius, state.tenon.radius, state.tenon.depth, 20, 1, false);
    probe.translate(item.x, h + (dir * state.tenon.depth) / 2, item.z);

    let intersects = false;
    try {
      intersects = bvh.intersectsGeometry(probe, IDENTITY);
    } catch {
      intersects = false;
    }

    let minGap = Infinity;
    const p = new THREE.Vector3();
    const fractions = [0, 0.2, 0.4, 0.6, 0.8, 1];
    const ringCount = 18;
    for (const f of fractions) {
      const y = h + dir * state.tenon.depth * f;
      p.set(item.x, y, item.z);
      const hit = bvh.closestPointToPoint(p, target);
      if (hit) minGap = Math.min(minGap, hit.distance);

      for (let r = 0; r < ringCount; r++) {
        const a = (r / ringCount) * Math.PI * 2;
        p.set(item.x + Math.cos(a) * state.tenon.radius, y, item.z + Math.sin(a) * state.tenon.radius);
        const ringHit = bvh.closestPointToPoint(p, target);
        if (ringHit) minGap = Math.min(minGap, ringHit.distance);
      }
    }
    probe.dispose();

    item.minOppositeGap = minGap;
    item.intersects = intersects;
    const gapConflict = intersects || minGap < state.tenon.minCover;
    item.conflict = item.thin || gapConflict;
    if (intersects) item.reason = '柱体穿出/刺入对面片，存在硬冲突';
    else if (minGap < state.tenon.minCover) item.reason = `与对面外表面最小间距 ${minGap.toFixed(1)}mm，小于保护距离 ${state.tenon.minCover.toFixed(1)}mm`;
    else if (!item.thin) item.reason = `最小间距 ${minGap.toFixed(1)}mm，边界余量 ${item.boundaryClearance.toFixed(1)}mm`;
  }
}

export function runPipeline(source: THREE.BufferGeometry, state: DocumentState): PipelineResult {
  const started = performance.now();
  const warnings: string[] = [];
  source.computeBoundingBox();
  const box = source.boundingBox;
  const minY = Number.isFinite(state.minY) ? state.minY : box?.min.y ?? 0;
  const maxY = Number.isFinite(state.maxY) ? state.maxY : box?.max.y ?? 120;
  const h = THREE.MathUtils.clamp(state.cutHeight, minY + 0.2, maxY - 0.2);

  let split;
  try {
    split = splitGeometryAtY(source, h);
  } catch (error) {
    return {
      cutHeight: h,
      lowerGeometry: null,
      upperGeometry: null,
      lowerBodyGeometry: null,
      upperBodyGeometry: null,
      sectionLoops: [],
      projectedCurve: projectContour(state.contour, h, state.contourClosed),
      tenons: [],
      thinWarnings: [],
      stats: [],
      durationMs: performance.now() - started,
      warnings: [`切割失败：${error instanceof Error ? error.message : String(error)}`],
    };
  }

  ensureBVH(split.lowerBody);
  ensureBVH(split.upperBody);

  const postSide = state.tenon.side;
  const oppositeBody = postSide === 'lower' ? split.upperBody : split.lowerBody;
  const planningBVH = ensureBVH(split.lowerBody);
  const tenons = planTenonPositions(
    state.tenon.count,
    split.loops,
    state.tenon,
    state.wall.thickness,
    planningBVH,
    h,
  );
  applyCollisionChecks(tenons, oppositeBody, h, state);

  let lowerGeometry: THREE.BufferGeometry = split.lower;
  let upperGeometry: THREE.BufferGeometry = split.upper;
  let lowerOK = true;
  let upperOK = true;

  const thinWarnings = state.wall.enabled
    ? detectThinCorners(source, state.wall.thinThreshold, 12)
    : [];

  if (state.wall.enabled) {
    const lowerCavity = buildShellCavityGeometry(split.lowerBody, split.loops, h, state.wall.thickness, 'lower');
    const upperCavity = buildShellCavityGeometry(split.upperBody, split.loops, h, state.wall.thickness, 'upper');
    const lowerShell = safeCsg(lowerGeometry, [lowerCavity], 'subtract');
    const upperShell = safeCsg(upperGeometry, [upperCavity], 'subtract');
    lowerOK = lowerShell.ok;
    upperOK = upperShell.ok;
    if (!lowerShell.ok) warnings.push(`下片抽壳布尔失败，已回退实体封口：${lowerShell.error}`);
    if (!upperShell.ok) warnings.push(`上片抽壳布尔失败，已回退实体封口：${upperShell.error}`);
    lowerGeometry = lowerShell.geometry;
    upperGeometry = upperShell.geometry;
    lowerCavity.dispose();
    upperCavity.dispose();
  }

  const postItems = tenons;
  const postTools = postItems.map((t) => createPostGeometry(t.x, h, t.z, state.tenon.radius, state.tenon.depth, postSide));
  const postBosses = postItems.map((t) => createBossGeometry(t.x, h, t.z, state.tenon.radius, state.tenon.depth, state.wall.thickness, postSide));
  const postTarget = postSide === 'lower' ? lowerGeometry : upperGeometry;
  const postResult = safeCsg(postTarget, [...postTools, ...postBosses], 'add');
  if (!postResult.ok) warnings.push(`定位柱合并失败：${postResult.error}`);
  if (postSide === 'lower') lowerGeometry = postResult.geometry;
  else upperGeometry = postResult.geometry;

  const socketSide = postSide === 'lower' ? 'upper' : 'lower';
  const socketTarget = socketSide === 'lower' ? lowerGeometry : upperGeometry;
  const socketBosses = tenons.map((t) => createBossGeometry(t.x, h, t.z, state.tenon.radius, state.tenon.depth, state.wall.thickness, socketSide));
  const bossResult = safeCsg(socketTarget, socketBosses, 'add');
  if (!bossResult.ok) warnings.push(`凹槽补强台合并失败：${bossResult.error}`);
  let socketGeometry = bossResult.geometry;
  const cutters = tenons.map((t) => createSocketCutterGeometry(t.x, h, t.z, state.tenon.radius, state.tenon.depth, state.tenon.clearance, socketSide));
  const socketResult = safeCsg(socketGeometry, cutters, 'subtract');
  if (!socketResult.ok) warnings.push(`凹槽布尔切割失败：${socketResult.error}`);
  socketGeometry = socketResult.geometry;
  if (socketSide === 'lower') lowerGeometry = socketGeometry;
  else upperGeometry = socketGeometry;

  postTools.forEach((g) => g.dispose());
  postBosses.forEach((g) => g.dispose());
  socketBosses.forEach((g) => g.dispose());
  cutters.forEach((g) => g.dispose());

  const lowerPosts = postSide === 'lower' ? tenons.length : 0;
  const lowerSockets = socketSide === 'lower' ? tenons.length : 0;
  const upperPosts = postSide === 'upper' ? tenons.length : 0;
  const upperSockets = socketSide === 'upper' ? tenons.length : 0;

  const stats = [
    {
      name: '下模 / 下片',
      triangles: geometryTriangleCount(lowerGeometry),
      volumeMm3: geometryVolumeMm3(lowerGeometry),
      volumeCm3: geometryVolumeMm3(lowerGeometry) / 1000,
      tenons: lowerPosts,
      sockets: lowerSockets,
      watertight: split.capped && lowerOK,
    },
    {
      name: '上模 / 上片',
      triangles: geometryTriangleCount(upperGeometry),
      volumeMm3: geometryVolumeMm3(upperGeometry),
      volumeCm3: geometryVolumeMm3(upperGeometry) / 1000,
      tenons: upperPosts,
      sockets: upperSockets,
      watertight: split.capped && upperOK,
    },
  ];

  return {
    cutHeight: h,
    lowerGeometry,
    upperGeometry,
    lowerBodyGeometry: split.lowerBody,
    upperBodyGeometry: split.upperBody,
    sectionLoops: split.loops,
    projectedCurve: projectContour(state.contour, h, state.contourClosed),
    tenons,
    thinWarnings,
    stats,
    durationMs: performance.now() - started,
    warnings,
  };
}
