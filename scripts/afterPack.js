'use strict';
/**
 * afterPack 钩子：在 electron-builder 打包完成后、生成安装包前执行。
 * 职责（P0 反逆向加固）：
 *   1. 翻转 Electron Fuses，关闭可被滥用的运行时开关（RunAsNode / --inspect / RunNodeCli 等）
 *   2. 用 asarmor 破坏 app.asar 结构，使 `asar extract` 直接失败（防一键解包）
 *
 * 注意：本文件本身会被一起打进 asar，但 asarmor 作用在它执行之后生成的产物上，
 *       不影响其自身运行。
 */
const fs = require('fs');
const path = require('path');

async function runAfterPack(context) {
  const { appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename || '菲比啾比';
  // Windows 产物为 FeibiJiubi.exe（productName 的中文在 exe 名中被映射）
  const exeCandidates = [
    path.join(appOutDir, `${appName}.exe`),
    path.join(appOutDir, 'FeibiJiubi.exe'),
    path.join(appOutDir, 'feibijiubi.exe'),
  ];
  const exePath = exeCandidates.find((p) => fs.existsSync(p));

  // ---- 1. 翻转 Electron Fuses ----
  if (exePath) {
    try {
      const { FuseV1Options, FuseVersion, flipFuses } = require('@electron/fuses');
      await flipFuses(exePath, {
        version: FuseVersion.V1,
        [FuseV1Options.RunAsNode]: false,            // 禁止 `electron --node` 直接执行 JS
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, // 禁止 NODE_OPTIONS 注入
        [FuseV1Options.EnableNodeCliInspectArguments]: false,       // 禁止 --inspect/--debug 开调试器
        [FuseV1Options.OnlyLoadAppFromAsar]: true,   // 只从 asar 加载，禁止外部目录注入
        [FuseV1Options.EnableCookieEncryption]: true,
        [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
      });
      console.log('[afterPack] Electron Fuses 已翻转（RunAsNode/--inspect 等已禁用）');
    } catch (e) {
      console.warn('[afterPack] 翻转 Fuses 失败（可能缺 @electron/fuses）：', e.message);
    }
  } else {
    console.warn('[afterPack] 未找到 exe，跳过 Fuses 翻转');
  }

  // ---- 2. asarmor 破坏 asar 结构（防解包）----
  const asarPath = path.join(appOutDir, 'resources', 'app.asar');
  if (fs.existsSync(asarPath)) {
    try {
      const { Asarmor, Trashify } = require('asarmor');
      new Asarmor(asarPath).applyProtection(
        new Trashify(['.git', '.env', 'node_modules/.cache'])
      );
      console.log('[afterPack] asarmor 已加固 app.asar（asar extract 将失败）');
    } catch (e) {
      console.warn('[afterPack] asarmor 加固失败（可能缺 asarmor）：', e.message);
    }
  } else {
    console.warn('[afterPack] 未找到 app.asar，跳过 asarmor 加固');
  }

  // ---- 3. P3 带密钥 HMAC 签名 app.asar（防篡改，密钥藏于原生模块）----
  if (fs.existsSync(asarPath)) {
    try {
      const nativePath = path.join(__dirname, '..', 'native', 'feibijiubi-core', 'target', 'release', 'feibijiubi_core.node');
      const native = require(nativePath);
      const data = fs.readFileSync(asarPath);
      const sig = native.hmacSha256(data);
      fs.writeFileSync(asarPath + '.sig', sig);
      console.log('[afterPack] 已生成 app.asar.sig（带密钥 HMAC，防篡改）');
    } catch (e) {
      console.warn('[afterPack] HMAC 签名失败（可能缺原生模块）：', e.message);
    }
  }
}

module.exports = runAfterPack;
