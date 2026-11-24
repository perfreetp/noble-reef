import type { FoliageParams, PotParams, Project, ShapeState, TreeParams } from '../core/types';

const KEY = 'bonsai-studio/v1';
const AUTOSAVE_DELAY = 500;

export interface SavedState {
  tree: TreeParams;
  shape: ShapeState;
  foliage: FoliageParams;
  pot: PotParams;
  savedAt: string;
}

interface StoredEnvelope {
  version: 1;
  savedAt: string;
  state: SavedState;
}

/** Wraps localStorage so private-mode failures never break the editor. */
export class LocalStore {
  private timer: number | null = null;
  private pending: SavedState | null = null;
  private available: boolean;
  lastSaved: Date | null = null;
  onSaved: (() => void) | null = null;

  constructor() {
    this.available = probeStorage();
  }

  get supported(): boolean {
    return this.available;
  }

  load(): SavedState | null {
    if (!this.available) return null;
    try {
      const text = localStorage.getItem(KEY);
      if (!text) return null;
      const env = JSON.parse(text) as StoredEnvelope;
      if (env?.version !== 1 || !env.state) return null;
      return env.state;
    } catch {
      return null;
    }
  }

  save(state: SavedState): void {
    this.pending = state;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.flush(), AUTOSAVE_DELAY);
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.pending || !this.available) return;
    const env: StoredEnvelope = {
      version: 1,
      savedAt: new Date().toISOString(),
      state: this.pending,
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(env));
      this.lastSaved = new Date();
      this.pending = null;
      this.onSaved?.();
    } catch {
      // Quota or blocked storage: keep editing, just stop reporting saves.
      this.available = false;
    }
  }

  /** Internationalisation-free relative time for the status bar. */
  savedAgo(): string {
    if (!this.lastSaved) return '未保存';
    const secs = Math.max(0, Math.round((Date.now() - this.lastSaved.getTime()) / 1000));
    if (secs < 3) return '刚刚保存';
    if (secs < 60) return `${secs} 秒前保存`;
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins} 分钟前保存`;
    const hours = Math.round(mins / 60);
    return `${hours} 小时前保存`;
  }

  clear(): void {
    if (!this.available) return;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nothing to do */
    }
  }
}

function probeStorage(): boolean {
  try {
    const probe = '__bonsai_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function projectToState(p: Project): SavedState {
  return { tree: p.tree, shape: p.shape, foliage: p.foliage, pot: p.pot, savedAt: p.createdAt };
}
