/**
 * 抽卡分析视图 —— HTML 渲染器（从遗留 barView.js / intuitiveView.js / shared.js 迁移）。
 *
 * 与原实现逐字节保真：CSS 类名 / DOM 结构 / 文案 / 换行完全一致，
 * 仅移除浏览器全局（window / document）依赖 —— 数据全部经参数传入，
 * 头像 / 常驻列表由显式参数提供（不再读 window.gachaAvatarMap / commonItems）。
 *
 * 职责边界：
 *   - 本文件只生成 HTML 字符串（危险注入视图的 innerHTML）；
 *   - 视图交互（点击展开四星详情、数字缩写切换等）由 React 组件在其
 *     effect / 事件委托中绑定，所需中间数据由「渲染结果」一并返回。
 */
import type { AvatarMap, CommonItemShape, GachaPool, GachaRecord } from './types';
import {
  avatarSpriteHtml,
  buildAllPoolsMiniGridHtml,
  buildIntuitiveCharCardHtml,
  buildMiniGridHtml,
  buildPityTrend,
  buildSparklineSvg,
  calculateDrawsBetween,
  calculateLastDraws,
  calculateNoDeviationRate,
  calculateUpAverage,
  computeAllPools,
  computePoolStats,
  drawsToNext,
  emptyStateHtml,
  escapeHtml,
  getBarDrawColor,
  isCharLimitedPool,
  isCommonItem,
  isWeaponLimitedPool,
} from './utils.ts';

/** 视图渲染公共入参 */
export interface ViewRenderOpts {
  records: GachaRecord[];
  pools: GachaPool;
  hidden: Set<string>;
  avatarMap: AvatarMap;
  commonItems: CommonItemShape[];
}

/** 卡池类型顺序（与遗留 barView / intuitiveView 一致） */
export const POOL_ORDER = [
  '角色活动唤取', '武器活动唤取', '角色联动唤取', '武器联动唤取',
  '角色新旅唤取', '武器新旅唤取', '角色忆旅唤取', '武器忆旅唤取', '角色常驻唤取', '武器常驻唤取',
  '新手限定唤取', '新手自选唤取', '感恩定向唤取',
];

/** 有数据的卡池（按 POOL_ORDER 排序） */
function orderedCats(pools: GachaPool): { key: string; title: string }[] {
  return POOL_ORDER.filter((k) => pools[k] && pools[k].length).map((k) => ({ key: k, title: k }));
}

/** 空记录占位（与记录头像一致：漂泊者·导电） */
const PITY_SHAPE: GachaRecord = { name: '漂泊者·导电', quality_level: 5, resource_id: '', player_id: '', card_pool_type: '', timestamp: '' };

/* =====================================================================
 * 全部卡池汇总卡（bar / card 两 variant，原 shared.js buildAllPoolsCard）
 * ===================================================================== */

/** 汇总卡渲染结果（含 bar 展开交互所需数据） */
export interface SummaryCardResult {
  html: string;
  /** bar 展开：跨全部可见池按时间区间收集四星（含本段区间计算） */
  fiveItems: FiveItemShape[];
  /** bar 展开：参与汇总的可见卡池记录（顺序与汇总一致） */
  visiblePoolRecs: GachaRecord[][];
}

export interface FiveItemShape { r: GachaRecord; draws: number; isDeviation: boolean; isUp: boolean; }

/**
 * 生成「全部卡池」汇总卡 HTML；被隐藏（__SUMMARY_ALL__）或卡池不足时返回 null。
 * 与原实现差异：不再写 window.__intuitiveCharData（全项目无读取方，纯历史残留）。
 */
