import { Engine } from '@babylonjs/core/Engines/engine'
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import { Scene } from '@babylonjs/core/scene'
import { Vector3, Quaternion, Matrix, Color3, Color4 } from '@babylonjs/core/Maths/math'
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
// tree-shakeable 副作用注册：createInstance 依赖 InstancedMesh
import '@babylonjs/core/Meshes/instancedMesh'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { LinesMesh } from '@babylonjs/core/Meshes/linesMesh'
import type { PatternResponse, Steering, Antenna } from '../compute/types'
import { gainToColor } from '../compute/colormap'

const SPHERE_RADIUS = 6
const D2R = Math.PI / 180

/** 等高线电平与配色（dB, 颜色） */
const CONTOUR_LEVELS: Array<{ level: number; color: Color3 }> = [
  { level: -3, color: new Color3(1, 1, 1) },
  { level: -10, color: new Color3(1, 0.85, 0.2) },
  { level: -20, color: new Color3(1, 0.45, 0.15) },
]

/**
 * 波束方向图 3D 场景。
 * 球面顶点与 θ–φ 采样网格一一对应，方向图更新时只刷新 vertex color buffer；
 * 等高线 LineSystem 挂为球的子节点，随指向角一起旋转。
 */
export class BeamScene {
  readonly engineMode: 'webgpu' | 'webgl2'
  private engine: Engine
  private scene: Scene
  private sphere: Mesh
  private contourMeshes: LinesMesh[] = []
  private markerRoot: Mesh
  private baselineMesh: LinesMesh | null = null
  private nTheta: number
  private nPhi: number

  static async Create(
    canvas: HTMLCanvasElement,
    nTheta: number,
    nPhi: number,
  ): Promise<BeamScene> {
    let engine: Engine
    let mode: 'webgpu' | 'webgl2'
    const webgpu = new WebGPUEngine(canvas, { antialias: true, stencil: true })
    try {
      await webgpu.initAsync()
      engine = webgpu as unknown as Engine
      mode = 'webgpu'
    } catch {
      webgpu.dispose()
      engine = new Engine(canvas, true, { stencil: true }, true)
      mode = 'webgl2'
    }
    return new BeamScene(engine, mode, canvas, nTheta, nPhi)
  }

  private constructor(
    engine: Engine,
    mode: 'webgpu' | 'webgl2',
    canvas: HTMLCanvasElement,
    nTheta: number,
    nPhi: number,
  ) {
    this.engine = engine
    this.engineMode = mode
    this.nTheta = nTheta
    this.nPhi = nPhi
    const scene = new Scene(engine)
    this.scene = scene
    scene.clearColor = new Color4(0.035, 0.045, 0.07, 1)

    const camera = new ArcRotateCamera(
      'cam',
      -Math.PI / 2,
      Math.PI / 3.2,
      17,
      new Vector3(0, 2.2, 0),
      scene,
    )
    camera.attachControl(canvas, true)
    camera.lowerRadiusLimit = 9
    camera.upperRadiusLimit = 40
    camera.wheelDeltaPercentage = 0.01
    camera.minZ = 0.1

    this.buildGround()
    this.sphere = this.buildSphere(nTheta, nPhi)
    this.markerRoot = new Mesh('markerRoot', scene)

    engine.runRenderLoop(() => scene.render())
    const ro = new ResizeObserver(() => engine.resize())
    ro.observe(canvas)
    this.scene.onDisposeObservable.add(() => ro.disconnect())
  }

