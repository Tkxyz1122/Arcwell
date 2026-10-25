# 开发与数据说明

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

JSON 使用队列与原子替换保存，外部改动时拒绝覆盖，损坏时尝试恢复 .bak 并保留原件。卸载默认保留用户数据，也可在两次确认后将当前用户的 `%APPDATA%/Arcwell` 和程序目录的 `网址备份.html` 移入回收站。自定义备份与手动导出文件不删除；保留数据时程序目录的 HTML 先保存到 `%APPDATA%/Arcwell/uninstall-backups`，失败则停止卸载。静默卸载和安装升级始终保留数据。

更新器替换程序文件及已安装副本的卸载器，保留收藏、备份设置与快捷方式；便携副本不创建卸载器。卸载数据处理失败会停止卸载，不回退为永久删除。运行 `npm run test:uninstall` 可在项目隔离目录验证数据处理及原生确认对话框，不操作真实收藏目录。

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

产物位于 `release/0.5.3`：Setup.exe 是安装向导，Portable.zip 是可选的便携版；Update.exe 供应用内更新及手动更新备用。便携运行需保留完整 Arcwell 文件夹。依赖由 npm ci 根据锁文件恢复。

界面测试：`npm run test:ui`、`npm run test:import`、`node scripts/release-ui-test.cjs`，均使用隔离数据。原生更新器测试需指定只读旧版基线，见 [更新与发布](UPDATING.md)。

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

技术栈：Electron 44.7.0、electron-builder 26.15.3、htmlparser2 12.0.0；Playwright 和 Prettier 仅用于开发验证。渲染器使用沙箱，通过受限 IPC 调用主进程。依赖版本与许可证见 package-lock.json 和 [DEPENDENCIES.json](../DEPENDENCIES.json)。

## 许可

源码公开可见，暂未授予开源再分发或复用许可，见 [LICENSE](../LICENSE)。第三方组件遵循各自许可证。
