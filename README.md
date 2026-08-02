# Torch Client

Cross-platform Minecraft launcher built with Electron.

## Downloads (Dev-Reds/website-nuxt)

| Plattform | Link |
|-----------|------|
| Windows | [Torch-Client-Windows-Installer.exe](https://github.com/Dev-Reds/website-nuxt/releases/latest/download/Torch-Client-Windows-Installer.exe) |
| Linux   | [Torch-Client-Linux-x64.tar.gz](https://github.com/Dev-Reds/website-nuxt/releases/latest/download/Torch-Client-Linux-x64.tar.gz) |
| macOS   | [Torch-Client-Mac-x64.zip](https://github.com/Dev-Reds/website-nuxt/releases/latest/download/Torch-Client-Mac-x64.zip) |
| Launcher.zip | [Launcher.zip](https://github.com/Dev-Reds/website-nuxt/releases/latest/download/Launcher.zip) |

## Development

```powershell
# Dependencies installieren
npm install

# App starten
npm start

# Lokale Installer bauen (vorher exe/ füllen)
npm run build-installer

# Icons generieren
node scripts/generate-icons.js
```

### Direkt mit electron-builder

```powershell
npx electron-builder --win        # Windows Installer
npx electron-builder --linux      # Linux .tar.gz + .zip
npx electron-builder --mac        # macOS .zip
```

### Manuelles Packaging (ohne electron-builder)

```powershell
node scripts/package-all.js       # Windows + Linux
node scripts/package-mac.js       # macOS
```

## CI/CD (GitHub Actions)

Workflow: `.github/workflows/build.yml`

### Workflow manuell triggern

```powershell
gh workflow run build.yml --ref main `
  -f upload-to=Dev-Reds/website-nuxt `
  -f release-tag=v1.0.0 `
  -R Dev-Reds/crux-client
```

### Aktuelle Runs anzeigen

```powershell
gh run list --limit 5 -R Dev-Reds/crux-client
gh run watch <run-id> -R Dev-Reds/crux-client
```

### Release Assets verwalten

```powershell
# Assets auflisten
gh release view v1.0.0 -R Dev-Reds/website-nuxt

# Einzelnes Asset löschen
gh release delete-asset v1.0.0 "<filename>" --yes -R Dev-Reds/website-nuxt
```

## Git & GitHub

```powershell
# Status
git status

# Committen
git add -A
git commit -m "<message>"

# Pushen
git push

# Remote
git remote -v
```

## Benötigte Secrets (GitHub)

| Secret | Beschreibung |
|--------|-------------|
| `GH_PAT` | Personal Access Token mit `repo` Scope für Cross-Repo Uploads |

```powershell
# Secret setzen
gh secret set GH_PAT --body "<token>" -R Dev-Reds/crux-client
```

## Repository Struktur

```
client-mod/        # Client-Module
exe/               # Kompilierte Clients (vor Build)
icons/             # App-Icons
installer/         # Build-Output
scripts/           # Build-Skripte
.github/workflows/ # CI-Pipeline
```
