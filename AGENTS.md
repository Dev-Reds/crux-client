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
- Bauen: `npm run build-installer` (electron-builder 24.13.3, ~2 min, ~102 MB)
- **Signatur-Bug**: das Nachsignieren in `installer/build-installer.js` schlägt fehl
  (Ergebnis `NotSigned`, obwohl `CN=Crux Client` in `Cert:\CurrentUser\My` liegt).
  Deshalb IMMER danach manuell prüfen und ggf. nachsignieren:
  ```powershell
  Get-AuthenticodeSignature installer\Crux-Client-Installer.exe | Select-Object Status
  # NotSigned ->
  $cert=Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -like '*Crux Client*' } | Select-Object -First 1
  Set-AuthenticodeSignature -FilePath 'installer\Crux-Client-Installer.exe' -Certificate $cert `
    -TimestampServer 'http://timestamp.digicert.com' -HashAlgorithm SHA256
  ```

### Bedrock Edition

Bedrock hat **keine** Versionsliste. Es gibt genau 2 auswählbare Optionen:

| Wert `mcVersion` | Anzeige | AUMID |
|---|---|---|
| `''` | Latest Release | `Microsoft.MinecraftUWP_8wekyb3d8bbwe!App` |
| `'__latest_prerelease__'` | Latest Pre-release | `Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe!App` |

- `index.html:3766-3772`: bei `modLoader==='bedrock'` wird die Java-Version-Liste
  gar nicht erst aufgebaut — nur die zwei Optionen, danach `return`.
- `index.html:3393-3411` (`updateModLoaderVisibility`): versteckt Mods/Resourcepacks/
  Shaderpacks/Render-API/Offline-Button, lässt nur Name, Version, Save, Share, Delete.
- **Start ohne Ordner-Fenster**: `launchBedrock()` (main.js:1755) schreibt ein
  PowerShell-Skript nach `%TEMP%\crux-activate-app.ps1` und ruft es mit
  `IApplicationActivationManager.ActivateApplication($aumid)` auf
  (COM-Interop via `Add-Type`). Verstecktes Fenster (`-WindowStyle Hidden`), 30 s Timeout.
  - NIEMALS `explorer.exe shell:appsFolder\...` — das öffnet den Apps-Ordner.
  - NIEMALS zusätzlich `start minecraft:` — das war ein Doppelstart.
  - Pre-Release-AUMID gegen die echte Installation prüfen:
    `Get-StartApps | Select-String Minecraft`

### Stats

Das Stats-Feature (Launch-Tab-Statistiken) ist **entfernt** und darf nicht wieder
eingeführt werden. `index.html` und `main.js` enthalten bewusst KEINE
`renderLaunchStats` / `load-stats` / `stat_*`-Symbole mehr.

### Dev-Builds (Update-Detection aus)

Version mit `-dev`-Suffix (z.B. `1.1.70-dev`) in `package.json` **und** `package-lock.json`
(zwei Stellen: Top-Level + `packages[""]`). Dadurch ist der Build automatisch update-frei:

- `main.js`: `IS_DEV_BUILD = /-dev\b/i.test(CURRENT_VERSION)`
  - `check-for-update` → `{ updateAvailable:false, devBuild:true }`, kein GitHub-Call
  - `download-and-install-update` → wirft Fehler
- `index.html`: `DEV_BUILD` analog aus package.json
  - kein Auto-Check beim Boot
  - `checkForUpdates()` bricht sofort ab
  - Settings-Button "Check for Updates" ist deaktiviert + umgelabelt

**Wichtig:** Ein Dev-Build NIEMALS mit `v?\d+\.\d+\.\d+` taggen. Update-Detection der
User liest `https://api.github.com/repos/Dev-Reds/crux-client/releases` und filtert
`!r.prerelease` + `/^v?\d+\.\d+\.\d+/` (main.js:3626). Ein Release-Tag `v1.1.70`
**wäre** sichtbar, `dev-1.1.70` ist es doppelt nicht (matcht den Regex nicht UND ist
prerelease). Nur `main` bekommt Version-Releases.

**Dev-Installer trotzdem bereitstellen** (z.B. zum Weitergeben): Tag `dev-<version>` auf
`dev` mit `prerelease=true` + Asset hochladen. User-Update-Dialog bleibt auf `v1.1.69`.
Ohne `gh` CLI geht es über die REST API:
```powershell
$h=@{ 'User-Agent'='CruxClient'; 'Authorization'="Bearer $tok"; 'Accept'='application/vnd.github+json' }
$r=Invoke-RestMethod -Method Post -Uri 'https://api.github.com/repos/Dev-Reds/crux-client/releases' `
  -Headers $h -Body ([Text.Encoding]::UTF8.GetBytes($json)) -ContentType 'application/json'
Invoke-RestMethod -Method Post -Uri "https://uploads.github.com/repos/Dev-Reds/crux-client/releases/$($r.id)/assets?name=Crux-Client-Installer.exe" `
  -Headers $h -ContentType 'application/octet-stream' -InFile 'installer\Crux-Client-Installer.exe' -TimeoutSec 900
```

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
