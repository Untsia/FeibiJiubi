/**
 * 抽卡分析视图 —— 数据桥 Store。
 *
 * 职责：承接 gacha/data.ts + gacha/treasure.ts（自遗留 gachaWuwa.js 迁移）
 * 发布的数据（records/pools/uid/uidOptions/状态栏/头像/常驻/隐藏卡池/奇藏/等级/
 * 账号），经 useSyncExternalStore 驱动 React 视图组件重渲染。
 *
 * 数据流（事件驱动，无遗留脚本参与）：
 *   gacha/data.ts + gacha/treasure.ts（数据层）--发布--> store --notify--> React 视图
 * 视图切换（bar/intuitive/detail/qizang/level）由 data.ts 的 switchAnalysisView
 * 统一负责（偏好持久化 + 冷启动奇藏同步兜底 + 派发 'app-nav-view-changed' 给侧边栏）。
 */
import { useSyncExternalStore } from 'react';
import type {
  GachaDataState,
  GachaNavView,
  GachaStatus,
  GachaSubMode,
  TreasureAccount,
  TreasureData,
} from './types';

/** 初始快照：无任何数据。视图渲染前 bootGacha 一定先发布（module 级保留，切页不丢） */
let state: GachaDataState = {
  status: 'idle',
  records: [],
  pools: {},
  uid: null,
  uidOptions: [],
  statusMessage: '「云鸣潮获取」读取云鸣潮的唤取链接；「鸣潮内获取」从本地游戏日志读取，需先在游戏内打开一次唤取记录',
  avatarMap: { byResourceId: {}, byName: {} },
  commonItems: [],
  hiddenPools: [],
  treasure: null,
  level: null,
  accountOptions: [],
  accountOauthCode: null,
  accountIsGlobal: null,
  accountLabel: '选择账号',
  currentView: 'bar',
  qizangSubMode: 'overview',
  levelSubMode: 'overview',
  growNumFull: true,
};

const listeners = new Set<() => void>();

function setState(patch: Partial<GachaDataState>) {
  state = Object.assign({}, state, patch);
  listeners.forEach((fn) => fn());
}

/* ---------- subscribe / snapshot（供 useSyncExternalStore） ---------- */
export function subscribeGacha(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getGachaSnapshot(): GachaDataState {
  return state;
}

/**
 * 细粒度订阅：仅当 selector 返回值变化（Object.is）时才触发组件重渲染。
 * 注意：selector 必须返回原始值或「引用稳定」的数据（如 s.records / s.pools /
 * s.hiddenPools / s.qizangSubMode / s.accountOptions），禁止每次新建对象/数组，
 * 否则会无限循环。组件在内部可用 useMemo 基于这些引用派生计算。
 */
export function useGachaSelector<T>(selector: (s: GachaDataState) => T): T {
  return useSyncExternalStore(subscribeGacha, () => selector(state), () => selector(state));
}

/* ---------- 发布 API（gacha/data.ts + gacha/treasure.ts → store） ---------- */
export function publishData(patch: Partial<GachaDataState>) {
  setState(patch);
}

export function publishStatus(status: GachaStatus) {
  setState({ status });
}

export function publishTreasure(treasure: TreasureData | null, level: number | null) {
  setState({ treasure, level });
}

export function setHiddenPools(hiddenPools: string[]) {
  setState({ hiddenPools });
}

/** UID 下拉框选项更新（get-player-uids 返回，含当前选中展示依据 uid） */
export function setUidOptions(uidOptions: string[]) {
  setState({ uidOptions });
}

/** 状态栏文案更新（主进程 gacha-records-status 推送 / 引导） */
export function setStatusMessage(statusMessage: string) {
  setState({ statusMessage });
}

/** 奇藏同步账号下拉框选项更新 */
export function setAccountOptions(accountOptions: TreasureAccount[]) {
  setState({ accountOptions });
}

/** 当前选中同步账号（oauthCode/isGlobal + 显示文案）更新 */
export function setAccountSelection(
  accountOauthCode: string | null,
  accountIsGlobal: boolean | null,
  accountLabel: string,
) {
  setState({ accountOauthCode, accountIsGlobal, accountLabel });
}

/** 分析子视图切换发布（data.ts switchAnalysisView 调用，镜像 currentView） */
export function setCurrentView(view: GachaNavView) {
  setState({ currentView: view });
}

/** 奇藏视图子模式切换（sub-view-tabbar 总览/差值对比） */
export function setQizangSubMode(mode: GachaSubMode) {
  setState({ qizangSubMode: mode });
}

/** 等级视图子模式切换（sub-view-tabbar 总览/差值对比） */
export function setLevelSubMode(mode: GachaSubMode) {
  setState({ levelSubMode: mode });
}

/** 数字 缩写(w)/完整 全局切换（奇藏/等级共用，切换 tab 不重置） */
export function setGrowNumFull(full: boolean) {
  setState({ growNumFull: full });
}
