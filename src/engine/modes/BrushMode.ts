import * as THREE from 'three';
import type { Engine } from '../Engine';
import type { InteractionMode } from '../InteractionMode';
import { getTerrainService } from '../terrain/terrainService';
import { applyRaiseLower, applySmooth, makeKernel } from '../terrain/brush';
import { BRUSH_MAX_DT, BRUSH_RADII } from '../../config/constants';
import { uiStore } from '../../store/uiStore';
import { beginTerrainStroke, cancelTerrainStroke, commitTerrainStroke } from '../../store/actions';
import type { MutationToken } from '../../store/history';
import { expandRect, unionRect, type DirtyRect } from '../../util/dirtyRect';
import type { TerrainMesh } from '../terrain/TerrainMesh';

/**
 * 地形笔刷模式：
 * pointerdown 开始 stroke（克隆工作数组 + 历史 token），拖动连续作用，
 * pointerup 一次提交；每帧只做脏矩形法线/几何更新，路径与植被等 stroke 结束再联动。
 */
export class BrushMode implements InteractionMode {
  private painting = false;
  private token: MutationToken | null = null;
  private dirty: DirtyRect | null = null;
  private lastTime = 0;
  private readonly cursor: THREE.Mesh;
  private readonly kernelCache = BRUSH_RADII.map((r) => makeKernel(r));

  constructor(
    private readonly engine: Engine,
    private readonly terrainMesh: TerrainMesh,
  ) {
    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(0.96, 1, 48),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    this.cursor.rotation.x = -Math.PI / 2;
    this.cursor.visible = false;
    this.cursor.renderOrder = 999;
    this.engine.scene.add(this.cursor);
  }

  onActivate(): void {
    this.cursor.visible = true;
    this.engine.controls.enabled = true;
  }

  onDeactivate(): void {
    this.finishStroke(true);
    this.cursor.visible = false;
  }

  onPointerMove(event: PointerEvent): void {
    const hit = this.engine.intersectTerrain(this.terrainMesh.mesh);
    if (!hit) {
      this.cursor.visible = false;
      return;
    }
    this.cursor.visible = true;
    const radiusCells = BRUSH_RADII[uiStore.brush.radiusIdx] ?? BRUSH_RADII[1]!;
    const radiusWorld = radiusCells * getTerrainService().model.cellSize;
    this.cursor.position.set(hit.x, hit.y + 0.4, hit.z);
    this.cursor.scale.setScalar(radiusWorld);
    if (this.painting) this.applyAt(hit.x, hit.z, event.timeStamp);
  }

  onPointerDown(event: PointerEvent): boolean | void {
    if (event.button !== 0) return;
    const hit = this.engine.intersectTerrain(this.terrainMesh.mesh);
    if (!hit) return;
    event.stopPropagation();
    this.engine.controls.enabled = false;
    this.painting = true;
    this.dirty = null;
    this.token = beginTerrainStroke(
      uiStore.brush.mode === 'smooth' ? '平滑地形' : uiStore.brush.mode === 'raise' ? '抬升地形' : '压低地形',
    );
    this.lastTime = event.timeStamp;
    this.applyAt(hit.x, hit.z, event.timeStamp);
    return true;
  }

  onPointerUp(): void {
    this.finishStroke(false);
  }

  onPointerLeave(): void {
    this.cursor.visible = false;
    this.finishStroke(false);
  }

  private applyAt(wx: number, wz: number, timeStamp: number): void {
    if (!this.token) return;
    const model = getTerrainService().model;
    const { gx, gy } = model.worldToGrid(wx, wz);
    const kernel = this.kernelCache[uiStore.brush.radiusIdx] ?? this.kernelCache[1]!;
    const dt = Math.min(BRUSH_MAX_DT, Math.max(0.008, (timeStamp - this.lastTime) / 1000));
    this.lastTime = timeStamp;

    let rect: DirtyRect;
    if (uiStore.brush.mode === 'smooth') {
      rect = applySmooth(model, gx, gy, kernel, uiStore.brush.smoothFactor);
    } else {
      rect = applyRaiseLower(
        model,
        gx,
        gy,
        uiStore.brush.mode === 'raise' ? 1 : -1,
        uiStore.brush.strength,
        dt,
        kernel,
      );
    }
    this.dirty = unionRect(this.dirty, rect);
    const normalRect = expandRect(rect, 1, model.size);
    model.recomputeNormals(normalRect);
    this.terrainMesh.uploadDirty(expandRect(rect, 1, model.size));
  }

  private finishStroke(cancel: boolean): void {
    if (!this.painting) return;
    this.painting = false;
    this.engine.controls.enabled = true;
    if (this.token) {
      if (cancel || !this.dirty) cancelTerrainStroke(this.token);
      else {
        this.terrainMesh.endStroke();
        commitTerrainStroke(this.token);
      }
    }
    this.token = null;
    this.dirty = null;
  }

  dispose(): void {
    this.engine.scene.remove(this.cursor);
    this.cursor.geometry.dispose();
    (this.cursor.material as THREE.Material).dispose();
  }
}
