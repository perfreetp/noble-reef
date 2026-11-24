import { store } from './store.svelte';

/**
 * 水舞播放器：维护播放时间与节拍位置。
 * 由 Pixi ticker 每帧驱动 tick()，组件通过 rAF 读取 beatPos 刷新进度条，
 * 避免高频 Svelte 重渲染。
 */
class Player {
  playing = $state(false);
  loop = $state(true);
  /** 当前节拍位置（浮点，可为总节拍数表示结尾） */
  beatPos = 0;
  /** 播放起始的秒时间戳（秒，高精度） */
  private startWall = 0;
  /** 起播时的节拍位置 */
  private startBeat = 0;
  /** 结束回调（播放到结尾且不循环时触发一次） */
  onEnded: (() => void) | null = null;
  private endedFired = false;

  get totalBeats(): number {
    return store.totalBeats;
  }

  get durationSec(): number {
    return (this.totalBeats / store.doc.bpm) * 60;
  }

  get currentBeatIndex(): number {
    return Math.min(Math.floor(this.beatPos), this.totalBeats - 1);
  }

  get progress(): number {
    return this.totalBeats > 0 ? this.beatPos / this.totalBeats : 0;
  }

  play() {
    if (this.playing) return;
    if (this.beatPos >= this.totalBeats - 0.0001) this.beatPos = 0;
    this.playing = true;
    this.endedFired = false;
    this.startWall = performance.now() / 1000;
    this.startBeat = this.beatPos;
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
  }

  stop() {
    this.playing = false;
    this.beatPos = 0;
    this.endedFired = false;
  }

  /** 拖动进度，fraction 0..1 */
  seekFraction(fraction: number) {
    const f = Math.max(0, Math.min(1, fraction));
    this.beatPos = f * this.totalBeats;
    if (this.playing) {
      this.startWall = performance.now() / 1000;
      this.startBeat = this.beatPos;
    }
    this.endedFired = false;
  }

  seekBeat(beat: number) {
    this.seekFraction(this.totalBeats > 0 ? beat / this.totalBeats : 0);
  }

  /** 每帧调用，nowSec = performance.now()/1000 */
  tick(nowSec: number) {
    if (!this.playing) return;
    const bps = store.doc.bpm / 60;
    let pos = this.startBeat + (nowSec - this.startWall) * bps;
    if (pos >= this.totalBeats) {
      if (this.loop) {
        const dur = this.totalBeats / bps;
        // 按整段时长取模，避免长时间播放漂移
        const elapsed = nowSec - this.startWall;
        const wrapped = elapsed % dur;
        this.startWall = nowSec - wrapped;
        this.startBeat = 0;
        pos = wrapped * bps;
      } else {
        pos = this.totalBeats;
        this.playing = false;
        if (!this.endedFired) {
          this.endedFired = true;
          this.onEnded?.();
        }
      }
    }
    this.beatPos = pos;
  }
}

export const player = new Player();
