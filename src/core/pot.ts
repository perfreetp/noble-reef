import type { MassBalance, PotMass, PotParams, PotResult, PotStyle, V3 } from './types';
import { supportMargin } from './hull';

export const STYLES: { id: PotStyle; label: string }[] = [
  { id: 'round', label: '圆钵' },
  { id: 'square', label: '四角' },
  { id: 'oval', label: '椭圆' },
  { id: 'hex', label: '六角' },
  { id: 'lotus', label: '莲瓣' },
];

export const DEFAULT_POT: PotParams = {
  style: 'round',
  topRadius: 14.5,
  height: 12,
  wall: 0.85,
  baseRatio: 0.74,
  belly: 0.18,
  footHeight: 1.5,
  footStyle: 'feet',
  drainage: 2.4,
  groove: true,
  autoBalance: true,
  balanceGain: 0.65,
};

export function clampPot(p: PotParams): PotParams {
  return {
    ...p,
    topRadius: Math.min(34, Math.max(9, p.topRadius)),
    height: Math.min(30, Math.max(5, p.height)),
    wall: Math.min(3, Math.max(0.45, p.wall)),
    baseRatio: Math.min(1.05, Math.max(0.4, p.baseRatio)),
    belly: Math.min(0.5, Math.max(0, p.belly)),
    footHeight: Math.min(6, Math.max(0, p.footHeight)),
    drainage: Math.min(6, Math.max(0, p.drainage)),
    balanceGain: Math.min(1.5, Math.max(0, p.balanceGain)),
  };
}

export interface WorldMass {
  treeMass: number;
  treeCom: V3;
  leafMass: number;
  leafCom: V3;
  /** Height of the tree's root above the pot base; the tree's own COM is root-local. */
  treeBaseY: number;
}

/**
 * Combine wood, leaves and pot into one balance reading. Heights are in scene units:
 * the pot sits on y = 0, and its COM/margins are relative to its base.
 */
export function combineMass(
  world: WorldMass,
  pot: { mass: number; com: V3; support: [number, number][]; balance: [number, number] } | null,
  // Reserved for a future pot-rim offset; the balance reading is in pot-base coordinates.
): MassBalance {
  const treeMass = world.treeMass + world.leafMass;
  const totalTreeMass = Math.max(1e-6, treeMass);
  const treeCom: V3 = [
    (world.treeCom[0] * world.treeMass + world.leafCom[0] * world.leafMass) / totalTreeMass,
    (world.treeCom[1] * world.treeMass + world.leafCom[1] * world.leafMass) / totalTreeMass + world.treeBaseY,
    (world.treeCom[2] * world.treeMass + world.leafCom[2] * world.leafMass) / totalTreeMass,
  ];

  const potMass = pot?.mass ?? 0;
  const potCom: V3 = pot?.com ?? [0, 0, 0];
  const potComWorld: V3 = potCom;
  const totalMass = treeMass + potMass;
  const totalCom: V3 = totalMass > 0
    ? [
      (treeCom[0] * treeMass + potComWorld[0] * potMass) / totalMass,
      (treeCom[1] * treeMass + potComWorld[1] * potMass) / totalMass,
      (treeCom[2] * treeMass + potComWorld[2] * potMass) / totalMass,
    ]
    : [0, 0, 0];

  let margin = 0;
  if (pot) margin = supportMargin(pot.support, totalCom[0], totalCom[2]);
  const height = Math.max(0.5, totalCom[1]);
  const tipAngle = margin > 0 ? (Math.atan2(margin, height) * 180) / Math.PI : 0;
  const inside = margin > 0;
  const threshold = Math.max(1.1, (pot?.support.length ?? 0) * 0.22);
  const status: MassBalance['status'] = !inside ? 'unstable' : margin < threshold ? 'marginal' : 'stable';
  return {
    treeMass,
    treeCom,
    woodMass: world.treeMass,
    leafMass: world.leafMass,
    potMass,
    potCom: potComWorld,
    totalMass,
    totalCom,
    margin,
    tipAngle,
    inside,
    status,
  };
}

/** Where the trunk should sit vertically inside the pot: just under the rim. */
export function soilLine(pot: PotParams): number {
  return pot.height - Math.max(0.75, pot.wall * 0.85);
}



export function formatMass(grams: number): string {
  if (grams >= 1000) return `${(grams / 1000).toFixed(2)} kg`;
  return `${grams.toFixed(0)} g`;
}

