'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { hashFile } = require('../src/updates.cjs');
const pkg = require('../package.json');
const root = path.resolve(__dirname, '..');
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
(async () => {
  if (process.platform !== 'win32') throw new Error('请在 Windows 中构建便携 ZIP。');
  const output = path.resolve(root, pkg.build.directories.output);
  const payload = path.join(output, 'win-unpacked');
  const names = await fs.readdir(payload);
  const runtime = await fs.readdir(path.join(root, 'node_modules/electron/dist'));
  const allowed = new Set(runtime.filter((name) => !['electron.exe', 'LICENSE'].includes(name)));
  allowed.add('Arcwell.exe');
  allowed.add('LICENSE.electron.txt');
  if (
    !names.includes('Arcwell.exe') ||
    !names.includes('resources') ||
    names.some((name) => !allowed.has(name))
  )
    throw new Error('请先构建应用；便携包只允许包含已知程序文件，不能含收藏或其他用户文件。');
  const results = path.join(root, 'test-results');
  await fs.mkdir(results, { recursive: true });
  const staging = await fs.mkdtemp(path.join(results, 'portable-build-'));
  if (!path.resolve(staging).startsWith(results + path.sep))
    throw new Error('暂存目录超出项目范围。');
  const temporary = path.join(output, `Arcwell-${pkg.version}-${randomUUID()}.partial.zip`);
  const target = path.join(output, `Arcwell-${pkg.version}-Portable.zip`);
  try {
    await fs.cp(payload, path.join(staging, 'Arcwell'), { recursive: true, errorOnExist: true });
    const command = [
      "$ErrorActionPreference='Stop'",
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      `try { [System.IO.Compression.ZipFile]::CreateFromDirectory(${quote(path.join(staging, 'Arcwell'))}, ${quote(temporary)}, [System.IO.Compression.CompressionLevel]::Optimal, $true) }`,
      'finally { Add-Type -AssemblyName Microsoft.VisualBasic;',
      `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(${quote(staging)},[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin) }`,
    ].join('\n');
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(command, 'utf16le').toString('base64'),
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 10 * 60000 },
    );
    if (result.error || result.status !== 0)
      throw new Error('便携 ZIP 构建失败：' + (result.error?.message || result.stderr));
    await fs.rename(temporary, target);
    await fs.writeFile(
      target + '.sha256',
      `${await hashFile(target)}  ${path.basename(target)}\r\n`,
    );
    console.log(`Portable ZIP built: ${path.basename(target)}`);
  } catch (error) {
    await fs.unlink(temporary).catch((e) => {
      if (e.code !== 'ENOENT') throw e;
    });
    throw error;
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
