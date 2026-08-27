const { ipcMain, clipboard } = require('electron');
const path = require('path');
const { db2, getSetting, setSetting } = require('../../app/database'); // 引入数据库实例
const { parseGachaUrl, fetchAllGachaLogs } = require('./gachaUtils'); // 工具方法
const { getGamePath, extractGachaUrl } = require("./getWutheringWavesPath"); // 获取游戏路径和唤取链接
const { getGachaUrlFromGameLogs, locateGameDir } = require("./gameLogReader"); // 鸣潮内获取：从游戏日志解析唤取链接
const gachaDb = db2; // 数据库实例
const { getTreasureBoxes, listTreasureAccounts, getMainAccount, getGameAccountState } = require('./kujiequTreasure'); // 复用官方启动器本地登录态拉取奇藏数据

// 将 gachaDb 的同步 API 封装为 Promise（保持 await 兼容）
function dbGet(sql, params = []) {
    try { return Promise.resolve(gachaDb.prepare(sql).get(...params)); }
    catch (err) { return Promise.reject(err); }
}
function dbAll(sql, params = []) {
    try { return Promise.resolve(gachaDb.prepare(sql).all(...params)); }
    catch (err) { return Promise.reject(err); }
}

// get-gacha-records 内存缓存（独立模块，供 refresh/import/deleteUID 共用失效方法）
const gachaRecordsCache = require('./gachaRecordsCache');
const cacheGet = gachaRecordsCache.get;
const cacheSet = gachaRecordsCache.set;
const invalidateGachaRecordsCache = gachaRecordsCache.invalidate;

// 导入其他抽卡分析IPC
require('./deleteUID');
require('./commonitems');
require('./gachaAvatarIpc'); // 角色/武器头像本地文件夹解析


/**
 * 获取上次查询的玩家 UID
 * 优先返回用户主动选择并持久化的 UID（lastSelectedUid）；
 * 若该值缺失或已不在账号列表中，则退回数据库里最新抽卡记录对应的账号。
 */
ipcMain.handle('get-last-query-uid', async () => {
    try {
        const saved = getSetting('lastSelectedUid');
        const savedUid = (saved && saved !== 'false') ? saved : null;
        if (savedUid != null) {
            // player_id 是 TEXT 列，必须用字符串匹配，转 Number 会查不到导致退回最新账号
            const exists = await dbGet('SELECT 1 FROM gacha_logs WHERE player_id = ? LIMIT 1', [String(savedUid)]);
            if (exists) return String(savedUid);
        }
        const row = await dbGet('SELECT player_id FROM gacha_logs ORDER BY timestamp DESC LIMIT 1');
        return row ? row.player_id : null;
    } catch (err) {
        console.error('Error fetching last query UID:', err);
        return null;
    }
});

/**
 * 持久化用户主动选择的 UID，使程序重启后仍能恢复到上次退出的账号页面。
 */
ipcMain.handle('set-last-query-uid', async (event, uid) => {
    try {
        setSetting('lastSelectedUid', String(uid));
        return true;
    } catch (err) {
        console.error('Error saving last query UID:', err);
        return false;
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
        // 支持按账号查询，避免多账号时把全库记录都传到渲染进程再过滤。
        // 注意：gacha_logs.player_id 列是 TEXT，库里存的是字符串（如 '129799920'）。
        // 渲染进程可能传入数字（来自 URL 解析 / Number() 转换），绑定 INTEGER 到 TEXT 列时
        // SQLite 按存储类比较（INTEGER < TEXT）导致查不到记录，界面显示「暂无数据」。
        // 必须统一转成 String 再绑定，才能命中 TEXT 列上的字符串值。
        const pid = playerId != null && playerId !== '' ? String(playerId) : null;
        const cacheKey = pid != null ? pid : '';
        const cached = cacheGet(cacheKey);
        if (cached !== undefined) return cached;
        // 排序必须带 id 作为同一时间戳（十连）的稳定 tie-breaker：
        // 仅用 timestamp DESC 时，同一秒内多条记录按 rowid 正序返回，正好与真实抽取顺序相反，
        // 导致五星进度条/已垫抽数算错（对比备份版 ORDER BY id DESC，结果一致的正确值）。
        const sql = pid != null
            ? 'SELECT * FROM gacha_logs WHERE player_id = ? ORDER BY timestamp DESC, id DESC'
            : 'SELECT * FROM gacha_logs ORDER BY timestamp DESC, id DESC';
        const params = pid != null ? [pid] : [];
        const rows = await dbAll(sql, params); // 最新在前（渲染层约定：库内倒序即最新在前，reverse 后为时间正序）
        cacheSet(cacheKey, rows);
        return rows;
    } catch (err) {
        console.error('Error fetching gacha records:', err);
        return [];
    }
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
        const refreshSuccess = totalRecords !== 0;
        // 新记录已写入 gacha_logs，失效记录缓存，下次查询命中新数据
        if (refreshSuccess) invalidateGachaRecordsCache();
        if (!refreshSuccess) global.Notify(false, `链接可能已经过期，请尝试重新打开抽卡界面`);
        event.sender.send('gacha-records-updated', { success: refreshSuccess, totalRecords, newRecords, playerId: params.playerId });
        return { success: refreshSuccess, totalRecords, newRecords, playerId: params.playerId };
    } catch (err) {
        const errorMessage = (err instanceof Error) ? err.message : String(err);
        console.error("获取记录失败:", errorMessage);
        event.sender.send('gacha-records-status', `获取记录失败: ${errorMessage}`);
        global.Notify(false, errorMessage);
        return { success: false, error: errorMessage };
    }
});


