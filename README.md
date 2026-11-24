# 球幕天象投影叠加演示

面向天文科普展馆球幕投影的天象叠加工具:SolidJS + three.js + postprocessing。

## 运行

```bash
npm install
npm run dev      # 开发
npm run build    # 构建到 dist/
```

## 功能与模块

| 模块 | 文件 | 说明 |
|---|---|---|
| 星空图层 | `src/scene/stars.js` | 8000 颗恒星单 draw call 点云,星等→亮度/大小分级(`10^(-0.4m)`),赤经赤纬→球面坐标一次性换算 |
| 星座图层 | `src/scene/constellations.js` | 11 个主要星座,连线按大圆 2.5° 分段,名称标注为朝向相机的精灵 |
| 地平线图层 | `src/scene/horizon.js` | 地平圈 + 5°/15° 方位刻度 + 四正方位标注;纬度 −90°~90° 滑杆驱动地平圈倾斜(天顶赤纬=纬度) |
| 银河图层 | `src/scene/milkyway.js` | 程序化银道带纹理(银纬高斯衰减+银心增亮+尘埃暗裂),与星空加法混合,弱/标准/强三档 |
| 时间控制 | `src/astro.js` | 日期+时刻滑杆 → UTC → GMST 恒星时;天球组一次矩阵旋转,所有图层联动 |
| 投影模块 | `src/scene/projection.js` | 球面投影 ⇄ 等距柱状投影,共享 uniform + 顶点着色器重采样,切换即时生效 |
| 后期合成 | `src/scene/engine.js` | postprocessing EffectComposer:Bloom + Vignette,每帧完成全部图层叠加合成 |
| 状态分享 | `src/state.js` | 时间/纬度/投影/图层开关导出为 JSON,导入后还原天象状态(带数值钳制校验) |

## 性能设计

- 恒星位置不随时间逐帧重算:恒星时变化只更新 `skyGroup.rotation.y` 一个矩阵,8000 颗恒星拖时间滑杆远超 30 FPS(面板左下角有实时 FPS)。
- 投影切换是着色器 uniform 切换,几何体零重建;仅文字标注(约 20 个精灵)在等距柱状模式下每帧做 CPU 重投影。
- 星座连线、地平圈、刻度全部预分段,静态几何。

## 坐标约定

- 天球:+Y 为北天极,赤经沿 −Z 方向增长;观测经度固定 0°(LST = GMST),时刻滑杆按 UTC。
- 观测者系:地平圈固定,天球按恒星时旋转;天顶方向 (cosφ, sinφ, 0),φ 为观测纬度。
