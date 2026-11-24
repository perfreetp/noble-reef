import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { HistoryProvider, useHistory } from './state/HistoryContext';
import { Viewport } from './components/Viewport';
import { ControlPanel } from './components/ControlPanel';
import { Inspector } from './components/Inspector';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import {
  LIBRARY_MODELS,
  createBuiltinGeometry,
  geometryInfo,
  getGeometry,
  importModelFile,
} from './geometry/modelLibrary';
import { runPipeline } from './geometry/pipeline';
import { splitGeometryAtY, type PlaneSplitResult } from './geometry/clipPlane';
import { ensureBVH } from './geometry/bvh';
import { exportBillOfMaterialsCsv, exportGeometryAsSTL } from './geometry/exporters';
import type { PipelineResult, StepId } from './types';

const STEPS: Array<{ id: StepId; index: string; label: string }> = [
  { id: 'model', index: '01', label: '模型库' },
  { id: 'parting', index: '02', label: '分模轮廓' },
  { id: 'tenon', index: '03', label: '榫卯' },
  { id: 'wall', index: '04', label: '壁厚' },
  { id: 'export', index: '05', label: '导出' },
];

function sanitizeFilename(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'figure';
}

function Workspace() {
  const history = useHistory();
  const { state, commit, undo, redo, canUndo, canRedo, reset, gesturing } = history;
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const geometry = useMemo(() => getGeometry(state.modelId) ?? createBuiltinGeometry('builtin-neko'), [state.modelId]);
  const debouncedState = useDebouncedValue(state, 180);

  // Plane clipping is cheap and gives immediate section feedback while dragging.
  const splitPreview = useMemo<PlaneSplitResult | null>(() => {
    if (!state.cutReady || !geometry) return null;
    try {
      return splitGeometryAtY(geometry, state.cutHeight);
    } catch (error) {
      console.warn('split preview failed', error);
      return null;
    }
  }, [geometry, state.cutHeight, state.cutReady]);

  const lastPipelineRef = useRef<PipelineResult | null>(null);
  const pipeline = useMemo<PipelineResult | null>(() => {
    if (!debouncedState.cutReady) {
      lastPipelineRef.current = null;
      return null;
    }
    // Keep the old CSG result on screen during an active drag; the fast plane
    // split preview is rendered instead until the gesture settles.
    if (gesturing) return lastPipelineRef.current;

    const source = getGeometry(debouncedState.modelId);
    if (!source) return null;
    try {
      const result = runPipeline(source, debouncedState);
      lastPipelineRef.current = result;
      return result;
    } catch (error) {
      console.error(error);
      const fallback: PipelineResult = {
        cutHeight: debouncedState.cutHeight,
        lowerGeometry: null,
        upperGeometry: null,
        lowerBodyGeometry: null,
        upperBodyGeometry: null,
        sectionLoops: [],
        projectedCurve: [],
        tenons: [],
        thinWarnings: [],
        stats: [],
        durationMs: 0,
        warnings: [`管线执行失败：${error instanceof Error ? error.message : String(error)}`],
      };
      lastPipelineRef.current = fallback;
      return fallback;
    }
    // Contour points intentionally do not invalidate the expensive CSG/tenon pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    debouncedState.modelId,
    debouncedState.cutReady,
    debouncedState.cutHeight,
    debouncedState.tenon,
    debouncedState.wall,
    gesturing,
  ]);

  const computing =
    state.cutReady &&
    (gesturing ||
      state.cutHeight !== debouncedState.cutHeight ||
      state.tenon !== debouncedState.tenon ||
      state.wall !== debouncedState.wall);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((event.ctrlKey || event.metaKey) && (key === 'y' || (key === 'z' && event.shiftKey))) {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const selectBuiltin = useCallback((id: string) => {
    const meta = LIBRARY_MODELS.find((m) => m.id === id);
    const g = getGeometry(id) ?? createBuiltinGeometry(id);
    const info = geometryInfo(g);
    commit({
      modelId: id,
      modelName: meta?.name ?? id,
      modelSource: 'builtin',
      format: '程序化',
      ...info,
      cutHeight: info.minY + (info.maxY - info.minY) * 0.47,
      contour: [],
      contourClosed: false,
      cutReady: false,
      step: 'model',
    }, '选择内置模型');
  }, [commit]);

  const handleImport = useCallback(async (file: File) => {
    setImporting(true);
    setImportError(null);
    try {
      const result = await importModelFile(file);
      const info = geometryInfo(result.geometry);
      commit({
        modelId: result.id,
        modelName: result.name,
        modelSource: 'import',
        format: result.format,
        ...info,
        cutHeight: info.minY + (info.maxY - info.minY) * 0.47,
        contour: [],
        contourClosed: false,
        cutReady: false,
        step: 'parting',
      }, '导入模型');
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  }, [commit]);

  const createExampleContour = useCallback(() => {
    const g = getGeometry(state.modelId);
    if (!g) return;
    const bvh = ensureBVH(g);
    const points = [];
    const count = 14;
    const origin = new THREE.Vector3(0, state.cutHeight, 0);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const hit = bvh.raycastFirst(new THREE.Ray(origin, dir), THREE.DoubleSide, 0, 260);
      if (hit) {
        points.push({ x: hit.point.x, y: hit.point.y, z: hit.point.z });
      } else {
        points.push({
          x: Math.cos(angle) * state.sizeX * 0.34,
          y: state.cutHeight,
          z: Math.sin(angle) * state.sizeZ * 0.34,
        });
      }
    }
    commit({ contour: points, contourClosed: true, cutReady: true }, '生成示例轮廓');
  }, [commit, state.cutHeight, state.modelId, state.sizeX, state.sizeZ]);

  const exportSTL = useCallback((side: 'lower' | 'upper') => {
    const g = side === 'lower' ? pipeline?.lowerGeometry : pipeline?.upperGeometry;
    if (!g) return;
    exportGeometryAsSTL(g, `${sanitizeFilename(state.modelName)}-${side === 'lower' ? '下模' : '上模'}.stl`);
  }, [pipeline, state.modelName]);

  const exportCsv = useCallback(() => {
    if (!pipeline?.stats?.length) return;
    exportBillOfMaterialsCsv(pipeline.stats, {
      modelName: state.modelName,
      tenonCount: state.tenon.count,
      wallThickness: state.wall.enabled ? state.wall.thickness : 0,
    });
  }, [pipeline, state.modelName, state.tenon.count, state.wall.enabled, state.wall.thickness]);

  const goStep = (id: StepId) => {
    commit((s) => ({ step: id, cutReady: id === 'parting' ? s.cutReady : true }), `切换到${STEPS.find((x) => x.id === id)?.label}`);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">模</div>
          <div>
            <h1>手办分件拆模工作台</h1>
            <p>TypeScript · React · three.js · three-mesh-bvh</p>
          </div>
        </div>
        <nav className="stepper" aria-label="工作流步骤">
          {STEPS.map((step) => (
            <button
              key={step.id}
              type="button"
              className={`step-button ${state.step === step.id ? 'active' : ''}`}
              onClick={() => goStep(step.id)}
            >
              <i>{step.index}</i><span>{step.label}</span>
            </button>
          ))}
        </nav>
        <div className="history-actions">
          <button type="button" className="icon-button" onClick={undo} disabled={!canUndo} title="撤销 Ctrl+Z">↶</button>
          <button type="button" className="icon-button" onClick={redo} disabled={!canRedo} title="重做 Ctrl+Shift+Z">↷</button>
          <button type="button" className="reset-button" onClick={reset}>重置</button>
        </div>
      </header>

      <main className="workspace">
        <aside className="control-drawer">
          <ControlPanel
            pipeline={pipeline}
            importing={importing}
            importError={importError}
            onSelectBuiltin={selectBuiltin}
            onImportFile={handleImport}
            onExampleContour={createExampleContour}
            onExportSTL={exportSTL}
            onExportCsv={exportCsv}
          />
        </aside>

        <section className="viewport-column">
          <Viewport geometry={geometry} pipeline={pipeline} preview={splitPreview} />
          <div className="viewport-hud">
            <strong>{STEPS.find((s) => s.id === state.step)?.label}</strong>
            {state.step === 'parting' && <span>模型表面单击加点 · 拖动橙点改线 · 拖动黄球调高度</span>}
            {state.step === 'tenon' && <span>青色为安全柱位，红色为薄壁 / 对面片间距冲突</span>}
            {state.step === 'wall' && <span>橙色线框为沿法线偏移的内表面，橙球为薄转角</span>}
            {state.step === 'export' && <span>上下模分别导出 STL，并附 CSV 分件清单</span>}
            {state.step === 'model' && <span>选择内置手办或导入 STL / OBJ / GLB</span>}
          </div>
        </section>

        <Inspector pipeline={pipeline} computing={computing} />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <HistoryProvider>
      <Workspace />
    </HistoryProvider>
  );
}
