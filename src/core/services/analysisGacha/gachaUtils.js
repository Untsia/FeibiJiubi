const axios = require('axios'); // 使用 axios 代替 fetch
const https = require('https');
const { db2 } = require('../../app/database'); // 引入数据库
const db = db2;  // 数据库实例

// 模块级预编译插入语句（懒加载并缓存，避免每次刷新都重建 prepared statement）
const INSERT_SQL = `
    INSERT OR REPLACE INTO gacha_logs (player_id, card_pool_type, resource_id, quality_level, resource_type, name, count, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?);
`;
let _insertStmt = null;
function getInsertStmt() {
    if (!_insertStmt) _insertStmt = db.prepare(INSERT_SQL);
    return _insertStmt;
}
const { ipcMain } = require('electron');
// 唤取类型映射
const GACHA_TYPE_MAP = {
    1: "角色活动唤取",
    2: "武器活动唤取",
    3: "角色常驻唤取",
    4: "武器常驻唤取",
    5: "新手限定唤取",
    6: "新手自选唤取",
    7: "感恩定向唤取",
    8: "角色新旅唤取",
    9: "武器新旅唤取",
    10: "角色联动唤取",
    11: "武器联动唤取",
    12: "角色忆旅唤取",
    13: "武器忆旅唤取",
};

const BASE_URL = "https://gmserver-api.aki-game2.com/gacha/record/query";
const HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Content-Type": "application/json",
};

// 复用 keep-alive 连接，避免 13 个池子顺序请求时重复 TLS 握手带来的额外耗时
const gachaAxios = axios.create({
    headers: HEADERS,
    timeout: 20000,
    httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 1 }),
});

// 请求间隔，避免 API 限流（鸣潮 gacha API 对短时间内的连续请求容易返回空/限流）。
// 实测 120ms/200ms 都会触发限流丢池（表现为“数据显示不全”）；350ms 是此前验证过稳定的安全值。
// 配合下方「自适应冷却」：某池一旦被限流重试，下一池额外冷却，进一步杜绝丢池。
const POOL_REQUEST_INTERVAL_MS = 350;
// 限流重试后追加的冷却时间，给 API 限流窗口留出余量（避免下一池立刻又被限流）
const RATELIMIT_COOLDOWN_MS = 2000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 获取所有类型的唤取记录
 * @param {object} params 查询参数（不包含 cardPoolId）
 * @param event
 * @returns {Promise<object[]>} 唤取记录数组
 */
// 致命鉴权错误（链接过期 / authkey 失效 / 参数非法）：这类错误对所有卡池都必然同样失败，
// 继续遍历剩余卡池只会浪费时间（每个卡池 sleep 350ms），应在首次捕获时立即中止并返回最终结果。
function isFatalAuthError(err) {
    const status = err.response && err.response.status;
    // 4xx（除 429 限流外）一律视为致命鉴权/参数错误
    if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) return true;
    // 业务码非 0 且非限流类：authkey 失效 / 链接过期 / 签名错误
    const apiCode = err.apiCode;
    if (apiCode !== undefined && apiCode !== 0 && apiCode !== '0') {
        // -110 / -120 等常见为 authkey 过期；一律按致命处理（重试无意义）
        return true;
    }
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('authkey') || msg.includes('expired') || msg.includes('失效') || msg.includes('过期')) return true;
    return false;
}

