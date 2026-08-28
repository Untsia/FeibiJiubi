/**
 * 条形（列表）视图 —— 取代遗留 views/barView.js + shared.js 的条形部分。
 *
 * 渲染：renderers.renderBarViewHtml 生成与原实现字节一致的 HTML（.bar-view）。
 * 交互：点击五星进度条展开「本段抽数内的四星」详情（toggleBarRowDetail 迁移）；
 *       主题切换时按深浅色重绘 .bar-fill 颜色（原 refreshBarFillColors 迁移）。
 * 事件一律委托到根容器，DOM 重建无需重绑。
 */
import { memo, useEffect, useMemo, useRef } from 'react';
import { useGachaSelector } from '../store';
import { buildBarRowDetailHtml, renderBarViewHtml } from '../renderers';
import type { BarRenderResult } from '../renderers';
import { drawsToNext, getBarDrawColor } from '../utils';
import type { AvatarMap, GachaRecord } from '../types';

/** 切换/收起某条五星进度条的展开详情（原 shared.js toggleBarRowDetail） */
function toggleRowDetail(row: HTMLElement, fours: GachaRecord[], totalDraws: number, avatarMap: AvatarMap) {
  const container = row.parentElement;
  if (!container) return;
  const next = row.nextElementSibling;
  if (next && next.classList.contains('bar-row-detail')) {
    next.remove();
    row.classList.remove('expanded');
    return;
  }
  container.querySelectorAll('.bar-row-detail').forEach((d) => d.remove());
  container.querySelectorAll('.bar-row.expanded').forEach((d) => d.classList.remove('expanded'));
  const holder = document.createElement('div');
  holder.innerHTML = buildBarRowDetailHtml(fours, totalDraws, avatarMap);
  const detailNode = holder.firstElementChild as HTMLElement | null;
  if (!detailNode) return;
  row.classList.add('expanded');
  container.insertBefore(detailNode, row.nextElementSibling);
}

function BarView() {
  const records = useGachaSelector((s) => s.records);
  const pools = useGachaSelector((s) => s.pools);
  const hiddenPools = useGachaSelector((s) => s.hiddenPools);
  const avatarMap = useGachaSelector((s) => s.avatarMap);
  const commonItems = useGachaSelector((s) => s.commonItems);
  const currentView = useGachaSelector((s) => s.currentView);

  const hidden = useMemo(() => new Set(hiddenPools), [hiddenPools]);
  const rootRef = useRef<HTMLDivElement>(null);
  // 交互数据引用：事件委托读取最新值；赋值不触发渲染，避免 effect 重绑
  const resultRef = useRef<BarRenderResult | null>(null);
  const avatarRef = useRef(avatarMap);
  avatarRef.current = avatarMap;

  // 六个视图是常驻挂载、靠 CSS .active 显隐的，因此 records 一变就会被全部重算。
  // 非当前视图的内容当前不可见，重算纯属浪费（万级记录下整页 HTML 拼接是主要开销之一）。
  // 这里对非活动视图直接跳过渲染：html 为空时外层 div 依然存在（id / class 不变），
  // 仅内容为空，DOM 结构与事件委托保持不变，切回来时随依赖变化自动重算。
  const isActive = currentView === 'bar';
  const { html, result } = useMemo(() => {
    if (!isActive) return { html: '', result: null };
    const r = renderBarViewHtml({ records, pools, hidden, avatarMap, commonItems });
    return { html: r.html, result: r };
  }, [records, pools, hidden, avatarMap, commonItems, isActive]);
  resultRef.current = result;

  // 主题切换重绘条形进度条深/浅配色（原 gachaWuwa.js theme-mode-changed → refreshBarFillColors）
  useEffect(() => {
    const onTheme = () => {
      rootRef.current?.querySelectorAll<HTMLElement>('.bar-fill[data-draws]').forEach((el) => {
        el.style.background = getBarDrawColor(parseInt(el.dataset.draws || '0', 10) || 0);
      });
    };
    window.addEventListener('theme-mode-changed', onTheme);
    return () => window.removeEventListener('theme-mode-changed', onTheme);
  }, []);

  // 点击五星进度条行：展开/收起本段四星（事件委托到根容器，DOM 重建无需重绑）
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const row = target ? target.closest('.bar-row') : null;
      if (!row || !(row instanceof HTMLElement) || !root.contains(row)) return;
      const data = resultRef.current;
      if (!data) return;

      // 垫抽行（pity-row）：展开「最近垫抽段（含本次）的四星」
      if (row.classList.contains('pity-row')) {
        const poolKey = row.closest('[data-pool-key]')?.getAttribute('data-pool-key') || '';
        const pd = data.interaction.pools[poolKey];
        if (!pd) return;
        const fours = pd.recs.slice(0, pd.currentPity).filter((x) => x.quality_level === 4);
        toggleRowDetail(row, fours, pd.currentPity, avatarRef.current);
        return;
      }
      const idx = row.dataset.fiveIdx;
      if (idx === undefined) return;
      const fiveIdx = Number(idx);

      // 全部卡池汇总卡：跨参与汇总的可见卡池按时间区间收集四星
      const isSummary = !!row.closest('[data-char-key="__summary__"]');
      if (isSummary) {
        const s = data.interaction.summary;
        if (!s) return;
        const a = s.fiveItems[fiveIdx];
        if (!a) return;
        const b = s.fiveItems[fiveIdx + 1];
        const t1 = a.r.timestamp;
        const t2 = b ? b.r.timestamp : null;
        const fours: GachaRecord[] = [];
        s.visiblePoolRecs.forEach((recs) =>
          recs.forEach((x) => {
            if (x.quality_level === 4 && x.timestamp <= t1 && (t2 == null || x.timestamp > t2)) fours.push(x);
          }),
        );
        toggleRowDetail(row, fours, a.draws, avatarRef.current);
        return;
      }

      // 单卡池：展开「本五星到下一个五星之间」的四星
      const poolKey = row.closest('[data-pool-key]')?.getAttribute('data-pool-key') || '';
      const pd = data.interaction.pools[poolKey];
      if (!pd) return;
      const nr = pd.fiveList[fiveIdx];
      if (!nr) return;
      const i = pd.recs.indexOf(nr);
      const nextNr = pd.fiveList[fiveIdx + 1];
      const j = nextNr ? pd.recs.indexOf(nextNr) : pd.recs.length;
      const fours = pd.recs.slice(i + 1, j).filter((x) => x.quality_level === 4);
      toggleRowDetail(row, fours, drawsToNext(pd.recs, nr, 5), avatarRef.current);
    };
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  }, []);

  return (
    <div
      ref={rootRef}
      id="view-bar"
      className={'analysis-view' + (currentView === 'bar' ? ' active' : '')}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default memo(BarView);