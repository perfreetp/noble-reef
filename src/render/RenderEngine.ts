import {
  Application,
  Buffer,
  BufferUsage,
  CLEAR,
  Container,
  Geometry,
  GlProgram,
  GpuProgram,
  Mesh,
  RenderTarget,
  RenderTexture,
  Shader,
  Sprite,
  TextureSource,
  UniformGroup,
} from 'pixi.js';
import type { Ornament, LayerId, BlendModeName } from '../core/types';
import { ProjectStore } from '../core/ProjectStore';
import { AssetLibrary, type AssetEntry } from './assets';
import { BatchGeometryBuilder } from './BatchGeometryBuilder';
import { buildMaterialShader, type MaterialKind } from './shaders/materialShaders';
import { buildCompositeShader, BLEND_MODE_ENUM } from './shaders/compositeShaders';

/** 图元未缩放时的正方形边长(画布像素) */
const ORNAMENT_SIZE = 150;
const BG_COLOR = { r: 0.055, g: 0.05, b: 0.065, a: 1 };

const KIND_INDEX: Record<LayerId, number> = { kingfisher: 0, pearl: 1, metal: 2 };

/** 自定义几何 + 自定义 shader 的 mesh 类型(默认 Mesh 泛型绑定 MeshGeometry/TextureShader) */
type AnyMesh = Mesh<Geometry, Shader>;

interface LayerRuntime {
  layerId: LayerId;
  color: RenderTexture;
  data: RenderTexture;
  target: RenderTarget;
  /** 按 assetId 分桶的批 mesh(同素材共用纹理与 shader 资源) */
  meshes: Map<string, AnyMesh>;
  container: Container;
  dirty: boolean;
}

interface AccumSlot {
  color: RenderTexture;
  data: RenderTexture;
  target: RenderTarget;
}

/** 复合 pass 的 UBO 结构显式标注,以获得强类型 uniforms 访问 */
type CompositeUniformGroup = UniformGroup<{
  uCompParams: { value: Float32Array; type: 'vec4<f32>' };
  uTexel: { value: Float32Array; type: 'vec2<f32>' };
  uLayerOrder: { value: number; type: 'f32' };
  uPad: { value: number; type: 'f32' };
}>;

function makeRT(width: number, height: number, resolution: number, label: string): RenderTexture {
  return RenderTexture.create({ width, height, resolution, label, autoGenerateMipmaps: false });
}

function makeTarget(color: RenderTexture, data: RenderTexture): RenderTarget {
  return new RenderTarget({
    colorTextures: [color.source as TextureSource, data.source as TextureSource],
  });
}

/**
 * 珠光合成渲染引擎。
 *
 * 渲染分层:
 *  1. 每层独立渲染到 MRT(color + data),层内按 depth 排序烘焙几何
 *  2. 自底向上全屏复合到累加槽(每槽保留,支持从任意层增量重合成)
 *  3. 最终累加槽显示到屏幕
 *
 * 增量策略与 ProjectStore 的 dirtyFrom 对齐:
 *  - 单层参数变化:重渲该层 RT + 从该层起向上复合(下层累加槽不动)
 *  - 层序变化:全链重算,透光累计与遮挡关系同步刷新
 */
export class RenderEngine {
  readonly app: Application;
  backend: 'webgpu' | 'webgl' = 'webgpu';
  onFps: ((fps: number) => void) | null = null;

  private store: ProjectStore;
  private lib: AssetLibrary;
  private builder: BatchGeometryBuilder;

  private layerRTs = new Map<LayerId, LayerRuntime>();
  private accum: AccumSlot[] = [];
  private previewContainer = new Container();
  private previewSprite!: Sprite;
  private oneShot = new Container();

  private materialPrograms: Record<MaterialKind, { gl: GlProgram; gpu: GpuProgram }>;
  private compositePrograms: { gl: GlProgram; gpu: GpuProgram };
  private compositeUniforms: CompositeUniformGroup;
  private quadGeometry: Geometry;

  private frameCounter = 0;
  private needsPresent = true;