async function fetchAllGachaLogs(params, event) {
    const allLogs = [];
    let totalNewRecords = 0; // 新增记录计数
    const poolSummary = [];  // 逐池结果汇总，用于刷新后回显
    let nextInterval = POOL_REQUEST_INTERVAL_MS; // 自适应间隔：限流重试后临时拉长

    // 循环遍历 GACHA_TYPE_MAP，查询每种类型的唤取记录
    for (const [cardPoolType, typeName] of Object.entries(GACHA_TYPE_MAP)) {
        console.log(`正在请求卡池类型 ${cardPoolType}: ${typeName}`);
        sendStatusToRenderer(event, `正在查询卡池: ${typeName}`);
        const currentParams = { ...params, cardPoolType: parseInt(cardPoolType, 10) };

        let gotLogs = [];
        try {
            // 获取当前卡池的所有记录
            gotLogs = await fetchGachaLogsByType(currentParams, event);
            gotLogs.forEach(log => {
                log.cardPoolType = typeName; // 使用定义的名称
            });

            allLogs.push(...gotLogs); // 将所有记录收集到 allLogs 数组中

            // 插入或更新记录（按倒序插入，且根据时间戳插入新数据）
            const newRecordsCount = await insertOrUpdateGachaLogs(gotLogs, params.playerId, event);
            totalNewRecords += newRecordsCount;
        } catch (err) {
            console.warn(`请求卡池类型 ${typeName} 时出错: ${err.message}`);
            sendStatusToRenderer(event, `卡池「${typeName}」获取失败: ${err.message}`);
            // 致命鉴权错误（链接过期 / authkey 失效）：对所有卡池都会同样失败，
            // 首次命中立即中止遍历，让上层直接返回失败结果，避免无意义地遍历全部卡池。
            if (isFatalAuthError(err)) {
                console.error(`卡池「${typeName}」出现致命鉴权错误，中止后续卡池遍历: ${err.message}`);
                sendStatusToRenderer(event, `链接可能已过期或失效，已中止请求`);
                throw err;
            }
            // 可重试条件：502 / 429 限流 / 5xx 服务错误 / 网络或超时错误（无 response）
            const status = err.response && err.response.status;
            const retryable = status === 502 || status === 429 || (typeof status === 'number' && status >= 500) || !err.response;
            if (retryable) {
                console.log(`可重试错误（status=${status || '网络/超时'}），尝试重试请求卡池类型 ${typeName}`);
                sendStatusToRenderer(event, `请求失败，尝试重试卡池类型 ${typeName}`);
                try {
                    const retryLogs = await retryFetch(currentParams, event);
                    retryLogs.forEach(log => (log.cardPoolType = typeName));
                    // 插入重试获取到的记录并统计新增记录数
                    const retryNewRecordsCount = await insertOrUpdateGachaLogs(retryLogs, params.playerId, event);
                    totalNewRecords += retryNewRecordsCount;
                    allLogs.push(...retryLogs);
                    gotLogs = retryLogs;
                    nextInterval = POOL_REQUEST_INTERVAL_MS + RATELIMIT_COOLDOWN_MS; // 刚被限流，下一池额外冷却
                } catch (retryErr) {
                    console.error(`重试卡池类型 ${typeName} 时依然失败: ${retryErr.message}`);
                    sendStatusToRenderer(event, `卡池「${typeName}」重试仍失败: ${retryErr.message}`);
                    // 重试失败若已是致命鉴权错误，同样中止遍历
                    if (isFatalAuthError(retryErr)) throw retryErr;
                }
            }
        }
        poolSummary.push({ type: typeName, count: gotLogs.length });

        // 自适应间隔：若上一步触发了限流重试，nextInterval 已临时拉长，给 API 限流窗口留余量
        await sleep(nextInterval);
        nextInterval = POOL_REQUEST_INTERVAL_MS; // 重置回基础安全间隔
    }

    const summaryText = poolSummary.map(s => `${s.type}=${s.count}`).join('，');
    console.log(`[GACHA-SUMMARY] 刷新汇总: ${summaryText}`);
    return { totalRecords: allLogs.length, newRecords: totalNewRecords, poolSummary: summaryText };
}



/**
 * 按单个类型查询唤取记录
 * @param {object} params 查询参数
 * @param event
 * @returns {Promise<object[]>} 返回单个卡池类型的唤取记录数组
 */
async function fetchGachaLogsByType(params, event) {
    try {
        const safeLog = { ...params, authkey: '***' };
        console.log(`[GACHA-REQ] 卡池类型 ${params.cardPoolType} 请求参数:`, JSON.stringify(safeLog));
        const response = await gachaAxios.post(BASE_URL, params);
        if (response.status !== 200) {
            const httpErr = new Error(`HTTP 状态码: ${response.status}`);
            httpErr.response = { status: response.status }; // 供上层判定致命鉴权错误
            throw httpErr;
        }
        const rd = response.data || {};
        const apiCode = rd.code;
        const dataList = Array.isArray(rd.data) ? rd.data : [];
        // API 业务码非 0（如限流/鉴权失效/参数错误）时抛出异常，交由上层重试或记录失败
        if (apiCode !== undefined && apiCode !== 0 && apiCode !== '0') {
            const bizErr = new Error(`API business code=${apiCode} message=${rd.message || '(无 message)'}`);
            bizErr.apiCode = apiCode; // 供上层判定致命鉴权错误时精确匹配业务码
            throw bizErr;
        }
        console.log(`[GACHA-RES] 卡池类型 ${params.cardPoolType}: http=${response.status} code=${apiCode} message=${rd.message} records=${dataList.length}`);
        sendStatusToRenderer(event, `卡池类型 ${params.cardPoolType} 获取到 ${dataList.length} 条记录`);
        return dataList;
    } catch (err) {
        global.Notify(false, `请求失败: ${err.message}`)
        console.error(`请求失败: ${err.message}`);
        throw err;
    }
}

/**
 * 尝试重试请求
 * @param {object} params 请求参数
 * @param event
 * @returns {Promise<object[]>} 重新请求并返回记录
 */
async function retryFetch(params, event) {
    const maxRetries = 3;
    let logs = [];
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            logs = await fetchGachaLogsByType(params, event);
            // 成功即返回：空数组表示该账号无此池记录，属正常响应，绝不可对空响应无限重试
            return logs;
        } catch (err) {
            const status = err.response && err.response.status;
            console.warn(`卡池类型 ${params.cardPoolType} 第 ${attempt} 次重试失败: ${err.message} (status=${status || '网络/超时'})`);
            sendStatusToRenderer(event, `卡池「${params.cardPoolType}」重试 ${attempt}/${maxRetries}: ${err.message}`);
            if (attempt < maxRetries) {
                await sleep(400 * attempt); // 指数退避，重点避让 429/5xx 限流
            }
        }
    }
    return logs; // 重试耗尽，返回最后一次结果（可能为空，交由上层记录为 0 条）
}

