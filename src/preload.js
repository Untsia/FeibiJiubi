const { contextBridge, ipcRenderer } = require('electron');

// 背景图用 local:// 协议 URL（同源，避免 file:// 被 Chromium 拦截显示不出来）。
// 与头像一致：页面由 local://app/index.html 提供，file:// 子资源会被「Not allowed to
// load local resource」拦截；背景图改走主进程 local 协议 /bg-image/ 前缀。
function backgroundImageToURL(filePath) {
    if (!filePath) return '';
    // 绝对路径按 / 分段编码（保留 / 分隔，避免 %2F 在 URL pathname 解析中被吞）
    const segs = String(filePath).replace(/\\/g, '/').split('/').map(encodeURIComponent);
    return 'local://app/bg-image/' + segs.join('/');
}


contextBridge.exposeInMainWorld('electronAPI', {
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    maximizeWindow: () => ipcRenderer.send('window-maximize'),
    closeWindow: () => ipcRenderer.send('window-close'),
    on: (channel, listener) => {ipcRenderer.on(channel, listener);},
    openExternal: (url) => ipcRenderer.send('open-external', url),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    checkUpdate: () => ipcRenderer.invoke('check-update'),
    refreshGachaRecords: () => ipcRenderer.invoke('refresh-gacha-records'),
    importGachaFromGame: () => ipcRenderer.invoke('import-gacha-from-game'),
    getGachaRecords: (playerId) => ipcRenderer.invoke('get-gacha-records', playerId),
    getLastQueryUid: () => ipcRenderer.invoke('get-last-query-uid'),
    setLastQueryUid: (uid) => ipcRenderer.invoke('set-last-query-uid', uid),
    getPlayerUIDs: () => ipcRenderer.invoke('get-player-uids'),
    saveBackgroundSettings: (key, value) => {ipcRenderer.invoke('saveBackgroundSettings', key, value); },
    selectBackgroundFile: (currentPath) => ipcRenderer.invoke('selectBackgroundFile', currentPath),

    getGachaAvatars: (items) => ipcRenderer.invoke('get-gacha-avatars', items),
    browseGamePath: (currentPath) => ipcRenderer.invoke('browse-game-path', currentPath),
    detectWutheringWavesPath: () => ipcRenderer.invoke('detect-wuthering-waves-path'),
    backgroundImageToURL,
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    // 渲染进程致命错误回写主进程日志。
    // 白屏/按钮点不动 = 渲染脚本有未捕获异常，生产版无 DevTools 就靠这条捞数据。
    reportRenderError: (payload) => ipcRenderer.invoke('report-render-error', payload),
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
