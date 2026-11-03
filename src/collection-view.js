'use strict';
// Presentation model shared by the renderer and its hierarchy regression tests.
(function () {
  const tree =
    typeof module !== 'undefined' && module.exports
      ? require('./folders.js')
      : globalThis.arcwellFolders;
  function create(
    library,
    { scope = 'all', query = '', starred = false, sort = 'recent', direction = 'desc' } = {},
  ) {
    const entries = tree.entries(library.folders);
    const byId = new Map(entries.map((entry) => [entry.folder.id, entry]));
    const byPath = new Map(
      entries
        .filter((entry) => entry.folder.id !== 'inbox')
        .map((entry) => [tree.key(entry.parts), entry.folder.id]),
    );
    const parents = new Map(
      entries
        .filter((entry) => entry.folder.id !== 'inbox')
        .map((entry) => [entry.folder.id, byPath.get(tree.key(entry.parts.slice(0, -1))) || null]),
    );
    const lineage = new Map(
      entries
        .filter((entry) => entry.folder.id !== 'inbox')
        .map((entry) => [
          entry.folder.id,
          entry.parts
            .map((_, index) => byPath.get(tree.key(entry.parts.slice(0, index + 1))))
            .filter(Boolean),
        ]),
    );
    const rootOf = (id) => lineage.get(id)?.[0] || id;
    const ancestors = (id) => lineage.get(id) || [];
    const selected = byId.get(scope);
    const queryText = query.toLocaleLowerCase();
    let bookmarks = library.bookmarks.filter((bookmark) => {
      if ((starred || scope === 'stars') && !bookmark.starred) return false;
      if (
        selected &&
        (scope === 'inbox'
          ? bookmark.folderId !== 'inbox'
          : bookmark.folderId === 'inbox' ||
            !tree.within(byId.get(bookmark.folderId).parts, selected.parts))
      )
        return false;
      return `${bookmark.title} ${bookmark.url} ${bookmark.note}`
        .toLocaleLowerCase()
        .includes(queryText);
    });
    const dates = new Map(
      bookmarks.map((bookmark) => [bookmark.id, Date.parse(bookmark.createdAt)]),
    );
    if (scope === 'recent')
      bookmarks = bookmarks.sort((a, b) => dates.get(b.id) - dates.get(a.id)).slice(0, 30);
    const sign = direction === 'asc' ? 1 : -1;
    const compare = (a, b) => {
      const order = sort === 'name' ? a.title.localeCompare(b.title, 'zh-CN') : a.time - b.time;
      return (
        sign *
        (order ||
          (sort === 'recent' && a.index - b.index) ||
          a.title.localeCompare(b.title, 'zh-CN') ||
          a.id.localeCompare(b.id))
      );
    };
    // Bookmark ties retain the established title/ID ordering; legacy folder dates use insertion order.
    bookmarks.sort((a, b) => {
      const order =
        sort === 'name'
          ? a.title.localeCompare(b.title, 'zh-CN')
          : dates.get(a.id) - dates.get(b.id);
      return sign * (order || a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id));
    });
    const childrenById = new Map();
    entries.forEach(({ folder, parts }, index) => {
      if (folder.id === 'inbox') return;
      const parent = parents.get(folder.id);
      if (!childrenById.has(parent)) childrenById.set(parent, []);
      childrenById.get(parent).push({
        folder,
        parts,
        index,
        title: parts.at(-1),
        time: Date.parse(folder.createdAt) || 0,
        id: folder.id,
      });
    });
    for (const children of childrenById.values()) children.sort(compare);
    const direct = new Map(),
      counts = new Map();
    for (const bookmark of bookmarks) {
      if (!direct.has(bookmark.folderId)) direct.set(bookmark.folderId, []);
      direct.get(bookmark.folderId).push(bookmark);
      for (const id of bookmark.folderId === 'inbox' ? ['inbox'] : ancestors(bookmark.folderId))
        counts.set(id, (counts.get(id) || 0) + 1);
    }
    const children = (parent) => ({
      folders: childrenById.get(parent) || [],
      bookmarks: direct.get(parent === null ? 'inbox' : parent) || [],
    });
    return {
      bookmarks,
      byId,
      parents,
      counts,
      rootOf,
      ancestors,
      children,
      flat: Boolean(query || starred || scope === 'stars' || scope === 'recent'),
      parent: selected ? scope : null,
      roots: entries.filter((entry) => entry.depth === 0),
    };
  }
  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.arcwellCollectionView = Object.freeze(api);
})();
