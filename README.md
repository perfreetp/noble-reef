# 盆景工坊 · Bonsai Studio

基于 three.js + postprocessing 的盆景枝叶生长可视化工具,React 组织界面,数据存于浏览器 localStorage,场景可导出为 JSON 文件分享、再导入。

## 运行

```bash
npm install
npm run dev      # 开发服务器
npm run build    # 生产构建(dist/)
npm run preview  # 预览生产构建
npx tsx scripts/smoke.ts   # 核心生成逻辑冒烟测试
```

## 四个模块(按造景流程串联)

1. **骨架编辑** — 拖动场景中的橙色控制点塑形主干与分枝;系统按枝干层级生成约 2000 根细枝实例,每根带独立生长相位。时间轴推进时枝叶按 0→1 生长度逐级萌发。修剪模式下点击枝条,其下游生长度归零并重算父级重心(红点标记)。
2. **生长参数** — 分枝角度、节间距、叶片密度、随机种子、细枝数量;改动后整树实例缓冲毫秒级重建(预算 3 秒,实测约 8ms)。
3. **苔藓材质** — 程序化 FBM 噪声生成苔藓覆盖;湿度 0–100 驱动颜色(干黄褐→湿深绿)与伪次表面散射强度;岩石表面按法线朝上程度决定分布。
4. **布光与倒影** — 三点布光(主/补/轮廓)+ 盆钵水面平面反射(菲涅尔混合);叶片半透明,每帧按视深排序实例避免穿插错误。

## 数据与分享

- 所有参数自动持久化到 localStorage(播放状态除外,避免每帧写盘)。
- 工具栏「导出场景」打包骨架、生长、苔藓、布光参数与修剪记录为 JSON;「导入」恢复整个场景。

## 结构

```
src/
  types.ts            数据模型与默认参数
  store.ts            zustand 状态(persist 到 localStorage)+ 导出/导入
  core/
    defaultSkeleton.ts 默认骨架(主干 + 分枝控制点)
    generator.ts      骨架展开 → 约2000细枝实例、生长度、修剪、重心
    random.ts         确定性种子随机
  scene/
    BonsaiScene.ts    渲染器、三点光、postprocessing(Bloom/SMAA/Vignette)、主循环
    foliage.ts        细枝/叶片 InstancedMesh,叶片逐帧深度排序
    rock.ts           盆钵、岩石、苔藓注入式材质
    water.ts          平面反射水面 + 菲涅尔 + 涟漪
    skeletonEditor.ts 控制点拖拽与枝干拾取
  components/         React 面板(骨架/生长/苔藓/布光/时间轴/工具栏)
```
