import { createStore } from 'solid-js/store';
import {
  BRUSH_RADII,
  BRUSH_STRENGTH_DEFAULT,
  SMOOTH_FACTOR_DEFAULT,
} from '../config/constants';
import type { BrushSettings, PageName, SelectionState, TourPlayback } from '../types/engine';

interface UiState {
  activePage: PageName;
  brush: BrushSettings;
  selection: SelectionState;
  tour: TourPlayback;
  /** 植被是否可见（性能对比开关） */
  vegetationVisible: boolean;
}

export const [uiStore, setUiStore] = createStore<UiState>({
  activePage: 'terrain',
  brush: {
    mode: 'raise',
    radiusIdx: 1,
    strength: BRUSH_STRENGTH_DEFAULT,
    smoothFactor: SMOOTH_FACTOR_DEFAULT,
    contourInterval: 5,
  },
  selection: { kind: 'none', id: null },
  tour: { playing: false, progress: 0, mode: 'fp' },
  vegetationVisible: true,
});

export const brushRadius = (): number => BRUSH_RADII[uiStore.brush.radiusIdx] ?? BRUSH_RADII[1]!;
