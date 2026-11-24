import { useEffect, useRef } from 'react';
import { BonsaiScene } from '../scene/BonsaiScene';
import { useBonsaiStore, usePlaybackStore } from '../store';

/** 三维视口:挂载 BonsaiScene,并把 store 变化同步到场景 */
export function Viewport(props: { onFps: (fps: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<BonsaiScene | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const store = useBonsaiStore;
    const scene = new BonsaiScene(canvas, {
      onFps: props.onFps,
      getState: () => {
        const s = store.getState();
        const pb = usePlaybackStore.getState();
        return {
          data: {
            version: 1,
            skeleton: s.skeleton,
            growth: s.growth,
            moss: s.moss,
            lighting: s.lighting,
            pruned: s.prunedBranches,
          },
          prunedTwigs: new Set(s.prunedTwigs),
          time: pb.time,
          playing: pb.playing,
          pruneMode: s.pruneMode,
          editing: s.activeModule === 'skeleton' && !s.pruneMode,
        };
      },
      setTime: (t) => usePlaybackStore.getState().setTime(t),
      onPointDrag: (branchId, pointIndex, local) => {
        const s = store.getState();
        const skeleton = {
          branches: s.skeleton.branches.map((b) =>
            b.id === branchId
              ? { ...b, points: b.points.map((p, i) => (i === pointIndex ? local : p)) }
              : b,
          ),
        };
        s.setSkeleton(skeleton);
      },
      onDragEnd: () => {},
      onPruneBranch: (id) => store.getState().pruneBranch(id),
      onPruneTwig: (key) => store.getState().pruneTwig(key),
    });
    sceneRef.current = scene;
    scene.rebuild();
    scene.applyLighting();
    scene.applyMoss();

    // store → 场景同步
    let lastRebuild = store.getState().rebuildNonce;
    let lastMoss = store.getState().moss;
    let lastLighting = store.getState().lighting;
    let lastEditing = store.getState().activeModule === 'skeleton';
    const unsub = store.subscribe((s) => {
      if (s.rebuildNonce !== lastRebuild) {
        lastRebuild = s.rebuildNonce;
        scene.rebuild();
      }
      if (s.moss !== lastMoss) {
        lastMoss = s.moss;
        scene.applyMoss();
      }
      if (s.lighting !== lastLighting) {
        lastLighting = s.lighting;
        scene.applyLighting();
      }
      const editing = s.activeModule === 'skeleton' && !s.pruneMode;
      if (editing !== lastEditing) {
        lastEditing = editing;
        scene.setEditing(editing);
      }
    });

    return () => {
      unsub();
      scene.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className="viewport-canvas" />;
}
