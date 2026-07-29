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
   - Wird vor jedem Minecraft-Start aufgerufen

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
