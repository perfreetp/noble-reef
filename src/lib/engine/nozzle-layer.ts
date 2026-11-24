import { Container, Sprite, Texture } from 'pixi.js';
import type { Doc } from '../types';
import { angleVec } from '../util';
import { lighten } from './color';

/** 喷头屏幕端基础尺寸（px，直径），缩小时有下限保护 */
const BASE_MARKER_PX = 22;
const MIN_MARKER_PX = 3.2;

interface NozzleGfx {
  marker: Sprite;
  water: Sprite;
  streak: Sprite;
  landing: Sprite;
  lastX: number;
  lastY: number;
  lastAngle: number;
  lastVis: boolean;
  lastTint: number;
  lastScale: number;
}

/**
 * 喷头渲染层。
 * 每个喷头固定 4 个 Sprite（底座/水柱基座/轨迹/落点），不可见时移出屏外。
 * 每帧只对屏内喷头做属性同步，配合 Pixi 自动合批，支撑上千喷头流畅渲染。
 */
export class NozzleLayer {
  readonly container = new Container();
  private readonly waterContainer = new Container();
  private readonly gfx: NozzleGfx[] = [];
  private nozzleIds: string[] = [];

  private readonly nozzleTex: Texture;
  private readonly waterTex: Texture;
  private readonly streakTex: Texture;
  private readonly landingTex: Texture;

  constructor(nozzleTex: Texture, waterTex: Texture, streakTex: Texture, landingTex: Texture) {
    this.nozzleTex = nozzleTex;
    this.waterTex = waterTex;
    this.streakTex = streakTex;
    this.landingTex = landingTex;
    this.container.label = 'nozzles';
    this.waterContainer.label = 'water';
    this.container.addChild(this.waterContainer);
  }

  /** 结构变化时按 doc 重建（喷头数量/顺序变化） */
  rebuild(doc: Doc) {
    this.container.removeChildren();
    this.container.addChild(this.waterContainer);
    this.waterContainer.removeChildren();
    this.gfx.length = 0;
    this.nozzleIds = doc.nozzles.map((n) => n.id);

    for (let i = 0; i < doc.nozzles.length; i++) {
      const marker = new Sprite(this.nozzleTex);
      marker.anchor.set(0.5);
      const water = new Sprite(this.waterTex);
      water.anchor.set(0.5);
      water.visible = false;
      const streak = new Sprite(this.streakTex);
      streak.anchor.set(0, 0.5);
      streak.visible = false;
      const landing = new Sprite(this.landingTex);
      landing.anchor.set(0.5);
      landing.visible = false;
      // 水柱相关置于底层，底座压在上面
      this.waterContainer.addChild(streak, landing, water);
      this.container.addChild(marker);
      this.gfx.push({
        marker,
        water,
        streak,
        landing,
        lastX: NaN,
        lastY: NaN,
        lastAngle: NaN,
        lastVis: false,
        lastTint: -1,
        lastScale: -1
      });
    }
  }

  indexOf(id: string): number {
    return this.nozzleIds.indexOf(id);
  }

  get count(): number {
    return this.gfx.length;
  }

