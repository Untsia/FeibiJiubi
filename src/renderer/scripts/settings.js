(() => {

     // 处理背景图片选择
    const backgroundImageInput = document.getElementById("background-path");

    // 数据路径设置
    const dataFilePathInput = document.getElementById('dataFile-path');
    const browseButton = document.getElementById('browse-dataFile');
    const resetButton = document.getElementById('reset-dataFile');

    // 鸣潮游戏目录设置
    const gamePathInput = document.getElementById('game-path');
    const browseGamePathButton = document.getElementById('browse-game-path');
    const resetGamePathButton = document.getElementById('reset-game-path');
    const DEFAULT_GAME_ROOT = '';

    // 当前背景状态（用于各事件重算）
    let currentThemeMode = 'light';
    let currentBgImage = '';

    // ===== 自定义主题配色 =====
    function hexToRgb(hex) {
        const m = String(hex || '').replace('#', '');
        const v = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
        return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16) };
    }
    function rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s = 0, l = (max + min) / 2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h /= 6;
        }
        return [h * 360, s, l];
    }
    function hslToRgb(h, s, l) {
        h /= 360;
        let r, g, b;
        if (s === 0) { r = g = b = l; }
        else {
            const hue = (p, q, t) => {
                if (t < 0) t += 1; if (t > 1) t -= 1;
                if (t < 1 / 6) return p + (q - p) * 6 * t;
                if (t < 1 / 2) return q;
                if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue(p, q, h + 1 / 3); g = hue(p, q, h); b = hue(p, q, h - 1 / 3);
        }
        return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
    }
    function rgbStr(c) { return c.r + ', ' + c.g + ', ' + c.b; }

    // 将主色衍生为一套完整主题变量并应用到 :root（全局生效，深浅兼容）
    function applyAccentColor(hex) {
        if (!hex) hex = '#7c83ff';
        const rgb = hexToRgb(hex);
        const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
        const h = hsl[0], s = hsl[1], l = hsl[2];
        const hover = hslToRgb(h, s, Math.max(l - 0.12, 0.18));
        const accent2 = hslToRgb((h + 28) % 360, Math.min(s + 0.06, 1), Math.min(l + 0.10, 0.72));
        const soft = 'rgba(' + rgbStr(rgb) + ', 0.16)';
        const lum = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
        const contrast = lum > 165 ? '#1a1a1a' : '#ffffff';
        const root = document.documentElement.style;
        root.setProperty('--accent', hex);
        root.setProperty('--accent-hover', 'rgb(' + rgbStr(hover) + ')');
        root.setProperty('--accent-2', 'rgb(' + rgbStr(accent2) + ')');
        root.setProperty('--accent-soft', soft);
        root.setProperty('--accent-glow', 'rgba(' + rgbStr(rgb) + ', 0.35)');
        root.setProperty('--accent-contrast', contrast);
        root.setProperty('--gradient-primary', 'linear-gradient(135deg, ' + hex + ' 0%, rgb(' + rgbStr(accent2) + ') 100%)');
        root.setProperty('--gradient-soft', 'linear-gradient(135deg, rgba(' + rgbStr(rgb) + ', 0.18), rgba(' + rgbStr(accent2) + ', 0.18))');
        // 氛围光晕跟随主题色派生（避免背景极光固定为紫色）
        root.setProperty('--glow-a', 'rgba(' + rgbStr(rgb) + ', 0.20)');
        root.setProperty('--glow-b', 'rgba(' + rgbStr(rgb) + ', 0.16)');
        root.setProperty('--glow-c', 'rgba(' + rgbStr(rgb) + ', 0.12)');
    }

    const accentSwatches = Array.from(document.querySelectorAll('#themeSwatches .swatch:not(.swatch-custom)'));
    const customSwatchBtn = document.getElementById('customSwatch');
    const customAccentInput = document.getElementById('customAccent');

    function setActiveSwatch(hex) {
        const target = (hex || '').toLowerCase();
        let matched = false;
        accentSwatches.forEach(btn => {
            const on = (btn.dataset.color || '').toLowerCase() === target;
            btn.classList.toggle('active', on);
            if (on) matched = true;
        });
        if (customSwatchBtn) customSwatchBtn.classList.toggle('active', !matched && !!target);
        if (customAccentInput) customAccentInput.value = hex || '#7c83ff';
    }

    function persistAccent(hex) {
        if (window.electronAPI && window.electronAPI.saveBackgroundSettings) {
            window.electronAPI.saveBackgroundSettings('accentColor', hex);
        }
    }

    accentSwatches.forEach(btn => {
        btn.addEventListener('click', () => {
            applyAccentColor(btn.dataset.color);
            setActiveSwatch(btn.dataset.color);
            persistAccent(btn.dataset.color);
        });
    });
    if (customAccentInput) {
        customAccentInput.addEventListener('input', (e) => {
            accentSwatches.forEach(b => b.classList.remove('active'));
            if (customSwatchBtn) customSwatchBtn.classList.add('active');
            applyAccentColor(e.target.value);
            persistAccent(e.target.value);
        });
    }

    // ===== 自定义取色面板（贴合毛玻璃 UI，点击自定义色块弹出） =====
    (function setupCustomPicker() {
        var swatch = customSwatchBtn;
        var pop = document.getElementById('colorPickerPop');
        if (!swatch || !pop) return;
        // 取色面板挂到 body 顶层：.content > * 的入场动画(pageIn 含 transform)会让
        // position:fixed 的参照系变成 .settings-page 而非视口，导致 left 叠加祖先偏移而偏右。
        // 挂到 body 后 fixed 恒相对视口，getBoundingClientRect 的视口坐标即可精确定位。
        document.querySelectorAll('body > .color-picker-pop').forEach(function (el) { if (el !== pop) el.remove(); });
        if (pop.parentElement !== document.body) document.body.appendChild(pop);
        var preview = document.getElementById('cppPreview');
        var hue = document.getElementById('cppHue');
        var sat = document.getElementById('cppSat');
        var light = document.getElementById('cppLight');
        var hueVal = document.getElementById('cppHueVal');
        var satVal = document.getElementById('cppSatVal');
        var lightVal = document.getElementById('cppLightVal');
        var hexInput = document.getElementById('cppHex');
        var presetsBox = document.getElementById('cppPresets');
        var applyBtn = document.getElementById('cppApply');
        var cancelBtn = document.getElementById('cppCancel');
        var presetColors = ['#7c83ff','#6d5df6','#3ecf8e','#33c9c9','#ff7eb6','#b18cff'];
        var curH = 248, curS = 100, curL = 74;

        function hslToHex(h, s, l) {
            var rgb = hslToRgb(h, s / 100, l / 100);
            function toHex(n) { var x = Math.round(n).toString(16); return x.length === 1 ? '0' + x : x; }
            return '#' + toHex(rgb.r) + toHex(rgb.g) + toHex(rgb.b);
        }
        function hexToHslObj(hex) {
            var rgb = hexToRgb(hex);
            var hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
            return { h: Math.round(hsl[0]), s: Math.round(hsl[1] * 100), l: Math.round(hsl[2] * 100) };
        }
        function render() {
            var hex = hslToHex(curH, curS, curL);
            var hex2 = hslToHex((curH + 28) % 360, Math.min(curS + 6, 100), Math.min(curL + 10, 72));
            preview.style.background = 'linear-gradient(135deg, ' + hex + ', ' + hex2 + ')';
            hueVal.textContent = curH;
            satVal.textContent = curS;
            lightVal.textContent = curL;
            if (document.activeElement !== hexInput) hexInput.value = hex.slice(1);
            hue.style.setProperty('--track', 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)');
            sat.style.setProperty('--track', 'linear-gradient(to right, ' + hslToHex(curH, 0, curL) + ', ' + hslToHex(curH, 100, curL) + ')');
            light.style.setProperty('--track', 'linear-gradient(to right, ' + hslToHex(curH, curS, 0) + ', ' + hslToHex(curH, curS, 50) + ', ' + hslToHex(curH, curS, 100) + ')');
        }
        function setFromHex(hex) {
            if (!/^#?[0-9a-fA-F]{6}$/.test(hex)) return;
            if (hex[0] !== '#') hex = '#' + hex;
            var o = hexToHslObj(hex);
            curH = o.h; curS = o.s; curL = o.l;
            render();
        }
        function openPop() {
            var cur = (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#7c83ff').trim();
            var o = hexToHslObj(cur);
            curH = o.h; curS = o.s; curL = o.l;
            render();
            pop.hidden = false;
            var r = swatch.getBoundingClientRect();
            var pw = pop.offsetWidth || 300;
            var ph = pop.offsetHeight || 220;
            // 定位在自定义按钮右侧；右侧放不下则翻到按钮左侧；最后才贴边
            var left = r.right + 8;
            if (left + pw > window.innerWidth - 12) left = r.left - pw - 8;
            if (left < 12) left = 12;
            if (left + pw > window.innerWidth - 12) left = window.innerWidth - 12 - pw;
            pop.style.left = left + 'px';
            // 垂直方向尽量与按钮居中对齐
            var top = r.top + (r.height - ph) / 2;
            if (top < 12) top = 12;
            if (top + ph > window.innerHeight - 12) top = Math.max(12, window.innerHeight - 12 - ph);
            pop.style.top = top + 'px';
            requestAnimationFrame(function () { pop.classList.add('show'); });
        }
        function closePop() {
            pop.classList.remove('show');
            setTimeout(function () { pop.hidden = true; }, 180);
        }
        presetsBox.innerHTML = presetColors.map(function (c) {
            return '<button type="button" class="cpp-preset" style="--pc:' + c + '" data-c="' + c + '" title="' + c + '"></button>';
        }).join('');
        presetsBox.querySelectorAll('.cpp-preset').forEach(function (b) {
            b.addEventListener('click', function () { setFromHex(b.dataset.c); hexInput.focus(); });
        });
        swatch.addEventListener('click', function (e) {
            e.stopPropagation();
            if (pop.hidden) openPop(); else closePop();
        });
        [hue, sat, light].forEach(function (el) {
            el.addEventListener('input', function () {
                curH = parseInt(hue.value, 10); curS = parseInt(sat.value, 10); curL = parseInt(light.value, 10);
                render();
            });
        });
        hexInput.addEventListener('input', function () { setFromHex(hexInput.value); });
        applyBtn.addEventListener('click', function () {
            var hex = hslToHex(curH, curS, curL);
            accentSwatches.forEach(function (b) { b.classList.remove('active'); });
            swatch.classList.add('active');
            applyAccentColor(hex);
            persistAccent(hex);
            closePop();
        });
        cancelBtn.addEventListener('click', closePop);
        pop.addEventListener('click', function (e) { e.stopPropagation(); });
        document.addEventListener('click', function (e) {
            if (!pop.hidden && !pop.contains(e.target) && e.target !== swatch) closePop();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !pop.hidden) closePop();
        });
    })();



    // 高亮主题模式按钮（仅 data-mode 按钮，排除关闭行为等无 data-mode 的按钮）
    function highlightThemeMode(mode) {
        document.querySelectorAll('.theme-option[data-mode]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
    }
    // 暴露给侧边栏主题按钮复用，实现双向同步
    window.highlightThemeMode = highlightThemeMode;

    // 加载背景信息
    function loadBackgroundSettings() {
        highlightThemeMode('light'); // 首次加载默认选中浅色，避免未返回 themeMode 时无高亮
        window.electronAPI.invoke('loadBackgroundSettings').then(settings => {
            currentBgImage = settings.backgroundImage || '';
            currentThemeMode = settings.themeMode || 'dark';

            // 检查背景图片路径是否存在
            if (settings.backgroundImage === null) {
                document.getElementById('background-path').value = '没有设置背景图片';
            }else{
                // 如果有背景图片
                document.getElementById('background-path').value = settings.backgroundImage || '';
            }
            window.applyAppBackground();

            // 高亮当前主题选项
            const savedAccent = settings.accentColor || '#7c83ff';
            applyAccentColor(savedAccent);
            setActiveSwatch(savedAccent);
            highlightThemeMode(currentThemeMode);
        }).catch(error => {
            console.error('加载背景设置失败:', error);
        });
    }
    loadBackgroundSettings();


    // 监听背景图片选择
    if (backgroundImageInput) {
        document.getElementById('browse-background').addEventListener('click', async () => {
            // 通过IPC发送选择文件夹的请求
            const result = await window.electronAPI.selectBackgroundFile();
            if (result.canceled === false && result.filePaths.length > 0) {
                const filePath = result.filePaths[0];
                document.getElementById('background-path').value = filePath;
                currentBgImage = filePath;
                // 可选择保存路径到数据库或直接应用
                await window.electronAPI.saveBackgroundSettings("backgroundImage", filePath);
                window.applyAppBackground();
            }
        });
    }

    // 主题模式（浅色/深色）切换
    document.querySelectorAll('.theme-option[data-mode]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const mode = btn.dataset.mode;
            currentThemeMode = mode;
            document.querySelectorAll('.theme-option[data-mode]').forEach(b => b.classList.toggle('active', b === btn));
            await window.electronAPI.saveBackgroundSettings("themeMode", mode);
            window.applyAppBackground();
            window.dispatchEvent(new CustomEvent('theme-mode-changed', { detail: { mode: mode } }));
        });
    });

    // 监听来自侧边栏的切换，实时同步设置页高亮
    window.addEventListener('theme-mode-changed', (e) => {
        if (e && e.detail && e.detail.mode) highlightThemeMode(e.detail.mode);
    });



    // 监听恢复默认配置按钮的点击事件
    document.getElementById('restore-defaults').addEventListener('click', () => {
        window.electronAPI.invoke('restoreDefaultBackgroundSettings')
            .then(() => {
                animationMessage(true, '背景设置已恢复为默认配置');
                // 更新配置
                loadBackgroundSettings();
            })
            .catch((err) => {
                console.error('恢复默认设置失败:', err);
                animationMessage(false, '恢复默认设置失败');
            });
    });


    // ===== 关闭程序窗口行为（退出程序 / 系统托盘） =====
    const closeActionBtns = Array.from(document.querySelectorAll('#closeActionSwitch .theme-option'));
    function setActiveCloseAction(action) {
        closeActionBtns.forEach(b => b.classList.toggle('active', b.dataset.action === action));
    }
    setActiveCloseAction('exit'); // 默认选中“退出程序”，避免 load-settings 未返回时无任何选中态
    window.electronAPI.invoke("load-settings").then(settings => {
        setActiveCloseAction(settings.closeAction === 'tray' ? 'tray' : 'exit');
    });
    closeActionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            setActiveCloseAction(action);
            window.electronAPI.invoke("save-setting", "closeAction", action).catch(err => {
                console.error('保存关闭行为失败:', err);
            });
        });
    });
    // 检查外部链接
    document.querySelectorAll('a[target="_blank"]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const url = e.currentTarget.href;
            window.electronAPI.openExternal(url);
        });
    });

    // 加载当前路径
    async function loadDataPath() {
        const result = await window.electronAPI.invoke('get-dataFile-path');
        if (result.path) {
            dataFilePathInput.value = result.path;
        }
    }

    // 选择自定义数据路径
    browseButton.addEventListener('click', async () => {
        browseButton.disabled = true;
        browseButton.innerText = '请等待...';
        try {
            const result = await window.electronAPI.invoke('browse-dataFile');
            if (result.success) {
                animationMessage(true, `路径相同: ${result.path}`);
                dataFilePathInput.value = result.path;
            } else {
                animationMessage(false, result.message);
            }
        } catch (error) {
            console.error('切换路径时发生错误:', error);
            animationMessage(false, `路径更新失败\n${error}`);
        }finally {
            browseButton.disabled = false;
            browseButton.innerText = '更新数据路径';
        }
    });

    // 恢复默认数据路径
    resetButton.addEventListener('click', async () => {
        resetButton.disabled = true;
        resetButton.innerText = '请等待...';
        try {
            const result = await window.electronAPI.invoke('reset-dataFile');
            if (result.success) {
                animationMessage(true, '目前已是默认路径');
                dataFilePathInput.value = result.path;
            } else {
                animationMessage(false, result.message);
            }
        } catch (error) {
            console.error('恢复路径时发生错误:', error);
            animationMessage(false, `重置路径失败\n${error}`);
        }finally {
            resetButton.disabled = false;
            resetButton.innerText = '恢复默认路径';
        }
    });

    // 加载并初始化鸣潮游戏目录
    function loadGamePath(val) {
        // getSetting 在未找到键时返回字符串 "false"，需归一化为空
        const normalized = (val && val.trim() && val.trim() !== 'false') ? val.trim() : DEFAULT_GAME_ROOT;
        gamePathInput.value = normalized;
        return normalized;
    }
    window.electronAPI.invoke('load-settings').then(settings => {
        const saved = (settings && settings.gameRootDir !== undefined) ? settings.gameRootDir : DEFAULT_GAME_ROOT;
        const current = loadGamePath(saved);
        // 用户没手动设置目录时，自动探测系统里已安装的鸣潮并把路径显示到框里
        if (!current && window.electronAPI.detectWutheringWavesPath) {
            window.electronAPI.detectWutheringWavesPath().then(res => {
                const found = res && res.success && res.path ? res.path : '';
                if (found) {
                    gamePathInput.value = found;
                    if (window.electronAPI.saveBackgroundSettings) {
                        window.electronAPI.saveBackgroundSettings('gameRootDir', found);
                    }
                }
            }).catch(() => { /* 探测失败保持空，用户可手动选择目录 */ });
        }
    });
    if (browseGamePathButton) {
        browseGamePathButton.addEventListener('click', async () => {
            try {
                const result = await window.electronAPI.browseGamePath();
                if (result && result.success && result.path) {
                    gamePathInput.value = result.path;
                    await window.electronAPI.invoke('save-setting', 'gameRootDir', result.path);
                    animationMessage(true, '已保存鸣潮游戏目录');
                } else if (result && result.message) {
                    animationMessage(false, result.message);
                }
            } catch (error) {
                console.error('选择游戏目录失败:', error);
                animationMessage(false, `选择失败\n${error}`);
            }
        });
    }
    if (resetGamePathButton) {
        resetGamePathButton.addEventListener('click', async () => {
            gamePathInput.value = DEFAULT_GAME_ROOT;
            await window.electronAPI.invoke('save-setting', 'gameRootDir', DEFAULT_GAME_ROOT);
            animationMessage(true, '已清空游戏目录');
        });
    }

    // 版本更新（基础版：检查 GitHub 最新版本，跳转下载）
    const currentVersionEl = document.getElementById('currentVersion');
    if (currentVersionEl && window.electronAPI && typeof window.electronAPI.getAppVersion === 'function') {
        window.electronAPI.getAppVersion().then(v => {
            if (v) currentVersionEl.textContent = v;
        }).catch(() => {});
    }
    const checkUpdateBtn = document.getElementById('check-update');
    const updateStatusEl = document.getElementById('updateStatus');
    const updateLinkEl = document.getElementById('update-link');
    if (checkUpdateBtn) {
        checkUpdateBtn.addEventListener('click', async () => {
            if (updateStatusEl) updateStatusEl.textContent = '正在检查更新…';
            try {
                const res = await window.electronAPI.checkUpdate();
                if (!res || !res.success) {
                    if (updateStatusEl) updateStatusEl.textContent = '检查失败：' + ((res && res.error) || '未知错误');
                    return;
                }
                const has = res.hasUpdate;
                if (updateStatusEl) {
                    updateStatusEl.textContent = has
                        ? ('发现新版本 v' + res.latestVersion + '（当前 v' + res.currentVersion + '）')
                        : ('已是最新版本 v' + res.currentVersion);
                }
                if (updateLinkEl) {
                    updateLinkEl.classList.toggle('hidden', !has);
                    if (has && res.releaseUrl) updateLinkEl.href = res.releaseUrl;
                }
            } catch (e) {
                if (updateStatusEl) updateStatusEl.textContent = '检查失败：' + (e && e.message ? e.message : e);
            }
        });
    }

    // 初始化加载路径
    loadDataPath();

})();
