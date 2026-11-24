import type {
  FoliageParams,
  LeafData,
  MassBalance,
  PotParams,
  PotResult,
  Project,
  ShapeState,
  Skeleton,
  TreeParams,
} from '../core/types';
import { DEFAULT_TREE } from '../core/skeleton';
import { DEFAULT_FOLIAGE } from '../core/foliage';
import { DEFAULT_POT } from '../core/pot';

export interface ProjectInput {
  tree: TreeParams;
  shape: ShapeState;
  foliage: FoliageParams;
  pot: PotParams;
  skeleton: Skeleton;
  leaves: LeafData[];
  leavesByDepth: Record<number, number>;
  potResult: PotResult | null;
  balance: MassBalance | null;
  camera?: { position: [number, number, number]; target: [number, number, number] };
}

export const FORMAT = 'bonsai-composition';

export function buildProject(input: ProjectInput): Project {
  const { tree, shape, skeleton, foliage, pot, leaves, leavesByDepth, potResult, balance, camera } = input;
  const branchCount = skeleton.limbs.filter((l) => l.kind !== 'trunk').length;
  const project: Project = {
    format: FORMAT,
    version: 1,
    createdAt: new Date().toISOString(),
    tree,
    shape,
    pruned: shape.pruned,
    foliage,
    pot,
    camera,
    stats: {
      leaves: leaves.length,
      leavesByDepth: Object.fromEntries(Object.entries(leavesByDepth).map(([k, v]) => [String(k), v])),
      controls: skeleton.controls.length,
      branches: branchCount,
      stability: balance ?? undefined,
    },
    skeleton: {
      nodes: skeleton.nodes,
      limbs: skeleton.limbs,
      controls: skeleton.controls,
    },
    foliageData: {
      leaves: leaves.map((leaf) => ({
        ...leaf,
        offset: [round(leaf.offset[0]), round(leaf.offset[1]), round(leaf.offset[2])],
        quat: [round(leaf.quat[0]), round(leaf.quat[1]), round(leaf.quat[2]), round(leaf.quat[3])],
        size: round(leaf.size),
        tone: round(leaf.tone),
      })),
    },
  };
  if (potResult) {
    project.potData = {
      mesh: {
        positions: Array.from(potResult.mesh.positions, (v) => round(v)),
        normals: Array.from(potResult.mesh.normals, (v) => round(v)),
        indices: Array.from(potResult.mesh.indices),
      },
      volume: round(potResult.volume),
      com: potResult.com.map((v) => round(v)) as [number, number, number],
      support: potResult.support.map(([x, z]) => [round(x), round(z)]),
      mass: round(potResult.mass),
    };
  }
  return project;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export interface LoadedProject {
  tree: TreeParams;
  shape: ShapeState;
  foliage: FoliageParams;
  pot: PotParams;
  camera?: { position: [number, number, number]; target: [number, number, number] };
  importedPot?: Project['potData'];
}

export class ProjectFormatError extends Error {}

export function parseProject(text: string): LoadedProject {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ProjectFormatError('文件不是有效的 JSON');
  }
  if (!raw || typeof raw !== 'object') throw new ProjectFormatError('文件内容为空');
  const obj = raw as Record<string, unknown>;
  if (obj.format !== FORMAT) throw new ProjectFormatError('不是盆景工程文件（缺少 bonsai-composition 标识）');
  const tree = normalizeTree(obj.tree);
  const shape = normalizeShape(obj.shape ?? obj);
  const foliage = normalizeFoliage(obj.foliage);
  const pot = normalizePot(obj.pot);
  const camera = normalizeCamera(obj.camera);
  return {
    tree,
    shape,
    foliage,
    pot,
    camera,
    importedPot: obj.potData as Project['potData'] | undefined,
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function normalizeTree(raw: unknown): TreeParams {
  const o = (raw ?? {}) as Record<string, unknown>;
  const t: TreeParams = { ...DEFAULT_TREE };
  for (const key of Object.keys(DEFAULT_TREE) as (keyof TreeParams)[]) {
    t[key] = num(o[key], DEFAULT_TREE[key]);
  }
  return t;
}

function normalizeFoliage(raw: unknown): FoliageParams {
  const o = (raw ?? {}) as Record<string, unknown>;
  const f: FoliageParams = { ...DEFAULT_FOLIAGE };
  for (const key of Object.keys(DEFAULT_FOLIAGE) as (keyof FoliageParams)[]) {
    f[key] = num(o[key], DEFAULT_FOLIAGE[key]);
  }
  return f;
}

function normalizePot(raw: unknown): PotParams {
  const o = (raw ?? {}) as Record<string, unknown>;
  const p: PotParams = { ...DEFAULT_POT };
  for (const key of Object.keys(DEFAULT_POT) as (keyof PotParams)[]) {
    const def = DEFAULT_POT[key];
    if (typeof def === 'number') (p as unknown as Record<string, unknown>)[key] = num(o[key], def);
    else if (typeof def === 'boolean') (p as unknown as Record<string, unknown>)[key] = typeof o[key] === 'boolean' ? o[key] : def;
    else if (key === 'style') {
      const styles = ['round', 'square', 'oval', 'hex', 'lotus'];
      (p as unknown as Record<string, unknown>)[key] = typeof o[key] === 'string' && styles.includes(o[key] as string) ? o[key] : def;
    } else if (key === 'footStyle') {
      (p as unknown as Record<string, unknown>)[key] = o[key] === 'plinth' ? 'plinth' : 'feet';
    }
  }
  return p;
}

function normalizeShape(raw: unknown): ShapeState {
  const o = (raw ?? {}) as Record<string, unknown>;
  const bends: ShapeState['bends'] = {};
  const rawBends = (o.bends ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(rawBends)) {
    if (Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number')) {
      bends[k] = [v[0], v[1], v[2], v[3]];
    }
  }
  const twists: ShapeState['twists'] = {};
  const rawTwists = (o.twists ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(rawTwists)) if (typeof v === 'number') twists[k] = v;
  const pruned = Array.isArray(o.pruned) ? o.pruned.filter((n): n is number => typeof n === 'number') : [];
  return { bends, twists, pruned };
}

function normalizeCamera(raw: unknown): LoadedProject['camera'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const pos = o.position;
  const tgt = o.target;
  if (!Array.isArray(pos) || !Array.isArray(tgt) || pos.length !== 3 || tgt.length !== 3) return undefined;
  return {
    position: [num(pos[0], 0), num(pos[1], 0), num(pos[2], 0)],
    target: [num(tgt[0], 0), num(tgt[1], 0), num(tgt[2], 0)],
  };
}

export function downloadProject(project: Project, filename?: string): void {
  const blob = new Blob([JSON.stringify(project)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = url;
  a.download = filename ?? `bonsai-${stamp}.bonsai.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
