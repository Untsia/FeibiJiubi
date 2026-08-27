// 渲染进程致命错误回写：任何未捕获异常 / Promise reject 都同步上报主进程，
// 写入 <logs>/feibijiubi-renderer.log。打包后用户没 DevTools，
// 白屏/按钮点不动就靠这一条定位具体报错位置。
(function installRenderErrorBridge() {
    var _bridgeReady = false;
    var _buf = [];
    function reportNow(payload) {
        try {
            if (window.electronAPI && typeof window.electronAPI.reportRenderError === 'function') {
                window.electronAPI.reportRenderError(payload);
                return true;
            }
        } catch (_) {}
        return false;
    }
    function report(payload) {
        if (_bridgeReady) { reportNow(payload); return; }
        var ok = reportNow(payload);
        if (!ok && _buf && _buf.length < 200) _buf.push(payload);
    }
    window.addEventListener('error', function (e) {
        report({
            type: 'error',
            message: (e.error && e.error.message) ? e.error.message : String(e.message || ''),
            source: String(e.filename || location.href || ''),
            lineno: typeof e.lineno === 'number' ? e.lineno : 0,
            colno: typeof e.colno === 'number' ? e.colno : 0,
            stack: (e.error && e.error.stack) ? String(e.error.stack) : (new Error(String(e.message)).stack),
            url: location.href,
        });
    }, true);
    window.addEventListener('unhandledrejection', function (e) {
        var reason = (e && e.reason != null) ? e.reason : '';
        var msg = '';
        var stk = '';
        if (reason && typeof reason === 'object') {
            msg = String(reason.message || String(reason));
            stk = String(reason.stack || '');
        } else {
            msg = String(reason);
        }
        report({
            type: 'unhandledrejection',
            message: msg,
            source: String(location.href || ''),
            lineno: 0,
            colno: 0,
            stack: stk,
            url: location.href,
        });
    }, true);

    // 全量劫持 console.error / console.warn：
    // 之前错误的实现是「bridge ready 之后 restore 原始 console」，
    // 导致 DOMContentLoaded 之后 renderer 逻辑里的 console.error（loadPage fetch 失败、
    // gachaWuwaInit 异常捕获日志、视图脚本报错）完全丢进黑洞——日志只剩 finish-load 1 条，
    // 用户看到的是侧边栏/标题栏完好但中间分析区空白，完全无法定位。
    // 改成永久劫持：所有 console.error/warn 统一落到主进程 renderer log（采样/超长截断），
    // 开发期 npm start 下也同步走原始 console 输出，不影响调试观感。
    function stringifyArg(a) {
        if (a instanceof Error) {
            return (a.message || 'Error') + '\n' + (a.stack || '');
        }
        if (a == null) return '';
        if (typeof a === 'object') {
            try { return JSON.stringify(a); } catch (_) { try { return String(a); } catch (_2) { return '[Object]'; } }
        }
        try { return String(a); } catch (_) { return ''; }
    }
    function hookConsole(level) {
        var orig = window.console && console[level] ? console[level] : null;
        if (!orig) return;
        console[level] = function () {
            try {
                var args = Array.prototype.slice.call(arguments);
                var msg = args.map(stringifyArg).join(' ').slice(0, 2048);
                if (msg.length > 0) {
                    report({
                        type: 'console.' + level,
                        message: msg,
                        source: String(location.href || ''),
                        lineno: 0,
                        colno: 0,
                        stack: '',
                        url: location.href,
                    });
                }
            } catch (_) {}
            return orig.apply(console, arguments);
        };
    }
    hookConsole('error');
    hookConsole('warn');

    // bridge 轮询 + 早期缓存补发。
    function tryFlush() {
        if (_bridgeReady) return;
        if (window.electronAPI && typeof window.electronAPI.reportRenderError === 'function') {
            _bridgeReady = true;
            if (_buf) {
                var list = _buf; _buf = null;
                for (var i = 0; i < list.length; i++) reportNow(list[i]);
            }
        }
    }
    // 生命周期/进度埋点：把 renderer 初始化每一步以 console.warn 级别
    // 打到主进程 feibijiubi-renderer.log（已在打包版接入 console-message → prod 日志），
    // 彻底定位「内容区空白是卡在哪一步」：index 脚本是否加载、DCL 是否回调、
    // gameTools.html fetch 是否执行、fetch 成功/失败、page 脚本是否注入。
    function lifeCycle(tag, extra) {
        try {
            var s = '[LIFE] ' + tag;
            if (extra !== undefined) {
                try { s += ' :: ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)); }
                catch (_) { try { s += ' :: ' + String(extra); } catch (_2) {} }
            }
            // 走 console.warn 级别：打包版 main.js 的 console-message 只转发 warn/error，
            // 不会把 info 级海量信息打进来。
            if (console && typeof console.warn === 'function') console.warn(s.slice(0, 1024));
        } catch (_) {}
    }
    // 立即同步一条「renderer.js 脚本已进入同步代码」
    lifeCycle('boot:renderer-script-sync', { url: location.href, readyState: document.readyState });
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(tryFlush, 0);
        setTimeout(tryFlush, 150);
        setTimeout(tryFlush, 500);
    } else {
        window.addEventListener('DOMContentLoaded', function () {
            lifeCycle('bridge:dom-content-loaded-inner');
            setTimeout(tryFlush, 0);
            setTimeout(tryFlush, 150);
            setTimeout(tryFlush, 500);
        });
    }
    // 兜底再追 3 次，某些极端时序下 DOMContentLoaded 时 preload 桥还没挂完
    setTimeout(tryFlush, 1000);
    setTimeout(tryFlush, 3000);
    setTimeout(function () { lifeCycle('boot:3s-post'); }, 3100);
})();

