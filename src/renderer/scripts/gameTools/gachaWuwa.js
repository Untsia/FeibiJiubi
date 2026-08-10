// 强制重绘所有 backdrop-filter 元素，修复禁用硬件加速（software rendering）下
// 局部 innerHTML 重建后模糊层错位/半透明堆叠的视觉扭曲。
(function () {
  if (window.__diagGlobalBound) return;
  window.__diagGlobalBound = true;
  window.addEventListener('error', (e) => {
    console.error('Unhandled error:', e.message, '\n', (e.error && e.error.stack) || '');
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    console.error('Unhandled rejection:', (r && (r.stack || r.message)) || r);
  });
})();

function fmtMiniValue(v) {
  const s = String(v);
  const m = s.match(/^(\d+)\.(\d{1,2})(%?)$/);
  if (m) return m[1] + '<span class="mini-value-dec">.' + m[2] + m[3] + '</span>';
  return s;
}

// 按钮加载态切换：保留原文案，叠加 spinner，避免「纯文字变灰」带来的不确定感
function setButtonLoading(btn, loading, label) {
  if (!btn) return;
  if (loading) {
    btn.dataset.label = btn.dataset.label || btn.textContent.trim();
    btn.classList.add('is-loading');
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span><span>' + (btn.dataset.label || label) + '</span>';
  } else {
    btn.classList.remove('is-loading');
    btn.removeAttribute('aria-busy');
    btn.textContent = btn.dataset.label || label;
  }
}

// 骨架屏：数据重载期间占位，避免 record-display 空白跳动（布局稳定性）
function skeletonHtml() {
  let cards = '';
  for (let i = 0; i < 6; i++) {
    cards += '<div class="skeleton-card">' +
      '<div class="sk-line sk-title"></div>' +
      '<div class="sk-grid">' +
      '<div class="sk-cell"></div><div class="sk-cell"></div>' +
      '<div class="sk-cell"></div><div class="sk-cell"></div>' +
      '</div>' +
      '<div class="sk-line sk-foot"></div>' +
      '</div>';
  }
  return '<div class="skeleton-screen" aria-hidden="true">' + cards + '</div>';
}

function forceRepaintBackdrop(root) {
  if (!root) return;
  const els = root.querySelectorAll('*');
  const list = [];
  for (const el of els) {
    const cs = getComputedStyle(el);
    const bf = cs.backdropFilter || cs.webkitBackdropFilter;
    if (bf && bf !== 'none') {
      list.push(el);
      el.style.backdropFilter = 'none';
      el.style.webkitBackdropFilter = 'none';
    }
  }
  if (!list.length) return;
  void root.offsetHeight; // 强制 reflow
  requestAnimationFrame(() => {
    list.forEach(el => { el.style.backdropFilter = ''; el.style.webkitBackdropFilter = ''; });
  });
}


/* 精致空状态：图标 + 标题 + 引导（统一毛玻璃视觉，替代孤立灰字） */
function emptyStateHtml(title, hint) {
  const t = title || '暂无数据';
  const h = hint || '';
  return '<div class="empty-state">' +
    '<div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3.5" y="5.5" width="17" height="14" rx="2.5"/>' +
    '<path d="M3.5 9.5h17"/>' +
    '<path d="M9 5.5v14"/>' +
    '</svg></div>' +
    '<div class="empty-title">' + t + '</div>' +
    (h ? '<div class="empty-hint">' + h + '</div>' : '') +
    '</div>';
}
// 加载玩家 UID 下拉列表
async function loadPlayerUIDs(defaultUid) {
    const players = await window.electronAPI.getPlayerUIDs(); // 从数据库获取所有 UID
    const uidDropdown = document.getElementById('uid-dropdown');
    const selectedDisplay = document.querySelector('.selected-display');
    const optionsList = document.querySelector('.options-list');
    selectedDisplay.textContent = defaultUid || '请先刷新数据';
    optionsList.innerHTML = ''; // 清空选项
    optionsList.classList.remove('show'); // 重建选项时收起，避免删空后残留展开空框
    players.forEach(uid => {
        const option = document.createElement('li');
        option.classList.add('dropdown-option');
        option.textContent = uid;
        option.dataset.value = uid;
        // 删除按钮
        const deleteBtn = document.createElement('button');
        deleteBtn.classList.add('delete-btn');
        deleteBtn.textContent = '删除';
        deleteBtn.addEventListener('click', async (event) => {
            event.stopPropagation(); // 阻止事件冒泡到 option 上
            const confirmed = confirm(`确定要删除 UID: ${uid} 的所有记录吗？`);
            if (confirmed) {
                try {
                    await window.electronAPI.invoke('delete-gacha-records', uid, 'gacha_logs');
                    const lastUid = await window.electronAPI.getLastQueryUid();
                    await loadPlayerUIDs(lastUid); // 加载玩家 UID 下拉框
                    await loadGachaRecords(lastUid); // 加载对应记录
                    animationMessage(true, `成功删除 UID: ${uid} 的记录`);
                } catch (error) {
                    animationMessage(false, `删除失败: ${error.message}`);
                }
            }
        });
        // 将删除按钮添加到选项中
        option.appendChild(deleteBtn);
        // UID 在数据库中是 INTEGER，而调用方可能传入字符串，必须统一按字符串比较
        if (String(uid) === String(defaultUid)) {
            selectedDisplay.textContent = uid;
            option.classList.add('active');
        }
        option.addEventListener('click', () => {
            selectedDisplay.textContent = uid;
            selectedDisplay.dataset.value = uid;
            document.querySelectorAll('.dropdown-option').forEach(opt => {
                opt.classList.remove('active');
            });
            option.classList.add('active');
            optionsList.classList.remove('show');
        });
        optionsList.appendChild(option);
    });
}

// 加载唤取记录
let gachaLoadToken = 0; // 切换账号并发保护：仅最新一次加载允许写 DOM，避免旧账号数据覆盖新账号
let currentAnalysisView = 'bar'; // 当前分析子视图（条形/卡片/详情/奇藏/等级）单一可信来源，默认进入条形视图
let cachedTreasure = null; // 当前账号奇藏数据（朴素/基准/精密/辉光/潮汐绿/紫/金），由 syncTreasureBoxes 填充，用于差值对比「已有」自动显示
let cachedLevel = null; // 当前账号联觉等级，由 syncTreasureBoxes 填充，用于等级差值对比「当前等级」自动显示（经验接口不返回，仍需手动）
let _accountState = { oauthCode: null, isGlobal: null };
function _getSavedAccount() { try { return JSON.parse(localStorage.getItem('wuwa_account') || 'null'); } catch { return null; } }
function _saveAccount(a) { try { localStorage.setItem('wuwa_account', JSON.stringify(a)); } catch {} }
// 下拉框显示文案：优先展示 UID（来自官方 API），离线拉不到时回退显示账号标识
function _accountLabel(a) {
  if (a && a.uid) return String(a.uid);
  return (a && (a.accountId || a.maskedPhone || a.username)) || '账号';
}

