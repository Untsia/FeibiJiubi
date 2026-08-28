'use strict';
/**
 * P5 运行时对抗（RASP）/ 完整性探针。
 * 原 src/core/security/selfcheck.js → TypeScript 迁移，行为逐行保持一致。
 * 注意：native 模块位于代码根目录（.build/src/feibijiubi_core.node），
 * 本文件编译后位于 <代码根>/main/core/security/，需上三级才能找到。
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
function listProcesses(): string[] {
  try {
    if (process.platform === 'win32') {
      const out = execSync('tasklist /FO CSV /NH', { encoding: 'utf8', windowsHide: true }).toString();
      return out.split('\r\n').map((l: string) => {
        const m = l.match(/"([^"]+)"/);
        return m ? m[1].toLowerCase() : '';
      }).filter(Boolean);
    }
    const out = execSync('ps -e -o comm=', { encoding: 'utf8' }).toString();
    return out.split('\n').map((s: string) => s.trim().toLowerCase()).filter(Boolean);
  } catch (e) {
    return [];
  }
}

/** 检测逆向工具是否正在运行 */
function detectReversingTools(): string[] {
  const procs = listProcesses();
  return procs.filter(p => REVERSING_PROCS.includes(p));
}

/** 检测 resources 目录是否被注入异常文件（如破解补丁 / 外部 app.asar） */
function detectResourceTamper(): string | null {
  try {
    const resources = path.join((process as any).resourcesPath);
    const appAsar = path.join(resources, 'app.asar');
    if (!fs.existsSync(appAsar)) return null;
    const expectedExact = new Set([
      'app.asar', 'app.asar.sig', 'app.asar.unpacked',
      'electron.asar', 'default_app.asar',
      'elevate.exe', 'app-update.yml',
      'LICENSE', 'LICENSE.electron.txt', 'LICENSES.chromium.html',
      'v8_context_snapshot.bin', 'snapshot_blob.bin',
      'resources.pak', 'icudtl.dat',
      'chrome_100_percent.pak', 'chrome_200_percent.pak',
      'content_resources.pak', 'content_shell.pak',
      'ui_resources_100_percent.pak',
    ]);
    const suffixOk = (name: string): boolean =>
      name.endsWith('.bin') ||
      name.endsWith('.pak') ||
      name.endsWith('.dat') ||
      name.startsWith('LICENSE') ||
      name.toLowerCase().endsWith('.dll');
    for (const name of fs.readdirSync(resources)) {
      if (expectedExact.has(name)) continue;
      if (suffixOk(name)) continue;
      if (/^uninstall[._-]?/i.test(name)) continue;
      return name; // 任何非预期文件 → 视为被注入
    }
  } catch (e) {
    console.warn('[selfcheck] detectResourceTamper 跳过（读取 resources 失败）：', e && (e as Error).message);
  }
  return null;
}

/** P3 闭环：校验 app.asar 的带密钥 HMAC 签名是否被篡改（密钥在原生模块内） */
function verifyAsarSignature(): boolean {
  // 原生模块缺失（未跑 npm run prebuild 的纯 dev 环境）→ 视为无签名，放行
  let native: any;
  try {
    native = require(path.join(__dirname, '..', '..', '..', 'feibijiubi_core.node'));
  } catch (e) {
    return true; // 开发模式无原生模块，放行
  }
  try {
    if (typeof native.hmacSha256Verify !== 'function') return true;
    const asar = path.join((process as any).resourcesPath, 'app.asar');
    const sig = path.join((process as any).resourcesPath, 'app.asar.sig');
    if (!fs.existsSync(asar) || !fs.existsSync(sig)) return true;
    // 打包后的 Electron 会把 fs patch 成 asar 透明读取，而 asarmor 加固（Trashify）
    // 会改写 app.asar 的 header，使 readFileSync(asar) 这种「整读容器」的操作抛
    // `ENOENT, not found in <asar>` —— 这是加固产物 + 运行时环境的正常现象，不是篡改。
    // 因此：
    //   1) 优先用原生层的文件直读校验（hmacSha256VerifyFile，绕过 fs patch，读物理字节）；
    //   2) 旧版 native 无该函数时，退回 fs 整读；读不到/解析异常一律放行（仅 IO 异常≠篡改）。
    if (typeof native.hmacSha256VerifyFile === 'function') {
      return native.hmacSha256VerifyFile(asar, sig);
    }
    const data = fs.readFileSync(asar);
    const expected = fs.readFileSync(sig);
    return native.hmacSha256Verify(data, expected);
  } catch (e) {
    console.error('[selfcheck] asar 签名校验异常（IO/解析失败，放行，不视为篡改）：', (e as Error).message);
    return true;
  }
}

/** 反调试：关闭 DevTools 开关，并在任何 webContents 打开 DevTools 时退出 */
function armAntiDebug(): void {
  try { app.commandLine.appendSwitch('disable-devtools'); } catch (e) {}
  app.on('web-contents-created', (event: any, contents: any) => {
    contents.on('devtools-opened', () => {
      try { app.quit(); } catch (e) {}
    });
    // 拦截通过 executeJavaScript 注入调试脚本的尝试
    contents.on('will-attach-webview', (e: any) => e.preventDefault());
  });
}

/**
 * 启动探针：返回 { ok, reasons[] }。reasons 非空即视为被篡改/被逆向，调用方应退出。
 */
/**
 * @param opts.skipAsarSignature 跳过 asar 签名校验。
 *   该步骤要把整个 app.asar（上百 MB）读进内存再做 HMAC，是启动期最重的一步，
 *   而原生模块只提供整块 Buffer 的校验接口（hmac_sha256_verify），无法流式处理。
 *   启动后那次探测只用于捕捉「启动之后才被注入」的威胁，签名在启动前已完整校验过，
 *   重复读取既无额外安全收益，又白付一次全量 IO 与内存峰值。
 */
function probe(opts?: { skipAsarSignature?: boolean }): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const tools = detectReversingTools();
  if (tools.length) reasons.push('reversing-tool:' + tools.join(','));
  const tamper = detectResourceTamper();
  if (tamper) reasons.push('resource-tamper:' + tamper);
  if (!opts?.skipAsarSignature && !verifyAsarSignature()) reasons.push('asar-signature-mismatch');
  return { ok: reasons.length === 0, reasons };
}

/** 安装：在 app ready 前调用。检测到威胁即退出进程。 */
function installSelfCheck(): void {
  if (_armed) return;
  _armed = true;
  armAntiDebug();

  const { ok, reasons } = probe();
  if (!ok) {
    console.error('[selfcheck] 检测到威胁，拒绝启动：', reasons.join(' | '));
    try { app.quit(); } catch (e) {}
    process.exit(1);
  }

  // ready 后再扫一次（部分注入在启动后才加载）。
  // 这里跳过签名校验：签名在启动前已校验，且这类「启动后注入」本就不是签名能覆盖的场景。
  app.once('ready', () => {
    const r = probe({ skipAsarSignature: true });
    if (!r.ok) {
      console.error('[selfcheck] 启动后检测到威胁，退出：', r.reasons.join(' | '));
      try { app.quit(); } catch (e) {}
      process.exit(1);
    }
  });
}

module.exports = { installSelfCheck, probe, detectReversingTools, detectResourceTamper };