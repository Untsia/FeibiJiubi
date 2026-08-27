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
  create: () => mockAxios, // gachaUtils 使用 axios.create 创建实例，复用同一 mock
};

// 可控的数据库 mock，测试里可覆盖 .get/.all/.run/.prepare
// 同时兼容两种风格：
//   1) 回调式（cb）：db.get(sql, params, cb) / db.all(sql, params, cb) —— 旧 sqlite3 代码
//   2) 同步式（better-sqlite3）：db.prepare(sql).get(...params) / .all(...params) / .run(...params)
// 默认（未被测试覆盖时）同步返回合理值（null / [] / {changes:0}），
// 若传入 cb 则走回调路径（兼容仍用回调式封装的源码）。
const dbMock = {
  get: (sql, params, cb) => {
    if (typeof params === 'function') { cb = params; params = []; }
    const row = null;
    if (cb) cb(null, row);
    return row;
  },
  all: (sql, params, cb) => {
    if (typeof params === 'function') { cb = params; params = []; }
    const rows = [];
    if (cb) cb(null, rows);
    return rows;
  },
  run: (sql, params, cb) => {
    if (typeof params === 'function') { cb = params; params = []; }
    const info = { changes: 0, lastInsertRowid: 0 };
    if (cb) cb.call(info, null);
    return info;
  },
  // better-sqlite3 风格：db.transaction(fn)() 同步执行 fn（真实库会包事务，这里直接跑函数体）
  transaction: (fn) => fn,
  // better-sqlite3 风格：prepare(sql).xxx(...params) 委托给对应方法。
  // 被测源码（analysisIpc.js 的 dbGet/dbAll）走同步 prepare().get()/.all()，
  // 但测试里通常用回调式覆盖 dbMock.get(sql, params, cb) => cb(null, row)。
  // 这里注入一个捕获回调，把 cb 收到的值作为同步返回值传给 better-sqlite3 风格的调用方。
  prepare: (sql) => ({
    run: (...params) => {
      let captured;
      const cb = (err, info) => { captured = info; };
      dbMock.run(sql, params, cb);
      return captured !== undefined ? captured : { changes: 0, lastInsertRowid: 0 };
    },
    get: (...params) => {
      let captured;
      const cb = (err, row) => { captured = row; };
      dbMock.get(sql, params, cb);
      return captured;
    },
    all: (...params) => {
      let captured;
      const cb = (err, rows) => { captured = rows; };
      dbMock.all(sql, params, cb);
      return captured !== undefined ? captured : [];
    },
    finalize: () => {},
  }),
};

// 全局兜底（部分模块在 catch 中调用 global.Notify）
global.Notify = global.Notify || (() => {});

// 可控的设置存取 mock（回调式）：默认返回 null，测试可覆盖 getSetting 取自定义值
const settingsStore = {};
const mockGetSetting = (key, cb) => { if (cb) cb(null, key in settingsStore ? settingsStore[key] : null); };
const mockSetSetting = (key, value, cb) => { settingsStore[key] = value; if (cb) cb(null); };

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return mockElectron;
  if (request.includes('app/database')) return { db: dbMock, db2: dbMock, getSetting: mockGetSetting, setSetting: mockSetSetting };
  if (request === 'axios') return mockAxios;
  return origLoad.apply(this, arguments);
};

module.exports = { ipcHandlers, mockElectron, dbMock, mockAxios, mockGetSetting, settingsStore };