document.addEventListener("DOMContentLoaded", () => {
    (typeof console !== 'undefined' && console && typeof console.warn === 'function') &&
        console.warn('[LIFE] dom-content-loaded-callback::enter');
    // 窗口控制按钮（成功绑定后打 data-on-click 标记，供主进程 dom-state 快照直接读取）
    (function attachTitlebarHandlers() {
        function markOk(id) { var el = document.getElementById(id); if (el) { el.setAttribute('data-on-click', '1'); return el; } return null; }
        var _mn = markOk('minimize'); if (_mn) _mn.addEventListener('click', () => { try { window.electronAPI && window.electronAPI.minimizeWindow && window.electronAPI.minimizeWindow(); } catch (e) { console.error('minimizeWindow threw', e); } });
        var _mx = markOk('maximize'); if (_mx) _mx.addEventListener('click', () => { try { window.electronAPI && window.electronAPI.maximizeWindow && window.electronAPI.maximizeWindow(); } catch (e) { console.error('maximizeWindow threw', e); } });
        var _cl = markOk('close');    if (_cl) _cl.addEventListener('click', () => { try { window.electronAPI && window.electronAPI.closeWindow && window.electronAPI.closeWindow(); } catch (e) { console.error('closeWindow threw', e); } });
    })();

    const content = document.getElementById("content");
    const navItems = document.querySelectorAll(".nav-item");
    let currentPage = null; // 初始化为空以确保首次加载
    let pendingView = null;
    console.warn('[LIFE] dcl::after-dom-refs', {
        hasContent: !!content,
        navCount: navItems ? navItems.length : 0,
        hasMin: !!document.getElementById('minimize'),
        hasElectronAPI: !!window.electronAPI,
        hasReport: !!(window.electronAPI && window.electronAPI.reportRenderError),
    });

    // 通过 fetch 取最新文本并用 Blob URL 执行，彻底绕过 <script src> 在 file:// 下的缓存/去重
    // （file:// 协议会以"文件路径"作为缓存 key、忽略 query，普通 cache-busting 失效；Blob URL 每次唯一）
    function loadScriptViaBlob(url, onload) {
        console.warn('[LIFE] loadScriptViaBlob::start', url);
        const fullUrl = url.startsWith('local://') ? url : `local://app/${url}`;
        fetch(fullUrl, { cache: 'no-store' })
            .then(r => {
                console.warn('[LIFE] loadScriptViaBlob::fetch-resolved', { url: url, ok: r.ok, status: r.status });
                return r.text();
            })
            .then(code => {
                console.warn('[LIFE] loadScriptViaBlob::code-loaded', { url: url, bytes: (code || '').length });
                const blob = new Blob([code], { type: 'text/javascript' });
                const blobUrl = URL.createObjectURL(blob);
                return new Promise((resolve) => {
                    const s = document.createElement("script");
                    s.dataset.page = url;
                    s.onload = () => {
                        console.warn('[LIFE] loadScriptViaBlob::script-onload', url);
                        URL.revokeObjectURL(blobUrl); resolve();
                    };
                    s.onerror = () => {
                        console.warn('[LIFE] loadScriptViaBlob::script-onerror', url);
                        URL.revokeObjectURL(blobUrl); resolve();
                    };
                    s.src = blobUrl;
                    content.appendChild(s);
                });
            })
            .then(() => { if (typeof onload === 'function') onload(); })
            .catch(err => {
                console.warn('[LIFE] loadScriptViaBlob::catch', { url: url, err: (err && err.message) ? err.message : String(err) });
                console.error('加载脚本失败:', url, err);
            });
    }

    // 加载指定页面
    function loadPage(page) {
        console.warn('[LIFE] loadPage::start', { page: page, prev: currentPage });
        if (currentPage === page) {
            const activeTab = document.querySelector(`.tab[data-page="${page}"]`);
            if (activeTab) {
                // 点击高亮动画已移除，即时切换无延迟
            }
            console.warn('[LIFE] loadPage::skip-same-page', page);
            return;
        }

        fetch(`local://app/views/${page}.html`, { cache: 'no-store' })
            .then(response => {
                console.warn('[LIFE] loadPage::fetch-resolved', {
                    page: page,
                    ok: response.ok,
                    status: response.status,
                    contentType: (response.headers && response.headers.get && response.headers.get('content-type')) || '',
                });
                return response.text();
            })
            .then(html => {
                content.innerHTML = html;
                console.warn('[LIFE] loadPage::html-injected', {
                    page: page,
                    htmlLen: (html || '').length,
                    childCount: content ? content.children.length : -1,
                });
                if (page === 'settings') reloadSettingsScript();
                else loadScript(page);
            })
            .catch(err => {
                console.error('loadPage fetch failed:', page, err);
                console.warn('[LIFE] loadPage::fetch-failed', { page: page, err: (err && err.message) ? err.message : String(err) });
            });
        currentPage = page;
    }

    // 动态加载页面的 JS 文件并调用初始化函数
    function loadScript(page) {
        console.warn('[LIFE] loadScript::start', { page: page });
        if (document.querySelector(`script[data-page="scripts/${page}.js"]`)) {
            console.warn('[LIFE] loadScript::already-loaded-hit', page);
            if (pendingView && typeof window.switchAnalysisView === 'function') {
                window.switchAnalysisView(pendingView);
                pendingView = null;
            }
            return; // 防止重复加载
        }

        loadScriptViaBlob(`scripts/${page}.js`, () => {
            console.warn('[LIFE] loadScript::via-blob-callback', page);
            if (typeof window[`${page}Init`] === 'function') {
                console.warn('[LIFE] loadScript::call-init', `${page}Init`);
                try {
                    window[`${page}Init`]();
                    console.warn('[LIFE] loadScript::call-init-returned', `${page}Init`);
                } catch (e) {
                    console.error('[LIFE] loadScript::call-init-threw', `${page}Init`, e);
                }
            } else {
                console.warn('[LIFE] loadScript::init-not-found', `${page}Init`, {
                    keys: Object.keys(window).filter(k => k.toLowerCase().includes(page.toLowerCase())).slice(0, 10),
                });
            }
            if (pendingView && typeof window.switchAnalysisView === 'function') {
                // gameTools 的初始化是异步的（动态加载 6 个视图脚本 + gachaWuwa.js），
                // 此时数据未必就绪，提前 switch 会触发重复的奇藏同步/渲染（页面闪两次）。
                // 改由 gachaWuwaInit 在拉取数据前消费 __pendingView，一次定位到目标子视图。
                if (page === 'gameTools') {
                    window.__pendingView = pendingView;
                } else {
                    window.switchAnalysisView(pendingView);
                }
                pendingView = null;
            }
        });
    }

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
    console.warn('[LIFE] dcl::before-default-load', {
        hasApplyAppBackground: typeof window.applyAppBackground === 'function',
        settingsBtnExists: !!settingsBtn,
        themeBtnExists: !!document.getElementById('sidebar-theme-toggle'),
    });
    if (typeof window.applyAppBackground === 'function') window.applyAppBackground();
    console.warn('[LIFE] dcl::calling-loadPage-gameTools');
    loadPage("gameTools");
    console.warn('[LIFE] dcl::after-loadPage-gameTools-called');

    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            navItems.forEach(n => n.classList.remove('active'));
            settingsBtn.classList.add('active');
            if (currentPage !== 'settings') loadPage('settings');
        });
    }

    // 侧边栏底部「浅色/深色」切换按钮（无文字，仅图标）
    // 主题切换：直接切换 body class（浅/深），无扩散动画。
    const themeBtn = document.getElementById('sidebar-theme-toggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            const isLight = document.body.classList.contains('theme-light');
            const next = isLight ? 'dark' : 'light';
            const nextIsLight = next === 'light';

            // 同步即时切换：直接写 body 底色 + 切换 theme-light class（最高优先级，确保即时生效，
            // 不依赖 background.js 的委托函数是否就绪）
            const colorTemp = (window.__appearance && window.__appearance.colorTemp) || 'warm';
            const isCool = colorTemp === 'cool';
            document.body.style.backgroundColor = nextIsLight
                ? (isCool ? '#f4f6fa' : '#fafafa')
                : (isCool ? '#101218' : '#171718');
            // 主题类双写 + 缓存：<html> 供首帧 CSS / <body> 供后代选择器与读取逻辑
            document.documentElement.classList.toggle('theme-light', nextIsLight);
            document.body.classList.toggle('theme-light', nextIsLight);
            try { localStorage.setItem('fbi_theme', (nextIsLight ? 'light' : 'dark') + (isCool ? '-cool' : '-warm')); } catch (_) {}
            // 兜底：若 background.js 已就绪，复用其逻辑（背景图/遮罩等）
            if (typeof window.applyThemeVisual === 'function') {
                window.applyThemeVisual(next, (window.__appearance && window.__appearance.backgroundImage) || '');
            }
            if (typeof window.highlightThemeMode === 'function') window.highlightThemeMode(next);

            // 轻量收尾：仅后台持久化 + 派发事件（不 reload DB / 不重绘背景图，避免卡顿）
            if (window.electronAPI && typeof window.electronAPI.saveBackgroundSettings === 'function') {
                window.electronAPI.saveBackgroundSettings('themeMode', next);
            }
            window.dispatchEvent(new CustomEvent('theme-mode-changed', { detail: { mode: next } }));
        });
    }
});
