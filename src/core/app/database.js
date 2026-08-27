const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { app } = require('electron');

dayjs.extend(utc);
dayjs.extend(timezone);

// 数据库目录必须跟随 FEIBIJIUBI_FOLDER_PATH（由 dataFile.js 在 main.js 中先于本模块设置），
// 即默认的 <userData>\FeibiJiubi 或用户自定义的数据目录。此前误改为 userData 下的
// 'feibijiubi' 子目录，导致应用打开全新的空库、读不到已有抽卡数据（"数据不见了"）。
const FULL_DB_PATH = process.env.FEIBIJIUBI_FOLDER_PATH || path.join(app.getPath('userData'), 'FeibiJiubi');

// 确保数据库目录存在
fs.mkdirSync(FULL_DB_PATH, { recursive: true });

const DB_PATH = path.join(FULL_DB_PATH, 'feibijiubi.db');
const DB2_PATH = path.join(FULL_DB_PATH, 'gacha_data.db');

// ——— 旧开发环境数据一次性迁移（必须在打开主库之前，避免覆盖已打开的 db 文件）———
// 统一 userData 根目录后（main.js 里强制为 %APPDATA%\feibijiubi），老的 npm start 数据
// 可能还躺在 %APPDATA%\Electron\FeibiJiubi。首次启动且当前库数据比旧库少时，把旧库
// 整体复制过来（带 _legacy_dev_migrated.flag 标记，只迁移一次；旧库有更多数据才执行，
// 绝不覆盖比自己新的数据）。
const LEGACY_DEV_PATH = path.join(app.getPath('appData'), 'Electron', 'FeibiJiubi');
try {
  const flagFile = path.join(FULL_DB_PATH, '_legacy_dev_migrated.flag');
  const legacyDbPath = path.join(LEGACY_DEV_PATH, 'gacha_data.db');
  if (!fs.existsSync(flagFile) && fs.existsSync(legacyDbPath)) {
    let cur = 0, legacy = 0;
    try {
      if (fs.existsSync(DB2_PATH)) {
        const rc = new Database(DB2_PATH, { readonly: true });
        cur = rc.prepare('SELECT COUNT(*) AS c FROM gacha_logs').get().c;
        rc.close();
      }
      const rl = new Database(legacyDbPath, { readonly: true });
      legacy = rl.prepare('SELECT COUNT(*) AS c FROM gacha_logs').get().c;
      rl.close();
    } catch (e) { /* 旧库损坏/表缺失时跳过迁移 */ }
    if (legacy > 0 && cur < legacy) {
      fs.cpSync(LEGACY_DEV_PATH, FULL_DB_PATH, { recursive: true, force: true });
      try {
        const lg = path.join(app.getPath('logs'), 'feibijiubi-db-boot.log');
        fs.appendFileSync(lg, `[${new Date().toISOString()}] MIGRATED legacy dev data: ${LEGACY_DEV_PATH} (${cur} -> ${legacy}) -> ${FULL_DB_PATH}\n`);
      } catch (_) {}
      console.log(`已从旧开发数据目录迁移抽卡数据: ${LEGACY_DEV_PATH} (${cur} -> ${legacy})`);
    }
    try { fs.writeFileSync(flagFile, String(Date.now()), 'utf8'); } catch (_) {}
  }
} catch (_) {}

// better-sqlite3 同步实例（NAPI，跨 Electron 版本兼容）
const db = new Database(DB_PATH);
const db2 = new Database(DB2_PATH);

// 基础 PRAGMA 设置
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db2.pragma('journal_mode = WAL');
db2.pragma('foreign_keys = ON');

