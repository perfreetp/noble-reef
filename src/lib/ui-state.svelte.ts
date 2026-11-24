// 全局 UI 状态（Svelte 5 runes，组件与 Pixi 引擎共享）

export type PageId = 'layout' | 'timeline' | 'preview' | 'config';
export type ToolId = 'select' | 'addRect' | 'addRing' | 'addSingle';

class UiState {
  page = $state<PageId>('layout');
  tool = $state<ToolId>('select');
  /** 画布选中的喷头 id */
  selection = $state<Set<string>>(new Set());
  /** 时间轴/分组列表悬停的分组 id，画布实时高亮 */
  hoverGroupId = $state<string>('');
  /** 画布悬停喷头所属分组，时间轴同步高亮行 */
  hoverNozzleGroupId = $state<string>('');
  /** 新建阵列/单喷头时默认归属的分组 */
  activeGroupId = $state<string>('');
  /** 配置页是否正在编辑水池（控制手柄显示） */
  poolEditing = $state(true);
  /** 播放页是否显示落点标记 */
  showLanding = $state(true);
  /** 播放页是否显示网格 */
  showGrid = $state(true);

  get mode(): 'layout' | 'preview' | 'config' {
    return this.page === 'preview' ? 'preview' : this.page === 'config' ? 'config' : 'layout';
  }

  selectOnly(ids: string[]) {
    this.selection = new Set(ids);
  }

  toggleSelection(id: string) {
    const next = new Set(this.selection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selection = next;
  }

  addSelection(ids: string[]) {
    const next = new Set(this.selection);
    for (const id of ids) next.add(id);
    this.selection = next;
  }

  clearSelection() {
    if (this.selection.size === 0) return;
    this.selection = new Set();
  }

  get selectedCount(): number {
    return this.selection.size;
  }
}

export const ui = new UiState();
