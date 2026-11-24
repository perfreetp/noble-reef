import { onCleanup, onMount } from 'solid-js';
import { UnderwaterEngine } from '../three/UnderwaterEngine';
import { useSceneStore, setLightPosition } from '../store';
import { updateFrameStats, updateLastAutoGains, useFrameStats } from '../stats';

/** three.js 视口：引擎生命周期、HUD 帧率与操作提示 */
export function Viewport() {
  let container: HTMLDivElement | undefined;
  const stats = useFrameStats();

  onMount(() => {
    const engine = new UnderwaterEngine(
      container!,
      useSceneStore,
      (s) => {
        updateFrameStats(s);
        updateLastAutoGains(s.appliedGains);
      },
      (id, pos) => setLightPosition(id, pos),
    );
    onCleanup(() => engine.dispose());
  });

  const fpsClass = () =>
    stats().fps >= 50 ? 'badge good' : stats().fps >= 30 ? 'badge warn' : 'badge';

  return (
    <div class="viewport" ref={container}>
      <div class="hud">
        <span class={fpsClass()}>{stats().fps > 0 ? `${stats().fps} FPS` : '— FPS'}</span>
      </div>
      <div class="hint">
        左键拖动空白处：旋转视角 · 滚轮：缩放
        <br />
        拖动发光球体：移动补光灯 · Shift+拖动：仅调高度
      </div>
    </div>
  );
}
