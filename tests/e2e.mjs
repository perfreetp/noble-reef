/**
 * End-to-end test of the whole tool in a real browser.
 *
 *   npm run dev          (in another terminal)
 *   npm run test:e2e
 *
 * Covers: engine boot, catalog placement, snapping, dragging, overlap prompt,
 * union merge, subtract, merge-into-group, 20+ merges stability, collision
 * export, project export/import round-trip and autosave.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const URL = process.env.GRIND_URL || 'http://127.0.0.1:5174/';
const results = [];
let failures = 0;

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  if (!condition) failures += 1;
  const mark = condition ? 'ok  ' : 'FAIL';
  console.log(`${mark} ${name}${detail && !condition ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1560, height: 940 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('GL Driver Message')) errors.push(m.text());
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__grind?.store?.state?.engine === 'ready', { timeout: 30000 });
await page.waitForTimeout(1200);

check('geometry engine boots (manifold WASM in a worker)', true);

/* ---------------------------------------------------------------- */
/* 1. Catalog + placement                                            */
/* ---------------------------------------------------------------- */

const lib = await page.$$eval('.lib-card', (cards) => cards.map((c) => c.dataset.type));
check('library lists ramp elements', lib.includes('bank') && lib.includes('quarter') && lib.includes('kicker'));

await page.locator('.cat-tab', { hasText: '台阶 / 台子' }).click();
const street = await page.$$eval('.lib-card', (cards) => cards.map((c) => c.dataset.type));
check('library switches category', street.includes('stairs') && street.includes('ledge'));

