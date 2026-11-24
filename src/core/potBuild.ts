import type { PotMesh, PotParams, V3 } from '../core/types';
import { convexHull2D } from '../core/hull';
import { clampPot } from '../core/pot';

/** Minimal surface of the manifold-3d module that this builder needs. */
export interface ManifoldLike {
  CrossSection: any;
  Manifold: any;
}

export interface PotBuildResult {
  /** Inner cavity outline at rim height, in plan (x, y == scene x, z). */
  cavity: [number, number][];
  mesh: PotMesh;
  volume: number;
  com: V3;
  mass: number;
  support: [number, number][];
  bbox: { min: V3; max: V3 };
  ballast: { mass: number; position: V3 } | null;
  balance: [number, number];
}

export const CERAMIC_DENSITY = 1.9; // g/cm^3
const BALLAST_DENSITY = 7.85; // steel, g/cm^3

function clampBase(r: number): number {
  return Math.min(1.02, Math.max(0.35, r));
}

function baseRadius(p: PotParams): number {
  return p.topRadius * clampBase(p.baseRatio);
}

function wallPoint(p: PotParams, t: number, inset: number): [number, number] {
  const Rb = baseRadius(p);
  const Rt = p.topRadius;
  const foot = p.footHeight;
  const y = foot + t * (p.height - foot);
  const belly = Math.sin(Math.PI * t) * p.belly * (Rt - Rb);
  const flare = Math.pow(t, 4) * (Rt - Rb) * 0.08;
  const r = Rb + (Rt - Rb) * Math.pow(t, 0.85) + belly + flare - inset;
  return [Math.max(0.4, r), y];
}

/** Closed (radius, height) outline for a revolved pot: outer wall, rim, inner wall, floor. */
export function revolveProfile(p: PotParams): [number, number][] {
  const foot = p.footHeight;
  const baseT = Math.max(0.65, p.wall * 1.2);
  const Rb = baseRadius(p);
  const rimInset = Math.min(p.topRadius * 0.5, p.wall + 0.35);
  const pts: [number, number][] = [];
  pts.push([0.001, foot]);
  pts.push([Rb * 0.985, foot]);
  const segs = 12;
  for (let i = 1; i <= segs; i++) pts.push(wallPoint(p, i / segs, 0));
  // Rim: from the outer lip inward and slightly over the top.
  pts.push([p.topRadius - rimInset, p.height]);
  for (let i = segs; i >= 1; i--) pts.push(wallPoint(p, i / segs, p.wall));
  pts.push([Math.max(0.45, Rb * 0.55), foot + baseT]);
  pts.push([0.001, foot + baseT]);
  return pts;
}

/**
 * Plan outline of the pot's inner cavity at rim height. The soil surface is built from this,
 * so it meets the wall exactly for every style instead of being guessed from triangles.
 */
export function cavityOutline(p: PotParams): [number, number][] {
  const sides = p.style === 'square' ? 4 : p.style === 'hex' ? 6 : 0;
  const Rb = baseRadius(p);
  const flare = 1 + Math.min(0.14, Math.max(0, p.belly * 0.35));
  const squashX = p.style === 'oval' ? 1.22 : 1;
  const squashZ = p.style === 'oval' ? 0.86 : 1;
  const pts: [number, number][] = [];
  if (sides === 0) {
    const steps = 112;
    const rr = Math.max(0.5, p.topRadius - p.wall * flare);
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      pts.push([Math.cos(a) * rr * squashX, Math.sin(a) * rr * squashZ]);
    }
    return pts;
  }
  // Regular polygon whose flats (not vertices) sit at the cavity apothem, then round the
  // corners by clipping each one with a short arc.
  const apothem = Math.max(0.4, (Rb - p.wall) * flare);
  const corner = sides === 4 ? Rb * 0.18 : Rb * 0.08;
  const outerR = apothem / Math.cos(Math.PI / sides);
  const cornerR = Math.min(corner, apothem * 0.55);
  const corners: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const a = (Math.PI * 2 * i) / sides - Math.PI / 2;
    corners.push([Math.cos(a) * outerR, Math.sin(a) * outerR]);
  }
  // For each corner: entry point on the incoming edge, arc, exit point on the outgoing edge.
  const shrink = cornerR / Math.tan(Math.PI / sides);
  const per = 12;
  for (let i = 0; i < sides; i++) {
    const prev = corners[(i + sides - 1) % sides];
    const cur = corners[i];
    const next = corners[(i + 1) % sides];
    const inDir = unit(sub(cur, prev));
    const outDir = unit(sub(next, cur));
    const entry: [number, number] = [cur[0] - inDir[0] * shrink, cur[1] - inDir[1] * shrink];
    const exit: [number, number] = [cur[0] + outDir[0] * shrink, cur[1] + outDir[1] * shrink];
    // Quadratic Bezier through the corner approximates the rounded joint well enough here.
    for (let k = 0; k <= per; k++) {
      const t = k / per;
      const mt = 1 - t;
      pts.push([
        mt * mt * entry[0] + 2 * mt * t * cur[0] + t * t * exit[0],
        mt * mt * entry[1] + 2 * mt * t * cur[1] + t * t * exit[1],
      ]);
    }
    // Straight run to the next corner's entry point.
    const nextPrev = cur;
    const nextCur = next;
    const nextIn = unit(sub(nextCur, nextPrev));
    const nextEntry: [number, number] = [nextCur[0] - nextIn[0] * shrink, nextCur[1] - nextIn[1] * shrink];
    const runSegs = 8;
    for (let k = 1; k < runSegs; k++) {
      const t = k / runSegs;
      pts.push([exit[0] + (nextEntry[0] - exit[0]) * t, exit[1] + (nextEntry[1] - exit[1]) * t]);
    }
  }
  return pts;
}

