const { contextBridge, ipcRenderer } = require('electron');
let appPath = ''; // 初始化应用路径

ipcRenderer.on('set-app-path', (_, path) => {
    appPath = path;
});

function filePathToURL(filePath) {
    if (!filePath) return '';
    if (filePath.startsWith('./assets')) {
        filePath = `${appPath}/${filePath.replace('./', '')}`;
    }
    return `file://${filePath.replace(/\\/g, '/').replace(/ /g, '%20')}`;
}



contextBridge.exposeInMainWorld('electronAPI', {
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    maximizeWindow: () => ipcRenderer.send('window-maximize'),
    closeWindow: () => ipcRenderer.send('window-close'),
    on: (channel, listener) => {ipcRenderer.on(channel, listener);},
    send: (channel, data) => {ipcRenderer.send(channel, data);},
    openExternal: (url) => ipcRenderer.send('open-external', url),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    checkUpdate: () => ipcRenderer.invoke('check-update'),
    refreshGachaRecords: (manualUrl) => ipcRenderer.invoke('refresh-gacha-records', manualUrl),
    importGachaFromGame: () => ipcRenderer.invoke('import-gacha-from-game'),
    getGachaRecords: (playerId) => ipcRenderer.invoke('get-gacha-records', playerId),
    getLastQueryUid: () => ipcRenderer.invoke('get-last-query-uid'),
    setLastQueryUid: (uid) => ipcRenderer.invoke('set-last-query-uid', uid),
    getPlayerUIDs: () => ipcRenderer.invoke('get-player-uids'),
    saveBackgroundSettings: (key, value) => {ipcRenderer.invoke('saveBackgroundSettings', key, value); },
    selectBackgroundFile: () => ipcRenderer.invoke('selectBackgroundFile'),

    getGachaAvatars: (items) => ipcRenderer.invoke('get-gacha-avatars', items),
    browseGamePath: () => ipcRenderer.invoke('browse-game-path'),
    detectWutheringWavesPath: () => ipcRenderer.invoke('detect-wuthering-waves-path'),
    filePathToURL,
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});