/**
 * 鸣潮内获取：直接从本地游戏日志解析唤取链接后拉取记录。
 * 与「云鸣潮获取」互为两套独立入口，但拿到链接后的请求与统计算法完全复用现有逻辑。
 */
ipcMain.handle('import-gacha-from-game', async (event) => {
    try {
        event.sender.send('gacha-records-status', '正在从游戏日志读取唤取链接...');

        // 读取用户在设置中保存的游戏根目录（可为空，模块内部会自动扫描）。
        // getSetting 未找到时会返回字符串 "false"，需归一化为 null
        const _rootV = getSetting('gameRootDir');
        const savedPath = (!_rootV || _rootV === 'false') ? null : _rootV;

        const found = await getGachaUrlFromGameLogs(savedPath);
        if (!found.success || !found.url) {
            throw new Error(found.error || '未在游戏日志中找到唤取链接');
        }

        const gachaUrl = found.url;
        const safeUrl = gachaUrl.replace(/(player_id=)\d+/, '$1***').replace(/(authkey=)[^&]+/, '$1***');
        console.log('[鸣潮内获取] 游戏目录：', found.gameDir);
        console.log('[鸣潮内获取] 唤取链接（已脱敏）：', safeUrl);

        clipboard.writeText(gachaUrl);
        event.sender.send('gacha-records-status', '已从游戏内读取到唤取链接，已复制到剪贴板');

        // 以下完全走项目原有的请求与统计算法
        const params = parseGachaUrl(gachaUrl);
        const { totalRecords, newRecords, poolSummary } = await fetchAllGachaLogs(params, event);

        const poolCount = (poolSummary || '').split('，').filter(s => !s.endsWith('=0')).length;
        event.sender.send('gacha-records-status', `本次共查询到 ${totalRecords} 条记录，新增 ${newRecords} 条记录，涉及 ${poolCount} 个卡池。抽卡链接已复制到剪贴板`);

        const importSuccess = totalRecords !== 0;
        // 新记录已写入 gacha_logs，失效记录缓存，下次查询命中新数据
        if (importSuccess) invalidateGachaRecordsCache();
        if (!importSuccess) global.Notify(false, '链接可能已经过期，请在游戏内重新打开一次唤取记录');
        event.sender.send('gacha-records-updated', { success: importSuccess, totalRecords, newRecords, playerId: params.playerId });
        return { success: importSuccess, totalRecords, newRecords, playerId: params.playerId };
    } catch (err) {
        const errorMessage = (err instanceof Error) ? err.message : String(err);
        console.error('鸣潮内获取失败:', errorMessage);
        event.sender.send('gacha-records-status', `鸣潮内获取失败: ${errorMessage}`);
        global.Notify(false, errorMessage);
        return { success: false, error: errorMessage };
    }
});


/**
 * 自动探测鸣潮游戏目录：优先用设置里已保存的路径，否则走注册表/扫盘自动发现。
 * 设置页「鸣潮游戏目录」显示框在没有用户手动设置时，用此结果回填，让用户知道程序读到了哪里。
 */
ipcMain.handle('detect-wuthering-waves-path', async () => {
    try {
        // 已保存的手动路径优先
        const _dirV = getSetting('gameRootDir');
        const saved = (!_dirV || _dirV === 'false') ? null : _dirV;
        const dir = await locateGameDir(saved);
        return { success: true, path: dir || '' };
    } catch (err) {
        console.error("探测鸣潮目录失败:", err.message);
        return { success: false, path: '', error: err.message };
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
        return { success: true, boxes: data.boxes, level: data.level, uid: data.uid != null ? data.uid : null };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('获取奇藏数据失败:', msg);
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

// 读取游戏本地账号状态（游戏内 UID / 区服），无需启动鸣潮启动器。
// 优先用 settings.gameRootDir，未配置则从 getGamePath() 反推游戏根目录；都不存在则路径为空（不做硬编码默认）。
ipcMain.handle('get-game-account-state', async () => {
    try {
        const _gv = getSetting('gameRootDir');
        const gameRootDir = _gv || null;
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
