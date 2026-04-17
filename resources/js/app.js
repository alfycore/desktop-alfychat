/**
 * AlfyChat Desktop — app.js (Electron renderer, script classique)
 */

// ── 1. Config ──────────────────────────────────────────────────────────────────
var FRONTEND_URL = 'http://localhost:4000';
var APP_VERSION  = '1.0.0';
var UPDATE_URL   = 'https://update.alfychat.com/desktop/manifest.json';

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

// ── 3. Helpers ─────────────────────────────────────────────────────────────────
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

window.retryLoad = function() {
  errorScreen.classList.remove('show');
  splash.classList.remove('fade-out');
  splash.style.opacity = '1';
  frame.src = 'about:blank';
  setProgress(5, 'Nouvelle tentative…');
  startBoot();
};

// ── 4. Auto-update (vérification silencieuse) ──────────────────────────────────
function checkUpdate(onDone) {
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', UPDATE_URL + '?_t=' + Date.now(), true);
    xhr.timeout = 5000;
    xhr.onload = function() {
      try {
        var m = JSON.parse(xhr.responseText);
        if (!m || !m.version) { onDone(); return; }
        var cur = APP_VERSION.replace(/^v/, '').split('.').map(Number);
        var nxt = m.version.replace(/^v/, '').split('.').map(Number);
        var isNewer = false;
        for (var i = 0; i < 3; i++) {
          var d = (nxt[i] || 0) - (cur[i] || 0);
          if (d > 0) { isNewer = true; break; }
          if (d < 0) break;
        }
        if (isNewer) {
          var plat = navigator.platform.toLowerCase().includes('win') ? 'win32' :
                     navigator.platform.toLowerCase().includes('mac') ? 'darwin' : 'linux';
          var pd = m.platforms && m.platforms[plat];
          if (pd && pd.url) {
            updateText.textContent = 'Mise à jour ' + m.version + ' disponible';
            updateBanner.classList.add('show');
            btnInstall.onclick = function() {
              updateBanner.classList.remove('show');
              window.electronAPI.openExternal(pd.url);
            };
            btnDismiss.onclick = function() { updateBanner.classList.remove('show'); };
          }
        }
      } catch (e) {}
      onDone();
    };
    xhr.onerror   = function() { onDone(); };
    xhr.ontimeout = function() { onDone(); };
    xhr.send();
  } catch (e) { onDone(); }
}

// ── 5. Navigation guard ────────────────────────────────────────────────────────
var ALLOWED_NAV = /^\/(login|register|forgot-password|reset-password|verify-email|channels|invite|app|subscription)(\/.*)?(\?.*)?$/;

function guardNavByUrl(url) {
  try {
    var pathname = new URL(url).pathname;
    if (!ALLOWED_NAV.test(pathname)) {
      frame.src = FRONTEND_URL + '/channels';
    }
  } catch (e) {}
}

// ── 6. Webview events ──────────────────────────────────────────────────────────
var failTimer = null;

frame.addEventListener('dom-ready', function() {
  if (failTimer) { clearTimeout(failTimer); failTimer = null; }
  if (!webviewWrap.classList.contains('visible')) {
    setProgress(100, 'Prêt !');
    setTimeout(hideSplash, 400);
  }
});

frame.addEventListener('will-navigate', function(e) {
  guardNavByUrl(e.url);
});

frame.addEventListener('did-navigate-in-page', function(e) {
  if (e.isMainFrame) guardNavByUrl(e.url);
});

// ── 7. Boot ────────────────────────────────────────────────────────────────────
function startBoot() {
  setProgress(5, 'Initialisation…');
  setProgress(20, 'Vérification des mises à jour…');
  checkUpdate(function() {
    setProgress(70, 'Chargement de l\'interface…');
    failTimer = setTimeout(function() {
      if (!webviewWrap.classList.contains('visible')) {
        showError(
          'Impossible de contacter le frontend (' + FRONTEND_URL + ').\n' +
          'Assurez-vous que le serveur AlfyChat est démarré (port 4000).'
        );
      }
    }, 20000);
    frame.src = FRONTEND_URL + '/channels';
  });
}

// ── 8. Messages postMessage depuis le frontend ────────────────────────────────
window.addEventListener('message', function(evt) {
  try {
    var msg = evt.data;
    if (!msg || !msg.type) return;
    if (msg.type === 'NOTIFICATION') {
      window.electronAPI.showNotification({ title: msg.title || 'AlfyChat', body: msg.body || '' });
    } else if (msg.type === 'OPEN_EXTERNAL' && msg.url && /^https?:\/\//.test(msg.url)) {
      window.electronAPI.openExternal(msg.url);
    }
  } catch (e) {}
});

// ── 9. Init ────────────────────────────────────────────────────────────────────
window.electronAPI.getConfig().then(function(cfg) {
  FRONTEND_URL = cfg.FRONTEND_URL;
  APP_VERSION  = cfg.APP_VERSION;
  UPDATE_URL   = cfg.UPDATE_URL;
  startBoot();
});


// ── 1. Config (valeurs par défaut, écrasées dès que getConfig() répond) ────────
var FRONTEND_URL = 'http://localhost:4000';
var APP_VERSION  = '1.0.0';
var UPDATE_URL   = 'https://update.alfychat.com/desktop/manifest.json';

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
var titlebar     = document.getElementById('titlebar');
var tbMin        = document.getElementById('tb-min');
var tbMax        = document.getElementById('tb-max');
var tbClose      = document.getElementById('tb-close');
var tbMaxIcon    = document.getElementById('tb-max-icon');

