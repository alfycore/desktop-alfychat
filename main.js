'use strict';

const { app, BrowserWindow, ipcMain, shell, Notification } = require('electron');
const path = require('path');
const fs   = require('fs');

// ── Config ────────────────────────────────────────────────────────────────────
const FRONTEND_URL = 'https://alfychat.app/';
const APP_VERSION  = '1.0.0';
const UPDATE_URL   = 'https://update.alfychat.com/desktop/manifest.json';

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
}

// ── IPC handlers ──────────────────────────────────────────────────────────────
ipcMain.handle('win-minimize',     () => { mainWindow?.minimize(); });
ipcMain.handle('win-maximize',     () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('win-close',        () => { mainWindow?.close(); });
ipcMain.handle('win-is-maximized', () => mainWindow?.isMaximized() ?? false);

ipcMain.handle('get-config', () => ({ FRONTEND_URL, APP_VERSION, UPDATE_URL }));

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
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
