import { Application, FederatedPointerEvent, UPDATE_PRIORITY } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import type { RectArraySpec, RingArraySpec } from '../types';
import { store } from '../store.svelte';
import { ui } from '../ui-state.svelte';
import { player } from '../player.svelte';
import { angleVec, vecAngle } from '../util';
import { makeHandleTexture, makeLandingTexture, makeNozzleTexture, makeStreakTexture, makeWaterBaseTexture } from './textures';
import { NozzleLayer } from './nozzle-layer';
import { GridLayer, OverlayLayer, PlazaLayer, poolHandlePositions, type PoolHandleId } from './env-layers';

const WORLD_EXTENT = 20000;
const ROTATE_HANDLE_PX = 52;
const HANDLE_HIT_PX = 16;

type DragState =
  | { kind: 'none' }
  | { kind: 'nozzle'; ids: string[]; moved: boolean; startX: number; startY: number }
  | { kind: 'rubber'; startX: number; startY: number; additive: boolean; moved: boolean }
  | { kind: 'rotate'; id: string }
  | { kind: 'pool'; handle: PoolHandleId; startPool: { x: number; y: number; width: number; height: number } }
  | { kind: 'place'; startX: number; startY: number };

export interface EngineCallbacks {
  onNozzleClick?: (id: string, additive: boolean) => void;
  onHoverNozzle?: (id: string) => void;
}

/**
 * Pixi 主引擎：Application + viewport + 分层渲染 + 指针交互 + 帧循环。
 * 一个实例随整个应用生命周期存在，页面切换只改变渲染模式。
 */
export class PlazaEngine {
  private app: Application;
  private viewport!: Viewport;
  private nozzleLayer!: NozzleLayer;
  private grid = new GridLayer();
  private plaza = new PlazaLayer();
  private overlay = new OverlayLayer();
  private cb: EngineCallbacks;
  private container: HTMLElement;
  private resizeObs!: ResizeObserver;

  private drag: DragState = { kind: 'none' };
  private hoverId = '';
  private spaceDown = false;
  private snapEnabled = false;
  private lastStructVersion = -1;
  private lastStoreVersion = -1;
  private lastBeatIndex = -1;
  private destroyed = false;
  private currentScale = 1;

  // 阵列放置预览参数（由 Svelte 面板写入）
  ghostSpec: ({ kind: 'rect'; spec: RectArraySpec } | { kind: 'ring'; spec: RingArraySpec } | null) = null;
  private ghostAt: { x: number; y: number } | null = null;

  constructor(container: HTMLElement, cb: EngineCallbacks = {}) {
    this.container = container;
    this.cb = cb;
    this.app = new Application();
  }

  async init() {
    await this.app.init({
      resizeTo: this.container,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      background: '#1a2330',
      preference: 'webgl'
    });
    this.container.appendChild(this.app.canvas);

    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.viewport = new Viewport({
      screenWidth: width,
      screenHeight: height,
      worldWidth: WORLD_EXTENT * 2,
      worldHeight: WORLD_EXTENT * 2,
      events: this.app.renderer.events
    });
    this.viewport.position.set(width / 2, height / 2);
    this.viewport
      .drag({ mouseButtons: 'middle-right', keyToPress: ['Space'], ignoreKeyToPressOnTouch: true })
      .wheel({ percent: 0.22, smooth: 6 })
      .decelerate({ friction: 0.88 })
      .pinch()
      .clampZoom({ minScale: 0.04, maxScale: 8 });
    this.app.stage.addChild(this.viewport);

    // 纹理与图层
    const nozzleTex = makeNozzleTexture();
    this.nozzleLayer = new NozzleLayer(nozzleTex, makeWaterBaseTexture(), makeStreakTexture(), makeLandingTexture());

    this.viewport.addChild(this.plaza, this.grid, this.nozzleLayer.container, this.overlay);
    // 所有子图层均不参与命中：交互统一由 viewport 接收 + 手动命中检测
    for (const child of this.viewport.children) child.eventMode = 'none';
    // viewport 自身接收全部指针事件（其内部插件仍正常工作）
    this.viewport.eventMode = 'static';

    this.bindEvents();
    this.nozzleLayer.rebuild(store.doc);
    this.lastStructVersion = store.structureVersion;
    this.lastStoreVersion = store.version;

    this.resizeObs = new ResizeObserver(() => this.handleResize());
    this.resizeObs.observe(this.container);

    // 应用渲染回调优先级为 LOW(-25)；UTILITY(-50) 在其后执行，用于测量纯渲染耗时
    this.app.ticker.add(this.onAfterRender, this, UPDATE_PRIORITY.UTILITY);

    this.app.ticker.add(this.tick);
  }

