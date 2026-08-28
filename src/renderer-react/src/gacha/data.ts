/**
 * 抽卡分析视图 —— 记录数据层（自遗留 gachaWuwa.js 迁移）。
 *
 * 职责：UID 列表加载、当前账号记录拉取（头像/常驻/分类）、刷新/导入后重载、
 * UID 删除、隐藏卡池读写、分析子视图切换（偏好持久化 + 冷启动奇藏同步兜底）、
 * 快捷键、主进程广播订阅。所有数据经 store 发布，React 视图订阅渲染。
 *
 * 依赖 treasure.ts（奇藏/等级账号同步）。GameToolsPage 挂载时调用 bootGacha()
 * 启动数据链路；后续交互（UID 下拉 / 刷新 / 隐藏卡池 / 删除 / 账号切换）由
 * React 组件直接调用本模块导出的动作函数。
 */
import { categorizeRecords } from './utils';
import {
  getGachaSnapshot,
  publishData,
  publishStatus,
  setCurrentView,
  setHiddenPools,
  setStatusMessage,
  setUidOptions,
} from './store';
import type { GachaNavView, GachaRecord } from './types';
import { POOL_ORDER } from './renderers';
import {
  getSavedAccount,
  isTreasureSynced,
  loadAccounts,
  resolveMainAccount,
  restoreSavedAccount,
  setSkipAutoSync,
  syncTreasureBoxes,
  warmTreasureFromCache,
} from './treasure';
import { initRecordTooltips } from './tooltip';
import { showNotification } from '../notification/store';

/* ===================== 分析子视图偏好（localStorage，与遗留键一致） ===================== */

const _VIEW_PREF_KEY = 'wuwa_analysis_view';

function loadViewPref(): GachaNavView {
  try {
    const v = localStorage.getItem(_VIEW_PREF_KEY);
    return ['bar', 'intuitive', 'detail'].includes(v || '') ? (v as GachaNavView) : 'bar';
  } catch {
    return 'bar';
  }
}

function saveViewPref(view: GachaNavView) {
  if (['bar', 'intuitive', 'detail'].includes(view)) {
    try {
      localStorage.setItem(_VIEW_PREF_KEY, view);
    } catch {
      /* ignore */
    }
  }
}

let currentAnalysisView: GachaNavView = loadViewPref();

/* ===================== 当前账号 UID + 隐藏卡池（按账号隔离） ===================== */

let currentUid: string | null = null;

function hiddenStorageKey(): string {
  return 'wuwa_hidden_pools_' + (currentUid != null ? String(currentUid) : 'default');
}

function readHiddenPools(): Set<string> {
  const raw = localStorage.getItem(hiddenStorageKey());
  if (raw != null) {
    try {
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      /* ignore */
    }
  }
  // 迁移：首次使用某账号时复用旧的全局隐藏设置（仅一次），避免老用户设置丢失
  const legacy = localStorage.getItem('wuwa_hidden_pools');
  if (legacy != null) {
    try {
      const arr = JSON.parse(legacy);
      const set = new Set(Array.isArray(arr) ? arr : []);
      localStorage.setItem(hiddenStorageKey(), JSON.stringify(Array.from(set)));
      localStorage.removeItem('wuwa_hidden_pools');
      return set;
    } catch {
      /* ignore */
    }
  }
  return new Set();
}

/** 保存并发布隐藏卡池（含 '__SUMMARY_ALL__'）；GameToolsPage 弹窗应用后调用 */
export function applyHiddenPools(selected: string[]) {
  try {
    localStorage.setItem(hiddenStorageKey(), JSON.stringify(selected));
  } catch {
    /* ignore */
  }
  setHiddenPools(selected);
}

/** 隐藏卡池弹窗选项：当前账号有记录的卡池（按 POOL_ORDER 排序，未知卡池追加在后） */
export function poolTitles(): { key: string; title: string }[] {
  const titleMap: Record<string, string> = {
    '角色活动唤取': '角色活动', '武器活动唤取': '武器活动',
    '角色联动唤取': '角色联动', '武器联动唤取': '武器联动',
    '角色新旅唤取': '角色新旅', '武器新旅唤取': '武器新旅',
    '角色忆旅唤取': '角色忆旅', '武器忆旅唤取': '武器忆旅',
    '角色常驻唤取': '角色常驻', '武器常驻唤取': '武器常驻',
    '新手限定唤取': '新手限定', '新手自选唤取': '新手自选', '感恩定向唤取': '感恩定向',
  };
  const records = getGachaSnapshot().records || [];
  const present = new Set(records.map((r) => r.card_pool_type));
  const ordered = POOL_ORDER.filter((k) => present.has(k));
  const extra = Array.from(present).filter((k) => !POOL_ORDER.includes(k));
  return ordered.concat(extra).map((k) => ({ key: k, title: titleMap[k] || k }));
}

