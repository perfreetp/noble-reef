import { useBonsaiStore } from '../store';

/** 骨架编辑面板:说明 + 枝干列表 + 修剪模式 */
export function SkeletonPanel() {
  const skeleton = useBonsaiStore((s) => s.skeleton);
  const pruneMode = useBonsaiStore((s) => s.pruneMode);
  const setPruneMode = useBonsaiStore((s) => s.setPruneMode);
  const prunedBranches = useBonsaiStore((s) => s.prunedBranches);
  const prunedTwigs = useBonsaiStore((s) => s.prunedTwigs);
  const resetPruning = useBonsaiStore((s) => s.resetPruning);

  return (
    <div className="panel">
      <h3>树桩骨架编辑</h3>
      <p className="hint">
        拖动场景中的橙色控制点塑形主干与分枝;子枝干跟随父级附着点。修改会实时重建枝叶实例。
      </p>
      <div className="branch-list">
        {skeleton.branches.map((b) => (
          <div key={b.id} className={`branch-item ${prunedBranches.includes(b.id) ? 'pruned' : ''}`}>
            <span>
              {b.id === 'trunk' ? '主干' : `分枝 ${b.id}`}
              {b.parentId ? ` ← ${b.parentId}` : ''}
            </span>
            <span className="branch-meta">{b.points.length} 控制点</span>
          </div>
        ))}
      </div>
      <div className="button-row">
        <button
          className={pruneMode ? 'danger active' : 'danger'}
          onClick={() => setPruneMode(!pruneMode)}
        >
          {pruneMode ? '✂ 修剪中(点击枝条)' : '✂ 进入修剪模式'}
        </button>
        <button onClick={resetPruning} disabled={!prunedBranches.length && !prunedTwigs.length}>
          恢复全部修剪
        </button>
      </div>
      {(prunedBranches.length > 0 || prunedTwigs.length > 0) && (
        <p className="hint">
          已修剪 {prunedBranches.length} 根枝干、{prunedTwigs.length} 根细枝;下游生长度已归零,父级重心已重算(红点标记)。
        </p>
      )}
    </div>
  );
}