  /**
   * 每帧同步。
   * @param active 索引 -> { intensity 0..1, color }，仅播放页传入
   * @param mode layout | preview | config
   */
  update(opts: {
    doc: Doc;
    viewLeft: number;
    viewTop: number;
    viewRight: number;
    viewBottom: number;
    scale: number;
    mode: 'layout' | 'preview' | 'config';
    active: Map<number, { intensity: number; color: string }> | null;
    selected: Set<string>;
    hoverId: string;
    hoverGroup: string;
    showLanding: boolean;
    time: number;
    jetRange: number;
  }) {
    const {
      doc,
      viewLeft,
      viewTop,
      viewRight,
      viewBottom,
      scale,
      mode,
      active,
      selected,
      hoverId,
      hoverGroup,
      showLanding,
      time,
      jetRange
    } = opts;

    const groupColor = new Map<string, string>();
    for (const g of doc.groups) groupColor.set(g.id, g.color);
    const DEFAULT_TINT = 0x9fb3c8;

    // 屏幕端标记尺寸：缩放越小，世界尺寸越大，保证可见
    const markerPx = Math.max(MIN_MARKER_PX, BASE_MARKER_PX);
    const markerWorld = markerPx / scale;

    for (let i = 0; i < doc.nozzles.length; i++) {
      const n = doc.nozzles[i];
      const g = this.gfx[i];
      if (!g) continue;

      // 视锥剔除（留 1 个标记的边距）
      const margin = markerWorld * 2;
      const vis =
        n.x > viewLeft - margin &&
        n.x < viewRight + margin &&
        n.y > viewTop - margin &&
        n.y < viewBottom + margin;

      if (vis !== g.lastVis) {
        g.marker.visible = vis;
        g.lastVis = vis;
        if (!vis) {
          g.water.visible = false;
          g.streak.visible = false;
          g.landing.visible = false;
          continue;
        }
      }
      if (!vis) continue;

      // 位置
      if (n.x !== g.lastX || n.y !== g.lastY) {
        g.marker.position.set(n.x, n.y);
        g.water.position.set(n.x, n.y);
        g.lastX = n.x;
        g.lastY = n.y;
      }
      // 标记尺寸随缩放反推世界尺寸
      if (scale !== g.lastScale) {
        g.marker.width = markerWorld;
        g.marker.height = markerWorld;
        g.lastScale = scale;
      }

      // 着色：分组色 + 选中/悬停/激活高亮
      const baseColor = n.groupId ? groupColor.get(n.groupId) ?? null : null;
      let tint = baseColor ? parseHex(baseColor) : DEFAULT_TINT;
      let boost = 0;
      const act = active?.get(i);
      if (act) {
        // 激活喷头：向亮青色提亮
        tint = parseHex(lighten(baseColor ?? '#7fd4ff', 0.35 + act.intensity * 0.35));
        boost = act.intensity;
      } else if (selected.has(n.id)) {
        tint = 0xffd34d;
      } else if (hoverId === n.id) {
        tint = parseHex(lighten(baseColor ? '#' + tint.toString(16).padStart(6, '0') : '#9fb3c8', 0.45));
      } else if (hoverGroup && n.groupId === hoverGroup) {
        tint = parseHex(lighten(baseColor ?? '#9fb3c8', 0.3));
      }
      if (tint !== g.lastTint) {
        g.marker.tint = tint;
        g.lastTint = tint;
      }
      g.marker.alpha = 1;

      // ---------- 水柱（仅预览模式） ----------
      const showWater = mode === 'preview' && act !== undefined && act !== null;
      if (showWater) {
        const intensity = act.intensity;
        const flicker = 0.86 + 0.14 * Math.sin(time * 9 + i * 1.7);
        const a = Math.min(1, 0.25 + intensity * 0.75) * flicker;
        const reach = jetRange * intensity;
        const v = angleVec(n.angle);
        const lx = v.x * reach;
        const ly = v.y * reach;

        g.water.visible = true;
        g.water.alpha = a;
        const baseSize = markerWorld * (0.9 + intensity * 1.6);
        g.water.width = baseSize;
        g.water.height = baseSize;
        g.water.tint = parseHex(lighten(baseColor ?? '#9fd9ff', 0.45));

        g.streak.visible = true;
        g.streak.alpha = Math.min(1, 0.35 + intensity * 0.6) * flicker;
        g.streak.position.set(n.x, n.y);
        // 纹理锚点在左端，rotation 直接用屏幕系角度（y 向下取负）
        g.streak.rotation = -(n.angle * Math.PI) / 180;
        const streakW = Math.max(markerWorld * 0.6, reach);
        g.streak.width = streakW;
        g.streak.height = Math.max(2 / scale, markerWorld * 0.28 * (0.5 + intensity));
        g.streak.tint = parseHex(lighten(baseColor ?? '#bfe8ff', 0.5));

        if (showLanding) {
          g.landing.visible = true;
          g.landing.alpha = (0.25 + 0.55 * intensity) * flicker;
          g.landing.position.set(n.x + lx, n.y + ly);
          // 落点脉冲（基于基础尺寸每帧重算，避免累积缩放）
          const pulse = 1 + 0.12 * Math.sin(time * 7 + i);
          const ls = markerWorld * (1.1 + intensity * 1.4) * pulse;
          g.landing.width = ls;
          g.landing.height = ls;
        } else {
          g.landing.visible = false;
        }
      } else {
        if (g.water.visible) g.water.visible = false;
        if (g.streak.visible) g.streak.visible = false;
        if (g.landing.visible) g.landing.visible = false;
      }
    }
  }

  /** 配置页静态落点预览（全部喷头按射程与朝向） */
  updateConfigLanding(doc: Doc, jetRange: number, visible: boolean, scale: number) {
    for (let i = 0; i < doc.nozzles.length; i++) {
      const n = doc.nozzles[i];
      const g = this.gfx[i];
      if (!g) continue;
      if (!visible) {
        g.landing.visible = false;
        g.streak.visible = false;
        continue;
      }
      const v = angleVec(n.angle);
      g.streak.visible = true;
      g.streak.alpha = 0.28;
      g.streak.position.set(n.x, n.y);
      g.streak.rotation = -(n.angle * Math.PI) / 180;
      g.streak.width = jetRange;
      g.streak.height = Math.max(1.5 / scale, 1);
      g.streak.tint = 0xbfe8ff;
      g.landing.visible = true;
      g.landing.alpha = 0.5;
      g.landing.position.set(n.x + v.x * jetRange, n.y + v.y * jetRange);
      const s = Math.max(10 / scale, 3);
      g.landing.width = s;
      g.landing.height = s;
    }
  }

  clearWater() {
    for (const g of this.gfx) {
      g.water.visible = false;
      g.streak.visible = false;
      g.landing.visible = false;
    }
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}

function parseHex(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}