  private renderStart = 0;
  private onAfterRender = () => {
    if (this.renderStart) this.perf.renderMs = performance.now() - this.renderStart;
  };

  // ---------------- 事件绑定 ----------------
  private bindEvents() {
    // 全部指针交互在 viewport 层处理，命中对象由 pick* 系列手动检测
    this.viewport.on('pointermove', this.onViewportMove);
    this.viewport.on('pointerdown', this.onViewportDown);
    this.viewport.on('pointerup', this.onViewportUp);
    this.viewport.on('pointerupoutside', this.onViewportUp);
    this.viewport.on('pointerleave', this.onPointerLeave);
    this.viewport.on('zoomed', () => {
      this.currentScale = this.viewport.scale.x;
      this.overlay.setScale(this.currentScale);
      this.overlay.setHandleWorldSize(20, this.currentScale);
    });
    this.viewport.on('moved', () => {
      this.currentScale = this.viewport.scale.x;
    });

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.currentScale = this.viewport.scale.x;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Space' && !this.isTypingTarget(e.target)) {
      this.spaceDown = true;
      this.app.canvas.style.cursor = 'grab';
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      this.spaceDown = false;
      this.app.canvas.style.cursor = '';
    }
  };

  private isTypingTarget(t: EventTarget | null): boolean {
    return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
  }

  // ---------------- 命中检测 ----------------
  private pickNozzle(screenX: number, screenY: number): string | null {
    const doc = store.doc;
    // 命中半径略小于标记半径，兼顾密集阵列间隙可点与操作容差
    const hitR = 12;
    let best: string | null = null;
    let bestD = hitR;
    for (let i = doc.nozzles.length - 1; i >= 0; i--) {
      const n = doc.nozzles[i];
      const s = this.viewport.toScreen(n.x, n.y);
      const d = Math.hypot(s.x - screenX, s.y - screenY);
      if (d <= bestD) {
        bestD = d;
        best = n.id;
      }
    }
    return best;
  }

  private pickPoolHandle(screenX: number, screenY: number): PoolHandleId | null {
    if (ui.mode !== 'config') return null;
    for (const h of poolHandlePositions(store.doc.config.pool)) {
      const s = this.viewport.toScreen(h.x, h.y);
      if (Math.hypot(s.x - screenX, s.y - screenY) <= HANDLE_HIT_PX) return h.id;
    }
    return null;
  }

  private pickRotateHandle(screenX: number, screenY: number): string | null {
    if (ui.mode !== 'layout' || ui.selection.size !== 1) return null;
    const id = [...ui.selection][0];
    const n = store.nozzleById(id);
    if (!n) return null;
    const rWorld = ROTATE_HANDLE_PX / this.currentScale;
    const v = angleVec(n.angle);
    const s = this.viewport.toScreen(n.x + v.x * rWorld, n.y + v.y * rWorld);
    return Math.hypot(s.x - screenX, s.y - screenY) <= HANDLE_HIT_PX ? id : null;
  }

  private screenPos(e: FederatedPointerEvent) {
    return { x: e.global.x, y: e.global.y };
  }

  // ---------------- 指针流程 ----------------
  private onViewportDown = (e: FederatedPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return; // 右键/中键交给 viewport 平移
    const { x: sx, y: sy } = this.screenPos(e);

    // 0. 布置工具（阵列/单喷头）：优先处理空白处放置
    if (ui.mode === 'layout' && ui.tool !== 'select') {
      if (!this.pickNozzle(sx, sy)) {
        this.drag = { kind: 'place', startX: sx, startY: sy };
        return;
      }
    }

    // 1. 配置页水池手柄
    const handle = this.pickPoolHandle(sx, sy);
    if (handle) {
      const p = store.doc.config.pool;
      this.drag = {
        kind: 'pool',
        handle,
        startPool: { x: p.x, y: p.y, width: p.width, height: p.height }
      };
      store.beginInteraction();
      return;
    }

    // 2. 旋转手柄
    const rotId = this.pickRotateHandle(sx, sy);
    if (rotId) {
      this.drag = { kind: 'rotate', id: rotId };
      store.beginInteraction();
      return;
    }

    // 3. 喷头
    const id = this.pickNozzle(sx, sy);
    if (id) {
      const additive = e.metaKey || e.ctrlKey || e.shiftKey;
      if (!ui.selection.has(id)) {
        if (additive) ui.addSelection([id]);
        else ui.selectOnly([id]);
      }
      const ids = [...ui.selection];
      this.drag = {
        kind: 'nozzle',
        ids: ui.selection.has(id) ? ids : [id],
        moved: false,
        startX: sx,
        startY: sy
      };
      store.beginInteraction();
      this.cb.onNozzleClick?.(id, additive);
      return;
    }

    // 4. 空白处：布置页进入框选
    if (ui.mode === 'layout') {
      this.drag = { kind: 'rubber', startX: sx, startY: sy, additive: e.shiftKey || e.ctrlKey || e.metaKey, moved: false };
    }
  };

  private onViewportMove = (e: FederatedPointerEvent) => {
    const { x: sx, y: sy } = this.screenPos(e);
    const world = this.viewport.toWorld(sx, sy);

    // 阵列工具的悬停预览
    if (ui.tool !== 'select' && ui.mode === 'layout' && this.drag.kind !== 'place') {
      this.ghostAt = world;
    } else if (this.drag.kind !== 'place') {
      this.ghostAt = null;
    }

    if (this.drag.kind === 'nozzle') {
      if (Math.hypot(sx - this.drag.startX, sy - this.drag.startY) > 3) this.drag.moved = true;
      if (this.drag.moved) {
        const grid = this.snapEnabled ? store.doc.config.gridSize : 0;
        for (const id of this.drag.ids) {
          const n = store.nozzleById(id);
          if (!n) continue;
          let nx = world.x;
          let ny = world.y;
          if (grid > 0) {
            nx = Math.round(nx / grid) * grid;
            ny = Math.round(ny / grid) * grid;
          }
          store.moveNozzle(id, nx, ny);
        }
      }
      return;
    }

    if (this.drag.kind === 'rotate') {
      const n = store.nozzleById(this.drag.id);
      if (n) {
        let deg = vecAngle(world.x - n.x, world.y - n.y);
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        store.setNozzleAngle(this.drag.id, deg);
      }
      return;
    }

    if (this.drag.kind === 'pool') {
      this.applyPoolDrag(world.x, world.y, e.shiftKey);
      return;
    }

    if (this.drag.kind === 'rubber') {
      const a = this.viewport.toWorld(this.drag.startX, this.drag.startY);
      if (Math.hypot(sx - this.drag.startX, sy - this.drag.startY) > 3) this.drag.moved = true;
      this.overlay.drawRubberBand({
        x: Math.min(a.x, world.x),
        y: Math.min(a.y, world.y),
        width: Math.abs(world.x - a.x),
        height: Math.abs(world.y - a.y)
      });
      if (this.drag.moved) {
        const hit = this.nozzlesInRect(a.x, a.y, world.x, world.y);
        if (this.drag.additive) ui.addSelection(hit);
        else ui.selectOnly(hit);
      }
      return;
    }

    // 悬停高亮
    const id = this.pickNozzle(sx, sy);
    if (id !== this.hoverId) {
      this.hoverId = id ?? '';
      this.cb.onHoverNozzle?.(this.hoverId);
      if (id) {
        const n = store.nozzleById(id);
        ui.hoverNozzleGroupId = n?.groupId ?? '';
        this.app.canvas.style.cursor = 'pointer';
      } else {
        ui.hoverNozzleGroupId = '';
        if (!this.spaceDown) this.app.canvas.style.cursor = '';
      }
    }
  };

  private onViewportUp = (e: FederatedPointerEvent) => {
    const d = this.drag;
    if (d.kind === 'nozzle' || d.kind === 'rotate' || d.kind === 'pool') {
      store.endInteraction();
      this.drag = { kind: 'none' };
      return;
    }
    if (d.kind === 'rubber') {
      this.overlay.drawRubberBand(null);
      // 未拖动的空白点击：清除选择
      if (!d.moved) ui.clearSelection();
      this.drag = { kind: 'none' };
      return;
    }
    if (d.kind === 'place') {
      // 视为点击（容忍微小移动），在抬手位置放置
      if (Math.hypot(e.global.x - d.startX, e.global.y - d.startY) <= 6) {
        const world = this.viewport.toWorld(e.global.x, e.global.y);
        this.placeWithTool(world.x, world.y);
      }
      this.drag = { kind: 'none' };
    }
  };

  private onPointerLeave = () => {
    this.hoverId = '';
    ui.hoverNozzleGroupId = '';
    this.ghostAt = null;
  };

  // ---------------- 工具放置 ----------------
  setSnap(v: boolean) {
    this.snapEnabled = v;
  }

  private placeWithTool(x: number, y: number) {
    const grid = this.snapEnabled ? store.doc.config.gridSize : 0;
    const wx = grid > 0 ? Math.round(x / grid) * grid : x;
    const wy = grid > 0 ? Math.round(y / grid) * grid : y;
    const groupId = ui.activeGroupId;
    if (ui.tool === 'addSingle') {
      store.addSingleNozzle(wx, wy, groupId);
    } else if (ui.tool === 'addRect' && this.ghostSpec?.kind === 'rect') {
      store.addRectArray(wx, wy, { ...this.ghostSpec.spec, groupId });
    } else if (ui.tool === 'addRing' && this.ghostSpec?.kind === 'ring') {
      store.addRingArray(wx, wy, { ...this.ghostSpec.spec, groupId });
    }
  }

  // ---------------- 水池拖拽 ----------------
  private applyPoolDrag(wx: number, wy: number, _aspect: boolean) {
    const d = this.drag;
    if (d.kind !== 'pool') return;
    const s = d.startPool;
    const p = store.doc.config.pool;
    const minSize = 200;
    const h = d.handle;
    let { x, y, width, height } = s;
    let r = s.x + s.width;
    let b = s.y + s.height;
    if (h.includes('w')) x = Math.min(wx, r - minSize);
    if (h.includes('e')) r = Math.max(wx, x + minSize);
    if (h.includes('n')) y = Math.min(wy, b - minSize);
    if (h.includes('s')) b = Math.max(wy, y + minSize);
    if (h === 'center') {
      x = wx - s.width / 2;
      y = wy - s.height / 2;
      r = x + s.width;
      b = y + s.height;
    }
    p.x = Math.round(x);
    p.y = Math.round(y);
    p.width = Math.round(r - x);
    p.height = Math.round(b - y);
    store.bump();
  }

  private nozzlesInRect(x1: number, y1: number, x2: number, y2: number): string[] {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    const out: string[] = [];
    for (const n of store.doc.nozzles) {
      if (n.x >= minX && n.x <= maxX && n.y >= minY && n.y <= maxY) out.push(n.id);
    }
    return out;
  }

  // ---------------- 视图控制 ----------------
  fitView() {
    const p = store.doc.config.pool;
    this.viewport.fit(false, Math.max(p.width * 1.4, 2000), Math.max(p.height * 1.4, 2000));
  }

  zoomBy(factor: number) {
    this.viewport.zoom(factor, true);
  }

  handleResize() {
    if (this.destroyed) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.app.renderer.resize(w, h);
    this.viewport.resize(w, h);
  }

  // ---------------- 帧循环 ----------------
  /** 最近帧性能（毫秒），供调试/性能面板读取 */
  perf = { updateMs: 0, renderMs: 0, frameMs: 0 };
  private lastTickWall = 0;

  private tick = () => {
    if (this.destroyed) return;
    const t0 = performance.now();
    const now = t0 / 1000;
    player.tick(now);

    // 结构变化 → 重建喷头层
    if (store.structureVersion !== this.lastStructVersion) {
      this.nozzleLayer.rebuild(store.doc);
      this.lastStructVersion = store.structureVersion;
      this.lastStoreVersion = store.version;
      this.plaza.invalidate();
      this.grid.invalidate();
    }
    this.lastStoreVersion = store.version;

    const mode = ui.mode;
    const vp = this.viewport;
    const bounds = vp.getVisibleBounds();
    const scale = vp.scale.x;
    const cfg = store.doc.config;

    // 广场/网格
    this.plaza.redraw({
      worldExtent: WORLD_EXTENT,
      plazaColor: parseHex(cfg.plazaColor),
      poolColor: parseHex(cfg.poolColor),
      pool: cfg.pool,
      scale
    });
    if (ui.showGrid && mode !== 'preview') {
      this.grid.visible = true;
      this.grid.redraw({
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        scale,
        baseGrid: cfg.gridSize
      });
    } else {
      this.grid.visible = false;
    }

    // 播放激活映射
    let active: Map<number, { intensity: number; color: string }> | null = null;
    if (mode === 'preview') {
      const beat = player.currentBeatIndex;
      if (beat !== this.lastBeatIndex) this.lastBeatIndex = beat;
      const beatIntensity = store.activeGroupsAtBeat(beat);
      if (beatIntensity.size > 0) {
        active = new Map();
        const groupColor = new Map(store.doc.groups.map((g) => [g.id, g.color]));
        for (let i = 0; i < store.doc.nozzles.length; i++) {
          const gid = store.doc.nozzles[i].groupId;
          const intensity = beatIntensity.get(gid);
          if (intensity !== undefined) {
            active.set(i, { intensity, color: groupColor.get(gid) ?? '#7fd4ff' });
          }
        }
      }
    }

    this.nozzleLayer.update({
      doc: store.doc,
      viewLeft: bounds.left,
      viewTop: bounds.top,
      viewRight: bounds.right,
      viewBottom: bounds.bottom,
      scale,
      mode,
      active,
      selected: ui.selection,
      hoverId: this.hoverId,
      hoverGroup: ui.hoverGroupId,
      showLanding: ui.showLanding,
      time: now,
      jetRange: cfg.jetRange
    });

    if (mode === 'config') {
      this.nozzleLayer.updateConfigLanding(store.doc, cfg.jetRange, ui.showLanding, scale);
      this.overlay.drawPoolHandles(cfg.pool, ui.poolEditing);
      this.overlay.setHandleWorldSize(20, scale);
    } else {
      this.overlay.drawPoolHandles(cfg.pool, false);
      if (mode !== 'preview') {
        // layout 模式清理可能残留的水柱/落点
        this.nozzleLayer.updateConfigLanding(store.doc, cfg.jetRange, false, scale);
      }
    }

    // 单选喷头的旋转手柄
    if (mode === 'layout' && ui.selection.size === 1 && this.drag.kind !== 'rotate') {
      const n = store.nozzleById([...ui.selection][0]);
      if (n) this.overlay.drawRotateHandle(n, ROTATE_HANDLE_PX / scale);
      else this.overlay.drawRotateHandle(null, 0);
    } else if (this.drag.kind !== 'rotate') {
      this.overlay.drawRotateHandle(null, 0);
    }

    // 阵列预览
    if (mode === 'layout' && ui.tool !== 'select' && this.ghostSpec && this.ghostAt) {
      this.overlay.drawGhost(this.ghostSpec, this.ghostAt, scale);
    } else {
      this.overlay.drawGhost(null, null, scale);
    }

    this.overlay.setScale(scale);

    const t1 = performance.now();
    this.perf.updateMs = t1 - t0;
    this.perf.frameMs = this.lastTickWall ? t0 - this.lastTickWall : 0;
    this.lastTickWall = t0;
    // 渲染紧随本回调执行，postrender 监听器据此计算纯渲染耗时
    this.renderStart = t1;
  };

  destroy() {
    this.destroyed = true;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.resizeObs?.disconnect();
    this.app.ticker.remove(this.onAfterRender, this);
    this.app.destroy({ removeView: true }, { children: true });
  }
}

function parseHex(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}
