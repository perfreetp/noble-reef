import * as THREE from 'three';
import type { FacilityType } from '../../types/project';
import { getCatalogEntry } from '../../config/facilityCatalog';

/** 三类设施的程序化低模 Group 工厂，本地坐标原点在占地中心、底部 y=0 */
export const createFacilityMesh = (type: FacilityType): THREE.Group => {
  const catalog = getCatalogEntry(type);
  const group = new THREE.Group();
  group.name = `facility-${type}`;
  const color = catalog.color;

  if (type === 'observation') {
    // 观景台：4 根立柱 + 圆形平台 + 环形栏杆
    const deckMat = new THREE.MeshStandardMaterial({ color: 0xd9c9a3, roughness: 0.8 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x6b5a44, roughness: 0.9 });
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 0.8, 24), deckMat);
    deck.position.y = 6;
    deck.castShadow = true;
    group.add(deck);
    const legPositions: [number, number][] = [
      [4.5, 4.5],
      [-4.5, 4.5],
      [4.5, -4.5],
      [-4.5, -4.5],
    ];
    for (const [x, z] of legPositions) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 6, 8), legMat);
      leg.position.set(x, 3, z);
      leg.castShadow = true;
      group.add(leg);
    }
    const rail = new THREE.Mesh(
      new THREE.TorusGeometry(6.8, 0.12, 8, 32),
      new THREE.MeshStandardMaterial({ color: 0x4a3b2c }),
    );
    rail.rotation.x = Math.PI / 2;
    rail.position.y = 7.3;
    group.add(rail);
    const canopy = new THREE.Mesh(
      new THREE.ConeGeometry(7.6, 2.6, 24),
      new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
    );
    canopy.position.y = 9.6;
    canopy.castShadow = true;
    group.add(canopy);
  } else if (type === 'cable') {
    // 缆车站：站房 + 双坡屋顶 + 门廊
    const wallMat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x5c3a2e, roughness: 0.8 });
    const hall = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 9), wallMat);
    hall.position.y = 3;
    hall.castShadow = true;
    hall.receiveShadow = true;
    group.add(hall);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0, 1, 1, 4, 1), roofMat);
    roof.scale.set(9, 3, 7);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 7.4;
    roof.castShadow = true;
    group.add(roof);
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x708090 });
    for (const x of [-5, 5]) {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 12, 8), towerMat);
      tower.position.set(x, 6, 0);
      tower.castShadow = true;
      group.add(tower);
    }
  } else {
    // 售卖亭：六角亭身 + 伞盖
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xc95a4d, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.5, 3.2, 6), bodyMat);
    body.position.y = 1.6;
    body.castShadow = true;
    group.add(body);
    const counter = new THREE.Mesh(
      new THREE.CylinderGeometry(3.7, 3.7, 0.5, 6),
      new THREE.MeshStandardMaterial({ color: 0xe8d9b0 }),
    );
    counter.position.y = 2.2;
    group.add(counter);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(4.4, 2, 6), roofMat);
    roof.position.y = 4.2;
    roof.castShadow = true;
    group.add(roof);
  }

  return group;
};
