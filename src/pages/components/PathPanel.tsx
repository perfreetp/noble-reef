import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { projectStore } from '../../store/projectStore';
import { setUiStore, uiStore } from '../../store/uiStore';
import {
  addPath,
  deleteControlPoint,
  deletePath,
  renamePath,
  updatePathStyle,
} from '../../store/actions';
import { SLOPE_LIMIT_DEG } from '../../config/constants';
import { useScene } from './sceneContext';
import { pushToast } from './toast';

export const PathPanel = (): JSX.Element => {
  const scene = useScene();
  const stats = scene.pathManager.statsMemo;

  return (
    <>
      <div class="panel-section">
        <h3>步道列表</h3>
        <button
          class="btn primary"
          style={{ width: '100%' }}
          onClick={() => {
            const id = addPath();
            setUiStore('selection', { kind: 'path', id });
            pushToast('已新建步道，在地形上单击添加控制点', 'success');
          }}
        >
          + 新建步道
        </button>
      </div>

      <For each={projectStore.pathOrder}>
        {(pathId) => {
          const path = () => projectStore.paths[pathId]!;
          const selected = () =>
            uiStore.selection.kind === 'path' && uiStore.selection.id === pathId;
          return (
            <div class="panel-section">
              <div
                class={`list-item ${selected() ? 'selected' : ''}`}
                onClick={() => setUiStore('selection', { kind: 'path', id: pathId })}
              >
                <div>
                  <input
                    type="text"
                    value={path().name}
                    style={{ width: '120px', 'border-color': 'transparent', background: 'transparent' }}
                    onClick={(e) => e.stopPropagation()}
                    onInput={(e) => renamePath(pathId, e.currentTarget.value)}
                  />
                  <div class="meta">{path().controlPoints.length} 个控制点</div>
                </div>
                <button
                  class="btn danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    deletePath(pathId);
                  }}
                >
                  删除
                </button>
              </div>

              <Show when={stats()[pathId]}>
                {(s) => (
                  <div class="stat-box" style={{ margin: '8px 0' }}>
                    <div>总长：{s().totalLen.toFixed(1)} m</div>
                    <div>
                      最大坡角：
                      <span class={s().maxSlopeDeg > SLOPE_LIMIT_DEG ? 'warn' : 'ok'}>
                        {s().maxSlopeDeg.toFixed(1)}°
                      </span>
                    </div>
                    <Show
                      when={s().intervalCount > 0}
                      fallback={<span class="ok">坡度全部满足 ≤ {SLOPE_LIMIT_DEG}°</span>}
                    >
                      <span class="warn">
                        超限 {s().intervalCount} 段 / 共 {s().overLimitLength.toFixed(1)} m（红色高亮）
                      </span>
                    </Show>
                  </div>
                )}
              </Show>

              <Show when={selected()}>
                <div class="panel-section">
                  <label class="field">
                    <span class="field-label">
                      <span>路面宽度</span>
                      <span>{path().style.width.toFixed(1)} m</span>
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={6}
                      step={0.2}
                      value={path().style.width}
                      onInput={(e) =>
                        updatePathStyle(pathId, { width: Number(e.currentTarget.value) })
                      }
                    />
                  </label>
                  <label class="field">
                    <span class="field-label">
                      <span>护栏高度</span>
                      <span>{path().style.railHeight.toFixed(2)} m</span>
                    </span>
                    <input
                      type="range"
                      min={0.6}
                      max={1.6}
                      step={0.05}
                      value={path().style.railHeight}
                      onInput={(e) =>
                        updatePathStyle(pathId, { railHeight: Number(e.currentTarget.value) })
                      }
                    />
                  </label>
                  <div class="btn-row">
                    <button
                      class={`btn ${path().style.hasWall ? 'toggled' : ''}`}
                      onClick={() => updatePathStyle(pathId, { hasWall: !path().style.hasWall })}
                    >
                      护坡
                    </button>
                    <button
                      class={`btn ${path().style.hasRail ? 'toggled' : ''}`}
                      onClick={() => updatePathStyle(pathId, { hasRail: !path().style.hasRail })}
                    >
                      护栏
                    </button>
                  </div>
                </div>

                <div class="panel-section">
                  <h3>控制点</h3>
                  <For each={path().controlPoints}>
                    {(cp, i) => (
                      <div class="list-item">
                        <span>
                          #{i() + 1} （{cp.x.toFixed(1)}, {cp.z.toFixed(1)}）
                        </span>
                        <button
                          class="btn danger"
                          onClick={() => deleteControlPoint(pathId, cp.id)}
                        >
                          移除
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          );
        }}
      </For>

      <Show when={projectStore.pathOrder.length === 0}>
        <div class="stat-box">还没有步道。新建后在场景中单击地形放置控制点，拖动黄色球可调整弯道。</div>
      </Show>
    </>
  );
};
