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
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
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

// Couleurs du bandeau avant que le frontend ne pousse celles de son thème
// (`set-title-bar-colors`) ; les dernières reçues sont mémorisées et servent
// au lancement suivant (pas d'éclair sombre sur un thème clair).
const DEFAULT_COLORS = { color: '#14141a', symbolColor: '#a5a3ad' };
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const TITLEBAR_HEIGHT = 32; // = AppTitleBar côté frontend
const MIN_WIDTH = 940;
const MIN_HEIGHT = 600;
// Paliers de zoom : ceux de Chrome.
const ZOOM_STEPS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const UPDATE_INTERVAL = 6 * 60 * 60 * 1000;

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
const TARGET_ORIGIN = new URL(TARGET.url).origin;
// Sessions séparées : les cookies de dev ne polluent jamais ceux de prod.
const PARTITION = TARGET.isDev ? 'persist:alfychat-dev' : 'persist:alfychat';

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null;
/** Vrai une fois la sortie demandée (⌘Q, mise à jour) : macOS cesse alors de masquer la fenêtre. */
let quitting = false;

// ── Instance unique ───────────────────────────────────────────────────────────
// Sans verrou, un second double-clic ouvrirait une deuxième fenêtre, une
// deuxième session socket et un deuxième flux vocal.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(start);
}

// ── Préférences ───────────────────────────────────────────────────────────────
// Position/taille, zoom et couleurs du thème, dans un seul fichier.
let prefsPath = '';
let prefs = {};

function loadPrefs() {
  try {
    const data = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function serializePrefs() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    Object.assign(prefs, mainWindow.getNormalBounds(), { maximized: mainWindow.isMaximized() });
  }
  return JSON.stringify(prefs);
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.promises.writeFile(prefsPath, serializePrefs()).catch(() => {});
  }, 500);
}

function saveNow() {
  clearTimeout(saveTimer);
  try {
    fs.writeFileSync(prefsPath, serializePrefs());
  } catch {
    /* préférences non critiques */
  }
}

function themeColors() {
  const c = prefs.colors;
  return c && HEX_COLOR.test(c.color) && HEX_COLOR.test(c.symbolColor) ? c : DEFAULT_COLORS;
}

function savedZoom() {
  const zoom = Number(prefs.zoom);
  return ZOOM_STEPS.includes(zoom) ? zoom : 1;
}

