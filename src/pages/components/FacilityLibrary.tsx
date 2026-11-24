import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { FACILITY_CATALOG } from '../../config/facilityCatalog';
import { deleteFacility } from '../../store/actions';
import { projectStore } from '../../store/projectStore';
import { setUiStore, uiStore } from '../../store/uiStore';
import { useScene } from './sceneContext';
import { getCatalogEntry } from '../../config/facilityCatalog';
import type { FacilityType } from '../../types/project';
import { pushToast } from './toast';

const footprintText = (type: FacilityType): string => {
  const fp = getCatalogEntry(type).footprint;
  return fp.shape === 'circle' ? `圆形 r=${fp.radius}m` : `矩形 ${fp.w}×${fp.d}m`;
};

export const FacilityLibrary = (): JSX.Element => {
  const scene = useScene();

  const pickDraft = (type: FacilityType | null): void => {
    scene.setFacilityDraft(type);
    if (type) pushToast(`移动鼠标预览占地，单击放置${getCatalogEntry(type).name}`, 'info');
  };

  return (
    <>
      <div class="panel-section">
        <h3>设施库</h3>
        <For each={FACILITY_CATALOG}>
          {(entry) => (
            <div
              class="list-item"
              style={{ cursor: 'pointer' }}
              onClick={() => pickDraft(entry.type)}
            >
              <div>
                <span class="color-swatch" style={{ background: `#${entry.color.toString(16).padStart(6, '0')}` }} />
                <strong>{entry.name}</strong>
                <div class="meta">{entry.description}</div>
                <div class="meta">占地：{footprintText(entry.type)}（放置自动整平）</div>
              </div>
              <button class="btn primary">放置</button>
            </div>
          )}
        </For>
        <button class="btn" style={{ width: '100%', 'margin-top': '8px' }} onClick={() => pickDraft(null)}>
          取消放置（改为选择/移动模式）
        </button>
      </div>

      <div class="panel-section">
        <h3>已放置设施（{projectStore.facilityOrder.length}）</h3>
        <For each={projectStore.facilityOrder}>
          {(id) => {
            const f = () => projectStore.facilities[id]!;
            return (
              <div
                class={`list-item ${uiStore.selection.id === id ? 'selected' : ''}`}
                onClick={() => {
                  setUiStore('selection', { kind: 'facility', id });
                  scene.facilityManager.showSelectionRing(f());
                }}
              >
                <div>
                  {getCatalogEntry(f().type).name}
                  <div class="meta">
                    整平标高 {f().baseHeight.toFixed(2)} m · ({f().x.toFixed(1)}, {f().z.toFixed(1)})
                  </div>
                </div>
                <button
                  class="btn danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteFacility(id);
                    scene.facilityManager.hideSelectionRing();
                    pushToast('设施已删除（可用撤销恢复，地形不自动回填）', 'info');
                  }}
                >
                  删除
                </button>
              </div>
            );
          }}
        </For>
        <Show when={projectStore.facilityOrder.length === 0}>
          <div class="stat-box">放置设施时会按占地整平地形；整平区与步道相交时，路径高度自动重算。</div>
        </Show>
      </div>
    </>
  );
};