async function renderAccountSwitch(containerEl, target) {
  if (!containerEl) return;
  try {
    // 启动时区服尚未确定：传 null 让主进程返回国服+国际服全部账号
    // （与 WutheringWavesBox 一致：自动列出所有启动器登录态账号，无需用户操作）
    const res = await window.electronAPI.invoke('list-treasure-accounts', { isGlobal: null });
    let accounts = (res && res.success && res.accounts) ? res.accounts : [];
    // 游戏本地账号状态（无需启动器）：用于离线兜底与自动选中当前账号
    let gameState = null;
    try {
      const gs = await window.electronAPI.invoke('get-game-account-state');
      if (gs && gs.success && gs.state && gs.state.success) gameState = gs.state;
    } catch (e) { /* 忽略，走启动器缓存逻辑 */ }
    // 启动器缓存为空时，用游戏本地状态兜底（仅显示账号身份，刷新仍需启动器持久化的登录态）
    if (!accounts.length && gameState && gameState.currentUid) {
      accounts = [{ oauthCode: null, username: null, accountId: null, maskedPhone: null, isGlobal: false, regionKey: 'China', uid: gameState.currentUid, _fromGame: true }];
    }
    const display = containerEl.querySelector('.selected-display');
    const list = containerEl.querySelector('.options-list');
    if (!display || !list) return;
    if (!accounts.length) { display.textContent = '无登录账号'; containerEl.style.display = 'none'; return; }
    let activeIdx = 0;
    const cur = _getSavedAccount() || _accountState;
    accounts.forEach((a, i) => { if (a.oauthCode === cur.oauthCode) activeIdx = i; });
    // 用游戏本地「当前登录 UID」自动选中匹配的账号（即使离线也能正确定位）
    if (gameState && gameState.currentUid) {
      const mi = accounts.findIndex(a => a.uid && String(a.uid) === String(gameState.currentUid));
      if (mi >= 0) activeIdx = mi;
    }
    function setActive(idx) { activeIdx = idx; display.textContent = _accountLabel(accounts[idx]); list.querySelectorAll('.dropdown-option').forEach((it, i) => it.classList.toggle('active', i === idx)); }
    list.innerHTML = accounts.map((a, i) => '<li class="dropdown-option" data-idx="' + i + '">' + _accountLabel(a) + '</li>').join('');
    setActive(activeIdx);
    // 自动选中（匹配游戏UID或第一个账号）后立即写入选中态并拉取该账号实时奇藏/等级——
    // 无需用户手动点击，启动即自动同步当前账号数据（对齐 WutheringWavesBox 体验）
    const autoA = accounts[activeIdx];
    if (autoA) {
      _accountState.oauthCode = autoA.oauthCode;
      _accountState.isGlobal = autoA.isGlobal;
      _saveAccount({ oauthCode: autoA.oauthCode, isGlobal: autoA.isGlobal });
      syncTreasureBoxes();
    }
    const closeMenu = () => { list.classList.remove('show'); if (window.__accDocHandler) { document.removeEventListener('click', window.__accDocHandler, true); window.__accDocHandler = null; } };
    const openMenu = () => { if (accounts.length < 1) return; list.classList.add('show'); window.__accDocHandler = (ev) => { if (!containerEl.contains(ev.target)) closeMenu(); }; document.addEventListener('click', window.__accDocHandler, true); };
    display.onclick = (e) => { e.stopPropagation(); if (list.classList.contains('show')) closeMenu(); else openMenu(); };
    containerEl.addEventListener('mouseleave', () => closeMenu());
    list.querySelectorAll('.dropdown-option').forEach((it) => {
      it.onclick = (e) => {
        e.stopPropagation();
        const idx = parseInt(it.dataset.idx, 10);
        setActive(idx);
        closeMenu();
        const a = accounts[idx];
        _accountState.oauthCode = a.oauthCode;
        _accountState.isGlobal = a.isGlobal;
        _saveAccount({ oauthCode: a.oauthCode, isGlobal: a.isGlobal });
        syncTreasureBoxes(); // 切换账号后立即同步该账号奇藏/等级
      };
    });
  } catch (e) { containerEl.style.display = 'none'; }
}

function bindAccountCard() {
  renderAccountSwitch(document.getElementById('account-switch-sync'));
}

// 当前选中账号 uid：隐藏卡池设置按账号隔离（账号a隐藏某池，不影响账号b）
let currentUid = null;
function _hiddenStorageKey() {
  return 'wuwa_hidden_pools_' + (currentUid != null ? String(currentUid) : 'default');
}
function _readHiddenPools() {
  const raw = localStorage.getItem(_hiddenStorageKey());
  if (raw != null) {
    try { const arr = JSON.parse(raw); return new Set(Array.isArray(arr) ? arr : []); } catch (e) {}
  }
  // 迁移：首次使用某账号时复用旧的全局隐藏设置（仅一次），避免老用户设置丢失
  const legacy = localStorage.getItem('wuwa_hidden_pools');
  if (legacy != null) {
    try {
      const arr = JSON.parse(legacy);
      const set = new Set(Array.isArray(arr) ? arr : []);
      localStorage.setItem(_hiddenStorageKey(), JSON.stringify(Array.from(set)));
      localStorage.removeItem('wuwa_hidden_pools');
      return set;
    } catch (e) {}
  }
  return new Set();
}


async function resolveMainAccount() {
  try {
    const res = await window.electronAPI.invoke('get-main-account');
    if (res && res.success && res.account) {
      _accountState.oauthCode = res.account.oauthCode;
      _accountState.isGlobal = res.account.isGlobal;
      const saved = _getSavedAccount();
      if (saved && saved.oauthCode) {
        _accountState.oauthCode = saved.oauthCode;
        _accountState.isGlobal = saved.isGlobal != null ? saved.isGlobal : res.account.isGlobal;
      }
    }
  } catch (e) { console.warn('resolveMainAccount 失败', e); }
}

