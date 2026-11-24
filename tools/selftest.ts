/**
 * 纯逻辑自测(Node 环境,不触碰 WebGL/WebGPU):
 *  - 冠面吸附投影
 *  - 增量脏标记(单层参数只标该层及以上;层序全链)
 *  - 配置序列化 -> 回读 -> 层序/不透明度一致
 *  - 5000 图元批几何构建正确性
 * 运行: node --experimental-strip-types tools/selftest.ts
 */
import { ProjectStore } from '../src/core/ProjectStore';
import { projectToCrown, snapToCrown } from '../src/core/crown';
import { BatchGeometryBuilder } from '../src/render/BatchGeometryBuilder';
import type { Ornament } from '../src/core/types';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ ${msg}`);
  }
}
function approx(a: number, b: number, eps = 1e-4): boolean {
  return Math.abs(a - b) <= eps;
}

console.log('1) 冠面吸附几何');
{
  const store = new ProjectStore(1000, 800);
  const c = store.crown;
  // 中点(t=0.5)应落在二次贝塞尔中点
  const mid = projectToCrown(c, c.p1.x, c.p1.y);
  const expectedX = 0.25 * c.p0.x + 0.5 * c.p1.x + 0.25 * c.p2.x;
  const expectedY = 0.25 * c.p0.y + 0.5 * c.p1.y + 0.25 * c.p2.y;
  assert(approx(mid.point.x, expectedX, 1) && approx(mid.point.y, expectedY, 1), '贝塞尔中点投影正确');
  const snapped = snapToCrown(c, 100, 100, 0);
  assert(snapped.t >= 0 && snapped.t <= 1, '吸附参数 t 在 [0,1]');
  assert(c.snapStrength === 0.6, '默认吸附强度 0.6');
}

console.log('2) 增量脏标记语义');
{
  const store = new ProjectStore();
  assert(store.consumeDirty() === 0, '初始为全链 dirty(0)');
  assert(store.consumeDirty() === null, '消费后干净');
  store.setLayerOpacity('metal', 0.4);
  assert(store.consumeDirty() === 2, '改顶层只从 index 2 起重合成');
  assert(store.consumeDirty() === null, '再次消费为 null');
  store.setLayerBlend('kingfisher', 'add');
  assert(store.consumeDirty() === 0, '改底层从 index 0 起(含全部上层)');
  store.setLayerOpacity('pearl', 0.7);
  assert(store.consumeDirty() === 1, '改中层从 index 1 起');
  store.reorder(0, 2);
  assert(store.consumeDirty() === 0, '拖动层序触发全链重算');
}

console.log('3) 层序拖动即时生效');
{
  const store = new ProjectStore();
  const before = store.layers.map((l) => l.id);
  store.reorder(2, 0);
  const after = store.layers.map((l) => l.id);
  assert(after[0] === before[2] && after[1] === before[0] && after[2] === before[1], '数组层序已交换');
}

console.log('4) 序列化与回读一致性');
{
  const store = new ProjectStore(1600, 1000);
  store.setLayerOpacity('kingfisher', 0.33);
  store.setLayerBlend('pearl', 'screen');
  store.reorder(0, 1);
  for (let i = 0; i < 25; i++) {
    const o = store.addOrnament('pearl', 'pearl-round', 'pearl', 100 + i * 20, 300);
    store.updateOrnament(o.id, { scale: 0.5, rotation: i * 0.1, depth: i / 25 });
  }
  const json = store.toJSON();
  const text = JSON.stringify(json);

  const store2 = new ProjectStore();
  const loaded = store2.loadJSON(JSON.parse(text));
  assert(loaded.layers.length === 3, '回读三层');
  assert(
    loaded.layers.every((l, i) => l.id === json.layers[i].id && approx(l.opacity, json.layers[i].opacity) && l.blendMode === json.layers[i].blendMode),
    '回读后层序与不透明度、混合模式一致',
  );
  assert(loaded.ornaments.length === 25, '回读 25 个图元');
  const o0 = loaded.ornaments[0];
  const j0 = json.ornaments[0];
  assert(
    o0.id === j0.id && approx(o0.x, j0.x) && approx(o0.scale, j0.scale) && approx(o0.rotation, j0.rotation) && approx(o0.depth, j0.depth),
    '图元属性逐项一致',
  );

  // 损坏配置必须抛错
  let threw = false;
  try {
    store2.loadJSON({ version: 99 });
  } catch {
    threw = true;
  }
  assert(threw, '非法版本号回读抛错');
  threw = false;
  try {
    const bad = JSON.parse(text);
    (bad.layers[0] as { opacity: number }).opacity = 2;
    store2.loadJSON(bad);
  } catch {
    threw = true;
  }
  assert(threw, '越界不透明度回读抛错');
}

console.log('5) 5000 图元批几何');
{
  const store = new ProjectStore();
  const kinds: [Ornament['kind'], string, Ornament['layer']][] = [
    ['kingfisher', 'kingfisher-blue', 'kingfisher'],
    ['pearl', 'pearl-round', 'pearl'],
    ['champleve', 'champleve-gold', 'metal'],
  ];
  const total = 5000;
  let n = 0;
  for (let i = 0; i < total; i++) {
    const [kind, asset, layer] = kinds[i % 3];
    store.addOrnament(kind, asset, layer, Math.random() * 1600, Math.random() * 1000);
    n++;
  }
  assert(store.ornaments.length === 5000, '灌入 5000 图元');
  const builder = new BatchGeometryBuilder();
  let verts = 0;
  let tris = 0;
  const t0 = performance.now();
  for (const layerId of ['kingfisher', 'pearl', 'metal'] as const) {
    const list = store.ornamentsOf(layerId);
    const byAsset = new Map<string, Ornament[]>();
    for (const o of list) {
      const arr = byAsset.get(o.assetId) ?? [];
      arr.push(o);
      byAsset.set(o.assetId, arr);
    }
    for (const group of byAsset.values()) {
      const built = builder.build(group, 150);
      verts += built.vertices.length;
      tris += built.ranges.length;
    }
  }
  const ms = performance.now() - t0;
  assert(tris === 5000, `5000 图元全部生成面片(实际 ${tris})`);
  assert(verts === 5000 * 4 * 5, `顶点缓冲元素数 = 5000×4×5(实际 ${verts})`);
  console.log(`     构建耗时 ${ms.toFixed(1)} ms`);
  assert(ms < 500, '5000 图元几何构建在 500ms 内');
}

console.log('6) 深度排序写入顺序(层内压盖)');
{
  const store = new ProjectStore();
  const a = store.addOrnament('pearl', 'pearl-round', 'pearl', 0, 0);
  const b = store.addOrnament('pearl', 'pearl-round', 'pearl', 0, 0);
  const c = store.addOrnament('pearl', 'pearl-round', 'pearl', 0, 0);
  store.updateOrnament(a.id, { depth: 0.9 });
  store.updateOrnament(b.id, { depth: 0.1 });
  store.updateOrnament(c.id, { depth: 0.5 });
  const built = new BatchGeometryBuilder().build(store.ornamentsOf('pearl'), 150);
  assert(
    built.ornaments[0].id === b.id && built.ornaments[1].id === c.id && built.ornaments[2].id === a.id,
    '同层按 depth 升序写入,大者后画压盖',
  );
  assert(built.vertices.length === 3 * 4 * 5 && built.indices.length === 3 * 6, '顶点/索引数量正确');
}

console.log(failures === 0 ? '\n全部自测通过 ✔' : `\n${failures} 项失败 ✘`);
if (failures > 0) process.exit(1);
