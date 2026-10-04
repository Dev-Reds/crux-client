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
- **Startseite** (`customInit` + `customWelcomePage` in `installer/custom-shortcuts.nsh`):
  erkennt eine bestehende Installation über `HKCU/HKLM\Software\${APP_GUID}\InstallLocation`
  + `UNINSTALL_REGISTRY_KEY\DisplayVersion` und zeigt dann **nur** „Update to version X“ und
  „Uninstall Crux Client“. Ohne bestehende Installation gibt es nur „Install“.
  - Update-Modus: `customInstallMode` überspringt den Benutzer-/Installationsmodus-Dialog
    (Hook in `multiUserUi.nsh:41`), `$INSTDIR` = alter InstallLocation. Die **Ordnerseite**
    bleibt beim manuellen Update sichtbar (vorausgefüllt) — `skipPageIfUpdated` kann nicht
    überschrieben werden (Makro-Redefinition), beim stillen `/S --updated` wird sie per
    Template ohnehin übersprungen.
  - Reihenfolge in `.onInit`: `initMultiUser` (installer.nsi:70) läuft **vor** `customInit`
    (:72) → `$installMode`/`$INSTDIR` stehen beim Löschen der Registry fest.
  - Update läuft über `uninstallOldVersion` hinweg. Dafür löscht `cruxHideOldVersionReg`
    vorher `UninstallString`/`QuietUninstallString`/`InstallLocation` der alten Installation
    (passend zu `$installMode`), sonst würde der Installer die App samt
    `%APPDATA%\Crux Client` deinstallieren. `registryAddInstallInfo` schreibt sie neu.
  - Deinstallieren: `cruxDoUninstall` fragt nach, prüft `CHECK_APP_RUNNING` und ruft
    den alten Uninstaller mit `/S /currentuser` bzw. `/S /allusers`.
  - NSIS-Fallen hier: `!macro` darf nicht doppelt definiert werden, LogicLib-`${If}` kann
    keine geklammerten `MessageBox`-Ausdrücke, und der Build läuft mit `-WX` (jede
    Warnung ist ein Fehler) → ungenutzte Vars per `!ifdef BUILD_UNINSTALLER` ausblenden.
- `custom-shortcuts.nsh`: Custom Page für Desktop/Startmenü-Verknüpfungen
- `createDesktopShortcut` / `createStartMenuShortcut` in package.json steuern defaults
- Kein `!define DONT_RUN_APP_AFTER_INSTALL` (damit Auto-Start aktiv ist)
- Bauen: `npm run build-installer` (electron-builder 24.13.3, ~2 min, ~102 MB)
- **Signatur**: `installer/build-installer.js` signiert am Ende selbst. Es MUSS
  `-EncodedCommand` (UTF-16LE + Base64) benutzen — mit `-Command "…"` schluckt cmd.exe
  die inneren Anführungszeichen, PowerShell läuft ins Leere und das Ergebnis ist
  `NotSigned`, ohne Fehlermeldung (2026-10-04 gefixt). Das Skript prueft danach selbst
  per `Get-AuthenticodeSignature` und meldet `SIGNING FAILED: …`.
  Nach dem Build trotzdem gegenpruefen und ggf. manuell nachsignieren:
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
| `''` | Latest Release | `Microsoft.MinecraftUWP_8wekyb3d8bbwe!Game` |
| `'__latest_prerelease__'` | Latest Pre-release | `Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe!Game` |

- `index.html` `openProfileModal()`: bei `modLoader==='bedrock'` wird die Java-Version-Liste
  nicht aufgebaut — nur die zwei Optionen. **KEIN `return`**, sonst öffnet das Modal gar nicht
  (das war der Bug in 1.1.70-dev). `setProfileSection()` darf bei Bedrock `.profile-section`
  nicht wieder auf `display:''` setzen.