/** Taille/position mémorisées, ignorées si l'écran d'origine a disparu. */
function restoredBounds() {
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

/** Même origine que le site (protocole compris : jamais sa version http). */
function isTargetUrl(url) {
  try {
    return new URL(url).origin === TARGET_ORIGIN;
  } catch {
    return false;
  }
}

function isErrorPage(url) {
  return url.startsWith(ERROR_PAGE_URL);
}

function load() {
  return mainWindow.loadURL(TARGET.url + START_PATH).catch(() => {
    /* did-fail-load affiche déjà la page d'erreur */
  });
}

/** Clair ou sombre, d'après la luminosité de la couleur du thème. */
function isLightColor(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4;
}

function showError(detail) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // La page d'erreur reprend le fond du thème : le bandeau natif garde la
  // même couleur que le reste de la fenêtre.
  const { color } = themeColors();
  mainWindow
    .loadFile(ERROR_PAGE, {
      query: {
        url: TARGET.url,
        dev: TARGET.isDev ? '1' : '0',
        detail,
        bg: color,
        light: isLightColor(color) ? '1' : '0',
      },
    })
    .catch(() => {});
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** Les IPC ne sont acceptées que de notre site et de la page d'erreur locale. */
function isTrusted(event) {
  const url = event.senderFrame?.url ?? '';
  return isTargetUrl(url) || isErrorPage(url);
}

const MENU_ROLES_FR = {
  undo: 'Annuler',
  redo: 'Rétablir',
  cut: 'Couper',
  copy: 'Copier',
  paste: 'Coller',
  selectAll: 'Tout sélectionner',
};

/** Libellés du menu contextuel : Electron ne traduit pas les siens. */
function contextMenuLabels() {
  const fr = app.getLocale().toLowerCase().startsWith('fr');
  return {
    /** @param {keyof typeof MENU_ROLES_FR} role */
    role: (role) => (fr ? { role, label: MENU_ROLES_FR[role] } : { role }),
    addWord: fr ? 'Ajouter au dictionnaire' : 'Add to dictionary',
    copyLink: fr ? 'Copier le lien' : 'Copy link',
    copyImage: fr ? 'Copier l’image' : 'Copy image',
  };
}

function attachNavigationGuards(wc) {
  // window.open / target=_blank : jamais de seconde fenêtre Electron.
  wc.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  // Tout ce qui sort de notre hôte part dans le navigateur système…
  wc.on('will-navigate', (event) => {
    if (isErrorPage(event.url) || isTargetUrl(event.url)) return;
    event.preventDefault();
    openExternal(event.url);
  });
  // … y compris au bout d'une redirection serveur (/terms, /support… →
  // alfychat.com) : sans ça, la fenêtre restait coincée sur le site vitrine,
  // sans aucun moyen de revenir à l'application.
  wc.on('will-redirect', (event) => {
    if (!event.isMainFrame || isTargetUrl(event.url)) return;
    event.preventDefault();
    openExternal(event.url);
  });

  // Menu contextuel natif (Electron n'en fournit aucun) : coller dans le
  // composeur, copier une sélection ou un lien, corriger une faute. Il ne
  // s'ouvre que si la page n'a pas déjà géré le clic droit elle-même.
  wc.on('context-menu', (_event, params) => {
    const t = contextMenuLabels();
    /** @type {import('electron').MenuItemConstructorOptions[]} */
    const items = [];
    const separate = () => items.length && items.push({ type: 'separator' });

    if (params.isEditable) {
      if (params.misspelledWord) {
        for (const word of params.dictionarySuggestions.slice(0, 5)) {
          items.push({ label: word, click: () => wc.replaceMisspelling(word) });
        }
        items.push({
          label: t.addWord,
          click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord),
        });
        separate();
      }
      items.push(
        t.role('undo'),
        t.role('redo'),
        { type: 'separator' },
        t.role('cut'),
        t.role('copy'),
        t.role('paste'),
        t.role('selectAll'),
      );
    } else if (params.selectionText.trim()) {
      items.push(t.role('copy'));
    }

    if (isHttp(params.linkURL)) {
      separate();
      items.push({ label: t.copyLink, click: () => clipboard.writeText(params.linkURL) });
    }
    if (params.mediaType === 'image' && params.srcURL) {
      if (!isHttp(params.linkURL)) separate();
      items.push({ label: t.copyImage, click: () => wc.copyImageAt(params.x, params.y) });
    }

    if (items.length) Menu.buildFromTemplate(items).popup({ window: mainWindow ?? undefined });
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

// ── Raccourcis : rechargement et zoom ─────────────────────────────────────────
function reload(wc, ignoreCache) {
  if (isErrorPage(wc.getURL())) load();
  else if (ignoreCache) wc.reloadIgnoringCache();
  else wc.reload();
}

/** `direction` : 1 agrandit, -1 réduit, 0 revient à 100 %. */
function zoom(wc, direction) {
  const current = wc.getZoomFactor();
  let next = 1;
  if (direction > 0) next = ZOOM_STEPS.find((z) => z > current + 0.01) ?? current;
  else if (direction < 0) next = ZOOM_STEPS.findLast((z) => z < current - 0.01) ?? current;
  if (Math.abs(next - current) < 0.001) return;
  wc.setZoomFactor(next);
  prefs.zoom = next;
  scheduleSave();
}

function attachShortcuts(wc) {
  // Ctrl + molette : Electron signale la demande sans l'appliquer.
  wc.on('zoom-changed', (_event, direction) => zoom(wc, direction === 'in' ? 1 : -1));

  // macOS garde sa barre de menu, qui porte déjà ces raccourcis. Ailleurs,
  // l'app distribuée n'a pas de menu : sans ceci, ni F5 ni Ctrl+0.
  if (IS_MAC) return;
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.alt || input.meta) return;
    const key = input.key.toLowerCase();
    let action = null;
    if (input.key === 'F5' || (input.control && key === 'r')) action = () => reload(wc, input.shift);
    else if (!input.control) return;
    else if (key === '+' || key === '=' || input.code === 'NumpadAdd') action = () => zoom(wc, 1);
    else if (key === '-' || input.code === 'NumpadSubtract') action = () => zoom(wc, -1);
    // Par code physique : en AZERTY, la touche 0 donne « à ».
    else if (input.code === 'Digit0' || input.code === 'Numpad0') action = () => zoom(wc, 0);
    if (!action) return;
    event.preventDefault();
    action();
  });
}

