# Dev-Build 1.1.70-dev — Abgeschlossen

Stand: 01.10.2026. Merge abgeschlossen, als **Dev-Build** veroeffentlicht — **kein Release**.

## Ergebnis
- Merge-Commit `9be27e0` auf Branch **`dev`** gepusht (`origin/dev`)
- **`main` unveraendert** auf `27ba389` (v1.1.69) — User bekommen kein Update
- **Kein** Tag `v1.1.70-dev`, **kein** GitHub Release, **kein** Installer-Upload
- Version in `package.json` / `package-lock.json`: `1.1.70-dev`

## Update-Detection im Dev-Build AUS
`main.js`:
- `IS_DEV_BUILD = /-dev\b/i.test(CURRENT_VERSION)` (main.js:3526)
- `check-for-update` gibt sofort `{ updateAvailable:false, devBuild:true }` zurueck (main.js:3594)
- `download-and-install-update` wirft Fehler (main.js:3727)

`index.html`:
- `DEV_BUILD` analog aus package.json (index.html:1930)
- Kein Auto-Check beim Boot (index.html:2104)
- `checkForUpdates()` bricht sofort ab (index.html:8117)
- Button "Check for Updates" ist deaktiviert + beschriftet (index.html:8783)

## Merge-Entscheidungen (index.html)
| Konflikt | Entscheidung |
|---|---|
| Glass-Theme-CSS (~180 Z.) | HEAD behalten |
| Datapacks/RP/SP Buttons | origin/main (CurseForge-Button) |
| Save-Button `save-profile-btn` | HEAD (Bedrock) |
| `applyTheme()` | HEAD (glass + win7/xp-Cleanup) |
| i18n `stat_*` (en/de/fr/es) | origin/main |
| Save-Button Handler | HEAD |

## Zusatzliche Fixes waehrend der Aufloesung
- **main.js**: Stats-Block war nach Konfliktaufloesung verschwunden, aber `stats` /
  `P.stats` / `_lastLauncherTick` wurden noch referenziert → Block + `P.stats`-Pfad
  wiederhergestellt → **danach auf Nutzerwunsch komplett entfernt (siehe Nachtrag unten)**
- **index.html**: doppelter "Recent Played"-Block (Merge-Artefakt) → entfernt,
  Launch-Stats-UI (`#launch-stats`) + `renderLaunchStats()` + `fmtDuration/fmtRelative/fmtDate`
  aus origin/main ergaenzt (CSS, visibilitychange, showPage, Boot) →
  **danach auf Nutzerwunsch komplett entfernt (siehe Nachtrag unten)**
- **update-window.ps1** war als UTF-16LE mit BOM im Worktree → in UTF-8 umgewandelt,
  entspricht jetzt Byte fuer Byte `origin/main:update-window.ps1`
  (wichtig: `main.js` liest die Datei mit `encoding:'utf8'` und schreibt BOM selbst)

## Verifikation
- `node --check main.js` → OK
- 5 Inline-Script-Bloecke in index.html via `vm.Script` geparst → 0 Fehler
- HTML-Tag-Balance (eigener Checker) → 0 Fehler, 0 unclosed
- Konfliktmarker in allen Dateien → 0
- `start-hidden.vbs` → nicht vorhanden (gut)

## Push-Befehl (Token via extraheader, ohne Persistenz)
```
$tok='<token>'
$pair=[Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$tok"))
git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $pair" -c credential.helper= push -u origin dev
```
Der alte `ghs_`-extraheader in `.git/config` wurde entfernt (erzeugte sonst
`remote: Duplicate header: "Authorization"`).

## Nachtrag: Stats entfernt + Bedrock-Versionen (Commit `932a892`)
- **NUTzerwunsch**: Stats sollen aus dem Launch-Tab **raus** (der Merge hatte sie
  aus origin/main wiederhergestellt) → komplett entfernt, nicht wiederhergestellt:
  - `index.html`: `#launch-stats`-HTML, Launch-Stats-CSS, `renderLaunchStats()`,
    `fmtDuration/fmtRelative/fmtDate`, `load-stats`-Aufrufe, visibilitychange-Handler,
    alle `stat_*`-i18n (en/de/fr/es)
  - `main.js`: kompletter Stats-Block, `P.stats`, `_lastLauncherTick`, Stats-IPC-Handler,
    `launcherOpenMs`/Backup-Liste
  - i18n-Key `ver_latest_prerelease` fuer alle 4 Sprachen NEU ergaenzt
- **Bedrock**: nur noch 2 Versionen waehlbar — "Latest Release" (`mcVersion:''`) und
  "Latest Pre-release" (`mcVersion:'__latest_prerelease__'`). Java-Version-Liste wird
  bei Bedrock-Profiles gar nicht erst aufgebaut (`index.html:3766-3772`).
- **Bedrock-Start ohne Ordner**: `explorer.exe shell:appsFolder\...` + `start minecraft:`
  (Doppelstart, oeffnete Fenster) ersetzt durch `launchBedrock()` (main.js:1755) →
  PowerShell + `IApplicationActivationManager.ActivateApplication()` per AUMID, verstecktes
  Fenster, 30 s Timeout. AUMIDs: `Microsoft.MinecraftUWP_...!App` /
  `Microsoft.MinecraftWindowsBeta_...!App`.

## Installer fuer den Dev-Stand (Release `dev-1.1.70`)
- Tag `dev-1.1.70` auf `dev`, **prerelease=true**, Asset `Crux-Client-Installer.exe`
- `npm run build-installer` (electron-builder 24.13.3) → 102 MB
- ACHTUNG: das Sign-Script in `installer/build-installer.js` schlug fehl (Zertifikat
  `CN=Crux Client` liegt in `Cert:\CurrentUser\My`, aber Ergebnis war `NotSigned`).
  Manuell nachsigniert:
  ```powershell
  $cert=Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -like '*Crux Client*' } | Select-Object -First 1
  Set-AuthenticodeSignature -FilePath 'installer\Crux-Client-Installer.exe' -Certificate $cert `
    -TimestampServer 'http://timestamp.digicert.com' -HashAlgorithm SHA256
  ```
  → `Status: Valid`. Bug in `build-installer.js` ist noch NICHT gefixt.
- **User bekommen kein Update**: der Client-Filter (main.js:3626)
  `/^v?\d+\.\d+\.\d+/` matcht `dev-1.1.70` nicht, `prerelease=true` filtert es doppelt.
  Verifiziert: Clients waehlen weiterhin `v1.1.69`.

## Naechste Schritte
- [ ] `dev` testen (Start, Profile, CurseForge-Buttons, Glass-Theme, Bedrock-Launch)
- [ ] `installer/build-installer.js`: Signatur-Fehler beheben
- [ ] Bedrock-Pre-Release-AUMID gegen echte Installation pruefen
      (`Get-StartApps | Select-String Minecraft`)
- [ ] Wenn alles passt: `main` auf `dev` fast-forwarden, Version auf `1.1.71`,
      Tag + Release — **erst dann** sehen User ein Update
