'use strict';
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
(async () => {
  const directory = await fs.mkdtemp(path.join(root, 'test-results', 'import-data-'));
  const file = path.join(directory, 'browser.html');
  const custom = path.join(directory, 'custom');
  await fs.mkdir(custom);
  await fs.writeFile(
    file,
    '<DL><H3>导入分类</H3><DL><H3>资料</H3><DL><A HREF="http://127.0.0.1:1/existing">文件中的新名称</A><A HREF="http://127.0.0.1:1/new">新增网址</A></DL></DL></DL>',
  );
  const application = await _electron.launch({
    executablePath:
      process.env.ARCWELL_TEST_EXE ||
      path.join(root, pkg.build.directories.output, 'win-unpacked', 'Arcwell.exe'),
    args: ['--arcwell-test'],
    env: { ...process.env, ARCWELL_TEST_DATA: directory },
  });
  try {
    const page = await application.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForSelector('.empty');
    assert.equal(
      await page.getByRole('button', { name: '导入 HTML', exact: true }).isVisible(),
      true,
    );
    assert.equal(await page.locator('.footer-actions #import-bookmarks').count(), 1);
    assert.match(await page.locator('#import-bookmarks').getAttribute('title'), /导入.*HTML/);
    const importBox = await page.locator('#import-bookmarks').boundingBox();
    const settingsBox = await page.locator('#settings').boundingBox();
    assert.ok(importBox.width <= 40 && importBox.x + importBox.width <= settingsBox.x);
    assert.equal(await page.getByRole('button', { name: '默认分区', exact: true }).count(), 1);
    await application.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, custom);
    await page.click('#settings');
    await page.getByRole('button', { name: '选择备份目录', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('#toast').textContent.includes('备份目录已设置'),
    );
    await page.click('#modal-submit');
    await page.evaluate(async () => {
      let result = await window.arcwell.change('folder-add', { name: '原分类' });
      const folderId = result.library.folders.at(-1).id;
      result = await window.arcwell.change('add', {
        url: 'http://127.0.0.1:1/existing',
        title: '保留原名称',
        folderId,
      });
      await window.arcwell.change('edit', { ...result.library.bookmarks[0], note: '保留原备注' });
      await window.arcwell.change('star', { id: result.selectedId });
      await window.arcwell.change('add', {
        url: 'http://127.0.0.1:1/absent',
        title: '文件中没有也保留',
        folderId: 'inbox',
      });
    });
    await page.reload();
    await page.waitForSelector('.bookmark-row');
    const before = (await page.evaluate(() => window.arcwell.load())).library;
    await application.evaluate(({ dialog }, file) => {
      globalThis.importAnswer = 0;
      globalThis.importPrompts = [];
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      dialog.showMessageBox = async (_window, options) => {
        globalThis.importPrompts.push(options);
        return { response: globalThis.importAnswer };
      };
    }, file);
    await page.click('#import-bookmarks');
    assert.equal(await page.locator('#import-merge').isChecked(), true);
    await page.click('#modal-submit');
    await page.waitForSelector('#modal', { state: 'hidden' });
    const merged = (await page.evaluate(() => window.arcwell.load())).library;
    assert.equal(merged.bookmarks.length, 3);
    for (const bookmark of before.bookmarks)
      assert.deepEqual(
        merged.bookmarks.find((item) => item.id === bookmark.id),
        bookmark,
      );
    assert.equal((await application.evaluate(() => globalThis.importPrompts)).length, 0);
    await page.click('#import-bookmarks');
    await page.check('#import-replace');
    await page.click('#modal-submit');
    await page.waitForFunction(() => !document.querySelector('#modal-submit').disabled);
    assert.deepEqual((await page.evaluate(() => window.arcwell.load())).library, merged);
    const prompts = await application.evaluate(() => globalThis.importPrompts);
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].defaultId, 0);
    assert.equal(prompts[0].buttons[0], '取消');
    const dataFolder = path.join(directory, 'data');
    const recoveryNames = async () =>
      (await fs.readdir(dataFolder)).filter((name) => name.startsWith('library.before-import-'));
    assert.equal((await recoveryNames()).length, 0);
    await application.evaluate(() => {
      globalThis.importAnswer = 1;
    });
    await page.click('#modal-submit');
    await page.waitForSelector('#modal', { state: 'hidden' });
    const replaced = (await page.evaluate(() => window.arcwell.load())).library;
    assert.equal(replaced.bookmarks.length, 2);
    assert.ok(!replaced.bookmarks.some((item) => item.url.includes('/absent')));
    const existing = replaced.bookmarks.find((item) => item.url.includes('/existing'));
    assert.equal(existing.title, '文件中的新名称');
    assert.equal(existing.note, '');
    assert.equal(existing.starred, false);
    assert.ok(!replaced.folders.some((folder) => folder.name === '原分类'));
    const names = await recoveryNames();
    assert.equal(names.length, 1);
    const savedRecovery = await fs.readFile(path.join(dataFolder, names[0]), 'utf8');
    assert.deepEqual(JSON.parse(savedRecovery), merged);
    assert.equal(
      await fs.readFile(path.join(directory, 'application', '网址备份.html'), 'utf8'),
      await fs.readFile(path.join(custom, '网址备份.html'), 'utf8'),
    );
    await fs.writeFile(file, '<p>不是书签文件</p>');
    await page.click('#import-bookmarks');
    await page.check('#import-replace');
    await page.click('#modal-submit');
    await page.waitForFunction(() =>
      document.querySelector('#modal-error').textContent.includes('未找到'),
    );
    assert.deepEqual((await page.evaluate(() => window.arcwell.load())).library, replaced);
    assert.equal((await recoveryNames()).length, 1);
    await page.click('#modal-cancel');
    await application.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    });
    await page.click('#import-bookmarks');
    await page.click('#modal-submit');
    await page.waitForFunction(() => !document.querySelector('#modal-submit').disabled);
    assert.deepEqual((await page.evaluate(() => window.arcwell.load())).library, replaced);
    await page.click('#modal-cancel');
    await page.evaluate(async () => {
      const { library } = await window.arcwell.load();
      await window.arcwell.change('star', { id: library.bookmarks[0].id });
    });
    assert.equal(await fs.readFile(path.join(dataFolder, names[0]), 'utf8'), savedRecovery);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await page.screenshot({ path: path.join(root, 'test-results', 'arcwell-import-entry.png') });
    await page.click('#import-bookmarks');
    await page.screenshot({ path: path.join(root, 'test-results', 'arcwell-import-modes.png') });
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(980, 680),
    );
    assert.ok(
      await page.evaluate(() => {
        const button = document.querySelector('#modal-submit').getBoundingClientRect();
        return button.bottom <= innerHeight && document.body.scrollWidth <= innerWidth;
      }),
    );
    await page.click('#modal-cancel');
    assert.ok(
      await page.locator('#import-bookmarks').evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        return bounds.bottom <= innerHeight && bounds.height > 20;
      }),
    );
    assert.deepEqual(errors, []);
    console.log(
      'Import UI passed: visible entry/default partition, A preservation, B confirm/cancel/replace, durable recovery, both HTML copies, malformed/canceled file, minimum-size layout.',
    );
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
