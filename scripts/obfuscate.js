'use strict';
/**
 * P1 代码混淆：把 src 复制到 .build/src，对其中 renderer / core 的 .js 做高强度混淆。
 * 注意：
 *   - 绝不修改 src 目录，所有产物落在 .build/src（开发源码安全）。
 *   - main.js / preload.js 不在此混淆：P2 由 build-pipeline.js 单独再跑
 *     一轮「selfDefending + stringArray(rc4)」强混淆（替代 bytenode 字节码，
 *     DebugD 分层构建已验证通过：viewExists=T API:min=T children=6）。
 *   - 混淆后文件可读性极低，且自带 selfDefending / debugProtection 反调试。
 */
const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const SRC = path.join(__dirname, '..', 'src');
const OUT = path.join(__dirname, '..', '.build', 'src');

// 不混淆的入口（P2 交由 build-pipeline.js 单独强混淆，不再使用 bytenode）
const SKIP = new Set(['main.js', 'preload.js']);

// 主进程 / core：中等强度混淆。
//
// ⚠️ 以下选项在「主进程 + 打包后」已确认会制造致命副作用，严禁打开：
//   - debugProtection / debugProtectionInterval：
//       会向 Node.js 主进程循环注入 Function('debugger')()。
//       安装版同时打开 disable-devtools + OnlyLoadAppFromAsar 时，
//       devtools 无法真正打开，debugger 语句卡在 GC/解析阶段，
//       IPC 回调、DB 读写全部阻塞，表现为「窗口空白、按钮点不动」。
//   - selfDefending：会对源代码 toString 做校验，ipcMain.handle 的
//       箭头函数闭包、原生事件触发上下文极易命中，直接卡死主进程。
//   - disableConsoleOutput：覆盖全局 console.*，会把启动期真正的错误
//       （如 require('.jsc') 失败、DB ENOENT、IPCs handler 抛异常）
//       全部吞掉，表现为「静默白屏、无日志」。
//   - transformObjectKeys：混淆对象字面量 key，运行时和 DB 列名、
//       IPC 通道名、executeJavaScript 注入的 CSS 模板字符串不一致。
const OBF_OPTIONS_CORE = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
};

// renderer：温和强度。必须关闭 debugProtection（避免注入 debugger 干扰 GUI 渲染）、
// selfDefending（格式化即死循环会卡白屏），并关闭 splitStrings（防止破坏
// background.js 中 executeJavaScript 注入 CSS 那行「不能带内层双引号」的约束）。
//
// ⚠️ 额外关闭 transformObjectKeys：它会把视图脚本 (barView/intuitiveView/...) 内部对
//   `window.renderXxx / renderTableView / window.gachaWuwaInit = ...` 这类「全局对象
//   字面量 + 动态 key」写法重命名，混淆后 gameTools.js 通过 `<script src>` 顺序加载
//   7 个 view 脚本 + gachaWuwa.js 时，renderXxx 名被改写、导致 gachaWuwaInit 拿不到
//   视图函数、建不出 #view-intuitive 等容器 → 首页 DOM 注入了但分析卡片全没，用户体感
//   「侧边栏有、中间仍是白的」。视图之间还有 key 为 `view-bar` / `view-intuitive`
//   的字符串查找，transformObjectKeys 不会破坏字符串但会破坏「对象 key = 函数引用」，
//   故对 renderer 子脚本必须关。
const OBF_OPTIONS_RENDERER = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.6,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.25,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: false,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
};

const RENDERER_RE = /[\\/]renderer[\\/]scripts[\\/]/;

function walk(dir, cb) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walk(full, cb);
    } else {
      cb(full);
    }
  }
}

function copyTree(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  walk(srcDir, (file) => {
    const rel = path.relative(srcDir, file);
    const dst = path.join(dstDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(file, dst);
  });
}

function obfuscateAll() {
  if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
  copyTree(SRC, OUT);
  let count = 0;
  walk(OUT, (file) => {
    if (!file.endsWith('.js')) return;
    const base = path.basename(file);
    if (SKIP.has(base)) return;
    const code = fs.readFileSync(file, 'utf8');
    const opts = RENDERER_RE.test(file) ? OBF_OPTIONS_RENDERER : OBF_OPTIONS_CORE;
    const obf = JavaScriptObfuscator.obfuscate(code, opts).getObfuscatedCode();
    fs.writeFileSync(file, obf, 'utf8');
    count++;
  });
  console.log(`[obfuscate] 已混淆 ${count} 个 JS 文件 -> .build/src`);
}

module.exports = { obfuscateAll };
if (require.main === module) obfuscateAll();
