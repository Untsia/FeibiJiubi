/**
 * 抽卡分析视图 —— 共享工具函数（从遗留 gacha.js / shared.js 迁移的纯函数）。
 *
 * 与原实现保持逐字节一致的算法与 HTML 生成（CSS 类名 / DOM 结构完全兼容），
 * 仅将原 window 全局（avatarMap / commonItems）改为显式参数，供 React 视图组件
 * 在 TS 环境直接调用；不依赖任何 window 状态，可由组件 useMemo 缓存。
 */
import type { AvatarMap, CommonItemShape, GachaPool, GachaRecord } from './types';

/* ===================== 基础工具（原 gacha.js） ===================== */

export function escapeHtml(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 按卡池分类记录（原 gacha.js categorizeRecords，gacha/data.ts 加载记录后调用） */
export function categorizeRecords(records: GachaRecord[]): GachaPool {
  const pools: GachaPool = {};
  records.forEach((record) => {
    if (!pools[record.card_pool_type]) pools[record.card_pool_type] = [];
    pools[record.card_pool_type].push(record);
  });
  return pools;
}

/** 记录展示时间（详情/表格用，优先 time 字段） */
export function recordTime(r: GachaRecord): string {
  return r.time || r.timestamp || '';
}

/** 从头像映射中解析某条记录的头像 url（本地无图回退 null → 星级文字） */
export function avatarUrlOf(record: GachaRecord, map: AvatarMap): string | null {
  const urls = map.byResourceId;
  const names = map.byName;
  const rid = record.resource_id;
  const url = (rid !== undefined && rid !== null && rid !== ''
    ? urls[String(rid)]
    : undefined) || (record.name ? names[record.name] : undefined) || null;
  return url != null ? url : null;
}

/** 与原 recordAvatarHtml 一致：头像 <img>，无本地图时回退星级文字（字符串，供 innerHTML） */
export function avatarSpriteHtml(record: GachaRecord, map: AvatarMap): string {
  const url = avatarUrlOf(record, map);
  if (url) {
    return `<img class="record-avatar q${record.quality_level}" src="${url}" alt="${escapeHtml(record.name)}">`;
  }
  const cls = record.quality_level === 5 ? 'gold' : record.quality_level === 4 ? 'purple' : 'blue';
  return `<span class="record-star ${cls}">${record.quality_level} 星</span>`;
}

/** 距上次命中 quality 的抽数（当前垫抽） */
export function calculateLastDraws(records: GachaRecord[], quality: number): number {
  let drawCount = 0;
  for (let i = 0; i < records.length; i++) {
    if (records[i].quality_level === quality) return drawCount;
    drawCount++;
  }
  return drawCount;
}

/**
 * 平均命中 quality 抽数；无命中返回字符串提示。
 *
 * 原实现在 forEach 里对每条命中记录做 records.indexOf()（O(n)），整体是 O(n·k)；
 * 万级记录 × 数百次命中 ≈ 百万级比较，是分析页渲染的主要开销之一。
 *
 * 记命中记录在 records 中的下标为 p[0..k-1]，则原求和式
 *   Σ(p[i+1] - p[i]) + (records.length - p[k-1])
 * 是望远镜和，恒等于 records.length - p[0]（与 p 是否递增无关）。
 * 因此一次遍历取「首个命中下标 + 命中总数」即可，复杂度降为 O(n) 且无需额外内存。
 */
export function calculateDrawsBetween(records: GachaRecord[], quality: number): number | string {
  let firstIdx = -1;
  let count = 0;
  for (let i = 0; i < records.length; i++) {
    if (records[i].quality_level === quality) {
      if (firstIdx < 0) firstIdx = i;
      count++;
    }
  }
  if (count === 0) return '还没抽出五星';
  return (records.length - firstIdx) / count;
}

/** 平均 UP（限定五星）抽数；无 UP 记录返回 null */
export function calculateUpAverage(records: GachaRecord[], commonItems: CommonItemShape[]): number | null {
  const isLimitedPoolType = (t: string): boolean => {
    const k = t || '';
    return (k.startsWith('角色') || k.startsWith('武器'))
      && !k.includes('常驻') && !k.includes('新手');
  };
  // 与 calculateDrawsBetween 同理：原实现用 indexOf 做 O(n·k) 求和，
  // 该求和恒等于 records.length - 首个 UP 记录下标，一次遍历即可（O(n)）。
  // isCommonItem 仍只在 quality_level === 5 时调用，次数与原实现一致。
  let firstIdx = -1;
  let count = 0;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.quality_level !== 5) continue;
    if (isCommonItem(r.name, r.timestamp || r.time, commonItems)) continue;
    if (!isLimitedPoolType(r.card_pool_type)) continue;
    if (firstIdx < 0) firstIdx = i;
    count++;
  }
  if (count === 0) return null;
  return (records.length - firstIdx) / count;
}

