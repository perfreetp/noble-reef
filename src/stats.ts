import { createSignal } from 'solid-js';
import type { FrameStats, WBGains } from './types';

/** 引擎回传统计数据的本地信号（不走全局 store，避免高频驱动面板树） */
const [frameStats, setFrameStats] = createSignal<FrameStats>({
  hdrMean: { r: 0, g: 0, b: 0 },
  ldrMean: { r: 0, g: 0, b: 0 },
  appliedGains: { r: 1, g: 1, b: 1 },
  fps: 0,
});

/** 最近一帧自动白平衡实际使用的增益（供“自动转手动”抓取） */
const [lastAutoGains, setLastAutoGains] = createSignal<WBGains>({ r: 1, g: 1, b: 1 });

export function useFrameStats() {
  return frameStats;
}

export function updateFrameStats(stats: FrameStats) {
  setFrameStats(stats);
}

export function useLastAutoGains() {
  return lastAutoGains;
}

export function updateLastAutoGains(gains: WBGains) {
  setLastAutoGains({ ...gains });
}
