'use strict';
const { randomUUID } = require('node:crypto');
const folders = require('./folders.js');
const MAX_BOOKMARKS = 20000;
function text(value, max, label, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()))
    throw new Error(`${label}不能为空，且最多 ${max} 个字符。`);
  return value.trim();
}
function normalizeUrl(value) {
  const raw = text(value, 4096, '网址');
  let parsed;
  try {
    parsed = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error('请输入有效的网址，例如 https://example.com。');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password
  )
    throw new Error('仅支持不含账号密码的 HTTP / HTTPS 网页链接。');
  return parsed.href;
}
function emptyLibrary() {
  return { version: 1, folders: [{ id: 'inbox', name: '默认分区' }], bookmarks: [] };
}
function validateLibrary(library) {
  if (library && Number.isInteger(library.version) && library.version !== 1) {
    const error = new Error(
      '收藏文件来自不兼容的版本，请使用对应版本的 Arcwell 打开。原文件已保留。',
    );
    error.code = 'UNSUPPORTED_VERSION';
    throw error;
  }
  if (
    !library ||
    library.version !== 1 ||
    !Array.isArray(library.folders) ||
    !Array.isArray(library.bookmarks)
  )
    throw new Error('收藏数据格式或版本不受支持。');
  if (library.folders.length > 300 || library.bookmarks.length > MAX_BOOKMARKS)
    throw new Error('收藏数据超过容量上限。');
  const ids = new Set();
  for (const folder of library.folders) {
    text(folder.id, 80, '文件夹标识');
    text(folder.name, 60, '文件夹名称');
    if (
      folder.importPath !== undefined &&
      (!Array.isArray(folder.importPath) ||
        folder.importPath.length > 32 ||
        !folder.importPath.length ||
        folder.importPath.some(
          (part) => typeof part !== 'string' || !part.trim() || part.length > 60,
        ))
    )
      throw new Error('导入文件夹路径无效。');
    if (ids.has(folder.id)) throw new Error('文件夹标识重复。');
    ids.add(folder.id);
  }
  if (!ids.has('inbox')) throw new Error('缺少默认分区。');
  const bookmarkIds = new Set();
  for (const bookmark of library.bookmarks) {
    text(bookmark.id, 80, '收藏标识');
    text(bookmark.title, 120, '名称');
    text(bookmark.note, 4000, '备注', true);
    if (
      normalizeUrl(bookmark.url) !== bookmark.url ||
      !ids.has(bookmark.folderId) ||
      typeof bookmark.starred !== 'boolean' ||
      !Number.isFinite(Date.parse(bookmark.createdAt))
    )
      throw new Error('收藏记录无效。');
    if (bookmarkIds.has(bookmark.id)) throw new Error('收藏标识重复。');
    bookmarkIds.add(bookmark.id);
    if (
      bookmark.icon !== undefined &&
      (typeof bookmark.icon !== 'string' ||
        bookmark.icon.length > 131072 ||
        !/^data:image\/(?:png|jpeg|x-icon|vnd\.microsoft\.icon);base64,[a-z\d+/=]+$/i.test(
          bookmark.icon,
        ))
    )
      throw new Error('网站图标无效。');
  }
  return library;
}
function findBookmark(library, id) {
  const bookmark = library.bookmarks.find((item) => item.id === id);
  if (!bookmark) throw new Error('这条收藏已不存在，请刷新后重试。');
  return bookmark;
}
function completeFolders(library) {
  const next = structuredClone(library);
  const inbox = next.folders.find((folder) => folder.id === 'inbox');
  if (inbox) {
    inbox.name = '默认分区';
    delete inbox.importPath;
  }
  const paths = new Set(
    next.folders
      .filter((folder) => folder.id !== 'inbox')
      .map((folder) => folders.key(folders.path(folder))),
  );
  for (const folder of [...next.folders]) {
    const parts = folders.path(folder);
    for (let depth = 1; depth < parts.length; depth++) {
      const prefix = parts.slice(0, depth);
      if (paths.has(folders.key(prefix))) continue;
      if (next.folders.length >= 300) throw new Error('补全父文件夹后超过300个，原收藏未修改。');
      next.folders.push({
        id: randomUUID(),
        name: prefix.join(' / ').slice(0, 60),
        importPath: prefix,
      });
      paths.add(folders.key(prefix));
    }
  }
  return validateLibrary(next);
}
function ensureUniqueFolder(library, parts, exceptId) {
  if (
    library.folders.some(
      (folder) =>
        folder.id !== exceptId && folders.key(folders.path(folder)) === folders.key(parts),
    )
  )
    throw new Error('同一父文件夹下的同名文件夹已存在。');
}
function mutate(library, action, payload = {}) {
  const next = structuredClone(library);
  let selectedId;
  switch (action) {
    case 'add': {
      const url = normalizeUrl(payload.url);
      if (next.bookmarks.some((item) => item.url === url))
        throw new Error('这个网址已经收藏过了，可以通过搜索找到它。');
      if (next.bookmarks.length >= MAX_BOOKMARKS) throw new Error('收藏数量已达到上限。');
      if (!next.folders.some((folder) => folder.id === payload.folderId))
        throw new Error('请选择有效的文件夹。');
      selectedId = randomUUID();
      next.bookmarks.unshift({
        id: selectedId,
        url,
        title: payload.title ? text(payload.title, 120, '名称') : new URL(url).hostname,
        note: '',
        folderId: payload.folderId,
        starred: false,
        createdAt: new Date().toISOString(),
      });
      break;
    }
    case 'edit': {
      const bookmark = findBookmark(next, payload.id);
      const url = normalizeUrl(payload.url);
      if (next.bookmarks.some((item) => item.id !== bookmark.id && item.url === url))
        throw new Error('这个网址已经收藏过了。');
      if (!next.folders.some((folder) => folder.id === payload.folderId))
        throw new Error('请选择有效的文件夹。');
      if (url !== bookmark.url) delete bookmark.icon;
      Object.assign(bookmark, {
        title: text(payload.title, 120, '名称'),
        url,
        note: text(payload.note, 4000, '备注', true),
        folderId: payload.folderId,
      });
      selectedId = bookmark.id;
      break;
    }
    case 'star': {
      const bookmark = findBookmark(next, payload.id);
      bookmark.starred = !bookmark.starred;
      selectedId = bookmark.id;
      break;
    }
    case 'remove':
      findBookmark(next, payload.id);
      next.bookmarks = next.bookmarks.filter((item) => item.id !== payload.id);
      break;
    case 'folder-add': {
      const name = text(payload.name, 60, '文件夹名称');
      const parent = payload.parentId
        ? next.folders.find((folder) => folder.id === payload.parentId && folder.id !== 'inbox')
        : null;
      if (payload.parentId && !parent) throw new Error('请选择有效的父文件夹。');
      const parts = [...(parent ? folders.path(parent) : []), name];
      if (parts.length > 30) throw new Error('文件夹最多支持30层。');
      ensureUniqueFolder(next, parts);
      if (next.folders.length >= 300) throw new Error('文件夹数量已达到上限。');
      next.folders.push({
        id: randomUUID(),
        name: parts.join(' / ').slice(0, 60),
        importPath: parts,
      });
      break;
    }
    case 'folder-rename': {
      if (payload.id === 'inbox') throw new Error('默认分区不能重命名。');
      const folder = next.folders.find((item) => item.id === payload.id);
      if (!folder) throw new Error('文件夹已不存在。');
      const name = text(payload.name, 60, '文件夹名称');
      const before = folders.path(folder);
      const after = [...before.slice(0, -1), name];
      ensureUniqueFolder(next, after, folder.id);
      for (const item of next.folders) {
        const parts = folders.path(item);
        if (!folders.within(parts, before)) continue;
        item.importPath = [...after, ...parts.slice(before.length)];
        item.name = item.importPath.join(' / ').slice(0, 60);
      }
      break;
    }
    case 'folder-remove': {
      if (payload.id === 'inbox' || !next.folders.some((item) => item.id === payload.id))
        throw new Error('这个文件夹不能移除。');
      const ancestor = folders.path(next.folders.find((item) => item.id === payload.id));
      const removed = new Set(
        next.folders
          .filter((item) => item.id !== 'inbox' && folders.within(folders.path(item), ancestor))
          .map((item) => item.id),
      );
      next.folders = next.folders.filter((item) => !removed.has(item.id));
      next.bookmarks.forEach((item) => {
        if (removed.has(item.folderId)) item.folderId = 'inbox';
      });
      break;
    }
    default:
      throw new Error('不支持的收藏操作。');
  }
  return { library: validateLibrary(next), selectedId };
}
module.exports = {
  emptyLibrary,
  validateLibrary,
  normalizeUrl,
  mutate,
  findBookmark,
  completeFolders,
};
