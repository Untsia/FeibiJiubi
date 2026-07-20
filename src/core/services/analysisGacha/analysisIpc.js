const { ipcMain, clipboard } = require('electron');
const { db2, getSetting, setSetting } = require('../../app/database'); // 引入数据库实例
const { parseGachaUrl, fetchAllGachaLogs } = require('./gachaUtils'); // 工具方法
const { getGamePath, extractGachaUrl } = require("./getWutheringWavesPath"); // 获取游戏路径和唤取链接
const gachaDb = db2; // 数据库实例
const { getTreasureBoxes, listTreasureAccounts, getAccountInfo, getMainAccount, getGameAccountState } = require('./kujiequTreasure'); // 复用官方启动器本地登录态拉取奇藏数据

// 将 gachaDb 的回调式 API 封装为 Promise，消除重复的 new Promise 样板
function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => gachaDb.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
}
function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => gachaDb.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
}

// 导入其他抽卡分析IPC
require('./deleteUID');
require('./commonitems');
require('./gachaAvatarIpc'); // 角色/武器头像本地文件夹解析


/**
 * 获取上次查询的玩家 UID
 */
ipcMain.handle('get-last-query-uid', async () => {
    try {
        const row = await dbGet('SELECT player_id FROM gacha_logs ORDER BY timestamp DESC LIMIT 1');
        return row ? row.player_id : null;
    } catch (err) {
        console.error('Error fetching last query UID:', err);
        return null;
    }
});

/**
 * 获取所有玩家 UID
 */
ipcMain.handle('get-player-uids', async () => {
    try {
        const rows = await dbAll('SELECT DISTINCT player_id FROM gacha_logs');
        return rows.map(row => row.player_id);
    } catch (err) {
        console.error('Error fetching player UIDs:', err);
        return [];
    }
});

/**
 * 获取所有唤取记录
 */
// 获取唤取记录
ipcMain.handle('get-gacha-records', async (event, playerId) => {
    try {
        // 支持按账号查询，避免多账号时把全库记录都传到渲染进程再过滤
        const sql = playerId
            ? 'SELECT * FROM gacha_logs WHERE player_id = ? ORDER BY id DESC'
            : 'SELECT * FROM gacha_logs ORDER BY id DESC';
        const params = playerId ? [playerId] : [];
        const rows = await dbAll(sql, params); // 按插入顺序倒序获取
        return rows;
    } catch (err) {
        console.error('Error fetching gacha records:', err);
        return [];
    }
});

// [DIAG] 返回程序实际连接的抽卡数据库路径与记录数，用于定位“刷新后只剩一种池子”的根因
ipcMain.handle('get-db-info', async () => {
    const folderPath = process.env.FEIBIJIUBI_FOLDER_PATH || '(unset)';
    const dbPath = require('path').join(folderPath, 'gacha_data.db');
    let count = -1, pools = [];
    try {
        const c = (await dbAll('SELECT COUNT(*) AS c FROM gacha_logs'))[0];
        count = c ? c.c : -1;
        pools = await dbAll('SELECT card_pool_type, COUNT(*) AS n FROM gacha_logs GROUP BY card_pool_type');
    } catch (e) { console.error('[DIAG] get-db-info err', e); }
    console.log('[DIAG-BE] get-db-info folder=', folderPath, 'path=', dbPath, 'count=', count, 'pools=', JSON.stringify(pools));
    return { folderPath, dbPath, count, pools };
});


/**
 * 刷新唤取记录
 */
ipcMain.handle('refresh-gacha-records', async (event) => {
    try {
        event.sender.send('gacha-records-status', '正在获取抽卡记录...');

        // 从游戏日志自动读取唤取链接
        const gamePath = await getGamePath();
        const gachaUrl = await extractGachaUrl(gamePath);

        if (!gachaUrl) throw new Error('未找到唤取链接');
        const safeUrl = gachaUrl.replace(/(player_id=)\d+/, '$1***').replace(/(authkey=)[^&]+/, '$1***');
        console.log("从日志获取的抽卡链接为（已脱敏）：", safeUrl);
        clipboard.writeText(gachaUrl);
        event.sender.send('gacha-records-status', '获取到抽卡链接，已复制到剪贴板');

        const params = parseGachaUrl(gachaUrl);
        const { totalRecords, newRecords, poolSummary } = await fetchAllGachaLogs(params, event);

        // 仅告知涉及几个卡池、共多少条记录，不逐一列举（诊断明细保留在终端 [GACHA-SUMMARY] 日志）
        const poolCount = (poolSummary || '').split('，').filter(s => !s.endsWith('=0')).length;
        event.sender.send('gacha-records-status', `本次共查询到 ${totalRecords} 条记录，新增 ${newRecords} 条记录，涉及 ${poolCount} 个卡池。抽卡链接已复制到剪贴板`);
        if (totalRecords === 0){
            global.Notify(false, `链接可能已经过期，请尝试重新打开抽卡界面`);
            event.sender.send('gacha-records-updated', { success: false, totalRecords, newRecords, playerId: params.playerId });
            return { success: false, totalRecords, newRecords, playerId: params.playerId };
        }else {
            event.sender.send('gacha-records-updated', { success: true, totalRecords, newRecords, playerId: params.playerId });
            return { success: true, totalRecords, newRecords, playerId: params.playerId };
        }
    } catch (err) {
        const errorMessage = (err instanceof Error) ? err.message : String(err);
        console.error("获取记录失败:", errorMessage);
        event.sender.send('gacha-records-status', `获取记录失败: ${errorMessage}`);
        global.Notify(false, errorMessage);
        return { success: false, error: errorMessage };
    }
});


