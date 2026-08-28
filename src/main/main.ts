// 控制台中文编码：由 src/main/core/app/console.ts 按系统代码页（ACP）输出，配合 IDE/Windows
// 终端继承系统代码页（中文环境 936=GBK）的默认解码。不再执行 chcp 65001——
// IDE 内置终端直接读子进程字节流，忽略 chcp，且 chcp 与 console.ts 的字节输出若不一致
// 反而会制造乱码（UTF-8 字节被 GBK 解 → 锟斤拷）。
import { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, screen, protocol } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
// 保持与旧代码一致的副作用导入方式（模块内部通过 global/注册 side-effect 工作）
const axios = require('axios');

// 声明 local:// 为特权 scheme，并启用 supportFetchAPI，
// 否则渲染进程内的 fetch() 会报 "URL scheme 'local' is not supported"。
if (typeof protocol.registerSchemesAsPrivileged === 'function') {
    protocol.registerSchemesAsPrivileged([
        { scheme: 'local', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
    ]);
}

// P5 运行时对抗：反调试 + 完整性探针（必须在 app 事件注册前安装）
require('./core/security/selfcheck').installSelfCheck();

// Windows 任务栏分组与通知归属：设置 AppUserModelID 需与 package.json build.appId 一致，
// 否则托盘/通知可能不显示、任务栏图标分组错乱（尤其 NSIS 安装版）。
try { app.setAppUserModelId('com.feibijiubi.app'); } catch (e) { /* 非 Windows 平台忽略 */ }

// Electron 代码目录解析：
//   - dev（npm start）：项目根/package.json 的 main=.build/src/main/main.js，app.getAppPath() = 项目根
//       → appCodeDir() = <appPath>/.build/src
//   - 安装构建：main=.build/src/main/main.js，app.getAppPath() = asar 根
//       → appCodeDir() = <appPath>/.build/src
//
// 不要依赖 __dirname：会在混淆/编译场景下被固化为构建机本地绝对路径，
// 否则 preload/assets/local:// 协议全部找错位置，表现为 win-unpacked 启动后：
//   createTray Failed to load image、preload.js Cannot find module、
//   local://app/index.html ERR_FILE_NOT_FOUND → 纯色白屏，按钮全死。
function appCodeDir(): string {
  try {
    const base = path.resolve(app.getAppPath());
    let pkg = null;
    try {
      const raw = fs.readFileSync(path.join(base, 'package.json'), 'utf8');
      pkg = JSON.parse(raw);
    } catch (_) { pkg = null; }
    const mainEntry = (pkg && typeof pkg.main === 'string') ? pkg.main : 'main.js';
    const resolved = path.resolve(base, mainEntry);
    const dir = path.dirname(resolved);
    try {
      if (fs.existsSync(path.join(dir, 'main.js')) || fs.existsSync(path.join(dir, 'main.jsc'))) {
        return dir;
      }
    } catch (_) {}
    return dir;
  } catch (_) {
    try { return path.resolve(__dirname); } catch (_2) { return process.cwd(); }
  }
}
const ASSETS_DIR = (): string => path.join(appCodeDir(), 'assets');
const RENDERER_DIR = (): string => path.join(appCodeDir(), 'renderer');
// 背景图路由允许返回的扩展名白名单（与 selectBackgroundFile 的文件筛选保持一致）。
const ALLOWED_IMAGE_EXT: ReadonlySet<string> = new Set([
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp',
]);
// 版本号 package.json 读取：appCodeDir() = <根>/.build/src/main（dev 与安装包一致），
// 项目根/asar 根 = codeDir 上三级（../../../package.json）；另外显式兜底 app 根。
// 不加这一级的话，dev 下（app.getAppPath() 指向 .build/src/main，无 package.json）
// 三个旧候选全部落空，app.getVersion() 会回退返回 Electron 自身版本号（如 44.0.0）。
function _readAppVersion(): string {
    const codeDir = appCodeDir();
    const candidates = [
        path.resolve(codeDir, '..', '..', '..', 'package.json'),
        path.resolve(codeDir, '..', '..', 'package.json'),
        path.resolve(codeDir, '..', 'package.json'),
        path.resolve(codeDir, 'package.json'),
    ];
    let version = null;
    for (const p of candidates) {
        try {
            const raw = fs.readFileSync(p, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && parsed.version) { version = parsed.version; break; }
        } catch (_) {}
    }
    if (!version) {
        try { version = app.getVersion(); } catch (_) { version = '未知版本'; }
    }
    return version;
}

// 语义化版本比较：a > b 返回 1，a < b 返回 -1，相等返回 0
function compareVersion(a: any, b: any): number {
    const pa = String(a == null ? '' : a).split('.').map((n: string) => parseInt(n, 10) || 0);
    const pb = String(b == null ? '' : b).split('.').map((n: string) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na > nb) return 1;
        if (na < nb) return -1;
    }
    return 0;
}
// 启用 GPU 硬件加速，让 renderer 动画/合成在 GPU 上完成，提升流畅度（不改变任何视觉）
app.commandLine.appendSwitch('--enable-gpu-rasterization');   // GPU 光栅化
app.commandLine.appendSwitch('--enable-gpu-compositing');     // 强制 GPU 合成
app.commandLine.appendSwitch('--ignore-gpu-blocklist');       // 忽略 GPU 黑名单（集显/老显卡也能启用）
// 强制启用 Electron 日志文件：生产安装版（打包后）没有 console 输出，
// 只有通过 --enable-logging / --log-file 才能把主进程的
// console.warn/error、preload require 异常、loader 失败堆栈
// 落到磁盘上。这对"窗口有了但按钮点不动/空白"的疑难排查是必须的。
// 默认关闭时会把这些关键信息全吞掉，跟静默白屏一样没处定位。
if (process.env.FEIBIJIUBI_VERBOSE !== '0') {
    try { app.commandLine.appendSwitch('enable-logging', '--v=1'); } catch (_) {}
}
// 最小化原生弹窗：生产包在未捕获致命异常时调用 showErrorBox，
// 不要在 DPI 缩放/无屏幕环境下尝试截图/截图失败。此处保留默认弹窗即可。
// 统一用户数据根目录：npm start（dev）下 Electron 默认把 userData 放在 %APPDATA%\Electron，
// 打包安装版则是 %APPDATA%\feibijiubi —— 同一应用两个根目录，数据库/设置/头像全部分家，
// 就出现「npm start 有数据、安装版没数据、要重新获取」的现象。
// 这里在 dataFile.ts 之前强制统一，双环境共享同一份数据。
try {
  app.setPath('userData', path.join(app.getPath('appData'), 'feibijiubi'));
} catch (_) {}
//在调用database前设置
require('./core/app/settings/dataFile');
require('./core/app/console');  // 导入日志管理
// P3/P4 原生核心模块（Rust/N-API 编译，含核心算法与 AES 底座；缺失时降级不崩）。
// 放在 console.ts 之后加载，确保失败告警也走 console.ts 的系统代码页输出（避免 UTF-8 乱码）。
try {
  require('../feibijiubi_core.node');
} catch (e) {
  console.warn('[native] 核心原生模块未加载（开发模式或构建产物缺失）：', (e as Error).message);
}
require('./core/services/syncMessage'); //导入消息通知

