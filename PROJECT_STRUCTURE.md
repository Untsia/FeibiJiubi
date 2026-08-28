# 菲比啾比 · 项目结构

> 鸣潮抽卡分析工具。Electron 主进程（TypeScript）+ 渲染进程（React 19，分析/设置页全面 React 化）。
> 所有唤取 / 奇藏 / 等级数据均**仅存本机数据库**（`FEIBIJIUBI_FOLDER_PATH` 指定目录），无任何远程上传逻辑。

## 一、技术栈

- **运行时**：Electron v44；主进程为 TypeScript（`src/main/**`），渲染进程为 React 19 —— 窗口框架、分析页 / 设置页的数据链路、视图渲染与交互全部 React 化（`gacha/`、`theme/`、`notification/`），DOM 结构与旧版完全一致，保证 UI 字节不变
- **构建**：`tsc` 编译主进程 + Vite 构建 React 应用与静态资产（`scripts/compile-main.js` 统一编排）
- **数据存储**：`better-sqlite3`（运行期 + 构建期统一，NAPI 跨版本兼容）
- **图表**：内联 SVG / canvas 自绘（含迷你趋势线 sparkline），无第三方图表库
- **配置持久化**：原生 `electron` `ipcMain` + `better-sqlite3` 设置表（自实现，无 `electron-store`）
- **自动更新**：主进程通过 `axios` 直接查询 GitHub Releases（`get-app-version` / `check-update`）自实现，无 `electron-updater`
- **加固**：`javascript-obfuscator` 混淆（main / preload 强混淆：selfDefending + controlFlowFlattening + stringArray rc4）+ Rust 原生模块（`feibijiubi_core.node`，AES 加密 / HMAC-SHA256 签名底座）

## 二、目录结构（当前真实状态）

```
FeibiJiubi/
├── package.json                 # 入口指向 .build/src/main/main.js（构建产物）
├── tsconfig.json                # TS 项目引用（main / renderer 两个独立配置）
├── tsconfig.main.json           # 主进程编译（rootDir: src，输出 .build/src）
├── tsconfig.renderer.json       # React 应用类型检查（noEmit）
├── eslint.config.js             # ESLint 扁平配置（主进程 / 渲染进程按环境拆分）
├── .prettierrc.json / .prettierignore  # Prettier 格式化规则与忽略清单
├── README.md / LICENSE / PROJECT_STRUCTURE.md / PRIVACY.md / release-notes.md
├── build/
│   └── installer.nsh            # NSIS 安装脚本（含更新场景防死循环关键进程结束宏）
├── scripts/                     # 构建 / 加固 / 发布辅助脚本
│   ├── compile-main.js          # 主进程 tsc 编译 + vite 渲染构建 + 资源布局（npm start/test 共用）
│   ├── build.js                 # 统一打包入口（electron-builder，输出隔离时间戳目录）
│   ├── build-pipeline.js        # prebuild：清理 → 编译 → 混淆 → 加固 → 打包
│   ├── clean-dist.js            # 构建前清理 dist/ 旧版本产物（被 build-pipeline require 调用）
│   ├── obfuscate.js             # P1 混淆 renderer / core 的 JS
│   ├── afterPack.js             # 打包后翻转 Electron Fuses + asarmor 加固 + HMAC 签名
│   ├── debug-build.js           # DebugB/C 快速构建（分层定位混淆问题）
│   └── release-test.js          # 真机自动更新测试发布脚本
├── native/feibijiubi-core/      # Rust 原生模块（napi-rs）：核心算法 + 密钥签名底座
├── tests/                       # 单元/冒烟测试（node --test，npm test）
├── docs/screenshots/            # 界面截图（README 展示用）
└── src/
    ├── assets/                  # 应用图标（icon.png / icon.ico）
    ├── main/                    # 主进程（TypeScript，tsc 编译）
    │   ├── main.ts              # 主进程入口：窗口、托盘、IPC 注册、生命周期、更新检查
    │   ├── preload.ts           # 上下文隔离的预加载脚本（contextBridge 暴露 electronAPI）
    │   └── core/                # 主进程业务逻辑（不进渲染进程，避免暴露实现）
    │       ├── app/
    │       │   ├── console.ts   # 日志系统（按日写入 log 目录）
    │       │   ├── database.ts  # better-sqlite3 连接与初始化（设置表 + 数据表）
    │       │   └── settings/
    │       │       └── dataFile.ts  # 用户数据目录管理（FEIBIJIUBI_FOLDER_PATH）
    │       ├── security/
    │       │   └── selfcheck.ts # 运行期自检 / 完整性校验
    │       └── services/
    │           ├── syncMessage.ts   # 本地同步消息/通知
    │           ├── analysisGacha/   # 鸣潮抽卡分析核心
    │           │   ├── analysisIpc.ts           # 分析相关 IPC 通道
    │           │   ├── gachaUtils.ts            # 卡池类型映射、请求/解析、缓存
    │           │   ├── gachaRecordsCache.ts     # 每 UID 的分析结果内存缓存
    │           │   ├── commonitems.ts           # 常驻/限定角色与武器清单
    │           │   ├── deleteUID.ts             # 删除 UID 记录
    │           │   ├── gachaAvatarIpc.ts        # 头像/图片资源 IPC
    │           │   ├── getWutheringWavesPath.ts # 定位鸣潮安装/启动器路径 + 游戏内注入
    │           │   ├── gameLogReader.ts         # 游戏日志解析
    │           │   └── kujiequTreasure.ts       # 奇藏/等级数据拉取
    │           └── settings/
    │               └── background.ts            # 背景图资源加载
    └── renderer-react/           # 渲染进程（React 应用 + 静态资产）
        ├── index.html           # Vite 入口：主题首帧脚本 + CSS 引用 + <div id="root">
        ├── vite.config.mts      # Vite 配置（root/base/publicDir，outDir 由 compile-main.js 传入）
        ├── tsconfig.json
        ├── src/                 # React 应用源码
        │   ├── main.tsx         # React 挂载入口
        │   ├── App.tsx          # 窗口框架（标题栏 / 侧边栏 / 导航直调 switchAnalysisView / 主题入口）
        │   ├── GameToolsPage.tsx# 分析页 UI 框架（UID 下拉 / 刷新 / 隐藏卡池 / 删除 / 账号切换，全面 React 化）
        │   ├── SettingsPage.tsx # 设置页（主题/色温/玻璃/亮度/取色/路径/更新，全面 React 化）
        │   ├── legacy.ts        # 遗留脚本注入加载器（仅 renderer.js 错误回写桥）
        │   ├── gacha/           # 分析页数据链路（自遗留 gachaWuwa.js 迁移）
        │   │   ├── data.ts      # 记录数据层：UID / 拉取 / 刷新 / 删除 / 隐藏卡池 / switchAnalysisView
        │   │   ├── treasure.ts  # 奇藏 / 等级同步数据层 + 账号解析
        │   │   ├── store.ts     # useSyncExternalStore 状态管理（records / pools / uid / 账号 / 子模式）
        │   │   ├── types.ts / utils.ts / renderers.ts / viewState.ts / tooltip.ts
        │   │   └── views/       # 六个视图组件（Bar / Intuitive / Table / Detail / Qizang / Level）
        │   ├── theme/           # 主题视觉（自遗留 background.js 迁移）
        │   │   ├── background.ts# 应用层：applyAppBackground / applyThemeVisual / applyGlassMode / setBackgroundOverlay
        │   │   └── utils.ts     # 纯函数：底色 / 遮罩 / 布尔解析（可单测）
        │   ├── notification/    # 全局浮层通知（自遗留 syncNotification.js 迁移）
        │   │   ├── store.ts     # showNotification 发布 / 订阅
        │   │   └── NotificationHost.tsx # React 浮窗（含点击复制、主进程 notify 订阅）
        │   └── vite-env.d.ts
        └── public/              # 静态资产（vite 原样拷贝，保证 UI 字节不变）
            ├── assets/fonts/        # HarmonyOS Sans（sc/latin/arabic）本地字体
            ├── styles/
            │   ├── main.css         # 全局设计 Token（深色/浅色变量，扁平实色）
            │   ├── settings.css
            │   ├── gameTools.css
            │   └── gameTools/
            │       └── gachaWuwa.css# 唤取分析页专用样式
            └── scripts/
                └── renderer.js      # 渲染进程错误回写桥（onerror / unhandledrejection / console 劫持 → 主进程 log）
```

