import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { sky } from './state.js';
import { createEngine, STAR_COUNT } from './scene/engine.js';
import ControlPanel from './ControlPanel.jsx';

export default function App() {
  let container;
  const [fps, setFps] = createSignal(0);
  let engine;

  onMount(() => {
    engine = createEngine(container, { onFps: setFps });

    // Solid 状态 -> 渲染引擎 的单向同步
    createEffect(() => engine.setTime(sky.date, sky.time));
    createEffect(() => engine.setLatitude(sky.latitude));
    createEffect(() => engine.setProjection(sky.projection));
    createEffect(() => engine.setMilkyWayIntensity(sky.milkyWay));
    createEffect(() => {
      for (const key of ['stars', 'constellations', 'horizon', 'milkyway']) {
        engine.setLayerVisible(key, sky.layers[key]);
      }
    });
  });

  onCleanup(() => engine?.dispose());

  return (
    <div class="app">
      <div ref={container} class="viewport" />
      <ControlPanel fps={fps()} starCount={STAR_COUNT} />
    </div>
  );
}
