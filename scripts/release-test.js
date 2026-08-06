#!/usr/bin/env node
/**
 * 真机自动更新测试一键脚本（在可访问 GitHub 的机器上运行）
 *
 * 用途：把当前工程打包成 nsis 安装版并发布到 GitHub Releases，
 *       再配合一个已安装的旧版 setup.exe 即可验证"程序内立即更新"全流程。
 *
 * 前置：
 *   1. 本机网络可达 GitHub（github.com:443 未封锁）
 *   2. 已 npm install（含 electron-builder / electron-updater）
 *   3. 已登录 gh CLI：gh auth login
 *   4. 仓库 https://github.com/Untsia/FeibiJiubi 有写权限
 *
 * 用法：
 *   node scripts/release-test.js            # 自动 minor+1（1.2.1 -> 1.2.2）
 *   node scripts/release-test.js 1.3.0      # 指定新版本号
 *   node scripts/release-test.js 1.2.2 --no-publish   # 只打包不发布
 *
 * 注意：
 *   - 自动更新仅对 nsis setup.exe 生效，portable 单文件版会降级为"前往下载"
 *   - dev 模式（npm start）不会触发自动更新
 *   - 发布时 latest.yml 必须随包上传（electron-builder 自动生成）
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PKG = path.join(ROOT, 'package.json');
const DIST = path.join(ROOT, 'dist');

function fail(msg) {
  console.error('❌ ' + msg);
  process.exit(1);
}

function run(cmd, opts = {}) {
  console.log('▶ ' + cmd);
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts });
  } catch (e) {
    fail('命令失败: ' + cmd + '\n' + (e.stderr || e.message));
  }
}

// 1. 解析目标版本
const argv = process.argv.slice(2);
const explicit = argv.find((a) => /^\d+\.\d+\.\d+$/.test(a));
const noPublish = argv.includes('--no-publish');

const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
const cur = pkg.version;
let next = explicit;
if (!next) {
  const [maj, min, pat] = cur.split('.').map(Number);
  next = `${maj}.${min + 1}.0`;
}
console.log(`当前版本: ${cur}  ->  将发布: ${next}`);

// 2. 写入新版本号
pkg.version = next;
fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log('已更新 package.json version = ' + next);

// 3. 打包（nsis + portable）
//    electron-builder 通过 package.json build 配置生成 setup.exe 与 latest.yml
console.log('\n=== 开始打包 ===');
run('npx electron-builder --win --x64 --publish=never');

// 4. 校验产物（必须用【当前版本 next】的产物，避免匹配到旧版文件）
const prefix = `FeibiJiubi-${next}-windows-x64`;
const nsisExe = fs.readdirSync(DIST).find((f) => f === `${prefix}-setup.exe`);
const blockmap = fs.readdirSync(DIST).find((f) => f === `${prefix}-setup.exe.blockmap`);
const latestYml = fs.readFileSync(path.join(DIST, 'latest.yml'), 'utf8');
if (!nsisExe) fail('未找到 nsis setup.exe 产物: ' + prefix + '-setup.exe');
if (!blockmap) fail('未找到 blockmap 产物: ' + prefix + '-setup.exe.blockmap');
if (!latestYml.includes('version: ' + next)) fail('latest.yml 版本不匹配');
console.log('产物校验通过: ' + nsisExe + ' + ' + blockmap + ' + latest.yml(version=' + next + ')');

if (noPublish) {
  console.log('\n⏭ 已跳过发布（--no-publish）。release 文件位于 dist/，手动上传即可。');
  process.exit(0);
}

// 5. 发布到 GitHub Releases
const tag = 'v' + next;
let ghAvailable = false;
try { execSync('gh --version', { stdio: 'ignore' }); ghAvailable = true; } catch {}

if (ghAvailable) {
  console.log('\n=== 发布到 GitHub Releases（gh CLI）===');
  run(`gh release create ${tag} --title "菲比啾比 ${next}" --notes "自动更新测试版本 ${next}" dist/${nsisExe} dist/latest.yml dist/${blockmap}`);
} else if (process.env.GH_TOKEN) {
  console.log('\n=== 发布到 GitHub Releases（electron-builder + GH_TOKEN）===');
  // 复用第3步已打好的包，直接让 electron-builder 上传（需 GH_TOKEN 环境变量）
  run('npx electron-builder --win --x64 --publish=always');
} else {
  fail('未检测到 gh CLI 且未设置 GH_TOKEN 环境变量，无法自动发布。\n' +
       '请二选一：\n' +
       '  A) 安装并登录 gh：winget install gh && gh auth login\n' +
       '  B) 设置环境变量 GH_TOKEN=github_pat_xxx 后重跑本脚本');
}

console.log('\n✅ 发布完成！');
console.log('下一步真机验证：');
console.log('  1. 用【旧版】setup.exe 安装（例如 1.2.1 的包）');
console.log('  2. 启动旧版 -> 首页应弹窗"发现新版本"，点击"立即更新"');
console.log('  3. 下载完成后按钮变"重启并安装"，点击即升级到 ' + next);
console.log('  4. 注意：必须 nsis 安装版，portable 单文件版不支持程序内更新');
