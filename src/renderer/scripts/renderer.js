document.addEventListener("DOMContentLoaded", () => {
    // 窗口控制按钮
    document.getElementById('minimize').addEventListener('click', () => {
        window.electronAPI.minimizeWindow();
    });

    document.getElementById('maximize').addEventListener('click', () => {
        window.electronAPI.maximizeWindow();
    });

    document.getElementById('close').addEventListener('click', () => {
        window.electronAPI.closeWindow();
    });

    const content = document.getElementById("content");
    const navItems = document.querySelectorAll(".nav-item");
    let currentPage = null; // 初始化为空以确保首次加载
    let pendingView = null;

    // 通过 fetch 取最新文本并用 Blob URL 执行，彻底绕过 <script src> 在 file:// 下的缓存/去重
    // （file:// 协议会以"文件路径"作为缓存 key、忽略 query，普通 cache-busting 失效；Blob URL 每次唯一）
    function loadScriptViaBlob(url, onload) {
        fetch(url, { cache: 'no-store' })
            .then(r => r.text())
            .then(code => {
                const blob = new Blob([code], { type: 'text/javascript' });
                const blobUrl = URL.createObjectURL(blob);
                return new Promise((resolve) => {
                    const s = document.createElement("script");
                    s.dataset.page = url;
                    s.onload = () => { URL.revokeObjectURL(blobUrl); resolve(); };
                    s.onerror = () => { URL.revokeObjectURL(blobUrl); resolve(); };
                    s.src = blobUrl;
                    content.appendChild(s);
                });
            })
            .then(() => { if (typeof onload === 'function') onload(); })
            .catch(err => console.error('加载脚本失败:', url, err));
    }

    // 加载指定页面
    function loadPage(page) {
        if (currentPage === page) {
            const activeTab = document.querySelector(`.tab[data-page="${page}"]`);
            if (activeTab) {
                // 点击高亮动画已移除，即时切换无延迟
            }
            return;
        }

        fetch(`views/${page}.html`, { cache: 'no-store' })
            .then(response => response.text())
            .then(html => {
                content.innerHTML = html;
                if (page === 'settings') reloadSettingsScript();
                else loadScript(page);
            });
        currentPage = page;
    }

    // 动态加载页面的 JS 文件并调用初始化函数
    function loadScript(page) {
        if (document.querySelector(`script[data-page="scripts/${page}.js"]`)) {
            if (pendingView && typeof window.switchAnalysisView === 'function') {
                window.switchAnalysisView(pendingView);
                pendingView = null;
            }
            return; // 防止重复加载
        }

        loadScriptViaBlob(`scripts/${page}.js`, () => {
            if (typeof window[`${page}Init`] === 'function') {
                window[`${page}Init`]();
            }
            if (pendingView && typeof window.switchAnalysisView === 'function') {
                window.switchAnalysisView(pendingView);
                pendingView = null;
            }
        });
    }

    // 完整重建当前分析页（与「切到设置页再切回」效果完全一致）：移除已加载的脚本标签并
    // 重置 currentPage，使 loadPage 重新注入 HTML + 重跑 gachaWuwaInit，确保刷新数据后视图正确刷新。
    window.reloadGameToolsView = function () {
        console.log('[DIAG-RV] reloadGameToolsView invoked');
        const old = document.querySelector('script[data-page="scripts/gameTools.js"]');
        if (old) old.remove();
        currentPage = null;
        loadPage('gameTools');
    };

    // 设置页：片段被 innerHTML 替换后旧的 DOM 事件监听器会随旧元素销毁，
    // 需在每次重新注入 HTML 后强制重载脚本、重新绑定（普通色块与自定义取色器都依赖此）
    function reloadSettingsScript() {
        const old = document.querySelector('script[data-page="scripts/settings.js"]');
        if (old) old.remove();
        loadScriptViaBlob("scripts/settings.js", () => {});
    }

    // 侧边栏底部「设置」按钮（独立于导航 ul），提前声明以便导航点击时同步清除高亮
    const settingsBtn = document.querySelector('.sidebar-settings');

    // 监听侧边栏导航（分析子视图 / 设置页）
    navItems.forEach(item => {
        item.addEventListener("click", () => {
            const page = item.dataset.page;
            const view = item.dataset.view;
            navItems.forEach(n => n.classList.remove("active"));
            if (settingsBtn) settingsBtn.classList.remove("active");
            item.classList.add("active");
            if (currentPage !== page) {
                pendingView = view || null;
                loadPage(page);
            } else if (view && typeof window.switchAnalysisView === "function") {
                window.switchAnalysisView(view);
            }
        });
    });
    // 默认加载游戏工具；并立即应用一次背景（兜底，确保启动即有背景，不依赖进入设置页）
    if (typeof window.applyAppBackground === 'function') window.applyAppBackground();
    loadPage("gameTools");

    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            navItems.forEach(n => n.classList.remove('active'));
            settingsBtn.classList.add('active');
            if (currentPage !== 'settings') loadPage('settings');
        });
    }

    // 侧边栏底部「浅色/深色」切换按钮（无文字，仅图标）
    const themeBtn = document.getElementById('sidebar-theme-toggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', async () => {
            const isLight = document.body.classList.contains('theme-light');
            const next = isLight ? 'dark' : 'light';
            try {
                if (window.electronAPI && typeof window.electronAPI.saveBackgroundSettings === 'function') {
                    await window.electronAPI.saveBackgroundSettings('themeMode', next);
                }
            } catch (e) { /* 保存失败也不阻塞视觉切换 */ }
            if (typeof window.applyAppBackground === 'function') window.applyAppBackground();
            // 同步设置页的浅/深按钮高亮
            if (typeof window.highlightThemeMode === 'function') window.highlightThemeMode(next);
            window.dispatchEvent(new CustomEvent('theme-mode-changed', { detail: { mode: next } }));
        });
    }

});
