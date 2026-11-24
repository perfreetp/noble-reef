import { mulberry32 } from '../../util/rng';

/**
 * 轻量 2D value noise + fBm，确定性生成山地高度场。
 * 不引入第三方噪声库；格点哈希 + 平滑插值，可在 node 测试环境直接运行。
 */

const hash2 = (ix: number, iy: number, seed: number): number => {
  let h = seed ^ Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const valueNoise = (x: number, y: number, seed: number): number => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const v00 = hash2(x0, y0, seed);
  const v10 = hash2(x0 + 1, y0, seed);
  const v01 = hash2(x0, y0 + 1, seed);
  const v11 = hash2(x0 + 1, y0 + 1, seed);
  const a = v00 + (v10 - v00) * sx;
  const b = v01 + (v11 - v01) * sx;
  return a + (b - a) * sy; // 0..1
};

/** 分形布朗运动：多倍频叠加 */
export const fbm = (
  x: number,
  y: number,
  seed: number,
  octaves = 5,
  lacunarity = 2,
  gain = 0.5,
): number => {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 1013);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm; // 0..1
};

export interface GeneratedTerrain {
  heights: Float32Array;
  seed: number;
}

/**
 * 生成程序化山地：
 * - 大尺度 fBm 决定主体起伏；
 * - 径向衰减使边缘降低，留出园区边界缓冲；
 * - 一条幂函数山脊增强“山地”特征。
 */
export const generateMountainTerrain = (
  size: number,
  seed: number,
  options?: { maxHeight?: number; baseFrequency?: number },
): GeneratedTerrain => {
  const maxHeight = options?.maxHeight ?? 60;
  const baseFrequency = options?.baseFrequency ?? 2.2;
  const rng = mulberry32(seed);
  const ridgeAngle = rng() * Math.PI * 2;
  const ridgeOffset = (rng() - 0.5) * size * 0.25;
  const heights = new Float32Array(size * size);
  const half = (size - 1) / 2;

  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      const nx = gx / size;
      const ny = gy / size;
      const broad = fbm(nx * baseFrequency, ny * baseFrequency, seed, 5);
      // 细节层
      const detail = fbm(nx * baseFrequency * 4, ny * baseFrequency * 4, seed + 777, 3);
      // 距中心归一化距离，边缘衰减到 0.15
      const dx = (gx - half) / half;
      const dz = (gy - half) / half;
      const dist = Math.min(1, Math.hypot(dx, dz));
      const edgeFalloff = 1 - 0.85 * Math.pow(dist, 2.5);

      // 山脊：沿随机方向的条带抬升
      const ridgeCoord =
        (gx - half) * Math.cos(ridgeAngle) + (gy - half) * Math.sin(ridgeAngle) - ridgeOffset;
      const ridge = Math.exp(-Math.pow(ridgeCoord / (size * 0.09), 2));

      let h = (broad * 0.75 + detail * 0.25) * maxHeight * edgeFalloff;
      h += ridge * maxHeight * 0.45 * edgeFalloff;
      heights[gy * size + gx] = Math.max(0, h);
    }
  }
  return { heights, seed };
};

export const createFlatTerrain = (size: number): Float32Array => new Float32Array(size * size);
