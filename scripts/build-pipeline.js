'use strict';
/**
 * 整合构建流水线（prebuild）：
 *   1. 清理 dist 旧产物
 *   2. 主进程 TS 编译（tsc）+ 渲染资源布局（compile-main.js）
 *   3. P1 混淆 renderer/core 的 JS（compile 产出的 .js）
 *   4. P2 把 main/preload 再跑一次强混淆（替代 bytenode 字节码）
 *      · 原 P2 bytenode 在 Electron 44 + OnlyLoadAppFromAsar=true + 反调试
 *        debugger 心跳 组合下会导致 preload.jsc 静默失败：
 *        electronAPI.hasMin/hasMax/hasClose/hasDb 全部 false，
 *        视图初始化 7 个脚本全部未挂载（viewExists=false、banners=0），
 *        从用户视角看就是「内容区空白、侧边栏部分可点、顶部栏按钮全不能点」。
 *      · 分层构建 DebugD（全混淆 + main/preload 额外强混淆 + SKIP bytenode）
 *        已验证：viewExists=T / API:min=T / API:close=T / intuitive=T / children=6，
 *        与 npm start 开发版行为一致。
 *
 * 若设置环境变量 SKIP_HARDEN=1，则跳过混淆两步（仅编译+拷贝，便于排查/本地调试构建）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { compileMain } = require('./compile-main.js');

const SKIP = process.env.SKIP_HARDEN === '1';
const OUT = path.join(__dirname, '..', '.build', 'src');
const OUT_MAIN = path.join(OUT, 'main');

function buildNative() {
  const nativeDir = path.join(__dirname, '..', 'native', 'feibijiubi-core');
  if (!fs.existsSync(path.join(nativeDir, 'Cargo.toml'))) {
    console.warn('[native] 未找到 Rust 工程，跳过原生模块编译');
    return;
  }
  const { execSync } = require('child_process');
  execSync('cargo build --release', { cwd: nativeDir, stdio: 'inherit' });
  const dll = path.join(nativeDir, 'target', 'release', 'feibijiubi_core.dll');
  const dest = path.join(OUT, 'feibijiubi_core.node');
  fs.copyFileSync(dll, dest);
  console.log('[native] 已编译并拷贝 .node -> .build/src/feibijiubi_core.node');
}

function main() {
  // 1. 清理 dist 旧产物
  require('./clean-dist.js').runClean();

  // 2. 编译主进程 TS + 布局渲染资源（若 SKIP，直接产出明文可跑包）
  compileMain();
  console.log('[pipeline] 主进程 TS 编译完成，布局就绪');

  if (SKIP) {
    // 同时跳过两道混淆：
    //   npm run build            = P1 混淆开 + P2(main/preload 强混淆) 开
    //                                + afterPack(Fuses/asarmor) 开
    //   npm run build:insecure   = P1 关 + P2 关 + afterPack 仍跑（最后一道）
    console.log('[pipeline] SKIP_HARDEN=1，跳过两级混淆，主/preload/renderer 均保留明文');
    buildNative();
    injectAssetVersions();
    return;
  }

  // 3. P1 混淆（compile 产出已是最终产物，原位混淆即可；
  //    原生模块必须在混淆「之后」拷贝，避免被混淆流程删除）
  require('./obfuscate.js').obfuscateExisting();

  // 3.5 P2：对 main.js / preload.js 跑「强混淆 + selfDefending」替代原 bytenode。
  // obfuscateExisting 会故意跳过 main/preload（见 scripts/obfuscate.js SKIP Set），
  // 所以这里单独再跑一次；和 DebugD 构建设置一致，Electron 44 下验证通过。
  (function obfuscateMainAndPreload() {
    const JSOb = require('javascript-obfuscator');
    const cfg = {
      compact: true,
      target: 'browser-no-eval',
      selfDefending: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.6,
      numbersToExpressions: true,
      simplify: true,
      shuffleStringArray: true,
      splitStrings: true,
      splitStringsChunkLength: 8,
      stringArray: true,
      stringArrayCallsTransform: true,
      stringArrayEncoding: ['rc4'],
      stringArrayThreshold: 0.85,
      transformObjectKeys: false, // main/preload 里也用到了 require('electron').*
      unicodeEscapeSequence: false,
      deadCodeInjection: false,   // 对入口文件副作用大，关闭
      renameGlobals: false,
      renameProperties: false,
      disableConsoleOutput: false,
      debugProtection: false,
    };
    for (const rel of ['main.js', 'preload.js']) {
      const f = path.join(OUT_MAIN, rel);
      if (!fs.existsSync(f)) {
        console.warn('[pipeline] 跳过入口混淆（不存在）: ' + rel);
        continue;
      }
      const src = fs.readFileSync(f, 'utf8');
      const obfuscated = JSOb.obfuscate(src, cfg).getObfuscatedCode();
      fs.writeFileSync(f, obfuscated, 'utf8');
      console.log(`[pipeline] P2 main/preload 强混淆: ${rel} (${src.length} -> ${obfuscated.length} bytes)`);
    }
  })();

  // 4. P3：编译 Rust 原生模块（核心算法 + AES 底座），在混淆之后拷贝 .node
  buildNative();

  // 5. 版本注入：产物为最终态后再算资源哈希，替换 index.html 中的 ?v=
  injectAssetVersions();

  console.log('[pipeline] 加固流水线完成（P1 混淆 + P2 入口强混淆，已停用 P2 bytenode）');
}

// 用本地资源内容哈希替换 index.html 中 CSS/JS 的 ?v= 缓存版本号：
// 发布构建不再依赖手工递增 ?v=，文件一旦变化哈希随之变化，浏览器缓存自动失效。
// 未带版本参数的本地资源也会补上 ?v=。开发模式（npm start 直用编译产物）不受影响，
// 其缓存由 main.ts 的 Cache-Control: no-store 保证。
function injectAssetVersions() {
  const indexPath = path.join(OUT_MAIN, 'renderer', 'index.html');
  if (!fs.existsSync(indexPath)) {
    console.warn('[pipeline] 未找到 index.html，跳过版本注入');
    return;
  }
  let html = fs.readFileSync(indexPath, 'utf8');
  // 匹配单个 (href|src)="styles/xxx.css" 或 (href|src)="scripts/xxx.js"，可选地
  // 在闭合 " 之前带 ?query。注意：此处必须严格以文件名+(可选 query)+闭合 " 收尾，
  // 任何跨引用、跨行的贪心匹配都会吞掉下一行的 script 标签，导致 renderer.js 被合并
  // 进相邻 script 标签的 src，整个渲染进程脚本无法加载（白屏 + 无任何 LIFE 埋点）。
  // vite 构建后 index.html 中 public 资产为 base 归一后的相对（./styles/...）或
  // 绝对（/styles/...）写法，兼容带/不带前导 ./ 与 / 三种形态
  const assetRe = /((?:href|src)=")((?:\/|\.\/)?)(styles|scripts)\/([A-Za-z0-9_\-/.]+?\.(?:css|js))(?:\?([^"]*))?"/g;
  let count = 0;
  html = html.replace(assetRe, (match, open, prefix, dir, file, query) => {
    const full = path.join(OUT_MAIN, 'renderer', dir, file);
    if (!fs.existsSync(full)) return match;
    const hash = crypto.createHash('md5').update(fs.readFileSync(full)).digest('hex').slice(0, 8);
    count++;
    // 保留除 v= 之外的其余 query（若有）且替换/追加 v 参数
    const rest = (query || '').split('&').filter(k => k !== '' && !k.startsWith('v=')).join('&');
    const q = ['v=' + hash, rest && rest !== '' ? rest : ''].filter(Boolean).join('&');
    return `${open}${prefix}${dir}/${file}?${q}"`;
  });
  fs.writeFileSync(indexPath, html);
  console.log(`[pipeline] 版本注入完成：${count} 个资源已写入内容哈希`);
}

main();