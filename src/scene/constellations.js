import * as THREE from 'three';
import { raDecToDir } from '../astro.js';
import { sharedUniforms, PROJECT_GLSL, R } from './projection.js';
import { CONSTELLATIONS } from '../data/constellations.js';
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
void main() {
  gl_FragColor = vec4(uColor, uOpacity);
}
`;

/** 大圆分段:两端点方向球面插值,每段约 2.5° */
function greatCirclePoints(a, b, out) {
  const va = new THREE.Vector3(...a).normalize();
  const vb = new THREE.Vector3(...b).normalize();
  const angle = va.angleTo(vb);
  const segs = Math.max(2, Math.ceil(angle / (2.5 * Math.PI / 180)));
  let prev = null;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    // slerp
    const sinT = Math.sin(angle);
    const ka = Math.sin((1 - t) * angle) / sinT;
    const kb = Math.sin(t * angle) / sinT;
    const p = new THREE.Vector3()
      .addScaledVector(va, ka)
      .addScaledVector(vb, kb)
      .multiplyScalar(R);
    if (prev) out.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
    prev = p;
  }
}

/**
 * 星座图层:连线按大圆分段绘制,名称标注为始终面向相机的精灵。
 * labels 暴露给引擎,投影切换时按目标投影重新定位。
 */
export function createConstellations() {
  const group = new THREE.Group();
  const linePositions = [];
  const labels = [];
  const tmp = [0, 0, 0];

  for (const con of CONSTELLATIONS) {
    const dirs = con.stars.map(([ra, dec]) => {
      raDecToDir(ra, dec, tmp);
      return [tmp[0], tmp[1], tmp[2]];
    });
    for (const [i, j] of con.lines) greatCirclePoints(dirs[i], dirs[j], linePositions);

    // 名称标注放在成员星方向质心处
    const centroid = new THREE.Vector3();
    for (const d of dirs) centroid.add(new THREE.Vector3(...d));
    centroid.normalize();
    const sprite = makeTextSprite(`${con.name} ${con.latin}`, { worldH: 6.5 });
    sprite.position.copy(centroid).multiplyScalar(R + 6);
    group.add(sprite);
    labels.push({ sprite, dir: centroid.clone() });
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(linePositions), 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uProjection: sharedUniforms.uProjection,
      uColor: { value: new THREE.Color(0x5f9dff) },
      uOpacity: { value: 0.6 },
    },
    vertexShader: LINE_VERT,
    fragmentShader: LINE_FRAG,
    transparent: true,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  group.add(lines);

  return { group, labels };
}
