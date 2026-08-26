/**
 * 性能压测：验证渲染层在大数据量下的耗时与稳定性。
 *
 * 覆盖：
 *  - renderIntuitiveView：模拟 13 个卡池 × 各 800 条记录（约 1 万条）渲染耗时 < 2s
 *  - renderBarView      ：同上数据量渲染耗时 < 2s
 *
 * 注意：本测试在带 DOM mock 的 vm 沙箱中跑真实源码，只测纯渲染 CPU 开销，
 * 不含浏览器 layout/paint，因此阈值比真实浏览器更宽松。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC_DIR = path.join(__dirname, '..', 'src', 'renderer', 'scripts', 'gameTools');

function makeEl() {
  const el = {
    innerHTML: '',
    className: '',
    id: '',
    dataset: {},
    style: {},
    children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this.children.push(c); this.innerHTML += (typeof c.outerHTML === 'string' ? c.outerHTML : (c.innerHTML || '')); return c; },
    get outerHTML() { return '<div class="' + this.className + '">' + this.innerHTML + '</div>'; },
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    addEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    remove() {},
    insertAdjacentHTML() {},
  };
  return el;
}

function buildSandbox() {
  const elCache = {};
  const documentMock = {
    getElementById(id) {
      if (!elCache[id]) elCache[id] = makeEl();
      return elCache[id];
    },
    createElement() { return makeEl(); },
    createDocumentFragment() { return makeEl(); },
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  const windowMock = {
    addEventListener() {},
    electronAPI: { on() {}, invoke() {}, send() {} },
    localStorage: { getItem() { return null; }, setItem() {} },
  };
  return {
    sandbox: {
      document: documentMock,
      window: windowMock,
      localStorage: windowMock.localStorage,
      console,
      setTimeout, clearTimeout, setInterval, clearInterval,
      JSON, Math, Date, String, Number, Array, Object, Promise,
    },
    windowMock,
  };
}

function loadWuwa() {
  const { sandbox, windowMock } = buildSandbox();
  const gacha = fs.readFileSync(path.join(SRC_DIR, 'gacha.js'), 'utf8');
  // 视图 render 函数已拆分为独立文件（与 gameTools.js 生产加载顺序一致）：
  // gacha.js -> shared.js -> barView.js -> intuitiveView.js -> gachaWuwa.js
  const shared = fs.readFileSync(path.join(SRC_DIR, 'views', 'shared.js'), 'utf8');
  const bar = fs.readFileSync(path.join(SRC_DIR, 'views', 'barView.js'), 'utf8');
  const intuitive = fs.readFileSync(path.join(SRC_DIR, 'views', 'intuitiveView.js'), 'utf8');
  const wuwa = fs.readFileSync(path.join(SRC_DIR, 'gachaWuwa.js'), 'utf8');
  const ctx = vm.createContext(sandbox);
  vm.runInContext(gacha, ctx, { filename: 'gacha.js' });
  vm.runInContext(shared, ctx, { filename: 'views/shared.js' });
  vm.runInContext(bar, ctx, { filename: 'views/barView.js' });
  vm.runInContext(intuitive, ctx, { filename: 'views/intuitiveView.js' });
  vm.runInContext(wuwa, ctx, { filename: 'gachaWuwa.js' });
  return { ctx, windowMock, sandbox };
}

const POOL_KEYS = [
  '新手限定唤取', '新手自选唤取', '角色活动唤取', '武器活动唤取', '角色常驻唤取',
  '武器常驻唤取', '角色联动唤取', '武器联动唤取', '角色活动唤取-复刻', '武器活动唤取-复刻',
  '角色忆旅唤取', '武器忆旅唤取', '新手活动唤取',
];

function makeLargeDataset() {
  const rec = (name, q, t) => ({ name, quality_level: q, time: t, pool_type: '角色活动唤取', resource_id: '' });
  const pools = {};
  const filtered = [];
  POOL_KEYS.forEach((key, pi) => {
    const arr = [];
    for (let i = 0; i < 800; i++) {
      const q = i % 17 === 0 ? 5 : (i % 5 === 0 ? 4 : 3);
      const r = rec('角色' + pi + '_' + i, q, '2024-0' + ((i % 9) + 1) + '-01 12:00:00');
      arr.push(r);
      filtered.push(r);
    }
    pools[key] = arr;
  });
  return { pools, filtered };
}

test('renderIntuitiveView: 13 卡池 × 800 条 (≈1万条) 渲染耗时 < 2s', () => {
  const { ctx, sandbox } = loadWuwa();
  const { pools, filtered } = makeLargeDataset();
  const t0 = Date.now();
  ctx.renderIntuitiveView(filtered, pools);
  const dt = Date.now() - t0;
  assert.ok(dt < 2000, '大数据量渲染应 < 2s，实际 ' + dt + 'ms');
  assert.ok(sandbox.document.getElementById('view-intuitive').children.length > 0, '应成功挂载');
});

test('renderBarView: 13 卡池 × 800 条 (≈1万条) 渲染耗时 < 2s', () => {
  const { ctx, sandbox } = loadWuwa();
  const { pools, filtered } = makeLargeDataset();
  const t0 = Date.now();
  ctx.renderBarView(filtered, pools);
  const dt = Date.now() - t0;
  assert.ok(dt < 2000, '大数据量渲染应 < 2s，实际 ' + dt + 'ms');
  assert.ok(sandbox.document.getElementById('view-bar').children.length > 0, '应成功挂载');
});
