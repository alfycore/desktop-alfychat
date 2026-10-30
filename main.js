'use strict';

// Cache de compilation V8 : les lancements suivants sautent la compilation de
// ce fichier et de ses dépendances.
try {
  require('node:module').enableCompileCache?.();
} catch {
  /* optionnel */
}

const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  desktopCapturer,
  dialog,
  ipcMain,
  screen,
  session,
  shell,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// ══════════════════════════════════════════════════════════════════════════════
// Cible du frontend — dev sur le serveur local, prod sur alfychat.app
//
// Ordre de priorité :
//   1. --url=<url>            (argument de ligne de commande, gagne toujours)
//   2. ALFYCHAT_URL=<url>     (variable d'environnement)
//   3. app.isPackaged         → prod si empaqueté, dev sinon
//
// L'application charge le site DIRECTEMENT dans la fenêtre : pas de shell, pas
// de <webview> (un process de rendu en moins, un seul bandeau de titre).
// ══════════════════════════════════════════════════════════════════════════════

const DEV_URL = 'http://localhost:4000';
const PROD_URL = 'https://alfychat.app';
const START_PATH = '/channels';

const BG = '#14141a';
const SYMBOL = '#a5a3ad';
const TITLEBAR_HEIGHT = 32; // = AppTitleBar côté frontend
const MIN_WIDTH = 940;
const MIN_HEIGHT = 600;

const RESOURCES = path.join(__dirname, 'resources');
const ERROR_PAGE = path.join(RESOURCES, 'error.html');
const ERROR_PAGE_URL = pathToFileURL(ERROR_PAGE).href;
const ICON = path.join(RESOURCES, 'icons', 'icon.png');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';

function resolveTarget() {
  const fromArg = process.argv.find((a) => a.startsWith('--url='));
  const explicit = fromArg ? fromArg.slice('--url='.length) : process.env.ALFYCHAT_URL;
  if (explicit) {
    const url = explicit.replace(/\/+$/, '');
    return {
      url,
      isDev: !/^https:\/\/alfychat\.app$/i.test(url),
      source: fromArg ? '--url' : 'ALFYCHAT_URL',
    };
  }

  // `--prod` force la cible de production même hors paquet (test du build).
  const isDev = !app.isPackaged && !process.argv.includes('--prod');
  return { url: isDev ? DEV_URL : PROD_URL, isDev, source: isDev ? 'dev' : 'prod' };
}

const TARGET = resolveTarget();
const TARGET_HOST = new URL(TARGET.url).host;
// Sessions séparées : les cookies de dev ne polluent jamais ceux de prod.
const PARTITION = TARGET.isDev ? 'persist:alfychat-dev' : 'persist:alfychat';

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null;
let prefsPath = '';

// ── Instance unique ───────────────────────────────────────────────────────────
// Sans verrou, un second double-clic ouvrirait une deuxième fenêtre, une
// deuxième session socket et un deuxième flux vocal.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(start);
}

// ── Préférences de fenêtre ────────────────────────────────────────────────────
function loadPrefs() {
  try {
    return JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
  } catch {
    return {};
  }
}

function currentPrefs() {
  return { ...mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized() };
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    fs.promises.writeFile(prefsPath, JSON.stringify(currentPrefs())).catch(() => {});
  }, 500);
}

/** Taille/position mémorisées, ignorées si l'écran d'origine a disparu. */
function restoredBounds(prefs) {
  const bounds = {
    width: Math.max(Number(prefs.width) || 1280, MIN_WIDTH),
    height: Math.max(Number(prefs.height) || 800, MIN_HEIGHT),
  };
  const { x, y } = prefs;
  if (Number.isInteger(x) && Number.isInteger(y)) {
    const onScreen = screen.getAllDisplays().some(({ workArea: a }) => {
      return x >= a.x - 8 && x < a.x + a.width - 100 && y >= a.y - 8 && y < a.y + a.height - 100;
    });
    if (onScreen) {
      bounds.x = x;
      bounds.y = y;
    }
  }
  return bounds;
}

// ── Navigation ────────────────────────────────────────────────────────────────
function isHttp(url) {
  return /^https?:\/\//i.test(url);
}

function openExternal(url) {
  if (isHttp(url)) shell.openExternal(url).catch(() => {});
}

function isTargetUrl(url) {
  try {
    return new URL(url).host === TARGET_HOST;
  } catch {
    return false;
  }
}

function load() {
  return mainWindow.loadURL(TARGET.url + START_PATH).catch(() => {
    /* did-fail-load affiche déjà la page d'erreur */
  });
}

