# AlfyChat Desktop

Enveloppe [Electron](https://www.electronjs.org/) d'AlfyChat. Le site est chargé
**directement** dans la fenêtre (pas de `<webview>`, pas de shell intermédiaire) :
un seul process de rendu, un seul bandeau de titre — celui du frontend (`AppTitleBar`),
avec les boutons de fenêtre natifs de l'OS posés par-dessus.

## Démarrage

```bash
npm install
npm start            # dev : charge http://localhost:4000 (le frontend doit tourner)
npm run dev          # idem + DevTools détachés
npm run prod         # charge https://alfychat.app sans empaqueter
```

Cible du frontend, par ordre de priorité : `--url=<url>` › variable `ALFYCHAT_URL` ›
`app.isPackaged` (prod si empaqueté, dev sinon). Les sessions dev et prod sont
séparées (`persist:alfychat-dev` / `persist:alfychat`).

## Build

```bash
npm run build:win     # NSIS
npm run build:mac     # DMG x64 + arm64
npm run build:linux   # deb + AppImage
```

Sortie dans `dist/`. Seuls `main.js`, `preload.js`, `resources/error.html` et
`resources/icons/icon.png` sont embarqués.

## Mises à jour

`electron-updater` (releases GitHub `alfycore/desktop-alfychat`), chargé 5 s après le
démarrage et uniquement dans l'app empaquetée. Une boîte de dialogue native propose
de redémarrer quand la mise à jour est téléchargée ; sinon elle s'installe à la fermeture.

## Ce que fait le processus principal

- instance unique (un second lancement ramène la fenêtre existante au premier plan) ;
- taille/position mémorisées, ignorées si l'écran d'origine a disparu ;
- liens externes et `window.open` → navigateur système, jamais une seconde fenêtre ;
- permissions limitées à notre hôte (notifications, micro/caméra, partage d'écran, presse-papiers) ;
- partage d'écran : menu natif de choix de source (écran ou fenêtre) ;
- menu contextuel natif (copier/coller, correcteur orthographique) ;
- rechargement automatique si le moteur de rendu plante (3 fois max par minute) ;
- page d'erreur locale (`resources/error.html`) si le site est injoignable.

## Pont frontend ↔ desktop — `window.electronAPI`

Défini dans `preload.js`, typé côté front dans `Frontend-AlfyChat/src/lib/desktop.ts`.
Les appels IPC sont refusés s'ils ne viennent pas de notre hôte.

| Méthode | Rôle |
| --- | --- |
| `platform`, `nativeControls` | OS, et boutons de fenêtre dessinés par l'OS |
| `getConfig()` | URL cible, version, mode dev |
| `openExternal(url)` | ouvre une URL http(s) dans le navigateur |
| `showNotification({ title, body })` | notification OS (clic = ramène la fenêtre) |
| `setBadge(n)` | pastille de non-lus (macOS / Linux) |
| `flash()` | fait clignoter la barre des tâches si la fenêtre n'a pas le focus |
| `minimize()` / `maximize()` / `close()` / `isMaximized()` | fenêtre |
| `onWinState(cb)` | maximisation poussée par le main ; renvoie la désinscription |
| `installUpdate()` | quitte et installe la mise à jour téléchargée |
| `retry()` | page d'erreur : recharge le site |
