# 天线阵列波束方向图渲染器

基于 **Vue 3 + TypeScript + Babylon.js（WebGPU 优先，WebGL2 自动回退）** 的相控阵方向图交互式渲染器。
方向图采样与等高线提取运行在 Web Worker 中，球面旋转/相机交互始终保持在主线程流畅执行。

## 功能模块

### 1. 天线布置（观测站地面平面）
- SVG 俯视图：**空白处点击添加**天线，**按住圆点拖动**改位，红色 × 删除（另有重置/清空）
- 实时显示天线数与**基线数量** N(N−1)/2，每条基线中点**实时标注长度（米）**，可开关
- 3D 场景地面同步显示天线立柱与 3D 基线连线

### 2. 观测参数
- 观测频率 50–3000 MHz（滑杆 + 数字输入），实时显示波长
- 指向天顶角 θ₀（0–90°）与方位角 φ₀（0–360°，东 0°→北 90°）
- **频率变化时主瓣宽度（HPBW）与旁瓣结构联动重算**；指向变化时球面即时旋转
- 指标卡：HPBW、第一旁瓣电平、基线数/最长基线、λ/D 瑞利估计

### 3. 方向图渲染
- θ–φ 规则网格采样 **73 × 128 = 9344 个方向**（上千级），物理模型：
  各向同性点源、均匀幅度、相位共轭权；`AF = Σ exp[j k (rᵢ·s − rᵢ·s0)]`，
  采样方向先经与 3D 场景同一旋转矩阵映射到全局坐标，主瓣恒在局部天顶
- 增益归一化为 dB，经 9 段颜色 LUT 映射到**与采样网格一一对应的自定义球面顶点色**
- **marching squares 等高线**：−3 dB 白（主瓣描边）、−10 dB 黄、−20 dB 橙，挂为球子节点随指向旋转
- 旁瓣按增益分级冷色着色，主瓣暖色高亮

### 4. 剖面分析
- 沿主瓣子午面切大圆，±90° 共 721 点双线性插值增益剖面（曲线按增益着色）
- 标注 **HPBW（−3 dB 全宽，插值穿越点 + 宽度箭头）**与**第一旁瓣电平**（红色虚线）
- 拖动指向角/改布局时随 worker 结果同步刷新

### 5. 数据与导出
- 布局与观测参数自动保存到浏览器 **localStorage**（300 ms 防抖）
- 导出：天线坐标 CSV/JSON；方向图增益 CSV（9344 行 θ,φ,dB）/JSON

## 性能设计

| 环节 | 位置 | 典型耗时（9 天线 / 9344 方向） |
| --- | --- | --- |
| 阵列因子网格 | Web Worker | ~14 ms |
| 剖面分析 | 主线程（纯数组，~1.7 ms） | 2 ms 内 |
| 3 条等高线提取 | Web Worker | ~52 ms（不占帧时间） |
| 球面重着色 | 主线程，仅更新 vertex color buffer | 单次 buffer 上传 |
| 指向旋转 | 主线程，仅改球四元数 | 0 重算，即时响应 |

天线/频率/指向变更经 100 ms 防抖合并；worker 单飞 + 过期结果丢弃，避免拖拽时任务堆积。

## 命令

```bash
npm install
npm run dev        # 开发服务器
npm run build      # vue-tsc 类型检查 + 生产构建
npm run test:physics   # 物理内核单测（基线、ULA 理论 HPBW、频率联动、指向不变性等 12 项）
npm run bench          # 内核性能测量
npm run test:browser      # 无头浏览器冒烟（需先起 dev server，CDP 无第三方依赖）
npm run test:interactions # 无头交互联动测试
```

## 目录结构

```
src/
├─ compute/           # 与渲染解耦的纯计算内核（worker 与主线程共用）
│  ├─ physics.ts      # 波长、基线枚举、阵列因子网格
│  ├─ colormap.ts     # dB → RGB 颜色 LUT
│  ├─ contour.ts      # marching squares 等高线
│  ├─ profile.ts      # 剖面切片、HPBW、第一旁瓣
│  ├─ pattern.worker.ts
│  └─ types.ts / defaults.ts
├─ babylon/beamScene.ts   # WebGPU/WebGL2 场景、自定义球面、等高线、地面站
├─ store/store.ts         # 响应式状态、worker 调度、持久化、导出
└─ components/            # 4 个功能面板 + 图例
```

> 无头/虚拟 GPU 环境下 WebGPU 初始化会失败并自动回退 WebGL2（功能一致）；
> 带 GPU 的 Chrome 113+/Edge 上默认走 WebGPU。
