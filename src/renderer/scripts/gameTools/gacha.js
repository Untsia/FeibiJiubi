function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

// 判断是否为歪
function isOffBanners(record, commonItems) {
    const validPools = [
        "角色活动唤取", "武器活动唤取", "角色联动唤取", "武器联动唤取",
        "角色新旅唤取", "武器新旅唤取", "角色忆旅唤取", "武器忆旅唤取", "角色常驻唤取", "武器常驻唤取", "新手限定唤取", "新手自选唤取", "感恩定向唤取"
    ];

    if (!validPools.includes(record.card_pool_type)) return false;
    return isCommonItem(record.name, record.timestamp || record.time, commonItems);
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

function calculateMostDraws(records, quality) {
    const qualityRecords = records.filter(r => r.quality_level === quality);
    if (qualityRecords.length === 0) return "暂未抽出五星";

    let maxDraws = 0;
    let minDraws = Number.MAX_VALUE;

    qualityRecords.forEach((record, index) => {
        const nextIndex = index + 1 < qualityRecords.length
            ? records.indexOf(qualityRecords[index + 1])
            : records.length;

        const draws = nextIndex - records.indexOf(record);
        maxDraws = Math.max(maxDraws, draws);
        minDraws = Math.min(minDraws, draws);
    });

    return { maxDraws, minDraws };
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
    const upRecords = records.filter(
        r => r.quality_level === 5
        && !isCommonItem(r.name, r.timestamp || r.time, commonItems)
        && (r.card_pool_type === "角色活动唤取" || r.card_pool_type === "角色联动唤取"
            || r.card_pool_type === "角色新旅唤取" || r.card_pool_type === "角色忆旅唤取")
    );
    if (upRecords.length === 0) return "还没抽出UP";
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



// 生成概览和详细列表
function generateOverview(records) {
    const fiveStarRecords = records.filter(r => r.quality_level === 5);

    return fiveStarRecords.map((record, index) => {
        const nextIndex = index + 1 < fiveStarRecords.length
            ? records.indexOf(fiveStarRecords[index + 1])
            : records.length;

        const draws = nextIndex - records.indexOf(record);
        const color = getDrawColor(draws, record.quality_level);
        const isOffBanner = isOffBanners(record, commonItems);
        return `
            <div class="record"
                data-name="${record.name}"
                data-time="${record.timestamp || '未知时间'}"
                data-draws="${draws}"
                data-color="${getColorByQuality(record.quality_level)}"
                data-offbanner="${isOffBanner ? 'true' : 'false'}">
                ${recordAvatarHtml(record)}
                <span class="record-name" style="color: ${getColorByQuality(record.quality_level)};">${record.name}</span>
                <span class="record-draws-with-off-banner">
                    ${isOffBanner ? `<span class="record-off-banner" title="常驻角色">歪</span>` : ""}
                    <span class="record-draws" style="color: ${color};">${draws} 抽</span>
                </span>
            </div>
        `;
    }).join('');
}
function generateDetails(records) {
    const groupedRecords = groupRecordsByDate(records);
    const fiveStarRecords = records.filter(r => r.quality_level === 5);
    const fourStarRecords = records.filter(r => r.quality_level === 4);

    return Object.keys(groupedRecords).map(date => {
        const recordsForDate = groupedRecords[date];
        return `
            <div class="record-date-group">
                <div class="record-date">${date}</div>
                ${recordsForDate.map(record => {
                    let draws = '';
                    if (record.quality_level === 5) {
                        const currentIndex = records.indexOf(record);
                        const nextIndex = fiveStarRecords.find(r => records.indexOf(r) > currentIndex);
                        draws = nextIndex ? records.indexOf(nextIndex) - currentIndex : records.length - currentIndex;
                    } else if (record.quality_level === 4) {
                        const currentIndex = records.indexOf(record);
                        const nextIndex = fourStarRecords.find(r => records.indexOf(r) > currentIndex);
                        draws = nextIndex ? records.indexOf(nextIndex) - currentIndex : records.length - currentIndex;
                    }

                    const color = getDrawColor(draws, record.quality_level);
                    const isOffBanner = isOffBanners(record, commonItems);

                    return `
                        <div class="record"
                            data-name="${record.name}"
                            data-time="${record.timestamp || '未知时间'}"
                            data-draws="${draws || '-'}"
                            data-color="${getColorByQuality(record.quality_level)}"
                            data-offbanner="${isOffBanner ? 'true' : 'false'}">
                            ${recordAvatarHtml(record)}
                            <span class="record-name" style="color: ${getColorByQuality(record.quality_level)};">
                                ${record.name}
                            </span>
                            ${draws ? `
                                <span class="record-draws-with-off-banner">
                                    ${isOffBanner ? `<span class="record-off-banner" title="常驻角色">歪</span>` : ""}
                                    <span class="record-draws" style="color: ${color};">${draws} 抽</span>
                                </span>` : ""}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }).join('');
}



// 分组逻辑
function groupRecordsByDate(records) {
    return records.reduce((grouped, record) => {
        const date = record.timestamp.split(' ')[0]; // 提取日期部分
        if (!grouped[date]) grouped[date] = [];
        grouped[date].push(record);
        return grouped;
    }, {});
}


// 辅助函数
// 根据抽数和质量获取颜色（统一极光玻璃语义色：近欧皇=青、平稳=紫、非酋=玫红）
function getDrawColor(draws, quality) {
    if (quality === 5) {
        if (draws <= 35) return '#5fd6a0'; // 青绿
        if (draws <= 67) return '#9d7bff'; // 紫罗兰
        return '#ff8585'; // 玫红
    }
    if (quality === 4) {
        if (draws <= 3) return '#5fd6a0'; // 青绿
        if (draws <= 7) return '#9d7bff'; // 紫罗兰
        return '#ff8585'; // 玫红
    }
    return '#8a90a6'; // 默认灰
}


// 根据五星平均抽数返回评价
function getRating(avg, avgUpText = null) {
    // 检查数据有效性
    if (avg === "无数据") return "无数据";
    if (avgUpText === "无数据" || avgUpText === null) {
        if (avg <= 15) return "万里挑一至尊欧皇";
        if (avg <= 30) return "万里挑一欧皇";
        if (avg <= 55) return "尊贵欧皇";
        if (avg <= 60) return "薛定谔的欧皇";
        if (avg <= 68) return "欧非守恒";
        if (avg <= 71) return "薛定谔的非酋";
        if (avg <= 73) return "绝世非酋";
        if (avg <= 75) return "万里挑一非酋";
        return "万里挑一绝世非酋";
    }
    // 如果有数据，则以平均up数判断欧非
    if (avgUpText <= 20) return "万里挑一至臻欧皇";
    if (avgUpText <= 35) return "万里挑一至尊欧皇";
    if (avgUpText <= 45) return "万里挑一欧皇";
    if (avgUpText <= 55) return "至臻欧皇";
    if (avgUpText <= 75) return "至尊欧皇";
    if (avgUpText <= 85) return "薛定谔的欧皇";
    if (avgUpText <= 95) return "欧非守恒";
    if (avgUpText <= 115) return "薛定谔的非酋";
    if (avgUpText <= 125) return "绝世非酋";
    if (avgUpText <= 135) return "万里挑一非酋";
    return "万里挑一绝世非酋";
}

function getColorByQuality(quality) {
    if (quality === 5) return '#f4d588';
    if (quality === 4) return '#c3b0ff';
    return '#7fa6ff';
}


// 生成图表
function renderPieChart(records, poolType) {
    const chartId = `star-pie-chart-${poolType}`;
    const canvas = document.getElementById(chartId);
    if (!canvas) {
        console.error(`Canvas with id ${chartId} not found.`);
        return;
    }

    const ctx = canvas.getContext("2d");

    // 统计星级分布
    const starCounts = {
        "五星": records.filter(r => r.quality_level === 5).length,
        "四星": records.filter(r => r.quality_level === 4).length,
        "三星": records.filter(r => r.quality_level === 3).length,
    };

    // 创建图表数据对象
    const chartData = {
        labels: Object.keys(starCounts),
        datasets: [
            {
                data: Object.values(starCounts),
                backgroundColor: ["rgba(244, 213, 136, 0.85)", "rgba(195, 176, 255, 0.85)", "rgba(127, 166, 255, 0.85)"],
            },
        ],
    };

    // 抽卡时间范围（仅显示到日期）
    const firstRecord = records[0]?.timestamp.split(' ')[0] || "未知";
    const lastRecord = records[records.length - 1]?.timestamp.split(' ')[0] || "未知";
    const dateRange = `${lastRecord} - ${firstRecord}`;

    // 动态生成星级数据块
    const starInfoHtml = `
        <div class="star-info">
            <span class="star-five" data-index="0">${starCounts["五星"]}</span> |
            <span class="star-four" data-index="1">${starCounts["四星"]}</span> |
            <span class="star-three" data-index="2">${starCounts["三星"]}</span>
        </div>
        <div class="date-range">${dateRange}</div>
    `;

    // 插入到饼状图下方
    canvas.insertAdjacentHTML('afterend', starInfoHtml);

    // 初始化图表并存储实例
    charts[poolType] = new Chart(ctx, {
        type: "doughnut", // 使用 doughnut 类型
        data: chartData,
        options: {
            responsive: true,
            plugins: {
                legend: {
                    display: false, // 隐藏默认标签
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const value = context.raw || 0;
                            return `${value} 抽`;
                        },
                    },
                },
            },
            animation: {
                duration: 1000,
                animateScale: true,
                animateRotate: true,
            },
        },
    });

    // 为每个数字绑定点击事件
    const starElements = canvas.nextElementSibling.querySelectorAll('.star-info span');
    starElements.forEach((element) => {
        element.addEventListener('click', function () {
            const index = this.dataset.index; // 获取对应数据索引
            const meta = charts[poolType].getDatasetMeta(0); // 获取当前卡池图表的元数据
            meta.data[index].hidden = !meta.data[index].hidden; // 切换数据可见性
            charts[poolType].update(); // 更新当前图表
        });
    });
}


