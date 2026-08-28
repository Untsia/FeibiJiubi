import { createRoot } from 'react-dom/client';
import App from './App';
import NotificationHost from './notification/NotificationHost';
import { applyAppBackground } from './theme/background';
import { loadLegacyScripts } from './legacy';

// 首帧主题同步由 index.html 头部内联脚本保证（React 挂载之前、CSS 解析之前执行）。
// 这里只负责：1) 渲染 React 应用 + 全局浮层通知；2) 挂载后启动背景/主题应用
// （替代遗留 background.js 的自动执行）；3) 注入剩余遗留脚本（renderer.js 错误回写桥）。
const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <>
      <App />
      <NotificationHost />
    </>,
  );
  // 启动即应用背景/主题（异步 IPC，不阻塞渲染；首帧底色由 CSS 变量保证）
  applyAppBackground().catch((e) => console.error('[theme] applyAppBackground failed', e));
  // 静默失败保护：遗留脚本加载失败不会影响 React 应用本身，错误留作启动排查线索
  loadLegacyScripts().catch((err) => {
    console.error('[react-shell] legacy script load error:', err);
  });
}
