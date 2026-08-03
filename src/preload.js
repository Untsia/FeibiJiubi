const { contextBridge, ipcRenderer } = require('electron');
let appPath = ''; // 初始化应用路径
let dbPath = ''; // 初始化 dbPath
ipcRenderer.on('set-db-path', (_, path) => {
    dbPath = path;
});


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
    refreshGachaRecords: (manualUrl) => ipcRenderer.invoke('refresh-gacha-records', manualUrl),
    importGachaFromGame: () => ipcRenderer.invoke('import-gacha-from-game'),
    getGachaRecords: (playerId) => ipcRenderer.invoke('get-gacha-records', playerId),
    getLastQueryUid: () => ipcRenderer.invoke('get-last-query-uid'),
    getPlayerUIDs: () => ipcRenderer.invoke('get-player-uids'),
    saveBackgroundSettings: (key, value) => {ipcRenderer.invoke('saveBackgroundSettings', key, value); },
    selectBackgroundFile: () => ipcRenderer.invoke('selectBackgroundFile'),

    getGachaAvatars: (items) => ipcRenderer.invoke('get-gacha-avatars', items),
    openGachaAvatarFolder: () => ipcRenderer.invoke('open-gacha-avatar-folder'),
    browseGamePath: () => ipcRenderer.invoke('browse-game-path'),
    filePathToURL,
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});
