/**
 * 表格视图 —— 取代遗留 views/tableView.js。
 *
 * 结构 / 类名 / 图标与原渲染结果字节一致（.table-sidebar + .table-main），
 * 分页 / 筛选状态存于 viewState.ts（原本 gachaWuwa.js 的 tableState 全局，
 * 切换视图组件卸载后仍保留），每页条数变更持久化到 localStorage。
 *
 * 与遗留行为的差异说明：
 * - 空数据（records 为空）时原实现不渲染本视图（空白占位），此处保持一致。
 * - 翻页越界（数据变少导致当前页超界）时按派生页渲染，并写回 store 修正。
 */
import { memo, useEffect, useMemo } from 'react';
import { useGachaSelector } from '../store';
import {
  setTablePage,
  setTablePageSize,
  setTablePool,
  setTableTotalPages,
  useTableViewState,
} from '../viewState';
import { recordTime } from '../utils';
import type { GachaRecord } from '../types';
import RecordAvatar from './RecordAvatar';

const PAGE_SIZES = [20, 50, 100, 200];

function TableView() {
  const records = useGachaSelector((s) => s.records);
  const hiddenPools = useGachaSelector((s) => s.hiddenPools);
  const avatarMap = useGachaSelector((s) => s.avatarMap);
  const currentView = useGachaSelector((s) => s.currentView);
  const tableState = useTableViewState();

  const hidden = useMemo(() => new Set(hiddenPools), [hiddenPools]);

  // 非当前视图时跳过本视图的筛选与全量排序（六视图常驻挂载，隐藏视图重算是纯浪费）。
  // 注意：必须在下面各 useMemo 之前定义，避免 TDZ。
  const isActive = currentView === 'table';

  // 卡池按钮列表：按每池「最新记录时间」降序（原 renderTableView 的 poolMaxTime 排序）
  const poolButtons = useMemo(() => {
    const poolMaxTime: Record<string, string> = {};
    if (!isActive) return [];
    records.forEach((r) => {
      const p = r.card_pool_type;
      const t = recordTime(r);
      if (p && (!poolMaxTime[p] || t > poolMaxTime[p])) poolMaxTime[p] = t;
    });
    return Object.keys(poolMaxTime)
      .filter((p) => p && !hidden.has(p))
      .sort((a, b) => (poolMaxTime[b] || '').localeCompare(poolMaxTime[a] || ''));
  }, [records, hidden, isActive]);

  // 筛选（隐藏卡池 + 当前池）后按时间降序（原 renderTablePage）
  const filtered = useMemo(() => {
    if (!isActive) return [];
    return records
      .filter((r) => !hidden.has(r.card_pool_type) && (!tableState.pool || r.card_pool_type === tableState.pool))
      .sort((a, b) => recordTime(b).localeCompare(recordTime(a)));
  }, [records, hidden, tableState.pool, isActive]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / tableState.pageSize));
  const page = Math.min(tableState.page, totalPages);
  const start = (page - 1) * tableState.pageSize;
  const pageRows = filtered.slice(start, start + tableState.pageSize);

  // 同步 totalPages / 越界修正（值未变化时 set 内部跳过，安全）。
  // 非活动视图的 filtered 被刻意置空，此时的 totalPages 无意义，
  // 若不跳过会把用户当前页码错误地重置为 1（该状态持久化在 store 里）。
  useEffect(() => {
    if (!isActive) return;
    setTableTotalPages(totalPages);
    if (tableState.page > totalPages) setTablePage(totalPages);
  }, [totalPages, tableState.page, isActive]);

  const atFirst = page <= 1;
  const atLast = page >= totalPages;

  // 空数据：与原实现一致，视图留白（置于全部 Hooks 之后，避免 Hook 计数随数据变化）
  if (records.length === 0) {
    return <div id="view-table" className={'analysis-view' + (currentView === 'table' ? ' active' : '')} />;
  }

  return (
    <div id="view-table" className={'analysis-view' + (currentView === 'table' ? ' active' : '')}>
      <div className="table-sidebar">
        <div className="table-sidebar-title">卡池类型</div>
        <button
          className={'table-pool-btn' + (tableState.pool === null ? ' active' : '')}
          data-pool=""
          onClick={() => setTablePool(null)}
        >
          全部
        </button>
        {poolButtons.map((p) => (
          <button
            key={p}
            className={'table-pool-btn' + (tableState.pool === p ? ' active' : '')}
            data-pool={p}
            onClick={() => setTablePool(p)}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="table-main">
        <div className="table-scroll">
          <table className="gacha-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>星级</th>
                <th>类型</th>
                <th>卡池</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r, i) => {
                const q = r.quality_level;
                const qcls = q === 5 ? 'q5' : q === 4 ? 'q4' : 'q3';
                const typeLabel = (r.card_pool_type || '').includes('角色')
                  ? '角色'
                  : (r.card_pool_type || '').includes('武器')
                    ? '武器'
                    : '—';
                return (
                  <tr key={r.id ?? i} className={`gacha-row ${qcls}`}>
                    <td className="gacha-name">
                      <RecordAvatar record={r} map={avatarMap} />
                      <span>{r.name}</span>
                    </td>
                    <td className="gacha-quality">{q}★</td>
                    <td className="gacha-type">{typeLabel}</td>
                    <td className="gacha-pool">{r.card_pool_type || '—'}</td>
                    <td className="gacha-time">{recordTime(r) || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="table-pager">
          <div className="table-page-group">
            <button className="table-page-btn" id="table-first" title="首页" aria-label="首页" disabled={atFirst} onClick={() => setTablePage(1)}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="13 17 8 12 13 7"></polyline><polyline points="18 17 13 12 18 7"></polyline></svg>
            </button>
            <button className="table-page-btn" id="table-prev" title="上一页" aria-label="上一页" disabled={atFirst} onClick={() => setTablePage(Math.max(1, page - 1))}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <span id="table-page-info">
              {page} / {totalPages}
            </span>
            <button className="table-page-btn" id="table-next" title="下一页" aria-label="下一页" disabled={atLast} onClick={() => setTablePage(Math.min(totalPages, page + 1))}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
            <button className="table-page-btn" id="table-last" title="末页" aria-label="末页" disabled={atLast} onClick={() => setTablePage(totalPages)}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="11 17 16 12 11 7"></polyline><polyline points="6 17 11 12 6 7"></polyline></svg>
            </button>
          </div>
          <span className="table-page-size">
            每页
            <select
              id="table-page-size"
              value={tableState.pageSize}
              onChange={(e) => setTablePageSize(parseInt(e.target.value, 10))}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </span>
          <span className="table-total">
            共 <b id="table-total">{total}</b> 条
          </span>
        </div>
      </div>
    </div>
  );
}

export default memo(TableView);