function showError(detail) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow
    .loadFile(ERROR_PAGE, {
      query: { url: TARGET.url, dev: TARGET.isDev ? '1' : '0', detail },
    })
    .catch(() => {});
}

/** Les IPC ne sont acceptées que de notre site et de la page d'erreur locale. */
function isTrusted(event) {
  const url = event.senderFrame?.url ?? '';
  return isTargetUrl(url) || url.startsWith(ERROR_PAGE_URL);
}

function attachNavigationGuards(wc) {
  // window.open / target=_blank : jamais de seconde fenêtre Electron.
  wc.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  // Tout ce qui sort de notre hôte part dans le navigateur système.
  wc.on('will-navigate', (event, url) => {
    if (url.startsWith(ERROR_PAGE_URL) || isTargetUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  });

  // Menu contextuel natif (Electron n'en fournit aucun) : coller dans le
  // composeur, copier une sélection, corriger une faute. Il ne s'ouvre que si
  // la page n'a pas déjà géré le clic droit elle-même.
  wc.on('context-menu', (_event, params) => {
    const items = [];
    if (params.isEditable) {
      for (const word of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: word, click: () => wc.replaceMisspelling(word) });
      }
      if (items.length) items.push({ type: 'separator' });
      items.push(
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      );
    } else if (params.selectionText) {
      items.push({ role: 'copy' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup();
  });

  // Process de rendu tombé : on recharge, mais pas en boucle.
  const crashes = [];
  wc.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    const now = Date.now();
    crashes.push(now);
    while (crashes.length && now - crashes[0] > 60_000) crashes.shift();
    if (crashes.length > 3) showError(`Le moteur de rendu s'est arrêté (${details.reason}).`);
    else load();
  });
}

// ── Fenêtre ───────────────────────────────────────────────────────────────────
function createWindow() {
  const prefs = loadPrefs();

  mainWindow = new BrowserWindow({
    ...restoredBounds(prefs),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: TARGET.isDev ? 'AlfyChat — DEV' : 'AlfyChat',
    icon: ICON,
    backgroundColor: BG,
    show: false,
    // Pas de barre système : le frontend dessine la sienne (AppTitleBar). Les
    // boutons de fenêtre restent natifs (boutons Windows 11 + snap layouts,
    // feux tricolores macOS) par-dessus.
    titleBarStyle: 'hidden',
    titleBarOverlay: IS_MAC ? undefined : { color: BG, symbolColor: SYMBOL, height: TITLEBAR_HEIGHT },
    trafficLightPosition: IS_MAC ? { x: 14, y: 10 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      partition: PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Les outils de développement n'existent pas dans l'app distribuée.
      devTools: !app.isPackaged,
    },
  });

  // Affichée tout de suite (fond sombre, pas d'éclair blanc) plutôt qu'après le
  // premier rendu : le site distant peut mettre plusieurs secondes à répondre.
  if (prefs.maximized) mainWindow.maximize();
  mainWindow.show();

  const wc = mainWindow.webContents;
  attachNavigationGuards(wc);

  wc.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    // -3 = ERR_ABORTED : navigation remplacée volontairement, sans intérêt.
    if (!isMainFrame || code === -3) return;
    showError(`Code ${code} — ${description}\nURL : ${url}`);
  });

  const pushState = () => wc.send('win-state', { maximized: mainWindow.isMaximized() });
  mainWindow.on('maximize', pushState);
  mainWindow.on('unmaximize', pushState);
  mainWindow.on('resize', scheduleSave);
  mainWindow.on('move', scheduleSave);
  mainWindow.on('focus', () => mainWindow.flashFrame(false));

  mainWindow.on('close', () => {
    clearTimeout(saveTimer);
    try {
      fs.writeFileSync(prefsPath, JSON.stringify(currentPrefs()));
    } catch {
      /* préférences non critiques */
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (!app.isPackaged && process.argv.includes('--devtools')) {
    wc.openDevTools({ mode: 'detach' });
  }

  load();
}

// ── Session : permissions, partage d'écran, cookies ───────────────────────────
const ALLOWED_PERMISSIONS = new Set([
  'notifications',
  'media',
  'display-capture',
  'fullscreen',
  'speaker-selection',
  'clipboard-read',
  'clipboard-sanitized-write',
]);

/** Sélecteur de source pour getDisplayMedia (Electron n'en fournit pas). */
async function pickDisplaySource(request, callback) {
  let sources;
  try {
    sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
  } catch {
    callback({});
    return;
  }
  if (!sources.length) {
    callback({});
    return;
  }

  let settled = false;
  const settle = (stream) => {
    if (settled) return;
    settled = true;
    callback(stream);
  };

  const menu = Menu.buildFromTemplate(
    sources.map((source) => ({
      label: source.name.slice(0, 60),
      click: () =>
        settle({
          video: source,
          // Le son système n'est capturable que sous Windows.
          ...(request.audioRequested && IS_WIN ? { audio: 'loopback' } : {}),
        }),
    })),
  );
  // Le callback de fermeture peut passer avant le clic sur certaines
  // plateformes : on laisse au clic le temps d'arriver avant de refuser.
  menu.popup({ window: mainWindow ?? undefined, callback: () => setTimeout(() => settle({}), 100) });
}

function configureSession() {
  const ses = session.fromPartition(PARTITION);

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isTargetUrl(details.requestingUrl || wc.getURL()));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.has(permission) && isTargetUrl(requestingOrigin);
  });
  ses.setDisplayMediaRequestHandler(pickDisplaySource, { useSystemPicker: true });

  // En prod, forcer `Secure` sur les cookies SameSite=None (exigence Chromium).
  // Inutile en dev : le serveur local est en http.
  if (!TARGET.isDev) {
    ses.webRequest.onHeadersReceived({ urls: ['https://*/*'] }, (details, callback) => {
      const headers = details.responseHeaders;
      const key = headers && (headers['set-cookie'] ? 'set-cookie' : headers['Set-Cookie'] ? 'Set-Cookie' : null);
      if (!key) {
        callback({});
        return;
      }
      callback({
        responseHeaders: {
          ...headers,
          [key]: headers[key].map((cookie) =>
            /samesite=none/i.test(cookie) && !/;\s*secure/i.test(cookie) ? `${cookie}; Secure` : cookie,
          ),
        },
      });
    });
  }
}

