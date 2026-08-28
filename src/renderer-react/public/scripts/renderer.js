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
    // 框架是否就绪（React 应用渲染）。
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

// 页面加载桥（domInit / loadPage / loadScript / __shellNavigator）已删除：
// 设置页与分析页均由 React 应用直接渲染（App.tsx → SettingsPage / GameToolsPage），
// 分析页数据链路在 gacha/data.ts + gacha/treasure.ts；背景应用由 main.tsx 调用
// theme/background.ts 完成，导航直调 data.ts 的 switchAnalysisView，无需本桥参与。
