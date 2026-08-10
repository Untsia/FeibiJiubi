/**
 * 复用官方鸣潮启动器的本地登录态，拉取当前账号的奇藏宝箱 / 潮汐之遗数据。
 *
 * 原理（逆向自 WutheringWavesTool 的 RoleBoardByLocalView / com.kuro.launcher）：
 *  - 官方启动器登录后会在 %APPDATA%/KR_G152（国服）或 KR_G153（国际服）下，
 *    每个账号子目录里写入 KRSDKUserLauncherCache.json，其中 oauthCode 经过 XOR5 加密。
 *  - 用解密后的 oauthCode + 玩家 ID 调 pc-launcher-sdk-api 的 queryRole 接口，
 *    返回的 PlayerData.Base 内含 BasicBoxes（4 个奇藏箱）与 PhantomBoxes（3 个潮汐之遗）。
 *  - 该接口只需启动器本地缓存，无需 WutheringWavesTool，也无需游戏路径。
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const axios = require('axios');

// 复刻 WutheringWavesTool 的 DecodeUtil.decodeXor5：每个字符与 5 做异或
function decodeXor5(s) {
    if (!s || typeof s !== 'string') return s;
    let out = '';
    for (const ch of s) {
        out += String.fromCharCode(ch.charCodeAt(0) ^ 5);
    }
    return out;
}

// 读取官方启动器本地缓存中的 oauthCode 列表
function readLocalOauthCodes() {
    const appData = process.env.APPDATA;
    if (!appData) return [];
    const result = [];
    const candidates = [
        { dir: path.join(appData, 'KR_G152'), isGlobal: false }, // 国服
        { dir: path.join(appData, 'KR_G153'), isGlobal: true },  // 国际服
    ];
    for (const { dir, isGlobal } of candidates) {
        if (!fs.existsSync(dir)) continue;
        let subDirs = [];
        try {
            subDirs = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory());
        } catch (e) {
            continue;
        }
        for (const sub of subDirs) {
            const jsonPath = path.join(dir, sub.name, 'KRSDKUserLauncherCache.json');
            if (!fs.existsSync(jsonPath)) continue;
            try {
                const arr = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                if (Array.isArray(arr)) {
                    for (const u of arr) {
                        if (u && u.oauthCode) {
                            const phone = u.phone ? String(u.phone) : '';
                            result.push({
                                oauthCode: decodeXor5(u.oauthCode),
                                isGlobal,
                                username: u.username || u.thirdNickName || ('账号' + (u.cuid != null ? u.cuid : '')),
                                accountId: u.cuid != null ? u.cuid : (u.id != null ? u.id : null),
                                phone,
                                maskedPhone: phone.length >= 11 ? phone.slice(0, 3) + '****' + phone.slice(7) : phone,
                            });
                        }
                    }
                }
            } catch (e) {
                // 跳过损坏的缓存文件
            }
        }
    }
    return result;
}

// 由玩家 ID 首字符判断服务器与接口域名
function getRegion(playerId) {
    if (!playerId) return null;
    const c = String(playerId).charAt(0);
    switch (c) {
        case '1': return { key: 'China', isGlobal: false };
        case '6': return { key: 'Eu', isGlobal: true };
        case '7': return { key: 'Asia', isGlobal: true };
        case '8': return { key: 'HMT', isGlobal: true };
        case '9': return { key: 'SEA', isGlobal: true };
        default: return null;
    }
}

// 调 queryRole，返回 baseData 中的奇藏箱 / 潮汐之遗
async function queryRole(playerId, oauthCode, region) {
    const url = region.isGlobal
        ? 'https://pc-launcher-sdk-api.kurogame.net/game/queryRole'
        : 'https://pc-launcher-sdk-api.kurogame.com/game/queryRole';
    // 安全说明：KURO 启动器 SDK 接口 (kurogame.com) 的证书链未被 Electron 内置 CA 信任，
    // 此处【仅针对该请求】关闭证书校验以兼容其证书。请勿将此模式推广到其他请求（存在 MITM 风险）。
    const agent = new https.Agent({ rejectUnauthorized: false });
    const resp = await axios.post(url, {
        oauthCode,
        playerId,
        region: region.key,
    }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
        httpsAgent: agent,
    });
    const tree = resp.data;
    const code = tree && tree.code;
    if (code === 200 || code === 0) {
        const dataNode = tree.data;
        if (dataNode && dataNode[region.key]) {
            const raw = dataNode[region.key];
            const playerData = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const base = playerData.Base || playerData.baseData || {};
            const bp = playerData.BattlePass || playerData.battlePassData || {};
            const num = (v) => (v != null ? v : null);
            return {
                basicBoxes: base.BasicBoxes || {},
                phantomBoxes: base.PhantomBoxes || {},
                name: base.Name,
                level: base.Level != null ? base.Level : null, // 联觉等级（当前等级），经验字段接口不返回
                uid: base.Id != null ? base.Id
                    : (base.id != null ? base.id
                        : (base.UID != null ? base.UID
                            : (base.uid != null ? base.uid : null))),
                // 账号信息面板所需字段（参考 WutheringWavesTool RoleBoardByLocalViewModel）
                energy: num(base.Energy),
                maxEnergy: num(base.MaxEnergy),
                activeDays: num(base.ActiveDays),
                liveness: num(base.Liveness),
                storeEnergy: num(base.StoreEnergy),
                maxStoreEnergy: num(base.MaxStoreEnergy),
                weekInstCount: num(base.WeeklyInstCount),
                bpLevel: num(bp.Level),
                bpWeekExp: num(bp.WeekExp),
                bpWeekMaxExp: num(bp.WeekMaxExp),
                region: region.key,
                isGlobal: region.isGlobal,
            };
        }
    }
    throw new Error('queryRole 返回 code=' + code + '（可能未在官方启动器登录）');
}

// 由 queryPlayerInfo 返回的 region key（China/Eu/Asia/HMT/SEA）还原为 {key,isGlobal}
function regionFromKey(key) {
    const k = String(key || 'China').toLowerCase();
    if (k === 'china') return { key: 'China', isGlobal: false };
    const map = { eu: 'Eu', asia: 'Asia', hmt: 'HMT', sea: 'SEA' };
    return { key: map[k] || 'Asia', isGlobal: true };
}

// 用 oauthCode 调 queryPlayerInfo，拿到当前登录态下的主角色 roleId（无需游戏内 UID）
async function queryPlayerInfo(oauthCode, isGlobal) {
    const url = isGlobal
        ? 'https://pc-launcher-sdk-api.kurogame.net/game/queryPlayerInfo'
        : 'https://pc-launcher-sdk-api.kurogame.com/game/queryPlayerInfo';
    // 安全说明：KURO 启动器 SDK 接口 (kurogame.com) 的证书链未被 Electron 内置 CA 信任，
    // 此处【仅针对该请求】关闭证书校验以兼容其证书。请勿将此模式推广到其他请求（存在 MITM 风险）。
    const agent = new https.Agent({ rejectUnauthorized: false });
    const resp = await axios.post(url, { oauthCode }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
        httpsAgent: agent,
    });
    const tree = resp.data;
    const code = tree && tree.code;
    if (code === 200 || code === 0) {
        const dataNode = tree.data;
        if (dataNode) {
            const keys = Object.keys(dataNode);
            const key = keys[0];
            if (key) {
                const raw = dataNode[key];
                const info = typeof raw === 'string' ? JSON.parse(raw) : raw;
                return {
                    roleId: info.roleId != null ? String(info.roleId)
                        : (info.id != null ? String(info.id)
                            : (info.UID != null ? String(info.UID) : null)),
                    name: info.name || info.nickName || info.roleName || null,
                    headPhoto: info.headPhoto != null ? String(info.headPhoto) : null,
                    region: key,
                    isGlobal: isGlobal,
                };
            }
        }
    }
    throw new Error('queryPlayerInfo 返回 code=' + code + '（可能未在官方启动器登录或 token 失效）');
}

// 返回启动器本地缓存中的第一个登录态作为「主账号」（用于免 UID 自动同步）
function getMainAccount() {
    const all = readLocalOauthCodes();
    if (!all.length) return null;
    const sorted = sortByOauthCode(all);
    const m = sorted[0];
    return { oauthCode: m.oauthCode, isGlobal: m.isGlobal };
}

// 将奇藏箱原始映射整理为前端展示结构
function buildTreasureResult(basicBoxes, phantomBoxes, level) {
    return {
        boxes: {
            '朴素': basicBoxes['1'] != null ? basicBoxes['1'] : 0,
            '基准': basicBoxes['2'] != null ? basicBoxes['2'] : 0,
            '精密': basicBoxes['3'] != null ? basicBoxes['3'] : 0,
            '辉光': basicBoxes['4'] != null ? basicBoxes['4'] : 0,
            '潮汐绿': phantomBoxes['1'] != null ? phantomBoxes['1'] : 0,
            '潮汐紫': phantomBoxes['2'] != null ? phantomBoxes['2'] : 0,
            '潮汐金': phantomBoxes['3'] != null ? phantomBoxes['3'] : 0,
        },
        level: level != null ? level : null,
    };
}

// 按 oauthCode 字典序稳定排序，避免 readdirSync 返回顺序不确定导致多次同步命中不同账号
function sortByOauthCode(list) {
    return list.slice().sort((a, b) => String(a.oauthCode).localeCompare(String(b.oauthCode)));
}

/**
 * 拉取当前账号数据，返回奇藏箱映射与当前等级。
 * @param {string} playerId 玩家 ID（游戏内 UID），来自抽卡记录；为 null 时免 UID，自动用启动器本地登录态定位主账号
 * @returns {Promise<{boxes: Object, level: (number|null)}>}
 *   boxes: { 朴素, 基准, 精密, 辉光, 潮汐绿, 潮汐紫, 潮汐金 }；level: 联觉等级（无则 null）
 */
