/// <reference lib="webworker" />
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import type { PotMesh, PotParams, V3 } from '../core/types';
import { buildPot, cavityOutline, CERAMIC_DENSITY, massProps, revolveProfile } from '../core/potBuild';
import { clampPot } from '../core/pot';

export interface PotRequest {
  id: number;
  params: PotParams;
  /** Tree mass (g) and its centre of mass in tree-local space. */
  treeMass: number;
  treeCom: V3;
  /** Height of the tree's root above the pot base. */
  treeBaseY: number;
  balanceGain: number;
}

export interface PotResponse {
  id: number;
  params: PotParams;
  mesh: PotMesh;
  volume: number;
  com: V3;
  mass: number;
  support: [number, number][];
  bbox: { min: V3; max: V3 };
  buildMs: number;
  ballast: { mass: number; position: V3 } | null;
  fallback: boolean;
  balance: [number, number];
  /** Inner cavity outline at rim height, for the soil surface. */
  cavity: [number, number][];
}

type Topology = Awaited<ReturnType<typeof Module>>;

let wasm: Topology | null = null;

async function init(): Promise<Topology> {
  if (wasm) return wasm;
  const mod = await Module({ locateFile: () => wasmUrl });
  mod.setup();
  wasm = mod;
  return mod;
}

/** Un-hollowed lathe fallback for the rare case the WASM kernel cannot start. */
function fallbackPot(req: PotRequest): PotResponse {
  const p = clampPot(req.params);
  const profile = revolveProfile(p);
  const segs = 96;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < profile.length; i++) {
    const [r, y] = profile[i];
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      positions.push(Math.cos(a) * r, y, Math.sin(a) * r);
      normals.push(Math.cos(a), 0, Math.sin(a));
    }
  }
  const n = profile.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * segs + j;
      const b = i * segs + ((j + 1) % segs);
      const c = ((i + 1) % n) * segs + j;
      const d = ((i + 1) % n) * segs + ((j + 1) % segs);
      indices.push(a, c, b, b, c, d);
    }
  }
  const pos = new Float32Array(positions);
  const idx = new Uint32Array(indices);
  const props = massProps(pos, idx);
  return {
    id: req.id,
    params: p,
    mesh: { positions: pos, normals: new Float32Array(normals), indices: idx },
    volume: props.volume,
    com: props.com,
    mass: props.volume * CERAMIC_DENSITY,
    support: props.support,
    bbox: props.bbox,
    buildMs: 0,
    ballast: null,
    fallback: true,
    balance: [0, 0],
    cavity: cavityForFallback(p),
  };
}

function cavityForFallback(p: ReturnType<typeof clampPot>): [number, number][] {
  return cavityOutline(p);
}

let latest: PotRequest | null = null;
let busy = false;

self.onmessage = async (ev: MessageEvent<PotRequest>) => {
  latest = ev.data;
  if (busy) return;
  busy = true;
  try {
    while (latest) {
      const req = latest;
      latest = null;
      const t0 = performance.now();
      try {
        const mod = await init();
        const built = buildPot(mod, req.params, {
          treeMass: req.treeMass,
          treeCom: req.treeCom,
          treeBaseY: req.treeBaseY,
          balanceGain: req.balanceGain,
        });
        const res: PotResponse = {
          id: req.id,
          params: clampPot(req.params),
          mesh: built.mesh,
          volume: built.volume,
          com: built.com,
          mass: built.mass,
          support: built.support,
          bbox: built.bbox,
          buildMs: performance.now() - t0,
          ballast: built.ballast,
          fallback: false,
          balance: built.balance,
          cavity: built.cavity,
        };
        (self as unknown as Worker).postMessage(res);
      } catch (err) {
        console.error('pot worker fallback', err);
        (self as unknown as Worker).postMessage(fallbackPot(req));
      }
    }
  } finally {
    busy = false;
  }
};