function sub(a: [number, number], b: [number, number]): [number, number] {
  return [a[0] - b[0], a[1] - b[1]];
}

function unit(v: [number, number]): [number, number] {
  const len = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / len, v[1] / len];
}

function roundedPolygon(mod: ManifoldLike, sides: number, radius: number, corner: number): any {
  const { CrossSection } = mod;
  if (sides <= 0) return CrossSection.circle(radius, 96);
  const pts: [number, number][] = [];
  const r = radius / Math.cos(Math.PI / sides);
  for (let i = 0; i < sides; i++) {
    const a = (Math.PI * 2 * i) / sides - Math.PI / 2;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  let cs = new CrossSection(pts);
  if (corner > 0.01) cs = cs.offset(-corner, 'Round', 2, 8);
  return cs;
}

function buildRevolved(mod: ManifoldLike, p: PotParams): any {
  const cs = new mod.CrossSection(revolveProfile(p));
  let pot = cs.revolve(128);
  if (p.style === 'oval') pot = pot.scale([1.22, 1, 0.86]);
  else if (p.style === 'round' || p.style === 'lotus') pot = pot.scale([1, 1, 1]);
  return pot;
}

function buildPolygon(mod: ManifoldLike, p: PotParams, sides: number): any {
  const { Manifold } = mod;
  const foot = p.footHeight;
  const Rb = baseRadius(p);
  const corner = sides === 4 ? Rb * 0.18 : Rb * 0.08;
  // Outer shell: constant profile from foot to rim; a slight outward flare is faked by
  // scaling the top, which keeps the cross-section valid for the boolean below.
  const flare = 1 + Math.min(0.14, Math.max(0, p.belly * 0.35));
  const outer = roundedPolygon(mod, sides, Rb, corner);
  const body = outer.extrude(p.height - foot, 1, 0, [flare, flare]).translate([0, 0, foot]);
  // Cavity: the same section, scaled to the rim, then inset by the wall. Offsetting the
  // base section first would leave the wall thicker at the rim than at the foot.
  const baseT = Math.max(0.7, p.wall * 1.2);
  const inner = roundedPolygon(mod, sides, Rb, corner)
    .offset(-p.wall, 'Round', 2, 8)
    .extrude(p.height - foot + 1.5, 1, 0, [flare, flare])
    .translate([0, 0, foot + baseT]);
  let pot = body.subtract(inner);
  // Feet / plinth.
  const feet: any[] = [];
  if (foot > 0.05) {
    if (p.footStyle === 'feet' && sides === 4) {
      for (let i = 0; i < 4; i++) {
        const a = (Math.PI / 2) * i + Math.PI / 4;
        const rr = Rb * 0.78;
        feet.push(Manifold.cylinder(foot + 0.05, Rb * 0.15, Rb * 0.11, 24)
          .translate([Math.cos(a) * rr, Math.sin(a) * rr, 0]));
      }
    } else {
      feet.push(roundedPolygon(mod, sides, Rb * 0.88, corner * 0.6).extrude(foot, 0, 0, 1));
    }
  }
  if (feet.length) pot = Manifold.union([pot, ...feet]);
  return pot;
}

function buildPetalRing(mod: ManifoldLike, p: PotParams): any {
  // Lotus petals: vertical scallops pressed into the outside of the body. Each is a thin
  // blade standing on the wall at that height and spun to face outwards around the Z axis.
  const { Manifold } = mod;
  if (p.style !== 'lotus') return null;
  const petals = 14;
  const cuts: any[] = [];
  const t0 = 0.34;
  const t1 = 0.86;
  const yMid = p.footHeight + ((t0 + t1) / 2) * (p.height - p.footHeight);
  const height = (t1 - t0) * (p.height - p.footHeight) * 0.9;
  const wallR = wallPoint(p, (t0 + t1) / 2, 0)[0];
  // Shallow relief: the blade bites only partway into the wall, so the petals read as
  // carved facets instead of windows into the pot.
  const depth = Math.max(0.16, Math.min(0.5, p.wall * 0.55));
  const width = Math.max(0.35, (Math.PI * 2 * wallR) / petals * 0.5);
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const blade = Manifold.cube([depth, width, height], true)
      .translate([wallR + depth * 0.5 - depth * 0.02, 0, yMid])
      .rotate([0, 0, (a * 180) / Math.PI]);
    cuts.push(blade);
  }
  return Manifold.union(cuts);
}

