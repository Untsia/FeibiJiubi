/* exported renderTableView */
/* =====================================================================
 * 表格视图 render（抽卡分析 - 全部记录）
 * 依赖 shared.js 提供的 getHiddenPools，以及 gacha.js 提供的
 * recordAvatarHtml / escapeHtml。
 * tableState 为 gachaWuwa.js 声明的全局分页状态（page/pageSize/pool/
 * totalPages），渲染与翻页共用。
 * ===================================================================== */

function renderTableView(records) {
    const view = document.getElementById('view-table');
    if (!view) return;
    const hidden = getHiddenPools();
    const poolMaxTime = {};
    records.forEach(r => {
        const p = r.card_pool_type; const t = (r.time || r.timestamp || '');
        if (p && (!poolMaxTime[p] || t > poolMaxTime[p])) poolMaxTime[p] = t;
    });
    const poolTypes = Object.keys(poolMaxTime)
        .filter(p => p && !hidden.has(p))
        .sort((a, b) => (poolMaxTime[b] || '').localeCompare(poolMaxTime[a] || ''));

    view.innerHTML = `
        <div class="table-sidebar">
            <div class="table-sidebar-title">卡池类型</div>
            <button class="table-pool-btn active" data-pool="">全部</button>
            ${poolTypes.map(p => `<button class="table-pool-btn" data-pool="${p}">${p}</button>`).join('')}
        </div>
        <div class="table-main">
            <div class="table-scroll">
                <table class="gacha-table">
                    <thead>
                        <tr><th>名称</th><th>星级</th><th>类型</th><th>卡池</th><th>时间</th></tr>
                    </thead>
                    <tbody id="gacha-table-body"></tbody>
                </table>
            </div>
            <div class="table-pager">
                <div class="table-page-group">
                    <button class="table-page-btn" id="table-first" title="首页" aria-label="首页">
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 17 8 12 13 7"></polyline><polyline points="18 17 13 12 18 7"></polyline></svg>
                    </button>
                    <button class="table-page-btn" id="table-prev" title="上一页" aria-label="上一页">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                    </button>
                    <span id="table-page-info">0 / 0</span>
                    <button class="table-page-btn" id="table-next" title="下一页" aria-label="下一页">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </button>
                    <button class="table-page-btn" id="table-last" title="末页" aria-label="末页">
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="11 17 16 12 11 7"></polyline><polyline points="6 17 11 12 6 7"></polyline></svg>
                    </button>
                </div>
                <span class="table-page-size">每页
                    <select id="table-page-size">
                        ${[20, 50, 100, 200].map(n => `<option value="${n}"${tableState.pageSize === n ? ' selected' : ''}>${n}</option>`).join('')}
                    </select>
                </span>
                <span class="table-total">共 <b id="table-total">0</b> 条</span>
            </div>
        </div>
    `;

    view.querySelectorAll('.table-pool-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            view.querySelectorAll('.table-pool-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            tableState.pool = btn.dataset.pool || null;
            tableState.page = 1;
            renderTablePage();
        });
    });
    view.querySelector('#table-first').addEventListener('click', () => { tableState.page = 1; renderTablePage(); });
    view.querySelector('#table-prev').addEventListener('click', () => { tableState.page = Math.max(1, tableState.page - 1); renderTablePage(); });
    view.querySelector('#table-next').addEventListener('click', () => { tableState.page = Math.min(tableState.totalPages, tableState.page + 1); renderTablePage(); });
    view.querySelector('#table-last').addEventListener('click', () => { tableState.page = tableState.totalPages; renderTablePage(); });
    view.querySelector('#table-page-size').addEventListener('change', (e) => { tableState.pageSize = parseInt(e.target.value, 10); tableState.page = 1; e.target.blur(); renderTablePage(); try { localStorage.setItem('wuwa_table_page_size', String(tableState.pageSize)); } catch (err) {} });

    renderTablePage(records);
}

function renderTablePage(records) {
    const view = document.getElementById('view-table');
    if (!view) return;
    const all = records || view._recordsCache;
    if (!all) return;
    view._recordsCache = all;
    const hidden = getHiddenPools();
    const recTime = (r) => (r.time || r.timestamp || '');
    const filtered = all.filter(r => !hidden.has(r.card_pool_type) && (!tableState.pool || r.card_pool_type === tableState.pool))
        .sort((a, b) => recTime(b).localeCompare(recTime(a)));
    const total = filtered.length;
    const pageSize = tableState.pageSize;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    tableState.totalPages = totalPages;
    if (tableState.page > totalPages) tableState.page = totalPages;
    const start = (tableState.page - 1) * pageSize;
    const pageRows = filtered.slice(start, start + pageSize);

    const body = view.querySelector('#gacha-table-body');
    if (body) {
        body.innerHTML = pageRows.map(r => {
            const q = r.quality_level;
            const qcls = q === 5 ? 'q5' : q === 4 ? 'q4' : 'q3';
            const typeLabel = (r.card_pool_type || '').includes('角色') ? '角色' : (r.card_pool_type || '').includes('武器') ? '武器' : '—';
            return `<tr class="gacha-row ${qcls}">
                <td class="gacha-name">${recordAvatarHtml(r)}<span>${escapeHtml(r.name)}</span></td>
                <td class="gacha-quality">${q}★</td>
                <td class="gacha-type">${typeLabel}</td>
                <td class="gacha-pool">${escapeHtml(r.card_pool_type || '—')}</td>
                <td class="gacha-time">${escapeHtml(r.timestamp || '')}</td>
            </tr>`;
        }).join('');
    }
    const info = view.querySelector('#table-page-info');
    if (info) info.textContent = `${tableState.page} / ${totalPages}`;
    const tot = view.querySelector('#table-total');
    if (tot) tot.textContent = total;
    const tf = view.querySelector('#table-first');
    const tp = view.querySelector('#table-prev');
    const tn = view.querySelector('#table-next');
    const tl = view.querySelector('#table-last');
    const atFirst = tableState.page <= 1;
    const atLast = tableState.page >= totalPages;
    if (tf) tf.disabled = atFirst;
    if (tp) tp.disabled = atFirst;
    if (tn) tn.disabled = atLast;
    if (tl) tl.disabled = atLast;
}
