/**
 * React 应用 —— 渲染窗口框架（与旧静态 index.html 的 DOM 结构、类名、ID 完全一致，
 * 保证 UI 字节不变）。
 *
 * 状态分层：
 *   - 导航高亮（侧边栏 active）、窗口控制、主题切换入口：由 React 状态驱动。
 *   - 页面内容（#content）：设置页与分析页均全面 React 化（<SettingsPage /> /
 *     <GameToolsPage />），分析页数据链路在 gacha/data.ts + gacha/treasure.ts，
 *     视图切换由 data.ts 的 switchAnalysisView 统一负责（偏好持久化 + 冷启动奇藏
 *     同步兜底 + 派发 'app-nav-view-changed' 上报侧边栏高亮）。
 *   - 主题视觉实际应用（body/html 类、背景图、遮罩）由 theme/background.ts 的
 *     applyThemeVisual / applyAppBackground 负责，React 只触发并接住状态事件。
 */
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import SettingsPage from './SettingsPage';
import GameToolsPage from './GameToolsPage';
import { switchAnalysisView } from './gacha/data';
import { applyThemeVisual, getAppearance } from './theme/background';

type Page = 'gameTools' | 'settings';
type NavView = 'analysis' | 'qizang' | 'level';

interface NavItemMeta {
  page: Page;
  view: NavView;
  label: string;
  icon: JSX.Element;
}

// 与旧 index.html 的 .nav-item 一一对应（data-page / data-view 原样保留）
const NAV_ITEMS: NavItemMeta[] = [
  {
    page: 'gameTools',
    view: 'analysis',
    label: '分析',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" />
        <path d="M19 9l-5 5-4-4-3 3" />
      </svg>
    ),
  },
  {
    page: 'gameTools',
    view: 'qizang',
    label: '奇藏',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
  },
  {
    page: 'gameTools',
    view: 'level',
    label: '等级',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 20h18" />
        <path d="M4 16l4-4 4 3 8-8" />
        <path d="M16 7h4v4" />
      </svg>
    ),
  },
];

