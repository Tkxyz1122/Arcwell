'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { emptyLibrary, validateLibrary, mutate, completeFolders } = require('./domain.cjs');
const MAX_SIZE = 32 * 1024 * 1024;
class LibraryStore {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, 'library.json');
    this.library = null;
    this.queue = Promise.resolve();
    this.lastRemoved = null;
    this.warning = '';
  }
  async read(file) {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SIZE)
      throw new Error('收藏数据文件无效或过大。');
    return validateLibrary(JSON.parse(await fs.readFile(file, 'utf8')));
  }
  async load() {
    await fs.mkdir(this.directory, { recursive: true });
    try {
      this.library = await this.read(this.file);
    } catch (error) {
      if (error.code === 'UNSUPPORTED_VERSION') throw error;
      if (error.code === 'ENOENT') {
        this.library = emptyLibrary();
        await this.write(this.library, false);
      } else {
        try {
          this.library = await this.read(`${this.file}.bak`);
        } catch {
          throw new Error('收藏文件无法读取。原文件已保留，请通过备份恢复，不会覆盖你的数据。');
        }
        await fs.copyFile(this.file, `${this.file}.corrupt-${Date.now()}`);
        await this.write(this.library, false);
        this.warning = '收藏文件异常，已从上次备份恢复；原文件已保留。';
      }
    }
    this.diskSnapshot = JSON.stringify(this.library);
    const { repairToolbarFolders } = require('./bookmark-html.cjs');
    const repaired = completeFolders(repairToolbarFolders(this.library));
    if (JSON.stringify(repaired) !== this.diskSnapshot) {
      await this.commit(repaired);
      this.warning += ' 已更新默认分区和文件夹层级，链接与备注均保留。';
    }
    return this.snapshot();
  }
  snapshot() {
    return structuredClone(this.library);
  }
  async write(library, backup = true) {
    const content = JSON.stringify(validateLibrary(library), null, 2);
    if (Buffer.byteLength(content) > MAX_SIZE) throw new Error('收藏数据文件过大，无法保存。');
    const temporary = `${this.file}.tmp`;
    try {
      const handle = await fs.open(temporary, 'w', 0o600);
      try {
        await handle.writeFile(content, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (backup) await fs.copyFile(this.file, `${this.file}.bak`);
      await fs.rename(temporary, this.file);
    } catch (error) {
      try {
        await fs.unlink(temporary);
      } catch (cleanup) {
        if (cleanup.code !== 'ENOENT') console.error('Temporary file cleanup failed.');
      }
      throw error;
    }
  }
  enqueue(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }
  async commit(next, { preserveImport = false } = {}) {
    const disk = await this.read(this.file);
    if (JSON.stringify(disk) !== this.diskSnapshot)
      throw new Error('收藏文件被其他程序修改，请重新启动 Arcwell 后再保存。');
    let recoveryFile;
    if (preserveImport) {
      recoveryFile = path.join(
        this.directory,
        `library.before-import-${Date.now()}-${randomUUID()}.json`,
      );
      await fs.copyFile(this.file, recoveryFile, fs.constants.COPYFILE_EXCL);
    }
    await this.write(next);
    this.library = next;
    this.diskSnapshot = JSON.stringify(next);
    return recoveryFile;
  }
  change(action, payload) {
    return this.enqueue(async () => {
      const result = mutate(this.library, action, payload);
      const removed =
        action === 'remove' ? this.library.bookmarks.find((item) => item.id === payload.id) : null;
      await this.commit(result.library);
      if (removed) this.lastRemoved = structuredClone(removed);
      return { library: this.snapshot(), selectedId: result.selectedId };
    });
  }
  undo() {
    return this.enqueue(async () => {
      if (!this.lastRemoved) throw new Error('没有可撤销的移除操作。');
      const next = this.snapshot();
      if (next.bookmarks.some((item) => item.url === this.lastRemoved.url))
        throw new Error('该网址已重新收藏，无需恢复。');
      const bookmark = { ...this.lastRemoved };
      if (!next.folders.some((item) => item.id === bookmark.folderId)) bookmark.folderId = 'inbox';
      next.bookmarks.unshift(bookmark);
      await this.commit(validateLibrary(next));
      this.lastRemoved = null;
      return { library: this.snapshot(), selectedId: bookmark.id };
    });
  }
  importHtml(html, mode = 'merge') {
    return this.enqueue(async () => {
      if (!['merge', 'replace'].includes(mode)) throw new Error('请选择合并添加或完全覆盖。');
      const { parseBookmarks, mergeBookmarks } = require('./bookmark-html.cjs');
      const result = mergeBookmarks(
        mode === 'replace' ? emptyLibrary() : this.library,
        await parseBookmarks(html),
      );
      let recoveryFile;
      if (mode === 'replace' || result.imported || result.foldersAdded)
        recoveryFile = await this.commit(result.library, { preserveImport: mode === 'replace' });
      if (mode === 'replace') this.lastRemoved = null;
      return { ...result, mode, recoveryFile, library: this.snapshot() };
    });
  }
}
module.exports = { LibraryStore };
