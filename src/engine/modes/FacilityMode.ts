import type { Engine } from '../Engine';
import type { InteractionMode } from '../InteractionMode';
import type { TerrainMesh } from '../terrain/TerrainMesh';
import type { FacilityManager } from '../facilities/FacilityManager';
import type { FacilityType } from '../../types/project';
import { getCatalogEntry } from '../../config/facilityCatalog';
import {
  addFacility,
  beginFacilityMove,
  commitFacilityMove,
  deleteFacility,
  rollbackMutation,
  updateFacilityPosition,
} from '../../store/actions';
import { setUiStore, uiStore } from '../../store/uiStore';
import type { MutationToken } from '../../store/history';
import { TERRAIN_EXTENT } from '../../config/constants';

/**
 * 设施模式：
 * - 设置 draftType 后，移动鼠标显示占地预览圈，单击放置（复合命令：整平 + 记录）；
 * - 点已有设施进入拖拽移动（commit 时一次性整平，避免每帧改地形）；
 * - Delete 键删除选中设施。
 */
export class FacilityMode implements InteractionMode {
  draftType: FacilityType | null = null;
  private dragging: { facilityId: string; token: MutationToken } | null = null;
  private readonly keyHandler: (e: KeyboardEvent) => void;

  constructor(
    private readonly engine: Engine,
    private readonly terrainMesh: TerrainMesh,
    private readonly manager: FacilityManager,
  ) {
    this.keyHandler = (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && uiStore.selection.kind === 'facility') {
        const id = uiStore.selection.id;
        if (id) {
          deleteFacility(id);
          this.manager.hideSelectionRing();
          setUiStore('selection', { kind: 'none', id: null });
        }
      }
    };
  }

  onActivate(): void {
    this.engine.controls.enabled = true;
    window.addEventListener('keydown', this.keyHandler);
  }

  onDeactivate(): void {
    this.cancelDrag();
    this.draftType = null;
    this.manager.hidePreview();
    this.manager.hideSelectionRing();
    window.removeEventListener('keydown', this.keyHandler);
  }

  onPointerMove(): void {
    if (this.dragging) {
      const hit = this.engine.intersectTerrain(this.terrainMesh.mesh);
      if (!hit) return;
      updateFacilityPosition(this.dragging.facilityId, hit.x, hit.z);
      return;
    }
    if (!this.draftType) return;
    const hit = this.engine.intersectTerrain(this.terrainMesh.mesh);
    if (!hit) {
      this.manager.hidePreview();
      return;
    }
    const catalog = getCatalogEntry(this.draftType);
    const r =
      catalog.footprint.shape === 'circle'
        ? catalog.footprint.radius
        : Math.max(catalog.footprint.w, catalog.footprint.d) / 2;
    const valid = Math.abs(hit.x) < TERRAIN_EXTENT / 2 && Math.abs(hit.z) < TERRAIN_EXTENT / 2;
    this.manager.showPreview(r, hit.x, hit.y, hit.z, valid);
  }

  onPointerDown(event: PointerEvent): boolean | void {
    if (event.button !== 0) return;
    // 优先拾取已有设施 → 拖拽
    const facHit = this.engine.intersectObjects(this.manager.allMeshes(), true);
    if (facHit) {
      const id = this.manager.findFacilityId(facHit.object);
      if (id) {
        event.stopPropagation();
        this.engine.controls.enabled = false;
        this.dragging = { facilityId: id, token: beginFacilityMove() };
        setUiStore('selection', { kind: 'facility', id });
        return true;
      }
    }
    // 否则放置新设施
    if (!this.draftType) return;
    const hit = this.engine.intersectTerrain(this.terrainMesh.mesh);
    if (!hit) return;
    event.stopPropagation();
    const id = addFacility(this.draftType, hit.x, hit.z);
    setUiStore('selection', { kind: 'facility', id });
    return true;
  }

  onPointerUp(): void {
    if (!this.dragging) return;
    commitFacilityMove(this.dragging.token, this.dragging.facilityId);
    this.dragging = null;
    this.engine.controls.enabled = true;
  }

  onPointerLeave(): void {
    this.cancelDrag();
    this.manager.hidePreview();
  }

  private cancelDrag(): void {
    if (!this.dragging) return;
    const { token } = this.dragging;
    this.dragging = null;
    this.engine.controls.enabled = true;
    rollbackMutation(token);
  }
}
