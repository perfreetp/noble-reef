/** 格点空间脏矩形（含边界，闭区间） */
export interface DirtyRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const unionRect = (a: DirtyRect | null, b: DirtyRect): DirtyRect => {
  if (!a) return { ...b };
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
};

export const expandRect = (r: DirtyRect, amount: number, size: number): DirtyRect => ({
  minX: Math.max(0, r.minX - amount),
  minY: Math.max(0, r.minY - amount),
  maxX: Math.min(size - 1, r.maxX + amount),
  maxY: Math.min(size - 1, r.maxY + amount),
});

export const rectsOverlap = (a: DirtyRect, b: DirtyRect): boolean =>
  !(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY);

/** 世界坐标矩形（米）与格点脏矩形相交判定，用于设施整平影响路径筛选 */
export const worldRectOverlapsGridRect = (
  world: { minX: number; minZ: number; maxX: number; maxZ: number },
  grid: DirtyRect,
  cellSize: number,
  halfGrid: number,
): boolean => {
  const gMinX = (grid.minX - halfGrid) * cellSize;
  const gMaxX = (grid.maxX - halfGrid) * cellSize;
  const gMinZ = (grid.minY - halfGrid) * cellSize;
  const gMaxZ = (grid.maxY - halfGrid) * cellSize;
  return !(world.maxX < gMinX || gMaxX < world.minX || world.maxZ < gMinZ || gMaxZ < world.minZ);
};