/** 不歪概率（百分比字符串）；无五星返回 null */
export function calculateNoDeviationRate(records: GachaRecord[], commonItems: CommonItemShape[]): string | null {
  const fiveStarRecords = records.filter((r) => r.quality_level === 5);
  if (!fiveStarRecords.length) return null;
  let upCount = 0;
  fiveStarRecords.forEach((record) => {
    const isCommon = isCommonItem(record.name, record.timestamp || record.time, commonItems);
    if (!isCommon) upCount++;
  });
  return `${((upCount / fiveStarRecords.length) * 100).toFixed(2)}`;
}

/** 某物品在特定抽卡时间点是否算作常驻（进常驻池时间 >= 加入时间才算） */
export function isCommonItem(name: string, timestamp: string | undefined, items: CommonItemShape[]): boolean {
  if (!timestamp) return false;
  const pullTime = new Date(String(timestamp).replace(' ', 'T')).getTime();
  return items.some((item) => {
    if (typeof item === 'string') return item === name;
    if (typeof item === 'object' && item.name === name) {
      const addedTime = new Date(item.addedTime.replace(' ', 'T')).getTime();
      return pullTime >= addedTime;
    }
    return false;
  });
}

/* ===================== 共享工具（原 shared.js） ===================== */

/** 数值迷你化：保留 1-2 位小数的数值，小数部分淡色 span */
export function fmtMiniValue(v: string | number): string {
  const s = String(v);
  const m = s.match(/^(\d+)\.(\d{1,2})(%?)$/);
  if (m) return m[1] + '<span class="mini-value-dec">.' + m[2] + m[3] + '</span>';
  return s;
}

/** 计算 record 之后（含 record 自身）到下一个同品质出货的抽数间隔 */
export function drawsToNext(recs: GachaRecord[], record: GachaRecord, quality: number): number {
  const idx = recs.indexOf(record);
  let nextIdx = recs.length;
  for (let i = idx + 1; i < recs.length; i++) {
    if (recs[i].quality_level === quality) { nextIdx = i; break; }
  }
  return nextIdx - idx;
}

/** 单个角色卡片 HTML（item: { r, draws, isDeviation }） */
export function buildIntuitiveCharCardHtml(
  it: { r: GachaRecord; draws: number; isDeviation?: boolean },
  quality: 'five' | 'four',
  avatarMap: AvatarMap,
): string {
  const r = it.r;
  const qClass = quality === 'five' ? 'quality-5' : 'quality-4';
  return `<div class="intuitive-char-card ${qClass}" data-time="${r.timestamp || ''}">
    <div class="char-avatar-wrap">
      ${avatarSpriteHtml(r, avatarMap)}
      ${it.isDeviation ? '<span class="char-deviation-badge">歪</span>' : ''}
    </div>
    <span class="intuitive-char-name">${r.name}</span>
    <span class="intuitive-char-draws">${it.draws}抽</span>
  </div>`;
}

/** 八宫格 HTML */
export function buildMiniGridHtml(statDefs: { label: string; value: string | number; cls: string }[]): string {
  return statDefs.map((s) => {
    return `
      <div class="mini-card ${s.cls}">
        <div class="mini-title">${s.label}</div>
        <div class="mini-value">${fmtMiniValue(s.value)}</div>
      </div>`;
  }).join('');
}

/* ---------- 条形/卡片：单卡池统计 ---------- */

export function isCharLimitedPool(type: string): boolean {
  return type.startsWith('角色') && !type.includes('常驻') && !type.includes('新手');
}
export function isWeaponLimitedPool(type: string): boolean {
  return type.startsWith('武器') && !type.includes('常驻') && !type.includes('新手');
}

export interface PoolStats {
  total: number;
  five: number;
  four: number;
  fiveRate: string;
  fourRate: string;
  currentPity: number;
  fiveAvg: string;
  avgLimited: string;
  noDeviation: string;
  dateRange: string;
  isCharLimited: boolean;
  isWeaponLimited: boolean;
}

