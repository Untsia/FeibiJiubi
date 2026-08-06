// 解决 Windows 控制台中文乱码：启动前将控制台代码页切换为 UTF-8（覆盖直接 electron . 启动的场景，npm start 已在脚本前置 chcp 65001）
if (process.platform === 'win32') {
  try { require('child_process').execSync('chcp 65001 > nul', { stdio: 'ignore' }); } catch (e) {}
}

const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, screen } = require('electron');
const path = require('path');
const axios = require('axios');

// 语义化版本比较：a > b 返回 1，a < b 返回 -1，相等返回 0
function compareVersion(a, b) {
    const pa = String(a == null ? '' : a).split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b == null ? '' : b).split('.').map(n => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na > nb) return 1;
        if (na < nb) return -1;
    }
    return 0;
}
// 启用 GPU 光栅化，让 backdrop-filter 模糊与动画在 GPU 上合成，提升流畅度（不改变任何视觉）
app.commandLine.appendSwitch('--enable-gpu-rasterization');
//在调用database前设置
require('./core/app/settings/dataFile');
require("./core/app/console");  // 导入日志管理
require('./core/services/syncMessage'); //导入消息通知

// 全局异常捕获：防止单个未捕获错误导致整个应用静默崩溃，统一写入日志文件
process.on('uncaughtException', (err) => {
    console.error('[FATAL] uncaughtException:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] unhandledRejection:', reason && reason.stack ? reason.stack : reason);
});


const { initializeDatabase, getSetting, setSetting} = require('./core/app/database');
const gotTheLock = app.requestSingleInstanceLock();


let tray = null;
let mainWindow;
let closeActionSetting = 'exit';


function createTray() {
    const iconPath = path.join(__dirname, 'assets', 'icon.ico'); // 使用绝对路径
    tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
        { label: '退出应用', click: () => {
            tray.destroy();  // 销毁托盘图标
            app.exit();      // 退出应用
        }}
    ]);
    tray.setToolTip('菲比啾比');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        if (!mainWindow) {
            createWindow();  // 如果主窗口未创建，则创建窗口
        } else {
            if (mainWindow.isVisible()) {
                mainWindow.destroy();  // 销毁窗口并释放资源
                mainWindow = null; // 清除引用
                global.mainWindow = null;  // 清除全局引用
            } else {
                mainWindow.show();
                mainWindow.focus();
            }
        }
    });
    global.tray = tray;
}


function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1081,
        height: 680,
        minWidth: 1000,
        minHeight: 600,
        backgroundColor: '#1e1e1e',
        icon: path.join(__dirname, 'assets', 'icon.ico'),
        show: false, // 先隐藏，定位完成后再显示，避免位置跳变闪烁
        webPreferences: {
            sandbox: false,
            preload: path.join(__dirname, 'preload.js'), // 指定 preload 脚本
            contextIsolation: true,
            enableRemoteModule: false,
            nodeIntegration: false
        },
        frame: false
    });
    // 定位：水平居中 + 垂直偏上
    // 注意：本机 Windows 开启 DPI 缩放时，screen 模块返回的是「物理像素」，
    // 而 BrowserWindow 的 x/y 用的是「逻辑像素」，两者不一致会把窗口推到右下。
    // 用 scaleFactor 还原为逻辑像素后再算，保证与窗口坐标同体系。
    const disp = screen.getPrimaryDisplay();
    const scale = disp.scaleFactor || 1;
    const sw = Math.round(disp.workAreaSize.width / scale);
    const sh = Math.round(disp.workAreaSize.height / scale);
    const winW = 1100, winH = 680;
    const x = Math.max(0, Math.round((sw - winW) / 2)); // 水平绝对居中
    // 窗口中心约落在屏幕高度 40% 处（偏上），可按需调整 0.40
    let y = Math.round(sh * 0.40 - winH / 2);
    if (y < 0) y = 0;
    if (y + winH > sh) y = Math.max(0, sh - winH);
    mainWindow.setBounds({ x, y, width: winW, height: winH });
    // DPI 适配：让 1 CSS 像素对应 scale 个物理像素，字体以原生密度渲染，
    // 避免高分屏（125%/150%/200%）下系统位图拉伸导致文字发虚。
    // 必须在 loadFile 之前设置，否则首次绘制仍会被缩放。
    if (scale !== 1) {
        mainWindow.webContents.setZoomFactor(scale);
    }
    mainWindow.loadFile('src/renderer/index.html');
    loadBackground(mainWindow);
    mainWindow.show();

    // 跨屏 DPI 变化适配：当显示器缩放比例改变（如拖到不同缩放的屏幕、
    // 或系统缩放设置变更）时，按新 scaleFactor 重设 zoomFactor，避免文字再次发虚。
    screen.on('display-metrics-changed', () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const newScale = screen.getPrimaryDisplay().scaleFactor || 1;
        if (newScale !== 1) {
            mainWindow.webContents.setZoomFactor(newScale);
        } else {
            mainWindow.webContents.setZoomFactor(1);
        }
    });

    // 定义后全局导出 mainWindow
    global.mainWindow = mainWindow; // 更新global.mainWindow
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('set-app-path', app.getAppPath());
    });
    mainWindow.on('close', (event) => {
        if (closeActionSetting === 'tray') {
            event.preventDefault();
            mainWindow.destroy();  // 销毁窗口并释放资源
            mainWindow = null; //清除引用
            global.mainWindow = null;  // 清除全局引用
        } else {
            mainWindow = null;  // 清除引用
            global.mainWindow = null;  // 清除全局引用
            app.quit();
        }
    });
}


