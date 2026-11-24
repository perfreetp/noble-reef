import type { Engine } from '../Engine';
import type { InteractionMode } from '../InteractionMode';
import type { PathManager } from '../paths/PathManager';
import type { TerrainMesh } from '../terrain/TerrainMesh';
import { uiStore, setUiStore } from '../../store/uiStore';
import {
  addControlPoint,
  addPath,
  beginControlPointDrag,
  commitControlPointDrag,
  rollbackMutation,
  updateControlPoint,
} from '../../store/actions';
import type { MutationToken } from '../../store/history';
import { projectStore } from '../../store/projectStore';

/**
 * 步道编辑模式：
 * - 点控制点 handle → 拖拽（射线打地形取 x/z，实时 rebuild，up 提交一条历史）；
 * - 点空白地形 → 向当前选中路径追加控制点（无选中则自动新建路径）。
 */
export class PathEditMode implements InteractionMode {
  private dragging: { pathId: string; cpId: string; token: MutationToken } | null = null;

  constructor(
    private readonly engine: Engine,
    private readonly terrainMesh: TerrainMesh,
    private readonly pathManager: PathManager,
  ) {}

  onActivate(): void {
    this.engine.controls.enabled = true;
  }

  onDeactivate(): void {
    this.cancelDrag();
  }

  onPointerDown(event: PointerEvent): boolean | void {
    if (event.button !== 0) return;
    const handleHit = this.engine.intersectObjects(this.pathManager.allHandles(), false);
    if (handleHit) {
      const info = this.pathManager.findHandle(handleHit.object);
      if (!info) return;
      event.stopPropagation();
      this.engine.controls.enabled = false;
      const token = beginControlPointDrag();
      this.dragging = { ...info, token };
      setUiStore('selection', { kind: 'controlPoint', id: info.cpId, pathId: info.pathId });
      return true;
    }

    const hit = this.engine.intersectTerrain(this.terrainMesh.mesh);
    if (!hit) return;
    event.stopPropagation();
    let pathId: string | null =
      uiStore.selection.kind === 'path' || uiStore.selection.kind === 'controlPoint'
        ? (uiStore.selection.pathId ?? uiStore.selection.id)
        : null;
    if (!pathId || !projectStore.paths[pathId]) {
      pathId = projectStore.pathOrder[projectStore.pathOrder.length - 1] ?? null;
    }
    if (!pathId) pathId = addPath();
    const cpId = addControlPoint(pathId, hit.x, hit.z);
    setUiStore('selection', { kind: 'controlPoint', id: cpId, pathId });
    return true;
  }

  onPointerMove(): void {
    if (!this.dragging) return;
    const hit = this.engine.intersectTerrain(this.terrainMesh.mesh);
    if (!hit) return;
    const { pathId, cpId } = this.dragging;
    updateControlPoint(pathId, cpId, hit.x, hit.z);
    this.pathManager.rebuildImmediate(pathId);
  }

  onPointerUp(): void {
    if (!this.dragging) return;
    commitControlPointDrag(this.dragging.token);
    this.dragging = null;
    this.engine.controls.enabled = true;
  }

  onPointerLeave(): void {
    this.cancelDrag();
  }

  private cancelDrag(): void {
    if (!this.dragging) return;
    const { token } = this.dragging;
    this.dragging = null;
    this.engine.controls.enabled = true;
    // 回滚 begin 之后的所有中间态，且不入历史栈
    rollbackMutation(token);
  }
}
