import './style.css';
import { ControlPanel, registerComponents } from './ui/control-panel';
import { Stage } from './render/stage';
import { defaultConfig } from './config';
import { exportJSON, importJSON, loadConfig, saveConfig, validateConfig } from './storage';
import type { Pose, RigConfig, RodDef } from './types';
import { MAX_POSES } from './types';

registerComponents();

let cfg: RigConfig = loadConfig();
const stageRoot = document.querySelector<HTMLDivElement>('#stage-root')!;
const panel = document.querySelector<ControlPanel>('#panel')!;
const stage = new Stage(stageRoot, cfg.parts, cfg.rods, cfg.lightIntensity);

panel.setConfig(cfg);

// ---------- 每帧:旋钮与补间后的杆件位置同步 ----------
function syncLoop(): void {
  const snapshot = stage.rodController.snapshot();
  panel.syncKnobs(snapshot);
  requestAnimationFrame(syncLoop);
}
requestAnimationFrame(syncLoop);

function persist(): void {
  saveConfig(cfg);
}

// ---------- 操纵杆事件 ----------
panel.addEventListener('rod-input', (e) => {
  const { id, pos } = (e as CustomEvent).detail;
  stage.rodController.setInput(id, pos);
});
panel.addEventListener('rod-release', (e) => {
  const { id } = (e as CustomEvent).detail;
  stage.rodController.release(id);
});

// ---------- 背光 ----------
panel.addEventListener('light-change', (e) => {
  const v = (e as CustomEvent).detail.value as number;
  cfg.lightIntensity = v;
  stage.setLight(v, true);
  persist();
});

// ---------- 姿态库 ----------
panel.addEventListener('pose-save', () => {
  if (cfg.poses.length >= MAX_POSES) return;
  const pose: Pose = {
    id: `pose-${cfg.poses.length + 1}-${Date.now().toString(36)}`,
    name: `姿态 ${cfg.poses.length + 1}`,
    rods: stage.rodController.snapshot(),
    light: stage.light,
    createdAt: Date.now(),
  };
  cfg.poses.push(pose);
  panel.refreshPoses(cfg.poses);
  panel.setActivePose(pose.id);
  persist();
});

panel.addEventListener('pose-apply', (e) => {
  const id = (e as CustomEvent).detail.id as string;
  const pose = cfg.poses.find((p) => p.id === id);
  if (!pose) return;
  // 杆件平滑过渡,背光同步过渡
  stage.rodController.tweenTo(pose.rods, 0.5);
  stage.setLight(pose.light, true);
  cfg.lightIntensity = pose.light;
  panel.setLightValue(pose.light);
  panel.setActivePose(id);
  persist();
});

panel.addEventListener('pose-rename', (e) => {
  const { id, name } = (e as CustomEvent).detail;
  const pose = cfg.poses.find((p) => p.id === id);
  if (pose) {
    pose.name = name;
    panel.refreshPoses(cfg.poses);
    persist();
  }
});

panel.addEventListener('pose-delete', (e) => {
  const id = (e as CustomEvent).detail.id as string;
  cfg.poses = cfg.poses.filter((p) => p.id !== id);
  panel.refreshPoses(cfg.poses);
  persist();
});

// ---------- 杆件绑定改配 ----------
panel.addEventListener('binding-change', (e) => {
  const rods = (e as CustomEvent).detail.rods as RodDef[];
  cfg.rods = structuredClone(rods);
  stage.rodController.configure(cfg.rods);
  panel.setConfig(cfg); // 重建操纵盘(新绑定下的 home 位置)
  persist();
});

// ---------- 导入 / 导出 / 重置 ----------
panel.addEventListener('export', () => exportJSON(cfg));

panel.addEventListener('import', async (e) => {
  const file = (e as CustomEvent).detail.file as File;
  try {
    cfg = await importJSON(file);
    stage.rebuild(cfg.parts, cfg.rods);
    stage.setLight(cfg.lightIntensity);
    panel.setConfig(cfg);
  } catch (err) {
    alert(`导入失败:${err instanceof Error ? err.message : '文件格式不合法'}`);
  }
});

panel.addEventListener('reset', () => {
  if (!window.confirm('恢复默认影偶?当前配置与姿态将被覆盖。')) return;
  cfg = defaultConfig();
  saveConfig(cfg);
  stage.rebuild(cfg.parts, cfg.rods);
  stage.setLight(cfg.lightIntensity);
  panel.setConfig(cfg);
});

// 防御:页面卸载前确保最新配置落盘
window.addEventListener('pagehide', () => {
  saveConfig(validateConfig(cfg));
});

// 调试/自动化探针:读取关节角、限位状态、背光与性能读数
declare global {
  interface Window {
    __probe?: {
      (): Record<string, unknown>;
      stats: () => { fps: number; maskMs: number };
      light: () => number;
    };
  }
}
let lastStats = { fps: 0, maskMs: 0 };
stage.onStats = (fps, maskMs) => {
  lastStats = { fps, maskMs };
  panel.setStats(fps, maskMs);
};
window.__probe = Object.assign(
  () => {
    const angles: Record<string, number> = {};
    let withinLimits = true;
    for (const id of ['head', 'body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const) {
      const part = stage.rigController.getPart(id);
      angles[id] = Number(part.angle.toFixed(4));
      const [lo, hi] = part.def.limits;
      if (part.angle < lo - 1e-6 || part.angle > hi + 1e-6) withinLimits = false;
    }
    return {
      angles,
      withinLimits,
      rodPositions: stage.rodController.snapshot(),
      tipWorld: {
        head: stage.rigController.tipWorld('head'),
        leftArm: stage.rigController.tipWorld('leftArm'),
      },
    };
  },
  {
    stats: () => lastStats,
    light: () => stage.light,
  },
) as Window['__probe'];
