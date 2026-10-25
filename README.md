# Arcwell

<p align="center"><img src="assets/icon.svg" width="64" alt="Arcwell" /></p>
<p align="center"><strong>A quiet home for your bookmarks.</strong><br />一个本地优先、简洁安静的 Windows 网页收藏器。</p>
<p align="center"><a href="https://github.com/Tkxyz1122/Arcwell/releases/latest">下载最新版本</a> · <a href="CHANGELOG.md">更新记录</a> · <a href="https://github.com/Tkxyz1122/Arcwell/issues">问题反馈</a></p>

![Arcwell 主界面](docs/images/overview.png)

## 下载与安装

前往 [Releases](https://github.com/Tkxyz1122/Arcwell/releases/latest)。首次安装选择 **Setup.exe**；已经安装选择 **Update.exe**，在原目录更新，无需先卸载。安装器会将程序放入独立的 Arcwell 文件夹，支持自选位置。

**0.5.0 及更早版本需先手动更新一次到 0.5.1。** 之后在左下角齿轮 → 应用更新中检查新版本、下载并启动更新器。版本相同时显示已是最新，后续更高版本发布后才出现下载按钮。

目标平台为 Windows 11 x64。运行不需要安装 Node.js、Python 或 .NET。应用 EXE 暂无 Windows Authenticode 代码签名；应用内更新另行使用 Ed25519 发布签名与 SHA-256 完整性校验。ARM64、干净系统安装和各 DPI 组合尚未完整验证。

## 功能

- **收藏与打开**：添加 HTTP / HTTPS 网址、修改名称、备注、星标。左键单击容器或标题，以默认浏览器打开；星标、菜单和分类区域不触发打开。
- **层级文件夹**：默认分区、父子目录、子目录管理与分类计数。启动时默认折叠，点击箭头展开；长名称悬停显示完整路径。
- **浏览与检索**：搜索、最近添加、星标筛选、名称排序、列表和网格视图。鼠标悬停与键盘焦点有高亮提示。
- **详情编辑**：三横线菜单或右键菜单 → 编辑详情，展开右栏。未保存内容有离开保护。
- **浏览器导入**：左下角齿轮旁的文件导入图标。支持浏览器导出的 HTML 书签、保留分类层级，跳过最外层收藏夹栏容器。
- **两种导入方式**：A 合并添加，保留已有内容，只新增；B 完全覆盖，再次确认并单独备份旧库后替换。
- **实时双备份**：应用目录和自选目录各一份“网址备份.html”，每次修改覆盖更新，采用标准浏览器书签格式；可复制导出原文件。
- **图标与撤销**：网站图标本地缓存，失败时显示文字图标。移除需要确认，收藏移除支持撤销。
- **GitHub 更新**：按需检查正式版、显示下载进度、取消下载，校验发布签名与文件后安装，沿用原目录更新与失败恢复。

快捷键：**Ctrl+K** 搜索，**Ctrl+N** 添加网址；聚焦收藏容器后 **Enter** 打开。

## 界面预览

演示使用公开示例网址与示例备份路径，不包含个人收藏。

![文件夹与详情编辑](docs/images/details.png)

![浏览器 HTML 导入](docs/images/import.png)

![备份与应用更新](docs/images/settings.png)

## 数据与隐私

核心收藏管理可离线使用，不上传收藏库、备注或备份，不包含遥测。读取图标时访问对应网站；点击检查更新及下载时访问 GitHub，不发送收藏数据。应用不内置 GitHub 访问令牌。

| 内容           | 默认位置与用途                                                        |
| -------------- | --------------------------------------------------------------------- |
| 完整收藏       | `%APPDATA%/Arcwell/data/library.json`，含备注、星标与分类             |
| 上次修改前副本 | 同目录 `library.json.bak`                                             |
| 覆盖前恢复副本 | 同目录 `library.before-import-时间戳-唯一标识.json`，后续编辑不会覆盖 |
| HTML 同步副本  | Arcwell.exe 同目录 + 设置中选择的第二个目录                           |
| 缓存           | `%APPDATA%/Arcwell/cache`，图标与更新下载                             |

HTML 是标准浏览器书签文件，**不包含应用备注和星标**。完整迁移请先关闭应用，再备份整个 data 目录；HTML 可通过导入按钮恢复分类和链接。两份 HTML 为当前库的同步副本，覆盖导入后也会更新，不能代替历史归档。备份目录不可写时会提示，JSON 收藏仍可保存。

JSON 使用队列与原子替换保存，外部改动时拒绝覆盖，损坏时尝试恢复 .bak 并保留原件。卸载保留用户数据。更新器只替换程序文件，保留收藏、备份设置与快捷方式。

## 从源码开发

开发环境：Windows x64、Node.js 24、npm 与 Git。Node 仅用于开发，应用自带运行时。

```powershell
git clone https://github.com/Tkxyz1122/Arcwell.git
cd Arcwell
npm ci
npm start
```

```powershell
npm test
npm run check
npm run format:check
npm run build
```

产物位于 `release/0.5.1`。免安装运行需保留完整 `win-unpacked`。构建先生成 Setup.exe，再生成 Update.exe。依赖不提交到 Git，由 npm ci 根据锁文件恢复。已有项目内 .tools/node.exe 的维护者也可使用本地构建脚本。

界面测试：`npm run test:ui`、`npm run test:import`、`node scripts/release-ui-test.cjs`，均使用隔离数据。原生更新器测试需指定只读旧版基线，见 [更新与发布](docs/UPDATING.md)。

## 项目结构

```text
src/                 主进程、业务与存储模块
  ui/                桌面界面
  updates.cjs        GitHub 更新与签名校验
build/               NSIS 安装与原目录更新
scripts/             构建、发布与桌面验证
tests/               业务及服务测试
assets/              SVG 与应用图标
docs/                演示图与发布说明
```

技术栈：Electron 44.7.0、electron-builder 26.15.3、htmlparser2 12.0.0；Playwright 和 Prettier 仅用于开发验证。渲染器使用沙箱，通过受限 IPC 调用主进程。依赖版本与许可证见 package-lock.json 和 [DEPENDENCIES.json](DEPENDENCIES.json)。

## 许可

源码公开可见，暂未授予开源再分发或复用许可，见 [LICENSE](LICENSE)。第三方组件遵循各自许可证。
