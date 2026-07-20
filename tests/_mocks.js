/**
 * 测试基础设施：拦截 require('electron') / require('.../app/database') / require('axios')，
 * 让依赖 Electron 主进程环境的真实模块能在纯 Node 下被加载与单元测试。
 *
 * 用法：在每个 *.test.js 顶部第一句 `require('./_mocks')`，
 * 之后再 require 待测模块即可生效。
 */
const Module = require('module');

// 跨模块共享的 IPC 处理器登记表（ipcMain.handle 注册到此处）
const ipcHandlers = {};

const mockElectron = {
  clipboard: { writeText: () => {} },
  ipcMain: {
    handle: (name, fn) => { ipcHandlers[name] = fn; },
    removeHandler: () => {},
    emit: () => {},
    on: () => {},
  },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { showItemInFolder: () => {}, openPath: async () => '' },
  BrowserWindow: class {
    constructor() {
      this.webContents = { on: () => {}, executeJavaScript: async () => {} };
    }
    loadURL() {}
    isDestroyed() { return true; }
    close() {}
    on() {}
  },
  session: { fromPartition: () => ({ webRequest: { onBeforeRequest: () => {} } }) },
};

// 可控的 axios mock（默认返回空 data），测试里通过 mockAxios.post = ... 覆盖
const mockAxios = {
  post: async () => ({ data: { data: [] } }),
  get: async () => ({ data: {} }),
};

// 可控的数据库 mock（回调/Promise 双支持），测试里可覆盖 .get/.all/.run/.prepare
const dbMock = {
  get: (sql, params, cb) => {
    if (typeof params === 'function') { cb = params; params = []; }
    if (cb) cb(null, null);
    return Promise.resolve(null);
  },
  all: (sql, params, cb) => {
    if (typeof params === 'function') { cb = params; params = []; }
    if (cb) cb(null, []);
    return Promise.resolve([]);
  },
  run: (sql, params, cb) => {
    if (typeof params === 'function') { cb = params; params = []; }
    if (cb) cb.call({ changes: 0 }, null);
    return Promise.resolve({ changes: 0 });
  },
  prepare: (sql) => ({ run: () => {}, finalize: () => {} }),
};

// 全局兜底（部分模块在 catch 中调用 global.Notify）
global.Notify = global.Notify || (() => {});

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return mockElectron;
  if (request.includes('app/database')) return { db: dbMock, db2: dbMock };
  if (request === 'axios') return mockAxios;
  return origLoad.apply(this, arguments);
};

module.exports = { ipcHandlers, mockElectron, dbMock, mockAxios };
