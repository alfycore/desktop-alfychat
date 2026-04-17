# AlfyChat Desktop

Application desktop pour AlfyChat, construite avec [Neutralino.js](https://neutralino.js.org/).

## Prérequis

- Node.js 18+
- Le frontend AlfyChat doit tourner (port 4000 par défaut)

## Démarrage rapide

```bash
# Installer les dépendances (neu CLI)
npm install

# Lancer en mode dev (ouvre la fenêtre et charge localhost:4000)
npm start
```

## Build

```bash
# Build debug (toutes plateformes)
npm run build

# Build release compressé
npm run build:all
```

Les binaires sont générés dans `dist/`.

## Auto-update

Le système d'auto-update vérifie au démarrage l'URL configurée dans `neutralino.config.json` → `globalVariables.UPDATE_MANIFEST_URL`.

Héberger un fichier JSON selon le format `update-manifest.example.json` :

```json
{
  "version": "1.2.0",
  "notes": "Description des changements",
  "date": "2026-04-17",
  "platforms": {
    "win32":  { "url": "https://…/alfychat-win.zip",   "size": 12345678 },
    "linux":  { "url": "https://…/alfychat-linux.zip", "size": 11234567 },
    "darwin": { "url": "https://…/alfychat-mac.zip",   "size": 13456789 }
  }
}
```

Dès que `version` > version de l'app installée, un bandeau s'affiche et l'utilisateur peut installer la mise à jour.

## Communication Frontend ↔ Desktop

Le frontend peut envoyer des commandes via `postMessage` :

```js
// Notification native OS
window.parent.postMessage({ type: 'NOTIFICATION', title: 'Nouveau message', body: 'Alice vous a écrit' }, '*');

// Badge dock (macOS)
window.parent.postMessage({ type: 'BADGE_COUNT', count: 5 }, '*');

// Flash barre des tâches (Windows)
window.parent.postMessage({ type: 'WINDOW_FLASH' }, '*');

// Ouvrir un lien dans le navigateur système
window.parent.postMessage({ type: 'OPEN_EXTERNAL', url: 'https://alfychat.com' }, '*');

// Minimiser dans le tray
window.parent.postMessage({ type: 'MINIMIZE_TO_TRAY' }, '*');
```

## Structure

```
desktop/
├── neutralino.config.json     # Config principale Neutralino
├── package.json
├── build.mjs                  # Script de build
├── update-manifest.example.json
└── resources/
    ├── index.html             # Splash + webview
    ├── icons/
    │   ├── icon.png           # 256×256
    │   ├── icon.ico           # Windows
    │   └── icon.icns          # macOS
    └── js/
        ├── neutralino.js      # Runtime Neutralino (auto-copié par neu CLI)
        ├── app.js             # Logique principale
        └── updater.js         # Système d'auto-update
```
