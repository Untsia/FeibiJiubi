require('./_mocks');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ipcHandlers, dbMock, mockElectron } = require('./_mocks');
const { loadBackground } = require('../src/core/services/settings/background');

// 捕获注入到渲染进程的 JS 字符串的辅助
function captureLoader(settingsRows) {
  let captured = '';
  dbMock.all = (sql, params, cb) => { if (cb) cb(null, settingsRows); return Promise.resolve(settingsRows); };
  const fakeWin = {
    webContents: { executeJavaScript: async (js) => { captured = js; } },
  };
  return { fakeWin, get: () => captured };
}

// ---------- 场景 1：无背景图 + 深色 → 纯色 rgb(24,26,34)，不加 theme-light ----------
test('loadBackground 无图深色使用纯色底', async () => {
  const { fakeWin, get } = captureLoader([]);
  await loadBackground(fakeWin);
  const js = get();
  // 背景值经 JSON.stringify 注入，内部已是字符串；theme-light 经变量 toggle（无引号）
  assert.match(js, /background = "rgb\(245, 246, 250\)"/);
  assert.match(js, /classList\.toggle\('theme-light', true\)/);
});

// ---------- 场景 2：浅色模式 → rgb(245,246,250) 并加 theme-light ----------
test('loadBackground 浅色模式加 theme-light', async () => {
  const { fakeWin, get } = captureLoader([
    { key: 'themeMode', value: 'light' },
  ]);
  await loadBackground(fakeWin);
  const js = get();
  assert.match(js, /rgb\(245, 246, 250\)/);
  assert.match(js, /classList\.toggle\('theme-light', true\)/);
});

// ---------- 场景 3：有背景图 → 线性渐变遮罩 + url('file://...') ----------
test('loadBackground 有图使用渐变遮罩 + 图片', async () => {
  const img = 'C:\\Users\\me\\bg.jpg';
  const { fakeWin, get } = captureLoader([
    { key: 'themeMode', value: 'dark' },
    { key: 'backgroundImage', value: img },
  ]);
  await loadBackground(fakeWin);
  const js = get();
  assert.match(js, /rgba\(24, 26, 34, 0.5\)/);
  assert.match(js, /url\('file:\/\//);
});

// ---------- 场景 4：浅色模式提高遮罩不透明度下限（≥0.8） ----------
test('loadBackground 浅色模式遮罩下限 0.8', async () => {
  // 浅色模式固定默认遮罩 0.5 低于可读下限 0.8，应抬到 0.8 保证可读性
  const { fakeWin, get } = captureLoader([
    { key: 'themeMode', value: 'light' },
    { key: 'backgroundImage', value: 'C:\\x.jpg' },
  ]);
  await loadBackground(fakeWin);
  const js = get();
  assert.match(js, /rgba\(245, 246, 250, 0.8\)/);
});
