// 全局错误捕获：记录未被 try/catch 覆盖的异常，便于排查（仅一次绑定）
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

// 加载玩家 UID 下拉列表
async function loadPlayerUIDs(defaultUid) {
    const players = await window.electronAPI.getPlayerUIDs(); // 从数据库获取所有 UID
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
        deleteBtn.addEventListener('click', (event) => {
            event.stopPropagation(); // 阻止事件冒泡到 option 上，避免同时触发选中
            // 打开自定义二次确认弹窗（替代原生 confirm，风格与全局 modal 统一）
            _pendingDeleteUid = uid;
            const textEl = document.getElementById('deleteUidText');
            if (textEl) textEl.innerHTML = '确定要删除 UID <strong>' + uid + '</strong> 的所有记录吗？';
            const modal = document.getElementById('deleteUidModal');
            if (modal) {
                if (typeof openModal === 'function') openModal(modal);
                else modal.style.display = 'flex';
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

// 待删除确认的 UID（由删除确认弹窗暂存，确认后才执行）
let _pendingDeleteUid = null;

// 删除 UID 记录的二次确认弹窗初始化：绑定确认/取消/关闭，仅绑一次
// （整页切换 DOM 重建后为新元素，dataset.bound 自动重置，属于新增的删除按钮每次动态重建）
function initDeleteUidModal() {
    const modal = document.getElementById('deleteUidModal');
    if (!modal || modal.dataset.bound) return;
    modal.dataset.bound = '1';
    const confirmBtn = document.getElementById('deleteUidConfirm');
    const cancelBtn = document.getElementById('deleteUidCancel');
    const closeBtn = document.getElementById('closeDeleteUidModal');
    const close = () => {
        _pendingDeleteUid = null;
        if (typeof closeModal === 'function') closeModal(modal);
        else modal.style.display = 'none';
    };
    if (confirmBtn) confirmBtn.addEventListener('click', async () => {
        const uid = _pendingDeleteUid;
        close();
        if (uid != null) await _runDeleteUid(uid);
    });
    if (cancelBtn) cancelBtn.addEventListener('click', close);
    if (closeBtn) closeBtn.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
}

// 执行 UID 记录删除：调用主进程删除，并刷新下拉框与当前账号记录
async function _runDeleteUid(uid) {
    try {
        await window.electronAPI.invoke('delete-gacha-records', uid);
        // 清除已删除账号的持久化选中，避免下次打开仍记住已不存在的账号
        try { await window.electronAPI.setLastQueryUid(''); } catch (e) {}
        const lastUid = await window.electronAPI.getLastQueryUid();
        await loadPlayerUIDs(lastUid); // 加载玩家 UID 下拉框
        await loadGachaRecords(lastUid); // 加载对应记录
        animationMessage(true, `成功删除 UID: ${uid} 的记录`);
    } catch (error) {
        animationMessage(false, `删除失败: ${error.message}`);
    }
}

// 加载唤取记录
let gachaLoadToken = 0; // 切换账号并发保护：仅最新一次加载允许写 DOM，避免旧账号数据覆盖新账号
// 分析子视图记忆：记住用户上次所在的视图（条形/卡片/详情），重启后恢复，不再每次回到条形
const _VIEW_PREF_KEY = 'wuwa_analysis_view';
function _loadViewPref() { try { const v = localStorage.getItem(_VIEW_PREF_KEY); return ['bar', 'intuitive', 'detail'].includes(v) ? v : 'bar'; } catch (e) { return 'bar'; } }
function _saveViewPref(view) { if (['bar', 'intuitive', 'detail'].includes(view)) { try { localStorage.setItem(_VIEW_PREF_KEY, view); } catch (e) {} } }
let currentAnalysisView = _loadViewPref(); // 当前分析子视图（条形/卡片/详情/奇藏/等级）单一可信来源，默认进入条形视图
let cachedTreasure = null; // 当前账号奇藏数据（朴素/基准/精密/辉光/潮汐绿/紫/金），由 syncTreasureBoxes 填充，用于差值对比「已有」自动显示
let cachedLevel = null; // eslint-disable-line no-unused-vars -- 由奇藏同步 syncTreasureBoxes 赋值为 window 级共享状态，等级视图通过 cachedLevel 间接读取，ESLint 仅在本文件看不到读取
const _accountState = { oauthCode: null, isGlobal: null };
let _skipAutoSync = false; // 启动期置位：bindAccountCard 自动选中时不各自同步，由 gachaWuwaInit 统一同步一次
let _treasureSynced = false; // 奇藏/等级是否已同步成功（冷启动同步失败时，切到奇藏/等级视图自动重试一次）
const _resolvedUidMap = {}; // oauthCode -> 游戏内 UID，由奇藏同步实证回填，优先于下拉框在线解析
function _getSavedAccount() { try { return JSON.parse(localStorage.getItem('wuwa_account') || 'null'); } catch { return null; } }
function _saveAccount(a) { try { localStorage.setItem('wuwa_account', JSON.stringify(a)); } catch {} }
// 奇藏/等级/UID 的本地缓存：上次成功同步的结果按 oauthCode 持久化，
// 用于「打开程序即解析好」——启动瞬间命中缓存填充，后台再静默刷新校验
const _TREASURE_CACHE_KEY = 'wuwa_treasure_cache';
function _loadTreasureCache() { try { return JSON.parse(localStorage.getItem(_TREASURE_CACHE_KEY) || '{}'); } catch { return {}; } }
function _saveTreasureCache(oauthCode, boxes, level, uid) {
  if (!oauthCode) return;
  try {
    const all = _loadTreasureCache();
    all[oauthCode] = { boxes: boxes || {}, level: level != null ? level : undefined, uid: uid != null ? String(uid) : undefined, ts: Date.now() };
    localStorage.setItem(_TREASURE_CACHE_KEY, JSON.stringify(all));
  } catch (e) {}
}
function _warmTreasureFromCache() {
  const oauthCode = _accountState.oauthCode;
  if (!oauthCode) return;
  const c = _loadTreasureCache()[oauthCode];
  if (!c) return;
  if (c.boxes && typeof c.boxes === 'object') cachedTreasure = c.boxes;
  if (c.level != null) cachedLevel = c.level;
  if (c.uid != null) _resolvedUidMap[oauthCode] = String(c.uid); // 下拉框立即显示「已解析」
  // 视图若已首次渲染则立即用缓存刷新；尚未渲染时缓存值会在首次 render 时直接命中
  if (typeof window.__renderQizang === 'function') window.__renderQizang();
  if (typeof window.__renderLevel === 'function') window.__renderLevel();
}
// 立即把「UID 选项框」（#account-switch-sync，仅奇藏/等级视图显示）填充为已解析/缓存的 UID。
// 不依赖任何 IPC —— 直接从本地缓存的已解析UID / 持久化账号读取，从而从设置页整页切回时
// 右侧 UID 框即时呈现，不必等 bindAccountCard 的一串 IPC 异步返回。
function _refreshAccountDisplay() {
  const d = document.querySelector('#account-switch-sync .selected-display');
  if (!d || d.textContent !== '选择账号') return; // 已被 renderAccountSwitch 填充时不动，避免覆盖真实账号
  const saved = _getSavedAccount();
  if (!saved) return;
  let uid = null;
  if (saved.oauthCode != null && _resolvedUidMap[saved.oauthCode] != null) uid = _resolvedUidMap[saved.oauthCode];
  else if (saved.uid != null) uid = String(saved.uid);
  if (uid != null) d.textContent = uid;
}

// 下拉框显示文案：优先展示 UID（来自官方 API），离线拉不到时回退显示账号标识
function _accountLabel(a) {
  if (a && a.uid) return String(a.uid);
  return (a && (a.accountId || a.maskedPhone || a.username)) || '账号';
}

// 优先用奇藏同步回填的 UID 覆盖下拉框在线解析结果（避免 token 偶发失效回退成通行证账号）
function _effectiveUid(a) {
  if (!a) return null;
  if (a.oauthCode != null && _resolvedUidMap[a.oauthCode] != null) return _resolvedUidMap[a.oauthCode];
  return a.uid != null ? String(a.uid) : null;
}

// 复用官方鸣潮启动器本地登录态，拉取当前账号奇藏数据并填充差值对比「已有」；免 UID，自动用主账号
async function syncTreasureBoxes(target) {
  try {
    let oauthCode = _accountState.oauthCode;
    let isGlobal = _accountState.isGlobal;
    const saved = _getSavedAccount();
    if (saved && saved.oauthCode) { oauthCode = saved.oauthCode; if (saved.isGlobal != null) isGlobal = saved.isGlobal; }
    // 不再因 oauthCode 为空而直接返回：主进程 getTreasureBoxes 会在 oauthCode 缺失时
    // 自动用启动器本地登录态 getMainAccount() 定位主账号并拉取（免 UID/免 oauthCode），
    // 确保「进入程序即同步」在账号解析延迟/失败时也能可靠触发。
    const res = await window.electronAPI.invoke('get-treasure-boxes', { oauthCode: oauthCode || null, isGlobal });
    if (!res || !res.success) {
      const msg = res && res.error ? res.error : '获取奇藏数据失败';
      return { success: false, error: msg };
    }
    cachedTreasure = res.boxes || {};
    // 缓存/回填用的有效 key：优先 oauthCode，其次用主进程回传的游戏内 UID 兜底
    const key = oauthCode || (res.uid != null ? String(res.uid) : null);
    if (key) {
      if (res.uid != null) _resolvedUidMap[key] = String(res.uid); // 回填已解析 UID，供下拉框复用
      if (res.level != null) cachedLevel = res.level;
      _saveTreasureCache(key, cachedTreasure, res.level, res.uid); // 持久化，供下次打开即命中
    } else if (res.level != null) {
      cachedLevel = res.level;
    }
    if (typeof window.__renderQizang === 'function') window.__renderQizang();
    if (typeof window.__renderLevel === 'function') window.__renderLevel();
    _treasureSynced = true;
    return { success: true, boxes: cachedTreasure };
  } catch (e) {
    console.error('同步奇藏失败', e);
    return { success: false, error: e.message };
  }
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
    function setActive(idx) { activeIdx = idx; const a = accounts[idx]; display.textContent = _effectiveUid(a) || _accountLabel(a); list.querySelectorAll('.dropdown-option').forEach((it) => it.classList.toggle('active', Number(it.dataset.idx) === idx)); }
    // 每个账号右侧显示解析状态标签：已解析=有游戏内 UID；未解析=仅通行证账号标识
    let optsHtml = '';
    accounts.forEach((a, i) => {
      const resolved = !!_effectiveUid(a);
      const label = _effectiveUid(a) || _accountLabel(a);
      const badge = '<span class="option-badge ' + (resolved ? 'resolved' : 'unresolved') + '">' + (resolved ? '已解析' : '未解析') + '</span>';
      optsHtml += '<li class="dropdown-option" data-idx="' + i + '"><span class="option-label">' + label + '</span>' + badge + '</li>';
    });
    list.innerHTML = optsHtml;
    setActive(activeIdx);
    // 自动选中（匹配游戏UID或第一个账号）后立即写入选中态并拉取该账号实时奇藏/等级——
    // 无需用户手动点击，启动即自动同步当前账号数据（对齐 WutheringWavesBox 体验）
    const autoA = accounts[activeIdx];
    if (autoA) {
      _accountState.oauthCode = autoA.oauthCode;
      _accountState.isGlobal = autoA.isGlobal;
      _saveAccount({ oauthCode: autoA.oauthCode, isGlobal: autoA.isGlobal });
      // 启动期由 gachaWuwaInit 统一同步一次，此处仅在非启动期（如账号在线列表刷新）同步，避免重复拉取
      if (!_skipAutoSync) syncTreasureBoxes();
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
        _treasureSynced = false;
        syncTreasureBoxes(); // 切换账号后立即同步该账号奇藏/等级
      };
    });
  } catch (e) { containerEl.style.display = 'none'; }
}

function bindAccountCard() {
  return renderAccountSwitch(document.getElementById('account-switch-sync'));
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

    // 顶部「列表/卡片/详情」与「数据总览/差值对比」Tab 属于模板静态元素，与数据无关，
    // 必须在空数据 / 有数据两条路径下都绑定，否则无数据时 Tab 点击无响应。
    setupAnalysisTabs();

    // player_id 在 SQLite 中是 INTEGER，uid 可能是字符串（来自 dataset / String() 转换），
    // 直接用 === 会全部过滤掉导致「有数据却显示空/ 不跳转」，必须统一按字符串比较
    const uidStr = String(uid);
    const filteredRecords = records.filter(r => String(r.player_id) === uidStr);

    const prevView = currentAnalysisView; // 上次切换账号前所在的子视图（由 switchAnalysisView 维护），侧边栏 nav-item 的 data-view 恒为 intuitive，不能作为判断依据
    // 切换账号并发保护：已有更新的账号加载在途时，丢弃本次渲染，避免旧账号数据覆盖新账号
    if (myLoadToken !== gachaLoadToken) return;
    if (!filteredRecords.length) {
        container.innerHTML = `
            <div id="view-bar" class="analysis-view active"></div>
            <div id="view-intuitive" class="analysis-view"></div>
            <div id="view-detail" class="analysis-view"></div>
            <div id="view-table" class="analysis-view"></div>
            <div id="view-qizang" class="analysis-view"></div>
            <div id="view-level" class="analysis-view"></div>
        `;
        const vb = document.getElementById('view-bar');
        if (vb) vb.innerHTML = emptyStateHtml('暂无唤取数据', '选择 UID 并点击「刷新数据」导入抽卡记录', 'data');
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

    // ===== 分析视图容器（直观 / 详情 / 表格）=====
    container.innerHTML = `
        <div id="view-bar" class="analysis-view active"></div>
        <div id="view-intuitive" class="analysis-view"></div>
        <div id="view-detail" class="analysis-view"></div>
        <div id="view-table" class="analysis-view"></div>
        <div id="view-qizang" class="analysis-view"></div>
        <div id="view-level" class="analysis-view"></div>
    `;


    try { renderDetailView(filteredRecords, pools); } catch (e) { console.error('详情视图渲染失败', e); }
    window.__renderDetailView = () => renderDetailView(filteredRecords, pools); // 缓存引用，供应用隐藏卡池后重渲染详情视图
    try { renderBarView(filteredRecords, pools); } catch (e) { console.error('条形视图渲染失败', e); }
    try { renderIntuitiveView(filteredRecords, pools); } catch (e) { console.error('直观视图渲染失败', e); }
    try { renderTableView(filteredRecords); } catch (e) { console.error('表格视图渲染失败', e); }
    try { renderQizangView(); } catch (e) { console.error('奇藏视图渲染失败', e); }
    try { renderLevelView(); } catch (e) { console.error('等级视图渲染失败', e); }

    // 重渲染后保留用户当前所在 tab（模板默认回到「统计」）
    if (typeof window.switchAnalysisView === 'function') window.switchAnalysisView(prevView);

 } catch (e) {
    console.error('[loadGachaRecords] 渲染过程中发生未捕获异常，已降级保护：', e);
 }
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

/* =====================================================================
 * 快捷键：Ctrl+1/2/3 切换分析视图 · Ctrl+S 打开设置 · Ctrl+T 切换主题 · Ctrl+R 刷新数据
 * 仅在抽卡分析页处于活动状态（#record-display 存在）时响应，避免误触发。
 * ===================================================================== */
function initShortcuts() {
    if (window.__gachaShortcutBound) return;
    window.__gachaShortcutBound = true;
    window.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        if (!document.getElementById('record-display')) return; // 仅在 gameTools 页生效
        const k = (e.key || '').toLowerCase();
        if (k === '1') { e.preventDefault(); switchAnalysisView('bar'); return; }
        if (k === '2') { e.preventDefault(); switchAnalysisView('intuitive'); return; }
        if (k === '3') { e.preventDefault(); switchAnalysisView('detail'); return; }
        if (k === 's') {
            e.preventDefault();
            const sb = document.querySelector('.sidebar-settings');
            if (sb && typeof sb.click === 'function') sb.click();
            return;
        }
        if (k === 't') {
            e.preventDefault();
            const tb = document.getElementById('sidebar-theme-toggle');
            if (tb && typeof tb.click === 'function') tb.click();
            return;
        }
        if (k === 'r') {
            e.preventDefault();
            loadGachaRecords(currentUid); // 重新拉取当前账号记录并渲染
        }
    });
}


