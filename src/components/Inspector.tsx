import type { PipelineResult } from '../types';
import { formatNumber } from '../geometry/stats';
import { Badge } from './ui';
import { useHistory } from '../state/HistoryContext';

export function Inspector({ pipeline, computing }: { pipeline: PipelineResult | null; computing: boolean }) {
  const { state, canUndo, canRedo, historyLabel } = useHistory();
  const conflicts = pipeline?.tenons.filter((t) => t.conflict).length ?? 0;

  return (
    <aside className="inspector">
      <section className="inspector-card">
        <div className="inspector-title">
          <h2>实时求解器</h2>
          <span className={`pipeline-dot ${computing ? 'busy' : pipeline ? 'ready' : ''}`} />
        </div>
        <div className="solver-grid">
          <div><span>BVH 拾取</span><b>MeshBVH</b></div>
          <div><span>切割加速</span><b>{pipeline ? `${pipeline.sectionLoops.length} 环` : '待切割'}</b></div>
          <div><span>重算耗时</span><b>{pipeline ? `${pipeline.durationMs.toFixed(0)} ms` : '—'}</b></div>
          <div><span>历史状态</span><b title={historyLabel}>{canUndo ? '可撤销' : '起点'}{canRedo ? ' / 可重做' : ''}</b></div>
        </div>
        {computing && <div className="progress-line"><i /></div>}
      </section>

      <section className="inspector-card">
        <div className="inspector-title"><h2>分件清单</h2><Badge tone={conflicts ? 'red' : 'green'}>{conflicts ? `${conflicts} 冲突` : '正常'}</Badge></div>
        {!pipeline && <p className="muted">应用切割后，这里显示上下片体积、三角面和榫卯数量。</p>}
        <div className="bom-list">
          {pipeline?.stats.map((stat) => (
            <article key={stat.name} className="bom-card">
              <header>
                <strong>{stat.name}</strong>
                <Badge tone={stat.watertight ? 'green' : 'amber'}>{stat.watertight ? '已封口' : '检查封口'}</Badge>
              </header>
              <div className="bom-volume">{formatNumber(stat.volumeCm3, 2)} <small>cm³</small></div>
              <dl>
                <div><dt>体积</dt><dd>{formatNumber(stat.volumeMm3, 0)} mm³</dd></div>
                <div><dt>三角面</dt><dd>{stat.triangles.toLocaleString()}</dd></div>
                <div><dt>定位柱 / 槽</dt><dd>{stat.tenons} / {stat.sockets}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="inspector-card">
        <div className="inspector-title"><h2>图例与快捷键</h2></div>
        <div className="legend">
          <span><i className="dot cyan" />通过柱位 / 投影曲线</span>
          <span><i className="dot red" />冲突柱位</span>
          <span><i className="dot amber" />薄壁转角 / 内表面</span>
          <span><i className="dot green" />BVH 截面环线</span>
        </div>
        <div className="shortcuts">
          <kbd>Ctrl</kbd>+<kbd>Z</kbd> 撤销
          <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> 重做<br />
          <kbd>左键</kbd> 加点 / 拖动
          <kbd>右键</kbd> 平移
          <kbd>滚轮</kbd> 缩放
        </div>
        <p className="muted small">当前壳厚 {state.wall.thickness.toFixed(1)}mm · 柱数 {state.tenon.count} · 爆炸 {state.explode.toFixed(0)}mm</p>
      </section>
    </aside>
  );
}
