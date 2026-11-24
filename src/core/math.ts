import { Quaternion, Vector3 } from 'three';
import type { V3, V4 } from './types';

export const DEG = Math.PI / 180;
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;




export function toV3(v: Vector3): V3 {
  return [v.x, v.y, v.z];
}


/** Quaternion that maps +Y onto `dir`, with a twist of `twist` radians about dir. */



/** Bend vector -> rotation that tilts +Y by |b| radians around the perpendicular axis. */



/** Rotate a vector around the Y axis. */
export function rotateY(v: Vector3, angle: number): Vector3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Vector3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}



export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function quatToV4(q: Quaternion): V4 {
  return [q.x, q.y, q.z, q.w];
}