/** 当前 UID 的隐藏卡池 Set（React 组件读取选中态用） */
export function getHiddenPools(): Set<string> {
  return readHiddenPools();
}

/* ===================== 并发保护令牌 ===================== */

let gachaLoadToken = 0; // 切换账号并发保护：仅最新一次加载允许落地，避免旧账号数据覆盖新账号
let reloadToken = 0; // 刷新/导入「最新请求获胜」：并发时只有最新一次请求落地

/* ===================== UID 下拉选项 ===================== */

/** 加载玩家 UID 下拉选项（get-player-uids）并发布 */
export async function loadPlayerUIDs(defaultUid: string | null): Promise<void> {
  const players = await window.electronAPI.getPlayerUIDs();
  const list = Array.isArray(players) ? players.map(String) : [];
  setUidOptions(list);
  // 下拉框展示：优先最近查询/刷新所得 UID；其次选项第一项（等价遗留 defaultUid 回退）
  if (list.length) {
    const target = defaultUid != null && list.some((u) => u === String(defaultUid))
      ? String(defaultUid)
      : list[0];
    publishData({ uid: target });
  } else {
    publishData({ uid: defaultUid != null ? String(defaultUid) : null });
  }
}

/* ===================== 记录加载 ===================== */

/**
 * 加载当前账号唤取记录并发布（头像预解析 / 常驻列表 / 按卡池分类）。
 * 空数据分支不提前 return（会跳过关键发布），照常走 ready + 保留当前 tab。
 */
export async function loadGachaRecords(uid: string | null): Promise<void> {
  try {
    const myLoadToken = ++gachaLoadToken;
    currentUid = uid;
    // 仅拉取当前账号的记录，避免多账号时把全库记录都传回再过滤
    const records = await window.electronAPI.getGachaRecords(uid);

    // player_id 在 SQLite 中是 INTEGER，uid 可能是字符串（dataset / String() 转换），
    // 必须统一按字符串比较，否则「有数据却显示空」。
    const uidStr = String(uid);
    // 显式标注类型：records 来自 IPC（any），若不标注则 filteredRecords 也是 any，
    // 下游 forEach 的参数会退化成隐式 any（TS7006）。
    const filteredRecords: GachaRecord[] = (records || []).filter((r: GachaRecord) => String(r.player_id) === uidStr);

    // 切换账号并发保护：已有更新的账号加载在途时，丢弃本次发布
    if (myLoadToken !== gachaLoadToken) return;

    const prevView = currentAnalysisView; // 上次切换账号前所在的子视图

    if (!filteredRecords.length) {
      publishData({
        records: [], pools: {}, uid,
        avatarMap: { byResourceId: {}, byName: {} },
        commonItems: [],
        hiddenPools: Array.from(readHiddenPools()),
      });
      publishStatus('ready');
      // 重载后保留用户当前所在 tab（空数据时视图仍就位）
      switchAnalysisView(prevView);
      return;
    }

    // 预解析头像（按 resource_id / 名称 从本地头像文件夹读取）
    let avatarMap = { byResourceId: {}, byName: {} };
    try {
      const seen = new Set<string>();
      const avatarItems: { resourceId: string | number | undefined; name: string }[] = [];
      filteredRecords.forEach((r) => {
        const key = (r.resource_id ?? '') + '|' + (r.name ?? '');
        if (!seen.has(key)) {
          seen.add(key);
          avatarItems.push({ resourceId: r.resource_id, name: r.name });
        }
      });
      avatarItems.push({ resourceId: '', name: '漂泊者·导电' });
      avatarMap = await window.electronAPI.getGachaAvatars(avatarItems);
    } catch (e) {
      console.warn('头像预解析失败:', e);
      avatarMap = { byResourceId: {}, byName: {} };
    }

    // 取得第一条记录的 lang 属性，若不存在则默认使用 'zh-cn'
    const lang = filteredRecords[0].lang || 'zh-cn';
    let commonItems = [];
    try {
      commonItems = await window.electronAPI.invoke('get-common-items', 'wuWa', lang);
      if (!Array.isArray(commonItems)) commonItems = [];
    } catch (e) {
      console.error('[commonItems] 获取常驻列表失败，降级为空数组', e);
      commonItems = [];
    }

    // await 期间可能已有新加载抢占，再次校验才允许落地
    if (myLoadToken !== gachaLoadToken) return;

    const pools = categorizeRecords(filteredRecords);
    publishData({
      records: filteredRecords,
      pools,
      uid,
      avatarMap,
      commonItems,
      hiddenPools: Array.from(readHiddenPools()),
    });
    publishStatus('ready');

    // 重渲染后保留用户当前所在 tab（currentView 不变，React 不重置 active）
    switchAnalysisView(prevView);
  } catch (e) {
    console.error('[loadGachaRecords] 渲染过程中发生未捕获异常，已降级保护：', e);
  }
}

