// 数据库连接与初始化（better-sqlite3，同步 API）
// 原 src/core/app/database.js → TypeScript 迁移，行为逐行保持一致。
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// 数据库目录必须跟随 FEIBIJIUBI_FOLDER_PATH（由 dataFile.js 在 main.js 中先于本模块设置），
// 即默认的 <userData>\FeibiJiubi 或用户自定义的数据目录。此前误改为 userData 下的
// 'feibijiubi' 子目录，导致应用打开全新的空库、读不到已有抽卡数据（"数据不见了"）。
const FULL_DB_PATH: string = process.env.FEIBIJIUBI_FOLDER_PATH || path.join(app.getPath('userData'), 'FeibiJiubi');

// 确保数据库目录存在
fs.mkdirSync(FULL_DB_PATH, { recursive: true });

const DB_PATH = path.join(FULL_DB_PATH, 'feibijiubi.db');
const DB2_PATH = path.join(FULL_DB_PATH, 'gacha_data.db');

// ——— 旧开发环境数据一次性迁移（必须在打开主库之前，避免覆盖已打开的 db 文件）———
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
  let gachaRows: any = -1, nativePath: any = 'unknown', nativeOk = false;
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
function initializeDatabase(): void {
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

  // 按账号取记录时的排序索引：analysisIpc 的查询形如
  //   WHERE player_id = ? ORDER BY timestamp DESC, id DESC
  // 仅有 (player_id, card_pool_type) 时，过滤能用上索引，排序仍需 filesort。
  db2.exec(`
    CREATE INDEX IF NOT EXISTS idx_gacha_logs_player_id_time
      ON gacha_logs (player_id, timestamp DESC, id DESC);
  `);

  // 不带 WHERE 的全库排序（如 `ORDER BY timestamp DESC LIMIT 1` 取最近一条），
  // 缺此索引会退化成全表扫描 + 排序。
  db2.exec(`
    CREATE INDEX IF NOT EXISTS idx_gacha_logs_time
      ON gacha_logs (timestamp DESC);
  `);

  // 数据完整性自愈（历史缺陷处理）：详见原 JS 注释。
  // 这里只做两件无害的事：
  //  ①修正 resource_id 的 '.0' 尾缀脏数据（ResourceId 被数值化后的序列化残留）；
  //  ②删除历史版本在建导出的唯一索引（存在则删）。
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
  const defaults: Array<[string, string]> = [
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
  const tx = db.transaction((rows: Array<[string, string]>) => { for (const r of rows) stmt.run(r[0], r[1]); });
  try { tx(defaults); } catch (e) { console.warn('[db] seed defaults 失败（可忽略）：', e && e.message); }
}

/**
 * 读取设置（同步 API，外面包一层 Promise 便于 await）
 */
// 预编译高频语句。原实现每次调用都 db.prepare()，重复编译同一条 SQL；
// 设置读写在启动阶段被密集调用，缓存后可省掉这些编译开销。
let _stmtGetSetting: any = null;
let _stmtSetSetting: any = null;

function getSetting(key: string, callback?: (err: Error | null, value?: string | null) => void): string | null {
  try {
    if (!_stmtGetSetting) _stmtGetSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
    const row = _stmtGetSetting.get(key);
    const value = row ? row.value : null;
    if (callback) callback(null, value);
    return value;
  } catch (err) {
    if (callback) callback(err as Error);
    throw err;
  }
}

/**
 * 写入设置（同步 API）
 */
function setSetting(key: string, value: string, callback?: (err: Error | null) => void): void {
  try {
    if (!_stmtSetSetting) _stmtSetSetting = db.prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    _stmtSetSetting.run(key, value);
    if (callback) callback(null);
  } catch (err) {
    if (callback) callback(err as Error);
    throw err;
  }
}

module.exports = {
  db,
  db2,
  initializeDatabase,
  getSetting,
  setSetting,
};