async function loadGachaRecords(uid) {
 try {
    const myLoadToken = ++gachaLoadToken;
    currentUid = uid;
    // 仅拉取当前账号的记录，避免多账号时把全库记录都传回再过滤
    const records = await window.electronAPI.getGachaRecords(uid);
    const container = document.getElementById('record-display');
    if (!container) {
        console.error('Error: Element with ID "record-display" not found.');
        return;
    }
    container.innerHTML = ''; // 清空显示内容
    console.log('Container cleared:', container.innerHTML);

    // player_id 在 SQLite 中是 INTEGER，uid 可能是字符串（来自 dataset / String() 转换），
    // 直接用 === 会全部过滤掉导致「有数据却显示空/ 不跳转」，必须统一按字符串比较
    const uidStr = String(uid);
    const filteredRecords = records.filter(r => String(r.player_id) === uidStr);

    const prevView = currentAnalysisView; // 上次切换账号前所在的子视图（由 switchAnalysisView 维护），侧边栏 nav-item 的 data-view 恒为 intuitive，不能作为判断依据
    // 切换账号并发保护：已有更新的账号加载在途时，丢弃本次渲染，避免旧账号数据覆盖新账号
    if (myLoadToken !== gachaLoadToken) return;
    if (!filteredRecords.length) {
        container.innerHTML = `
            <div id="view-intuitive" class="analysis-view active"></div>
            <div id="view-detail" class="analysis-view"></div>
            <div id="view-table" class="analysis-view"></div>
            <div id="view-qizang" class="analysis-view"></div>
            <div id="view-level" class="analysis-view"></div>
        `;
        document.getElementById('view-bar').innerHTML = emptyStateHtml('暂无唤取数据', '选择 UID 并点击「刷新数据」导入抽卡记录');
        try { renderQizangView(); } catch (e) { console.error('奇藏视图渲染失败', e); }
        try { renderLevelView(); } catch (e) { console.error('等级视图渲染失败', e); }
        return;
    }


    // 预解析头像（按 resource_id / 名称 从本地头像文件夹读取）
    try {
        const seen = new Set();
        const avatarItems = [];
        filteredRecords.forEach(r => {
            const key = (r.resource_id ?? '') + '|' + (r.name ?? '');
            if (!seen.has(key)) { seen.add(key); avatarItems.push({ resourceId: r.resource_id, name: r.name }); }
        });
        avatarItems.push({ resourceId: '', name: '漂泊者·导电' });
        window.gachaAvatarMap = await window.electronAPI.getGachaAvatars(avatarItems);
    } catch (e) {
        console.warn('头像预解析失败:', e);
        window.gachaAvatarMap = { byResourceId: {}, byName: {} };
    }
    // 取得第一条记录的 lang 属性，若不存在则默认使用 'zh-cn'
    const lang = filteredRecords[0].lang || 'zh-cn';
    // 根据 lang 从后端获取对应的 commonItems
    try {
      commonItems = await window.electronAPI.invoke('get-common-items','wuWa', lang);
      if (!Array.isArray(commonItems)) commonItems = [];
    } catch (e) {
      console.error('[commonItems] 获取常驻列表失败，降级为空数组', e);
      commonItems = [];
    }

    const pools = categorizeRecords(filteredRecords);
    const GACHA_TYPE_ORDER = [
        "角色活动唤取", "武器活动唤取", "角色联动唤取", "武器联动唤取","角色新旅唤取", "武器新旅唤取", "角色忆旅唤取", "武器忆旅唤取",
        "角色常驻唤取", "武器常驻唤取", "新手限定唤取", "新手自选唤取",
        "感恩定向唤取",
    ];

    const safeValue = (value, fallback = "暂无") => (value === null || value === undefined ? fallback : value);

    const generateStatsCards = (avgFiveStarText, avgUpText, mostDrawsText, leastDrawsText) => `
        <div class="stats-container">
            <div class="stats-card">
                <div class="stats-title">平均5星</div>
                <div class="stats-value">${safeValue(avgFiveStarText)}</div>
            </div>
            <div class="stats-card">
                <div class="stats-title">平均UP</div>
                <div class="stats-value">${safeValue(avgUpText)}</div>
            </div>
            <div class="stats-card">
                <div class="stats-title">最非</div>
                <div class="stats-value">${safeValue(mostDrawsText)}</div>
            </div>
            <div class="stats-card">
                <div class="stats-title">最欧</div>
                <div class="stats-value">${safeValue(leastDrawsText)}</div>
            </div>
        </div>
    `;

    const generateProgressBar = (draws, maxDraws, label, variant = 'gold') => {
        const progressWidth = Math.max(0, Math.min((draws / maxDraws) * 100, 100)) || 0; // 限制最大宽度为 100%
        return `
            <div class="progress-card">
                <div class="progress-card-title">
                    <span>${label}</span>
                    <span class="progress-draws">${draws}抽</span>
                </div>
                <div class="progress-bar-container">
                    <div class="progress-bar ${variant}" style="width: ${progressWidth}%;"></div>
                </div>
            </div>
        `;
    };
    const generateRatingCards = (records, poolType) => {
        const fiveStarAvg = calculateDrawsBetween(records, 5);
        const isCharacterEvent = poolType === "角色活动唤取";
        const noDeviationRate = isCharacterEvent ? calculateNoDeviationRate(records) : null;
        const avgUp = poolType === "角色活动唤取" ? calculateUpAverage(pools[poolType]) : null;
        const avgUpText = typeof avgUp === "number" ? `${avgUp.toFixed(2)}` : avgUp;
        const careerRating = getRating(fiveStarAvg, avgUpText);
        const chartId = `star-pie-chart-${poolType}`; // 动态生成唯一 ID

        const ratingDetails = isCharacterEvent
            ? `
                <div class="rating-detail">
                    <h3>生涯评级</h3>
                    <p>${careerRating}</p>
                </div>
                <div class="rating-detail">
                    <h3>不歪概率</h3>
                    <p>${noDeviationRate || "--"}</p>
                </div>
            `
            : `
                <div class="rating-detail full">
                    <h3>生涯评级</h3>
                    <p>${careerRating}</p>
                </div>
            `;

        return `
            <div class="rating-container">
                <div class="rating-chart-card">
                    <canvas id="${chartId}" width="150" height="150"></canvas>
                </div>
                <div class="rating-info-card">
                    ${ratingDetails}
                </div>
            </div>
        `;
    };

    // ===== 分析视图容器（直观 / 详情 / 表格）=====
    container.innerHTML = `
        <div id="view-bar" class="analysis-view active"></div>
        <div id="view-intuitive" class="analysis-view"></div>
        <div id="view-detail" class="analysis-view"></div>
        <div id="view-table" class="analysis-view"></div>
        <div id="view-qizang" class="analysis-view"></div>
        <div id="view-level" class="analysis-view"></div>
    `;

    function renderDetailView() {
        const viewEl = document.getElementById('view-detail');
        const recTime = (r) => (r.time || r.timestamp || '');
        const hidden = getHiddenPools();
        const presentTypes = Object.keys(pools);
        const orderedTypes = GACHA_TYPE_ORDER.filter(t => presentTypes.includes(t));
        const extraTypes = presentTypes.filter(t => !GACHA_TYPE_ORDER.includes(t));
        const allPoolTypes = orderedTypes.concat(extraTypes);
        const poolTypes = allPoolTypes.filter(t => pools[t] && pools[t].length && !hidden.has(t));
        // 全部卡池（全部数据）：始终存在，不受个体卡池隐藏影响；仅当用户显式隐藏“全部卡池”时移除
        const showSummary = !hidden.has('__SUMMARY_ALL__');
        let currentPool = showSummary ? 'all' : (poolTypes[0] || '');
        let currentPage = 1;
        let pageSize = 10;
        let starFilter = new Set();
        let timeFilter = new Set();

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
                            <option value="10" selected>10</option>
                            <option value="20">20</option>
                            <option value="50">50</option>
                            <option value="100">100</option>
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
                list = filteredRecords.slice();
            } else {
                if (poolTypes.length === 0) return [];
                list = filteredRecords.filter(r => r.card_pool_type === currentPool);
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
        sizeSel.addEventListener('change', () => { pageSize = parseInt(sizeSel.value, 10); currentPage = 1; renderRows(); });
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
            const popH = pop.offsetHeight || 160;
            // 水平：优先让浮层中心对齐列中心
            let left = (tr.left - cr.left) + (tr.width - popW) / 2;
            // 左边界防护
            if (left < 4) left = 4;
            // 右边界防护：内容区右缘 - 浮层宽 - 4
            const maxLeft = cr.width - popW - 4;
            if (left > maxLeft) left = Math.max(4, maxLeft);
            pop.style.left = left + 'px';
            // 垂直：列表头正下方
            let top = (tr.bottom - cr.top) + 8;
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
                ? filteredRecords.slice()
                : filteredRecords.filter(r => r.card_pool_type === currentPool);
            const dates = [...new Set(base.map(r => (recTime(r).split(' ')[0] || '')))].filter(Boolean).sort().reverse();
            const listEl = timePop.querySelector('#time-date-list');
            listEl.innerHTML = dates.map(d =>
                '<button type="button" class="dfp-option' + (timeFilter.has(d) ? ' active' : '') + '" data-date="' + d + '">' + d + '</button>'
            ).join('') || '<div class="dfp-empty">无可用日期</div>';
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

    try { renderDetailView(); } catch (e) { console.error('详情视图渲染失败', e); }
    window.__renderDetailView = renderDetailView; // 缓存引用，供应用隐藏卡池后重渲染详情视图
    try { renderBarView(filteredRecords, pools); } catch (e) { console.error('条形视图渲染失败', e); }
    try { renderIntuitiveView(filteredRecords, pools); } catch (e) { console.error('直观视图渲染失败', e); }
    try { renderTableView(filteredRecords); } catch (e) { console.error('表格视图渲染失败', e); }
    try { renderQizangView(); } catch (e) { console.error('奇藏视图渲染失败', e); }
    try { renderLevelView(); } catch (e) { console.error('等级视图渲染失败', e); }
    setupAnalysisTabs();

    // 重渲染后保留用户当前所在 tab（模板默认回到「统计」）
    if (typeof window.switchAnalysisView === 'function') window.switchAnalysisView(prevView);
    // 修复禁用硬件加速时 backdrop-filter 局部重建后的视觉扭曲
    forceRepaintBackdrop(container);

 } catch (e) {
    console.error('[loadGachaRecords] 渲染过程中发生未捕获异常，已降级保护：', e);
 }
}



/* ---------- 详情页 卡池内 概览/详细 子标签切换 ---------- */
function initRecordListTabs(pool, poolSection) {
    const tabContainer = poolSection.querySelector('.record-list-tabs');
    if (!tabContainer) return;
    const tabs = tabContainer.querySelectorAll('.record-tab');
    const listEl = poolSection.querySelector('.record-list');
    if (!listEl) return;
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.dataset.tab;
            if (target === 'overview') {
                listEl.innerHTML = generateOverview(pool);
            } else if (target === 'details') {
                listEl.innerHTML = generateDetails(pool);
            }
        });
    });
}

function initScrollLogic() {
    const recordDisplay = document.getElementById('record-display');
    if (!recordDisplay) {
        console.error('Error: Element with ID "record-display" not found.');
        return;
    }
    // 滚动完全交给浏览器原生处理：内部可滚动区域（.detail-table-scroll / .record-list / .card-content）
    // 优先滚动，到达边界后由外层 .content 接管页面纵向滚动。
    // 原逻辑会在详情视图把滚轮转成横向滚动并 preventDefault，导致鼠标滚轮无法纵向滑动页面/表格，已移除。
    recordDisplay.addEventListener('wheel', () => {}, { passive: true });
}


