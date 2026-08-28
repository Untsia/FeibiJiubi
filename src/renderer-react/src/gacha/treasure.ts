/**
 * 抽卡分析视图 —— 奇藏/等级同步数据层（自遗留 gachaWuwa.js 迁移）。
 *
 * 职责：解析启动器登录态账号（list-treasure-accounts / get-game-account-state）、
 * 拉取当前账号奇藏箱子与等级（get-treasure-boxes）、本地缓存「打开即命中」、
 * 账号下拉选项与选中态发布。所有数据经 store 发布，React（GameToolsPage /
 * QizangView / LevelView）订阅渲染。
 *
 * 与遗留实现保持一致的持久化键 / 算法：
 *   - localStorage 'wuwa_account'：{ oauthCode, isGlobal }
 *   - localStorage 'wuwa_treasure_cache'：{ [oauthCode]: { boxes, level, uid, ts } }
 *   - _resolvedUidMap：奇藏同步实证回填的游戏内 UID，优先于下拉框在线解析
 */
import type { TreasureAccount, TreasureData } from './types';
import { publishTreasure, setAccountOptions, setAccountSelection } from './store';

/* ===================== 持久化账号（localStorage，与遗留键完全一致） ===================== */

interface SavedAccount {
  oauthCode: string | null;
  isGlobal: boolean | null;
  uid?: string | null;
}

export function getSavedAccount(): SavedAccount | null {
  try {
    return JSON.parse(localStorage.getItem('wuwa_account') || 'null');
  } catch {
    return null;
  }
}

export function saveAccount(a: SavedAccount) {
  try {
    localStorage.setItem('wuwa_account', JSON.stringify(a));
  } catch {
    /* 隐私模式忽略 */
  }
}

const _TREASURE_CACHE_KEY = 'wuwa_treasure_cache';

interface TreasureCacheEntry {
  boxes: TreasureData;
  level?: number;
  uid?: string;
  ts: number;
}

