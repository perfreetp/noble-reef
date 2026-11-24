import { derived, writable } from 'svelte/store';
import type { IntersectionPair } from '../hair/intersect';

export type ToolId = 'select' | 'add' | 'comb' | 'brush';

export const activeTool = writable<ToolId>('select');

/** 当前选中的发束 id 集合 */
export const selection = writable<Set<string>>(new Set());

/** 当前编辑的组（组模式下参数调整按增量联动全组） */
export const activeGroupId = writable<string | null>(null);

/** 发束穿插提示 */
export const intersections = writable<IntersectionPair[]>([]);

/** 模型数据版本号：参数/结构变化时自增，驱动面板刷新 */
export const modelVersion = writable(0);

export function bumpModelVersion(): void {
  modelVersion.update((v) => v + 1);
}

/** 选中发束数量（供面板显示） */
export const selectionCount = derived(selection, (s) => s.size);

/** 梳子/刷子半径 */
export const brushRadius = writable(0.15);
