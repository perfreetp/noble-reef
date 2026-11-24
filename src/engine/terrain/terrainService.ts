import { TerrainModel } from './TerrainModel';

/**
 * 地形服务：全局唯一 TerrainModel 持有者。
 * TerrainModel 本身是纯 TS（不依赖 three.js/DOM），store action 与渲染层共用同一实例，
 * 保证 store 中的 heights 与模型计算用的 heights 始终是同一个 TypedArray 引用。
 */
class TerrainService {
  readonly model: TerrainModel;

  constructor(initialHeights: Float32Array, size: number, cellSize: number) {
    this.model = new TerrainModel(size, cellSize, initialHeights);
  }

  /** 换用新的高度场数组（stroke 开始克隆、撤销重做、导入时调用），全量重算法线 */
  adopt(heights: Float32Array): void {
    if (heights === this.model.heights) return;
    // TerrainModel 的 heights 为 readonly 引用，构造替换语义通过内部方法实现
    (this.model as { heights: Float32Array }).heights = heights;
    this.model.recomputeNormals();
  }
}

let service: TerrainService | null = null;

export const initTerrainService = (
  heights: Float32Array,
  size: number,
  cellSize: number,
): TerrainService => {
  service = new TerrainService(heights, size, cellSize);
  return service;
};

export const getTerrainService = (): TerrainService => {
  if (!service) throw new Error('TerrainService 尚未初始化');
  return service;
};