function buildRimGroove(mod: ManifoldLike, p: PotParams): any {
  const { Manifold } = mod;
  const bandY = p.height - Math.max(0.9, p.height * 0.14);
  // A shallow decorative notch: it only bites into the outer skin of the wall.
  const depth = Math.max(0.12, p.wall * 0.22);
  const rIn = Math.max(0.6, p.topRadius - depth);
  const ring: [number, number][] = [
    [rIn, bandY - 0.3], [p.topRadius + 3, bandY - 0.3],
    [p.topRadius + 3, bandY + 0.3], [rIn, bandY + 0.3],
  ];
  let cut = new mod.CrossSection(ring).revolve(128);
  if (p.style === 'square') cut = cut.scale([1.26, 1.26, 1]);
  else if (p.style === 'hex') cut = cut.scale([1.16, 1.16, 1]);
  else if (p.style === 'oval') cut = cut.scale([1.24, 0.9, 1]);
  return cut;
}

function buildRimRing(mod: ManifoldLike, p: PotParams): any {
  // A raised lip outside the rim, so the silhouette reads as a pot and not a bowl.
  // The lip follows the pot's plan shape so square and hex pots keep their corners.
  const { Manifold } = mod;
  const lift = Math.max(0.4, p.wall * 0.7);
  const lip = Math.max(0.4, p.wall * 0.55);
  const sides = p.style === 'square' ? 4 : p.style === 'hex' ? 6 : 0;
  let outer: any;
  let inner: any;
  if (sides === 0) {
    outer = Manifold.cylinder(lift, p.topRadius + lip * 0.6, p.topRadius + lip, 128)
      .translate([0, 0, p.height - lift]);
    inner = Manifold.cylinder(lift + 0.8, p.topRadius - p.wall * 0.9, p.topRadius - p.wall * 0.9, 128)
      .translate([0, 0, p.height - lift - 0.4]);
    if (p.style === 'oval') {
      outer = outer.scale([1.22, 0.86, 1]);
      inner = inner.scale([1.22, 0.86, 1]);
    }
  } else {
    const corner = sides === 4 ? baseRadius(p) * 0.18 : baseRadius(p) * 0.08;
    const flare = 1 + Math.min(0.14, Math.max(0, p.belly * 0.35));
    // The body's rim is the base section scaled by `flare`; match that ring exactly.
    outer = roundedPolygon(mod, sides, baseRadius(p), corner)
      .extrude(lift, 0, 0, [flare, flare])
      .translate([0, 0, p.height - lift]);
    inner = roundedPolygon(mod, sides, baseRadius(p), corner)
      .offset(-p.wall * 0.55, 'Round', 2, 6)
      .extrude(lift + 0.8, 0, 0, [flare, flare])
      .translate([0, 0, p.height - lift - 0.4]);
  }
  return outer.subtract(inner);
}

function buildDrainage(mod: ManifoldLike, p: PotParams): any {
  const { Manifold } = mod;
  if (p.drainage <= 0.2) return null;
  const y = p.footHeight + 0.2;
  const holes: any[] = [];
  const h = Math.max(2.2, p.wall * 5);
  holes.push(Manifold.cylinder(h, p.drainage * 0.42, p.drainage * 0.42, 28).translate([0, 0, y - h / 2]));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const rr = p.topRadius * 0.36;
    holes.push(Manifold.cylinder(h, p.drainage * 0.24, p.drainage * 0.24, 20)
      .translate([Math.cos(a) * rr, Math.sin(a) * rr, y - h / 2]));
  }
  return Manifold.union(holes);
}