export function buildAllPoolsCardHtml(
  cats: { key: string; title: string }[],
  pools: GachaPool,
  hidden: Set<string>,
  commonItems: CommonItemShape[],
  avatarMap: AvatarMap,
  variant: 'bar' | 'card',
): SummaryCardResult | null {
  const all = computeAllPools(cats, pools, hidden, commonItems);
  if (!all) return null;
  const { allTotal, allFive, allFour, allLimitedFive, allStdFive, avgFive, avgLimited, fiveRate, fourRate, dateRange, fiveItems, fourItems } = all;
  const miniHtml = buildAllPoolsMiniGridHtml(all);

  if (variant === 'bar') {
    const MAX_DRAW_ALL = 80;
    let summaryRows = '';
    fiveItems.forEach((it, fi) => {
      const draws = it.draws;
      const pct = Math.min(100, (draws / MAX_DRAW_ALL) * 100);
      const color = getBarDrawColor(draws);
      summaryRows += '<div class="bar-row" data-time="' + (it.r.timestamp || '') + '" data-five-idx="' + fi + '">' +
        '<div class="bar-avatar-wrap">' + avatarSpriteHtml(it.r, avatarMap) +
        (it.isUp ? '<span class="bar-up-badge">UP</span>' : '') +
        '</div><div class="bar-track"><div class="bar-fill" data-draws="' + draws + '" style="width:' + pct + '%;background:' + color + ';"></div>' +
        '<span class="bar-fill-text"><span class="bar-draws-num">' + draws + '</span>抽</span></div></div>';
    });
    const summarySpark = buildSparklineSvg(fiveItems.slice().reverse().map((it) => it.draws));
    const html = `
            <div class="bar-pool-head">
                <div class="bar-head-left">
                    <span class="bar-pool-title">全部卡池</span>
                    <span class="bar-pool-date">${dateRange}</span>
                </div>
                <span class="total-draws">${allTotal} 抽</span>
            </div>
            <div class="intuitive-mini-grid bar-mini-grid">${miniHtml}</div>
            <div class="bar-sparkline-wrap" title="五星出货抽数走势">${summarySpark}</div>
            <div class="bar-pool-rows">${summaryRows || '<div class="intuitive-empty">暂无记录</div>'}</div>
        `;
    // 展开交互所需：参与汇总的可见卡池记录（与 chart 分支一致顺序）
    const visiblePoolRecs = (all.catKeys || []).map((k) => pools[k] || []);
    return { html, fiveItems, visiblePoolRecs };
  }

  // card variant：按角色名合并，显示个数 xN，头像只显示一个
  const charAgg = new Map<string, { count: number; sample: GachaRecord; deviation: boolean; isUp: boolean }>();
  fiveItems.forEach((it) => {
    const name = it.r.name || '未知';
    if (!charAgg.has(name)) charAgg.set(name, { count: 0, sample: it.r, deviation: false, isUp: false });
    const a = charAgg.get(name)!;
    a.count++;
    if (it.isDeviation) a.deviation = true;
    if (it.isUp) a.isUp = true;
  });
  const aggArr = Array.from(charAgg.values());
  aggArr.sort((x, y) => y.count - x.count || (x.sample.name || '').localeCompare(y.sample.name || ''));
  const charListHtml = aggArr.length ? aggArr.map((a) => {
    return '<div class="intuitive-char-card quality-5" data-time="">' +
      '<div class="char-avatar-wrap">' + avatarSpriteHtml(a.sample, avatarMap) +
      (a.count > 1 ? '<span class="char-up-badge">' + (a.count - 1) + '</span>' : '') +
      '</div>' +
      '<span class="intuitive-char-name">' + escapeHtml(a.sample.name || '未知') + '</span>' +
      '<span class="intuitive-char-draws">' + a.count + '个</span></div>';
  }).join('') : '<div class="intuitive-empty">暂无五星</div>';
  const html = `
            <div class="intuitive-card-head">
                <div class="intuitive-head-left">
                    <span class="intuitive-card-title"><span class="intuitive-card-title-text">全部卡池</span></span>
                    <span class="intuitive-date">${dateRange}</span>
                </div>
                <span class="total-draws">${allTotal} 抽</span>
            </div>
            <div class="intuitive-card-body">
            <div class="intuitive-mini-grid">${miniHtml}</div>
            <div class="intuitive-sparkline-wrap" title="五星出货抽数走势">${buildSparklineSvg(fiveItems.slice().reverse().map((it) => it.draws))}</div>
            <div class="intuitive-char-list" data-charlist>${charListHtml}</div>
            </div>
        `;
  return { html, fiveItems, visiblePoolRecs: [] };
}

// 条形进度条配色原先在 utils.ts（getBarDrawColor）与本文件（getBarDrawColorSafe）
// 各写了一份且逐字节相同。保留 utils.ts 的唯一实现，这里直接复用。

/* =====================================================================
 * 条形视图（原 barView.js renderBarView）
 * ===================================================================== */

/** 条形视图交互所需数据（React 事件委托使用） */
export interface BarInteractionData {
  /** 卡池 key -> 该池渲染数据（fiveList / recs / currentPity 为展开计算所需） */
  pools: Record<string, { recs: GachaRecord[]; fiveList: GachaRecord[]; currentPity: number }>;
  /** 汇总卡展开数据（无汇总卡时为 null） */
  summary: { fiveItems: FiveItemShape[]; visiblePoolRecs: GachaRecord[][] } | null;
}

export interface BarRenderResult {
  html: string;
  interaction: BarInteractionData;
}

