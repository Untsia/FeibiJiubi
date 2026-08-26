// 通知系统：通过 Electron IPC 向渲染进程推送通知（替代 WebSocket，无需开放本地端口）
// 主进程窗口引用挂在 global.mainWindow（见 main.js），渲染进程通过 window.electronAPI.on('notify', ...) 接收
global.Notify = (success, message) => {
    const win = global.mainWindow;
    if (win && !win.isDestroyed()) {
        win.webContents.send('notify', { success, message });
    }
};
