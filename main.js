'use strict';

const { app, BrowserWindow, ipcMain, shell, Notification, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

// ══════════════════════════════════════════════════════════════════════════════
// Cible du frontend — dev sur le serveur local, prod sur alfychat.app
//
// Ordre de priorité :
//   1. --url=<url>            (argument de ligne de commande, gagne toujours)
//   2. ALFYCHAT_URL=<url>     (variable d'environnement)
//   3. app.isPackaged         → prod si empaqueté, dev sinon
//
// `app.isPackaged` vaut false quand on lance `electron .` : le mode dev est
// donc automatique en local, sans rien avoir à régler.
// ══════════════════════════════════════════════════════════════════════════════

const DEV_URL = 'http://localhost:4000';
const PROD_URL = 'https://alfychat.app';

/** Normalise une URL en retirant le slash final. */
function normalise(url) {
  return String(url).replace(/\/+$/, '');
}

function resolveTarget() {
  const argUrl = process.argv.find((a) => a.startsWith('--url='));
  if (argUrl) {
    const url = normalise(argUrl.slice('--url='.length));
    return { url, isDev: !/^https:\/\/alfychat\.app/i.test(url), source: '--url' };
  }

  if (process.env.ALFYCHAT_URL) {
    const url = normalise(process.env.ALFYCHAT_URL);
    return { url, isDev: !/^https:\/\/alfychat\.app/i.test(url), source: 'ALFYCHAT_URL' };
  }

  // `--prod` force la cible de production même hors paquet (test du build).
  const forceProd = process.argv.includes('--prod');
  const isDev = !app.isPackaged && !forceProd;
  return { url: isDev ? DEV_URL : PROD_URL, isDev, source: isDev ? 'dev' : 'prod' };
}

const TARGET = resolveTarget();
const APP_VERSION = require('./package.json').version;

// Sessions séparées : les cookies de dev ne polluent jamais ceux de prod.
const PARTITION = TARGET.isDev ? 'persist:alfychat-dev' : 'persist:alfychat';

let prefsPath;
let mainWindow;

// ── Préférences de fenêtre (taille / position) ────────────────────────────────
function loadPrefs() {
  try {
    return JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
  } catch {
    return {};
  }
}

function savePrefs(data) {
  try {
    fs.writeFileSync(prefsPath, JSON.stringify(data));
  } catch {
    /* préférences non critiques */
  }
}

// ── Fenêtre ───────────────────────────────────────────────────────────────────
function createWindow() {
  const prefs = loadPrefs();

  mainWindow = new BrowserWindow({
    width: prefs.width || 1280,
    height: prefs.height || 800,
    x: prefs.x != null ? prefs.x : undefined,
    y: prefs.y != null ? prefs.y : undefined,
    minWidth: 940,
    minHeight: 600,
    title: TARGET.isDev ? 'AlfyChat — DEV' : 'AlfyChat',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#14141a',
      symbolColor: '#a5a3ad',
      height: 36,
    },
    backgroundColor: '#14141a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true, // le shell embarque le frontend dans un <webview>
    },
    icon: path.join(__dirname, 'resources', 'icons', 'icon.png'),
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'resources', 'index.html'));

  if (prefs.maximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (TARGET.isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.on('maximize', () => mainWindow.webContents.send('win-state', { maximized: true }));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('win-state', { maximized: false }));

  mainWindow.on('close', () => {
    const b = mainWindow.getBounds();
    savePrefs({ ...b, maximized: mainWindow.isMaximized() });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Preload injecté dans chaque <webview> rattaché à cette fenêtre.
  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences) => {
    webPreferences.preload = path.join(__dirname, 'resources', 'js', 'webview-preload.js');
    webPreferences.contextIsolation = false;
  });
}

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.handle('win-minimize', () => {
  mainWindow?.minimize();
});
ipcMain.handle('win-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('win-close', () => {
  mainWindow?.close();
});
ipcMain.handle('win-is-maximized', () => mainWindow?.isMaximized() ?? false);

ipcMain.handle('get-config', () => ({
  FRONTEND_URL: TARGET.url,
  APP_VERSION,
  IS_DEV: TARGET.isDev,
  SOURCE: TARGET.source,
  PARTITION,
}));

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

// ── Cycle de vie ──────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  prefsPath = path.join(app.getPath('userData'), `window-prefs${TARGET.isDev ? '-dev' : ''}.json`);

  console.log(`[AlfyChat] mode=${TARGET.source} · cible=${TARGET.url} · session=${PARTITION}`);

  const frontSession = session.fromPartition(PARTITION);

  frontSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = [
      'notifications',
      'media',
      'microphone',
      'camera',
      'clipboard-read',
      'clipboard-sanitized-write',
    ];
    callback(allowed.includes(permission));
  });

  // En prod, forcer `Secure` sur les cookies SameSite=None (exigence Chromium).
  // Inutile en dev : le serveur local est en http, on ne touche à rien.
  if (!TARGET.isDev) {
    frontSession.webRequest.onHeadersReceived((details, callback) => {
      const headers = Object.assign({}, details.responseHeaders);
      const setCookie = headers['set-cookie'] || headers['Set-Cookie'];
      if (setCookie) {
        const key = headers['set-cookie'] ? 'set-cookie' : 'Set-Cookie';
        headers[key] = setCookie.map((cookie) =>
          /samesite=none/i.test(cookie) && !/;\s*secure/i.test(cookie) ? `${cookie}; Secure` : cookie,
        );
      }
      callback({ responseHeaders: headers });
    });
  }

  createWindow();

  // ── Auto-update — uniquement sur une app empaquetée ─────────────────────────
  if (app.isPackaged) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
      mainWindow?.webContents.send('update-available', {
        version: info.version,
        releaseNotes: info.releaseNotes || '',
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      mainWindow?.webContents.send('update-downloaded', { version: info.version });
    });

    autoUpdater.on('error', (err) => {
      const msg = err && err.message ? err.message : String(err);
      if (!msg.includes('net::') && !msg.includes('ENOTFOUND')) {
        mainWindow?.webContents.send('update-error', { message: msg });
      }
    });

    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
