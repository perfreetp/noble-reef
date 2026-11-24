import * as THREE from 'three';
import { sharedUniforms, PROJECT_GLSL, R } from './projection.js';
import { makeTextSprite } from './textSprite.js';

const LINE_VERT = /* glsl */ `
${PROJECT_GLSL}
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(skyProject(world.xyz), 1.0);
}
`;
const LINE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
void main() { gl_FragColor = vec4(uColor, uOpacity); }
`;

function lineMaterial(color, opacity) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uProjection: sharedUniforms.uProjection,
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
    },
    vertexShader: LINE_VERT,
    fragmentShader: LINE_FRAG,
    transparent: true,
    depthWrite: false,
  });
}

/**
 * 地平线图层:地平圈 + 方位刻度 + 四正方位标注。
 * 地平圈在天球坐标系中随观测纬度倾斜(天顶赤纬 = 观测纬度)。
 */
export function createHorizon() {
  const group = new THREE.Group();
  const inner = new THREE.Group(); // 几何在"天顶=+Y"的本地系中构建
  group.add(inner);

  // --- 地平圈 ---
  const ringPts = [];
  const N = 128;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    ringPts.push(Math.sin(a) * R, 0, Math.cos(a) * R);
  }
  const ringGeo = new THREE.BufferGeometry();
  ringGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ringPts), 3));
  const ring = new THREE.Line(ringGeo, lineMaterial(0xffb347, 0.95));
  ring.frustumCulled = false;
  inner.add(ring);

  // --- 地面(半透明圆盘,示意地平面以下) ---
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(R * 0.995, 96),
    new THREE.MeshBasicMaterial({
      color: 0x0a1420,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.renderOrder = -1;
  inner.add(disc);

  const labels = [];
  let ticks = null;
  let cardinalGroup = null;

  /** 按纬度重建刻度与方位标注(本地系中的"北"随倾斜四元数变化) */
  function rebuildAzimuth() {
    if (ticks) { inner.remove(ticks); ticks.geometry.dispose(); }
    if (cardinalGroup) inner.remove(cardinalGroup);
    labels.length = 0;

    // 本地系:上 = +Y;世界北天极投影到地平面得到"北"
    const q = inner.quaternion;
    const qInv = q.clone().invert();
    const zenith = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const pole = new THREE.Vector3(0, 1, 0);
    let northW = pole.clone().addScaledVector(zenith, -pole.dot(zenith));
    if (northW.lengthSq() < 1e-6) northW = new THREE.Vector3(0, 0, 1);
    northW.normalize();
    const north = northW.clone().applyQuaternion(qInv).setY(0).normalize();
    const east = new THREE.Vector3().crossVectors(north, new THREE.Vector3(0, 1, 0)).negate();
    // e × n = u  =>  e = n × u 的反向修正;直接取 cross(north, up) 再按右手系定向
    east.crossVectors(north, new THREE.Vector3(0, 1, 0)).normalize();

    // --- 方位刻度:每 5° 小刻度,每 15° 中刻度,四正长刻度 ---
    const pts = [];
    for (let deg = 0; deg < 360; deg += 5) {
      const a = (deg * Math.PI) / 180;
      const dir = new THREE.Vector3()
        .addScaledVector(north, Math.cos(a))
        .addScaledVector(east, Math.sin(a));
      const len = deg % 90 === 0 ? 7 : deg % 15 === 0 ? 4 : 2;
      const p0 = dir.clone().multiplyScalar(R);
      const p1 = dir.clone().multiplyScalar(R - len);
      pts.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
    }
    const tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    ticks = new THREE.LineSegments(tGeo, lineMaterial(0xffd9a0, 0.75));
    ticks.frustumCulled = false;
    inner.add(ticks);

    // --- 四正方位标注 ---
    cardinalGroup = new THREE.Group();
    const cards = [
      ['北', north], ['东', east],
      ['南', north.clone().negate()], ['西', east.clone().negate()],
    ];
    for (const [name, dir] of cards) {
      const sp = makeTextSprite(name, { fontSize: 34, color: '#ffcf8a', worldH: 8 });
      sp.position.copy(dir).multiplyScalar(R + 10);
      cardinalGroup.add(sp);
      labels.push({ sprite: sp, dir: dir.clone(), localParent: inner });
    }
    inner.add(cardinalGroup);
  }

  /** 设置观测纬度:天顶方向 = (cosφ, sinφ, 0),即天顶赤纬等于纬度 */
  function setLatitude(latDeg) {
    const lat = (latDeg * Math.PI) / 180;
    const zenith = new THREE.Vector3(Math.cos(lat), Math.sin(lat), 0);
    inner.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), zenith);
    rebuildAzimuth();
  }

  setLatitude(40);
  return { group, inner, disc, setLatitude, labels };
}
