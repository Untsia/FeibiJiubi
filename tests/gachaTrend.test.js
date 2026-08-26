/**
 * 趋势线共享工具回归测试（gachaWuwa 视图 shared.js）
 *
 * gacha.js + 视图 shared.js 是浏览器端渲染脚本（依赖 document/window），
 * 无法整体在 Node 直接 require。与 gachaWuwa.test.js 一致，用 vm 在 DOM mock
 * 沙箱中加载真实源码，再直接调用 buildSparklineSvg / buildPityTrend / drawsToNext
 * 验证抽数语义与可视化输出。
 *
 * 覆盖本次改动：
 *  - drawsToNext        ：共享工具抽数间隔语义（三视图曾重复定义）
 *  - buildPityTrend     ：首尾抽数闭合、有/无垫抽分支、纯垫抽卡池
 *  - buildSparklineSvg  ：空序列隐藏、单点水平线（按抽数给高度）、多点圆点热区与悬停抽数
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC_DIR = path.join(__dirname, '..', 'src', 'renderer', 'scripts', 'gameTools');

function buildSandbox() {
  const windowMock = {
    addEventListener() {},
    localStorage: { getItem() { return null; }, setItem() {} },
  };
  const sandbox = {
    document: {
      getElementById() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      createElement() { return {}; },
    },
    window: windowMock,
    localStorage: windowMock.localStorage,
    console, JSON, Math, String, Number, Array, Object,
  };
  return { sandbox, windowMock };
}

function loadShared() {
  const { sandbox } = buildSandbox();
  const gacha = fs.readFileSync(path.join(SRC_DIR, 'gacha.js'), 'utf8');
  const shared = fs.readFileSync(path.join(SRC_DIR, 'views', 'shared.js'), 'utf8');
  const ctx = vm.createContext(sandbox);
  vm.runInContext(gacha, ctx, { filename: 'gacha.js' });
  vm.runInContext(shared, ctx, { filename: 'views/shared.js' });
  return ctx;
}

// 简化的记录对象：只保留 drawsToNext / buildPityTrend 依赖的字段
const q = (n) => ({ name: 'x' + n, quality_level: n });

// 提取 SVG 中所有 <circle> 的 cx/cy/title
function extractCircles(svg) {
  const out = [];
  const re = /<circle cx="([^"]+)" cy="([^"]+)" r="6" fill="transparent"><title>([^<]+)<\/title><\/circle>/g;
  let m;
  while ((m = re.exec(svg)) !== null) out.push({ cx: m[1], cy: m[2], title: m[3] });
  return out;
}

// ---------- drawsToNext ----------
test('drawsToNext: 返回到下一个同品质出货的抽数间隔', () => {
  const ctx = loadShared();
  const recs = [q(5), q(4), q(3), q(5), q(3), q(4), q(5)];
  assert.equal(ctx.drawsToNext(recs, recs[0], 5), 3); // index0 → 下一个 5 在 index3
  assert.equal(ctx.drawsToNext(recs, recs[3], 5), 3); // index3 → 下一个 5 在 index6
  assert.equal(ctx.drawsToNext(recs, recs[6], 5), 1); // 最后一个 5 → 到末尾
  assert.equal(ctx.drawsToNext(recs, recs[1], 4), 4); // index1 4星 → 下一个 4 在 index5
  assert.equal(ctx.drawsToNext(recs, recs[6], 4), 1); // 末尾无下一个 → length - idx
});

// vm 沙箱跨 realm，数组与宿主原型不同，deepEqual 会误报；统一用 JSON 序列化比较
function json(a) { return JSON.stringify(a); }
function jsonArr(...vals) { return '[' + vals.join(',') + ']'; }

// ---------- buildPityTrend ----------
test('buildPityTrend: 首尾抽数闭合（起点含本次、终点为上次距本次）', () => {
  const ctx = loadShared();
  // chrono（时间正序）：[3星, 5星A, 4星, 3星, 5星B, 5星C]
  // A=idx1→1-(-1)=2；B=idx4→4-1=3；C=idx5→5-4=1；垫抽=6-1-5=0 不追加
  const chrono = [q(3), q(5), q(4), q(3), q(5), q(5)];
  const recs = chrono.slice().reverse(); // 库内 id 倒序（最新在前）
  assert.equal(json(ctx.buildPityTrend(recs)), jsonArr(2, 3, 1));
});

test('buildPityTrend: 最后出五星后有垫抽 → 末尾追加垫抽点', () => {
  const ctx = loadShared();
  // chrono：[5星A, 4星, 4星, 5星B, 3星]
  // A=idx0→1；B=idx3→3；垫抽=5-1-3=1 >0 → 追加 1
  const chrono = [q(5), q(4), q(4), q(5), q(3)];
  const recs = chrono.slice().reverse();
  assert.equal(json(ctx.buildPityTrend(recs)), jsonArr(1, 3, 1));
});

test('buildPityTrend: 有五星但零垫抽 → 不追加 0 抽点', () => {
  const ctx = loadShared();
  // chrono：[5星A, 3星, 5星B]（最后一条即五星）
  // A=idx0→1；B=idx2→2；垫抽=3-1-2=0 → 不追加
  const chrono = [q(5), q(3), q(5)];
  const recs = chrono.slice().reverse();
  assert.equal(json(ctx.buildPityTrend(recs)), jsonArr(1, 2));
});

test('buildPityTrend: 从未出五星但有垫抽 → 单点为已垫总抽数', () => {
  const ctx = loadShared();
  // chrono：[3星, 4星, 4星]（全垫抽，垫抽=3>0）
  const chrono = [q(3), q(4), q(4)];
  const recs = chrono.slice().reverse();
  assert.equal(json(ctx.buildPityTrend(recs)), jsonArr(3));
});

test('buildPityTrend: 空数据 → 空序列', () => {
  const ctx = loadShared();
  assert.equal(json(ctx.buildPityTrend([])), '[]');
});

// ---------- buildSparklineSvg ----------
test('buildSparklineSvg: 空序列 → 返回空串（不渲染）', () => {
  const ctx = loadShared();
  assert.equal(ctx.buildSparklineSvg([]), '');
  assert.equal(ctx.buildSparklineSvg(null), '');
});

test('buildSparklineSvg: 单点 → 非空水平线（两端同高）且含该抽数提示', () => {
  const ctx = loadShared();
  const svg = ctx.buildSparklineSvg([60]);
  assert.ok(svg.includes('<svg class="sparkline"'), '应渲染 sparkline');
  assert.ok(svg.includes('<polyline'), '应渲染折线');
  const circles = extractCircles(svg);
  assert.equal(circles.length, 2, '单点复制成两端，应有 2 个热区');
  assert.equal(circles[0].cy, circles[1].cy, '单点两端应同高（水平线）');
  assert.equal(circles[0].title, '60 抽');
});

test('buildSparklineSvg: 单点高度按抽数归一化（抽数越多 y 越小/越高）', () => {
  const ctx = loadShared();
  const low = extractCircles(ctx.buildSparklineSvg([10]))[0].cy;
  const high = extractCircles(ctx.buildSparklineSvg([80]))[0].cy;
  assert.ok(parseFloat(high) < parseFloat(low), '满保底(80)的线应高于低抽数(10)的线');
});

test('buildSparklineSvg: 多点 → 每点一个热区且 title 为对应抽数', () => {
  const ctx = loadShared();
  const values = [10, 50, 90];
  const svg = ctx.buildSparklineSvg(values);
  const circles = extractCircles(svg);
  assert.equal(circles.length, values.length);
  valueLoop: for (const v of values) {
    if (!circles.some(c => c.title === v + ' 抽')) { assert.fail('缺少 ' + v + ' 抽 提示点'); }
  }
});