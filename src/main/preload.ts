// preload 桥（原 src/preload.js → TypeScript 迁移，行为逐行保持一致）
const { contextBridge, ipcRenderer } = require('electron');

// 背景图用 local:// 协议 URL（同源，避免 file:// 被 Chromium 拦截显示不出来）。
// 与头像一致：页面由 local://app/index.html 提供，file:// 子资源会被「Not allowed to
// load local resource」拦截；背景图改走主进程 local 协议 /bg-image/ 前缀。
function backgroundImageToURL(filePath: any): string {
    if (!filePath) return '';
    // 绝对路径按 / 分段编码（保留 / 分隔，避免 %2F 在 URL pathname 解析中被吞）
    const segs = String(filePath).replace(/\\/g, '/').split('/').map(encodeURIComponent);
    return 'local://app/bg-image/' + segs.join('/');
}


// 允许渲染进程动态调用的 IPC 通道白名单。
// 原先暴露的是通用 invoke(channel, ...args)，渲染进程可调用任意 ipcMain.handle 通道
// （项目中共有 26 个），contextBridge 的收窄设计形同虚设。
// 这里改为白名单放行：未列出的通道直接拒绝。清单覆盖现有全部调用点，行为不变。
const ALLOWED_INVOKE_CHANNELS: ReadonlySet<string> = new Set([
    // main.ts：设置读写 / 更新 / 错误回写
    'load-settings',
    'save-setting',
    'get-app-version',
    'check-update',
    'report-render-error',
    // settings/background.ts：外观设置
    'saveBackgroundSettings',
    'loadBackgroundSettings',
    'selectBackgroundFile',
    'restoreDefaultBackgroundSettings',
    // analysisGacha：唤取分析主链路
    'get-last-query-uid',
    'set-last-query-uid',
    'get-player-uids',
    'get-gacha-records',
    'refresh-gacha-records',
    'import-gacha-from-game',
    'detect-wuthering-waves-path',
    'get-treasure-boxes',
    'list-treasure-accounts',
    'get-main-account',
    'get-game-account-state',
    'get-gacha-avatars',
    'delete-gacha-records',
    'get-common-items',
    // settings/dataFile.ts：数据目录
    'browse-dataFile',
    'reset-dataFile',
    'get-dataFile-path',
    'browse-game-path',
]);

contextBridge.exposeInMainWorld('electronAPI', {
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    maximizeWindow: () => ipcRenderer.send('window-maximize'),
    closeWindow: () => ipcRenderer.send('window-close'),
    on: (channel: any, listener: any) => {ipcRenderer.on(channel, listener);},
    openExternal: (url: any) => ipcRenderer.send('open-external', url),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    checkUpdate: () => ipcRenderer.invoke('check-update'),
    refreshGachaRecords: () => ipcRenderer.invoke('refresh-gacha-records'),
    importGachaFromGame: () => ipcRenderer.invoke('import-gacha-from-game'),
    getGachaRecords: (playerId: any) => ipcRenderer.invoke('get-gacha-records', playerId),
    getLastQueryUid: () => ipcRenderer.invoke('get-last-query-uid'),
    setLastQueryUid: (uid: any) => ipcRenderer.invoke('set-last-query-uid', uid),
    getPlayerUIDs: () => ipcRenderer.invoke('get-player-uids'),
    // 必须 return：丢弃 Promise 会让调用方拿不到结果，失败时变成 unhandledRejection。
    saveBackgroundSettings: (key: any, value: any) => ipcRenderer.invoke('saveBackgroundSettings', key, value),
    selectBackgroundFile: (currentPath: any) => ipcRenderer.invoke('selectBackgroundFile', currentPath),

    getGachaAvatars: (items: any) => ipcRenderer.invoke('get-gacha-avatars', items),
    browseGamePath: (currentPath: any) => ipcRenderer.invoke('browse-game-path', currentPath),
    detectWutheringWavesPath: () => ipcRenderer.invoke('detect-wuthering-waves-path'),
    backgroundImageToURL,
    // 动态通道调用：仅放行白名单内的通道，其余一律拒绝。
    invoke: (channel: any, ...args: any[]) => {
        if (typeof channel !== 'string' || !ALLOWED_INVOKE_CHANNELS.has(channel)) {
            console.error(`[preload] 已阻止非白名单 IPC 通道调用: ${String(channel)}`);
            return Promise.reject(new Error(`IPC channel not allowed: ${String(channel)}`));
        }
        return ipcRenderer.invoke(channel, ...args);
    },
    // 渲染进程致命错误回写主进程日志。
    // 白屏/按钮点不动 = 渲染脚本有未捕获异常，生产版无 DevTools 就靠这条捞数据。
    reportRenderError: (payload: any) => ipcRenderer.invoke('report-render-error', payload),
});

// P5 renderer 反调试（注意：必须在 contextBridge.exposeInMainWorld 之后执行，
// 否则 defineProperty 在 electronAPI 还没挂上之前就把它锁成 configurable=false + value=undefined，
// exposeInMainWorld 再重设 descriptor 会抛 TypeError、electronAPI 永远 undefined）。
// 1) 防外部脚本篡改已暴露的 electronAPI 桥。
// 2) **调试器心跳已移除**：之前 setInterval(Function('debu'+'gger'), 2000) 在
//    Electron 44 + 生产 fuses=OnlyLoadAppFromAsar=true 下会触发 renderer
//    sandbox crash，看起来像「preload 没加载」。
(function sealBridge() {
  try {
    // contextBridge 暴露的属性默认已 non-writable/configurable，这里再锁定一层
    // （防止未来 exposeInMainWorld 行为变化被绕过）。
    Object.defineProperty(window, 'electronAPI', { configurable: false, writable: false });
  } catch (_) { /* 已 non-configurable 会抛；保持静默 */ }
})();