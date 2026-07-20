/**
 * analysisIpc.js 单元测试（IPC / 网络层）
 *
 * 覆盖场景：
 *  - get-last-query-uid        : 数据库有记录→返回 player_id；数据库异常→null
 *  - get-player-uids           : 多条记录→映射数组；异常→空数组
 *  - get-gacha-records         : 正常返回记录；异常→空数组
 *  - refresh-gacha-records     : 自动读取分支（日志→解析→抓取）
 *       · 正常抓取且有记录 → success:true
 *       · 抓取 0 条（链接过期）→ success:false + Notify 提示
 *       · 日志里没有唤取链接 → success:false + 错误文案
 *       · 游戏路径定位失败 → success:false + 错误文案
 *  - get-treasure-boxes        : 带 playerId / 不带 playerId（回退查最新 UID）
 *
 * 说明：本文件通过 Module._load 钩子拦截 getWutheringWavesPath / kujiequTreasure，
 * 让依赖游戏日志与本地登录态的模块在纯 Node 下可控运行；其余真实逻辑（parseGachaUrl /
 * fetchAllGachaLogs 走真实代码 + mockAxios）。
 */
const test = require('node:test');
const assert = require('node:assert');

require('./_mocks');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 必须在 require analysisIpc（其间接加载 commonitems）之前设置数据目录，
// commonitems.js 顶层会读取该环境变量拼接 commonItems.json 路径。
process.env.FEIBIJIUBI_FOLDER_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'feibijiubi-ipc-'));

const Module = require('module');
const prevLoad = Module._load; // _mocks 的包装器（仍负责 electron/axios/database）

// 受本测试控制的外部依赖桩
const stubs = {
  gachaUrl: 'https://aki-gm-resources.aki-game.com/aki/gacha/index.html#/record?player_id=123456&gacha_type=1&lang=zh-Hans',
  gamePathErr: null,
  lastTreasurePid: undefined,
};

Module._load = function (request, parent, isMain) {
  if (request.includes('getWutheringWavesPath')) {
    return {
      getGamePath: async () => {
        if (stubs.gamePathErr) throw stubs.gamePathErr;
        return '/fake/Wuthering Waves/Client/Saved/Logs/Client.log';
      },
      extractGachaUrl: async () => stubs.gachaUrl,
    };
  }
  if (request.includes('kujiequTreasure')) {
    return {
      getTreasureBoxes: async (pid) => {
        stubs.lastTreasurePid = pid;
        if (stubs.treasureThrow) throw new Error('本地登录态失效');
        return { boxes: [{ id: 1, name: '新生波波' }], level: 7 };
      },
    };
  }
  return prevLoad.apply(this, arguments);
};

const { ipcHandlers, mockAxios, dbMock } = require('./_mocks');
require('../src/core/services/analysisGacha/analysisIpc');

// 测试结束后还原 Module._load，避免污染同进程内后续文件（node:test 一般按文件分进程，仍做防御）
test.after(() => { Module._load = prevLoad; });

// 每个用例后还原共享 mock，避免用例间泄漏（dbMock / mockAxios 是跨用例共享的可变对象）
test.afterEach(() => {
  dbMock.get = (sql, params, cb) => {
    if (typeof params === 'function') { cb = params; params = []; }
    if (cb) cb(null, null);
    return Promise.resolve(null);
  };
  dbMock.all = (sql, params, cb) => {
    if (typeof params === 'function') { cb = params; params = []; }
    if (cb) cb(null, []);
    return Promise.resolve([]);
  };
  dbMock.run = (sql, params, cb) => {
    if (typeof params === 'function') { cb = params; params = []; }
    if (cb) cb.call({ changes: 0 }, null);
    return Promise.resolve({ changes: 0 });
  };
  mockAxios.post = async () => ({ data: { data: [] } });
  stubs.gachaUrl = 'https://aki-gm-resources.aki-game.com/aki/gacha/index.html#/record?player_id=123456&gacha_type=1&lang=zh-Hans';
  stubs.gamePathErr = null;
  stubs.treasureThrow = false;
  global.Notify = () => {};
});

// 构造一个带 sender.send 捕获的 event
function makeEvent() {
  const statuses = [];
  return {
    sender: { send: (ch, msg) => statuses.push({ ch, msg }) },
    statuses,
  };
}

test('get-last-query-uid: 数据库有记录时返回 player_id', async () => {
  dbMock.get = (sql, params, cb) => {
    if (typeof params === 'function') { cb = params; params = []; }
    if (cb) cb(null, { player_id: '998877' });
    return Promise.resolve({ player_id: '998877' });
  };
  const res = await ipcHandlers['get-last-query-uid']();
  assert.strictEqual(res, '998877');
});

test('get-last-query-uid: 数据库异常时返回 null', async () => {
  dbMock.get = (sql, params, cb) => {
    if (typeof params === 'function') { cb = params; params = []; }
    if (cb) cb(new Error('db down'));
    return Promise.resolve(null);
  };
  const res = await ipcHandlers['get-last-query-uid']();
  assert.strictEqual(res, null);
});