  /** 观测站地面：动态纹理绘制网格的半透明平面（x=东, z=北） */
  private buildGround() {
    const ground = MeshBuilder.CreateGround(
      'ground',
      { width: 200, height: 200, subdivisions: 1 },
      this.scene,
    )
    const texSize = 1024
    const tex = new DynamicTexture('groundGrid', texSize, this.scene, false)
    const ctx = tex.getContext() as CanvasRenderingContext2D
    ctx.fillStyle = '#141f31'
    ctx.fillRect(0, 0, texSize, texSize)
    const cells = 20 // 200 m / 每格 10 m
    const step = texSize / cells
    ctx.strokeStyle = '#27405f'
    ctx.lineWidth = 1
    for (let i = 0; i <= cells; i++) {
      const p = Math.round(i * step) + 0.5
      ctx.beginPath()
      ctx.moveTo(p, 0)
      ctx.lineTo(p, texSize)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, p)
      ctx.lineTo(texSize, p)
      ctx.stroke()
    }
    // 中心坐标轴（东-西 / 北-南）
    ctx.strokeStyle = '#3f6b9e'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(0, texSize / 2)
    ctx.lineTo(texSize, texSize / 2)
    ctx.moveTo(texSize / 2, 0)
    ctx.lineTo(texSize / 2, texSize)
    ctx.stroke()
    tex.update()

