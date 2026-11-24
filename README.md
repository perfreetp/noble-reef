# 跑酷路径光带编辑器

基于 **Three.js + EffectComposer 后处理**的三维跑酷路径光带编辑工具。在场景地面与障碍物表面绘制控制点,自动生成平滑发光路径带,支持泛光调节、深度遮挡预览、拖拽微调与参数文件分享。

纯前端单文件应用(`index.html`),无需构建,浏览器直接打开即可运行。

## 运行方式

```bash
# 任选一种静态服务器(ES 模块不能用 file:// 直接打开)
npx serve .
# 或
python -m http.server 8080
```

浏览器访问对应地址即可。Three.js 0.160 通过 CDN importmap 加载,首次运行需联网。

## 功能模块

### 1. 路径绘制
- 点击场景地面/障碍物表面添加控制点(射线拾取,吸附到实际表面)
- 控制点上限 **80 个**,达到上限后拒绝添加并提示
- 拖动控制点微调路径,双击控制点删除,Ctrl+Z 撤销(最多 50 步)
- 右键平移、滚轮缩放、左键空白处旋转视角(OrbitControls)

### 2. 光带几何生成
- Catmull-Rom(centripetal)样条穿过全部控制点,生成平滑曲线
- 每段曲线固定细分 **20 段**;Parallel-Transport 平行移动标架构建带状网格,避免扭转
- 宽度 3 档:窄 0.8 / 标准 1.6 / 宽 2.6
- 发光强度 0.2–4 可调;颜色沿光带长度方向从起点色渐变到终点色
- 自定义 ShaderMaterial,边缘柔化 + 中心光芯,加法混合

### 3. 后处理泛光
- `EffectComposer + RenderPass + UnrealBloomPass + OutputPass`
- 泛光阈值 / 强度 / 半径三个滑杆,改动即时生效(阈值变化时下一帧自动重算预滤波泛光)
- ACES 色调映射,色彩按 sRGB 输出

### 4. 遮挡关系预览(深度纹理)
- 独立深度通道:单独相机 + `WebGLRenderTarget` 挂载 `DepthTexture`,仅渲染场景遮挡物层
- 光带位于独立编辑层,不写入深度纹理,避免自污染
- 光带片元着色器采样深度纹理,用 `perspectiveDepthToViewZ` 比对视空间深度:
  场景物比光带更近 → 该像素判定为被遮挡,亮度压到可配的"被遮挡段亮度"(默认 0.12),带 0.3 单位的平滑过渡防硬边闪烁
- 可一键开关,便于对比"穿透显示"与"正确遮挡"

### 5. 数据持久化与分享
- 编辑状态自动写入 `localStorage`(防抖 400ms),刷新/重开自动恢复
- 导出 JSON 参数文件(含控制点、宽度、颜色、发光与全部泛光/遮挡参数)
- 导入 JSON(按钮选择或直接拖入页面)完整恢复编辑状态,带格式校验与数值兜底

## 导出文件格式

```json
{
  "app": "parkour-lightpath-editor",
  "version": 1,
  "exportedAt": "2026-11-24T01:06:46.000Z",
  "params": { "maxPoints": 80, "subdivisions": 20, "widthLevels": [0.8, 1.6, 2.6] },
  "state": {
    "points": [[x, y, z], ...],
    "widthLevel": 1,
    "intensity": 1.15,
    "colorStart": "#00e5ff",
    "colorEnd": "#ff3df0",
    "bloomThreshold": 0.35,
    "bloomStrength": 0.9,
    "bloomRadius": 0.45,
    "occlusion": true,
    "occlusionFactor": 0.12
  }
}
```

## 架构要点

| 设计 | 说明 |
|---|---|
| 双层渲染(layer 0/1) | 场景遮挡物在 layer 0 写入深度纹理;光带、控制点在 layer 1,只进主通道 |
| 深度通道 | `scene.overrideMaterial = MeshDepthMaterial` 每帧先渲染到独立 RT |
| 遮挡判定 | 片元着色器内手动深度比对,而非靠硬件深度测试,因此光带可 `depthTest:false` 保持加法发光的同时仍能被遮挡压暗 |
| 几何重建 | 控制点变化时整体重建带状网格;拖拽中只更新标记位置,松手才重建标记材质 |
| 调试句柄 | `window.__editor` 暴露相机/光带/状态,便于控制台调试与自动化测试 |

## 测试

`.smoketest/` 内为 Playwright + SwiftShader 无头浏览器测试(依赖通过 npm 安装):

| 脚本 | 覆盖内容 |
|---|---|
| `test.mjs` | 加点、滑杆联动、撤销、导出、localStorage 持久化、导入恢复 |
| `fresh.mjs` | 全新上下文出厂默认参数校验 |
| `occlusion.mjs` | 遮挡开关像素级亮度对比(被挡区域降亮约 30%)、细分几何顶点数 |
| `cap.mjs` | 80 点上限拒绝、满载 3162 顶点几何、重建耗时 |

> 无头环境使用软件渲染(SwiftShader),FPS 仅作回归参照;真实 GPU 上该场景规模(满载约 3 千顶点 + 单张深度纹理 + 一次泛光)可稳定保持 60 帧。

## 目录

```
index.html        编辑器全部代码(HTML/CSS/JS 单文件)
.smoketest/       Playwright 自动化测试(node_modules 与截图已 gitignore)
```
