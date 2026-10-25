'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { emptyLibrary, mutate } = require('../src/domain.cjs');
const {
  parseBookmarks,
  mergeBookmarks,
  serializeBookmarks,
  repairToolbarFolders,
} = require('../src/bookmark-html.cjs');
test('repair moves loose links to inbox and merges matching categories without losing bookmark fields', () => {
  const library = emptyLibrary();
  library.folders.push(
    { id: 'root', name: '收藏夹栏', importPath: ['收藏夹栏'] },
    { id: 'old', name: '收藏夹栏 / 工作', importPath: ['收藏夹栏', '工作'] },
    { id: 'existing', name: '工作', importPath: ['工作'] },
  );
  const base = {
    title: '保留',
    note: '保留备注',
    starred: true,
    createdAt: new Date().toISOString(),
  };
  library.bookmarks.push(
    { ...base, id: 'loose', url: 'https://loose.example/', folderId: 'root' },
    { ...base, id: 'grouped', url: 'https://grouped.example/', folderId: 'old' },
  );
  const repaired = repairToolbarFolders(library);
  assert.deepEqual(
    repaired.bookmarks,
    library.bookmarks.map((item) => ({
      ...item,
      folderId: item.id === 'loose' ? 'inbox' : 'existing',
    })),
  );
  assert.equal(repaired.folders.length, 2);
  assert.equal(library.folders.length, 4);
  assert.deepEqual(repairToolbarFolders(repaired), repaired);
});
test('outer browser toolbar is a container, while nested folders with that name remain categories', async () => {
  const parsed = await parseBookmarks(
    '<DL><DT><H3 PERSONAL_TOOLBAR_FOLDER="true">收藏夹栏</H3><DL><DT><A HREF="https://loose.example">散装</A><DT><H3>工作</H3><DL><DT><H3>收藏夹栏</H3><DL><DT><A HREF="https://nested.example">深层</A></DL></DL></DL></DL>',
  );
  assert.deepEqual(parsed.bookmarks[0].path, []);
  assert.deepEqual(parsed.bookmarks[1].path, ['工作', '收藏夹栏']);
  assert.deepEqual(
    parsed.folders.map((folder) => folder.path),
    [['工作'], ['工作', '收藏夹栏']],
  );
});
test('browser HTML preserves nested categories, entities, dates, notes and stars without executing scripts', async () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3>工作 &amp; 学习</H3><DL><p><DT><H3>资料</H3><DL><p><DT><A HREF="https://example.com/?x=1&amp;y=2" ADD_DATE="1700000000" ARCWELL_STARRED="1">名称 &lt;你好&gt;</A><DD>第一行\n第二行 &amp; 备注<DT><A HREF="javascript:alert(1)">危险链接</A><script><a href="https://injected.example">不应导入</a></script></DL><p></DL><p></DL><p>`;
  const parsed = await parseBookmarks(html);
  assert.equal(parsed.bookmarks.length, 1);
  assert.equal(parsed.skipped, 1);
  assert.deepEqual(parsed.bookmarks[0].path, ['工作 & 学习', '资料']);
  assert.equal(parsed.bookmarks[0].title, '名称 <你好>');
  assert.equal(parsed.bookmarks[0].note, '第一行\n第二行 & 备注');
  const library = mergeBookmarks(emptyLibrary(), parsed).library;
  const backup = serializeBookmarks(library);
  assert.ok(backup.includes('<TITLE>Bookmarks</TITLE>'));
  assert.ok(!backup.includes('<STYLE>'));
  assert.ok(!backup.includes('javascript:'));
  const restored = mergeBookmarks(emptyLibrary(), await parseBookmarks(backup)).library;
  assert.equal(restored.bookmarks[0].createdAt, library.bookmarks[0].createdAt);
  assert.equal(restored.bookmarks[0].note, '');
  assert.equal(restored.bookmarks[0].starred, false);
  assert.equal(restored.folders.length, library.folders.length);
});
test('imports merge instead of replacing; repeats are idempotent and unsafe icons ignored', async () => {
  let library = mutate(emptyLibrary(), 'add', { url: 'existing.com', folderId: 'inbox' }).library;
  const parsed = await parseBookmarks(
    '<DL><DT><H3>分类</H3><DL><DT><A HREF="https://new.example" ICON="https://tracker.example/icon">新链接</A><DT><A HREF="https://existing.com/">已有</A></DL></DL>',
  );
  const result = mergeBookmarks(library, parsed);
  assert.equal(result.imported, 1);
  assert.equal(result.duplicates, 1);
  library = result.library;
  assert.equal(library.bookmarks.length, 2);
  assert.equal(library.bookmarks[1].icon, undefined);
  const repeat = mergeBookmarks(library, parsed);
  assert.equal(repeat.imported, 0);
  assert.equal(repeat.foldersAdded, 0);
  assert.deepEqual(repeat.library, library);
  await assert.rejects(parseBookmarks('<p>无收藏</p>'), /未找到/);
});
test('standard bookmark HTML escapes titles and keeps application-only remarks out of the file', async () => {
  const added = mutate(emptyLibrary(), 'add', {
    url: 'https://example.com',
    title: '<img src=x onerror=alert(1)>',
    folderId: 'inbox',
  });
  const bookmark = added.library.bookmarks[0];
  const library = mutate(added.library, 'edit', {
    ...bookmark,
    note: '</DD><script>bad()</script>\n & "',
  }).library;
  const html = serializeBookmarks(library);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<DD>'));
  const result = await parseBookmarks(html);
  assert.equal(result.bookmarks[0].note, '');
  assert.equal(result.bookmarks[0].title, library.bookmarks[0].title);
  assert.ok(library.bookmarks[0].note.includes('<script>'));
});
test('backup uses the exact browser header, CRLF and standard bookmark tags without decorations', () => {
  const library = mutate(emptyLibrary(), 'add', {
    url: 'https://example.com',
    folderId: 'inbox',
    title: '普通书签',
  }).library;
  const html = serializeBookmarks(library, new Date('2026-10-11T00:00:00Z'));
  const header = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file.',
    '     It will be read and overwritten.',
    '     DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ].join('\r\n');
  assert.ok(html.startsWith(header + '\r\n'));
  assert.match(
    html,
    /    <DT><H3 ADD_DATE="\d+" LAST_MODIFIED="\d+" PERSONAL_TOOLBAR_FOLDER="true">收藏夹栏<\/H3>/,
  );
  assert.doesNotMatch(
    html,
    /<STYLE|<SCRIPT|<DD>|ARCWELL_|TARGET=|REL=|Content-Security-Policy|说明|更新时间|使用提示/i,
  );
  assert.doesNotMatch(html, /(?<!\r)\n/);
});
