/* exported categorizeRecords, calculateLastDraws, calculateDrawsBetween, calculateUpAverage,
 calculateNoDeviationRate, initRecordTooltips, getRenderedPoolTitles, recordAvatarHtml */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// eslint-disable-next-line prefer-const -- commonItems 是渲染层共享全局，声明在此，被 gachaWuwa.js 重新赋值，不能改 const
let commonItems = []; //这里是常驻

window.gachaAvatarMap = window.gachaAvatarMap || { byResourceId: {}, byName: {} };

// 根据记录返回头像 <img>，本地无对应图片时回退为星级文字
function recordAvatarHtml(record) {
    const map = window.gachaAvatarMap || { byResourceId: {}, byName: {} };
    const url = (record.resource_id !== undefined && record.resource_id !== null && record.resource_id !== ''
        ? map.byResourceId[record.resource_id]
        : undefined) || (record.name ? map.byName[record.name] : undefined) || null;
    if (url) {
        return `<img class="record-avatar q${record.quality_level}" src="${url}" alt="${escapeHtml(record.name)}">`;
    }
    const cls = record.quality_level === 5 ? 'gold' : record.quality_level === 4 ? 'purple' : 'blue';
    return `<span class="record-star ${cls}">${record.quality_level} 星</span>`;
}

// 按卡池分类记录
function categorizeRecords(records) {
    const pools = {};
    records.forEach(record => {
        if (!pools[record.card_pool_type]) {
            pools[record.card_pool_type] = [];
        }
        pools[record.card_pool_type].push(record);
    });
    return pools;
}


// 抽数计算逻辑
function calculateLastDraws(records, quality) {
    let drawCount = 0;
    for (let i = 0; i < records.length; i++) {
        if (records[i].quality_level === quality) {
            return drawCount;
        }
        drawCount++;
    }
    return drawCount;
}

// 计算平均抽卡数
function calculateDrawsBetween(records, quality) {
    const qualityRecords = records.filter(r => r.quality_level === quality);
    if (qualityRecords.length === 0) return "还没抽出五星";
    let totalDraws = 0;
    qualityRecords.forEach((record, index) => {
        const nextIndex = index + 1 < qualityRecords.length
            ? records.indexOf(qualityRecords[index + 1])
            : records.length;
        totalDraws += nextIndex - records.indexOf(record);
    });
    return totalDraws / qualityRecords.length;
}
function calculateUpAverage(records) {
    const isLimitedPoolType = (t) => {
        const k = t || '';
        return (k.startsWith('角色') || k.startsWith('武器'))
            && !k.includes('常驻') && !k.includes('新手');
    };
    const upRecords = records.filter(
        r => r.quality_level === 5
        && !isCommonItem(r.name, r.timestamp || r.time, commonItems)
        && isLimitedPoolType(r.card_pool_type)
    );
    if (upRecords.length === 0) return null;
    // 遍历UP角色，累加抽数
    let totalDraws = 0;
    upRecords.forEach((record, index) => {
        const nextIndex = index + 1 < upRecords.length
            ? records.indexOf(upRecords[index + 1]) // 下一个UP角色的索引
            : records.length; // 最后一抽的索引
        totalDraws += nextIndex - records.indexOf(record); // 当前UP角色到下一个UP角色的距离
    });
    return totalDraws / upRecords.length; // 平均UP抽数
}



// 计算不歪概率
function calculateNoDeviationRate(records) {
    const fiveStarRecords = records.filter(r => r.quality_level === 5); // 筛选五星记录

    if (!fiveStarRecords.length) return null; // 无五星记录

    // 统计「不歪」五星数：在角色活动卡池中，五星非常驻角色即视为当期UP限定角色（不歪）
    // 判定使用 isCommonItem（带加入常驻时间判断），与详情列表的「歪」标记保持一致
    let upCount = 0;
    fiveStarRecords.forEach(record => {
        const isCommon = isCommonItem(record.name, record.timestamp || record.time, commonItems);
        if (!isCommon) upCount++;
    });

    // 不歪概率 = 不歪五星数 / 五星总数
    return `${(upCount / fiveStarRecords.length * 100).toFixed(2)}`;
}


// 页面加载后加载tooltip
function initRecordTooltips() {
    let tooltip = document.querySelector('.record-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'record-tooltip';
        document.body.appendChild(tooltip);
    }
    // 事件委托：详情页数据条(.record)、卡片视图头像(.char-avatar-wrap)、列表视图头像(.bar-avatar-wrap) 统一显示获取时间
    if (window.__recordTooltipBound) return;
    window.__recordTooltipBound = true;
    document.addEventListener('mouseover', e => {
        const el = e.target.closest('.record, .char-avatar-wrap, .bar-avatar-wrap');
        if (!el) return;
        // 头像元素(.char-avatar-wrap/.bar-avatar-wrap)自身无 data-time，向上找最近带 data-time 的父级（角色卡/列表行/记录条）
        const timeEl = el.dataset.time ? el : el.closest('[data-time]');
        const time = timeEl ? timeEl.dataset.time : '';
        if (!time) { tooltip.style.opacity = '0'; return; }
        tooltip.innerHTML = '<div class="tooltip-body"><p><strong>获取时间：</strong>' + time + '</p></div>';
        tooltip.style.opacity = '1';
    });
    document.addEventListener('mousemove', e => {
        const el = e.target.closest('.record, .char-avatar-wrap, .bar-avatar-wrap');
        if (!el) return;
        const offset = 14;
        tooltip.style.left = (e.pageX + offset) + 'px';
        tooltip.style.top = (e.pageY + offset) + 'px';
    });
    document.addEventListener('mouseout', e => {
        const el = e.target.closest('.record, .char-avatar-wrap, .bar-avatar-wrap');
        if (el && !el.contains(e.relatedTarget)) {
            tooltip.style.opacity = '0';
        }
    });
}

async function getRenderedPoolTitles() {
  const uid = document.querySelector('.selected-display')?.textContent?.trim();
  if (!uid || uid === '请先刷新数据') return [];
  let records = [];
  try { records = await window.electronAPI.getGachaRecords() || []; } catch (e) { records = []; }
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
  const present = new Set(records.filter(r => String(r.player_id) === String(uid)).map(r => r.card_pool_type));
  const ordered = POOL_ORDER.filter(k => present.has(k));
  const extra = [...present].filter(k => !POOL_ORDER.includes(k));
  return ordered.concat(extra).map(k => ({ key: k, title: titleMap[k] || k }));
}

// 判断一个物品在特定抽卡时间点是否算作常驻
function isCommonItem(name, timestamp, commonItemsList) {
    if (!timestamp) return false;

    // 统一将"YYYY-MM-DD HH:mm:ss"替换为标准 ISO 格式以便正确转换时间戳
    const pullTime = new Date(String(timestamp).replace(' ', 'T')).getTime();

    return commonItemsList.some(item => {
        if (typeof item === 'string') {
            return item === name;
        }
        else if (typeof item === 'object' && item.name === name) {
            const addedTime = new Date(item.addedTime.replace(' ', 'T')).getTime();
            // 只有抽卡时间 >= 加入常驻的时间，才算常驻（算歪）
            return pullTime >= addedTime;
        }
        return false;
    });
}
