/**
 * 性能压测：验证渲染层在大数据量下的耗时与稳定性（React 侧 renderers.ts）。
 *
 * 原实现在带 DOM mock 的 vm 沙箱中跑遗留视图脚本，已随 React 迁移移至
 * src/renderer-react/src/gacha/renderers.ts 纯函数（直接返回 HTML 字符串）。
 *
 * 覆盖：
 *  - renderIntuitiveViewHtml：模拟 13 个卡池 × 各 800 条记录（约 1 万条）渲染耗时 < 2s
 *  - renderBarViewHtml      ：同上数据量渲染耗时 < 2s
 *
 * 注意：只测纯渲染 CPU 开销，不含浏览器 layout/paint，因此阈值比真实浏览器更宽松。
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  renderBarViewHtml,
  renderIntuitiveViewHtml,
} = require('../src/renderer-react/src/gacha/renderers.ts');

const POOL_KEYS = [
  '新手限定唤取', '新手自选唤取', '角色活动唤取', '武器活动唤取', '角色常驻唤取',
  '武器常驻唤取', '角色联动唤取', '武器联动唤取', '角色活动唤取-复刻', '武器活动唤取-复刻',
  '角色忆旅唤取', '武器忆旅唤取', '新手活动唤取',
];

function makeLargeDataset() {
  const pools = {};
  const records = [];
  POOL_KEYS.forEach((key, pi) => {
    const arr = [];
    for (let i = 0; i < 800; i++) {
      const q = i % 17 === 0 ? 5 : (i % 5 === 0 ? 4 : 3);
      arr.push({
        name: '角色' + pi + '_' + i,
        quality_level: q,
        timestamp: '2024-0' + ((i % 9) + 1) + '-01 12:00:00',
        card_pool_type: key,
        resource_id: String(pi * 1000 + i),
      });
    }
    pools[key] = arr;
    records.push(...arr);
  });
  return { pools, records };
}

function makeOpts() {
  const { pools, records } = makeLargeDataset();
  return {
    records,
    pools,
    hidden: new Set(),
    avatarMap: { byResourceId: {}, byName: {} },
    commonItems: [],
  };
}

test('renderIntuitiveViewHtml: 13 卡池 × 800 条 (≈1万条) 渲染耗时 < 2s', () => {
  const opts = makeOpts();
  const t0 = Date.now();
  const html = renderIntuitiveViewHtml(opts);
  const dt = Date.now() - t0;
  assert.ok(dt < 2000, '大数据量渲染应 < 2s，实际 ' + dt + 'ms');
  assert.ok(html.includes('intuitive-grid'), '应渲染出网格内容');
});

test('renderBarViewHtml: 13 卡池 × 800 条 (≈1万条) 渲染耗时 < 2s', () => {
  const opts = makeOpts();
  const t0 = Date.now();
  const res = renderBarViewHtml(opts);
  const dt = Date.now() - t0;
  assert.ok(dt < 2000, '大数据量渲染应 < 2s，实际 ' + dt + 'ms');
  assert.ok(res.html.includes('bar-view'), '应渲染出条形内容');
});