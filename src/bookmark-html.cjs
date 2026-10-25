'use strict';
const { randomUUID } = require('node:crypto');
const { normalizeUrl, validateLibrary } = require('./domain.cjs');
const folderTree = require('./folders.js');
const MAX_HTML_BYTES = 20 * 1024 * 1024;
const safeIcon = (value) =>
  typeof value === 'string' &&
  value.length <= 131072 &&
  /^data:image\/(?:png|jpeg|x-icon|vnd\.microsoft\.icon);base64,[a-z\d+/=]+$/i.test(value);
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
async function parseBookmarks(html) {
  if (typeof html !== 'string' || Buffer.byteLength(html) > MAX_HTML_BYTES)
    throw new Error('HTML 文件过大，最多支持 20 MB。');
  const { Parser } = await import('htmlparser2');
  const folders = [],
    bookmarks = [],
    stack = [];
  let capture = null,
    pendingFolder = null,
    lastBookmark = null,
    ignored = 0,
    skipped = 0;
  const finish = () => {
    if (!capture) return;
    if (capture.kind === 'h3') {
      pendingFolder = capture.value.trim().slice(0, 60) || '未命名文件夹';
      if (
        stack.length <= 1 &&
        !stack.some(Boolean) &&
        (pendingFolder === '收藏夹栏' || capture.attributes.personal_toolbar_folder === 'true')
      )
        pendingFolder = null;
    } else if (capture.kind === 'a') {
      try {
        const url = normalizeUrl(capture.attributes.href);
        const seconds = Number(capture.attributes.add_date);
        const createdAt =
          Number.isFinite(seconds) && seconds > 0 && seconds < 8640000000000
            ? new Date(seconds * 1000).toISOString()
            : new Date().toISOString();
        lastBookmark = {
          url,
          title: capture.value.trim().slice(0, 120) || new URL(url).hostname,
          note: '',
          path: stack.filter(Boolean),
          starred: capture.attributes.arcwell_starred === '1',
          createdAt,
        };
        if (safeIcon(capture.attributes.icon)) lastBookmark.icon = capture.attributes.icon;
        bookmarks.push(lastBookmark);
      } catch {
        skipped++;
        lastBookmark = null;
      }
    } else if (capture.kind === 'dd' && lastBookmark)
      lastBookmark.note = capture.value.trim().slice(0, 4000);
    capture = null;
  };
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (['script', 'style', 'iframe', 'object'].includes(name)) {
          ignored++;
          return;
        }
        if (ignored) return;
        if (['dt', 'dl', 'h3', 'a', 'dd'].includes(name)) finish();
        if (name === 'dl') {
          if (stack.length >= 32) throw new Error('文件夹层级超过 32 层。');
          stack.push(pendingFolder);
          pendingFolder = null;
          if (stack.at(-1)) folders.push({ path: stack.filter(Boolean) });
        } else if (['h3', 'a', 'dd'].includes(name))
          capture = { kind: name, attributes, value: '' };
        if (bookmarks.length > 20000 || folders.length > 300)
          throw new Error('导入文件超过 20,000 条链接或 300 个文件夹的上限。');
      },
      ontext(value) {
        if (!ignored && capture) capture.value += value;
      },
      onclosetag(name) {
        if (['script', 'style', 'iframe', 'object'].includes(name)) {
          ignored = Math.max(0, ignored - 1);
          return;
        }
        if (ignored) return;
        if (name === capture?.kind) finish();
        if (name === 'dl') {
          finish();
          stack.pop();
        }
      },
    },
    { decodeEntities: true },
  );
  parser.end(html);
  finish();
  if (!bookmarks.length && !folders.length)
    throw new Error('未找到可导入的收藏，请选择浏览器导出的书签 HTML 文件。');
  return { folders, bookmarks, skipped };
}
function repairToolbarFolders(library) {
  const next = structuredClone(library),
    remap = new Map(),
    folders = [];
  const paths = new Map(
    next.folders
      .filter((folder) => folder.id !== 'inbox' && folder.importPath?.[0] !== '收藏夹栏')
      .map((folder) => [JSON.stringify(folder.importPath || [folder.name]), folder.id]),
  );
  for (const folder of next.folders) {
    if (folder.importPath?.[0] !== '收藏夹栏') {
      folders.push(folder);
      continue;
    }
    const parts = folder.importPath.slice(1);
    if (!parts.length) {
      remap.set(folder.id, 'inbox');
      continue;
    }
    const key = JSON.stringify(parts);
    if (paths.has(key)) {
      remap.set(folder.id, paths.get(key));
      continue;
    }
    let name = parts.join(' / ').slice(0, 60);
    const occupied = new Set(
      next.folders
        .filter((item) => item.importPath?.[0] !== '收藏夹栏')
        .map((item) => item.name)
        .concat(folders.map((item) => item.name)),
    );
    if (occupied.has(name)) {
      const base = name.slice(0, 48);
      let suffix = 2;
      while (occupied.has((name = `${base} · ${suffix++}`))) {}
    }
    folder.name = name;
    folder.importPath = parts;
    folders.push(folder);
    paths.set(key, folder.id);
  }
  next.folders = folders;
  for (const bookmark of next.bookmarks)
    if (remap.has(bookmark.folderId)) bookmark.folderId = remap.get(bookmark.folderId);
  return validateLibrary(next);
}
function mergeBookmarks(library, imported) {
  const next = structuredClone(library),
    folderIndex = new Map(),
    urls = new Set(next.bookmarks.map((item) => item.url));
  for (const folder of next.folders)
    if (folder.id !== 'inbox') folderIndex.set(folderTree.key(folderTree.path(folder)), folder.id);
  const ensureFolder = (parts) => {
    if (!parts.length) return 'inbox';
    const key = folderTree.key(parts);
    if (folderIndex.has(key)) return folderIndex.get(key);
    const parentId = ensureFolder(parts.slice(0, -1));
    if (parentId !== 'inbox')
      parts = [
        ...folderTree.path(next.folders.find((folder) => folder.id === parentId)),
        parts.at(-1),
      ];
    if (next.folders.length >= 300) throw new Error('导入后文件夹将超过 300 个，未修改原收藏。');
    const name = parts.join(' / ').slice(0, 60);
    const id = randomUUID();
    next.folders.push({ id, name, importPath: parts });
    folderIndex.set(key, id);
    return id;
  };
  imported.folders.forEach((folder) => ensureFolder(folder.path));
  let added = 0,
    duplicates = 0;
  for (const item of imported.bookmarks) {
    if (urls.has(item.url)) {
      duplicates++;
      continue;
    }
    if (next.bookmarks.length >= 20000)
      throw new Error('导入后链接将超过 20,000 条，未修改原收藏。');
    const { path: parts, ...bookmark } = item;
    next.bookmarks.push({ ...bookmark, id: randomUUID(), folderId: ensureFolder(parts) });
    urls.add(item.url);
    added++;
  }
  return {
    library: validateLibrary(next),
    imported: added,
    duplicates,
    skipped: imported.skipped,
    foldersAdded: next.folders.length - library.folders.length,
  };
}
function serializeBookmarks(library, now = new Date()) {
  validateLibrary(library);
  const tree = { children: new Map(), bookmarks: [] };
  for (const folder of library.folders) {
    let node = tree;
    if (folder.id !== 'inbox')
      for (const part of folder.importPath || [folder.name]) {
        if (!node.children.has(part))
          node.children.set(part, { children: new Map(), bookmarks: [] });
        node = node.children.get(part);
      }
    node.bookmarks.push(...library.bookmarks.filter((item) => item.folderId === folder.id));
  }
  const seconds = Math.floor(now.getTime() / 1000);
  const render = (node, indent = '') => {
    const lines = [`${indent}<DL><p>`];
    for (const [name, child] of node.children) {
      lines.push(
        `${indent}    <DT><H3 ADD_DATE="${seconds}" LAST_MODIFIED="${seconds}">${escape(name)}</H3>`,
        render(child, `${indent}    `),
      );
    }
    for (const bookmark of node.bookmarks) {
      lines.push(
        `${indent}    <DT><A HREF="${escape(bookmark.url)}" ADD_DATE="${Math.floor(Date.parse(bookmark.createdAt) / 1000)}"${safeIcon(bookmark.icon) ? ` ICON="${escape(bookmark.icon)}"` : ''}>${escape(bookmark.title)}</A>`,
      );
    }
    lines.push(`${indent}</DL><p>`);
    return lines.join('\r\n');
  };
  return [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file.',
    '     It will be read and overwritten.',
    '     DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
    `    <DT><H3 ADD_DATE="${seconds}" LAST_MODIFIED="${seconds}" PERSONAL_TOOLBAR_FOLDER="true">收藏夹栏</H3>`,
    render(tree, '    '),
    '</DL><p>',
    '',
  ].join('\r\n');
}
module.exports = {
  parseBookmarks,
  mergeBookmarks,
  serializeBookmarks,
  repairToolbarFolders,
  safeIcon,
  MAX_HTML_BYTES,
};
