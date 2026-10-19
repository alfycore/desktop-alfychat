/**
 * AlfyChat Desktop — renderer du shell (script classique, pas de bundler).
 *
 * Rôle : afficher le splash, créer le <webview> qui embarque le frontend,
 * surveiller le chargement et présenter les erreurs.
 * La cible (localhost en dev, alfychat.app en prod) vient du main process.
 *
 * ⚠ Tout est enfermé dans une IIFE : en script classique, un `var` de premier
 * niveau devient une propriété de `window`. Certains noms (`status`, `name`,
 * `length`, `top`…) y sont déjà définis par le navigateur avec un type imposé —
 * `window.status` coerce par exemple toute valeur en chaîne, ce qui casse
 * silencieusement une référence DOM. L'IIFE supprime le problème à la racine.
 */

(function () {
  'use strict';

  // ── Config (remplie par getConfig) ──────────────────────────────────────────
  var CFG = {
    FRONTEND_URL: 'https://alfychat.app',
    APP_VERSION: '0.0.0',
    IS_DEV: false,
    PARTITION: 'persist:alfychat',
  };

  // ── Références DOM ──────────────────────────────────────────────────────────
  var splash = document.getElementById('splash');
  var track = document.getElementById('track');
  var bar = document.getElementById('bar');
  var statusEl = document.getElementById('status');
  var view = document.getElementById('view');
  var devBadge = document.getElementById('dev-badge');

  var errorPane = document.getElementById('error');
  var errorLead = document.getElementById('error-lead');
  var errorHint = document.getElementById('error-hint');
  var errorDetail = document.getElementById('error-detail');
  var btnRetry = document.getElementById('btn-retry');
  var btnOpenExternal = document.getElementById('btn-open-external');

  var updateBanner = document.getElementById('update');
  var updateText = document.getElementById('update-text');
  var btnInstall = document.getElementById('btn-install');
  var btnDismiss = document.getElementById('btn-dismiss');

  var frame = null; // <webview>, créé une fois la config connue
  var failTimer = null;
  var slowTimer = null;

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function setProgress(pct, label) {
    if (pct == null) {
      track.classList.add('pending');
    } else {
      track.classList.remove('pending');
      bar.style.width = pct + '%';
    }
    if (label) statusEl.textContent = label;
  }

  function clearTimers() {
    if (failTimer) { clearTimeout(failTimer); failTimer = null; }
    if (slowTimer) { clearTimeout(slowTimer); slowTimer = null; }
  }

  function showApp() {
    view.classList.add('visible');
    splash.classList.add('hidden');
  }

  function showError(detail) {
    clearTimers();
    errorLead.textContent = CFG.IS_DEV
      ? 'Le serveur de développement (' + CFG.FRONTEND_URL + ') est injoignable.'
      : 'AlfyChat n’a pas pu contacter ' + CFG.FRONTEND_URL + '.';
    errorHint.classList.toggle('show', !!CFG.IS_DEV);
    errorDetail.textContent = detail;
    errorPane.classList.add('show');
    splash.classList.add('hidden');
  }

  function hideError() {
    errorPane.classList.remove('show');
    splash.classList.remove('hidden');
  }

  // ── Garde de navigation ─────────────────────────────────────────────────────
  // Les routes hors application sont ramenées sur /channels ; tout ce qui sort
  // de l'hôte cible part dans le navigateur système.
  var ALLOWED_NAV =
    /^\/(login|register|forgot-password|reset-password|verify-email|channels|invite)(\/.*)?$/;

  function guardNav(url) {
    try {
      var parsed = new URL(url);
      var cible = new URL(CFG.FRONTEND_URL);
      if (parsed.host !== cible.host) {
        window.electronAPI.openExternal(url);
        return;
      }
      if (!ALLOWED_NAV.test(parsed.pathname)) {
        frame.setAttribute('src', CFG.FRONTEND_URL + '/channels');
      }
    } catch (_) {
      /* URL non analysable : on laisse passer */
    }
  }

  // ── Création du <webview> ───────────────────────────────────────────────────
  // Créé en JS (et non dans le HTML) car l'attribut `partition` doit être posé
  // avant l'attachement : il diffère entre dev et prod pour isoler les sessions.
  function createFrame() {
    frame = document.createElement('webview');
    frame.setAttribute('id', 'app-frame');
    frame.setAttribute('allowpopups', '');
    frame.setAttribute('partition', CFG.PARTITION);
    frame.setAttribute('webpreferences', 'contextIsolation=no');

    frame.addEventListener('dom-ready', function () {
      clearTimers();
      if (!view.classList.contains('visible')) {
        setProgress(100, 'Prêt');
        setTimeout(showApp, 320);
      }
    });

    frame.addEventListener('will-navigate', function (e) {
      guardNav(e.url);
    });

    frame.addEventListener('did-navigate-in-page', function (e) {
      if (e.isMainFrame) guardNav(e.url);
    });

    frame.addEventListener('did-fail-load', function (e) {
      // -3 = ERR_ABORTED : navigation interrompue volontairement, sans intérêt.
      if (e.errorCode === -3 || !e.isMainFrame) return;
      showError('Code ' + e.errorCode + ' — ' + e.errorDescription + '\nURL : ' + e.validatedURL);
    });

    // Messages venus du frontend, relayés par webview-preload.js.
    frame.addEventListener('ipc-message', function (e) {
      if (e.channel !== 'app-message') return;
      var msg = e.args && e.args[0];
      if (!msg || !msg.type) return;

      if (msg.type === 'NOTIFICATION') {
        window.electronAPI.showNotification({
          title: msg.title || 'AlfyChat',
          body: msg.body || '',
        });
      } else if (msg.type === 'OPEN_EXTERNAL' && msg.url && /^https?:\/\//.test(msg.url)) {
        window.electronAPI.openExternal(msg.url);
      } else if (msg.type === 'MINIMIZE_TO_TRAY') {
        window.electronAPI.minimize();
      }
    });

    view.appendChild(frame);
  }

  // ── Démarrage ───────────────────────────────────────────────────────────────
  function boot() {
    clearTimers();
    hideError();

    var hote = CFG.FRONTEND_URL;
    try {
      hote = new URL(CFG.FRONTEND_URL).host;
    } catch (_) {
      /* URL invalide : on affiche la chaîne brute */
    }
    setProgress(15, 'Connexion à ' + hote + '…');

    // En dev, Next compile la route à la première requête : l'attente est
    // normale et peut être longue. Barre indéterminée, délai plus large.
    var delai = CFG.IS_DEV ? 45000 : 20000;

    if (CFG.IS_DEV) {
      slowTimer = setTimeout(function () {
        if (!view.classList.contains('visible')) {
          setProgress(null, 'Compilation du frontend…');
        }
      }, 2500);
    }

    failTimer = setTimeout(function () {
      if (!view.classList.contains('visible')) {
        showError('Aucune réponse après ' + Math.round(delai / 1000) + ' s.');
      }
    }, delai);

    if (!frame) createFrame();
    setProgress(60, 'Chargement de l’interface…');
    frame.setAttribute('src', CFG.FRONTEND_URL + '/channels');
  }

  // ── Actions ─────────────────────────────────────────────────────────────────
  btnRetry.addEventListener('click', function () {
    if (frame) frame.setAttribute('src', 'about:blank');
    boot();
  });

  btnOpenExternal.addEventListener('click', function () {
    window.electronAPI.openExternal(CFG.FRONTEND_URL + '/channels');
  });

  btnDismiss.addEventListener('click', function () {
    updateBanner.classList.remove('show');
  });

  // ── Mises à jour ────────────────────────────────────────────────────────────
  window.electronAPI.onUpdateAvailable(function (info) {
    updateText.textContent = 'Mise à jour ' + info.version + ' — téléchargement en cours…';
    btnInstall.style.display = 'none';
    updateBanner.classList.add('show');
  });

  window.electronAPI.onUpdateDownloaded(function (info) {
    updateText.textContent = 'Mise à jour ' + info.version + ' prête à être installée';
    btnInstall.style.display = '';
    btnInstall.onclick = function () {
      window.electronAPI.installUpdate();
    };
    updateBanner.classList.add('show');
  });

  window.electronAPI.onUpdateError(function () {
    /* silencieux : l'app reste utilisable */
  });

  window.electronAPI.onWinState(function () {
    /* barre de titre native : rien à synchroniser côté DOM */
  });

  // ── Init ────────────────────────────────────────────────────────────────────
  window.electronAPI
    .getConfig()
    .then(function (cfg) {
      CFG.FRONTEND_URL = (cfg.FRONTEND_URL || CFG.FRONTEND_URL).replace(/\/+$/, '');
      CFG.APP_VERSION = cfg.APP_VERSION || CFG.APP_VERSION;
      CFG.IS_DEV = !!cfg.IS_DEV;
      CFG.PARTITION = cfg.PARTITION || CFG.PARTITION;

      devBadge.classList.toggle('show', CFG.IS_DEV);
      document.title = CFG.IS_DEV ? 'AlfyChat — DEV' : 'AlfyChat';

      boot();
    })
    .catch(function (err) {
      showError('Configuration illisible : ' + (err && err.message ? err.message : String(err)));
    });
})();
