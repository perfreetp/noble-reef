/** 默认盆景骨架:主干 + 5 根一级分枝 + 部分二级分枝 */
import type { SkeletonData } from '../types';

export const DEFAULT_SKELETON: SkeletonData = {
  branches: [
    {
      id: 'trunk',
      parentId: null,
      attachT: 0,
      radius: 0.16,
      points: [
        [0, 0, 0],
        [0.12, 0.55, 0.04],
        [-0.08, 1.15, -0.05],
        [0.1, 1.75, 0.02],
        [-0.04, 2.3, 0.06],
        [0.02, 2.75, 0],
      ],
    },
    {
      id: 'b1',
      parentId: 'trunk',
      attachT: 0.3,
      radius: 0.07,
      points: [
        [0, 0, 0],
        [0.45, 0.12, 0.1],
        [0.85, 0.3, 0.05],
        [1.15, 0.42, -0.08],
      ],
    },
    {
      id: 'b2',
      parentId: 'trunk',
      attachT: 0.48,
      radius: 0.065,
      points: [
        [0, 0, 0],
        [-0.4, 0.15, -0.15],
        [-0.8, 0.34, -0.2],
        [-1.05, 0.5, -0.1],
      ],
    },
    {
      id: 'b3',
      parentId: 'trunk',
      attachT: 0.64,
      radius: 0.055,
      points: [
        [0, 0, 0],
        [0.3, 0.18, -0.3],
        [0.55, 0.4, -0.55],
        [0.7, 0.58, -0.75],
      ],
    },
    {
      id: 'b4',
      parentId: 'trunk',
      attachT: 0.78,
      radius: 0.05,
      points: [
        [0, 0, 0],
        [-0.28, 0.2, 0.28],
        [-0.5, 0.42, 0.5],
        [-0.62, 0.6, 0.66],
      ],
    },
    {
      id: 'b5',
      parentId: 'trunk',
      attachT: 0.9,
      radius: 0.04,
      points: [
        [0, 0, 0],
        [0.2, 0.25, 0.12],
        [0.3, 0.5, 0.05],
      ],
    },
    {
      id: 'b1a',
      parentId: 'b1',
      attachT: 0.55,
      radius: 0.035,
      points: [
        [0, 0, 0],
        [0.2, 0.2, 0.25],
        [0.35, 0.38, 0.4],
      ],
    },
    {
      id: 'b2a',
      parentId: 'b2',
      attachT: 0.6,
      radius: 0.03,
      points: [
        [0, 0, 0],
        [-0.15, 0.22, -0.3],
        [-0.22, 0.4, -0.5],
      ],
    },
  ],
};
