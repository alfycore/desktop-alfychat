'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /** { FRONTEND_URL, APP_VERSION, IS_DEV, SOURCE, PARTITION } */
  getConfig: () => ipcRenderer.invoke('get-config'),

  // Liens externes
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Notifications OS
  showNotification: (opts) => ipcRenderer.invoke('show-notification', opts),

  // Contrôles fenêtre
  minimize: () => ipcRenderer.invoke('win-minimize'),
  maximize: () => ipcRenderer.invoke('win-maximize'),
  close: () => ipcRenderer.invoke('win-close'),
  isMaximized: () => ipcRenderer.invoke('win-is-maximized'),

  // Maximize / restore poussé par le main process
  onWinState: (callback) => {
    ipcRenderer.on('win-state', (_event, state) => callback(state));
  },

  // Auto-update (electron-updater)
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, info) => cb(info)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_, info) => cb(info)),
  onUpdateError: (cb) => ipcRenderer.on('update-error', (_, info) => cb(info)),
  installUpdate: () => ipcRenderer.invoke('install-update'),
});
