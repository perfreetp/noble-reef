import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  BonsaiSceneData,
  GrowthParams,
  LightingParams,
  MossParams,
  SkeletonData,
} from './types';
import { DEFAULT_GROWTH, DEFAULT_LIGHTING, DEFAULT_MOSS } from './types';
import { DEFAULT_SKELETON } from './core/defaultSkeleton';

export type ModuleId = 'skeleton' | 'growth' | 'moss' | 'lighting';

interface BonsaiState {
  skeleton: SkeletonData;
  growth: GrowthParams;
  moss: MossParams;
  lighting: LightingParams;
  prunedBranches: string[];
  prunedTwigs: string[];
  activeModule: ModuleId;
  pruneMode: boolean;
  /** 递增以通知场景重建实例缓冲 */
  rebuildNonce: number;
  /** 递增以通知场景重建骨架网格 */
  skeletonNonce: number;

  setSkeleton: (s: SkeletonData) => void;
  setGrowth: (g: Partial<GrowthParams>) => void;
  setMoss: (m: Partial<MossParams>) => void;
  setLighting: (l: Partial<LightingParams>) => void;
  setActiveModule: (m: ModuleId) => void;
  setPruneMode: (p: boolean) => void;
  pruneBranch: (id: string) => void;
  pruneTwig: (key: string) => void;
  resetPruning: () => void;
  requestRebuild: () => void;
  exportScene: () => BonsaiSceneData;
  importScene: (data: BonsaiSceneData) => void;
  resetAll: () => void;
}

/** 播放状态独立存放:每帧变化,不持久化,避免 localStorage 写入抖动 */
export const usePlaybackStore = create<{
  time: number;
  playing: boolean;
  setTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
}>((set) => ({
  time: 0.65,
  playing: false,
  setTime: (time) => set({ time }),
  setPlaying: (playing) => set({ playing }),
}));

export const useBonsaiStore = create<BonsaiState>()(
  persist(
    (set, get) => ({
      skeleton: DEFAULT_SKELETON,
      growth: DEFAULT_GROWTH,
      moss: DEFAULT_MOSS,
      lighting: DEFAULT_LIGHTING,
      prunedBranches: [],
      prunedTwigs: [],
      activeModule: 'skeleton',
      pruneMode: false,
      rebuildNonce: 0,
      skeletonNonce: 0,

      setSkeleton: (skeleton) =>
        set((s) => ({ skeleton, skeletonNonce: s.skeletonNonce + 1, rebuildNonce: s.rebuildNonce + 1 })),
      setGrowth: (g) =>
        set((s) => ({ growth: { ...s.growth, ...g }, rebuildNonce: s.rebuildNonce + 1 })),
      setMoss: (m) => set((s) => ({ moss: { ...s.moss, ...m } })),
      setLighting: (l) => set((s) => ({ lighting: { ...s.lighting, ...l } })),
      setActiveModule: (activeModule) => set({ activeModule }),
      setPruneMode: (pruneMode) => set({ pruneMode }),
      pruneBranch: (id) =>
        set((s) => ({
          prunedBranches: [...new Set([...s.prunedBranches, id])],
          rebuildNonce: s.rebuildNonce + 1,
        })),
      pruneTwig: (key) =>
        set((s) => ({
          prunedTwigs: [...new Set([...s.prunedTwigs, key])],
          rebuildNonce: s.rebuildNonce + 1,
        })),
      resetPruning: () =>
        set((s) => ({ prunedBranches: [], prunedTwigs: [], rebuildNonce: s.rebuildNonce + 1 })),
      requestRebuild: () => set((s) => ({ rebuildNonce: s.rebuildNonce + 1 })),
      exportScene: () => {
        const s = get();
        return {
          version: 1,
          skeleton: s.skeleton,
          growth: s.growth,
          moss: s.moss,
          lighting: s.lighting,
          pruned: s.prunedBranches,
          prunedTwigs: s.prunedTwigs,
        };
      },
      importScene: (data) =>
        set((s) => ({
          skeleton: data.skeleton,
          growth: data.growth,
          moss: data.moss,
          lighting: data.lighting,
          prunedBranches: data.pruned ?? [],
          prunedTwigs: data.prunedTwigs ?? [],
          rebuildNonce: s.rebuildNonce + 1,
          skeletonNonce: s.skeletonNonce + 1,
        })),
      resetAll: () =>
        set((s) => ({
          skeleton: DEFAULT_SKELETON,
          growth: DEFAULT_GROWTH,
          moss: DEFAULT_MOSS,
          lighting: DEFAULT_LIGHTING,
          prunedBranches: [],
          prunedTwigs: [],
          rebuildNonce: s.rebuildNonce + 1,
          skeletonNonce: s.skeletonNonce + 1,
        })),
    }),
    {
      name: 'bonsai-studio-v1',
      partialize: (s) => ({
        skeleton: s.skeleton,
        growth: s.growth,
        moss: s.moss,
        lighting: s.lighting,
        prunedBranches: s.prunedBranches,
        prunedTwigs: s.prunedTwigs,
        // time 每帧变化,不持久化,避免 localStorage 写入抖动
      }),
    },
  ),
);

/** 导出场景为 JSON 文件下载 */
export function downloadSceneFile(data: BonsaiSceneData): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bonsai-scene-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 校验并解析导入文件 */
export function parseSceneFile(text: string): BonsaiSceneData {
  const data = JSON.parse(text) as BonsaiSceneData;
  if (data.version !== 1 || !data.skeleton?.branches || !data.growth || !data.moss || !data.lighting) {
    throw new Error('文件格式不正确:缺少必要字段');
  }
  return data;
}