function loadTreasureCache(): Record<string, TreasureCacheEntry> {
  try {
    return JSON.parse(localStorage.getItem(_TREASURE_CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveTreasureCache(
  oauthCode: string,
  boxes: TreasureData,
  level: number | null,
  uid: string | number | null,
) {
  if (!oauthCode) return;
  try {
    const all = loadTreasureCache();
    all[oauthCode] = {
      boxes: boxes || {},
      level: level != null ? level : undefined,
      uid: uid != null ? String(uid) : undefined,
      ts: Date.now(),
    };
    localStorage.setItem(_TREASURE_CACHE_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

/* ===================== 当前账号运行时状态（module 级，切页不丢） ===================== */

interface AccountState {
  oauthCode: string | null;
  isGlobal: boolean | null;
}

const _accountState: AccountState = { oauthCode: null, isGlobal: null };
/** oauthCode -> 游戏内 UID，由奇藏同步实证回填，优先于下拉框在线解析 */
const _resolvedUidMap: Record<string, string> = {};
let _treasureSynced = false; // 奇藏/等级是否已同步成功（冷启动失败时切到该视图自动重试一次）
let _skipAutoSync = false; // 启动期置位：loadAccounts 自动选中时不各自同步，由 boot 统一同步一次

let cachedTreasure: TreasureData | null = null;
let cachedLevel: number | null = null;

function publish() {
  publishTreasure(cachedTreasure, cachedLevel);
}

/* ===================== 对外只读访问（供 data.ts / GameToolsPage） ===================== */

export function isTreasureSynced(): boolean {
  return _treasureSynced;
}

/** boot 启动期置位：loadAccounts 自动选中期间不各自同步（避免启动重复拉取） */
export function setSkipAutoSync(v: boolean) {
  _skipAutoSync = v;
}

/** 用持久化账号预置 _accountState（尽早命中缓存，无需等 IPC 解析） */
export function restoreSavedAccount() {
  const saved = getSavedAccount();
  if (saved && saved.oauthCode != null) {
    _accountState.oauthCode = saved.oauthCode;
    _accountState.isGlobal = saved.isGlobal != null ? saved.isGlobal : _accountState.isGlobal;
  }
}

/** 下拉框显示文案：优先展示 UID（来自官方 API），离线拉不到时回退账号标识 */
export function accountLabel(a: TreasureAccount | null | undefined): string {
  if (a && a.uid) return String(a.uid);
  return (a && (a.accountId || a.maskedPhone || a.username)) || '账号';
}

/** 有效 UID：优先奇藏同步回填的解析结果，回退账号在线解析 uid */
export function effectiveUid(a: TreasureAccount | null | undefined): string | null {
  if (!a) return null;
  if (a.oauthCode != null && _resolvedUidMap[a.oauthCode] != null) return _resolvedUidMap[a.oauthCode];
  return a.uid != null ? String(a.uid) : null;
}

/* ===================== 缓存温暖：打开程序即解析好 ===================== */

/**
 * 立即把奇藏/等级/已解析 UID 从本地缓存填充并发布（无需网络/多段 IPC），
 * 后台随后静默同步校验纠偏。启动瞬间命中缓存即可渲染「已有」数据。
 */
export function warmTreasureFromCache() {
  const oauthCode = _accountState.oauthCode;
  if (!oauthCode) return;
  const c = loadTreasureCache()[oauthCode];
  if (!c) return;
  if (c.boxes && typeof c.boxes === 'object') cachedTreasure = c.boxes;
  if (c.level != null) cachedLevel = c.level;
  if (c.uid != null) _resolvedUidMap[oauthCode] = String(c.uid);
  publish();
}

/* ===================== 奇藏/等级同步 ===================== */

/**
 * 复用官方鸣潮启动器本地登录态，拉取当前账号奇藏数据并填充差值对比「已有」。
 * oauthCode 缺失时主进程 getTreasureBoxes 会自动用启动器主账号兜底（免 UID）。
 */
export async function syncTreasureBoxes(): Promise<{ success: boolean; error?: string }> {
  try {
    let oauthCode = _accountState.oauthCode;
    let isGlobal = _accountState.isGlobal;
    const saved = getSavedAccount();
    if (saved && saved.oauthCode) {
      oauthCode = saved.oauthCode;
      if (saved.isGlobal != null) isGlobal = saved.isGlobal;
    }
    const res = await window.electronAPI.invoke('get-treasure-boxes', {
      oauthCode: oauthCode || null,
      isGlobal,
    });
    if (!res || !res.success) {
      const msg = res && res.error ? res.error : '获取奇藏数据失败';
      return { success: false, error: msg };
    }
    // 用局部常量持有非空结果：cachedTreasure 声明为 TreasureData | null，
    // 直接传它给 saveTreasureCache 会报 TS2345，但此处刚赋值、运行时必非空。
    const boxes: TreasureData = (res.boxes || {}) as TreasureData;
    cachedTreasure = boxes;
    // 缓存/回填用的有效 key：优先 oauthCode，其次用主进程回传的游戏内 UID 兜底
    const key = oauthCode || (res.uid != null ? String(res.uid) : null);
    if (key) {
      if (res.uid != null) _resolvedUidMap[key] = String(res.uid); // 回填已解析 UID，供下拉框复用
      if (res.level != null) cachedLevel = res.level;
      saveTreasureCache(key, boxes, res.level, res.uid); // 持久化，供下次打开即命中
    } else if (res.level != null) {
      cachedLevel = res.level;
    }
    publish();
    _treasureSynced = true;
    return { success: true };
  } catch (e) {
    console.error('同步奇藏失败', e);
    return { success: false, error: (e as Error).message };
  }
}

/* ===================== 账号解析 / 下拉选项 ===================== */

/** 解析主账号（免启动器 / 免 UID），写入 _accountState（持久化账号优先） */
export async function resolveMainAccount(): Promise<void> {
  try {
    const res = await window.electronAPI.invoke('get-main-account');
    if (res && res.success && res.account) {
      _accountState.oauthCode = res.account.oauthCode;
      _accountState.isGlobal = res.account.isGlobal;
      const saved = getSavedAccount();
      if (saved && saved.oauthCode) {
        _accountState.oauthCode = saved.oauthCode;
        _accountState.isGlobal = saved.isGlobal != null ? saved.isGlobal : res.account.isGlobal;
      }
    }
  } catch (e) {
    console.warn('resolveMainAccount 失败', e);
  }
}

/**
 * 加载账号下拉选项并自动选中当前账号（启动器缓存 + 游戏本地状态兜底）。
 * 选项发布到 store（GameToolsPage 渲染下拉），选中态发布 accountOauthCode/accountLabel。
 * autoSync=false（启动期）时只选中不各自同步，由 boot 统一 syncTreasureBoxes。
 */
export async function loadAccounts(autoSync: boolean): Promise<void> {
  try {
    const res = await window.electronAPI.invoke('list-treasure-accounts', { isGlobal: null });
    let accounts: TreasureAccount[] = (res && res.success && res.accounts) ? res.accounts : [];
    // 游戏本地账号状态（无需启动器）：用于离线兜底与自动选中当前账号
    let gameState: { currentUid?: string } | null = null;
    try {
      const gs = await window.electronAPI.invoke('get-game-account-state');
      if (gs && gs.success && gs.state && gs.state.success) gameState = gs.state;
    } catch {
      /* 忽略，走启动器缓存逻辑 */
    }
    // 启动器缓存为空时，用游戏本地状态兜底（仅显示账号身份，刷新仍需启动器持久化登录态）
    if (!accounts.length && gameState && gameState.currentUid) {
      accounts = [{
        oauthCode: null, username: null, accountId: null, maskedPhone: null,
        isGlobal: false, regionKey: 'China', uid: gameState.currentUid, _fromGame: true,
      }];
    }
    if (!accounts.length) {
      setAccountOptions([]);
      setAccountSelection(null, null, '无登录账号');
      return;
    }
    let activeIdx = 0;
    const cur = getSavedAccount() || _accountState;
    accounts.forEach((a, i) => {
      if (a.oauthCode === cur.oauthCode) activeIdx = i;
    });
    // 用游戏本地「当前登录 UID」自动选中匹配的账号（即使离线也能正确定位）
    if (gameState && gameState.currentUid) {
      const mi = accounts.findIndex((a) => a.uid && String(a.uid) === String(gameState.currentUid));
      if (mi >= 0) activeIdx = mi;
    }
    setAccountOptions(accounts);
    const autoA = accounts[activeIdx];
    if (autoA) {
      _accountState.oauthCode = autoA.oauthCode;
      _accountState.isGlobal = autoA.isGlobal;
      saveAccount({ oauthCode: autoA.oauthCode, isGlobal: autoA.isGlobal });
      setAccountSelection(
        autoA.oauthCode,
        autoA.isGlobal,
        effectiveUid(autoA) || accountLabel(autoA),
      );
      // 启动期由 boot 统一同步一次，此处仅在非启动期（切账号/账号列表刷新）同步，避免重复拉取
      if (autoSync) syncTreasureBoxes();
    }
  } catch (e) {
    setAccountOptions([]);
    setAccountSelection(null, null, '选择账号');
  }
}

/** 切换同步账号：持久化 + 立即同步该账号奇藏/等级 */
export async function switchAccount(account: TreasureAccount): Promise<void> {
  _accountState.oauthCode = account.oauthCode;
  _accountState.isGlobal = account.isGlobal;
  saveAccount({ oauthCode: account.oauthCode, isGlobal: account.isGlobal });
  setAccountSelection(
    account.oauthCode,
    account.isGlobal,
    effectiveUid(account) || accountLabel(account),
  );
  _treasureSynced = false;
  await syncTreasureBoxes();
}