/* ===================== 刷新 / 导入后统一重载 ===================== */

/**
 * 刷新/登录后统一重载：账号下拉框 + 记录 + 奇藏，与 bootGacha 保持一致。
 * 采用「最新请求获胜」令牌：多账号/双入口并发时只有最新一次请求落地，
 * 避免旧账号覆盖新账号（刷新路径此前漏调 loadPlayerUIDs 导致账号不显示）。
 */
export async function reloadGachaData(preferredUid?: string | null): Promise<void> {
  const myToken = ++reloadToken;
  // 优先使用刷新/获取时实际拉取的账号 uid（多账号下「最近查询 uid」可能仍是旧账号）
  const uid = preferredUid || (await window.electronAPI.getLastQueryUid());
  // 先切换下拉框到目标 UID，确保「获取到哪个账号就跳到哪个账号」
  if (uid != null) publishData({ uid: String(uid) });
  await loadPlayerUIDs(uid);
  if (myToken !== reloadToken) return; // 已有更新的重载，交给它落地
  // 数据拉取/渲染前先发布 loading：React 在 #record-display 渲染骨架屏，避免空白跳动
  publishStatus('loading');
  await loadGachaRecords(uid);
  if (myToken !== reloadToken) return; // 已有更新的重载，交给它落地
  syncTreasureBoxes();
}

/* ===================== UID 删除 ===================== */

/** 执行 UID 记录删除：主进程删除 + 清空持久化选中 + 重载下拉框与记录 */
export async function runDeleteUid(uid: string): Promise<void> {
  try {
    await window.electronAPI.invoke('delete-gacha-records', uid);
    // 清除已删除账号的持久化选中，避免下次打开仍记住已不存在的账号
    try {
      await window.electronAPI.setLastQueryUid('');
    } catch {
      /* ignore */
    }
    const lastUid = await window.electronAPI.getLastQueryUid();
    await loadPlayerUIDs(lastUid);
    await loadGachaRecords(lastUid);
    notify(true, `成功删除 UID: ${uid} 的记录`);
  } catch (error) {
    notify(false, `删除失败: ${(error as Error).message}`);
  }
}

/* ===================== 分析子视图切换 ===================== */

/**
 * 分析子视图切换：偏好持久化 + 冷启动奇藏同步兜底 + 上报侧边栏。
 * 侧边栏「分析」入口（view='analysis'）恢复上次离开时的子视图。
 */
export function switchAnalysisView(view: GachaNavView | 'analysis'): void {
  // 原先先 `view as GachaNavView` 再比较 === 'analysis'，断言把 'analysis' 从类型里
  // 抹掉了，比较恒为 false（TS2367）。改为先判分支再收窄类型，语义不变。
  const v: GachaNavView = view === 'analysis' ? loadViewPref() : view;
  currentAnalysisView = v;
  saveViewPref(v);
  // 发布 currentView → React（GameToolsPage / 六个视图组件）重渲染
  setCurrentView(v);
  // 侧边栏高亮由 React 应用（App.tsx）状态驱动，这里上报真实视图变更
  window.dispatchEvent(new CustomEvent('app-nav-view-changed', { detail: { view: v } }));
  // 冷启动时启动同步可能失败（启动器登录态未就绪）：切到奇藏/等级时若尚未同步成功，
  // 主动重新解析账号（刷新 oauthCode）并同步，确保用户切过来即可看到数据。
  if ((v === 'qizang' || v === 'level') && !isTreasureSynced()) {
    (async () => {
      try {
        await resolveMainAccount();
      } catch {
        /* ignore */
      }
      try {
        await loadAccounts(true);
      } catch {
        /* ignore */
      }
      // loadAccounts(autoSync=true) 内部已触发 syncTreasureBoxes；若仍失败再兜底一次
      if (!isTreasureSynced()) syncTreasureBoxes();
    })();
  }
}

