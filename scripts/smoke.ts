/** 核心生成逻辑冒烟测试:细枝预算、生长分级、修剪归零、确定性、重心重算 */
import { generateTree, updateGrowth, collectDescendants } from '../src/core/generator';
import { DEFAULT_SKELETON } from '../src/core/defaultSkeleton';
import { DEFAULT_GROWTH } from '../src/types';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    console.error(`  ✗ ${name} ${detail}`);
    failures++;
  }
}

// 1. 生成规模
const tree = generateTree(DEFAULT_SKELETON, DEFAULT_GROWTH, new Set(), new Set());
console.log(`twigs=${tree.twigs.length} leaves=${tree.leaves.length} maxLevel=${tree.maxLevel}`);
check('细枝数量达到预算(约2000)', tree.twigs.length >= 1900 && tree.twigs.length <= 2100, `got ${tree.twigs.length}`);
check('叶片数量为正', tree.leaves.length > 1000, `got ${tree.leaves.length}`);
check('每根细枝相位在[0,0.45]', tree.twigs.every((t) => t.phase >= 0 && t.phase <= 0.45));

// 2. 生长分级:g=0 全未萌发,g=1 全部萌发,中间逐级
updateGrowth(tree, 0);
check('g=0 时全部生长度为0', tree.twigs.every((t) => t.growth === 0));
updateGrowth(tree, 1);
check('g=1 时全部生长度为1', tree.twigs.every((t) => t.growth === 1));
updateGrowth(tree, 0.5);
const grown = tree.twigs.filter((t) => t.growth > 0);
check('g=0.5 时低级先萌发', grown.every((t) => t.level <= 3), `max level grown: ${Math.max(...grown.map((t) => t.level))}`);
check('g=0.5 时有部分萌发', grown.length > 0 && grown.length < tree.twigs.length);
check('重心已计算', tree.centersOfMass.size > 0);

// 3. 修剪:下游归零
const prunedTree = generateTree(DEFAULT_SKELETON, DEFAULT_GROWTH, new Set(['b1']), new Set());
updateGrowth(prunedTree, 1);
const b1Twigs = prunedTree.twigs.filter((t) => t.branchId === 'b1');
const b1aTwigs = prunedTree.twigs.filter((t) => t.branchId === 'b1a'); // b1 的下游
check('被剪枝干细枝存在但生长度归零', b1Twigs.length > 0 && b1Twigs.every((t) => t.growth === 0));
check('下游枝干(b1a)生长度也归零', b1aTwigs.length > 0 && b1aTwigs.every((t) => t.growth === 0));
const b2Twigs = prunedTree.twigs.filter((t) => t.branchId === 'b2');
check('未剪枝干不受影响', b2Twigs.length > 0 && b2Twigs.every((t) => t.growth === 1));
check('collectDescendants 包含下游', collectDescendants(DEFAULT_SKELETON, 'b1').has('b1a'));

// 4. 细枝级修剪传播到子细枝
const someKey = prunedTree.twigs.find((t) => t.level === 2 && t.branchId === 'b2')!.key;
const twigPruned = generateTree(DEFAULT_SKELETON, DEFAULT_GROWTH, new Set(), new Set([someKey]));
updateGrowth(twigPruned, 1);
const parentIdx = twigPruned.twigs.findIndex((t) => t.key === someKey);
const children = twigPruned.twigs.filter((t) => t.parent === parentIdx);
check('细枝修剪传播到子细枝', children.length > 0 && children.every((t) => t.growth === 0));

// 5. 确定性:同种子两次生成一致
const again = generateTree(DEFAULT_SKELETON, DEFAULT_GROWTH, new Set(), new Set());
check(
  '同种子重建结果确定',
  again.twigs.length === tree.twigs.length &&
    again.twigs.every((t, i) => t.key === tree.twigs[i].key && t.length === tree.twigs[i].length),
);

// 6. 参数变化改变结果
const other = generateTree(DEFAULT_SKELETON, { ...DEFAULT_GROWTH, seed: 42 }, new Set(), new Set());
check('不同种子产生不同形态', other.twigs.some((t, i) => t.length !== tree.twigs[i]?.length));

// 7. 重建性能
const t0 = performance.now();
for (let i = 0; i < 10; i++) generateTree(DEFAULT_SKELETON, DEFAULT_GROWTH, new Set(), new Set());
const avg = (performance.now() - t0) / 10;
console.log(`重建耗时 ${avg.toFixed(1)}ms/次`);
check('重建远低于3秒预算', avg < 3000);

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
