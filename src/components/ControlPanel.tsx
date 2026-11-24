import { useRef } from 'react';
import { LIBRARY_MODELS } from '../geometry/modelLibrary';
import { formatNumber } from '../geometry/stats';
import type { PipelineResult } from '../types';
import { useHistory } from '../state/HistoryContext';
import { ActionButton, Badge, PanelSection, Slider, Toggle } from './ui';

interface ControlPanelProps {
  pipeline: PipelineResult | null;
  importing: boolean;
  importError: string | null;
  onSelectBuiltin: (id: string) => void;
  onImportFile: (file: File) => void;
  onExampleContour: () => void;
  onExportSTL: (side: 'lower' | 'upper') => void;
  onExportCsv: () => void;
}

function ModelStep({ importing, importError, onSelectBuiltin, onImportFile }: Pick<ControlPanelProps, 'importing' | 'importError' | 'onSelectBuiltin' | 'onImportFile'>) {
  const { state, commit } = useHistory();
  const fileRef = useRef<HTMLInputElement | null>(null);

  return (
    <>
      <PanelSection title="内置手办库" icon="♟" hint="程序化低模，首次加载会建立 BVH">
        <div className="library-grid">
          {LIBRARY_MODELS.map((model) => (
            <button
              key={model.id}
              type="button"
              className={`library-card ${state.modelId === model.id ? 'active' : ''}`}
              onClick={() => onSelectBuiltin(model.id)}
            >
              <span className="library-tag">{model.tag}</span>
              <strong>{model.name}</strong>
              <small>{model.description}</small>
            </button>
          ))}
        </div>
      </PanelSection>

      <PanelSection title="导入模型" icon="⤓" hint="STL / OBJ / GLB；按毫米处理并统一归一化到工作台">
        <input
          ref={fileRef}
          type="file"
          accept=".stl,.obj,.glb,.gltf"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportFile(file);
            e.target.value = '';
          }}
        />
        <ActionButton variant="primary" onClick={() => fileRef.current?.click()} disabled={importing}>
          {importing ? '解析并构建 BVH 中…' : '选择手办模型文件'}
        </ActionButton>
        {importError && <p className="inline-error">{importError}</p>}
        <div
          className="drop-zone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file) onImportFile(file);
          }}
        >
          也可以把 STL / OBJ / GLB 拖到这里
        </div>
      </PanelSection>

      <PanelSection title="当前模型" icon="▦">
        <dl className="metric-grid">
          <div><dt>名称</dt><dd>{state.modelName}</dd></div>
          <div><dt>来源 / 格式</dt><dd>{state.modelSource === 'builtin' ? '内置库' : '导入'} · {state.format}</dd></div>
          <div><dt>三角面</dt><dd>{state.triangleCount.toLocaleString()}</dd></div>
          <div><dt>高度</dt><dd>{formatNumber(state.maxY - state.minY, 1)} mm</dd></div>
          <div><dt>外形 X / Z</dt><dd>{formatNumber(state.sizeX, 1)} / {formatNumber(state.sizeZ, 1)} mm</dd></div>
        </dl>
        <ActionButton variant="success" onClick={() => commit({ step: 'parting' }, '进入分模轮廓')}>
          下一步：画分模轮廓 →
        </ActionButton>
      </PanelSection>
    </>
  );
}