// ── 3. État maximize ───────────────────────────────────────────────────────────
function updateMaxIcon(isMax) {
  if (!tbMaxIcon) return;
  if (isMax) {
    tbMaxIcon.innerHTML =
      '<rect x="2" y="0" width="8" height="8" stroke="currentColor" stroke-width="1" fill="none"/>' +
      '<rect x="0" y="2" width="8" height="8" stroke="currentColor" stroke-width="1" fill="var(--bg)"/>';
  } else {
    tbMaxIcon.innerHTML =
      '<rect x=".5" y=".5" width="9" height="9" stroke="currentColor" stroke-width="1" fill="none"/>';
  }
}

window.electronAPI.onWinState(function(state) {
  updateMaxIcon(state.maximized);
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

window.retryLoad = function() {
  errorScreen.classList.remove('show');
  splash.classList.remove('fade-out');
  splash.style.opacity = '1';
  frame.src = 'about:blank';
  setProgress(5, 'Nouvelle tentative…');
  startBoot();
};

// ── 5. Auto-update (vérification silencieuse) ──────────────────────────────────
function checkUpdate(onDone) {
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', UPDATE_URL + '?_t=' + Date.now(), true);
    xhr.timeout = 5000;
    xhr.onload = function() {
      try {
        var m = JSON.parse(xhr.responseText);
        if (!m || !m.version) { onDone(); return; }
        var cur = APP_VERSION.replace(/^v/, '').split('.').map(Number);
        var nxt = m.version.replace(/^v/, '').split('.').map(Number);
        var isNewer = false;
        for (var i = 0; i < 3; i++) {
          var d = (nxt[i] || 0) - (cur[i] || 0);
          if (d > 0) { isNewer = true; break; }
          if (d < 0) break;
        }
        if (isNewer) {
          var plat = navigator.platform.toLowerCase().includes('win') ? 'win32' :
                     navigator.platform.toLowerCase().includes('mac') ? 'darwin' : 'linux';
          var pd = m.platforms && m.platforms[plat];
          if (pd && pd.url) {
            updateText.textContent = 'Mise à jour ' + m.version + ' disponible';
            updateBanner.classList.add('show');
            btnInstall.onclick = function() {
              updateBanner.classList.remove('show');
              window.electronAPI.openExternal(pd.url);
            };
            btnDismiss.onclick = function() { updateBanner.classList.remove('show'); };
          }
        }
      } catch (e) {}
      onDone();
    };
    xhr.onerror   = function() { onDone(); };
    xhr.ontimeout = function() { onDone(); };
    xhr.send();
  } catch (e) { onDone(); }
}

// ── 6. Navigation guard ────────────────────────────────────────────────────────
var ALLOWED_NAV = /^\/(login|register|forgot-password|reset-password|verify-email|channels|invite|app|subscription)(\/.*)?(\?.*)?$/;

function guardNavByUrl(url) {
  try {
    var pathname = new URL(url).pathname;
    if (!ALLOWED_NAV.test(pathname)) {
      frame.src = FRONTEND_URL + '/channels';
    }
  } catch (e) {}
}

// ── 7. Webview events (enregistrés une seule fois) ─────────────────────────────
var failTimer = null;

frame.addEventListener('dom-ready', function() {
  if (failTimer) { clearTimeout(failTimer); failTimer = null; }
  if (!webviewWrap.classList.contains('visible')) {
    setProgress(100, 'Prêt !');
    setTimeout(hideSplash, 400);
  }
});

frame.addEventListener('will-navigate', function(e) {
  guardNavByUrl(e.url);
});

frame.addEventListener('did-navigate-in-page', function(e) {
  if (e.isMainFrame) guardNavByUrl(e.url);
});

// ── 8. Boot ────────────────────────────────────────────────────────────────────
function startBoot() {
  setProgress(5, 'Initialisation…');
  setProgress(20, 'Vérification des mises à jour…');

  checkUpdate(function() {
    setProgress(70, 'Chargement de l\'interface…');

    failTimer = setTimeout(function() {
      if (!webviewWrap.classList.contains('visible')) {
        showError(
          'Impossible de contacter le frontend (' + FRONTEND_URL + ').\n' +
          'Assurez-vous que le serveur AlfyChat est démarré (port 4000).'
        );
      }
    }, 20000);

    frame.src = FRONTEND_URL + '/channels';
  });
}

// ── 9. Titlebar ────────────────────────────────────────────────────────────────
function initTitlebar() {
  tbMin.onclick   = function() { window.electronAPI.minimize(); };
  tbClose.onclick = function() { window.electronAPI.close(); };
  tbMax.onclick   = function() { window.electronAPI.maximize(); };

  titlebar.addEventListener('dblclick', function(e) {
    if (e.target.closest('#tb-controls')) return;
    window.electronAPI.maximize();
  });

  window.electronAPI.isMaximized().then(function(isMax) {
    updateMaxIcon(isMax);
  });
}

// ── 10. Messages postMessage depuis le frontend ────────────────────────────────
window.addEventListener('message', function(evt) {
  try {
    var msg = evt.data;
    if (!msg || !msg.type) return;
    if (msg.type === 'NOTIFICATION') {
      window.electronAPI.showNotification({ title: msg.title || 'AlfyChat', body: msg.body || '' });
    } else if (msg.type === 'OPEN_EXTERNAL' && msg.url && /^https?:\/\//.test(msg.url)) {
      window.electronAPI.openExternal(msg.url);
    } else if (msg.type === 'MINIMIZE_TO_TRAY') {
      window.electronAPI.minimize();
    }
  } catch (e) {}
});

// ── 11. Init principal ─────────────────────────────────────────────────────────
window.electronAPI.getConfig().then(function(cfg) {
  FRONTEND_URL = cfg.FRONTEND_URL;
  APP_VERSION  = cfg.APP_VERSION;
  UPDATE_URL   = cfg.UPDATE_URL;
  initTitlebar();
  startBoot();
});

