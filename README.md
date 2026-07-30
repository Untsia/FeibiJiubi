# 菲比啾比 · 鸣潮抽卡分析工具

> 一款基于 Electron 的桌面工具，用于**本地**读取并可视化分析《鸣潮》的抽卡（唤取）记录，帮助你了解自己的抽卡数据与养成进度。

---

## ✨ 功能特性

- **抽卡记录分析**：从本机游戏客户端捕获唤取链接，调用官方接口拉取你的抽卡记录（角色 / 武器卡池）。
- **多维度统计**：出货概率、保底进度、星级分布、垫抽情况、差值对比等可视化图表。
- **奇藏 / 等级数据**：同步并展示角色的奇藏（收藏）与等级养成数据。
- **极光玻璃 UI**：精致、通透的现代玻璃拟态界面，支持深色 / 浅色主题与自定义主色。
- **完全本地**：所有数据仅存储在本机数据库，不存在远程上传 / 数据外发逻辑。

---

## 🖥️ 环境要求

| 依赖 | 版本 |
|---|---|
| Node.js | **24.x**（建议使用 LTS 及以上，勿降级） |
| 操作系统 | Windows 10 / 11（当前打包目标为 Windows） |
| npm | 随 Node 附带即可 |

---

## 📦 安装与运行

```powershell
# 1. 克隆仓库
git clone https://github.com/Untsia/FeibiJiubi.git
cd FeibiJiubi

# 2. 安装依赖
npm install

# 3. 开发模式启动
npm start
```

> 若 `npm install` 下载 Electron 二进制过慢或超时，可配置国内镜像（**无需关闭 TLS 证书校验**）：
> ```powershell
> npm config set electron_mirror https://registry.npmmirror.com/-/binary/electron/
> npm install
> ```

---

## 🛠️ 构建打包

```powershell
# 清理旧的构建产物并打包（输出到 dist/）
npm run build
```

打包产物（`dist/` 下的 `portable.exe` 与 NSIS 安装包）可在 GitHub Releases 中发布。
自动更新通过 `electron-builder` 的 GitHub 发布渠道（`publish.github`）实现，需在你的 GitHub 仓库 `Untsia/FeibiJiubi` 下发布 Release。

---

## 📁 目录结构

详见 [`PROJECT_STRUCTURE.md`](./PROJECT_STRUCTURE.md)。

---

## ⚖️ 免责声明

1. 本项目**仅供个人学习与数据分析使用**，所有抽卡记录均从用户**自有**的游戏客户端本地读取，数据仅保存在本机，开发者不会收集任何用户数据。
2. 使用本工具可能**违反游戏《用户协议》/ 服务条款**中关于第三方工具的相关规定，由此产生的账号风险、封禁等后果由使用者**自行承担**，开发者不承担任何责任。
3. 本项目与游戏开发商（库洛游戏 / KURO GAMES）及任何官方机构**无任何关联**，并非官方产品，亦未获得官方授权或背书。
4. 本项目名称、界面、品牌元素仅供工具标识使用，相关权利归各自权利人所有。
5. 如游戏官方明确要求停止使用，请立即停止使用并删除本软件。

---

## 📄 开源许可

本项目以 **MIT 许可证** 开源。详见 [`LICENSE`](./LICENSE) 文件。

---

## 🙏 致谢

- 抽卡记录读取方式参考了社区通用做法（基于官方唤取接口）。
- 图表展示使用 [ECharts](https://echarts.apache.org/) / [Chart.js](https://www.chartjs.org/)。
