# 婚纱相册版式排版工具

基于 **Fabric.js v6 + Svelte 5（runes）+ Vite** 的对开页婚纱相册图文排版工具。所有尺寸以毫米（mm）为文档单位，画布内部按固定精度渲染像素。

## 启动

```bash
npm install
npm run dev      # 开发服务器 http://localhost:5173
npm run build    # 生产构建
npm test         # 30 个纯逻辑单元测试（node:test）
```

## 功能与实现对照

| 需求 | 实现位置 | 说明 |
| --- | --- | --- |
| 四类版式（单/双/三图、跨页通栏） | `src/lib/templates.js` | 9 个模板，槽位带裁切框；L/R 用页内坐标，跨页 S 用 `{x1,x2,y,h}` 描述符随中缝实时换算 |
| 槽位裁切框 + 最小间距约束 | `geometry.js#applyGapConstraints` | 拖动后沿最小重叠轴回弹，保证间距 ≥ `MIN_SLOT_GAP` |
| 拖入照片自动适配 + 焦点裁切 | `layout.js#coverRect` / `computeFillRect` | cover 模式填满槽位，焦点归一化坐标驱动，靠边自动夹紧不露白 |
| 焦点可拖动设定 | `albumCanvas.js` 焦点标记 + `layout.js#dragFocus` | 红色十字标记，拖动时图片跟随、焦点与平移量同步更新 |
| 照片缩放/平移 + 超出裁掉 | Fabric `clipPath` + `clampInside` | Ctrl/⌘+滚轮以指针为中心缩放；平移越界自动回弹到最近合法位置 |
| 间距不足自动回弹 | `geometry.js#clampInside` / `applyGapConstraints` | 图片级与槽位级两层约束 |
| 姓名/日期/页码三变量联动 | `store.svelte.js#setVariable` + `layout.js#resolveText` | 单一数据源 `doc.variables`，页码按对开页位置实时计算（左奇右偶） |
| 跨页通栏 + 可调中缝 | `constants.js#DEFAULT_GUTTER`、`layout.js#slotFrame` | 中缝 0–30mm，通栏照片宽度随中缝自动延展 |
| 页序调整 + 页码重算 | `ThumbnailBar.svelte` 原生拖拽 + `store#movePage` | 拖动缩略图重排，页码由位置决定无需改数据 |
| 对齐吸附 + 参考线 | `geometry.js#snapRect` | 边缘/中心线 6mm 阈值吸附，橙色参考线实时显示，松手即清 |
| 撤销重做 | `history.js` | 事务快照栈，覆盖照片填充、裁切、页序、文字、槽位、中缝、样式；同 key 700ms 内合并（拖拽/连续输入） |
| 本地存储 + 跨设备导出 | `imageStore.js`（IndexedDB）、`store#import/exportFile` | 文档 JSON 存 localStorage，图片 dataUrl 存 IDB（失败降级内存）；导出单个 `.walbum.json` 含全部图片 |
| 四区界面 | `App.svelte` + `components/` | 版式库 / 页面缩略图栏 / 画布 / 属性面板 |
| 画布缩放 + 多页滚动 | `albumCanvas.js` | 所有对开页纵向排列同一 Fabric 画布，25%–250% 缩放，滚轮滚动 |
| 流畅编辑 | 对象级拖拽同步 | 拖拽中只 `set()` Fabric 对象属性并 `requestRenderAll`，松手提交后才全量重绘 |

## 数据模型

```
doc = {
  version, variables: { names, date }, gutter,
  pages: [{
    id, templateId,
    photoSlots: [{ id, type, zone: 'L'|'R'|'S', rect|spread, fill }],
    textSlots:  [{ id, type, zone, rect, variable, fontSize, color, align, fontFamily }]
  }]
}
fill = { imageId, focus: {x,y} /* 0..1 */, zoom /* 1..6 */, pan: {x,y} }
```

- `rect`：页内坐标 mm；`spread`：跨页描述符，中缝变化时由 `slotFrame` 实时展开
- 填充只存相对状态（焦点/缩放/平移），裁切框改变时图片自动重新适配
- 图片二进制不进文档，IDB 按 `imageId` 存取；导出时内联为 dataUrl 打包

## 目录结构

```
src/lib/
  constants.js    尺寸/间距/阈值常量
  geometry.js     纯几何：cover、夹紧回弹、间距约束、吸附
  layout.js       坐标换算、填充状态 ↔ 渲染矩形、文字解析
  templates.js    四类九款模板与实例化
  history.js      撤销重做快照栈（合并窗口）
  imageStore.js   IndexedDB 图片存储（含内存降级）
  albumCanvas.js  Fabric 画布封装与全部指针交互
  store.svelte.js 全局状态、编辑动作、持久化与导入导出
src/components/   五个 Svelte 组件 + 缩略图子组件
tests/            node:test 单元测试（30 个）
.smoke/           CDP 浏览器冒烟测试脚本（gitignore，非交付物）
```

## 快捷键

- `Ctrl/⌘ + Z` 撤销，`Ctrl/⌘ + Shift + Z`（或 `Ctrl+Y`）重做
- 画布上 `Ctrl/⌘ + 滚轮` 缩放照片，普通滚轮滚动页面
- 双击空照片槽快速选图；照片库缩略图可直接拖到画布槽位
