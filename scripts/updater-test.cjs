'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { _electron } = require('playwright');
const { buildUpdater, compiler } = require('./build-updater.cjs');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const updater = path.join(root, pkg.build.directories.output, `Arcwell-${pkg.version}-Update.exe`);
const payload = path.join(root, pkg.build.directories.output, 'win-unpacked');
const oldPayload = path.resolve(
  process.env.ARCWELL_UPDATE_BASELINE || path.join(root, 'release', '0.3.0', 'win-unpacked'),
);
let testRoot;
const hash = async (file) =>
  crypto
    .createHash('sha256')
    .update(await fs.readFile(file))
    .digest('hex');
async function inventory(directory, prefix = '') {
  const files = {};
  for (const entry of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const name = path.join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(files, await inventory(directory, name));
    else files[name] = await hash(path.join(directory, name));
  }
  return files;
}
function run(exe, args = []) {
  return new Promise((resolve, reject) => {
    assert.ok(testRoot && testRoot.startsWith(path.join(root, 'test-results') + path.sep));
    const child = spawn(exe, args, {
      env: { ...process.env, ARCWELL_UPDATE_TEST_ROOT: testRoot },
      windowsVerbatimArguments: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('隔离更新测试超时'));
    }, 60000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}
async function openApp(target, data) {
  const app = await _electron.launch({
    executablePath: path.join(target, 'Arcwell.exe'),
    args: ['--arcwell-test'],
    env: { ...process.env, ARCWELL_TEST_DATA: data },
  });
  await (await app.firstWindow()).waitForSelector('#add-header');
  return app;
}
(async () => {
  const results = path.join(root, 'test-results');
  await fs.access(path.join(oldPayload, 'Arcwell.exe')).catch(() => {
    throw new Error(
      '请通过 ARCWELL_UPDATE_BASELINE 指定旧版完整程序目录，测试会只读复制到隔离目录。',
    );
  });
  const directory = await fs.mkdtemp(path.join(results, 'update-data-'));
  testRoot = directory;
  const target = path.join(directory, '应用 程序', 'Arcwell');
  const data = path.join(directory, 'user-data');
  const custom = path.join(directory, 'custom-backup');
  await fs.mkdir(custom, { recursive: true });
  await fs.cp(oldPayload, target, { recursive: true });
  await fs.writeFile(
    path.join(target, 'Uninstall Arcwell.exe'),
    'legacy uninstaller sentinel: must never execute or replace',
  );
  await fs.writeFile(path.join(target, '原快捷方式.lnk'), 'shortcut target remains Arcwell.exe');
  await fs.writeFile(path.join(target, '网址备份.html'), 'existing root HTML must survive update');
  let app;
  let lock;
  const checks = [];
  try {
    assert.equal(await run(updater, ['/S']), 9);
    checks.push('test-root guard blocks auto-detected installations outside the fixture');
    app = await openApp(target, data);
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, custom);
    await page.click('#settings');
    await page.getByRole('button', { name: '选择备份目录', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('#toast').textContent.includes('备份目录已设置'),
    );
    await page.click('#modal-submit');
    await page.evaluate(async () => {
      let result = await window.arcwell.change('folder-add', { name: '工作' });
      const parent = result.library.folders.at(-1).id;
      result = await window.arcwell.change('folder-add', { name: '资料', parentId: parent });
      const folderId = result.library.folders.at(-1).id;
      result = await window.arcwell.change('add', {
        url: 'http://127.0.0.1:1/update-test',
        title: '升级保留的收藏',
        folderId,
      });
      const bookmark = result.library.bookmarks[0];
      await window.arcwell.change('edit', { ...bookmark, note: '备注必须保留' });
      await window.arcwell.change('star', { id: bookmark.id });
    });
    const preserved = [
      path.join(data, 'data', 'library.json'),
      path.join(data, 'backup-settings.json'),
      path.join(custom, '网址备份.html'),
      path.join(target, '网址备份.html'),
      path.join(target, '原快捷方式.lnk'),
    ];
    const before = await Promise.all(preserved.map(hash));
    const assertPreserved = async () =>
      assert.deepEqual(await Promise.all(preserved.map(hash)), before);
    assert.equal(await run(updater, ['/S', `/D=${target}`]), 0);
    await assertPreserved();
    await app.close().catch(() => {});
    app = null;
    const expected = await inventory(payload);
    const verifyProgram = async () => {
      for (const [name, content] of Object.entries(expected))
        assert.equal(await hash(path.join(target, name)), content, name);
      assert.equal(
        await hash(path.join(target, 'Uninstall Arcwell.exe')),
        await hash(
          path.join(root, 'test-results', `uninstaller-${pkg.version}`, 'Uninstall Arcwell.exe'),
        ),
      );
    };
    await verifyProgram();
    checks.push(
      'previous running copy updated in place; normal close; payload and new uninstaller hashes match; library/settings/HTML/shortcuts preserved',
    );
    app = await openApp(target, data);
    const loaded = await (await app.firstWindow()).evaluate(() => window.arcwell.load());
    assert.equal(loaded.library.bookmarks[0].note, '备注必须保留');
    assert.equal(loaded.library.bookmarks[0].starred, true);
    assert.deepEqual(
      loaded.library.folders.find((folder) => folder.id === loaded.library.bookmarks[0].folderId)
        .importPath,
      ['工作', '资料'],
    );
    await app.close();
    app = null;
    checks.push('new app starts and reads nested folders, notes and stars');
    // Reopening legitimately refreshes the HTML timestamp; snapshot again.
    const afterReopen = await Promise.all(preserved.map(hash));
    assert.equal(await run(updater, ['/S', `/D=${target}`]), 0);
    assert.deepEqual(await Promise.all(preserved.map(hash)), afterReopen);
    await verifyProgram();
    checks.push('same-version reapply is idempotent');
    const portableTarget = path.join(directory, 'portable', 'Arcwell');
    await fs.cp(oldPayload, portableTarget, { recursive: true });
    assert.equal(await run(updater, ['/S', `/D=${portableTarget}`]), 0);
    await assert.rejects(fs.access(path.join(portableTarget, 'Uninstall Arcwell.exe')));
    checks.push('portable update does not create an uninstaller for an unregistered copy');
    await fs.cp(oldPayload, target, { recursive: true });
    const oldFiles = await inventory(target);
    const failingUpdater = await buildUpdater({ testFailure: true });
    assert.notEqual(await run(failingUpdater, ['/S', `/D=${target}`]), 0);
    assert.deepEqual(await inventory(target), oldFiles);
    checks.push(
      'injected failure after three replacements restores every original program and user file',
    );
    const nsis = await compiler();
    const lockSource = path.join(directory, 'lock.nsi');
    const lockExe = path.join(directory, 'lock.exe');
    await fs.writeFile(
      lockSource,
      `Unicode true\nName "Arcwell updater lock fixture"\nOutFile "${lockExe}"\nRequestExecutionLevel user\nSilentInstall silent\nSection\nFileOpen $0 "$INSTDIR\\Arcwell.exe" r\nFileOpen $1 "$INSTDIR\\lock-ready" w\nFileWrite $1 "ready"\nFileClose $1\nSleep 30000\nFileClose $0\nSectionEnd\n`,
    );
    const compile = spawnSync(nsis, ['/V2', '/INPUTCHARSET', 'UTF8', lockSource], {
      encoding: 'utf8',
    });
    assert.equal(compile.status, 0, compile.stdout + compile.stderr);
    lock = spawn(lockExe, ['/S', `/D=${target}`], {
      windowsVerbatimArguments: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        await fs.access(path.join(target, 'lock-ready')).then(
          () => true,
          () => false,
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(
      await fs.access(path.join(target, 'lock-ready')).then(
        () => true,
        () => false,
      ),
    );
    assert.notEqual(await run(updater, ['/S', `/D=${target}`]), 0);
    lock.kill();
    await new Promise((resolve) => lock.once('exit', resolve));
    lock = null;
    await fs.unlink(path.join(target, 'lock-ready'));
    assert.deepEqual(await inventory(target), oldFiles);
    checks.push('busy executable refuses update and restores the unchanged original copy');
    const empty = path.join(directory, 'empty');
    await fs.mkdir(empty);
    assert.notEqual(await run(updater, ['/S', `/D=${empty}`]), 0);
    assert.deepEqual(await fs.readdir(empty), []);
    checks.push('non-installation directory refused without scattered files');
    await fs.copyFile(
      path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
      path.join(target, 'Arcwell.exe'),
    );
    const newerHash = await hash(path.join(target, 'Arcwell.exe'));
    assert.notEqual(await run(updater, ['/S', `/D=${target}`]), 0);
    assert.equal(await hash(path.join(target, 'Arcwell.exe')), newerHash);
    checks.push('newer executable version refused to prevent downgrade');
    await fs.writeFile(
      path.join(results, 'updater-results.json'),
      JSON.stringify({ version: pkg.version, checks }, null, 2),
    );
    console.log(`Updater native tests passed (${checks.length} checks):\n${checks.join('\n')}`);
  } finally {
    if (lock) lock.kill();
    if (app) await app.close().catch(() => {});
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
