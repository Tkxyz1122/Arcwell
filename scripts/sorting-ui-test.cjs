'use strict';
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { emptyLibrary, mutate, validateLibrary } = require('../src/domain.cjs');
const root = path.resolve(__dirname, '..');
const temporary = path.join(root, '_Temp');
async function capture(application, destination) {
  const png = await application.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
      stayHidden: true,
      stayAwake: true,
    });
    if (image.isEmpty()) throw new Error('Empty UI capture.');
    return image.toPNG().toString('base64');
  });
  await fs.writeFile(destination, Buffer.from(png, 'base64'));
}
(async () => {
  await fs.mkdir(temporary, { recursive: true });
  const directory = await fs.mkdtemp(path.join(temporary, 'sorting-ui-'));
  let library = emptyLibrary();
  for (let i = 0; i < 35; i++) {
    const title =
      ['资料', 'Alpha', '工作', 'Beta', '灵感'][i % 5] + ' ' + String(35 - i).padStart(2, '0');
    library = mutate(library, 'add', {
      url: `http://127.0.0.1:9/bookmarks/${i}`,
      title,
      folderId: 'inbox',
    }).library;
    const bookmark = library.bookmarks[0];
    bookmark.createdAt = new Date(Date.UTC(2026, 0, 1, 0, Math.max(1, i))).toISOString();
    bookmark.starred = i % 3 === 0;
  }
  library.bookmarks[12].title = 'leon-se/FigLib-Test 在主场 · 长名称与中文资料的完整展示';
  validateLibrary(library);
  assert.ok(library.bookmarks.filter((b) => b.starred).length > 1);
  assert.equal(new Set(library.bookmarks.map((b) => b.createdAt)).size, 34);
  await fs.mkdir(path.join(directory, 'data'));
  const libraryPath = path.join(directory, 'data', 'library.json');
  const savedLibrary = JSON.stringify(library);
  await fs.writeFile(libraryPath, savedLibrary);
  const application = await _electron.launch({
    executablePath: process.env.ARCWELL_TEST_EXE || require('electron'),
    args: [root, '--arcwell-test'],
    env: { ...process.env, ARCWELL_TEST_DATA: directory },
  });
  const report = { version: require('../package.json').version, layouts: [] };
  try {
    const page = await application.firstWindow();
    await page.waitForSelector('.bookmark-row');
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const titles = () => page.locator('.bookmark-title > span').allTextContents();
    const expected = (items, criterion, ascending) =>
      [...items]
        .sort((a, b) => {
          const difference =
            criterion === 'name'
              ? a.title.localeCompare(b.title, 'zh-CN')
              : Date.parse(a.createdAt) - Date.parse(b.createdAt);
          return (
            (ascending ? 1 : -1) *
            (difference || a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id))
          );
        })
        .map((bookmark) => bookmark.title);
    const all = library.bookmarks;
    assert.deepEqual(await titles(), expected(all, 'recent', false));
    assert.equal(await page.locator('.bookmark-title svg').count(), 0);
    await page.locator('#sort-direction').focus();
    await page.keyboard.press('Enter');
    assert.match(await page.locator('#sort-direction').getAttribute('aria-label'), /添加时间升序/);
    assert.deepEqual(await titles(), expected(all, 'recent', true));
    await page.selectOption('#sort', 'name');
    assert.deepEqual(await titles(), expected(all, 'name', true));
    await page.click('#sort-direction');
    assert.deepEqual(await titles(), expected(all, 'name', false));
    await page.selectOption('#sort', 'recent');
    assert.deepEqual(await titles(), expected(all, 'recent', true));
    await page.selectOption('#sort', 'name');
    assert.deepEqual(await titles(), expected(all, 'name', false));
    await page.click('#grid-view');
    assert.deepEqual(await titles(), expected(all, 'name', false));
    await page.click('#list-view');
    await page.fill('#search', '资料');
    assert.deepEqual(
      await titles(),
      expected(
        all.filter((b) => b.title.includes('资料')),
        'name',
        false,
      ),
    );
    await page.fill('#search', '');
    await page.click('#star-tab');
    assert.deepEqual(
      await titles(),
      expected(
        all.filter((b) => b.starred),
        'name',
        false,
      ),
    );
    await page.click('#all-tab');
    await page.locator('#navigation .nav-item').filter({ hasText: '最近添加' }).click();
    const latest = [...all]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 30);
    assert.deepEqual(await titles(), expected(latest, 'name', false));
    await page.selectOption('#sort', 'recent');
    assert.deepEqual(await titles(), expected(latest, 'recent', true));
    await page.click('#sort-direction');
    assert.deepEqual(await titles(), expected(latest, 'recent', false));
    await page.locator('#navigation .nav-item').filter({ hasText: '全部收藏' }).click();
    const row = page.locator('.bookmark-row').filter({ hasText: library.bookmarks[12].title });
    await row.locator('.bookmark-actions button').last().click();
    await page.getByRole('button', { name: '编辑详情', exact: true }).click();
    assert.equal(
      await page.locator('.detail-brand strong').textContent(),
      library.bookmarks[12].title,
    );
    assert.equal(
      await page.locator('.detail-brand > div:last-child').getAttribute('title'),
      library.bookmarks[12].title,
    );
    assert.match(
      await page
        .locator('.profile-cover')
        .evaluate((node) => getComputedStyle(node).backgroundImage),
      /gradient/,
    );
    assert.equal(await page.locator('.site-profile .website-icon').count(), 1);
    const edited = library.bookmarks[12];
    const longUrl = edited.url + '?reference=' + 'long-link-'.repeat(16);
    await page.fill('#detail-url', longUrl);
    await page.locator('#detail-url').evaluate((node) => {
      node.setSelectionRange(0, 0);
      node.scrollTop = 0;
    });
    await page.locator('#detail-url').blur();
    for (const [width, height] of [
      [1280, 820],
      [980, 680],
      [1600, 1000],
    ]) {
      await application.evaluate(
        ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size),
        [width, height],
      );
      await page.waitForFunction(
        (size) => innerWidth === size[0] && innerHeight >= size[1],
        [width, height],
      );
      const layout = await page.evaluate(() => {
        const pane = document.querySelector('#inspector');
        const bounds = pane.getBoundingClientRect();
        const actions = document.querySelector('.detail-actions').getBoundingClientRect();
        const brand = document.querySelector('.detail-brand');
        return {
          width: innerWidth,
          height: innerHeight,
          blank: (bounds.bottom - actions.bottom) / bounds.height,
          overflow: pane.scrollHeight - pane.clientHeight,
          horizontalOverflow: document.body.scrollWidth - innerWidth,
          brandOverflow: brand.scrollWidth - brand.clientWidth,
          urlOverflow:
            document.querySelector('#detail-url').scrollWidth -
            document.querySelector('#detail-url').clientWidth,
          fields: [...pane.querySelectorAll('.field')].map((field) => {
            const range = document.createRange();
            range.selectNodeContents(field.firstChild);
            const label = range.getBoundingClientRect();
            const control = field.querySelector('input, textarea, select').getBoundingClientRect();
            return {
              gap: control.top - label.bottom,
              fullWidth: Math.abs(control.width - field.getBoundingClientRect().width) < 1,
            };
          }),
        };
      });
      await capture(application, path.join(temporary, `profile-final-${width}.png`));
      assert.ok(layout.overflow <= 1, 'Inspector editing controls must fit.');
      assert.equal(layout.horizontalOverflow, 0);
      assert.equal(layout.urlOverflow, 0, 'Long URLs wrap without horizontal scrolling.');
      for (const field of layout.fields) {
        assert.ok(
          field.gap >= 2 && field.gap <= 7,
          'Labels must be above their controls with a small gap.',
        );
        assert.equal(field.fullWidth, true);
      }
      assert.ok(layout.brandOverflow <= 1, 'Long website names must stay in the profile.');
      if (width !== 980)
        assert.ok(
          layout.blank >= 0.25 && layout.blank <= 0.36,
          'Normal windows retain about 30% space below: ' + JSON.stringify(layout),
        );
      report.layouts.push(layout);
    }
    assert.equal(
      await fs.readFile(libraryPath, 'utf8'),
      savedLibrary,
      'Sorting and profile browsing never rewrite bookmarks.',
    );
    await page.fill('#detail-url', 'javascript:alert(1)');
    await page.locator('#detail-form button[type=submit]').click();
    await page.waitForFunction(() =>
      document.querySelector('#detail-error').textContent.includes('HTTP'),
    );
    assert.equal(
      (await page.evaluate(() => window.arcwell.load())).library.bookmarks.find(
        (b) => b.id === edited.id,
      ).url,
      edited.url,
    );
    await page.fill('#detail-url', longUrl);
    await page.locator('#detail-form button[type=submit]').click();
    await page.waitForFunction(
      () =>
        !document.querySelector('#detail-form button[type=submit]').textContent.includes('未保存'),
    );
    assert.equal(
      (await page.evaluate(() => window.arcwell.load())).library.bookmarks.find(
        (b) => b.id === edited.id,
      ).url,
      longUrl,
    );
    assert.equal(await page.inputValue('#detail-url'), longUrl);
    assert.deepEqual(errors, []);
    report.passed = true;
    await fs.writeFile(
      path.join(temporary, 'sorting-ui-results.json'),
      JSON.stringify(report, null, 2),
    );
    console.log(
      'Sorting/profile UI passed: all four orders, ties, keyboard toggle, per-criterion direction, search/stars/grid, latest 30 membership, long names and 3 responsive sizes.',
    );
    console.log(JSON.stringify(report.layouts));
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