> 构建产物（`.build/`、`dist/`）、原生模块缓存（`native/**/target/`）、本机数据库（`*.db`）均为可再生/本地产物，已在 `.gitignore` 中忽略，不入库。

## 三、核心数据流

1. **启动**：`src/main/main.ts` 创建窗口 → `preload.ts` 注入 bridge → 加载 React 应用 `renderer/index.html` → `main.tsx` 渲染 App + NotificationHost 并调用 `applyAppBackground()` → `legacy.ts` 注入 renderer.js 错误回写桥
2. **唤取分析**：渲染进程触发 IPC → `analysisIpc` → `gachaUtils`（读启动器本地登录态 / 唤取链接）→ 官方接口 → 缓存入库（`better-sqlite3`）
3. **奇藏 / 等级**：`gacha/treasure.ts`（React 数据层）→ `analysisIpc` → `kujiequTreasure.ts`（KURO 启动器 SDK，复用本地登录态）
4. **设置持久化**：`SettingsPage.tsx`（React 状态）↔ `better-sqlite3` 设置表（通过 `save-setting` / load-settings 白名单通道）
5. **构建加固**：`prebuild` → 清理旧产物 → compile-main（tsc + vite）→ 混淆非入口 JS → 编译 Rust `.node` → main/preload 强混淆 → `electron-builder` 打包

## 四、测试

`tests/` 用 Node 内置 `node --test` 运行（`npm test`）。覆盖：分析 IPC、唤取记录、趋势线工具（`gachaTrend.test.js`）、背景、常驻角色、删除 UID、奇藏解码、性能基准、更新检查。通过 `tests/_mocks.js` 拦截 `electron` / `axios` / 数据库依赖，使真实逻辑可在纯 Node 下运行。

## 五、开源相关

- 提交前 `.gitignore` 已忽略 `node_modules/`、`.build/`、`dist/`、`*.db`、构建日志等
- 数据仅存本机，无远程上传
- 免责声明见 `README.md`