// 监听 UID 切换
async function gachaWuwaInit() {
    // 从设置页等整页切换而来时消费目标子视图（qizang/level/bar/…），
    // 让 loadGachaRecords 直接渲染目标视图，避免 renderer.js 在数据就绪前
    // 提前 switchAnalysisView 导致重复初始化与重复的奇藏同步
    if (window.__pendingView && typeof window.switchAnalysisView === 'function') {
        currentAnalysisView = window.__pendingView;
        window.__pendingView = null;
    }
    // 尽早用本地持久化账号命中奇藏缓存：让首次渲染（loadGachaRecords 内的 renderQizang / renderLevel）
    // 即刻显示上次的「已有」数据，同时把右侧 UID 框填充为已解析 UID —— 都无需等待网络/多段 IPC，
    // 从而从设置页整页切回时右侧 UID 框即时呈现，避免停顿。后台后续会静默同步校验纠偏。
    const initSaved = _getSavedAccount();
    if (initSaved && initSaved.oauthCode != null) {
        _accountState.oauthCode = initSaved.oauthCode;
        _accountState.isGlobal = initSaved.isGlobal != null ? initSaved.isGlobal : _accountState.isGlobal;
    }
    _warmTreasureFromCache(); // 填充 cachedTreasure/cachedLevel/_resolvedUidMap（视图未建时 __renderQizang 为空跳过，值仍生效）
    _refreshAccountDisplay(); // 立即填充#account-switch-sync 的 UID 显示
    const lastUid = await window.electronAPI.getLastQueryUid();
    await loadPlayerUIDs(lastUid); // 加载玩家 UID 下拉框
    await loadGachaRecords(lastUid); // 加载对应记录
    initScrollLogic(); // 初始化滚动逻辑
    initRecordTooltips();
    initSettingsMenu();
    initDeleteUidModal(); // 删除 UID 的二次确认弹窗
    initShortcuts();         // 快捷键：Ctrl+1/2/3/S/T/R

    // 主题切换时重绘条形进度条颜色（深/浅色配色不同），仅注册一次
    if (!window.__barThemeBound) {
        window.__barThemeBound = true;
        window.addEventListener('theme-mode-changed', () => {
            if (typeof refreshBarFillColors === 'function') refreshBarFillColors();
        });
    }

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

            // 持久化用户主动选择的 UID，重启后恢复到此账号
            try { await window.electronAPI.setLastQueryUid(selectedUid); } catch (e) {}

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

    // 解析主账号（免启动器 / 免 UID），并自动同步奇藏/等级。
    // 进入程序时同步刷新 UID 解析与奇藏/等级数据：
    //  1) _skipAutoSync 标志让 bindAccountCard 自动选中期间不各自同步，避免启动重复拉取；
    //  2) await bindAccountCard 确保账号自动选中完成（写对 oauthCode/localStorage）后再统一同步，
    //     使进入程序时同步的一定是当前账号，且即使账号解析失败主进程也能免 oauthCode 兜底拉取。
    await resolveMainAccount();
    _skipAutoSync = true;
    await bindAccountCard(); // 先确定最终账号（写入 oauthCode），再统一同步
    _skipAutoSync = false;
    _warmTreasureFromCache(); // 用已确定的 oauthCode 命中缓存，立即显示上次的奇藏/等级/UID
    _refreshAccountDisplay(); // 兜底：若 bindAccountCard 尚未填充 UID 显示，这里补一次即时呈现
    // 网络同步放到后台静默执行（不 await，不阻塞 init 收尾）：
    // 切换的「即时呈现」已由顶部温暖缓存 + warm cache 完成，这里只在后台拉最新数据并纠偏，
    // 对用户无感知刷新，消除从设置页整页切回时的可见停顿。
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
  const hiddenPools = _readHiddenPools();

  // 重置列表
  list.innerHTML = '';
  allHideOptions.forEach(name => {
    const item = document.createElement('div');
    item.className = 'pool-row';
    item.dataset.pool = name.key;
    const label = document.createElement('span'); label.className = 'pool-name'; label.textContent = name.title;
    const check = document.createElement('span'); check.className = 'pool-check';
    item.appendChild(label); item.appendChild(check);
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

// eslint-disable-next-line no-unused-vars, prefer-const -- tableState 是渲染层共享全局（分页/分页大小/卡池筛选），声明在此，由 tableView.js 读写；在 gachaWuwa.js 仅一处赋值，保留 let 以便跨文件重新赋值结构字段
let tableState = {
    page: 1,
    pageSize: (function () { try { return parseInt(localStorage.getItem('wuwa_table_page_size') || '50', 10) || 50; } catch (e) { return 50; } })(),
    pool: null,
    totalPages: 1
};

// eslint-disable-next-line prefer-const -- lastIntuitiveData 在此文件声明为共享全局，由 views/intuitiveView.js:15 重新赋值，不能改为 const
let lastIntuitiveData = null;




/* ---------- 总览 Tab 切换 ---------- */
function switchAnalysisView(view) {
    // 侧边栏“分析”进入：恢复到上次离开分析页时的子视图（条形/卡片/详情），
    // 持久化值仅含分析子视图，不会被子页（奇藏/等级）覆盖，切走再切回也能保持
    if (view === 'analysis') {
        view = _loadViewPref();
    }
    currentAnalysisView = view; // 维护当前子视图单一可信来源，供切换账号/切回分析后恢复
    _saveViewPref(view); // 持久化用户当前分析视图，重启后恢复
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
        tabbar.querySelectorAll('.analysis-tab').forEach(t => {
            const on = t.dataset.view === view;
            t.classList.toggle('active', on);
            if (t.getAttribute('role') === 'tab') t.setAttribute('aria-selected', String(on));
        });
    }
    const subTabbar = document.getElementById('sub-view-row');
    if (subTabbar) {
        const showSub = (view === 'qizang' || view === 'level');
        subTabbar.style.display = showSub ? '' : 'none';
        if (showSub) {
            // 冷启动时启动同步可能失败（启动器登录态未就绪）：切到奇藏/等级时若尚未同步成功，
            // 主动重新解析账号（刷新 oauthCode）并同步，确保用户切过来即可看到数据。
            // 必须重跑 resolveMainAccount + bindAccountCard，否则用陈旧的 oauthCode 重试仍会失败
            // （切设置页能成功正是因为脚本重载后重新解析了账号）。
            if (typeof syncTreasureBoxes === 'function' && !_treasureSynced) {
                (async () => {
                    try { await resolveMainAccount(); } catch (e) {}
                    try { await bindAccountCard(); } catch (e) {}
                    // bindAccountCard 内部（_skipAutoSync=false）已触发 syncTreasureBoxes；
                    // 若账号解析后仍未同步成功，再兜底触发一次
                    if (!_treasureSynced && typeof syncTreasureBoxes === 'function') syncTreasureBoxes();
                })();
            }
            const cur = (view === 'qizang') ? qizangSubMode : levelSubMode;
            subTabbar.querySelectorAll('.analysis-tab').forEach(t => {
                const on = t.dataset.mode === cur;
                t.classList.toggle('active', on);
                if (t.getAttribute('role') === 'tab') t.setAttribute('aria-selected', String(on));
            });
        }
    }
}
window.switchAnalysisView = switchAnalysisView;

/* 导航已迁移至左侧边栏（index.html），由 renderer.js 统一绑定与页面切换 */
// 幂等保护：脚本只在首次加载时执行一次，但切走再切回游戏工具页时 gameTools.html
// 会被重新注入 DOM（renderer.js fetch 后插入 #content），新 DOM 元素必须重新绑定。
// 因此以“当前 DOM 元素是否已标记”为准（dataset 随元素重建而重置），而不是模块级布尔。
function setupAnalysisTabs() {
    const tabbar = document.getElementById('analysis-tabbar');
    const subTabbar = document.getElementById('sub-view-tabbar');
    // 两个 tabbar 任一尚不存在（如模板未注入）时先跳过，等待下次加载再绑定
    if (!tabbar || !subTabbar) return;
    // 同一 DOM 元素只绑一次，避免同页内多次调用（账号切换等）产生重复监听
    if (tabbar.dataset.tabsBound) return;
    tabbar.dataset.tabsBound = 'true';
    tabbar.querySelectorAll('.analysis-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const view = tab.dataset.view;
            tabbar.querySelectorAll('.analysis-tab').forEach(t => {
                const on = t === tab;
                t.classList.toggle('active', on);
                if (t.getAttribute('role') === 'tab') t.setAttribute('aria-selected', String(on));
            });
            if (typeof window.switchAnalysisView === 'function') {
                window.switchAnalysisView(view);
            }
        });
    });
    subTabbar.querySelectorAll('.analysis-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const mode = tab.dataset.mode;
            const isQizang = document.getElementById('view-qizang').classList.contains('active');
            if (isQizang) { qizangSubMode = mode; } else { levelSubMode = mode; }
            subTabbar.querySelectorAll('.analysis-tab').forEach(t => {
                const on = t === tab;
                t.classList.toggle('active', on);
                if (t.getAttribute('role') === 'tab') t.setAttribute('aria-selected', String(on));
            });
            if (isQizang) { if (typeof window.__renderQizang === 'function') window.__renderQizang(); }
            else { if (typeof window.__renderLevel === 'function') window.__renderLevel(); }
        });
    });
}


// eslint-disable-next-line no-unused-vars, prefer-const -- growNumFull 共享全局（奇藏/等级视图切换数字缩写），声明在此，被 qizangView.js:32 / levelView.js:32 重新赋值
let growNumFull = true; // 数字 缩写(w)/完整 全局切换状态（奇藏/等级共用，切换 tab 不重置）
let qizangSubMode = 'overview';



/* ===== 等级视图（参考 FeibiJiubi 数据页：1-80 级经验养成表，与抽卡记录无关） ===== */
let levelSubMode = 'overview';

