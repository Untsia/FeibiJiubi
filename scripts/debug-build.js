'use strict';
// DebugB/C 快速构建：复制 src -> .build 且可选择
//   a) 是否跑 P1 混淆（core / renderer）
//   b) 是否额外强混淆 main / preload（--obfuscate-main-preload）
// 独立于 build-pipeline.js，用于「分层定位哪一步破坏 reportRenderError / 视图初始化」
// （P2 bytenode 已弃用，main/preload 统一走强混淆，见 build-pipeline.js）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const argv = process.argv.slice(2);
const opts = {
  skipObfuscate: argv.includes('--skip-obfuscate'),
};

const SRC = path.join(__dirname, '..', 'src');
const OUT = path.join(__dirname, '..', '.build', 'src');

function copyTree(srcDir, dstDir) {
  fs.rmSync(dstDir, { recursive: true, force: true });
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const full = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      copyTree(full, dst);
    } else {
      fs.copyFileSync(full, dst);
    }
  }
}

// 1. 先复制 src -> .build/src
copyTree(SRC, OUT);
console.log('[debug-build] 已复制 src -> .build/src');

// 可选：原生模块（若已编译过）
const nativeOut = path.join(OUT, 'feibijiubi_core.node');
const builtNode = path.join(__dirname, '..', 'native', 'feibijiubi-core', 'target', 'release', 'feibijiubi_core.dll');
if (fs.existsSync(builtNode) && !fs.existsSync(nativeOut)) {
  fs.copyFileSync(builtNode, nativeOut);
  console.log('[debug-build] 拷贝原生模块 feibijiubi_core.node');
}

// 2. P1 混淆
if (!opts.skipObfuscate) {
  console.log('[debug-build] 运行 P1 obfuscateAll');
  const obf = require('./obfuscate.js');
  obf.obfuscateAll();
  // --obfuscate-main-preload: obfuscateAll 默认会跳过 main.js/preload.js，
  // 这里单独再跑一次强混淆（替代已弃用的 bytenode 字节码，与 build-pipeline P2 一致）。
  if (argv.includes('--obfuscate-main-preload')) {
    console.log('[debug-build] 为 main.js / preload.js 单独跑强混淆（替代 bytenode）');
    const SKIP = new Set([]);
    // 强混淆级别 ≈ 原 core 级别，但避免拆分入口结构（deadCodeInjection 对入口副作用重）。
    const cfg = {
      compact: true, target: 'browser-no-eval', selfDefending: true,
      controlFlowFlattening: true, controlFlowFlatteningThreshold: 0.6,
      numbersToExpressions: true, simplify: true, shuffleStringArray: true,
      splitStrings: true, splitStringsChunkLength: 8,
      stringArray: true, stringArrayCallsTransform: true, stringArrayEncoding: ['rc4'], stringArrayThreshold: 0.85,
      transformObjectKeys: false, unicodeEscapeSequence: false,
      deadCodeInjection: false, renameGlobals: false, renameProperties: false,
      disableConsoleOutput: false, debugProtection: false,
    };
    const JSOb = require('javascript-obfuscator');
    const OUT2 = path.join(__dirname, '..', '.build', 'src');
    for (const rel of ['main.js', 'preload.js']) {
      const f = path.join(OUT2, rel);
      if (!fs.existsSync(f)) { console.warn('[debug-build] 跳过 ' + rel + '（不存在）'); continue; }
      const src = fs.readFileSync(f, 'utf8');
      const obfuscated = JSOb.obfuscate(src, cfg).getObfuscatedCode();
      fs.writeFileSync(f, obfuscated, 'utf8');
      console.log(`[debug-build] main-preload 强混淆: ${rel} (${src.length} -> ${obfuscated.length} bytes)`);
    }
  }
} else {
  console.log('[debug-build] 跳过 P1 混淆 (core+renderer 均保留明文)');
}

// 4. 版本注入
function injectAssetVersions() {
  const indexPath = path.join(OUT, 'renderer', 'index.html');
  if (!fs.existsSync(indexPath)) return;
  let html = fs.readFileSync(indexPath, 'utf8');
  const assetRe = /((?:href|src)=")(styles|scripts)\/([A-Za-z0-9_\-/.]+?\.(?:css|js))(?:\?([^"]*))?"/g;
  let count = 0;
  html = html.replace(assetRe, (match, open, dir, file, query) => {
    const full = path.join(OUT, 'renderer', dir, file);
    if (!fs.existsSync(full)) return match;
    const hash = crypto.createHash('md5').update(fs.readFileSync(full)).digest('hex').slice(0, 8);
    count++;
    const rest = (query || '').split('&').filter(k => k !== '' && !k.startsWith('v=')).join('&');
    const q = ['v=' + hash, rest && rest !== '' ? rest : ''].filter(Boolean).join('&');
    return `${open}${dir}/${file}?${q}"`;
  });
  fs.writeFileSync(indexPath, html);
  console.log(`[debug-build] 版本注入：${count} 个资源`);
}
injectAssetVersions();
console.log('[debug-build] 完成');
