import { createContext, useCallback, useContext, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { DocumentState } from '../types';
import { createBuiltinGeometry, geometryInfo } from '../geometry/modelLibrary';

function createDefaultState(): DocumentState {
  const geometry = createBuiltinGeometry('builtin-neko');
  const info = geometryInfo(geometry);
  const cutHeight = info.minY + (info.maxY - info.minY) * 0.47;
  return {
    step: 'model',
    modelId: 'builtin-neko',
    modelName: '星愿人形手办',
    modelSource: 'builtin',
    format: '程序化',
    ...info,
    contour: [],
    contourClosed: true,
    cutHeight,
    cutReady: false,
    explode: 22,
    showSection: true,
    tenon: {
      count: 5,
      radius: 3.2,
      depth: 8,
      clearance: 0.35,
      side: 'lower',
      gridPadding: 5,
      minCover: 1.6,
    },
    wall: {
      enabled: false,
      thickness: 3,
      thinThreshold: 4.2,
      autoThicken: true,
    },
    showConflictOnly: false,
    showInnerShell: true,
  };
}

interface HistoryState {
  past: DocumentState[];
  present: DocumentState;
  future: DocumentState[];
  label: string;
}

type Patch = Partial<DocumentState> | ((s: DocumentState) => Partial<DocumentState>);

type HistoryAction =
  | { type: 'commit'; patch: Patch; label?: string }
  | { type: 'commit-base'; base: DocumentState; label: string }
  | { type: 'live'; patch: Patch }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset' };

function clone<T>(value: T): T {
  return structuredClone(value);
}

function mergePatch(present: DocumentState, patch: Patch): DocumentState {
  const resolved = typeof patch === 'function' ? patch(present) : patch;
  return { ...present, ...resolved };
}

function reducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'commit': {
      const next = mergePatch(state.present, action.patch);
      return {
        past: [...state.past.slice(-99), clone(state.present)],
        present: next,
        future: [],
        label: action.label ?? '编辑文档',
      };
    }
    case 'commit-base': {
      try {
        if (JSON.stringify(action.base) === JSON.stringify(state.present)) return state;
      } catch {
        // Record anyway.
      }
      return {
        ...state,
        past: [...state.past.slice(-99), action.base],
        future: [],
        label: action.label,
      };
    }
    case 'live':
      return { ...state, present: mergePatch(state.present, action.patch) };
    case 'undo': {
      if (!state.past.length) return state;
      const previous = state.past[state.past.length - 1];
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [clone(state.present), ...state.future].slice(0, 100),
        label: '撤销',
      };
    }
    case 'redo': {
      if (!state.future.length) return state;
      const next = state.future[0];
      return {
        past: [...state.past.slice(-99), clone(state.present)],
        present: next,
        future: state.future.slice(1),
        label: '重做',
      };
    }
    case 'reset':
      return { past: [], present: createDefaultState(), future: [], label: '重置文档' };
    default:
      return state;
  }
}

interface HistoryContextValue {
  state: DocumentState;
  canUndo: boolean;
  canRedo: boolean;
  commit: (patch: Partial<DocumentState> | ((s: DocumentState) => Partial<DocumentState>), label?: string) => void;
  live: (patch: Partial<DocumentState> | ((s: DocumentState) => Partial<DocumentState>)) => void;
  beginGesture: () => void;
  endGesture: (label?: string) => void;
  cancelGesture: () => void;
  gesturing: boolean;
  undo: () => void;
  redo: () => void;
  reset: () => void;
  historyLabel: string;
}

const HistoryContext = createContext<HistoryContextValue | null>(null);

export function HistoryProvider({ children }: { children: ReactNode }) {
  const [history, dispatch] = useReducer(reducer, undefined, () => ({
    past: [],
    present: createDefaultState(),
    future: [],
    label: '初始文档',
  }));
  const gestureBase = useRef<DocumentState | null>(null);
  const gestureActive = useRef(false);
  const [gesturing, setGesturing] = useState(false);

  const commit = useCallback<HistoryContextValue['commit']>((patch, label) => dispatch({ type: 'commit', patch, label }), []);
  const live = useCallback<HistoryContextValue['live']>((patch) => dispatch({ type: 'live', patch }), []);
  const beginGesture = useCallback(() => {
    // pointerdown can be followed by focus; the second call must not reset the
    // undo snapshot to an already-modified value.
    if (gestureActive.current) return;
    gestureActive.current = true;
    gestureBase.current = clone(history.present);
    setGesturing(true);
  }, [history.present]);
  const endGesture = useCallback((label = '调整参数') => {
    if (!gestureActive.current) return;
    gestureActive.current = false;
    const base = gestureBase.current;
    gestureBase.current = null;
    setGesturing(false);
    if (base) dispatch({ type: 'commit-base', base, label });
  }, []);
  const cancelGesture = useCallback(() => {
    if (!gestureActive.current) return;
    gestureActive.current = false;
    const base = gestureBase.current;
    gestureBase.current = null;
    setGesturing(false);
    if (base) dispatch({ type: 'live', patch: base });
  }, []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const reset = useCallback(() => {
    gestureActive.current = false;
    gestureBase.current = null;
    setGesturing(false);
    dispatch({ type: 'reset' });
  }, []);

  const value = useMemo<HistoryContextValue>(
    () => ({
      state: history.present,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      commit,
      live,
      beginGesture,
      endGesture,
      cancelGesture,
      gesturing,
      undo,
      redo,
      reset,
      historyLabel: history.label,
    }),
    [history, commit, live, beginGesture, endGesture, cancelGesture, gesturing, undo, redo, reset],
  );

  return <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>;
}

export function useHistory(): HistoryContextValue {
  const ctx = useContext(HistoryContext);
  if (!ctx) throw new Error('useHistory must be used inside HistoryProvider');
  return ctx;
}
