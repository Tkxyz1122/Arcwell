'use strict';
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { emptyLibrary, mutate } = require('../src/domain.cjs');
const root = path.resolve(__dirname, '..');
const temp = path.join(root, '_Temp');
async function capture(app, name) {
  const bytes = await app.evaluate(async ({ BrowserWindow }) =>
    (
      await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      })
    )
      .toPNG()
      .toString('base64'),
  );
  await fs.writeFile(path.join(temp, name), Buffer.from(bytes, 'base64'));
}
(async () => {
  await fs.mkdir(temp, { recursive: true });
  const directory = await fs.mkdtemp(path.join(temp, 'hierarchy-ui-'));
  let library = emptyLibrary();
  const ids = {};
  for (const [name, parent] of [
    ['工作常用'],
    ['学习资料'],
    ['A 项目资料', '工作常用'],
    ['B 设计灵感', '工作常用'],
    ['深层参考', 'A 项目资料'],
    ['C 空文件夹', '工作常用'],
  ]) {
    library = mutate(library, 'folder-add', { name, parentId: ids[parent] }).library;
    ids[name] = library.folders.at(-1).id;
    library.folders.at(-1).createdAt = new Date(
      Date.UTC(2026, 0, Object.keys(ids).length),
    ).toISOString();
  }
  const deepIds = [];
  let deepParent = ids['B 设计灵感'];
  for (let depth = 3; depth <= 30; depth++) {
    library = mutate(library, 'folder-add', { name: '层级' + depth, parentId: deepParent }).library;
    deepParent = library.folders.at(-1).id;
    deepIds.push(deepParent);
  }
  for (const [title, folder, star] of [
    ['默认网址', 'inbox', false],
    ['工作门户', '工作常用', false],
    ['项目文档', 'A 项目资料', true],
    ['深层网页', '深层参考', true],
    ['设计网站', 'B 设计灵感', false],
    ['课程文档', '学习资料', false],
  ]) {
    library = mutate(library, 'add', {
      url: 'http://127.0.0.1:9/' + encodeURIComponent(title),
      title,
      folderId: ids[folder] || folder,
    }).library;
    library.bookmarks[0].starred = star;
    library.bookmarks[0].note = '保留备注 · 单击用默认浏览器打开';
  }
  await fs.mkdir(path.join(directory, 'data'));
  const file = path.join(directory, 'data/library.json');
  const original = JSON.stringify(library);
  await fs.writeFile(file, original);
  const launch = () =>
    _electron.launch({
      executablePath: process.env.ARCWELL_TEST_EXE || require('electron'),
      args: [root, '--arcwell-test'],
      env: { ...process.env, ARCWELL_TEST_DATA: directory },
    });
  let app = await launch();
  const report = { sizes: [] };
  try {
    let page = await app.firstWindow();
    await page.waitForSelector('.folder-card');
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await app.evaluate(({ app }) => {
      globalThis.treeOpenCount = 0;
      app.on('arcwell-test-open', () => globalThis.treeOpenCount++);
    });
    assert.deepEqual(await page.locator('#folders .nav-label').allTextContents(), [
      '默认分区',
      '工作常用',
      '学习资料',
    ]);
    assert.equal(await page.locator('.bookmark-row').count(), 1);
    assert.equal(await page.locator('.folder-card').count(), 2);
    assert.equal(await page.locator('.folder-group.is-expanded').count(), 0);
    await page.locator('#folders .nav-item').filter({ hasText: '工作常用' }).click();
    const group = (name) => page.locator('.folder-group[data-folder-id="' + ids[name] + '"]');
    const heading = (name) => group(name).locator(':scope > .folder-card');
    const title = (name) => heading(name).locator('.folder-title');
    assert.equal(await heading('A 项目资料').locator('.bookmark-domain').count(), 0);
    const folderHeight = (await heading('A 项目资料').boundingBox()).height;
    assert.ok(folderHeight >= 60 && folderHeight <= 62, 'Folder rows occupy about 80% of 76px.');
    report.folderHeight = folderHeight;
    await heading('A 项目资料').hover({ position: { x: 70, y: 20 } });
    const hint = page.locator('#collection-hint');
    await hint.waitFor({ state: 'visible' });
    assert.equal(await hint.textContent(), '1 个文件夹 · 2 个链接');
    const hintBox = await hint.boundingBox();
    assert.ok(hintBox.height < 32 && hintBox.width < 220, 'The count hint stays small.');
    await page.keyboard.press('Escape');
    assert.equal(await hint.isVisible(), false);
    await heading('A 项目资料').hover({ position: { x: 75, y: 20 } });
    await hint.waitFor({ state: 'visible' });
    await heading('A 项目资料').locator('.bookmark-actions button').last().hover();
    assert.equal(await hint.isVisible(), false);
    assert.equal(await app.evaluate(() => globalThis.treeOpenCount), 0);
    assert.equal(await page.locator('.bookmark-row').count(), 1);
    const children = () =>
      page.locator('#bookmark-list > .folder-group > .folder-card .folder-title').allTextContents();
    assert.deepEqual(await children(), ['C 空文件夹', 'B 设计灵感', 'A 项目资料']);
    await page.selectOption('#sort', 'name');
    assert.deepEqual(await children(), ['A 项目资料', 'B 设计灵感', 'C 空文件夹']);
    await page.click('#sort-direction');
    assert.deepEqual(await children(), ['C 空文件夹', 'B 设计灵感', 'A 项目资料']);
    await page.selectOption('#sort', 'recent');
    await page.click('#sort-direction');
    assert.deepEqual(await children(), ['A 项目资料', 'B 设计灵感', 'C 空文件夹']);
    assert.equal(
      await page.locator('#bookmark-list > :first-child').getAttribute('data-folder-id'),
      ids['A 项目资料'],
    );
    await heading('A 项目资料').locator('.bookmark-note').click();
    assert.equal(await title('A 项目资料').getAttribute('aria-expanded'), 'true');
    assert.ok(
      await group('A 项目资料')
        .locator(':scope > .folder-reveal')
        .evaluate((node) => node.getAnimations().length > 0),
    );
    assert.equal(await title('深层参考').isVisible(), true);
    assert.equal(await page.locator('.bookmark-row:visible').count(), 2);
    await title('深层参考').click();
    await page.waitForFunction(() => document.querySelectorAll('.bookmark-row').length === 3);
    assert.equal(await app.evaluate(() => globalThis.treeOpenCount), 0);
    await heading('A 项目资料').locator('.bookmark-actions button').last().click();
    assert.equal(await title('A 项目资料').getAttribute('aria-expanded'), 'true');
    assert.equal(await app.evaluate(() => globalThis.treeOpenCount), 0);
    await page.keyboard.press('Escape');
    const nested = group('深层参考').locator('.bookmark-row');
    await nested.locator('.bookmark-note').click();
    await page.waitForFunction(() => !document.body.hasAttribute('aria-busy'));
    assert.equal(await app.evaluate(() => globalThis.treeOpenCount), 1);
    assert.equal(
      await fs.readFile(file, 'utf8'),
      original,
      'Browsing/expanding never rewrites saved data.',
    );
    await nested.locator('.bookmark-actions button').first().click();
    await page.waitForFunction(() => !document.body.hasAttribute('aria-busy'));
    assert.equal(await app.evaluate(() => globalThis.treeOpenCount), 1);
    // A star operation rebuilds the list; expanded IDs and nested geometry must survive.
    assert.equal(await title('A 项目资料').getAttribute('aria-expanded'), 'true');
    assert.equal(await title('深层参考').getAttribute('aria-expanded'), 'true');
    await title('A 项目资料').click();
    assert.equal(
      await group('A 项目资料').locator(':scope > .folder-reveal').getAttribute('inert'),
      '',
    );
    await title('A 项目资料').click();
    assert.equal(await title('深层参考').getAttribute('aria-expanded'), 'true');
    for (let i = 0; i < 6; i++) await title('A 项目资料').click({ force: true });
    assert.equal(await title('A 项目资料').getAttribute('aria-expanded'), 'true');
    await title('C 空文件夹').focus();
    await page.keyboard.press('Enter');
    assert.equal(await group('C 空文件夹').locator('.folder-empty').isVisible(), true);
    await page.keyboard.press('Enter');
    await page.fill('#search', '深层网页');
    assert.equal(await page.locator('.folder-card').count(), 0);
    assert.equal(await page.locator('.bookmark-row').count(), 1);
    await page.fill('#search', '');
    assert.equal(await title('A 项目资料').getAttribute('aria-expanded'), 'true');
    const inside = await nested.evaluate((node) => getComputedStyle(node).padding);
    const outside = await page
      .locator('#bookmark-list > .bookmark-row')
      .evaluate((node) => getComputedStyle(node).padding);
    assert.equal(inside, outside);
    assert.equal(
      await group('A 项目资料')
        .locator(':scope > .folder-reveal > .folder-clip > .folder-contents')
        .evaluate((node) => getComputedStyle(node).backgroundColor),
      'rgb(255, 249, 241)',
    );
    for (const mode of ['list', 'grid']) {
      await page.click('#' + mode + '-view');
      for (const [width, height] of [
        [1280, 820],
        [980, 680],
        [1600, 1000],
      ]) {
        await app.evaluate(
          ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size),
          [width, height],
        );
        await page.waitForFunction((size) => innerWidth === size[0], [width, height]);
        assert.ok(await page.evaluate(() => document.body.scrollWidth <= innerWidth));
        assert.ok(
          await page.locator('#bookmark-list').evaluate((n) => n.scrollWidth <= n.clientWidth + 1),
        );
        report.sizes.push({ mode, width, height });
        if (width === 1280) await capture(app, 'hierarchy-' + mode + '.png');
      }
    }
    await page.click('#list-view');
    await nested.locator('.bookmark-actions button').last().click();
    await page.getByRole('button', { name: '编辑详情', exact: true }).click();
    await page.fill('#detail-note', '未保存的层级备注');
    await title('A 项目资料').click();
    await title('A 项目资料').click();
    assert.equal(await page.inputValue('#detail-note'), '未保存的层级备注');
    await page.locator('#detail-form button[type=submit]').click();
    await page.waitForFunction(
      () =>
        !document.querySelector('#detail-form button[type=submit]').textContent.includes('未保存'),
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await title('A 项目资料').click();
    await title('A 项目资料').click();
    assert.ok(
      await group('A 项目资料')
        .locator(':scope > .folder-reveal')
        .evaluate((n) => parseFloat(getComputedStyle(n).transitionDuration) < 0.01),
    );
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => a.playState !== 'running'),
    );
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 680));
    await title('B 设计灵感').click();
    for (const id of deepIds)
      await page
        .locator('.folder-group[data-folder-id="' + id + '"] > .folder-card .folder-title')
        .click();
    assert.ok(
      await page
        .locator('#bookmark-list')
        .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      'Thirty nested levels fit a small window with the inspector open.',
    );
    assert.deepEqual(errors, []);
    await app.close();
    app = null;
    app = await launch();
    page = await app.firstWindow();
    await page.waitForSelector('.folder-card');
    assert.equal(await page.locator('.folder-group.is-expanded').count(), 0);
    const loaded = (await page.evaluate(() => window.arcwell.load())).library;
    assert.equal(loaded.bookmarks.find((b) => b.title === '深层网页').note, '未保存的层级备注');
    assert.deepEqual(loaded.folders, library.folders);
    assert.equal(loaded.bookmarks.length, library.bookmarks.length);
    report.passed = true;
    await fs.writeFile(
      path.join(temp, 'hierarchy-ui-results.json'),
      JSON.stringify(report, null, 2),
    );
    console.log(
      'Hierarchy UI passed: roots-only sidebar, pinned sibling sorting in both directions, lazy nested expansion, real animation, rapid reversal, keyboard/empty states, protected clicks/drafts, deep search, row consistency, list/grid resizing, reduced motion and restart.',
    );
  } finally {
    if (app) await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
