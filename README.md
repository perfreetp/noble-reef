# 皮影操纵杆联动台

基于 three.js 的皮影影偶操纵系统:原生 TypeScript + Web Components 封装控制面板,
影偶由 6 个铰接部件组成,3 根操纵杆驱动关节,灯幕实时投射镂空透光剪影。

## 运行

```bash
npm install
npm run dev        # 开发服务器
npm run build      # 类型检查 + 生产构建
npm run test:smoke # 无头浏览器冒烟测试(Playwright)
```

## 架构

```
src/
├── types.ts            数据类型:部件/挂点/杆件/姿态/配置
├── config.ts           默认 6 部件层级与 3 杆绑定
├── storage.ts          localStorage 持久化 + JSON 导入导出 + 校验
├── puppet/
│   ├── shapes.ts       部件轮廓与镂空孔(Shape/holes),含填实几何
│   ├── rig.ts          运动学骨架:挂点层级、铰接、限位、防穿透、回弹
│   └── rods.ts         操纵杆:位移→关节角换算、圆盘限位、姿态补间
├── render/
│   ├── mask.ts         双层镂空遮罩(silhouette + cutout RT)
│   ├── screen.ts       灯幕 shader:剪影/皮革/镂空三色合成
│   └── stage.ts        舞台:主视区 + 灯幕 PiP、背光、渲染循环、FPS
├── ui/
│   ├── rod-pad.ts      单杆操纵盘(pointer events,多指触控)
│   ├── pose-panel.ts   姿态库(最多 6 个)
│   ├── config-panel.ts 杆件绑定配置
│   └── control-panel.ts 总面板(组装子组件、背光、文件操作)
└── main.ts             事件总线与装配
```

## 关键设计

### 挂点层级与铰接
影偶固定 6 部件:`body`(根)— `head`/`leftArm`/`rightArm`/`leftLeg`/`rightLeg`,
子部件枢轴挂在父部件的 anchor 上。每帧沿 BFS 层级刷新世界变换,
子枢轴始终等于父挂点世界坐标,**铰接永不脱开**。

### 杆件 → 关节角
每根杆 1~2 个挂点绑定(轴向 + 换算系数):

```
localAngle = restAngle + (rodPos[axis] - home[axis]) * scale
```

操纵盘坐标夹在半径 `ROD_RANGE` 的圆盘内(极限位置)。目标角写入骨架后,
被驱动部件用临界阻尼逼近,未驱动部件绕静止角做阻尼摆(松手回弹)。
每个部件有 `[min, max]` 角度限位,外加单帧角变化速率上限,**部件不会翻折穿透**。

### 双层镂空遮罩
单层遮罩无法区分"影偶外部"与"镂空内部",因此每帧重算两张 RT:

- `silhouette`:填实几何(无孔同轮廓)→ 黑=皮革,白=外部
- `cutout`:带 Shape holes 的真实几何 → 黑=镂空孔,白=其余

灯幕 shader 组合:外部暖光幕光、皮革近黑剪影、镂空高亮光。
遮罩网格在独立扁平 overlay 场景,每帧从源网格复制世界
position/quaternion/scale,与主场景材质/可见性解耦。实测重算约 0.2~0.4ms。

### 姿态
保存的是各杆归一化位置与背光强度(最多 6 个)。切换时杆件走 easeOutCubic 补间,
骨架临界阻尼跟随,实现平滑过渡;背光同步补间。

### 持久化与分享
配置(`RigConfig`:挂点层级 + 杆件绑定 + 姿态列表 + 背光)自动存 localStorage。
导出为带时间戳的 JSON 文件;导入经 `validateConfig` 严格校验
(6 部件、父子挂点存在、限位合法、杆 1~2 绑定、姿态 ≤6),非法结构整体拒绝、
可裁剪数据逐条过滤,保证导入后操纵效果可还原。

## 性能指标(无头浏览器实测,900p 软渲染)

- 3 杆持续同时拖动:FPS 最低约 35、平均约 42(要求 ≥30)
- 遮罩重算:平均 0.23ms、最大 0.4ms(要求一帧内,预算 16.7ms)
