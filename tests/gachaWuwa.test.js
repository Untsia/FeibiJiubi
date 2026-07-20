/**
 * gachaWuwa.js 前端渲染层单元测试
 *
 * 该文件是浏览器端渲染脚本（大量依赖 document/window），无法整体在 Node 加载。
 * 本测试直接从「真实源码」中用括号平衡扫描抽取纯函数（进度条 / 统计单元 / 时间排序 /
 * 空状态），再用 new Function 执行真实代码并断言，确保测的是源码而非副本。
 *
 * 覆盖场景：
 *  - generateProgressBar : 宽度钳制（正常 / 超过 100% / 0 抽 / 除零 / 负数）、
 *                          variant 类（gold 默认 / purple）、label 与抽数文本、
 *                          color 参数未参与渲染（记录潜在缺陷）
 *  - statCell            : 数值与标签正确包裹
 *  - statByTime          : 按时间戳排序的结果符号
 *  - emptyStateHtml      : 默认标题 / 带提示 / 无提示
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'js', 'gameTools', 'gachaWuwa.js'),
  'utf8'
);

/**
 * 括号平衡扫描：从 marker 起始位置找到首个 { 并平衡计数，
 * 过程中跳过字符串 / 模板字符串 / 注释，避免误判其中字符。
 */
function extractFunctionSource(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('marker not found: ' + marker);
  let i = src.indexOf('{', start);
  if (i < 0) throw new Error('no opening brace for ' + marker);
  let depth = 0;
  let inSingle = false, inDouble = false, inTmpl = false, inTmplExpr = false, inLine = false, inBlock = false;
  for (; i < src.length; i++) {
    const c = src[i];
    const prev = src[i - 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && src[i + 1] === '/') { inBlock = false; i++; } continue; }
    if (inSingle) { if (c === "'" && prev !== '\\') inSingle = false; continue; }
    if (inDouble) { if (c === '"' && prev !== '\\') inDouble = false; continue; }
    if (inTmpl) {
      if (inTmplExpr) {
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) inTmplExpr = false; }
        else if (c === '`' && prev !== '\\') inTmpl = false;
        else if (c === '\\') i++;
        continue;
      }
      if (c === '\\') { i++; continue; }
      if (c === '`') { inTmpl = false; continue; }
      if (c === '$' && src[i + 1] === '{') { inTmplExpr = true; depth++; i++; continue; }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { inLine = true; i++; continue; }
    if (c === '/' && src[i + 1] === '*') { inBlock = true; i++; continue; }
    if (c === "'") { inSingle = true; continue; }
    if (c === '"') { inDouble = true; continue; }
    if (c === '`') { inTmpl = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces for ' + marker);
}

function buildFn(marker, name) {
  const src = extractFunctionSource(SRC, marker);
  return new Function(src + '\n;return ' + name + ';')();
}

const generateProgressBar = buildFn('generateProgressBar = (', 'generateProgressBar');
const statCell = buildFn('function statCell(', 'statCell');
const statByTime = buildFn('function statByTime(', 'statByTime');
const emptyStateHtml = buildFn('function emptyStateHtml(', 'emptyStateHtml');

test('generateProgressBar: 正常比例 → 宽度等于百分比', () => {
  const html = generateProgressBar(50, 100, '新手限定唤取');
  assert.ok(html.includes('width: 50%'), '应包含 width: 50%');
  assert.ok(html.includes('50抽'), '应包含抽数文本');
  assert.ok(html.includes('新手限定唤取'), '应包含 label');
  assert.ok(html.includes('progress-bar gold'), '默认 variant 应为 gold');
});

test('generateProgressBar: 超过 100% → 钳制为 100%', () => {
  const html = generateProgressBar(150, 100, 'X');
  assert.ok(html.includes('width: 100%'), '应钳制为 100%');
});

test('generateProgressBar: 0 抽 → 宽度为 0%', () => {
  const html = generateProgressBar(0, 100, 'X');
  assert.ok(html.includes('width: 0%'), '0 抽应为 0%');
});

test('generateProgressBar: 除零 (maxDraws=0, draws>0) → 钳制为 100%', () => {
  const html = generateProgressBar(5, 0, 'X');
  assert.ok(html.includes('width: 100%'), '除零时不应产生 NaN%，回退为满格');
});

test('generateProgressBar: 负数抽数 → 钳制为 0%', () => {
  const html = generateProgressBar(-10, 100, 'X');
  assert.ok(html.includes('width: 0%'), '负数应钳制为 0%');
});

test('generateProgressBar: variant=purple → 应用 purple 类', () => {
  const html = generateProgressBar(30, 100, 'X', 'purple');
  assert.ok(html.includes('progress-bar purple'), '应应用 purple 类');
});

test('generateProgressBar: 清理后签名为 (draws, maxDraws, label, variant)', () => {
  const html = generateProgressBar(50, 100, '我的卡池', 'gold');
  assert.ok(html.includes('我的卡池'), '应渲染 label');
  assert.ok(html.includes('progress-bar gold'), '默认/显式 gold 类应被正确应用');
});

test('statCell: 数值与标签被正确包裹', () => {
  const html = statCell('12', '平均UP');
  assert.ok(html.includes('>12<'));
  assert.ok(html.includes('平均UP'));
  assert.ok(html.includes('stat-cell'));
});

test('statByTime: 时间戳较早者排在前面', () => {
  const a = { timestamp: '2024-01-02 00:00:00' };
  const b = { timestamp: '2024-01-01 00:00:00' };
  assert.ok(statByTime(a, b) > 0, '后者更早应返回正数');
  assert.ok(statByTime(b, a) < 0, '前者更早应返回负数');
});

test('emptyStateHtml: 默认标题为「暂无数据」', () => {
  const html = emptyStateHtml();
  assert.ok(html.includes('暂无数据'));
  assert.ok(!html.includes('empty-hint'), '无 hint 时不应渲染 empty-hint');
});

test('emptyStateHtml: 带提示时渲染 empty-hint', () => {
  const html = emptyStateHtml('没数据', '去抽卡吧');
  assert.ok(html.includes('没数据'));
  assert.ok(html.includes('去抽卡吧'));
  assert.ok(html.includes('empty-hint'));
});
