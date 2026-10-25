'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (command, payload) => {
  const result = await ipcRenderer.invoke('arcwell', command, payload);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
contextBridge.exposeInMainWorld(
  'arcwell',
  Object.freeze({
    load: () => invoke('load'),
    change: (action, payload) => invoke('change', { action, payload }),
    undo: () => invoke('undo'),
    draft: (dirty) => invoke('draft', { dirty }),
    open: (id) => invoke('open', { id }),
    openUrl: (url) => invoke('open-url', { url }),
    icon: (url, refresh) => invoke('icon', { url, refresh }),
    export: () => invoke('export'),
    importHtml: (mode = 'merge') => invoke('import-html', { mode }),
    chooseBackup: () => invoke('choose-backup'),
    backupStatus: () => invoke('backup-status'),
    retryBackup: () => invoke('retry-backup'),
    updateStatus: () => invoke('update-status'),
    checkUpdate: () => invoke('update-check'),
    downloadUpdate: () => invoke('update-download'),
    cancelUpdate: () => invoke('update-cancel'),
    installUpdate: () => invoke('update-install'),
    updateReleases: () => invoke('update-releases'),
    onUpdateResult: (callback) => {
      const listener = (_event, result) => callback(result);
      ipcRenderer.on('arcwell-update-result', listener);
      return () => ipcRenderer.removeListener('arcwell-update-result', listener);
    },
    window: (action) => invoke('window', { action }),
  }),
);
