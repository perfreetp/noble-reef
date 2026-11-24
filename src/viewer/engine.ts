import { Engine } from "@babylonjs/core/Engines/engine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";

export interface EngineBundle {
  engine: Engine;
  isWebGPU: boolean;
}

/** 优先 WebGPU，失败时回退 WebGL2 */
export async function createEngine(canvas: HTMLCanvasElement): Promise<EngineBundle> {
  if (typeof navigator !== "undefined" && "gpu" in navigator) {
    try {
      const webgpu = new WebGPUEngine(canvas, { antialias: true });
      await webgpu.initAsync();
      return { engine: webgpu as unknown as Engine, isWebGPU: true };
    } catch (e) {
      console.warn("[mol-viewer] WebGPU 初始化失败，回退到 WebGL2:", e);
    }
  }
  return { engine: new Engine(canvas, true, { stencil: true }), isWebGPU: false };
}
