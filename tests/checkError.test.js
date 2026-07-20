require('./_mocks');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ipcHandlers, dbMock } = require('./_mocks');
require('../src/core/services/settings/checkError'); // 注册 check-errors handler

// checkError 使用 db(dbMock) 与 db2(dbMock)，二者为同一 mock

// ---------- 场景 1：无过期缓存、无重复 → 提示无需整理 ----------
test('check-errors 无数据变动时提示无需整理', async () => {
  dbMock.run = (sql, params, cb) => { if (cb) cb.call({ changes: 0 }, null); return Promise.resolve({ changes: 0 }); };
  const msg = await ipcHandlers['check-errors']();
  assert.equal(msg, '没有需要整理的数据');
});

// ---------- 场景 2：清理了过期缓存与重复记录 → 汇总提示 ----------
test('check-errors 汇总清理数量', async () => {
  let seq = 0;
  dbMock.run = (sql, params, cb) => {
    seq++;
    const changes = seq === 1 ? 2 : 5; // 第一次(缓存)=2，第二次(去重)=5
    if (cb) cb.call({ changes }, null);
    return Promise.resolve({ changes });
  };
  const msg = await ipcHandlers['check-errors']();
  assert.match(msg, /已清理 2 条过期缓存数据/);
  assert.match(msg, /已移除 5 条重复抽卡记录/);
});
