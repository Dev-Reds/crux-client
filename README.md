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

1. Installer für deine Plattform herunterladen
2. Installer ausführen

## Downloads

| Plattform | Link |
|-----------|------|
| Windows | [Crux-Client-Installer.exe](https://github.com/Dev-Reds/crux-client/releases/latest/download/Crux-Client-Installer.exe) |
| Linux | [Crux-Client-Linux-x64.zip](https://github.com/Dev-Reds/crux-client/releases/latest/download/Crux-Client-Linux-x64.zip) |
| Linux | [Crux-Client-Linux-x64.tar.gz](https://github.com/Dev-Reds/crux-client/releases/latest/download/Crux-Client-Linux-x64.tar.gz) |
| macOS | [Crux-Client-Mac-Installer.zip](https://github.com/Dev-Reds/crux-client/releases/latest/download/Crux-Client-Mac-Installer.zip) |

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

## Neues Release erstellen (Anleitung)

### Schritt 1: Version bumpen
```json
// package.json
"version": "1.0.X"
```

### Schritt 2: Installer bauen
```bash
npm install
npm run build-installer
```
Die fertigen Dateien liegen danach in `installer/`:
- `Crux-Client-Installer.exe`
- `Crux-Client-Installer.exe.blockmap`
- `latest.yml`

### Schritt 3: Git committen & pushen
```bash
git add -A
git commit -m "v1.0.X"
git push origin main
```

### Schritt 4: GitHub Release erstellen
1. Gehe zu https://github.com/Dev-Reds/crux-client/releases/new
2. **Tag erstellen:** `v1.0.X`
3. **Title:** `v1.0.X`
4. **Release-Notizen** einfügen (Changelog)
5. **Assets hochladen:**
   - `installer/Crux-Client-Installer.exe`
   - `installer/Crux-Client-Installer.exe.blockmap`
   - `installer/latest.yml`
6. **Release veröffentlichen** (nicht als Draft!)

### WICHTIG: Dateinamen
> **Die folgenden Dateinamen dürfen sich NIE ändern**, da sie im Auto-Update System verwendet werden:
>
> - `Crux-Client-Installer.exe` (Windows Installer)
> - `latest.yml` (Update-Manifest)
>
> Neue Releases MÜSSEN diese exakten Dateinamen verwenden.

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
