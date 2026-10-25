# 更新与发布

应用固定从 `Tkxyz1122/Arcwell` 的 GitHub Releases 读取最新正式版本。无需用户登录或内置访问令牌，不读取草稿、预发布或低于当前版本的包。不会在启动时自动联网检查。

“设置与备份 → 应用更新”提供检查、下载、取消和安装。只有指定仓库的 HTTPS 发布地址可作为入口，跳转仅允许 GitHub 的下载域名。清单大小上限 64 KB，包上限 400 MB，请求与下载有超时。网络失败可重试，取消不改程序和收藏。

每个 Release 必须有四个文件：

- `Arcwell-x.y.z-Setup.exe`：首次安装。
- `Arcwell-x.y.z-Update.exe`：完整原目录更新。
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

先调整 package.json 和锁文件的版本、build.directories.output、启动Arcwell.cmd，更新 CHANGELOG.md 和 docs/release-notes.md。确认本地测试及更新包测试后提交、推送源码，设置 `GH_TOKEN`（仅在发布进程环境内），执行 `node scripts/publish-release.cjs`。脚本先上传到草稿，四个文件上传完后发布；拒绝覆盖已发布的同版本。失败可对相同草稿重试。

签名私钥使用 `ARCWELL_UPDATE_PRIVATE_KEY` 环境变量，或仅保存在本地 `.tools/release-signing/private.pem`。**私钥不进 Git、不进安装包。维护者应另行安全备份；不要随意重新生成，否则已安装应用不再信任后续更新。** 公钥可以公开。发布脚本不打印访问令牌或私钥。公开仓库并不赋予来访者发布权限。

已安装 0.4.0 或更早版本没有在线更新入口，须先手动运行一次 0.5.0 Update.exe。版本相同会显示已是最新；后续发布更高版本才出现下载入口。

## 原生更新器验证

`ARCWELL_UPDATE_BASELINE` 指向可读的旧版完整程序目录，再运行 `npm run test:update`。测试只把旧版复制到项目 test-results 的隔离目录，强制设置 `ARCWELL_UPDATE_TEST_ROOT`，原生更新器写入前验证目标在该隔离根内。不得移除此保护或对真实安装目录进行试验。

更新器的回退目录为安装目录下 `.arcwell-update-版本/old`。异常中断后保留该目录用于恢复。当前只验证 Windows x64；干净系统、管理员保护目录、断电与各 DPI 组合仍需扩展验证。应用 EXE 尚无 Windows Authenticode 证书，Ed25519 更新发布签名与 Windows 代码签名是两种独立用途。
