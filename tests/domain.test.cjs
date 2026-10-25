'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { emptyLibrary, normalizeUrl, validateLibrary, mutate } = require('../src/domain.cjs');
test('URL normalization preserves query and fragment, rejects executable schemes and credentials', () => {
  assert.equal(
    normalizeUrl(' example.com/path?q=中文#x '),
    'https://example.com/path?q=%E4%B8%AD%E6%96%87#x',
  );
  for (const value of [
    'javascript:alert(1)',
    'file:///C:/test',
    'data:text/html,hello',
    'https://user:secret@example.com',
    '',
    'bad url',
  ])
    assert.throws(() => normalizeUrl(value));
});
test('add, edit, star, folder move and remove preserve contracts', () => {
  let library = emptyLibrary();
  library = mutate(library, 'folder-add', { name: '设计灵感' }).library;
  const folderId = library.folders[1].id;
  let result = mutate(library, 'add', { url: 'example.com', title: '我的站点', folderId });
  const id = result.selectedId;
  library = result.library;
  assert.throws(() => mutate(library, 'add', { url: 'https://example.com/', folderId }));
  assert.throws(() => mutate(library, 'add', { url: 'other.com', folderId: 'missing' }));
  result = mutate(library, 'edit', {
    id,
    url: 'example.com/new',
    title: '<script>不是脚本</script>',
    note: '中文备注\n第二行',
    folderId,
  });
  library = result.library;
  library = mutate(library, 'star', { id }).library;
  assert.equal(library.bookmarks[0].starred, true);
  library = mutate(library, 'folder-remove', { id: folderId }).library;
  assert.equal(library.bookmarks[0].folderId, 'inbox');
  assert.equal(library.bookmarks[0].note, '中文备注\n第二行');
  assert.throws(() => mutate(library, 'folder-remove', { id: 'inbox' }));
  assert.equal(mutate(library, 'remove', { id }).library.bookmarks.length, 0);
});
test('input length, folder duplicate, ID and schema validation', () => {
  const library = emptyLibrary();
  assert.throws(() => mutate(library, 'folder-add', { name: '默认分区' }));
  assert.throws(() => mutate(library, 'folder-add', { name: 'a'.repeat(61) }));
  assert.throws(() =>
    mutate(library, 'add', { url: 'example.com', title: 'a'.repeat(121), folderId: 'inbox' }),
  );
  assert.throws(() => validateLibrary({ ...library, version: 2 }));
  assert.throws(() =>
    validateLibrary({ ...library, folders: [library.folders[0], library.folders[0]] }),
  );
  assert.throws(() => mutate(library, 'edit', { id: 'missing' }));
});
