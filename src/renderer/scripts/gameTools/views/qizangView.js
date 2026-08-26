/* exported renderQizangView */
/* =====================================================================
 * 奇藏视图 render（奇藏计算）
 * 依赖 gachaWuwa.js 声明的全局状态：growNumFull（数字缩写/完整）、
 * qizangSubMode（总览/差值对比）、cachedTreasure（同步的「已有」数据）。
 * 由 gachaWuwa.js 的 loadGachaRecords / switchAnalysisView 调用，
 * 并把内部 render 暴露为 window.__renderQizang 供 Tab 切换与数据同步刷新。
 * ===================================================================== */

function renderQizangView() {
  const view = document.getElementById('view-qizang');
  if (!view) return;
  const DATA = [
    { name: '朴素', count: 956, unit: 5 },
    { name: '基准', count: 1083, unit: 10 },
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
    // 用户已操作过该输入框（含清空成空串）一律按输入解析：空串 → 0；未操作过则回退同步值 / 0
    const effUser = (d) => {
      const raw = userInputs[d.name];
      if (raw !== undefined && raw !== null) return Math.max(0, parseInt(raw, 10) || 0);
      const synced = cachedTreasure && cachedTreasure[d.name] != null ? cachedTreasure[d.name] : null;
      return synced != null ? synced : 0;
    };
    const body = DATA.map(d => {
      if (qizangSubMode === 'overview') {
        return '<tr><td class="grow-name">' + d.name + '</td><td class="grow-qty">' + d.count + '</td><td class="grow-qty">' + d.unit + '</td>' + numCell(d.total) + '</tr>';
      }
      const user = effUser(d);
      const lack = Math.max(0, d.count - user);
      const stars = Math.max(0, d.count - user) * d.unit;
      return '<tr><td class="grow-name">' + d.name + '</td>'
        + '<td><input class="grow-input" type="number" min="0" max="999999" maxlength="6" inputmode="numeric" data-name="' + d.name + '" value="' + (user || '') + '" /></td>'
        + '<td class="grow-qty cell-lack">' + lack + '</td>'
        + numCell(stars) + '</tr>';
    }).join('');
    const totalRow = qizangSubMode === 'overview'
      ? '<tr class="grow-total-row"><td>合计</td><td>' + totalCount + '</td><td class="grow-dash">—</td>' + numCell(totalStars) + '</tr>'
      : (function () {
          let su = 0, sl = 0, ss = 0;
          DATA.forEach(d => {
            const u = effUser(d); const l = Math.max(0, d.count - u); su += u; sl += l; ss += l * d.unit;
          });
          return '<tr class="grow-total-row"><td>合计</td><td>' + su + '</td><td>' + sl + '</td>' + numCell(ss) + '</tr>';
        })();
    const html = '<div class="grow-card">'
      + '<div class="grow-head"><h2 class="grow-title">奇藏 · 资源收集进度</h2>'
      + '</div>'
      + '<div class="grow-table-wrap"><table class="grow-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + totalRow + '</tbody></table></div>'
      + '<p class="grow-hint">参考 v3.6 上版本全收集所需资源；「差值对比」中输入你已有的数量，自动算出还差多少箱子与星声（点击数字可在缩写 / 完整间切换）。</p>'
      + '</div>';
    // 内容未变则跳过重建（避免整表 innerHTML 重置导致的闪烁）。
    // 快照绑定到 view 元素本身：DOM 重建（页面整页切换）后是新元素、无旧快照，必会正常渲染；
    // 仅同一元素的重复渲染（如后台同步）在内容一致时跳过，杜绝「表格消失」。
    if (html === view._qizangLastHtml) return;
    view._qizangLastHtml = html;
    view.innerHTML = html;

    if (qizangSubMode === 'diff') {
      view.querySelectorAll('.grow-input').forEach(inp => {
        inp.addEventListener('input', () => {
          // 仅允许纯数字、最多 6 位（已有输入框）
          inp.value = inp.value.replace(/\D/g, '').slice(0, 6);
          userInputs[inp.dataset.name] = inp.value;
          const d = DATA.find(x => x.name === inp.dataset.name);
          // 清空输入框（空串）→ 已有按 0 计算，缺少/星声差按满额显示，不再显示空白占位（—）
          const user = Math.max(0, parseInt(inp.value, 10) || 0);
          const lack = Math.max(0, d.count - user);
          const stars = Math.max(0, d.count - user) * d.unit;
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