// 全局异常捕获：防止单个未捕获错误导致整个应用静默崩溃，统一写入日志文件。
// 按错误性质分类处理：已知可恢复/退出流程中的噪声告警记为 WARN，不中断运行；
// 真正的未知异常才记 FATAL。避免把网络波动、渲染进程退出等正常情况误报成致命错误。
function classifyRuntimeError(context: string, err: any): void {
    const raw = err && err.message != null ? err.message : (err || '');
    const s = String(raw);
    // 网络层瞬时错误：抽卡请求超时/断连/重试，属可预期噪声
    const networkCodes = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH',
        'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ERR_NETWORK', '502', '503', '504'];
    // 数据库连接已关闭：多发生在窗口销毁/进程退出时仍有残留异步回调触发，非业务缺陷
    const sqliteClosed = /database is closed|SQLITE_MISUSE/i.test(s);
    // 原生核心模块缺失/加载失败（开发或精简产物场景），已在加载处单独捕获，此处仅兜底
    const nativeMissing = err && /feibijiubi_core\.node|Cannot find module/i.test(s);
    if (networkCodes.some(c => s.includes(c)) || sqliteClosed || nativeMissing) {
        console.warn(`[WARN][${context}] 可忽略异常：${s}`, err && err.stack ? err.stack : '');
        return;
    }
    console.error(`[FATAL] ${context}:`, err && err.stack ? err.stack : err);
}