// ── Fenêtre ───────────────────────────────────────────────────────────────────
function createWindow() {
  const { color, symbolColor } = themeColors();

  mainWindow = new BrowserWindow({
    ...restoredBounds(),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: TARGET.isDev ? 'AlfyChat — DEV' : 'AlfyChat',
    icon: ICON,
    backgroundColor: color,
    show: false,
    // Pas de barre système : le frontend dessine la sienne (AppTitleBar). Les
    // boutons de fenêtre restent natifs (boutons Windows 11 + snap layouts,
    // feux tricolores macOS) par-dessus.
    titleBarStyle: 'hidden',
    titleBarOverlay: IS_MAC ? undefined : { color, symbolColor, height: TITLEBAR_HEIGHT },
    trafficLightPosition: IS_MAC ? { x: 14, y: 10 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      partition: PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      zoomFactor: savedZoom(),
      // Le JS du site est mis en cache compilé dès le premier lancement,
      // pas seulement au deuxième passage.
      v8CacheOptions: 'bypassHeatCheck',
      // Les outils de développement n'existent pas dans l'app distribuée.
      devTools: !app.isPackaged,
    },
  });

  // Affichée tout de suite (fond du thème, pas d'éclair blanc) plutôt qu'après
  // le premier rendu : le site distant peut mettre plusieurs secondes à répondre.
  if (prefs.maximized) mainWindow.maximize();
  mainWindow.show();

  const wc = mainWindow.webContents;
  attachNavigationGuards(wc);
  attachShortcuts(wc);

  wc.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    // -3 = ERR_ABORTED : navigation remplacée volontairement, sans intérêt.
    // Jamais pour la page d'erreur elle-même : on bouclerait.
    if (!isMainFrame || code === -3 || isErrorPage(url)) return;
    showError(`Code ${code} — ${description}\nURL : ${url}`);
  });

  const pushState = () => wc.send('win-state', { maximized: mainWindow.isMaximized() });
  mainWindow.on('maximize', pushState);
  mainWindow.on('unmaximize', pushState);
  mainWindow.on('resize', scheduleSave);
  mainWindow.on('move', scheduleSave);
  mainWindow.on('focus', () => mainWindow.flashFrame(false));

  mainWindow.on('close', (event) => {
    saveNow();
    // macOS : fermer la fenêtre la masque, ⌘Q quitte — la convention des apps
    // de messagerie. La session socket et un appel en cours y survivent.
    if (!IS_MAC || quitting) return;
    event.preventDefault();
    if (mainWindow.isFullScreen()) {
      // Masquer une fenêtre plein écran laisse un bureau noir.
      mainWindow.once('leave-full-screen', () => mainWindow?.hide());
      mainWindow.setFullScreen(false);
    } else {
      mainWindow.hide();
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

/** Couleurs poussées par le frontend à chaque changement de thème. */
function setThemeColors(colors) {
  const color = String(colors?.color ?? '').toLowerCase();
  const symbolColor = String(colors?.symbolColor ?? '').toLowerCase();
  if (!mainWindow || !HEX_COLOR.test(color) || !HEX_COLOR.test(symbolColor)) return;
  const current = themeColors();
  if (current.color === color && current.symbolColor === symbolColor) return;
  prefs.colors = { color, symbolColor };
  mainWindow.setBackgroundColor(color);
  if (!IS_MAC) mainWindow.setTitleBarOverlay({ color, symbolColor, height: TITLEBAR_HEIGHT });
  scheduleSave();
}

// ── Pastille de non-lus ───────────────────────────────────────────────────────
// macOS et Linux affichent un nombre (`app.setBadgeCount`). Windows ne le sait
// pas : il prend une icône superposée à celle de la barre des tâches — une
// pastille rouge, dessinée ici une fois pour toutes.
let badgeIcon = null;
function badgeImage() {
  if (badgeIcon) return badgeIcon;
  const [r, g, b] = [0xe5, 0x48, 0x4d];
  badgeIcon = nativeImage.createEmpty();
  for (const scaleFactor of [1, 2]) {
    const size = 16 * scaleFactor;
    const radius = size / 2 - scaleFactor;
    const buffer = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const distance = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2);
        const alpha = Math.min(1, Math.max(0, radius - distance + 0.5)); // bord lissé
        const i = (y * size + x) * 4;
        // BGRA prémultiplié : le format natif des bitmaps Skia.
        buffer[i] = b * alpha;
        buffer[i + 1] = g * alpha;
        buffer[i + 2] = r * alpha;
        buffer[i + 3] = 255 * alpha;
      }
    }
    badgeIcon.addRepresentation({ scaleFactor, width: size, height: size, buffer });
  }
  return badgeIcon;
}

