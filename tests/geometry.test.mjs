/**
 * Geometry + model tests. Runs in plain Node (no browser, no DOM).
 *
 *   node tests/geometry.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module from 'manifold-3d';

import {
  TYPE_LIST,
  TYPES,
  buildLocalManifold,
  buildWorldManifold,
  buildGroupManifold,
  normalizeParams,
} from '../src/geometry/solids.js';
import { manifoldToRenderMesh, mergeRenderMeshes } from '../src/geometry/mesh.js';
import {
  createDoc,
  addElement,
  updateElement,
  deleteElements,
  duplicateElement,
  mergeElements,
  addMembersToGroup,
  subtractElements,
  removeCutter,
  ungroup,
  translateGroup,
  groupOfElement,
  looseElements,
  findOverlapClusters,
  normalizeDoc,
  serializeDoc,
  createDemoDoc,
  docStats,
  elementById,
  groupById,
} from '../src/model/doc.js';
import { snapScalar, snapVec, edgeSnapAxis } from '../src/model/snap.js';

const bin = readFileSync(new URL('../node_modules/manifold-3d/manifold.wasm', import.meta.url));
const wasm = await Module({ wasmBinary: bin });
wasm.setup();

const approx = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

/* ---------------------------------------------------------------- */
/* Element catalog                                                   */
/* ---------------------------------------------------------------- */

test('every catalog entry builds a valid closed manifold', () => {
  for (const def of TYPE_LIST) {
    const m = buildLocalManifold(wasm, def.key, {});
    try {
      assert.equal(m.status(), 'NoError', `${def.key} status`);
      assert.equal(m.isEmpty(), false, `${def.key} not empty`);
      assert.ok(m.volume() > 0, `${def.key} positive volume`);
      // A genus-0 solid: V - E + F = 2 for a closed surface.
      const V = m.numVert();
      const E = m.numEdge();
      const F = m.numTri();
      assert.equal(V - E + F, 2, `${def.key} Euler characteristic (${V}-${E}+${F})`);
      const bb = m.boundingBox();
      // Grounded: sits on y = 0 and has a footprint centred on the origin.
      approx(bb.min[1], 0, 1e-3);
      assert.ok(Math.abs(bb.min[0] + bb.max[0]) < 1e-3, `${def.key} centred on X`);
      assert.ok(Math.abs(bb.min[2] + bb.max[2]) < 1e-3, `${def.key} centred on Z`);
    } finally {
      m.delete();
    }
  }
});

test('catalog metadata is complete', () => {
  for (const def of TYPE_LIST) {
    assert.ok(def.name && def.en && def.icon, `${def.key} labels`);
    assert.ok(['ramp', 'street', 'rail'].includes(def.category), `${def.key} category`);
    assert.ok(def.params.length >= 1, `${def.key} params`);
    for (const p of def.params) {
      assert.ok(p.key && p.label, `${def.key}.${p.key} label`);
      assert.ok(p.min < p.max, `${def.key}.${p.key} range`);
      assert.ok(p.default >= p.min && p.default <= p.max, `${def.key}.${p.key} default in range`);
    }
  }
});

test('params are clamped and rounded to the catalog range', () => {
  const p = normalizeParams('stairs', { width: 999, steps: 3.7, rise: -4, tread: 0.4 });
  assert.equal(p.width, TYPES.stairs.params[0].max);
  assert.equal(p.steps, 4); // rounded to integer
  assert.equal(p.rise, TYPES.stairs.params[2].min);
  assert.equal(p.tread, 0.4);
});

test('geometry responds to parameter changes', () => {
  const low = buildLocalManifold(wasm, 'bank', { width: 2, length: 3, height: 0.5 });
  const high = buildLocalManifold(wasm, 'bank', { width: 2, length: 3, height: 1.5 });
  try {
    approx(high.volume() / low.volume(), 3, 1e-3);
    assert.notEqual(low.numTri(), Infinity);
  } finally {
    low.delete();
    high.delete();
  }
});

/* ---------------------------------------------------------------- */
/* Booleans                                                          */
/* ---------------------------------------------------------------- */