function PartingStep({ onExampleContour }: Pick<ControlPanelProps, 'onExampleContour'>) {
  const { state, commit, live } = useHistory();
  const pointCount = state.contour.length;

  return (
    <>
      <PanelSection title="表面折线" icon="✎" hint="在模型表面点击加点；拖动橙色球可移动顶点">
        <ol className="instruction-list">
          <li>沿手办侧面画一圈能分开上下模的折线。</li>
          <li>至少 3 点后闭合，系统将其垂直投影到分模平面。</li>
          <li>拖动黄色高度球或下方滑杆，BVH 截面实时更新。</li>
        </ol>
        <div className="button-row">
          <ActionButton onClick={() => commit({ contourClosed: true, cutReady: true }, '闭合并投影轮廓')} disabled={pointCount < 3}>
            闭合投影
          </ActionButton>
          <ActionButton onClick={() => commit((s) => ({ contour: s.contour.slice(0, -1), cutReady: false }), '撤销折线点')} disabled={!pointCount}>
            撤点
          </ActionButton>
          <ActionButton variant="danger" onClick={() => commit({ contour: [], contourClosed: false, cutReady: false }, '清空轮廓')} disabled={!pointCount}>
            清空
          </ActionButton>
        </div>
        <div className="button-row">
          <ActionButton onClick={onExampleContour}>生成示例环形折线</ActionButton>
          <ActionButton variant="primary" onClick={() => commit({ cutReady: true, contourClosed: pointCount >= 3 ? true : state.contourClosed }, '应用 BVH 切割')}>
            {state.cutReady ? '重新执行切割' : '应用切割'}
          </ActionButton>
        </div>
        <p className="status-line">
          当前折线 <Badge tone="cyan">{pointCount}</Badge> 点 ·
          {state.contourClosed && pointCount >= 3 ? <Badge tone="green">已闭合</Badge> : <Badge tone="amber">未闭合</Badge>}
        </p>
      </PanelSection>

      <PanelSection title="分模面高度" icon="↕">
        <Slider
          label="Y 高度"
          value={state.cutHeight}
          min={state.minY + 0.5}
          max={state.maxY - 0.5}
          step={0.1}
          unit=" mm"
          digits={1}
          historyLabel="拖动分模面高度"
          onChange={(v) => live({ cutHeight: v, cutReady: true })}
        />
        <Slider label="爆炸分离距离" value={state.explode} min={0} max={90} step={1} unit=" mm" digits={0} onChange={(v) => live({ explode: v })} />
        <Toggle label="显示 BVH 截面环线" checked={state.showSection} onChange={(v) => commit({ showSection: v }, '切换截面显示')} />
        <div className="callout">
          three-mesh-bvh 同时负责表面拾取和截面求交；平面封口使用截面线段焊接、闭环追踪与耳切三角化。
        </div>
        <ActionButton variant="success" onClick={() => commit({ step: 'tenon', cutReady: true }, '进入榫卯模块')}>
          下一步：排布榫卯 →
        </ActionButton>
      </PanelSection>
    </>
  );
}

