'use strict';
/**
 * P5 运行时对抗（RASP）/ 完整性探针。
 * 注意：编译后随主进程字节码一起运行。这里做的是"行为级"防护——
 * 检测调试器、逆向工具、外部注入与异常文件，而非依赖固定哈希
 * （字节码/打包产物每次构建哈希都会变）。真正的固若金汤交给 P0 的
 * asar integrity + P4 原生模块。
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 常见逆向 / 调试 / 抓包工具进程名（小写）
const REVERSING_PROCS = [
  'x64dbg.exe', 'x32dbg.exe', 'ollydbg.exe', 'windbg.exe', 'idaq.exe', 'ida64.exe',
  'cheatengine.exe', 'cheatengine-x86_64.exe', 'fiddler.exe', 'processhacker.exe',
  'procexp.exe', 'procmon.exe', 'wireshark.exe', 'httpdebugger.exe', 'dnspy.exe',
  'ilspy.exe', 'reshacker.exe', 'peid.exe', 'scylla.exe', 'importrec.exe',
];

let _armed = false;

/** 列出当前系统所有进程名（Windows 用 tasklist，其他平台 ps） */
function listProcesses() {
  try {
    if (process.platform === 'win32') {
      const out = execSync('tasklist /FO CSV /NH', { encoding: 'utf8', windowsHide: true });
      return out.split('\r\n').map(l => {
        const m = l.match(/"([^"]+)"/);
        return m ? m[1].toLowerCase() : '';
      }).filter(Boolean);
    }
    const out = execSync('ps -e -o comm=', { encoding: 'utf8' });
    return out.split('\n').map(s => s.trim().toLowerCase()).filter(Boolean);
  } catch (e) {
    return [];
  }
}

/** 检测逆向工具是否正在运行 */
function detectReversingTools() {
  const procs = listProcesses();
  return procs.filter(p => REVERSING_PROCS.includes(p));
}

/** 检测 resources 目录是否被注入异常文件（如破解补丁 / 外部 app.asar） */
function detectResourceTamper() {
  try {
    const resources = path.join(process.resourcesPath);
    // dev 模式（npm start 直跑 src）下 resourcesPath 指向 node_modules/electron/dist/resources，
    // 里面 electron.asar/default_app.asar/各种 .pak 非常多，不属于安装期管控范围，
    // 不应把它当成「资源被篡改」退出——否则首次直接白屏进程自杀、没有任何报错。
    // 只在「已打包且 resources/app.asar 实际存在」时启用这条检查。
    const appAsar = path.join(resources, 'app.asar');
    if (!fs.existsSync(appAsar)) return null;
    // 白名单：electron-builder 打包后 resources 下的正常文件/目录。
    // 注意必须包含：
    //   - asar 产物：app.asar / app.asar.sig / app.asar.unpacked
    //   - Electron 自带：electron.asar / default_app.asar
    //   - 安装器辅助：elevate.exe / app-update.yml / uninstall.exe / Uninstall.exe
    //     （NSIS 生成的卸载程序，在安装完成后会立即出现在 resources 同级/安装根目录里，
    //      部分 electron-builder 版本也会放在 resources/ 下）
    //   - V8 快照 / ICU / 资源包：v8_context_snapshot.bin / snapshot_blob.bin /
    //     resources.pak / icudtl.dat / chrome_*.pak（不同 Electron 版本组合不同，
    //     这里以通配后缀 + 精确名双重匹配）
    const expectedExact = new Set([
      'app.asar', 'app.asar.sig', 'app.asar.unpacked',
      'electron.asar', 'default_app.asar',
      'elevate.exe', 'app-update.yml',
      'LICENSE', 'LICENSE.electron.txt', 'LICENSES.chromium.html',
      'v8_context_snapshot.bin', 'snapshot_blob.bin',
      'resources.pak', 'icudtl.dat',
      // 常见变体：electron43/44 把 chrome 资源合并进 resources.pak，
      // 但部分平台仍会拆包，下面这些兜底。
      'chrome_100_percent.pak', 'chrome_200_percent.pak',
      'content_resources.pak', 'content_shell.pak',
      'ui_resources_100_percent.pak',
    ]);
    const suffixOk = (name) =>
      name.endsWith('.bin') ||
      name.endsWith('.pak') ||
      name.endsWith('.dat') ||
      name.startsWith('LICENSE') ||
      name.toLowerCase().endsWith('.dll'); // VC++/系统运行时
    for (const name of fs.readdirSync(resources)) {
      if (expectedExact.has(name)) continue;
      if (suffixOk(name)) continue;
      // NSIS 卸载文件：要么 resources 下，要么安装目录级；
      // name 含 uninstall / Uninstall 忽略大小写时放行。
      if (/^uninstall[._-]?/i.test(name)) continue;
      return name; // 任何非预期文件 → 视为被注入
    }
  } catch (e) {
    console.warn('[selfcheck] detectResourceTamper 跳过（读取 resources 失败）：', e && e.message);
  }
  return null;
}

