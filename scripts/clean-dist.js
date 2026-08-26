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
    // 当前版本的文件/目录一律保留
    if (name.includes(version)) continue;
    // win-unpacked 每次构建都会重建，清掉避免堆积旧解包目录
    if (name === 'win-unpacked') { toRemove.push(full); continue; }
    // builder-debug.yml / latest.yml 等元数据每次重写，清掉无妨
    if (/^(builder-debug\.yml|latest.*\.yml)$/.test(name)) { toRemove.push(full); continue; }
    // 带有版本号的产品文件（旧版本）：菲比啾比 x.y.z.exe / Setup x.y.z.exe / feibijiubi-x.y.z-x64.nsis.7z / *.blockmap
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

// 直接运行时执行；被 require 时仅导出函数、不自动执行（build-pipeline 会自行调用）。
if (require.main === module) {
  runClean();
  process.exit(0);
}

module.exports = { runClean };