// 缓存：playerId -> 上次成功匹配的 oauthCode，保证同一账号多次同步（奇藏/等级/刷新）命中同一登录态，不漂到别的账号
const _treasureOauthCache = {};


// 读取游戏本地 Client/Saved/LocalStorage/LocalStorage.db，获取当前登录账号的「游戏内 UID」与区服信息。
// 参考 WutheringWavesTool 的 account-state 存储逻辑：用 gameRootDir 指向游戏目录，
// 直接读游戏本地 SQLite 即可知道当前账号（无需启动鸣潮启动器，游戏关掉后该文件依旧存在）。
// 注意：该库只含账号身份（游戏内 UID / 区服），不含 API token；刷新奇藏/等级仍需启动器持久化的 oauthCode。
function getGameAccountState(gameRootDir) {
  if (!gameRootDir) return { success: false, reason: 'no-game-root' };
  const dbPath = path.join(gameRootDir, 'Client', 'Saved', 'LocalStorage', 'LocalStorage.db');
  if (!fs.existsSync(dbPath)) return { success: false, reason: 'no-local-storage-db' };
  let db;
  try {
    const Database = require('better-sqlite3');
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (e) {
    return { success: false, reason: 'open-failed: ' + e.message };
  }
  try {
    const getVal = (k) => {
      try {
        const row = db.prepare('SELECT value FROM LocalStorage WHERE key = ?').get(k);
        return row ? row.value : null;
      } catch (e) { return null; }
    };
    const recentlyUid = getVal('RecentlyLoginUID');
    const accounts = [];
    const raw = getVal('SdkLastTimeLoginData');
    if (raw) {
      try {
        const obj = JSON.parse(raw);
        const content = obj && obj.Content;
        if (Array.isArray(content)) {
          for (const pair of content) {
            const kuroId = pair && pair[0];
            const info = (pair && pair[1]) || {};
            accounts.push({
              kuroAccountId: kuroId != null ? String(kuroId) : null,
              region: info.Region != null ? String(info.Region) : null,
              serverIp: info.Ip || null,
            });
          }
        }
      } catch (e) { /* 解析失败忽略 */ }
    }
    return {
      success: true,
      currentUid: recentlyUid != null ? String(recentlyUid) : null,
      accounts,
    };
  } finally {
    try { db.close(); } catch (e) {}
  }
}

// 返回某 playerId 对应区服下所有启动器登录态的账号元信息（不发起网络请求），供 UI 选择框使用
async function listTreasureAccounts(playerId, isGlobal) {
    let region = null;
    if (playerId) region = getRegion(playerId);
    let codes;
    if (region) {
        codes = readLocalOauthCodes().filter(c => c.isGlobal === region.isGlobal);
    } else if (isGlobal != null) {
        codes = readLocalOauthCodes().filter(c => c.isGlobal === isGlobal);
    } else {
        codes = readLocalOauthCodes(); // 无 UID 时返回全部区服账号，供前端选择主账号
    }
    // 按 oauthCode 字典序稳定排序，保证选择框里账号顺序固定
    const sorted = sortByOauthCode(codes);
    const accounts = [];
    for (const c of sorted) {
        // 下拉框优先展示游戏内 UID（= queryRole 返回的 base.Id）；
        // queryPlayerInfo 的 roleId 是库洛游戏通行证的 roleId，并非游戏内 UID，需再查 queryRole 取游戏内 UID。
        // 离线或 token 失效时回退显示账号标识。
        let uid = null;
        try {
            const info = await queryPlayerInfo(c.oauthCode, c.isGlobal);
            if (info && info.roleId) {
                uid = info.roleId; // 兜底：库洛通行证 roleId
                try {
                    const rg = regionFromKey(info.region);
                    const role = await queryRole(info.roleId, c.oauthCode, rg);
                    if (role && role.uid) uid = role.uid; // 优先：游戏内 UID
                } catch (e) { /* 取游戏内 UID 失败时保留通行证的 roleId 兜底 */ }
            }
        } catch (e) { /* 离线或 token 失效时忽略，下拉框回退显示账号标识 */ }
        accounts.push({
            oauthCode: c.oauthCode,
            username: c.username,
            accountId: c.accountId,
            maskedPhone: c.maskedPhone,
            isGlobal: c.isGlobal,
            regionKey: region ? region.key : (c.isGlobal ? 'Global' : 'China'),
            uid: uid,
        });
    }
    return accounts;
}

async function getTreasureBoxes(playerId, oauthCode, isGlobal) {
    // 免 UID：用启动器本地登录态自动定位主账号并拉取（无需游戏内 UID / 抽卡记录）
    if (!playerId) {
        let oc = oauthCode;
        let ig = isGlobal;
        if (!oc) {
            const m = getMainAccount();
            if (!m) throw new Error('未在 %APPDATA% 找到官方启动器登录缓存，请先在鸣潮启动器登录账号');
            oc = m.oauthCode; ig = m.isGlobal;
        }
        const info = await queryPlayerInfo(oc, ig);
        const rg = regionFromKey(info.region);
        const r = await queryRole(info.roleId, oc, rg);
        return buildTreasureResult(r.basicBoxes, r.phantomBoxes, r.level);
    }
    const region = getRegion(playerId);
    if (!region) {
        throw new Error('无法识别玩家服务器（ID=' + playerId + '）');
    }
    // 显式指定了启动器登录态：直接用它拉取，不再遍历猜测（避免多账号命中错乱）
    if (oauthCode) {
        try {
            const r = await queryRole(playerId, oauthCode, region);
            return buildTreasureResult(r.basicBoxes, r.phantomBoxes, r.level);
        } catch (e) {
            throw new Error('所选账号同步失败：' + (e && e.message ? e.message : e));
        }
    }
    let codes = readLocalOauthCodes().filter(c => c.isGlobal === region.isGlobal);
    // 按 oauthCode 字典序稳定排序，避免 readdirSync 返回顺序不确定导致多次同步命中不同账号（a/b 循环）
    codes = codes.slice().sort((a, b) => String(a.oauthCode).localeCompare(String(b.oauthCode)));
    if (!codes.length) {
        throw new Error('未在 %APPDATA% 找到官方启动器登录缓存，请先在鸣潮启动器登录账号');
    }
    // 优先把该 playerId 上次成功匹配的 oauthCode 排到最前，确保多次同步一致
    const cached = _treasureOauthCache[playerId];
    if (cached) {
        codes = [cached, ...codes.filter(c => c.oauthCode !== cached)];
    }
    const matched = [];
    let lastErr = null;
    for (const { oauthCode: oc } of codes) {
        try {
            const r = await queryRole(playerId, oc, region);
            const res = buildTreasureResult(r.basicBoxes, r.phantomBoxes, r.level);
            // 严格按 UID 锁定：返回账号的 UID 与 playerId 一致，立即采用并缓存
            if (r.uid != null && String(r.uid) === String(playerId)) {
                _treasureOauthCache[playerId] = oc;
                return res;
            }
            matched.push({ oauthCode: oc, res });
        } catch (e) {
            lastErr = e;
        }
    }
    // 无 UID 精确匹配（如接口忽略 playerId 只返回登录态账号）：用首个成功结果并缓存，保证确定性
    if (matched.length) {
        _treasureOauthCache[playerId] = matched[0].oauthCode;
        return matched[0].res;
    }
    throw new Error(lastErr ? lastErr.message : '获取奇藏数据失败');
}

module.exports = { getTreasureBoxes, listTreasureAccounts, decodeXor5, getRegion, queryPlayerInfo, getMainAccount, getGameAccountState };
