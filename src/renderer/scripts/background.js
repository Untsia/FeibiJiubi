// 应用启动时即加载：读取背景/主题设置并应用到 <body>，
// 不依赖进入「设置」页（解决重启后背景不生效的问题）。
(function () {
    function applyAppBackground() {
        if (!window.electronAPI || typeof window.electronAPI.invoke !== 'function') return;
        window.electronAPI.invoke('loadBackgroundSettings').then(function (settings) {
            const opacity = settings.backgroundOpacity || '0.5';
            const themeMode = settings.themeMode || 'dark';
            const imagePath = settings.backgroundImage || '';
            const isLight = themeMode === 'light';
            const baseRGB = isLight ? '245, 246, 250' : '24, 26, 34'; // 浅色 #F5F6FA / 深色 #181A22
            if (imagePath) {
                const effOpacity = isLight ? Math.max(parseFloat(opacity), 0.8) : parseFloat(opacity);
                const overlayColor = 'rgba(' + baseRGB + ', ' + effOpacity + ')';
                const url = window.electronAPI.filePathToURL
                    ? window.electronAPI.filePathToURL(imagePath)
                    : 'file://' + imagePath;
                document.body.style.background = 'linear-gradient(' + overlayColor + ', ' + overlayColor + '), url(\'' + url + '\')';
            } else {
                document.body.style.background = 'rgb(' + baseRGB + ')';
            }
            document.body.style.backgroundSize = 'cover';
            document.body.style.backgroundRepeat = 'no-repeat';
            document.body.style.backgroundPosition = 'center';
            document.body.classList.toggle('theme-light', isLight);
        }).catch(function (err) {
            console.error('启动时应用背景失败:', err);
        });
    }

    // 暴露给 settings.js / renderer.js 复用
    window.applyAppBackground = applyAppBackground;

    // 启动即应用一次（DOM 已就绪，因为本脚本放在 body 末尾）
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyAppBackground);
    } else {
        applyAppBackground();
    }
})();