// ── IPC ───────────────────────────────────────────────────────────────────────
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => (isTrusted(event) ? fn(...args) : undefined));
}

function registerIpc() {
  handle('win-minimize', () => mainWindow?.minimize());
  handle('win-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  handle('win-close', () => mainWindow?.close());
  handle('win-is-maximized', () => mainWindow?.isMaximized() ?? false);

  handle('get-config', () => ({
    FRONTEND_URL: TARGET.url,
    APP_VERSION: app.getVersion(),
    IS_DEV: TARGET.isDev,
    SOURCE: TARGET.source,
    PARTITION,
  }));

  handle('open-external', (url) => openExternal(String(url)));
  handle('retry', () => load());

  handle('show-notification', (opts) => {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: opts?.title || 'AlfyChat', body: opts?.body || '', icon: ICON });
    n.on('click', () => {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    });
    n.show();
  });

  // Pastille de non-lus (macOS / Linux) et clignotement de la barre des tâches.
  handle('set-badge', (count) => app.setBadgeCount(Math.max(0, Number(count) || 0)));
  handle('flash', () => {
    if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true);
  });

  handle('install-update', () => require('electron-updater').autoUpdater.quitAndInstall(false, true));
}

// ── Mises à jour ──────────────────────────────────────────────────────────────
// electron-updater n'est chargé qu'ici, 5 s après le démarrage : ce module
// pèse lourd et n'a rien à faire sur le chemin critique du premier affichage.
function scheduleUpdateCheck() {
  if (!app.isPackaged) return;
  setTimeout(() => {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-downloaded', async (info) => {
      if (!mainWindow) return;
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'AlfyChat',
        message: `La version ${info.version} est prête.`,
        detail: 'Redémarrer maintenant pour l’installer, ou elle le sera à la fermeture de l’application.',
        buttons: ['Redémarrer', 'Plus tard'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) autoUpdater.quitAndInstall(false, true);
    });
    autoUpdater.on('error', () => {
      /* silencieux : l'app reste utilisable */
    });
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);
}

// ── Cycle de vie ──────────────────────────────────────────────────────────────
function start() {
  if (IS_WIN) app.setAppUserModelId('com.alfychat.desktop'); // notifications nommées « AlfyChat »
  prefsPath = path.join(app.getPath('userData'), `window-prefs${TARGET.isDev ? '-dev' : ''}.json`);

  console.log(`[AlfyChat] mode=${TARGET.source} · cible=${TARGET.url} · session=${PARTITION}`);

  // Sans barre de menu, les raccourcis par défaut (Ctrl+R, Ctrl+Shift+I…)
  // disparaissent de la version distribuée. macOS garde son menu : il porte
  // couper/copier/coller.
  if (app.isPackaged && !IS_MAC) Menu.setApplicationMenu(null);

  configureSession();
  registerIpc();
  createWindow();
  scheduleUpdateCheck();
}

app.on('window-all-closed', () => {
  if (!IS_MAC) app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && app.isReady()) createWindow();
});