ipcMain.handle("load-settings", async () => {
    const settings = {};
    const keys = ["closeAction", "gameRootDir"];
    const defaults = { closeAction: "exit", gameRootDir: "" };

    for (const key of keys) {
        settings[key] = await new Promise((resolve) => {
            getSetting(key, (err, value) => {
                if (err) {
                    console.error(`Error loading setting ${key}:`, err);
                    resolve(defaults[key] ?? "false");
                } else {
                    resolve(value && value !== "false" ? value : (defaults[key] ?? "false"));
                }
            });
        });
    }
    return settings;
});

ipcMain.handle("save-setting", (event, key, value) => {
    setSetting(key, value, (err) => {
        if (err) {
            console.error(`Error saving setting ${key}:`, err);
        } else {
            if (key === "closeAction") {
                closeActionSetting = value;
            }
        }
    });
});


// 窗口控制事件
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow.maximize();
    }
});
ipcMain.on('window-close', () => mainWindow.close());
async function initializeSettings() {
    closeActionSetting = await new Promise((resolve) => {
        getSetting("closeAction", (err, value) => {
            resolve(value === "tray" ? "tray" : "exit");
        });
    });

    createWindow();
    createTray();
}
if (!gotTheLock) {
    dialog.showErrorBox('菲比啾比 已运行', '应用已在运行，请检查喵。'); // 提示用户已有进程
    app.exit(); // 使用 app.exit 退出当前实例
}
require('./core/services/analysisGacha/analysisIpc'); // 引入分析相关的 IPC 逻辑
// 设置页面
const { loadBackground } = require('./core/services/settings/background');
// 页面功能
app.whenReady().then(() => {
    initializeDatabase();
    initializeSettings();
    module.exports = { createWindow };
});

ipcMain.on('open-external', (event, url) => {
    if (url) {
        shell.openExternal(url);
    }
});

// 当前应用版本（来自 package.json，electron-builder 打包后与之同步）
ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

// 检查 GitHub 最新发布版本，返回与当前版本的差异
ipcMain.handle('check-update', async () => {
    const repo = 'Untsia/FeibiJiubi';
    const currentVersion = app.getVersion();
    const releasesUrl = `https://github.com/${repo}/releases/latest`;
    const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
    try {
        const resp = await axios.get(apiUrl, {
            timeout: 12000,
            headers: {
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'feibijiubi'
            }
        });
        const data = resp.data || {};
        const latestVersion = String(data.tag_name || '').replace(/^v/i, '');
        const hasUpdate = latestVersion ? compareVersion(latestVersion, currentVersion) > 0 : false;
        return {
            success: true,
            currentVersion,
            latestVersion,
            hasUpdate,
            releaseUrl: data.html_url || releasesUrl,
            releaseNotes: data.body || '',
            publishedAt: data.published_at || ''
        };
    } catch (err) {
        return {
            success: false,
            error: (err && err.message) ? err.message : '网络请求失败',
            currentVersion,
            releaseUrl: releasesUrl
        };
    }
});

app.on('window-all-closed', () => {
    // 在托盘模式下不退出应用
    if (process.platform !== 'darwin' && !tray) {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
