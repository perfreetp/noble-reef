import * as THREE from 'three';
import type { Engine } from '../Engine';
import type { PathManager } from '../paths/PathManager';
import type { TerrainModel } from '../terrain/TerrainModel';
import { buildTimeline, sampleFrame, type TimelineSegment } from './pathFrame';
import type { CameraMode, Viewpoint } from '../../types/project';
import { setUiStore, uiStore } from '../../store/uiStore';
import { projectStore } from '../../store/projectStore';
import { TOUR_PROGRESS_UI_INTERVAL_MS } from '../../config/constants';

/**
 * 漫游播放器：rAF 内直接驱动 engine.camera（不经 Solid 响应式），
 * 进度按 ~10Hz 节流回写 uiStore.tour.progress 供时间轴显示。
 */
export class TourPlayer {
  private progress = 0;
  private segments: TimelineSegment[] = [];
  private lastUiPush = 0;
  private readonly lookTarget = new THREE.Vector3();
  private lookInitialized = false;
  private mode: CameraMode = 'fp';
  private offFrame: (() => void) | null = null;

  constructor(
    private readonly engine: Engine,
    private readonly pathManager: PathManager,
    private readonly model: TerrainModel,
  ) {}

  activate(): void {
    this.engine.controls.enabled = false;
    this.mode = uiStore.tour.mode;
    this.segments = buildTimeline(this.viewpoints());
    this.progress = uiStore.tour.progress;
    this.lookInitialized = false;
    this.offFrame = this.engine.onFrame((delta) => this.tick(delta));
    this.renderFrame();
  }

  deactivate(): void {
    this.offFrame?.();
    this.offFrame = null;
    this.engine.controls.enabled = true;
    setUiStore('tour', 'playing', false);
  }

  play(): void {
    if (this.progress >= 1) this.progress = 0;
    setUiStore('tour', 'playing', true);
  }

  pause(): void {
    setUiStore('tour', 'playing', false);
  }

  seek(p: number): void {
    this.progress = Math.min(1, Math.max(0, p));
    setUiStore('tour', 'progress', this.progress);
    this.renderFrame();
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    setUiStore('tour', 'mode', mode);
    this.renderFrame();
  }

  private viewpoints(): Viewpoint[] {
    // 直接读 store，保证编辑关键点后立即生效
    return projectStore.viewpoints;
  }

  private tick(delta: number): void {
    this.segments = buildTimeline(this.viewpoints());
    if (this.segments.length < 1 || !uiStore.tour.playing) {
      this.renderFrame();
      return;
    }
    const totalDuration = this.segments.reduce(
      (a, s) => a + Math.max(0.1, s.vp.durationSec),
      0,
    );
    this.progress += delta / totalDuration;
    if (this.progress >= 1) {
      this.progress = 1;
      setUiStore('tour', 'playing', false);
    }
    const now = performance.now();
    if (now - this.lastUiPush > TOUR_PROGRESS_UI_INTERVAL_MS) {
      this.lastUiPush = now;
      setUiStore('tour', 'progress', this.progress);
    }
    this.renderFrame();
  }

  private renderFrame(): void {
    if (this.segments.length === 0) return;
    const seg = this.locateSegment();
    if (!seg) return;
    const runtime = this.pathManager.getRuntime(seg.vp.pathId);
    if (!runtime) return;
    const u = (this.progress - seg.startProgress) / Math.max(1e-6, seg.endProgress - seg.startProgress);
    const t = seg.startT + (seg.endT - seg.startT) * Math.min(1, Math.max(0, u));
    const frame = sampleFrame(runtime.sampled, t, this.mode, this.model, seg.vp.eyeHeight);
    this.engine.camera.position.copy(frame.position);
    if (!this.lookInitialized) {
      this.lookTarget.copy(frame.lookAt);
      this.lookInitialized = true;
    } else {
      this.lookTarget.lerp(frame.lookAt, 0.4);
    }
    this.engine.camera.lookAt(this.lookTarget);
  }

  private locateSegment(): TimelineSegment | null {
    const seg = this.segments.find(
      (s) => this.progress >= s.startProgress && this.progress <= s.endProgress,
    );
    return seg ?? this.segments[this.segments.length - 1] ?? null;
  }
}
