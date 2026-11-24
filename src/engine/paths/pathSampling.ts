import {
  PATH_SAMPLE_SPACING,
  PATH_SUBDIV_PER_SEGMENT,
  PATH_SURFACE_OFFSET,
  TAN_SLOPE_LIMIT,
} from '../../config/constants';
import type { ControlPoint, PathState } from '../../types/project';
import type { TerrainModel } from '../terrain/TerrainModel';
import { radToDeg } from '../../util/math';

export interface SampledPoint {
  x: number;
  y: number;
  z: number;
}

export interface SlopeInterval {
  /** 采样段起点索引 */
  from: number;
  to: number;
  maxAngleDeg: number;
}

export interface SampledPath {
  /** 等弧长采样点（含贴面 y） */
  points: SampledPoint[];
  /** 单位切线（水平为主，含竖向分量） */
  tangents: { x: number; y: number; z: number }[];
  /** 累积弧长（水平+垂直弦长），长度与 points 相同 */
  cumLen: number[];
  totalLen: number;
  /** 每段是否超限，长度 = points.length - 1 */
  slopeFlags: boolean[];
  slopeIntervals: SlopeInterval[];
  maxSlopeDeg: number;
  overLimitLength: number;
}

interface Vec2 {
  x: number;
  z: number;
}

/** 向心 Catmull-Rom（α=0.5），仅插值 x/z；重复端点（p0==p1、p2==p3）做除零保护 */
const catmullRom2D = (p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, u: number): Vec2 => {
  const alpha = 0.5;
  const tj = (ti: number, a: Vec2, b: Vec2): number => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d2 = dx * dx + dz * dz;
    return d2 === 0 ? ti : ti + Math.pow(d2, alpha * 0.5);
  };
  const t0 = 0;
  const t1 = tj(t0, p0, p1);
  const t2 = tj(t1, p1, p2);
  const t3 = tj(t2, p2, p3);
  const t = t1 + (t2 - t1) * u;

  // 重合点退化为取另一点，避免 0 分母产生 NaN
  const a1: Vec2 = t1 === t0 ? p1 : {
    x: ((t1 - t) / (t1 - t0)) * p0.x + ((t - t0) / (t1 - t0)) * p1.x,
    z: ((t1 - t) / (t1 - t0)) * p0.z + ((t - t0) / (t1 - t0)) * p1.z,
  };
  const a2: Vec2 = {
    x: ((t2 - t) / (t2 - t1)) * p1.x + ((t - t1) / (t2 - t1)) * p2.x,
    z: ((t2 - t) / (t2 - t1)) * p1.z + ((t - t1) / (t2 - t1)) * p2.z,
  };
  const a3: Vec2 = t3 === t2 ? p2 : {
    x: ((t3 - t) / (t3 - t2)) * p2.x + ((t - t2) / (t3 - t2)) * p3.x,
    z: ((t3 - t) / (t3 - t2)) * p2.z + ((t - t2) / (t3 - t2)) * p3.z,
  };

  const b1: Vec2 = {
    x: ((t2 - t) / (t2 - t1)) * a1.x + ((t - t1) / (t2 - t1)) * a2.x,
    z: ((t2 - t) / (t2 - t1)) * a1.z + ((t - t1) / (t2 - t1)) * a2.z,
  };
  const b2: Vec2 = {
    x: ((t3 - t) / (t3 - t1)) * a2.x + ((t - t1) / (t3 - t1)) * a3.x,
    z: ((t3 - t) / (t3 - t1)) * a2.z + ((t - t1) / (t3 - t1)) * a3.z,
  };

  return {
    x: ((t2 - t) / (t2 - t1)) * b1.x + ((t - t1) / (t2 - t1)) * b2.x,
    z: ((t2 - t) / (t2 - t1)) * b1.z + ((t - t1) / (t2 - t1)) * b2.z,
  };
};

/** 控制点 → 密集细分折线（未吸附），首尾端点重复补齐 */
export const subdivideControlPoints = (cps: ControlPoint[], perSegment = PATH_SUBDIV_PER_SEGMENT): Vec2[] => {
  if (cps.length === 0) return [];
  if (cps.length === 1) return [{ x: cps[0]!.x, z: cps[0]!.z }];

  const pts = cps.map((c) => ({ x: c.x, z: c.z }));
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    for (let s = 0; s < perSegment; s++) {
      out.push(catmullRom2D(p0, p1, p2, p3, s / perSegment));
    }
  }
  out.push({ ...pts[pts.length - 1]! });
  return out;
};