test('union of overlapping boxes is a manifold with merged volume', () => {
  const a = buildWorldManifold(wasm, { type: 'box', params: { width: 1, length: 1, height: 1 }, position: [0, 0, 0], rotationY: 0 });
  const b = buildWorldManifold(wasm, { type: 'box', params: { width: 1, length: 1, height: 1 }, position: [0.5, 0, 0], rotationY: 0 });
  const world = new Map([
    ['a', a],
    ['b', b],
  ]);
  const group = { members: ['a', 'b'], cutters: [] };
  const { manifold, idMap } = buildGroupManifold(wasm, group, world);
  try {
    assert.equal(manifold.status(), 'NoError');
    approx(manifold.volume(), 1.5, 1e-6);
    assert.equal(manifold.genus(), 0);
    assert.equal(idMap.size, 2);
  } finally {
    manifold.delete();
    a.delete();
    b.delete();
  }
});

test('difference subtracts material and keeps manifoldness', () => {
  const base = buildWorldManifold(wasm, { type: 'box', params: { width: 2, length: 2, height: 1 }, position: [0, 0, 0], rotationY: 0 });
  const cut = buildWorldManifold(wasm, { type: 'box', params: { width: 1, length: 1, height: 3 }, position: [0, -0.5, 0], rotationY: 0 });
  const world = new Map([
    ['base', base],
    ['cut', cut],
  ]);
  const { manifold } = buildGroupManifold(wasm, { members: ['base'], cutters: ['cut'] }, world);
  try {
    assert.equal(manifold.status(), 'NoError');
    approx(manifold.volume(), 4 - 1, 1e-6);
    // A through-hole: genus 1, Euler char 0.
    assert.equal(manifold.genus(), 1);
    assert.equal(manifold.numVert() - manifold.numEdge() + manifold.numTri(), 0);
  } finally {
    manifold.delete();
    base.delete();
    cut.delete();
  }
});

test('repeated rebuilds are deterministic (no drift past 20 merges)', () => {
  const doc = createDoc({ name: 'drift' });
  let d = doc;
  const ids = [];
  for (let i = 0; i < 26; i++) {
    const r = addElement(d, 'box', {
      params: { width: 0.9, length: 0.9, height: 0.4 + (i % 5) * 0.1 },
      position: [i * 0.7, 0, (i % 3) * 0.15],
    });
    d = r.doc;
    ids.push(r.element.id);
  }
  let built = mergeElements(d, [ids[0], ids[1]]);
  d = built.doc;
  const groupId = built.group.id;
  for (let i = 2; i < 26; i++) {
    d = addMembersToGroup(d, groupId, [ids[i]]).doc;
  }

  const worldFor = (docIn) => {
    const world = new Map();
    for (const el of docIn.elements) world.set(el.id, buildWorldManifold(wasm, el));
    return world;
  };

  const measure = (docIn) => {
    const world = worldFor(docIn);
    const { manifold } = buildGroupManifold(wasm, docIn.groups[0], world);
    const result = {
      status: manifold.status(),
      volume: manifold.volume(),
      tris: manifold.numTri(),
      genus: manifold.genus(),
      mesh: manifold.getMesh().vertProperties.slice(),
    };
    manifold.delete();
    for (const m of world.values()) m.delete();
    return result;
  };

  const a = measure(d);
  const b = measure(d);
  assert.equal(a.status, 'NoError');
  assert.equal(d.mergeOps, 25);
  assert.equal(a.volume, b.volume, 'volume is bit-identical across rebuilds');
  assert.equal(a.tris, b.tris, 'triangle count stable');
  assert.equal(a.genus, 0);
  assert.deepEqual(Array.from(a.mesh), Array.from(b.mesh), 'vertex data is bit-identical');

  // Editing a member keeps the group valid and changes the volume.
  const edited = updateElement(d, ids[12], { params: { height: 1.4 } }).doc;
  const c = measure(edited);
  assert.equal(c.status, 'NoError');
  assert.notEqual(c.volume, a.volume);
});

test('deleting all members removes the group', () => {
  let d = createDoc();
  const a = addElement(d, 'box', {});
  d = a.doc;
  const b = addElement(d, 'box', { position: [0.4, 0, 0] });
  d = b.doc;
  const merged = mergeElements(d, [a.element.id, b.element.id]);
  d = merged.doc;
  assert.equal(d.groups.length, 1);
  d = deleteElements(d, [a.element.id, b.element.id]);
  assert.equal(d.groups.length, 0);
  assert.equal(d.elements.length, 0);
});

/* ---------------------------------------------------------------- */
/* Mesh extraction                                                   */
/* ---------------------------------------------------------------- */