function setBadge(count) {
  const n = Math.max(0, Math.floor(Number(count)) || 0);
  if (!IS_WIN) {
    app.setBadgeCount(n);
    return;
  }
  mainWindow?.setOverlayIcon(n ? badgeImage() : null, n ? `${n} non lu${n > 1 ? 's' : ''}` : '');
}

// ── Notifications ─────────────────────────────────────────────────────────────
// Une notification sans référence est ramassée par le GC : son clic n'arrive
// alors jamais. On garde les dernières en vie.
const liveNotifications = new Set();

function showNotification(opts) {
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title: String(opts?.title || 'AlfyChat').slice(0, 200),
    body: String(opts?.body || '').slice(0, 500),
    icon: ICON,
    // Le frontend joue déjà son propre son : pas de second son système.
    silent: opts?.silent === true,
    // Mentions : restent affichées jusqu'à une action (Windows / Linux).
    timeoutType: opts?.urgent ? 'never' : 'default',
  });
  const forget = () => liveNotifications.delete(notification);
  notification.on('click', () => {
    forget();
    showWindow();
  });
  notification.on('close', forget);
  notification.on('failed', forget);
  liveNotifications.add(notification);
  if (liveNotifications.size > 20) liveNotifications.delete(liveNotifications.values().next().value);
  notification.show();
}

// ── Session : permissions, partage d'écran ────────────────────────────────────
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

  // DNS + TLS vers le site pendant que la fenêtre se construit.
  ses.preconnect({ url: TARGET.url });
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
  handle('set-title-bar-colors', setThemeColors);

  handle('get-config', () => ({
    FRONTEND_URL: TARGET.url,
    APP_VERSION: app.getVersion(),
    IS_DEV: TARGET.isDev,
    SOURCE: TARGET.source,
    PARTITION,
  }));

  handle('open-external', (url) => openExternal(String(url)));
  handle('retry', () => load());

  handle('show-notification', showNotification);
  handle('set-badge', setBadge);
  handle('flash', () => {
    if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true);
  });

  handle('install-update', installUpdate);
}

// ── Mises à jour ──────────────────────────────────────────────────────────────
// electron-updater n'est chargé qu'ici, 5 s après le démarrage : ce module
// pèse lourd et n'a rien à faire sur le chemin critique du premier affichage.
/** @type {import('electron-updater').AppUpdater | null} */
let updater = null;

function installUpdate() {
  if (!updater) return;
  quitting = true;
  updater.quitAndInstall(false, true);
}

function scheduleUpdateCheck() {
  if (!app.isPackaged) return;
  setTimeout(() => {
    updater = require('electron-updater').autoUpdater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;

    // Une mise à jour déjà téléchargée est re-signalée à chaque vérification :
    // on ne pose la question qu'une fois par version.
    let proposed = null;
    updater.on('update-downloaded', async (info) => {
      if (!mainWindow || proposed === info.version) return;
      proposed = info.version;
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'AlfyChat',
        message: `La version ${info.version} est prête.`,
        detail: 'Redémarrer maintenant pour l’installer, ou elle le sera à la fermeture de l’application.',
        buttons: ['Redémarrer', 'Plus tard'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) installUpdate();
    });
    updater.on('error', () => {
      /* silencieux : l'app reste utilisable */
    });

    const check = () => updater.checkForUpdates().catch(() => {});
    check();
    // L'app reste ouverte des jours entiers : une seule vérification au
    // lancement ne suffit pas.
    setInterval(check, UPDATE_INTERVAL);
  }, 5000);
}

// ── Cycle de vie ──────────────────────────────────────────────────────────────
function start() {
  if (IS_WIN) app.setAppUserModelId('com.alfychat.desktop'); // notifications nommées « AlfyChat »
  prefsPath = path.join(app.getPath('userData'), `window-prefs${TARGET.isDev ? '-dev' : ''}.json`);
  prefs = loadPrefs();

  console.log(`[AlfyChat] mode=${TARGET.source} · cible=${TARGET.url} · session=${PARTITION}`);

  // Sans barre de menu, les raccourcis par défaut (Ctrl+R, Ctrl+Shift+I…)
  // disparaissent de la version distribuée ; `attachShortcuts` remet ceux
  // qui servent. macOS garde son menu : il porte couper/copier/coller.
  if (app.isPackaged && !IS_MAC) Menu.setApplicationMenu(null);

  configureSession();
  registerIpc();
  createWindow();
  scheduleUpdateCheck();
}

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  if (!IS_MAC) app.quit();
});

app.on('activate', () => {
  if (mainWindow) showWindow();
  else if (app.isReady()) createWindow();
});
