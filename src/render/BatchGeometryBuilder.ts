import type { Ornament } from '../core/types';

/**
 * 层内批几何(纯数据,无 GPU 依赖):把同层、同素材的所有图元烘焙进一组三角面片。
 * 顶点交错:position(画布坐标,已含平移/缩放/旋转)+ uv + depth。
 * 深度排序在 CPU 端按 ornament.depth 升序写入,后写者覆盖,即层内压盖顺序。
 *
 * RenderEngine 负责把这里的数组包装成 Pixi Buffer/Geometry,
 * 因此本模块可在 Node 下直接做纯逻辑自测。
 */
export interface BatchBuildResult {
  /** 交错顶点数组,每组 5 个 float:x, y, u, v, depth */
  vertices: Float32Array;
  indices: Uint32Array;
  /** 参与构建的图元(深度排序后),拾取复用 */
  ornaments: Ornament[];
  /** 每个图元在 index buffer 中的图元序号区间,拾取后定位用 */
  ranges: { id: string; start: number; count: number }[];
}

export const VERT_STRIDE = 5; // x, y, u, v, depth

export class BatchGeometryBuilder {
  /**
   * @param ornaments 同层且同素材 id 的图元
   * @param size      图元正方形边长(画布像素,未缩放前)
   */
  build(ornaments: Ornament[], size: number): BatchBuildResult {
    const sorted = [...ornaments].sort((a, b) => a.depth - b.depth);
    const vertexCount = sorted.length * 4;
    const indexCount = sorted.length * 6;
    const vertices = new Float32Array(vertexCount * VERT_STRIDE);
    const indices = new Uint32Array(indexCount);
    const ranges: BatchBuildResult['ranges'] = [];

    const half = size / 2;
    const corners = [
      { lx: -half, ly: -half, u: 0, v: 0 },
      { lx: half, ly: -half, u: 1, v: 0 },
      { lx: half, ly: half, u: 1, v: 1 },
      { lx: -half, ly: half, u: 0, v: 1 },
    ];

    let vi = 0;
    let ii = 0;
    sorted.forEach((o, qi) => {
      const cos = Math.cos(o.rotation);
      const sin = Math.sin(o.rotation);
      const base = qi * 4;
      for (const c of corners) {
        const sx = c.lx * o.scale;
        const sy = c.ly * o.scale;
        vertices[vi++] = o.x + sx * cos - sy * sin;
        vertices[vi++] = o.y + sx * sin + sy * cos;
        vertices[vi++] = c.u;
        vertices[vi++] = c.v;
        vertices[vi++] = o.depth;
      }
      indices[ii++] = base;
      indices[ii++] = base + 1;
      indices[ii++] = base + 2;
      indices[ii++] = base;
      indices[ii++] = base + 2;
      indices[ii++] = base + 3;
      ranges.push({ id: o.id, start: qi * 6, count: 6 });
    });

    return { vertices, indices, ornaments: sorted, ranges };
  }
}
