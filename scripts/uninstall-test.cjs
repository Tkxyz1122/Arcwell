'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { compiler } = require('./build-updater.cjs');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const htmlName = '\u7f51\u5740\u5907\u4efd.html';
const exists = (file) =>
  fs.access(file).then(
    () => true,
    () => false,
  );
(async () => {
  const directory = await fs.mkdtemp(path.join(root, 'test-results', 'uninstall-data-'));
  const setup = path.join(directory, 'fixture-setup.exe');
  const result = spawnSync(
    await compiler(),
    [
      '/V2',
      '/WX',
      '/INPUTCHARSET',
      'UTF8',
      `/DFIXTURE_OUTPUT=${setup}`,
      `/DBUILD_RESOURCES_DIR=${path.join(root, 'build')}`,
      path.join(root, 'scripts/uninstall-data-test.nsi'),
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const checks = [];
  async function fixture(name) {
    const base = path.join(directory, name);
    const install = path.join(base, '\u5e94\u7528 \u7a0b\u5e8f', 'Arcwell');
    const profile = path.join(path.dirname(install), 'profile', 'Arcwell');
    const external = path.join(base, 'custom-backup');
    for (const folder of [install, profile, external]) await fs.mkdir(folder, { recursive: true });
    const data = path.join(profile, 'library.json');
    const html = path.join(install, htmlName);
    await fs.writeFile(data, 'library and notes must survive unless confirmed');
    await fs.writeFile(html, 'HTML backup must survive unless confirmed');
    await fs.writeFile(path.join(external, htmlName), 'external backup must always survive');
    const created = spawnSync(setup, ['/S', `/D=${install}`], {
      windowsVerbatimArguments: true,
      windowsHide: true,
    });
    assert.equal(created.status, 0);
    return {
      base,
      install,
      profile,
      external,
      data,
      html,
      exe: path.join(install, 'Uninstall Arcwell.exe'),
    };
  }
  async function run(f, answers = [], flags = '/S', lockedFile) {
    const request = path.join(f.base, 'request.json');
    await fs.writeFile(
      request,
      JSON.stringify({
        root: directory,
        exe: f.exe,
        arguments: `${flags} _?=${f.install}`,
        answers,
        lockedFile,
        expectRecycled:
          answers.length === 2 && answers.every((answer) => answer === 6) && !lockedFile
            ? [f.profile, f.html]
            : [],
      }),
    );
    const execution = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(root, 'scripts/uninstall-dialog-test.ps1'),
        '-RequestFile',
        request,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 35000 },
    );
    assert.equal(execution.status, 0, execution.stdout + execution.stderr);
    return JSON.parse(execution.stdout.replace(/^\uFEFF/, '').trim());
  }
  async function externalIntact(f) {
    assert.equal(
      await fs.readFile(path.join(f.external, htmlName), 'utf8'),
      'external backup must always survive',
    );
  }
  async function kept(f) {
    assert.equal(
      await fs.readFile(f.data, 'utf8'),
      'library and notes must survive unless confirmed',
    );
    const copies = await fs.readdir(path.join(f.profile, 'uninstall-backups'));
    assert.ok(copies.length);
    assert.equal(
      await fs.readFile(path.join(f.profile, 'uninstall-backups', copies[0]), 'utf8'),
      'HTML backup must survive unless confirmed',
    );
    await externalIntact(f);
  }
  let f = await fixture('silent');
  assert.equal((await run(f)).exitCode, 0);
  await kept(f);
  checks.push('silent uninstall preserves profile and copies program HTML before program removal');
  f = await fixture('keep');
  assert.equal((await run(f, [7], '--interactive')).exitCode, 0);
  await kept(f);
  checks.push('interactive No preserves profile and application HTML');
  f = await fixture('cancel');
  assert.equal((await run(f, [2], '--interactive')).exitCode, 1);
  assert.ok(await exists(f.data));
  assert.ok(await exists(f.html));
  checks.push('Cancel stops uninstall before touching data');
  f = await fixture('decline-confirmation');
  assert.equal((await run(f, [6, 7], '--interactive')).exitCode, 0);
  await kept(f);
  checks.push('declining second confirmation preserves data');
  f = await fixture('recycle');
  const recycled = await run(f, [6, 6], '--interactive');
  assert.equal(recycled.exitCode, 0);
  assert.equal(recycled.dialogs.length, 2);
  assert.deepEqual(recycled.recycledPaths, [f.profile, f.html]);
  assert.ok(recycled.dialogs[1].includes(f.profile));
  assert.ok(recycled.dialogs[1].includes(f.html));
  assert.equal(await exists(f.profile), false);
  assert.equal(await exists(f.html), false);
  await externalIntact(f);
  checks.push(
    'two explicit confirmations show exact paths and recycle profile plus application HTML; external backup retained',
  );
  f = await fixture('updated');
  assert.equal((await run(f, [], '--interactive --updated')).exitCode, 0);
  await kept(f);
  checks.push('installer update does not ask for deletion and preserves data');
  f = await fixture('locked');
  assert.equal((await run(f, [], '/S --recycle-direct', f.html)).exitCode, 2);
  assert.ok(await exists(f.data));
  assert.ok(await exists(f.html));
  await externalIntact(f);
  checks.push('locked backup stops uninstall and retains profile instead of deleting permanently');
  f = await fixture('nested-junction');
  await fs.symlink(f.external, path.join(f.profile, 'linked-backup'), 'junction');
  assert.equal((await run(f, [6, 6], '--interactive')).exitCode, 0);
  assert.equal(await exists(f.profile), false);
  await externalIntact(f);
  checks.push('nested directory junction is recycled without traversing its external target');
  f = await fixture('root-junction');
  await fs.rename(f.profile, f.profile + '-saved');
  await fs.symlink(f.external, f.profile, 'junction');
  assert.equal((await run(f, [], '/S')).exitCode, 2);
  await externalIntact(f);
  checks.push('root junction is refused before processing data');
  f = await fixture('production-guard');
  await fs.copyFile(
    path.join(root, 'test-results', `uninstaller-${pkg.version}`, 'Uninstall Arcwell.exe'),
    f.exe,
  );
  assert.equal((await run(f)).exitCode, 9);
  checks.push('actual distributed uninstaller refuses test execution against real APPDATA');
  await fs.writeFile(
    path.join(root, 'test-results', 'uninstall-results.json'),
    JSON.stringify({ version: pkg.version, checks, directory }, null, 2),
  );
  console.log(`Uninstall native tests passed (${checks.length} checks).`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
