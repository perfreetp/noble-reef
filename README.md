# 水下摄影布光工具

面向水下机械臂拍摄的实时布光与成片预览工具。技术栈：**TypeScript + SolidJS + three.js + Vite**。

## 启动

```bash
npm install
npm run dev        # 开发服务器
npm run build      # 类型检查 + 生产构建
npm run preview    # 预览生产构建
```

## 功能模块

### 1. 光源布置器（`src/components/LightPanel.tsx`）
- 最多 **4 盏补光灯**，可添加 / 删除 / 单独开关。
- 视口中发光球体即灯位，直接拖拽移动（**Shift+拖拽**只改高度 Y）；OrbitControls 旋转视角时自动避让。
- 每盏灯可调强度（0–1）与色温（**3000K–8000K**，Tanner Helland 算法转线性 RGB），手柄颜色随色温实时变化。

### 2. 水体吸收模型（`src/lib/water.ts` + `src/three/shaders.ts`）
- 三档预设：**清澈 / 近岸 / 浑浊**，参数参考 Jerlov 水体类型简化。
- RGB 三通道 Beer-Lambert 指数衰减 `exp(-a·d)`，**红光系数最大、衰减最快**，光程越长画面越偏蓝绿。
- 吸收系数随水深按比例缩放（0.4–2.5 倍），面板实时显示当前各通道系数与后向散射密度。
- 两段水路径分别建模：灯→表面（影响表面受光）、相机→表面（影响成片）+ 加性后向散射。

### 3. 白平衡面板（`src/components/WhiteBalancePanel.tsx` + `src/lib/whiteBalance.ts`）
- **自动**：对白平衡前的 HDR 线性均值按 Rec.709 亮度逐通道求增益，指数平滑防抖动。
- **手动**：R/G/B 三通道增益滑杆（0.25–4），可一键抓取当前自动值转手动。
- 面板显示当前成片画面的 **RGB 均值（0–255）**，由 GPU 降采样链回读，每 0.25s 更新。

### 4. 渲染管线与联动（`src/three/UnderwaterEngine.ts`）
```
场景 Pass (HDR HalfFloat + Depth)
  → 多灯各自吸收衰减后线性叠加（HDR，允许 >1）
  → 相机路径吸收 + 后向散射
  → 白平衡增益 → ACES filmic 色调映射（抑制多灯过曝）→ sRGB
  → 降采样 1×1 回读均值
```
移动灯位 / 调色温 / 切水体 / 调白平衡时，**通道衰减 → 物体着色 → 白平衡增益在同一帧内联动重算**；
多灯照同一表面按贡献叠加，最终统一做色调映射。

### 5. 方案导出 / 导入（`src/lib/exportPlan.ts`、`src/store.ts#importScene`）
导出 JSON 打包：每盏灯的位置、强度、色温、开关，水体档位与水深，白平衡模式与增益。
导入时做字段归一化（兼容 `colorTempKelvin`、`position{x,y,z}`、`gains` 等外部命名），并校验版本与灯数上限。

## 性能设计（4 灯拖拽 ≥ 50fps）

- 所有材质**共享同一份 uniform 对象**，逐帧只写值、零对象分配；临时向量全部复用。
- 灯数固定 4 的数组 uniform + 静态分支，无循环展开开销、无灯光增删导致的 shader 重编译。
- 像素比上限 1.5；均值统计走逐级 /2 降采样链（末端仅 1×1 回读），节流到 4Hz，不占主帧预算。
- Solid store 细粒度订阅：拖拽只更新对应灯的 `position` 字段，面板与引擎各自按需重算。

## 目录结构

```
src/
├─ types.ts                 场景状态 / 灯光 / 白平衡类型与默认值
├─ store.ts                 Solid 全局 store（单一数据源）+ 导入归一化
├─ stats.ts                 帧统计信号（RGB 均值、FPS、自动增益）
├─ lib/
│  ├─ kelvin.ts             色温 → 线性 RGB
│  ├─ water.ts              三档水体参数、水深缩放
│  ├─ whiteBalance.ts       自动增益计算 + 平滑
│  └─ exportPlan.ts         JSON 方案打包下载
├─ three/
│  ├─ shaders.ts            GLSL：水下材质 / 输出 / 降采样 / 拷贝
│  ├─ uniforms.ts           共享 uniform 句柄
│  ├─ robotArm.ts           机械臂与海床建模
│  ├─ LightDragController.ts 灯位射线拖拽
│  └─ UnderwaterEngine.ts   渲染管线、均值链、自动白平衡闭环
└─ components/              Solid 面板与视口
```
