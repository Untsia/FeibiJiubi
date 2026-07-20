const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dayjs = require('dayjs');
const timezone = require('dayjs/plugin/timezone');
const utc = require('dayjs/plugin/utc');

dayjs.extend(utc);
dayjs.extend(timezone);
const chinaTimezone = 'Asia/Shanghai';


// 获取 feibijiubiFolderPath
const feibijiubiFolderPath = process.env.FEIBIJIUBI_FOLDER_PATH;
console.log('[DIAG-BE] feibijiubiFolderPath=', feibijiubiFolderPath);

const db = new sqlite3.Database(path.join(feibijiubiFolderPath, "feibijiubi.db"), (err) => {
    if (err) {
        console.error("Database connection failed:", err.message);
    } else {
        console.log("Connected to the database.");
    }
});
const db2 = new sqlite3.Database(path.join(feibijiubiFolderPath, "gacha_data.db"), (err) => {
    if (err) {
        console.error("Database connection failed:", err.message);
    } else {
        console.log("Connected to the database.");
    }
});


// 初始化数据库函数
function initializeDatabase() {
    db.serialize(() => {
        // 新增设置表
        db.run(`
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        `, (err) => {
            if (err) {
                console.error("Error creating settings table:", err.message);
            } else {
                console.log("Settings table created or already exists.");
            }
        });

        // 创建分析数据缓存表
        db.run(`
            CREATE TABLE IF NOT EXISTS analysis_cache (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                analysis_type TEXT NOT NULL,
                date DATE NOT NULL,
                data TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(analysis_type, date)
            )
        `, (err) => {
            if (err) console.error("Error creating analysis_cache table:", err.message);
            else console.log("Analysis cache table created or already exists.");
        });
    });
    db2.serialize(() => {
        db2.run(`
            CREATE TABLE IF NOT EXISTS gacha_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player_id TEXT NOT NULL,
                card_pool_type TEXT NOT NULL,
                resource_id TEXT,
                quality_level INTEGER,
                resource_type TEXT,
                name TEXT,
                count INTEGER,
                timestamp TEXT NOT NULL
            );
        `, (err) => {
            if (err) {
                console.error("Failed to initialize gacha_logs table:", err.message);
            } else {
                console.log("gacha_logs table initialized successfully.");
            }
        });
    });
}


function getSetting(key, callback) {
    db.get(`SELECT value FROM settings WHERE key = ?`, [key], (err, row) => {
        if (err) {
            console.error("Error fetching setting:", err);
            callback(err);
        } else {
            callback(null, row ? row.value : "false"); // 返回默认值 "false"
        }
    });
}


function setSetting(key, value, callback) {
    db.run(`INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, value], (err) => {
        if (err) {
            console.error("Error setting value:", err);
            callback(err);
        } else {
            callback(null);
        }
    });
}


// 导出数据库实例和初始化函数
module.exports = {
    db,
    db2,
    initializeDatabase,
    getSetting,
    setSetting,
};
