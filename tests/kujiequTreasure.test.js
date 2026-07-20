require('./_mocks');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getTreasureBoxes, decodeXor5, getRegion } = require('../src/core/services/analysisGacha/kujiequTreasure');
const { mockAxios, mockElectron } = require('./_mocks');

// ---------- 场景 1：decodeXor5 自反性（解密两次还原原文） ----------
test('decodeXor5 两次解密还原原文', () => {
  const s = 'Hello, 库洛! 123';
  assert.equal(decodeXor5(decodeXor5(s)), s);
});

// ---------- 场景 2：decodeXor5 对 null / 非字符串原样返回 ----------
test('decodeXor5 对 null 与非字符串安全返回', () => {
  assert.equal(decodeXor5(null), null);
  assert.equal(decodeXor5(123), 123);
  assert.equal(decodeXor5(''), '');
});

// ---------- 场景 3：getRegion 各首位 UID 映射到正确区服 ----------
test('getRegion 按 UID 首位识别国服/国际服', () => {
  assert.deepEqual(getRegion('1xxxxx'), { key: 'China', isGlobal: false });
  assert.deepEqual(getRegion('6xxxxx'), { key: 'Eu', isGlobal: true });
  assert.deepEqual(getRegion('7xxxxx'), { key: 'Asia', isGlobal: true });
  assert.deepEqual(getRegion('8xxxxx'), { key: 'HMT', isGlobal: true });
  assert.deepEqual(getRegion('9xxxxx'), { key: 'SEA', isGlobal: true });
  assert.equal(getRegion(''), null);
  assert.equal(getRegion('3xxxxx'), null); // 非鸣潮 UID 首位
  assert.equal(getRegion(null), null);
});

// ---------- 场景 4：getTreasureBoxes 缺少 playerId 抛错 ----------
test('getTreasureBoxes 无 playerId 抛错', async () => {
  await assert.rejects(() => getTreasureBoxes(''), /未提供玩家 ID/);
});

// ---------- 场景 5：getTreasureBoxes 无法识别区服抛错 ----------
test('getTreasureBoxes 无法识别区服抛错', async () => {
  await assert.rejects(() => getTreasureBoxes('3xxxxx'), /无法识别玩家服务器/);
});

// ---------- 场景 6：getTreasureBoxes 正常路径（APPDATA 缓存 + queryRole） ----------
test('getTreasureBoxes 正常返回七类宝箱与等级', async () => {
  // 准备本地启动器缓存（国服 KR_G152）
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'feibijiubi-appdata-'));
  const accDir = path.join(appData, 'KR_G152', 'someAccount');
  fs.mkdirSync(accDir, { recursive: true });
  fs.writeFileSync(
    path.join(accDir, 'KRSDKUserLauncherCache.json'),
    JSON.stringify([{ oauthCode: 'dummyCode' }])
  );
  process.env.APPDATA = appData;

  // 模拟 queryRole 返回
  mockAxios.post = async () => ({
    data: {
      code: 200,
      data: {
        China: JSON.stringify({
          Base: {
            BasicBoxes: { '1': 11, '2': 22, '3': 33, '4': 44 },
            PhantomBoxes: { '1': 55, '2': 66, '3': 77 },
            Name: 'TestPlayer',
            Level: 70,
          },
        }),
      },
    },
  });

  const res = await getTreasureBoxes('123456');
  assert.deepEqual(res.boxes, {
    朴素: 11, 基准: 22, 精密: 33, 辉光: 44,
    潮汐绿: 55, 潮汐紫: 66, 潮汐金: 77,
  });
  assert.equal(res.level, 70);
});