  private constructor(app: Application, store: ProjectStore, lib: AssetLibrary) {
    this.app = app;
    this.store = store;
    this.lib = lib;
    this.builder = new BatchGeometryBuilder();

    this.materialPrograms = {
      kingfisher: this.makePrograms('kingfisher'),
      pearl: this.makePrograms('pearl'),
      metal: this.makePrograms('metal'),
    };
    const csrc = buildCompositeShader();
    this.compositePrograms = {
      gl: new GlProgram({ name: 'composite-gl', vertex: csrc.glsl.vertex, fragment: csrc.glsl.fragment }),
      gpu: new GpuProgram({
        name: 'composite-gpu',
        vertex: { source: csrc.wgsl.vertex, entryPoint: 'mainVertex' },
        fragment: { source: csrc.wgsl.fragment, entryPoint: 'mainFragment' },
      }),
    };
    this.compositeUniforms = new UniformGroup({
      uCompParams: { value: new Float32Array(4), type: 'vec4<f32>' },
      uTexel: { value: new Float32Array(2), type: 'vec2<f32>' },
      uLayerOrder: { value: 0, type: 'f32' },
      uPad: { value: 0, type: 'f32' },
    });
    this.quadGeometry = this.buildFullscreenQuad();
  }

  static async create(canvas: HTMLCanvasElement, store: ProjectStore, lib: AssetLibrary): Promise<RenderEngine> {
    let app: Application;
    let backend: 'webgpu' | 'webgl';
    try {
      app = new Application();
      await app.init({
        canvas,
        width: store.canvas.width,
        height: store.canvas.height,
        preference: 'webgpu',
        antialias: false,
        backgroundAlpha: 1,
        autoDensity: true,
      });
      backend = app.renderer.type === 2 ? 'webgpu' : 'webgl';
    } catch (err) {
      app = new Application();
      await app.init({
        canvas,
        width: store.canvas.width,
        height: store.canvas.height,
        preference: 'webgl',
        antialias: false,
        backgroundAlpha: 1,
        autoDensity: true,
      });
      backend = 'webgl';
      console.warn('[RenderEngine] WebGPU 不可用,回退 WebGL2:', err);
    }
    console.info(`[RenderEngine] 渲染后端:${backend}`);

    const engine = new RenderEngine(app, store, lib);
    engine.backend = backend;
    engine.allocateTargets();
    engine.buildAllBatches();
    engine.previewSprite = new Sprite(engine.accum[engine.accum.length - 1].color);
    engine.previewSprite.width = store.canvas.width;
    engine.previewSprite.height = store.canvas.height;
    engine.previewContainer.addChild(engine.previewSprite);
    app.stage.addChild(engine.previewContainer);
    engine.bindStoreEvents();
    app.ticker.add(engine.tick);
    return engine;
  }

  // ---------------- 资源分配 ----------------

  private allocateTargets(): void {
    const { width, height } = this.store.canvas;
    for (const layerId of ['kingfisher', 'pearl', 'metal'] as LayerId[]) {
      const color = makeRT(width, height, 1, `layer-${layerId}-color`);
      const data = makeRT(width, height, 1, `layer-${layerId}-data`);
      const rt: LayerRuntime = {
        layerId,
        color,
        data,
        target: makeTarget(color, data),
        meshes: new Map(),
        container: new Container(),
        dirty: true,
      };
      this.layerRTs.set(layerId, rt);
    }
    // 累加槽:层数 + 1(槽 0 为背景)
    for (let i = 0; i < 4; i++) {
      const color = makeRT(width, height, 1, `accum-${i}-color`);
      const data = makeRT(width, height, 1, `accum-${i}-data`);
      this.accum.push({ color, data, target: makeTarget(color, data) });
    }
  }

  // ---------------- 批构建 ----------------

  private kindOf(layerId: LayerId): MaterialKind {
    return layerId === 'kingfisher' ? 'kingfisher' : layerId === 'pearl' ? 'pearl' : 'metal';
  }

