'use strict';
// importPath is the existing persisted hierarchy; ordinary folders are roots.
(function () {
  const path = (folder) => folder.importPath || [folder.name];
  const key = (parts) => JSON.stringify(parts.map((part) => part.toLocaleLowerCase()));
  const within = (parts, ancestor) =>
    parts.length >= ancestor.length && key(parts.slice(0, ancestor.length)) === key(ancestor);
  function entries(folders) {
    const result = [];
    const inbox = folders.find((folder) => folder.id === 'inbox');
    if (inbox) result.push({ folder: inbox, depth: 0, parts: path(inbox) });
    const visit = (parent, depth) => {
      for (const folder of folders) {
        if (folder.id === 'inbox') continue;
        const parts = path(folder);
        if (parts.length === parent.length + 1 && within(parts, parent)) {
          result.push({ folder, depth, parts });
          visit(parts, depth + 1);
        }
      }
    };
    visit([], 0);
    return result;
  }
  const api = { path, key, within, entries };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.arcwellFolders = Object.freeze(api);
})();
