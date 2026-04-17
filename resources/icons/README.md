# Icônes AlfyChat Desktop

Placez ici les fichiers :
- `icon.png`  — 256×256 px (requis par Neutralino pour Windows/Linux)
- `icon.ico`  — Windows (multi-résolution : 16, 32, 48, 256)
- `icon.icns` — macOS

Un SVG source (`icon.svg`) est fourni. Pour générer les formats :

```bash
# Via ImageMagick
magick icon.svg -resize 256x256 icon.png
magick icon.png -define icon:auto-resize=256,48,32,16 icon.ico

# Via sharp (Node.js)
npx sharp-cli -i icon.svg -o icon.png --width 256 --height 256
```

En production, remplacez par les vraies icônes AlfyChat brandées.
