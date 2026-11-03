'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { emptyLibrary, mutate, validateLibrary } = require('../src/domain.cjs');
const { create } = require('../src/collection-view.js');
const { mergeBookmarks } = require('../src/bookmark-html.cjs');
function fixture() {
  let library = emptyLibrary();
  const ids = {};
  for (const [name, parent] of [
    ['Work'],
    ['Study'],
    ['A', 'Work'],
    ['B', 'Work'],
    ['Deep', 'A'],
    ['Empty', 'Work'],
  ]) {
    library = mutate(library, 'folder-add', { name, parentId: ids[parent] }).library;
    ids[name] = library.folders.at(-1).id;
    library.folders.at(-1).createdAt = new Date(
      Date.UTC(2026, 0, Object.keys(ids).length),
    ).toISOString();
  }
  for (const [title, folder, starred] of [
    ['Loose', 'inbox', false],
    ['Root link', 'Work', false],
    ['A link', 'A', true],
    ['Deep link', 'Deep', true],
    ['Study link', 'Study', false],
  ]) {
    const r = mutate(library, 'add', {
      url: 'https://example.com/' + title.replaceAll(' ', '-'),
      title,
      folderId: ids[folder] || folder,
    });
    library = r.library;
    library.bookmarks[0].starred = starred;
  }
  return { library, ids };
}
test('root navigation and each collection expose only immediate child folders and direct bookmarks', () => {
  const { library, ids } = fixture();
  const original = structuredClone(library);
  const all = create(library);
  assert.deepEqual(
    all.roots.map((e) => e.folder.id),
    ['inbox', ids.Work, ids.Study],
  );
  assert.deepEqual(
    all.children(null).folders.map((e) => e.folder.id),
    [ids.Study, ids.Work],
  );
  assert.deepEqual(
    all.children(null).bookmarks.map((b) => b.title),
    ['Loose'],
  );
  const work = create(library, { scope: ids.Work });
  assert.equal(work.bookmarks.length, 3);
  assert.deepEqual(
    work.children(ids.Work).bookmarks.map((b) => b.title),
    ['Root link'],
  );
  assert.deepEqual(
    work.children(ids.A).folders.map((e) => e.folder.id),
    [ids.Deep],
  );
  assert.deepEqual(
    work.children(ids.A).bookmarks.map((b) => b.title),
    ['A link'],
  );
  assert.deepEqual(work.children(ids.Empty), { folders: [], bookmarks: [] });
  assert.equal(work.counts.get(ids.Work), 3);
  assert.equal(work.rootOf(ids.Deep), ids.Work);
  assert.deepEqual(work.ancestors(ids.Deep), [ids.Work, ids.A, ids.Deep]);
  assert.deepEqual(library, original);
});
test('sibling folders support both name and addition-time directions, while legacy dates keep stable insertion order', () => {
  const { library, ids } = fixture();
  const names = (sort, direction) =>
    create(library, { scope: ids.Work, sort, direction })
      .children(ids.Work)
      .folders.map((e) => e.title);
  assert.deepEqual(names('name', 'asc'), ['A', 'B', 'Empty']);
  assert.deepEqual(names('name', 'desc'), ['Empty', 'B', 'A']);
  assert.deepEqual(names('recent', 'asc'), ['A', 'B', 'Empty']);
  assert.deepEqual(names('recent', 'desc'), ['Empty', 'B', 'A']);
  for (const f of library.folders) delete f.createdAt;
  assert.deepEqual(names('recent', 'asc'), ['A', 'B', 'Empty']);
  assert.deepEqual(names('recent', 'desc'), ['Empty', 'B', 'A']);
});
test('search and star/recent collections find deep bookmarks without requiring expansion', () => {
  const { library, ids } = fixture();
  const search = create(library, { query: 'Deep link' });
  assert.equal(search.flat, true);
  assert.deepEqual(
    search.bookmarks.map((b) => b.title),
    ['Deep link'],
  );
  const scoped = create(library, { scope: ids.Study, query: 'Deep link' });
  assert.equal(scoped.bookmarks.length, 0);
  assert.equal(create(library, { scope: 'recent' }).flat, true);
  assert.equal(create(library, { scope: 'stars' }).bookmarks.length, 2);
  assert.equal(create(library, { scope: ids.Work, starred: true }).bookmarks.length, 2);
  assert.equal(create(library, { scope: 'inbox' }).children('inbox').folders.length, 0);
});
test('folder dates remain optional for old libraries and survive rename/import merging', () => {
  const { library, ids } = fixture();
  const time = library.folders.find((f) => f.id === ids.Work).createdAt;
  const renamed = mutate(library, 'folder-rename', { id: ids.Work, name: 'Renamed' }).library;
  assert.equal(renamed.folders.find((f) => f.id === ids.Work).createdAt, time);
  const imported = mergeBookmarks(library, {
    folders: [{ path: ['Work', 'Imported'] }],
    bookmarks: [],
    skipped: 0,
  }).library;
  assert.ok(Number.isFinite(Date.parse(imported.folders.at(-1).createdAt)));
  assert.equal(imported.folders.find((f) => f.id === ids.Work).createdAt, time);
  const old = structuredClone(library);
  for (const f of old.folders) delete f.createdAt;
  assert.doesNotThrow(() => validateLibrary(old));
  old.folders[1].createdAt = 'invalid';
  assert.throws(() => validateLibrary(old), /添加时间/);
});
