// 在每次 npm run build 前自动清理 dist/ 中的旧版本产物，只保留当前版本号文件。
// 解决 electron-builder 不会自动删除“不同版本号”旧文件、造成 dist 堆积的问题。
//
// 注意：本文件既可作为独立脚本运行（node scripts/clean-dist.js），也被
// build-pipeline.js 以 require 方式调用。为避免 require 时 process.exit 误杀
// 整个流水线进程，仅在“直接运行”时才 exit，被引入时正常 return。

const fs = require('fs');
const path = require('path');

function runClean() {
  const pkg = require('../package.json');
  const version = pkg.version;
  const distDir = path.join(__dirname, '..', 'dist');

  if (!fs.existsSync(distDir)) {
    console.log('[clean-dist] dist 目录不存在，跳过');
    return;
  }

  const files = fs.readdirSync(distDir);
  const toRemove = [];

  for (const name of files) {
    const full = path.join(distDir, name);
    // 元数据文件一律先清理，不受版本号保护：
    //   *.blockmap 差分包、builder-effective-config.yaml/builder-debug.yml 构建快照、
    //   latest*.yml / latest*.yaml 更新元数据 —— 每次重写并且已禁用的生成项应当剔除
    if (/(^|\.)latest.*\.ya?ml$/.test(name) ||
        /^builder-.*\.ya?ml$/.test(name) ||
        /\.blockmap$/.test(name)) {
      toRemove.push(full);
      continue;
    }
    // win-unpacked 每次构建都会重建，清掉避免堆积旧解包目录
    if (name === 'win-unpacked') { toRemove.push(full); continue; }
    // 当前版本的文件/目录一律保留
    if (name.includes(version)) continue;
    // 带有版本号的产品文件（旧版本）：菲比啾比 x.y.z.exe / Setup x.y.z.exe / feibijiubi-x.y.z-x64.nsis.7z
    if (/(菲比啾比|feibijiubi)/i.test(name) && /\d+\.\d+\.\d+/.test(name)) {
      toRemove.push(full);
      continue;
    }
  }

  let removed = 0;
  for (const full of toRemove) {
    try {
      fs.rmSync(full, { recursive: true, force: true });
      removed++;
      console.log('[clean-dist] 删除旧产物: ' + path.basename(full));
    } catch (e) {
      console.warn('[clean-dist] 删除失败 ' + path.basename(full) + ': ' + e.message);
    }
  }

  console.log(`[clean-dist] 完成，移除 ${removed} 项；当前版本 ${version} 产物已保留`);
}

// 构建后清理：electron-builder 每次打包都会在输出目录生成 builder-debug.yml
//（无官方配置关闭），连同可能残留的 blockmap / latest*.yml 一起递归删除。
// 只删元数据文件，不动 win-unpacked 与安装包，可直接挂在 build/release 脚本尾部。
function cleanMetaRecursive() {
  const root = path.join(__dirname, '..');
  const distDir = path.join(root, 'dist');
  const targets = [];
  if (!fs.existsSync(distDir)) return 0;
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules') continue;
        walk(full);
      } else if (/(^|\.)latest.*\.ya?ml$/.test(ent.name) ||
                 /^builder-.*\.ya?ml$/.test(ent.name) ||
                 /\.blockmap$/.test(ent.name)) {
        targets.push(full);
      }
    }
  };
  walk(distDir);
  for (const f of targets) {
    try {
      fs.rmSync(f, { force: true });
      console.log('[clean-meta] 删除: ' + path.relative(root, f));
    } catch (e) {
      console.warn('[clean-meta] 删除失败 ' + f + ': ' + e.message);
    }
  }
  return targets.length;
}

// 直接运行时执行；被 require 时仅导出函数、不自动执行（build-pipeline 会自行调用）。
if (require.main === module) {
  runClean();
  process.exit(0);
}

module.exports = { runClean, cleanMetaRecursive };
