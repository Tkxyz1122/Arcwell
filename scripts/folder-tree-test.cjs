'use strict';
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
  const directory = await fs.mkdtemp(path.join(root, 'test-results', 'tree-data-'));
  const application = await _electron.launch({
    executablePath:
      process.env.ARCWELL_TEST_EXE ||
      path.join(root, 'release', require('../package.json').version, 'win-unpacked', 'Arcwell.exe'),
    args: [root, '--arcwell-test'],
    env: { ...process.env, ARCWELL_TEST_DATA: directory },
  });
  try {
    const page = await application.firstWindow();
    await page.waitForSelector('.empty');
    await page.evaluate(async () => {
      const add = async (name, parentId) => {
        const result = await window.arcwell.change('folder-add', { name, parentId });
        return result.library.folders.at(-1).id;
      };
      const work = await add('工作学习');
      const course = await add('课程学习', work);
      const english = await add('英语', course);
      await add('开发平台', work);
      await add('AI工具');
      await window.arcwell.change('add', {
        url: 'http://127.0.0.1:1/english',
        title: '英语学习资料',
        folderId: english,
      });
    });
    await page.reload();
    await page.waitForSelector('.bookmark-row');
    assert.equal(
      await page.getByRole('button', { name: '工作学习 / 课程学习', exact: true }).count(),
      0,
    );
    await page.getByRole('button', { name: '展开 工作学习', exact: true }).click();
    await page.getByRole('button', { name: '展开 工作学习 / 课程学习', exact: true }).click();
    await page.getByRole('button', { name: '工作学习', exact: true }).click();
    assert.equal(await page.locator('.bookmark-row').count(), 1);
    const english = page.getByRole('button', { name: '工作学习 / 课程学习 / 英语', exact: true });
    assert.equal(await english.locator('.nav-label').textContent(), '英语');
    await page.getByRole('button', { name: '收起 工作学习', exact: true }).click();
    assert.equal(await english.count(), 0);
    await page.getByRole('button', { name: '展开 工作学习', exact: true }).click();
    assert.equal(await english.count(), 1);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await page.screenshot({ path: path.join(root, 'test-results', 'arcwell-folder-tree.png') });
    console.log(
      'Packaged folder tree smoke passed: three levels, subtree count, expand/collapse, visible screenshot.',
    );
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
