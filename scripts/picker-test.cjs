'use strict';
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..');
  const directory = await fs.mkdtemp(path.join(root, 'test-results/picker-data-'));
  const application = await _electron.launch({
    executablePath:
      process.env.ARCWELL_TEST_EXE ||
      path.join(root, 'release', require('../package.json').version, 'win-unpacked/Arcwell.exe'),
    args: [root, '--arcwell-test'],
    env: { ...process.env, ARCWELL_TEST_DATA: directory },
  });
  try {
    const page = await application.firstWindow();
    await page.waitForSelector('.empty');
    for (const name of [
      '工作学习',
      '工作学习 / 课程学习',
      '工作学习 / 开发平台',
      '邮箱',
      '资源社区',
      '工具',
      'AI工具',
      'AI工具 / API',
      '游戏',
      '稍后阅读',
    ])
      await page.evaluate((name) => window.arcwell.change('folder-add', { name }), name);
    await page.reload();
    await page.waitForSelector('.empty');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
    await page.click('#add-header');
    await page.locator('#add-folder').focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.getElementById('add-folder').matches(':open'));
    const style = await page.locator('#add-folder').evaluate((node) => {
      const p = getComputedStyle(node, '::picker(select)');
      return {
        background: p.backgroundColor,
        radius: p.borderTopLeftRadius,
        maxHeight: p.maxHeight,
      };
    });
    assert.equal(style.background, 'rgb(252, 252, 251)');
    assert.equal(style.radius, '7px');
    assert.equal(style.maxHeight, '240px');
    await page.screenshot({ path: path.join(root, 'test-results/arcwell-folder-picker.png') });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(
      await page.locator('#add-folder').evaluate((node) => node.matches(':open')),
      false,
    );
    console.log(
      'Expanded picker verified: rounded warm-white popup, bounded height and keyboard selection.',
    );
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
