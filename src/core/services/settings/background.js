const {db} = require('../../app/database');
const {ipcMain, dialog, app } = require('electron');
const path = require('path');
const fs = require('fs');

// 自定义主色衍生计算（与渲染进程 settings.js 保持一致）
function hexToRgb(hex) {
    const m = String(hex || '').replace('#', '');
    const v = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
    return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16) };
}
function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
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

// 根据已保存的主色生成注入页面的 JS（设置 :root 主题变量）

// 根据已保存的主色生成注入页面的 JS（设置 :root 主题变量）

function buildAccentInject(accentColor) {
    if (!accentColor) return '';
    const rgb = hexToRgb(accentColor);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    const h = hsl[0], s = hsl[1], l = hsl[2];
    const hover = hslToRgb(h, s, Math.max(l - 0.12, 0.18)); // eslint-disable-line no-unused-vars -- 当前 --accent-hover 注入值与 --accent-2 共取值（accent2），此变量预留未来单独调 hover 明度，删除会丢失语义锚点
    const accent2 = hslToRgb((h + 28) % 360, Math.min(s + 0.06, 1), Math.min(l + 0.10, 0.72));
    const a2 = "rgb(" + accent2.r + ", " + accent2.g + ", " + accent2.b + ")";
    const soft = "rgba(" + rgb.r + ", " + rgb.g + ", " + rgb.b + ", 0.16)";
    const lum = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
    const contrast = lum > 165 ? "#1a1a1a" : "#ffffff";
    return 'document.documentElement.style.setProperty("--accent", "' + accentColor + '");' +
        'document.documentElement.style.setProperty("--accent-hover", "' + a2 + '");' +
        'document.documentElement.style.setProperty("--accent-2", "' + a2 + '");' +
        'document.documentElement.style.setProperty("--accent-soft", "' + soft + '");' +
        'document.documentElement.style.setProperty("--accent-contrast", "' + contrast + '");' +
        'document.documentElement.style.setProperty("--gradient-primary", "' + accentColor + '");' +
        'document.documentElement.style.setProperty("--gradient-soft", "' + soft + '");';
}


// 保存设置到数据库
ipcMain.handle('saveBackgroundSettings', async (event, key, value) => {
    try {
        db.prepare(`
            INSERT INTO settings (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) 
            DO UPDATE SET value = excluded.value
        `).run(key, value);  // 插入或更新
        console.log(`设置保存成功: ${key} = ${value}`);
    } catch (error) {
        console.error('保存设置失败:', error);
    }
});

// 背景亮度 → 遮罩不透明度：0 最暗(遮罩最强) → 100 最亮(遮罩最弱，图片最清晰)
// 默认 50 → 不透明度 0.5；两者主题共用同一映射，避免浅色模式强制高遮罩导致背景「白蒙蒙」
function brightnessToOpacity(v) {
    const n = parseFloat(v);
    if (isNaN(n)) return 0.5; // 未设置时默认
    return Math.min(1, Math.max(0, 1 - n / 100));
}

// 改写为异步函数
async function loadBackgroundSettings() {
    try {
        const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('backgroundImage', 'themeMode', 'accentColor', 'glassEnabled', 'backgroundBrightness', 'backgroundHidden', 'colorTemp')").all();
        // 格式化数据为 key-value 对，并合并默认值（首次使用库里尚无记录时仍返回完整字段）
        const result = rows.reduce((acc, row) => {
            acc[row.key] = row.value;
            return acc;
        }, {});
        return Object.assign({ themeMode: 'light', accentColor: '#7c83ff', backgroundImage: null, glassEnabled: false, backgroundBrightness: 50, backgroundHidden: false, colorTemp: 'warm' }, result); // 返回数据（含默认）
    } catch (err) {
        console.error(err);
        return {};  // 出现错误时返回空对象
    }
}

// 监听渲染进程请求
ipcMain.handle('loadBackgroundSettings', async (event) => {
     // 调用函数获取背景设置
    return event.returnValue = await loadBackgroundSettings();  // 将数据返回给渲染进程
});


// 打开文件选择对话框
ipcMain.handle('selectBackgroundFile', async (event, currentPath) => {
    // 默认打开：上次所选背景图所在目录；无背景图时默认打开 C 盘根目录
    let defaultPath = process.platform === 'win32' ? 'C:\\' : app.getPath('home');
    if (currentPath) {
        const dir = path.dirname(currentPath);
        if (fs.existsSync(dir)) defaultPath = dir;
    }
    return await dialog.showOpenDialog({
        properties: ['openFile'],  // 允许选择文件
        defaultPath,
        filters: [{name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']}]
    });  // 返回选择的文件路径
});

// 加载背景设置
async function loadBackground(mainWindow) {
    try {
        // 请求加载背景设置
        const settings = await loadBackgroundSettings();
        const themeMode = settings.themeMode || 'light';
        const colorTemp = settings.colorTemp || 'warm';
        const accentJs = buildAccentInject(settings.accentColor);
        const isLight = themeMode === 'light';
        const isCool = colorTemp === 'cool';
        const baseRGB = isCool
            ? (isLight ? '244, 246, 250' : '16, 18, 24')
            : (isLight ? '250, 250, 250' : '23, 23, 24');
        let backgroundValue;
        const bgHidden = settings.backgroundHidden === true || settings.backgroundHidden === 'true' || settings.backgroundHidden === '1';
        if (settings.backgroundImage && !bgHidden) {
            // 按亮度滑块计算遮罩不透明度（浅色/深色共用映射）
            const effOpacity = brightnessToOpacity(settings.backgroundBrightness);
            const overlayColor = `rgba(${baseRGB}, ${effOpacity})`;
            // 背景图用 local:// 协议（同源），避免 file:// 在 local:// 页面下被 Chromium 拦截不显示。
            // 与 preload 的 backgroundImageToURL 保持一致的编码（按 / 分段 encodeURIComponent）。
            const bgUrl = 'local://app/bg-image/' +
                String(settings.backgroundImage).replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
            backgroundValue = `linear-gradient(${overlayColor}, ${overlayColor}), url('${bgUrl}')`;
        } else {
            // 无背景图时使用不透明纯色，避免半透明遮罩叠加在窗口底层产生灰黑
            backgroundValue = `rgb(${baseRGB})`;
        }
        // 设置背景样式与主题模式（浅色模式加 theme-light 类，冷白加 theme-cool 类）
        mainWindow.webContents.executeJavaScript(`
            document.body.style.background = ${JSON.stringify(backgroundValue)};
            document.body.style.backgroundSize = "cover";
            document.body.style.backgroundRepeat = "no-repeat";
            document.body.style.backgroundPosition = "center";
            document.body.classList.toggle('theme-light', ${isLight});
            document.body.classList.toggle('theme-cool', ${isCool});
            ${accentJs}
        `);
    } catch (err) {
        global.Notify(false, `加载背景设置时出错\n${err}`);
    }
}

ipcMain.handle('restoreDefaultBackgroundSettings', async () => {
    try {
        // 默认背景图片路径
        const defaultBackgroundImage = null;

        // 更新数据库
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('backgroundImage', defaultBackgroundImage);
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('themeMode', 'light');

        console.log('已恢复默认背景设置');
    } catch (error) {
        console.error('恢复默认背景设置失败:', error);
    }
});

module.exports = { loadBackground };

