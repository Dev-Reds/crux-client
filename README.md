# Crux Client

Cross-platform Minecraft launcher built with Electron.

## WICHTIG: Installer-Filenames

> **Die folgenden Dateinamen dürfen sich NIE ändern**, da sie auf der Website und im Auto-Update System verwendet werden:
>
> - `Crux-Client-Installer.exe` (Windows Installer)
> - `Launcher.zip` (Auto-Update)
>
> Neue Releases MÜSSEN diese exakten Dateinamen verwenden. Die `latest` Release muss diese Dateien immer enthalten.

## Schnellstart

```bash
npm install
npm start
```

### Voraussetzungen

- [Node.js](https://nodejs.org) (v18 oder höher)
- npm (wird mit Node.js mitgeliefert)

### Erste Schritte

1. Code.zip herunterladen und entpacken
2. Terminal im entpackten Ordner öffnen
3. `npm install` ausführen (installiert alle Abhängigkeiten)
4. `npm start` ausführen (startet den Launcher)

## Downloads

| Plattform | Link |
|-----------|------|
| Windows | [Crux-Client-Installer.exe](https://github.com/Dev-Reds/crux-client/releases/latest/download/Crux-Client-Installer.exe) |
| Linux | [Crux-Client-Linux-x64.zip](https://github.com/Dev-Reds/crux-client/releases/latest/download/Crux-Client-Linux-x64.zip) |
| Linux | [Crux-Client-Linux-x64.tar.gz](https://github.com/Dev-Reds/crux-client/releases/latest/download/Crux-Client-Linux-x64.tar.gz) |
| macOS | [Crux-Client-Mac-Installer.zip](https://github.com/Dev-Reds/crux-client/releases/latest/download/Crux-Client-Mac-Installer.zip) |
| Quellcode | [Code.zip](https://github.com/Dev-Reds/crux-client/releases/latest/download/Code.zip) |

## Entwicklung

```bash
# Dependencies installieren
npm install

# App starten
npm start

# Icons generieren
node scripts/generate-icons.js

# Installer bauen
npx electron-builder --win        # Windows
npx electron-builder --linux      # Linux
npx electron-builder --mac        # macOS
```

## CI/CD (GitHub Actions)

Workflow: `.github/workflows/build.yml`

## Repository Struktur

```
main.js              # Electron Hauptprozess
index.html           # UI (HTML + CSS + JS)
package.json         # Dependencies und Build-Config
Crux-Client.png      # App Icon
icons/               # Generierte Icons (ico, png, favicon)
scripts/             # Build-Skripte
client-mod/          # Begleitender Fabric Client-Mod
installer/           # Build-Output
exe/                 # Gebaute Apps
.github/workflows/   # CI-Pipeline
```
