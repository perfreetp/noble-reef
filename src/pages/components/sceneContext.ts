import { createContext, useContext } from 'solid-js';
import type { SceneController } from '../../engine/SceneController';

/** SceneController 在 App 中创建后通过 context 提供给面板使用 */
export const SceneContext = createContext<SceneController | null>(null);

export const useScene = (): SceneController => {
  const ctx = useContext(SceneContext);
  if (!ctx) throw new Error('SceneController 尚未提供');
  return ctx;
};
