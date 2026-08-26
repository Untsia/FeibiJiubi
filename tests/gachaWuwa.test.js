/**
 * gachaWuwa.js 渲染层回归测试
 *
 * gachaWuwa.js 是浏览器端渲染脚本（依赖 document/window），无法整体在 Node 直接 require。
 * 本测试用 vm 在带 DOM mock 的沙箱中加载真实源码（gacha.js + gachaWuwa.js），
 * 直接调用 renderIntuitiveView / renderBarView 验证渲染输出。
 *
 * 覆盖：
 *  - renderIntuitiveView：不抛错、输出含两列网格 intuitive-grid、含头像卡片、不包含条形专属 bar-char-list
 *  - renderBarView      ：不抛错、输出含 bar-pool-rows、不包含内联头像卡片 bar-char-list（本次改动）
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC_DIR = path.join(__dirname, '..', 'src', 'renderer', 'scripts', 'gameTools');

// ---------- DOM / window mock ----------
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
    __intuitiveCharData: undefined,
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

// 构造最小真实结构的假数据
function makeRecords() {
  const rec = (name, q, time) => ({ name, quality_level: q, time, pool_type: '角色活动唤取', resource_id: '' });
  const role = [
    rec('角色A', 5, '2024-05-01 12:00:00'),
    rec('角色B', 4, '2024-05-02 12:00:00'),
    rec('角色C', 3, '2024-05-03 12:00:00'),
    rec('角色D', 5, '2024-05-04 12:00:00'),
  ];
  const weapon = [rec('武器A', 5, '2024-04-01 12:00:00'), rec('武器B', 4, '2024-04-02 12:00:00')];
  return { role, weapon };
}

// ---------- 测试 ----------
test('renderIntuitiveView: 渲染成功且为一行两列网格 + 含头像卡片', () => {
  const { ctx, sandbox } = loadWuwa();
  const { role, weapon } = makeRecords();
  const pools = { '角色活动唤取': role, '武器活动唤取': weapon };
  const filtered = role.concat(weapon);
  ctx.renderIntuitiveView(filtered, pools); // 返回 void，结果写入 view-intuitive 节点
  const view = sandbox.document.getElementById('view-intuitive');
  assert.ok(view.children.length > 0, 'view-intuitive 应被挂载内容');
  const wrapper = view.children[0];
  assert.ok(wrapper.className.includes('intuitive-grid'), '卡片视图应使用两列网格布局 intuitive-grid');
  const html = wrapper.innerHTML;
  assert.ok(html.includes('intuitive-char-card'), '卡片视图应显示头像卡片');
  assert.ok(!html.includes('bar-char-list'), '卡片视图不应包含条形专属头像列表');
});

test('renderBarView: 渲染成功且为纯条形（无内联头像卡片）', () => {
  const { ctx, sandbox } = loadWuwa();
  const { role, weapon } = makeRecords();
  const pools = { '角色活动唤取': role, '武器活动唤取': weapon };
  const filtered = role.concat(weapon);
  ctx.renderBarView(filtered, pools);
  const view = sandbox.document.getElementById('view-bar');
  assert.ok(view.children.length > 0, 'view-bar 应被挂载内容');
  const html = view.children[0].innerHTML;
  assert.ok(html.includes('bar-pool-rows'), '条形视图应含条形容器 bar-pool-rows');
  assert.ok(!html.includes('bar-char-list'), '条形视图不应再内联头像卡片（本次改动）');
});