/** 条形视图完整 HTML（含空状态分支；空状态时 interaction.pools 为空） */
export function renderBarViewHtml(o: ViewRenderOpts): BarRenderResult {
  const hidden = o.hidden;
  const cats = orderedCats(o.pools);
  const MAX_DRAW = 80;
  let hasAny = false;
  const interaction: BarInteractionData = { pools: {}, summary: null };
  let sections = '';
  const summaryCard = buildAllPoolsCardHtml(cats, o.pools, hidden, o.commonItems, o.avatarMap, 'bar');
  if (summaryCard) {
    interaction.summary = { fiveItems: summaryCard.fiveItems, visiblePoolRecs: summaryCard.visiblePoolRecs };
    sections += '<div class="intuitive-card pool-all" data-char-key="__summary__">' + summaryCard.html + '</div>';
  }

  cats.forEach((cat) => {
    if (hidden.has(cat.key)) return;
    const recs = o.pools[cat.key] || [];
    const total = recs.length;
    if (!total) return;
    // 原先在这里手工重算了五星/四星数、出货率、垫抽、平均五星、平均限定、不歪概率与
    // 日期区间，紧接着又调用 computePoolStats() 把同一批 recs 整套再算一遍。
    // 两者算法逐行一致（recs 来自 o.pools[cat.key]，其 card_pool_type 即 cat.key），
    // 改为直接复用 stats 字段，省掉一整套重复计算（叠加 indexOf 优化后收益更明显）。
    const stats = computePoolStats(recs, o.commonItems);
    const isCharLimited = stats.isCharLimited;
    const isWeaponLimited = stats.isWeaponLimited;
    const five = stats.five;
    const four = stats.four;
    const fiveRate = stats.fiveRate;
    const fourRate = stats.fourRate;
    const currentPity = stats.currentPity;
    const fiveAvg = stats.fiveAvg;
    const avgLimited = stats.avgLimited;
    const noDeviation = stats.noDeviation;
    const dateRange = stats.dateRange;
    const statDefs = [
      { key: 'pity', label: '当前已垫', value: currentPity, cls: 'st-pity' },
      { key: 'nodev', label: '不歪概率', value: noDeviation, cls: 'st-nodev' },
      { key: 'avglimited', label: '平均限定', value: avgLimited, cls: 'st-avglimited' },
      { key: 'avgfive', label: '平均五星', value: isWeaponLimited ? '—' : fiveAvg, cls: 'st-avgfive' },
      { key: 'five', label: '五星总数', value: five, cls: 'st-five' },
      { key: 'four', label: '四星总数', value: four, cls: 'st-four' },
      { key: 'fiverate', label: '五星出率', value: fiveRate, cls: 'st-avgfive' },
      { key: 'fourrate', label: '四星出率', value: fourRate, cls: 'st-avglimited' },
    ];
    const miniHtml = buildMiniGridHtml(statDefs);
    const fiveList = recs.filter((r) => r.quality_level === 5);
    const sparkHtml = buildSparklineSvg(buildPityTrend(recs));
    interaction.pools[cat.key] = { recs, fiveList, currentPity };

    // rows：垫抽行在前 + 五星进度条行
    let rowsHtml = '';
    if (currentPity > 0) {
      const pct = Math.min(100, (currentPity / MAX_DRAW) * 100);
      const color = getBarDrawColor(currentPity);
      rowsHtml += `
                <div class="bar-row pity-row" data-time="">
                    <div class="bar-avatar-wrap">
                        ${avatarSpriteHtml(PITY_SHAPE, o.avatarMap)}
                        <span class="bar-pity-badge">垫</span>
                    </div>
                    <div class="bar-track">
                        <div class="bar-fill" data-draws="${currentPity}" style="width: ${pct}%; background: ${color};"></div>
                        <span class="bar-fill-text"><span class="bar-draws-num">${currentPity}</span>抽</span>
                    </div>
                </div>
            `;
      hasAny = true;
    }
    let rowsHasFive = false;
    fiveList.forEach((r, fi) => {
      const draws = drawsToNext(recs, r, 5);
      const pct = Math.min(100, (draws / MAX_DRAW) * 100);
      const color = getBarDrawColor(draws);
      const isDeviation = isCharLimited && isCommonItem(r.name, r.timestamp, o.commonItems);
      rowsHtml += `
                <div class="bar-row${isDeviation ? ' deviation' : ''}" data-time="${r.timestamp || ''}" data-five-idx="${fi}">
                    <div class="bar-avatar-wrap">
                        ${avatarSpriteHtml(r, o.avatarMap)}
                        ${isDeviation ? '<span class="bar-deviation-badge">歪</span>' : ''}
                    </div>
                    <div class="bar-track">
                        <div class="bar-fill" data-draws="${draws}" style="width: ${pct}%; background: ${color};"></div>
                        <span class="bar-fill-text"><span class="bar-draws-num">${draws}</span>抽</span>
                    </div>
                </div>
            `;
      rowsHasFive = true;
      hasAny = true;
    });
    if (!pityRowExists(currentPity) && !rowsHasFive) return;
    sections += `
            <div class="bar-pool-section ${cat.key.startsWith('角色') ? 'pool-char' : 'pool-weapon'}" data-pool-key="${escapeHtml(cat.key)}">
                <div class="bar-pool-head">
                    <div class="bar-head-left">
                        <span class="bar-pool-title">${cat.title}</span>
                        <span class="bar-pool-date">${dateRange}</span>
                    </div>
                    <span class="total-draws">${total} 抽</span>
                </div>
                <div class="intuitive-mini-grid bar-mini-grid">${miniHtml}</div>
                <div class="bar-sparkline-wrap" title="五星出货抽数走势">${sparkHtml}</div>
                <div class="bar-pool-rows">${rowsHtml}</div>
            </div>
        `;
  });

  if (!hasAny) {
    return { html: emptyStateHtml('暂无可视化数据', '切换卡池筛选或刷新数据后再来查看', 'bar'), interaction: { pools: {}, summary: null } };
  }
  return { html: '<div class="bar-view">' + sections + '</div>', interaction };
}

