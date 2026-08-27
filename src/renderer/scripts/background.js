// 应用启动时即加载：读取背景/主题设置并应用到 <body>，
// 不依赖进入「设置」页（解决重启后背景不生效的问题）。
(function () {
    // 主题切换瞬间临时关闭全局过渡：否则半透明毛玻璃面板（账号下拉框、
    // 状态提示框、隐藏卡池按钮等）在 background 插值中间态会「闪白」。
    // 等到下一帧背景稳定后再移除，避免影响日常 hover 动画。
    function suspendTransitions() {
        document.body.classList.add('theme-switching');
        // 下一帧背景稳定后移除；无 rAF 时用定时器兜底，避免 class 残留影响 hover 动画
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                    document.body.classList.remove('theme-switching');
                });
            });
        } else {
            setTimeout(function () {
                document.body.classList.remove('theme-switching');
            }, 30);
        }
    }

    // 玻璃材质开启状态（'true'/'false' 字符串、布尔值、'1' 均视为开启）
    function parseGlass(v) {
        return v === true || v === 'true' || v === '1';
    }

    // 背景亮度 → 遮罩不透明度：0 最暗(遮罩最强) → 100 最亮(遮罩最弱，图片最清晰)
    // 默认 50 → 不透明度 0.5；浅色/深色共用映射，避免浅色模式背景「白蒙蒙」
    function brightnessToOpacity(v) {
        const n = parseFloat(v);
        if (isNaN(n)) return 0.5; // 未设置时默认
        return Math.min(1, Math.max(0, 1 - n / 100));
    }

    // 按主题模式 + 色温获取底色 RGB 字符串（用于背景遮罩与纯色底色）
    function getBaseRGB(isLight, colorTemp) {
        if (colorTemp === 'cool') {
            return isLight ? '244, 246, 250' : '16, 18, 24'; // 冷白浅 #F4F6FA / 冷白深 #101218
        }
        return isLight ? '250, 250, 250' : '23, 23, 24'; // 暖白浅 #FAFAFA / 暖白深 #171718
    }

    // 布尔类设置解析（'true'/'1'/布尔 true 均视为 true）
    function parseBool(v) {
        return v === true || v === 'true' || v === '1';
    }

    // 用户在本次会话内手动设定的玻璃状态（可为 null = 未手动设过，使用 DB 值）。
    // 用于防止页面加载时异步 applyBackground 用「过期的 DB 值」把刚点击的开关顶回去，
    // 导致玻璃效果时有时无、要重复点击才生效。重启后仍以 DB 持久化值为准。
    let glassUserSet = false;
    let glassUserValue = false;
    function currentGlass() {
        return glassUserSet ? glassUserValue : parseGlass(window.__appearance ? window.__appearance.glassEnabled : false);
    }

    // 开关玻璃材质：给 body 增删 glass-mode 类（半透明毛玻璃，透出背景图）。
    // 优先临时禁过渡，避免半透明面板在类切换中间态闪白。
    function applyGlassMode(enabled) {
        glassUserSet = true;
        glassUserValue = !!parseGlass(enabled);
        suspendTransitions();
        document.body.classList.toggle('glass-mode', glassUserValue);
    }

    function applyAppBackground() {
        if (!window.electronAPI || typeof window.electronAPI.invoke !== 'function') return Promise.resolve();
        return window.electronAPI.invoke('loadBackgroundSettings').then(function (settings) {
            window.__appearance = settings; // 缓存，供 renderer 同步切换视觉
            const themeMode = settings.themeMode || 'light';
            const colorTemp = settings.colorTemp || 'warm';
            const imagePath = settings.backgroundImage || '';
            const isLight = themeMode === 'light';
            const baseRGB = getBaseRGB(isLight, colorTemp);
            const hidden = parseBool(settings.backgroundHidden); // 隐藏背景图开关
            if (imagePath && !hidden) {
                const effOpacity = brightnessToOpacity(settings.backgroundBrightness);
                // 遮罩颜色承载在 CSS 变量上：亮度拖动预览只需改这个变量，
                // 不必每帧重建整串 background + url，从而避免大图重绘卡顿。
                document.documentElement.style.setProperty('--bg-overlay', 'rgba(' + baseRGB + ', ' + effOpacity + ')');
                // 背景图用 local:// 协议（同源），避免 file:// 在 local:// 页面下被 Chromium 拦截不显示
                const url = window.electronAPI.backgroundImageToURL ? window.electronAPI.backgroundImageToURL(imagePath) : '';
                document.body.style.background = 'linear-gradient(var(--bg-overlay), var(--bg-overlay)), url(\'' + url + '\')';
                document.body.style.backgroundSize = 'cover';
                document.body.style.backgroundRepeat = 'no-repeat';
                document.body.style.backgroundPosition = 'center';
                document.body.classList.add('has-bg-image');
            } else {
                // 无背景图：直接用内联写死对应底色（优先级最高，保证切换即时生效）
                document.body.style.background = 'rgb(' + baseRGB + ')';
                document.body.classList.remove('has-bg-image');
            }
            // 主题类双写：<html> 供首帧 CSS（index.html 同步脚本 + 此后每次切换都同步），
            // <body> 供 body.theme-light .xxx 后代选择器与既有读取逻辑，保持同步。
            // 同时把主题写入 localStorage 缓存，供下次启动首帧同步脚本恢复，避免闪黑屏。
            document.documentElement.classList.toggle('theme-light', isLight);
            document.documentElement.classList.toggle('theme-cool', colorTemp === 'cool');
            document.body.classList.toggle('theme-light', isLight);
            document.body.classList.toggle('theme-cool', colorTemp === 'cool');
            document.body.classList.toggle('glass-mode', currentGlass());
            try { localStorage.setItem('fbi_theme', (isLight ? 'light' : 'dark') + (colorTemp === 'cool' ? '-cool' : '-warm')); } catch (_) {}
        }).catch(function (err) {
            console.error('启动时应用背景失败:', err);
        });
    }

    // 同步即时应用主题视觉（class + body 背景），供 View Transition 在动画前瞬时调用，
    // 避免等待 IPC/DB 造成的切换延迟。imagePath 来自已缓存的 window.__appearance。
    window.applyThemeVisual = function (mode, imagePath) {
        // 先禁过渡，避免半透明毛玻璃面板在 background 插值中间态「闪白」
        suspendTransitions();
        const isLight = mode === 'light';
        const colorTemp = (window.__appearance && window.__appearance.colorTemp) || 'warm';
        const baseRGB = getBaseRGB(isLight, colorTemp);
        const hidden = parseBool(window.__appearance ? window.__appearance.backgroundHidden : false);
        if (imagePath && !hidden) {
            const effOpacity = brightnessToOpacity(window.__appearance ? window.__appearance.backgroundBrightness : 50);
            // 遮罩改由 CSS 变量承载，亮度预览只更新变量，避免每帧重建整串 background
            document.documentElement.style.setProperty('--bg-overlay', 'rgba(' + baseRGB + ', ' + effOpacity + ')');
            // 背景图用 local:// 协议（同源），同 applyAppBackground
            const url = window.electronAPI && window.electronAPI.backgroundImageToURL ? window.electronAPI.backgroundImageToURL(imagePath) : '';
            document.body.style.background = 'linear-gradient(var(--bg-overlay), var(--bg-overlay)), url(\'' + url + '\')';
            document.body.style.backgroundSize = 'cover';
            document.body.style.backgroundRepeat = 'no-repeat';
            document.body.style.backgroundPosition = 'center';
            document.body.classList.add('has-bg-image');
        } else {
            // 无背景图：直接用内联写死对应底色（优先级最高，保证切换即时生效）
            document.body.style.background = 'rgb(' + baseRGB + ')';
            document.body.classList.remove('has-bg-image');
        }
        // 主题类双写 + 缓存（同 applyAppBackground，保持两者一致）
        document.documentElement.classList.toggle('theme-light', isLight);
        document.documentElement.classList.toggle('theme-cool', colorTemp === 'cool');
        document.body.classList.toggle('theme-light', isLight);
        document.body.classList.toggle('theme-cool', colorTemp === 'cool');
        document.body.classList.toggle('glass-mode', currentGlass());
        try { localStorage.setItem('fbi_theme', (isLight ? 'light' : 'dark') + (colorTemp === 'cool' ? '-cool' : '-warm')); } catch (_) {}
    };

    // 亮度拖动预览专用：只更新遮罩 CSS 变量（--bg-overlay），
    // 不重建背景字符串、不切换 body 类，仅触发一层 paint，保证拖动顺滑。
    window.setBackgroundOverlay = function (opacity) {
        const isLight = document.body.classList.contains('theme-light');
        const colorTemp = (window.__appearance && window.__appearance.colorTemp) || 'warm';
        const baseRGB = getBaseRGB(isLight, colorTemp);
        document.documentElement.style.setProperty('--bg-overlay', 'rgba(' + baseRGB + ', ' + opacity + ')');
    };

    // 暴露给 settings.js / renderer.js 复用
    window.applyAppBackground = applyAppBackground;
    window.applyGlassMode = applyGlassMode;

    // 启动生命周期埋点（与 renderer.js 的 [LIFE] 同一 log 通道）
    function _bgLife(tag, extra) {
        try {
            var s = '[LIFE:bg] ' + tag;
            if (extra !== undefined) {
                try { s += ' :: ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)); }
                catch (_) { try { s += ' :: ' + String(extra); } catch (_2) {} }
            }
            console.warn(s.slice(0, 1024));
        } catch (_) {}
    }
    _bgLife('sync-entry', { readyState: document.readyState });

    // 启动即应用一次（DOM 已就绪，因为本脚本放在 body 末尾）
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            _bgLife('dcl-fired-via-listener');
            applyAppBackground().then(function () { _bgLife('apply-ok'); }).catch(function (e) { _bgLife('apply-rejected', (e && e.message) ? e.message : String(e)); });
        });
    } else {
        applyAppBackground()
            .then(function () { _bgLife('apply-ok'); })
            .catch(function (e) { _bgLife('apply-rejected', (e && e.message) ? e.message : String(e)); });
    }
})();
