/**
 * 遗留脚本加载器 —— 仅剩渲染进程错误回写桥：
 *   scripts/renderer.js
 *
 * 主题视觉（background.js）已迁入 React（theme/background.ts，main.tsx 挂载后调用
 * applyAppBackground），浮层通知（syncNotification.js）已迁入 React
 * （notification/NotificationHost.tsx，订阅同一 'notify' 通道）。此处仅保留
 * renderer.js —— 渲染进程致命错误回写桥（window.onerror / unhandledrejection /
 * console 劫持 → 主进程 feibijiubi-renderer.log）。它必须在任何业务代码之前注册，
 * 故保留为经典脚本入口，不并入 React。
 *
 * React 应用挂载完成后再注入：renderer.js 是经典脚本（共享 window 全局 + 顶层函数），
 * 必须用 <script src> 元素执行；不能走 ESM import（会变成模块作用域，破坏其
 * 对 window 级错误事件的早期捕获语义）。
 */

const LEGACY_SCRIPTS = [
  'scripts/renderer.js',
];

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('legacy script load failed: ' + src));
    document.body.appendChild(s);
  });
}

/** 按原始顺序依次注入遗留脚本，任一失败即中断（与旧的同步 <script> 语义一致）。 */
export function loadLegacyScripts(): Promise<void> {
  return LEGACY_SCRIPTS.reduce(
    (chain, src) => chain.then(() => loadScript(src)),
    Promise.resolve(),
  );
}
