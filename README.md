# AlfyChat Desktop

Enveloppe [Electron](https://www.electronjs.org/) d'AlfyChat. Le site est chargé
**directement** dans la fenêtre (pas de `<webview>`, pas de shell intermédiaire) :
un seul process de rendu, un seul bandeau de titre — celui du frontend (`AppTitleBar`),
avec les boutons de fenêtre natifs de l'OS posés par-dessus.

## Démarrage

```bash
npm ci               # installe exactement les versions du package-lock (Electron 39)
npm start            # dev : charge http://localhost:4000 (le frontend doit tourner)
npm run dev          # idem + DevTools détachés
npm run prod         # charge https://alfychat.app sans empaqueter
```

Cible du frontend, par ordre de priorité : `--url=<url>` › variable `ALFYCHAT_URL` ›
`app.isPackaged` (prod si empaqueté, dev sinon). Les sessions dev et prod sont
séparées (`persist:alfychat-dev` / `persist:alfychat`).

Lancé depuis le terminal de VS Code, Electron hérite de `ELECTRON_RUN_AS_NODE=1` et
démarre comme un simple Node (`Cannot read properties of undefined (reading
'requestSingleInstanceLock')`) : `env -u ELECTRON_RUN_AS_NODE npm start`, ou un autre terminal.

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
démarrage puis toutes les 6 h, uniquement dans l'app empaquetée. Une boîte de dialogue
native propose de redémarrer quand la mise à jour est téléchargée (une fois par version) ;
sinon elle s'installe à la fermeture.

La CI (`.github/workflows/build-desktop.yml`) ne publie que si la version de
`package.json` n'a pas encore de tag : **augmenter la version pour publier**. Le bouton
« Run workflow » reconstruit dans tous les cas.

macOS : la mise à jour automatique exige une app signée et une cible `zip` en plus du
DMG — tant que le build n'est pas signé, elle échoue en silence.

## Ce que fait le processus principal

- instance unique (un second lancement ramène la fenêtre existante au premier plan) ;
- taille/position, zoom et couleurs du thème mémorisés (position ignorée si l'écran d'origine a disparu) ;
- liens externes, `window.open` et redirections serveur vers un autre site → navigateur système,
  jamais une seconde fenêtre ni la fenêtre principale ;
- permissions limitées à notre origine (notifications, micro/caméra, partage d'écran, presse-papiers) ;
- partage d'écran : menu natif de choix de source (écran ou fenêtre) ;
- menu contextuel natif (copier/coller, lien, image, correcteur orthographique) ;
- raccourcis sans barre de menu (Windows/Linux) : F5 / Ctrl+R, Ctrl+Maj+R, Ctrl +/−/0, Ctrl + molette ;
- macOS : fermer la fenêtre la masque (⌘Q quitte), un appel en cours continue ;
- rechargement automatique si le moteur de rendu plante (3 fois max par minute) ;
- page d'erreur locale (`resources/error.html`) si le site est injoignable, rechargée seule au retour du réseau.

## Pont frontend ↔ desktop — `window.electronAPI`

Défini dans `preload.js`, typé côté front dans `Frontend-AlfyChat/src/lib/desktop.ts`.
Les appels IPC sont refusés s'ils ne viennent pas de notre hôte.

| Méthode | Rôle |
| --- | --- |
| `platform`, `nativeControls` | OS, et boutons de fenêtre dessinés par l'OS |
| `getConfig()` | URL cible, version, mode dev |
| `openExternal(url)` | ouvre une URL http(s) dans le navigateur |
| `showNotification({ title, body, silent, urgent })` | notification OS (clic = ramène la fenêtre ; `urgent` = reste affichée) |
| `setBadge(n)` | pastille de non-lus : nombre (macOS / Linux), point rouge sur l'icône (Windows) |
| `flash()` | fait clignoter la barre des tâches si la fenêtre n'a pas le focus |
| `setTitleBarColors({ color, symbolColor })` | couleurs `#rrggbb` des boutons de fenêtre natifs, poussées par le thème |
| `minimize()` / `maximize()` / `close()` / `isMaximized()` | fenêtre |
| `onWinState(cb)` | maximisation poussée par le main ; renvoie la désinscription |
| `installUpdate()` | quitte et installe la mise à jour téléchargée |
| `retry()` | page d'erreur : recharge le site |
