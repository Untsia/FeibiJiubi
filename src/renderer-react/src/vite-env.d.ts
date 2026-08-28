/// <reference types="vite/client" />

// 渲染进程可访问的 electronAPI 类型声明（与 src/main/preload.ts 暴露面一一对应）。
// 原先这里只有一行 vite/client 引用，导致所有 window.electronAPI 访问在
// tsc 类型检查下报 TS2339（共 12 处），各处只能用 any 绕过。
//
// 说明：IPC 返回值的结构由主进程各 handler 决定且随业务演进，这里统一标注为 any，
// 目的是消除「属性不存在」的误报；参数与同步方法仍保留精确类型以保留提示价值。
interface ElectronAPI {
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
  on: (channel: string, listener: (...args: any[]) => void) => void;
  openExternal: (url: string) => void;
  getAppVersion: () => Promise<any>;
  checkUpdate: () => Promise<any>;
  refreshGachaRecords: () => Promise<any>;
  importGachaFromGame: () => Promise<any>;
  // uid 允许为 null：主进程 handler 形参为 any，调用方 loadGachaRecords(uid) 本就接受 null。
  getGachaRecords: (playerId: string | null) => Promise<any>;
  getLastQueryUid: () => Promise<any>;
  setLastQueryUid: (uid: string) => Promise<any>;
  getPlayerUIDs: () => Promise<any>;
  saveBackgroundSettings: (key: string, value: any) => Promise<any>;
  selectBackgroundFile: (currentPath: string) => Promise<any>;
  getGachaAvatars: (items: any[]) => Promise<any>;
  browseGamePath: (currentPath: string) => Promise<any>;
  detectWutheringWavesPath: () => Promise<any>;
  backgroundImageToURL: (filePath: string) => string;
  // 动态通道调用：主进程侧有白名单校验，未登记的通道会被拒绝。
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  reportRenderError: (payload: any) => Promise<any>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