test('render mesh carries normals, groups and crease edges', () => {
  const m = buildLocalManifold(wasm, 'quarter', { width: 4, radius: 2, extension: 0.3, deck: 0.2 });
  const idMap = new Map([[m.originalID(), 'q1']]);
  const rm = manifoldToRenderMesh(m, idMap);
  try {
    assert.equal(rm.positions.length, rm.vertexCount * 3);
    assert.equal(rm.normals.length, rm.vertexCount * 3);
    assert.equal(rm.indices.length, rm.triangleCount * 3);
    assert.ok(rm.triangleCount > 40);
    assert.ok(rm.edges.length > 0, 'has crease/outline edges');
    assert.equal(rm.edges.length % 6, 0);
    assert.deepEqual(
      rm.groups.map((g) => g.id),
      ['q1'],
    );
    // Normals are unit length.
    for (let i = 0; i < rm.normals.length; i += 3) {
      const len = Math.hypot(rm.normals[i], rm.normals[i + 1], rm.normals[i + 2]);
      assert.ok(Math.abs(len - 1) < 1e-3, `normal ${i / 3} length ${len}`);
    }
    // Every index is in range.
    for (const idx of rm.indices) assert.ok(idx < rm.vertexCount);
    // All vertex colours are assigned by the caller; here colors are absent.
  } finally {
    m.delete();
  }
});

test('sharp angle controls split normals', () => {
  const m = buildLocalManifold(wasm, 'stairs', { width: 2, steps: 3, rise: 0.2, tread: 0.3 });
  const soft = manifoldToRenderMesh(m, new Map([[m.originalID(), 's']]), { sharpAngle: 80 });
  const hard = manifoldToRenderMesh(m, new Map([[m.originalID(), 's']]), { sharpAngle: 1 });
  try {
    assert.ok(hard.vertexCount >= soft.vertexCount, 'sharper creases duplicate more vertices');
    assert.ok(hard.edges.length >= soft.edges.length);
  } finally {
    m.delete();
  }
});

test('merging render meshes offsets indices and groups', () => {
  const a = buildWorldManifold(wasm, { type: 'ledge', params: { width: 2, length: 2, height: 0.4 }, position: [0, 0, 0] });
  const b = buildWorldManifold(wasm, { type: 'box', params: { width: 1, length: 1, height: 1 }, position: [3, 0, 0] });
  const ra = manifoldToRenderMesh(a, new Map([[a.originalID(), 'a']]));
  const rb = manifoldToRenderMesh(b, new Map([[b.originalID(), 'b']]));
  const merged = mergeRenderMeshes([ra, rb]);
  try {
    assert.equal(merged.vertexCount, ra.vertexCount + rb.vertexCount);
    assert.equal(merged.triangleCount, ra.triangleCount + rb.triangleCount);
    const maxIdx = Math.max(...merged.indices);
    assert.ok(maxIdx < merged.vertexCount);
    assert.deepEqual(
      merged.groups.map((g) => g.id),
      ['a', 'b'],
    );
  } finally {
    a.delete();
    b.delete();
  }
});

/* ---------------------------------------------------------------- */
/* Snapping + overlap detection                                      */
/* ---------------------------------------------------------------- */

test('snap rounds to the configured step', () => {
  approx(snapScalar(1.234, 0.1), 1.2, 1e-9);
  approx(snapScalar(1.26, 0.1), 1.3, 1e-9);
  approx(snapScalar(-0.04, 0.1), -0, 1e-9);
  approx(snapScalar(3.0, 0.25), 3.0, 1e-9);
  const v = snapVec([1.24, -2, 0.04], 0.1);
  approx(v[0], 1.2, 1e-9);
  approx(v[1], 0, 1e-9);
  approx(v[2], 0, 1e-9);
  // Snapping disabled keeps the raw value.
  approx(snapScalar(1.234, 0), 1.234, 1e-9);
});

test('edge snapping aligns faces of neighbouring elements', () => {
  // Moving box of width 2 wants its right face on the other box's left face.
  const moving = { min: [-1, 0, -1], max: [1, 1, 1] };
  const other = { min: [3, 0, 0], max: [5, 1, 4] };
  const res = edgeSnapAxis({
    axis: 'x',
    center: 2.05,
    size: 2,
    others: [other],
    tolerance: 0.09,
  });
  approx(res, 2, 1e-9, 'left face of other (3) - half size (1) = 2');
});

test('overlap clusters detect stacked/intersecting elements', () => {
  const doc = createDemoDoc();
  const bounds = {};
  // Hand-made AABBs: demo-funbox overlaps a fake element, others are apart.
  for (const el of doc.elements) bounds[el.id] = { min: [0, 0, 0], max: [0.1, 0.1, 0.1] };
  bounds['demo-bank'] = { min: [-1, 0, -1], max: [1, 1, 1] };
  bounds['demo-ledge'] = { min: [0.5, 0, 0.5], max: [2, 1, 2] };
  const clusters = findOverlapClusters(doc, bounds);
  const c = clusters.find((cl) => cl.ids.includes('demo-bank') && cl.ids.includes('demo-ledge'));
  assert.ok(c, 'funbox/ledge cluster found');
});

