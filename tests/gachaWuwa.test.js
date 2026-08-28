/**
 * 抽卡分析视图渲染回归测试（React 侧 renderers.ts）
 *
 * 原实现为浏览器端视图脚本（views/intuitiveView.js / views/barView.js，依赖
 * document/window），已随 React 迁移移至 src/renderer-react/src/gacha/renderers.ts
 * 纯函数（返回 HTML 字符串）。本测试直接 require TS 模块（Node type-stripping），
 * 验证渲染输出与遗留实现字节级一致的关键结构。
 *
 * 覆盖：
 *  - renderIntuitiveViewHtml：输出两列网格 intuitive-grid、含头像卡片，不含条形专属 bar-char-list
 *  - renderBarViewHtml      ：输出 bar-pool-rows 条形容器，不内联头像卡片（本次改动）
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  renderBarViewHtml,
  renderIntuitiveViewHtml,
} = require('../src/renderer-react/src/gacha/renderers.ts');

// 构造最小真实结构的假数据（字段与 GachaRecord 对齐）
function makeRecords() {
  const rec = (name, q, ts, pool) => ({ name, quality_level: q, timestamp: ts, card_pool_type: pool, resource_id: '' });
  const role = [
    rec('角色A', 5, '2024-05-01 12:00:00', '角色活动唤取'),
    rec('角色B', 4, '2024-05-02 12:00:00', '角色活动唤取'),
    rec('角色C', 3, '2024-05-03 12:00:00', '角色活动唤取'),
    rec('角色D', 5, '2024-05-04 12:00:00', '角色活动唤取'),
  ];
  const weapon = [
    rec('武器A', 5, '2024-04-01 12:00:00', '武器活动唤取'),
    rec('武器B', 4, '2024-04-02 12:00:00', '武器活动唤取'),
  ];
  return { role, weapon };
}

function makeOpts() {
  const { role, weapon } = makeRecords();
  const pools = { '角色活动唤取': role, '武器活动唤取': weapon };
  return {
    records: role.concat(weapon),
    pools,
    hidden: new Set(),
    avatarMap: { byResourceId: {}, byName: {} },
    commonItems: [],
  };
}

// ---------- 测试 ----------
test('renderIntuitiveViewHtml: 一行两列网格 + 含头像卡片 + 无条形专属头像列表', () => {
  const html = renderIntuitiveViewHtml(makeOpts());
  assert.ok(html.includes('intuitive-grid'), '卡片视图应使用两列网格布局 intuitive-grid');
  assert.ok(html.includes('intuitive-char-card'), '卡片视图应显示头像卡片');
  assert.ok(!html.includes('bar-char-list'), '卡片视图不应包含条形专属头像列表');
});

test('renderBarViewHtml: 纯条形（无内联头像卡片）且返回交互数据', () => {
  const res = renderBarViewHtml(makeOpts());
  assert.ok(res.html.includes('bar-pool-rows'), '条形视图应含条形容器 bar-pool-rows');
  assert.ok(!res.html.includes('bar-char-list'), '条形视图不应内联头像卡片（本次改动）');
  assert.ok(Object.keys(res.interaction.pools).length === 2, '交互数据应含两个卡池');
});