/** 建弧长表并按等弧长重采样（纯 2D，间距单位与输入坐标一致=米） */
export const resampleByLength = (polyline: Vec2[], spacing = PATH_SAMPLE_SPACING): Vec2[] => {
  if (polyline.length < 2) return polyline.map((p) => ({ ...p }));

  const cum: number[] = [0];
  for (let i = 1; i < polyline.length; i++) {
    const d = Math.hypot(
      polyline[i]!.x - polyline[i - 1]!.x,
      polyline[i]!.z - polyline[i - 1]!.z,
    );
    cum.push(cum[i - 1]! + d);
  }
  const total = cum[cum.length - 1]!;
  const count = Math.max(2, Math.round(total / spacing) + 1);
  const result: Vec2[] = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / (count - 1)) * total;
    while (seg < cum.length - 2 && cum[seg + 1]! < target) seg++;
    const len0 = cum[seg]!;
    const len1 = cum[seg + 1]!;
    const u = len1 === len0 ? 0 : (target - len0) / (len1 - len0);
    result.push({
      x: polyline[seg]!.x + (polyline[seg + 1]!.x - polyline[seg]!.x) * u,
      z: polyline[seg]!.z + (polyline[seg + 1]!.z - polyline[seg]!.z) * u,
    });
  }
  return result;
};

/** 沿等距采样点做坡度检测：slope = Δy / 水平距 */
export const computeSlopeFlags = (
  points: SampledPoint[],
  horizontalSpacing: number,
): { flags: boolean[]; intervals: SlopeInterval[]; maxSlopeDeg: number; overLimitLength: number } => {
  const flags: boolean[] = new Array(Math.max(0, points.length - 1)).fill(false);
  const intervals: SlopeInterval[] = [];
  let maxSlopeDeg = 0;
  let overLimitLength = 0;
  let open: SlopeInterval | null = null;

  for (let i = 0; i < flags.length; i++) {
    const dy = points[i + 1]!.y - points[i]!.y;
    const slope = dy / horizontalSpacing;
    const angle = Math.abs(radToDeg(Math.atan(slope)));
    maxSlopeDeg = Math.max(maxSlopeDeg, angle);
    const over = Math.abs(slope) > TAN_SLOPE_LIMIT;
    flags[i] = over;
    if (over) {
      overLimitLength += horizontalSpacing;
      if (!open) open = { from: i, to: i + 1, maxAngleDeg: angle };
      else {
        open.to = i + 1;
        open.maxAngleDeg = Math.max(open.maxAngleDeg, angle);
      }
    } else if (open) {
      intervals.push(open);
      open = null;
    }
  }
  if (open) intervals.push(open);
  return { flags, intervals, maxSlopeDeg, overLimitLength };
};

/** 路径点吸附地表（双线性 + 贴面偏移） */
export const snapPointsToTerrain = (
  points: Vec2[],
  model: TerrainModel,
): SampledPoint[] =>
  points.map((p) => ({
    x: p.x,
    z: p.z,
    y: model.sampleHeightBilinear(p.x, p.z) + PATH_SURFACE_OFFSET,
  }));

const computeTangents = (points: SampledPoint[]) => {
  const tangents: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)]!;
    const b = points[Math.min(points.length - 1, i + 1)]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const inv = 1 / Math.hypot(dx, dy, dz);
    tangents.push({ x: dx * inv, y: dy * inv, z: dz * inv });
  }
  return tangents;
};

/** 主入口：PathState + 地形 → 完整采样结果（控制点/地形变化即重算） */
export const rebuildPath = (path: PathState, model: TerrainModel): SampledPath | null => {
  if (path.controlPoints.length < 2) return null;
  const dense = subdivideControlPoints(path.controlPoints);
  const spaced = resampleByLength(dense);
  const points = snapPointsToTerrain(spaced, model);

  const cumLen: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cumLen.push(
      cumLen[i - 1]! +
        Math.hypot(
          points[i]!.x - points[i - 1]!.x,
          points[i]!.y - points[i - 1]!.y,
          points[i]!.z - points[i - 1]!.z,
        ),
    );
  }
  const slope = computeSlopeFlags(points, PATH_SAMPLE_SPACING);
  return {
    points,
    tangents: computeTangents(points),
    cumLen,
    totalLen: cumLen[cumLen.length - 1]!,
    slopeFlags: slope.flags,
    slopeIntervals: slope.intervals,
    maxSlopeDeg: slope.maxSlopeDeg,
    overLimitLength: slope.overLimitLength,
  };
};

/** 按归一化里程 t∈[0,1] 取采样点与切线（漫游用） */
export const samplePathAtT = (
  sampled: SampledPath,
  t: number,
): { point: SampledPoint; tangent: { x: number; y: number; z: number }; distance: number } => {
  const clamped = Math.min(1, Math.max(0, t));
  const target = clamped * sampled.totalLen;
  let i = 0;
  while (i < sampled.cumLen.length - 2 && sampled.cumLen[i + 1]! < target) i++;
  const len0 = sampled.cumLen[i]!;
  const len1 = sampled.cumLen[i + 1]!;
  const u = len1 === len0 ? 0 : (target - len0) / (len1 - len0);
  const p0 = sampled.points[i]!;
  const p1 = sampled.points[i + 1]!;
  return {
    point: {
      x: p0.x + (p1.x - p0.x) * u,
      y: p0.y + (p1.y - p0.y) * u,
      z: p0.z + (p1.z - p0.z) * u,
    },
    tangent: sampled.tangents[i]!,
    distance: target,
  };
};
