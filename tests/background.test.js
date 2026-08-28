require('./_mocks');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ipcHandlers, dbMock, mockElectron } = require('./_mocks');
const { loadBackground } = require('../.build/src/main/core/services/settings/background');

// 捕获注入到渲染进程的 JS 字符串的辅助
function captureLoader(settingsRows) {
  let captured = '';
  dbMock.all = (sql, params, cb) => { if (cb) cb(null, settingsRows); };
  const fakeWin = {
    webContents: { executeJavaScript: async (js) => { captured = js; } },
  };
  return { fakeWin, get: () => captured };
}

// ---------- 场景 1：无背景图 + 默认浅色 → 纯色 rgb(250,250,250)，加 theme-light ----------
test('loadBackground 无图默认浅色使用纯色底', async () => {
  const { fakeWin, get } = captureLoader([]);
  await loadBackground(fakeWin);
  const js = get();
  // 背景值经 JSON.stringify 注入，内部已是字符串；theme-light 经变量 toggle（无引号）
  assert.match(js, /background = "rgb\(250, 250, 250\)"/);
  assert.match(js, /classList\.toggle\('theme-light', true\)/);
});

// ---------- 场景 2：浅色模式 → rgb(250,250,250) 并加 theme-light ----------
test('loadBackground 浅色模式加 theme-light', async () => {
  const { fakeWin, get } = captureLoader([
    { key: 'themeMode', value: 'light' },
  ]);
  await loadBackground(fakeWin);
  const js = get();
  assert.match(js, /rgb\(250, 250, 250\)/);
  assert.match(js, /classList\.toggle\('theme-light', true\)/);
});

// ---------- 场景 3：有背景图 → 线性渐变遮罩 + local:// 图片（同源，勿用 file:// 以免被拦截） ----------
test('loadBackground 有图使用渐变遮罩 + local:// 图片', async () => {
  const img = 'C:\\Users\\me\\bg.jpg';
  const { fakeWin, get } = captureLoader([
    { key: 'themeMode', value: 'dark' },
    { key: 'backgroundImage', value: img },
  ]);
  await loadBackground(fakeWin);
  const js = get();
  assert.match(js, /rgba\(23, 23, 24, 0.5\)/);
  assert.match(js, /url\('local:\/\/app\/bg-image\//);
});

// ---------- 场景 4：遮罩不透明度由「背景亮度」滑块动态计算（0 暗→1 全遮罩，100 亮→0） ----------
test('loadBackground 遮罩不透明度跟随背景亮度（默认 50 → 0.5）', async () => {
  const { fakeWin, get } = captureLoader([
    { key: 'themeMode', value: 'light' },
    { key: 'backgroundImage', value: 'C:\\x.jpg' },
  ]);
  await loadBackground(fakeWin);
  const js = get();
  assert.match(js, /rgba\(250, 250, 250, 0.5\)/);
});

test('loadBackground 亮度 0 → 全遮罩 / 亮度 100 → 透明', async () => {
  const dim = captureLoader([
    { key: 'themeMode', value: 'light' },
    { key: 'backgroundImage', value: 'C:\\x.jpg' },
    { key: 'backgroundBrightness', value: '0' },
  ]);
  await loadBackground(dim.fakeWin);
  assert.match(dim.get(), /rgba\(250, 250, 250, 1\)/);

  const bright = captureLoader([
    { key: 'themeMode', value: 'light' },
    { key: 'backgroundImage', value: 'C:\\x.jpg' },
    { key: 'backgroundBrightness', value: '100' },
  ]);
  await loadBackground(bright.fakeWin);
  assert.match(bright.get(), /rgba\(250, 250, 250, 0\)/);
});
