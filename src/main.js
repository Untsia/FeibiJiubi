// 解决 Windows 控制台中文乱码：启动前将控制台代码页切换为 UTF-8（覆盖直接 electron . 启动的场景，npm start 已在脚本前置 chcp 65001）
if (process.platform === 'win32') {
  try { require('child_process').execSync('chcp 65001 > nul', { stdio: 'ignore' }); } catch (e) {}
}

const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell } = require('electron');
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


const { initializeDatabase, getSetting, setSetting} = require('./core/app/database');
const gotTheLock = app.requestSingleInstanceLock();


let tray = null;
let mainWindow;
global.mainWindow = mainWindow; // 将 mainWindow 保存在全局对象中
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
                // mainWindow.hide();
                mainWindow.destroy();  // 销毁窗口并释放资源
                mainWindow = null; // 清除引用
                global.mainWindow = null;  // 清除全局引用
                // isWindowVisible = false;
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
        width: 1250,
        height: 700,
        minWidth: 1000,
        minHeight: 600,
        backgroundColor: '#1e1e1e',
        icon: path.join(__dirname, 'assets', 'icon.ico'),
        webPreferences: {
            sandbox: false,
            preload: path.join(__dirname, 'preload.js'), // 指定 preload 脚本
            contextIsolation: true,
            enableRemoteModule: false,
            nodeIntegration: false
        },
        frame: false
    });
    mainWindow.loadFile('src/renderer/index.html');
    loadBackground(mainWindow);

    // 定义后全局导出 mainWindow
    global.mainWindow = mainWindow; // 更新global.mainWindow
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('set-app-path', app.getAppPath());
    });
    // mainWindow.on('minimize', () => {
    //     isWindowVisible = false;
    // });
    // mainWindow.on('restore', () => {
    //     isWindowVisible = true;
    // });
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
require('./core/app/appIPC');
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
