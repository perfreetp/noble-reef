# 手办分件拆模工作台

一个纯前端 TypeScript + React + Three.js 工具，覆盖：

1. **模型导入 / 内置库**：支持 STL、OBJ、GLB/GLTF；内置三个闭合车削手办原型。
2. **表面折线与投影**：使用 `three-mesh-bvh` 加速射线拾取；可加点、拖动顶点、闭合折线并投影为水平闭合切割曲线。
3. **BVH 平面切割与封口**：BVH `shapecast` 收集跨平面三角面交线，焊接为截面环，耳切生成平面封口。
4. **分模高度预览**：拖动滑杆或视口中的黄色高度球，立即执行轻量平面切割预览；松手后重算榫卯、CSG 和清单。
5. **榫卯模块**：3–8 个柱位按自适应网格排布，可调柱径、插入深度、间隙和保护距离；螺旋搜索避开边界/薄壁，BVH 检测与对面片的最小间距和硬相交，冲突位红色标记。
6. **壁厚处理**：2–6 mm 均匀壳厚，内腔沿法线偏移；通过 `three-bvh-csg` 减去闭合内腔，并探测薄转角给出加厚提示。
7. **导出**：上下模分别导出二进制 STL，CSV 分件清单包含体积、三角面、柱/槽数量。
8. **撤销 / 重做**：模型切换、导入、折线、滑杆手势、开关和步骤切换均进入最多 100 步历史；`Ctrl/Cmd+Z` 撤销，`Ctrl+Shift+Z` 或 `Ctrl+Y` 重做。

## 运行

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
npm run preview
```

## 几何管线

```text
原始 BufferGeometry
  ├─ MeshBVH：表面拾取 / 薄壁射线 / 对面片距离与相交
  ├─ plane split：三角面裁剪 + BVH 交线 + 截面环焊接 + earcut 封口
  ├─ tenon planner：自适应网格 + 边界距离 + 局部弦厚
  ├─ shell：顶点法线偏移内腔 + CSG SUBTRACTION
  └─ tenon CSG：柱/补强台 ADDITION，配合间隙刀具 SUBTRACTION
```

主要代码：

- `src/geometry/clipPlane.ts`：平面切割、截面环、封口、体积。
- `src/geometry/contour.ts`：投影曲线、网格柱位、薄壁评分、柱/槽刀具。
- `src/geometry/pipeline.ts`：切割、冲突检测、抽壳和榫卯 CSG 总管线。
- `src/geometry/shell.ts`：法线偏移内腔和薄转角检测。
- `src/components/Viewport.tsx`：Three.js 场景、BVH 拾取、折线/高度拖拽和预览。
- `src/state/HistoryContext.tsx`：撤销重做与手势合并。

## 验证脚本

```bash
npx tsx scripts/smoke.ts
npx tsx scripts/export-smoke.ts
node scripts/browser-smoke.mjs
```

`browser-smoke.mjs` 使用本机 Chrome/Puppeteer Core 做无界面工作流冒烟测试。
