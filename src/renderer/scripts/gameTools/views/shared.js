/* exported animateViewNumbers, emptyStateHtml, getHiddenPools, buildIntuitiveCharListHtml,
 buildMiniGridHtml, buildAllPoolsCard, refreshBarFillColors, buildPityTrend */
/* =====================================================================
 * 抽卡分析视图共享工具
 * 六个视图 render 函数（bar / intuitive / table / detail / qizang / level）
 * 共用的纯函数与 HTML 生成器。必须早于各视图与 gachaWuwa.js 加载。
 * 依赖的全局函数来自 gacha.js（escapeHtml / recordAvatarHtml / isCommonItem
 * / calculateDrawsBetween / calculateUpAverage 等）与 gachaWuwa.js
 * （_readHiddenPools），均为运行时调用，加载顺序无强依赖。
 * ===================================================================== */

// 数值迷你化：保留 1-2 位小数的百分比/数值，小数部分淡色
function fmtMiniValue(v) {
  const s = String(v);
  const m = s.match(/^(\d+)\.(\d{1,2})(%?)$/);
  if (m) return m[1] + '<span class="mini-value-dec">.' + m[2] + m[3] + '</span>';
  return s;
}

/* ---------- 统计数字滚动动画 ---------- */
// 将元素文本中的数值从 0 平滑递增到目标值（保留小数位与后缀，如 "3.14" / "82 抽"）。
// 同一元素只动画一次（dataset.animated 标记），视图切换后新元素重新动画。
function animateCountUp(el, duration) {
  if (!el || el.dataset.animated === '1') return;
  const m = String(el.textContent || '').match(/^(-?\d+(?:\.\d+)?)(.*)$/);
  if (!m) return;
  const target = parseFloat(m[1]);
  if (!isFinite(target)) return;
  const suffix = m[2];
  const dur = duration || 600;
  const dec = (m[1].split('.')[1] || '').length;
  const originalHtml = el.innerHTML; // 保留小数淡色 span，动画结束后还原
  el.dataset.animated = '1';
  const t0 = performance.now();
  function tick(now) {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = target * eased;
    el.textContent = (dec ? val.toFixed(dec) : Math.round(val).toString()) + suffix;
    if (p < 1) requestAnimationFrame(tick);
    else el.innerHTML = originalHtml;
  }
  requestAnimationFrame(tick);
}
// 对容器内所有 .stats-value 执行数字滚动动画（每次视图渲染完成后调用）。
// 注：八宫格（.mini-value）不再滚动，进入页面时直接显示最终数值。
function animateViewNumbers(container) {
  const root = container || document;
  root.querySelectorAll('.stats-value').forEach(el => animateCountUp(el, 600));
}

/* 精致空状态：图标 + 标题 + 引导（统一毛玻璃视觉，替代孤立灰字）
   icon 可选：empty(默认表格)/data(数据导入)/bar(柱状)/card(卡片网格)，按场景语境化 */
function emptyStateHtml(title, hint, icon) {
  const t = title || '暂无数据';
  const h = hint || '';
  const svg = {
    'data': '<rect x="3.5" y="5.5" width="17" height="14" rx="2.5"/><path d="M3.5 9.5h17"/><path d="M12 12.5v5"/><path d="M9.5 15l2.5 2.5 2.5-2.5"/>',
    'bar': '<line x1="5" y1="19" x2="5" y2="10"/><line x1="12" y1="19" x2="12" y2="5"/><line x1="19" y1="19" x2="19" y2="13"/><line x1="3" y1="19.5" x2="21" y2="19.5"/>',
    'card': '<rect x="4" y="5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="5" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="14.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="14.5" width="6.5" height="6.5" rx="1.5"/>',
    'empty': '<rect x="3.5" y="5.5" width="17" height="14" rx="2.5"/><path d="M3.5 9.5h17"/><path d="M9 5.5v14"/>'
  }[icon] || '<rect x="3.5" y="5.5" width="17" height="14" rx="2.5"/><path d="M3.5 9.5h17"/><path d="M9 5.5v14"/>';
  return '<div class="empty-state">' +
    '<div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' + svg + '</svg></div>' +
    '<div class="empty-title">' + t + '</div>' +
    (h ? '<div class="empty-hint">' + h + '</div>' : '') +
    '</div>';
}

