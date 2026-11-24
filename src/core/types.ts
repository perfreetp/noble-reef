export type V3 = [number, number, number];
export type V4 = [number, number, number, number];

export type LimbKind = 'trunk' | 'primary' | 'secondary' | 'twig' | 'root';

/** One joint of the tree skeleton. restPos is in tree-local bind space. */
export interface SkeletonNode {
  id: number;
  parent: number;
  limb: number;
  depth: number;
  restPos: V3;
  radius: number;
  /** Bone length from the parent joint (0 for a limb's first node). */
  length: number;
  segIndex: number;
  control: boolean;
}

export interface LimbInfo {
  id: number;
  parentLimb: number;
  /** Parent node this limb is attached to (-1 for the trunk). */
  attachNode: number;
  /** Node ids, ordered from the attach point outward. */
  nodes: number[];
  depth: number;
  kind: LimbKind;
  seedAngle: number;
}

export interface Skeleton {
  seed: number;
  nodes: SkeletonNode[];
  limbs: LimbInfo[];
  /** Node ids that own a draggable handle. */
  controls: number[];
  /** Trunk joints in order (used by handle rings + labels). */
  trunk: number[];
  params: TreeParams;
}

export interface TreeParams {
  seed: number;
  height: number;
  trunkBend: number;
  trunkRadius: number;
  taper: number;
  primaryCount: number;
  primaryLength: number;
  branchSpread: number;
  droop: number;
  detail: number;
}

export interface ShapeState {
  /** Per control-node bend rotation (quaternion x,y,z,w) in the parent frame. */
  bends: Record<string, V4>;
  /** Per control-node twist in degrees, about the limb axis. */
  twists: Record<string, number>;
  /** Root limbs (branch ids) removed from the tree. */
  pruned: number[];
}

export interface FoliageParams {
  density: number;
  size: number;
  hue: number;
  opacity: number;
  fluff: number;
  seed: number;
}

/** One leaf instance in bind space of its anchor node. */
export interface LeafData {
  node: number;
  offset: V3;
  quat: V4;
  size: number;
  depth: number;
  /** 0..1 tonal variation. */
  tone: number;
}

export interface FoliageData {
  leaves: LeafData[];
  byDepth: Record<number, number>;
}

export type PotStyle = 'round' | 'square' | 'oval' | 'hex' | 'lotus';

export interface PotParams {
  style: PotStyle;
  topRadius: number;
  height: number;
  wall: number;
  baseRatio: number;
  belly: number;
  footHeight: number;
  footStyle: 'feet' | 'plinth';
  drainage: number;
  groove: boolean;
  autoBalance: boolean;
  balanceGain: number;
}

export interface PotMass {
  volume: number;
  /** Centre of mass in pot-local cm. */
  com: V3;
  /** Lowest vertices projected onto the ground plane, convex hull, pot-local. */
  support: [number, number][];
  bbox: { min: V3; max: V3 };
}

export interface PotMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface PotResult {
  id: number;
  params: PotParams;
  /** COM offset the mesh was balanced for. */
  balance: [number, number];
  /** Mass of the mesh (volume * density) for convenience, grams. */
  mass: number;
  mesh: PotMesh;
  /** Inner cavity outline at rim height; the soil surface follows it. */
  cavity?: [number, number][];
  support: [number, number][];
  volume: number;
  com: V3;
  buildMs: number;
}

export interface MassBalance {
  treeMass: number;
  treeCom: V3;
  woodMass: number;
  leafMass: number;
  potMass: number;
  potCom: V3;
  totalMass: number;
  totalCom: V3;
  /** Distance from the COM projection to the support edge; negative = outside. */
  margin: number;
  /** Tip-over angle in degrees (0 when the COM is outside). */
  tipAngle: number;
  inside: boolean;
  status: 'stable' | 'marginal' | 'unstable';
}

export interface Project {
  format: 'bonsai-composition';
  version: 1;
  createdAt: string;
  tree: TreeParams;
  shape: ShapeState;
  pruned: number[];
  foliage: FoliageParams;
  pot: PotParams;
  camera?: { position: V3; target: V3 };
  stats: {
    leaves: number;
    leavesByDepth: Record<string, number>;
    controls: number;
    branches: number;
    stability?: MassBalance;
  };
  skeleton: {
    nodes: SkeletonNode[];
    limbs: LimbInfo[];
    controls: number[];
  };
  foliageData: {
    leaves: LeafData[];
  };
  potData?: {
    mesh: { positions: number[]; normals: number[]; indices: number[] };
    volume: number;
    com: V3;
    support: [number, number][];
    mass: number;
  };
}
