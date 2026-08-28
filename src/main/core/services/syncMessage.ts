// 通知系统：通过 Electron IPC 向渲染进程推送通知（替代 WebSocket，无需开放本地端口）
// 主进程窗口引用挂在 global.mainWindow（见 main.ts），渲染进程通过 window.electronAPI.on('notify', ...) 接收
declare global {
  var Notify: (success: boolean, message: string) => void;
  var mainWindow: any;
  var tray: any;
  var __dpiListenerBound: boolean;
}

global.Notify = (success: boolean, message: string): void => {
    const win = global.mainWindow;
    if (win && !win.isDestroyed()) {
        win.webContents.send('notify', { success, message });
    }
};

// 使本文件成为模块，允许 declare global 全局增强（被编译进 tsconfig.main 的 include 即全局可见）
export {};