import * as THREE from 'three';
import { UNDERWATER_VERTEX, UNDERWATER_FRAGMENT } from './shaders';
import type { UniformsHandle } from './uniforms';

export interface UnderwaterMaterial {
  material: THREE.ShaderMaterial;
  setUniforms: (u: UniformsHandle) => void;
}

/** 创建共享水体 uniform 的水下物体材质 */
export function createUnderwaterMaterial(
  uniforms: UniformsHandle,
  baseColor: THREE.ColorRepresentation,
  metalness = 0.4,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: UNDERWATER_VERTEX,
    fragmentShader: UNDERWATER_FRAGMENT,
    uniforms: {
      ...uniforms.shared,
      uBaseColor: { value: new THREE.Color(baseColor) },
      uMetalness: { value: metalness },
    },
  });
}

/** 段与段之间的连接铰链 */
function joint(
  group: THREE.Group,
  pos: THREE.Vector3,
  radius: number,
  matOrange: THREE.ShaderMaterial,
  matGray: THREE.ShaderMaterial,
) {
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), matOrange);
  sphere.position.copy(pos);
  group.add(sphere);

  const axle = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, radius * 2.2, 20), matGray);
  axle.rotation.z = Math.PI / 2;
  axle.position.copy(pos);
  group.add(axle);
}

/** 圆柱连接两关节点 */
function linkBetween(a: THREE.Vector3, b: THREE.Vector3, radius: number, mat: THREE.ShaderMaterial) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 22), mat);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

export interface RobotScene {
  group: THREE.Group;
  materials: THREE.ShaderMaterial[];
}

/**
 * 搭建一只三段式工业机械臂（底座 → 大臂 → 小臂 → 夹爪），
 * 全部使用共享 uniform 的自定义水下材质。
 */
export function buildRobotArm(uniforms: UniformsHandle): RobotScene {
  const group = new THREE.Group();
  const matGray = createUnderwaterMaterial(uniforms, 0x8f9aa6, 0.85);
  const matDark = createUnderwaterMaterial(uniforms, 0x3a424c, 0.7);
  const matOrange = createUnderwaterMaterial(uniforms, 0xd2691e, 0.35);
  const materials = [matGray, matDark, matOrange];

  // 底座
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.35, 32), matDark);
  base.position.y = 0.175;
  group.add(base);

  const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.45, 28), matGray);
  turret.position.y = 0.55;
  group.add(turret);

  // 三个关节位置
  const p0 = new THREE.Vector3(0, 0.8, 0);
  const p1 = new THREE.Vector3(0.55, 1.75, 0.15);
  const p2 = new THREE.Vector3(1.35, 2.25, -0.1);
  const p3 = new THREE.Vector3(2.0, 1.7, 0.05);

  joint(group, p0, 0.28, matOrange, matGray);
  group.add(linkBetween(p0, p1, 0.17, matGray));
  joint(group, p1, 0.24, matOrange, matGray);
  group.add(linkBetween(p1, p2, 0.14, matGray));
  joint(group, p2, 0.21, matOrange, matGray);
  group.add(linkBetween(p2, p3, 0.11, matDark));
  joint(group, p3, 0.17, matOrange, matGray);

  // 夹爪
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.28, 18), matGray);
  wrist.position.set(p3.x + 0.18, p3.y - 0.12, p3.z);
  wrist.rotation.z = Math.PI / 2.8;
  group.add(wrist);

  for (const side of [-1, 1]) {
    const finger = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.1), matOrange);
    finger.position.set(p3.x + 0.36, p3.y - 0.24 + side * 0.09, p3.z);
    finger.rotation.z = side * 0.25;
    group.add(finger);
  }

  // 线缆细节
  const cableCurve = new THREE.CatmullRomCurve3([
    p0.clone().add(new THREE.Vector3(0, 0.1, 0.2)),
    p1.clone().add(new THREE.Vector3(0, 0.12, 0.2)),
    p2.clone().add(new THREE.Vector3(0, 0.1, 0.16)),
  ]);
  const cable = new THREE.Mesh(new THREE.TubeGeometry(cableCurve, 32, 0.03, 8, false), matDark);
  group.add(cable);

  return { group, materials };
}

/** 海床与少量礁石，提供可被灯光染色的大面积表面 */
export function buildSeabed(uniforms: UniformsHandle): RobotScene {
  const group = new THREE.Group();
  const matSand = createUnderwaterMaterial(uniforms, 0x5a5648, 0.05);
  const matRock = createUnderwaterMaterial(uniforms, 0x474d52, 0.1);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30, 1, 1), matSand);
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  const rockPositions: Array<[number, number, number]> = [
    [-3.2, -2.1, 0.45],
    [3.4, -2.8, 0.6],
    [-2.4, 2.6, 0.35],
    [2.8, 2.2, 0.5],
    [0.2, -3.4, 0.3],
  ];
  for (const [x, z, s] of rockPositions) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), matRock);
    rock.position.set(x, s * 0.45, z);
    rock.scale.y = 0.7;
    group.add(rock);
  }

  return { group, materials: [matSand, matRock] };
}
