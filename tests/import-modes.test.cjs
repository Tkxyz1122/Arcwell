'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { LibraryStore } = require('../src/store.cjs');
const { emptyLibrary } = require('../src/domain.cjs');
const { entries } = require('../src/folders.js');
const { parseBookmarks, mergeBookmarks } = require('../src/bookmark-html.cjs');
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'arcwell-import-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new LibraryStore(directory);
  await store.load();
  return store;
}
test('A merge preserves existing and absent-from-file records; B replaces with a durable complete pre-import copy', async (t) => {
  const store = await fixture(t);
  await store.change('folder-add', { name: '原分类' });
  const folderId = store.library.folders.at(-1).id;
  await store.change('add', { url: 'https://existing.example', folderId, title: '原名称' });
  const original = store.library.bookmarks[0];
  await store.change('edit', { ...original, note: '原备注' });
  await store.change('star', { id: original.id });
  await store.change('add', { url: 'https://keep.example', folderId: 'inbox' });
  const oldRecords = store.snapshot().bookmarks;
  const html =
    '<DL><DT><H3>替换分类</H3><DL><DT><H3>子资料</H3><DL><DT><A HREF="https://existing.example">新名称</A><DT><A HREF="https://new.example">新增</A></DL></DL></DL>';
  let result = await store.importHtml(html, 'merge');
  assert.equal(result.imported, 1);
  assert.equal(result.duplicates, 1);
  for (const record of oldRecords)
    assert.deepEqual(
      store.library.bookmarks.find((item) => item.id === record.id),
      record,
    );
  assert.ok(store.library.folders.some((folder) => folder.id === folderId));
  assert.equal(result.recoveryFile, undefined);
  await store.change('remove', { id: oldRecords[0].id });
  const beforeReplace = store.snapshot();
  result = await store.importHtml(html, 'replace');
  assert.equal(result.imported, 2);
  assert.ok(!store.library.folders.some((folder) => folder.id === folderId));
  assert.equal(store.library.folders.find((folder) => folder.id === 'inbox').name, '默认分区');
  assert.equal(
    store.library.bookmarks.find((item) => item.url === 'https://existing.example/').title,
    '新名称',
  );
  assert.equal(
    store.library.bookmarks.find((item) => item.url === 'https://existing.example/').note,
    '',
  );
  assert.equal(
    store.library.bookmarks.find((item) => item.url === 'https://existing.example/').starred,
    false,
  );
  assert.ok(!store.library.bookmarks.some((item) => item.url === 'https://keep.example/'));
  const recovery = await fs.readFile(result.recoveryFile, 'utf8');
  assert.deepEqual(JSON.parse(recovery), beforeReplace);
  await assert.rejects(store.undo(), /没有可撤销/);
  await store.change('star', { id: store.library.bookmarks[0].id });
  assert.equal(await fs.readFile(result.recoveryFile, 'utf8'), recovery);
});
test('invalid replacement, invalid mode and failed pre-import backup preserve the current library and file', async (t) => {
  const store = await fixture(t);
  await store.change('add', { url: 'https://keep.example', folderId: 'inbox' });
  const before = store.snapshot();
  const bytes = await fs.readFile(store.file, 'utf8');
  await assert.rejects(store.importHtml('<p>不是书签</p>', 'replace'), /未找到/);
  await assert.rejects(store.importHtml('<DL></DL>', 'anything'), /合并添加或完全覆盖/);
  const blocker = path.join(store.directory, 'not-a-directory');
  await fs.writeFile(blocker, 'block');
  store.directory = blocker;
  await assert.rejects(
    store.importHtml('<DL><A HREF="https://new.example">新</A></DL>', 'replace'),
  );
  assert.deepEqual(store.snapshot(), before);
  assert.equal(await fs.readFile(store.file, 'utf8'), bytes);
});
test('system partition rename preserves ID and records without renaming manual folders', async (t) => {
  const store = await fixture(t);
  await store.change('add', { url: 'https://keep.example', folderId: 'inbox' });
  const old = store.snapshot();
  old.folders[0].name = '未分类';
  old.folders.push({ id: 'manual', name: '未分类' });
  await fs.writeFile(store.file, JSON.stringify(old));
  const restarted = new LibraryStore(store.directory);
  await restarted.load();
  assert.equal(restarted.library.folders[0].id, 'inbox');
  assert.equal(restarted.library.folders[0].name, '默认分区');
  assert.equal(restarted.library.folders.find((folder) => folder.id === 'manual').name, '未分类');
  assert.deepEqual(restarted.library.bookmarks, old.bookmarks);
  assert.deepEqual(JSON.parse(await fs.readFile(`${store.file}.bak`, 'utf8')), old);
});
test('imported folders named like the default partition remain separate from the system partition', async () => {
  const library = mergeBookmarks(
    emptyLibrary(),
    await parseBookmarks(
      '<DL><H3>默认分区</H3><DL><H3>资料</H3><DL><A HREF="https://nested.example">资料</A></DL></DL></DL>',
    ),
  ).library;
  const tree = entries(library.folders);
  assert.equal(tree.length, 3);
  assert.equal(tree.filter((entry) => entry.parts.length === 2).length, 1);
  assert.notEqual(library.bookmarks[0].folderId, 'inbox');
});