// 监听 UID 切换
async function gachaWuwaInit() {
    const lastUid = await window.electronAPI.getLastQueryUid();
    await loadPlayerUIDs(lastUid); // 加载玩家 UID 下拉框
    await loadGachaRecords(lastUid); // 加载对应记录
    initScrollLogic(); // 初始化滚动逻辑
    initRecordTooltips();
    initSettingsMenu();

    // 监听 UID 切换
    document.querySelector('.selected-display').addEventListener('click', async () => {
        const optionsList = document.querySelector('.options-list');
        if (!optionsList.querySelector('.dropdown-option')) return; // 没有任何账号时不展开
        optionsList.classList.toggle('show');
    });

    // 鼠标移出 UID 下拉框时自动收起
    document.getElementById('uid-dropdown').addEventListener('mouseleave', () => {
        const optionsList = document.getElementById('uid-dropdown').querySelector('.options-list');
        if (optionsList) optionsList.classList.remove('show');
    });

    document.querySelector('.options-list').addEventListener('click', async (event) => {
        if (event.target && event.target.classList.contains('dropdown-option')) {
            const selectedUid = event.target.dataset.value;

            // 更新下拉显示
            document.querySelector('.selected-display').textContent = selectedUid;
            document.querySelector('.selected-display').dataset.value = selectedUid;

            // 收起下拉列表
            document.querySelector('.options-list').classList.remove('show');

            // 加载对应的抽卡记录
            await loadGachaRecords(selectedUid);
        }
    });

    // 刷新数据
    document.getElementById('refresh-data').addEventListener('click', async () => {
        const refreshButton = document.getElementById('refresh-data');
        // 禁用按钮，防止重复点击；显示 spinner 加载态
        refreshButton.disabled = true;
        setButtonLoading(refreshButton, true, '云鸣潮获取');
        try {
            const result = await window.electronAPI.refreshGachaRecords();
            if (result && result.success) {
                // 直接重载该账号数据并自动选中刚获取的账号（多账号场景下不再需手动切换）
                await reloadGachaData(result.playerId);
            } else {
                console.error(result && result.error);
            }
        } catch (error) {
            console.error('发生错误:', error);
        } finally {
            // 无论请求是否成功，启用按钮并恢复文案
            refreshButton.disabled = false;
            setButtonLoading(refreshButton, false, '云鸣潮获取');
        }
    });

    // 鸣潮内获取：从本地游戏日志读取唤取链接（数据算法与云鸣潮获取完全一致）
    const importFromGameBtn = document.getElementById('import-from-game');
    if (importFromGameBtn) {
        importFromGameBtn.addEventListener('click', async () => {
            const otherBtn = document.getElementById('refresh-data');
            importFromGameBtn.disabled = true;
            setButtonLoading(importFromGameBtn, true, '鸣潮内获取');
            if (otherBtn) otherBtn.disabled = true;
            try {
                const result = await window.electronAPI.importGachaFromGame();
                if (result && result.success) {
                    await reloadGachaData(result.playerId);
                } else {
                    console.error(result && result.error);
                }
            } catch (error) {
                console.error('鸣潮内获取发生错误:', error);
            } finally {
                importFromGameBtn.disabled = false;
                setButtonLoading(importFromGameBtn, false, '鸣潮内获取');
                if (otherBtn) otherBtn.disabled = false;
            }
        });
    }

    // 解析主账号（免启动器 / 免 UID），并自动同步奇藏/等级
    await resolveMainAccount();
    bindAccountCard();
    syncTreasureBoxes();
}

window.electronAPI.on('gacha-records-status', (event, status) => {
    const statusElement = document.getElementById('status-display');
    if (statusElement) {
        // 保留 .status-text span 结构，确保超出框时稳定显示 ...（避免 textContent 销毁 span 导致省略失效）
        let span = statusElement.querySelector('.status-text');
        if (!span) {
            statusElement.textContent = '';
            span = document.createElement('span');
            span.className = 'status-text';
            statusElement.appendChild(span);
        }
        span.textContent = status;
    }
});

function initSettingsMenu() {
  // 隐藏卡池（右上角直接按钮）
  const hidePoolsBtn = document.getElementById('hidePoolsBtn');
  if (hidePoolsBtn) {
    hidePoolsBtn.addEventListener('click', async () => {
      openHidePoolsModal();
    });
  }
}

/** ===== 隐藏卡池弹窗逻辑 ===== */
async function openHidePoolsModal() {
  const modal = document.getElementById('hidePoolsModal');
  const list = document.getElementById('hidePoolsList');
  const closeBtn = document.getElementById('closeHidePoolsModal');
  const selectAllBtn = document.getElementById('hidePoolsSelectAll');
  const confirmBtn = document.getElementById('hidePoolsConfirm');

  const poolOptions = await getRenderedPoolTitles();
  // 追加“全部卡池”汇总卡的隐藏选项
  const allHideOptions = poolOptions.concat([{ key: '__SUMMARY_ALL__', title: '全部卡池' }]);

  // 从 localStorage 读隐藏列表（按当前账号隔离）
  const STORAGE_KEY = _hiddenStorageKey();
  const hiddenPools = _readHiddenPools();

  // 重置列表
  list.innerHTML = '';
  allHideOptions.forEach(name => {
    const item = document.createElement('div');
    item.className = 'pool-row';
    item.dataset.pool = name.key;
    const dot = document.createElement('span'); dot.className = 'pool-dot';
    const label = document.createElement('span'); label.className = 'pool-name'; label.textContent = name.title;
    const check = document.createElement('span'); check.className = 'pool-check';
    item.appendChild(dot); item.appendChild(label); item.appendChild(check);
    if (hiddenPools.has(name.key)) item.classList.add('selected');

    item.addEventListener('click', () => {
      item.classList.toggle('selected');
      updateSelectAllText();
    });

    list.appendChild(item);
  });

  const updateSelectAllText = () => {
    const items = Array.from(list.querySelectorAll('.pool-row'));
    const selectedItems = items.filter(x => x.classList.contains('selected'));
    const allSelected = items.length > 0 && selectedItems.length === items.length;
    if (allSelected) {
      selectAllBtn.classList.add('primary');
      selectAllBtn.innerText = '取消全选';
    } else {
      selectAllBtn.classList.remove('primary');
      selectAllBtn.innerText = '全选';
    }
    const counter = document.getElementById('hidePoolsCount');
    if (counter) counter.textContent = selectedItems.length;
  };
  updateSelectAllText();

  if (typeof openModal === 'function') openModal(modal);
  else {
    modal.style.display = 'flex';
    modal.classList.remove('fade-out');
  }

  // 关闭
  const close = () => {
    if (typeof closeModal === 'function') closeModal(modal);
    else modal.style.display = 'none';
  };
  closeBtn.onclick = close;

  // 全选/取消全选
  selectAllBtn.onclick = () => {
    const items = Array.from(list.querySelectorAll('.pool-row'));
    const allSelected = items.length > 0 && items.every(x => x.classList.contains('selected'));
    items.forEach(x => x.classList.toggle('selected', !allSelected));
    updateSelectAllText();
  };

  // 应用：保存到 localStorage，并刷新当前展示
  const applyHidden = async () => {
    const selected = Array.from(list.querySelectorAll('.pool-row.selected')).map(x => x.dataset.pool);
    localStorage.setItem(_hiddenStorageKey(), JSON.stringify(selected));
    close();
    // 直接基于已缓存数据重渲染，跳过数据库拉取/头像读取/IPC，消除卡顿
    if (lastIntuitiveData) {
      try { renderBarView(lastIntuitiveData.records, lastIntuitiveData.pools); } catch (e) { console.error('条形视图重渲染失败', e); }
      try { renderIntuitiveView(lastIntuitiveData.records, lastIntuitiveData.pools); } catch (e) { console.error('直观视图重渲染失败', e); }
      try { renderTableView(lastIntuitiveData.records); } catch (e) { console.error('表格视图重渲染失败', e); }
      try { if (typeof window.__renderDetailView === 'function') window.__renderDetailView(); } catch (e) { console.error('详情视图重渲染失败', e); }
    }
    animationMessage(true, '已应用隐藏卡池设置');
  };
  confirmBtn.onclick = applyHidden;

}

function getHiddenPools() {
  return _readHiddenPools();
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


// 刷新/登录后统一重载：账号下拉框 + 记录，与 gachaWuwaInit 保持一致，
// 避免「账号不显示 / 数据与所选账号对不上」（刷新路径此前漏调 loadPlayerUIDs）
//
// 采用「最新请求获胜」令牌：多账号/双入口（云鸣潮获取 & 鸣潮内获取）并发时，
// 只有最新一次请求的 UID 会真正落地到下拉框与记录渲染，避免旧账号覆盖新账号
// （此前 _reloading 布尔守卫会直接丢弃后到的请求，导致留在旧账号页面）。
let _reloadToken = 0;
async function reloadGachaData(preferredUid) {
    const myToken = ++_reloadToken;
    // 优先使用刷新/获取时实际拉取的账号 uid（多账号下「最近查询 uid」可能仍是旧账号，
    // 导致新账号数据不自动展示）；兜底再退回「最近查询 uid」。
    const uid = preferredUid || await window.electronAPI.getLastQueryUid();
    // 先切换下拉框到目标 UID，确保「获取到哪个账号就跳到哪个账号」
    switchDropdownTo(uid);
    await loadPlayerUIDs(uid);   // 重新加载账号下拉框（关键：刷新后必须更新）
    if (myToken !== _reloadToken) return; // 已有更新的重载，交给它落地
    // 数据拉取/渲染前先显示骨架屏，避免 record-display 空白跳动
    const rd = document.getElementById('record-display');
    if (rd) rd.innerHTML = skeletonHtml();
    await loadGachaRecords(uid); // 重载记录（其内部会清空 record-display 再渲染真实内容）
    if (myToken !== _reloadToken) return; // 已有更新的重载，交给它落地
    syncTreasureBoxes();
}

// 立刻把 UID 下拉框显示与选中态切到指定 uid（不等 loadPlayerUIDs 异步完成），
// 保证「鸣潮内获取 a 账号页面 → 拉到 b 数据 → 立即跳到 b」的体验。
function switchDropdownTo(uid) {
    if (!uid) return;
    const selectedDisplay = document.querySelector('.selected-display');
    if (selectedDisplay) {
        selectedDisplay.textContent = uid;
        selectedDisplay.dataset.value = uid;
    }
    document.querySelectorAll('.dropdown-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.value === String(uid));
    });
}

