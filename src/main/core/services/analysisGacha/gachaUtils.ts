// 抽卡数据获取与写入核心逻辑（原 src/core/services/analysisGacha/gachaUtils.js → TypeScript 迁移，行为逐行保持一致）
const axios = require('axios'); // 使用 axios 代替 fetch
const https = require('https');
const { db2 } = require('../../app/database'); // 引入数据库
const db = db2;  // 数据库实例

// 模块级预编译插入语句（懒加载并缓存，避免每次刷新都重建 prepared statement）
const INSERT_SQL = `
    INSERT OR REPLACE INTO gacha_logs (player_id, card_pool_type, resource_id, quality_level, resource_type, name, count, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?);
`;
let _insertStmt: any = null;
function getInsertStmt(): any {
    if (!_insertStmt) _insertStmt = db.prepare(INSERT_SQL);
    return _insertStmt;
}
const { ipcMain } = require('electron');
// 唤取类型映射
const GACHA_TYPE_MAP: Record<number, string> = {
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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 归一化 resource_id：API/数据库中可能存在 '21010043.0' 这类数值化序列残留。
// 若写入时与比对时不统一，同一真实抽取会被拆成两个不同 key（‘21010043’ 与 ‘21010043.0’），
// 导致「补齐真实重复」逻辑把已存在的记录再补插一遍，刷新一次多一条、数据与游戏内对不上。
// 统一规则：去掉尾缀 '.0'（资源 ID 均为数字，去掉后无歧义）。
function normalizeResourceId(id: any): string {
    if (id === null || id === undefined) return '';
    return String(id).replace(/\.0$/, '');
}

/**
 * 获取所有类型的唤取记录
 * @param {object} params 查询参数（不包含 cardPoolId）
 * @param event
 * @returns {Promise<object[]>} 唤取记录数组
 */
// 致命鉴权错误（链接过期 / authkey 失效 / 参数非法）：这类错误对所有卡池都必然同样失败，
// 继续遍历剩余卡池只会浪费时间（每个卡池 sleep 350ms），应在首次捕获时立即中止并返回最终结果。
function isFatalAuthError(err: any): boolean {
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

async function fetchAllGachaLogs(params: any, event: any): Promise<any> {
    const allLogs: any[] = [];
    let totalNewRecords = 0; // 新增记录计数
    const poolSummary: any[] = [];  // 逐池结果汇总，用于刷新后回显
    let nextInterval = POOL_REQUEST_INTERVAL_MS; // 自适应间隔：限流重试后临时拉长

    // 循环遍历 GACHA_TYPE_MAP，查询每种类型的唤取记录
    for (const [cardPoolType, typeName] of Object.entries(GACHA_TYPE_MAP)) {
        console.log(`正在请求卡池类型 ${cardPoolType}: ${typeName}`);
        sendStatusToRenderer(event, `正在查询卡池: ${typeName}`);
        const currentParams = { ...params, cardPoolType: parseInt(cardPoolType, 10) };

        let gotLogs: any[] = [];
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
                    const retryLogs: any[] = await retryFetch(currentParams, event);
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
async function fetchGachaLogsByType(params: any, event: any): Promise<any[]> {
    try {
        const safeLog = { ...params, authkey: '***' };
        console.log(`[GACHA-REQ] 卡池类型 ${params.cardPoolType} 请求参数:`, JSON.stringify(safeLog));
        const response = await gachaAxios.post(BASE_URL, params);
        if (response.status !== 200) {
            const httpErr: any = new Error(`HTTP 状态码: ${response.status}`);
            httpErr.response = { status: response.status }; // 供上层判定致命鉴权错误
            throw httpErr;
        }
        const rd = response.data || {};
        const apiCode = rd.code;
        const dataList = Array.isArray(rd.data) ? rd.data : [];
        // API 业务码非 0（如限流/鉴权失效/参数错误）时抛出异常，交由上层重试或记录失败
        if (apiCode !== undefined && apiCode !== 0 && apiCode !== '0') {
            const bizErr: any = new Error(`API business code=${apiCode} message=${rd.message || '(无 message)'}`);
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
async function retryFetch(params: any, event: any): Promise<any[]> {
    const maxRetries = 3;
    let logs: any[] = [];
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
function parseGachaUrl(url: string): any {
    const parsedUrl = new URL(url);
    const queryParams = new URLSearchParams(parsedUrl.search);
    const fragmentParams = new URLSearchParams(parsedUrl.hash.split("?")[1] || "");

    const getParam = (keySnake: string, keyCamel: string): string => {
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
// 插入/同步唤取记录到数据库（整池对账，以本次 API 返回为权威）
// 鸣潮记录页 API 只返回最近约 6 个月左右的记录窗口，且不会告知窗口边界。
// 若沿用「增量 + 补齐」策略，超出窗口的历史记录会一直残留在库里，
// 导致界面显示抽数比游戏内多（游戏内只展示窗口内记录）——这正是此前
// “应用比游戏多 / 抽数全都对不上” 的根因。
// 因此改为整池对账：某池本次 API 成功返回记录时，先清空该玩家该池的旧记录，
// 再按本次返回全量重插。API 是权威源，刷新一次后界面与游戏记录页完全一致，
// 同时自动修正历史残留问题（超出窗口的旧记录、重复膨胀、resource_id 的 '.0' 尾缀等）。
// 注：API 返回空数组（该池无记录）时不做任何操作——无法与限流导致的假空响应区分，
// 避免误删用户已有数据。
async function insertOrUpdateGachaLogs(logs: any[], playerId: any, event: any): Promise<number> {
    // 过滤掉没有时间戳的记录（API 正常返回均带 time，此为防御性保护）
    const validLogs = logs.filter(record => record.time);

    // 按卡池类型分组（playerId 固定）
    const groupedLogs: Record<string, any[]> = {};
    validLogs.forEach(record => {
        const key = record.cardPoolType;
        if (!groupedLogs[key]) {
            groupedLogs[key] = [];
        }
        groupedLogs[key].push(record);
    });

    // 注意：gacha_logs.player_id 列实际存的是 TEXT（插入时绑定的是 URL 解析出的字符串）。
    // 统一转 String 再绑定（与 analysisIpc get-gacha-records 的处理保持一致），
    // 避免 SQLite 类型比较（INTEGER < TEXT）导致 DELETE/INSERT 匹配不到任何记录。
    const pid = playerId != null && playerId !== '' ? String(playerId) : null;
    let newRecordsCount = 0;

    const stmt = getInsertStmt();
    const delStmt = db.prepare('DELETE FROM gacha_logs WHERE player_id = ? AND card_pool_type = ?');

    // 遍历每个卡池类型：清空旧记录 → 整池重插本次 API 返回
    // API 返回顺序为最新在前，这里按“从数组末尾往头”倒序插入，保证 id 随
    // 时间正序递增（最早的记录 id 最小）。渲染层约定库内数据为最新在前
    // （get-gacha-records ORDER BY timestamp/id DESC），因此插入顺序不能正着来，
    // 否则 id 与时间反转、列表会变成旧记录在前。
    // 事务函数只创建一次、循环里复用：原先每遍历一个卡池都 db.transaction(...) 新建
    // 一个事务函数再立即调用（13 个卡池 = 13 次创建）。
    // 仍然保持「每个卡池各自提交」——任一卡池写入失败不会回滚其它已完成的卡池，
    // 这与原实现语义一致，不要为省 IO 合并成单事务。
    const runPoolTx = db.transaction((cardPoolType: string, groupedRecords: any[]) => {
        delStmt.run(pid, cardPoolType);
        for (let i = groupedRecords.length - 1; i >= 0; i--) {
            const record = groupedRecords[i];
            stmt.run([
                pid,                                      // player_id（保持 String 形态）
                cardPoolType,                             // 卡池类型名称
                normalizeResourceId(record.resourceId),   // 资源 ID（归一化去 '.0' 尾缀）
                record.qualityLevel,                      // 物品质量
                record.resourceType,                      // 资源类型
                record.name,                              // 物品名称
                record.count,                             // 物品数量
                record.time                               // 时间戳
            ]);
        }
    });

    for (const [cardPoolType, groupedRecords] of Object.entries(groupedLogs)) {
        runPoolTx(cardPoolType, groupedRecords);
        newRecordsCount += groupedRecords.length;
        sendStatusToRenderer(event, `${cardPoolType}成功更新${groupedRecords.length}条`);
    }

    if (validLogs.length > 0) console.log(`${validLogs.length} 条记录成功同步数据库.`);
    return newRecordsCount;
}

function sendStatusToRenderer(event: any, message: string): void {
    if (event && event.sender) {
        event.sender.send('gacha-records-status', message);
    } else {
        ipcMain.emit('gacha-records-status', message);
    }
}


module.exports = { parseGachaUrl, fetchAllGachaLogs, GACHA_TYPE_MAP };