function TenonStep({ pipeline }: { pipeline: PipelineResult | null }) {
  const { state, commit, live } = useHistory();
  const t = state.tenon;
  const conflicts = pipeline?.tenons.filter((x) => x.conflict).length ?? 0;

  return (
    <>
      <PanelSection title="网格定位柱" icon="⊞" hint="按截面包围盒生成自适应行列，并螺旋搜索避开薄壁">
        <Slider label="柱数" value={t.count} min={3} max={8} step={1} unit=" 个" digits={0} onChange={(v) => live({ tenon: { ...t, count: v } })} />
        <Slider label="柱径" value={t.radius * 2} min={3} max={12} step={0.2} unit=" mm" digits={1} historyLabel="调整柱径" onChange={(d) => live({ tenon: { ...t, radius: d / 2 } })} />
        <Slider label="插入深度" value={t.depth} min={4} max={18} step={0.5} unit=" mm" onChange={(v) => live({ tenon: { ...t, depth: v } })} />
        <Slider label="配合间隙" value={t.clearance} min={0.1} max={0.9} step={0.05} unit=" mm" digits={2} onChange={(v) => live({ tenon: { ...t, clearance: v } })} />
        <Slider label="最小保护间距" value={t.minCover} min={0.5} max={5} step={0.1} unit=" mm" onChange={(v) => live({ tenon: { ...t, minCover: v } })} />
        <Slider label="网格边距" value={t.gridPadding} min={0} max={14} step={0.5} unit=" mm" onChange={(v) => live({ tenon: { ...t, gridPadding: v } })} />

        <div className="segmented">
          <button type="button" className={t.side === 'lower' ? 'active' : ''} onClick={() => commit({ tenon: { ...t, side: 'lower' } }, '定位柱放到下片')}>柱在下片</button>
          <button type="button" className={t.side === 'upper' ? 'active' : ''} onClick={() => commit({ tenon: { ...t, side: 'upper' } }, '定位柱放到上片')}>柱在上片</button>
        </div>
        <Toggle label="只看冲突点位" checked={state.showConflictOnly} onChange={(v) => commit({ showConflictOnly: v }, '切换冲突过滤')} />
      </PanelSection>

      <PanelSection title="BVH 冲突检测" icon="⚠">
        <div className={`conflict-summary ${conflicts ? 'bad' : 'good'}`}>
          {conflicts ? <><strong>{conflicts}</strong> 个柱位冲突或位于薄壁区，已在视口标红</> : <>当前 {t.count} 个柱位未发现硬冲突</>}
        </div>
        <div className="tenon-list">
          {(pipeline?.tenons ?? []).map((item) => (
            <div key={item.index} className={`tenon-item ${item.conflict ? 'bad' : 'good'}`}>
              <header>
                <b>#{item.index + 1}</b>
                {item.conflict ? <Badge tone="red">冲突</Badge> : <Badge tone="green">通过</Badge>}
              </header>
              <p>{item.reason}</p>
              <small>X {item.x.toFixed(1)} · Z {item.z.toFixed(1)} · 间距 {Number.isFinite(item.minOppositeGap) ? item.minOppositeGap.toFixed(1) : '—'}mm</small>
            </div>
          ))}
        </div>
        <ActionButton variant="success" onClick={() => commit({ step: 'wall' }, '进入壁厚模块')}>下一步：壁厚处理 →</ActionButton>
      </PanelSection>
    </>
  );
}

function WallStep({ pipeline }: { pipeline: PipelineResult | null }) {
  const { state, commit, live } = useHistory();
  const w = state.wall;
  const warnings = pipeline?.thinWarnings ?? [];

  return (
    <>
      <PanelSection title="均匀壳厚" icon="◌" hint="内外表面沿顶点法线偏移，切口内侧生成平行封盖与过渡裙边">
        <Toggle label="启用抽壳与 STL 壁厚" checked={w.enabled} onChange={(v) => commit({ wall: { ...w, enabled: v } }, v ? '启用壁厚处理' : '关闭壁厚处理')} description="启用后使用 CSG 减去闭合内腔" />
        <Slider label="壳厚" value={w.thickness} min={2} max={6} step={0.5} unit=" mm" onChange={(v) => live({ wall: { ...w, thickness: v, enabled: true } })} />
        <Slider label="薄转角阈值" value={w.thinThreshold} min={2} max={9} step={0.1} unit=" mm" onChange={(v) => live({ wall: { ...w, thinThreshold: v } })} />
        <Toggle label="转角自动补强建议" checked={w.autoThicken} onChange={(v) => commit({ wall: { ...w, autoThicken: v } }, '切换自动补强')} description="榫卯补强台半径会随壳厚放大" />
        <Toggle label="显示琥珀色内表面偏移线框" checked={state.showInnerShell} onChange={(v) => commit({ showInnerShell: v })} />
      </PanelSection>

      <PanelSection title="薄壁 / 尖角提示" icon="⚠">
        <div className={`conflict-summary ${warnings.length ? 'warn' : 'good'}`}>
          {warnings.length ? <>发现 <strong>{warnings.length}</strong> 个薄于 {w.thinThreshold.toFixed(1)}mm 的转角，建议局部加厚或加大圆角</> : <>BVH 法线探测未发现低于阈值的转角</>}
        </div>
        <div className="warning-list">
          {warnings.map((item, i) => (
            <div key={`${item.x}-${i}`} className="warning-item">
              <Badge tone="amber">#{i + 1}</Badge>
              <div>
                <strong>估算厚度 {item.thickness.toFixed(1)} mm</strong>
                <small>位置 {item.x.toFixed(1)}, {item.y.toFixed(1)}, {item.z.toFixed(1)}</small>
              </div>
            </div>
          ))}
        </div>
        {warnings.length > 0 && (
          <ActionButton onClick={() => commit({ wall: { ...w, thinThreshold: Math.max(w.thinThreshold, Math.max(...warnings.map((x) => x.thickness)) + 0.5) } }, '提高检测阈值')}>
            按最薄点提高阈值
          </ActionButton>
        )}
        <ActionButton variant="success" onClick={() => commit({ step: 'export' }, '进入导出模块')}>下一步：导出 STL 与清单 →</ActionButton>
      </PanelSection>
    </>
  );
}

