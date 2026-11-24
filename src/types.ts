/** 共享数据类型:骨架、生长参数、苔藓参数、布光参数 */

export type Vec3 = [number, number, number];

/** 一根可编辑枝干:一串控制点 + 父子关系 */
export interface BranchSkeleton {
  id: string;
  /** 父枝干 id;主干为 null */
  parentId: string | null;
  /** 在父枝干曲线上的附着位置 0..1 */
  attachT: number;
  /** 控制点(局部坐标,主干为世界坐标) */
  points: Vec3[];
  /** 基部半径 */
  radius: number;
}

export interface SkeletonData {
  branches: BranchSkeleton[];
}

export interface GrowthParams {
  /** 分枝角度(度) */
  branchAngle: number;
  /** 节间距 */
  internodeSpacing: number;
  /** 叶片密度 0..1 */
  leafDensity: number;
  /** 随机种子 */
  seed: number;
  /** 目标细枝数量(约 2000) */
  twigBudget: number;
}

export interface MossParams {
  /** 湿度 0..100,影响颜色与次表面散射 */
  humidity: number;
  /** 苔藓覆盖度 0..1 */
  coverage: number;
  /** 噪声尺度 */
  noiseScale: number;
}

export interface LightingParams {
  keyColor: string;
  keyIntensity: number;
  fillColor: string;
  fillIntensity: number;
  rimColor: string;
  rimIntensity: number;
  ambient: number;
  /** 水面倒影强度 0..1 */
  reflectionStrength: number;
  bloom: number;
}

export interface BonsaiSceneData {
  version: 1;
  skeleton: SkeletonData;
  growth: GrowthParams;
  moss: MossParams;
  lighting: LightingParams;
  /** 被修剪的枝干 id 集合 */
  pruned: string[];
  /** 被修剪的细枝稳定 key 集合 */
  prunedTwigs?: string[];
}

export const DEFAULT_GROWTH: GrowthParams = {
  branchAngle: 42,
  internodeSpacing: 0.55,
  leafDensity: 0.8,
  seed: 20240501,
  twigBudget: 2000,
};

export const DEFAULT_MOSS: MossParams = {
  humidity: 65,
  coverage: 0.7,
  noiseScale: 3.2,
};

export const DEFAULT_LIGHTING: LightingParams = {
  keyColor: '#fff2dd',
  keyIntensity: 2.6,
  fillColor: '#bcd4ff',
  fillIntensity: 0.9,
  rimColor: '#ffe9c4',
  rimIntensity: 1.6,
  ambient: 0.35,
  reflectionStrength: 0.55,
  bloom: 0.35,
};
