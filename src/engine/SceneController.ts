import * as THREE from 'three';
import { createEffect } from 'solid-js';
import type { Engine } from './Engine';
import type { InteractionMode } from './InteractionMode';
import { getTerrainService } from './terrain/terrainService';
import { TerrainMesh } from './terrain/TerrainMesh';
import { PathManager } from './paths/PathManager';
import { FacilityManager } from './facilities/FacilityManager';
import { VegetationController } from './vegetation/VegetationController';
import { TourPlayer } from './camera/TourPlayer';
import { BrushMode } from './modes/BrushMode';
import { PathEditMode } from './modes/PathEditMode';
import { FacilityMode } from './modes/FacilityMode';
import { TourMode } from './modes/TourMode';
import { uiStore } from '../store/uiStore';
import { projectStore } from '../store/projectStore';
import { TERRAIN_EXTENT } from '../config/constants';
import type { PageName } from '../types/engine';

/**
 * 场景总账：持有所有 mesh 管理器与交互模式，负责按页面切换模式、
 * 同步 shader uniform，并提供视点关键点标记物。
 */
export class SceneController {
  readonly terrainMesh: TerrainMesh;
  readonly pathManager: PathManager;
  readonly facilityManager: FacilityManager;
  readonly vegetation: VegetationController;
  readonly tourPlayer: TourPlayer;
  readonly viewpointMarkerGroup = new THREE.Group();

  private readonly modes: Record<PageName, InteractionMode>;
  private readonly markerGeo = new THREE.SphereGeometry(1.4, 16, 12);

  constructor(private readonly engine: Engine) {
    const model = getTerrainService().model;

    this.terrainMesh = new TerrainMesh(model);
    this.engine.scene.add(this.terrainMesh.mesh);

    this.addGroundGrid();

    this.pathManager = new PathManager(model);
    this.engine.scene.add(this.pathManager.group);

    this.facilityManager = new FacilityManager();
    this.engine.scene.add(this.facilityManager.group);

    this.vegetation = new VegetationController();
    this.engine.scene.add(this.vegetation.mesh.group);

    this.viewpointMarkerGroup.name = 'viewpoint-markers';
    this.engine.scene.add(this.viewpointMarkerGroup);

    this.tourPlayer = new TourPlayer(engine, this.pathManager, model);

    this.modes = {
      terrain: new BrushMode(engine, this.terrainMesh),
      path: new PathEditMode(engine, this.terrainMesh, this.pathManager),
      facility: new FacilityMode(engine, this.terrainMesh, this.facilityManager),
      viewpoint: new TourMode(this.tourPlayer, engine),
    };

    createEffect(() => this.engine.setMode(this.modes[uiStore.activePage]));
    createEffect(() => this.terrainMesh.setContourInterval(uiStore.brush.contourInterval));
    createEffect(() => this.syncViewpointMarkers());
  }

  /** 设施页切换草稿类型时由 UI 调用 */
  setFacilityDraft(type: import('../types/project').FacilityType | null): void {
    const mode = this.modes.facility;
    if (mode instanceof FacilityMode) mode.draftType = type;
  }

  private syncViewpointMarkers(): void {
    // 追踪 viewpoints 变化
    this.viewpointMarkerGroup.clear();
    for (const vp of projectStore.viewpoints) {
      const rt = this.pathManager.getRuntime(vp.pathId);
      if (!rt) continue;
      const p = rt.sampled.points[Math.min(rt.sampled.points.length - 1, Math.round(vp.t * (rt.sampled.points.length - 1)))]!;
      const mat = new THREE.MeshStandardMaterial({
        color: vp.mode === 'fp' ? 0x38bdf8 : 0xa78bfa,
        emissive: 0x1e3a5f,
      });
      const marker = new THREE.Mesh(this.markerGeo, mat);
      marker.position.set(p.x, p.y + 3, p.z);
      this.viewpointMarkerGroup.add(marker);
    }
  }

  private addGroundGrid(): void {
    const grid = new THREE.GridHelper(TERRAIN_EXTENT, 32, 0x5b6b7a, 0x8494a3);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.25;
    grid.position.y = -0.15;
    this.engine.scene.add(grid);
  }

  dispose(): void {
    this.terrainMesh.dispose();
    this.pathManager.dispose();
    this.facilityManager.dispose();
    this.vegetation.dispose();
    this.markerGeo.dispose();
  }
}