function ExportStep({ pipeline, onExportSTL, onExportCsv }: Pick<ControlPanelProps, 'pipeline' | 'onExportSTL' | 'onExportCsv'>) {
  const { state } = useHistory();
  const ready = state.cutReady && pipeline && pipeline.stats.length === 2;
  return (
    <>
      <PanelSection title="分别导出上下模" icon="⇩" hint="二进制 STL，单位按毫米；网格已写入法线">
        <div className="button-row vertical">
          <ActionButton variant="primary" disabled={!ready} onClick={() => onExportSTL('lower')}>导出下模 STL（含柱/槽）</ActionButton>
          <ActionButton variant="primary" disabled={!ready} onClick={() => onExportSTL('upper')}>导出上模 STL（含柱/槽）</ActionButton>
          <ActionButton variant="success" disabled={!ready} onClick={onExportCsv}>下载分件清单 CSV</ActionButton>
        </div>
        {!ready && <p className="inline-error">请先在分模步骤应用切割。</p>}
        {pipeline?.warnings.map((warning, i) => <p key={i} className="inline-error small">{warning}</p>)}
      </PanelSection>

      <PanelSection title="导出前检查" icon="✓">
        <ul className="check-list">
          <li className={state.cutReady ? 'ok' : 'bad'}>{state.cutReady ? '✓' : '×'} 闭合曲线已投影并完成平面切割</li>
          <li className={(pipeline?.tenons.some((t) => t.conflict) ?? true) ? 'warn' : 'ok'}>
            {(pipeline?.tenons.some((t) => t.conflict) ?? true) ? '!' : '✓'} 榫卯冲突 {pipeline?.tenons.filter((t) => t.conflict).length ?? 0} 项
          </li>
          <li className={(pipeline?.thinWarnings.length ?? 1) ? 'warn' : 'ok'}>
            {(pipeline?.thinWarnings.length ?? 1) ? '!' : '✓'} 薄壁转角 {pipeline?.thinWarnings.length ?? 0} 项
          </li>
          <li className={state.wall.enabled ? 'ok' : 'warn'}>{state.wall.enabled ? '✓' : '!'} {state.wall.enabled ? `已启用 ${state.wall.thickness.toFixed(1)}mm 壳厚` : '当前导出为实体封口件'}</li>
        </ul>
      </PanelSection>
    </>
  );
}

export function ControlPanel(props: ControlPanelProps) {
  const { state } = useHistory();
  if (state.step === 'model') return <ModelStep {...props} />;
  if (state.step === 'parting') return <PartingStep onExampleContour={props.onExampleContour} />;
  if (state.step === 'tenon') return <TenonStep pipeline={props.pipeline} />;
  if (state.step === 'wall') return <WallStep pipeline={props.pipeline} />;
  return <ExportStep pipeline={props.pipeline} onExportSTL={props.onExportSTL} onExportCsv={props.onExportCsv} />;
}
