'use strict';
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { generateKeyPairSync, sign, createHash } = require('node:crypto');
const pkg = require('../package.json');
const root = path.resolve(__dirname, '..');
(async () => {
  const directory = await fs.mkdtemp(path.join(root, 'test-results', 'release-ui-'));
  const application = await _electron.launch({
    executablePath: path.join(root, pkg.build.directories.output, 'win-unpacked', 'Arcwell.exe'),
    args: ['--arcwell-test'],
    env: { ...process.env, ARCWELL_TEST_DATA: directory },
  });
  const screenshots = path.join(root, 'docs', 'images');
  await fs.mkdir(screenshots, { recursive: true });
  try {
    const page = await application.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForSelector('.empty');
    await application.evaluate(({ app }) => {
      globalThis.openCount = 0;
      globalThis.installCount = 0;
      app.on('arcwell-test-open', () => globalThis.openCount++);
      app.on('arcwell-test-update', () => globalThis.installCount++);
    });
    await page.evaluate(async () => {
      const api = window.arcwell;
      let r = await api.change('folder-add', { name: '工作常用' });
      const work = r.library.folders.at(-1).id;
      r = await api.change('folder-add', { name: '项目资料', parentId: work });
      const child = r.library.folders.at(-1).id;
      r = await api.change('folder-add', { name: '设计灵感' });
      const design = r.library.folders.at(-1).id;
      r = await api.change('folder-add', { name: '学习资料' });
      const study = r.library.folders.at(-1).id;
      for (const [url, title, folderId, note, starred] of [
        ['https://github.com/', 'GitHub', work, '代码、项目与灵感，集中在这里。', true],
        [
          'https://developer.mozilla.org/zh-CN/',
          'MDN Web Docs',
          study,
          '查阅 Web 技术文档与开发指南。',
          true,
        ],
        ['https://www.figma.com/', 'Figma', design, '收集界面设计与协作素材。', false],
        ['https://www.notion.so/', 'Notion', work, '整理想法，规划下一步。', false],
        [
          'https://github.com/Tkxyz1122/Arcwell',
          'Arcwell · 项目主页',
          child,
          '查看源码、更新记录和最新版本。',
          true,
        ],
      ]) {
        r = await api.change('add', { url, title, folderId });
        await api.change('edit', {
          ...r.library.bookmarks.find((b) => b.id === r.selectedId),
          note,
        });
        if (starred) await api.change('star', { id: r.selectedId });
      }
    });
    await page.reload();
    await page.waitForSelector('.bookmark-row');
    assert.equal(
      await page.getByRole('button', { name: '工作常用 / 项目资料', exact: true }).count(),
      0,
    );
    assert.equal(
      await page
        .getByRole('button', { name: '展开 工作常用', exact: true })
        .getAttribute('aria-expanded'),
      'false',
    );
    const importBox = await page.locator('#import-bookmarks').boundingBox();
    const settingsBox = await page.locator('#settings').boundingBox();
    assert.ok(importBox.x + importBox.width <= settingsBox.x && importBox.y === settingsBox.y);
    const row = page.locator('.bookmark-row').first();
    await row.hover();
    assert.notEqual(await row.evaluate((node) => getComputedStyle(node).boxShadow), 'none');
    await row.locator('.bookmark-note').click();
    await page.waitForFunction(() => !document.body.hasAttribute('aria-busy'));
    assert.equal(await application.evaluate(() => globalThis.openCount), 1);
    await row.locator('.bookmark-title').click();
    await page.waitForFunction(() => !document.body.hasAttribute('aria-busy'));
    assert.equal(await application.evaluate(() => globalThis.openCount), 2);
    await row.locator('.folder-chip').click();
    await row.locator('.bookmark-actions button').first().click();
    await page.waitForFunction(() => !document.body.hasAttribute('aria-busy'));
    await row.locator('.bookmark-actions button').last().click();
    assert.equal(await application.evaluate(() => globalThis.openCount), 2);
    await page.keyboard.press('Escape');
    await row.click({ button: 'right' });
    assert.equal(await application.evaluate(() => globalThis.openCount), 2);
    await page.keyboard.press('Escape');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
    const shot = async (name) => {
      await page.evaluate(() => document.activeElement?.blur());
      await page.mouse.move(1170, 180);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      await page.screenshot({ path: path.join(screenshots, name) });
    };
    await shot('overview.png');
    await page.getByRole('button', { name: '展开 工作常用', exact: true }).click();
    assert.equal(
      await page.getByRole('button', { name: '工作常用 / 项目资料', exact: true }).count(),
      1,
    );
    await row.locator('.bookmark-actions button').last().click();
    await page.getByRole('button', { name: '编辑详情', exact: true }).click();
    await shot('details.png');
    await page.click('#import-bookmarks');
    await shot('import.png');
    await page.click('#modal-cancel');
    await page.click('#settings');
    await page.locator('.backup-paths').evaluate((node) => {
      node.textContent =
        '应用内：D:\\Apps\\Arcwell\\网址备份.html\n自定义：E:\\Backups\\Arcwell\\网址备份.html\n两份备份会随每次修改自动更新。';
    });
    await shot('settings.png');
    assert.equal(await page.locator('#check-update').isVisible(), true);
    // Signed synthetic feed: only the isolated test process trusts this key.
    // The test-mode IPC emits an event instead of executing any downloaded file.
    const keys = generateKeyPairSync('ed25519');
    const binary = Buffer.from('not an executable - test never launches this');
    const filename = 'Arcwell-0.5.2-Update.exe';
    const manifest = {
      repository: 'Tkxyz1122/Arcwell',
      version: '0.5.2',
      filename,
      size: binary.length,
      sha256: createHash('sha256').update(binary).digest('hex'),
    };
    const payload = Buffer.from(JSON.stringify(manifest));
    const envelope = JSON.stringify({
      payload: payload.toString('base64'),
      signature: sign(null, payload, keys.privateKey).toString('base64'),
    });
    await application.evaluate(
      ({ dialog }, fixture) => {
        const exports = Object.values(process.mainModule.require('node:module')._cache).find(
          (entry) => entry.exports.UpdateService,
        )?.exports;
        const originalCheck = exports.UpdateService.prototype.check;
        exports.UpdateService.prototype.check = function () {
          this.publicKey = fixture.key;
          this.fetch = async (url) => {
            if (url.endsWith('/latest'))
              return new Response(
                JSON.stringify({
                  tag_name: 'v0.5.2',
                  draft: false,
                  prerelease: false,
                  assets: [
                    {
                      name: 'update.json',
                      size: fixture.envelope.length,
                      browser_download_url:
                        'https://github.com/Tkxyz1122/Arcwell/releases/download/v0.5.2/update.json',
                    },
                    {
                      name: fixture.filename,
                      size: fixture.size,
                      browser_download_url: `https://github.com/Tkxyz1122/Arcwell/releases/download/v0.5.2/${fixture.filename}`,
                    },
                  ],
                }),
              );
            return new Response(
              url.endsWith('/update.json')
                ? fixture.envelope
                : Buffer.from(fixture.binary, 'base64'),
            );
          };
          return originalCheck.call(this);
        };
        globalThis.updateAnswer = 0;
        dialog.showMessageBox = async () => ({ response: globalThis.updateAnswer });
      },
      {
        key: keys.publicKey.export({ type: 'spki', format: 'pem' }),
        envelope,
        filename,
        size: binary.length,
        binary: binary.toString('base64'),
      },
    );
    await page.click('#check-update');
    await page.waitForSelector('#download-update:not([hidden])');
    await page.click('#download-update');
    await page.waitForSelector('#install-update:not([hidden])');
    await page.click('#install-update');
    await page.waitForFunction(() => !document.querySelector('#install-update').disabled);
    assert.equal(await application.evaluate(() => globalThis.installCount), 0);
    await application.evaluate(() => {
      globalThis.updateAnswer = 1;
    });
    await page.click('#install-update');
    await page.waitForFunction(() => !document.querySelector('#install-update').disabled);
    assert.equal(await application.evaluate(() => globalThis.installCount), 1);
    await page.click('#modal-submit');
    await page.fill('#detail-note', '未保存内容');
    await page.click('#settings');
    await page.click('#install-update');
    await page.waitForFunction(() =>
      document.querySelector('#modal-error').textContent.includes('先保存'),
    );
    assert.equal(await application.evaluate(() => globalThis.installCount), 1);
    await page.click('#modal-submit');
    await page.locator('#detail-form button[type=submit]').click();
    await page.waitForFunction(
      () =>
        !document.querySelector('#detail-form button[type=submit]').textContent.includes('未保存'),
    );
    await page.reload();
    await page.waitForSelector('.bookmark-row');
    assert.equal(
      await page.getByRole('button', { name: '工作常用 / 项目资料', exact: true }).count(),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      'Release UI passed: footer import, startup collapse, hover, single click, protected controls, signed update download, installation confirmation/cancel, draft protection. Demo screenshots saved.',
    );
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
