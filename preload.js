'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Config applicative
  getConfig: () => ipcRenderer.invoke('get-config'),

  // Liens externes
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Notifications OS
  showNotification: (opts) => ipcRenderer.invoke('show-notification', opts),
});
