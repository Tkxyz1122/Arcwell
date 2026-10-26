'use strict';
const paths = {
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  folder: '<path d="M3 6h6l2 2h10v12H3z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  star: '<path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3L3.2 9.7l6.4-.9z"/>',
  settings:
    '<path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 3-1 2 2 3-2v-3l3-1 1-3-3-2V6l-3-2-2 1z"/><circle cx="11.5" cy="10.5" r="3"/>',
  link: '<path d="m9 15 6-6M8 13l-2 2a3.5 3.5 0 0 0 5 5l4-4a3.5 3.5 0 0 0 0-5M16 11l2-2a3.5 3.5 0 0 0-5-5L9 8a3.5 3.5 0 0 0 0 5"/>',
  external: '<path d="M8 5h11v11M19 5 5 19"/>',
  more: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  minus: '<path d="M5 12h14"/>',
  square: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  list: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  ascending: '<path d="M12 20V4m-5 5 5-5 5 5"/>',
  descending: '<path d="M12 4v16m-5-5 5 5 5-5"/>',
  edit: '<path d="m15 4 5 5-10 10-6 1 1-6zM13 6l5 5"/>',
  archive: '<path d="M4 8h16v13H4zM3 3h18v5H3zM9 12h6"/>',
  import: '<path d="M8 7V3h7l5 5v13H8v-4M15 3v5h5M3 12h10m-4-4 4 4-4 4"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
};
const $ = (id) => document.getElementById(id);
const api = window.arcwell;
const folderTree = window.arcwellFolders;
const state = {
  library: { folders: [], bookmarks: [] },
  scope: 'all',
  query: '',
  starred: false,
  sort: 'recent',
  sortDirections: { recent: 'desc', name: 'asc' },
  view: 'list',
  selected: null,
  dirty: false,
  busy: false,
  icons: new Map(),
  iconRequests: new Set(),
  backup: null,
  collapsedFolders: new Set(),
  knownFolders: new Set(),
};
function setDirty(dirty) {
  state.dirty = dirty;
  api.draft(dirty).catch((error) => toast(error.message));
}
function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.link}</svg>`;
}
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((element) => {
    element.innerHTML = icon(element.dataset.icon);
  });
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(label, iconName, className = '') {
  const node = element('button', className);
  node.type = 'button';
  if (iconName) node.innerHTML = icon(iconName);
  if (label) node.append(element('span', '', label));
  return node;
}
function iconButton(name, label) {
  const node = button('', name, 'icon-button');
  node.title = label;
  node.setAttribute('aria-label', label);
  return node;
}
let toastTimer;
function toast(message, undo = false) {
  clearTimeout(toastTimer);
  $('toast').replaceChildren(element('span', '', message));
  if (undo) {
    const control = button('撤销');
    control.onclick = () =>
      run(async () => {
        const result = await api.undo();
        applyResult(result);
        toast('已恢复收藏');
      });
    $('toast').append(control);
  }
  $('toast').hidden = false;
  toastTimer = setTimeout(
    () => {
      $('toast').hidden = true;
    },
    undo ? 10000 : 4500,
  );
}
async function run(operation) {
  if (state.busy) return;
  state.busy = true;
  document.body.setAttribute('aria-busy', 'true');
  try {
    await operation();
  } catch (error) {
    toast(error.message);
  } finally {
    state.busy = false;
    document.body.removeAttribute('aria-busy');
  }
}
let modalResolver, modalHandler;
function closeModal(value = false) {
  $('modal').close();
  const resolver = modalResolver;
  modalResolver = null;
  modalHandler = null;
  resolver?.(value);
}
function showModal(
  title,
  content,
  submitLabel,
  handler,
  { hideCancel = false, destructive = false, wide = false } = {},
) {
  if ($('modal').open) return Promise.resolve(false);
  $('modal-title').textContent = title;
  $('modal-content').replaceChildren(...content);
  $('modal-error').textContent = '';
  $('modal-submit').textContent = submitLabel;
  $('modal-cancel').hidden = hideCancel;
  $('modal').classList.toggle('wide', wide);
  $('modal-submit').classList.toggle('destructive', destructive);
  modalHandler = handler;
  $('modal').showModal();
  if (destructive) $('modal-cancel').focus();
  const input = $('modal-content').querySelector('input');
  if (input) {
    input.focus();
    input.select();
  }
  return new Promise((resolve) => {
    modalResolver = resolve;
  });
}
$('modal-form').onsubmit = async (event) => {
  event.preventDefault();
  const submit = $('modal-submit');
  submit.disabled = true;
  try {
    const result = await modalHandler?.();
    if (result !== false) closeModal(true);
  } catch (error) {
    $('modal-error').textContent = error.message;
  } finally {
    submit.disabled = false;
  }
};
$('modal-close').onclick = () => closeModal();
$('modal-cancel').onclick = () => closeModal();
$('modal').addEventListener('cancel', (event) => {
  event.preventDefault();
  if (!$('modal-submit').disabled) closeModal();
});
async function discardDraft() {
  if (!state.dirty) return true;
  return showModal(
    '放弃未保存的修改？',
    [element('p', '', '当前链接的修改尚未保存。放弃后将显示上次保存的内容。')],
    '放弃修改',
    () => {
      setDirty(false);
      renderInspector();
    },
  );
}
function currentBookmark() {
  return state.library.bookmarks.find((item) => item.id === state.selected);
}
function folderName(id) {
  const folder = state.library.folders.find((item) => item.id === id);
  return folder ? folderTree.path(folder).join(' / ') : '默认分区';
}
function scopeTitle() {
  return state.scope === 'all'
    ? '全部收藏'
    : state.scope === 'recent'
      ? '最近添加'
      : state.scope === 'stars'
        ? '星标收藏'
        : folderName(state.scope);
}
function filtered() {
  const selectedFolder = state.library.folders.find((folder) => folder.id === state.scope);
  const scopeIds = selectedFolder
    ? new Set(
        state.library.folders
          .filter((folder) =>
            selectedFolder.id === 'inbox'
              ? folder.id === 'inbox'
              : folder.id !== 'inbox' &&
                folderTree.within(folderTree.path(folder), folderTree.path(selectedFolder)),
          )
          .map((folder) => folder.id),
      )
    : null;
  let bookmarks = state.library.bookmarks.filter((bookmark) => {
    if (state.scope === 'stars' && !bookmark.starred) return false;
    if (scopeIds && !scopeIds.has(bookmark.folderId)) return false;
    if (state.starred && !bookmark.starred) return false;
    return `${bookmark.title} ${bookmark.url} ${bookmark.note}`
      .toLocaleLowerCase()
      .includes(state.query.toLocaleLowerCase());
  });
  // The recent scope always contains the latest 30, regardless of display direction.
  if (state.scope === 'recent') {
    bookmarks.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    bookmarks = bookmarks.slice(0, 30);
  }
  const direction = state.sortDirections[state.sort] === 'asc' ? 1 : -1;
  bookmarks.sort((a, b) => {
    const order =
      state.sort === 'name'
        ? a.title.localeCompare(b.title, 'zh-CN')
        : Date.parse(a.createdAt) - Date.parse(b.createdAt);
    return (
      direction * (order || a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id))
    );
  });
  return bookmarks;
}
async function setScope(scope) {
  if (!(await discardDraft())) return;
  state.scope = scope;
  state.starred = false;
  state.selected = null;
  refresh();
}
function renderNavigation() {
  const starredCount = state.library.bookmarks.filter((item) => item.starred).length;
  $('navigation').replaceChildren();
  for (const [id, label, glyph, count] of [
    ['all', '全部收藏', 'folder', state.library.bookmarks.length],
    ['recent', '最近添加', 'clock', Math.min(30, state.library.bookmarks.length)],
    ['stars', '星标收藏', 'star', starredCount],
  ]) {
    const control = button(label, glyph, `nav-item ${state.scope === id ? 'active' : ''}`);
    control.append(element('span', 'nav-count', count));
    control.onclick = () => setScope(id);
    $('navigation').append(control);
  }
  $('folders').replaceChildren();
  const treeEntries = folderTree.entries(state.library.folders);
  const byId = new Map(state.library.folders.map((folder) => [folder.id, folderTree.path(folder)]));
  const counts = new Map();
  let inboxCount = 0;
  for (const bookmark of state.library.bookmarks) {
    if (bookmark.folderId === 'inbox') {
      inboxCount++;
      continue;
    }
    const parts = byId.get(bookmark.folderId);
    for (let depth = 1; depth <= parts.length; depth++) {
      const key = folderTree.key(parts.slice(0, depth));
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  for (const { folder, depth, parts } of treeEntries) {
    if (
      treeEntries.some(
        (entry) =>
          entry.folder.id !== 'inbox' &&
          entry.parts.length < parts.length &&
          folderTree.within(parts, entry.parts) &&
          state.collapsedFolders.has(entry.folder.id),
      )
    )
      continue;
    const row = element('div', `folder-row ${state.scope === folder.id ? 'active' : ''}`);
    row.style.setProperty('--folder-depth', Math.min(depth, 8));
    const hasChildren =
      folder.id !== 'inbox' &&
      treeEntries.some(
        (entry) => entry.parts.length === parts.length + 1 && folderTree.within(entry.parts, parts),
      );
    const toggle = iconButton(
      'chevron',
      `${state.collapsedFolders.has(folder.id) ? '展开' : '收起'} ${parts.join(' / ')}`,
    );
    toggle.classList.add('folder-toggle');
    toggle.classList.toggle('leaf', !hasChildren);
    toggle.disabled = !hasChildren;
    if (hasChildren)
      toggle.setAttribute('aria-expanded', String(!state.collapsedFolders.has(folder.id)));
    toggle.onclick = () => {
      if (state.collapsedFolders.has(folder.id)) state.collapsedFolders.delete(folder.id);
      else state.collapsedFolders.add(folder.id);
      renderNavigation();
    };
    const control = button(parts.at(-1), 'folder', 'nav-item');
    control.title = parts.join(' / ');
    control.setAttribute('aria-label', control.title);
    control.querySelector('span').className = 'nav-label';
    control.append(
      element(
        'span',
        'nav-count',
        folder.id === 'inbox' ? inboxCount : counts.get(folderTree.key(parts)) || 0,
      ),
    );
    control.onclick = () => setScope(folder.id);
    row.append(toggle, control);
    $('folders').append(row);
  }
  const folder = state.library.folders.find((item) => item.id === state.scope);
  const menu = $('folder-menu');
  menu.hidden = !folder || folder.id === 'inbox';
  menu.onclick = null;
  if (!menu.hidden) {
    menu.title = `管理文件夹 ${folder.name}`;
    menu.setAttribute('aria-label', menu.title);
    menu.onclick = (event) =>
      openMenu(event, [
        ['新建子文件夹', () => addFolder(folder.id)],
        ['重命名', () => renameFolder(folder)],
        ['移除文件夹', () => removeFolder(folder)],
      ]);
  }
}
function siteIcon(bookmark, large = false) {
  const node = element('div', 'website-icon');
  const origin = new URL(bookmark.url).origin;
  const cached = state.icons.get(origin) || bookmark.icon;
  if (cached) {
    const image = element('img');
    image.src = cached;
    image.alt = '';
    node.append(image);
  } else {
    node.textContent = bookmark.title.slice(0, 1).toUpperCase();
    node.setAttribute('aria-label', '网站图标');
  }
  node.dataset.origin = origin;
  if (large) node.classList.add('large');
  if (!state.iconRequests.has(origin)) {
    state.iconRequests.add(origin);
    api
      .icon(bookmark.url, false)
      .then((value) => {
        if (value) updateIcon(origin, value);
      })
      .catch(() => {
        /* Cached icons are optional; the initial remains visible. */
      });
  }
  return node;
}
function updateIcon(origin, value) {
  state.icons.set(origin, value);
  document.querySelectorAll('.website-icon').forEach((node) => {
    if (node.dataset.origin === origin) {
      const image = element('img');
      image.src = value;
      image.alt = '';
      node.replaceChildren(image);
    }
  });
}
async function fetchIcon(bookmark, showFeedback = false) {
  try {
    const value = await api.icon(bookmark.url, true);
    if (value) updateIcon(new URL(bookmark.url).origin, value);
    if (showFeedback) toast('网站图标已更新');
  } catch {
    if (showFeedback) toast('网站图标暂时无法读取，已保留文字图标。');
  }
}
async function selectBookmark(id) {
  if (state.selected === id) return;
  if (!(await discardDraft())) return;
  state.selected = id;
  document
    .querySelectorAll('.bookmark-row')
    .forEach((row) => row.classList.toggle('selected', row.dataset.id === id));
  renderInspector();
}
function bookmarkMenu(event, bookmark) {
  openMenu(event, [
    ['打开网页', () => run(() => api.open(bookmark.id))],
    ['编辑详情', () => selectBookmark(bookmark.id)],
    [bookmark.starred ? '取消星标' : '加入星标', () => toggleStar(bookmark.id)],
    ['刷新图标', () => fetchIcon(bookmark, true)],
    ['移除收藏', () => removeBookmark(bookmark)],
  ]);
}
function renderList() {
  const list = $('bookmark-list');
  list.classList.toggle('grid', state.view === 'grid');
  list.replaceChildren();
  const bookmarks = filtered();
  $('result-count').textContent = bookmarks.length;
  if (!bookmarks.length) {
    const empty = element('div', 'empty');
    empty.innerHTML = icon(state.query ? 'search' : 'bookmark');
    empty.append(
      element('strong', '', state.query ? '没有找到匹配的收藏' : '好网页，值得有个好位置'),
      element(
        'p',
        '',
        state.query
          ? '试试网站名称、网址或备注里的其他关键词。'
          : '粘贴第一个网址，建立属于你的收藏空间。文件夹让每一条链接井井有条。',
      ),
    );
    if (!state.query) {
      const control = button('添加第一个网址', 'plus', 'primary');
      control.onclick = showAdd;
      empty.append(control);
    }
    list.append(empty);
    return;
  }
  for (const bookmark of bookmarks) {
    const row = element(
      'article',
      `bookmark-row ${state.selected === bookmark.id ? 'selected' : ''}`,
    );
    row.dataset.id = bookmark.id;
    row.tabIndex = 0;
    row.setAttribute('aria-label', `${bookmark.title}，单击打开网页，菜单编辑详情`);
    row.onclick = (event) => {
      if (event.button !== 0 || event.detail > 1) return;
      if (
        event.target.closest('button, a, input, select, textarea, .bookmark-actions, .folder-chip')
      )
        return;
      run(() => api.open(bookmark.id));
    };
    row.onkeydown = (event) => {
      if (event.target === row && event.key === 'Enter') run(() => api.open(bookmark.id));
    };
    row.oncontextmenu = (event) => {
      event.preventDefault();
      bookmarkMenu(event, bookmark);
    };
    row.append(siteIcon(bookmark));
    const copy = element('div', 'bookmark-copy');
    const title = button(bookmark.title, null, 'bookmark-title');
    title.title = '单击使用默认浏览器打开，通过菜单编辑详情';
    title.innerHTML = '';
    title.append(element('span', '', bookmark.title));
    title.onclick = (event) => {
      event.stopPropagation();
      if (event.detail <= 1) run(() => api.open(bookmark.id));
    };
    copy.append(
      title,
      element('span', 'bookmark-domain', new URL(bookmark.url).hostname),
      element('p', 'bookmark-note', bookmark.note || '通过菜单编辑详情，添加你的备注'),
    );
    row.append(copy);
    const chip = element('div', 'folder-chip');
    chip.innerHTML = icon('folder');
    chip.append(element('span', '', folderName(bookmark.folderId)));
    row.append(chip);
    const actions = element('div', 'bookmark-actions');
    const star = iconButton('star', bookmark.starred ? '取消星标' : '加入星标');
    star.classList.toggle('starred', bookmark.starred);
    star.setAttribute('aria-pressed', bookmark.starred);
    star.onclick = (event) => {
      event.stopPropagation();
      toggleStar(bookmark.id);
    };
    const more = iconButton('more', `管理 ${bookmark.title}`);
    more.onclick = (event) => {
      event.stopPropagation();
      bookmarkMenu(event, bookmark);
    };
    actions.append(star, more);
    row.append(actions);
    list.append(row);
  }
}
function field(label, input) {
  const wrapper = element('label', 'field', label);
  wrapper.append(input);
  return wrapper;
}
function input(id, value, maxLength) {
  const node = element('input');
  node.id = id;
  node.value = value;
  node.maxLength = maxLength;
  node.required = true;
  return node;
}
function folderSelect(id, selected) {
  const select = element('select');
  select.id = id;
  for (const { folder } of folderTree.entries(state.library.folders)) {
    const option = element('option', '', folderName(folder.id));
    option.value = folder.id;
    option.selected = folder.id === selected;
    select.append(option);
  }
  return select;
}
function renderInspector() {
  const pane = $('inspector');
  pane.replaceChildren();
  const bookmark = currentBookmark();
  pane.hidden = !bookmark;
  if (!bookmark) return;
  const heading = element('div', 'inspector-heading');
  heading.append(element('h2', '', '链接详情'));
  pane.append(heading);
  const close = iconButton('close', '关闭链接详情');
  close.onclick = async () => {
    if (await discardDraft()) {
      state.selected = null;
      refresh();
    }
  };
  heading.append(close);
  const profile = element('section', 'site-profile');
  profile.setAttribute('aria-label', '网站资料');
  const cover = element('div', 'profile-cover');
  cover.setAttribute('aria-hidden', 'true');
  const brand = element('div', 'detail-brand');
  const text = element('div');
  text.append(
    element('strong', '', bookmark.title),
    element('small', '', new URL(bookmark.url).hostname),
  );
  text.title = bookmark.title;
  brand.append(siteIcon(bookmark, true), text);
  const open = button('打开网页', 'external', 'primary full');
  open.onclick = () => run(() => api.open(bookmark.id));
  const profileActions = element('div', 'profile-actions');
  open.title = '使用系统默认浏览器打开';
  profileActions.append(
    open,
    element(
      'p',
      'detail-date profile-date',
      '添加于 ' + new Date(bookmark.createdAt).toLocaleDateString('zh-CN'),
    ),
  );
  profile.append(cover, brand, profileActions);
  pane.append(profile);
  const form = element('form', 'detail-form');
  form.id = 'detail-form';
  const title = input('detail-title', bookmark.title, 120);
  const url = element('textarea');
  url.id = 'detail-url';
  url.value = bookmark.url;
  url.maxLength = 4096;
  url.required = true;
  url.rows = 2;
  url.spellcheck = false;
  url.inputMode = 'url';
  url.wrap = 'soft';
  const folder = folderSelect('detail-folder', bookmark.folderId);
  const note = element('textarea');
  note.id = 'detail-note';
  note.value = bookmark.note;
  note.maxLength = 4000;
  note.placeholder = '记录为什么收藏这个网页…';
  form.append(
    field('名称', title),
    field('网址', url),
    field('所属文件夹', folder),
    field('备注', note),
  );
  const mark = element('div', 'detail-star');
  const label = element('span');
  label.innerHTML = icon('star');
  label.classList.toggle('starred', bookmark.starred);
  label.append(document.createTextNode('加入星标'));
  const toggle = button('', null, `switch ${bookmark.starred ? 'on' : ''}`);
  toggle.id = 'detail-star';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', bookmark.starred);
  toggle.setAttribute('aria-label', '加入星标');
  toggle.onclick = () => toggleStar(bookmark.id);
  mark.append(label, toggle);
  form.append(mark);
  const error = element('p', 'form-error');
  error.id = 'detail-error';
  error.setAttribute('role', 'alert');
  form.append(error);
  const actions = element('div', 'detail-actions');
  const save = button('保存修改', null, 'primary');
  save.type = 'submit';
  const more = iconButton('more', '更多操作');
  more.onclick = (event) => bookmarkMenu(event, bookmark);
  actions.append(save, more);
  form.append(actions);
  form.addEventListener('input', () => {
    setDirty(true);
    save.textContent = '保存修改 · 未保存';
  });
  form.onsubmit = (event) => {
    event.preventDefault();
    run(async () => {
      try {
        const changedUrl = bookmark.url !== url.value;
        const result = await api.change('edit', {
          id: bookmark.id,
          title: title.value,
          url: url.value,
          folderId: folder.value,
          note: note.value,
        });
        setDirty(false);
        applyResult(result);
        toast('修改已保存');
        if (changedUrl) fetchIcon(currentBookmark());
      } catch (failure) {
        error.textContent = failure.message;
      }
    });
  };
  pane.append(form);
}
function refresh(details = true) {
  for (const folder of state.library.folders) {
    if (!state.knownFolders.has(folder.id)) state.collapsedFolders.add(folder.id);
    state.knownFolders.add(folder.id);
  }
  renderNavigation();
  $('page-title').textContent = scopeTitle();
  $('breadcrumb-name').textContent = scopeTitle();
  $('all-tab').classList.toggle('active', !state.starred);
  $('star-tab').classList.toggle('active', state.starred);
  $('list-view').classList.toggle('active', state.view === 'list');
  $('grid-view').classList.toggle('active', state.view === 'grid');
  renderList();
  if (details) renderInspector();
}
function applyResult(result, details = true, selectNew = false) {
  state.library = result.library;
  if (result.backup) updateBackup(result.backup);
  if (result.selectedId && selectNew) state.selected = result.selectedId;
  if (!currentBookmark()) state.selected = null;
  refresh(details);
}
function toggleStar(id) {
  run(async () => {
    const selected = state.selected;
    const result = await api.change('star', { id });
    state.library = result.library;
    if (result.backup) updateBackup(result.backup);
    state.selected = selected;
    refresh(false);
    const control = $('detail-star');
    const current = currentBookmark();
    if (control && current) {
      control.classList.toggle('on', current.starred);
      control.setAttribute('aria-checked', current.starred);
      control.parentElement.querySelector('span').classList.toggle('starred', current.starred);
    }
  });
}
async function showAdd() {
  if (!(await discardDraft())) return;
  const url = input('add-url', $('quick-url').value, 4096);
  url.placeholder = 'https://example.com';
  const title = input('add-title', '', 120);
  title.required = false;
  title.placeholder = '留空时使用网站域名';
  const folder = folderSelect(
    'add-folder',
    state.library.folders.some((item) => item.id === state.scope) ? state.scope : 'inbox',
  );
  await showModal(
    '添加网址',
    [field('网址', url), field('名称（可选）', title), field('所属文件夹', folder)],
    '收藏网页',
    async () => {
      const result = await api.change('add', {
        url: url.value,
        title: title.value,
        folderId: folder.value,
      });
      setDirty(false);
      state.scope = folder.value;
      state.starred = false;
      state.query = '';
      $('search').value = '';
      applyResult(result, true, false);
      $('quick-url').value = '';
      toast('网页已收藏');
      fetchIcon(result.library.bookmarks.find((item) => item.id === result.selectedId));
    },
  );
}
$('quick-add').onsubmit = (event) => {
  event.preventDefault();
  run(async () => {
    await api.openUrl($('quick-url').value);
    toast('已使用默认浏览器打开');
  });
};
async function renameFolder(folder) {
  const name = input('folder-name', folderTree.path(folder).at(-1), 60);
  await showModal('重命名文件夹', [field('文件夹名称', name)], '保存名称', async () => {
    const result = await api.change('folder-rename', { id: folder.id, name: name.value });
    applyResult(result, !state.dirty);
    toast('文件夹已重命名');
  });
}
async function removeFolder(folder) {
  if (!(await discardDraft())) return;
  await showModal(
    '移除文件夹？',
    [
      element(
        'p',
        '',
        `将移除「${folderName(folder.id)}」及其所有子文件夹，其中全部收藏会移到「默认分区」，链接与备注会保留。`,
      ),
    ],
    '移除文件夹',
    async () => {
      const result = await api.change('folder-remove', { id: folder.id });
      if (state.scope === folder.id) state.scope = 'inbox';
      setDirty(false);
      applyResult(result);
      toast('文件夹已移除，收藏已移至默认分区');
    },
    { destructive: true },
  );
}
async function removeBookmark(bookmark) {
  if (state.selected === bookmark.id && !(await discardDraft())) return;
  await showModal(
    '移除这条收藏？',
    [
      element(
        'p',
        '',
        `将从收藏中移除「${bookmark.title}」。移除后可以立即撤销，网站本身不会受到影响。`,
      ),
    ],
    '移除收藏',
    async () => {
      const result = await api.change('remove', { id: bookmark.id });
      const preserveDraft = state.dirty && state.selected !== bookmark.id;
      applyResult(result, !preserveDraft);
      toast('已移除收藏', true);
    },
    { destructive: true },
  );
}
async function addFolder(parentId = '') {
  const name = input('folder-name', '', 60);
  name.placeholder = '例如：设计灵感';
  const parent = folderSelect('folder-parent', parentId);
  parent.querySelector('option[value="inbox"]').remove();
  const root = element('option', '', '顶层文件夹');
  root.value = '';
  parent.prepend(root);
  parent.value = parentId;
  await showModal(
    '新建文件夹',
    [field('文件夹名称', name), field('上级文件夹', parent)],
    '创建文件夹',
    async () => {
      const result = await api.change('folder-add', { name: name.value, parentId: parent.value });
      state.collapsedFolders.delete(parent.value);
      applyResult(result, !state.dirty);
      toast('文件夹已创建');
    },
  );
}
$('new-folder').onclick = () => addFolder();
function openMenu(event, items) {
  event.preventDefault();
  event.stopPropagation();
  const menu = $('context-menu');
  menu.replaceChildren();
  for (const [label, action] of items) {
    const control = button(label);
    control.onclick = () => {
      menu.hidden = true;
      action();
    };
    if (label.startsWith('移除')) control.classList.add('danger');
    menu.append(control);
  }
  menu.hidden = false;
  menu.style.left = `${Math.min(event.clientX, innerWidth - 175)}px`;
  menu.style.top = `${Math.max(4, Math.min(event.clientY, innerHeight - menu.offsetHeight - 12))}px`;
}
document.addEventListener('click', () => {
  $('context-menu').hidden = true;
});
$('settings').onclick = async () => {
  const description = element(
    'p',
    '',
    'Arcwell · 收藏保存在本地。每次修改后自动覆盖更新“网址备份.html”，使用标准浏览器书签格式保存分类、名称、网址、图标与添加时间；备注和星标保存在本地数据中。',
  );
  const exportButton = button('导出收藏备份', 'archive', 'secondary');
  exportButton.onclick = async () => {
    exportButton.disabled = true;
    try {
      if (await api.export()) toast('收藏备份已导出');
    } catch (error) {
      $('modal-error').textContent = error.message;
    } finally {
      exportButton.disabled = false;
    }
  };
  const backup = await api.backupStatus();
  updateBackup(backup);
  const htmlCard = element('div', 'settings-card');
  htmlCard.append(element('h3', '', '自动 HTML 备份'));
  const paths = element('p', 'backup-paths');
  const refreshPaths = () => {
    paths.textContent = `应用内：${state.backup.applicationFile}\n自定义：${state.backup.customFile || '尚未设置，请选择第二份备份目录'}\n${state.backup.warning || state.backup.settingsWarning || (state.backup.configured ? '两份备份会随每次修改自动更新。' : '选择目录后立即生成第二份，并自动记住路径。')}`;
  };
  refreshPaths();
  htmlCard.append(paths);
  const choose = button('选择备份目录', 'folder', 'secondary');
  choose.onclick = async () => {
    choose.disabled = true;
    try {
      const status = await api.chooseBackup();
      if (status) {
        updateBackup(status);
        refreshPaths();
        toast(status.warning || '备份目录已设置，两份 HTML 备份已更新');
      }
    } catch (error) {
      $('modal-error').textContent = error.message;
    } finally {
      choose.disabled = false;
    }
  };
  const retry = button('立即更新备份', 'archive', 'secondary');
  retry.onclick = async () => {
    retry.disabled = true;
    try {
      const status = await api.retryBackup();
      updateBackup(status);
      refreshPaths();
      toast(status.warning || 'HTML 备份已更新');
    } catch (error) {
      $('modal-error').textContent = error.message;
    } finally {
      retry.disabled = false;
    }
  };
  htmlCard.append(element('p', '', '导出会复制应用目录里的 HTML 备份，可直接打开或重新导入。'));
  const backupActions = element('div', 'backup-actions');
  backupActions.append(choose, retry, exportButton);
  htmlCard.append(backupActions);
  const updateCard = element('div', 'settings-card');
  updateCard.append(element('h3', '', '应用更新'));
  const updateStatus = element('p', 'update-status');
  updateStatus.id = 'update-status';
  updateStatus.setAttribute('aria-live', 'polite');
  const progress = element('progress', 'update-progress');
  progress.max = 100;
  progress.setAttribute('aria-label', '更新下载进度');
  const actions = element('div', 'update-actions');
  const check = button('检查更新', 'clock', 'secondary');
  check.id = 'check-update';
  const download = button('下载更新', 'archive', 'secondary');
  download.id = 'download-update';
  const install = button('安装更新', 'external', 'primary');
  install.id = 'install-update';
  const cancel = button('取消下载', null, 'secondary');
  const releases = button('GitHub 发布页', 'external', 'secondary');
  const paintUpdate = (status) => {
    updateStatus.textContent = `当前版本 ${status.currentVersion}\n${status.message}`;
    const busy = ['checking', 'downloading'].includes(status.phase);
    check.disabled = busy;
    download.hidden = status.phase !== 'available';
    install.hidden = status.phase !== 'ready';
    cancel.hidden = !busy;
    cancel.textContent = status.phase === 'checking' ? '取消检查' : '取消下载';
    progress.hidden = status.phase !== 'downloading';
    progress.value = status.progress || 0;
  };
  let updateAction = false;
  const updateOperation = async (control, operation) => {
    if (updateAction) return;
    updateAction = true;
    control.disabled = true;
    try {
      await operation();
      paintUpdate(await api.updateStatus());
    } catch (error) {
      $('modal-error').textContent = error.message;
    } finally {
      updateAction = false;
      control.disabled = false;
    }
  };
  check.onclick = () => updateOperation(check, () => api.checkUpdate());
  download.onclick = () => updateOperation(download, () => api.downloadUpdate());
  cancel.onclick = () => updateOperation(cancel, () => api.cancelUpdate());
  install.onclick = () =>
    updateOperation(install, async () => {
      showUpdateFeedback({ status: 'installing' });
      try {
        await api.installUpdate();
      } catch (error) {
        showUpdateFeedback({ status: 'failed' }, error.message);
      }
    });
  releases.onclick = () => updateOperation(releases, () => api.updateReleases());
  paintUpdate(await api.updateStatus());
  actions.append(check, download, install, cancel, releases);
  updateCard.append(updateStatus, progress, actions);
  const updateTimer = setInterval(async () => {
    try {
      if (!updateAction) paintUpdate(await api.updateStatus());
    } catch {
      clearInterval(updateTimer);
    }
  }, 600);
  await showModal('设置与备份', [description, htmlCard, updateCard], '完成', () => true, {
    hideCancel: true,
    wide: true,
  });
  clearInterval(updateTimer);
};
function updateBackup(backup) {
  state.backup = backup;
  const status = $('save-status');
  status.classList.toggle('backup-warning', !!backup.warning || !backup.configured);
  status.querySelector('span').textContent = backup.warning
    ? '备份待重试'
    : backup.configured
      ? '双份备份已同步'
      : '本地已保存';
  status.title =
    backup.warning ||
    (backup.configured
      ? '应用目录与自定义目录的 HTML 备份已同步。'
      : '应用内 HTML 已保存；请在设置中选择第二份备份目录。');
}
$('import-bookmarks').onclick = () =>
  run(async () => {
    if (!(await discardDraft())) return;
    const choices = element('div', 'import-modes');
    for (const [mode, title, description] of [
      ['merge', 'A · 合并添加', '已有收藏保持不变，文件中没有的也不删除，只添加尚未收藏的网址。'],
      [
        'replace',
        'B · 完全覆盖',
        '以文件内容替换当前全部收藏和文件夹。执行前再次确认，并单独备份原收藏。',
      ],
    ]) {
      const label = element('label', 'import-mode');
      const radio = element('input');
      radio.type = 'radio';
      radio.name = 'import-mode';
      radio.value = mode;
      radio.id = `import-${mode}`;
      radio.checked = mode === 'merge';
      label.append(radio, element('strong', '', title), element('small', '', description));
      choices.append(label);
    }
    await showModal(
      '导入浏览器收藏',
      [element('p', '', '选择浏览器导出的 HTML 书签文件，并选择导入方式。'), choices],
      '选择 HTML 文件',
      async () => {
        const mode = choices.querySelector('input:checked').value;
        const result = await api.importHtml(mode);
        if (!result) return false;
        state.scope = 'all';
        state.selected = null;
        state.query = '';
        state.starred = false;
        if (mode === 'replace') {
          state.collapsedFolders.clear();
          state.knownFolders.clear();
        }
        $('search').value = '';
        applyResult(result);
        toast(
          `${mode === 'replace' ? '已覆盖导入' : '已导入'} ${result.imported} 条收藏，跳过 ${result.duplicates} 条重复网址${result.skipped ? `、${result.skipped} 条无效链接` : ''}${result.recoveryFile ? '；原收藏已单独备份' : ''}${result.backup.warning ? '；HTML 备份待重试' : ''}`,
        );
        $('toast').title = result.recoveryFile ? `原收藏恢复备份：${result.recoveryFile}` : '';
      },
    );
  });
$('search').oninput = (event) => {
  state.query = event.target.value;
  renderList();
};
function renderSortDirection() {
  const ascending = state.sortDirections[state.sort] === 'asc';
  const criterion = state.sort === 'recent' ? '添加时间' : '名称';
  const label =
    '当前按' +
    criterion +
    (ascending ? '升序' : '降序') +
    '，切换为' +
    (ascending ? '降序' : '升序');
  const control = $('sort-direction');
  control.innerHTML = icon(ascending ? 'ascending' : 'descending');
  control.setAttribute('aria-label', label);
  control.title =
    state.sort === 'recent'
      ? ascending
        ? '由旧到新 · 点击反转'
        : '由新到旧 · 点击反转'
      : ascending
        ? '名称正序 · 点击反转'
        : '名称倒序 · 点击反转';
}
$('sort').onchange = (event) => {
  state.sort = event.target.value;
  renderSortDirection();
  renderList();
};
$('sort-direction').onclick = () => {
  state.sortDirections[state.sort] = state.sortDirections[state.sort] === 'asc' ? 'desc' : 'asc';
  renderSortDirection();
  renderList();
};
renderSortDirection();
$('all-tab').onclick = () => {
  state.starred = false;
  refresh(false);
};
$('star-tab').onclick = () => {
  state.starred = true;
  refresh(false);
};
$('list-view').onclick = () => {
  state.view = 'list';
  refresh(false);
};
$('grid-view').onclick = () => {
  state.view = 'grid';
  refresh(false);
};
$('add-header').onclick = showAdd;
document.querySelectorAll('[data-window]').forEach((control) => {
  control.onclick = async () => {
    if (control.dataset.window === 'close' && !(await discardDraft())) return;
    api.window(control.dataset.window).catch((error) => toast(error.message));
  };
});
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    $('search').focus();
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'n' && !$('modal').open) {
    event.preventDefault();
    showAdd();
  }
  if (event.key === 'Escape') $('context-menu').hidden = true;
});
window.addEventListener('beforeunload', (event) => {
  if (state.dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});
hydrateIcons();
let updateInProgress = false;
function showUpdateFeedback(result, detail) {
  const success = result.status === 'success';
  updateInProgress = result.status === 'installing';
  $('update-feedback-title').textContent = updateInProgress
    ? '正在更新'
    : success
      ? '更新成功'
      : '更新失败';
  $('update-feedback-message').textContent =
    detail ||
    (updateInProgress
      ? '正在原安装目录后台更新，完成后会自动重新打开应用。\n收藏与设置会保留，请稍候。'
      : success
        ? `已更新至 ${result.version}，收藏与设置均已保留。`
        : result.status === 'rollback-failed'
          ? '程序文件未能完整恢复，请重新运行安装程序修复。收藏与备份数据保留在本地。'
          : '更新未完成，收藏与设置未被删除。请检查文件占用、权限和磁盘空间后重试。');
  $('update-feedback-done').hidden = updateInProgress;
  if (!$('update-feedback').open) $('update-feedback').showModal();
}
$('update-feedback-done').onclick = () => $('update-feedback').close();
$('update-feedback').oncancel = (event) => {
  if (updateInProgress) event.preventDefault();
};
api.onUpdateResult((result) => showUpdateFeedback(result));
api
  .load()
  .then((result) => {
    state.library = result.library;
    updateBackup(result.backup);
    refresh();
    if (result.warning) toast(result.warning);
    if (result.updateResult) showUpdateFeedback(result.updateResult);
  })
  .catch((error) => toast(error.message));
