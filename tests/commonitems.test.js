require('./_mocks');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ipcHandlers } = require('./_mocks');

// 必须在 require commonitems 之前设置数据目录（其顶层会读取该环境变量）
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feibijiubi-common-'));
process.env.FEIBIJIUBI_FOLDER_PATH = dataDir;
require('../src/core/services/analysisGacha/commonitems'); // 注册 get-common-items + 初始化写文件

// ---------- 场景 1：首次请求自动创建默认常驻数据并返回 zh-cn 列表 ----------
test('get-common-items 默认返回 wuWa zh-cn 常驻列表', async () => {
  const list = await ipcHandlers['get-common-items'](null, 'wuWa', 'zh-cn');
  assert.ok(Array.isArray(list));
  assert.ok(list.includes('安可'));
  assert.ok(list.includes('千古洑流'));
  // 文件确实被创建
  assert.ok(fs.existsSync(path.join(dataDir, 'commonItems.json')));
});

// ---------- 场景 2：繁体语言返回 zh-tw 列表 ----------
test('get-common-items 返回 wuWa zh-tw 常驻列表', async () => {
  const list = await ipcHandlers['get-common-items'](null, 'wuWa', 'zh-tw');
  assert.ok(list.includes('卡卡羅')); // 繁体字形
});

// ---------- 场景 3：未知语言回退到 zh-cn ----------
test('get-common-items 未知语言回退 zh-cn', async () => {
  const list = await ipcHandlers['get-common-items'](null, 'wuWa', 'unknown');
  assert.ok(list.includes('安可'));
});