// 当前账号隐藏卡池集合（按账号隔离；读取逻辑 _readHiddenPools 位于 gachaWuwa.js）
function getHiddenPools() {
  return _readHiddenPools();
}

// 计算 record 之后（含 record 自身）到下一个同品质出货的抽数间隔。
// 共享工具：原在 shared/barView/intuitiveView 三处重复定义，现统一到此处供各视图复用。
function drawsToNext(recs, record, quality) {
  const idx = recs.indexOf(record);
  let nextIdx = recs.length;
  for (let i = idx + 1; i < recs.length; i++) { if (recs[i].quality_level === quality) { nextIdx = i; break; } }
  return nextIdx - idx;
}

// 由角色 item 对象生成单个角色卡片 HTML（item: {r, draws, isDeviation}）
function buildIntuitiveCharCardHtml(it, quality) {
  const r = it.r;
  const qClass = quality === 'five' ? 'quality-5' : 'quality-4';
  return `<div class="intuitive-char-card ${qClass}" data-time="${r.timestamp || ''}">
    <div class="char-avatar-wrap">
      ${recordAvatarHtml(r)}
      ${it.isDeviation ? '<span class="char-deviation-badge">歪</span>' : ''}
    </div>
    <span class="intuitive-char-name">${r.name}</span>
    <span class="intuitive-char-draws">${it.draws}抽</span>
  </div>`;
}
// 由角色 item 对象数组生成角色卡片列表 HTML
function buildIntuitiveCharListHtml(items, quality) {
  if (!items || !items.length) {
    return `<div class="intuitive-empty">暂无${quality === 'five' ? '五星' : '四星'}</div>`;
  }
  return items.map(it => buildIntuitiveCharCardHtml(it, quality)).join('');
}

/* ---------- 生成八宫格 HTML（卡片/条形共用） ---------- */
function buildMiniGridHtml(statDefs) {
    return statDefs.map(s => {
        return `
          <div class="mini-card ${s.cls}">
            <div class="mini-title">${s.label}</div>
            <div class="mini-value">${fmtMiniValue(s.value)}</div>
          </div>`;
    }).join('');
}
/* ---------- 条形视图：点击五星进度条展开「本段抽数内的四星」 ---------- */
// 生成展开详情 HTML：四星按名称聚合，≥2 个相同则在头像右上角显示数量徽标
function buildBarRowDetailHtml(fours, totalDraws) {
  if (!fours || !fours.length) {
    return `<div class="bar-row-detail"><div class="bar-detail-title">本段抽数（${totalDraws}抽）内的四星：0 个</div><div class="intuitive-empty">此段无四星</div></div>`;
  }
  const counts = {};
  fours.forEach(r => { counts[r.name] = (counts[r.name] || 0) + 1; });
  const cards = Object.keys(counts).map(name => {
  const c = counts[name];
  const rec = fours.find(r => r.name === name);
  const badge = c > 1 ? `<span class="four-count-badge"><span class="badge-num">${c - 1}</span></span>` : '';
  return `<div class="four-card"><div class="four-avatar-wrap">${recordAvatarHtml(rec)}${badge}</div></div>`;
  }).join('');
  return `<div class="bar-row-detail"><div class="bar-detail-title">本段抽数（${totalDraws}抽）内的四星：${fours.length} 个</div><div class="bar-four-grid">${cards}</div></div>`;
}
// 切换某条五星进度条的展开/收起（同容器内仅一个展开）
function toggleBarRowDetail(row, fours, totalDraws) {
  const container = row.parentElement;
  const next = row.nextElementSibling;
  if (next && next.classList.contains('bar-row-detail')) { next.remove(); row.classList.remove('expanded'); return; }
  container.querySelectorAll('.bar-row-detail').forEach(d => d.remove());
  container.querySelectorAll('.bar-row.expanded').forEach(d => d.classList.remove('expanded'));
  const holder = document.createElement('div');
  holder.innerHTML = buildBarRowDetailHtml(fours, totalDraws);
  const detailNode = holder.firstElementChild;
  row.classList.add('expanded');
  container.insertBefore(detailNode, row.nextElementSibling);
}