- `index.html` `updateModLoaderVisibility()`: versteckt Mods/Resourcepacks/
  Shaderpacks/Render-API/Offline-Button, lässt nur Name, Version, Save, Share, Delete.
  Für **`vanilla`** gelten dieselben Regeln (kein Loader → Mods, Shader Packs, Render-API,
  „Use Crux Client Features" und „Use Client Mods" werden ausgeblendet; Datapacks,
  Resource Packs und „Use Client Resource Packs" bleiben). ACHTUNG: Datapacks/RPs liegen
  **innerhalb** von `#profile-mods-section` — dieses Element darf für Vanilla **nicht**
  versteckt werden, sonst verschwinden die Packs mit. Die Mods-Liste blendet
  `setProfileSection()` über `#profile-split-left` aus. `openProfileModal()` öffnet bei
  ausgeblendetem Mods-Tab auf `datapacks`.
- **AUMID endet auf `!Game`, NICHT `!App`** — das Application-Id im AppxManifest heißt `Game`.
  Mit `!App` liefert `ActivateApplication` HRESULT `0x80270254`.
  AUMID-Gefahr prüfen: `[xml]$m=Get-Content (Join-Path (Get-AppxPackage -Name Microsoft.MinecraftUWP).InstallLocation 'AppxManifest.xml'); $m.Package.Applications.Application.Id`
- **Bedrock hat kein `inst.process`** (UWP-Prozess, nicht vom Launcher gestartet). Die PID aus
  `launchBedrock()` wird über `watchBedrockProcess(instanceId, pid)` alle 3 s per
  `process.kill(pid, 0)` geprüft. Ist die PID weg, sendet main `instance-closed` → der Renderer
  setzt `status='closed'` (Anzeige `■`). Ohne diesen Watcher bleibt eine Bedrock-Instanz
  nach dem Schließen **ewig auf "running"**. `stop-minecraft` killt zusätzlich `inst.bedrockPid`
  per `taskkill /PID … /F /T` und räumt den Watcher auf.
- **HRESULT muss geprüft werden**: `Marshal.ThrowExceptionForHR` + `pid -le 0` als Fehler.
  Sonst meldet der Launcher "OK:0" als Erfolg, obwohl nichts gestartet wurde.
- **Auto-Installation** (`ensureBedrockInstalled()`, main.js): Bedrock ist ein Store-MSIX-Paket,
  kein plain Download. Ablauf: `Get-AppxPackage -Name Microsoft.MinecraftUWP` (bzw.
  `...WindowsBeta`) → fehlt es, `shell.openExternal('ms-windows-store://downloadsandopen?id=<ID>')`,
  dann 5 s pollen (max. 5 min), danach Start. Store-Produkt-IDs: `9NBLGGH2JHXJ` (Minecraft for
  Windows), `9P5X4QVLC2XR` (Minecraft Preview for Windows).
  - `winget --source msstore` findet Minecraft **nicht** (`winget show --id 9NBLGGH2JHXJ` → kein
    Paket), also kein winget-Pfad. `.msixvc` von der Store-CDN sind DRM-verschlüsselt und ohne
    Store nicht installierbar.
- **Start ohne Ordner-Fenster**: `launchBedrock(aumid, send, instanceId)` schreibt ein
  PowerShell-Skript nach `%TEMP%\crux-activate-app.ps1` und ruft es mit
  `IApplicationActivationManager.ActivateApplication($aumid)` auf
  (COM-Interop via `Add-Type`). Verstecktes Fenster (`-WindowStyle Hidden`), 30 s Timeout.
  - NIEMALS `explorer.exe shell:appsFolder\...` — das öffnet den Apps-Ordner.
  - NIEMALS zusätzlich `start minecraft:` — das war ein Doppelstart.

### Glass Theme: Listen werden ignoriert (`--gs-list`)

Zwei Fallen, die beide schon zugeschlagen haben (2026-10-03, Glass-Listen blieben weiß):

1. **`setGlassTone()` überschreibt `--gs-list` als Inline-Style auf `document.body`.**
   Das gewinnt gegen jede `body.glass{...}`-Regel im `<style>`. Der Wert darf dort
   **nicht** hart verdrahtet werden. Helle Bilder lassen die CSS-Variable jetzt durch
   (`st.removeProperty('--gs-list')`), nur der dunkle Ton setzt `rgba(0,0,0,.3)`.
   Wer die Listen-Deckkraft ändern will, ändert `--gs-list` in der `body.glass`-Regel.
2. **`body.light`-Regeln stehen im `<style>` NACH dem Glass-Block** und gewinnen bei
   gleicher Spezifität (z.B. `.logs-container`, `.feature-card`, `.profile-split`).
   Alle Transparenz-Overrides stehen deshalb im Block
   `GLASS TRANSPARENCY — MUST STAY LAST` ganz am Ende des `<style>`.
   Betroffen war u.a. das aufgeklappte Custom-Dropdown: `body.light .cdrop-menu` setzte
   `#fff !important` → weiße Liste. Auch `.cdrop-opt:hover/.sel/.disabled` und die
   Textfarben des Triggers werden dort für `.glass` neu gesetzt.

Verwandt: der **Mod-Loader im Profil-Modal ist keine `<select>`**, sondern eine
   Radio-Reihe (`.modloader-row` / `.modloader-pick`) und sieht deshalb anders aus als
   die Dropdowns. Die Pills sind bewusst mit denselben Werten wie `.cdrop-trigger`
   nachgebaut (Glas-Fläche, `--gs-*`, Akzent nur bei `:has(input:checked)`). (die laden das Theme gar nicht), sondern
mit der echten App + Messung im Live-DOM. Muster: temporäre Harness-Datei **im Repo-Root**
(bei `loadFile('index.html')` zählt `process.cwd()`, nicht der Skriptort), vor
`require('main.js')` `process.env.APPDATA` auf einen Temp-Ordner setzen, dann per
`webContents.executeJavaScript` `getComputedStyle` aller Elemente auswerten. Datei danach löschen.

### Standard-Hintergrundbilder (Auswahl + Akzentfarbe, Toggle im Profil-Stil)

- `main.js` `get-default-glass-bgs`: liefert **alle** `icons/default_background*.png|jpg|webp`,
  natuerlich sortiert nach der Zahl in Klammern (`(2)`, `(3)`, ...).
  Neue Default-Bilder einfach in `icons/` ablegen, keine Code-Aenderung noetig.
  Renderer haelt `glassDefaultBgs` (Array); die Auswahl steckt in `settings.glassBgPreset` (Index).
- Settings-UI: `#glass-bg-presets` mit `.gbg-preset`-Kacheln (`renderGlassBgPresets()`).
  Klick setzt `glassBgPreset` **und** leert `glassBgImage` (sonst waere es kein Default mehr).
  Eigenes Bild ueber "Choose Image" -> Preset-Kacheln unmarkiert, "Remove" faellt auf das
  gewaehlte Default zurueck.
- Akzentfarbe als **`.mod-switch`-Toggle** (`<label class="mod-switch"><input
  id="glass-bg-tint-input" checked><span class="slider"></span></label>`) - gleicher
  Schalter wie "Use Crux Client Features" im Profil-Modal. `settings.glassBgTint` ist per
  `!== false` **standardmaessig AN** (undefined = an). Nur bei eigenem Bild wird nie gefaerbt.
- **WICHTIG Chromium-Falle:** Custom Properties mit sehr grossem Wert werden verworfen.
  Ein 2,4-MB-PNG als data-URL (~3,3 MB) in `--gs-frame` ergab `getPropertyValue() === ''`
  und das Bild wurde gar nicht angezeigt (nur der `var(--gs-frame, <fallback>)`-Gradient).
  Deshalb geht JEDES Bild ueber `toCssImage()`: > `CSS_IMG_LIMIT` (900000 Zeichen) wird
  per Canvas auf max. 1600 px / JPEG 0.85 verkleinert (~0,3-0,4 MB) und danach gesetzt.
- `tintDefaultBg()` zeichnet das Bild im Canvas mit `globalCompositeOperation='color'`
  (Farbton der Akzentfarbe, Helligkeit bleibt) + `'overlay'` leicht obendrauf,
  `globalAlpha` 0.7 / 0.25. ES BLEIBT DASSELBE BILD - kein zweites Bild, kein CSS-Overlay.
  Farbwechsel im Tab Color: `applyAccent()` ruft am Ende `applyGlassBg()` auf (nur wenn
  `settings.glassBgTint !== false`).
- Cache: `_cssImgCache` (Key Laenge+Prefix), `_tintCache` (Key `id|accent`), Quellbild in
  `_tintSrcIm`. Erste Faerbung ca. 50 ms, danach 0 ms.
- `paint()` setzt erst das Originalbild, dann das gefaerbte - `_glassBgToken` verhindert,
  dass ein langsamer Canvas-Lauf ein spaeter gewaehltes Bild ueberschreibt.

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

`main.js` liest `update-window.ps1` mit `encoding:'utf8'` und
schreibt den BOM selbst (`'\uFEFF' + readFileSync(...)`). Die Date MUSS UTF-8 sein.
PowerShell-Redirect (`> file`) erzeugt unter Windows UTF-16LE → Skript läuft nicht.
Bei Konfliktauflösung immer prüfen:
```powershell
git hash-object update-window.ps1   # muss == gewünschtem Blob stehen
```

### Update-Ablauf (kein Deinstallieren mehr)

`uninstall-window.ps1` ist **entfernt** (gelöscht + aus `package.json` `files` raus).
Grund: Das Update macht jetzt ein echtes In-Place-Update über den Installer.

- `main.js` `download-and-install-update`: Download läuft **ohne** externes Fenster
  (Fortschritt im Renderer-Overlay `update-download-progress`). Erst **nach** fertigem
  Download ruft der Handler `startUpdateProgressWindow()` auf — das ist die ganze
  Anforderung „Bildschirm erst zeigen, wenn die Datei da ist“.
- `startUpdateProgressWindow()` löscht vorher `crux-update-progress.json` (sonst zeigt
  das neue Fenster sofort 100 % aus der alten Datei), schreibt `phase:'install'` und
  startet das PS-Fenster detached.
- Die Batch-Datei startet `"<Installer>" /S --updated` (`start /wait`) und danach
  `start "" "<InstallDir>\<Crux Client.exe>"` — der Launcher startet sich selbst neu,
  also Pfad hart aus `app.getPath('exe')` nehmen, nicht `process.execPath` (im
  Dev-Mode zeigt das auf node.exe).
- Reihenfolge in der Batch: Installer → `echo done > %TEMP%\crux-update-installed.flag`
  → `update-window.ps1 set launch` → Launcher starten.
- Beim Boot: liegt `base\Crux-Client-Installer.exe` **und** weder `base\update-migrated.flag`
  **noch** `%TEMP%\crux-update-installed.flag` vor, wird das Update automatisch gestartet.
  Nach dem Installer-Lauf wird die `installed.flag` gesetzt, damit der liegengebliebene
  Installer beim nächsten Start **nicht** nochmal läuft. Beide Flags + Installer werden
  im normalen Boot-Pfad wieder gelöscht.
- `update-window.ps1` kennt nur noch `install` / `launch` / `done` / `cancel`
  (alte Phase `uninstall` entfernt). Das Skript kommt als **UTF-8 ohne BOM** in git;
  der BOM wird von `main.js` beim Kopieren nach `%TEMP%` gesetzt.
- **PS-Falle im selben Skript**: der `DispatcherTimer.Add_Tick`-Handler läuft in einem
  eigenen Scope. `$phase = …` darin blieb im Child-Scope hängen → Text wechselte nie
  und das Fenster schloss nie (jeder andere Handler-Code sieht davon nichts). Zustand
  liegt deshalb in der Hashtable `$S` (`$S.phase`, `$S.cur`, …) — Hashtable-Mutationen
  sind scope-unabhängig. `$win.Close()` als Methodenaufruf war immer schon ok.

### Recent: Instances / Servers / Welten

- Ein Profil-**Start** ist **immer** `type:'instance'` — auch Vanilla, auch wenn im Profil eine
  Server-Adresse hinterlegt ist. Beim Start gibt es KEINEN Server- und KEINEN World-Eintrag.
- **Server**-Eintrag nur, wenn in-game wirklich gejoint wird: `Connecting to server, host:port`,
  `Connecting to host,port` oder `Server IP: host` (`ipcRenderer.on('instance-log')`).
- **Welt**-Eintrag nur bei echter Welt im Spiel: `Preparing level "Name"` / `Loading level "Name"`,
  Fallback `Loaded n advancements from ...\saves\<Ordner>\...`. Der Save-**Ordner** wird
  nachgetragen, sobald die advancements-Zeile kommt (`_worldFolder`, wird in recentHistory gespeichert).
- Migration beim Boot: `type==='world' && !worldName && !worldId` → `instance` (Alte Schein-Welten).
- `recentEntryKey()`: Welten über `worldName`, Server über Adresse+Port entprechen — nicht über
  das Profil, sonst überschreiben sich zwei Welten im selben Profil.
- **Join aus Recent:**
  - Server: `pendingLaunchServer` → `--server`/`--port` (in beiden Launch-Pfaden: Vanilla/NeoForge
    und MCLC).
  - Welt: `pendingLaunchWorld` → `worldFolder` → main.js `worldJoinArgs()`.
    Ordner-Auflösung: Ordner == Weltname? sonst `LevelName` aus `level.dat`
    (`readLevelNameFromDat()`, gzip + roh, NBT-String-Scan), sonst normalisiert/Quasi-Gleichstand.
  - **Nur Java ≥ 1.20** kennt `--quickPlaySingleplayer`. Für Bedrock und <1.20 gibt es keinen
    Auto-Join; Fallback `markSaveAsLastPlayed()` schreibt `LastPlayed` (TAG_Long, 8 Byte — Länge
    bleibt gleich, NBT-Offsets bleiben gültig) in die `level.dat`, damit die Welt oben in der
    Singleplayer-Liste steht. Ein Klick bleibt nötig.
