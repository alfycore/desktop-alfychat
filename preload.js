'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  /** Boutons de fenêtre dessinés par l'OS : le frontend n'a pas à les refaire. */
  nativeControls: true,

  /** { FRONTEND_URL, APP_VERSION, IS_DEV, SOURCE, PARTITION } */
  getConfig: invoke('get-config'),

  openExternal: invoke('open-external'),
  /** { title, body, silent, urgent } — un clic ramène la fenêtre au premier plan. */
  showNotification: invoke('show-notification'),
  /** Pastille de non-lus : nombre (macOS / Linux), point rouge sur l'icône (Windows). */
  setBadge: invoke('set-badge'),
  /** Fait clignoter la barre des tâches si la fenêtre n'a pas le focus. */
  flash: invoke('flash'),
  /** { color, symbolColor } en #rrggbb : fond et symboles des boutons de fenêtre natifs. */
  setTitleBarColors: invoke('set-title-bar-colors'),

  minimize: invoke('win-minimize'),
  maximize: invoke('win-maximize'),
  close: invoke('win-close'),
  isMaximized: invoke('win-is-maximized'),
  /** Maximisation/restauration poussée par le processus principal. Renvoie la fonction de désinscription. */
  onWinState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('win-state', listener);
    return () => ipcRenderer.removeListener('win-state', listener);
  },

  installUpdate: invoke('install-update'),
  /** Page d'erreur locale : recharge le site. */
  retry: invoke('retry'),
});
