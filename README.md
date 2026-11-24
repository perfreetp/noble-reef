# 水景广场编排工作室（Aqua Plaza Studio）

园区水景广场的**喷头布置**与**水舞编排**工具。基于 TypeScript + Svelte 5 + PixiJS 8 + pixi-viewport，
可在俯视画布上布置上千个喷头、按分组在多节拍轨道上编排喷水强度，并实时预览整段水舞。

## 功能

### 布置页
- 俯视画布，滚轮缩放、右键/中键或空格+拖动平移，支持上千喷头流畅查看
- **矩形阵列**：行列数、XY 间距、整体旋转角可调
- **环形阵列**：数量、半径、起始角、整圆/扇形扫掠、径向/切向/固定三种朝向
- 单喷头放置；点击放置前画布实时显示阵列落点预览
- 喷头可拖动改位（可选网格吸附），黄色旋转手柄或属性滑杆调整朝向
- 点选 / 框选 / Ctrl 加选，批量指定分组、批量旋转、微调、删除
- 分组管理：新建、改名、换色、删除；悬停分组行画布实时高亮对应喷头

### 节奏页
- 每个分组一条节拍轨道，多小节 × 每小节 N 拍
- 在网格上**按下并拖动**连续绘制色块；单击在 60% → 100% → 30% → 清空间循环
- 色块高度与数字即喷水强度（0–100%）
- 整小节复制到后续轨道、清空小节；BPM、小节数、每小节拍数可调
- 播放头随时间推进；分组行与画布喷头双向高亮联动

### 预览页
- 播放/暂停/停止、循环开关、可拖动进度条跳转任意节拍
- 激活分组喷头实时高亮，按节拍强度显示水柱（基座、轨迹、落点）
- 水柱落点随喷头朝向与射程偏移，强度控制实际喷射距离
- 侧栏实时显示各激活分组强度仪表

### 配置页
- 广场底色、水池底色
- 水池范围：数值输入或拖动画布上的 8 个调整手柄 + 中心平移手柄
- 水柱最大射程、网格间距、全部喷头落点预览
- 工程统计（喷头/分组/色块/节拍/水池面积）

### 通用
- 全局**撤销 / 重做**（Ctrl+Z / Ctrl+Y，含拖拽与拖绘的合并提交），上限 100 步
- 编排数据导出为 `.aqua.json`，可重新导入继续编辑
- 快捷键：1–4 切换页面、Del 删除、Esc 取消、空格临时平移

## 技术架构

```
src/
├── lib/
│   ├── types.ts             可序列化数据模型（Doc/Nozzle/Group/Block/...）
│   ├── doc-factory.ts       阵列几何生成 + 内置 1269 喷头演示工程
│   ├── store.svelte.ts      中央 Store：$state.raw 文档 + 快照历史栈（撤销重做）
│   ├── player.svelte.ts     播放器：BPM 时间换算、循环、进度寻址
│   ├── ui-state.svelte.ts   页面/工具/选择集/悬停等 UI 状态
│   ├── io.ts                工程文件导入导出
│   └── engine/
│       ├── plaza-engine.ts  Pixi Application + viewport + 交互 + 帧循环 + 性能指标
│       ├── nozzle-layer.ts  喷头/水柱/落点 Sprite 池，视锥剔除，每帧增量同步
│       ├── env-layers.ts    自适应网格、广场水池、框选/手柄/阵列预览覆盖物
│       ├── textures.ts      运行时生成的柔光纹理（无外部资源）
│       └── color.ts         颜色工具
├── components/              四个页面 + 顶栏 + 画布舞台 + 时间轴网格等 Svelte 组件
└── main.ts / App.svelte
```

### 上千喷头的流畅性设计
- 每个喷头固定 4 个 Sprite（底座/水柱/轨迹/落点），对象只在结构变化时重建
- 每帧做**视锥剔除**，屏外喷头跳过属性同步并隐藏
- Pixi 8 自动合批，同纹理 Sprite 合并为少量 draw call
- 命中检测不依赖每个 DisplayObject 的事件对象，统一在 viewport 层手动距离判定
- Svelte 与渲染解耦：播放进度走 rAF 直读，高频拖拽只更新版本号不触发组件重渲染
- 文档用 `$state.raw` 持有普通对象，`structuredClone` 快照可靠；变更后浅拷贝顶引用通知响应式

实测（无头虚拟机，1269 喷头全水柱激活）：逻辑更新 ~3–4ms、纯渲染 ~3ms/帧。

## 开发

```bash
npm install
npm run dev        # 启动开发服务器
npm run check      # svelte-check 类型检查
npm run build      # 生产构建到 dist/
npm test           # Playwright 无头测试（需先 npm run dev，并确认 tests 中端口）
```

测试位于 `tests/`：`smoke.ts`（全流程冒烟）、`integration.ts`（导入导出/撤销栈）、
`interaction.ts`（喷头拖动/朝向/框选/删除）。测试通过 `window.__engine/__store__/__ui__/__player__`
调试钩子读取内部状态。

## 数据格式

导出文件为带标记的 JSON：

```json
{
  "app": "AQUA_PLAZA_STUDIO",
  "formatVersion": 1,
  "exportedAt": "2026-...",
  "doc": {
    "version": 1,
    "nozzles": [{ "id", "x", "y", "angle", "groupId" }],
    "groups":  [{ "id", "name", "color" }],
    "blocks":  [{ "id", "groupId", "beatIndex", "intensity" }],
    "config":  { "plazaColor", "poolColor", "pool", "jetRange", "gridSize" },
    "beatsPerBar": 4, "bpm": 96, "barCount": 8
  }
}
```

坐标单位为厘米，角度为度（0 = 朝 +x，逆时针为正）。
