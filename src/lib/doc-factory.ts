import type {
  Block,
  Doc,
  Nozzle,
  NozzleGroup,
  PlazaConfig,
  RectArraySpec,
  RingArraySpec
} from './types';
import { angleVec, normalizeDeg, uid } from './util';

export const DEFAULT_CONFIG: PlazaConfig = {
  plazaColor: '#d9d2c3',
  pool: { x: -1200, y: -900, width: 2400, height: 1800 },
  poolColor: '#2f6f8f',
  jetRange: 260,
  gridSize: 100
};

const GROUP_COLORS = [
  '#e84855',
  '#f18f01',
  '#f5c518',
  '#3db87a',
  '#1f9df0',
  '#7b5cd6',
  '#e3579f',
  '#14b8a6',
  '#c08552',
  '#8d99ae'
];

export function colorForIndex(i: number): string {
  return GROUP_COLORS[i % GROUP_COLORS.length];
}

/** 由矩形阵列参数生成喷头（中心点 cx, cy） */
export function buildRectArray(cx: number, cy: number, spec: RectArraySpec): Nozzle[] {
  const out: Nozzle[] = [];
  const rot = (spec.angle * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const totalW = (spec.cols - 1) * spec.spacingX;
  const totalH = (spec.rows - 1) * spec.spacingY;
  for (let r = 0; r < spec.rows; r++) {
    for (let c = 0; c < spec.cols; c++) {
      const lx = c * spec.spacingX - totalW / 2;
      const ly = r * spec.spacingY - totalH / 2;
      // 屏幕坐标旋转（y 向下，逆时针角度对应标准数学旋转）
      const x = cx + lx * cos - ly * sin;
      const y = cy - lx * sin - ly * cos;
      out.push({
        id: uid('nz'),
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        angle: normalizeDeg(spec.angle),
        groupId: spec.groupId
      });
    }
  }
  return out;
}

/** 由环形阵列参数生成喷头（中心点 cx, cy） */
export function buildRingArray(cx: number, cy: number, spec: RingArraySpec): Nozzle[] {
  const out: Nozzle[] = [];
  if (spec.count <= 0) return out;
  const span = spec.fullCircle ? 360 : spec.sweep;
  const denom = spec.fullCircle ? spec.count : Math.max(spec.count - 1, 1);
  for (let i = 0; i < spec.count; i++) {
    const t = spec.count === 1 ? 0 : i / denom;
    const a = spec.startAngle + span * t;
    const v = angleVec(a);
    const x = cx + v.x * spec.radius;
    const y = cy + v.y * spec.radius;
    let angle: number;
    if (spec.orientation === 'radial') angle = normalizeDeg(a);
    else if (spec.orientation === 'tangent') angle = normalizeDeg(a + 90);
    else angle = normalizeDeg(spec.fixedAngle);
    out.push({
      id: uid('nz'),
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      angle,
      groupId: spec.groupId
    });
  }
  return out;
}

/** 单个喷头 */
export function buildNozzle(x: number, y: number, groupId = '', angle = 90): Nozzle {
  return { id: uid('nz'), x, y, angle: normalizeDeg(angle), groupId };
}

export function buildGroup(name: string, index: number): NozzleGroup {
  return { id: uid('grp'), name, color: colorForIndex(index) };
}

export function buildBlock(groupId: string, beatIndex: number, intensity: number): Block {
  return { id: uid('blk'), groupId, beatIndex, intensity };
}

/** 创建一份带演示内容的初始工程（含上千喷头、多条轨道、编排色块） */
export function createDefaultDoc(): Doc {
  const groups: NozzleGroup[] = [
    { id: 'grp_ring_outer', name: '外环', color: GROUP_COLORS[4] },
    { id: 'grp_ring_inner', name: '内环', color: GROUP_COLORS[3] },
    { id: 'grp_rect_a', name: '矩阵 A', color: GROUP_COLORS[0] },
    { id: 'grp_rect_b', name: '矩阵 B', color: GROUP_COLORS[1] },
    { id: 'grp_center', name: '中心泉', color: GROUP_COLORS[6] }
  ];

  const nozzles: Nozzle[] = [];
  // 外环 360 个
  nozzles.push(
    ...buildRingArray(0, 0, {
      count: 360,
      radius: 760,
      startAngle: 0,
      fullCircle: true,
      sweep: 360,
      orientation: 'radial',
      fixedAngle: 0,
      groupId: 'grp_ring_outer'
    })
  );
  // 内环 240 个
  nozzles.push(
    ...buildRingArray(0, 0, {
      count: 240,
      radius: 480,
      startAngle: 0,
      fullCircle: true,
      sweep: 360,
      orientation: 'radial',
      fixedAngle: 0,
      groupId: 'grp_ring_inner'
    })
  );
  // 矩阵 A：30 x 18 = 540
  nozzles.push(
    ...buildRectArray(0, 0, {
      rows: 18,
      cols: 30,
      spacingX: 55,
      spacingY: 55,
      angle: 0,
      groupId: 'grp_rect_a'
    })
  );
  // 矩阵 B（两侧小矩阵）：2 x (10 x 6) = 120
  nozzles.push(
    ...buildRectArray(-880, 0, {
      rows: 6,
      cols: 10,
      spacingX: 45,
      spacingY: 45,
      angle: 0,
      groupId: 'grp_rect_b'
    }),
    ...buildRectArray(880, 0, {
      rows: 6,
      cols: 10,
      spacingX: 45,
      spacingY: 45,
      angle: 0,
      groupId: 'grp_rect_b'
    })
  );
  // 中心泉 9 个
  nozzles.push(
    ...buildRectArray(0, 0, {
      rows: 3,
      cols: 3,
      spacingX: 90,
      spacingY: 90,
      angle: 0,
      groupId: 'grp_center'
    })
  );

  const beatsPerBar = 4;
  const barCount = 8;
  const totalBeats = beatsPerBar * barCount;
  const blocks: Block[] = [];
  // 演示编排：各组以不同节拍模式喷水
  const pattern: Record<string, number[]> = {
    grp_ring_outer: [0.9, 0, 0.5, 0, 0.9, 0.4, 0, 0.2],
    grp_ring_inner: [0, 0.7, 0, 0.7, 0.3, 0.7, 0.7, 0],
    grp_rect_a: [0.5, 0.5, 0.8, 0.3, 0.6, 0.6, 1, 0.4],
    grp_rect_b: [0, 0.4, 0.4, 0.9, 0, 0.5, 0.5, 0.9],
    grp_center: [1, 0.8, 0.6, 0.9, 1, 0.7, 0.8, 1]
  };
  for (const g of groups) {
    const p = pattern[g.id];
    for (let b = 0; b < totalBeats; b++) {
      const v = p[b % p.length];
      if (v > 0) blocks.push(buildBlock(g.id, b, v));
    }
  }

  return {
    version: 1,
    nozzles,
    groups,
    blocks,
    config: structuredClone(DEFAULT_CONFIG),
    beatsPerBar,
    bpm: 96,
    barCount
  };
}
