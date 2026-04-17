'use strict';
/**
 * Preload injecté dans le <webview> alfychat via will-attach-webview.
 * Rôle : bridger les window.postMessage() du frontend → ipcRenderer.sendToHost()
 * afin que app.js puisse les recevoir via l'événement 'ipc-message'.
 */

const { ipcRenderer } = require('electron');

// ── Bridge postMessage ─────────────────────────────────────────────────────────
window.addEventListener('message', function (evt) {
  try {
    var msg = (typeof evt.data === 'object') ? evt.data : JSON.parse(evt.data);
    if (msg && msg.type) {
      ipcRenderer.sendToHost('app-message', msg);
    }
  } catch (_) {}
});

// ── API exposée au frontend pour détecter le contexte desktop ─────────────────
window.__alfychatDesktop__ = {
  isDesktop:  true,
  platform:   process.platform,
  /** Envoyer un message au shell Electron */
  sendToHost: function (type, payload) {
    ipcRenderer.sendToHost('app-message', Object.assign({ type: type }, payload || {}));
  },
};
