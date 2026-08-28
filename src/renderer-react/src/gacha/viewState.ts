/**
 * 表格视图 —— 分页状态 Store（跨页保留）。
 *
 * 对应遗留 gachaWuwa.js 的共享全局 tableState：切换视图（表格 → 条形/卡片/奇藏…）
 * 时组件卸载，而分页/筛选状态必须保留，故放在模块级 + useSyncExternalStore，
 * 由 Table 视图组件订阅，翻页/筛选时原地重渲染，不影响其他视图。
 */
import { useSyncExternalStore } from 'react';

/** 表格视图分页状态（与遗留 gachaWuwa.js tableState 字段一致） */
export interface TableViewState {
  page: number;
  pageSize: number;
  /** 当前筛选卡池 key（null = 全部） */
  pool: string | null;
  totalPages: number;
}

let tableState: TableViewState = {
  page: 1,
  pageSize: (function () {
    try {
      return parseInt(localStorage.getItem('wuwa_table_page_size') || '50', 10) || 50;
    } catch (e) {
      return 50;
    }
  })(),
  pool: null,
  totalPages: 1,
};

const listeners = new Set<() => void>();

function setTableState(patch: Partial<TableViewState>) {
  tableState = Object.assign({}, tableState, patch);
  listeners.forEach((fn) => fn());
}

/* ---------- subscribe / snapshot（供 useSyncExternalStore） ---------- */
export function subscribeTable(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getTableSnapshot(): TableViewState {
  return tableState;
}

/** Table 视图组件统一入口 */
export function useTableViewState(): TableViewState {
  return useSyncExternalStore(subscribeTable, getTableSnapshot);
}

/* ---------- 变更 API（Table 组件内部翻页/筛选调用） ---------- */
export function setTablePage(page: number) {
  setTableState({ page });
}

export function setTablePageSize(pageSize: number) {
  // 与遗留行为一致：每页条数变更后回到第一页，并持久化到 localStorage
  setTableState({ pageSize, page: 1 });
  try {
    localStorage.setItem('wuwa_table_page_size', String(pageSize));
  } catch (e) {
    /* ignore */
  }
}

export function setTablePool(pool: string | null) {
  setTableState({ pool, page: 1 });
}

export function setTableTotalPages(totalPages: number) {
  // 值未变化时跳过（组件渲染期反复推导 totalPages，避免无限 notify 循环）
  if (tableState.totalPages === totalPages) return;
  setTableState({ totalPages });
}