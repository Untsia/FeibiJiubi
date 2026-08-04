# 菲比啾比 · 项目结构

> 鸣潮抽卡分析工具。Electron 主进程 + 原生渲染进程（HTML/CSS/JS，无前端框架）。
> 所有唤取 / 奇藏 / 等级数据均**仅存本机数据库**，无任何远程上传逻辑（旧 `uploadData` 模块已移除）。

## 一、技术栈

- **运行时**：Electron v33（主进程）+ 原生渲染进程（无 React/Vue 等框架）
- **数据存储**：`better-sqlite3`（运行期）+ `sqlite3`（构建期）
- **图表**：ECharts（`import/echarts.min.js`）、Chart.js（`import/chart.js` 二次封装）
- **配置持久化**：`electron-store`（设置页）
- **自动更新**：`electron-updater`（构建期，GitHub 发布渠道）

## 二、目录结构（当前真实状态）

```
FeibiJiubi/
├── main.js                         # 主进程入口：窗口、托盘、IPC 注册、生命周期
├── preload.js                      # 上下文隔离的预加载脚本（主/渲染进程 bridge）
├── index.html                      # Electron 外壳入口
├── package.json / README.md / LICENSE / PROJECT_STRUCTURE.md
├── scripts/
│   └── clean-dist.js               # 构建前清理 dist/
├── tests/                          # 单元/冒烟测试（node --test，npm test）
└── src/
    ├── core/                       # 主进程业务逻辑（不进渲染进程，避免暴露实现）
    │   ├── app/
    │   │   ├── console.js          # 日志系统（按日写入日志文件）
    │   │   ├── database.js         # 数据库连接与初始化
    │   │   └── settings/
    │   │       └── dataFile.js     # 用户数据目录管理（NEKO_GAME_FOLDER_PATH）
    │   └── services/
    │       ├── syncMessage.js      # 本地同步消息/通知（奇藏、等级同步状态）
    │       ├── analysisGacha/      # 鸣潮抽卡分析核心
    │       │   ├── analysisIpc.js           # 分析相关 IPC 通道
    │       │   ├── gachaUtils.js            # 卡池类型映射、请求/解析、缓存
    │       │   ├── commonitems.js           # 常驻/限定角色与武器清单
    │       │   ├── deleteUID.js             # 删除 UID 记录
    │       │   ├── gachaAvatarIpc.js        # 头像/图片资源 IPC
    │       │   ├── getWutheringWavesPath.js # 定位鸣潮安装/启动器路径
    │       │   └── kujiequTreasure.js       # 奇藏/等级数据拉取（KURO 启动器 SDK）
    │       └── settings/
    │           └── background.js            # 壁纸/背景加载
    └── renderer/                    # 渲染进程（界面 + 页面逻辑）
        ├── index.html              # 主窗口外壳
        ├── views/
        │   ├── gameTools.html      # 鸣潮抽卡分析页
        │   └── settings.html       # 设置页
        ├── styles/
        │   ├── main.css            # 全局设计 Token（深色/浅色变量 + 极光玻璃）
        │   ├── settings.css
        │   ├── gameTools.css
        │   └── gameTools/
        │       └── gachaWuwa.css   # 唤取分析页专用样式
        └── scripts/
            ├── renderer.js         # 渲染进程入口（导航、主题、窗口控制）
            ├── background.js       # 背景/壁纸渲染逻辑
            ├── gameTools.js        # 动态加载 gachaWuwa.js
            ├── settings.js         # 设置页逻辑（主题、主色、账号）
            ├── gameTools/
            │   ├── gacha.js        # 抽卡数据解析 / 进度条 / 图表渲染
            │   └── gachaWuwa.js    # 唤取分析主逻辑（统计 / 奇藏 / 等级 / 同步）
            ├── tools/
            │   ├── modalManager.js # 弹窗管理
            │   └── syncNotification.js # 同步通知 UI
            └── import/             # 第三方库（本地打包，不进 npm 依赖）
                ├── echarts.min.js
                └── chart.js        # Chart.js 封装
```

> 已移除的历史模块（本文档不再描述）：`uploadData/`（数据上传）、`settings/hardwareAcceleration.js`、`settings/checkError.js`、`settings/export/exportExcel.js`、`views/modalPages/dataSyncWindow.html`。

## 三、核心数据流

1. **启动**：`main.js` 创建窗口 → `preload.js` 注入 bridge → 加载 `renderer/index.html`
2. **唤取分析**：渲染进程触发 IPC → `analysisIpc` → `gachaUtils`（读启动器本地登录态 / 唤取链接）→ 官方接口 → 缓存入库（`better-sqlite3`）
3. **奇藏 / 等级**：`gachaWuwa.js` → `analysisIpc` → `kujiequTreasure.js`（KURO 启动器 SDK，复用本地登录态）
4. **设置持久化**：`settings.js` ↔ `electron-store`

## 四、测试

`tests/` 用 Node 内置 `node --test` 运行（`npm test`）。覆盖：analysisIpc、gachaWuwa、背景、常驻角色、删除 UID、奇藏解码、数据解析。

## 五、开源相关

- 提交前 `.gitignore` 已忽略 `node_modules/`、`dist/`、`*.db`、`.codebuddy/`、`-w` 等
- 数据仅存本机，无远程上传（`uploadData` 模块已移除）
- 免责声明见 `README.md`