export function computePoolStats(recs: GachaRecord[], commonItems: CommonItemShape[]): PoolStats {
  const total = recs.length;
  const five = recs.filter((r) => r.quality_level === 5).length;
  const four = recs.filter((r) => r.quality_level === 4).length;
  const fiveRate = total ? ((five / total) * 100).toFixed(2) : '—';
  const fourRate = total ? ((four / total) * 100).toFixed(2) : '—';
  const currentPity = calculateLastDraws(recs, 5);
  const fiveAvgRaw = total ? calculateDrawsBetween(recs, 5) : null;
  const fiveAvg = typeof fiveAvgRaw === 'number' && !isNaN(fiveAvgRaw) ? String(fiveAvgRaw.toFixed(2)) : '—';
  const isCharLimited = recs.length > 0 && isCharLimitedPool(recs[0].card_pool_type);
  const isWeaponLimited = recs.length > 0 && isWeaponLimitedPool(recs[0].card_pool_type);
  const avgLimitedRaw = (isCharLimited || isWeaponLimited) ? calculateUpAverage(recs, commonItems) : null;
  const avgLimited = typeof avgLimitedRaw === 'number' && !isNaN(avgLimitedRaw)
    ? String(avgLimitedRaw.toFixed(2))
    : (typeof avgLimitedRaw === 'string' ? avgLimitedRaw : '—');
  let noDeviation = '—';
  if (isCharLimited) { const _nd = calculateNoDeviationRate(recs, commonItems); if (_nd) noDeviation = _nd; }
  let dateRange = '暂无';
  const times = recs.map((r) => r.timestamp).filter(Boolean).sort();
  if (times.length) dateRange = (times[0] || '').split(' ')[0] + ' - ' + (times[times.length - 1] || '').split(' ')[0];
  return {
    total, five, four, fiveRate, fourRate, currentPity, fiveAvg, avgLimited, noDeviation, dateRange,
    isCharLimited, isWeaponLimited,
  };
}

/* ===================== 条形进度条配色 / sparkline / 空状态 ===================== */

export function getBarDrawColor(draws: number): string {
  const dark = typeof document !== 'undefined' && document.body
    ? document.body.classList.contains('theme-light') === false
    : false;
  if (dark) {
    if (draws <= 60) return 'rgba(82, 195, 132, 0.90)';
    if (draws <= 70) return 'rgba(240, 186, 74, 0.90)';
    return 'rgba(242, 108, 108, 0.90)';
  }
  if (draws <= 60) return '#69d994';
  if (draws <= 70) return '#ffd96e';
  return '#ff8282';
}

// 数字单元格：大数缩写为「x.xxw」，点击可在缩写 / 完整值间切换。
// 原先在 LevelView 与 QizangView 各写一份，其中 LevelView 版额外处理了
// Infinity / NaN（否则会显示成 "Infinityw"）。统一到此处并采用更健壮的实现。
export function numCellDisplay(n: number, growNumFull: boolean): string {
  if (n === Infinity || isNaN(n)) return String(n);
  if (growNumFull) return String(n);
  return n >= 10000 ? (n / 10000).toFixed(2) + 'w' : String(n);
}

let __sparkId = 0;

/** 五星出货抽数走势 sparkline（SVG 字符串） */
export function buildSparklineSvg(valuesRaw: number[]): string {
  if (!valuesRaw || !valuesRaw.length) return '';
  const gid = 'spark' + (++__sparkId);
  const w = 240, h = 44, pad = 4;
  let values = valuesRaw.slice();
  const isSingle = values.length === 1;
  if (isSingle) values = [values[0], values[0]];
  let min = Infinity, max = -Infinity;
  values.forEach((v) => { if (v < min) min = v; if (v > max) max = v; });
  if (isSingle) { min = 0; max = 80; }
  const span = (max - min) || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return [x.toFixed(1), y.toFixed(1)];
  });
  const line = pts.map((p) => p.join(',')).join(' ');
  const area = 'M' + pts[0][0] + ',' + (h - pad) + ' L' + pts.map((p) => p.join(',')).join(' L') + ' L' + pts[pts.length - 1][0] + ',' + (h - pad) + ' Z';
  const dots = pts.map((p, i) =>
    '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="6" fill="transparent">' +
    '<title>' + values[i] + ' 抽</title>' +
    '</circle>',
  ).join('');
  return '<svg class="sparkline" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">' +
    '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="var(--accent)" stop-opacity="0.30"/>' +
    '<stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>' +
    '</linearGradient></defs>' +
    '<polyline points="' + line + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="' + area + '" fill="url(#' + gid + ')"/>' +
    dots +
    '</svg>';
}

