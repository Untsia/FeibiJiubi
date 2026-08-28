'use strict';
/**
 * 统一构建入口（npm run build / npm run release 均走这里）。
 *
 * 为什么用时间戳隔离输出目录：
 *   dist\win-unpacked 下的 app.asar / default_app.asar 偶尔会被驱动级（MiniFilter，
 *   如安全软件实时扫描 / IDE 索引）进程持有写排他句柄，Restart Manager 看不到、
 *   普通删除/重命名都被拒 → electron-builder 覆盖 dist\win-unpacked 时 EBUSY 失败。
 *   每次构建输出到全新的 dist\build-YYYYMMDDHHMMSS 目录即可完全绕开该锁；
 *   构建成功后清理元数据文件（builder-debug.yml 等）并移除更早的 build-* 目录，
 *   避免 dist 堆积旧版本。
 *
 * 参数：--publish never（本地）/ --publish always（GitHub Releases），原样透传给
 *       electron-builder。
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { cleanMetaRecursive } = require('./clean-dist.js');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function ts() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function main() {
  const args = process.argv.slice(2);
  const out = path.join(DIST, 'build-' + ts());
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const cmd = `electron-builder ${args.join(' ')} --config.directories.output="${out}"`.trim();
  console.log(`[build] 输出目录: ${out}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });

  // 构建成功后清理元数据文件（builder-debug.yml / latest*.yml / *.blockmap）
  const removed = cleanMetaRecursive();
  if (removed > 0) console.log(`[build] 已清理 ${removed} 个元数据文件`);

  // 清理更早的 build-* 目录（保留本次产物），避免 dist 无限堆积
  if (fs.existsSync(DIST)) {
    for (const name of fs.readdirSync(DIST)) {
      if (!/^build-\d{14}$/.test(name)) continue;
      const full = path.join(DIST, name);
      if (path.resolve(full) === path.resolve(out)) continue;
      try {
        fs.rmSync(full, { recursive: true, force: true });
        console.log('[build] 清理旧构建目录: ' + name);
      } catch (e) {
        console.warn('[build] 清理旧构建目录失败（忽略）: ' + name + ' :: ' + e.message);
      }
    }
  }

  console.log('[build] 构建完成: ' + out);
}

main();