/** 是否存在垫抽行（等价原逻辑：currentPity > 0 行即存在） */
function pityRowExists(currentPity: number): boolean {
  return currentPity > 0;
}

/* =====================================================================
 * 直观（卡片）视图（原 intuitiveView.js renderIntuitiveView）
 * ===================================================================== */

/** 直观视图完整 HTML（含空状态分支） */
export function renderIntuitiveViewHtml(o: ViewRenderOpts): string {
  const hidden = o.hidden;
  const cats = orderedCats(o.pools);
  const MAX_PITY_DEFAULT = 80; // 不使用；保留读性（原逻辑无上限常量，pity 卡仅限 >=0）
  let hasAny = false;
  let cardsHtml = '';
  const summaryCard = buildAllPoolsCardHtml(cats, o.pools, hidden, o.commonItems, o.avatarMap, 'card');
  if (summaryCard) {
    cardsHtml += '<div class="intuitive-card pool-all" data-char-key="__summary__">' + summaryCard.html + '</div>';
  }

  cats.forEach((cat) => {
    if (hidden.has(cat.key)) return;
    const recs = o.pools[cat.key] || [];
    const total = recs.length;
    if (!total) return;
    const isCharLimited = isCharLimitedPool(cat.key);
    const isWeaponLimited = isWeaponLimitedPool(cat.key);
    const isLimitedPool = isCharLimited || isWeaponLimited;
    const fiveList = recs.filter((r) => r.quality_level === 5);
    const fourList = recs.filter((r) => r.quality_level === 4);
    const five = fiveList.length;
    const four = fourList.length;
    const fiveRate = total ? ((five / total * 100).toFixed(2)) : '—';
    const fourRate = total ? ((four / total * 100).toFixed(2)) : '—';
    const currentPity = calculateLastDraws(recs, 5);
    const fiveAvgRaw = total ? calculateDrawsBetween(recs, 5) : null;
    const fiveAvg = (typeof fiveAvgRaw === 'number' && !isNaN(fiveAvgRaw)) ? String(fiveAvgRaw.toFixed(2)) : '—';
    const avgLimitedRaw = isLimitedPool ? calculateUpAverage(recs, o.commonItems) : null;
    const avgLimited = (typeof avgLimitedRaw === 'number' && !isNaN(avgLimitedRaw)) ? String(avgLimitedRaw.toFixed(2)) : (typeof avgLimitedRaw === 'string' ? avgLimitedRaw : '—');
    let noDeviation = '—';
    if (isCharLimited) { const _nd = calculateNoDeviationRate(recs, o.commonItems); if (_nd) noDeviation = _nd; }
    let dateRange = '暂无';
    const times = recs.map((r) => r.timestamp).filter(Boolean).sort();
    if (times.length) dateRange = (times[0] || '').split(' ')[0] + ' - ' + (times[times.length - 1] || '').split(' ')[0];

    const statDefs = [
      { key: 'pity', label: '当前已垫', value: currentPity, cls: 'st-pity' },
      { key: 'nodev', label: '不歪概率', value: noDeviation, cls: 'st-nodev' },
      { key: 'avglimited', label: '平均限定', value: avgLimited, cls: 'st-avglimited' },
      { key: 'avgfive', label: '平均五星', value: isWeaponLimited ? '—' : fiveAvg, cls: 'st-avgfive' },
      { key: 'five', label: '五星总数', value: five, cls: 'st-five' },
      { key: 'four', label: '四星总数', value: four, cls: 'st-four' },
      { key: 'fiverate', label: '五星出率', value: fiveRate, cls: 'st-avgfive' },
      { key: 'fourrate', label: '四星出率', value: fourRate, cls: 'st-avglimited' },
    ];
    const miniHtml = buildMiniGridHtml(statDefs);
    const fiveItemsHtmlArr: string[] = [];
    fiveList.forEach((r) => {
      const _draws = drawsToNext(recs, r, 5);
      fiveItemsHtmlArr.push(buildIntuitiveCharCardHtml(
        { r, draws: _draws, isDeviation: r.quality_level === 5 && (r.card_pool_type || '').startsWith('角色') && !(r.card_pool_type || '').includes('常驻') && !(r.card_pool_type || '').includes('新手') && isCommonItem(r.name, r.timestamp, o.commonItems) },
        'five',
        o.avatarMap,
      ));
    });
    if (currentPity > 0) {
      const pityCardHtml = '<div class="intuitive-char-card quality-5" data-time="">' +
        '<div class="char-avatar-wrap">' + avatarSpriteHtml(PITY_SHAPE, o.avatarMap) +
        '<span class="char-pity-badge">垫</span></div>' +
        '<span class="intuitive-char-name">漂泊者</span>' +
        '<span class="intuitive-char-draws">' + currentPity + '抽</span></div>';
      fiveItemsHtmlArr.unshift(pityCardHtml);
    }
    const fiveHtml = fiveItemsHtmlArr.length ? fiveItemsHtmlArr.join('') : '<div class="intuitive-empty">暂无五星</div>';
    const sparkHtml = buildSparklineSvg(buildPityTrend(recs));
    cardsHtml += `
            <div class="intuitive-card ${cat.key.startsWith('角色') ? 'pool-char' : 'pool-weapon'}" data-char-key="${escapeHtml('pool_' + cat.key)}">
                <div class="intuitive-card-head">
                    <div class="intuitive-head-left">
                        <span class="intuitive-card-title"><span class="intuitive-card-title-text">${cat.title}</span></span>
                        <span class="intuitive-date">${dateRange}</span>
                    </div>
                    <span class="total-draws">${total} 抽</span>
                </div>
                <div class="intuitive-card-body">
                    <div class="intuitive-mini-grid">${miniHtml}</div>
                    <div class="intuitive-sparkline-wrap" title="五星出货抽数走势">${sparkHtml}</div>
                    <div class="intuitive-char-list" data-charlist>${fiveHtml}</div>
                </div>
            </div>
        `;
    hasAny = true;
  });

  if (!hasAny) {
    return emptyStateHtml('暂无可视化数据', '切换卡池筛选或刷新数据后再来查看', 'card');
  }
  return '<div class="intuitive-grid">' + cardsHtml + '</div>';
}