function ballastSolid(mod: ManifoldLike, p: PotParams, dir: [number, number], massGrams: number): {
  solid: any; position: V3;
} {
  const { Manifold } = mod;
  const volume = Math.max(0.3, massGrams / BALLAST_DENSITY);
  const Rb = baseRadius(p);
  const innerR = Math.max(1.2, Rb - p.wall - 0.5);
  let radius = Math.cbrt((volume * 3) / (4 * Math.PI));
  radius = Math.min(radius, innerR * 0.68);
  const height = Math.max(0.35, volume / (Math.PI * radius * radius));
  const y = p.footHeight + Math.max(0.7, p.wall * 1.2) + height / 2 + 0.05;
  const arm = Math.max(0, Math.min(innerR * 0.7, innerR - radius * 1.05));
  const x = dir[0] * arm;
  const z = dir[1] * arm;
  // Plan coordinates (x, y) with height along Z, matching the rest of the build.
  return {
    solid: Manifold.cylinder(height, radius, radius, 36).translate([x, z, y]),
    position: [x, y, z],
  };
}

export interface MassProps {
  volume: number;
  com: V3;
  support: [number, number][];
  bbox: { min: V3; max: V3 };
  masses: { ceramic: number; ballast: number } | null;
}

/** Volume, centroid and support polygon of a closed mesh (tetrahedron decomposition). */
export function massProps(positions: Float32Array, indices: Uint32Array): MassProps {
  let vol = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  const n = positions.length / 3;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  }
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t] * 3;
    const ib = indices[t + 1] * 3;
    const ic = indices[t + 2] * 3;
    const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
    const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
    const dx = positions[ic], dy = positions[ic + 1], dz = positions[ic + 2];
    const v = (ax * (by * dz - bz * dy) - ay * (bx * dz - bz * dx) + az * (bx * dy - by * dx)) / 6;
    vol += v;
    cx += (v * (ax + bx + dx)) / 4;
    cy += (v * (ay + by + dy)) / 4;
    cz += (v * (az + bz + dz)) / 4;
  }
  if (Math.abs(vol) < 1e-9) {
    return { volume: 0, com: [0, 0, 0], support: [], bbox: { min, max }, masses: null };
  }
  const com: V3 = [cx / vol, cy / vol, cz / vol];
  const height = Math.max(1e-3, max[1] - min[1]);
  const band = min[1] + Math.max(0.3, height * 0.035);
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (positions[i * 3 + 1] <= band) pts.push([positions[i * 3], positions[i * 3 + 2]]);
  }
  const hull = convexHull2D(pts);
  return { volume: Math.abs(vol), com, support: hull, bbox: { min, max }, masses: null };
}

export function meshFromManifold(obj: any): { mesh: PotMesh; props: MassProps } {
  const withNormals = obj.calculateNormals(0, 28);
  const m = withNormals.getMesh();
  const vp: Float32Array = m.vertProperties;
  const tv: Uint32Array = m.triVerts;
  const numProp = m.numProp as number;
  const numVert = vp.length / numProp;
  const positions = new Float32Array(numVert * 3);
  const normals = new Float32Array(numVert * 3);
  for (let i = 0; i < numVert; i++) {
    positions[i * 3] = vp[i * numProp];
    positions[i * 3 + 1] = vp[i * numProp + 1];
    positions[i * 3 + 2] = vp[i * numProp + 2];
    if (numProp >= 6) {
      normals[i * 3] = vp[i * numProp + 3];
      normals[i * 3 + 1] = vp[i * numProp + 4];
      normals[i * 3 + 2] = vp[i * numProp + 5];
    } else {
      normals[i * 3 + 1] = 1;
    }
  }
  const indices = new Uint32Array(tv);
  const props = massProps(positions, indices);
  return { mesh: { positions, normals, indices }, props };
}

/**
 * Builds a pot as real solid geometry: hollow body, feet/plinth, rim lip, decorative
 * groove, drainage holes and (optionally) a steel ballast slug to correct the combined
 * centre of mass. Every shape is a manifold boolean, so the exported mesh stays watertight.
 */
