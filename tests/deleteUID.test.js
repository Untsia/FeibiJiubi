require('./_mocks');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ipcHandlers, dbMock } = require('./_mocks');
require('../src/core/services/analysisGacha/deleteUID'); // 注册 delete-gacha-records handler

// ---------- 场景 1：table 参数已移除，固定删除 gacha_logs（传入任意表名均忽略） ----------
test('delete-gacha-records 忽略传入的 table 参数，固定删除 gacha_logs', async () => {
  let captured = null;
  dbMock.run = (sql, params, cb) => {
    captured = { sql, params };
    if (cb) cb.call({ changes: 1 }, null);
    return Promise.resolve({ changes: 1 });
  };
  const res = await ipcHandlers['delete-gacha-records'](null, 'uid123', 'users');
  assert.equal(res.success, true);
  assert.match(captured.sql, /DELETE FROM gacha_logs WHERE player_id = \?/);
  assert.deepEqual(captured.params, ['uid123']);
});

// ---------- 场景 2：合法表名执行删除并返回成功 ----------
test('delete-gacha-records 合法表名执行删除', async () => {
  let captured = null;
  dbMock.run = (sql, params, cb) => {
    captured = { sql, params };
    if (cb) cb.call({ changes: 3 }, null);
    return Promise.resolve({ changes: 3 });
  };
  const res = await ipcHandlers['delete-gacha-records'](null, 'uid123', 'gacha_logs');
  assert.equal(res.success, true);
  assert.match(captured.sql, /DELETE FROM gacha_logs WHERE player_id = \?/);
  assert.deepEqual(captured.params, ['uid123']);
});

// ---------- 场景 3：DB 报错时返回失败信息 ----------
test('delete-gacha-records DB 异常返回失败', async () => {
  dbMock.run = (sql, params, cb) => {
    if (cb) cb(new Error('disk error'));
    return Promise.resolve();
  };
  const res = await ipcHandlers['delete-gacha-records'](null, 'uid123', 'gacha_logs');
  assert.equal(res.success, false);
  assert.match(res.message, /删除失败/);
});