/** 某卡池抽到五星的抽数时间正序序列（含末尾已垫抽数） */
export function buildPityTrend(recs: GachaRecord[]): number[] {
  const chrono = recs.slice().reverse();
  const result: number[] = [];
  let prev = -1;
  let lastFiveIdx = -1;
  for (let i = 0; i < chrono.length; i++) {
    if (chrono[i].quality_level === 5) {
      result.push(i - prev);
      prev = i;
      lastFiveIdx = i;
    }
  }
  if (lastFiveIdx !== -1) {
    const padded = chrono.length - 1 - lastFiveIdx;
    if (padded > 0) result.push(padded);
  } else if (chrono.length) {
    result.push(chrono.length);
  }
  return result;
}

/** 精致空状态（图标 + 标题 + 引导） */
export function emptyStateHtml(title: string, hint: string, icon: 'empty' | 'data' | 'bar' | 'card'): string {
  const t = title || '暂无数据';
  const h = hint || '';
  const svg = {
    'data': '<rect x="3.5" y="5.5" width="17" height="14" rx="2.5"/><path d="M3.5 9.5h17"/><path d="M12 12.5v5"/><path d="M9.5 15l2.5 2.5 2.5-2.5"/>',
    'bar': '<line x1="5" y1="19" x2="5" y2="10"/><line x1="12" y1="19" x2="12" y2="5"/><line x1="19" y1="19" x2="19" y2="13"/><line x1="3" y1="19.5" x2="21" y2="19.5"/>',
    'card': '<rect x="4" y="5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="5" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="14.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="14.5" width="6.5" height="6.5" rx="1.5"/>',
    'empty': '<rect x="3.5" y="5.5" width="17" height="14" rx="2.5"/><path d="M3.5 9.5h17"/><path d="M9 5.5v14"/>',
  }[icon] || '<rect x="3.5" y="5.5" width="17" height="14" rx="2.5"/><path d="M3.5 9.5h17"/><path d="M9 5.5v14"/>';
  return '<div class="empty-state">' +
    '<div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' + svg + '</svg></div>' +
    '<div class="empty-title">' + t + '</div>' +
    (h ? '<div class="empty-hint">' + h + '</div>' : '') +
    '</div>';
}

/* ===================== 全部卡池汇总（bar / card 共用统计） ===================== */

export interface FiveItem { r: GachaRecord; draws: number; isDeviation: boolean; isUp: boolean; }
export interface FourItem { r: GachaRecord; draws: number; }

export interface AllPoolsResult {
  allTotal: number;
  allFive: number;
  allFour: number;
  allLimitedFive: number;
  allStdFive: number;
  avgFive: string;
  avgLimited: string;
  fiveRate: string;
  fourRate: string;
  dateRange: string;
  fiveItems: FiveItem[];
  fourItems: FourItem[];
  /** 实际参与汇总的可见卡池 key（未隐藏且非空；不足两个时回退全部非空卡池） */
  catKeys: string[];
}

function isStdCharName(r: GachaRecord): boolean {
  const STD_FIVE_CHAR_NAMES = ['凌阳', '维里奈', '安可', '卡卡罗', '鉴心'];
  return STD_FIVE_CHAR_NAMES.some((n) => (r.name || '').includes(n));
}
function isStdWeaponName(r: GachaRecord): boolean {
  const STD_FIVE_WEAPON_NAMES = ['漪澜浮录', '擎渊怒涛', '停驻之烟', '千古洑流', '浩境粼光', '源能机锋', '相位涟漪', '脉冲协臂', '玻色星仪', '镭射切变'];
  return STD_FIVE_WEAPON_NAMES.some((n) => (r.name || '').includes(n));
}

