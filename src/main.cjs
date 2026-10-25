'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, net, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { LibraryStore } = require('./store.cjs');
const { normalizeUrl, findBookmark } = require('./domain.cjs');
const { IconService } = require('./icons.cjs');
const { HtmlBackup } = require('./html-backup.cjs');
const { MAX_HTML_BYTES, parseBookmarks } = require('./bookmark-html.cjs');
const { UpdateService, RELEASES } = require('./updates.cjs');
const { updateFetch } = require('./update-transport.cjs');
const { spawn } = require('node:child_process');
const { resultFromArguments, takeUpdateResult } = require('./update-result.cjs');
app.setName('Arcwell');
const testMode = process.argv.includes('--arcwell-test');
if (testMode) app.setPath('userData', path.resolve(process.env.ARCWELL_TEST_DATA));
let window,
  store,
  icons,
  backups,
  updates,
  installingUpdate = false,
  closing = false,
  hasDraft = false;
let pendingUpdateResult = null;
let lastUpdateResultKey = null;
function deliverUpdateResult(result) {
  if (!result) return;
  const key = `${result.status}:${result.version}`;
  if (key === lastUpdateResultKey) return;
  lastUpdateResultKey = key;
  pendingUpdateResult = result;
  if (window && !window.isDestroyed() && !window.webContents.isLoadingMainFrame()) {
    window.webContents.send('arcwell-update-result', result);
    pendingUpdateResult = null;
  }
}
const entry = path.join(__dirname, 'ui', 'index.html');
const entryUrl = pathToFileURL(entry).href;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, args) => {
    const result = resultFromArguments(args, app.getVersion());
    if (result) {
      takeUpdateResult(app.getPath('userData'), args, app.getVersion()).then(deliverUpdateResult);
    }
    if (window && !testMode) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      pendingUpdateResult = await takeUpdateResult(
        app.getPath('userData'),
        process.argv,
        app.getVersion(),
      );
      store = new LibraryStore(path.join(app.getPath('userData'), 'data'));
      icons = new IconService(
        path.join(app.getPath('userData'), 'cache', 'icons'),
        (url, options) => net.fetch(url, options),
        async (bytes) => {
          let image = nativeImage.createFromBuffer(bytes);
          if (
            image.isEmpty() &&
            bytes.length >= 22 &&
            bytes.readUInt32LE(0) === 65536 &&
            bytes.readUInt16LE(4) <= 256
          ) {
            const temporary = path.join(
              app.getPath('userData'),
              'cache',
              'icons',
              `decode-${randomUUID()}.ico`,
            );
            try {
              await fs.writeFile(temporary, bytes);
              image = nativeImage.createFromPath(temporary);
            } finally {
              await fs.unlink(temporary);
            }
          }
          if (image.isEmpty()) return null;
          return image.resize({ width: 64, height: 64, quality: 'good' }).toPNG();
        },
      );
      try {
        await store.load();
      } catch (error) {
        dialog.showErrorBox('Arcwell · 数据读取失败', error.message);
        app.quit();
        return;
      }
      backups = new HtmlBackup(
        testMode
          ? path.join(app.getPath('userData'), 'application')
          : app.isPackaged
            ? path.dirname(app.getPath('exe'))
            : path.join(__dirname, '..'),
        app.getPath('userData'),
      );
      await backups.load();
      await backups.sync(store.snapshot());
      updates = new UpdateService({
        currentVersion: app.getVersion(),
        directory: path.join(app.getPath('userData'), 'cache', 'updates'),
        fetch: updateFetch(net),
        publicKey: await fs.readFile(path.join(__dirname, 'update-public.pem'), 'utf8'),
      });
      window = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 980,
        minHeight: 680,
        frame: false,
        show: !testMode,
        backgroundColor: '#fcfcfb',
        title: 'Arcwell',
        icon: path.join(__dirname, '../assets/icon.ico'),
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          spellcheck: false,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => event.preventDefault());
      window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      ipcMain.handle('arcwell', async (event, command, payload) => {
        try {
          if (
            event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame ||
            event.senderFrame.url !== entryUrl
          )
            throw new Error('请求来源不受支持。');
          let value;
          if (installingUpdate && command.startsWith('update-'))
            throw new Error('更新器正在启动，请稍候。');
          switch (command) {
            case 'update-status':
              value = updates.status();
              break;
            case 'update-check':
              updates.check();
              value = updates.status();
              break;
            case 'update-download':
              updates.download();
              value = updates.status();
              break;
            case 'update-cancel':
              value = updates.cancel();
              break;
            case 'update-releases':
              if (testMode) app.emit('arcwell-test-open', RELEASES);
              else await shell.openExternal(RELEASES);
              value = true;
              break;
            case 'update-install': {
              if (
                !testMode &&
                (!app.isPackaged || process.platform !== 'win32' || process.arch !== 'x64')
              )
                throw new Error('请在 Windows x64 安装版中更新。');
              if (hasDraft) throw new Error('请先保存或放弃正在编辑的内容，再安装更新。');
              installingUpdate = true;
              lastUpdateResultKey = null;
              try {
                const file = await updates.installFile();
                await store.queue;
                await backups.queue;
                await updates.installFile();
                const target = path.dirname(app.getPath('exe'));
                if (testMode) app.emit('arcwell-test-update', { file, target, silent: true });
                else
                  await new Promise((resolve, reject) => {
                    // NSIS /D must be the final, unquoted argument; it consumes
                    // the rest of the raw command line, including spaces.
                    const child = spawn(file, ['/S', `/D=${target}`], {
                      detached: true,
                      stdio: 'ignore',
                      cwd: path.dirname(file),
                      windowsHide: true,
                      windowsVerbatimArguments: true,
                    });
                    child.once('error', reject);
                    child.once('exit', (code) => {
                      if (code !== 0 && window && !window.isDestroyed() && !closing)
                        deliverUpdateResult({
                          status: code === 4 ? 'rollback-failed' : 'failed',
                          version: updates.status().version,
                        });
                    });
                    child.once('spawn', () => {
                      child.unref();
                      resolve();
                    });
                  });
                value = true;
              } finally {
                installingUpdate = false;
              }
              break;
            }
            case 'load':
              value = {
                library: store.snapshot(),
                warning: store.warning,
                backup: backups.status(),
                updateResult: pendingUpdateResult,
              };
              pendingUpdateResult = null;
              break;
            case 'change':
              value = await store.change(payload.action, payload.payload);
              value.backup = await backups.sync(value.library);
              break;
            case 'undo':
              value = await store.undo();
              value.backup = await backups.sync(value.library);
              break;
            case 'backup-status':
              value = backups.status();
              break;
            case 'retry-backup':
              value = await backups.sync(store.snapshot());
              break;
            case 'choose-backup': {
              const result = await dialog.showOpenDialog(window, {
                title: '选择第二份备份目录（自动覆盖网址备份.html）',
                properties: ['openDirectory', 'createDirectory'],
              });
              value = result.canceled
                ? null
                : await backups.choose(result.filePaths[0], store.snapshot());
              break;
            }
            case 'import-html': {
              const mode = payload?.mode;
              if (!['merge', 'replace'].includes(mode)) throw new Error('请选择有效的导入方式。');
              const result = await dialog.showOpenDialog(window, {
                title:
                  mode === 'replace' ? '选择完全覆盖用的 HTML 收藏' : '选择合并添加的 HTML 收藏',
                properties: ['openFile'],
                filters: [{ name: 'HTML 收藏', extensions: ['html', 'htm'] }],
              });
              if (result.canceled) {
                value = null;
                break;
              }
              const selectedFile = result.filePaths[0],
                stat = await fs.lstat(selectedFile);
              if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_HTML_BYTES)
                throw new Error('请选择不超过 20 MB 的普通 HTML 收藏文件。');
              const html = await fs.readFile(selectedFile, 'utf8');
              if (mode === 'replace') {
                const preview = await parseBookmarks(html);
                const answer = await dialog.showMessageBox(window, {
                  type: 'warning',
                  title: '完全覆盖收藏',
                  message: '确认用此 HTML 文件完全替换当前收藏？',
                  detail: `当前有 ${store.library.bookmarks.length} 条收藏。文件中有 ${preview.bookmarks.length} 条链接${preview.skipped ? `，另有 ${preview.skipped} 条无效链接会跳过` : ''}。原有收藏和文件夹将被替换，不保留文件中没有的内容；原有备注和星标也会以文件中的内容为准。\n\n覆盖前会单独保存原收藏的恢复备份；日常两份 HTML 备份会同步更新。`,
                  buttons: ['取消', '完全覆盖'],
                  defaultId: 0,
                  cancelId: 0,
                  noLink: true,
                });
                if (answer.response !== 1) {
                  value = null;
                  break;
                }
              }
              value = await store.importHtml(html, mode);
              value.backup = await backups.sync(value.library);
              break;
            }
            case 'draft':
              hasDraft = payload.dirty === true;
              value = true;
              break;
            case 'open': {
              const url = normalizeUrl(findBookmark(store.library, payload.id).url);
              if (testMode) app.emit('arcwell-test-open', url);
              else await shell.openExternal(url);
              value = true;
              break;
            }
            case 'open-url': {
              const url = normalizeUrl(payload.url);
              if (testMode) app.emit('arcwell-test-open', url);
              else await shell.openExternal(url);
              value = true;
              break;
            }
            case 'icon': {
              const url = normalizeUrl(payload.url);
              if (
                !store.library.bookmarks.some(
                  (item) => new URL(item.url).origin === new URL(url).origin,
                )
              )
                throw new Error('只能读取已收藏网站的图标。');
              value = await icons.load(url, payload.refresh === true);
              break;
            }
            case 'export': {
              const result = await dialog.showSaveDialog(window, {
                title: '导出收藏备份',
                defaultPath: '网址备份.html',
                filters: [{ name: 'HTML 收藏备份', extensions: ['html'] }],
              });
              if (result.canceled) {
                value = false;
                break;
              }
              await store.queue;
              value = await backups.exportTo(result.filePath);
              break;
            }
            case 'window':
              if (payload.action === 'minimize') window.minimize();
              else if (payload.action === 'maximize')
                window.isMaximized() ? window.unmaximize() : window.maximize();
              else if (payload.action === 'close') window.close();
              else throw new Error('窗口操作无效。');
              value = true;
              break;
            default:
              throw new Error('请求不受支持。');
          }
          return { ok: true, value };
        } catch (error) {
          const message = error.code
            ? '操作未完成，请检查文件权限和可用磁盘空间。原收藏数据未被清空。'
            : error.message;
          return { ok: false, error: message };
        }
      });
      window.on('close', async (event) => {
        if (closing) return;
        event.preventDefault();
        closing = true;
        if (hasDraft && !testMode) {
          const answer = await dialog.showMessageBox(window, {
            type: 'question',
            title: 'Arcwell',
            message: '有尚未保存的修改，仍要退出吗？',
            detail: '退出后未保存的名称、网址或备注修改会丢失。',
            buttons: ['继续编辑', '放弃并退出'],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          if (answer.response === 0) {
            closing = false;
            return;
          }
        }
        icons.dispose();
        updates.cancel();
        Promise.all([store.queue.then(() => backups.queue), updates.dispose()]).finally(() =>
          window.destroy(),
        );
      });
      await window.loadFile(entry);
    })
    .catch((error) => {
      dialog.showErrorBox('Arcwell · 启动失败', '程序无法启动，请重新运行或检查安装文件。');
      console.error(error.message);
      app.quit();
    });
  app.on('window-all-closed', () => app.quit());
}