/* =====================================================================
 * 条形行展开详情（原 shared.js buildBarRowDetailHtml / toggleBarRowDetail）
 * ===================================================================== */

/** 本段四星展开详情 HTML */
export function buildBarRowDetailHtml(fours: GachaRecord[], totalDraws: number, avatarMap: AvatarMap): string {
  if (!fours || !fours.length) {
    return `<div class="bar-row-detail"><div class="bar-detail-title">本段抽数（${totalDraws}抽）内的四星：0 个</div><div class="intuitive-empty">此段无四星</div></div>`;
  }
  const counts: Record<string, number> = {};
  fours.forEach((r) => { counts[r.name] = (counts[r.name] || 0) + 1; });
  const cards = Object.keys(counts).map((name) => {
    const c = counts[name];
    const rec = fours.find((r) => r.name === name)!;
    const badge = c > 1 ? `<span class="four-count-badge"><span class="badge-num">${c - 1}</span></span>` : '';
    return `<div class="four-card"><div class="four-avatar-wrap">${avatarSpriteHtml(rec, avatarMap)}${badge}</div></div>`;
  }).join('');
  return `<div class="bar-row-detail"><div class="bar-detail-title">本段抽数（${totalDraws}抽）内的四星：${fours.length} 个</div><div class="bar-four-grid">${cards}</div></div>`;
}