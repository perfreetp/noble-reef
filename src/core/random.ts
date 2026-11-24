/** 确定性随机数:mulberry32 + 字符串哈希,保证同一种子重建结果一致 */

export function hashSeed(seed: number, salt: number): number {
  let h = (seed >>> 0) ^ Math.imul(salt + 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next: () => number;
  constructor(seed: number, salt = 0) {
    this.next = mulberry32(hashSeed(seed, salt));
  }
  float(min = 0, max = 1): number {
    return min + (max - min) * this.next();
  }
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }
  /** 正态近似 */
  gauss(): number {
    return this.next() + this.next() + this.next() - 1.5;
  }
}