function applySlideInAnimation(recordList, newContent) {
    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = newContent;
    tempContainer.classList.add('slide-in'); // 添加动画类
    recordList.innerHTML = '';
    recordList.appendChild(tempContainer);
    tempContainer.addEventListener('animationend', () => {
        tempContainer.classList.remove('slide-in');
    });
}



function initTabs() {
    document.querySelectorAll('.record-tabs').forEach(tabContainer => {
        const tabs = tabContainer.querySelectorAll('.record-tab');
        const tabPanels = tabContainer.closest('.card-pool').querySelectorAll('.tab-panel');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tabPanels.forEach(panel => panel.classList.remove('active'));

                tab.classList.add('active');
                const targetPanel = tab.dataset.tab;
                tabContainer.closest('.card-pool').querySelector(`#${targetPanel}`).classList.add('active');
            });
        });
    });
}

// 页面加载后加载tooltip
function initRecordTooltips() {
    let tooltip = document.querySelector('.record-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'record-tooltip';
        document.body.appendChild(tooltip);
    }
    // 事件委托：详情页数据条(.record) 与 统计页角色卡片(.intuitive-char-card) 统一显示获取时间
    if (window.__recordTooltipBound) return;
    window.__recordTooltipBound = true;
    document.addEventListener('mouseover', e => {
        const el = e.target.closest('.record, .intuitive-char-card');
        if (!el) return;
        const time = el.dataset.time;
        if (!time) { tooltip.style.opacity = '0'; return; }
        tooltip.innerHTML = '<div class="tooltip-body"><p><strong>获取时间：</strong>' + time + '</p></div>';
        tooltip.style.opacity = '1';
    });
    document.addEventListener('mousemove', e => {
        const el = e.target.closest('.record, .intuitive-char-card');
        if (!el) return;
        const offset = 14;
        tooltip.style.left = (e.pageX + offset) + 'px';
        tooltip.style.top = (e.pageY + offset) + 'px';
    });
    document.addEventListener('mouseout', e => {
        const el = e.target.closest('.record, .intuitive-char-card');
        if (el && !el.contains(e.relatedTarget)) {
            tooltip.style.opacity = '0';
        }
    });
}

function applyHiddenPools() {
  const hidden = getHiddenPools();
  document.querySelectorAll('.card-pool').forEach(poolEl => {
    const title = poolEl.querySelector('.card-title')?.textContent?.trim();
    if (!title) return;
    poolEl.style.display = hidden.has(title) ? 'none' : '';
  });
  // 隐藏“全部卡池”汇总卡
  const allCard = document.querySelector('.intuitive-card.pool-all');
  if (allCard) allCard.style.display = hidden.has('__SUMMARY_ALL__') ? 'none' : '';
}

function toDatetimeLocalValue(date) {
  // date: Date
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function parseRecordTime(record) {

  const t = record.time || record.gacha_time || record.date || record.timestamp;
  if (!t) return null;
  const isoLike = String(t).replace(' ', 'T');
  const d = new Date(isoLike);
  return isNaN(d.getTime()) ? null : d;
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