/* ===================== 快捷键：Ctrl+1/2/3 切视图 · Ctrl+S 设置 · Ctrl+T 主题 · Ctrl+R 刷新 ===================== */

let __shortcutBound = false;

function initShortcuts() {
  if (__shortcutBound) return;
  __shortcutBound = true;
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (!document.getElementById('record-display')) return; // 仅在分析页生效
    const k = (e.key || '').toLowerCase();
    if (k === '1') { e.preventDefault(); switchAnalysisView('bar'); return; }
    if (k === '2') { e.preventDefault(); switchAnalysisView('intuitive'); return; }
    if (k === '3') { e.preventDefault(); switchAnalysisView('detail'); return; }
    if (k === 's') {
      e.preventDefault();
      const sb = document.querySelector('.sidebar-settings');
      if (sb && typeof (sb as HTMLElement).click === 'function') (sb as HTMLElement).click();
      return;
    }
    if (k === 't') {
      e.preventDefault();
      const tb = document.getElementById('sidebar-theme-toggle');
      if (tb && typeof tb.click === 'function') tb.click();
      return;
    }
    if (k === 'r') {
      e.preventDefault();
      loadGachaRecords(currentUid); // 重新拉取当前账号记录并渲染
    }
  });
}

/* ===================== 主进程广播订阅（仅绑定一次） ===================== */

let __ipcBound = false;

function initIpcSubscriptions() {
  if (__ipcBound) return;
  __ipcBound = true;
  // 获取/导入进度文案 → 状态栏（保留 .status-text span 结构由 React 渲染，这里只更新状态）
  window.electronAPI.on('gacha-records-status', (_event: unknown, status: unknown) => {
    setStatusMessage(String(status));
  });
  // 刷新/登录获取完成后主进程广播；停留在分析页则立即重载，否则切回时 bootGacha 重新拉取
  // 注意：preload 的 on 回调签名为 (event, ...args)，真正 payload 是第二个参数
  window.electronAPI.on(
    'gacha-records-updated',
    async (_event: unknown, payload: { playerId?: string | null }) => {
      if (document.getElementById('record-display')) {
        const pid = payload && payload.playerId;
        await reloadGachaData(pid);
      }
    },
  );
}

/* ===================== 启动 ===================== */

function notify(success: boolean, message: string) {
  showNotification(success, message);
}

/**
 * 分析页数据链路启动（GameToolsPage 挂载时调用；切页重挂载时重新拉取最新数据）。
 * 流程与遗留 gachaWuwaInit 一致：缓存温暖 → UID 下拉 + 记录 → tooltip/快捷键/IPC
 * → 账号解析 → 后台静默奇藏同步。
 */
export async function bootGacha(): Promise<void> {
  // 尽早用本地持久化账号命中奇藏缓存：首次渲染即刻显示上次「已有」数据，无需等待网络
  restoreSavedAccount();
  warmTreasureFromCache();
  const lastUid = await window.electronAPI.getLastQueryUid();
  await loadPlayerUIDs(lastUid); // 加载玩家 UID 下拉框
  await loadGachaRecords(lastUid); // 加载对应记录
  initRecordTooltips(); // 详情/卡片/列表头像的获取时间 tooltip
  initShortcuts(); // 快捷键：Ctrl+1/2/3/S/T/R
  initIpcSubscriptions(); // gacha-records-status / gacha-records-updated 订阅（仅一次）

  // 解析主账号（免启动器 / 免 UID），并自动同步奇藏/等级：
  // setSkipAutoSync 让 loadAccounts 自动选中期间不各自同步，由下面统一同步一次，
  // 确保进入程序时同步的一定是当前账号，且即使账号解析失败主进程也能免 oauthCode 兜底。
  await resolveMainAccount();
  setSkipAutoSync(true);
  await loadAccounts(false);
  setSkipAutoSync(false);
  warmTreasureFromCache(); // 用已确定的 oauthCode 命中缓存，立即显示上次的奇藏/等级/UID
  // 网络同步放后台静默执行（不 await，不阻塞启动收尾）：顶部缓存已完成即时呈现
  syncTreasureBoxes();
}