// 获取鸣潮路径
ipcMain.handle('get-wuthering-waves-gacha-url', async () => {
    try {
        const gamePath = await getGamePath(); // 调用更新后的函数
        const gachaUrl = await extractGachaUrl(gamePath);
        return { success: true, gachaUrl };
    } catch (err) {
        console.error("获取唤取链接失败:", err.message);
        return { success: false, error: err.message };
    }
});

/**
 * 复用官方鸣潮启动器本地登录态，拉取当前账号的奇藏宝箱 / 潮汐之遗数据
 */
ipcMain.handle('get-treasure-boxes', async (event, playerId) => {
    try {
        let pid = playerId;
        let oauthCode = null;
        let isGlobal = null;
        if (playerId && typeof playerId === 'object') {
            oauthCode = playerId.oauthCode || null;
            pid = playerId.playerId || null;
            isGlobal = playerId.isGlobal != null ? playerId.isGlobal : null;
        }
        if (!pid) {
            const row = await dbGet('SELECT player_id FROM gacha_logs ORDER BY timestamp DESC LIMIT 1');
            pid = row ? row.player_id : null;
        }
        // pid 为 null 时 getTreasureBoxes 自动用启动器本地登录态定位主账号（免 UID）
        const data = await getTreasureBoxes(pid, oauthCode, isGlobal);
        return { success: true, boxes: data.boxes, level: data.level };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('获取奇藏数据失败:', msg);
        return { success: false, error: msg };
    }
});

// 拉取账号信息面板数据（头像/昵称/等级/体力/活跃天数/通行证/宝箱），免 UID 自动定位主账号
ipcMain.handle('get-account-info', async (event, arg) => {
    try {
        let oauthCode = null, isGlobal = null;
        if (arg && typeof arg === 'object') { oauthCode = arg.oauthCode || null; isGlobal = arg.isGlobal != null ? arg.isGlobal : null; }
        const info = await getAccountInfo(oauthCode, isGlobal);
        return { success: true, info };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('获取账号信息失败:', msg);
        return { success: false, error: msg };
    }
});

// 返回启动器本地缓存中的主账号（用于免 UID 自动同步）
ipcMain.handle('get-main-account', async () => {
    try {
        const m = getMainAccount();
        return { success: !!m, account: m };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('获取主账号失败:', msg);
        return { success: false, error: msg };
    }
});

// 列出当前抽卡 UID 对应区服下所有启动器登录态账号，供前端同步账号选择框使用
ipcMain.handle('list-treasure-accounts', async (event, playerId) => {
    try {
        let pid = null, isGlobal = null;
        if (playerId && typeof playerId === 'object') {
            pid = playerId.playerId || null;
            isGlobal = playerId.isGlobal != null ? playerId.isGlobal : null;
        } else {
            pid = playerId;
        }
        const list = await listTreasureAccounts(pid, isGlobal);
        return { success: true, accounts: list };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('列出奇藏账号失败:', msg);
        return { success: false, error: msg };
    }
});

// 读取游戏本地账号状态（游戏内 UID / 区服），无需启动鸣潮启动器。
// 优先用 settings.gameRootDir，未配置则从 getGamePath() 反推游戏根目录；都不存在则路径为空（不做硬编码默认）。
ipcMain.handle('get-game-account-state', async () => {
    try {
        const gameRootDir = await new Promise((resolve) =>
            getSetting('gameRootDir', (err, v) => resolve((!err && v) ? v : null)));
        let root = gameRootDir || '';
        if (!gameRootDir) {
            try {
                const logPath = await getGamePath();
                if (logPath) root = path.resolve(logPath, '..', '..', '..', '..');
            } catch (e) { /* 无日志路径时保持为空，前端按未配置处理 */ }
        }
        const state = getGameAccountState(root);
        return { success: true, gameRootDir: root, state };
    } catch (e) {
        return { success: false, error: e.message };
    }
});
