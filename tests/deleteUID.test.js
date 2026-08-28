require('./_mocks');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ipcHandlers, dbMock } = require('./_mocks');
require('../.build/src/main/core/services/analysisGacha/deleteUID'); // 注册 delete-gacha-records handler

// ---------- 场景 1：table 参数已移除，固定删除 gacha_logs（传入任意表名均忽略） ----------
test('delete-gacha-records 忽略传入的 table 参数，固定删除 gacha_logs', async () => {
  let captured = null;
  dbMock.run = (sql, params, cb) => {
    captured = { sql, params };
    if (cb) cb.call({ changes: 1 }, null);
  };
  const res = await ipcHandlers['delete-gacha-records'](null, '123456', 'users');
  assert.equal(res.success, true);
  assert.match(captured.sql, /DELETE FROM gacha_logs WHERE player_id = \?/);
  // gacha_logs.player_id 列存 TEXT，必须用字符串绑定才能命中（Number 绑定 INTEGER 永不匹配）
  assert.deepEqual(captured.params, ['123456']);
});

// ---------- 场景 2：合法表名执行删除并返回成功 ----------
test('delete-gacha-records 合法表名执行删除', async () => {
  let captured = null;
  dbMock.run = (sql, params, cb) => {
    captured = { sql, params };
    if (cb) cb.call({ changes: 3 }, null);
  };
  const res = await ipcHandlers['delete-gacha-records'](null, '123456', 'gacha_logs');
  assert.equal(res.success, true);
  assert.match(captured.sql, /DELETE FROM gacha_logs WHERE player_id = \?/);
  // gacha_logs.player_id 列存 TEXT，必须用字符串绑定才能命中（Number 绑定 INTEGER 永不匹配）
  assert.deepEqual(captured.params, ['123456']);
});

// ---------- 场景 3：DB 报错时返回失败信息 ----------
test('delete-gacha-records DB 异常返回失败', async () => {
  // better-sqlite3 是同步 API：prepare().run() 直接 throw，这里覆盖 prepare 使其 run 抛错
  const origPrepare = dbMock.prepare;
  dbMock.prepare = (sql) => ({ run: () => { throw new Error('disk error'); }, finalize: () => {} });
  try {
    const res = await ipcHandlers['delete-gacha-records'](null, '123456', 'gacha_logs');
    assert.equal(res.success, false);
    assert.match(res.message, /删除失败/);
  } finally {
    dbMock.prepare = origPrepare; // 还原，避免影响其他用例
  }
});

// ---------- 场景 4：空/缺失 UID（健壮性）----------
test('delete-gacha-records 空 UID 返回失败而非静默成功', async () => {
  let ran = false;
  dbMock.run = (sql, params, cb) => { ran = true; if (cb) cb(null); };
  // 非空字符串（如 'uid123'）现在视为合法 UID（player_id 列就是 TEXT），
  // 只有 null / undefined / 空字符串 才是无效输入。
  const res = await ipcHandlers['delete-gacha-records'](null, null);
  assert.equal(res.success, false);
  assert.match(res.message, /无效的玩家 UID/);
  assert.equal(ran, false, '无效 UID 不应执行 DB 删除');
});
