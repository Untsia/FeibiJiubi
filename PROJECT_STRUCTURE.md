# 菲比啾比 · 项目结构

> 鸣潮抽卡分析工具。Electron 主进程 + 原生渲染进程（HTML/CSS/JS，无前端框架）。
> 所有唤取 / 奇藏 / 等级数据均**仅存本机数据库**（`FEIBIJIUBI_FOLDER_PATH` 指定目录），无任何远程上传逻辑。

## 一、技术栈

- **运行时**：Electron v44（主进程）+ 原生渲染进程（无 React/Vue 等框架）
- **数据存储**：`better-sqlite3`（运行期 + 构建期统一，NAPI 跨版本兼容）
- **图表**：内联 SVG / canvas 自绘（含迷你趋势线 sparkline），无第三方图表库
- **配置持久化**：原生 `electron` `ipcMain` + `better-sqlite3` 设置表（自实现，无 `electron-store`）
- **自动更新**：`main.js` 通过 `axios` 直接查询 GitHub Releases（`get-app-version` / `check-update`）自实现，无 `electron-updater`
- **加固**：`javascript-obfuscator` 混淆 + `bytenode` 编译 V8 字节码 + Rust 原生模块（`feibijiubi_core.node`，AES 加密 / HMAC-SHA256 签名底座）

## 二、目录结构（当前真实状态）

```
FeibiJiubi/
├── package.json                 # 入口指向 .build/src/main.js（构建产物）
├── eslint.config.js             # ESLint 扁平配置（主进程 / 渲染进程按环境拆分）
├── .prettierrc.json / .prettierignore  # Prettier 格式化规则与忽略清单
├── README.md / LICENSE / PROJECT_STRUCTURE.md / PRIVACY.md
├── scripts/                     # 构建 / 加固 / 发布辅助脚本
│   ├── build-pipeline.js        # prebuild：清理 dist → 复制源码 → 混淆 → 编译原生 → 字节码
│   ├── clean-dist.js            # 构建前清理 dist/ 旧版本产物
│   ├── obfuscate.js             # P1 混淆 renderer / core 的 JS
│   ├── compile-bytecode.js      # P2 把 main/preload 编译为 V8 字节码 .jsc
│   ├── afterPack.js             # 打包后翻转 Electron Fuses + asarmor 加固 + HMAC 签名
│   └── release-test.js          # 真机自动更新测试发布脚本
├── native/feibijiubi-core/      # Rust 原生模块（napi-rs）：核心算法 + 密钥签名底座
├── tests/                       # 单元/冒烟测试（node --test，npm test）
├── docs/screenshots/            # 界面截图（README 展示用）
└── src/
    ├── main.js                  # 主进程入口：窗口、托盘、IPC 注册、生命周期、更新检查
    ├── preload.js               # 上下文隔离的预加载脚本（主/渲染进程 bridge）
    ├── assets/                  # 应用图标（icon.png / icon.ico）
    ├── core/                    # 主进程业务逻辑（不进渲染进程，避免暴露实现）
    │   ├── app/
    │   │   ├── console.js       # 日志系统（按日写入 log 目录）
    │   │   ├── database.js      # better-sqlite3 连接与初始化（设置表 + 数据表）
    │   │   └── settings/
    │   │       └── dataFile.js  # 用户数据目录管理（FEIBIJIUBI_FOLDER_PATH）
    │   ├── security/
    │   │   └── selfcheck.js     # 运行期自检 / 完整性校验
    │   └── services/
    │       ├── syncMessage.js   # 本地同步消息/通知
    │       ├── analysisGacha/   # 鸣潮抽卡分析核心
    │       │   ├── analysisIpc.js           # 分析相关 IPC 通道
    │       │   ├── gachaUtils.js            # 卡池类型映射、请求/解析、缓存
    │       │   ├── gachaRecordsCache.js     # 每 UID 的分析结果内存缓存
    │       │   ├── commonitems.js           # 常驻/限定角色与武器清单
    │       │   ├── deleteUID.js             # 删除 UID 记录
    │       │   ├── gachaAvatarIpc.js        # 头像/图片资源 IPC
    │       │   ├── getWutheringWavesPath.js # 定位鸣潮安装/启动器路径 + 游戏内注入
    │       │   ├── gameLogReader.js         # 游戏日志解析
    │       │   └── kujiequTreasure.js       # 奇藏/等级数据拉取
    │       └── settings/
    │           └── background.js            # 背景图资源加载
    └── renderer/                 # 渲染进程（界面 + 页面逻辑）
        ├── index.html           # 主窗口外壳
        ├── views/
        │   ├── gameTools.html   # 鸣潮抽卡分析页
        │   └── settings.html    # 设置页
        ├── assets/fonts/        # HarmonyOS Sans（sc/latin/arabic）本地字体
        ├── styles/
        │   ├── main.css         # 全局设计 Token（深色/浅色变量，扁平实色）
        │   ├── settings.css
        │   ├── gameTools.css
        │   └── gameTools/
        │       └── gachaWuwa.css# 唤取分析页专用样式
        └── scripts/
            ├── renderer.js      # 渲染进程入口（导航、主题、窗口控制）
            ├── background.js    # 背景/壁纸渲染逻辑
            ├── gameTools.js     # 动态加载分析视图脚本
            ├── settings.js      # 设置页逻辑（主题、主色、账号）
            ├── gameTools/
            │   ├── gacha.js     # 抽卡数据解析 / 进度条 / 图表渲染
            │   ├── gachaWuwa.js # 唤取分析主逻辑（统计 / 奇藏 / 等级 / 同步）
            │   └── views/       # 各分析子视图（bar/intuitive/table/detail/qizang/level + shared 共享工具）
            └── tools/
                ├── modalManager.js      # 弹窗管理
                └── syncNotification.js  # 同步通知 UI
```

> 构建产物（`.build/`、`dist/`）、原生模块缓存（`native/**/target/`）、本机数据库（`*.db`）均为可再生/本地产物，已在 `.gitignore` 中忽略，不入库。

## 三、核心数据流

1. **启动**：`src/main.js` 创建窗口 → `preload.js` 注入 bridge → 加载 `renderer/index.html`
2. **唤取分析**：渲染进程触发 IPC → `analysisIpc` → `gachaUtils`（读启动器本地登录态 / 唤取链接）→ 官方接口 → 缓存入库（`better-sqlite3`）
3. **奇藏 / 等级**：`gachaWuwa.js` → `analysisIpc` → `kujiequTreasure.js`（KURO 启动器 SDK，复用本地登录态）
4. **设置持久化**：`settings.js` ↔ `better-sqlite3` 设置表（通过 `save-setting` / load-settings 白名单通道）
5. **构建加固**：`prebuild` → 清理旧产物 → 复制源码 → 混淆非入口 JS → 编译 Rust `.node` → main/preload 转字节码 → `electron-builder` 打包

## 四、测试

`tests/` 用 Node 内置 `node --test` 运行（`npm test`）。覆盖：分析 IPC、唤取记录、趋势线工具（`gachaTrend.test.js`）、背景、常驻角色、删除 UID、奇藏解码、性能基准、更新检查。通过 `tests/_mocks.js` 拦截 `electron` / `axios` / 数据库依赖，使真实逻辑可在纯 Node 下运行。

## 五、开源相关

- 提交前 `.gitignore` 已忽略 `node_modules/`、`.build/`、`dist/`、`*.db`、构建日志等
- 数据仅存本机，无远程上传
- 免责声明见 `README.md`