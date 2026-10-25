'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { emptyLibrary, mutate, completeFolders } = require('../src/domain.cjs');
const { entries, path } = require('../src/folders.js');
const { serializeBookmarks, parseBookmarks, mergeBookmarks } = require('../src/bookmark-html.cjs');
test('hierarchy supports children, sibling names, rename descendants and subtree removal without losing bookmarks', async () => {
  let library = emptyLibrary();
  const add = (name, parentId) => {
    library = mutate(library, 'folder-add', { name, parentId }).library;
    return library.folders.at(-1).id;
  };
  const work = add('工作');
  const study = add('学习');
  const child = add('资料', work);
  const other = add('资料', study);
  const grandchild = add('课程', child);
  assert.throws(() => add('资料', work), /同名/);
  assert.throws(() => add('错误', 'missing'), /父文件夹/);
  assert.throws(() => add('错误', 'inbox'), /父文件夹/);
  library = mutate(library, 'add', { url: 'https://nested.example', folderId: grandchild }).library;
  const before = structuredClone(library.bookmarks);
  library = mutate(library, 'folder-rename', { id: work, name: '工作项目' }).library;
  assert.deepEqual(path(library.folders.find((folder) => folder.id === grandchild)), [
    '工作项目',
    '资料',
    '课程',
  ]);
  assert.deepEqual(library.bookmarks, before);
  assert.deepEqual(
    entries(library.folders).map(({ folder, depth }) => [folder.id, depth]),
    [
      ['inbox', 0],
      [work, 0],
      [child, 1],
      [grandchild, 2],
      [study, 0],
      [other, 1],
    ],
  );
  const restored = mergeBookmarks(
    emptyLibrary(),
    await parseBookmarks(serializeBookmarks(library)),
  ).library;
  assert.deepEqual(
    path(restored.folders.find((folder) => folder.id === restored.bookmarks[0].folderId)),
    ['工作项目', '资料', '课程'],
  );
  library = mutate(library, 'folder-remove', { id: work }).library;
  assert.ok(!library.folders.some((folder) => [work, child, grandchild].includes(folder.id)));
  assert.ok(library.folders.some((folder) => folder.id === other));
  assert.deepEqual(
    library.bookmarks,
    before.map((bookmark) => ({ ...bookmark, folderId: 'inbox' })),
  );
});
test('legacy imported paths restore missing ancestors once, keep IDs and never guess manual slash names', () => {
  const library = emptyLibrary();
  library.folders.push(
    { id: 'deep', name: '工作 / 资料 / 课程', importPath: ['工作', '资料', '课程'] },
    { id: 'manual', name: '资源/社区' },
  );
  const repaired = completeFolders(library);
  assert.equal(repaired.folders.length, 5);
  assert.deepEqual(path(repaired.folders.find((folder) => folder.id === 'deep')), [
    '工作',
    '资料',
    '课程',
  ]);
  assert.deepEqual(completeFolders(repaired), repaired);
  assert.equal(library.folders.length, 3);
  assert.deepEqual(
    entries(repaired.folders).find((entry) => entry.folder.id === 'manual').depth,
    0,
  );
});
test('imports reuse the existing spelling of a parent to avoid duplicate branches in HTML backups', async () => {
  let library = mutate(emptyLibrary(), 'folder-add', { name: 'Work' }).library;
  library = mergeBookmarks(
    library,
    await parseBookmarks(
      '<DL><DT><H3>work</H3><DL><DT><H3>Docs</H3><DL><DT><A HREF="https://case.example">资料</A></DL></DL></DL>',
    ),
  ).library;
  assert.deepEqual(path(library.folders.at(-1)), ['Work', 'Docs']);
  const parsed = await parseBookmarks(serializeBookmarks(library));
  assert.deepEqual(
    parsed.folders.map((folder) => folder.path),
    [['Work'], ['Work', 'Docs']],
  );
});