/**
 * 解析唤取链接，提取参数
 * @param {string} url 唤取链接
 * @returns {object} 解析后的参数
 */
function parseGachaUrl(url) {
    const parsedUrl = new URL(url);
    const queryParams = new URLSearchParams(parsedUrl.search);
    const fragmentParams = new URLSearchParams(parsedUrl.hash.split("?")[1] || "");

    const getParam = (keySnake, keyCamel) => {
        return queryParams.get(keySnake) || fragmentParams.get(keySnake) ||
               queryParams.get(keyCamel) || fragmentParams.get(keyCamel) || "";
    };

    return {
        playerId: getParam("player_id", "playerId"),
        cardPoolId: getParam("resources_id", "cardPoolId"),
        languageCode: getParam("lang", "languageCode") || "zh-Hans",
        serverId: getParam("svr_id", "serverId"),
        recordId: getParam("record_id", "recordId") || "0",
    };
}
/**
 * 插入获取到的唤取记录到数据库
 * @param {object[]} logs 需要插入的唤取记录数组
 * @param playerId
 * @param event
 */

// 插入获取到的唤取记录到数据库（按倒序插入）
async function insertGachaLogs(logs, playerId, event) {
    // 过滤掉没有时间戳的记录
    const validLogs = logs.filter(record => record.time);

    // 倒序插入数据（从数组最后一条记录开始插入），复用缓存的预编译语句
    const stmt = getInsertStmt();
    for (let i = validLogs.length - 1; i >= 0; i--) {
        const record = validLogs[i];
        stmt.run([
            playerId,            // 从 params 中获取 player_id
            record.cardPoolType, // 卡池类型名称
            record.resourceId,   // 资源 ID
            record.qualityLevel, // 物品质量
            record.resourceType, // 资源类型
            record.name,         // 物品名称
            record.count,        // 物品数量
            record.time          // 时间戳
        ]);
    }

    console.log(`${validLogs.length} 条记录成功插入数据库.`);
    const poolTypeLabel = validLogs.length > 0 ? validLogs[0].cardPoolType : '';
    sendStatusToRenderer(event, `${poolTypeLabel}成功更新${validLogs.length}条`);
}

// 一次性拉取某玩家所有卡池的最新时间戳，避免逐个卡池的 N+1 查询
async function getLatestTimestampsForPlayer(playerId) {
    // player_id 列是 INTEGER，playerId 可能来自 URL 是字符串，转 Number 确保节点 sqlite3 绑定匹配
    const pid = playerId != null && playerId !== '' ? Number(playerId) : null;
    return new Promise((resolve, reject) => {
        db.all(
            'SELECT card_pool_type, MAX(timestamp) AS latestTimestamp FROM gacha_logs WHERE player_id = ? GROUP BY card_pool_type',
            [pid],
            (err, rows) => {
                if (err) return reject(err);
                const map = {};
                (rows || []).forEach(r => { map[r.card_pool_type] = r.latestTimestamp; });
                resolve(map); // { [cardPoolType]: latestTimestamp }
            }
        );
    });
}

// 插入数据（按倒序插入，且只插入时间戳更新的数据）
async function insertOrUpdateGachaLogs(logs, playerId, event) {
    // 按卡池类型分组（playerId 固定）
    const groupedLogs = {};
    let newRecordsCount = 0; // 新增记录

    logs.forEach(record => {
        const key = record.cardPoolType;
        if (!groupedLogs[key]) {
            groupedLogs[key] = [];
        }
        groupedLogs[key].push(record);
    });

    // 一次性查询该玩家所有卡池的最新时间戳（避免 N+1 查询）
    const latestMap = await getLatestTimestampsForPlayer(playerId);

    // 遍历每个卡池类型，插入时间戳更新的记录
    for (const [cardPoolType, groupedRecords] of Object.entries(groupedLogs)) {
        const latestTimestamp = latestMap[cardPoolType] || null;

        const validRecords = groupedRecords.filter(record => {
            // 如果数据库中没有记录，或者时间戳更晚，则插入新记录
            return !latestTimestamp || new Date(record.time) > new Date(latestTimestamp);
        });

        if (validRecords.length > 0) {
            await insertGachaLogs(validRecords, playerId, event); // 批量插入符合条件的记录
            newRecordsCount += validRecords.length;
        }
    }
    return newRecordsCount;
}

function sendStatusToRenderer(event, message) {
    if (event && event.sender) {
        event.sender.send('gacha-records-status', message);
    } else {
        ipcMain.emit('gacha-records-status', message);
    }
}


module.exports = { parseGachaUrl, fetchAllGachaLogs, GACHA_TYPE_MAP };
