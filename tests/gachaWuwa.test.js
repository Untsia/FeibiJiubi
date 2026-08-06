/**
 * gachaWuwa.js 渲染层回归测试
 *
 * gachaWuwa.js 是浏览器端渲染脚本（依赖 document/window），无法整体在 Node 直接 require。
 * 本测试用 vm 在带 DOM mock 的沙箱中加载真实源码（gacha.js + gachaWuwa.js），
 * 直接调用 renderIntuitiveView / renderBarView 验证渲染输出，
 * 并从源码文本抽取 generateProgressBar 纯函数验证宽度钳制。
 *
 * 覆盖：
 *  - renderIntuitiveView：不抛错、输出含两列网格 intuitive-grid、含头像卡片、不包含条形专属 bar-char-list
 *  - renderBarView      ：不抛错、输出含 bar-pool-rows、不包含内联头像卡片 bar-char-list（本次改动）
 *  - generateProgressBar：宽度钳制（正常 / 超 100% / 0 抽 / 除零 / 负数）、variant 类、抽数文本
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
  const wuwa = fs.readFileSync(path.join(SRC_DIR, 'gachaWuwa.js'), 'utf8');
  const ctx = vm.createContext(sandbox);
  vm.runInContext(gacha, ctx, { filename: 'gacha.js' });
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

// 从真实源码抽取 generateProgressBar 函数源码（marker 为局部 const 形式）
function extractGenerateProgressBar() {
  const src = fs.readFileSync(path.join(SRC_DIR, 'gachaWuwa.js'), 'utf8');
  const marker = 'const generateProgressBar = (';
  const start = src.indexOf(marker);
  assert.ok(start >= 0, 'marker not found: ' + marker);
  // 从 marker 后找到首个 { 平衡括号，直到匹配的 }
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const fnSrc = src.slice(start, i);
  // eslint-disable-next-line no-new-func
  return new Function(fnSrc + '\n;return generateProgressBar;')();
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

test('generateProgressBar: 正常比例 → 宽度等于百分比', () => {
  const fn = extractGenerateProgressBar();
  const html = fn(50, 100, '新手限定唤取');
  assert.ok(html.includes('width: 50%'), '应包含 width: 50%');
  assert.ok(html.includes('50抽'), '应包含抽数文本');
  assert.ok(html.includes('新手限定唤取'), '应包含 label');
  assert.ok(html.includes('progress-bar gold'), '默认 variant 应为 gold');
});

test('generateProgressBar: 超过 100% → 钳制为 100%', () => {
  const fn = extractGenerateProgressBar();
  const html = fn(150, 100, 'X');
  assert.ok(html.includes('width: 100%'), '应钳制为 100%');
});

test('generateProgressBar: 0 抽 → 宽度为 0%', () => {
  const fn = extractGenerateProgressBar();
  const html = fn(0, 100, 'X');
  assert.ok(html.includes('width: 0%'), '0 抽应为 0%');
});

test('generateProgressBar: 除零 (maxDraws=0, draws>0) → 钳制为 100%', () => {
  const fn = extractGenerateProgressBar();
  const html = fn(5, 0, 'X');
  assert.ok(html.includes('width: 100%'), '除零时不应产生 NaN%，回退为满格');
});

test('generateProgressBar: 负数抽数 → 钳制为 0%', () => {
  const fn = extractGenerateProgressBar();
  const html = fn(-10, 100, 'X');
  assert.ok(html.includes('width: 0%'), '负数应钳制为 0%');
});

test('generateProgressBar: variant=purple → 应用 purple 类', () => {
  const fn = extractGenerateProgressBar();
  const html = fn(30, 100, 'X', 'purple');
  assert.ok(html.includes('progress-bar purple'), '应应用 purple 类');
});
