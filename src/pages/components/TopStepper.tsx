import type { JSX } from 'solid-js';
import { setUiStore, uiStore } from '../../store/uiStore';
import type { PageName } from '../../types/engine';

const PAGES: { key: PageName; label: string }[] = [
  { key: 'terrain', label: '地形编辑' },
  { key: 'path', label: '步道布置' },
  { key: 'facility', label: '设施放置' },
  { key: 'viewpoint', label: '视点漫游' },
];

export const TopStepper = (): JSX.Element => (
  <div class="stepper">
    {PAGES.map((p, i) => (
      <button
        class={`step ${uiStore.activePage === p.key ? 'active' : ''}`}
        onClick={() => setUiStore('activePage', p.key)}
      >
        <span class="num">{i + 1}</span>
        {p.label}
      </button>
    ))}
  </div>
);
