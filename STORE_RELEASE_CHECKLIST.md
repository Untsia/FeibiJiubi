# 菲比啾比 · 应用商店上架清单

> 本文件为发布前的就绪状态核对与待办清单。所有自动化测试已通过，剩余为需人工处理的发布阻塞项。

## 一、发布就绪状态（已自动化验证）

| 维度 | 状态 | 说明 |
|------|------|------|
| 功能测试 | ✅ 53/53 通过 | node --test 全量（含渲染/IPC/升级/性能） |
| 性能压测 | ✅ 通过 | 1 万条数据渲染 < 2s；进度条 1000 次均值 < 5ms |
| 回归测试 | ✅ 通过 | 卡片视图两列网格、条形视图无内联头像卡片 |
| 安全模型 | ✅ 通过 | contextIsolation:true / nodeIntegration:false / contextBridge |
| 安装升级 | ✅ 通过 | installer.nsh 防更新死循环；compareVersion 守卫防误弹 |
| 代码签名 | ⚠️ 已配置占位 | package.json win 段已加证书字段，待填入真实证书 |

## 二、应用商店上架待办（需人工）

### 1. 代码签名证书（硬阻塞）
- 证书通过 electron-builder 原生环境变量注入（不写死在 package.json，避免泄露私钥/误当路径）：
  - `CSC_LINK`：指向 `.pfx` / `.p12` 证书文件路径
  - `CSC_KEY_PASSWORD`：证书私钥密码
- 打包前设置环境变量后执行构建：
  ```powershell
  $env:CSC_LINK = "C:\path\to\your\code-signing.pfx"
  $env:CSC_KEY_PASSWORD = "your-cert-password"
  npm run build
  ```
- **未设置环境变量时**：自动跳过签名，正常生成未签名安装包（可用于本地测试，但上架商店会被 SmartScreen 拦截）。
- 推荐证书：DigiCert / Sectigo / 国内沃通 / 数安时代 EV 代码签名证书（EV 可免 SmartScreen 拦截）。

### 2. 隐私政策 URL（硬阻塞，多数商店强制）
- 本项目为**纯本地**工具：不收集、不上传任何用户个人信息；仅本地读取游戏日志与本地数据库。
- 仍需提供一份隐私政策页面（GitHub Pages / 官网均可），内容要点：
  - 明确声明「不收集任何个人数据」
  - 说明数据仅存于本机 `%APPDATA%/feibijiubi/`
  - 说明「检查更新」仅请求 GitHub Releases 公开接口（无身份追踪）
- 占位 URL（发布前替换为真实地址）：
  `https://github.com/Untsia/FeibiJiubi/blob/main/PRIVACY.md`

### 3. 商店元数据
- 应用名称：菲比啾比
- 分类：工具 / 游戏辅助
- 简介：鸣潮（Wuthering Waves）抽卡（唤取）数据分析工具，本地读取、可视化分析
- 图标：`src/assets/icon.ico`
- 官网/仓库：`https://github.com/Untsia/FeibiJiubi`

### 4. 安装包产物
- NSIS 安装包：`dist/FeibiJiubi-1.2.4-windows-x64-setup.exe`
- 便携版：`dist/FeibiJiubi-1.2.4-windows-x64-portable.exe`

## 三、已知限制（发布说明中建议注明）
- Windows 平台优先（打包目标仅 win）
- 需用户本机已安装鸣潮客户端以自动读取日志（或手动粘贴唤取链接）
- 未做 macOS / Linux 签名与打包

## 四、人工验证清单（无法自动化）
- [ ] 高分屏（125%/150% DPI）窗口居中正常
- [ ] Windows 7/10/11 兼容性实机验证
- [ ] 真实 1 万+ 条数据时界面流畅度
- [ ] 覆盖安装（升级）不丢数据、不弹「请手动关闭」
- [ ] 卸载后残留数据目录提示
