/**
 * 抽卡分析视图 —— 获取时间 tooltip（自遗留 gacha.js initRecordTooltips 迁移）。
 *
 * 事件委托到 document：详情页数据条(.record)、卡片视图头像(.char-avatar-wrap)、
 * 列表视图头像(.bar-avatar-wrap) 统一显示获取时间。模块级 __bound 标志只绑一次
 * （模块只加载一次，等价遗留 window.__recordTooltipBound）。
 */
let __bound = false;

/** 绑定获取时间 tooltip（GameToolsPage 挂载 → bootGacha 调用，幂等） */
export function initRecordTooltips(): void {
  let tooltip = document.querySelector('.record-tooltip') as HTMLElement | null;
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'record-tooltip';
    document.body.appendChild(tooltip);
  }
  if (__bound) return;
  __bound = true;

  const TOOLTIP_SELECTOR = '.record, .char-avatar-wrap, .bar-avatar-wrap';

  document.addEventListener('mouseover', (e) => {
    const target = e.target as Element | null;
    const el = target ? target.closest(TOOLTIP_SELECTOR) : null;
    if (!el) return;
    // 头像元素(.char-avatar-wrap/.bar-avatar-wrap)自身无 data-time，向上找最近带 data-time 的父级
    const timeEl = el instanceof HTMLElement && el.dataset.time ? el : el.closest('[data-time]');
    const time = timeEl ? timeEl.getAttribute('data-time') || '' : '';
    if (!time) {
      tooltip!.style.opacity = '0';
      return;
    }
    tooltip!.innerHTML = '<div class="tooltip-body"><p><strong>获取时间：</strong>' + time + '</p></div>';
    tooltip!.style.opacity = '1';
  });

  document.addEventListener('mousemove', (e) => {
    const target = e.target as Element | null;
    const el = target ? target.closest(TOOLTIP_SELECTOR) : null;
    if (!el) return;
    const offset = 14;
    tooltip!.style.left = e.pageX + offset + 'px';
    tooltip!.style.top = e.pageY + offset + 'px';
  });

  document.addEventListener('mouseout', (e) => {
    const target = e.target as Element | null;
    const el = target ? target.closest(TOOLTIP_SELECTOR) : null;
    const rel = e.relatedTarget as Element | null;
    if (el && rel && !el.contains(rel)) {
      tooltip!.style.opacity = '0';
    }
  });
}