export function buildPot(mod: ManifoldLike, input: PotParams, opts: {
  treeMass: number;
  treeCom: V3;
  treeBaseY: number;
  balanceGain: number;
}): PotBuildResult {
  const p = clampPot(input);
  const { Manifold } = mod;

  const assemble = (ballastMass: number, dir: [number, number]): any => {
    let solid = p.style === 'square' || p.style === 'hex'
      ? buildPolygon(mod, p, p.style === 'square' ? 4 : 6)
      : buildRevolved(mod, p);
    solid = Manifold.union([solid, buildRimRing(mod, p)]);
    if (p.footStyle === 'feet' && (p.style === 'round' || p.style === 'oval' || p.style === 'lotus')) {
      const Rb = baseRadius(p);
      if (p.footHeight > 0.05) {
        const feet: any[] = [];
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          feet.push(Manifold.cylinder(p.footHeight + 0.05, Rb * 0.15, Rb * 0.11, 24)
            .translate([Math.cos(a) * Rb * 0.76, Math.sin(a) * Rb * 0.76, 0]));
        }
        solid = Manifold.union([solid, ...feet]);
      }
    }
    if (p.groove) {
      solid = solid.subtract(buildRimGroove(mod, p));
      const petals = buildPetalRing(mod, p);
      if (petals) solid = solid.subtract(petals);
    }
    const drains = buildDrainage(mod, p);
    if (drains) solid = solid.subtract(drains);
    let ballastPos: V3 | null = null;
    if (ballastMass > 0.05) {
      const b = ballastSolid(mod, p, dir, ballastMass);
      solid = Manifold.union([solid, b.solid]);
      ballastPos = b.position;
    }
    // Manifold works Z-up; the scene is Y-up. One rotation converts the whole solid.
    return { solid: solid.rotate([-90, 0, 0]), ballastPos };
  };

  const plain = assemble(0, [0, 0]);
  let { mesh, props } = meshFromManifold(plain.solid);
  let ballast: PotBuildResult['ballast'] = null;
  let ceramicVolume = props.volume;

  if (p.autoBalance && opts.treeMass > 0.5) {
    const treeComWorld: V3 = [opts.treeCom[0], opts.treeCom[1] + opts.treeBaseY, opts.treeCom[2]];
    const potMass = ceramicVolume * CERAMIC_DENSITY;
    // The tree's weight must be counterbalanced by an equal moment from ballast.
    const needX = -opts.treeMass * treeComWorld[0];
    const needZ = -opts.treeMass * treeComWorld[2];
    // Existing pot offset relative to the axis contributes as well.
    const potOffsetX = potMass * (props.com[0] - 0);
    const potOffsetZ = potMass * (props.com[2] - 0);
    const targetX = needX - potOffsetX;
    const targetZ = needZ - potOffsetZ;
    const dist = Math.hypot(targetX, targetZ);
    if (dist > 1) {
      const dir: [number, number] = [targetX / dist, targetZ / dist];
      const Rb = baseRadius(p);
      const innerR = Math.max(1.2, Rb - p.wall - 0.5);
      const arm = Math.max(0.5, innerR * 0.6);
      let massNeeded = dist / arm;
      const cap = potMass * 0.8 + 40;
      massNeeded = Math.max(0, Math.min(cap, massNeeded));
      if (massNeeded > 1) {
        const withBallast = assemble(massNeeded, dir);
        const out = meshFromManifold(withBallast.solid);
        if (out.props.volume > 0) {
          mesh = out.mesh;
          props = out.props;
          ballast = { mass: massNeeded, position: withBallast.ballastPos ?? [0, 0, 0] };
          ceramicVolume = props.volume;
        }
      }
    }
  }

  const ceramicMass = Math.max(0, ceramicVolume) * CERAMIC_DENSITY;
  let com: V3 = props.com;
  if (ballast) {
    const slugVol = ballast.mass / BALLAST_DENSITY;
    const ceramicVol = Math.max(1e-6, ceramicVolume - slugVol);
    com = blendCom(props.com, ceramicVol * CERAMIC_DENSITY, ballast.position, ballast.mass);
  }

  return {
    cavity: cavityOutline(p),
    mesh,
    volume: ceramicVolume,
    com,
    mass: ceramicMass,
    support: props.support,
    bbox: props.bbox,
    ballast,
    balance: [0, 0],
  };
}

function blendCom(bodyCom: V3, bodyMass: number, slugPos: V3, slugMass: number): V3 {
  const total = Math.max(1e-6, bodyMass + slugMass);
  return [
    (bodyCom[0] * bodyMass + slugPos[0] * slugMass) / total,
    (bodyCom[1] * bodyMass + slugPos[1] * slugMass) / total,
    (bodyCom[2] * bodyMass + slugPos[2] * slugMass) / total,
  ];
}
