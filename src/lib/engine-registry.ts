import type { PlazaEngine } from './engine/plaza-engine';

// 引擎单例注册表：CanvasStage 注册，各面板读取（避免组件间层层传参）
let engine: PlazaEngine | null = null;

export function registerEngine(e: PlazaEngine | null) {
  engine = e;
}

export function getEngine(): PlazaEngine | null {
  return engine;
}