/* ---------- 全部卡池汇总卡（条形 / 卡片共用） ---------- */
function buildAllPoolsCard(appendTo, cats, pools, hidden, variant) {
    // 常驻五星名单（角色出现在所有角色池，武器仅出现在武器常驻池）
    const STD_FIVE_CHAR_NAMES = ['凌阳', '维里奈', '安可', '卡卡罗', '鉴心'];
    const STD_FIVE_WEAPON_NAMES = ['漪澜浮录', '擎渊怒涛', '停驻之烟', '千古洑流', '浩境粼光', '源能机锋', '相位涟漪', '脉冲协臂', '玻色星仪', '镭射切变'];
    const isStdChar = r => STD_FIVE_CHAR_NAMES.some(n => (r.name || '').includes(n));
    const isStdWeapon = r => STD_FIVE_WEAPON_NAMES.some(n => (r.name || '').includes(n));
    if (hidden.has('__SUMMARY_ALL__')) return; // 隐藏“全部卡池”汇总卡
    let visibleCats = cats.filter(c => !hidden.has(c.key) && (pools[c.key] || []).length);
    // 所有个体卡池都被隐藏时，改为汇总全部卡池，使“全部卡池”可单独显示
    if (visibleCats.length < 2) visibleCats = cats.filter(c => (pools[c.key] || []).length);
    if (visibleCats.length < 2) return; // 仍不足两个卡池则无需汇总
    let allTotal = 0, allFive = 0, allFour = 0;
    let allLimitedFive = 0, allStdFive = 0;
    let sumFiveAvg = 0, cntFiveAvg = 0, sumAvgLimited = 0, cntAvgLimited = 0;
    const allFiveItems = [];
    const allTimes = [];
    visibleCats.forEach(cat => {
        const recs = pools[cat.key] || [];
        // 单次过滤五星/四星列表并据此计数，避免对同一数组重复 filter 遍历
        const fiveList = recs.filter(r => r.quality_level === 5);
        const fourList = recs.filter(r => r.quality_level === 4);
        allTotal += recs.length;
        allFive += fiveList.length;
        allFour += fourList.length;
        const isCharLimited = cat.key.startsWith('角色') && !cat.key.includes('常驻') && !cat.key.includes('新手');
        const isWeaponLimited = cat.key.startsWith('武器') && !cat.key.includes('常驻') && !cat.key.includes('新手');
        const isLimited = isCharLimited || isWeaponLimited;
        // 限定 = 限定池抽出的五星中「非常驻」的部分（限定池里抽到的常驻属「歪」，不计入限定）
        allLimitedFive += (isLimited ? fiveList.filter(r => !(isStdChar(r) || isStdWeapon(r))).length : 0);
        // 常驻五星：命中常驻名单即计入，与卡池类型无关（任何池抽到的常驻都只算常驻）
        allStdFive += fiveList.filter(r => (isStdChar(r) || isStdWeapon(r))).length;
        const _total = recs.length;
        const _fa = _total ? calculateDrawsBetween(recs, 5) : null;
        if (typeof _fa === 'number' && !isNaN(_fa)) { sumFiveAvg += _fa; cntFiveAvg++; }
        if (isLimited) {
          const _al = calculateUpAverage(recs);
          if (typeof _al === 'number' && !isNaN(_al)) { sumAvgLimited += _al; cntAvgLimited++; }
        }
        recs.forEach(r => { if (r.timestamp) allTimes.push(r.timestamp); });
        fiveList.forEach(r => {
            const draws = drawsToNext(recs, r, 5);
            const isDeviation = isLimited && isCommonItem(r.name, r.timestamp, commonItems);
            const isUp = isLimited && !(isStdChar(r) || isStdWeapon(r));
            allFiveItems.push({ r: r, draws: draws, isDeviation: isDeviation, isUp: isUp });
        });
    });
    const avgFive = cntFiveAvg ? String((sumFiveAvg / cntFiveAvg).toFixed(2)) : '—';
    const avgLimited = cntAvgLimited ? String((sumAvgLimited / cntAvgLimited).toFixed(2)) : '—';
    if (!allTotal) return;
    allFiveItems.sort((a, b) => (b.r.timestamp || '').localeCompare(a.r.timestamp || ''));
    const allFourItems = [];
    cats.forEach(cat => {
        const recs = pools[cat.key] || [];
        recs.filter(r => r.quality_level === 4).forEach(r => {
            const draws = drawsToNext(recs, r, 4);
            allFourItems.push({ r: r, draws: draws });
        });
    });
    allFourItems.sort((a, b) => (b.r.timestamp || '').localeCompare(a.r.timestamp || ''));
    if (!window.__intuitiveCharData) window.__intuitiveCharData = {};
    window.__intuitiveCharData['__summary__'] = {
      five: allFiveItems.map(it => buildIntuitiveCharCardHtml(it, 'five')),
      four: allFourItems.map(it => buildIntuitiveCharCardHtml(it, 'four')),
      filter: 'five'
    };



    const fiveRate = allTotal ? ((allFive / allTotal * 100).toFixed(2)) : '—';
    const fourRate = allTotal ? ((allFour / allTotal * 100).toFixed(2)) : '—';
    const statDefs = [
        { label: '限定五星', value: allLimitedFive, cls: 'st-pity' },
        { label: '常驻五星', value: allStdFive, cls: 'st-nodev' },
        { label: '平均限定', value: avgLimited, cls: 'st-avglimited' },
        { label: '平均五星', value: avgFive, cls: 'st-avgfive' },
        { label: '五星总数', value: allFive, cls: 'st-five' },
        { label: '四星总数', value: allFour, cls: 'st-four' },
        { label: '五星出率', value: fiveRate, cls: 'st-avgfive' },
        { label: '四星出率', value: fourRate, cls: 'st-avglimited' }
    ];
    const miniHtml = statDefs.map(sd => {
        return '<div class="mini-card ' + sd.cls + '"><div class="mini-title">' + sd.label + '</div><div class="mini-value">' + fmtMiniValue(sd.value) + '</div></div>';
    }).join('');

    allTimes.sort();
    let dateRange = '暂无';
    if (allTimes.length) dateRange = (allTimes[0] || '').split(' ')[0] + ' - ' + (allTimes[allTimes.length - 1] || '').split(' ')[0];

    const card = document.createElement('div');
    card.className = 'intuitive-card pool-all';
    card.dataset.charKey = '__summary__';
    if (variant === 'bar') {
        const MAX_DRAW_ALL = 80;
        let summaryRows = '';
        allFiveItems.forEach((it, fi) => {
            const draws = it.draws;
            const pct = Math.min(100, (draws / MAX_DRAW_ALL) * 100);
            const color = getBarDrawColor(draws);
            summaryRows += '<div class="bar-row" data-time="' + (it.r.timestamp || '') + '" data-five-idx="' + fi + '">' +
                '<div class="bar-avatar-wrap">' + recordAvatarHtml(it.r) +
                (it.isUp ? '<span class="bar-up-badge">UP</span>' : '') +
                '</div><div class="bar-track"><div class="bar-fill" data-draws="' + draws + '" style="width:' + pct + '%;background:' + color + ';"></div>' +
                '<span class="bar-fill-text"><span class="bar-draws-num">' + draws + '</span>抽</span></div></div>';
        });
        const summarySpark = buildSparklineSvg(allFiveItems.slice().reverse().map(it => it.draws)); // 全卡池出货走势
        card.innerHTML = `
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
        // 汇总卡：点击五星进度条展开「本段（到下一个五星之间）抽数内的四星」（跨全部卡池按时间区间收集）
        const allRows = card.querySelector('.bar-pool-rows');
        if (allRows) {
            const visiblePoolRecs = visibleCats.map(c => pools[c.key] || []);
            allRows.addEventListener('click', (e) => {
                const row = e.target.closest('.bar-row');
                if (!row || row.dataset.fiveIdx === undefined) return;
                const fi = Number(row.dataset.fiveIdx);
                const a = allFiveItems[fi];
                const b = allFiveItems[fi + 1];
                const t1 = a.r.timestamp;
                const t2 = b ? b.r.timestamp : null;
                const fours = [];
                visiblePoolRecs.forEach(recs => {
                    recs.forEach(x => {
                        if (x.quality_level === 4 && x.timestamp <= t1 && (t2 == null || x.timestamp > t2)) fours.push(x);
                    });
                });
                toggleBarRowDetail(row, fours, a.draws);
            });
        }
    } else {
        // 全部卡池角色卡片：按角色名合并，显示个数 xN，头像只显示一个
        const charAgg = new Map();
        allFiveItems.forEach(it => {
            const name = it.r.name || '未知';
            if (!charAgg.has(name)) charAgg.set(name, { count: 0, sample: it.r, deviation: false, isUp: false });
            const a = charAgg.get(name);
            a.count++;
            if (it.isDeviation) a.deviation = true;
            if (it.isUp) a.isUp = true;
        });
        const aggArr = Array.from(charAgg.values());
        aggArr.sort((x, y) => y.count - x.count || (x.sample.name || '').localeCompare(y.sample.name || ''));
        const charListHtml = aggArr.length ? aggArr.map(a => {
            return '<div class="intuitive-char-card quality-5" data-time="">' +
                '<div class="char-avatar-wrap">' + recordAvatarHtml(a.sample) +
                (a.count > 1 ? '<span class="char-up-badge">' + (a.count - 1) + '</span>' : '') +
                '</div>' +
                '<span class="intuitive-char-name">' + escapeHtml(a.sample.name || '未知') + '</span>' +
                '<span class="intuitive-char-draws">' + a.count + '个</span></div>';
        }).join('') : '<div class="intuitive-empty">暂无五星</div>';
        card.innerHTML = `
            <div class="intuitive-card-head">
                <div class="intuitive-head-left">
                    <span class="intuitive-card-title"><span class="intuitive-card-title-text">全部卡池</span></span>
                    <span class="intuitive-date">${dateRange}</span>
                </div>
                <span class="total-draws">${allTotal} 抽</span>
            </div>
            <div class="intuitive-card-body">
            <div class="intuitive-mini-grid">${miniHtml}</div>
            <div class="intuitive-sparkline-wrap" title="五星出货抽数走势">${buildSparklineSvg(allFiveItems.slice().reverse().map(it => it.draws))}</div>
            <div class="intuitive-char-list" data-charlist>${charListHtml}</div>
            </div>
        `;
    }
    appendTo.appendChild(card);



}

// 条形 tap 进度条专属配色（按抽数分段）：1-60 绿、61-70 黄、71-80 红
// 深色模式下用鲜明但不过曝的饱和色（比浅色略深一档），保持色彩生动又不刺眼；
// 浅色模式保持原略淡配色，视觉清晰。
function getBarDrawColor(draws) {
  const dark = typeof document !== 'undefined' && document.body
    ? document.body.classList.contains('theme-light') === false
    : false; // 非浏览器（测试）环境：使用浅色配色
  if (dark) {
    // 深色：中高饱和 + 中等明度，带轻微透明度融入毛玻璃卡片，避免灰暗死寂
    if (draws <= 60) return "rgba(82, 195, 132, 0.90)"; // 绿
    if (draws <= 70) return "rgba(240, 186, 74, 0.90)"; // 黄
    return "rgba(242, 108, 108, 0.90)"; // 红
  }
  if (draws <= 60) return "#69d994"; // 绿（略淡）
  if (draws <= 70) return "#ffd96e"; // 黄（略淡）
  return "#ff8282"; // 红（略淡）
}

// 主题切换后重绘当前可见条形进度条颜色（深/浅色配色不同）。
// data-draws 在渲染时已存于 .bar-fill，避免重新计算抽数。
function refreshBarFillColors() {
  document.querySelectorAll('.bar-fill[data-draws]').forEach(function (el) {
    el.style.background = getBarDrawColor(parseInt(el.dataset.draws, 10) || 0);
  });
}

/* ---------- 卡池卡 sparkline（五星出货抽数走势迷你图） ---------- */
// 输入为“抽到每个五星所花的抽数”序列（时间正序），输出一条面积折线；
// 只有一个数据点时绘制一条水平直线（两端同高），不再隐藏。
let __sparkId = 0;
function buildSparklineSvg(values) {
  if (!values || !values.length) return '';
  const gid = 'spark' + (++__sparkId);
  const w = 240, h = 44, pad = 4;
  // 单数据点：画一条直直的水平线，且以五星硬保底（80 抽）为参照归一化高度，抽数越多线越高
  const isSingle = values.length === 1;
  if (isSingle) values = [values[0], values[0]];
  let min = Infinity, max = -Infinity;
  values.forEach(v => { if (v < min) min = v; if (v > max) max = v; });
  if (isSingle) { min = 0; max = 80; }
  const span = (max - min) || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return [x.toFixed(1), y.toFixed(1)];
  });
  const line = pts.map(p => p.join(',')).join(' ');
  const area = 'M' + pts[0][0] + ',' + (h - pad) + ' L' + pts.map(p => p.join(',')).join(' L') + ' L' + pts[pts.length - 1][0] + ',' + (h - pad) + ' Z';
  // 每个数据点放一个透明热区：视觉上不画点，仅当鼠标移到对应位置时弹出该点抽数提示
  const dots = pts.map((p, i) =>
    '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="6" fill="transparent">' +
    '<title>' + values[i] + ' 抽</title>' +
    '</circle>'
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
// 计算某卡池“抽到五星的抽数”时间正序序列（用于 sparkline）
// 每个五星记录“距上一个五星（或起点）的抽数，含本次出货”，
// 从而首尾抽数闭合正确（第一个=起点到首次出货的抽数，最后一个=上次出到本次的抽数）
function buildPityTrend(recs) {
  const chrono = recs.slice().reverse(); // 库内 id 倒序 → 转成时间正序
  const result = [];
  let prev = -1; // 起点之前：第一个五星按距抽卡起点（含本次）计算
  let lastFiveIdx = -1;
  for (let i = 0; i < chrono.length; i++) {
    if (chrono[i].quality_level === 5) {
      result.push(i - prev);
      prev = i;
      lastFiveIdx = i;
    }
  }
  // 末尾追加“已垫抽数”：最后一次五星出货后至今累计抽了多少次（进行中的保底计数）；
  // 仅当确有垫抽（>0）时追加，避免“刚出货、零垫抽”时多加一个无意义的 0 抽点
  if (lastFiveIdx !== -1) {
    const padded = chrono.length - 1 - lastFiveIdx;
    if (padded > 0) result.push(padded);
  } else if (chrono.length) {
    // 从未出过五星但有已垫抽数：以“已垫总抽数”作单点，画一条按垫抽定位高度的水平线，
    // 让纯垫抽的卡池也能看到进行中的保底情况
    result.push(chrono.length);
  }
  return result;
}