test('group bounds participate in overlap detection', () => {
  const doc = createDemoDoc();
  const bounds = {};
  for (const el of doc.elements) bounds[el.id] = { min: [100, 0, 100], max: [100.1, 0.1, 100.1] };
  bounds['demo-ledge'] = { min: [0, 0, 0], max: [1, 1, 1] };
  const groupBounds = { 'demo-group-1': { min: [0.5, 0, 0.5], max: [2, 2, 2] } };
  const clusters = findOverlapClusters(doc, bounds, { groupBounds });
  const hit = clusters.find((c) => c.ids.includes('demo-ledeed') || c.ids.includes('demo-ledge'));
  assert.ok(hit, 'ledge overlaps the merged group');
  assert.equal(hit.targetGroupId, 'demo-group-1');
});

/* ---------------------------------------------------------------- */
/* Document model                                                    */
/* ---------------------------------------------------------------- */

test('addElement places a normalized element and records no merge', () => {
  const { doc, element } = addElement(createDoc(), 'bank', { position: [1.234, 0.5, -2], rotationY: 190 });
  assert.equal(doc.elements.length, 1);
  assert.equal(doc.mergeOps, 0);
  assert.deepEqual(element.position, [1.234, 0.5, -2]);
  assert.equal(element.rotationY, -170); // normalized to (-180, 180]
  assert.ok(element.id.startsWith('e'));
});

test('merge, addMembers and subtract update mergeOps and wiring', () => {
  let d = createDoc();
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const r = addElement(d, 'box', { position: [i * 0.5, 0, 0] });
    d = r.doc;
    ids.push(r.element.id);
  }
  const m = mergeElements(d, [ids[0], ids[1]]);
  d = m.doc;
  assert.equal(d.mergeOps, 1);
  assert.equal(groupOfElement(d, ids[0]).id, m.group.id);

  d = addMembersToGroup(d, m.group.id, [ids[2]]).doc;
  assert.equal(d.mergeOps, 2);
  assert.equal(groupById(d, m.group.id).members.length, 3);

  // looseElements only returns ungrouped ones.
  assert.equal(looseElements(d).length, 0);

  // ungroup frees them again.
  d = ungroup(d, m.group.id);
  assert.equal(d.groups.length, 0);
  assert.equal(looseElements(d).length, 3);
});

test('merging an already-grouped element is rejected', () => {
  let d = createDoc();
  const a = addElement(d, 'box', { position: [0, 0, 0] });
  d = a.doc;
  const b = addElement(d, 'box', { position: [0.4, 0, 0] });
  d = b.doc;
  const c = addElement(d, 'box', { position: [1.2, 0, 0] });
  d = c.doc;
  d = mergeElements(d, [a.element.id, b.element.id]).doc;
  assert.throws(() => mergeElements(d, [a.element.id, c.element.id]), /已在合并组/);
});

test('subtract by group id adds cutters to that group', () => {
  let d = createDoc();
  const a = addElement(d, 'box', { position: [0, 0, 0] });
  d = a.doc;
  const b = addElement(d, 'box', { position: [0.4, 0, 0] });
  d = b.doc;
  const cut = addElement(d, 'box', { position: [1.5, 0, 0] });
  d = cut.doc;
  const g = mergeElements(d, [a.element.id, b.element.id]);
  d = g.doc;
  const s = subtractElements(d, g.group.id, [cut.element.id]);
  d = s.doc;
  assert.deepEqual(d.groups[0].cutters, [cut.element.id]);
  assert.equal(d.mergeOps, 2);
  // Removing the cutter restores the group.
  d = removeCutter(d, g.group.id, cut.element.id);
  assert.deepEqual(d.groups[0].cutters, []);
});

test('duplicate offsets and keeps params', () => {
  const { doc, element } = addElement(createDoc(), 'rail', { position: [1, 0, 2] });
  const dup = duplicateElement(doc, element.id, [0.5, 0, -0.5]);
  assert.equal(dup.doc.elements.length, 2);
  assert.notEqual(dup.element.id, element.id);
  assert.deepEqual(dup.element.position, [1.5, 0, 1.5]);
  assert.deepEqual(dup.element.params, element.params);
});

