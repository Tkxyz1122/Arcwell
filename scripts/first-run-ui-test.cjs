'use strict';
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
  const directory = await fs.mkdtemp(path.join(root, '_Temp', 'first-run-ui-'));
  const launch = () =>
    _electron.launch({
      executablePath: process.env.ARCWELL_TEST_EXE || require('electron'),
      args: [root, '--arcwell-test'],
      env: { ...process.env, ARCWELL_TEST_DATA: directory },
    });
  let app;
  const report = { version: require('../package.json').version };
  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.waitForSelector('.bookmark-row');
    const initial = (await page.evaluate(() => window.arcwell.load())).library;
    assert.equal(initial.bookmarks.length, 1);
    assert.equal(initial.bookmarks[0].url, 'https://www.bilibili.com/');
    assert.equal(initial.bookmarks[0].folderId, 'inbox');
    const row = page.locator('.bookmark-row');
    const before = await row.boundingBox();
    assert.equal(before.height, 61, 'Link rows match compact folder rows.');
    assert.equal(await row.locator('.bookmark-domain').count(), 0);
    await row.hover();
    let hint = page.locator('#collection-hint');
    await hint.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await hint.textContent(), initial.bookmarks[0].url);
    await page.waitForTimeout(260);
    assert.deepEqual(await row.boundingBox(), before, 'Hover never shifts or rescales the card.');
    const hovered = await row.evaluate((n) => {
      const s = getComputedStyle(n);
      return {
        background: s.backgroundColor,
        shadow: s.boxShadow,
        before: getComputedStyle(n, '::before').content,
        duration: s.transitionDuration,
      };
    });
    assert.equal(hovered.background, 'rgb(240, 245, 241)');
    assert.equal(hovered.before, 'none');
    assert.ok(!hovered.shadow.includes('3px 0px 0px 0px'), 'No coarse left-edge stripe.');
    await row.locator('.bookmark-actions button').last().click();
    await page.getByRole('button', { name: '编辑详情', exact: true }).click();
    await page.waitForTimeout(260);
    // Hidden windows may pause compositor transitions; inspect their finished style.
    await row.evaluate((n) => n.getAnimations().forEach((animation) => animation.finish()));
    assert.equal(
      await row.evaluate((n) => getComputedStyle(n).backgroundColor),
      'rgb(232, 241, 235)',
    );
    for (const mode of ['list', 'grid']) {
      await page.click('#' + mode + '-view');
      for (const size of [
        [980, 680],
        [1280, 820],
      ]) {
        await app.evaluate(
          ({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].setSize(...value),
          size,
        );
        assert.ok(
          await page.locator('#bookmark-list').evaluate((n) => n.scrollWidth <= n.clientWidth + 1),
        );
      }
    }
    await page.click('#list-view');
    await page.locator('.bookmark-row').hover();
    await page.waitForTimeout(260);
    const capture = await app.evaluate(async ({ BrowserWindow }) =>
      (
        await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
          stayHidden: true,
          stayAwake: true,
        })
      )
        .toPNG()
        .toString('base64'),
    );
    await fs.writeFile(
      path.join(root, '_Temp', 'first-run-selection.png'),
      Buffer.from(capture, 'base64'),
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.ok(
      await page
        .locator('.bookmark-row')
        .evaluate((n) => parseFloat(getComputedStyle(n).transitionDuration) < 0.01),
    );
    await app.close();
    app = null;
    app = await launch();
    page = await app.firstWindow();
    await page.waitForSelector('.bookmark-row');
    assert.deepEqual((await page.evaluate(() => window.arcwell.load())).library, initial);
    await page.locator('.bookmark-row .bookmark-actions button').last().click();
    await page.getByRole('button', { name: '移除收藏', exact: true }).click();
    await page.locator('#modal-submit').click();
    await page.waitForSelector('.empty');
    await app.close();
    app = null;
    app = await launch();
    page = await app.firstWindow();
    await page.waitForSelector('.empty');
    assert.equal((await page.evaluate(() => window.arcwell.load())).library.bookmarks.length, 0);
    const longUrl = 'http://127.0.0.1:9/' + 'reference/'.repeat(350);
    await page.evaluate(
      (url) =>
        window.arcwell.change('add', { url, title: '长网址提示'.repeat(24), folderId: 'inbox' }),
      longUrl,
    );
    await page.reload();
    await page.waitForSelector('.bookmark-row');
    hint = page.locator('#collection-hint');
    const longRow = page.locator('.bookmark-row');
    await longRow.hover({ position: { x: 70, y: 20 } });
    await hint.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await hint.textContent(), longUrl);
    assert.ok(
      (await hint.boundingBox()).height <= 83,
      'Long URLs occupy at most four compact lines.',
    );
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    await longRow.dispatchEvent('pointermove', {
      pointerType: 'mouse',
      clientX: viewport.width - 1,
      clientY: viewport.height - 1,
    });
    const bounds = await hint.boundingBox();
    assert.ok(
      bounds.x >= 8 &&
        bounds.y >= 8 &&
        bounds.x + bounds.width <= viewport.width - 8 &&
        bounds.y + bounds.height <= viewport.height - 8,
    );
    await page.click('#grid-view');
    assert.equal(await hint.isVisible(), false, 'Changing views dismisses the shared hint.');
    assert.ok(
      await page.locator('#bookmark-list').evaluate((n) => n.scrollWidth <= n.clientWidth + 1),
    );
    Object.assign(report, {
      linkHeight: 61,
      urlOnHover: true,
      boundedLongUrl: true,
      sampleOnlyOnFirstRun: true,
      deletionSurvivesRestart: true,
      hoverNoLayoutShift: true,
      subtleSelection: true,
      reducedMotion: true,
      listAndGridResponsive: true,
      passed: true,
    });
    await fs.writeFile(
      path.join(root, '_Temp', 'first-run-ui-results.json'),
      JSON.stringify(report, null, 2),
    );
    console.log(
      'First-run UI passed: one persistent bilibili sample, no reinsertion after deletion/restart, refined hover/selection without layout shifts, reduced motion and responsive list/grid.',
    );
  } finally {
    if (app) await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