process.on('uncaughtException', (err) => {
    classifyRuntimeError('uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
    classifyRuntimeError('unhandledRejection', reason);
});

const { initializeDatabase, getSetting, setSetting } = require('./core/app/database');
const gotTheLock = app.requestSingleInstanceLock();

let tray: any = null;
let mainWindow: any = null;
let closeActionSetting: string = 'exit';
// 跟踪窗口最大化状态：frameless(无边框) 窗口在 Windows 上 isMaximized() 时常失真，
// 导致第二次点击最大化按钮时被误判为「未最大化」而重复 maximize()，表现为无法缩小。
// 改由事件驱动记录真实状态，双击标题栏 / 按钮最大化的场景都能准确同步。
let isWinMaximized: boolean = false;

function createTray(): void {
    const iconPath = path.join(ASSETS_DIR(), 'icon.ico');
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

async function createWindow(): Promise<void> {
    // 首帧底色按实际主题 + 色温匹配，与页面 body 背景一致，
    // 避免固定深色 backgroundColor 在浅色主题下造成"闪黑屏"
    const themeMode = getSetting('themeMode');
    const colorTemp = getSetting('colorTemp');
    const isCool = colorTemp === 'cool';
    const initBgColor = themeMode === 'dark'
        ? (isCool ? '#101218' : '#171718')
        : (isCool ? '#f4f6fa' : '#fafafa');
    mainWindow = new BrowserWindow({
        width: 1081,
        height: 680,
        minWidth: 1000,
        minHeight: 600,
        backgroundColor: initBgColor,
        icon: path.join(ASSETS_DIR(), 'icon.ico'),
        show: false, // 先隐藏，定位完成后再显示，避免位置跳变闪烁
        webPreferences: {
            sandbox: false,
            // preload 必须跟随 appCodeDir（打包后 asar 内的 .build/src），
            // 不能用 __dirname：编译/混淆场景会把 __dirname 固化为构建机路径，
            // 导致安装版找不到 preload.js → preload 桥 electronAPI 完全不存在，
            // renderer.js 访问 window.electronAPI.xxx 全部抛 TypeError，
            // 表现为「首帧只有 backgroundColor、UI 不渲染、按钮死无响应」。
            preload: path.join(appCodeDir(), 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        frame: false
    });
    // 定位：优先恢复上次记忆的窗口位置与尺寸（创新-9 窗口尺寸记忆）；
    // 无记忆时水平居中 + 垂直偏上。
    // 注意：本机 Windows 开启 DPI 缩放时，screen 模块返回的是「物理像素」，
    // 而 BrowserWindow 的 x/y 用的是「逻辑像素」，两者不一致会把窗口推到右下。
    // 用 scaleFactor 还原为逻辑像素后再算，保证与窗口坐标同体系。
    let savedBounds: any = null;
    try {
        const v = getSetting('windowBounds');
        if (v && v !== 'false') {
            try { savedBounds = JSON.parse(v); } catch (_) { savedBounds = null; }
        }
    } catch (_) { savedBounds = null; }
    const disp = screen.getPrimaryDisplay();
    const scale = disp.scaleFactor || 1;
    const sw = Math.round(disp.workAreaSize.width / scale);
    const sh = Math.round(disp.workAreaSize.height / scale);
    let bounds: any;
    if (savedBounds && typeof savedBounds.width === 'number' && typeof savedBounds.height === 'number') {
        // 钳制到当前工作区内（显示器变更/分辨率调整后窗口不跑出屏幕）
        const w = Math.max(1000, Math.min(savedBounds.width, sw));
        const h = Math.max(600, Math.min(savedBounds.height, sh));
        const x = Math.max(0, Math.min(typeof savedBounds.x === 'number' ? savedBounds.x : Math.round((sw - w) / 2), sw - w));
        const y = Math.max(0, Math.min(typeof savedBounds.y === 'number' ? savedBounds.y : Math.round(sh * 0.40 - h / 2), sh - h));
        // 兜底：若记忆尺寸几乎覆盖整个工作区，说明是历史版本在最大化状态下误存的
        // 全屏边界（如 {-8,-8,2576,1408}），不应作为「正常尺寸」恢复，否则窗口一启动就全屏，
        // 且「缩小」后仍接近全屏。此类坏数据直接忽略，回退到默认尺寸。
        if (w >= sw - 4 && h >= sh - 4) {
            bounds = null;
        } else {
            bounds = { x, y, width: w, height: h };
        }
    } else {
        bounds = null;
    }
    if (!bounds) {
        const winW = 1100, winH = 680;
        const x = Math.max(0, Math.round((sw - winW) / 2)); // 水平绝对居中
        // 窗口中心约落在屏幕高度 40% 处（偏上），可按需调整 0.40
        let y = Math.round(sh * 0.40 - winH / 2);
        if (y < 0) y = 0;
        if (y + winH > sh) y = Math.max(0, sh - winH);
        bounds = { x, y, width: winW, height: winH };
    }
    mainWindow.setBounds(bounds);
    // 记忆窗口位置与尺寸：resize/move 防抖落盘，重启后恢复（设置表 windowBounds）
    let _boundsTimer: any = null;
    const scheduleSaveBounds = () => {
        clearTimeout(_boundsTimer);
        _boundsTimer = setTimeout(() => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            // 最大化/全屏状态下不覆盖记忆的「正常尺寸」：否则会把全屏边界
            // (x/y 为负、占满工作区) 误存成 normal 尺寸，导致下次启动或还原时仍全屏。
            if (mainWindow.isMaximized() || mainWindow.isFullScreen()) return;
            const b = mainWindow.getBounds();
            try { setSetting('windowBounds', JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height })); } catch (_) {}
        }, 400);
    };
    mainWindow.on('resize', scheduleSaveBounds);
    mainWindow.on('move', scheduleSaveBounds);
    // 每次(重新)创建窗口，重置最大化状态为「未最大化」，
    // 避免托盘 destroy/重建窗口时残留上一次的最大化标志导致误判。
    isWinMaximized = false;
    // 同步「最大化」真实状态：无论通过按钮(ipc)还是双击标题栏(drag region)触发，
    // 都经此处准确记录，供 window-maximize 切换时判断，避免 frameless 下 isMaximized() 失真。
    mainWindow.on('maximize', () => { isWinMaximized = true; });
    mainWindow.on('unmaximize', () => { isWinMaximized = false; });
    // DPI 适配：让 1 CSS 像素对应 scale 个物理像素，字体以原生密度渲染，
    // 避免高分屏（125%/150%/200%）下系统位图拉伸导致文字发虚。
    // 必须在 loadURL 之前设置，否则首次绘制仍会被缩放。
    if (scale !== 1) {
        mainWindow.webContents.setZoomFactor(scale);
    }
    // 禁用 HTTP 磁盘缓存：Electron 在 local:// 协议下以「文件路径」作为缓存 key 并忽略
    // query string，导致 CSS 的 ?v= 缓存破坏失效（旧样式一直被复用，改 CSS 不生效）。
    // 开发/更新期必须始终加载最新样式与脚本，故对本地资源一律 no-store。
    try {
        const ses = mainWindow.webContents.session;
        if (ses && typeof ses.webRequest !== 'undefined') {
            ses.webRequest.onHeadersReceived((details: any, callback: any) => {
                const headers = Object.assign({}, details.responseHeaders);
                headers['Cache-Control'] = ['no-store, no-cache, must-revalidate, max-age=0'];
                headers['Pragma'] = ['no-cache'];
                callback({ responseHeaders: headers });
            });
        }
    } catch (e) { /* 忽略缓存配置异常 */ }
    // 开发期渲染进程调试日志：仅未打包（npm start）时写入系统日志目录，避免把
    // 本机开发绝对路径（如 E:\test\...）硬编码进生产包，也避免生产环境每行 console 落盘。
    // 但「did-fail-load / did-finish-load / unresponsive / crashed」这四类对排障
    // 是刚需的，打包版也统一写入（使用安全的 relative 路径，不外泄本机绝对路径）。
    const wc = mainWindow.webContents;
    const appendProdLog = (tag: string, line: any): void => {
        const safe = String(tag) + ' ' + String(line).slice(0, 6144);
        try {
            const logPath = path.join(app.getPath('logs'), 'feibijiubi-renderer.log');
            fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${safe}\n`);
        } catch (_) {}
    };
    if (!app.isPackaged) {
        const appendDebug = (line: string): void => { try { fs.appendFileSync(path.join(app.getPath('logs'), 'renderer-debug.log'), line); } catch (_) {} };
        wc.on('console-message', (event: any) => { appendDebug(`[r:${event.level}] ${event.message}\n`); });
        wc.on('did-fail-load', (_e: any, code: any, desc: any, url: any) => { appendDebug(`[fail-load] ${code} ${desc} ${url}\n`); });
    } else {
        // 打包版：**完整**把 renderer 的 console 全部转写到 feibijiubi-renderer.log。
        // 之前只记录 did-fail-load，导致内容区空白的真因（loadPage fetch 异常、
        // gachaWuwaInit 错误、视图脚本异常）全部丢进黑洞，用户只能看到「直接白屏」。
        // 这里改用 webContents.on('console-message') 的新单参签名：event.args / event.level。
        wc.on('console-message', (event: any) => {
            try {
                const args = Array.isArray(event.args) ? event.args : [];
                const msg = args.map(String).join(' ').slice(0, 2048);
                if (msg.length === 0) return;
                const level = String(event.level || 'info');
                // 生产日志只收：error / warning / 包含诊断标记的 info。
                // 诊断标记（[LIFE]/[GT]/[ERR]）专门用来打异步初始化链路，量极小。
                const isDiagnosticInfo = (level === 'info' || level === 'verbose') &&
                    /\[(LIFE|GT|ERR|ASSERT|INIT|VIEW)\]/.test(msg);
                if (level !== 'error' && level !== 'warning' && !isDiagnosticInfo) return;
                appendProdLog(`[console:${level}]`, msg);
            } catch (_) {}
        });
        wc.on('did-fail-load', (_e: any, code: any, desc: any, url: any) => appendProdLog('[fail-load]', `c=${code} d=${desc} u=${url}`));
    }
    wc.on('did-finish-load', () => appendProdLog('[finish-load]', 'loaded ' + (wc.getURL && wc.getURL() || '')));
    wc.on('unresponsive', () => appendProdLog('[unresponsive]', 'renderer hang'));
    wc.on('crashed', (_e: any, killed: any) => appendProdLog('[crashed]', killed ? 'killed' : 'crashed'));
    wc.on('render-process-gone', (_e: any, detail: any) => appendProdLog('[render-gone]', (detail && detail.reason) || 'unknown'));
    // 新增：dom-ready 后分两阶段强制把关键 DOM 状态 + 可见性/命中测试回写主进程日志。
    // T+300ms 捕捉初始化；T+3500ms 再抓一次，覆盖 gameToolsInit 异步拉 6 个视图 & gachaWuwaInit
    // 的延迟，判断「用户体感内容区空白」到底是 DOM 没来 / 透明 / 被遮罩覆盖 / 按钮没绑事件。
    function buildSnapshotCode(tag: string): string {
        // 注意：executeJavaScript 的字符串里用函数传参极易因 IIFE 闭包+引号导致 tag 丢失，
        // 这里直接把 tag 字面量嵌入到 JS 字符串中，避免 ReferenceError。
        const tagLiteral = JSON.stringify(String(tag || ''));
        return `(function(){try{
var TAG=${tagLiteral};
var c=document.getElementById('content');
var uid=document.getElementById('uid-dropdown');
var view=document.getElementById('view-intuitive');
var scripts=[].map.call(document.querySelectorAll('script[data-page]'),function(s){return s.getAttribute('data-page')}).slice(0,20);
function rect(id){try{var el=document.getElementById(id);if(!el)return null;var r=el.getBoundingClientRect();var cs=getComputedStyle(el);return {id:id,visible:!(el.offsetParent===null && el.tagName!=='HTML'),display:cs.display,visibility:cs.visibility,opacity:cs.opacity,zIndex:cs.zIndex,pointerEvents:cs.pointerEvents,hidden:el.hasAttribute('hidden'),rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)},listeners:{click:Number(el.getAttribute && el.getAttribute('data-on-click')==='1')}};}catch(e){return {id:id,err:String(e.message)};}}
function pointHit(x,y){try{var el=document.elementFromPoint(x,y);if(!el)return null;function path(n){var out=[];while(n && n.nodeType===1){out.unshift(n.tagName.toLowerCase()+(n.id?('#'+n.id):'')+(n.className && n.className.trim?('.'+String(n.className.trim()).split(/\\s+/).slice(0,2).join('.')):''));n=n.parentElement;}return out.join(' < ');}return {x:x,y:y,hitTag:el.tagName,hitId:el.id,hitClass:(el.className||'').toString().slice(0,80),path:path(el).slice(0,260)};}catch(e){return {x:x,y:y,err:String(e.message)};}}
function centerOf(r){if(!r||!r.rect)return null;var re=r.rect;return {x:Math.round(re.x+re.w/2),y:Math.round(re.y+re.h/2)};}
var contentRect=rect('content');
var hitCenter=null;
if(contentRect && contentRect.rect){var rx=contentRect.rect.x+contentRect.rect.w/2,ry=contentRect.rect.y+contentRect.rect.h/2;hitCenter=pointHit(Math.round(rx),Math.round(ry));}
var mr=rect('minimize'),xr=rect('maximize'),cr=rect('close');
var mc=centerOf(mr),xc=centerOf(xr),cc=centerOf(cr);
return JSON.stringify({
  tag:TAG,
  winSize:{w:window.innerWidth,h:window.innerHeight},
  contentChildCount:c?c.children.length:-1,
  contentHtmlStart:c?(c.innerHTML||'').slice(0,250):'',
  uidExists:!!uid,
  viewExists:!!view,
  pageScripts:scripts,
  bodyScriptCount:document.body.querySelectorAll('script').length,
  allScripts:[].map.call(document.querySelectorAll('script[src]'),function(s){try{var u=new URL(s.src,location.href);return u.pathname.replace(/^.*\\/renderer\\//,'').replace(/^.*\\/resources\\/app\\.asar\\.build\\/src\\/renderer\\//,'');}catch(e){return (s.src||'').slice(0,120);}}).slice(0,20),
  content:contentRect,
  titlebar:{min:mr,max:xr,close:cr,hitMin:mc?pointHit(mc.x,mc.y):null,hitMax:xc?pointHit(xc.x,xc.y):null,hitClose:cc?pointHit(cc.x,cc.y):null},
  contentCenterHit:hitCenter,
  views:{intuitive:!!document.getElementById('view-intuitive'),tapCount:!!document.getElementById('view-tap-count'),char:!!document.getElementById('view-character'),star:!!document.getElementById('view-star'),trend:!!document.getElementById('view-trend'),banners:document.querySelectorAll('.banner-card,.gacha-banner').length,children:[].map.call(document.querySelectorAll('.analysis-view'),function(v){return v.id+'|'+(v.classList.contains('active')?'active':'idle')+'|child'+v.children.length;}).slice(0,10)},
  electronAPI:{hasMin:typeof (window.electronAPI && window.electronAPI.minimizeWindow)==='function',hasMax:typeof (window.electronAPI && window.electronAPI.maximizeWindow)==='function',hasClose:typeof (window.electronAPI && window.electronAPI.closeWindow)==='function',hasDb:typeof (window.electronAPI && window.electronAPI.getSetting)==='function'}
});
}catch(e){return JSON.stringify({tag:${tagLiteral},err:String(e && e.message),stack:String(e && e.stack||'')})}})();`;
    }
    function snapshotDom(tag: string): void {
        if (wc.isDestroyed()) return;
        wc.executeJavaScript(buildSnapshotCode(tag)).then(function (json: any) {
            appendProdLog('[dom-state]', json);
        }).catch(function (e: any) { appendProdLog('[dom-state-err]', String(e && e.message)); });
    }
    wc.once('dom-ready', () => {
        // DOM 诊断快照是排查「内容区空白」时期的遗留手段，会向页面注入两轮全量 DOM 探测
        // 并把结果写进用户日志目录。生产包无需承担这份开销，默认只在开发模式执行；
        // 需要在线上复现问题时设 FEIBIJIUBI_VERBOSE=1 单独开启。
        const verbose = !app.isPackaged || process.env.FEIBIJIUBI_VERBOSE === '1';
        if (!verbose) return;
        setTimeout(function () { snapshotDom('t+300ms'); }, 300);
        setTimeout(function () { snapshotDom('t+3500ms'); }, 3500);
    });
    mainWindow.loadURL(process.env.FBI_DEV_URL || 'local://app/index.html');
    loadBackground(mainWindow);
    // 等待页面完成首次绘制后再显示窗口：loadURL 后立即 show() 会在首帧尚未
    // 渲染时就把窗口弹出来，只会显示 backgroundColor 深色 → 启动闪黑屏。
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // 跨屏 DPI 变化适配：当显示器缩放比例改变（如拖到不同缩放的屏幕、
    // 或系统缩放设置变更）时，按新 scaleFactor 重设 zoomFactor，避免文字再次发虚。
    // 注意：在 createWindow 内注册会导致每次重建窗口（托盘重开）都叠加一个监听器，
    // 造成事件累积；因此该全局监听只在此处（单实例创建流程）注册一次。
    if (!global.__dpiListenerBound) {
        global.__dpiListenerBound = true;
        screen.on('display-metrics-changed', () => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            const newScale = screen.getPrimaryDisplay().scaleFactor || 1;
            mainWindow.webContents.setZoomFactor(newScale !== 1 ? newScale : 1);
        });
    }

    // 定义后全局导出 mainWindow
    global.mainWindow = mainWindow; // 更新global.mainWindow
    mainWindow.on('close', (event: any) => {
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

ipcMain.handle("load-settings", () => {
    const settings: Record<string, string> = {};
    const keys = ["closeAction", "gameRootDir"];
    const defaults: Record<string, string> = { closeAction: "exit", gameRootDir: "" };

    for (const key of keys) {
        try {
            const value = getSetting(key);
            settings[key] = value && value !== "false" ? value : (defaults[key] ?? "false");
        } catch (err) {
            console.error(`Error loading setting ${key}:`, err);
            settings[key] = defaults[key] ?? "false";
        }
    }
    return settings;
});

ipcMain.handle("save-setting", (event: any, key: string, value: any) => {
    // 写入白名单：与读取侧 load-settings 的 key 保持一致，避免任意 key 脏写 settings 表
    const allowedKeys = ["closeAction", "gameRootDir"];
    if (!allowedKeys.includes(key)) return;
    try {
        setSetting(key, value);
        if (key === "closeAction") {
            closeActionSetting = value;
        }
    } catch (err) {
        console.error(`Error saving setting ${key}:`, err);
    }
});

// 窗口控制事件
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
    if (!mainWindow) return;
    if (isWinMaximized || mainWindow.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow.maximize();
    }
});
ipcMain.on('window-close', () => mainWindow.close());
function initializeSettings(): void {
    const value = getSetting("closeAction");
    closeActionSetting = value === "tray" ? "tray" : "exit";

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
    // 自定义 local:// 协议：把渲染资源（src/renderer）以同源方式提供，
    // 规避 file:// 协议下 Chromium 禁止 fetch 本地文件的同源策略限制
    // （否则页面用 fetch 加载 views/*.html、scripts/*.js 会被 CORS 拦截，
    //  导致主内容区空白、无数据、按钮切换无效）。
    //
    // rendererRoot 必须走 RENDERER_DIR()（= appCodeDir()/renderer），
    // 绝对不能用 path.join(__dirname, 'renderer')：
    //   编译/混淆场景下 __dirname 会被固化成构建机路径，
    //   安装到用户电脑后指向不存在目录 → 所有 renderer 请求都 404 →
    //   首帧只显示 backgroundColor 纯色、HTML/CSS/JS 全丢，就是用户看到的"白屏+按钮死"。
    const rendererRoot = RENDERER_DIR();
    const protocolLogPath = path.join(app.getPath('logs'), 'feibijiubi-local-protocol.log');
    const protocolLog = (line: string): void => {
        try { fs.appendFileSync(protocolLogPath, `[${new Date().toISOString()}] ${line}\n`); } catch (_) {}
    };
    // 启动时一次性写 rendererRoot 快照：生产包靠这行定位"为什么 all 404"，
    // 一旦发现记录的是构建机 E:\\... 路径，就可以立即确认是 __dirname 固化漏网。
    protocolLog(`[BOOT] rendererRoot=${rendererRoot} exists=${fs.existsSync(rendererRoot) ? '1' : '0'} appCodeDir=${appCodeDir()} packaged=${app.isPackaged ? '1' : '0'}`);

    if (typeof protocol.registerFileProtocol === 'function') {
        protocol.registerFileProtocol('local', (request: any, callback: any) => {
            try {
                const url = new URL(request.url);
                let p = decodeURIComponent(url.pathname);
                // 抽卡头像：local://app/avatars/<相对路径> -> <数据目录>/gacha_avatars/<相对路径>
                // 头像位于用户数据目录（rendererRoot 之外），单独放行并提供路径穿越防护。
                if (p.startsWith('/avatars/')) {
                    const avatarBase = path.join(process.env.FEIBIJIUBI_FOLDER_PATH || app.getPath('userData'), 'gacha_avatars');
                    const filePath = path.normalize(path.join(avatarBase, p.slice('/avatars/'.length)));
                    const rel = path.relative(avatarBase, filePath);
                    if (rel.startsWith('..') || path.isAbsolute(rel)) {
                        protocolLog(`[403] avatars path-traversal: ${p}`);
                        callback({ error: -3 });
                        return;
                    }
                    if (!fs.existsSync(filePath)) protocolLog(`[404] avatar ${p} -> ${filePath}`);
                    callback({ path: filePath });
                    return;
                }
                // 标题栏左上角品牌图标：index.html 的 src="../assets/icon.png" 在
                // local://app/ 下解析为 local://app/assets/icon.png，但图标位于 src/assets
                // （rendererRoot 之外），单独放行到 ASSETS_DIR/icon.png（固定路径，无穿越风险）。
                if (p === '/assets/icon.png') {
                    const iconPath = path.normalize(path.join(ASSETS_DIR(), 'icon.png'));
                    if (!fs.existsSync(iconPath)) protocolLog(`[404] icon ${iconPath}`);
                    callback({ path: iconPath });
                    return;
                }
                // 背景图：local://app/bg-image/<encodeURIComponent 分段 的绝对路径> -> 用户自定义背景图片。
                // 页面由 local://app/ 提供，返回 file:// 会被 Chromium 拦截「Not allowed to load local
                // resource」而无法显示；经本路由同源放行。路径必须是绝对路径（path.isAbsolute 校验）。
                if (p.startsWith('/bg-image/')) {
                    const bgPath = path.normalize(p.slice('/bg-image/'.length));
                    if (!path.isAbsolute(bgPath)) {
                        protocolLog(`[403] bg-image not absolute: ${p}`);
                        callback({ error: -3 });
                        return;
                    }
                    // 仅限图片扩展名：否则该路由可把磁盘上任意文件（数据库、密钥等）
                    // 当作图片内容返回给渲染进程。
                    if (!ALLOWED_IMAGE_EXT.has(path.extname(bgPath).toLowerCase())) {
                        protocolLog(`[403] bg-image not an image: ${p}`);
                        callback({ error: -3 });
                        return;
                    }
                    if (!fs.existsSync(bgPath)) protocolLog(`[404] bg-image ${bgPath}`);
                    callback({ path: bgPath });
                    return;
                }
                if (p === '/' || p === '') p = '/index.html';
                const filePath = path.normalize(path.join(rendererRoot, p));
                // 用 path.relative 做越界判断（与上面 avatars 分支保持一致）。
                // 原先的 startsWith 前缀判断可被 /../rendererX/evil.js 绕过：
                // 归一化后落在 rendererRoot 的兄弟目录，却仍满足前缀匹配。
                const relPath = path.relative(rendererRoot, filePath);
                if (relPath.startsWith('..') || path.isAbsolute(relPath)) {
                    protocolLog(`[403] renderer path-traversal: ${p} -> ${filePath}`);
                    callback({ error: -3 });
                    return;
                }
                // 生产包渲染资源 404 是致命事件（index.html、styles、scripts 任一丢都会白屏），
                // 必须把每次缺失都落到协议日志里，用户直接把这个文件贴出来就能定位。
                // 正常命中不写日志，避免用户日志目录爆炸。
                if (!fs.existsSync(filePath)) {
                    protocolLog(`[404] renderer ${p} -> ${filePath}`);
                    callback({ error: -6 }); // -6 = ERR_FILE_NOT_FOUND
                    return;
                }
                callback({ path: filePath });
            } catch (e: any) {
                protocolLog(`[500] exception url=${request.url} err=${e && e.message} stack=${e && e.stack}`);
                callback({ error: -2 });
            }
        });
    }

    initializeDatabase();
    initializeSettings();
    module.exports = { createWindow };
});

ipcMain.on('open-external', (event: any, url: string) => {
    if (url) {
        shell.openExternal(url);
    }
});

// 渲染进程致命错误回写：白屏、按钮点不动时，90% 场景是 renderer.js / 视图脚本
// 抛了未捕获异常但生产安装版没有 DevTools，只能靠这一条把错误落到主进程日志。
// preload.ts 暴露 window.electronAPI.reportRenderError，renderer 端
// window.onerror / unhandledrejection 统一走这里。
ipcMain.handle('report-render-error', (_event: any, payload: any) => {
    try {
        const logPath = path.join(app.getPath('logs'), 'feibijiubi-renderer.log');
        const p = payload && typeof payload === 'object' ? payload : { message: String(payload) };
        const line = JSON.stringify({
            ts: new Date().toISOString(),
            type: String(p.type || 'error'),
            message: String(p.message || '').slice(0, 2048),
            source: String(p.source || '').slice(0, 512),
            lineno: p.lineno,
            colno: p.colno,
            stack: String(p.stack || '').slice(0, 4096),
            url: String(p.url || '').slice(0, 512),
        });
        try { fs.appendFileSync(logPath, line + '\n'); } catch (_) {}
        // 主进程同步打印一份，开发期 npm start 下直接看终端就能定位。
        console.error(`[render-error][${p.type}] ${p.message} src=${p.source}:${p.lineno}:${p.colno}\n${p.stack || ''}`);
    } catch (_) {}
});

ipcMain.handle('get-app-version', () => {
    return _readAppVersion();
});

// 检查 GitHub 最新发布版本，返回与当前版本的差异
ipcMain.handle('check-update', async () => {
    const repo = 'Untsia/FeibiJiubi';
    const currentVersion = _readAppVersion();
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