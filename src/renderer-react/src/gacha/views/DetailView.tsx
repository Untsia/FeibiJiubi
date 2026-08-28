/**
 * 详情视图 —— 取代遗留 views/detailView.js。
 *
 * 结构 / 类名 / SVG 图标与原渲染结果字节一致（.detail-sidebar + .detail-content）。
 * 状态（卡池筛选 / 分页 / 星级 / 日期筛选 / 浮层开合）从 renderDetailView 的
 * 闭包变量迁移为组件 React state：
 * - currentPool / starFilter / timeFilter：数据（pools / hiddenPools）变化时重置，
 *   等价遗留「每次 renderDetailView 重建闭包」的行为（切账号、应用隐藏卡池后回到默认）。
 * - pageSize 持久化到 localStorage('wuwa_detail_page_size')。
 * - 星级 / 日期浮层：open 类由 state 驱动，打开时经 getBoundingClientRect 定位
 *   （原 positionPop），点击外部 / 重复点击表头关闭（原 document click + stopPropagation）。
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useGachaSelector } from '../store';
import { escapeHtml, recordTime } from '../utils';
import type { GachaPool, GachaRecord } from '../types';
import RecordAvatar from './RecordAvatar';

/** 卡池排序（与原 renderDetailView 的 GACHA_TYPE_ORDER 一致） */
const GACHA_TYPE_ORDER = [
  '角色活动唤取', '武器活动唤取', '角色联动唤取', '武器联动唤取',
  '角色新旅唤取', '武器新旅唤取', '角色忆旅唤取', '武器忆旅唤取',
  '角色常驻唤取', '武器常驻唤取', '新手限定唤取', '新手自选唤取',
  '感恩定向唤取',
];
const PAGE_SIZES = [10, 20, 50, 100];

function readDetailPageSize(): number {
  try {
    return parseInt(localStorage.getItem('wuwa_detail_page_size') || '10', 10) || 10;
  } catch (e) {
    return 10;
  }
}

