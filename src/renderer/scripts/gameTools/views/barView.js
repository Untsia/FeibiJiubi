/* exported renderBarView */
/* =====================================================================
 * 条形视图 render（抽卡分析 - 列表）
 * 依赖 shared.js 提供的 buildAllPoolsCard / buildMiniGridHtml /
 * buildIntuitiveCharCardHtml / buildBarRowDetailHtml / toggleBarRowDetail /
 * emptyStateHtml / getBarDrawColor / getHiddenPools，
 * 以及 gacha.js 提供的 calculateLastDraws / calculateDrawsBetween /
 * calculateUpAverage / calculateNoDeviationRate / recordAvatarHtml /
 * isCommonItem / commonItems。
 * ===================================================================== */

/* ---------- 条形：按卡池分组展示五星出货条形图 ---------- */
function renderBarView(records, pools) {
    const hidden = getHiddenPools();
    const POOL_ORDER = [
        '角色活动唤取', '武器活动唤取', '角色联动唤取', '武器联动唤取',
        '角色新旅唤取', '武器新旅唤取', '角色忆旅唤取', '武器忆旅唤取', '角色常驻唤取', '武器常驻唤取',
        '新手限定唤取', '新手自选唤取', '感恩定向唤取'
    ];
    const cats = POOL_ORDER.filter(k => pools[k] && pools[k].length).map(k => ({ key: k, title: k }));
    const view = document.getElementById('view-bar');
    if (!view) return;
    view.innerHTML = '';

    const MAX_DRAW = 80;
    let hasAny = false;
    const wrapper = document.createElement('div');
    wrapper.className = 'bar-view';

    // 全部卡池卡片置顶（第一个）
    buildAllPoolsCard(wrapper, cats, pools, hidden, 'bar');

    cats.forEach(cat => {
        if (hidden.has(cat.key)) return;
        const recs = pools[cat.key] || [];
        const total = recs.length;
        if (!total) return;
        const isCharLimited = cat.key.startsWith('角色') && !cat.key.includes('常驻') && !cat.key.includes('新手');
        const isWeaponLimited = cat.key.startsWith('武器') && !cat.key.includes('常驻') && !cat.key.includes('新手');
        const isLimitedPool = isCharLimited || isWeaponLimited;
        const five = recs.filter(r => r.quality_level === 5).length;
        const four = recs.filter(r => r.quality_level === 4).length;
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

        const fiveList = recs.filter(r => r.quality_level === 5);
        const sparkHtml = buildSparklineSvg(buildPityTrend(recs)); // 五星出货抽数走势
        const section = document.createElement('div');
        section.className = 'bar-pool-section ' + (cat.key.startsWith('角色') ? 'pool-char' : 'pool-weapon');
        section.innerHTML = `
            <div class="bar-pool-head">
                <div class="bar-head-left">
                    <span class="bar-pool-title">${cat.title}</span>
                    <span class="bar-pool-date">${dateRange}</span>
                </div>
                <span class="total-draws">${total} 抽</span>
            </div>
            <div class="intuitive-mini-grid bar-mini-grid">${miniHtml}</div>
            <div class="bar-sparkline-wrap" title="五星出货抽数走势">${sparkHtml}</div>
            <div class="bar-pool-rows"></div>
        `;
        const fourList = recs.filter(r => r.quality_level === 4);
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
        window.__intuitiveCharData[charKey] = { five: fiveItemsHtmlArr, four: fourItemsHtmlArr, filter: 'five' };
        const rowsContainer = section.querySelector('.bar-pool-rows');

        if (currentPity > 0) {
            const pct = Math.min(100, (currentPity / MAX_DRAW) * 100);
            const color = getBarDrawColor(currentPity);
            rowsContainer.insertAdjacentHTML('beforeend', `
                <div class="bar-row pity-row" data-time="">
                    <div class="bar-avatar-wrap">
                        ${recordAvatarHtml({ name: '漂泊者·导电', quality_level: 5, resource_id: '' })}
                        <span class="bar-pity-badge">垫</span>
                    </div>
                    <div class="bar-track">
                        <div class="bar-fill" data-draws="${currentPity}" style="width: ${pct}%; background: ${color};"></div>
                        <span class="bar-fill-text"><span class="bar-draws-num">${currentPity}</span>抽</span>
                    </div>
                </div>
            `);
            hasAny = true;
        }

        // 五星进度条行：先挂到离线 DocumentFragment，最后一次性插入，减少逐条回流
        const rowsFrag = document.createDocumentFragment();
        fiveList.forEach((r, fi) => {
            const draws = drawsToNext(recs, r, 5);
            const pct = Math.min(100, (draws / MAX_DRAW) * 100);
            const color = getBarDrawColor(draws);
            const isDeviation = isCharLimited && isCommonItem(r.name, r.timestamp, commonItems);
            const row = document.createElement('div');
            row.className = 'bar-row' + (isDeviation ? ' deviation' : '');
            row.dataset.time = r.timestamp || '';
            row.dataset.fiveIdx = String(fi);
            row.innerHTML = `
                <div class="bar-avatar-wrap">
                    ${recordAvatarHtml(r)}
                    ${isDeviation ? '<span class="bar-deviation-badge">歪</span>' : ''}
                </div>
                <div class="bar-track">
                    <div class="bar-fill" data-draws="${draws}" style="width: ${pct}%; background: ${color};"></div>
                    <span class="bar-fill-text"><span class="bar-draws-num">${draws}</span>抽</span>
                </div>
            `;
            rowsFrag.appendChild(row);
            hasAny = true;
        });
        rowsContainer.appendChild(rowsFrag);
        // 点击五星进度条：展开/收起「本段（到下一个五星之间）抽数内的四星」
        rowsContainer.addEventListener('click', (e) => {
            const row = e.target.closest('.bar-row');
            if (!row) return; if (row.classList.contains('pity-row')) { toggleBarRowDetail(row, recs.slice(0, currentPity).filter(function(x){return x.quality_level===4;}), currentPity); return; } if (row.dataset.fiveIdx === undefined) return;
            const fi = Number(row.dataset.fiveIdx);
            const nr = fiveList[fi];
            const i = recs.indexOf(nr);
            const nextNr = fiveList[fi + 1];
            const j = nextNr ? recs.indexOf(nextNr) : recs.length;
            const fours = recs.slice(i + 1, j).filter(x => x.quality_level === 4);
            toggleBarRowDetail(row, fours, drawsToNext(recs, nr, 5));
        });

        if (rowsContainer.children.length) {
            wrapper.appendChild(section);
            hasAny = true;
        }
    });


    if (!hasAny) view.innerHTML = emptyStateHtml('暂无可视化数据', '切换卡池筛选或刷新数据后再来查看', 'bar');
    else view.appendChild(wrapper);
    // 统计数字滚动动画（仅 .stats-value；八宫格 .mini-value 不滚动）
    if (typeof animateViewNumbers === 'function') animateViewNumbers(view);

    }