  private makePrograms(kind: MaterialKind): { gl: GlProgram; gpu: GpuProgram } {
    const src = buildMaterialShader(kind);
    return {
      gl: new GlProgram({ name: `mat-${kind}-gl`, vertex: src.glsl.vertex, fragment: src.glsl.fragment }),
      gpu: new GpuProgram({
        name: `mat-${kind}-gpu`,
        vertex: { source: src.wgsl.vertex, entryPoint: 'mainVertex' },
        fragment: { source: src.wgsl.fragment, entryPoint: 'mainFragment' },
      }),
    };
  }

  private materialUniforms(asset: AssetEntry): UniformGroup {
    return new UniformGroup({
      uParams: {
        value: new Float32Array([1.0, asset.kind === 'kingfisher' ? 0.08 : 0.25, 0, 0]),
        type: 'vec4<f32>',
      },
      uTint: { value: new Float32Array([1, 1, 1, 1]), type: 'vec4<f32>' },
      uLightDir: { value: new Float32Array([-0.45, -0.55, 0.7, 0]), type: 'vec4<f32>' },
    });
  }

  /** 重建某层所有批 mesh */
  rebuildLayerBatches(layerId: LayerId): void {
    const rt = this.layerRTs.get(layerId);
    if (!rt) return;
    for (const mesh of rt.meshes.values()) {
      rt.container.removeChild(mesh);
      mesh.geometry.destroy();
      mesh.destroy();
    }
    rt.meshes.clear();

    const ornaments = this.store.ornamentsOf(layerId);
    if (ornaments.length === 0) {
      rt.dirty = true;
      return;
    }
    const byAsset = new Map<string, Ornament[]>();
    for (const o of ornaments) {
      const list = byAsset.get(o.assetId) ?? [];
      list.push(o);
      byAsset.set(o.assetId, list);
    }
    const kind = this.kindOf(layerId);
    for (const [assetId, list] of byAsset) {
      const asset = this.lib.get(assetId);
      const built = this.builder.build(list, ORNAMENT_SIZE);
      const geometry = this.wrapGeometry(built.vertices, built.indices);
      const dataTex = asset.filter ?? asset.normal;
      if (!dataTex) throw new Error(`素材 ${assetId} 缺少 data 贴图`);
      const shader = new Shader({
        glProgram: this.materialPrograms[kind].gl,
        gpuProgram: this.materialPrograms[kind].gpu,
        resources: {
          uMaterials: this.materialUniforms(asset),
          uColorTex: asset.color.source,
          uDataTex: dataTex.source,
          uSampler: asset.color.source.style,
        },
      });
      const mesh = new Mesh({ geometry, shader }) as AnyMesh;
      mesh.label = `${layerId}-${assetId}`;
      rt.container.addChild(mesh);
      rt.meshes.set(assetId, mesh);
    }
    rt.dirty = true;
  }

