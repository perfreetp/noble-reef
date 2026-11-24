import type { PartDef, RigConfig, RodDef } from './types';
import { RIG_VERSION } from './types';

/**
 * 默认影偶:6 部件铰接层级
 *
 *            head
 *              │ 挂在身体顶端
 *   leftArm ─ body ─ rightArm
 *              │
 *   leftLeg ─ body ─ rightLeg(挂点在身体底端左右两侧)
 *
 * 所有坐标为部件局部坐标,枢轴(原点)即该部件与父级的铰接点。
 */
export function defaultParts(): PartDef[] {
  return [
    {
      id: 'body',
      parent: null,
      anchor: { x: 0, y: 0 },
      tips: { body: { x: 0, y: 0 } },
      restAngle: 0,
      // 身体只允许小幅摆动,避免整偶翻折
      limits: [-0.35, 0.35],
      z: 0,
    },
    {
      id: 'head',
      parent: 'body',
      anchor: { x: 0, y: 2.05 },
      tips: { head: { x: 0, y: 0.45 } },
      restAngle: 0,
      // 头部绕颈铰接,禁止转到躯干背后
      limits: [-0.9, 0.9],
      z: 2,
    },
    {
      id: 'leftArm',
      parent: 'body',
      anchor: { x: -0.26, y: 1.78 },
      tips: { leftArm: { x: 0, y: -1.15 } },
      restAngle: 0.18,
      // 左臂:上举到下垂,且限位避免越过躯干中线穿透身体
      limits: [-0.45, 2.0],
      z: 1,
    },
    {
      id: 'rightArm',
      parent: 'body',
      anchor: { x: 0.26, y: 1.78 },
      tips: { rightArm: { x: 0, y: -1.15 } },
      restAngle: -0.18,
      limits: [-2.0, 0.45],
      z: 1,
    },
    {
      id: 'leftLeg',
      parent: 'body',
      anchor: { x: -0.14, y: 0 },
      tips: { leftLeg: { x: 0, y: -1.15 } },
      restAngle: 0.1,
      // 双腿限位:不允许交叉翻折
      limits: [-0.5, 0.9],
      z: -1,
    },
    {
      id: 'rightLeg',
      parent: 'body',
      anchor: { x: 0.14, y: 0 },
      tips: { rightLeg: { x: 0, y: -1.15 } },
      restAngle: -0.1,
      limits: [-0.9, 0.5],
      z: -1,
    },
  ];
}

/** 默认 3 根杆:头杆(同时带身体)、左臂杆、右臂杆;腿默认自由垂摆,可在面板里改绑 */
export function defaultRods(): RodDef[] {
  return [
    {
      id: 'rod-head',
      label: '头杆',
      home: { x: 0, y: 0.55 },
      bindings: [
        { tip: 'head', axis: 'x', scale: 1.1 },
        { tip: 'body', axis: 'x', scale: 0.35 },
      ],
    },
    {
      id: 'rod-larm',
      label: '左臂杆',
      home: { x: 0, y: 0 },
      bindings: [{ tip: 'leftArm', axis: 'y', scale: 1.25 }],
    },
    {
      id: 'rod-rarm',
      label: '右臂杆',
      home: { x: 0, y: 0 },
      bindings: [{ tip: 'rightArm', axis: 'y', scale: -1.25 }],
    },
  ];
}

export function defaultConfig(): RigConfig {
  return {
    version: RIG_VERSION,
    parts: defaultParts(),
    rods: defaultRods(),
    poses: [],
    lightIntensity: 1,
  };
}

/** 可在面板里给杆件选择的全部挂点(每个部件一个末端挂点) */
export const ALL_TIPS = ['head', 'body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const;
