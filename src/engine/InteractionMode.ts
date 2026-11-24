import type { PickResult } from '../types/engine';

/** 交互模式策略接口，四个页面各实现一个。
 * onPointerDown 返回 true 表示事件被模式消费（拖拽/放置），Engine 据此在捕获阶段
 * 阻断 OrbitControls 的同元素监听，避免拖控制点时镜头同时旋转。 */
export interface InteractionMode {
  onActivate?(): void;
  onDeactivate?(): void;
  onPointerDown?(event: PointerEvent): boolean | void;
  onPointerMove?(event: PointerEvent): void;
  onPointerUp?(event: PointerEvent): void;
  onPointerLeave?(event: PointerEvent): void;
  onWheel?(event: WheelEvent): void;
  onFrame?(delta: number, elapsed: number): void;
}

export type { PickResult };
