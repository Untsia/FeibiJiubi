/* exported renderLevelView */
/* =====================================================================
 * 等级视图 render（等级计算）
 * 依赖 gachaWuwa.js 声明的全局状态：growNumFull（数字缩写/完整）、
 * levelSubMode（总览/差值对比）、cachedLevel（同步的当前等级）。
 * 由 gachaWuwa.js 的 loadGachaRecords / switchAnalysisView 调用，
 * 并把内部 render 暴露为 window.__renderLevel 供 Tab 切换与数据同步刷新。
 * ===================================================================== */

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
      ? '<div class="grow-inputs grow-inputs-inline">'
        + '<label class="grow-field">当前等级<input class="grow-input" type="number" min="1" max="80" id="lvl-input" value="' + (userLevel !== '' ? userLevel : (cachedLevel != null ? cachedLevel : '')) + '" placeholder="1-80" /></label>'
        + '<label class="grow-field">当前经验<input class="grow-input" type="number" min="0" id="exp-input" value="' + (userExp || '') + '" placeholder="0" /></label>'
        + '</div>'
      : '';
    const html = '<div class="grow-card">'
      + '<div class="grow-head"><h2 class="grow-title">等级 · 经验养成表</h2>'
      + inputs
      + '</div>'
      + '<div class="grow-table-wrap grow-scroll"><table class="grow-table"><thead><tr>' + head + '</tr></thead><tbody class="grow-level-body">' + bodyRows() + '</tbody></table></div>'
      + '<p class="grow-hint">鸣潮 1-80 级角色养成经验参考；「差值对比」中输入当前等级与经验，自动高亮当前等级并算出到各等级还差多少经验（点击数字可切换缩写 / 完整）。</p>'
      + '</div>';
    // 内容未变则跳过重建（避免整表 innerHTML 重置导致的闪烁）。
    // 快照绑定到 view 元素本身：DOM 重建（页面整页切换）后是新元素、无旧快照，必会正常渲染；
    // 仅同一元素的重复渲染（如后台同步）在内容一致时跳过，杜绝「表格消失」。
    if (html === view._levelLastHtml) return;
    view._levelLastHtml = html;
    view.innerHTML = html;

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