test('translateGroup moves every member and clamps to ground', () => {
  let d = createDoc();
  const a = addElement(d, 'box', { position: [0, 0.5, 0] });
  d = a.doc;
  const b = addElement(d, 'box', { position: [0.5, 0, 0] });
  d = b.doc;
  const g = mergeElements(d, [a.element.id, b.element.id]);
  d = g.doc;
  d = translateGroup(d, g.group.id, [1, -2, 3]);
  approx(elementById(d, a.element.id).position[0], 1);
  approx(elementById(d, a.element.id).position[1], 0, 1e-9);
  approx(elementById(d, a.element.id).position[2], 3);
});

/* ---------------------------------------------------------------- */
/* Serialization                                                     */
/* ---------------------------------------------------------------- */

test('project round-trips through JSON without loss', () => {
  const doc = createDemoDoc();
  const json = JSON.parse(serializeDoc(doc));
  const back = normalizeDoc(json);
  assert.equal(back.elements.length, doc.elements.length);
  assert.equal(back.groups.length, doc.groups.length);
  const key = (e) => `${e.type}|${JSON.stringify(e.params)}|${e.position.join(',')}|${e.rotationY}`;
  assert.deepEqual(back.elements.map(key).sort(), doc.elements.map(key).sort());
  assert.deepEqual(
    back.groups.map((g) => [g.members.join(','), g.cutters.join(',')]).sort(),
    doc.groups.map((g) => [g.members.join(','), g.cutters.join(',')]).sort(),
  );
  assert.equal(back.name, doc.name);
});

test('normalizeDoc rejects junk and repairs dangling references', () => {
  assert.throws(() => normalizeDoc(null), /有效的 JSON/);
  assert.throws(() => normalizeDoc({ elements: [] }), /没有可用的场地元素/);
  assert.throws(() => normalizeDoc({ schema: 'other', elements: [] }), /类型不匹配/);

  const repaired = normalizeDoc({
    name: '坏的',
    elements: [
      { id: 'a', type: 'box', params: { width: 1 } },
      { id: 'a', type: 'ledge' }, // duplicate id
      { id: 'b', type: 'nope' }, // unknown type
      { type: 'rail', rotationY: 725 }, // no id
    ],
    groups: [
      { id: 'g1', members: ['a', 'b', 'missing'], cutters: ['ghost'] },
      { id: 'g2', members: ['missing'] },
    ],
  });
  assert.equal(repaired.elements.length, 3);
  assert.equal(new Set(repaired.elements.map((e) => e.id)).size, 3);
  assert.equal(repaired.groups.length, 1);
  assert.deepEqual(repaired.groups[0].cutters, []);
  // Every group member exists.
  for (const g of repaired.groups) {
    for (const id of [...g.members, ...g.cutters]) {
      assert.ok(repaired.elements.some((e) => e.id === id));
    }
  }
});

test('docStats counts loose elements and groups', () => {
  const doc = createDemoDoc();
  const stats = docStats(doc);
  assert.equal(stats.elements, doc.elements.length);
  assert.equal(stats.groups, 1);
  assert.equal(stats.members, 2);
  assert.equal(stats.loose, doc.elements.length - 2);
});

/* ---------------------------------------------------------------- */
/* Full park rebuild                                                 */
/* ---------------------------------------------------------------- */

test('the demo park builds end to end with correct group metadata', () => {
  const doc = createDemoDoc();
  const world = new Map();
  for (const el of doc.elements) world.set(el.id, buildWorldManifold(wasm, el));

  const chunks = [];
  for (const el of doc.elements) {
    if (groupOfElement(doc, el.id)) continue;
    const m = world.get(el.id);
    chunks.push(manifoldToRenderMesh(m, new Map([[m.originalID(), el.id]])));
  }
  for (const g of doc.groups) {
    const { manifold, idMap } = buildGroupManifold(wasm, g, world);
    assert.equal(manifold.status(), 'NoError');
    assert.ok(manifold.volume() > 0);
    chunks.push(manifoldToRenderMesh(manifold, idMap));
    manifold.delete();
  }
  const merged = mergeRenderMeshes(chunks);
  assert.ok(merged.triangleCount > 200);
  assert.ok(merged.edges.length > 0);
  for (const m of world.values()) m.delete();
});

test('all three categories have at least one type', () => {
  for (const cat of ['ramp', 'street', 'rail']) {
    assert.ok(TYPE_LIST.some((t) => t.category === cat), `${cat} has types`);
  }
});
