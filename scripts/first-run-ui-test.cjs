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
    await row.hover();
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
    Object.assign(report, {
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