// 暴露初始化函数
window.gachaWuwaInit = gachaWuwaInit;

// 刷新/登录获取完成后，主进程广播 gacha-records-updated。
// 若当前正停留在抽卡分析页则立即重渲染；否则不处理——切回分析页时
// gachaWuwaInit 会重新 loadGachaRecords 拉取最新数据，避免“切几次页面才出来”。
// 注意：preload 的 on 直接桥接 ipcRenderer.on，回调签名为 (event, ...args)，
// 真正的 payload 是第二个参数，不要误把 event 当 payload（否则 evt.playerId 永远 undefined，
// 导致广播触发的重载永远走 getLastQueryUid() 兜底回到第一个账号）。
window.electronAPI.on('gacha-records-updated', async (event, payload) => {
    if (document.getElementById('record-display')) {
        const pid = payload && payload.playerId;
        await reloadGachaData(pid);
    }
});

/* ===================== 直观 / 详情 / 表格 三个分析视图 ===================== */

let tableState = { page: 1, pageSize: 50, pool: null, totalPages: 1 };

let lastIntuitiveData = null;


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
/* ---------- 条形：按卡池分组展示五星出货条形图 ---------- */
function renderBarView(records, pools) {
    const hidden = getHiddenPools();
    const POOL_ORDER = [
        '角色活动唤取', '武器活动唤取', '角色联动唤取', '武器联动唤取',
        '角色新旅唤取', '武器新旅唤取', '角色忆旅唤取', '武器忆旅唤取', '角色常驻唤取', '武器常驻唤取',
        '新手限定唤取', '新手自选唤取', '感恩定向唤取'
    ];
    const titleMap = {
        '角色活动唤取': '角色活动', '武器活动唤取': '武器活动',
        '角色联动唤取': '角色联动', '武器联动唤取': '武器联动',
        '角色新旅唤取': '角色新旅', '武器新旅唤取': '武器新旅',
        '角色忆旅唤取': '角色忆旅', '武器忆旅唤取': '武器忆旅',
        '角色常驻唤取': '角色常驻', '武器常驻唤取': '武器常驻',
        '新手限定唤取': '新手限定', '新手自选唤取': '新手自选', '感恩定向唤取': '感恩定向'
    };
    const cats = POOL_ORDER.filter(k => pools[k] && pools[k].length).map(k => ({ key: k, title: titleMap[k] || k }));
    const view = document.getElementById('view-bar');
    if (!view) return;
    view.innerHTML = '';

    function drawsToNext(recs, record, quality) {
        const idx = recs.indexOf(record);
        let nextIdx = recs.length;
        for (let i = idx + 1; i < recs.length; i++) {
            if (recs[i].quality_level === quality) { nextIdx = i; break; }
        }
        return nextIdx - idx;
    }

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
        const five = recs.filter(r => r.quality_level === 5).length;
        const four = recs.filter(r => r.quality_level === 4).length;
        const fiveRate = total ? ((five / total * 100).toFixed(2)) : '—';
        const fourRate = total ? ((four / total * 100).toFixed(2)) : '—';
        const currentPity = calculateLastDraws(recs, 5);
        const fiveAvgRaw = total ? calculateDrawsBetween(recs, 5) : null;
        const fiveAvg = (typeof fiveAvgRaw === 'number' && !isNaN(fiveAvgRaw)) ? String(fiveAvgRaw.toFixed(2)) : '—';
        const avgLimitedRaw = isCharLimited ? calculateUpAverage(recs) : null;
        const avgLimited = (typeof avgLimitedRaw === 'number' && !isNaN(avgLimitedRaw)) ? String(avgLimitedRaw.toFixed(2)) : '—';
        let noDeviation = '—';
        if (isCharLimited) { const _nd = calculateNoDeviationRate(recs); if (_nd) noDeviation = _nd; }
        let dateRange = '暂无';
        const times = recs.map(r => r.timestamp).filter(Boolean).sort();
        if (times.length) dateRange = (times[0] || '').split(' ')[0] + ' - ' + (times[times.length - 1] || '').split(' ')[0];

        const statDefs = [
            { key: 'pity', label: '当前已垫', value: currentPity, cls: 'st-pity' },
            { key: 'nodev', label: '不歪概率', value: noDeviation, cls: 'st-nodev' },
            { key: 'avglimited', label: '平均限定', value: avgLimited, cls: 'st-avglimited' },
            { key: 'avgfive', label: '平均五星', value: fiveAvg, cls: 'st-avgfive' },
            { key: 'five', label: '五星总数', value: five, cls: 'st-five' },
            { key: 'four', label: '四星总数', value: four, cls: 'st-four' },
            { key: 'fiverate', label: '五星出率', value: fiveRate, cls: 'st-avgfive' },
            { key: 'fourrate', label: '四星出率', value: fourRate, cls: 'st-avglimited' }
        ];
        const miniHtml = buildMiniGridHtml(statDefs);

        const fiveList = recs.filter(r => r.quality_level === 5);
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
                        <div class="bar-fill" style="width: ${pct}%; background: ${color};">
                                <span class="bar-fill-text">${currentPity}抽</span>
                        </div>
                    </div>
                </div>
            `);
            hasAny = true;
        }

        fiveList.forEach(r => {
            const draws = drawsToNext(recs, r, 5);
            const pct = Math.min(100, (draws / MAX_DRAW) * 100);
            const color = getBarDrawColor(draws);
            const isDeviation = isCharLimited && isCommonItem(r.name, r.timestamp, commonItems);
            const row = document.createElement('div');
            row.className = 'bar-row' + (isDeviation ? ' deviation' : '');
            row.dataset.time = r.timestamp || '';
            row.innerHTML = `
                <div class="bar-avatar-wrap">
                    ${recordAvatarHtml(r)}
                    ${isDeviation ? '<span class="bar-deviation-badge">歪</span>' : ''}
                </div>
                <div class="bar-track">
                    <div class="bar-fill" style="width: ${pct}%; background: ${color};">
                        <span class="bar-fill-text">${draws}抽</span>
                    </div>
                </div>
            `;
            rowsContainer.appendChild(row);
            hasAny = true;
        });

        if (rowsContainer.children.length) {
            wrapper.appendChild(section);
            hasAny = true;
        }
    });


    if (!hasAny) view.innerHTML = emptyStateHtml('暂无可视化数据', '切换卡池筛选或刷新数据后再来查看');
    else view.appendChild(wrapper);


    }
    function buildAllPoolsCard(appendTo, cats, pools, hidden, variant) {
        function drawsToNext(recs, record, quality) {
            const idx = recs.indexOf(record);
            let nextIdx = recs.length;
            for (let i = idx + 1; i < recs.length; i++) { if (recs[i].quality_level === quality) { nextIdx = i; break; } }
            return nextIdx - idx;
        }

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
            allTotal += recs.length;
            allFive += recs.filter(r => r.quality_level === 5).length;
            allFour += recs.filter(r => r.quality_level === 4).length;
            const isCharLimited = cat.key.startsWith('角色') && !cat.key.includes('常驻') && !cat.key.includes('新手');
            const isRolePool = cat.key.startsWith('角色') || cat.key.includes('新手');
            const isWeaponStd = cat.key.startsWith('武器') && cat.key.includes('常驻');
            allLimitedFive += (isCharLimited ? recs.filter(r => r.quality_level === 5).length : 0);
            if (isRolePool) {
                allStdFive += recs.filter(r => r.quality_level === 5 && isStdChar(r)).length;
            } else if (isWeaponStd) {
                allStdFive += recs.filter(r => r.quality_level === 5 && isStdWeapon(r)).length;
            }
            const _total = recs.length;
            const _fa = _total ? calculateDrawsBetween(recs, 5) : null;
            if (typeof _fa === 'number' && !isNaN(_fa)) { sumFiveAvg += _fa; cntFiveAvg++; }
            if (isCharLimited) {
              const _al = calculateUpAverage(recs);
              if (typeof _al === 'number' && !isNaN(_al)) { sumAvgLimited += _al; cntAvgLimited++; }
            }
            recs.forEach(r => { if (r.timestamp) allTimes.push(r.timestamp); });
            recs.filter(r => r.quality_level === 5).forEach(r => {
                const draws = drawsToNext(recs, r, 5);
                const isDeviation = isCharLimited && isCommonItem(r.name, r.timestamp, commonItems);
                allFiveItems.push({ r: r, draws: draws, isDeviation: isDeviation });
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
        card.dataset.charKey = '__summary__';
        if (variant === 'bar') {
            const MAX_DRAW_ALL = 80;
            let summaryRows = '';
            allFiveItems.forEach(it => {
                const draws = it.draws;
                const pct = Math.min(100, (draws / MAX_DRAW_ALL) * 100);
                const color = getBarDrawColor(draws);
                summaryRows += '<div class="bar-row' + (it.isDeviation ? ' deviation' : '') + '" data-time="' + (r.timestamp || '') + '">' +
                    '<div class="bar-avatar-wrap">' + recordAvatarHtml(it.r) +
                    (it.isDeviation ? '<span class="bar-deviation-badge">歪</span>' : '') +
                    '</div><div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:' + color + ';">' +
                    '<span class="bar-fill-text">' + draws + '抽</span></div></div></div>';
            });
            card.innerHTML = `
                <div class="bar-pool-head">
                    <div class="bar-head-left">
                        <span class="bar-pool-title">全部卡池</span>
                        <span class="bar-pool-date">${dateRange}</span>
                    </div>
                    <span class="total-draws">${allTotal} 抽</span>
                </div>
                <div class="intuitive-mini-grid bar-mini-grid">${miniHtml}</div>
                <div class="bar-pool-rows">${summaryRows || '<div class="intuitive-empty">暂无记录</div>'}</div>
            `;
        } else {
            const charListHtml = buildIntuitiveCharListHtml(allFiveItems, 'five');
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
                <div class="intuitive-char-list" data-charlist>${charListHtml}</div>
                </div>
            `;
        }
        appendTo.appendChild(card);



    }


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
    function drawsToNext(recs, record, quality) {
        const idx = recs.indexOf(record);
        let nextIdx = recs.length;
        for (let i = idx + 1; i < recs.length; i++) {
            if (recs[i].quality_level === quality) { nextIdx = i; break; }
        }
        return nextIdx - idx;
    }
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
        const five = recs.filter(r => r.quality_level === 5).length;
        const four = recs.filter(r => r.quality_level === 4).length;
        const fiveRate = total ? ((five / total * 100).toFixed(2)) : '—';
        const fourRate = total ? ((four / total * 100).toFixed(2)) : '—';
        const currentPity = calculateLastDraws(recs, 5);
        const fiveAvgRaw = total ? calculateDrawsBetween(recs, 5) : null;
        const fiveAvg = (typeof fiveAvgRaw === 'number' && !isNaN(fiveAvgRaw)) ? String(fiveAvgRaw.toFixed(2)) : '—';
        const avgLimitedRaw = isCharLimited ? calculateUpAverage(recs) : null;
        const avgLimited = (typeof avgLimitedRaw === 'number' && !isNaN(avgLimitedRaw)) ? String(avgLimitedRaw.toFixed(2)) : '—';
        let noDeviation = '—';
        if (isCharLimited) { const _nd = calculateNoDeviationRate(recs); if (_nd) noDeviation = _nd; }
        let dateRange = '暂无';
        const times = recs.map(r => r.timestamp).filter(Boolean).sort();
        if (times.length) dateRange = (times[0] || '').split(' ')[0] + ' - ' + (times[times.length - 1] || '').split(' ')[0];
        const statDefs = [
            { key: 'pity', label: '当前已垫', value: currentPity, cls: 'st-pity' },
            { key: 'nodev', label: '不歪概率', value: noDeviation, cls: 'st-nodev' },
            { key: 'avglimited', label: '平均限定', value: avgLimited, cls: 'st-avglimited' },
            { key: 'avgfive', label: '平均五星', value: fiveAvg, cls: 'st-avgfive' },
            { key: 'five', label: '五星总数', value: five, cls: 'st-five' },
            { key: 'four', label: '四星总数', value: four, cls: 'st-four' },
            { key: 'fiverate', label: '五星出率', value: fiveRate, cls: 'st-avgfive' },
            { key: 'fourrate', label: '四星出率', value: fourRate, cls: 'st-avglimited' }
        ];
        const miniHtml = buildMiniGridHtml(statDefs);
        const fiveList = recs.filter(r => r.quality_level === 5);
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
        const fiveHtml = fiveItemsHtmlArr.length ? fiveItemsHtmlArr.join('') : '<div class="intuitive-empty">暂无五星</div>';
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
                <div class="intuitive-char-list" data-charlist>${fiveHtml}</div>
            </div>
        `;
        wrapper.appendChild(card);
        hasAny = true;
    });
    if (!hasAny) view.innerHTML = emptyStateHtml('暂无可视化数据', '切换卡池筛选或刷新数据后再来查看');
    else view.appendChild(wrapper);
}

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
                        <option value="20">20</option>
                        <option value="50" selected>50</option>
                        <option value="100">100</option>
                        <option value="200">200</option>
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
    view.querySelector('#table-page-size').addEventListener('change', (e) => { tableState.pageSize = parseInt(e.target.value, 10); tableState.page = 1; renderTablePage(); });

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

/* ---------- 总览 Tab 切换 ---------- */
function switchAnalysisView(view) {
    // 侧边栏“分析”进入：恢复到上次离开分析页时的子视图（条形/卡片/详情），
    // 避免切到奇藏再切回时被强制重置为条形、且顶部按钮高亮残留导致“详情按钮高亮却显示条形内容”
    if (view === 'analysis') {
        if (currentAnalysisView === 'detail' || currentAnalysisView === 'intuitive') view = currentAnalysisView;
        else view = 'bar';
    }
    currentAnalysisView = view; // 维护当前子视图单一可信来源，供切换账号/切回分析后恢复
    document.querySelectorAll('.nav-item[data-view]').forEach(b => {
        const bv = b.dataset.view;
        b.classList.toggle('active', bv === view || (bv === 'analysis' && (view === 'bar' || view === 'intuitive' || view === 'detail')) || (bv === 'intuitive' && view === 'detail') || (bv === 'detail' && view === 'intuitive'));
    });
    document.querySelectorAll('.analysis-view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    const pageTitle = document.querySelector('.page-title');
    if (pageTitle) {
        const titles = { bar: '抽卡分析', intuitive: '抽卡分析', detail: '抽卡分析', qizang: '奇藏计算', level: '等级计算' };
        pageTitle.textContent = titles[view] || '抽卡分析';
    }
    const tabbar = document.getElementById('analysis-tabbar');
    if (tabbar) {
        tabbar.style.display = (view === 'bar' || view === 'intuitive' || view === 'detail') ? '' : 'none';
        // 同步顶部“统计/详情”按钮高亮，避免从奇藏切回时按钮态残留（详情按钮高亮但显示统计内容）
        tabbar.querySelectorAll('.analysis-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    }
    const subTabbar = document.getElementById('sub-view-row');
    if (subTabbar) {
        const showSub = (view === 'qizang' || view === 'level');
        subTabbar.style.display = showSub ? '' : 'none';
        if (showSub) {
            const cur = (view === 'qizang') ? qizangSubMode : levelSubMode;
            subTabbar.querySelectorAll('.analysis-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === cur));
        }
    }
}
window.switchAnalysisView = switchAnalysisView;

/* 导航已迁移至左侧边栏（index.html），由 renderer.js 统一绑定与页面切换 */
function setupAnalysisTabs() {
    const tabbar = document.getElementById('analysis-tabbar');
    if (tabbar) {
        tabbar.querySelectorAll('.analysis-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const view = tab.dataset.view;
                tabbar.querySelectorAll('.analysis-tab').forEach(t => t.classList.toggle('active', t === tab));
                if (typeof window.switchAnalysisView === 'function') {
                    window.switchAnalysisView(view);
                }
            });
        });
    }
    const subTabbar = document.getElementById('sub-view-tabbar');
    if (subTabbar) {
        subTabbar.querySelectorAll('.analysis-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const mode = tab.dataset.mode;
                const isQizang = document.getElementById('view-qizang').classList.contains('active');
                if (isQizang) { qizangSubMode = mode; } else { levelSubMode = mode; }
                subTabbar.querySelectorAll('.analysis-tab').forEach(t => t.classList.toggle('active', t === tab));
                if (isQizang) { if (typeof window.__renderQizang === 'function') window.__renderQizang(); }
                else { if (typeof window.__renderLevel === 'function') window.__renderLevel(); }
            });
        });
    }
}


let growNumFull = true; // 数字 缩写(w)/完整 全局切换状态（奇藏/等级共用，切换 tab 不重置）
let qizangSubMode = 'overview';


function renderQizangView() {
  const view = document.getElementById('view-qizang');
  if (!view) return;
  const DATA = [
    { name: '朴素', count: 954, unit: 5 },
    { name: '基准', count: 1082, unit: 10 },
    { name: '精密', count: 453, unit: 20 },
    { name: '辉光', count: 111, unit: 40 },
    { name: '潮汐绿', count: 201, unit: 5 },
    { name: '潮汐紫', count: 207, unit: 5 },
    { name: '潮汐金', count: 233, unit: 10 },
  ];
  DATA.forEach(d => { d.total = d.count * d.unit; });
  const totalStars = DATA.reduce((a, d) => a + d.total, 0);
  const totalCount = DATA.reduce((a, d) => a + d.count, 0);
  const userInputs = {};

  if (!view.dataset.numBound) {
    view.dataset.numBound = '1';
    view.addEventListener('click', e => {
      const cell = e.target.closest('.grow-num');
      if (!cell) return;
      // 点击任意数字：全部一起在「缩写(w) / 完整」间切换（状态持久化，切换 tab 不重置）
      growNumFull = !growNumFull;
      render();
    });
  }

  function numCell(n) {
    const full = String(n);
    const short = n >= 10000 ? (n / 10000).toFixed(2) + 'w' : full;
    return '<td class="grow-num" data-full="' + full + '" data-short="' + short + '">' + (growNumFull ? full : short) + '</td>';
  }

  function render() {
    const head = qizangSubMode === 'overview'
      ? '<th>名称</th><th>参考数量</th><th>单个星声</th><th>合计星声</th>'
      : '<th>名称</th><th>已有</th><th>缺少</th><th>星声差</th>';
    const effUser = (d) => {
      const raw = userInputs[d.name];
      const fromInput = (raw !== undefined && raw !== null && String(raw).trim() !== '') ? Math.max(0, parseInt(raw, 10) || 0) : null;
      if (fromInput != null) return fromInput;
      const synced = cachedTreasure && cachedTreasure[d.name] != null ? cachedTreasure[d.name] : null;
      return synced != null ? synced : 0;
    };
    const body = DATA.map(d => {
      if (qizangSubMode === 'overview') {
        return '<tr><td class="grow-name">' + d.name + '</td><td class="grow-qty">' + d.count + '</td><td class="grow-qty">' + d.unit + '</td>' + numCell(d.total) + '</tr>';
      }
      const user = effUser(d);
      const lack = Math.max(0, d.count - user);
      const stars = lack * d.unit;
      return '<tr><td class="grow-name">' + d.name + '</td>'
        + '<td><input class="grow-input" type="number" min="0" data-name="' + d.name + '" value="' + user + '" /></td>'
        + '<td class="grow-qty cell-lack">' + lack + '</td>'
        + numCell(stars) + '</tr>';
    }).join('');
    const totalRow = qizangSubMode === 'overview'
      ? '<tr class="grow-total-row"><td>合计</td><td>' + totalCount + '</td><td class="grow-dash">—</td>' + numCell(totalStars) + '</tr>'
      : (function () {
          let su = 0, sl = 0, ss = 0;
          DATA.forEach(d => { const u = effUser(d); const l = Math.max(0, d.count - u); su += u; sl += l; ss += l * d.unit; });
          return '<tr class="grow-total-row"><td>合计</td><td>' + su + '</td><td>' + sl + '</td>' + numCell(ss) + '</tr>';
        })();
    view.innerHTML =
      '<div class="grow-card">'
      + '<div class="grow-head"><h2 class="grow-title">奇藏 · 资源收集进度</h2>'
      + '</div>'
      + '<div class="grow-table-wrap"><table class="grow-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + totalRow + '</tbody></table></div>'
      + '<p class="grow-hint">参考 v3.5 版本全收集所需资源；「差值对比」中输入你已有的数量，自动算出还差多少箱子与星声（点击数字可在缩写 / 完整间切换）。</p>'
      + '</div>';

    if (qizangSubMode === 'diff') {
      view.querySelectorAll('.grow-input').forEach(inp => {
        inp.addEventListener('input', () => {
          userInputs[inp.dataset.name] = inp.value;
          const d = DATA.find(x => x.name === inp.dataset.name);
          const user = Math.max(0, parseInt(inp.value || '0', 10) || 0);
          const lack = Math.max(0, d.count - user);
          const stars = lack * d.unit;
          const tr = inp.closest('tr');
          tr.querySelector('.cell-lack').textContent = lack;
          const tc = tr.querySelector('.grow-num');
          const tcFull = String(stars);
          const tcShort = stars >= 10000 ? (stars / 10000).toFixed(2) + 'w' : tcFull;
          tc.dataset.full = tcFull;
          tc.dataset.short = tcShort;
          tc.textContent = growNumFull ? tcFull : tcShort;
          let su = 0, sl = 0, ss = 0;
          DATA.forEach(x => { const u = effUser(x); const l = Math.max(0, x.count - u); su += u; sl += l; ss += l * x.unit; });
          const tr2 = view.querySelector('.grow-total-row');
          tr2.children[1].textContent = su;
          tr2.children[2].textContent = sl;
          const tc2 = tr2.querySelector('.grow-num');
          const tc2Full = String(ss);
          const tc2Short = ss >= 10000 ? (ss / 10000).toFixed(2) + 'w' : tc2Full;
          tc2.dataset.full = tc2Full;
          tc2.dataset.short = tc2Short;
          tc2.textContent = growNumFull ? tc2Full : tc2Short;
        });
      });
    }
  }
  window.__renderQizang = render;
  render();
}


// 复用官方鸣潮启动器本地登录态，拉取当前账号奇藏数据并填充差值对比「已有」；免 UID，自动用主账号
async function syncTreasureBoxes(target) {
  try {
    let oauthCode = _accountState.oauthCode;
    let isGlobal = _accountState.isGlobal;
    const saved = _getSavedAccount();
    if (saved && saved.oauthCode) { oauthCode = saved.oauthCode; if (saved.isGlobal != null) isGlobal = saved.isGlobal; }
    if (!oauthCode) {
      return { success: false, error: 'no account' };
    }
    const res = await window.electronAPI.invoke('get-treasure-boxes', { oauthCode, isGlobal });
    if (!res || !res.success) {
      const msg = res && res.error ? res.error : '获取奇藏数据失败';
      return { success: false, error: msg };
    }
    cachedTreasure = res.boxes || {};
    if (res.level != null) cachedLevel = res.level;
    if (typeof window.__renderQizang === 'function') window.__renderQizang();
    if (typeof window.__renderLevel === 'function') window.__renderLevel();
    return { success: true, boxes: cachedTreasure };
  } catch (e) {
    console.error('同步奇藏失败', e);
    return { success: false, error: e.message };
  }
}

/* ===== 等级视图（参考 FeibiJiubi 数据页：1-80 级经验养成表，与抽卡记录无关） ===== */
let levelSubMode = 'overview';

function renderLevelView() {
  const view = document.getElementById('view-level');
  if (!view) return;
  const LEVELS = [
    [1,400,0],[2,500,400],[3,600,900],[4,1100,1500],[5,1200,2600],[6,1300,3800],[7,1400,5100],[8,1500,6500],[9,1600,8000],[10,1600,9600],
    [11,1650,11200],[12,1650,12850],[13,1700,14500],[14,1700,16200],[15,1700,17900],[16,1750,19600],[17,1750,21350],[18,1800,23100],[19,1800,24900],[20,2300,26700],
    [21,2400,29000],[22,2500,31400],[23,2500,33900],[24,2500,36400],[25,2700,38900],[26,2900,41600],[27,3000,44500],[28,3200,47500],[29,3400,50700],[30,6500,54100],
    [31,6700,60600],[32,6800,67300],[33,7200,74100],[34,7600,81300],[35,8000,88900],[36,8400,96900],[37,9000,105300],[38,9600,114300],[39,10000,123900],[40,10200,133900],
    [41,10400,144100],[42,10600,154500],[43,10800,165100],[44,11200,175900],[45,11600,187100],[46,12000,198700],[47,12400,210700],[48,12800,223100],[49,13000,235900],[50,13100,248900],
    [51,13300,262000],[52,13500,275300],[53,13700,288800],[54,13900,302500],[55,14100,316400],[56,14300,330500],[57,14500,344800],[58,14700,359300],[59,15700,374000],[60,21600,389700],
    [61,21900,411300],[62,22300,433200],[63,23000,455500],[64,23800,478500],[65,24700,502300],[66,26100,527000],[67,27500,553100],[68,29400,580600],[69,29400,610000],[70,32400,639400],
    [71,32800,671800],[72,33500,704600],[73,34500,738100],[74,35600,772600],[75,37200,808200],[76,39100,845400],[77,41300,884500],[78,44100,925800],[79,47300,969900],[80,'—',1017200]
  ];
  const MAX = 1017200;
  let userLevel = '';
  let userExp = '';

  if (!view.dataset.numBound) {
    view.dataset.numBound = '1';
    view.addEventListener('click', e => {
      const cell = e.target.closest('.grow-num');
      if (!cell) return;
      // 点击任意数字：全部一起在「缩写(w) / 完整」间切换（状态持久化，切换 tab 不重置）
      growNumFull = !growNumFull;
      updateBody();
    });
  }

  function numCell(n) {
    if (n === '—') return '<td class="grow-num" data-full="—" data-short="—">—</td>';
    const full = String(n);
    const short = n >= 10000 ? (n / 10000).toFixed(2) + 'w' : full;
    return '<td class="grow-num" data-full="' + full + '" data-short="' + short + '">' + (growNumFull ? full : short) + '</td>';
  }

  function bodyRows() {
    if (levelSubMode === 'overview') {
      return LEVELS.map(r => {
        const lv = r[0], need = r[1], cum = r[2];
        const remain = lv === 80 ? '—' : MAX - cum;
        return '<tr><td class="grow-name">' + lv + '</td>'
          + (need === '—' ? '<td class="grow-dash">—</td>' : numCell(need))
          + numCell(cum)
          + (remain === '—' ? '<td class="grow-dash">—</td>' : numCell(remain)) + '</tr>';
      }).join('');
    }
    const hasLevel = userLevel !== '' || cachedLevel != null;
    const effLevelRaw = hasLevel ? (userLevel !== '' ? userLevel : String(cachedLevel)) : '1';
    const ul = hasLevel ? Math.max(1, Math.min(80, parseInt(effLevelRaw, 10) || 1)) : 0;
    const expCap = (ul >= 1 && ul <= 80 && LEVELS[ul - 1][1] !== '—') ? LEVELS[ul - 1][1] : 0;
    const ue = hasLevel ? Math.max(0, Math.min(expCap, parseInt(userExp || '0', 10) || 0)) : 0;
    const userCum = hasLevel ? LEVELS[ul - 1][2] + ue : 0;
    return LEVELS.map(r => {
      const lv = r[0], cum = r[2];
      const isCur = hasLevel && lv === ul;
      const toLevel = !hasLevel ? '—' : (lv <= ul ? 0 : Math.max(0, cum - userCum));
      return '<tr class="' + (isCur ? 'level-current-row' : '') + '"><td class="grow-name">' + lv + '</td>'
        + numCell(cum)
        + (lv === 80 ? '<td class="grow-dash">—</td>' : numCell(MAX - cum))
        + (toLevel === '—' ? '<td class="grow-dash">—</td>' : numCell(toLevel)) + '</tr>';
    }).join('');
  }

  function render() {
    const head = levelSubMode === 'overview'
      ? '<th>等级</th><th>下级所需</th><th>累计经验</th><th>满级还需</th>'
      : '<th>等级</th><th>累计经验</th><th>满级还需</th><th>距此等级</th>';
    const inputs = levelSubMode === 'diff'
      ? '<div class="grow-inputs">'
        + '<label class="grow-field">当前等级<input class="grow-input" type="number" min="1" max="80" id="lvl-input" value="' + (userLevel !== '' ? userLevel : (cachedLevel != null ? cachedLevel : '')) + '" placeholder="1-80" /></label>'
        + '<label class="grow-field">当前经验<input class="grow-input" type="number" min="0" id="exp-input" value="' + (userExp || '') + '" placeholder="0" /></label>'
        + '</div>'
      : '';
    view.innerHTML =
      '<div class="grow-card">'
      + '<div class="grow-head"><h2 class="grow-title">等级 · 经验养成表</h2>'
      + '</div>'
      + inputs
      + '<div class="grow-table-wrap grow-scroll"><table class="grow-table"><thead><tr>' + head + '</tr></thead><tbody class="grow-level-body">' + bodyRows() + '</tbody></table></div>'
      + '<p class="grow-hint">鸣潮 1-80 级角色养成经验参考；「差值对比」中输入当前等级与经验，自动高亮当前等级并算出到各等级还差多少经验（点击数字可切换缩写 / 完整）。</p>'
      + '</div>';

    const li = view.querySelector('#lvl-input');
    const ei = view.querySelector('#exp-input');

    // 等级限定 1-80；经验上限 = 当前等级对应的升级所需经验
    function levelCap() {
      let n = parseInt((li && li.value) ? li.value : '1', 10);
      if (isNaN(n)) n = 1;
      return Math.max(1, Math.min(80, n));
    }
    function expCapOf(lv) {
      const r = LEVELS[lv - 1];
      return (r && r[1] !== '—') ? r[1] : 0;
    }
    function syncExpInput() {
      if (!ei) return;
      const cap = expCapOf(levelCap());
      ei.max = String(cap);
      let n = parseInt(ei.value || '0', 10);
      if (isNaN(n)) n = 0;
      n = Math.max(0, Math.min(cap, n));
      ei.value = (n === 0 && ei.value !== '0') ? '' : String(n);
    }
    if (li) {
      li.addEventListener('input', () => {
        let raw = li.value;
        if (raw !== '' && !/^[0-9]+$/.test(raw)) { li.value = ''; raw = ''; }
        if (raw === '') { userLevel = ''; syncExpInput(); userExp = ei ? ei.value : ''; updateBody(); return; }
        let n = parseInt(raw, 10);
        if (n < 1) { li.value = '1'; n = 1; }
        else if (n > 80) { li.value = '80'; n = 80; }
        userLevel = String(n);
        syncExpInput();
        userExp = ei ? ei.value : '';
        updateBody();
        scrollToCurrentLevel();
      });
      li.addEventListener('blur', () => {
        if (li.value === '' || !/^[0-9]+$/.test(li.value)) {
          li.value = '1'; userLevel = '1'; syncExpInput(); userExp = ei ? ei.value : '';
          updateBody(); scrollToCurrentLevel();
        }
      });
    }
    if (ei) {
      ei.addEventListener('input', () => {
        const cap = expCapOf(levelCap());
        let raw = ei.value;
        if (raw !== '' && !/^[0-9]+$/.test(raw)) { ei.value = ''; raw = ''; }
        if (raw === '') { userExp = ''; updateBody(); return; }
        let n = parseInt(raw, 10);
        if (n < 0) { ei.value = '0'; n = 0; }
        else if (n > cap) { ei.value = String(cap); n = cap; }
        userExp = String(n);
        updateBody();
      });
    }
    syncExpInput();

    // 差值对比且有当前等级时，渲染后自动滚动到当前等级所在行
    if (levelSubMode === 'diff' && (userLevel !== '' || cachedLevel != null)) {
      requestAnimationFrame(scrollToCurrentLevel);
    }

  }
  function scrollToCurrentLevel() {
    const wrap = view.querySelector('.grow-scroll');
    const row = view.querySelector('.level-current-row');
    if (!wrap || !row) return;
    const rowRect = row.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const target = wrap.scrollTop + (rowRect.top - wrapRect.top) - (wrap.clientHeight - rowRect.height) / 2;
    wrap.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }
  function updateBody() {
    const tbody = view.querySelector('.grow-level-body');
    if (tbody) tbody.innerHTML = bodyRows();
  }
  window.__scrollToCurrentLevel = scrollToCurrentLevel;
  window.__renderLevel = render;
  render();
}

// 条形 tap 进度条专属配色（按抽数分段，略淡）：1-60 绿、61-70 黄、71-80 红
function getBarDrawColor(draws) {
  if (draws <= 60) return "#69d994"; // 绿（略淡）
  if (draws <= 70) return "#ffd96e"; // 黄（略淡）
  return "#ff8282"; // 红（略淡）
}



