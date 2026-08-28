/**
 * 安装升级 / 版本比较测试
 *
 * 覆盖：
 *  - compareVersion：语义化版本比较（> / < / = / 不同段数 / 含 v 前缀 / 空值兜底）
 *  - check-update 守卫逻辑：远端版本不高于当前版本时 hasUpdate 必须为 false（不误弹更新窗）
 *  - installer.nsh 存在性 + 关键进程结束宏存在（更新场景不会死循环「请手动关闭」）
 *
 * compareVersion 与 check-update 守卫从编译产物 .build/src/main/main.js（tsc 输出）提取，
 * 与运行时行为一致并避免逻辑漂移。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MAIN_SRC = fs.readFileSync(path.join(__dirname, '..', '.build', 'src', 'main', 'main.js'), 'utf8');

// 从真实源码抽取 compareVersion 纯函数
function extractCompareVersion() {
  const marker = 'function compareVersion(a, b) {';
  const start = MAIN_SRC.indexOf(marker);
  assert.ok(start >= 0, 'marker not found: ' + marker);
  let i = MAIN_SRC.indexOf('{', start);
  let depth = 0;
  for (; i < MAIN_SRC.length; i++) {
    const c = MAIN_SRC[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const fnSrc = MAIN_SRC.slice(start, i);
  // eslint-disable-next-line no-new-func
  return new Function(fnSrc + '\n;return compareVersion;')();
}

// 复刻 check-update 的 hasUpdate 守卫（与 main.js 第 239 行一致）
function hasUpdateGuard(latestVersion, currentVersion) {
  const cmp = extractCompareVersion();
  return latestVersion ? cmp(latestVersion, currentVersion) > 0 : false;
}

const compareVersion = extractCompareVersion();

test('compareVersion: 高位更高 → 1', () => {
  assert.strictEqual(compareVersion('2.0.0', '1.2.4'), 1);
});

test('compareVersion: 低位更高 → -1', () => {
  assert.strictEqual(compareVersion('1.2.3', '1.2.4'), -1);
});

test('compareVersion: 相等 → 0', () => {
  assert.strictEqual(compareVersion('1.2.4', '1.2.4'), 0);
});

test('compareVersion: 不同段数（补零比较）', () => {
  assert.strictEqual(compareVersion('1.2', '1.2.0'), 0);
  assert.strictEqual(compareVersion('1.10.0', '1.9.9'), 1);
});

test('compareVersion: 含 v 前缀（实际由调用方去掉，这里测空值兜底）', () => {
  assert.strictEqual(compareVersion('', '1.2.4'), -1);
  assert.strictEqual(compareVersion(null, '1.2.4'), -1);
  assert.strictEqual(compareVersion(undefined, '1.2.4'), -1);
});

test('check-update 守卫: 远端 == 当前 → 不弹更新', () => {
  assert.strictEqual(hasUpdateGuard('1.2.4', '1.2.4'), false);
});

test('check-update 守卫: 远端 < 当前 → 不弹更新（防止降级误弹）', () => {
  assert.strictEqual(hasUpdateGuard('1.2.3', '1.2.4'), false);
});

test('check-update 守卫: 远端 > 当前 → 弹更新', () => {
  assert.strictEqual(hasUpdateGuard('1.2.5', '1.2.4'), true);
});

test('check-update 守卫: 远端为空 → 不弹更新（feed 解析异常兜底）', () => {
  assert.strictEqual(hasUpdateGuard('', '1.2.4'), false);
});

test('installer.nsh: 存在且含关键进程结束宏（防更新死循环）', () => {
  const nshPath = path.join(__dirname, '..', 'build', 'installer.nsh');
  assert.ok(fs.existsSync(nshPath), 'installer.nsh 必须存在');
  const content = fs.readFileSync(nshPath, 'utf8');
  assert.ok(content.includes('!macro preInit'), '应定义 preInit 宏');
  assert.ok(content.includes('!macro customInit'), '应定义 customInit 宏');
  assert.ok(content.includes('taskkill.exe /IM "feibijiubi.exe"'), '应结束主程序进程 feibijiubi.exe');
  // 注释中允许提及 explorer.exe（作为说明），但绝不可出现实际 taskkill 命令
  assert.ok(!content.includes('taskkill.exe /IM "explorer.exe"'), '绝不可 taskkill explorer.exe（黑屏风险）');
});

test('package.json: 不残留签名 / 证书路径配置（商店签名已移除，证书走原生环境变量 CSC_LINK 注入）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(!(pkg.build.win || {}).signtoolOptions, '不应残留 signtoolOptions 配置');
  assert.ok(!(pkg.build.win || {}).certificateFile, '不应写死 certificateFile 字面路径');
});
