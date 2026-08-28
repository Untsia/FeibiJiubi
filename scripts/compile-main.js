'use strict';
/**
 * 主进程 TypeScript 编译 + 渲染资源构建（npm start / prebuild 共用）。
 *
 * 新目录布局（与 src/main/*.ts 的相对引用保持一致）：
 *   src/main/**            --tsc-->  .build/src/main/**   （main.js / preload.js / core/**）
 *   src/renderer-react/**  --vite--> .build/src/main/renderer/**（React 应用 + public 静态资产）
 *   src/assets/**          --copy--> .build/src/main/assets/**
 *   native dll             --copy--> .build/src/feibijiubi_core.node
 *
 * 为什么要这个布局？main.ts 内所有 require 路径（./core/**、../feibijiubi_core.node
 * 等）都以「main.js 所在目录」为基准；package.json main 指向 .build/src/main/main.js，
 * 则 appCodeDir() = <asar 根>/.build/src/main，renderer/assets/preload 都必须落在
 * .build/src/main/ 下，否则打印出的全是 404 白屏。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, '.build', 'src');
const OUT_MAIN = path.join(OUT, 'main');
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const TSCONFIG = path.join(ROOT, 'tsconfig.main.json');
const VITE_BIN = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const VITE_CONFIG = path.join(ROOT, 'src', 'renderer-react', 'vite.config.mts');
const VITE_ROOT = path.join(ROOT, 'src', 'renderer-react');

function copyDir(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.rmSync(dstDir, { recursive: true, force: true });
  fs.mkdirSync(dstDir, { recursive: true });
  const walk = (dir, out) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const dst = path.join(out, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(full, dst);
      } else {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(full, dst);
      }
    }
  };
  walk(srcDir, dstDir);
}

function buildRenderer() {
  if (!fs.existsSync(VITE_BIN)) {
    throw new Error('未找到 Vite：' + VITE_BIN + '，请先 npm install');
  }
  console.log('[compile] vite build src/renderer-react ...');
  // outDir 相对 vite root（src/renderer-react）：../../.build/src/main/renderer
  execSync(
    `node "${VITE_BIN}" build --config "${VITE_CONFIG}" --outDir "../../.build/src/main/renderer" --emptyOutDir`,
    { cwd: VITE_ROOT, stdio: 'inherit' }
  );
  console.log('[compile] renderer（React 应用 + 静态资产）已由 vite 构建到 .build/src/main/renderer');
}

function compileMain() {
  // 1. 清空并重新编译 TS（保证 .build/src 下无旧 JS 残留）
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  if (!fs.existsSync(TSC)) {
    throw new Error('未找到 TypeScript 编译器：' + TSC + '，请先 npm install');
  }
  console.log('[compile] tsc -p tsconfig.main.json ...');
  execSync(`node "${TSC}" -p "${TSCONFIG}"`, { cwd: ROOT, stdio: 'inherit' });

  // 2. 渲染层由 vite 构建（React 应用 + public 静态资产原样拷贝，UI 字节不变）
  buildRenderer();

  // 3. 拷贝外层静态资源（图标等）到 main 目录同级（见文件头注释的布局说明）
  copyDir(path.join(SRC, 'assets'), path.join(OUT_MAIN, 'assets'));
  console.log('[compile] assets 已复制到 .build/src/main/');
}

module.exports = { compileMain, buildRenderer };
if (require.main === module) compileMain();