function DetailView() {
  const records = useGachaSelector((s) => s.records);
  const pools = useGachaSelector((s) => s.pools);
  const hiddenPools = useGachaSelector((s) => s.hiddenPools);
  const avatarMap = useGachaSelector((s) => s.avatarMap);
  const currentView = useGachaSelector((s) => s.currentView);

  const hidden = useMemo(() => new Set(hiddenPools), [hiddenPools]);
  const showSummary = useMemo(() => !hidden.has('__SUMMARY_ALL__'), [hidden]);

  // 卡池按钮有序列表（排除已隐藏 / 无数据池）
  const poolTypes = useMemo(() => {
    const ordered = GACHA_TYPE_ORDER.filter((t) => pools[t] && pools[t].length);
    const extra = Object.keys(pools).filter((t) => !GACHA_TYPE_ORDER.includes(t) && pools[t] && pools[t].length);
    return ordered.concat(extra).filter((t) => !hidden.has(t));
  }, [pools, hidden]);

  const defaultPool = showSummary ? 'all' : poolTypes[0] || '';
  const [currentPool, setCurrentPool] = useState<string>(defaultPool);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(readDetailPageSize);
  const [starFilter, setStarFilter] = useState<Set<number>>(() => new Set());
  const [timeFilter, setTimeFilter] = useState<Set<string>>(() => new Set());
  const [starOpen, setStarOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);

  // 数据（切账号 / 应用隐藏卡池 / 刷新）变化：重置状态，等价遗留重建闭包
  useEffect(() => {
    setCurrentPage(1);
    setStarFilter(new Set());
    setTimeFilter(new Set());
    setCurrentPool(showSummary ? 'all' : poolTypes[0] || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pools, hiddenPools]);

  // 非当前视图时跳过开销较大的筛选与排序（六视图常驻挂载，隐藏视图重算是纯浪费）。
  const isActive = currentView === 'detail';
  // 筛选后的有序列表（全部池 / 单池 + 星级 + 日期）
  const filtered = useMemo(() => {
    if (!isActive) return [];
    let list: GachaRecord[];
    if (currentPool === 'all') {
      if (!showSummary) return [];
      list = records.slice();
    } else {
      if (poolTypes.length === 0) return [];
      list = records.filter((r) => r.card_pool_type === currentPool);
    }
    if (starFilter.size) list = list.filter((r) => starFilter.has(r.quality_level));
    if (timeFilter.size) list = list.filter((r) => timeFilter.has(recordTime(r).split(' ')[0] || ''));
    return [...list].sort((a, b) => recordTime(b).localeCompare(recordTime(a)));
  }, [records, currentPool, poolTypes, showSummary, starFilter, timeFilter, isActive]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.max(1, Math.min(currentPage, totalPages));
  const start = (page - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);

  // 日期聚合（浮层列表）：日期 -> { count, maxStar }
  const dateItems = useMemo(() => {
    if (!isActive) return [];
    const base = currentPool === 'all' ? records.slice() : records.filter((r) => r.card_pool_type === currentPool);
    const dateMap = new Map<string, { count: number; maxStar: number }>();
    base.forEach((r) => {
      const d = recordTime(r).split(' ')[0] || '';
      if (!d) return;
      if (!dateMap.has(d)) dateMap.set(d, { count: 0, maxStar: 0 });
      const e = dateMap.get(d)!;
      e.count++;
      const star = Number(r.quality_level) || 0;
      if (star > e.maxStar) e.maxStar = star;
    });
    return [...dateMap.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [records, currentPool, isActive]);

  /* ---------- 浮层定位 / 开合（原 positionPop / openPop / closePops / doc click） ---------- */
  const detailContentRef = useRef<HTMLDivElement>(null);
  const starPopRef = useRef<HTMLDivElement>(null);
  const timePopRef = useRef<HTMLDivElement>(null);
  const starThRef = useRef<HTMLTableCellElement>(null);
  const timeThRef = useRef<HTMLTableCellElement>(null);
  const starOpenRef = useRef(starOpen);
  const timeOpenRef = useRef(timeOpen);
  starOpenRef.current = starOpen;
  timeOpenRef.current = timeOpen;
  // 始终保存最新的 state 供 document click 判断（避免闭包过期）
  const setOpenRef = useRef({ setStarOpen, setTimeOpen });
  setOpenRef.current = { setStarOpen, setTimeOpen };

  function positionPop(pop: HTMLDivElement | null, th: HTMLTableCellElement | null) {
    const content = detailContentRef.current;
    if (!pop || !th || !content) return;
    const tr = th.getBoundingClientRect();
    const cr = content.getBoundingClientRect();
    const popW = pop.offsetWidth || 260;
    let left = tr.left - cr.left + (tr.width - popW) / 2;
    if (left < 4) left = 4;
    const maxLeft = cr.width - popW - 4;
    if (left > maxLeft) left = Math.max(4, maxLeft);
    pop.style.left = left + 'px';
    pop.style.top = tr.bottom - cr.top + 8 + 'px';
  }

  useEffect(() => {
    if (starOpen) positionPop(starPopRef.current, starThRef.current);
  }, [starOpen]);
  useEffect(() => {
    if (timeOpen) positionPop(timePopRef.current, timeThRef.current);
  }, [timeOpen]);

  function toggleStar(v: number) {
    const next = new Set(starFilter);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setStarFilter(next);
    setCurrentPage(1);
  }

  function toggleDate(d: string) {
    const next = new Set(timeFilter);
    if (next.has(d)) next.delete(d);
    else next.add(d);
    setTimeFilter(next);
    setCurrentPage(1);
  }

  // 点击外部关闭浮层（原 document click → closePops）
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Element | null;
      const inStar = starPopRef.current?.contains(t);
      const inTime = timePopRef.current?.contains(t);
      const onStarTh = starThRef.current?.contains(t);
      const onTimeTh = timeThRef.current?.contains(t);
      if (!inStar && !onStarTh) setOpenRef.current.setStarOpen(false);
      if (!inTime && !onTimeTh) setOpenRef.current.setTimeOpen(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  const todayFilterFn = (d: string) => {
    const rowClicked = timeFilter.has(d);
    return rowClicked;
  };

  return (
    <div id="view-detail" className={'analysis-view' + (currentView === 'detail' ? ' active' : '')}>
      <div className="detail-sidebar">
        <div className="detail-sidebar-title">卡池筛选</div>
        {showSummary ? (
          <button
            className={`detail-pool-btn${currentPool === 'all' ? ' active' : ''}`}
            data-pool="all"
            onClick={() => {
              setCurrentPool('all');
              setCurrentPage(1);
            }}
          >
            全部卡池
          </button>
        ) : null}
        {poolTypes.map((t) => (
          <button
            key={t}
            className={`detail-pool-btn${currentPool === t ? ' active' : ''}`}
            data-pool={t}
            onClick={() => {
              setCurrentPool(t);
              setCurrentPage(1);
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="detail-content" ref={detailContentRef}>
        <div className="detail-table-scroll">
          <table className="detail-table">
            <colgroup>
              <col className="col-avatar" />
              <col className="col-name" />
              <col className="col-quality" />
              <col className="col-pool" />
              <col className="col-time" />
            </colgroup>
            <thead>
              <tr>
                <th className="detail-th-avatar">头像</th>
                <th>名称</th>
                <th
                  ref={starThRef}
                  className={'detail-th-filter' + (starFilter.size ? ' filtered' : '')}
                  data-filter="quality"
                  onClick={(e) => {
                    e.stopPropagation();
                    setStarOpen((o) => !o);
                    setTimeOpen(false);
                  }}
                >
                  星级
                </th>
                <th>卡池</th>
                <th
                  ref={timeThRef}
                  className={'detail-th-filter' + (timeFilter.size ? ' filtered' : '')}
                  data-filter="time"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTimeOpen((o) => !o);
                    setStarOpen(false);
                  }}
                >
                  时间
                </th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r, i) => (
                <tr key={r.id ?? i} className={`detail-row q${r.quality_level}`} data-time={recordTime(r)}>
                  <td className="detail-avatar">
                    <span className="record-avatar-wrap">
                      <RecordAvatar record={r} map={avatarMap} />
                    </span>
                  </td>
                  <td className="detail-name">
                    <span className="detail-name-text">{r.name || ''}</span>
                  </td>
                  <td className="detail-quality">
                    <span className="q-badge">{r.quality_level} 星</span>
                  </td>
                  <td className="detail-pool">{r.card_pool_type || ''}</td>
                  <td className="detail-time">{recordTime(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="detail-pager">
          <div className="detail-page-group">
            <button
              className="detail-page-btn"
              id="detail-prev"
              aria-label="上一页"
              disabled={page <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <span className="detail-total">
              第 <b id="detail-current">{page}</b> / <span id="detail-page-total">{totalPages}</span> 页 · 共{' '}
              <b id="detail-count">{filtered.length}</b> 条
            </span>
            <button
              className="detail-page-btn"
              id="detail-next"
              aria-label="下一页"
              disabled={page >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
          </div>
          <span className="detail-page-size">
            每页
            <select
              id="detail-page-size"
              value={pageSize}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setPageSize(n);
                setCurrentPage(1);
                try {
                  localStorage.setItem('wuwa_detail_page_size', String(n));
                } catch (err) {
                  /* ignore */
                }
              }}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n} dangerouslySetInnerHTML={{ __html: `${n}/条` }} />
              ))}
            </select>
          </span>
        </div>

        {/* 星级筛选浮层 */}
        <div
          ref={starPopRef}
          className={'detail-filter-pop' + (starOpen ? ' open' : '')}
          id="star-filter-pop"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="dfp-title">按星级筛选</div>
          <div className="dfp-option-list" id="star-option-list">
            {[5, 4, 3].map((v) => (
              <button
                key={v}
                type="button"
                className={'dfp-option' + (starFilter.has(v) ? ' active' : '')}
                data-star={v}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleStar(v);
                }}
              >
                {v} 星
              </button>
            ))}
          </div>
          <div className="dfp-actions">
            <button
              type="button"
              id="star-confirm"
              className="dfp-btn primary"
              onClick={(e) => {
                e.stopPropagation();
                setStarOpen(false);
              }}
            >
              确定
            </button>
            <button
              type="button"
              id="star-clear"
              className="dfp-btn ghost"
              onClick={(e) => {
                e.stopPropagation();
                setStarFilter(new Set());
                setCurrentPage(1);
              }}
            >
              清除
            </button>
          </div>
        </div>

        {/* 日期筛选浮层 */}
        <div
          ref={timePopRef}
          className={'detail-filter-pop' + (timeOpen ? ' open' : '')}
          id="time-filter-pop"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="dfp-title">按日期筛选</div>
          <div className="dfp-option-list column" id="time-date-list">
            {dateItems.length
              ? dateItems.map(([d, e]) => {
                  const star = e.maxStar >= 5 ? 5 : e.maxStar >= 4 ? 4 : 3;
                  return (
                    <button
                      key={d}
                      type="button"
                      className={
                        'dfp-option' + (todayFilterFn(d) ? ' active' : '') + ' date-star-' + star
                      }
                      data-date={d}
                      dangerouslySetInnerHTML={{
                        __html: escapeHtml(d) + ' <span class="date-count">' + e.count + '抽</span>',
                      }}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        toggleDate(d);
                      }}
                    />
                  );
                })
              : null}
            {!dateItems.length ? <div className="dfp-empty">无可用日期</div> : null}
          </div>
          <div className="dfp-actions">
            <button
              type="button"
              id="time-confirm"
              className="dfp-btn primary"
              onClick={(e) => {
                e.stopPropagation();
                setTimeOpen(false);
              }}
            >
              确定
            </button>
            <button
              type="button"
              id="time-clear"
              className="dfp-btn ghost"
              onClick={(e) => {
                e.stopPropagation();
                setTimeFilter(new Set());
                setCurrentPage(1);
              }}
            >
              清除
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(DetailView);