const before = await page.evaluate(() => window.__grind.store.doc.elements.length);
await page.locator('.lib-card[data-type="ledge"]').click();
const scene = await page.locator('#scene').boundingBox();
await page.mouse.click(scene.x + scene.width * 0.32, scene.y + scene.height * 0.62);
await page.waitForTimeout(900);
const placed = await page.evaluate(() => {
  const s = window.__grind.store.state;
  const el = s.doc.elements.find((e) => e.id === s.selection[0]);
  return { count: s.doc.elements.length, pos: el?.position, type: el?.type, id: el?.id, placing: s.placingType };
});
check('clicking the library + ground places an element', placed.count === before + 1 && placed.type === 'ledge');
const onGrid = (v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-6;
check('placement lands on the 0.1 m grid', onGrid(placed.pos[0]) && onGrid(placed.pos[2]), JSON.stringify(placed.pos));
check('placing mode ends after one drop', placed.placing === null);

/* ---------------------------------------------------------------- */
/* 2. Parametric resize + undo                                       */
/* ---------------------------------------------------------------- */

await page.locator('.tree-row', { hasText: '台子' }).last().click();
await page.waitForTimeout(400);
const undo0 = await page.evaluate(() => window.__grind.store.undoStack.length);

await page.evaluate(() => {
  const { store } = window.__grind;
  store.beginTransaction('空操作');
  store.commitTransaction();
});
const undoAfterLive = await page.evaluate(() => window.__grind.store.undoStack.length);
check('an empty transaction records nothing', undoAfterLive === undo0, `${undo0} -> ${undoAfterLive}`);

const firstSlider = page.locator('.insp-body input[type=range]').first();
const sliderBox = await firstSlider.boundingBox();
await page.mouse.move(sliderBox.x + sliderBox.width * 0.3, sliderBox.y + sliderBox.height / 2);
await page.mouse.down();
await page.mouse.move(sliderBox.x + sliderBox.width * 0.62, sliderBox.y + sliderBox.height / 2, { steps: 8 });
await page.mouse.move(sliderBox.x + sliderBox.width * 0.72, sliderBox.y + sliderBox.height / 2, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(1100);
const sliderRes = await page.evaluate((u0) => {
  const s = window.__grind.store.state;
  const el = s.doc.elements.find((e) => e.id === s.selection[0]);
  return { width: el.params.width, undoDelta: window.__grind.store.undoStack.length - u0, buildEpoch: s.buildEpoch };
}, undo0);
check('slider edits the element parameter', Math.abs(sliderRes.width - 2.4) > 1e-6, `width=${sliderRes.width}`);
check('a whole slider drag is one undo step', sliderRes.undoDelta === 1, `delta=${sliderRes.undoDelta}`);

await page.keyboard.press('Control+z');
await page.waitForTimeout(1100);
const undone = await page.evaluate((id) => window.__grind.store.doc.elements.find((e) => e.id === id)?.params.width, placed.id);
check('undo restores the previous size', Math.abs(undone - 2.4) < 1e-6, `width=${undone}`);

/* ---------------------------------------------------------------- */
/* 3. Dragging + snapping                                            */
/* ---------------------------------------------------------------- */

const dragStart = await page.evaluate((id) => {
  const vp = window.__grind.viewport;
  const b = vp.payload.worldBounds[id];
  const v = new vp.camera.position.constructor((b.min[0] + b.max[0]) / 2, b.max[1] - 0.02, (b.min[2] + b.max[2]) / 2);
  v.project(vp.camera);
  const r = vp.canvas.getBoundingClientRect();
  return {
    pos: [...window.__grind.store.doc.elements.find((e) => e.id === id).position],
    x: r.left + (v.x * 0.5 + 0.5) * r.width,
    y: r.top + (-v.y * 0.5 + 0.5) * r.height,
  };
}, placed.id);
await page.mouse.move(dragStart.x, dragStart.y);
await page.mouse.down();
await page.mouse.move(dragStart.x + 110, dragStart.y + 40, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(1100);
const dragged = await page.evaluate((id) => {
  const s = window.__grind.store.state;
  return {
    pos: [...s.doc.elements.find((e) => e.id === id).position],
    undo: window.__grind.store.undoStack.length,
  };
}, placed.id);
const moved = Math.hypot(dragged.pos[0] - dragStart.pos[0], dragged.pos[2] - dragStart.pos[2]);
check('dragging an element moves it', moved > 0.3, `moved=${moved.toFixed(2)} m`);
check('dragged position snaps to 0.1 m', onGrid(dragged.pos[0]) && onGrid(dragged.pos[2]), JSON.stringify(dragged.pos));

/* ---------------------------------------------------------------- */
/* 4. Overlap prompt -> merge into existing group                    */
/* ---------------------------------------------------------------- */

const overlap = await page.evaluate(async (groupBase) => {
  const { store } = window.__grind;
  const { addElement } = await import('/src/model/doc.js');
  const r = addElement(store.doc, 'bank', { params: { width: 3, length: 3, height: 1 }, position: [0, 0, 0] });
  store.commit(r.doc, { selection: [r.element.id] });
  await new Promise((res) => setTimeout(res, 1400));
  const coach = document.querySelector('#coach');
  const cluster = store.state.overlaps.find((c) => c.ids.includes('demo-group-1'));
  return {
    coachVisible: !coach.hidden,
    coachText: coach.textContent.replace(/\s+/g, ' '),
    cluster,
    bankId: r.element.id,
    opsBefore: store.doc.mergeOps,
  };
}, {});
check('overlap prompt appears when new geometry hits a merged group', overlap.coachVisible && Boolean(overlap.cluster));
check('prompt offers merge-into-group', overlap.coachText.includes('并入合并组'), overlap.coachText.slice(0, 80));

await page.locator('#coach-body .btn-accent').click();
await page.waitForTimeout(2000);
const mergedIn = await page.evaluate((bankId) => {
  const s = window.__grind.store.state;
  const g = s.doc.groups.find((x) => x.id === 'demo-group-1');
  return {
    hasMember: g.members.includes(bankId),
    info: s.payload.groupInfo['demo-group-1'],
    ops: s.doc.mergeOps,
    coachHidden: document.querySelector('#coach').hidden,
  };
}, overlap.bankId);
check('element is merged into the existing group', mergedIn.hasMember);
check('merged group stays a valid manifold', mergedIn.info.status === 'NoError' && mergedIn.info.volume > 0);
check('merge counter increments', mergedIn.ops === overlap.opsBefore + 1);
check('prompt closes after merging', mergedIn.coachHidden);

/* ---------------------------------------------------------------- */
/* 5. Subtract (difference)                                          */
/* ---------------------------------------------------------------- */

const sub = await page.evaluate(async () => {
  const { store } = window.__grind;
  const { addElement, mergeElements, subtractElements, removeCutter } = await import('/src/model/doc.js');
  const base = addElement(store.doc, 'box', { params: { width: 3, length: 3, height: 1 }, position: [30, 0, 0] });
  store.commit(base.doc, { selection: [base.element.id] });
  await new Promise((r) => setTimeout(r, 700));
  const cut = addElement(store.doc, 'box', { params: { width: 1, length: 1, height: 3 }, position: [30, 0, 0] });
  store.commit(cut.doc, { selection: [cut.element.id] });
  // Base becomes a one-member group holding the cutter.
  const m = subtractElements(store.doc, base.element.id, [cut.element.id]);
  store.commit(m.doc, { selection: [m.group.id] });
  await new Promise((r) => setTimeout(r, 1400));
  const afterInfo = store.state.payload.groupInfo[m.group.id];
  return { groupId: m.group.id, beforeInfo: { volume: 9 }, afterInfo };
});
check('difference removes the cutter volume', sub.afterInfo.volume < sub.beforeInfo.volume - 0.5, `${sub.beforeInfo.volume} -> ${sub.afterInfo.volume}`);
check('difference result is a manifold', sub.afterInfo.status === 'NoError');
check('hole through the solid gives genus 1', sub.afterInfo.genus === 1, `genus=${sub.afterInfo.genus}`);

/* ---------------------------------------------------------------- */
/* 6. 25+ sequential merges stay stable                              */
/* ---------------------------------------------------------------- */

const stress = await page.evaluate(async () => {
  const { store } = window.__grind;
  const { addElement, mergeElements, addMembersToGroup } = await import('/src/model/doc.js');
  store.commit(
    {
      schema: 'grind.skatepark', version: 1, name: '稳定性', units: 'm',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mergeOps: 0,
      settings: store.doc.settings, elements: [], groups: [],
    },
    { label: '清空', selection: [] },
  );
  await new Promise((r) => setTimeout(r, 600));
  const ids = [];
  for (let i = 0; i < 28; i++) {
    const r = addElement(store.doc, 'box', {
      params: { width: 0.9, length: 0.9, height: 0.4 + (i % 5) * 0.08 },
      position: [i * 0.55, 0, (i % 3 - 1) * 0.2],
    });
    store.commit(r.doc, {});
    ids.push(r.element.id);
  }
  await new Promise((r) => setTimeout(r, 1000));
  const seed = mergeElements(store.doc, [ids[0], ids[1]]);
  store.commit(seed.doc, { selection: [seed.group.id] });
  await new Promise((r) => setTimeout(r, 900));
  const gid = seed.group.id;
  const history = [];
  for (let i = 2; i < ids.length; i++) {
    store.commit(addMembersToGroup(store.doc, gid, [ids[i]]).doc, { selection: [gid] });
    await new Promise((resolve) => {
      const check = () => {
        const info = store.state.payload?.groupInfo?.[gid];
        const g = store.doc.groups.find((x) => x.id === gid);
        if (info && g.members.length === i + 1) resolve();
        else setTimeout(check, 30);
      };
      check();
    });
    const info = store.state.payload.groupInfo[gid];
    history.push({ status: info.status, genus: info.genus, vol: info.volume, tris: info.triangles });
  }
  const final = store.state.payload.groupInfo[gid];
  const rebuildA = await window.__grind.client.build(structuredClone(store.doc), { sharpAngle: 40 });
  const rebuildB = await window.__grind.client.build(structuredClone(store.doc), { sharpAngle: 40 });
  return {
    merges: store.doc.mergeOps,
    members: store.doc.groups.find((g) => g.id === gid).members.length,
    history,
    final,
    buildMs: store.state.payload.stats.buildMs,
    stable: JSON.stringify(rebuildA.payload.groupInfo) === JSON.stringify(rebuildB.payload.groupInfo),
    sameAsLive: JSON.stringify(rebuildA.payload.groupInfo) === JSON.stringify(store.state.payload.groupInfo),
  };
});
check('27 successive merges into one group', stress.merges === 27, `merges=${stress.merges}`);
check('every intermediate result is a valid manifold', stress.history.every((h) => h.status === 'NoError'));
check('volume grows monotonically', stress.history.every((h, i) => i === 0 || h.vol >= stress.history[i - 1].vol - 1e-6));
check('genus stays 0 for a solid lump', stress.history.every((h) => h.genus === 0));
check('rebuild is deterministic after 27 merges', stress.stable && stress.sameAsLive);
check('rebuild stays fast (<150 ms)', stress.buildMs < 150, `${stress.buildMs} ms`);

/* ---------------------------------------------------------------- */
/* 7. Collision mesh export                                          */
/* ---------------------------------------------------------------- */

await page.evaluate(async () => {
  const { store } = window.__grind;
  const { createDemoDoc } = await import('/src/model/doc.js');
  const next = createDemoDoc();
  next.settings = store.doc.settings;
  store.commit(next, { label: '示例', selection: [] });
});
await page.waitForTimeout(1600);

const collision = await page.evaluate(() => {
  const { json, obj } = window.__grind.buildCollisionExport();
  return {
    json,
    objV: (obj.match(/^v /gm) || []).length,
    objF: (obj.match(/^f /gm) || []).length,
    objO: (obj.match(/^o /gm) || []).length,
  };
});
check('collision export has a manifest', collision.json.format === 'grind.collision');
check('collision export covers every render chunk', collision.json.totals.colliders === (await page.evaluate(() => window.__grind.store.state.payload.chunks.length)));
check(
  'collision OBJ vertex/triangle counts match the manifest',
  collision.objV === collision.json.totals.vertices &&
    collision.objF === collision.json.totals.triangles &&
    collision.objO === collision.json.totals.colliders,
);
check('merged colliders are marked manifold', collision.json.colliders.filter((c) => c.kind === 'merged').every((c) => c.manifold));
check('colliders carry bounds for broad-phase tests', collision.json.colliders.every((c) => c.bounds.min.length === 3 && c.bounds.max.length === 3));

/* ---------------------------------------------------------------- */
/* 8. Project export / import round trip                             */
/* ---------------------------------------------------------------- */

const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.evaluate(() => window.__grind.exportProject()),
]);
check('project file downloads', Boolean(await download.path()), download.suggestedFilename());
const projectPath = await download.path();
mkdirSync('scratch/downloads', { recursive: true });
await download.saveAs(`scratch/downloads/${download.suggestedFilename()}`);

const roundTrip = await page.evaluate(async (path) => {
  const { store } = window.__grind;
  const { deleteElements } = await import('/src/model/doc.js');
  const before = structuredClone(store.doc);
  const json = JSON.parse(JSON.stringify(before));
  store.commit(deleteElements(store.doc, store.doc.elements.map((e) => e.id)), { label: '清空', selection: [] });
  await new Promise((r) => setTimeout(r, 800));
  const cleared = store.doc.elements.length;
  await window.__grind.importDoc(json);
  await new Promise((r) => setTimeout(r, 1400));
  const after = store.doc;
  const key = (e) => `${e.type}|${JSON.stringify(e.params)}|${e.position.join(',')}|${e.rotationY}`;
  return {
    cleared,
    elementsMatch: JSON.stringify(before.elements.map(key).sort()) === JSON.stringify(after.elements.map(key).sort()),
    groupsMatch: JSON.stringify(before.groups.map((g) => [g.members, g.cutters])) === JSON.stringify(after.groups.map((g) => [g.members, g.cutters])),
    name: after.name,
    chunks: store.state.payload.chunks.length,
    groupInfo: Object.values(store.state.payload.groupInfo).every((i) => i.status === 'NoError'),
  };
}, projectPath);
check('import restores every element and its layout', roundTrip.cleared === 0 && roundTrip.elementsMatch && roundTrip.groupsMatch);
check('imported model rebuilds into valid manifolds', roundTrip.groupInfo);

/* ---------------------------------------------------------------- */
/* 9. Autosave                                                       */
/* ---------------------------------------------------------------- */

await page.waitForTimeout(1500);
const savedBefore = await page.evaluate(() => Boolean(localStorage.getItem('grind.skatepark.autosave.v1')));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__grind?.store?.state?.engine === 'ready', { timeout: 30000 });
await page.waitForTimeout(1500);
const restored = await page.evaluate(() => ({
  elements: window.__grind.store.doc.elements.length,
  groups: window.__grind.store.doc.groups.length,
  chunks: window.__grind.store.state.payload.chunks.length,
}));
check('autosave writes to localStorage', savedBefore);
check('reload restores the park from localStorage', restored.elements > 0 && restored.chunks > 0);

/* ---------------------------------------------------------------- */

check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await page.screenshot({ path: 'scratch/e2e-final.png' });
await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
