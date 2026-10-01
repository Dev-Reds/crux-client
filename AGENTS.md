# AGENTS.md — Crux Launcher

## Mesa3D / AMD GPU Crash Fix

### Problem
AMD-Treiber (`atio6axx.dll`) stürzt Minecraft mit `EXCEPTION_ACCESS_VIOLATION` ab, wenn LWJGL OpenGL lädt.

### Lösung: Java Agent + Mesa3D + Zink

1. **Mesa3D** wird bei Launcher-Start in `ensureMesaAgent()` bereitgestellt:
   - `mesa-release.sf.net` → `mesa3d-*.7z` herunterladen
   - Mit `7zr.exe` extrahieren nach `%APPDATA%\CruxClient\mesa\`
   - `7zr.exe` von `www.7-zip.org/a/7zr.exe` (wird gecached)

2. **Java Agent** (`MesaAgent.jar`):
   - Wird aus Source in `mesa-agent/MesaAgent.java` kompiliert und als JAR gepackt
   - Wird via `-javaagent:path\to\MesaAgent.jar=mesaGL` an JVM-Args angehängt
   - In `premain()` wird `System.load(vollpfad)` für `mesa\opengl32.dll` aufgerufen
   - Das lädt Mesa in den Prozess, BEVOR GLFW `LoadLibrary("opengl32.dll")` aufruft
   - Windows findet dann die bereits geladene Mesa-DLL statt der System-`opengl32.dll`

3. **Zink** Treiber:
   - `GALLIUM_DRIVER=zink` als Env-Variable setzen (NeoForge-Spawn + MCLC options)
   - Mesa nutzt dann Zink (OpenGL→Vulkan) statt llvmpipe
   - Texturen werden korrekt gerendert (llvmpipe hatte Buggy-Texturen)

4. **Integration in main.js**:
   - `ensureMesaAgent()` ~line 3120: lädt Mesa, kompiliert Agent, fügt JVM-Args hinzu
   - `getMesaDlls()`: findet `opengl32.dll` im Mesa-Ordner
   - **Native GPU ist der Standard** — Mesa/Zink wird NUR geladen, wenn `forceSoftwareGL` gesetzt ist
   - Läuft ein AMD-Treiber-Crash ohne `forceSoftwareGL`, wird der Flag automatisch gesetzt (nächster Start nutzt Mesa)

### Release-Prozess

```powershell
# Version in package.json erhöhen
# Commit + Tag
git add . && git commit -m "Nachricht"
git push origin main
git tag v1.1.xx
git push origin v1.1.xx

# GitHub Release erstellen + Assets hochladen
gh release create v1.1.xx --title "Crux Client v1.1.xx" --notes "Release notes..."
gh release upload v1.1.xx installer/Crux-Client-Installer.exe --clobber

# crux_code.zip bauen (Node.js archiver)
node -e "..."   # siehe main.js oder Skripte

# Upload zu crux-code repo
gh release upload v1.1.xx crux_code.zip --clobber -R Dev-Reds/crux-code
```

### Mod-Loading Bug

- `cleanMods()` löscht alle JARs im Mods-Ordner, inkl. der von mrpack-deployten Mods
- Fix: Nach `cleanMods()` werden `diskPath`-Mods erneut deployed (loop ~lines 1420-1424)
- Gleiche Copy-Logik wie beim initialen Deployment
- Mods OHNE `modrinthId` werden korrekt erhalten

### Installer

- NSIS-Installer in `installer/`
- `package.json`: `"runAfterFinish": true` (Autostart nach Installation)
- `custom-shortcuts.nsh`: Custom Page für Desktop/Startmenü-Verknüpfungen
- `createDesktopShortcut` / `createStartMenuShortcut` in package.json steuern defaults
- Kein `!define DONT_RUN_APP_AFTER_INSTALL` (damit Auto-Start aktiv ist)

### Dev-Builds (Update-Detection aus)

Version mit `-dev`-Suffix (z.B. `1.1.70-dev`) in `package.json` **und** `package-lock.json`
(zwei Stellen: Top-Level + `packages[""]`). Dadurch ist der Build automatisch update-frei:

- `main.js`: `IS_DEV_BUILD = /-dev\b/i.test(CURRENT_VERSION)` (main.js:3526)
  - `check-for-update` → `{ updateAvailable:false, devBuild:true }`, kein GitHub-Call (main.js:3594)
  - `download-and-install-update` → wirft Fehler (main.js:3727)
- `index.html`: `DEV_BUILD` analog aus package.json (index.html:1930)
  - kein Auto-Check beim Boot (index.html:2104)
  - `checkForUpdates()` bricht sofort ab (index.html:8117)
  - Settings-Button "Check for Updates" ist deaktiviert + umgelabelt (index.html:8783)

**Wichtig:** Ein Dev-Build NIEMALS taggen und KEIN `gh release create` aufrufen.
Update-Detection der User liest `https://api.github.com/repos/Dev-Reds/crux-client/releases`
und filtert `!r.prerelease` + `/^v?\d+\.\d+\.\d+/` — ein Tag `v1.1.70-dev` würde dort
ignoriert, aber ein Release-Tag `v1.1.70` **nicht**. Nur `main` bekommt Releases.

### Push ohne persistierten Token

`.git/config` darf **keinen** `http.https://github.com/.extraheader` enthalten — sonst
`remote: Duplicate header: "Authorization"` (HTTP 400). Token nur pro Befehl:

```powershell
$tok='<PAT>'
$pair=[Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$tok"))
git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $pair" -c credential.helper= push -u origin dev
```

Alte `ghs_`-Header vorher entfernen: `git config --local --unset-all http.https://github.com/.extraheader`

### PowerShell-Dateien: Kodierung

`main.js` liest `update-window.ps1` / `uninstall-window.ps1` mit `encoding:'utf8'` und
schreibt den BOM selbst (`'\uFEFF' + readFileSync(...)`). Die Dateien MÜSSEN UTF-8 sein.
PowerShell-Redirect (`> file`) erzeugt unter Windows UTF-16LE → Skript läuft nicht.
Bei Konfliktauflösung immer prüfen:
```powershell
git hash-object update-window.ps1   # muss == gewünschtem Blob stehen
```
