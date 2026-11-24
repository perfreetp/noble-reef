import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

const bvhCache = new WeakMap<THREE.BufferGeometry, MeshBVH>();

export function ensureBVH(geometry: THREE.BufferGeometry): MeshBVH {
  const existing = bvhCache.get(geometry);
  if (existing) return existing;

  const bvh = new MeshBVH(geometry, { targetLeafSize: 8, strategy: 0 });
  geometry.boundsTree = bvh;
  bvhCache.set(geometry, bvh);
  return bvh;
}

export function makeBVHMesh(geometry: THREE.BufferGeometry, material?: THREE.Material): THREE.Mesh {
  ensureBVH(geometry);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.raycast = acceleratedRaycast;
  return mesh;
}

const _ray = new THREE.Ray();
const _hit = new THREE.Vector3();

/** Casts along an arbitrary direction using the BVH. Returns distance or Infinity. */
export function bvhRayDistance(
  bvh: MeshBVH,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDistance = 500,
): number {
  _ray.set(origin, direction.clone().normalize());
  const hit = bvh.raycastFirst(_ray, THREE.DoubleSide, 0.001, maxDistance);
  return hit?.distance ?? Number.POSITIVE_INFINITY;
}

export function bvhClosestDistance(bvh: MeshBVH, point: THREE.Vector3): number {
  const result = bvh.closestPointToPoint(point, undefined as never, 0, 1000);
  if (!result) return Number.POSITIVE_INFINITY;
  _hit.copy(result.point);
  return result.distance;
}
