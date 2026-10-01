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
  wiederhergestellt
- **index.html**: doppelter "Recent Played"-Block (Merge-Artefakt) → entfernt,
  Launch-Stats-UI (`#launch-stats`) + `renderLaunchStats()` + `fmtDuration/fmtRelative/fmtDate`
  aus origin/main ergaenzt (CSS, visibilitychange, showPage, Boot)
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

## Naechste Schritte (bewusst NICHT ausgefuehrt)
- [ ] `dev` testen (Start, Stats, Profile, CurseForge-Buttons, Glass-Theme)
- [ ] Wenn alles passt: `main` auf `dev` fast-forwarden, Version auf `1.1.71`,
      Tag + `gh release create` — **erst dann** sehen User ein Update
