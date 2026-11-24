import type { JSX } from 'solid-js';
import { canRedo, canUndo, redo, undo } from '../../store/actions';

export const HistoryButtons = (): JSX.Element => (
  <div class="btn-row" style={{ flex: '0 0 auto' }}>
    <button class="btn" disabled={!canUndo()} onClick={() => undo()} title="撤销最近操作（最多 20 步）">
      ↶ 撤销
    </button>
    <button class="btn" disabled={!canRedo()} onClick={() => redo()} title="重做">
      ↷ 重做
    </button>
  </div>
);
