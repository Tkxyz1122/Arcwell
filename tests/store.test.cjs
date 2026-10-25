'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { LibraryStore } = require('../src/store.cjs');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'arcwell-中文 test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new LibraryStore(root);
  await store.load();
  return store;
}
test('missing legacy parent folders are restored with original JSON backed up and stable IDs on restart', async (t) => {
  const store = await fixture(t);
  const old = store.snapshot();
  old.folders.push({
    id: 'nested',
    name: '工作 / 项目 / 资料',
    importPath: ['工作', '项目', '资料'],
  });
  await fs.writeFile(store.file, JSON.stringify(old));
  const restarted = new LibraryStore(store.directory);
  await restarted.load();
  assert.equal(restarted.library.folders.length, 4);
  assert.deepEqual(JSON.parse(await fs.readFile(`${store.file}.bak`, 'utf8')), old);
  const snapshot = restarted.snapshot();
  const again = new LibraryStore(store.directory);
  await again.load();
  assert.deepEqual(again.snapshot(), snapshot);
  assert.deepEqual(JSON.parse(await fs.readFile(`${store.file}.bak`, 'utf8')), old);
});
test('old imported toolbar paths are repaired once with the original JSON backed up', async (t) => {
  const store = await fixture(t);
  const old = store.snapshot();
  old.folders.push(
    { id: 'toolbar', name: '收藏夹栏', importPath: ['收藏夹栏'] },
    { id: 'work', name: '收藏夹栏 / 工作', importPath: ['收藏夹栏', '工作'] },
  );
  old.bookmarks.push({
    id: 'old-link',
    url: 'https://example.com/',
    title: '保留标题',
    note: '保留备注',
    folderId: 'work',
    starred: true,
    createdAt: new Date().toISOString(),
  });
  await store.commit(old);
  const restarted = new LibraryStore(store.directory);
  await restarted.load();
  assert.equal(restarted.library.folders.find((folder) => folder.id === 'work').name, '工作');
  assert.equal(
    restarted.library.folders.some((folder) => folder.id === 'toolbar'),
    false,
  );
  assert.deepEqual(restarted.library.bookmarks, old.bookmarks);
  assert.deepEqual(JSON.parse(await fs.readFile(`${store.file}.bak`, 'utf8')), old);
  const again = new LibraryStore(store.directory);
  await again.load();
  assert.deepEqual(again.library, restarted.library);
});
test('serialized writes survive restart; removal undo restores note and folder', async (t) => {
  const store = await fixture(t);
  await Promise.all([
    store.change('add', { url: 'example.com/a', folderId: 'inbox' }),
    store.change('add', { url: 'example.com/b', folderId: 'inbox' }),
  ]);
  const bookmark = store.library.bookmarks[0];
  await store.change('edit', { ...bookmark, note: '保留备注' });
  await store.change('remove', { id: bookmark.id });
  await store.undo();
  const restarted = new LibraryStore(store.directory);
  await restarted.load();
  assert.equal(restarted.library.bookmarks.length, 2);
  assert.equal(restarted.library.bookmarks[0].note, '保留备注');
});
test('write failure keeps live state and original file unchanged', async (t) => {
  const store = await fixture(t);
  const before = await fs.readFile(store.file, 'utf8');
  await fs.mkdir(`${store.file}.tmp`);
  await assert.rejects(store.change('add', { url: 'example.com', folderId: 'inbox' }));
  assert.equal(store.library.bookmarks.length, 0);
  assert.equal(await fs.readFile(store.file, 'utf8'), before);
});
test('corrupted primary restores backup and preserves corrupt evidence', async (t) => {
  const store = await fixture(t);
  await store.change('add', { url: 'example.com', folderId: 'inbox' });
  const bookmark = store.library.bookmarks[0];
  await store.change('star', { id: bookmark.id });
  await fs.writeFile(store.file, '{broken');
  const restarted = new LibraryStore(store.directory);
  await restarted.load();
  assert.equal(restarted.library.bookmarks.length, 1);
  assert.match(restarted.warning, /备份/);
  assert.ok((await fs.readdir(store.directory)).some((file) => file.includes('.corrupt-')));
});
test('external edits block overwrite and both damaged files never reset data', async (t) => {
  const store = await fixture(t);
  const modified = store.snapshot();
  modified.folders[0].name = '外部变更';
  await fs.writeFile(store.file, JSON.stringify(modified));
  await assert.rejects(store.change('add', { url: 'example.com', folderId: 'inbox' }), /其他程序/);
  await fs.writeFile(store.file, 'broken');
  await fs.writeFile(`${store.file}.bak`, 'broken');
  await assert.rejects(new LibraryStore(store.directory).load(), /原文件已保留/);
  assert.equal(await fs.readFile(store.file, 'utf8'), 'broken');
});
test('future versions are preserved and never replaced with an older backup', async (t) => {
  const store = await fixture(t);
  await store.change('add', { url: 'example.com', folderId: 'inbox' });
  const future = { ...store.snapshot(), version: 2 };
  await fs.writeFile(store.file, JSON.stringify(future));
  await assert.rejects(new LibraryStore(store.directory).load(), /不兼容/);
  assert.equal(JSON.parse(await fs.readFile(store.file, 'utf8')).version, 2);
});
