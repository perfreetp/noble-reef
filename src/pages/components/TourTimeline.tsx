import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { projectStore } from '../../store/projectStore';
import { uiStore } from '../../store/uiStore';
import {
  addViewpoint,
  deleteViewpoint,
  updateViewpoint,
} from '../../store/actions';
import { useScene } from './sceneContext';
import { pushToast } from './toast';
import type { CameraMode } from '../../types/project';

export const TourTimeline = (): JSX.Element => {
  const scene = useScene();
  const player = scene.tourPlayer;

  const addAtCurrent = (mode: CameraMode): void => {
    const pathId = projectStore.pathOrder[0];
    if (!pathId) {
      pushToast('请先在步道页创建至少一条步道', 'error');
      return;
    }
    const t = projectStore.viewpoints.length === 0 ? 0 : 1;
    addViewpoint(pathId, t, mode);
    pushToast('已添加漫游关键点', 'success');
  };

  return (
    <>
      <div class="panel-section">
        <h3>播放控制</h3>
        <div class="btn-row" style={{ margin: '0 0 10px' }}>
          <button
            class="btn primary"
            disabled={projectStore.viewpoints.length < 1}
            onClick={() => (uiStore.tour.playing ? player.pause() : player.play())}
          >
            {uiStore.tour.playing ? '⏸ 暂停' : '▶ 播放'}
          </button>
          <button class="btn" onClick={() => player.seek(0)}>
            ⏮ 回到起点
          </button>
        </div>
        <div class="seg-group">
          <button
            class={`seg ${uiStore.tour.mode === 'fp' ? 'active' : ''}`}
            onClick={() => player.setMode('fp')}
          >
            第一人称
          </button>
          <button
            class={`seg ${uiStore.tour.mode === 'top' ? 'active' : ''}`}
            onClick={() => player.setMode('top')}
          >
            俯瞰
          </button>
        </div>
        <div class="timeline">
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(uiStore.tour.progress * 1000)}
            onInput={(e) => player.seek(Number(e.currentTarget.value) / 1000)}
          />
          <div class="meta" style={{ 'text-align': 'center', color: '#7a8896', 'font-size': '12px' }}>
            进度 {(uiStore.tour.progress * 100).toFixed(0)}% · 相机高度随地形起伏实时跟随
          </div>
        </div>
      </div>

      <div class="panel-section">
        <h3>关键点（{projectStore.viewpoints.length}）</h3>
        <div class="btn-row" style={{ margin: '0 0 10px' }}>
          <button class="btn" onClick={() => addAtCurrent('fp')}>
            + 第一人称点
          </button>
          <button class="btn" onClick={() => addAtCurrent('top')}>
            + 俯瞰点
          </button>
        </div>
        <For each={projectStore.viewpoints}>
          {(vp, i) => (
            <div class="list-item" style={{ display: 'block' }}>
              <div style={{ display: 'flex', 'justify-content': 'space-between' }}>
                <strong>
                  关键点 {i() + 1}（{vp.mode === 'fp' ? '第一人称' : '俯瞰'}）
                </strong>
                <button class="btn danger" onClick={() => deleteViewpoint(vp.id)}>
                  删除
                </button>
              </div>
              <label class="field" style={{ margin: '6px 0 2px' }}>
                <span class="field-label">
                  <span>所属步道</span>
                </span>
                <select
                  value={vp.pathId}
                  onChange={(e) => updateViewpoint(vp.id, { pathId: e.currentTarget.value })}
                >
                  <For each={projectStore.pathOrder}>
                    {(pid) => <option value={pid}>{projectStore.paths[pid]!.name}</option>}
                  </For>
                </select>
              </label>
              <label class="field">
                <span class="field-label">
                  <span>沿路径位置 t</span>
                  <span>{vp.t.toFixed(2)}</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={vp.t}
                  onInput={(e) => updateViewpoint(vp.id, { t: Number(e.currentTarget.value) })}
                />
              </label>
              <label class="field">
                <span class="field-label">
                  <span>视高 / 段时长</span>
                  <span>{vp.eyeHeight.toFixed(1)}m · {vp.durationSec.toFixed(1)}s</span>
                </span>
                <input
                  type="range"
                  min={0.5}
                  max={12}
                  step={0.5}
                  value={vp.durationSec}
                  onInput={(e) => updateViewpoint(vp.id, { durationSec: Number(e.currentTarget.value) })}
                />
              </label>
            </div>
          )}
        </For>
        <Show when={projectStore.viewpoints.length === 0}>
          <div class="stat-box">
            关键点沿步道里程定位。添加两个以上关键点后即可播放，相机在点间按时长插值，高度实时跟随地形。
          </div>
        </Show>
      </div>
    </>
  );
};
