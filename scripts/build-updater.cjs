'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { UUID } = require('builder-util-runtime');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const output = path.join(root, pkg.build.directories.output);
async function compiler() {
  const cache =
    process.env.ELECTRON_BUILDER_CACHE ||
    path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache');
  for (const name of await fs.readdir(cache)) {
    if (!name.startsWith('nsis-3.')) continue;
    const directory = path.join(cache, name);
    for (const child of await fs.readdir(directory)) {
      const candidate = path.join(directory, child, 'Bin', 'makensis.exe');
      if (
        await fs.access(candidate).then(
          () => true,
          () => false,
        )
      )
        return candidate;
    }
  }
  throw new Error('未找到已缓存的NSIS，请先构建安装包。');
}
async function buildUpdater({ testFailure = false } = {}) {
  let payload = path.join(output, 'win-unpacked');
  const names = await fs.readdir(payload);
  if (!names.includes('Arcwell.exe') || !names.includes('resources'))
    throw new Error('请先构建应用。');
  if (names.some((name) => !/^[a-z\d._-]+$/i.test(name)))
    throw new Error('程序目录含意外文件，停止打包。');
  const runtimeNames = await fs.readdir(path.join(root, 'node_modules', 'electron', 'dist'));
  const allowed = new Set(
    runtimeNames.filter((name) => name !== 'electron.exe' && name !== 'LICENSE'),
  );
  allowed.add('Arcwell.exe');
  allowed.add('LICENSE.electron.txt');
  if (names.some((name) => !allowed.has(name)))
    throw new Error('程序目录包含运行时之外的文件，拒绝把用户文件打进更新包。');
  if (testFailure) {
    // Exercise the identical native replacement/rollback logic with a tiny
    // non-runnable payload. Never distribute this deliberately failing EXE.
    const fixture = path.join(root, 'test-results', 'updater-failure-payload');
    await fs.mkdir(fixture, { recursive: true });
    for (const name of names) {
      const stat = await fs.stat(path.join(payload, name));
      if (stat.isDirectory()) {
        await fs.mkdir(path.join(fixture, name), { recursive: true });
        await fs.writeFile(path.join(fixture, name, 'fixture.txt'), 'test replacement');
      } else await fs.writeFile(path.join(fixture, name), `test replacement ${name}`);
    }
    payload = fixture;
  }
  const manifest = path.join(root, 'test-results', 'updater-files.nsh');
  await fs.mkdir(path.dirname(manifest), { recursive: true });
  await fs.writeFile(
    manifest,
    [
      '!macro ArcwellEntries ACTION',
      ...names.sort().map((name) => `  !insertmacro \${ACTION} "${name}"`),
      '!macroend',
      '',
    ].join('\n'),
  );
  const version = pkg.version.split('.').map(Number);
  const target = path.join(
    testFailure ? path.join(root, 'test-results') : output,
    testFailure ? 'Arcwell-Update-Failure-Test.exe' : `Arcwell-${pkg.version}-Update.exe`,
  );
  const guid = UUID.v5(pkg.build.appId, UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3'));
  const args = [
    '/V2',
    '/WX',
    '/INPUTCHARSET',
    'UTF8',
    `/DVERSION=${pkg.version}`,
    `/DVERSION_HIGH=${version[0] * 65536 + version[1]}`,
    `/DVERSION_LOW=${version[2] * 65536}`,
    `/DAPP_GUID=${guid}`,
    `/DPAYLOAD=${payload}`,
    `/DMANIFEST=${manifest}`,
    `/DOUTPUT=${target}`,
  ];
  if (testFailure) args.push('/DARCWELL_TEST_FAIL_AFTER=3');
  args.push(path.join(root, 'build', 'updater.nsi'));
  const result = spawnSync(await compiler(), args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stdout + '\n' + result.stderr);
  console.log(`Updater built: ${path.basename(target)}`);
  return target;
}
module.exports = { buildUpdater, compiler };
if (require.main === module)
  buildUpdater({ testFailure: process.argv.includes('--test-failure') }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
