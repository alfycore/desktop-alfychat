'use strict';

const { app, BrowserWindow, ipcMain, shell, Notification, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs   = require('fs');

// ── Config ────────────────────────────────────────────────────────────────────
const FRONTEND_URL = 'https://alfychat.app/';
const APP_VERSION  = require('./package.json').version;

let prefsPath;
let mainWindow;

// ── Window prefs (taille/position sauvegardées) ───────────────────────────────
function loadPrefs() {
  try { return JSON.parse(fs.readFileSync(prefsPath, 'utf8')); } catch (e) { return {}; }
}
function savePrefs(data) {
  try { fs.writeFileSync(prefsPath, JSON.stringify(data)); } catch (e) {}
}

// ── Création de la fenêtre ────────────────────────────────────────────────────
function createWindow() {
  const prefs = loadPrefs();

  mainWindow = new BrowserWindow({
    width:  prefs.width  || 1280,
    height: prefs.height || 800,
    x: prefs.x != null ? prefs.x : undefined,
    y: prefs.y != null ? prefs.y : undefined,
    minWidth:  940,
    minHeight: 600,
    titleBarStyle:   'hidden',
    titleBarOverlay: {
      color:       '#09090b',
      symbolColor: '#a1a1aa',
      height:      32,
    },
    backgroundColor: '#09090b',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      nodeIntegration:  false,
      contextIsolation: true,
      webviewTag:       true,   // nécessaire pour <webview> dans index.html
    },
    icon: path.join(__dirname, 'resources', 'icons', 'icon.png'),
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'resources', 'index.html'));

  if (prefs.maximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Notifier le renderer quand la fenêtre est maximisée/restaurée
  mainWindow.on('maximize',   () => mainWindow.webContents.send('win-state', { maximized: true  }));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('win-state', { maximized: false }));

  // Sauvegarder les préférences à la fermeture
  mainWindow.on('close', () => {
    const b = mainWindow.getBounds();
    savePrefs({ ...b, maximized: mainWindow.isMaximized() });
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Injecter le preload dans chaque <webview> attaché à cette fenêtre
  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences, _params) => {
    webPreferences.preload = path.join(__dirname, 'resources', 'js', 'webview-preload.js');
    webPreferences.contextIsolation = false;
  });
}

// ── IPC handlers ──────────────────────────────────────────────────────────────
ipcMain.handle('win-minimize',     () => { mainWindow?.minimize(); });
ipcMain.handle('win-maximize',     () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('win-close',        () => { mainWindow?.close(); });
ipcMain.handle('win-is-maximized', () => mainWindow?.isMaximized() ?? false);

ipcMain.handle('get-config', () => ({ FRONTEND_URL, APP_VERSION }));

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('open-external', (_, url) => {
  if (/^https?:\/\//.test(url)) return shell.openExternal(url);
});

ipcMain.handle('show-notification', (_, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title: title || 'AlfyChat', body: body || '' }).show();
  }
});

// ── Cycle de vie de l'app ─────────────────────────────────────────────────────
app.whenReady().then(() => {
  prefsPath = path.join(app.getPath('userData'), 'window-prefs.json');

  // Configurer la session persist:alfychat pour les cookies et permissions
  const alfychatSession = session.fromPartition('persist:alfychat');

  alfychatSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['notifications', 'media', 'microphone', 'camera',
                     'clipboard-read', 'clipboard-sanitized-write'];
    callback(allowed.includes(permission));
  });

  // S'assurer que les cookies SameSite=None sont bien stockés dans le contexte webview
  alfychatSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = Object.assign({}, details.responseHeaders);
    const setCookie = headers['set-cookie'] || headers['Set-Cookie'];
    if (setCookie) {
      const key = headers['set-cookie'] ? 'set-cookie' : 'Set-Cookie';
      headers[key] = setCookie.map(cookie => {
        // Ajouter Secure si SameSite=None sans attribut Secure
        if (/samesite=none/i.test(cookie) && !/;\s*secure/i.test(cookie)) {
          return cookie + '; Secure';
        }
        return cookie;
      });
    }
    callback({ responseHeaders: headers });
  });

  createWindow();

  // ── Auto-update via GitHub Releases ─────────────────────────────────────────
  if (app.isPackaged) {
    autoUpdater.autoDownload    = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
      mainWindow?.webContents.send('update-available', {
        version: info.version,
        releaseNotes: info.releaseNotes || '',
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      mainWindow?.webContents.send('update-downloaded', {
        version: info.version,
      });
    });

    autoUpdater.on('error', (err) => {
      // Ignorer silencieusement les erreurs réseau
      const msg = err && err.message ? err.message : String(err);
      if (!msg.includes('net::') && !msg.includes('ENOTFOUND')) {
        mainWindow?.webContents.send('update-error', { message: msg });
      }
    });

    // Vérifier après 5 secondes pour ne pas bloquer le démarrage
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