/** 全部卡池汇总统计（原 buildAllPoolsCard 的计算部分，无 DOM/无全局） */
export function computeAllPools(
  cats: { key: string; title: string }[],
  pools: GachaPool,
  hidden: Set<string>,
  commonItems: CommonItemShape[],
): AllPoolsResult | null {
  if (hidden.has('__SUMMARY_ALL__')) return null;
  let visibleCats = cats.filter((c) => !hidden.has(c.key) && (pools[c.key] || []).length);
  if (visibleCats.length < 2) visibleCats = cats.filter((c) => (pools[c.key] || []).length);
  if (visibleCats.length < 2) return null;

  let allTotal = 0, allFive = 0, allFour = 0;
  let allLimitedFive = 0, allStdFive = 0;
  let sumFiveAvg = 0, cntFiveAvg = 0, sumAvgLimited = 0, cntAvgLimited = 0;
  const allFiveItems: FiveItem[] = [];
  const allTimes: string[] = [];

  visibleCats.forEach((cat) => {
    const recs = pools[cat.key] || [];
    const fiveList = recs.filter((r) => r.quality_level === 5);
    const fourList = recs.filter((r) => r.quality_level === 4);
    allTotal += recs.length;
    allFive += fiveList.length;
    allFour += fourList.length;
    const isCharLimited = isCharLimitedPool(cat.key);
    const isWeaponLimited = isWeaponLimitedPool(cat.key);
    const isLimited = isCharLimited || isWeaponLimited;
    allLimitedFive += (isLimited ? fiveList.filter((r) => !(isStdCharName(r) || isStdWeaponName(r))).length : 0);
    allStdFive += fiveList.filter((r) => (isStdCharName(r) || isStdWeaponName(r))).length;
    const _total = recs.length;
    const _fa = _total ? calculateDrawsBetween(recs, 5) : null;
    if (typeof _fa === 'number' && !isNaN(_fa)) { sumFiveAvg += _fa; cntFiveAvg++; }
    if (isLimited) {
      const _al = calculateUpAverage(recs, commonItems);
      if (typeof _al === 'number' && !isNaN(_al)) { sumAvgLimited += _al; cntAvgLimited++; }
    }
    recs.forEach((r) => { if (r.timestamp) allTimes.push(r.timestamp); });
    fiveList.forEach((r) => {
      const draws = drawsToNext(recs, r, 5);
      const isDeviation = isLimited && isCommonItem(r.name, r.timestamp, commonItems);
      const isUp = isLimited && !(isStdCharName(r) || isStdWeaponName(r));
      allFiveItems.push({ r, draws, isDeviation, isUp });
    });
  });

  const avgFive = cntFiveAvg ? String((sumFiveAvg / cntFiveAvg).toFixed(2)) : '—';
  const avgLimited = cntAvgLimited ? String((sumAvgLimited / cntAvgLimited).toFixed(2)) : '—';
  if (!allTotal) return null;
  allFiveItems.sort((a, b) => (b.r.timestamp || '').localeCompare(a.r.timestamp || ''));
  const allFourItems: FourItem[] = [];
  cats.forEach((cat) => {
    const recs = pools[cat.key] || [];
    recs.filter((r) => r.quality_level === 4).forEach((r) => {
      const draws = drawsToNext(recs, r, 4);
      allFourItems.push({ r, draws });
    });
  });
  allFourItems.sort((a, b) => (b.r.timestamp || '').localeCompare(a.r.timestamp || ''));
  const fiveRate = allTotal ? ((allFive / allTotal * 100).toFixed(2)) : '—';
  const fourRate = allTotal ? ((allFour / allTotal * 100).toFixed(2)) : '—';

  allTimes.sort();
  let dateRange = '暂无';
  if (allTimes.length) dateRange = (allTimes[0] || '').split(' ')[0] + ' - ' + (allTimes[allTimes.length - 1] || '').split(' ')[0];

  return {
    allTotal, allFive, allFour, allLimitedFive, allStdFive,
    avgFive, avgLimited, fiveRate, fourRate, dateRange,
    fiveItems: allFiveItems, fourItems: allFourItems,
    catKeys: visibleCats.map((c) => c.key),
  };
}

/** 全部卡池八宫格 HTML */
export function buildAllPoolsMiniGridHtml(a: AllPoolsResult): string {
  const statDefs = [
    { label: '限定五星', value: a.allLimitedFive, cls: 'st-pity' },
    { label: '常驻五星', value: a.allStdFive, cls: 'st-nodev' },
    { label: '平均限定', value: a.avgLimited, cls: 'st-avglimited' },
    { label: '平均五星', value: a.avgFive, cls: 'st-avgfive' },
    { label: '五星总数', value: a.allFive, cls: 'st-five' },
    { label: '四星总数', value: a.allFour, cls: 'st-four' },
    { label: '五星出率', value: a.fiveRate, cls: 'st-avgfive' },
    { label: '四星出率', value: a.fourRate, cls: 'st-avglimited' },
  ];
  return buildMiniGridHtml(statDefs);
}