/** P3 闭环：校验 app.asar 的带密钥 HMAC 签名是否被篡改（密钥在原生模块内） */
function verifyAsarSignature() {
  // 原生模块缺失（未跑 npm run prebuild 的纯 dev 环境）→ 视为无签名，放行，
  // 绝不能把 require 失败当作「篡改」拒绝启动，否则 npm start 无法运行。
  let native;
  try {
    native = require(path.join(__dirname, '..', '..', 'feibijiubi_core.node'));
  } catch (e) {
    return true; // 开发模式无原生模块，放行
  }
  try {
    if (typeof native.hmacSha256Verify !== 'function') return true; // 开发模式无签名，放行
    const asar = path.join(process.resourcesPath, 'app.asar');
    const sig = path.join(process.resourcesPath, 'app.asar.sig');
    if (!fs.existsSync(asar) || !fs.existsSync(sig)) return true; // 开发模式
    const data = fs.readFileSync(asar);
    const expected = fs.readFileSync(sig);
    return native.hmacSha256Verify(data, expected);
  } catch (e) {
    console.error('[selfcheck] asar 签名校验异常：', e.message);
    return false;
  }
}

/** 反调试：关闭 DevTools 开关，并在任何 webContents 打开 DevTools 时退出 */
function armAntiDebug() {
  try { app.commandLine.appendSwitch('disable-devtools'); } catch (e) {}
  app.on('web-contents-created', (event, contents) => {
    contents.on('devtools-opened', () => {
      try { app.quit(); } catch (e) {}
    });
    // 拦截通过 executeJavaScript 注入调试脚本的尝试
    contents.on('will-attach-webview', (e) => e.preventDefault());
  });
}

/**
 * 启动探针：返回 { ok, reasons[] }。reasons 非空即视为被篡改/被逆向，调用方应退出。
 */
function probe() {
  const reasons = [];
  const tools = detectReversingTools();
  if (tools.length) reasons.push('reversing-tool:' + tools.join(','));
  const tamper = detectResourceTamper();
  if (tamper) reasons.push('resource-tamper:' + tamper);
  if (!verifyAsarSignature()) reasons.push('asar-signature-mismatch');
  return { ok: reasons.length === 0, reasons };
}

/** 安装：在 app ready 前调用。检测到威胁即退出进程。 */
function installSelfCheck() {
  if (_armed) return;
  _armed = true;
  armAntiDebug();

  const { ok, reasons } = probe();
  if (!ok) {
    console.error('[selfcheck] 检测到威胁，拒绝启动：', reasons.join(' | '));
    try { app.quit(); } catch (e) {}
    process.exit(1);
  }

  // ready 后再扫一次（部分注入在启动后才加载）
  app.once('ready', () => {
    const r = probe();
    if (!r.ok) {
      console.error('[selfcheck] 启动后检测到威胁，退出：', r.reasons.join(' | '));
      try { app.quit(); } catch (e) {}
      process.exit(1);
    }
  });
}

module.exports = { installSelfCheck, probe, detectReversingTools, detectResourceTamper };
