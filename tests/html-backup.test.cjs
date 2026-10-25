'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { HtmlBackup } = require('../src/html-backup.cjs');
const { emptyLibrary, mutate } = require('../src/domain.cjs');
const { parseBookmarks } = require('../src/bookmark-html.cjs');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'arcwell-html-中文 '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const service = new HtmlBackup(path.join(root, 'application'), path.join(root, 'settings'));
  await service.load();
  await fs.mkdir(path.join(root, 'custom'));
  return { root, service, custom: path.join(root, 'custom') };
}
test('export copies the exact application HTML instead of rebuilding or exporting JSON', async (t) => {
  const { root, service } = await fixture(t);
  await service.sync(emptyLibrary());
  const source = await fs.readFile(service.applicationFile);
  const exported = path.join(root, 'exports', '网址备份.html');
  await service.exportTo(exported);
  assert.deepEqual(await fs.readFile(exported), source);
  await service.exportTo(service.applicationFile);
  assert.deepEqual(await fs.readFile(service.applicationFile), source);
});
test('both copies are identical, overwritten on updates and custom path survives restart', async (t) => {
  const { root, service, custom } = await fixture(t);
  let library = mutate(emptyLibrary(), 'add', {
    url: 'example.com',
    title: '原标题',
    folderId: 'inbox',
  }).library;
  await service.choose(custom, library);
  library = mutate(library, 'edit', {
    ...library.bookmarks[0],
    title: '更新后的标题',
    note: '实时备注',
  }).library;
  await service.sync(library);
  const first = await fs.readFile(service.applicationFile, 'utf8'),
    second = await fs.readFile(path.join(custom, '网址备份.html'), 'utf8');
  assert.equal(first, second);
  assert.ok(first.includes('更新后的标题'));
  assert.ok(!first.includes('原标题'));
  assert.equal((await parseBookmarks(first)).bookmarks[0].note, '');
  assert.equal(library.bookmarks[0].note, '实时备注');
  const restarted = new HtmlBackup(path.join(root, 'application'), path.join(root, 'settings'));
  await restarted.load();
  assert.equal(restarted.customDirectory, await fs.realpath(custom));
  await assert.rejects(service.choose(path.join(root, 'application'), library), /应用目录以外/);
});
test('one-copy failure is visible and leaves the other up-to-date; retry recovers', async (t) => {
  const { root, service } = await fixture(t);
  await service.choose(path.join(root, 'custom'), emptyLibrary());
  const customFile = path.join(root, 'custom', '网址备份.html');
  await fs.rename(customFile, `${customFile}.saved`);
  await fs.mkdir(customFile);
  const library = mutate(emptyLibrary(), 'add', { url: 'example.com', folderId: 'inbox' }).library;
  const failed = await service.sync(library);
  assert.match(failed.warning, /自定义目录/);
  assert.ok((await fs.readFile(service.applicationFile, 'utf8')).includes('example.com'));
  await fs.rmdir(customFile);
  const recovered = await service.sync(library);
  assert.equal(recovered.failures.length, 0);
  assert.equal(
    await fs.readFile(customFile, 'utf8'),
    await fs.readFile(service.applicationFile, 'utf8'),
  );
});
test('queued writes keep latest mutation and an unset second path is explicit', async (t) => {
  const { service } = await fixture(t);
  const first = mutate(emptyLibrary(), 'add', { url: 'first.example', folderId: 'inbox' }).library;
  const last = mutate(first, 'add', { url: 'last.example', folderId: 'inbox' }).library;
  await Promise.all([service.sync(first), service.sync(last)]);
  assert.equal(
    (await parseBookmarks(await fs.readFile(service.applicationFile, 'utf8'))).bookmarks.length,
    2,
  );
  assert.equal(service.status().configured, false);
  assert.equal(service.status().customFile, null);
});
