'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { serializeBookmarks } = require('./bookmark-html.cjs');
async function writeAtomic(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    const target = await fs.lstat(file);
    if (!target.isFile() || target.isSymbolicLink()) throw new Error('目标不是普通文件。');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, file);
  } catch (error) {
    try {
      await fs.unlink(temporary);
    } catch (cleanup) {
      if (cleanup.code !== 'ENOENT') console.error('HTML temporary cleanup failed.');
    }
    throw error;
  }
}
class HtmlBackup {
  constructor(applicationDirectory, settingsDirectory) {
    this.applicationFile = path.join(applicationDirectory, '网址备份.html');
    this.settingsFile = path.join(settingsDirectory, 'backup-settings.json');
    this.customDirectory = null;
    this.queue = Promise.resolve();
    this.lastStatus = null;
  }
  async load() {
    try {
      const stat = await fs.lstat(this.settingsFile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536)
        throw new Error('备份路径设置文件无效。');
      const settings = JSON.parse(await fs.readFile(this.settingsFile, 'utf8'));
      if (
        settings.version !== 1 ||
        (settings.customDirectory !== null &&
          (typeof settings.customDirectory !== 'string' ||
            !path.isAbsolute(settings.customDirectory)))
      )
        throw new Error('备份路径设置文件无效。');
      this.customDirectory = settings.customDirectory;
    } catch (error) {
      if (error.code !== 'ENOENT')
        this.settingsWarning = '备份路径设置无法读取，请重新选择目录；现有收藏不受影响。';
    }
  }
  status() {
    return {
      applicationFile: this.applicationFile,
      customFile: this.customDirectory ? path.join(this.customDirectory, '网址备份.html') : null,
      ...this.lastStatus,
      settingsWarning: this.settingsWarning,
    };
  }
  enqueue(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }
  sync(library) {
    const snapshot = structuredClone(library);
    return this.enqueue(() => this.write(snapshot));
  }
  async write(library) {
    const html = serializeBookmarks(library),
      failures = [],
      targets = [['应用目录', this.applicationFile]];
    if (this.customDirectory)
      targets.push(['自定义目录', path.join(this.customDirectory, '网址备份.html')]);
    for (const [name, file] of targets) {
      try {
        await writeAtomic(file, html);
      } catch {
        failures.push(`${name}的 HTML 备份未更新，请检查目录权限、文件占用或磁盘空间。`);
      }
    }
    this.lastStatus = {
      failures,
      configured: !!this.customDirectory,
      savedAt: failures.length ? null : new Date().toISOString(),
      warning: failures.join(' '),
    };
    return this.status();
  }
  choose(directory, library) {
    return this.enqueue(async () => {
      const resolved = await fs.realpath(directory);
      if (!(await fs.stat(resolved)).isDirectory()) throw new Error('请选择文件夹作为备份目录。');
      await fs.mkdir(path.dirname(this.applicationFile), { recursive: true });
      const applicationDirectory = await fs.realpath(path.dirname(this.applicationFile));
      if (resolved.toLowerCase() === applicationDirectory.toLowerCase())
        throw new Error('第二份备份请选择应用目录以外的文件夹。');
      await writeAtomic(path.join(resolved, '网址备份.html'), serializeBookmarks(library));
      await writeAtomic(
        this.settingsFile,
        JSON.stringify({ version: 1, customDirectory: resolved }, null, 2),
      );
      this.customDirectory = resolved;
      this.settingsWarning = null;
      return this.write(library);
    });
  }
  exportTo(file) {
    return this.enqueue(async () => {
      const stat = await fs.lstat(this.applicationFile).catch(() => {
        throw new Error('应用目录备份不存在，请先点击“立即更新备份”。');
      });
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error('应用目录备份不是普通文件，无法导出。');
      if (path.resolve(file).toLowerCase() === path.resolve(this.applicationFile).toLowerCase())
        return true;
      await writeAtomic(file, await fs.readFile(this.applicationFile, 'utf8'));
      return true;
    });
  }
}
module.exports = { HtmlBackup, writeAtomic };
