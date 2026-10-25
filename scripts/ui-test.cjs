'use strict';
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const http = require('node:http');
const { parseBookmarks } = require('../src/bookmark-html.cjs');
const root = path.resolve(__dirname, '..');
const results = path.join(root, 'test-results');
async function screenshot(application, name) {
  const png = await application.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
      stayHidden: true,
      stayAwake: true,
    });
    if (image.isEmpty()) throw new Error('Screenshot capture was empty.');
    return image.toPNG().toString('base64');
  });
  await fs.writeFile(path.join(results, name), Buffer.from(png, 'base64'));
}
async function launch(directory) {
  return _electron.launch({
    executablePath: process.env.ARCWELL_TEST_EXE || require('electron'),
    args: [root, '--arcwell-test'],
    env: { ...process.env, ARCWELL_TEST_DATA: directory },
    timeout: 30000,
  });
}
(async () => {
  await fs.mkdir(results, { recursive: true });
  const directory = await fs.mkdtemp(path.join(results, 'ui-data-'));
  const fixtureIcon = await fs.readFile(path.join(root, 'assets', 'icon.ico'));
  const server = http.createServer((request, response) => {
    if (request.url === '/favicon.ico') {
      response.writeHead(200, { 'Content-Type': 'image/x-icon' });
      response.end(fixtureIcon);
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<html><link rel="icon" href="/favicon.ico"></html>');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const fixtureUrl = `http://127.0.0.1:${server.address().port}/example`;
  let application;
  try {
    application = await launch(directory);
    const page = await application.firstWindow();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForSelector('.empty');
    assert.equal(await page.locator('#folder-menu').isVisible(), false);
    assert.equal(await page.locator('.folder-more').count(), 0);
    assert.equal(await page.locator('#inspector').isVisible(), false);
    assert.equal(await page.locator('#add-top').count(), 0);
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    await application.evaluate(({ app }) => {
      globalThis.arcwellTestOpenCount = 0;
      app.on('arcwell-test-open', () => {
        globalThis.arcwellTestOpenCount++;
      });
    });
    const customDirectory = path.join(directory, 'custom-backup');
    await fs.mkdir(customDirectory);
    await application.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, customDirectory);
    await page.click('#settings');
    await page.getByRole('button', { name: '选择备份目录', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('#toast').textContent.includes('备份目录已设置'),
    );
    await page.locator('#modal-submit').click();
    // A local-only fixture proves the website opening flow without launching a browser.
    await page.click('#new-folder');
    await page.fill('#folder-name', '设计灵感');
    await page.click('#modal-submit');
    await page.locator('#folders .nav-item').filter({ hasText: '设计灵感' }).click();
    await page.click('#add-header');
    assert.equal(await page.evaluate(() => CSS.supports('appearance', 'base-select')), true);
    await page.locator('#add-folder').click();
    await screenshot(application, 'arcwell-folder-picker.png');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#modal').evaluate((node) => node.open), true);
    await page.fill('#add-url', fixtureUrl);
    await page.click('#modal-submit');
    await page.waitForSelector('.bookmark-row');
    assert.equal(await page.locator('#inspector').isVisible(), false);
    await page.locator('.bookmark-row').click();
    assert.equal(await page.locator('#inspector').isVisible(), false);
    await page.locator('.bookmark-actions button').last().click();
    await page.getByRole('button', { name: '编辑详情', exact: true }).click();
    assert.equal(await application.evaluate(() => globalThis.arcwellTestOpenCount), 1);
    await page.fill('#detail-title', '本地测试收藏');
    await page.fill('#detail-note', '中文备注\n第二行');
    await page.waitForSelector('.website-icon img');
    console.log('Verified automatic ICO favicon loading.');
    await page.locator('#detail-form button[type=submit]').click();
    await page.waitForFunction(() =>
      document.querySelector('.bookmark-title')?.textContent.includes('本地测试收藏'),
    );
    await page.locator('.bookmark-row').click();
    await page.waitForFunction(() => !document.body.hasAttribute('aria-busy'));
    assert.equal(await application.evaluate(() => globalThis.arcwellTestOpenCount), 2);
    await page.locator('.bookmark-actions button').first().click();
    await page.waitForFunction(
      () => document.querySelector('#detail-star')?.getAttribute('aria-checked') === 'true',
    );
    assert.equal(await page.locator('#detail-star').getAttribute('aria-checked'), 'true');
    assert.equal(
      await page
        .locator('.bookmark-actions .starred svg')
        .evaluate((node) => getComputedStyle(node).fill),
      'rgb(245, 197, 66)',
    );
    // Star changes must not wipe unsaved notes.
    await page.fill('#detail-note', '草稿不能丢失');
    await page.locator('.bookmark-actions button').first().click();
    await page.waitForFunction(
      () => document.querySelector('#detail-star')?.getAttribute('aria-checked') === 'false',
    );
    assert.equal(await page.inputValue('#detail-note'), '草稿不能丢失');
    await page.locator('#navigation .nav-item').filter({ hasText: '全部收藏' }).click();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await page.inputValue('#detail-note'), '草稿不能丢失');
    await page.locator('#detail-form button[type=submit]').click();
    await page.waitForFunction(
      () =>
        document.querySelector('#detail-note')?.value === '草稿不能丢失' &&
        !document.querySelector('#detail-form button[type=submit]').textContent.includes('未保存'),
    );
    await page.fill('#quick-url', 'javascript:alert(1)');
    await page.locator('#quick-add button').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('HTTP'));
    assert.equal(await page.locator('.bookmark-row').count(), 1);
    await page.fill('#quick-url', 'example.com');
    await page.locator('#quick-add button').click();
    await page.waitForFunction(() => !document.body.hasAttribute('aria-busy'));
    assert.equal(await application.evaluate(() => globalThis.arcwellTestOpenCount), 3);
    assert.equal(await page.locator('.bookmark-row').count(), 1);
    await page.fill('#search', '没有匹配');
    assert.equal(await page.locator('.bookmark-row').count(), 0);
    await page.fill('#search', '');
    await page.click('#grid-view');
    assert.ok(
      await page.locator('#bookmark-list').evaluate((node) => node.classList.contains('grid')),
    );
    await page.click('#list-view');
    assert.equal(
      await fs.readFile(path.join(directory, 'application', '网址备份.html'), 'utf8'),
      await fs.readFile(path.join(customDirectory, '网址备份.html'), 'utf8'),
    );
    assert.ok(
      !(await fs.readFile(path.join(customDirectory, '网址备份.html'), 'utf8')).includes(
        '草稿不能丢失',
      ),
    );
    console.log('Verified edits, stars, drafts, search and views.');
    await screenshot(application, 'arcwell-functional.png');
    await application.close();
    application = null;
    application = await launch(directory);
    const restarted = await application.firstWindow();
    await restarted.waitForSelector('.bookmark-row');
    await restarted.locator('.bookmark-actions button').last().click();
    await restarted.getByRole('button', { name: '编辑详情', exact: true }).click();
    assert.equal(await restarted.inputValue('#detail-title'), '本地测试收藏');
    assert.equal(await restarted.inputValue('#detail-note'), '草稿不能丢失');
    assert.equal(
      await restarted.inputValue('#detail-folder'),
      await restarted.locator('#detail-folder option').last().getAttribute('value'),
    );
    await restarted.locator('.bookmark-actions button').last().click();
    await restarted.getByRole('button', { name: '移除收藏', exact: true }).click();
    assert.equal(await restarted.locator('#modal').evaluate((node) => node.open), true);
    assert.equal(await restarted.locator('.bookmark-row').count(), 1);
    await restarted.locator('#modal-cancel').click();
    assert.equal(await restarted.locator('.bookmark-row').count(), 1);
    await restarted.locator('.bookmark-actions button').last().click();
    await restarted.getByRole('button', { name: '移除收藏', exact: true }).click();
    await restarted.locator('#modal-submit').click();
    await restarted.waitForSelector('.empty');
    await restarted.getByRole('button', { name: '撤销', exact: true }).click();
    await restarted.waitForSelector('.bookmark-row');
    assert.equal(await restarted.locator('#inspector').isVisible(), false);
    await restarted.locator('.bookmark-actions button').last().click();
    await restarted.getByRole('button', { name: '编辑详情', exact: true }).click();
    // Duplicate URL is rejected without changing the existing record.
    await restarted.click('#add-header');
    await restarted.fill('#add-url', fixtureUrl);
    await restarted.click('#modal-submit');
    await restarted.waitForFunction(() =>
      document.querySelector('#modal-error').textContent.includes('已经收藏'),
    );
    assert.equal(await restarted.locator('.bookmark-row').count(), 1);
    await restarted.getByRole('button', { name: '取消', exact: true }).click();
    await restarted
      .locator('.folder-row')
      .filter({ hasText: '设计灵感' })
      .locator('.nav-item')
      .click();
    await restarted.locator('#folder-menu').click();
    await restarted.getByRole('button', { name: '重命名', exact: true }).click();
    await restarted.fill('#folder-name', '灵感收藏');
    await restarted.locator('#modal-submit').click();
    await restarted.locator('#folder-menu').click();
    await restarted.getByRole('button', { name: '移除文件夹', exact: true }).click();
    const foldersBeforeDelete = await restarted.locator('.folder-row').count();
    await restarted.locator('#modal-cancel').click();
    assert.equal(await restarted.locator('.folder-row').count(), foldersBeforeDelete);
    await restarted.locator('#folder-menu').click();
    await restarted.getByRole('button', { name: '移除文件夹', exact: true }).click();
    await restarted.locator('#modal-submit').click();
    await restarted.waitForSelector('#folder-menu', { state: 'hidden' });
    assert.equal(await restarted.locator('.bookmark-row').count(), 1);
    assert.equal(
      (await restarted.evaluate(() => window.arcwell.load())).library.bookmarks[0].folderId,
      'inbox',
    );
    const exportedFile = path.join(directory, 'exported.html');
    await application.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, exportedFile);
    await restarted.click('#settings');
    await restarted.getByRole('button', { name: '导出收藏备份', exact: true }).click();
    await restarted.waitForFunction(() =>
      document.querySelector('#toast').textContent.includes('已导出'),
    );
    assert.equal(
      (await parseBookmarks(await fs.readFile(exportedFile, 'utf8'))).bookmarks[0].note,
      '',
    );
    assert.equal(
      await fs.readFile(exportedFile, 'utf8'),
      await fs.readFile(path.join(directory, 'application', '网址备份.html'), 'utf8'),
    );
    const actionTops = await restarted
      .locator('.backup-actions button')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
    assert.equal(actionTops.length, 3);
    assert.ok(actionTops.every((top) => top === actionTops[0]));
    await screenshot(application, 'arcwell-settings.png');
    await restarted.locator('#modal-submit').click();
    const importedFile =
      process.env.ARCWELL_IMPORT_FIXTURE || path.join(directory, 'browser-favorites.html');
    if (!process.env.ARCWELL_IMPORT_FIXTURE)
      await fs.writeFile(
        importedFile,
        `<DL><p><DT><H3>浏览器收藏</H3><DL><p><DT><A HREF="${fixtureUrl}">已存在</A><DT><A HREF="https://imported.example">导入的收藏</A><DD>导入备注</DL><p></DL><p>`,
      );
    const parsed = await parseBookmarks(await fs.readFile(importedFile, 'utf8'));
    const beforeImport = await restarted.evaluate(() => window.arcwell.load());
    const expectedCount = new Set([
      ...beforeImport.library.bookmarks.map((item) => item.url),
      ...parsed.bookmarks.map((item) => item.url),
    ]).size;
    await application.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, importedFile);
    await restarted.click('#import-bookmarks');
    assert.equal(await restarted.locator('#import-merge').isChecked(), true);
    await restarted.click('#modal-submit');
    await restarted.waitForFunction(() =>
      document.querySelector('#toast').textContent.includes('已导入'),
    );
    assert.equal(await restarted.locator('.bookmark-row').count(), expectedCount);
    assert.equal(await restarted.locator('#inspector').isVisible(), false);
    const primaryHtml = await fs.readFile(
      path.join(directory, 'application', '网址备份.html'),
      'utf8',
    );
    assert.equal(
      primaryHtml,
      await fs.readFile(path.join(customDirectory, '网址备份.html'), 'utf8'),
    );
    assert.equal((await parseBookmarks(primaryHtml)).bookmarks.length, expectedCount);
    await restarted.click('#import-bookmarks');
    await restarted.click('#modal-submit');
    await restarted.waitForFunction(() =>
      document.querySelector('#toast').textContent.includes('已导入 0 条收藏'),
    );
    assert.equal(await restarted.locator('.bookmark-row').count(), expectedCount);
    // Render the same visual examples as the approved mockup, entirely offline.
    await restarted.evaluate(async () => {
      const loaded = await window.arcwell.load();
      for (const bookmark of loaded.library.bookmarks)
        await window.arcwell.change('remove', { id: bookmark.id });
      for (const folder of loaded.library.folders)
        if (folder.id !== 'inbox') await window.arcwell.change('folder-remove', { id: folder.id });
      const folderIds = {};
      for (const name of ['工作常用', 'AI 工具', '设计灵感', '学习资料', '稍后阅读']) {
        const result = await window.arcwell.change('folder-add', { name });
        folderIds[name] = result.library.folders.find((item) => item.name === name).id;
      }
      for (const [url, title, note, category] of [
        ['https://sspai.com', '少数派', '效率工具与数字生活', '学习资料'],
        ['https://anthropic.com', 'Anthropic', 'AI 产品与研究动态', 'AI 工具'],
        ['https://notion.so', 'Notion', '个人知识库与项目笔记', '工作常用'],
        ['https://figma.com', 'Figma', '界面设计与协作', '设计灵感'],
        ['https://github.com', 'GitHub', '代码仓库与开源项目', '工作常用'],
        ['https://chatgpt.com', 'ChatGPT', '日常提问、文案整理与灵感记录', 'AI 工具'],
      ]) {
        const result = await window.arcwell.change('add', {
          url,
          title,
          folderId: folderIds[category],
        });
        const bookmark = result.library.bookmarks.find((item) => item.id === result.selectedId);
        await window.arcwell.change('edit', { ...bookmark, note });
      }
    });
    await restarted.reload();
    await restarted.waitForSelector('.bookmark-row');
    assert.equal(await restarted.locator('#inspector').isVisible(), false);
    await screenshot(application, 'arcwell-compact-collapsed.png');
    await restarted.click('#new-folder');
    const longName = '工作学习 / 课程学习 / 英语资料与参考网址';
    await restarted.fill('#folder-name', longName);
    await restarted.click('#modal-submit');
    const folderControl = restarted.getByRole('button', { name: longName, exact: true });
    await folderControl.click();
    assert.equal(await folderControl.getAttribute('title'), longName);
    assert.ok(
      await folderControl
        .locator('.nav-label')
        .evaluate((node) => node.scrollWidth > node.clientWidth),
    );
    assert.equal(
      await restarted.locator('#folder-menu').getAttribute('aria-label'),
      `管理文件夹 ${longName}`,
    );
    assert.ok(
      await restarted.evaluate(
        () =>
          document.querySelector('#folder-menu').getBoundingClientRect().right <=
          document.querySelector('.sort').getBoundingClientRect().left,
      ),
    );
    await restarted.locator('#folder-menu').click();
    await screenshot(application, 'arcwell-folder-menu.png');
    await restarted.keyboard.press('Escape');
    await restarted.getByRole('button', { name: '工作常用', exact: true }).click();
    await restarted.locator('#folder-menu').click();
    await restarted.getByRole('button', { name: '新建子文件夹', exact: true }).click();
    await restarted.fill('#folder-name', '项目资料');
    await restarted.click('#modal-submit');
    const childControl = restarted.getByRole('button', {
      name: '工作常用 / 项目资料',
      exact: true,
    });
    assert.equal(await childControl.locator('.nav-label').textContent(), '项目资料');
    await childControl.click();
    await restarted.locator('#folder-menu').click();
    await restarted.getByRole('button', { name: '新建子文件夹', exact: true }).click();
    await restarted.fill('#folder-name', '参考链接');
    await restarted.click('#modal-submit');
    await restarted.waitForSelector('#modal', { state: 'hidden' });
    await restarted.evaluate(async () => {
      const { library } = await window.arcwell.load();
      const folder = library.folders.find((item) => item.importPath?.at(-1) === '参考链接');
      const bookmark = library.bookmarks.find((item) => item.title === 'Notion');
      await window.arcwell.change('edit', { ...bookmark, folderId: folder.id });
    });
    await restarted.reload();
    await restarted.waitForSelector('.bookmark-row');
    await restarted.getByRole('button', { name: '工作常用', exact: true }).click();
    assert.equal(await restarted.locator('.bookmark-row').count(), 2);
    assert.equal(
      await restarted.getByRole('button', { name: '工作常用 / 项目资料', exact: true }).count(),
      0,
    );
    await restarted.getByRole('button', { name: '展开 工作常用', exact: true }).click();
    await restarted.getByRole('button', { name: '展开 工作常用 / 项目资料', exact: true }).click();
    await restarted.locator('#folder-menu').click();
    await restarted.getByRole('button', { name: '重命名', exact: true }).click();
    await restarted.fill('#folder-name', '工作项目');
    await restarted.click('#modal-submit');
    await restarted.waitForSelector('#modal', { state: 'hidden' });
    const grandchildControl = restarted.getByRole('button', {
      name: '工作项目 / 项目资料 / 参考链接',
      exact: true,
    });
    assert.equal(await grandchildControl.count(), 1);
    assert.equal(await grandchildControl.getAttribute('title'), '工作项目 / 项目资料 / 参考链接');
    assert.ok(
      await grandchildControl.evaluate(
        (node) =>
          node.getBoundingClientRect().left >
          document.querySelector('.folder-row .nav-item').getBoundingClientRect().left,
      ),
    );
    await screenshot(application, 'arcwell-folder-tree.png');
    await restarted.locator('#folder-menu').click();
    await restarted.getByRole('button', { name: '移除文件夹', exact: true }).click();
    assert.ok((await restarted.locator('#modal-content').textContent()).includes('所有子文件夹'));
    await restarted.click('#modal-cancel');
    assert.equal(await grandchildControl.count(), 1);
    await restarted.locator('#folder-menu').click();
    await restarted.getByRole('button', { name: '移除文件夹', exact: true }).click();
    await restarted.click('#modal-submit');
    await restarted.waitForSelector('#folder-menu', { state: 'hidden' });
    const afterTreeRemoval = (await restarted.evaluate(() => window.arcwell.load())).library;
    assert.equal(
      afterTreeRemoval.bookmarks.find((item) => item.title === 'Notion').folderId,
      'inbox',
    );
    assert.ok(!afterTreeRemoval.folders.some((item) => item.importPath?.[0] === '工作项目'));
    await restarted.locator('#navigation button').first().click();
    assert.equal(await restarted.locator('#folder-menu').isVisible(), false);
    await restarted
      .locator('.bookmark-row')
      .filter({ hasText: 'ChatGPT' })
      .locator('.bookmark-actions button')
      .last()
      .click();
    await restarted.getByRole('button', { name: '编辑详情', exact: true }).click();
    await screenshot(application, 'arcwell-preview.png');
    for (const [width, height] of [
      [980, 680],
      [1280, 800],
      [1600, 1000],
    ]) {
      await application.evaluate(
        ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]),
        [width, height],
      );
      assert.ok(await restarted.evaluate(() => document.body.scrollWidth <= innerWidth));
      assert.ok(
        await restarted
          .locator('#inspector')
          .evaluate((node) => node.scrollHeight <= node.clientHeight),
        'Inspector must fit without scrolling',
      );
      await screenshot(application, `arcwell-${width}.png`);
    }
    assert.deepEqual(errors, []);
    console.log(
      'UI tests passed: compact layout, collapsed inspector, single click, HTML import/duplicates, two HTML copies, custom path persistence, edits, folders, stars, drafts, search, restart, removal/undo and responsive layout.',
    );
  } finally {
    if (application) await application.close();
    await new Promise((resolve) => server.close(resolve));
    // Keep fixture data and screenshots as reviewable test evidence, never touch user data.
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
