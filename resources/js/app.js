/**
 * AlfyChat Desktop — app.js (Electron renderer, script classique)
 */

// ── 1. Config (écrasée dès que getConfig() répond) ─────────────────────────────
var FRONTEND_URL = 'https://alfychat.app';
var APP_VERSION  = '1.0.0';

// ── 2. DOM refs ────────────────────────────────────────────────────────────────
var splash       = document.getElementById('splash');
var progressBar  = document.getElementById('progress');
var splashStatus = document.getElementById('splash-status');
var webviewWrap  = document.getElementById('webview-container');
var frame        = document.getElementById('app-frame');
var errorScreen  = document.getElementById('error-screen');
var errorDetail  = document.getElementById('error-detail');
var updateBanner = document.getElementById('update-banner');
var updateText   = document.getElementById('update-text');
var btnInstall   = document.getElementById('btn-install-update');
var btnDismiss   = document.getElementById('btn-dismiss-update');

// ── 3. État maximize (titleBarOverlay natif — hook pour extension future) ───────
window.electronAPI.onWinState(function (_state) {
  // Barre de titre native Electron (titleBarOverlay) — rien à mettre à jour côté DOM.
});

// ── 4. Helpers ─────────────────────────────────────────────────────────────────
function setProgress(pct, status) {
  progressBar.style.width = pct + '%';
  if (status) splashStatus.textContent = status;
}

function showError(msg) {
  errorDetail.textContent = msg;
  errorScreen.classList.add('show');
  splash.classList.add('fade-out');
}

function hideSplash() {
  webviewWrap.classList.add('visible');
  splash.classList.add('fade-out');
}

window.retryLoad = function () {
  errorScreen.classList.remove('show');
  splash.classList.remove('fade-out');
  splash.style.opacity = '1';
  frame.setAttribute('src', 'about:blank');
  setProgress(5, 'Nouvelle tentative…');
  startBoot();
};

// ── 5. Auto-update (via electron-updater → IPC) ───────────────────────────────
window.electronAPI.onUpdateAvailable(function (info) {
  updateText.textContent = 'Mise à jour ' + info.version + ' disponible — Téléchargement…';
  updateBanner.classList.add('show');
  btnInstall.style.display = 'none';
  btnDismiss.onclick = function () { updateBanner.classList.remove('show'); };
});

window.electronAPI.onUpdateDownloaded(function (info) {
  updateText.textContent = 'Mise à jour ' + info.version + ' prête';
  updateBanner.classList.add('show');
  btnInstall.style.display = '';
  btnInstall.textContent = 'Redémarrer et installer';
  btnInstall.onclick = function () { window.electronAPI.installUpdate(); };
  btnDismiss.onclick = function () { updateBanner.classList.remove('show'); };
});

window.electronAPI.onUpdateError(function (_info) {
  // Ignorer silencieusement — l'app reste fonctionnelle
});

// ── 6. Navigation guard ────────────────────────────────────────────────────────
var ALLOWED_NAV = /^\/(login|register|forgot-password|reset-password|verify-email|channels)(\/.*)?(\..*)?$/;

function guardNavByUrl(url) {
  try {
    var parsed      = new URL(url);
    var frontendHost = new URL(FRONTEND_URL).host;
    // Liens externes → ouvrir dans le navigateur système
    if (parsed.host !== frontendHost) {
      window.electronAPI.openExternal(url);
      return;
    }
    // Routes internes non autorisées → rediriger vers /channels
    if (!ALLOWED_NAV.test(parsed.pathname)) {
      frame.setAttribute('src', FRONTEND_URL + '/channels');
    }
  } catch (_) {}
}

// ── 7. Webview events ──────────────────────────────────────────────────────────
var failTimer = null;

frame.addEventListener('dom-ready', function () {
  if (failTimer) { clearTimeout(failTimer); failTimer = null; }
  if (!webviewWrap.classList.contains('visible')) {
    setProgress(100, 'Prêt !');
    setTimeout(hideSplash, 400);
  }
});

frame.addEventListener('will-navigate', function (e) {
  guardNavByUrl(e.url);
});

frame.addEventListener('did-navigate-in-page', function (e) {
  if (e.isMainFrame) guardNavByUrl(e.url);
});

frame.addEventListener('did-fail-load', function (e) {
  // errorCode -3 = ERR_ABORTED (navigation interrompue normalement), ignorer
  if (e.errorCode !== -3 && e.isMainFrame) {
    showError(
      'Erreur de chargement (' + e.errorCode + ') : ' + e.errorDescription + '\n' +
      'URL : ' + e.validatedURL
    );
  }
});

// ── 8. Messages depuis le webview ──────────────────────────────────────────────
// Le preload du webview (webview-preload.js) bridge window.postMessage → sendToHost.
// On reçoit ici via l'événement 'ipc-message' du <webview>.
frame.addEventListener('ipc-message', function (e) {
  if (e.channel !== 'app-message') return;
  try {
    var msg = e.args && e.args[0];
    if (!msg || !msg.type) return;
    if (msg.type === 'NOTIFICATION') {
      window.electronAPI.showNotification({
        title: msg.title || 'AlfyChat',
        body:  msg.body  || '',
      });
    } else if (msg.type === 'OPEN_EXTERNAL' && msg.url && /^https?:\/\//.test(msg.url)) {
      window.electronAPI.openExternal(msg.url);
    } else if (msg.type === 'MINIMIZE_TO_TRAY') {
      window.electronAPI.minimize();
    }
  } catch (_) {}
});

// ── 9. Boot ────────────────────────────────────────────────────────────────────
function startBoot() {
  setProgress(5, 'Initialisation…');

  failTimer = setTimeout(function () {
    if (!webviewWrap.classList.contains('visible')) {
      showError(
        'Impossible de contacter le frontend (' + FRONTEND_URL + ').\n' +
        'Assurez-vous que l\'application AlfyChat est accessible.'
      );
    }
  }, 20000);

  setProgress(60, 'Chargement de l\'interface…');
  frame.setAttribute('src', FRONTEND_URL + '/channels');
}

// ── 10. Init ───────────────────────────────────────────────────────────────────
window.electronAPI.getConfig().then(function (cfg) {
  FRONTEND_URL = (cfg.FRONTEND_URL || FRONTEND_URL).replace(/\/$/, '');
  APP_VERSION  = cfg.APP_VERSION  || APP_VERSION;
  startBoot();
});

