import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * 渲染层 Vite 配置（React 应用 + 静态资产）。
 *
 * 布局约定：
 *   src/renderer-react/index.html      Vite 入口（主题首帧脚本 + CSS 引用 + <div id="root">）
 *   src/renderer-react/public/**       遗留静态资产（styles/scripts/assets 字体与图标），
 *                                      Vite 原样拷贝到构建输出，保证 UI 字节不变
 *   src/renderer-react/src/**          React 应用源码（main.tsx / App.tsx / gacha/ / theme/ / notification/ / legacy.ts）
 *
 * 产物输出到 .build/src/main/renderer（由 scripts/compile-main.js 调起 vite build），
 * 与主进程 RENDERER_DIR()/local:// 协议约定一致。
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [react()],
  publicDir: 'public',
  build: {
    // outDir 由调用方（compile-main.js）通过 --outDir 传入，此处不做死路径
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});