    const mat = new StandardMaterial('groundMat', this.scene)
    mat.diffuseTexture = tex
    mat.specularColor = new Color3(0.05, 0.08, 0.12)
    mat.emissiveColor = new Color3(0.55, 0.62, 0.72)
    mat.backFaceCulling = false
    ground.material = mat
  }

  /** 自定义球面：顶点布局 = 采样网格（theta-major），极点按 φ 列复制 */
  private buildSphere(nTheta: number, nPhi: number): Mesh {
    const positions: number[] = []
    const colors: number[] = []
    const indices: number[] = []
    const gray = new Color4(0.35, 0.35, 0.4, 1)

    for (let i = 0; i <= nTheta; i++) {
      const theta = (i / nTheta) * Math.PI
      const st = Math.sin(theta)
      const ct = Math.cos(theta)
      for (let j = 0; j < nPhi; j++) {
        const phi = (j / nPhi) * 2 * Math.PI
        // 局部物理坐标 (东, 天顶, 北) → Babylon (x=东, y=天顶, z=北)
        positions.push(
          SPHERE_RADIUS * st * Math.cos(phi),
          SPHERE_RADIUS * ct,
          SPHERE_RADIUS * st * Math.sin(phi),
        )
        colors.push(gray.r, gray.g, gray.b, gray.a)
      }
    }

    for (let i = 0; i < nTheta; i++) {
      for (let j = 0; j < nPhi; j++) {
        const a = i * nPhi + j
        const b = i * nPhi + ((j + 1) % nPhi)
        const c = (i + 1) * nPhi + ((j + 1) % nPhi)
        const d = (i + 1) * nPhi + j
        // 外法线朝外的逆时针绕序
        indices.push(a, b, d)
        indices.push(b, c, d)
      }
    }

    const mesh = new Mesh('patternSphere', this.scene)
    mesh.setVerticesData(VertexBuffer.PositionKind, new Float32Array(positions), true)
    mesh.setVerticesData(VertexBuffer.ColorKind, new Float32Array(colors), true)
    mesh.setIndices(indices)
    mesh.position.y = 8

    const mat = new StandardMaterial('sphereMat', this.scene)
    mat.emissiveColor = new Color3(1, 1, 1)
    mat.disableLighting = true
    mat.backFaceCulling = false
    mesh.material = mat
    mesh.hasVertexAlpha = false
    return mesh
  }

  /** 应用新一版方向图：重着色 + 重建等高线 */
  applyGain(res: PatternResponse) {
    const colors = new Float32Array((this.nTheta + 1) * this.nPhi * 4)
    for (let i = 0; i <= this.nTheta; i++) {
      const gi = Math.min(i, this.nTheta - 1)
      for (let j = 0; j < this.nPhi; j++) {
        const db = res.gainDb[gi * this.nPhi + j]
        const c = gainToColor(db)
        const o = (i * this.nPhi + j) * 4
        colors[o] = c.r
        colors[o + 1] = c.g
        colors[o + 2] = c.b
        colors[o + 3] = 1
      }
    }
    this.sphere.updateVerticesData(VertexBuffer.ColorKind, colors)

    // 重建等高线（worker 已提取；子节点、局部坐标，随球旋转）
    for (const m of this.contourMeshes) m.dispose()
    this.contourMeshes = []
    const r = SPHERE_RADIUS * 1.006
    for (const payload of res.contours) {
      if (payload.coords.length === 0) continue
      const lines: Vector3[][] = []
      for (let k = 0; k < payload.coords.length; k += 6) {
        const c = payload.coords
        lines.push([
          new Vector3(c[k] * r, c[k + 1] * r, c[k + 2] * r),
          new Vector3(c[k + 3] * r, c[k + 4] * r, c[k + 5] * r),
        ])
      }
      const colorCfg = CONTOUR_LEVELS.find((l) => l.level === payload.level)
      const line = MeshBuilder.CreateLineSystem(
        `contour${payload.level}`,
        { lines, useVertexAlpha: false },
        this.scene,
      )
      line.color = colorCfg?.color ?? new Color3(1, 1, 1)
      line.parent = this.sphere
      line.alpha = 0.95
      this.contourMeshes.push(line)
    }
  }

  /** 球面随指向角旋转：把局部天顶（主瓣轴）转到世界指向 (θ0, φ0) */
  setSteering(s: Steering) {
    const theta0 = s.theta0Deg * D2R
    const phi0 = s.phi0Deg * D2R
    // Q：局部 (东,天顶,北) → 世界；局部 y 轴映射为 (sinθ0 cosφ0, cosθ0, sinθ0 sinφ0)
    const cp = Math.cos(phi0)
    const sp = Math.sin(phi0)
    const ct = Math.cos(theta0)
    const st = Math.sin(theta0)
    const q = Quaternion.FromRotationMatrix(
      Matrix.FromValues(
        sp * sp + ct * cp * cp,
        st * cp,
        (ct - 1) * sp * cp,
        0,
        -st * cp,
        ct,
        -st * sp,
        0,
        (ct - 1) * sp * cp,
        st * sp,
        cp * cp + ct * sp * sp,
        0,
        0,
        0,
        0,
        1,
      ),
    )
    this.sphere.rotationQuaternion = q
  }

  /** 重建地面天线标记与 3D 基线（1 米 = 1 世界单位） */
  updateAntennas(antennas: Antenna[], showBaselines: boolean) {
    // 清空旧标记
    for (const c of this.markerRoot.getChildMeshes()) c.dispose()
    this.baselineMesh?.dispose()
    this.baselineMesh = null
    if (antennas.length === 0) return

    const pole = MeshBuilder.CreateCylinder(
      'poleTemplate',
      { height: 1.6, diameter: 0.18 },
      this.scene,
    )
    const poleMat = new StandardMaterial('poleMat', this.scene)
    poleMat.emissiveColor = new Color3(0.95, 0.5, 0.15)
    poleMat.disableLighting = true
    pole.material = poleMat
    const head = MeshBuilder.CreateSphere('headTemplate', { diameter: 0.55 }, this.scene)
    const headMat = new StandardMaterial('headMat', this.scene)
    headMat.emissiveColor = new Color3(1, 0.85, 0.3)
    headMat.disableLighting = true
    head.material = headMat

    for (const a of antennas) {
      const p = pole.createInstance(`pole${a.id}`)
      p.parent = this.markerRoot
      p.position.set(a.x, 0.8, a.y)
      const h = head.createInstance(`head${a.id}`)
      h.parent = this.markerRoot
      h.position.set(a.x, 1.75, a.y)
    }
    pole.dispose()
    head.dispose()

    if (showBaselines && antennas.length > 1) {
      const lines: Vector3[][] = []
      for (let i = 0; i < antennas.length; i++) {
        for (let j = i + 1; j < antennas.length; j++) {
          lines.push([
            new Vector3(antennas[i].x, 0.06, antennas[i].y),
            new Vector3(antennas[j].x, 0.06, antennas[j].y),
          ])
        }
      }
      this.baselineMesh = MeshBuilder.CreateLineSystem(
        'baselines3d',
        { lines, useVertexAlpha: false },
        this.scene,
      )
      this.baselineMesh.color = new Color3(0.4, 0.8, 1)
      this.baselineMesh.alpha = 0.55
    }
  }

  dispose() {
    this.scene.dispose()
    this.engine.dispose()
  }
}
