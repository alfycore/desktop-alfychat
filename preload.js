'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Config applicative
  getConfig: () => ipcRenderer.invoke('get-config'),

  // Liens externes
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Notifications OS
  showNotification: (opts) => ipcRenderer.invoke('show-notification', opts),

  // Contrôles fenêtre
  minimize:    () => ipcRenderer.invoke('win-minimize'),
  maximize:    () => ipcRenderer.invoke('win-maximize'),
  close:       () => ipcRenderer.invoke('win-close'),
  isMaximized: () => ipcRenderer.invoke('win-is-maximized'),

  // Événement maximize/restore envoyé par le main process
  onWinState: (callback) => {
    ipcRenderer.on('win-state', (_event, state) => callback(state));
  },
});
