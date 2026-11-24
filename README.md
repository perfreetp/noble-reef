# 凤冠珠光层叠合成台

面向凤冠头面装配的**珠光层叠合成工具**。原生 TypeScript + Web Components + PixiJS,
渲染器 **WebGPU 优先、WebGL2 自动回退**,同一套 GLSL/WGSL 双着色器在两个后端等价运行。

## 能力对照需求

| 需求 | 实现 |
| --- | --- |
| 三层:点翠底 / 珠串层 / 金银饰片 | 每层独立 MRT 渲染目标(颜色 + 数据),`src/core/types.ts` |
| 每层不透明度 + 混合模式 | 7 种混合模式在复合着色器内实现,`LayerPanel.ts` |
| 层序上下拖动即时生效 | HTML5 拖拽 + `reorder`,全链重算,`ProjectStore.reorder` |
| 拖入翠片/珠串/錾片 | 素材面板程序化生成贴图,拖放落点入对应层 |
| 缩放 / 旋转 / 沿冠面吸附 | 二次贝塞尔投影 + 牛顿精化,`core/crown.ts`;Shift 关闭吸附 |
| 重叠显示压盖关系 | 层间顺序 + 层内 depth 共同排序,选中即列「压在上方/被压盖」 |
| 点翠各向异性光泽 | Ward 各向异性高光 + 烘焙滤镜像切线场 |
| 珠串折射偏移采样下层 | 复合时按法线偏移 UV 采样累加图,落点无覆盖自动回退 |
| 金银金属高光 + 边缘亮边 | 金属漫反射/高光 + alpha 梯度 rim light |
| 层内深度 + 层间顺序共同排序 | 深度烘焙进逐顶点 `aDepth`,层序决定复合次序 |
| 半透明翠片透光但不透遮挡 | 累加图元数据记录覆盖度,折射/透光按覆盖掩码加权 |
| 拖层序后透光/遮挡同步重算 | 层序变化置全链 dirty,重跑全部复合 pass |
| 2× PNG 导出 | 离屏高分辨率 RT 重渲染,实测输出 3200×2000 |
| 层配置 JSON 回读一致 | 严格校验序列化,回读后层序/不透明度逐项一致 |
| 5000 图元 ≥55fps | 真实 GPU + WebGPU 实测 **61–73fps** |
| 改单层只重合成该层及以上 | 脏标记下确界,实测顶层 1 pass、中层 2 pass、全链 3 pass |

## 渲染管线

```
素材贴图(Canvas2D 程序化生成:color / normal / filter)
   │
   ▼  层内批渲染(同素材合并为一个 Mesh,按 depth 升序烘焙)
每层 MRT ── attachment0:预乘 RGBA
          └ attachment1:法线 xy / 层内深度 / 覆盖度
   │
   ▼  自底向上全屏复合(乒乓累加槽,每槽保留以支持增量)
accum[0] 背景 → accum[1] 复合最底层 → … → accum[3] 成片
   │
   ▼
Sprite 上屏 / 高分辨率离屏导出 2× PNG
```

**增量策略**:`ProjectStore` 维护 `dirtyFrom`(脏层下确界)。改单层参数只标记该层及以上,
`RenderEngine.recompose(fromIndex)` 仅重跑 `fromIndex..end` 的复合 pass,下层累加槽保持不变;
拖动层序置全链 dirty,透光累计与遮挡关系整体重算。

### 双后端着色器的关键约束(踩坑记录)

- **GLSL 不能用嵌套 `struct 实例` 传 uniform**:Pixi 的 GL 松散 uniform 同步按名匹配顶层 uniform,
  写 `uniform MaterialUniforms uMaterials;` 会导致成员(如 uTint)同步不到、RGB 被乘零变黑。
  GLSL 用松散同名 uniform,WGSL 才用真正的 UBO struct。
- **WGSL 的 `textureSample` 只能在 uniform 控制流调用**:不能放进依赖纹理值的 `if` 分支。
  所有采样移到分支外,用 `step/mix` 权重实现条件效果(折射、透光、alpha 掩码)。
- **`meta` 是 WGSL 保留字**,不能做结构体字段名。

## 目录结构

```
src/
  core/      数据模型、事件总线、冠面几何、状态中心(脏标记/序列化)
  render/    程序化素材、批几何、渲染引擎、GLSL+WGSL 着色器
  editor/    拾取/变换交互、覆盖层(选择框/手柄/压盖标注)
  ui/        原生 Web Components(素材/图层/属性/导出/画布/外壳)
  main.ts    启动入口;testData.ts 演示构图与 5000 图元压力填充
tools/       Node 纯逻辑自测
```

## 命令

```bash
npm install
npm run dev        # 开发服务器
npm run build      # tsc 严格检查 + Vite 生产构建
npm run selftest   # Node 纯逻辑自测(吸附/脏标记/序列化/5000 图元几何)
```

启动后浏览器控制台可用 `window.fg`:
- `fg.fillTo5000()` 灌入 5000 图元做帧率验收
- `fg.clearAll()` 清空
- `fg.store` / `fg.engine` / `fg.editor` 直接调试

## 验收实测(无头 Chrome)

- WebGPU(真实 GPU,D3D11):后端就绪,5000 图元 **61fps**,旋转/层序拖动 **73fps**
- WebGL2(SwiftShader 软件渲染,无独显环境):功能全通,32fps(软件渲染预期上限)
- 双后端:`nonBackgroundPixels`、PNG 导出、JSON 回读、压盖关系全部一致,零运行时错误
- 增量:全链 3 复合 pass;改顶层 1 pass / 0 层重渲;改中层 2 pass
- 导出 PNG:3200×2000,恰为画布 2 倍
