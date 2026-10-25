# 更新与发布

应用固定从 `Tkxyz1122/Arcwell` 的 GitHub Releases 读取最新正式版本。无需用户登录或内置访问令牌，不读取草稿、预发布或低于当前版本的包。不会在启动时自动联网检查。

“设置与备份 → 应用更新”提供检查、下载、取消和安装。只有指定仓库的 HTTPS 发布地址可作为入口，跳转仅允许 GitHub 的下载域名。清单大小上限 64 KB，包上限 400 MB，请求与下载有超时。网络失败可重试，取消不改程序和收藏。

每个 Release 提供以下文件；项目首页以安装程序为主要下载入口，便携版为可选项，日常更新在应用内完成：

- `Arcwell-x.y.z-Setup.exe`：首次安装。
- `Arcwell-x.y.z-Update.exe`：完整原目录更新。
- `Arcwell-x.y.z-Portable.zip`：可选便携版，解压后包含完整 Arcwell 文件夹。
- `Arcwell-x.y.z-Portable.zip.sha256`：便携版校验值。
- `SHA256.txt`：便于人工校验。
- `update.json`：Ed25519 签名的版本、仓库、包名、大小和 SHA-256 清单。

应用内置 `src/update-public.pem`，先验证清单签名，再校验下载大小与 SHA-256，启动前再次校验文件。下载仅保存在本地用户缓存目录；不能让渲染器传入任意程序、目标路径或下载地址。安装前明确确认，并要求先保存编辑中的内容。更新器确认目标目录、阻止降级，正常关闭该目录内的 Arcwell 后替换程序，失败尝试回滚。它不会调用原卸载器。

## 发布下一版

维护者使用 Node.js 24 和 npm，Windows x64：

```powershell
npm ci
npm test
npm run check
npm run format:check
npm run build
npm run release:manifest
```

先调整 package.json 和锁文件的版本、build.directories.output，以及 README 和发布说明中的下载链接。更新 CHANGELOG.md 和 docs/release-notes.md。确认本地测试及更新包测试后提交、推送源码，设置 `GH_TOKEN`（仅在发布进程环境内），执行 `node scripts/publish-release.cjs`。脚本先上传到草稿，全部文件上传完后发布；拒绝覆盖已发布的同版本。失败可对相同草稿重试。

`npm run build` 同时生成安装、更新与便携文件；仅补打便携版可运行 `npm run build:portable`。便携版构建只复制已知程序文件，压缩包内统一放入 Arcwell 文件夹，不包含收藏或本地维护脚本。0.5.1 后补的便携包使用独立校验文件，原有 SHA256.txt 与签名更新资产保持不变；下一版生成的 SHA256.txt 会包含三种包。

签名私钥使用 `ARCWELL_UPDATE_PRIVATE_KEY` 环境变量，或仅保存在本地 `.tools/release-signing/private.pem`。**私钥不进 Git、不进安装包。维护者应另行安全备份；不要随意重新生成，否则已安装应用不再信任后续更新。** 公钥可以公开。发布脚本不打印访问令牌或私钥。公开仓库并不赋予来访者发布权限。

0.4.0 及更早版本没有在线更新入口；0.5.0 存在 GitHub 下载跳转问题。这两种情况需先手动运行一次当前正式版 Update.exe。0.5.1 可直接在应用内更新至 0.5.2。版本相同会显示已是最新；后续发布更高版本才出现下载入口。

## 原生更新器验证

`ARCWELL_UPDATE_BASELINE` 指向可读的旧版完整程序目录，再运行 `npm run test:update`。测试只把旧版复制到项目 test-results 的隔离目录，强制设置 `ARCWELL_UPDATE_TEST_ROOT`，原生更新器写入前验证目标在该隔离根内。不得移除此保护或对真实安装目录进行试验。

更新器的回退目录为安装目录下 `.arcwell-update-版本/old`。异常中断后保留该目录用于恢复。当前只验证 Windows x64；干净系统、管理员保护目录、断电与各 DPI 组合仍需扩展验证。应用 EXE 尚无 Windows Authenticode 证书，Ed25519 更新发布签名与 Windows 代码签名是两种独立用途。

从 0.5.2 起，构建安装包时会捕获同版本卸载器，用于更新已安装副本。更新器把卸载器作为同一事务中的程序文件替换并参与失败回滚，便携副本不创建卸载器。已有用户不需卸载重装，即可通过更新获得卸载时的数据保留/删除选项。自定义安装目录、卸载注册命令与快捷方式保持不变。

`npm run test:uninstall` 使用无注册表和真实 APPDATA 写入的原生测试壳，覆盖保留、取消、二次确认、回收、文件占用与目录链接；另用实际分发卸载器验证 `ARCWELL_UNINSTALL_TEST_ROOT` 的限制。该变量只能拦截隔离根之外的运行，不能把生产数据路径改到任意位置或跳过确认。卸载实现不支持旧的 `--delete-app-data` 永久删除参数。