test('get-player-uids: 多条记录映射为 player_id 数组', async () => {
  dbMock.all = (sql, params, cb) => {
    if (typeof params === 'function') { cb = params; params = []; }
    const rows = [{ player_id: '1' }, { player_id: '2' }];
    if (cb) cb(null, rows);
    return Promise.resolve(rows);
  };
  const res = await ipcHandlers['get-player-uids']();
  assert.deepStrictEqual(res, ['1', '2']);
});

test('get-player-uids: 数据库异常时返回空数组', async () => {
  dbMock.all = (sql, params, cb) => {
    if (typeof params === 'function') { cb = params; params = []; }
    if (cb) cb(new Error('boom'));
    return Promise.resolve([]);
  };
  const res = await ipcHandlers['get-player-uids']();
  assert.deepStrictEqual(res, []);
});

test('get-gacha-records: 正常返回记录', async () => {
  const rows = [{ id: 1, name: '秧秧' }];
  dbMock.all = (sql, params, cb) => {
    if (typeof params === 'function') { cb = params; params = []; }
    if (cb) cb(null, rows);
    return Promise.resolve(rows);
  };
  const res = await ipcHandlers['get-gacha-records']();
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].name, '秧秧');
});

test('get-gacha-records: 数据库异常时返回空数组', async () => {
  dbMock.all = (sql, params, cb) => {
    if (typeof params === 'function') { cb = params; params = []; }
    if (cb) cb(new Error('x'));
    return Promise.resolve([]);
  };
  const res = await ipcHandlers['get-gacha-records']();
  assert.deepStrictEqual(res, []);
});

test('refresh-gacha-records: 正常抓取且有记录 → success:true', async () => {
  stubs.gachaUrl = 'https://aki-gm-resources.aki-game.com/aki/gacha/index.html#/record?player_id=123456&gacha_type=1&lang=zh-Hans';
  stubs.gamePathErr = null;
  mockAxios.post = async () => ({
    status: 200,
    data: { data: [{ resourceId: 1, qualityLevel: 5, resourceType: 'character', name: '守岸人', count: 1, time: '2024-05-01 12:00:00' }] },
  });
  const ev = makeEvent();
  const res = await ipcHandlers['refresh-gacha-records'](ev);
  assert.strictEqual(res.success, true);
  assert.ok(res.totalRecords > 0, 'totalRecords 应大于 0');
  assert.ok(res.newRecords > 0, 'newRecords 应大于 0');
  assert.ok(ev.statuses.some(s => s.ch === 'gacha-records-status' && /查询到/.test(s.msg)), '应推送查询结果状态');
});

test('refresh-gacha-records: 抓取 0 条记录 → 链接过期 → success:false', async () => {
  stubs.gachaUrl = 'https://aki-gm-resources.aki-game.com/aki/gacha/index.html#/record?player_id=123456&gacha_type=1';
  stubs.gamePathErr = null;
  mockAxios.post = async () => ({ status: 200, data: { data: [] } });
  let notified = null;
  global.Notify = (ok, msg) => { notified = { ok, msg }; };
  const res = await ipcHandlers['refresh-gacha-records'](makeEvent());
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.totalRecords, 0);
  assert.ok(notified && /过期/.test(notified.msg), '应提示链接可能过期');
});

test('refresh-gacha-records: 日志中无唤取链接 → 失败并报错', async () => {
  stubs.gachaUrl = null; // extractGachaUrl 返回 null → 抛 "未找到唤取链接"
  stubs.gamePathErr = null;
  const res = await ipcHandlers['refresh-gacha-records'](makeEvent());
  assert.strictEqual(res.success, false);
  assert.ok(/未找到唤取链接/.test(res.error || ''), '错误文案应为未找到唤取链接');
});

test('refresh-gacha-records: 游戏路径定位失败 → 失败并报错', async () => {
  stubs.gachaUrl = 'https://aki-gm-resources.aki-game.com/aki/gacha/index.html#/record?player_id=123456';
  stubs.gamePathErr = new Error('无法自动定位游戏路径');
  const res = await ipcHandlers['refresh-gacha-records'](makeEvent());
  assert.strictEqual(res.success, false);
  assert.ok(/无法自动定位游戏路径/.test(res.error || ''));
});

test('get-treasure-boxes: 传入 playerId 直接复用', async () => {
  stubs.lastTreasurePid = undefined;
  const res = await ipcHandlers['get-treasure-boxes'](makeEvent(), '555666');
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.boxes.length, 1);
  assert.strictEqual(res.level, 7);
  assert.strictEqual(stubs.lastTreasurePid, '555666');
});

test('get-treasure-boxes: 不传 playerId 时回退查最新 UID', async () => {
  stubs.lastTreasurePid = undefined;
  dbMock.get = (sql, params, cb) => {
    if (typeof params === 'function') { cb = params; params = []; }
    if (cb) cb(null, { player_id: '777888' });
    return Promise.resolve({ player_id: '777888' });
  };
  const res = await ipcHandlers['get-treasure-boxes'](makeEvent());
  assert.strictEqual(res.success, true);
  assert.strictEqual(stubs.lastTreasurePid, '777888');
});

test('get-treasure-boxes: 拉取异常时返回失败', async () => {
  stubs.treasureThrow = true; // 让已捕获的 kujiequTreasure 桩抛出
  const res = await ipcHandlers['get-treasure-boxes'](makeEvent(), '1');
  assert.strictEqual(res.success, false);
  assert.ok(/本地登录态失效/.test(res.error || ''));
});