export default function App() {
  const [page, setPage] = useState<Page>('gameTools');
  const [view, setView] = useState<NavView>('analysis');

  // 遗留 switchAnalysisView 完成真实视图切换后（含内部 tab / 账号卡切换 / 冷启动恢复），
  // 把真实视图同步回侧边栏高亮：bar/intuitive/detail 统一归「分析」。
  useEffect(() => {
    const mapView = (v: string): NavView => {
      if (v === 'qizang') return 'qizang';
      if (v === 'level') return 'level';
      return 'analysis';
    };
    const onNavViewChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.view != null) setView(mapView(String(detail.view)));
    };
    window.addEventListener('app-nav-view-changed', onNavViewChanged);
    return () => window.removeEventListener('app-nav-view-changed', onNavViewChanged);
  }, []);

  // 导航入口：更新本地高亮状态 + 直调 data.ts 的 switchAnalysisView 做真实视图切换。
  // 语义与旧 renderer.js 一致：切页到设置 → setPage；切到 gameTools 子视图 → switchAnalysisView
  // （'analysis' 恢复上次离开的子视图；奇藏/等级还会触发冷启动同步兜底）。
  const navigate = useCallback((nextPage: Page, nextView: NavView | null) => {
    setPage(nextPage);
    if (nextPage === 'gameTools') {
      if (nextView) setView(nextView);
      switchAnalysisView(nextView || 'analysis');
    }
  }, []);

  // 窗口控制（minimize/maximize/close）：直调 electronAPI。
  // data-on-click 标记保留，供主进程 dom-state 诊断快照判断按钮已可交互。
  const winControl = useCallback((method: 'minimizeWindow' | 'maximizeWindow' | 'closeWindow') => {
    return () => {
      try {
        const api = (window as any).electronAPI;
        if (api && typeof api[method] === 'function') api[method]();
      } catch (e) {
        console.error(method + ' threw', e);
      }
    };
  }, []);

  // 浅色/深色切换：复刻旧 renderer.js 主题按钮逻辑（body 类 + localStorage +
  // applyThemeVisual 兜底 + 持久化 + 派发事件）。
  const toggleTheme = useCallback(() => {
    const isLight = document.body.classList.contains('theme-light');
    const next = isLight ? 'dark' : 'light';
    const nextIsLight = next === 'light';
    const colorTemp = (getAppearance() && getAppearance()!.colorTemp) || 'warm';
    const isCool = colorTemp === 'cool';
    document.body.style.backgroundColor = nextIsLight
      ? (isCool ? '#f4f6fa' : '#fafafa')
      : (isCool ? '#101218' : '#171718');
    document.documentElement.classList.toggle('theme-light', nextIsLight);
    document.body.classList.toggle('theme-light', nextIsLight);
    try { localStorage.setItem('fbi_theme', (nextIsLight ? 'light' : 'dark') + (isCool ? '-cool' : '-warm')); } catch (_) { /* 隐私模式忽略 */ }
    const bgImage = (getAppearance() && getAppearance()!.backgroundImage) || '';
    applyThemeVisual(next, bgImage);
    if (window.electronAPI && typeof window.electronAPI.saveBackgroundSettings === 'function') {
      window.electronAPI.saveBackgroundSettings('themeMode', next);
    }
    window.dispatchEvent(new CustomEvent('theme-mode-changed', { detail: { mode: next } }));
  }, []);

  const isGameTools = page === 'gameTools';

  return (
    <>
      <header className="title-bar">
        <div className="title-brand">
          <img src="/assets/icon.png" className="title-brand-logo" alt="菲比啾比" />
          <span className="title-brand-name">菲比啾比</span>
        </div>
        <div className="window-controls">
          <span id="minimize" className="control-button" data-on-click="1" title="最小化" aria-label="最小化" onClick={winControl('minimizeWindow')}>
            <svg width="13" height="13" viewBox="0 0 13 13"><line x1="2.5" y1="6.5" x2="10.5" y2="6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          </span>
          <span id="maximize" className="control-button" data-on-click="1" title="最大化" aria-label="最大化" onClick={winControl('maximizeWindow')}>
            <svg width="13" height="13" viewBox="0 0 13 13"><rect x="3" y="3" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
          </span>
          <span id="close" className="control-button" data-on-click="1" title="关闭" aria-label="关闭" onClick={winControl('closeWindow')}>
            <svg width="13" height="13" viewBox="0 0 13 13"><line x1="3.5" y1="3.5" x2="9.5" y2="9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /><line x1="9.5" y1="3.5" x2="3.5" y2="9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          </span>
        </div>
      </header>

      <div className="container">
        <nav className="sidebar">
          <ul>
            {NAV_ITEMS.map((item) => (
              <li
                key={item.view}
                className={'nav-item' + (isGameTools && view === item.view ? ' active' : '')}
                data-page={item.page}
                data-view={item.view}
                onClick={() => navigate(item.page, item.view)}
              >
                <span className="nav-ico" aria-hidden="true">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </li>
            ))}
          </ul>
          <div className="sidebar-bottom">
            <button className="sb-btn theme-toggle" id="sidebar-theme-toggle" type="button" aria-label="切换浅色/深色" onClick={toggleTheme}>
              <span className="nav-ico" aria-hidden="true">
                <svg className="ico-sun" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
                <svg className="ico-moon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              </span>
            </button>
            <button
              className={'sb-btn sidebar-settings' + (page === 'settings' ? ' active' : '')}
              data-page="settings"
              type="button"
              aria-label="设置"
              onClick={() => navigate('settings', null)}
            >
              <span className="nav-ico" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </span>
            </button>
          </div>
        </nav>
        {/* 内容区：设置页与分析页均由 React 托管（SettingsPage / GameToolsPage），
            分析页数据链路在 gacha/data.ts + gacha/treasure.ts，视图订阅 store 渲染 */}
        <main id="content" className="content">
          {page === 'settings' ? <SettingsPage /> : <GameToolsPage />}
        </main>
      </div>

      {/* 启动时发现新版本提示 */}
      <div id="update-modal" className="modal">
        <div className="modal-content update-modal-card">
          <div className="modal-header update-modal-header">
            <span className="update-modal-icon">✨</span>
            <span>发现新版本</span>
          </div>
          <div className="modal-body update-modal-body">
            <div className="update-version-row">
              <span className="update-badge" id="update-current">当前 v1.7.0</span>
              <span className="update-arrow">→</span>
              <span className="update-badge update-badge-new" id="update-latest">v1.7.0</span>
            </div>
            <p className="update-modal-text" id="update-desc">菲比啾比已发布新版本，点击「立即更新」可在程序内一键完成下载与安装，无需手动操作。</p>
            <div className="update-progress" id="update-progress" style={{ display: 'none' }}>
              <div className="update-progress-bar"><div className="update-progress-fill" id="update-progress-fill"></div></div>
              <div className="update-progress-meta">
                <span id="update-progress-pct">0%</span>
                <span id="update-progress-speed"></span>
              </div>
            </div>
          </div>
          <div className="modal-footer update-modal-footer">
            <button type="button" id="update-later" className="modal-button modal-button-ghost">稍后</button>
            <button type="button" id="update-go" className="modal-button modal-button-primary">立即更新</button>
          </div>
        </div>
      </div>
    </>
  );
}