/* exported renderDetailView */
/* =====================================================================
 * 详情视图 render（抽卡分析 - 详情）
 * 依赖 shared.js 提供的 getHiddenPools，以及 gacha.js 提供的
 * recordAvatarHtml / escapeHtml。
 * 原为 loadGachaRecords 内部闭包函数，现拆为独立函数，records/pools
 * 由调用方传入；window.__renderDetailView 由 gachaWuwa.js 包装为
 * 闭包（捕获最新 records/pools），供隐藏卡池后重渲染。
 * ===================================================================== */

function renderDetailView(records, pools) {
    const viewEl = document.getElementById('view-detail');
    if (!viewEl) return;
    const recTime = (r) => (r.time || r.timestamp || '');
    const hidden = getHiddenPools();
    const GACHA_TYPE_ORDER = [
        "角色活动唤取", "武器活动唤取", "角色联动唤取", "武器联动唤取","角色新旅唤取", "武器新旅唤取", "角色忆旅唤取", "武器忆旅唤取",
        "角色常驻唤取", "武器常驻唤取", "新手限定唤取", "新手自选唤取",
        "感恩定向唤取",
    ];
    const presentTypes = Object.keys(pools);
    const orderedTypes = GACHA_TYPE_ORDER.filter(t => presentTypes.includes(t));
    const extraTypes = presentTypes.filter(t => !GACHA_TYPE_ORDER.includes(t));
    const allPoolTypes = orderedTypes.concat(extraTypes);
    const poolTypes = allPoolTypes.filter(t => pools[t] && pools[t].length && !hidden.has(t));
    // 全部卡池（全部数据）：始终存在，不受个体卡池隐藏影响；仅当用户显式隐藏“全部卡池”时移除
    const showSummary = !hidden.has('__SUMMARY_ALL__');
    let currentPool = showSummary ? 'all' : (poolTypes[0] || '');
    let currentPage = 1;
    let pageSize = (function () { try { return parseInt(localStorage.getItem('wuwa_detail_page_size') || '10', 10) || 10; } catch (e) { return 10; } })();
    const starFilter = new Set();
    const timeFilter = new Set();

    viewEl.innerHTML = `
        <div class="detail-sidebar">
            <div class="detail-sidebar-title">卡池筛选</div>
            ${showSummary ? '<button class="detail-pool-btn active" data-pool="all">全部卡池</button>' : ''}
            ${poolTypes.map(t => `<button class="detail-pool-btn${!showSummary && t === currentPool ? ' active' : ''}" data-pool="${t}">${t}</button>`).join('')}
        </div>
        <div class="detail-content">
            <div class="detail-table-scroll">
                <table class="detail-table">
                    <colgroup>
                        <col class="col-avatar">
                        <col class="col-name">
                        <col class="col-quality">
                        <col class="col-pool">
                        <col class="col-time">
                    </colgroup>
                    <thead>
                        <tr>
                            <th class="detail-th-avatar">头像</th>
                            <th>名称</th>
                            <th class="detail-th-filter" data-filter="quality">星级</th>
                            <th>卡池</th>
                            <th class="detail-th-filter" data-filter="time">时间</th>
                        </tr>
                    </thead>
                    <tbody id="detail-tbody"></tbody>
                </table>
            </div>
            <div class="detail-pager">
                <div class="detail-page-group">
                    <button class="detail-page-btn" id="detail-prev" aria-label="上一页">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                    </button>
                    <span class="detail-total">第 <b id="detail-current">1</b> / <span id="detail-page-total">1</span> 页 · 共 <b id="detail-count">0</b> 条</span>
                    <button class="detail-page-btn" id="detail-next" aria-label="下一页">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </button>
                </div>
                <span class="detail-page-size">每页
                    <select id="detail-page-size">
                        ${[10, 20, 50, 100].map(n => `<option value="${n}"${pageSize === n ? ' selected' : ''}>${n}/条</option>`).join('')}
                    </select>
                </span>
            </div>
        </div>
    `;

    const tbody = viewEl.querySelector('#detail-tbody');
    const currentEl = viewEl.querySelector('#detail-current');
    const pageTotal = viewEl.querySelector('#detail-page-total');
    const countEl = viewEl.querySelector('#detail-count');
    const prevBtn = viewEl.querySelector('#detail-prev');
    const nextBtn = viewEl.querySelector('#detail-next');
    const sizeSel = viewEl.querySelector('#detail-page-size');

    function getFiltered() {
        // 全部卡池：展示全部数据，不受个体卡池隐藏影响
        let list;
        if (currentPool === 'all') {
            if (!showSummary) return [];
            list = records.slice();
        } else {
            if (poolTypes.length === 0) return [];
            list = records.filter(r => r.card_pool_type === currentPool);
        }
        if (starFilter.size) {
            list = list.filter(r => starFilter.has(r.quality_level));
        }
        if (timeFilter.size) {
            list = list.filter(r => timeFilter.has(recTime(r).split(' ')[0] || ''));
        }
        return [...list].sort((a, b) => recTime(b).localeCompare(recTime(a)));
    }

    function renderRows() {
        const list = getFiltered();
        const total = Math.max(1, Math.ceil(list.length / pageSize));
        if (currentPage > total) currentPage = total;
        if (currentPage < 1) currentPage = 1;
        const start = (currentPage - 1) * pageSize;
        const pageItems = list.slice(start, start + pageSize);
        tbody.innerHTML = pageItems.map(r => {
            const t = r.time || r.timestamp || '';
            return `
                <tr class="detail-row q${r.quality_level}" data-time="${escapeHtml(t)}">
                    <td class="detail-avatar"><span class="record-avatar-wrap">${recordAvatarHtml(r)}</span></td>
                    <td class="detail-name"><span class="detail-name-text">${escapeHtml(r.name || '')}</span></td>
                    <td class="detail-quality"><span class="q-badge">${r.quality_level} 星</span></td>
                    <td class="detail-pool">${escapeHtml(r.card_pool_type || '')}</td>
                    <td class="detail-time">${escapeHtml(t)}</td>
                </tr>
            `;
        }).join('');
        currentEl.textContent = currentPage;
        pageTotal.textContent = total;
        countEl.textContent = list.length;
        prevBtn.disabled = currentPage <= 1;
        nextBtn.disabled = currentPage >= total;
    }

    viewEl.querySelectorAll('.detail-pool-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            viewEl.querySelectorAll('.detail-pool-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentPool = btn.dataset.pool;
            currentPage = 1;
            renderRows();
        });
    });
    prevBtn.addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderRows(); } });
    nextBtn.addEventListener('click', () => { currentPage++; renderRows(); });
    // 「每页」原生 select 分页大小切换
    if (sizeSel) {
        sizeSel.addEventListener('change', () => { pageSize = parseInt(sizeSel.value, 10); currentPage = 1; sizeSel.blur(); renderRows(); try { localStorage.setItem('wuwa_detail_page_size', String(pageSize)); } catch (err) {} });
    }
    // ===== 表头点击筛选：星级 / 时间自定义区间（小浮层，居中在列表头下方）=====
    const detailContent = viewEl.querySelector('.detail-content');
    const starTh = viewEl.querySelector('th[data-filter="quality"]');
    const timeTh = viewEl.querySelector('th[data-filter="time"]');

    const starPop = document.createElement('div');
    starPop.className = 'detail-filter-pop';
    starPop.id = 'star-filter-pop';
    starPop.innerHTML = `
        <div class="dfp-title">按星级筛选</div>
        <div class="dfp-option-list" id="star-option-list">
            <button type="button" class="dfp-option" data-star="5">5 星</button>
            <button type="button" class="dfp-option" data-star="4">4 星</button>
            <button type="button" class="dfp-option" data-star="3">3 星</button>
        </div>
        <div class="dfp-actions">
            <button type="button" id="star-confirm" class="dfp-btn primary">确定</button>
            <button type="button" id="star-clear" class="dfp-btn ghost">清除</button>
        </div>
    `;
    const timePop = document.createElement('div');
    timePop.className = 'detail-filter-pop';
    timePop.id = 'time-filter-pop';
    timePop.innerHTML = `
        <div class="dfp-title">按日期筛选</div>
        <div class="dfp-option-list column" id="time-date-list"></div>
        <div class="dfp-actions">
            <button type="button" id="time-confirm" class="dfp-btn primary">确定</button>
            <button type="button" id="time-clear" class="dfp-btn ghost">清除</button>
        </div>
    `;
    detailContent.appendChild(starPop);
    detailContent.appendChild(timePop);

    // 居中在触发列表头下方，并做左右边界防护避免被内容区边缘遮挡
    function positionPop(pop, th) {
        const tr = th.getBoundingClientRect();
        const cr = detailContent.getBoundingClientRect();
        const popW = pop.offsetWidth || 260;
        const popH = pop.offsetHeight || 160; // eslint-disable-line no-unused-vars -- 预留变量，预留未来"内容区上方不够展示就弹列表头上"的反向定位，暂未使用
        // 水平：优先让浮层中心对齐列中心
        let left = (tr.left - cr.left) + (tr.width - popW) / 2;
        // 左边界防护
        if (left < 4) left = 4;
        // 右边界防护：内容区右缘 - 浮层宽 - 4
        const maxLeft = cr.width - popW - 4;
        if (left > maxLeft) left = Math.max(4, maxLeft);
        pop.style.left = left + 'px';
        // 垂直：列表头正下方
        const top = (tr.bottom - cr.top) + 8;
        pop.style.top = top + 'px';
    }
    function closePops(except) {
        if (starPop !== except) { starPop.classList.remove('open'); starTh.classList.remove('open'); }
        if (timePop !== except) { timePop.classList.remove('open'); timeTh.classList.remove('open'); }
    }
    function openPop(pop, th) {
        closePops(pop);
        if (pop === timePop) renderTimeOptions();
        if (pop === starPop) syncStarOptions();
        pop.classList.add('open');
        th.classList.add('open');
        positionPop(pop, th);
    }
    function syncStarOptions() {
        starPop.querySelectorAll('.dfp-option[data-star]').forEach((b) => {
            const v = parseInt(b.dataset.star, 10);
            b.classList.toggle('active', starFilter.has(v));
        });
        starTh.classList.toggle('filtered', starFilter.size > 0);
    }
    function renderTimeOptions() {
        const base = currentPool === 'all'
          ? records.slice()
          : records.filter(r => r.card_pool_type === currentPool);
        // 按日期聚合：总抽数 + 当天最高稀有度（五星>四星>三星）
        const dateMap = new Map();
        base.forEach(r => {
            const d = (recTime(r).split(' ')[0] || '');
            if (!d) return;
            if (!dateMap.has(d)) dateMap.set(d, { count: 0, maxStar: 0 });
            const e = dateMap.get(d);
            e.count++;
            const star = Number(r.quality_level) || 0;
            if (star > e.maxStar) e.maxStar = star;
        });
        const dates = [...dateMap.keys()].sort().reverse();
        const listEl = timePop.querySelector('#time-date-list');
        listEl.innerHTML = dates.map(d => {
            const e = dateMap.get(d);
            const star = e.maxStar >= 5 ? 5 : (e.maxStar >= 4 ? 4 : 3);
            const cls = 'dfp-option' + (timeFilter.has(d) ? ' active' : '') + ' date-star-' + star;
            return '<button type="button" class="' + cls + '" data-date="' + d + '">' + d + ' <span class="date-count">' + e.count + '抽</span></button>';
        }).join('') || '<div class="dfp-empty">无可用日期</div>';
        timeTh.classList.toggle('filtered', timeFilter.size > 0);
    }

    starTh.addEventListener('click', (e) => {
        e.stopPropagation();
        if (starPop.classList.contains('open')) { closePops(); return; }
        openPop(starPop, starTh);
    });
    timeTh.addEventListener('click', (e) => {
        e.stopPropagation();
        if (timePop.classList.contains('open')) { closePops(); return; }
        openPop(timePop, timeTh);
    });
    starPop.querySelector('#star-option-list').addEventListener('click', (e) => {
        const btn = e.target.closest('.dfp-option');
        if (!btn) return;
        e.stopPropagation();
        const v = parseInt(btn.dataset.star, 10);
        if (starFilter.has(v)) starFilter.delete(v);
        else starFilter.add(v);
        btn.classList.toggle('active', starFilter.has(v));
        starTh.classList.toggle('filtered', starFilter.size > 0);
        currentPage = 1;
        renderRows();
    });
    starPop.querySelector('#star-clear').addEventListener('click', (e) => {
        e.stopPropagation();
        starFilter.clear();
        syncStarOptions();
        currentPage = 1;
        renderRows();
    });
    starPop.querySelector('#star-confirm').addEventListener('click', (e) => {
        e.stopPropagation();
        closePops();
    });
    timePop.querySelector('#time-date-list').addEventListener('click', (e) => {
        const btn = e.target.closest('.dfp-option');
        if (!btn) return;
        e.stopPropagation();
        const d = btn.dataset.date;
        if (timeFilter.has(d)) timeFilter.delete(d);
        else timeFilter.add(d);
        btn.classList.toggle('active', timeFilter.has(d));
        timeTh.classList.toggle('filtered', timeFilter.size > 0);
        currentPage = 1;
        renderRows();
    });
    timePop.querySelector('#time-clear').addEventListener('click', (e) => {
        e.stopPropagation();
        timeFilter.clear();
        timeTh.classList.remove('filtered');
        if (timePop.classList.contains('open')) renderTimeOptions();
        currentPage = 1;
        renderRows();
    });
    timePop.querySelector('#time-confirm').addEventListener('click', (e) => {
        e.stopPropagation();
        closePops();
    });

    [starPop, timePop].forEach((p) => { p.addEventListener('click', (e) => { e.stopPropagation(); }); });
    const onDetailDocClick = () => { closePops(); };
    if (window.__detailDocClick) document.removeEventListener('click', window.__detailDocClick);
    window.__detailDocClick = onDetailDocClick;
    document.addEventListener('click', onDetailDocClick);

    renderRows();
}
