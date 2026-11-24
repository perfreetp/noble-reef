import { usePlaybackStore } from '../store';

/** 生长时间轴:0 → 1 逐级萌发 */
export function Timeline() {
  const time = usePlaybackStore((s) => s.time);
  const playing = usePlaybackStore((s) => s.playing);
  const setTime = usePlaybackStore((s) => s.setTime);
  const setPlaying = usePlaybackStore((s) => s.setPlaying);

  return (
    <div className="timeline">
      <button className="play-btn" onClick={() => setPlaying(!playing)}>
        {playing ? '⏸' : '▶'}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={time}
        onChange={(e) => {
          setPlaying(false);
          setTime(Number(e.target.value));
        }}
      />
      <span className="time-label">生长度 {(time * 100).toFixed(0)}%</span>
    </div>
  );
}
