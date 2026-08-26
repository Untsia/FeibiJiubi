/* exported renderIntuitiveView */
/* =====================================================================
 * 直观视图 render（抽卡分析 - 卡片）
 * 依赖 shared.js 提供的 getHiddenPools / buildAllPoolsCard /
 * buildMiniGridHtml / buildIntuitiveCharCardHtml / emptyStateHtml，
 * 以及 gacha.js 提供的 calculateLastDraws / calculateDrawsBetween /
 * calculateUpAverage / calculateNoDeviationRate / recordAvatarHtml /
 * isCommonItem / commonItems。
 * lastIntuitiveData 为 gachaWuwa.js 声明的全局状态（records/pools 缓存），
 * 供隐藏卡池后重渲染各分析视图使用。
 * ===================================================================== */

function renderIntuitiveView(records, pools) {
    const view = document.getElementById('view-intuitive');
    if (!view) return;
    lastIntuitiveData = { records, pools };
    view.innerHTML = '';
    const hidden = getHiddenPools();
    const POOL_ORDER = [
        '角色活动唤取', '武器活动唤取', '角色联动唤取', '武器联动唤取',
        '角色新旅唤取', '武器新旅唤取', '角色忆旅唤取', '武器忆旅唤取', '角色常驻唤取', '武器常驻唤取',
        '新手限定唤取', '新手自选唤取', '感恩定向唤取'
    ];
    const cats = POOL_ORDER.filter(k => pools[k] && pools[k].length).map(k => ({ key: k, title: k }));
    const wrapper = document.createElement('div');
    wrapper.className = 'intuitive-grid';
    let hasAny = false;
    // 全部卡池卡片置顶
    buildAllPoolsCard(wrapper, cats, pools, hidden, 'card');
    cats.forEach(cat => {
        if (hidden.has(cat.key)) return;
        const recs = pools[cat.key] || [];
        const total = recs.length;
        if (!total) return;
        const isCharLimited = cat.key.startsWith('角色') && !cat.key.includes('常驻') && !cat.key.includes('新手');
        const isWeaponLimited = cat.key.startsWith('武器') && !cat.key.includes('常驻') && !cat.key.includes('新手');
        const isLimitedPool = isCharLimited || isWeaponLimited;
        // 单次过滤五星/四星列表并据此计数，避免对同一数组重复 filter 遍历
        const fiveList = recs.filter(r => r.quality_level === 5);
        const fourList = recs.filter(r => r.quality_level === 4);
        const five = fiveList.length;
        const four = fourList.length;
        const fiveRate = total ? ((five / total * 100).toFixed(2)) : '—';
        const fourRate = total ? ((four / total * 100).toFixed(2)) : '—';
        const currentPity = calculateLastDraws(recs, 5);
        const fiveAvgRaw = total ? calculateDrawsBetween(recs, 5) : null;
        const fiveAvg = (typeof fiveAvgRaw === 'number' && !isNaN(fiveAvgRaw)) ? String(fiveAvgRaw.toFixed(2)) : '—';
        const avgLimitedRaw = isLimitedPool ? calculateUpAverage(recs) : null;
        const avgLimited = (typeof avgLimitedRaw === 'number' && !isNaN(avgLimitedRaw)) ? String(avgLimitedRaw.toFixed(2)) : (typeof avgLimitedRaw === 'string' ? avgLimitedRaw : '—');
        let noDeviation = '—';
        if (isCharLimited) { const _nd = calculateNoDeviationRate(recs); if (_nd) noDeviation = _nd; }
        let dateRange = '暂无';
        const times = recs.map(r => r.timestamp).filter(Boolean).sort();
        if (times.length) dateRange = (times[0] || '').split(' ')[0] + ' - ' + (times[times.length - 1] || '').split(' ')[0];
        const statDefs = [
            { key: 'pity', label: '当前已垫', value: currentPity, cls: 'st-pity' },
            { key: 'nodev', label: '不歪概率', value: noDeviation, cls: 'st-nodev' }
        ];
        // 八宫格统一为完整 8 格：所有卡池都显示「平均限定」与「平均五星」
        // （常驻/新手武器无限定数据时平均限定显示 —）
        statDefs.push({ key: 'avglimited', label: '平均限定', value: avgLimited, cls: 'st-avglimited' });
        // 武器活动/联动/新旅/忆旅四个武器限定池的「平均五星」宫格保留，但数值显示 —
        statDefs.push({ key: 'avgfive', label: '平均五星', value: isWeaponLimited ? '—' : fiveAvg, cls: 'st-avgfive' });
        statDefs.push(
            { key: 'five', label: '五星总数', value: five, cls: 'st-five' },
            { key: 'four', label: '四星总数', value: four, cls: 'st-four' },
            { key: 'fiverate', label: '五星出率', value: fiveRate, cls: 'st-avgfive' },
            { key: 'fourrate', label: '四星出率', value: fourRate, cls: 'st-avglimited' }
        );
        const miniHtml = buildMiniGridHtml(statDefs);
        const fiveItemsHtmlArr = fiveList.map(r => {
            const draws = drawsToNext(recs, r, 5);
            return buildIntuitiveCharCardHtml({ r: r, draws: draws, isDeviation: r.quality_level === 5 && (r.card_pool_type || '').startsWith('角色') && !(r.card_pool_type || '').includes('常驻') && !(r.card_pool_type || '').includes('新手') && isCommonItem(r.name, r.timestamp, commonItems) }, 'five');
        });
        const fourItemsHtmlArr = fourList.map(r => {
            const draws = drawsToNext(recs, r, 4);
            return buildIntuitiveCharCardHtml({ r: r, draws: draws, isDeviation: r.quality_level === 5 && (r.card_pool_type || '').startsWith('角色') && !(r.card_pool_type || '').includes('常驻') && !(r.card_pool_type || '').includes('新手') && isCommonItem(r.name, r.timestamp, commonItems) }, 'four');
        });
        const charKey = 'pool_' + cat.key;
        if (!window.__intuitiveCharData) window.__intuitiveCharData = {};
        if (currentPity > 0) {
          const pityCardHtml = '<div class="intuitive-char-card quality-5" data-time="">' +
            '<div class="char-avatar-wrap">' + recordAvatarHtml({ name: '漂泊者·导电', quality_level: 5, resource_id: '' }) +
            '<span class="char-pity-badge">垫</span></div>' +
            '<span class="intuitive-char-name">漂泊者</span>' +
            '<span class="intuitive-char-draws">' + currentPity + '抽</span></div>';
          fiveItemsHtmlArr.unshift(pityCardHtml);
        }
        window.__intuitiveCharData[charKey] = { five: fiveItemsHtmlArr, four: fourItemsHtmlArr, filter: 'five' };
        const fiveHtml = fiveItemsHtmlArr.length ? fiveItemsHtmlArr.join('') : '<div class="intuitive-empty">暂无五星</div>';
        const sparkHtml = buildSparklineSvg(buildPityTrend(recs)); // 五星出货抽数走势
        const card = document.createElement('div');
        card.className = 'intuitive-card ' + (cat.key.startsWith('角色') ? 'pool-char' : 'pool-weapon');
        card.dataset.charKey = charKey;
        card.innerHTML = `
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
        `;
        wrapper.appendChild(card);
        hasAny = true;
    });
    if (!hasAny) view.innerHTML = emptyStateHtml('暂无可视化数据', '切换卡池筛选或刷新数据后再来查看', 'card');
    else view.appendChild(wrapper);
    // 统计数字滚动动画（仅 .stats-value；八宫格 .mini-value 不滚动）
    if (typeof animateViewNumbers === 'function') animateViewNumbers(view);
}
