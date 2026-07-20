const {db} = require('../../app/database');
const {ipcMain, dialog } = require('electron');

// 自定义主色衍生计算（与渲染进程 settings.js 保持一致）
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

// 根据已保存的主色生成注入页面的 JS（设置 :root 主题变量）

// 根据已保存的主色生成注入页面的 JS（设置 :root 主题变量）

function buildAccentInject(accentColor) {
    if (!accentColor) return '';
    const rgb = hexToRgb(accentColor);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    const h = hsl[0], s = hsl[1], l = hsl[2];
    const hover = hslToRgb(h, s, Math.max(l - 0.12, 0.18));
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
        'document.documentElement.style.setProperty("--gradient-primary", "linear-gradient(135deg, "' + accentColor + '" 0%, "' + a2 + '" 100%)");' +
        'document.documentElement.style.setProperty("--gradient-soft", "linear-gradient(135deg, rgba(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ', 0.18), rgba(' + accent2.r + ', ' + accent2.g + ', ' + accent2.b + ', 0.18))");';
}


// 保存设置到数据库
ipcMain.handle('saveBackgroundSettings', async (event, key, value) => {
    try {
        await db.run(`
            INSERT INTO settings (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) 
            DO UPDATE SET value = excluded.value
        `, [key, value]);  // 插入或更新
        console.log(`设置保存成功: ${key} = ${value}`);
    } catch (error) {
        console.error('保存设置失败:', error);
    }
});

// 改写为异步函数
async function loadBackgroundSettings() {
    try {
        const rows = await new Promise((resolve, reject) => {
            db.all('SELECT key, value FROM settings WHERE key IN ("backgroundImage", "backgroundOpacity", "themeMode", "accentColor")', [], (err, rows) => {
                if (err) {
                    reject('加载背景设置失败:' + err);
                } else {
                    resolve(rows);
                }
            });
        });
        // 格式化数据为 key-value 对，并合并默认值（首次使用库里尚无记录时仍返回完整字段）
        const result = rows.reduce((acc, row) => {
            acc[row.key] = row.value;
            return acc;
        }, {});
        return Object.assign({ themeMode: 'dark', accentColor: '#7c83ff', backgroundOpacity: '0.5', backgroundImage: null }, result); // 返回数据（含默认）
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
ipcMain.handle('selectBackgroundFile', async () => {
    return await dialog.showOpenDialog({
        properties: ['openFile'],  // 允许选择文件
        filters: [{name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']}]
    });  // 返回选择的文件路径
});

// 加载背景设置
async function loadBackground(mainWindow) {
    try {
        // 请求加载背景设置
        const settings = await loadBackgroundSettings();
        const themeMode = settings.themeMode || 'dark';
        const bgOpacity = settings.backgroundOpacity || '0.5'; // 默认透明度
        const accentJs = buildAccentInject(settings.accentColor);
        const isLight = themeMode === 'light';
        const baseRGB = isLight ? '245, 246, 250' : '24, 26, 34'; // 浅色 #F5F6FA / 深色 #181A22，非纯白
        let backgroundValue;
        if (settings.backgroundImage) {
            // 浅色模式提高遮罩不透明度下限，避免背景图被冲成灰蒙蒙
            const effOpacity = isLight ? Math.max(parseFloat(bgOpacity), 0.8) : parseFloat(bgOpacity);
            const overlayColor = `rgba(${baseRGB}, ${effOpacity})`;
            const backgroundPath = settings.backgroundImage.replace(/\\/g, '/'); // 转换路径分隔符
            backgroundValue = `linear-gradient(${overlayColor}, ${overlayColor}), url('file://${backgroundPath}')`;
        } else {
            // 无背景图时使用不透明纯色，避免半透明遮罩叠加在窗口底层产生灰黑
            backgroundValue = `rgb(${baseRGB})`;
        }
        // 设置背景样式与主题模式（浅色模式加 theme-light 类）
        mainWindow.webContents.executeJavaScript(`
            document.body.style.background = ${JSON.stringify(backgroundValue)};
            document.body.style.backgroundSize = "cover";
            document.body.style.backgroundRepeat = "no-repeat";
            document.body.style.backgroundPosition = "center";
            document.body.classList.toggle('theme-light', ${isLight});
            ${accentJs}
        `);
    } catch (err) {
        global.Notify(false, `加载背景设置时出错\n${err}`);
    }
}

ipcMain.handle('restoreDefaultBackgroundSettings', async () => {
    try {
        // 默认背景图片路径和透明度
        const defaultBackgroundImage = null;
        const defaultOpacity = '0.5';  // 默认透明度

        // 更新数据库
        await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['backgroundImage', defaultBackgroundImage]);
        await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['backgroundOpacity', defaultOpacity]);
        await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['themeMode', 'dark']);

        console.log('已恢复默认背景设置');
    } catch (error) {
        console.error('恢复默认背景设置失败:', error);
    }
});

module.exports = { loadBackground };