// 启动自检：落盘数据目录 / native 模块路径 / gacha_logs 行数，
// 用于排查「npm start 有数据、安装版没数据」这类数据分家问题。
try {
  const lg = path.join(app.getPath('logs'), 'feibijiubi-db-boot.log');
  let gachaRows = -1, nativePath = 'unknown', nativeOk = false;
  try {
    const np = require.resolve('better-sqlite3', { paths: [__dirname] });
    nativePath = np;
    nativeOk = true;
  } catch (e) { nativePath = 'resolve-fail: ' + (e && e.message); }
  try {
    const t = db2.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gacha_logs'").get();
    const c = db2.prepare('SELECT COUNT(*) AS c FROM gacha_logs').get();
    gachaRows = t ? c.c : -2;
  } catch (e) { gachaRows = -3; }
  fs.appendFileSync(lg, `[${new Date().toISOString()}] FOLDER_PATH=${process.env.FEIBIJIUBI_FOLDER_PATH} FULL_DB_PATH=${FULL_DB_PATH} gacha_logs=${gachaRows} native=${nativeOk ? 'OK' : 'FAIL'} nativePath=${nativePath} packaged=${app.isPackaged}\n`);
} catch (_) {}

/**
 * 初始化数据库表结构
 */
function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  db2.exec(`
    CREATE TABLE IF NOT EXISTS gacha_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id TEXT,
      card_pool_type TEXT,
      resource_id TEXT,
      quality_level INTEGER,
      resource_type TEXT,
      name TEXT,
      count INTEGER,
      timestamp INTEGER
    );
  `);

  // gacha_logs 按账号高频查询（get-gacha-records WHERE player_id、get-player-uids、
  // refresh 里的 latestTimestamp GROUP BY），复合索引覆盖 player_id + 卡池分组，
  // 避免每次全表扫描；左前缀 player_id 同时加速所有按账号的单卡过滤。
  db2.exec(`
    CREATE INDEX IF NOT EXISTS idx_gacha_logs_player_id_card_pool_type
      ON gacha_logs (player_id, card_pool_type);
  `);

  // 数据完整性自愈（历史缺陷处理）：
  // 早期 getLatestTimestampsForPlayer / deleteUID 用 Number(playerId) 绑定 TEXT 列，
  // SQLite 类型比较（INTEGER < TEXT）永不相等 → 最新时间戳查不到 → 每次刷新把整池
  // 记录当全新数据全量重插 → gacha_logs 大量重复膨胀。
  // 修复需谨慎：gacha 记录没有唯一 ID，API 返回中「同一时间戳下同名同星级物品」可能
  // 是真实的多次抽取（一次十连抽到两把同名 3★ 武器会返回两条相同字段的记录）。
  // 因此绝不能按 (player_id, card_pool_type, resource_id, name, timestamp) 去重/建唯一
  // 索引——那会把真实抽取合并吞掉（数据变少，与游戏内对不上）。
  // 这里只做两件无害的事：
  //  ①修正 resource_id 的 '.0' 尾缀脏数据（ResourceId 被数值化后的序列化残留）；
  //  ②删除历史版本在建导出的唯一索引（存在则删，防止 INSERT OR REPLACE 把真实重复
  //   记录静默合并；删除后普通写入即可保留全部真实抽取）。
  // 重复膨胀的根因（Number 绑定）已在查询层修复，未来由增量时间戳过滤保证幂等。
  try {
    db2.prepare(`
      UPDATE gacha_logs
      SET resource_id = substr(resource_id, 1, length(resource_id) - 2)
      WHERE resource_id GLOB '*[0-9].0'
    `).run();
  } catch (e) {
    console.warn('[db] gacha_logs resource_id 修正失败（仅告警，不影响启动）：', e && e.message);
  }
  try {
    db2.prepare(`DROP INDEX IF EXISTS idx_gacha_logs_dedup`).run();
  } catch (e) {
    console.warn('[db] gacha_logs 残留唯一索引删除失败（仅告警，不影响启动）：', e && e.message);
  }

  db2.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT
    );
  `);

  console.log('数据库初始化成功');

  // 首次使用的默认值落库（INSERT OR IGNORE = 用户已经改过后不再覆盖）。
  //
  // ⚠️ 这是打包版"白屏 + 按钮死"的一个直接触发点：
  //
  // createWindow 里 getSetting('themeMode'/'colorTemp') 会在 loadURL 之前立刻读取，
  // 如果库空、返回 null，则 loadBackground(mainWindow) 的 executeJavaScript 拼接 CSS
  // 变量模板会把 undefined/null 直接塞进去，渲染进程首帧 parse JS 出错，
  // 后续 renderer.js 的 tab 绑定、IPCs 初始化、数据加载都不再执行——
  // 表现为「窗口只显示默认 backgroundColor 的纯色、内容区空白、所有按钮无响应」，
  // npm start 下因为开发期有历史数据而恰好绕过。
  const defaults = [
    ['themeMode', 'light'],
    ['colorTemp', 'warm'],
    ['glassEnabled', 'false'],
    ['backgroundBrightness', '50'],
    ['backgroundHidden', 'false'],
    ['closeAction', 'exit'],
    ['gameRootDir', ''],
    ['autoRefreshImport', 'false'],
    ['accentColor', '#7c83ff'],
  ];
  const stmt = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  const tx = db.transaction((rows) => { for (const r of rows) stmt.run(r[0], r[1]); });
  try { tx(defaults); } catch (e) { console.warn('[db] seed defaults 失败（可忽略）：', e && e.message); }
}

/**
 * 读取设置（同步 API，外面包一层 Promise 便于 await）
 * @param {string} key 设置键
 * @param {function} [callback] 可选回调，兼容旧调用方
 */
function getSetting(key, callback) {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    const value = row ? row.value : null;
    if (callback) callback(null, value);
    return value;
  } catch (err) {
    if (callback) callback(err);
    throw err;
  }
}

/**
 * 写入设置（同步 API）
 * @param {string} key 设置键
 * @param {string} value 设置值
 * @param {function} [callback] 可选回调
 */
function setSetting(key, value, callback) {
  try {
    db.prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
    if (callback) callback(null);
  } catch (err) {
    if (callback) callback(err);
    throw err;
  }
}

function logUserActivity(uid, roleId, serverId) {
  const timestamp = dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss');
  db.prepare(`
    INSERT INTO user_activity (uid, role_id, server_id, last_login)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(uid) DO UPDATE SET last_login = excluded.last_login
  `).run(uid, roleId, serverId, timestamp);
}

function recordUpload(uid, fileName) {
  const timestamp = dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss');
  db.prepare(`
    INSERT INTO data_uploads (uid, file_name, upload_time)
    VALUES (?, ?, ?)
  `).run(uid, fileName, timestamp);
}

function getUploadHistory(callback) {
  try {
    const rows = db.prepare('SELECT * FROM data_uploads ORDER BY upload_time DESC').all();
    if (callback) callback(null, rows);
    return rows;
  } catch (err) {
    if (callback) callback(err);
    throw err;
  }
}

function getUploadStats(callback) {
  try {
    const row = db.prepare('SELECT COUNT(*) AS total_uploads, COUNT(DISTINCT uid) AS unique_users FROM data_uploads').get();
    if (callback) callback(null, row);
    return row;
  } catch (err) {
    if (callback) callback(err);
    throw err;
  }
}

function getActivityStats(callback) {
  try {
    const row = db.prepare('SELECT COUNT(*) AS total_users, COUNT(DISTINCT uid) AS unique_uids FROM user_activity').get();
    if (callback) callback(null, row);
    return row;
  } catch (err) {
    if (callback) callback(err);
    throw err;
  }
}

function getDataStats(callback) {
  try {
    const totalLogs = db2.prepare('SELECT COUNT(*) AS count FROM gacha_logs').get().count;
    const totalGames = db.prepare('SELECT COUNT(*) AS count FROM games').get().count;
    const result = { totalLogs, totalGames };
    if (callback) callback(null, result);
    return result;
  } catch (err) {
    if (callback) callback(err);
    throw err;
  }
}

function checkDatabase() {
  try {
    const result = db.prepare('SELECT name FROM sqlite_master WHERE type="table"').all();
    console.log('数据库表:', result);
    return result;
  } catch (err) {
    console.error('数据库检查失败:', err);
    throw err;
  }
}

module.exports = {
  db,
  db2,
  initializeDatabase,
  getSetting,
  setSetting,
  logUserActivity,
  recordUpload,
  getUploadHistory,
  getUploadStats,
  getActivityStats,
  getDataStats,
  checkDatabase
};
