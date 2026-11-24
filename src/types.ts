import type * as THREE from 'three';

export type StepId = 'model' | 'parting' | 'tenon' | 'wall' | 'export';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type TenonSide = 'lower' | 'upper';

export interface TenonSettings {
  count: number;
  radius: number;
  depth: number;
  clearance: number;
  side: TenonSide;
  gridPadding: number;
  minCover: number;
}

export interface WallSettings {
  enabled: boolean;
  thickness: number;
  thinThreshold: number;
  autoThicken: boolean;
}

export interface DocumentState {
  step: StepId;
  modelId: string;
  modelName: string;
  modelSource: 'builtin' | 'import';
  format: string;
  triangleCount: number;
  minY: number;
  maxY: number;
  sizeX: number;
  sizeZ: number;

  contour: Vec3[];
  contourClosed: boolean;
  cutHeight: number;
  cutReady: boolean;
  explode: number;
  showSection: boolean;

  tenon: TenonSettings;
  wall: WallSettings;

  showConflictOnly: boolean;
  showInnerShell: boolean;
}

export interface TenonReportItem {
  index: number;
  x: number;
  z: number;
  score: number;
  boundaryClearance: number;
  minOppositeGap: number;
  intersects: boolean;
  thin: boolean;
  conflict: boolean;
  reason: string;
}

export interface ThinCornerWarning {
  x: number;
  y: number;
  z: number;
  thickness: number;
  required: number;
}

export interface PieceStats {
  name: string;
  triangles: number;
  volumeMm3: number;
  volumeCm3: number;
  tenons: number;
  sockets: number;
  watertight: boolean;
}

export interface PipelineResult {
  cutHeight: number;
  lowerGeometry: THREE.BufferGeometry | null;
  upperGeometry: THREE.BufferGeometry | null;
  lowerBodyGeometry: THREE.BufferGeometry | null;
  upperBodyGeometry: THREE.BufferGeometry | null;
  sectionLoops: Vec3[][];
  projectedCurve: Vec3[];
  tenons: TenonReportItem[];
  thinWarnings: ThinCornerWarning[];
  stats: PieceStats[];
  durationMs: number;
  warnings: string[];
}