  /** 纯顶点数据 -> Pixi 交错属性 Geometry(position/uv/depth 共享一个缓冲) */
  private wrapGeometry(vertices: Float32Array, indices: Uint32Array): Geometry {
    const buffer = new Buffer({ data: vertices, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    return new Geometry({
      attributes: {
        aPosition: { buffer, format: 'float32x2', stride: 5 * 4, offset: 0 },
        aUV: { buffer, format: 'float32x2', stride: 5 * 4, offset: 2 * 4 },
        aDepth: { buffer, format: 'float32', stride: 5 * 4, offset: 4 * 4 },
      },
      indexBuffer: new Buffer({ data: indices, usage: BufferUsage.INDEX | BufferUsage.COPY_DST }),
      topology: 'triangle-list',
    });
  }

  private buildAllBatches(): void {
    for (const id of this.layerRTs.keys()) this.rebuildLayerBatches(id);
  }

  // ---------------- 全屏 quad ----------------

  private buildFullscreenQuad(): Geometry {
    const { width, height } = this.store.canvas;
    const verts = new Float32Array([
      0, 0, 0, 0,
      width, 0, 1, 0,
      width, height, 1, 1,
      0, height, 0, 1,
    ]);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    return new Geometry({
      attributes: {
        aPosition: {
          buffer: new Buffer({ data: verts, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST }),
          format: 'float32x2',
          stride: 4 * 4,
          offset: 0,
        },
        aUV: {
          buffer: new Buffer({ data: verts, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST }),
          format: 'float32x2',
          stride: 4 * 4,
          offset: 2 * 4,
        },
      },
      indexBuffer: new Buffer({ data: indices, usage: BufferUsage.INDEX | BufferUsage.COPY_DST }),
      topology: 'triangle-list',
    });
  }

  // ---------------- 事件接线 ----------------

  private bindStoreEvents(): void {
    const e = this.store.emitter;
    e.on('ornament:add', ({ ornament }) => this.rebuildLayerBatches(ornament.layer));
    e.on('ornament:remove', () => this.buildAllBatches());
    e.on('ornament:update', ({ ornament }) => this.rebuildLayerBatches(ornament.layer));
    e.on('project:load', () => this.buildAllBatches());
  }

  // ---------------- 每帧合成 ----------------

  private tick = (): void => {
    const dirtyFrom = this.store.consumeDirty();
    if (dirtyFrom !== null) {
      this.recompose(dirtyFrom);
      this.needsPresent = true;
    }
    if (this.needsPresent) {
      this.previewSprite.texture = this.accum[this.store.layers.length].color;
      this.needsPresent = false;
    }
    this.frameCounter++;
    if (this.frameCounter % 30 === 0) {
      const fps = Math.round(1000 / Math.max(1, this.app.ticker.deltaMS));
      this.onFps?.(fps);
    }
  };

  /**
   * 从 fromIndex 层开始重合成。
   * accum[i+1] = accum[i] 与第 i 层复合结果。
   * 增量时 accum[fromIndex] 仍有效,只重跑 fromIndex..end 的 pass。
   */
  /** 诊断统计:最近一次 recompose 的起始层与复合 pass 数 */
  lastRecompose = { fromIndex: -1, compositePasses: 0, layerRenders: 0 };

  recompose(fromIndex: number): void {
    const ordered = this.store.layers;
    let layerRenders = 0;

    for (let i = fromIndex; i < ordered.length; i++) {
      const rt = this.layerRTs.get(ordered[i].id)!;
      if (rt.dirty) {
        this.renderLayerRT(rt);
        rt.dirty = false;
        layerRenders++;
      }
    }
    if (fromIndex === 0) this.renderBackground(this.accum[0].target);

    let compositePasses = 0;
    for (let i = fromIndex; i < ordered.length; i++) {
      const cfg = ordered[i];
      const rt = this.layerRTs.get(cfg.id)!;
      this.compositePass(this.accum[i], this.accum[i + 1], rt, cfg.id, cfg.opacity, cfg.blendMode, cfg.visible, i);
      compositePasses++;
    }
    this.lastRecompose = { fromIndex, compositePasses, layerRenders };
  }

  private renderLayerRT(rt: LayerRuntime): void {
    this.app.renderer.render({ container: rt.container, target: rt.target, clear: true });
  }

  private renderBackground(target: RenderTarget): void {
    this.app.renderer.render({
      container: this.oneShot,
      target,
      clear: CLEAR.ALL,
      clearColor: [BG_COLOR.r, BG_COLOR.g, BG_COLOR.b, BG_COLOR.a],
    });
    this.oneShot.removeChildren();
  }

  private compositePass(
    src: AccumSlot,
    dst: AccumSlot,
    rt: LayerRuntime,
    layerId: LayerId,
    opacity: number,
    blendMode: BlendModeName,
    visible: boolean,
    order: number,
  ): void {
    const u = this.compositeUniforms.uniforms;
    u.uCompParams[0] = visible ? opacity : 0;
    u.uCompParams[1] = KIND_INDEX[layerId];
    u.uCompParams[2] = 0.012;
    u.uCompParams[3] = BLEND_MODE_ENUM[blendMode] ?? 0;
    u.uTexel[0] = 1 / this.store.canvas.width;
    u.uTexel[1] = 1 / this.store.canvas.height;
    u.uLayerOrder = order / 3;
    this.compositeUniforms.update();

    const shader = new Shader({
      glProgram: this.compositePrograms.gl,
      gpuProgram: this.compositePrograms.gpu,
      resources: {
        uComp: this.compositeUniforms,
        uBelow: src.color.source,
        uBelowMeta: src.data.source,
        uLayer: rt.color.source,
        uLayerData: rt.data.source,
        uSampler: src.color.source.style,
      },
    });
    const mesh = new Mesh({ geometry: this.quadGeometry, shader }) as AnyMesh;
    this.oneShot.removeChildren();
    this.oneShot.addChild(mesh);
    this.app.renderer.render({ container: this.oneShot, target: dst.target, clear: true });
    this.oneShot.removeChildren();
    mesh.destroy({ children: false, texture: false, textureSource: false, context: false });
    shader.destroy();
  }

  // ---------------- 高分辨率导出 ----------------

  /**
   * 以 scale=2 离屏重渲染整张成片:复用同一套几何与 shader,
   * 仅临时替换为高分辨率 RT,返回 PNG dataURL。
   */
  async exportPNG(scale = 2): Promise<string> {
    const { width, height } = this.store.canvas;
    const savedAccum = this.accum;
    const savedLayer = new Map<LayerId, { target: RenderTarget; color: RenderTexture; data: RenderTexture }>();

    const hiSlots: AccumSlot[] = [];
    for (let i = 0; i < this.accum.length; i++) {
      const c = makeRT(width, height, scale, `export-accum-${i}-c`);
      const d = makeRT(width, height, scale, `export-accum-${i}-d`);
      hiSlots.push({ color: c, data: d, target: makeTarget(c, d) });
    }
    this.accum = hiSlots;

    for (const [id, rt] of this.layerRTs) {
      savedLayer.set(id, { target: rt.target, color: rt.color, data: rt.data });
      const c = makeRT(width, height, scale, `export-layer-${id}-c`);
      const d = makeRT(width, height, scale, `export-layer-${id}-d`);
      rt.color = c;
      rt.data = d;
      rt.target = makeTarget(c, d);
      rt.dirty = true;
    }

    let dataUrl = '';
    try {
      this.recompose(0);
      const finalTex = hiSlots[hiSlots.length - 1].color;
      const { pixels } = this.app.renderer.extract.pixels({ target: finalTex });
      dataUrl = this.encodePNG(pixels, width * scale, height * scale);
    } finally {
      this.accum = savedAccum;
      for (const [id, rt] of this.layerRTs) {
        const s = savedLayer.get(id)!;
        rt.target = s.target;
        rt.color = s.color;
        rt.data = s.data;
        rt.dirty = true;
      }
      for (const s of hiSlots) {
        s.color.destroy(true);
        s.data.destroy(true);
        s.target.destroy();
      }
      this.recompose(0);
      this.needsPresent = true;
    }
    return dataUrl;
  }

  private encodePNG(pixels: Uint8ClampedArray, w: number, h: number): string {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    img.data.set(pixels);
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  }

  /** 当前最终成片纹理(最顶累加槽),供像素校验与外部读取 */
  finalTexture(): RenderTexture {
    return this.accum[this.store.layers.length].color;
  }

  /** 诊断:导出各层 mesh 的纹理资源与几何规模 */
  debugState(): unknown {
    const out: Record<string, unknown> = {};
    for (const [lid, lrt] of this.layerRTs) {
      out[lid] = {
        meshCount: lrt.meshes.size,
        meshes: [...lrt.meshes.entries()].map(([aid, mesh]) => ({
          assetId: aid,
          texture: mesh.shader!.resources.uColorTex,
          dataTexture: mesh.shader!.resources.uDataTex,
          vertexCount: (mesh.geometry.getBuffer('aPosition')?.data as Float32Array | undefined)?.length ?? 0,
        })),
      };
    }
    return out;
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
  }
}
