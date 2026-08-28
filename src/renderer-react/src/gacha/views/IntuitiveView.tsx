/**
 * 直观（卡片）视图 —— 取代遗留 views/intuitiveView.js。
 *
 * 纯展示视图：由 renderers.renderIntuitiveViewHtml 生成与原实现字节一致的
 * HTML（.intuitive-grid 卡片网格），无 JS 交互（仅 CSS hover），故无事件绑定。
 */
import { memo, useMemo } from 'react';
import { useGachaSelector } from '../store';
import { renderIntuitiveViewHtml } from '../renderers';

function IntuitiveView() {
  const records = useGachaSelector((s) => s.records);
  const pools = useGachaSelector((s) => s.pools);
  const hiddenPools = useGachaSelector((s) => s.hiddenPools);
  const avatarMap = useGachaSelector((s) => s.avatarMap);
  const commonItems = useGachaSelector((s) => s.commonItems);
  const currentView = useGachaSelector((s) => s.currentView);

  const hidden = useMemo(() => new Set(hiddenPools), [hiddenPools]);
  // 非当前视图时跳过整页 HTML 渲染（六视图常驻挂载，内容不可见时重算是纯浪费）。
  // html 为空时外层 div 依然存在（id / class 不变），DOM 结构不受影响。
  const isActive = currentView === 'intuitive';
  const html = useMemo(
    () => (isActive ? renderIntuitiveViewHtml({ records, pools, hidden, avatarMap, commonItems }) : ''),
    [records, pools, hidden, avatarMap, commonItems, isActive],
  );

  return (
    <div
      id="view-intuitive"
      className={'analysis-view' + (currentView === 'intuitive' ? ' active' : '')}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default memo(IntuitiveView);