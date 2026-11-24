import { ProjectStore } from './core/ProjectStore';
import { snapToCrown } from './core/crown';
import type { OrnamentKind } from './core/types';

/** 初始演示构图:沿冠面铺翠片、珠串与金錾片 */
export function seedDemoForTest(store: ProjectStore): void {
  const w = store.canvas.width;
  const h = store.canvas.height;

  const kingfisherAssets = ['kingfisher-blue', 'kingfisher-teal'];
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const x = w * (0.16 + t * 0.68);
    const y = h * (0.5 + (i % 2 === 0 ? 0.06 : -0.04));
    const snapped = snapToCrown(store.crown, x, y, 0);
    store.addOrnament('kingfisher', kingfisherAssets[i % 2], 'kingfisher', snapped.x, snapped.y);
    const o = store.ornaments[store.ornaments.length - 1];
    store.updateOrnament(o.id, { rotation: snapped.rotation, scale: 0.62, depth: 0.3 + (i % 3) * 0.1 });
  }

  for (let i = 0; i < 18; i++) {
    const t = i / 17;
    const x = w * (0.14 + t * 0.72);
    const y = h * 0.34 + Math.sin(t * Math.PI) * -h * 0.08;
    const snapped = snapToCrown(store.crown, x, y, 0);
    store.addOrnament('pearl', 'pearl-round', 'pearl', snapped.x, snapped.y);
    const o = store.ornaments[store.ornaments.length - 1];
    store.updateOrnament(o.id, { scale: 0.34, depth: 0.5 });
  }

  const spots = [
    { x: 0.5, y: 0.2, asset: 'champleve-gold', scale: 0.85, depth: 0.9 },
    { x: 0.22, y: 0.62, asset: 'champleve-silver', scale: 0.6, depth: 0.8 },
    { x: 0.78, y: 0.62, asset: 'champleve-gold', scale: 0.6, depth: 0.85 },
  ];
  for (const s of spots) {
    store.addOrnament('champleve', s.asset, 'metal', w * s.x, h * s.y);
    const o = store.ornaments[store.ornaments.length - 1];
    store.updateOrnament(o.id, { scale: s.scale, depth: s.depth });
  }
}

/**
 * 压力填充:把三层图元总数补到 5000(性能验收基线)。
 * 确定性伪随机(不用 Math.random),保证每次布局一致、可复现。
 */
export function fillTo5000(store: ProjectStore): void {
  let seed = 0x9e3779b9;
  const rand = (): number => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) % 10000) / 10000;
  };
  const plan: { kind: OrnamentKind; asset: string; layer: 'kingfisher' | 'pearl' | 'metal'; count: number }[] = [
    { kind: 'kingfisher', asset: 'kingfisher-blue', layer: 'kingfisher', count: 2600 },
    { kind: 'pearl', asset: 'pearl-round', layer: 'pearl', count: 1800 },
    { kind: 'champleve', asset: 'champleve-gold', layer: 'metal', count: 600 },
  ];
  const w = store.canvas.width;
  const h = store.canvas.height;
  for (const p of plan) {
    for (let i = 0; i < p.count; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const scale = 0.18 + rand() * 0.4;
      const rotation = rand() * Math.PI * 2;
      const depth = rand();
      store.addOrnament(p.kind, p.asset, p.layer, x, y);
      const o = store.ornaments[store.ornaments.length - 1];
      Object.assign(o, { scale, rotation, depth });
    }
  }
  store.emitter.emit('project:load', store.toJSON());
}
