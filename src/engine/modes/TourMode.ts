import type { Engine } from '../Engine';
import type { InteractionMode } from '../InteractionMode';
import type { TourPlayer } from '../camera/TourPlayer';

/** 漫游模式：禁用 OrbitControls，相机交给 TourPlayer */
export class TourMode implements InteractionMode {
  constructor(private readonly player: TourPlayer, private readonly engine: Engine) {}

  onActivate(): void {
    this.player.activate();
    this.engine.controls.enabled = false;
  }

  onDeactivate(): void {
    this.player.deactivate();
    this.engine.controls.enabled = true;
  }
}
