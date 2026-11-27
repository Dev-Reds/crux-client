const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu } = require('electron');
try { require('electron').shell && 0; } catch(e){}

const https = require('https');
const http  = require('http');
const { exec, execSync, spawn, execFile } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { URL } = require('url');
const crypto = require('crypto');

let mainWindow;
let authWindow = null;
// Zweites Fenster, das vor dem Launcher-Start ein gefundenes Update anzeigt.
let updateWindow = null;
// Solange das Update-Fenster läuft, bleibt das (versteckt erzeugte) Launcher-
// Fenster unsichtbar. Erst "Later" oder ein Fehler zeigt es.
let suppressMainWindowShow = false;

// ── AppUserModelID (needed for proper taskbar pinning / grouping) ───────────
try { app.setAppUserModelId('com.cruxclient.launcher'); } catch {}

// ── Single instance lock ────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ── Prevent crashes ──────────────────────────────────────────────────────────
const logFile = path.join(process.env.APPDATA || process.env.LOCALAPPDATA || '', 'Crux Client', 'crash.log');
function logDebug(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(logFile, line); } catch {}
}
process.on('uncaughtException', (err) => { logDebug('Uncaught: ' + err.stack); console.error('[Crux] Uncaught exception:', err); });
process.on('unhandledRejection', (reason) => { logDebug('Unhandled: ' + reason); console.error('[Crux] Unhandled rejection:', reason); });

// ── jszip (optional dependency, never abort module load if missing) ──────────
let JSZip = null;
try { JSZip = require('jszip'); } catch (e) { logDebug('jszip not available: ' + e.message); }
function getJszip() {
  if (!JSZip) throw new Error('jszip module not available');
  return JSZip;
}

// ── yauzl (streaming zip reader, for large NoRisk .noriskpack exports) ────────
let yauzl = null;
try { yauzl = require('yauzl'); } catch (e) { logDebug('yauzl not available: ' + e.message); }

// ── Launcher RAM limit ────────────────────────────────────────────────────────
// Der Launcher bekommt nur die Haelfte des eingestellten RAMs. Die andere
// Haelfte bleibt frei, damit das System und die Bedienung fluessig bleiben.
try {
  const settingsFile = path.join(process.env.APPDATA || process.env.LOCALAPPDATA || '', 'Crux Client', 'settings.json');
  const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const launcherRam = parseInt(saved.launcherRam, 10) || 2;
  const halfMb = Math.floor(launcherRam * 1024 / 2);
  const mb = Math.max(512, Math.min(8192, halfMb));
  app.commandLine.appendSwitch('js-flags', `--max-old-space-size=${mb}`);
} catch {}

// ── Paths ──────────────────────────────────────────────────────────────────────
const base = path.join(process.env.APPDATA || process.env.LOCALAPPDATA || '', 'Crux Client');
const P = {
  settings: path.join(base,'settings.json'),
  accounts: path.join(base,'accounts.json'),
  profiles: path.join(base,'profiles.json'),
  mods:     path.join(base,'mods.json'),
  launched: path.join(base,'launched-versions.json'),
  clientMods: path.join(base,'client-mods.json'),
  java: path.join(base,'javaInstallations'),
  mc:   path.join(base,'minecraft'),
  servers: path.join(base,'servers'),
  groups: path.join(base,'groups'),
  instances: path.join(base,'instances'),
  broken: path.join(base,'broken-mods.json'),
  gpuDrivers: path.join(base,'gpu-drivers.json'),
  modCache: path.join(base,'mod-cache'),
};
app.setPath('userData', base);
app.setPath('cache', path.join(base,'Cache'));

// ── Per-profile game directories ──────────────────────────────────────────────
// Every profile launches with its OWN game dir (worlds, mods, config, packs,
// options.txt), while libraries/assets/versions stay shared under P.mc.
function instanceDir(profileId){
  const id = sanitizeFileName(String(profileId || 'default')) || 'default';
  return path.join(P.instances, id);
}

// Default presence server so the Friends tab works out of the box.
// Points to the Render Blueprint service defined in render.yaml (see server/README.md).
const DEFAULT_PRESENCE_SERVER = "https://crux-presence.onrender.com";

// Default chat server so the Chat tab works out of the box.
// Points to the Deno Deploy app (server/chat-server.ts, see server/README.md).
const DEFAULT_CHAT_SERVER = "";

// Default bug-report webhook so shipped installs can report without any setup.
// Ships in cleartext: anyone can extract it from the installed client and post
// to that channel, so give it a dedicated channel with sane permissions.
const DEFAULT_BUGREPORT_WEBHOOK = "https://discord.com/api/webhooks/1556665583133532272/XXnqbE0-Qc3eYXH-gZmvt9UMK5wRJKApGdPk6s9njMN5ltjzmEDpGcXc_TuQjdqYVoTB";

// ── Window ─────────────────────────────────────────────────────────────────────
function createWindow() {
  console.log('[Crux] Creating window...');
  logDebug('createWindow called');
  mainWindow = new BrowserWindow({
    width:1200, height:800, minWidth:900, minHeight:600,
    autoHideMenuBar:true,
    icon: path.join(__dirname, 'icons', 'icon.ico'),
    show: false,
    webPreferences:{ nodeIntegration:true, contextIsolation:false, devTools:true }
  });
  mainWindow.setMenu(null);
  console.log('[Crux] cwd=', process.cwd(), ' __dirname=', __dirname);
if (process.env.CRUX_DEVTOOLS === '1') { try { mainWindow.webContents.openDevTools({ mode: 'detach' }); } catch {} }
mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => {
    console.log('[Crux] Window ready-to-show');
    logDebug('ready-to-show');
    mainWindow.show();
    mainWindow.focus();
  });
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Crux] did-finish-load');
    logDebug('did-finish-load');
  });
  mainWindow.webContents.on('did-fail-load', (e, code, desc) => {
    console.error('[Crux] did-fail-load:', code, desc);
    logDebug('did-fail-load: ' + code + ' ' + desc);
  });

  // Initialize system tray after window is created
  initializeTray();
}

let tray = null;
let minimizeToTrayEnabled = false;

async function initializeTray() {
  try {
    // Load setting to check if minimize to tray is enabled
    const settings = await load(P.settings, {});
    minimizeToTrayEnabled = !!settings.minimizeToTray;

    // Create tray icon
    const iconPath = path.join(__dirname, 'icons', 'icon.ico');
    tray = new Tray(iconPath);

    // Create context menu
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show Crux Client',
        click: () => {
          showMainWindow();
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ]);

    tray.setToolTip('Crux Client');
    tray.setContextMenu(contextMenu);

    // Double-click to show
    tray.on('double-click', () => {
      showMainWindow();
    });

    // Handle minimize to tray setting change from renderer
    ipcMain.on('minimize-to-tray-changed', (event, enabled) => {
      minimizeToTrayEnabled = enabled;
    });

    // Override close behavior when minimize to tray is enabled
    mainWindow.on('close', (e) => {
      if (isQuitting) return;

      const mcRunning = Object.keys(instances || {}).length > 0;
      const serversRunning = Object.values(serverProcesses || {}).some(s => s.status === 'running');

      if (mcRunning || serversRunning) {
        e.preventDefault();
        mainWindow.hide();
        return;
      }

      if (minimizeToTrayEnabled) {
        e.preventDefault();
        mainWindow.hide();
      }
    });

    // Also handle minimize event
    mainWindow.on('minimize', (e) => {
      if (minimizeToTrayEnabled) {
        e.preventDefault();
        mainWindow.hide();
      }
    });

  } catch (err) {
    console.error('[Crux] Failed to initialize tray:', err);
  }
}

function showMainWindow() {
  suppressMainWindowShow = false;
  try {
    if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
  } catch {}
}

function createUpdateWindow(info) {
  try {
    console.log('[Crux] createUpdateWindow called');
    updateWindow = new BrowserWindow({
      width: 620, height: 480, minWidth: 480, minHeight: 380,
      resizable: true, closable: false, minimizable: true,
      autoHideMenuBar: true,
      icon: path.join(__dirname, 'icons', 'icon.ico'),
      show: false,
      title: 'Crux Client — Update',
      webPreferences: { nodeIntegration: true, contextIsolation: false, devTools: false }
    });
    updateWindow.setMenu(null);
    updateWindow.loadFile('index.html', { query: { updatewin: '1' } });
    updateWindow.once('ready-to-show', () => {
      if (updateWindow && !updateWindow.isDestroyed()) { updateWindow.show(); updateWindow.focus(); }
    });
    updateWindow.webContents.on('did-finish-load', () => {
      try { updateWindow.webContents.send('update-info', info); } catch {}
    });
    updateWindow.on('closed', () => {
      updateWindow = null;
      if (!isQuitting) showMainWindow();
    });
  } catch (e) {
    updateLog('Failed to create update window: ' + (e && e.message));
    showMainWindow();
  }
}

function sendToWindows(...args) {
  for (const w of [mainWindow, updateWindow]) {
    try { if (w && !w.isDestroyed()) w.webContents.send(...args); } catch {}
  }
}

app.whenReady().then(async () => {
  console.log('[Crux] app.whenReady');
  logDebug('app.whenReady');
  // Create directories async (non-blocking)
  await Promise.all(['Cache','javaInstallations','client-mods','minecraft','servers'].map(d =>
    fs.promises.mkdir(path.join(base, d), { recursive: true }).catch(()=>{})
  ));

  // Check for pending update installer before creating window
  const pendingUpdatePath = path.join(base, 'Crux-Client-Installer.exe');
  const updateDoneFlag = path.join(base, 'update-migrated.flag');
  // The batch script writes this after the installer finished - then the pending
  // installer is just a leftover and must NOT be started again.
  const installRanFlag = path.join(os.tmpdir(), 'crux-update-installed.flag');
  if (fs.existsSync(pendingUpdatePath) && !fs.existsSync(updateDoneFlag) && !fs.existsSync(installRanFlag)) {
    try {
      // Save user data (settings, accounts, profiles, ...) as a safety net
      backupUserDataForUpdate();
      // Mark as migrated so we don't loop on next startup
      fs.writeFileSync(updateDoneFlag, 'done');
      // Open the progress window - the update file is already there, so the
      // window can show up right away
      startUpdateProgressWindow();
      // Create a batch script that waits for the launcher to close, then runs the installer
      const launcherExe = path.basename(app.getPath('exe'));
      const batchPath = path.join(os.tmpdir(), 'crux-update-' + Date.now() + '.bat');
      // /S --updated = silent in-place update (the installer replaces the app
      // files, it does not uninstall the old version first)
      const batchContent = [
        '@echo off',
        ':waitloop',
        'timeout /t 1 /nobreak >nul',
        'tasklist /FI "IMAGENAME eq ' + launcherExe + '" 2>nul | find /I "' + launcherExe + '" >nul',
        'if %errorlevel%==0 goto waitloop',
        'start /wait "" "' + pendingUpdatePath + '" /S --updated',
        'echo done > "%TEMP%\\crux-update-installed.flag"',
        'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%TEMP%\\crux-update-window.ps1" set launch',
        'start "" "' + path.dirname(app.getPath('exe')) + '\\' + launcherExe + '"',
        'del "%~f0"',
      ].join('\r\n');
      await fs.promises.writeFile(batchPath, batchContent, 'utf8');
      console.log('[UPDATE] Update batch script created. Closing launcher, installer window shows progress...');
      // Create a VBS wrapper to run the batch completely hidden (no console window)
      const vbsPath = path.join(os.tmpdir(), 'crux-update-hidden-' + Date.now() + '.vbs');
      const vbsContent = 'Set s = CreateObject("WScript.Shell")\r\ns.Run "cmd /c """ & WScript.Arguments(0) & """", 0, False\r\n';
      await fs.promises.writeFile(vbsPath, vbsContent, 'utf8');
      // Start via VBS wrapper (completely hidden), then quit the app
      try {
        spawn('wscript.exe', [vbsPath, batchPath], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      } catch (e) {
        console.log('[UPDATE] VBS spawn failed: ' + e.message + ', trying PowerShell fallback...');
        try {
          spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', 'Start-Process cmd -ArgumentList \'/c\', \'' + batchPath.replace(/\\/g, '\\\\') + '\' -WindowStyle Hidden'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
        } catch (e2) {
          console.log('[UPDATE] All spawn methods failed: ' + e2.message);
        }
      }
      await new Promise(r => setTimeout(r, 500));
      app.quit();
      return;
    } catch (e) {
      console.error('[UPDATE] Auto-install failed:', e.message);
    }
  }
  // Restore user data backed up before the update (safety net)
  restoreUserDataAfterUpdate();
  // Clean up downloaded installer and flags so we don't loop on next startup
  if (fs.existsSync(updateDoneFlag)) {
    try { fs.unlinkSync(updateDoneFlag); } catch {}
  }
  try { fs.unlinkSync(installRanFlag); } catch {}
  try { fs.unlinkSync(pendingUpdatePath); console.log('[UPDATE] Installer cleaned up.'); } catch {}
  // Tell any leftover update-progress window that the client is up and running
  writeUpdateProgress('done', 100);

  const preUpdate = await preLaunchUpdateCheck();
  if (preUpdate) suppressMainWindowShow = true;
  createWindow();
  if (preUpdate) createUpdateWindow(preUpdate);
  startServiceMonitor();
  // Auto-scan Java in background after window loads
  mainWindow.webContents.on('did-finish-load', async () => {
    try {
      const javas = await findInstalledJavas();
      mainWindow.webContents.send('java-scan-result', javas);
    } catch {}
  });
  // Prevent renderer crashes — reload instead of white screen
  mainWindow.webContents.on('crashed', () => {
    console.error('[Crux] Renderer crashed — reloading');
    setTimeout(() => { try { mainWindow.reload(); } catch {} }, 1000);
  });
  mainWindow.on('unresponsive', () => {
    console.error('[Crux] Window unresponsive — reloading');
    setTimeout(() => { try { mainWindow.reload(); } catch {} }, 2000);
  });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// Auto-stop servers on real quit (not when hiding)
let isQuitting = false;
app.on('before-quit', () => {
  isQuitting = true;
  stopAllServers();
  stopPlayitAgent();
  // Clean up tray
  if (tray) {
    tray.destroy();
    tray = null;
  }
  // Best-effort: mark our presence offline before exiting
  try {
    if (myPresence) { myPresence.online = false; myPresence.inGame = false; myPresence.ownerView = false; postPresence(); }
  } catch {}
});

// Override close to distinguish hide vs quit
ipcMain.on('close-launcher', () => {
  if (mainWindow) mainWindow.hide(); // Just hide, don't quit
});

// ── Persist ────────────────────────────────────────────────────────────────────
const load = async (file, def) => { try { return JSON.parse(await fs.promises.readFile(file,'utf8')); } catch { return def; } };
const save = async (file, data) => { try { await fs.promises.writeFile(file, JSON.stringify(data,null,2)); } catch {} };
const saveSettings = async (data) => {
  try {
    const existing = await load(P.settings, {});
    Object.assign(existing, data);
    // Whitelist: strip unknown keys to prevent stale/corrupt fields
    const KNOWN_KEYS = [
      'ram','ramUnit','theme','accentIdx','lang','javaPath','launcherRam',
      'selectedProfile','selectedAccount','recentHistory',
      'openLogsAfterLaunch','closeLauncherWhilePlaying','useOriginalLauncher',
      'minimizeToTray',
      'clientResourcePacks','autoUseResourcePacks',
      'presenceServer','bugreportWebhook','chatServer',
      'useCruxClientMod','tabBarPosition','cornerRadius','glassBgImage',
      'fontMode','fontFamily',
      'glassBgPreset','glassBgTint',      'loginHistory','bans',
      'seenNotices','ownerDeviceTokens','ownerUuid',
      'deviceId','deviceName','anthropicApiKey'
    ];
    const clean = {};
    for (const k of Object.keys(existing)) { if (KNOWN_KEYS.includes(k)) clean[k] = existing[k]; }
    await fs.promises.writeFile(P.settings, JSON.stringify(clean,null,2));
  } catch {}
};

// ── Device identity (cross-device owner tab) ────────────────────────────────
// Stable per-installation ID + human-readable machine name. Written once,
// kept by the settings whitelist above, sent with every login post so the
// presence server can build the per-account devices map.
const DEVICE_ID_FILE = path.join(base, '.device-id');
function ensureDeviceIdentity() {
  return (async () => {
    try {
      const s = await load(P.settings, {});
      if (s && s.deviceId) {
        if (!s.deviceName) { s.deviceName = os.hostname() || 'Unknown PC'; await saveSettings(s); }
        return;
      }
      let id = '';
      try { id = fs.readFileSync(DEVICE_ID_FILE, 'utf8').trim(); } catch {}
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
        id = crypto.randomBytes(16).toString('hex');
        try { fs.writeFileSync(DEVICE_ID_FILE, id, 'utf8'); } catch {}
      }
      const data = Object.assign({}, s, { deviceId: id, deviceName: os.hostname() || 'Unknown PC' });
      await saveSettings(data);
    } catch {}
  })();
}

// Default glass background images bundled in icons/ (selectable in settings)
let _glassDefaultBgs = null;
const _glassBgMime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
ipcMain.handle('get-default-glass-bgs', async () => {
  if (_glassDefaultBgs) return _glassDefaultBgs;
  try {
    const dir = path.join(__dirname, 'icons');
    const num = n => { const m = n.match(/\((\d+)\)/); return m ? parseInt(m[1], 10) : 1; };
    const files = fs.readdirSync(dir)
      .filter(n => /^default_background/i.test(n) && /\.(png|jpe?g|webp)$/i.test(n))
      .sort((a, b) => (num(a) - num(b)) || a.localeCompare(b));
    const out = [];
    for (const f of files) {
      const buf = await fs.promises.readFile(path.join(dir, f));
      const ext = (f.match(/\.([^.]+)$/) || [, 'png'])[1].toLowerCase();
      out.push({
        id: f,
        name: f.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s*\(\d+\)\s*$/, ''),
        dataUrl: 'data:' + (_glassBgMime[ext] || 'image/png') + ';base64,' + buf.toString('base64')
      });
    }
    _glassDefaultBgs = out;
    return out;
  } catch { return []; }
});

// Installed font families for the Appearance → Font setting. Cached because
// enumerating fonts is comparatively slow and the list rarely changes.
let _systemFontCache = null;
function runFontCommand(cmd, args) {
  return new Promise(resolve => {
    try {
      execFile(cmd, args, { encoding: 'utf8', timeout: 8000, maxBuffer: 1024 * 1024 },
        (err, stdout) => resolve(err ? '' : String(stdout || '')));
    } catch { resolve(''); }
  });
}
async function systemFontFamilies() {
  if (_systemFontCache) return _systemFontCache;
  let out = '';
  try {
    if (process.platform === 'win32') {
      out = await runFontCommand('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        "Add-Type -AssemblyName System.Drawing; [System.Drawing.FontFamily]::Families | ForEach-Object { $_.Name }"
      ]);
    } else if (process.platform === 'darwin') {
      out = await runFontCommand('system_profiler', ['SPFontsDataType']);
    } else {
      out = await runFontCommand('fc-list', [':', 'family']);
    }
  } catch {}
  const names = [];
  if (process.platform === 'darwin') {
    const re = /^\s*Family:\s*(.+?)\s*$/gm;
    let m;
    while ((m = re.exec(out))) names.push(m[1]);
  } else {
    out.split(/\r?\n/).forEach(line => {
      line.split(',').forEach(part => names.push(part));
    });
  }
  const clean = names.map(n => String(n).replace(/\s*\(.*\)\s*$/, '').trim())
    .filter(n => n && !/^[.#]/.test(n));
  _systemFontCache = Array.from(new Set(clean)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return _systemFontCache;
}
ipcMain.handle('get-system-fonts', async () => {
  return { ok: true, fonts: await systemFontFamilies() };
});

// Auto-configure the default servers on first run so installed clients
// have the Friends and Chat tabs ready without manual setup.
async function ensureDefaultServers() {
  try {
    const s = await load(P.settings, {});
    let changed = false;
    if (s.presenceServer === undefined || s.presenceServer === null || s.presenceServer === '') {
      s.presenceServer = DEFAULT_PRESENCE_SERVER;
      console.log('[Crux] Presence server default applied: ' + DEFAULT_PRESENCE_SERVER);
      changed = true;
    }
    if (s.chatServer === undefined || s.chatServer === null || s.chatServer === '') {
      s.chatServer = DEFAULT_CHAT_SERVER;
      console.log('[Crux] Chat server default applied: ' + DEFAULT_CHAT_SERVER);
      changed = true;
    }
    // Only `undefined`, NOT `''` — load-settings runs on every launch, so an
    // empty-string check would re-apply the default to anyone who deliberately
    // cleared the field and make opting out impossible.
    if (s.bugreportWebhook === undefined) {
      s.bugreportWebhook = DEFAULT_BUGREPORT_WEBHOOK;
      console.log('[Crux] Bug report webhook default applied');
      changed = true;
    }
    // Minecraft ist der Standard-Font. Explizit gewaehlte System-/Custom-Fonts
    // bleiben unberuehrt.
    if (s.fontMode === undefined || s.fontMode === null || s.fontMode === '') {
      s.fontMode = 'minecraft';
      changed = true;
    }
    if (changed) await save(P.settings, s);
  } catch {}
}

ipcMain.on('open-external', (event, url) => {
  try {
    const u = String(url || '');
    if (u.startsWith('https://') || u.startsWith('http://')) shell.openExternal(u);
  } catch (e) { console.error('open-external', e); }
});

ipcMain.handle('load-settings',          async () => {
  await ensureDefaultServers();
  await ensureDeviceIdentity();
  const s = await load(P.settings, {});
  autoPrecache.clientRPs = Array.isArray(s.clientResourcePacks) ? s.clientResourcePacks : [];
  scheduleAutoPrecache();
  return s;
});
ipcMain.handle('load-accounts',          async () => load(P.accounts, []));
ipcMain.handle('load-profiles',          async () => {
  const loaded = await load(P.profiles, [
    { id:'latest-java', name:'Latest Version Java', mcVersion:'', modLoader:'fabric', mods:[], datapacks:[], resourcePacks:[], shaderPacks:[] },
    { id:'latest-snapshot', name:'Latest Snapshot Java', mcVersion:'__latest_snapshot__', modLoader:'fabric', mods:[], datapacks:[], resourcePacks:[], shaderPacks:[] },
    { id:'latest-bedrock', name:'Latest Bedrock', mcVersion:'', modLoader:'bedrock', mods:[], datapacks:[], resourcePacks:[], shaderPacks:[] },
    { id:'latest-bedrock-pre', name:'Latest Pre-release Bedrock', mcVersion:'__latest_prerelease__', modLoader:'bedrock', mods:[], datapacks:[], resourcePacks:[], shaderPacks:[] }
  ]);
  let list = Array.isArray(loaded) ? loaded : [];
  // Alte MC-Launcher-Importe: interne Gruppe nach dataGroup verschieben und
  // nach aussen "default" anzeigen (gleiche Kartenhoehe wie alle Profile).
  let migrated = false;
  list = list.map(p => {
    if (p && p.isMcLauncherImport && typeof p.group === 'string' && /^mc-/.test(p.group) && !p.dataGroup) {
      migrated = true;
      return { ...p, group: 'default', dataGroup: p.group };
    }
    return p;
  });
  if (migrated) await save(P.profiles, list);
  autoPrecache.profiles = list;
  scheduleAutoPrecache();
  return list;
});
ipcMain.handle('load-mods',              async () => {
  const mods = await load(P.mods, []);
  autoPrecache.mods = Array.isArray(mods) ? mods : [];
  scheduleAutoPrecache();
  return mods;
});
ipcMain.handle('load-client-mods',       async () => {
  const mods = await load(P.clientMods, []);
  autoPrecache.clientMods = Array.isArray(mods) ? mods : [];
  scheduleAutoPrecache();
  return mods;
});
ipcMain.handle('load-launched-versions', async () => load(P.launched, []));
ipcMain.on('save-settings',          async (e,d) => {
  await saveSettings(d);
  if (d && Array.isArray(d.clientResourcePacks)) autoPrecache.clientRPs = d.clientResourcePacks;
  scheduleAutoPrecache();
});
ipcMain.on('save-accounts',          async (e,d) => save(P.accounts, d));
ipcMain.handle('delete-account',     async (event, acc) => {
  try {
    const accounts = await load(P.accounts, []);
    const key = String(acc && (acc.uuid || acc.name || ''));
    const filtered = accounts.filter(a => String(a && (a.uuid || a.name || '')) !== key);
    await save(P.accounts, filtered);
    return { ok: true, removed: accounts.length - filtered.length };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('open-app-data-folder', async () => {
  const base = path.join(process.env.APPDATA || process.env.LOCALAPPDATA || '', 'Crux Client');
  try { await shell.showItemInFolder(base); return { ok: true }; } catch {}
  try { await shell.openPath(base); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.on('save-profiles',          async (e,d) => {
  await save(P.profiles, d);
  autoPrecache.profiles = Array.isArray(d) ? d : [];
  scheduleAutoPrecache();
});
ipcMain.on('save-client-mods',       async (e,d) => {
  await save(P.clientMods, d);
  autoPrecache.clientMods = Array.isArray(d) ? d : [];
  scheduleAutoPrecache();
});

// ── Profile offline-capability check ──────────────────────────────────────────
// Tells the UI whether every mod the profile would deploy is already cached,
// i.e. whether the profile can be launched without an internet connection.
ipcMain.handle('profile-offline-check', async (event, profile) => {
  try {
    if (!profile) return { ok:true, total:0, missing:0 };
    const modsDir = path.join(instanceDir(profile.id), 'mods');
    const files = fs.existsSync(modsDir) ? fs.readdirSync(modsDir) : [];
    const version = profile.mcVersion || '';
    const modLoader = profile.modLoader || 'fabric';

    const candidates = [];
    if (profile.useClientMods !== false) {
      for (const m of (profile.clientMods || [])) {
        if (m.disabled) continue;
        if (m.type === 'jar') continue;
        if (m.loader && m.loader !== 'any' && m.loader !== modLoader) continue;
        const vm = m.downloadAllVersions || m.mcVersion === version || m.mcVersion === 'all' || m.mcVersion === 'latest';
        if (!vm) continue;
        candidates.push(m);
      }
    }
    const alreadyCandidate = (m) =>
      (m.modrinthId && candidates.some(c => c.modrinthId === m.modrinthId)) ||
      (m.curseforgeId && candidates.some(c => c.curseforgeId === m.curseforgeId));
    for (const m of (profile.mods || [])) {
      if (m.disabled) continue;
      if (m.loader && m.loader !== 'any' && m.loader !== modLoader) continue;
      if (!alreadyCandidate(m)) candidates.push(m);
    }
    for (const m of (profile.mrpackMods || [])) {
      if (m.disabled) continue;
      if (!alreadyCandidate(m)) candidates.push(m);
    }

    let missing = 0;
    for (const mod of candidates) {
      if (!mod.modrinthId && !mod.curseforgeId) {
        if (mod.diskPath && fs.existsSync(mod.diskPath)) continue;
        if (mod.data && mod.data.length) continue;
        missing++;
      } else if (!modHasJar(mod, files)) {
        missing++;
      }
    }
    return { ok: missing === 0, total: candidates.length, missing };
  } catch (e) {
    return { ok:false, total:0, missing:-1, error: e.message };
  }
});

// ── Download profile for offline ──────────────────────────────────────────────
// Pre-downloads everything the profile needs (mods + game files) so the
// profile can be launched without an internet connection.

function resolveConcreteVersion(mcVersion) {
  let v = mcVersion || '';
  if (!v || v === '') v = mcVersionList.find(x => x.type === 'release')?.id || '';
  else if (v === '__latest_snapshot__') v = mcVersionList.find(x => x.type === 'snapshot')?.id || mcVersionList[0]?.id || '';
  return v;
}

// Deploy ALL mods the profile would deploy at launch (client + profile + mrpack + fabric deps)
async function downloadProfileMods(profile, clientMods, version, modLoader, sendProgress) {
  const modsDir = path.join(instanceDir(profile.id), 'mods');
  await fs.promises.mkdir(modsDir, { recursive: true });
  const existingFiles = fs.existsSync(modsDir) ? fs.readdirSync(modsDir) : [];
  const broken = await brokenIdsFor(version, modLoader);

  const toDeploy = [];
  const pushUnique = (mod) => {
    if (mod.disabled || modHasBrokenId(mod, broken)) return;
    if (mod.loader && mod.loader !== 'any' && mod.loader !== modLoader) return;
    if (mod.modrinthId && toDeploy.some(m => m.modrinthId === mod.modrinthId)) return;
    if (mod.curseforgeId && toDeploy.some(m => m.curseforgeId === mod.curseforgeId)) return;
    toDeploy.push(mod);
  };

  // mrpack overrides (same order/logic as launch — uses first listed version)
  for (const mod of (profile.mrpackMods || [])) { mod._mrpack = true; pushUnique(mod); }
  // client mods matching this version/loader
  if (profile.useClientMods !== false) {
    for (const mod of (clientMods || [])) {
      if (mod.type === 'jar') continue;
      if (mod.mcVersion === version || mod.mcVersion === 'all' || mod.mcVersion === 'latest' || mod.downloadAllVersions) pushUnique(mod);
    }
  }
  // profile mods — Namen ohne Quelle nachschlagen, damit sie offline gecacht werden
  for (const mod of (profile.mods || [])) {
    await resolveProfileModIdentity(mod, version, modLoader);
    pushUnique(mod);
  }
  // auto fabric deps
  if (modLoader === 'fabric' || modLoader === 'quilt') {
    const fabricDeps = [
      { name:'Fabric API',             modrinthId:'P7dR8mSH', loader:'fabric' },
      { name:'Cloth Config',           modrinthId:'9s6osm5g', loader:'fabric' },
      { name:'Fabric Language Kotlin', modrinthId:'Ha28R6CL', loader:'fabric' },
      { name:'YetAnotherConfigLib',    modrinthId:'1eAoo2KR', loader:'fabric' },
      { name:'TCDCommons',             modrinthId:'Eldc1g37', loader:'fabric' },
    ];
    for (const dep of fabricDeps) pushUnique(dep);
  }
  await addRequiredDependencies(toDeploy, version, modLoader, false, broken);

// Crux Client Features jar (only if the per-profile toggle is on and an asset exists)
  if (profile.useCruxMod === true && (modLoader === 'fabric' || modLoader === 'quilt')) {
    try {
      const crux = await ensureCruxClientMod(version, sendProgress, 'offline');
      if (crux) await deployCruxMod(modsDir, crux);
    } catch {}
  }

  const versionCache = new Map();
  let done = 0;
  let lastModLog = Date.now();
  const processMod = async (mod) => {
    if (autoPrecache.busy && (autoPrecache.abort || autoPrecache.userInterrupted)) return;
    const tryCurseforgeFallback = async () => {
      if (!mod.curseforgeId || mod._cfFallbackTried) return false;
      mod._cfFallbackTried = true;
      return await deployCurseforgeMod(mod, modsDir, version, modLoader,
        (line) => sendProgress(line.replace(/^\[MODS\]\s*/, '')));
    };
    try {
      if (!mod.modrinthId) {
        if (mod.curseforgeId) {
          await deployCurseforgeMod(mod, modsDir, version, modLoader, (line) => sendProgress(line.replace(/^\[MODS\]\s*/, '')));
          return;
        }
        if (mod.diskPath && fs.existsSync(mod.diskPath)) {
          const dest = path.join(modsDir, mod.fileName || (String(mod.name||'mod').replace(/[^a-zA-Z0-9._-]/g,'_') + '.jar'));
          if (!fs.existsSync(dest)) await fs.promises.copyFile(mod.diskPath, dest);
        } else if (mod.data && mod.data.length) {
          const dest = path.join(modsDir, mod.fileName || `mod-${done}.jar`);
          if (!fs.existsSync(dest)) await fs.promises.writeFile(dest, Buffer.from(mod.data));
        }
        return;
      }

      const hasJar = modHasJar(mod, existingFiles);
      if (hasJar) { return; }

      let versionData = versionCache.get(mod.modrinthId);
      if (!versionData) {
        const allVersions = await fetchJson(`https://api.modrinth.com/v2/project/${mod.modrinthId}/version`).catch(() => null);
        if (!allVersions || !allVersions.length) {
          await tryCurseforgeFallback();
          return;
        }
        if (mod._mrpack) {
          // mrpack mods are deployed as the first listed version (same as launch)
          versionData = allVersions[0];
        } else {
          // profile/client mods: match MC version AND loader, otherwise skip (launch disables it)
          versionData = allVersions.find(v => (v.game_versions || []).includes(version) && (v.loaders || []).includes(modLoader)) || null;
          if (!versionData) {
            await tryCurseforgeFallback();
            return;
          }
        }
        versionCache.set(mod.modrinthId, versionData);
      }
      if (!versionData) { return; }

      const file = versionData.files.find(f => f.primary) || versionData.files[0];
      if (!file) { await tryCurseforgeFallback(); return; }
      const dest = path.join(modsDir, `${mod.modrinthId}-${file.filename}`);
      await deployModCachedOrDownload({
        url: file.url,
        cacheName: modrinthCacheName(mod.modrinthId, versionData, file),
        dest,
        label: mod.name || mod.modrinthId,
        log: line => sendProgress(line.replace(/^\[CACHE\]\s*/, ''))
      });
      existingFiles.push(`${mod.modrinthId}-${file.filename}`);
    } catch (e) {
      console.error('[OFFLINE-DL] Mod failed:', mod.name, e.message);
      if (mod.modrinthId) await tryCurseforgeFallback();
    }
  };
  // Batches statt 257 einzelner Requests: sonst steht die Konsole zwischen
  // "Starte…" und "Fertig…" minutenlang still.
  for (let i = 0; i < toDeploy.length; i += 4) {
    if (autoPrecache.busy && (autoPrecache.abort || autoPrecache.userInterrupted)) break;
    await Promise.all(toDeploy.slice(i, i + 4).map(processMod));
    done = Math.min(i + 4, toDeploy.length);
    if (done % 8 === 0 || Date.now() - lastModLog > 5000) {
      sendProgress(`Mods ${done}/${toDeploy.length}…`);
      lastModLog = Date.now();
    }
    await new Promise(r => setImmediate(r));
  }
  await persistProfileMods(profile.id, profile.mods);
  return toDeploy.length;
}

// Pre-download the base Minecraft version (version json, client jar, libraries,
// natives, assets) via a mclc "dry run" that never spawns the game.
// If customId is given (e.g. a fabric-loader version), that loader's files are
// pre-downloaded instead of plain vanilla.
async function predownloadVanillaGameFiles(version, javaPath, sendProgress, customId) {
  const { Client } = require('minecraft-launcher-core');
  const launcher = new Client();
  if (process.env.CRX_CACHE_DEBUG) {
    launcher.on('debug', m => console.log('[MCLC] ' + m));
    launcher.on('progress', p => {
      if (p.type !== 'assets' || p.task % 500 === 0) console.log(`[MCLC-PROG] ${p.type} ${p.task}/${p.total}`);
    });
  }
  // Patch: do NOT spawn the game — download only.
  launcher.startMinecraft = () => new (require('events').EventEmitter)();

  const versionType = mcVersionList.find(v => v.id === version)?.type || 'release';
  const versionObj = customId ? { number: version, type: versionType, custom: customId } : { number: version, type: versionType };
  const opts = {
    clientPackage: null,
    authorization: { access_token:'offline-predownload', name:'Player', uuid:'00000000000000000000000000000000', user_properties:'{}', meta:{ type:'mojang' } },
    root: P.mc,
    version: versionObj,
    memory: { max: 1024, min: 512 },
    javaPath,
    overrides: { detached: false },
  };
  // Keine download-status/progress-Listener: MCLC feuert pro Datenchunk und
  // pro einem der 5000 Assets - die Nachrichten wurden vorher ohnehin
  // verworfen, kosteten aber Event-Loop-Zeit und verursachten Ruckler.

  // MCLC feuert alle 5000+ Assets gleichzeitig ab - das ist nicht pausierbar.
  // Nur für diesen Hintergrund-Lauf: Downloads begrenzen und vor jedem neuen
  // Download auf Nutzer-Ruhe warten. Nach dem Lauf wird das Patch entfernt.
  const HandlerClass = require('minecraft-launcher-core/components/handler');
  const origCheckSum = HandlerClass.prototype.checkSum;
  // MCLC prueft vor JEDEM Asset die SHA1 - bei 5000 Dateien gleichzeitig ein
  // Stau im libuv-Threadpool: die UI haengt, obwohl nichts heruntergeladen wird.
  // Im Hintergrund-Cache reicht die Existenz; die Dateien stammen vom
  // offiziellen CDN und wurden beim letzten Lauf bereits geprueft.
  const patchedCheckSum = function (hash, file) {
    return Promise.resolve(fs.existsSync(file));
  };
  HandlerClass.prototype.checkSum = patchedCheckSum;
  const origDownload = HandlerClass.prototype.downloadAsync;
  let activeDownloads = 0;
  const downloadQueue = [];
  let interrupted = false;
  const waitForSlot = async () => {
    if (activeDownloads >= 8) await new Promise(resolve => downloadQueue.push(resolve));
    activeDownloads++;
  };
  const releaseSlot = () => {
    activeDownloads--;
    const next = downloadQueue.shift();
    if (next) next();
  };
  const patchedHandlers = [];
  let gateCalls = 0;
  const cacheGate = async () => {
    gateCalls++;
    // Kein waitForPrecacheIdle() pro Asset: eine haengende Busy-Meldung darf
    // die 5000 Downloads nicht blockieren. Der Klick bricht laufende Requests
    // sofort ab (abortPrecacheDownloads); neue starten erst nach der Ruhe.
    if (autoPrecache.abort || autoPrecache.userInterrupted || autoPrecache.userBusy) { interrupted = true; return false; }
    // Regelmässig die Event-Loop freigeben, damit Klicks sofort ankommen.
    if (gateCalls % 200 === 0) await new Promise(r => setImmediate(r));
    return true;
  };
  const patchedDownload = function (...args) {
    return (async () => {
      // MCLC ruft bei einem Download-Fehler this.downloadAsync() erneut auf,
      // solange der erste Download noch laeuft. Dieser Retry darf KEINEN
      // zweiten Slot nehmen: er wartet sonst auf einen Slot, den sein
      // Eltern-Download noch haelt -> Deadlock bei mehreren Timeouts.
      if (this.__cacheInside) {
        if (autoPrecache.abort || autoPrecache.userInterrupted || autoPrecache.userBusy) {
          interrupted = true;
          return false;
        }
        return origDownload.apply(this, args);
      }
      if (!(await cacheGate())) return false;
      await waitForSlot();
      try {
        if (!(await cacheGate())) return false;
        // MCLC ruft intern this.baseRequest() auf. Wir registrieren jeden
        // Request mit seinem Zielpfad, damit abortPrecacheDownloads() ihn bei
        // der nächsten Nutzeraktion sofort abbrechen und die Teildatei löschen kann.
        if (!this.__cacheBasePatched) {
          this.__cacheBasePatched = true;
          this.__cacheOrigBase = this.baseRequest;
          patchedHandlers.push(this);
          this.baseRequest = function (...a) {
            const req = this.__cacheOrigBase.apply(this, a);
            const item = { req, dest: this.__cacheDest || null };
            precacheActiveDownloads.add(item);
            const clear = () => precacheActiveDownloads.delete(item);
            req.once('complete', clear);
            req.once('error', clear);
            req.once('abort', clear);
            return req;
          };
        }
        const dlDir = args[1], dlName = args[2];
        this.__cacheDest = (typeof dlDir === 'string' && typeof dlName === 'string')
          ? path.join(dlDir, dlName) : null;
        this.__cacheInside = true;
        try {
          return await origDownload.apply(this, args);
        } finally {
          this.__cacheInside = false;
          this.__cacheDest = null;
        }
      } finally {
        releaseSlot();
      }
    })();
  };
  const restoreDownload = () => {
    if (HandlerClass.prototype.downloadAsync === patchedDownload) {
      HandlerClass.prototype.downloadAsync = origDownload;
    }
    if (HandlerClass.prototype.checkSum === patchedCheckSum) {
      HandlerClass.prototype.checkSum = origCheckSum;
    }
    for (const h of patchedHandlers) {
      try {
        h.baseRequest = h.__cacheOrigBase;
        delete h.__cacheBasePatched;
        delete h.__cacheOrigBase;
        delete h.__cacheDest;
        delete h.__cacheInside;
      } catch {}
    }
    patchedHandlers.length = 0;
    precacheRestorers.delete(restoreDownload);
  };
  HandlerClass.prototype.downloadAsync = patchedDownload;
  precacheRestorers.add(restoreDownload);
  const dbgTimer = process.env.CRX_CACHE_DEBUG
    ? setInterval(() => console.log(`[CACHE-STATE] active=${activeDownloads} queue=${downloadQueue.length} gate=${gateCalls} interrupted=${interrupted}`), 5000)
    : null;
  dbgTimer?.unref?.();
  try {
    await launcher.launch(opts);
  } catch (e) {
    // MCLC bricht bei einer abgebrochenen Hintergrund-Download-Kette ab.
    if (!interrupted) throw e;
  } finally {
    dbgTimer && clearInterval(dbgTimer);
    restoreDownload();
  }
  if (interrupted) return { paused: true, jsonOk: false, jarOk: false, assetsOk: false };

  const vDir = path.join(P.mc, 'versions', customId || version);
  return {
    jsonOk: fs.existsSync(path.join(vDir, `${version}.json`)) || fs.existsSync(path.join(vDir, `${customId}.json`)),
    jarOk: fs.existsSync(path.join(vDir, `${customId || version}.jar`)),
    assetsOk: fs.existsSync(path.join(P.mc, 'assets', 'indexes', `${customId || version}.json`)),
  };
}

// Loader-Versionen numerisch vergleichen: 0.19.5 < 0.20.1.
function compareVersionNumbers(a, b){
  const pa = String(a || '').match(/\d+/g)?.map(Number) || [];
  const pb = String(b || '').match(/\d+/g)?.map(Number) || [];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++){
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function loaderVerFromId(id, prefix){
  // prefix endet bereits mit '-' (z. B. 'fabric-loader-').
  const m = String(id || '').match(new RegExp('^' + prefix + '([0-9][^-]*)-'));
  return m ? m[1] : null;
}

// Neuesten installierten Loader-Ordnernamen fuer diese MC-Version finden.
function newestLoaderId(version, prefix){
  const versionsDir = path.join(P.mc, 'versions');
  if (!fs.existsSync(versionsDir)) return null;
  const dirs = fs.readdirSync(versionsDir).filter(d =>
    d.toLowerCase().startsWith(prefix.toLowerCase()) &&
    (d.endsWith(`-${version}`) || d.endsWith(version)) &&
    fs.existsSync(path.join(versionsDir, d, `${d}.json`))
  );
  if (!dirs.length) return null;
  dirs.sort((a, b) => compareVersionNumbers(loaderVerFromId(a, prefix), loaderVerFromId(b, prefix)));
  return dirs[dirs.length - 1];
}

// Zwei bekannte Problemfaelle automatisch beheben:
//  - ein alter Loader-Ordner wird immer wiederverwendet (0.19.5), obwohl es
//    fuer die MC-Version schon eine neuere Version gibt (0.20.1);
//  - Mods laden immer die neueste Version und verlangen dann einen neueren Loader.
// Der Service wird vor jedem Start geprueft; bei Offline/Fehler bleibt der
// installierte Loader unangetastet.
async function refreshLoaderIfOutdated(version, modLoader, javaPath, onProgress){
  if (modLoader !== 'fabric' && modLoader !== 'quilt') return null;
  const isFabric = modLoader === 'fabric';
  const prefix = isFabric ? 'fabric-loader-' : 'quilt-loader-';
  const currentId = newestLoaderId(version, prefix);
  let list = null;
  try {
    list = await fetchJson(isFabric
      ? `https://meta.fabricmc.net/v2/versions/loader/${version}`
      : `https://meta.quiltmc.net/v3/versions/loader/${version}`);
  } catch {
    return currentId;
  }
  if (!Array.isArray(list) || !list.length || !list[0]?.loader?.version) return currentId;
  const latest = String(list[0].loader.version);
  if (currentId && compareVersionNumbers(loaderVerFromId(currentId, prefix), latest) >= 0) return currentId;

  let instVer = list[0].installer?.version;
  if (isFabric && !instVer){
    try { const m = await fetchJson('https://meta.fabricmc.net/v2/versions/installer'); instVer = m[0]?.version; } catch {}
  }
  if (!instVer) instVer = isFabric ? '0.11.2' : '0.5.1';
  const installerName = isFabric ? `fabric-installer-${instVer}.jar` : `quilt-installer-${instVer}.jar`;
  const instPath = path.join(base, installerName);
  const instUrl = isFabric
    ? `https://maven.fabricmc.net/net/fabricmc/fabric-installer/${instVer}/${installerName}`
    : `https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/${instVer}/${installerName}`;
  onProgress?.(`Aktualisiere ${isFabric ? 'Fabric' : 'Quilt'}-Loader auf ${latest}…`);
  try {
    if (!fs.existsSync(instPath)) await downloadFile(instUrl, instPath);
    const javaExe = `"${path.resolve(javaPath)}"`;
    const args = isFabric
      ? `client -dir "${path.resolve(P.mc)}" -mcversion ${version} -loader ${latest} -noprofile`
      : `install client -dir "${path.resolve(P.mc)}" -mcversion ${version} -loader ${latest} -noprofile`;
    await new Promise((res, rej) => exec(
      `${javaExe} -jar "${path.resolve(instPath)}" ${args}`,
      { timeout: 120000 }, (e, o, se) => { if (e) rej(new Error(se || e.message || String(e))); else res(o); }
    ));
    const updatedId = newestLoaderId(version, prefix);
    if (!updatedId || compareVersionNumbers(loaderVerFromId(updatedId, prefix), latest) < 0){
      throw new Error(`Loader ${latest} wurde installiert, aber kein passender Versionsordner gefunden`);
    }
    onProgress?.(`${isFabric ? 'Fabric' : 'Quilt'}-Loader aktualisiert: ${latest}`);
    return updatedId;
  } catch (e){
    console.error('[LOADER AUTO-FIX]', e);
    onProgress?.(`Loader-Update fehlgeschlagen: ${e.message}`);
    return currentId;
  }
}

// Install Fabric/Quilt loader for the version if not already present (so the
// loader + its libraries are cached for offline use).
async function ensureLoaderForOffline(version, modLoader, javaPath, sendProgress) {
  const versionsDir = path.join(P.mc, 'versions');
  let loaderId = null;
  if (modLoader === 'fabric' || modLoader === 'quilt'){
    const prefix = modLoader === 'fabric' ? 'fabric-loader-' : 'quilt-loader-';
    loaderId = newestLoaderId(version, prefix);
    if (loaderId) loaderId = await refreshLoaderIfOutdated(version, modLoader, javaPath, sendProgress) || loaderId;
  }
  if (loaderId && fs.existsSync(path.join(versionsDir, loaderId, `${loaderId}.json`))) {
    return { installed: true, id: loaderId };
  }

  sendProgress('Installiere Loader…');
  if (modLoader === 'fabric') {
    const loaders = await fetchJson(`https://meta.fabricmc.net/v2/versions/loader/${version}`);
    if (!loaders || !loaders.length) throw new Error('Kein Fabric-Loader für ' + version);
    const loaderVer = loaders[0].loader.version;
    let instVer = loaders[0].installer?.version;
    if (!instVer) { try { const m = await fetchJson('https://meta.fabricmc.net/v2/versions/installer'); instVer = m[0]?.version; } catch {} }
    if (!instVer) instVer = '0.11.2';
    const instUrl = `https://maven.fabricmc.net/net/fabricmc/fabric-installer/${instVer}/fabric-installer-${instVer}.jar`;
    const instPath = path.join(base, `fabric-installer-${instVer}.jar`);
    if (!fs.existsSync(instPath)) await downloadFile(instUrl, instPath);
    const javaExe = `"${path.resolve(javaPath)}"`;
    await new Promise((res, rej) => exec(
      `${javaExe} -jar "${path.resolve(instPath)}" client -dir "${path.resolve(P.mc)}" -mcversion ${version} -loader ${loaderVer} -noprofile`,
      { timeout: 120000 }, (e, o, se) => { if (e) rej(new Error(se || e.message || String(e))); else res(o); }
    ));
    if (fs.existsSync(versionsDir)) {
      loaderId = fs.readdirSync(versionsDir).find(d => d.toLowerCase().startsWith('fabric-loader-') && d.includes(version)) || null;
    }
    if (!loaderId || !fs.existsSync(path.join(versionsDir, loaderId, `${loaderId}.json`))) throw new Error('Fabric-Installer lief, aber Versionsordner fehlt');
    return { installed: true, id: loaderId };
  }

  if (modLoader === 'quilt') {
    const loaders = await fetchJson(`https://meta.quiltmc.net/v3/versions/loader/${version}`);
    if (!loaders || !loaders.length) throw new Error('Kein Quilt-Loader für ' + version);
    const loaderVer = loaders[0].loader.version;
    const instVer = loaders[0].installer?.version || '0.5.1';
    const instUrl = `https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/${instVer}/quilt-installer-${instVer}.jar`;
    const instPath = path.join(base, `quilt-installer-${instVer}.jar`);
    if (!fs.existsSync(instPath)) await downloadFile(instUrl, instPath);
    const javaExe = `"${path.resolve(javaPath)}"`;
    await new Promise((res, rej) => exec(
      `${javaExe} -jar "${path.resolve(instPath)}" install client -dir "${path.resolve(P.mc)}" -mcversion ${version} -loader ${loaderVer} -noprofile`,
      { timeout: 120000 }, (e, o, se) => { if (e) rej(new Error(se || e.message || String(e))); else res(o); }
    ));
    if (fs.existsSync(versionsDir)) {
      loaderId = fs.readdirSync(versionsDir).find(d => d.toLowerCase().startsWith('quilt-loader-') && d.includes(version)) || null;
    }
    if (!loaderId || !fs.existsSync(path.join(versionsDir, loaderId, `${loaderId}.json`))) throw new Error('Quilt-Installer lief, aber Versionsordner fehlt');
    return { installed: true, id: loaderId };
  }

  return { installed: false, id: null };
}

// ── Offline-Cache (automatisch im Hintergrund) ──────────────────────────────────
// Solange der Launcher offen ist, werden nach und nach für ALLE Java-Profile
// alle Assets gecacht, die für einen Start ohne Internet nötig sind:
// Spieldateien, Loader, Mods und Ressourcenpakete. Bereits vorhandene Dateien
// werden von den bestehenden Download-Helfern übersprungen.

const autoPrecache = {
  profiles: [],
  mods: [],
  clientMods: [],
  clientRPs: [],
  done: new Map(),      // profileId -> Hash der Eingaben (nur bei Erfolg)
  gameDone: new Set(),  // "version|loader" (geteilt zwischen Profilen)
  busy: false,
  abort: false,         // Spielstart bricht den Hintergrund-Cache sofort ab
  timer: null,
  userBusy: false,      // Nutzer arbeitet gerade im Launcher -> Cache pausiert
  userInterrupted: false, // Nutzeraktion hat laufende Cache-Downloads abgebrochen
  idleWaiters: [],      // warten auf "Nutzer wieder untätig"
};
// Temporäre MCLC-Download-Patches des Caches (siehe predownloadVanillaGameFiles).
const precacheRestorers = new Set();
// Aktive Cache-Requests mit Zielpfad, damit eine Nutzeraktion sie sofort
// abbrechen und halb geschriebene Dateien entfernen kann.
const precacheActiveDownloads = new Set();
function abortPrecacheDownloads() {
  for (const item of [...precacheActiveDownloads]) {
    try { item.req.abort(); } catch {}
    if (item.dest) {
      // Erst löschen, wenn der Write-Stream des abgebrochenen Requests zu ist.
      setTimeout(() => { try { fs.unlinkSync(item.dest); } catch {} }, 250).unref?.();
    }
  }
  precacheActiveDownloads.clear();
}

// Der Cache läuft im Hauptprozess, darf dort aber nie die Event-Loop blockieren.
// Nach jedem Arbeitsschritt bekommt Electron/IPC wieder Luft (Klicks reagieren).

// Der Renderer meldet jede Nutzeraktion (Klick, Tastatur, laufende IPC-Aktion).
// Solange userBusy gilt, startet der Cache keine neuen Schritte mehr; bereits
// laufende Downloads werden nach dem letzten Schritt fortgesetzt.
function setPrecacheUserBusy(active) {
  const next = !!active;
  if (autoPrecache.userBusy === next) return;
  autoPrecache.userBusy = next;
  if (next) {
    // Erste Aktion: alles, was gerade läuft, sofort stoppen. Der Cache startet
    // danach komplett neu (siehe userInterrupted in predownloadVanillaGameFiles).
    autoPrecache.userInterrupted = true;
    abortPrecacheDownloads();
  } else {
    const waiters = autoPrecache.idleWaiters.splice(0);
    for (const resolve of waiters) resolve();
    // Der Nutzer ist fertig: Cache nach kurzer Ruhe weiterplanen, statt auf
    // den naechsten 5-Minuten-Tick zu warten.
    if (!autoPrecache.busy && !autoPrecache.abort) scheduleAutoPrecache(1500);
  }
}
ipcMain.on('cache-user-active', (event, active) => setPrecacheUserBusy(active));

function waitForPrecacheIdle() {
  if (!autoPrecache.userBusy) return Promise.resolve();
  // Never block forever: a stuck renderer busy flag must not stall the cache.
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const i = autoPrecache.idleWaiters.indexOf(finish);
      if (i >= 0) autoPrecache.idleWaiters.splice(i, 1);
      resolve();
    };
    const timer = setTimeout(finish, 10000);
    timer.unref?.();
    autoPrecache.idleWaiters.push(finish);
  });
}

// Spielstart bricht den Cache sofort ab - auch wenn gerade auf Nutzer-Ruhe
// gewartet wird (sonst haengen die wartenden Downloads bis zur Ruhe fest).
function abortPrecache() {
  autoPrecache.abort = true;
  abortPrecacheDownloads();
  const waiters = autoPrecache.idleWaiters.splice(0);
  for (const resolve of waiters) resolve();
  // Kein Cache-Patch darf in einen Spielstart hinein laufen.
  for (const restore of [...precacheRestorers]) restore();
}

// Ein Cache-Schritt: erst auf Nutzer-Ruhe warten, dann der Event-Loop Luft geben.
async function precacheStep() {
  await waitForPrecacheIdle();
  await new Promise(r => setImmediate(r));
}

function autoPrecacheHash(profile, version, loader, mods, rps) {
  return crypto.createHash('md5').update(JSON.stringify({
    version, loader,
    useClientMods: profile.useClientMods !== false,
    useClientRPs: profile.useClientRPs !== false,
    useCruxMod: profile.useCruxMod === true,
    profileMods: profile.mods || [],
    mrpackMods: profile.mrpackMods || [],
    mrpackRPs: profile.mrpackRPs || [],
    profileRPs: profile.resourcePacks || [],
    mods: mods || [],
    rps: rps || [],
  })).digest('hex');
}

function precacheLog(msg) {
  // Massen-Fortschritt (einzelne Spieldateien / 5000 Assets) weder loggen
  // noch an die UI schicken - das war die Hauptursache für Ruckler im Cache.
  if (/^(Spieldatei|Spieldateien):/.test(msg)) return;
  console.log('[OFFLINE-CACHE] ' + msg);
  try { if (mainWindow) mainWindow.webContents.send('auto-precache-progress', msg); } catch {}
}
function precacheTime(phase, started) {
  if (process.env.CRX_CACHE_DEBUG) console.log(`[CACHE-TIME] ${phase}: ${Date.now() - started}ms`);
}

// Genau die Ressourcenpakete, die der Launch auch deployen würde, lokal bereitstellen.
async function precacheResourcePacks(profile, version, send) {
  const rpDir = path.join(instanceDir(profile.id), 'resourcepacks');
  await fs.promises.mkdir(rpDir, { recursive: true });
  const lists = [];
  if (profile.useClientRPs !== false) lists.push(autoPrecache.clientRPs || []);
  lists.push(profile.resourcePacks || [], profile.mrpackRPs || []);

  for (const list of lists) {
    for (const rp of list) {
      if (autoPrecache.abort) return;
      await precacheStep();
      try {
        if (!rp || rp.disabled) continue;
        const name = typeof rp === 'string' ? rp : (rp.name || rp.fileName || '');
        const mcV = typeof rp === 'object' ? (rp.mcVersion || 'all') : 'all';
        if (mcV !== 'all' && mcV !== version) continue;

        if (typeof rp === 'object' && rp.diskPath && fs.existsSync(rp.diskPath)) {
          const dest = path.join(rpDir, rp.fileName || path.basename(rp.diskPath));
          if (!fs.existsSync(dest)) await fs.promises.copyFile(rp.diskPath, dest);
          continue;
        }
        if (typeof rp === 'object' && rp.data && rp.data.length) {
          const dest = path.join(rpDir, rp.fileName || `rp-${Date.now()}.zip`);
          if (!fs.existsSync(dest)) await fs.promises.writeFile(dest, Buffer.from(rp.data));
          continue;
        }
        if (typeof name === 'string' && name.startsWith('file://')) {
          const src = name.slice('file://'.length);
          if (fs.existsSync(src)) {
            const dest = path.join(rpDir, path.basename(src));
            if (!fs.existsSync(dest)) await fs.promises.copyFile(src, dest);
          }
          continue;
        }

        let downloadUrl = null, fname = null, packName = name;
        if (typeof rp === 'object' && rp.modrinthId) {
          const vd = await fetchJson(`https://api.modrinth.com/v2/project/${rp.modrinthId}/version`).catch(() => null);
          if (vd && vd.length) {
            const chosen = vd.find(v => (v.game_versions || []).includes(version)) || vd[0];
            const file = chosen.files?.find(f => f.primary) || chosen.files?.[0];
            if (file) { downloadUrl = file.url; fname = file.filename; }
          }
        } else if (typeof name === 'string' && /^https?:\/\//i.test(name)) {
          downloadUrl = name;
          fname = path.basename(name.split('?')[0]) || `rp-${Date.now()}.zip`;
        }
        if (!downloadUrl) continue; // Namens-basierte Packs liegen schon im Instance-Ordner
        fname = fname || path.basename(downloadUrl.split('?')[0]) || `rp-${Date.now()}.zip`;
        send('Ressourcenpaket: ' + (packName || fname));
        await deployResourcePack({
          rpDir, version, packName: packName || fname,
          tempDest: path.join(rpDir, fname), downloadUrl,
          onDownload: () => send('Ressourcenpaket: ' + (packName || fname))
        });
        await precacheStep();
      } catch (e) {
        console.error('[OFFLINE-CACHE] RP failed:', e.message);
      }
    }
  }
}

// Alles, was ein Profil für den Offline-Start braucht (einmalig pro Profil).
// Version, Loader, Mods und Packs kommen immer aus dem jeweiligen Profil.
async function precacheProfileAssets(profile, mods, rps, send) {
  if (!profile) return { ok:false, error:'Kein Profil.' };
  const version = resolveConcreteVersion(profile.mcVersion);
  if (!version) return { ok:false, error:'Keine Minecraft-Version gefunden.' };
  const loader = profile.modLoader || 'fabric';
  const phaseStart = { game: Date.now(), mods: 0, rps: 0 };

  send(`Starte Offline-Cache: ${profile.name || profile.id} (${version}, ${loader})`);
  await precacheStep();
  if (autoPrecache.abort) return { ok:false, aborted:true };

  // Spieldateien teilen sich alle Profile mit gleicher Version/Loader.
  const gameKey = `${version}|${loader}`;
  if (!autoPrecache.gameDone.has(gameKey)) {
    try {
      const javas = await findInstalledJavas();
      await precacheStep();
      if (autoPrecache.abort) return { ok:false, aborted:true };
      const javaPath = javas[0]?.path || null;
      if (javaPath) {
        let loaderId = null;
        if (loader === 'fabric' || loader === 'quilt') {
          const r = await ensureLoaderForOffline(version, loader, javaPath, send).catch(() => ({ installed:false, id:null }));
          loaderId = r.id;
        }
        await precacheStep();
        if (autoPrecache.abort) return { ok:false, aborted:true };
        send('Spieldateien (Version, Libraries, Assets)…');
        const g = await predownloadVanillaGameFiles(version, javaPath, send, loaderId || undefined);
        if (g && g.paused) return { ok:false, paused:true };
        if (autoPrecache.abort) return { ok:false, aborted:true };
        if (g && g.jsonOk && g.jarOk) autoPrecache.gameDone.add(gameKey);
      }
    } catch (e) {
      console.error('[OFFLINE-CACHE] Game files:', e.message);
    }
  }
  precacheTime(`Spieldateien ${profile.name || profile.id}`, phaseStart.game);

  await precacheStep();
  if (autoPrecache.abort) return { ok:false, aborted:true };
  send('Mods…');
  phaseStart.mods = Date.now();
  const modsDownloaded = await downloadProfileMods(profile, mods, version, loader, send);
  precacheTime(`Mods ${profile.name || profile.id}`, phaseStart.mods);
  await precacheStep();
  if (autoPrecache.abort) return { ok:false, aborted:true };
  phaseStart.rps = Date.now();
  await precacheResourcePacks(profile, version, send);
  precacheTime(`Ressourcenpakete ${profile.name || profile.id}`, phaseStart.rps);
  await precacheStep();
  if (autoPrecache.abort) return { ok:false, aborted:true };
  send(`Fertig: ${profile.name || profile.id}`);
  return { ok:true, version, modsDownloaded };
}

// Manueller Handler bleibt für die API erhalten (die UI hat keinen Button mehr).
ipcMain.handle('profile-download-offline', async (event, payload) => {
  try {
    const r = await precacheProfileAssets(payload && payload.profile,
      (payload && payload.clientMods) || [], [], precacheLog);
    return { ok:r.ok, error:r.error, version:r.version, modsDownloaded:r.modsDownloaded || 0,
      gameFiles:{ jsonOk:true, jarOk:true, assetsOk:true } };
  } catch (e) { return { ok:false, error:e.message }; }
});

function scheduleAutoPrecache(delay = 4000) {
  if (autoPrecache.timer) clearTimeout(autoPrecache.timer);
  autoPrecache.timer = setTimeout(() => {
    autoPrecache.timer = null;
    runAutoPrecache().catch(e => console.error('[OFFLINE-CACHE]', e.message));
  }, delay);
}

async function runAutoPrecache() {
  if (autoPrecache.busy || !mainWindow) return;
  // Solange der Nutzer arbeitet, gar nicht erst anfangen. Nach seiner Aktion
  // wird der Cache automatisch wieder eingeplant.
  if (autoPrecache.userBusy) { scheduleAutoPrecache(15000); return; }
  const profiles = autoPrecache.profiles.filter(p => p && p.id && p.modLoader !== 'bedrock');
  if (!profiles.length) return;
  // Keine Änderungen an einem laufenden Spiel vornehmen.
  try { if (Object.keys(instances).length) { scheduleAutoPrecache(60000); return; } } catch {}

  autoPrecache.busy = true;
  autoPrecache.abort = false;
  autoPrecache.userInterrupted = false;
  const mods = [...(autoPrecache.mods || []), ...(autoPrecache.clientMods || [])];
  const rps = autoPrecache.clientRPs || [];
  try {
    for (const p of profiles) {
      await precacheStep();
      if (autoPrecache.abort) break;
      const version = resolveConcreteVersion(p.mcVersion);
      if (!version) continue;
      const loader = p.modLoader || 'fabric';
      const hash = autoPrecacheHash(p, version, loader, mods, rps);
      const gameReady = autoPrecache.gameDone.has(`${version}|${loader}`);
      // Erst fertig, wenn auch die Spieldateien da sind (sonst alle 5 Min erneut).
      if (autoPrecache.done.get(p.id) === hash && gameReady) continue;
      try {
        const r = await precacheProfileAssets(p, mods, rps, precacheLog);
        if (r.aborted || r.paused) break;
        if (r.ok) autoPrecache.done.set(p.id, hash);
      } catch (e) {
        console.error('[OFFLINE-CACHE] Profile failed:', p.name || p.id, e.message);
      }
      await precacheStep();
    }
  } finally {
    autoPrecache.busy = false;
    autoPrecache.abort = false;
    // Der nächste Lauf startet wieder frisch, sobald der Nutzer fertig ist.
    autoPrecache.userInterrupted = false;
  }
}

// Fehlgeschlagene Downloads werden nachgeholt, erfolgreiche per Hash übersprungen.
setInterval(() => scheduleAutoPrecache(0), 5 * 60 * 1000).unref?.();

ipcMain.handle('copy-mod-to-profile', async (event, { profileId, sourcePath, fileName }) => { console.log("[COPY-MOD] profileId:", profileId, "sourcePath:", sourcePath, "fileName:", fileName);
  try {
    if (!profileId || !sourcePath || !fs.existsSync(sourcePath)) {
      return { ok:false, error:'Invalid parameters or source file not found.' };
    }
    const gameDir = instanceDir(profileId);
    const modsDir = path.join(gameDir, 'mods');
    await fs.promises.mkdir(modsDir, { recursive:true });
    const destName = fileName || path.basename(sourcePath);
    const destPath = path.join(modsDir, destName);
    await fs.promises.copyFile(sourcePath, destPath);
    return { ok:true, destPath };
  } catch (e) {
    return { ok:false, error: e.message };
  }
});

// ── NoRisk Client import: installed client (v3 norisk_versions.json / legacy
//    profiles.json) + exported .noriskpack files (ZIP with profile.json + overrides/) ──
const NRC_VALID_LOADERS = ['vanilla','fabric','forge','quilt','neoforge','bedrock'];
const NRC_REPO_SET = new Set(['noriskproduction','norisksnapshots','norisk']);
const NRC_OVERRIDES_PREFIX = 'overrides/';

// Parse JSON tolerating a UTF-8 BOM (some exports write one).
function nrcParseJson(text){
  return JSON.parse(String(text).replace(/^\uFEFF/, ''));
}

function nrcNormalizeLoader(l){
  const v = String(l || 'fabric').toLowerCase();
  return NRC_VALID_LOADERS.includes(v) ? v : 'fabric';
}

// Convert one NoRisk mod entry into a Crux profile mod (or null when it can't be ported).
function nrcConvertMod(m, mcVersion){
  if (!m || typeof m !== 'object') return null;
  const src = m.source || {};
  const srcType = String(src.type || '').toLowerCase();
  const repo = String(src.repository || '').toLowerCase();
  const display = String(m.display_name || m.name || '');
  // NoRisk's own client modules don't exist in this launcher — drop them.
  if (NRC_REPO_SET.has(repo)) return null;
  if (/noriskclient/i.test(display)) return null;
  const base = {
    name: display || 'Mod',
    version: m.version || 'latest',
    mcVersion: mcVersion || (Array.isArray(m.game_versions) && m.game_versions[0]) || 'latest',
    source: '',
    iconUrl: '',
    downloadAllVersions: true,
    disabled: m.enabled === false,
    loader: 'any'
  };
  if (srcType === 'modrinth') {
    const pid = src.project_id || (typeof src.artifact === 'string' ? src.artifact.split(':')[1] : null);
    if (!pid) return null;
    return Object.assign(base, { name: display || pid, source: 'Modrinth', modrinthId: String(pid) });
  }
  if (srcType === 'curse_forge' || srcType === 'curseforge') {
    const pid = src.project_id;
    if (!pid) return null;
    return Object.assign(base, { name: display || String(pid), source: 'CurseForge', curseforgeId: String(pid) });
  }
  return null;
}

// Convert one NoRisk profile object into a Crux profile object.
function nrcConvertProfile(np){
  const mcVersion = String(np.game_version || '');
  const loader = nrcNormalizeLoader(np.loader);
  const mods = [];
  let skipped = 0;
  for (const m of (np.mods || [])) {
    const c = nrcConvertMod(m, mcVersion);
    if (c) mods.push(c); else skipped++;
  }
  const name = String(np.name || 'NoRisk Profile').slice(0, 60);
  return {
    id: 'nrc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
    name,
    group: (typeof np.group === 'string' && np.group.trim()) ? np.group.trim() : name,
    mcVersion,
    modLoader: loader,
    renderApi: 'opengl',
    mods,
    datapacks: [],
    resourcePacks: [],
    shaderPacks: [],
    useCruxMod: false,
    useClientMods: true,
    useClientRPs: true,
    isNrcImported: true,
    _nrcSkipped: skipped
  };
}

function nrcConvertList(list){
  const profiles = [];
  let skippedMods = 0;
  for (const np of (Array.isArray(list) ? list : [])) {
    if (!np || typeof np !== 'object' || !np.name) continue;
    const p = nrcConvertProfile(np);
    skippedMods += p._nrcSkipped || 0;
    delete p._nrcSkipped;
    profiles.push(p);
  }
  return { profiles, skippedMods };
}

function nrcCandidates(){
  const dirs = [
    process.env.APPDATA ? path.join(process.env.APPDATA, 'norisk', 'NoRiskClientV3') : '',
    path.join(os.homedir(), 'AppData', 'Roaming', 'norisk', 'NoRiskClientV3'),
  ].filter(Boolean);
  const files = [];
  for (const d of dirs) {
    files.push(path.join(d, 'norisk_versions.json'));   // NoRisk v3
    files.push(path.join(d, 'profiles.json'));           // legacy v2
  }
  return files;
}

// Read the root profile manifest out of a NoRisk ZIP export (streaming — no full load).
function nrcReadZipProfile(zipPath){
  return new Promise((resolve, reject) => {
    if (!yauzl) return reject(new Error('yauzl module not available'));
    yauzl.open(zipPath, { lazyEntries:true, autoClose:true }, (err, zip) => {
      if (err) return reject(err);
      let profileBuf = null;
      let overrideBytes = 0, overrideCount = 0, hasOverrides = false;
      zip.on('entry', (entry) => {
        const name = entry.fileName;
        if (name === 'profile.json' || name === 'profiles.json') {
          zip.openReadStream(entry, (e, rs) => {
            if (e) return reject(e);
            const chunks = [];
            rs.on('data', c => chunks.push(c));
            rs.on('end', () => { profileBuf = Buffer.concat(chunks); zip.readEntry(); });
            rs.on('error', reject);
          });
          return;
        }
        if (name.startsWith(NRC_OVERRIDES_PREFIX)) {
          hasOverrides = true;
          if (!name.endsWith('/')) { overrideBytes += (entry.uncompressedSize || 0); overrideCount++; }
        }
        zip.readEntry();
      });
      zip.on('end', () => resolve({ profileBuf, hasOverrides, overrideBytes, overrideCount }));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

// Stream every overrides/* entry from a NoRisk ZIP into destRoot.
// Skips overrides/mods: NoRisk's mods are converted into the profile's mod list
// (and downloaded by Crux), so extracting the jars too would duplicate them.
const NRC_OVERRIDES_SKIP = new Set(['mods']);
function nrcExtractOverrides(zipPath, destRoot, onBytes){
  return new Promise((resolve, reject) => {
    if (!yauzl) return reject(new Error('yauzl module not available'));
    yauzl.open(zipPath, { lazyEntries:true, autoClose:true }, (err, zip) => {
      if (err) return reject(err);
      let extracted = 0, errors = 0;
      const next = () => zip.readEntry();
      zip.on('entry', (entry) => {
        const name = entry.fileName;
        if (!name.startsWith(NRC_OVERRIDES_PREFIX) || name.endsWith('/')) return next();
        const rel = name.slice(NRC_OVERRIDES_PREFIX.length);
        if (!rel) return next();
        const top = rel.split('/')[0].toLowerCase();
        if (NRC_OVERRIDES_SKIP.has(top)) { if (onBytes) onBytes(entry.uncompressedSize || 0); return next(); }
        const dest = path.join(destRoot, rel);
        fs.promises.mkdir(path.dirname(dest), { recursive:true }).then(() => {
          zip.openReadStream(entry, (e, rs) => {
            if (e) { errors++; return next(); }
            let advanced = false;
            const advance = () => { if (advanced) return; advanced = true; next(); };
            const ws = fs.createWriteStream(dest);
            rs.on('error', () => { errors++; try { ws.destroy(); } catch {} advance(); });
            ws.on('error', () => { errors++; try { rs.destroy(); } catch {} advance(); });
            ws.on('close', () => { extracted++; if (onBytes) onBytes(entry.uncompressedSize || 0); advance(); });
            rs.pipe(ws);
          });
        }).catch(() => { errors++; next(); });
      });
      zip.on('end', () => resolve({ extracted, errors }));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

// Auto-scan the installed NoRisk Client (v3 norisk_versions.json or legacy profiles.json).
ipcMain.handle('import-norisk-profiles', async () => {
  try {
    const profiles = [];
    const skippedMods = 0;
    const nrcBases = [
      process.env.APPDATA ? path.join(process.env.APPDATA, 'norisk', 'NoRiskClientV3') : '',
      path.join(os.homedir(), 'AppData', 'Roaming', 'norisk', 'NoRiskClientV3'),
    ].filter(Boolean);
    // 1) data/profiles (custom profiles like "Create Complete")
    const nrcMeta = (() => { try { const f = nrcCandidates().find(p => fs.existsSync(p)); if (!f) return null; const raw = fs.readFileSync(f, 'utf8'); let l = nrcParseJson(raw); if (l && !Array.isArray(l) && Array.isArray(l.profiles)) l = l.profiles; return Array.isArray(l) ? l : null; } catch { return null; } })();
    const findMetaForName = (nm) => {
      if (!nrcMeta) return null;
      const want = String(nm || '').toLowerCase();
      return nrcMeta.find(m => String(m.name || '').toLowerCase() === want) || nrcMeta.find(m => String(m.name || '').toLowerCase().includes(want) || want.includes(String(m.name || '').toLowerCase())) || null;
    };
    const parseFromModsFolder = (modsDir) => {
      let mc = 'latest', ld = 'neoforge';
      try {
        const sub = fs.readdirSync(modsDir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
        for (const s of sub) {
          const m = /^nrc-(.+?)-(forge|neoforge|fabric|quilt)$/i.exec(s);
          if (m) { mc = m[1]; ld = m[2].toLowerCase(); break; }
        }
      } catch {}
      return { mcVersion: mc, modLoader: ld };
    };
    for (const base of nrcBases) {
      const dataProfilesDir = path.join(base, 'data', 'profiles');
      if (!fs.existsSync(dataProfilesDir)) continue;
      let names = [];
      try { names = fs.readdirSync(dataProfilesDir).filter(d => { try { return fs.statSync(path.join(dataProfilesDir, d)).isDirectory(); } catch { return false; } }); } catch {}
      for (const name of names) {
        try {
          const profPath = path.join(dataProfilesDir, name);
          const meta = findMetaForName(name);
          const inferred = parseFromModsFolder(path.join(profPath, 'mods'));
          const prof = {
            id: 'nrc_dp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
            name: name,
            group: meta && meta.group ? String(meta.group) : 'NoRisk (custom)',
            mcVersion: meta && (meta.game_version || meta.gameVersion || meta.version) ? (meta.game_version || meta.gameVersion || meta.version) : inferred.mcVersion,
            modLoader: (meta && meta.loader) ? String(meta.loader).toLowerCase() : inferred.modLoader,
            renderApi: 'opengl',
            mods: [],
            datapacks: [],
            resourcePacks: [],
            shaderPacks: [],
            useCruxMod: false,
            useClientMods: true,
            useClientRPs: true,
            isNrcImported: true,
          };
          const modsDir = path.join(profPath, 'mods');
          if (fs.existsSync(modsDir)) {
            const walkJars = (dir) => {
              let out = [];
              try {
                for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                  const fp = path.join(dir, e.name);
                  if (e.isDirectory()) out = out.concat(walkJars(fp));
                  else if (e.isFile() && e.name.toLowerCase().endsWith('.jar')) out.push({ fp, name: e.name });
                }
              } catch {}
              return out;
            };
            const jars = walkJars(modsDir);
            prof.mods = jars.map(j => ({ name: j.name.replace(/\.jar$/i,''), fileName: j.name, diskPath: j.fp, path: 'mods/' + j.name, source: 'NoRisk Client', modrinthId: null, version: 'latest', mcVersion: prof.mcVersion, iconUrl: '', downloadAllVersions: false, disabled: false, loader: prof.modLoader }));
          }
          // Fallback: also search instances folders for jars if none found
          if ((!prof.mods || prof.mods.length === 0)) {
            for (const base2 of nrcBases) {
              const instancesDir = path.join(base2, 'instances');
              if (!fs.existsSync(instancesDir)) continue;
              let instanceDirs = [];
              try { instanceDirs = fs.readdirSync(instancesDir).filter(d => { try { return fs.statSync(path.join(instancesDir, d)).isDirectory(); } catch { return false; } }); } catch {}
              const want = String(prof.name || '').toLowerCase();
              let matchDir = '';
              for (const dir of instanceDirs) {
                const dl = dir.toLowerCase();
                if (want && (dl.includes(want) || want.includes(dl))) { matchDir = dir; break; }
              }
              if (!matchDir) continue;
              const instMods = path.join(instancesDir, matchDir, 'mods');
              if (fs.existsSync(instMods)) {
                const jars = fs.readdirSync(instMods).filter(f => f.toLowerCase().endsWith('.jar'));
                prof.mods = jars.map(f => ({ name: f.replace(/\.jar$/i,''), fileName: f, diskPath: path.join(instMods,f), path: 'mods/'+f, source:'NoRisk Client', modrinthId: null, version:'latest', mcVersion: prof.mcVersion||'', iconUrl:'', downloadAllVersions:false, disabled:false, loader: prof.modLoader||'fabric' }));
              }
              if (prof.mods && prof.mods.length > 0) break;
            }
          }
          const rpDir = path.join(profPath, 'resourcepacks');
          if (fs.existsSync(rpDir)) prof.resourcePacks = fs.readdirSync(rpDir).map(f => ({ name: f, path: 'resourcepacks/'+f, source: 'NoRisk Client', diskPath: path.join(rpDir,f), enabled: true }));
          const spDir = path.join(profPath, 'shaderpacks');
          if (fs.existsSync(spDir)) prof.shaderPacks = fs.readdirSync(spDir).map(f => ({ name: f, path: 'shaderpacks/'+f, source: 'NoRisk Client', diskPath: path.join(spDir,f), enabled: true }));
          const dpDir = path.join(profPath, 'datapacks');
          if (fs.existsSync(dpDir)) prof.datapacks = fs.readdirSync(dpDir).map(f => ({ name: f, path: 'datapacks/'+f, source: 'NoRisk Client', diskPath: path.join(dpDir,f), enabled: true }));
          if (!profiles.find(p => p.name === prof.name)) profiles.push(prof);
        } catch (e) {}
      }
    }
    // 2) also include entries from norisk_versions.json + instances enrichment (best effort)
    try {
      const file = nrcCandidates().find(p => fs.existsSync(p));
      if (file) {
        let raw; try { raw = await fs.promises.readFile(file, 'utf8'); } catch {}
        if (raw) {
          let list; try { list = nrcParseJson(raw); } catch {}
          if (list && !Array.isArray(list) && Array.isArray(list.profiles)) list = list.profiles;
          if (Array.isArray(list)) {
            const { profiles: plist } = nrcConvertList(list);
            for (const prof of plist) {
              // enrich from instances
              for (const base of nrcBases) {
                const instancesDir = path.join(base, 'instances');
                if (!fs.existsSync(instancesDir)) continue;
                let instanceDirs = [];
                try { instanceDirs = fs.readdirSync(instancesDir).filter(d => { try { return fs.statSync(path.join(instancesDir, d)).isDirectory(); } catch { return false; } }); } catch {}
                const want = String(prof.name || '').toLowerCase();
                let matchDir = '';
                for (const dir of instanceDirs) {
                  const dl = dir.toLowerCase();
                  if (want && (dl.includes(want) || want.includes(dl))) { matchDir = dir; break; }
                }
                if (!matchDir) continue;
                const instRoot = path.join(instancesDir, matchDir);
                const modsDir = path.join(instRoot, 'mods');
                const rpDir = path.join(instRoot, 'resourcepacks');
                const spDir = path.join(instRoot, 'shaderpacks');
                const dpDir = path.join(instRoot, 'datapacks');
                if (fs.existsSync(modsDir) && (!prof.mods || prof.mods.length === 0)) {
                  const jars = fs.readdirSync(modsDir).filter(f => f.toLowerCase().endsWith('.jar'));
                  prof.mods = jars.map(f => ({ name: f.replace(/\\.jar$/i,''), fileName: f, diskPath: path.join(modsDir,f), path: 'mods/'+f, source:'NoRisk Client', modrinthId: null, version:'latest', mcVersion: prof.mcVersion||'', iconUrl:'', downloadAllVersions:false, disabled:false, loader: prof.modLoader||'fabric' }));
                }
                if (fs.existsSync(rpDir)) prof.resourcePacks = fs.readdirSync(rpDir).map(f => ({ name: f, path: 'resourcepacks/'+f, source: 'NoRisk Client', diskPath: path.join(rpDir,f), enabled: true }));
                if (fs.existsSync(spDir)) prof.shaderPacks = fs.readdirSync(spDir).map(f => ({ name: f, path: 'shaderpacks/'+f, source: 'NoRisk Client', diskPath: path.join(spDir,f), enabled: true }));
                if (fs.existsSync(dpDir)) prof.datapacks = fs.readdirSync(dpDir).map(f => ({ name: f, path: 'datapacks/'+f, source: 'NoRisk Client', diskPath: path.join(dpDir,f), enabled: true }));
                break;
              }
              if (!profiles.find(p => p.name === prof.name)) profiles.push(prof);
            }
          }
        }
      }
    } catch (e) {}
    return { ok:true, file: 'nrc-scan', profiles, skippedMods };
  } catch (e) { return { ok:false, error: e.message }; }
});

// Import NoRisk instance — copy mods from NoRisk instance folder
ipcMain.handle('import-norisk-instance', async (event, profileName) => {
  try {
    const nrcBase = process.env.APPDATA ? path.join(process.env.APPDATA, 'norisk', 'NoRiskClientV3') : '';
    const legacyBase = path.join(os.homedir(), 'AppData', 'Roaming', 'norisk', 'NoRiskClientV3');
    const bases = [nrcBase, legacyBase].filter(Boolean);

    for (const base of bases) {
      const instancesDir = path.join(base, 'instances');
      if (!fs.existsSync(instancesDir)) continue;

      // Find instance folder matching profile name
      const instanceDirs = fs.readdirSync(instancesDir).filter(d => {
        try { return fs.statSync(path.join(instancesDir, d)).isDirectory(); } catch { return false; }
      });

      for (const dir of instanceDirs) {
        if (dir.toLowerCase().includes(profileName.toLowerCase()) || profileName.toLowerCase().includes(dir.toLowerCase())) {
          const modsPath = path.join(instancesDir, dir, 'mods');
          if (fs.existsSync(modsPath)) {
            const modFiles = fs.readdirSync(modsPath).filter(f => f.endsWith('.jar'));
            const mods = [];
            for (const f of modFiles) {
              mods.push({
                name: f.replace(/\.jar$/i, ''),
                fileName: f,
                diskPath: path.join(modsPath, f),
                path: 'mods/' + f,
                source: 'NoRisk Client', modrinthId: null, version: 'latest',
                mcVersion: '', iconUrl: '', downloadAllVersions: false, disabled: false, loader: 'fabric'
              });
            }
            return { ok: true, mods };
          }
        }
      }
    }
    return { ok: true, mods: [] };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Open a file dialog and parse a NoRisk export (any name/location: .noriskpack/.zip/.json).

ipcMain.handle('choose-mrpack', async () => {
  try {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Select a Modrinth modpack (.mrpack)',
      properties: ['openFile'],
      filters: [{ name: 'Modrinth Modpack', extensions: ['mrpack', 'zip'] }, { name: 'All Files', extensions: ['*'] }]
    });
    if (res.canceled || !res.filePaths || !res.filePaths.length) return { ok: true, canceled: true };
    const file = res.filePaths[0];
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(file);
    const entry = zip.getEntry('modrinth.index.json');
    if (!entry) return { ok: false, error: 'modrinth.index.json not found in this .mrpack (is this a valid Modrinth modpack?)' };
    let idx;
    try { idx = JSON.parse(entry.getData().toString('utf8')); } catch (e) { return { ok: false, error: 'Invalid modrinth.index.json: ' + e.message }; }
    const deps = (idx && idx.dependencies) || {};
    const mcVer = deps.minecraft || '';
    const loader = deps['fabric-loader'] ? 'fabric' : (deps['quilt-loader'] ? 'quilt' : (deps['neoforge'] ? 'neoforge' : (deps.forge ? 'forge' : 'fabric')));
    const loaderVer = deps['fabric-loader'] || deps['quilt-loader'] || deps['neoforge'] || deps.forge || '';
    const name = (idx && (idx.name || idx.versionId)) || path.basename(file, path.extname(file));
    const files = Array.isArray(idx.files) ? idx.files : [];
    // External file URLs (mods/resources) listed in index; we cannot auto-download into profile store without more logic
    const prof = {
      id: 'mr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      name: String(name).slice(0, 120),
      mcVersion: String(mcVer || 'latest'),
      modLoader: loader,
      loaderVersion: String(loaderVer || ''),
      mods: [],
      datapacks: [],
      resourcePacks: [],
      shaderPacks: [],
      useCruxMod: true,
      useClientMods: false,
      useClientRPs: false,
      isMrpackImport: true,
      mrpackSourceFile: file,
      mrpackFilesCount: files.length
    };
    return { ok: true, file, profile: prof, mrpackIndex: { name: idx.name, game: idx.game, versionId: idx.versionId, filesCount: files.length, dependencies: deps } };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});


ipcMain.handle('choose-mrpack-path', async (event, filePath) => {
  try {
    if (!filePath || typeof filePath !== 'string') return { ok: false, error: 'No path' };
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(filePath);
    const entry = zip.getEntry('modrinth.index.json');
    if (!entry) return { ok: false, error: 'modrinth.index.json not found in this .mrpack' };
    let idx;
    try { idx = JSON.parse(entry.getData().toString('utf8')); } catch (e) { return { ok: false, error: 'Invalid modrinth.index.json: ' + e.message }; }
    const deps = (idx && idx.dependencies) || {};
    const mcVer = deps.minecraft || '';
    const loader = deps['fabric-loader'] ? 'fabric' : (deps['quilt-loader'] ? 'quilt' : (deps['neoforge'] ? 'neoforge' : (deps.forge ? 'forge' : 'fabric')));
    const loaderVer = deps['fabric-loader'] || deps['quilt-loader'] || deps['neoforge'] || deps.forge || '';
    const name = (idx && (idx.name || idx.versionId)) || path.basename(filePath, path.extname(filePath));
    const files = Array.isArray(idx.files) ? idx.files : [];
    const prof = {
      id: 'mr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      name: String(name).slice(0, 120),
      mcVersion: String(mcVer || 'latest'),
      modLoader: loader,
      loaderVersion: String(loaderVer || ''),
      mods: [],
      datapacks: [],
      resourcePacks: [],
      shaderPacks: [],
      useCruxMod: true,
      useClientMods: false,
      useClientRPs: false,
      isMrpackImport: true,
      mrpackSourceFile: filePath,
      mrpackFilesCount: files.length
    };
    return { ok: true, file: filePath, profile: prof, mrpackIndex: { name: idx.name, game: idx.game, versionId: idx.versionId, filesCount: files.length, dependencies: deps } };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});
ipcMain.handle('import-mrpack-from-url', async (event, url) => {
  try {
    const u = String(url || '');
    if (!u.startsWith('https://') && !u.startsWith('http://')) return { ok: false, error: 'Invalid URL' };
    const tmp = path.join(os.tmpdir(), 'crux-mrpack-' + Date.now() + '.mrpack');
    await new Promise((resolve, reject) => {
      const mod = u.startsWith('https') ? https : http;
      const req = mod.get(u, { headers: { 'User-Agent': 'CruxLauncher/1' } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          // follow once
          const loc = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, u).toString();
          const mod2 = loc.startsWith('https') ? https : http;
          const req2 = mod2.get(loc, { headers: { 'User-Agent': 'CruxLauncher/1' } }, (res2) => {
            if (res2.statusCode !== 200) { res2.resume(); return reject(new Error('HTTP ' + res2.statusCode)); }
            const ws = fs.createWriteStream(tmp);
            res2.pipe(ws);
            ws.on('finish', () => ws.close(resolve));
            ws.on('error', reject);
          });
          req2.on('error', reject);
          return;
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
        const ws = fs.createWriteStream(tmp);
        res.pipe(ws);
        ws.on('finish', () => ws.close(resolve));
        ws.on('error', reject);
      });
      req.on('error', reject);
    });
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(tmp);
    const entry = zip.getEntry('modrinth.index.json');
    if (!entry) { try { fs.unlinkSync(tmp); } catch {} return { ok: false, error: 'modrinth.index.json not found' }; }
    let idx;
    try { idx = JSON.parse(entry.getData().toString('utf8')); } catch (e) { try { fs.unlinkSync(tmp); } catch {} return { ok: false, error: 'Invalid modrinth.index.json: ' + e.message }; }
    const deps = (idx && idx.dependencies) || {};
    const mcVer = deps.minecraft || '';
    const loader = deps['fabric-loader'] ? 'fabric' : (deps['quilt-loader'] ? 'quilt' : (deps['neoforge'] ? 'neoforge' : (deps.forge ? 'forge' : 'fabric')));
    const loaderVer = deps['fabric-loader'] || deps['quilt-loader'] || deps['neoforge'] || deps.forge || '';
    const name = (idx && (idx.name || idx.versionId)) || 'Modrinth Modpack';
    const files = Array.isArray(idx.files) ? idx.files : [];
    const prof = {
      id: 'mr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      name: String(name).slice(0, 120),
      mcVersion: String(mcVer || 'latest'),
      modLoader: loader,
      loaderVersion: String(loaderVer || ''),
      mods: [],
      datapacks: [],
      resourcePacks: [],
      shaderPacks: [],
      useCruxMod: true,
      useClientMods: false,
      useClientRPs: false,
      isMrpackImport: true,
      mrpackSourceFile: tmp,
      mrpackFilesCount: files.length
    };
    return { ok: true, file: tmp, profile: prof, mrpackIndex: { name: idx.name, game: idx.game, versionId: idx.versionId, filesCount: files.length, dependencies: deps } };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});


// Gemeinsamer Parser fuer Datei-Dialog UND Drag & Drop.
async function readNoriskExportFile(file){
  try {
    // Drag & Drop muss den echten Pfad liefern - ein reiner Dateiname wuerde
    // relativ zum Installationsordner aufgeloest werden (ENOENT).
    if (!file || !path.isAbsolute(file)) return { ok:false, error:'No absolute file path. Drag the export from Explorer or use "Choose file".' };
    const stat = await fs.promises.stat(file);

    // Detect ZIP by magic bytes ("PK").
    const fh = await fs.promises.open(file, 'r');
    const head = Buffer.alloc(4);
    await fh.read(head, 0, 4, 0);
    await fh.close();
    const isZip = head[0] === 0x50 && head[1] === 0x4b;

    let parsed = null, hasOverrides = false;
    if (isZip) {
      const r = await nrcReadZipProfile(file);
      hasOverrides = r.hasOverrides;
      if (!r.profileBuf) return { ok:false, error:'The archive contains no profile.json — is this really a NoRisk export?' };
      try { parsed = nrcParseJson(r.profileBuf.toString('utf8')); }
      catch(e) { return { ok:false, error:'profile.json inside the export is not valid JSON: ' + e.message }; }
    } else {
      const raw = await fs.promises.readFile(file, 'utf8');
      try { parsed = nrcParseJson(raw); }
      catch(e) { return { ok:false, error:'Not a valid NoRisk export or JSON file: ' + e.message }; }
    }

    let list;
    if (Array.isArray(parsed)) list = parsed;
    else if (parsed && Array.isArray(parsed.profiles)) list = parsed.profiles;
    else if (parsed && (parsed.game_version || parsed.mods)) list = [parsed];
    else return { ok:false, error:'No NoRisk profile found in this file.' };

    const { profiles, skippedMods } = nrcConvertList(list);
    if (!profiles.length) return { ok:false, error:'No importable profile found in this file.' };
    return { ok:true, canceled:false, file, isZip, hasOverrides, sizeBytes: stat.size, profiles, skippedMods };
  } catch (e) { return { ok:false, error: e.message }; }
}

ipcMain.handle('choose-norisk-export', async () => {
  try {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Select a NoRisk Client export',
      properties: ['openFile'],
      filters: [
        { name: 'NoRisk Export', extensions: ['noriskpack','zip','json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    if (res.canceled || !res.filePaths || !res.filePaths.length) return { ok:true, canceled:true };
    return await readNoriskExportFile(res.filePaths[0]);
  } catch (e) { return { ok:false, error: e.message }; }
});

ipcMain.handle('read-norisk-export', async (event, filePath) => {
  if (!filePath || typeof filePath !== 'string') return { ok:false, error:'Kein Pfad angegeben' };
  return readNoriskExportFile(filePath);
});

// Extract the export's overrides/ game files straight into the imported
// profile's own game directory (worlds, configs, packs, mods).
ipcMain.handle('extract-norisk-overrides', async (e, opts = {}) => {
  const { file, profileId, profileName } = opts;
  try {
    if (!file || !fs.existsSync(file)) return { ok:false, error:'Export file not found.' };
    const gameDir = instanceDir(profileId || profileName || 'NoRisk');
    await fs.promises.mkdir(gameDir, { recursive:true });

    const notify = (payload) => { try { mainWindow.webContents.send('norisk-import-progress', payload); } catch {} };

    notify({ message:'Reading export…', percent:0, phase:'scan' });
    const scan = await nrcReadZipProfile(file);
    const total = scan.overrideBytes || 1;
    let doneBytes = 0, lastPct = -1;

    notify({ message:'Importing game files…', percent:0, phase:'extract' });
    const res = await nrcExtractOverrides(file, gameDir, (bytes) => {
      doneBytes += bytes;
      const pct = Math.min(99, Math.round(doneBytes / total * 100));
      if (pct !== lastPct) { lastPct = pct; notify({ message:'Importing game files…', percent:pct, phase:'extract' }); }
    });

    notify({ message:'Game files imported.', percent:100, phase:'done' });
    logDebug(`[NRC] Imported overrides from ${file} into instance "${gameDir}" (${res.extracted} files, ${res.errors} errors)`);
    return { ok:true, gameDir, extracted:res.extracted, errors:res.errors, totalBytes:scan.overrideBytes, hasOverrides:scan.hasOverrides };
  } catch (err) { return { ok:false, error: err.message }; }
});
ipcMain.on('save-launched-versions', async (e,d) => save(P.launched, d));
ipcMain.on('show-launcher', () => { if(mainWindow) mainWindow.show(); });
ipcMain.on('save-mods', async (e, data) => {
  save(P.mods, data);
  autoPrecache.mods = Array.isArray(data) ? data : [];
  scheduleAutoPrecache();
  const byVer = {};
  for (const m of data) { if (!byVer[m.mcVersion]) byVer[m.mcVersion]=[]; byVer[m.mcVersion].push(m); }
  for (const [ver,mods] of Object.entries(byVer)) {
    const dir = path.join(P.clientMods, ver); await fs.promises.mkdir(dir, { recursive:true }).catch(()=>{});
    for (const m of mods) { const safe = m.name.replace(/[^a-zA-Z0-9_\-. ]/g,'_'); await save(path.join(dir,`${safe}.json`), m); }
  }
});

// ── Profile Settings Groups ──────────────────────────────────────────────────
// Profiles that share the same group name share the same Minecraft settings
// (options.txt: keybinds, video settings, ...). Each group keeps its own
// options.txt under groups/<group>/, like NoRisk Client does.
function groupDirName(group){
  return sanitizeFileName(String(group || 'default').trim()) || 'default';
}
// Importierte Profile haben nach aussen die normale Gruppe "default", behalten
// aber intern ihre eigene Gruppe, damit sich ihre Einstellungen nicht gegenseitig
// ueberschreiben. Nur die Datenhaltung nutzt dataGroup, die UI zeigt group.
function effectiveDataGroup(profile){
  const internal = profile && profile.dataGroup && String(profile.dataGroup).trim();
  if (internal) return String(internal);
  const own = profile && profile.group && String(profile.group).trim();
  return own ? String(own) : 'default';
}
function groupOptionsPath(group){
  return path.join(P.groups, groupDirName(group), 'options.txt');
}
async function applyGroupSettings(group, gameDir){
  try{
    await fs.promises.mkdir(P.groups, { recursive: true });
    const gFile = groupOptionsPath(group);
    const mcOptions = path.join(gameDir || P.mc, 'options.txt');
    if (fs.existsSync(gFile)) {
      await fs.promises.mkdir(path.dirname(mcOptions), { recursive: true });
      await fs.promises.copyFile(gFile, mcOptions);
      logDebug(`[GROUP] Applied settings of group "${group}" to ${gameDir || P.mc}`);
    } else if (fs.existsSync(mcOptions)) {
      await fs.promises.mkdir(path.dirname(gFile), { recursive: true });
      await fs.promises.copyFile(mcOptions, gFile);
      logDebug(`[GROUP] Seeded group "${group}" from ${gameDir || P.mc}`);
    }
  } catch(e){ logDebug('[GROUP] apply failed: ' + e.message); }
}
async function syncGroupSettings(group, gameDir){
  try{
    const mcOptions = path.join(gameDir || P.mc, 'options.txt');
    if (!fs.existsSync(mcOptions)) return;
    const gFile = groupOptionsPath(group);
    await fs.promises.mkdir(path.dirname(gFile), { recursive: true });
    await fs.promises.copyFile(mcOptions, gFile);
    logDebug(`[GROUP] Saved settings of group "${group}"`);
  } catch(e){ logDebug('[GROUP] sync failed: ' + e.message); }
}

// ── Per-group game data (saves + servers.dat) ────────────────────────────────
// Worlds and the multiplayer server list are separated per settings group, so
// starting a profile from another group never shows the other group's worlds.
const currentGroupFile = path.join(base, 'current-group.json');
function getCurrentGroup(){
  try {
    const d = JSON.parse(fs.readFileSync(currentGroupFile, 'utf8'));
    if (d && typeof d.group === 'string' && d.group) return d.group;
  } catch {}
  return 'default';
}
function setCurrentGroup(group){
  try { fs.writeFileSync(currentGroupFile, JSON.stringify({ group: group || 'default' })); } catch {}
}
function groupSavesPath(group){
  return path.join(P.groups, groupDirName(group), 'saves');
}
// Liest den LevelName aus einer (gepackten) level.dat — reiner NBT-String-Scan.
function readLevelNameFromDat(datFile){
  try {
    const zlib = require('zlib');
    let buf = fs.readFileSync(datFile);
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
    const i = buf.indexOf('LevelName');
    if (i < 0) return null;
    const p = i + 9;              // nach dem 9-Byte-Schluessel kommt die String-Laenge (int16)
    if (p + 2 > buf.length) return null;
    const len = buf.readUInt16BE(p);
    if (len <= 0 || p + 2 + len > buf.length) return null;
    return buf.toString('utf8', p + 2, p + 2 + len);
  } catch { return null; }
}
// "Weltname" -> Save-Ordner (fuer --quickPlaySingleplayer aus Recent > Welten)
function resolveSaveFolder(worldName, gameDir){
  const savesDir = path.join(gameDir || P.mc, 'saves');
  if (!worldName || !fs.existsSync(savesDir)) return null;
  let dirs = [];
  try { dirs = fs.readdirSync(savesDir).filter(d => fs.existsSync(path.join(savesDir, d, 'level.dat'))); } catch { return null; }
  if (!dirs.length) return null;
  const name = String(worldName);
  if (dirs.includes(name)) return name;
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const want = norm(name);
  for (const d of dirs) {
    const lvl = readLevelNameFromDat(path.join(savesDir, d, 'level.dat'));
    if (lvl && norm(lvl) === want) return d;
  }
  const loose = dirs.find(d => norm(d) === want);
  if (loose) return loose;
  // Quasi-Gleichstand ("Meine Welt" <-> "Meine Welt (Kopie)")
  const score = dirs.map(d => {
    const a = norm(readLevelNameFromDat(path.join(savesDir, d, 'level.dat')) || d);
    let s = 0;
    for (const ch of new Set(want)) if (a.includes(ch)) s++;
    return { d, s };
  }).sort((x, y) => y.s - x.s)[0];
  if (score && score.s / Math.max(1, new Set(want).size) >= 0.8) return score.d;
  return null;
}
// --quickPlaySingleplayer gibt es erst ab 1.20 (Bedrock kennt keine CLI-Args)
function mcVersionAtLeast(v, major, minor){
  if (!v) return false;
  const bedrock = v === '__latest_prerelease__' || v === 'bedrock' || (typeof v === 'string' && /bedrock/i.test(v));
  if (bedrock) return false;
  const m = String(v).match(/(\d+)\.(\d+)/);
  if (!m) return false;
  const a = +m[1], b = +m[2];
  return a > major || (a === major && b >= minor);
}
// Setzt LastPlayed der level.dat auf jetzt -> Welt steht oben in der Singleplayer-Liste.
// Das ist der Fallback fuer Minecraft < 1.20 und Bedrock: dort gibt es kein --quickPlaySingleplayer,
// also wird die Welt wenigstens als "zuletzt gespielt" markiert (1 Klick noetig).
// TAG_Long hat immer 8 Byte Payload -> Laenge bleibt gleich, alle NBT-Offsets bleiben gueltig.
function markSaveAsLastPlayed(folder, gameDir){
  try {
    const file = path.join(gameDir || P.mc, 'saves', folder, 'level.dat');
    if (!fs.existsSync(file)) return false;
    const zlib = require('zlib');
    let buf = fs.readFileSync(file);
    const gz = buf[0] === 0x1f && buf[1] === 0x8b;
    if (gz) buf = zlib.gunzipSync(buf);
    const i = buf.indexOf('LastPlayed');
    if (i < 0) return false;
    const p = i + 10;                  // 10 Byte Schluesselname, danach 8 Byte Long
    if (p + 8 > buf.length) return false;
    buf.writeBigInt64BE(BigInt(Date.now()), p);
    fs.writeFileSync(file, gz ? zlib.gzipSync(buf) : buf);
    return true;
  } catch { return false; }
}
function worldJoinArgs(data, log, gameDir){
  const out = [];
  if (!data.worldFolder) return out;
  const folder = resolveSaveFolder(data.worldFolder, gameDir);
  if (!folder) {
    log(`[LAUNCH] Welt "${data.worldFolder}" nicht unter saves gefunden — starte ohne Welt-Join`);
    return out;
  }
  // Java ab 1.20: echter Direct-Join
  if (data.modLoader !== 'bedrock' && mcVersionAtLeast(data.version, 1, 20)) {
    out.push('--quickPlaySingleplayer', folder);
    log(`[LAUNCH] Join Welt: ${folder}`);
    return out;
  }
  // Fallback: Welt als zuletzt gespielt markieren, damit sie in der Liste oben steht
  if (markSaveAsLastPlayed(folder, gameDir)) {
    log(`[LAUNCH] ${data.modLoader === 'bedrock' ? 'Bedrock' : 'Minecraft ' + data.version} kann die Welt nicht direkt oeffnen — Welt "${folder}" als "zuletzt gespielt" markiert (Singleplayer -> 1. Klick)`);
  } else {
    log(`[LAUNCH] ${data.modLoader === 'bedrock' ? 'Bedrock' : 'Minecraft ' + data.version} kann die Welt nicht direkt oeffnen — starte normal (Singleplayer -> "${folder}")`);
  }
  return out;
}
function groupServersDatPath(group){
  return path.join(P.groups, groupDirName(group), 'servers.dat');
}
// Move the active game data (P.mc/saves + servers.dat) into a group's storage.
async function stashGameDataToGroup(group){
  const gDir = path.join(P.groups, groupDirName(group));
  const gSaves = groupSavesPath(group);
  const gServers = groupServersDatPath(group);
  try {
    await fs.promises.mkdir(gSaves, { recursive: true });
    const mcSaves = path.join(P.mc, 'saves');
    if (fs.existsSync(mcSaves)) {
      const entries = await fs.promises.readdir(mcSaves);
      for (const en of entries) {
        const src = path.join(mcSaves, en);
        const dst = path.join(gSaves, en);
        try { await fs.promises.rm(dst, { recursive: true, force: true }); } catch {}
        try { await fs.promises.rename(src, dst); }
        catch {
          try { await fs.promises.cp(src, dst, { recursive: true }); await fs.promises.rm(src, { recursive: true, force: true }); } catch {}
        }
      }
    }
    const mcServers = path.join(P.mc, 'servers.dat');
    if (fs.existsSync(mcServers)) {
      await fs.promises.mkdir(gDir, { recursive: true });
      try { await fs.promises.rename(mcServers, gServers); }
      catch { try { await fs.promises.copyFile(mcServers, gServers); await fs.promises.rm(mcServers, { force: true }); } catch {} }
    }
    logDebug(`[GROUP] Stashed game data into group "${group}"`);
  } catch(e){ logDebug('[GROUP] stash failed: ' + e.message); }
}
// Move a group's stored saves + servers.dat into the active game directory.
async function restoreGameDataToMc(group){
  const gSaves = groupSavesPath(group);
  const gServers = groupServersDatPath(group);
  try {
    const mcSaves = path.join(P.mc, 'saves');
    if (fs.existsSync(mcSaves)) { try { await fs.promises.rm(mcSaves, { recursive: true, force: true }); } catch {} }
    if (fs.existsSync(gSaves)) {
      await fs.promises.mkdir(mcSaves, { recursive: true });
      const entries = await fs.promises.readdir(gSaves);
      for (const en of entries) {
        const src = path.join(gSaves, en);
        const dst = path.join(mcSaves, en);
        try { await fs.promises.rename(src, dst); }
        catch {
          try { await fs.promises.cp(src, dst, { recursive: true }); await fs.promises.rm(src, { recursive: true, force: true }); } catch {}
        }
      }
    }
    const mcServers = path.join(P.mc, 'servers.dat');
    if (fs.existsSync(mcServers)) { try { await fs.promises.rm(mcServers, { force: true }); } catch {} }
    if (fs.existsSync(gServers)) {
      try { await fs.promises.rename(gServers, mcServers); }
      catch { try { await fs.promises.copyFile(gServers, mcServers); await fs.promises.rm(gServers, { force: true }); } catch {} }
    }
    logDebug(`[GROUP] Restored game data of group "${group}"`);
  } catch(e){ logDebug('[GROUP] restore failed: ' + e.message); }
}
// Switch the active game data to the given group (no-op when already active).
async function swapGameDataToGroup(group){
  const current = getCurrentGroup();
  try {
    if (current === group) return;
    await stashGameDataToGroup(current);
    await restoreGameDataToMc(group);
    setCurrentGroup(group);
    logDebug(`[GROUP] Switched game data ${current} -> ${group}`);
  } catch(e){ logDebug('[GROUP] swap failed: ' + e.message); }
}

// Scan installed launchers for options.txt so the user can import keybinds/settings
ipcMain.handle('scan-mc-settings', async () => {
  const appData = process.env.APPDATA || '';
  const results = [];
  const seen = new Set();
  const skip = new Set(['Crux Client','Microsoft','Google','Edge','Spotify','npm','.vscode','Code','Docker','Slack','Discord','Teams','Zoom','Telegram','Adobe','Apple','Amazon','BraveSoftware','Citrix','VMware','Oracle','dotnet','NuGet','Android','Bing','Gnome','KDE','Mozilla','Opera','Vivaldi']);
  let visited = 0;
  const walk = (dir, depth) => {
    if (depth > 6 || visited > 4000) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const en of entries) {
      if (en.isFile() && en.name === 'options.txt') {
        const full = path.join(dir, en.name);
        if (seen.has(full)) continue;
        seen.add(full);
        results.push({ path: full, label: path.relative(appData, full) });
        continue;
      }
      if (!en.isDirectory()) continue;
      if (skip.has(en.name)) continue;
      if (depth >= 6) continue;
      visited++;
      walk(path.join(dir, en.name), depth + 1);
    }
  };
  walk(appData, 0);
  results.sort((a, b) => a.path.length - b.path.length);
  return results;
});

// Copy a launcher's options.txt into a profile settings group. It is applied
// to a profile's instance game dir at launch (when the profile sets the group).
ipcMain.handle('import-mc-settings', async (e, { group, sourcePath }) => {
  if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('Source file not found');
  const g = String(group || 'default').trim() || 'default';
  const gFile = groupOptionsPath(g);
  await fs.promises.mkdir(path.dirname(gFile), { recursive: true });
  await fs.promises.copyFile(sourcePath, gFile);
  logDebug(`[GROUP] Imported settings from ${sourcePath} into group "${g}"`);
  return { group: g, copiedTo: gFile };
});

// ── Offizieller Minecraft Launcher: Instanzen komplett importieren ────────────
// Der Original-Launcher legt seine Profile in launcher_profiles.json ab. Jedes
// dieser Profile ist eine Instanz mit eigener Version und (optional) eigenem
// Spielordner. Wir lesen die Liste und zeigen Anzahl Welten/Server/Einstellungen.
function officialMcDirs(){
  const appData = process.env.APPDATA || '';
  const localAppData = process.env.LOCALAPPDATA || '';
  const found = [];
  const seen = new Set();
  const add = (dir) => {
    if (!dir) return;
    const abs = path.resolve(dir);
    if (seen.has(abs)) return;
    seen.add(abs);
    if (fs.existsSync(path.join(abs, 'launcher_profiles.json'))) found.push(abs);
  };
  add(path.join(appData, '.minecraft'));
  add(path.join(localAppData, '.minecraft'));
  // Portable/andere Launcher-Installationen und der Microsoft-Store-Launcher
  // liegen eine oder mehrere Ebenen tiefer (auch unter LOCALAPPDATA\Packages).
  const scanChildDirs = (root, depth) => {
    if (!root || depth <= 0) return;
    try {
      for (const en of fs.readdirSync(root, { withFileTypes: true })) {
        if (!en.isDirectory() || en.name === path.basename(base)) continue;
        const dir = path.join(root, en.name);
        add(dir);
        add(path.join(dir, '.minecraft'));
        add(path.join(dir, 'LocalCache', 'Roaming', '.minecraft'));
        add(path.join(dir, 'LocalCache', 'Local', '.minecraft'));
        if (depth > 1) scanChildDirs(dir, depth - 1);
      }
    } catch {}
  };
  scanChildDirs(appData, 1);
  scanChildDirs(localAppData, 1);
  scanChildDirs(path.join(localAppData, 'Packages'), 3);
  return found;
}

function countWorlds(gameDir){
  try {
    return fs.readdirSync(path.join(gameDir, 'saves'), { withFileTypes: true })
      .filter(e => e.isDirectory() && fs.existsSync(path.join(gameDir, 'saves', e.name, 'level.dat'))).length;
  } catch { return 0; }
}
function countResourcePacks(gameDir, mcDir){
  try {
    const rpDir = fs.existsSync(path.join(gameDir, 'resourcepacks')) ? path.join(gameDir, 'resourcepacks') : path.join(mcDir, 'resourcepacks');
    return fs.readdirSync(rpDir, { withFileTypes: true }).filter(e =>
      (e.isFile() && /\.zip$/i.test(e.name)) ||
      (e.isDirectory() && fs.existsSync(path.join(rpDir, e.name, 'pack.mcmeta')))
    ).length;
  } catch { return 0; }
}

// Der Original-Launcher speichert bei vielen Profilen einen leeren Namen und
// benutzt nur den 32-Zeichen-Hash als JSON-Key. Dann lieber Typ/Version als
// Namen anzeigen statt des kryptischen Keys.
function launcherProfileName(key, pr){
  const own = typeof pr.name === 'string' ? pr.name.trim() : '';
  if (own) return own;
  const type = String(pr.type || '').toLowerCase();
  const lv = String(pr.lastVersionId || pr.version || '').toLowerCase();
  if (type === 'latest-release' || lv === 'latest-release' || lv === 'release' || lv === 'latest') return 'Latest Release';
  if (type === 'latest-snapshot' || lv === 'latest-snapshot' || lv === 'snapshot') return 'Latest Snapshot';
  const version = String(pr.lastVersionId || pr.version || '').trim();
  if (version) return version;
  if (pr.gameDir) return path.basename(String(pr.gameDir)) || 'Minecraft';
  return 'Minecraft';
}
function launcherProfileTime(value){
  if (typeof value === 'number' && isFinite(value)) return value;
  const n = Number(value);
  if (isFinite(n) && n > 0) return n;
  const t = Date.parse(String(value || ''));
  return isFinite(t) ? t : 0;
}

ipcMain.handle('scan-mc-launcher-instances', async () => {
  try {
    const dirs = officialMcDirs();
    const instances = [];
    for (const mcDir of dirs) {
      let data;
      try { data = JSON.parse(fs.readFileSync(path.join(mcDir, 'launcher_profiles.json'), 'utf8')); }
      catch { continue; }
      const entries = (data && data.profiles) || {};
      for (const [key, pr] of Object.entries(entries)) {
        if (!pr || typeof pr !== 'object') continue;
        const rawVersion = String(pr.lastVersionId || pr.version || '');
        // Leer = neueste Release (so wie das Standardprofil des Launchers),
        // __latest_snapshot__ = neueste Snapshot. Alles andere ist eine konkrete
        // Versions-ID und wird unveraendert uebernommen.
        let version = rawVersion;
        if (/^latest[-_]?release$/i.test(rawVersion) || /^release$/i.test(rawVersion) || /^latest$/i.test(rawVersion)) version = '';
        else if (/^latest[-_]?snapshot$/i.test(rawVersion) || /^snapshot$/i.test(rawVersion)) version = '__latest_snapshot__';
        let gameDir = mcDir;
        if (pr.gameDir && typeof pr.gameDir === 'string') {
          const gd = path.isAbsolute(pr.gameDir) ? pr.gameDir : path.resolve(mcDir, pr.gameDir);
          if (fs.existsSync(gd)) gameDir = gd;
        }
        // Loader aus der Versions-ID bzw. den installierten Jars erraten.
        let loader = 'vanilla';
        const vlow = rawVersion.toLowerCase();
        if (/quilt/.test(vlow)) loader = 'quilt';
        else if (/fabric/.test(vlow)) loader = 'fabric';
        else if (/neoforge/.test(vlow)) loader = 'neoforge';
        else if (/forge/.test(vlow)) loader = 'forge';
        else {
          try {
            const jarNames = fs.readdirSync(path.join(gameDir, 'mods')).filter(f => /\.jar$/i.test(f)).join(' ').toLowerCase();
            if (/quilt/.test(jarNames)) loader = 'quilt';
            else if (/fabric/.test(jarNames)) loader = 'fabric';
            else if (/neoforge/.test(jarNames)) loader = 'neoforge';
            else if (/forge/.test(jarNames)) loader = 'forge';
          } catch {}
        }
        const hasOptions = fs.existsSync(path.join(gameDir, 'options.txt')) || fs.existsSync(path.join(mcDir, 'options.txt'));
        const hasServers = fs.existsSync(path.join(gameDir, 'servers.dat')) || fs.existsSync(path.join(mcDir, 'servers.dat'));
        instances.push({
          key: String(key),
          name: launcherProfileName(key, pr),
          version,
          rawVersion,
          loader,
          mcDir,
          gameDir,
          customGameDir: path.resolve(gameDir) !== path.resolve(mcDir),
          worlds: countWorlds(gameDir) || countWorlds(mcDir),
          packs: countResourcePacks(gameDir, mcDir),
          hasOptions,
          hasServers,
          hasConfig: fs.existsSync(path.join(gameDir, 'config')),
          lastUsed: launcherProfileTime(pr.lastUsed)
        });
      }
    }
    instances.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
    return { ok: true, instances, dirs };
  } catch (e) {
    return { ok: false, error: e.message || String(e), instances: [], dirs: [] };
  }
});

// Kopiert die Daten der ausgewaehlten Launcher-Instanzen in eigene Crux-Profile.
// Einstellungen und Serverliste liegen zusaetzlich in der Settings-Group, damit
// sie von allen Profilen dieser Gruppe genutzt werden koennen.
ipcMain.handle('import-mc-launcher-instances', async (event, selected) => {
  try {
    const list = Array.isArray(selected) ? selected : [];
    if (!list.length) return { ok: false, error: 'Keine Instanz ausgewaehlt.' };
    const profiles = await load(P.profiles, []);
    const created = [];
    const progress = (message, percent) => {
      try { event.sender.send('mc-launcher-import-progress', { message, percent }); } catch {}
    };

    const copyFileTo = async (src, targets) => {
      if (!src || !fs.existsSync(src)) return false;
      for (const dst of targets) {
        try {
          await fs.promises.mkdir(path.dirname(dst), { recursive: true });
          await fs.promises.copyFile(src, dst);
        } catch {}
      }
      return true;
    };

    // Registriert mitkopierte Packs im Profil, damit sie beim Start auch
    // tatsaechlich aktiviert werden (die Dateien liegen danach im Instance-Ordner).
    const packEntries = async (dir, folder, kind) => {
      const out = [];
      try {
        for (const en of await fs.promises.readdir(dir, { withFileTypes: true })) {
          const full = path.join(dir, en.name);
          const isZip = en.isFile() && /\.zip$/i.test(en.name);
          const isFolderPack = en.isDirectory() && fs.existsSync(path.join(full, kind === 'shaderpacks' ? 'shaders' : 'pack.mcmeta'));
          if (!isZip && !isFolderPack) continue;
          out.push({
            name: en.name,
            path: folder + '/' + en.name,
            source: 'Minecraft Launcher',
            diskPath: full,
            enabled: true,
            mcVersion: 'all'
          });
        }
      } catch {}
      return out;
    };

    for (const item of list) {
      const key = String(item.key || '');
      const mcDir = String(item.mcDir || '');
      let gameDir = String(item.gameDir || mcDir);
      if (!fs.existsSync(gameDir)) gameDir = mcDir;
      // Ohne Quellordner wuerde der Import still ein leeres Profil anlegen.
      if (!gameDir || !fs.existsSync(gameDir)) {
        return { ok: false, error: 'Minecraft Launcher source directory not found: ' + (gameDir || '(empty)') };
      }
      progress('Importing ' + (item.name || key || 'Minecraft') + '…', 0);
      let name = String(item.name || key || 'Minecraft').slice(0, 120);
      if (profiles.some(p => p && p.name === name)) {
        let n = 2;
        while (profiles.some(p => p && p.name === name + ' (' + n + ')')) n++;
        name = name + ' (' + n + ')';
      }
      const id = 'mc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
      // Nach aussen "default" (gleiche Kartenoptik wie alle anderen Profile),
      // intern aber eine eigene Gruppe fuer options.txt/Server/Welten.
      const dataGroup = 'mc-' + (sanitizeFileName(name) || id);
      const gDir = path.join(P.groups, groupDirName(dataGroup));
      const dest = instanceDir(id);
      await fs.promises.mkdir(dest, { recursive: true });

      // Einstellungen: options.txt (Keybinds/Video/...) plus optionale
      // OptiFine-/Shader-Optionen. Serverliste: servers.dat. Beides liegt im
      // Custom-GameDir, falls vorhanden, sonst im .minecraft-Hauptordner.
      const srcOptions = fs.existsSync(path.join(gameDir, 'options.txt')) ? path.join(gameDir, 'options.txt') : path.join(mcDir, 'options.txt');
      const srcServers = fs.existsSync(path.join(gameDir, 'servers.dat')) ? path.join(gameDir, 'servers.dat') : path.join(mcDir, 'servers.dat');
      const settings = await copyFileTo(srcOptions, [path.join(gDir, 'options.txt'), path.join(dest, 'options.txt')]);
      const servers = await copyFileTo(srcServers, [path.join(gDir, 'servers.dat'), path.join(dest, 'servers.dat')]);
      for (const extra of ['optionsof.txt', 'optionsshaders.txt']) {
        const src = fs.existsSync(path.join(gameDir, extra)) ? path.join(gameDir, extra) : path.join(mcDir, extra);
        await copyFileTo(src, [path.join(gDir, extra), path.join(dest, extra)]);
      }

      let worlds = 0;
      progress('Copying worlds…', 35);
      const savesRoot = fs.existsSync(path.join(gameDir, 'saves')) ? path.join(gameDir, 'saves') : path.join(mcDir, 'saves');
      if (fs.existsSync(savesRoot)) {
        for (const en of await fs.promises.readdir(savesRoot, { withFileTypes: true })) {
          if (!en.isDirectory()) continue;
          const src = path.join(savesRoot, en.name);
          if (!fs.existsSync(path.join(src, 'level.dat'))) continue;
          for (const dst of [path.join(dest, 'saves', en.name), path.join(gDir, 'saves', en.name)]) {
            try { await fs.promises.mkdir(path.dirname(dst), { recursive: true }); await fs.promises.cp(src, dst, { recursive: true }); } catch {}
          }
          worlds++;
        }
      }
      // Weitere spielrelevante Ordner mitnehmen. Packs werden zusaetzlich im
      // Profil registriert, damit der Launcher sie beim Start aktiviert.
      const importedPacks = { datapacks: [], resourcePacks: [], shaderPacks: [] };
      progress('Copying resource packs and settings…', 70);
      for (const folder of ['config', 'resourcepacks', 'datapacks', 'shaderpacks']) {
        const src = fs.existsSync(path.join(gameDir, folder)) ? path.join(gameDir, folder) : path.join(mcDir, folder);
        if (!fs.existsSync(src)) continue;
        const target = path.join(dest, folder);
        try { await fs.promises.cp(src, target, { recursive: true }); } catch {}
        const key = folder === 'resourcepacks' ? 'resourcePacks' : folder === 'shaderpacks' ? 'shaderPacks' : folder;
        if (importedPacks[key]) importedPacks[key] = await packEntries(target, folder, folder);
      }
      const packCount = importedPacks.resourcePacks.length;

      const prof = {
        id, name, group:'default', dataGroup,
        // '' bleibt '' (= neueste Release), '__latest_snapshot__' bleibt erhalten.
        mcVersion: item.version != null ? String(item.version) : '',
        modLoader: String(item.loader || 'vanilla'),
        mods: [],
        datapacks: importedPacks.datapacks,
        resourcePacks: importedPacks.resourcePacks,
        shaderPacks: importedPacks.shaderPacks,
        lastUsed: Date.now(),
        isMcLauncherImport: true,
        mcLauncherKey: key,
        mcLauncherDir: gameDir,
        importedWorlds: worlds,
        importedSettings: settings,
        importedServers: servers,
        importedPacks: packCount
      };
      profiles.push(prof);
      created.push({ profile: prof, worlds, settings, servers, packs: packCount });
    }
    // Direkt schreiben, damit ein Persistenzfehler nicht als Erfolg gemeldet wird.
    await fs.promises.writeFile(P.profiles, JSON.stringify(profiles, null, 2));
    progress('Import complete', 100);
    return { ok: true, created };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

// ── Skin List ──────────────────────────────────────────────────────────────────
const skinListPath = path.join(base, 'skin-list.json');
ipcMain.handle('load-skin-list', async () => load(skinListPath, []));
ipcMain.on('save-skin-list', async (e, data) => save(skinListPath, data));

// ── Custom Cape ────────────────────────────────────────────────────────────────
const customCapePath = path.join(base, 'custom-cape.png');
const customCapeZipPath = path.join(base, 'custom-cape.zip');
const customCapeRpName = 'Crux-Custom-Cape.zip';

ipcMain.handle('save-custom-cape', async (e, dataUrl) => {
  try {
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    const buf = Buffer.from(base64, 'base64');
    await fs.promises.writeFile(customCapePath, buf);
    await buildCustomCapeResourcePack(buf);
    return { success: true };
  } catch(err) { return { success: false, error: err.message }; }
});

ipcMain.handle('load-custom-cape', async () => {
  try {
    if (!fs.existsSync(customCapePath)) return null;
    const buf = await fs.promises.readFile(customCapePath);
    return 'data:image/png;base64,' + buf.toString('base64');
  } catch { return null; }
});

ipcMain.handle('remove-custom-cape', async () => {
  try {
    if (fs.existsSync(customCapePath)) await fs.promises.unlink(customCapePath);
    if (fs.existsSync(customCapeZipPath)) await fs.promises.unlink(customCapeZipPath);
    return { success: true };
  } catch { return { success: false }; }
});

ipcMain.handle('toggle-custom-cape', async () => {
  try {
    const s = await load(P.settings, {});
    s.customCapeDisabled = !s.customCapeDisabled;
    await save(P.settings, s);
    return { success: true, disabled: s.customCapeDisabled };
  } catch { return { success: false }; }
});

ipcMain.handle('get-custom-cape-state', async () => {
  try {
    const s = await load(P.settings, {});
    return { disabled: !!s.customCapeDisabled };
  } catch { return { disabled: false }; }
});

// Selbst erstellte Capes (Liste auf der Capes-Seite, unterhalb der
// Minecraft-Capes). Wird als JSON in der base abgelegt.
const customCapeListPath = path.join(base, 'custom-cape-list.json');
ipcMain.handle('load-custom-cape-list', async () => {
  const list = await load(customCapeListPath, []);
  return Array.isArray(list) ? list : [];
});
ipcMain.on('save-custom-cape-list', async (e, data) => {
  await save(customCapeListPath, Array.isArray(data) ? data : []);
});

// Build the cape resource pack zip once, into the launcher data folder. It is
// copied into each instance's resourcepacks/ dir at launch.
async function buildCustomCapeResourcePack(capeBuf) {
  const JSZip = getJszip();
  const zip = new JSZip();
  const packMeta = JSON.stringify({ pack:{ pack_format:15, description:'Crux Custom Cape' } });
  zip.file('pack.mcmeta', packMeta);
  zip.file('assets/minecraft/textures/entity/cape.png', capeBuf);
  const zipBuf = await zip.generateAsync({ type:'nodebuffer', compression:'DEFLATE' });
  await fs.promises.writeFile(customCapeZipPath, zipBuf);
}

// Auto-deploy custom cape resource pack into the instance's game dir on launch.
async function deployCustomCapeRp(optionsPath, gameDir) {
  if (!fs.existsSync(customCapePath)) return false;
  const s = await load(P.settings, {});
  const rpDir = path.join(gameDir || P.mc, 'resourcepacks');
  const rpZip = path.join(rpDir, customCapeRpName);

  let options = '';
  try { options = await fs.promises.readFile(optionsPath, 'utf8'); } catch {}

  const rpEntry = `"file/${customCapeRpName}"`;

  // If disabled, remove cape from options.txt (and the pack) if present
  if (s.customCapeDisabled) {
    try { if (fs.existsSync(rpZip)) await fs.promises.unlink(rpZip); } catch {}
    if (options.includes(customCapeRpName)) {
      options = options.replace(new RegExp(`,?\\s*\\??"file/${customCapeRpName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\?`,'g'), '');
      // Clean up empty array edge cases
      options = options.replace(/^resourcePacks:\["vanilla",?\s*\]/m, 'resourcePacks:["vanilla"]');
      await fs.promises.writeFile(optionsPath, options);
    }
    return false;
  }

  try {
    if (!fs.existsSync(customCapeZipPath)) await buildCustomCapeResourcePack(await fs.promises.readFile(customCapePath));
    await fs.promises.mkdir(rpDir, { recursive: true });
    await fs.promises.copyFile(customCapeZipPath, rpZip);
  } catch { return false; }
  if (!fs.existsSync(rpZip)) return false;

  if (!options.includes(customCapeRpName)) {
    if (options.match(/^resourcePacks:/m)) {
      options = options.replace(/^resourcePacks:.*$/m, (line) => {
        const current = line.replace(/^resourcePacks:/, '').trim();
        if (current === '[]') return `resourcePacks:["vanilla",${rpEntry}]`;
        return `resourcePacks:${current.replace(/\]$/, `,${rpEntry}]`)}`;
      });
    } else {
      options += `\nresourcePacks:["vanilla",${rpEntry}]`;
    }
    if (options.match(/^incompatibleResourcePacks:/m)) {
      options = options.replace(/^incompatibleResourcePacks:.*$/m, 'incompatibleResourcePacks:[]');
    } else {
      options += '\nincompatibleResourcePacks:[]';
    }
    await fs.promises.writeFile(optionsPath, options);
  }
  return true;
}

// ── Friends & Presence ─────────────────────────────────────────────────────────
const friendsPath = path.join(base, 'friends.json');
ipcMain.handle('load-friends', async () => load(friendsPath, []));
ipcMain.on('save-friends', async (e, d) => save(friendsPath, d));

let myPresence = null;
let presenceTimer = null;
// Letzter Owner-Viewer-Eintrag, damit er beim Verlassen des Tabs/Accountwechsel
// zuverlaessig auf offline gesetzt werden kann.
let lastOwnerViewerUuid = '';

// Generic HTTP(S) request helper (returns { status, data, headers })
function genericHttp(url, { method = 'GET', headers = {}, body = null, timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const lib = String(url).startsWith('https') ? https : http;
    const req = lib.request(url, { method, headers }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('Request timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

async function postPresence() {
  try {
    const settings = await load(P.settings, {});
    const srv = String(settings.presenceServer || '').trim();
    if (!srv || !myPresence) return;
    const url = srv.replace(/\/+$/, '') + '/v1/status';
    if (myPresence.uuid) {
      await genericHttp(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(myPresence)
      });
    }
    // Eigener Presence-Eintrag pro Geraet und Account: so sieht der Owner
    // live, wer den Tab gerade offen hat. Beim Accountwechsel muss der alte
    // Eintrag sofort offline gesetzt werden, sonst bleibt er bis zum Timeout
    // als Zuschauer haengen.
    const prevUuid = normUuidArg(lastOwnerViewerUuid);
    const viewerUuid = normUuidArg(myPresence.viewerUuid || prevUuid);
    const viewing = !!myPresence.ownerView && !!myPresence.uuid;
    if (prevUuid && prevUuid !== viewerUuid) {
      await genericHttp(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid: prevUuid, online: false, inGame: false, instanceName: null })
      });
    }
    if (viewerUuid) {
      const viewerBody = {
        uuid: viewerUuid,
        username: String(myPresence.deviceName || myPresence.username || 'Owner'),
        // Das Geraet ist online, sobald der Account angemeldet ist. Ob der
        // Owner-Tab offen ist, steht im Marker (instanceName).
        online: !!myPresence.online,
        inGame: false,
        server: String(myPresence.deviceId || ''),
        instanceName: viewing ? String(myPresence.instanceName || '') : null
      };
      const res = await genericHttp(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(viewerBody)
      });
      if (res.status === 200) lastOwnerViewerUuid = viewing ? viewerUuid : '';
    }
  } catch {}
}

function schedulePresence() {
  if (presenceTimer) clearInterval(presenceTimer);
  presenceTimer = setInterval(postPresence, 15000);
  postPresence();
}

ipcMain.on('presence-update', (e, data) => {
  myPresence = {
    uuid: String(data.uuid || '').replace(/-/g, '').toLowerCase(),
    username: String(data.username || ''),
    online: !!data.online,
    inGame: !!data.inGame,
    server: data.server || null,
    instanceName: data.instanceName || null,
    ownerView: !!data.ownerView,
    deviceId: String(data.deviceId || ''),
    deviceName: String(data.deviceName || ''),
    viewerUuid: normUuidArg(data && data.viewerUuid)
  };
  if (myPresence.uuid || lastOwnerViewerUuid) schedulePresence();
});

ipcMain.handle('presence-fetch', async (e, uuids) => {
  try {
    const settings = await load(P.settings, {});
    const srv = String(settings.presenceServer || '').trim();
    const list = (uuids || []).map(u => String(u).replace(/-/g, '').toLowerCase()).filter(Boolean);
    if (!srv || !list.length) return { friends: {} };
    const url = srv.replace(/\/+$/, '') + '/v1/status?friends=' + list.map(encodeURIComponent).join(',');
    const res = await genericHttp(url, {});
    if (res.status !== 200) return { friends: {} };
    try { return JSON.parse(res.data); } catch { return { friends: {} }; }
  } catch { return { friends: {} }; }
});

async function presenceServerUrl() {
  const s = await load(P.settings, {});
  return String(s.presenceServer || '').trim().replace(/\/+$/, '');
}

function normUuidArg(u) {
  return String(u || '').replace(/-/g, '').toLowerCase();
}

ipcMain.handle('presence-requests-fetch', async (e, uuid) => {
  try {
    const srv = await presenceServerUrl();
    const id = normUuidArg(uuid);
    if (!srv || !id) return { requests: [], accepted: [] };
    const res = await genericHttp(srv + '/v1/requests?uuid=' + encodeURIComponent(id), {});
    if (res.status !== 200) return { requests: [], accepted: [] };
    try { return JSON.parse(res.data); } catch { return { requests: [], accepted: [] }; }
  } catch { return { requests: [], accepted: [] }; }
});

ipcMain.handle('presence-requests-send', async (e, data) => {
  try {
    const srv = await presenceServerUrl();
    if (!srv) return { ok: false, error: 'no-server' };
    const res = await genericHttp(srv + '/v1/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromUuid: normUuidArg(data && data.fromUuid),
        fromName: String((data && data.fromName) || ''),
        toUuid: normUuidArg(data && data.toUuid),
        toName: String((data && data.toName) || '')
      })
    });
    if (res.status !== 200) return { ok: false, error: 'http' };
    try { return JSON.parse(res.data); } catch { return { ok: false, error: 'http' }; }
  } catch { return { ok: false, error: 'network' }; }
});

ipcMain.handle('presence-requests-respond', async (e, data) => {
  try {
    const srv = await presenceServerUrl();
    if (!srv) return { ok: false };
    await genericHttp(srv + '/v1/requests/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromUuid: normUuidArg(data && data.fromUuid),
        toUuid: normUuidArg(data && data.toUuid),
        accept: !!(data && data.accept),
        acceptorName: String((data && data.acceptorName) || '')
      })
    });
    return { ok: true };
  } catch { return { ok: false }; }
});

ipcMain.handle('presence-requests-withdraw', async (e, data) => {
  try {
    const srv = await presenceServerUrl();
    if (!srv) return { ok: false, error: 'no-server' };
    const res = await genericHttp(srv + '/v1/requests/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromUuid: normUuidArg(data && data.fromUuid),
        toUuid: normUuidArg(data && data.toUuid)
      })
    });
    if (res.status !== 200) return { ok: false, error: 'http' };
    try { return JSON.parse(res.data); } catch { return { ok: false, error: 'http' }; }
  } catch { return { ok: false, error: 'network' }; }
});

ipcMain.handle('presence-requests-consume', async (e, data) => {
  try {
    const srv = await presenceServerUrl();
    if (!srv) return { ok: false };
    await genericHttp(srv + '/v1/requests/consume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uuid: normUuidArg(data && data.uuid),
        fromUuid: normUuidArg(data && data.fromUuid)
      })
    });
    return { ok: true };
  } catch { return { ok: false }; }
});

// ── Global login registry + bans (device-spanning, via presence server) ─────
async function loginServerUrl() {
  const s = await load(P.settings, {});
  const v = String(s.presenceServer || '').trim().replace(/\/+$/, '');
  return v || DEFAULT_PRESENCE_SERVER;
}

// ── Owner: Geraete-Tokens ─────────────────────────────────────────────────────
// Nur der Hash des Tokens liegt auf dem Server; das Token selbst bleibt auf
// dem Geraet. Owner-Befehle werden in main.js gegen diesen Hash geprueft,
// damit ein Eingriff im Renderer (DevTools/IPC) nicht ausreicht.
const OWNER_DEVICE_MARKER = '__owner_device__';
const OWNER_DEVICE_REQ_MARKER = '__owner_device_req__';
function ownerHash(s) { return crypto.createHash('sha256').update(String(s || '')).digest('hex'); }
function ownerTokenKey(accountKey, deviceId) { return 'ot:' + accountKey + '|' + deviceId; }
function ownerReqKey(accountKey, deviceId) { return 'or:' + accountKey + '|' + deviceId; }
function parseOwnerScopedKey(key, prefix) {
  if (!key || String(key).indexOf(prefix) !== 0) return null;
  const rest = String(key).slice(prefix.length);
  const i = rest.indexOf('|');
  if (i < 0) return null;
  return { accountKey: rest.slice(0, i), deviceId: rest.slice(i + 1) };
}
function isOwnerTokenRecord(b) {
  return !!(b && Array.isArray(b.disabled) && b.disabled.includes(OWNER_DEVICE_MARKER));
}
function isOwnerDeviceRequest(b) {
  return !!(b && Array.isArray(b.disabled) && b.disabled.includes(OWNER_DEVICE_REQ_MARKER));
}
function ownerViewerUuid(uuid, name, deviceId) {
  const seed = String(uuid || name || '_onlysams').replace(/-/g, '').toLowerCase() + '|' + String(deviceId || '');
  return 'ov_' + ownerHash(seed).slice(0, 32);
}
async function fetchOwnerBans(srv) {
  try {
    const res = await genericHttp(srv + '/v1/bans', {});
    if (res.status !== 200) return [];
    const j = JSON.parse(res.data);
    return Array.isArray(j.bans) ? j.bans : [];
  } catch { return []; }
}
async function postOwnerRecord(srv, record) {
  const res = await genericHttp(srv + '/v1/bans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record)
  });
  return res.status === 200;
}
async function deleteOwnerRecord(srv, key) {
  try {
    const res = await genericHttp(srv + '/v1/bans/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    return res.status === 200;
  } catch { return false; }
}
async function ownerDeviceOnlineMap(srv, records) {
  const out = {};
  const uuids = [];
  records.forEach(r => {
    const p = parseOwnerScopedKey(r.key, 'ot:');
    if (!p || !p.deviceId) return;
    uuids.push(ownerViewerUuid(r.uuid, r.name, p.deviceId));
  });
  if (!uuids.length) return out;
  try {
    const res = await genericHttp(srv + '/v1/status?friends=' + uuids.map(encodeURIComponent).join(','), {});
    if (res.status !== 200) return out;
    const statuses = (JSON.parse(res.data) || {}).friends || {};
    records.forEach(r => {
      const p = parseOwnerScopedKey(r.key, 'ot:');
      if (!p) return;
      const st = statuses[ownerViewerUuid(r.uuid, r.name, p.deviceId)];
      out[p.deviceId] = !!(st && st.online && Date.now() - Number(st.lastSeen || 0) <= 120000);
    });
  } catch {}
  return out;
}
async function ownerAccountState(srv, accountKey, token, deviceId) {
  const list = await fetchOwnerBans(srv);
  const tokens = list.filter(b => isOwnerTokenRecord(b) &&
    (parseOwnerScopedKey(b.key, 'ot:') || {}).accountKey === accountKey);
  const requests = list.filter(b => isOwnerDeviceRequest(b) &&
    (parseOwnerScopedKey(b.key, 'or:') || {}).accountKey === accountKey);
  const own = tokens.find(b => b.key === ownerTokenKey(accountKey, deviceId));
  const approved = !!(own && own.reason === ownerHash(token) && !(own.end && own.end <= Date.now()));
  const online = await ownerDeviceOnlineMap(srv, tokens);
  const oldest = tokens.slice().sort((a, b) => (a.start || 0) - (b.start || 0))
    .find(r => online[(parseOwnerScopedKey(r.key, 'ot:') || {}).deviceId]);
  return {
    list, tokens, requests, approved, online,
    hasAny: tokens.length > 0,
    oldestOnlineDeviceId: oldest ? (parseOwnerScopedKey(oldest.key, 'ot:') || {}).deviceId : ''
  };
}
async function ownerCommandAllowed(accountKey, deviceId, token) {
  if (!accountKey || !deviceId || !token) return false;
  const srv = await loginServerUrl();
  const state = await ownerAccountState(srv, accountKey, token, deviceId);
  if (state.approved) return true;
  // Erstes Geraet eines Accounts darf sich selbst registrieren.
  return !state.hasAny;
}

ipcMain.handle('logins-post', async (e, data) => {
  try {
    const srv = await loginServerUrl();
    if (!srv) return { ok: false, error: 'no-server' };
    const res = await genericHttp(srv + '/v1/logins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uuid: normUuidArg(data && data.uuid),
        username: String((data && (data.username || data.name)) || ''),
        first: Number((data && data.first) || 0) || undefined,
        last: Number((data && data.last) || 0) || undefined,
        logins: Number((data && data.logins) || 0) || undefined,
        deviceId: String((data && data.deviceId) || '').slice(0, 64) || undefined,
        deviceName: String((data && data.deviceName) || '').slice(0, 64) || undefined
      })
    });
    if (res.status !== 200) return { ok: false, error: 'http' };
    try { return JSON.parse(res.data); } catch { return { ok: false, error: 'http' }; }
  } catch { return { ok: false, error: 'network' }; }
});

ipcMain.handle('logins-fetch', async () => {
  try {
    const srv = await loginServerUrl();
    if (!srv) return null;
    const res = await genericHttp(srv + '/v1/logins', {});
    if (res.status !== 200) return null;
    try { const j = JSON.parse(res.data); return Array.isArray(j.logins) ? j : null; }
    catch { return null; }
  } catch { return null; }
});

ipcMain.handle('bans-post', async (e, data) => {
  try {
    if (!(await ownerCommandAllowed(data && data.ownerAccountKey, data && data.ownerDeviceId, data && data.ownerToken))) {
      return { ok: false, error: 'unauthorized' };
    }
    const srv = await loginServerUrl();
    if (!srv) return { ok: false, error: 'no-server' };
    const res = await genericHttp(srv + '/v1/bans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: String((data && data.key) || ''),
        uuid: normUuidArg(data && data.uuid),
        name: String((data && data.name) || ''),
        reason: String((data && data.reason) || ''),
        by: String((data && data.by) || ''),
        start: Number((data && data.start) || 0) || undefined,
        end: data && data.end ? Number(data.end) : null,
        disabled: Array.isArray(data && data.disabled) ? data.disabled : undefined
      })
    });
    if (res.status !== 200) return { ok: false, error: 'http' };
    try { return JSON.parse(res.data); } catch { return { ok: false, error: 'http' }; }
  } catch { return { ok: false, error: 'network' }; }
});

ipcMain.handle('bans-remove', async (e, data) => {
  try {
    if (!(await ownerCommandAllowed(data && data.ownerAccountKey, data && data.ownerDeviceId, data && data.ownerToken))) {
      return { ok: false, error: 'unauthorized' };
    }
    const srv = await loginServerUrl();
    if (!srv) return { ok: false, error: 'no-server' };
    const res = await genericHttp(srv + '/v1/bans/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: String((data && data.key) || '') })
    });
    if (res.status !== 200) return { ok: false, error: 'http' };
    return { ok: true };
  } catch { return { ok: false, error: 'network' }; }
});

ipcMain.handle('bans-fetch', async () => {
  try {
    const srv = await loginServerUrl();
    if (!srv) return null;
    const res = await genericHttp(srv + '/v1/bans', {});
    if (res.status !== 200) return null;
    try { const j = JSON.parse(res.data); return Array.isArray(j.bans) ? j : null; }
    catch { return null; }
  } catch { return null; }
});

// Status eines Geraet-Tokens + aeltestes gerade onlinees Geraet
ipcMain.handle('owner-token-state', async (e, data) => {
  try {
    const srv = await loginServerUrl();
    if (!srv) return { ok: false, error: 'no-server' };
    const st = await ownerAccountState(srv,
      String((data && data.accountKey) || ''),
      String((data && data.token) || ''),
      String((data && data.deviceId) || ''));
    return {
      ok: true,
      approved: st.approved,
      hasAny: st.hasAny,
      oldestOnlineDeviceId: st.oldestOnlineDeviceId,
      tokens: st.tokens.length,
      requests: st.requests.map(r => ({
        key: r.key,
        deviceId: (parseOwnerScopedKey(r.key, 'or:') || {}).deviceId || '',
        deviceName: String(r.name || ''),
        tokenHash: String(r.reason || ''),
        uuid: String(r.uuid || ''),
        start: Number(r.start || 0)
      }))
    };
  } catch { return { ok: false, error: 'network' }; }
});

// Erstes Geraet eines Accounts registrieren (nur solange noch keins da ist)
ipcMain.handle('owner-token-bootstrap', async (e, data) => {
  try {
    const srv = await loginServerUrl();
    if (!srv) return { ok: false, error: 'no-server' };
    const accountKey = String((data && data.accountKey) || '');
    const deviceId = String((data && data.deviceId) || '');
    const token = String((data && data.token) || '');
    if (!accountKey || !deviceId || !token) return { ok: false, error: 'invalid' };
    const st = await ownerAccountState(srv, accountKey, token, deviceId);
    if (st.hasAny) return { ok: false, error: 'exists' };
    const ok = await postOwnerRecord(srv, {
      key: ownerTokenKey(accountKey, deviceId),
      uuid: normUuidArg(data && data.uuid),
      name: String((data && data.deviceName) || ''),
      reason: ownerHash(token),
      by: '_onlysams',
      start: Date.now(),
      end: null,
      disabled: [OWNER_DEVICE_MARKER]
    });
    return ok ? { ok: true } : { ok: false, error: 'http' };
  } catch { return { ok: false, error: 'network' }; }
});

// Neues Geraet beantragt einen Token (nur der Hash geht an den Server)
ipcMain.handle('owner-device-request', async (e, data) => {
  try {
    const srv = await loginServerUrl();
    if (!srv) return { ok: false, error: 'no-server' };
    const accountKey = String((data && data.accountKey) || '');
    const deviceId = String((data && data.deviceId) || '');
    const token = String((data && data.token) || '');
    if (!accountKey || !deviceId || !token) return { ok: false, error: 'invalid' };
    const st = await ownerAccountState(srv, accountKey, token, deviceId);
    if (st.approved) return { ok: true, approved: true };
    const ok = await postOwnerRecord(srv, {
      key: ownerReqKey(accountKey, deviceId),
      uuid: normUuidArg(data && data.uuid),
      name: String((data && data.deviceName) || ''),
      reason: ownerHash(token),
      by: String((data && data.deviceName) || ''),
      start: Date.now(),
      end: null,
      disabled: [OWNER_DEVICE_REQ_MARKER]
    });
    return ok ? { ok: true, approved: false } : { ok: false, error: 'http' };
  } catch { return { ok: false, error: 'network' }; }
});

async function ownerApprovalGuard(data) {
  const srv = await loginServerUrl();
  const accountKey = String((data && data.accountKey) || '');
  const approverDeviceId = String((data && data.approverDeviceId) || '');
  const approverToken = String((data && data.approverToken) || '');
  const st = await ownerAccountState(srv, accountKey, approverToken, approverDeviceId);
  if (!st.approved) return { error: 'unauthorized' };
  if (st.oldestOnlineDeviceId !== approverDeviceId) return { error: 'not-oldest' };
  return { srv };
}

ipcMain.handle('owner-device-approve', async (e, data) => {
  try {
    const guard = await ownerApprovalGuard(data);
    if (guard.error) return { ok: false, error: guard.error };
    const accountKey = String(data.accountKey || '');
    const deviceId = String(data.deviceId || '');
    const st = await fetchOwnerBans(guard.srv);
    const req = st.find(b => b.key === ownerReqKey(accountKey, deviceId) && isOwnerDeviceRequest(b));
    if (!req || !req.reason) return { ok: false, error: 'request-gone' };
    const ok = await postOwnerRecord(guard.srv, {
      key: ownerTokenKey(accountKey, deviceId),
      uuid: normUuidArg(req.uuid),
      name: String(req.name || ''),
      reason: String(req.reason),
      by: '_onlysams',
      start: Date.now(),
      end: null,
      disabled: [OWNER_DEVICE_MARKER]
    });
    if (!ok) return { ok: false, error: 'http' };
    await deleteOwnerRecord(guard.srv, req.key);
    return { ok: true };
  } catch { return { ok: false, error: 'network' }; }
});

ipcMain.handle('owner-device-reject', async (e, data) => {
  try {
    const guard = await ownerApprovalGuard(data);
    if (guard.error) return { ok: false, error: guard.error };
    const ok = await deleteOwnerRecord(guard.srv, ownerReqKey(String(data.accountKey || ''), String(data.deviceId || '')));
    return ok ? { ok: true } : { ok: false, error: 'http' };
  } catch { return { ok: false, error: 'network' }; }
});

// ── Chat (friends messaging) ────────────────────────────────────────────────
async function chatServerUrl() {
  const s = await load(P.settings, {});
  const v = String(s.chatServer || '').trim().replace(/\/+$/, '');
  return v || DEFAULT_CHAT_SERVER;
}

ipcMain.handle('chat-send', async (e, data) => {
  try {
    const srv = await chatServerUrl();
    if (!srv) return { ok: false, error: 'no-server' };
    const res = await genericHttp(srv + '/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: normUuidArg(data && data.from),
        to: normUuidArg(data && data.to),
        text: String((data && data.text) || '')
      })
    });
    if (res.status !== 200) return { ok: false, error: 'http' };
    try { return JSON.parse(res.data); } catch { return { ok: false, error: 'http' }; }
  } catch { return { ok: false, error: 'network' }; }
});

ipcMain.handle('chat-poll', async (e, data) => {
  try {
    const srv = await chatServerUrl();
    if (!srv) return { messages: [] };
    const from = normUuidArg(data && data.from);
    const to = normUuidArg(data && data.to);
    const after = parseInt(data && data.after, 10) || 0;
    if (!from || !to) return { messages: [] };
    const url = srv + '/v1/poll?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to) +
      '&after=' + encodeURIComponent(after) + '&timeout=8000';
    const res = await genericHttp(url, { timeout: 15000 });
    if (res.status !== 200) return { messages: [] };
    try { return JSON.parse(res.data); } catch { return { messages: [] }; }
  } catch { return { messages: [] }; }
});

ipcMain.handle('chat-history', async (e, data) => {
  try {
    const srv = await chatServerUrl();
    if (!srv) return { messages: [] };
    const from = normUuidArg(data && data.from);
    const to = normUuidArg(data && data.to);
    const after = parseInt(data && data.after, 10) || 0;
    const limit = parseInt(data && data.limit, 10) || 50;
    if (!from || !to) return { messages: [] };
    const url = srv + '/v1/messages?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to) +
      '&after=' + encodeURIComponent(after) + '&limit=' + encodeURIComponent(limit);
    const res = await genericHttp(url, {});
    if (res.status !== 200) return { messages: [] };
    try { return JSON.parse(res.data); } catch { return { messages: [] }; }
  } catch { return { messages: [] }; }
});

// ── Bug Report (no GitHub account required) ────────────────────────────────────
function isDiscordWebhook(url) {
  return /discord(app)?\.com\/api\/webhooks/i.test(url);
}

function buildMultipart(fields, fileField, filename, fileBuf, contentType) {
  const boundary = '----Crux' + Date.now().toString(16) + Math.random().toString(16).slice(2);
  const chunks = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`));
  chunks.push(fileBuf);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
}

async function collectBugReportContext(report) {
  const settings = await load(P.settings, {});
  const accs = await load(P.accounts, []);
  const lines = [];
  lines.push('Crux Client Bug Report');
  lines.push('======================');
  lines.push('');
  lines.push('Title: ' + (report.title || ''));
  lines.push('Category: ' + (report.category || ''));
  lines.push('Description: ' + (report.description || ''));
  lines.push('');
  lines.push('--- System ---');
  lines.push('OS: ' + os.type() + ' ' + os.release() + ' (' + process.platform + ' ' + process.arch + ')');
  lines.push('Node: ' + process.versions.node);
  lines.push('Electron: ' + process.versions.electron);
  lines.push('Launcher version: ' + (app.getVersion ? app.getVersion() : ''));
  lines.push('Total RAM: ' + Math.round(os.totalmem() / 1073741824) + ' GB');
  lines.push('Launcher RAM: ' + (settings.launcherRam || 2) + ' GB');
  lines.push('');
  lines.push('--- Account ---');
  lines.push('Username: ' + ((accs[0] && accs[0].name) || 'not logged in'));
  lines.push('');
  lines.push('--- Settings (no sensitive data) ---');
  lines.push('RAM: ' + (settings.ram || ''));
  lines.push('Theme: ' + (settings.theme || ''));
  lines.push('Language: ' + (settings.lang || ''));
  lines.push('Selected profile: ' + (settings.selectedProfile || ''));
  lines.push('Last played: ' + ((settings.recentHistory || [])[0] && settings.recentHistory[0].version) || '');
  lines.push('Presence server set: ' + (!!(settings.presenceServer && String(settings.presenceServer).trim())));
  lines.push('');
  lines.push('--- Launcher log (last 200 lines) ---');
  try {
    const log = fs.readFileSync(logFile, 'utf8');
    lines.push(log.split('\n').slice(-200).join('\n'));
  } catch {}
  if (report.includeLogs) {
    const seenDirs = new Set();
    for (const inst of Object.values(instances)) {
      lines.push('');
      lines.push('--- Instance log: ' + inst.id + ' (' + (inst.status || '?') + ') ---');
      lines.push((inst.logs || []).slice(-300).join('\n'));
      const gDir = inst.gameDir || P.mc;
      if (seenDirs.has(gDir)) continue;
      seenDirs.add(gDir);
      const latest = path.join(gDir, 'logs', 'latest.log');
      try {
        const content = await fs.promises.readFile(latest, 'utf8');
        lines.push('');
        lines.push('--- Minecraft latest.log (' + gDir + ', last 200 lines) ---');
        lines.push(content.split('\n').slice(-200).join('\n'));
      } catch {}
      try {
        const crashDir = path.join(gDir, 'crash-reports');
        const files = fs.readdirSync(crashDir).filter(f => f.endsWith('.txt')).sort();
        if (files.length) {
          const f = files[files.length - 1];
          lines.push('');
          lines.push('--- Latest crash report: ' + f + ' (first 120 lines) ---');
          lines.push((await fs.promises.readFile(path.join(crashDir, f), 'utf8')).split('\n').slice(0, 120).join('\n'));
        }
      } catch {}
    }
  }
  return lines.join('\n');
}

ipcMain.handle('send-bugreport', async (e, report) => {
  try {
    const settings = await load(P.settings, {});
    const webhook = String(settings.bugreportWebhook || '').trim();
    if (!webhook) return { success: false, error: 'NO_WEBHOOK' };
    const text = await collectBugReportContext(report);
    const title = String(report.title || 'Bug Report');
    const category = String(report.category || 'Other');
    const head = `**New Bug Report** (${category}) — ${title}`;

    if (isDiscordWebhook(webhook)) {
      const filename = 'bug-report-' + Date.now() + '.txt';
      const m = buildMultipart({ content: head }, 'file', filename, Buffer.from(text, 'utf8'), 'text/plain');
      const res = await genericHttp(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data; boundary=' + m.boundary },
        body: m.body,
        timeout: 15000
      });
      if (res.status >= 200 && res.status < 300) return { success: true };
      return { success: false, error: 'HTTP ' + res.status, body: res.data.slice(0, 500) };
    }

    // Generic webhook: JSON with embed
    const payload = {
      content: head,
      embeds: [{
        title,
        description: String(report.description || 'No description').slice(0, 3500),
        fields: [{ name: 'Details', value: '```text\n' + text.slice(0, 3900).replace(/`/g, '`\u200b') + '\n```' }]
      }]
    };
    const res = await genericHttp(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 15000
    });
    if (res.status >= 200 && res.status < 300) return { success: true };
    return { success: false, error: 'HTTP ' + res.status, body: res.data.slice(0, 500) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Analyze bug report with AI (Anthropic/Claude)
ipcMain.handle('analyze-bugreport', async (e, report) => {
  try {
    const settings = await load(P.settings, {});
    const apiKey = String(settings.anthropicApiKey || '').trim();
    if (!apiKey) return { success: false, error: 'NO_API_KEY' };

    const text = await collectBugReportContext(report);
    const title = String(report.title || 'Bug Report');
    const category = String(report.category || 'Other');

    // Build the prompt for AI analysis
    const prompt = `You are an expert Minecraft modding and launcher support assistant. Analyze the following bug report and provide the most likely cause and solution.

Bug Report:
Title: ${title}
Category: ${category}
Description: ${report.description || 'No description provided'}

Full Context:
${text}

Please provide:
1. Most likely root cause
2. Step-by-step solution
3. Any workarounds
4. Prevention tips

Format your response clearly with headings.`;

    const payload = {
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4000,
      messages: [
        { role: 'user', content: prompt }
      ]
    };

    const res = await genericHttp('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload),
      timeout: 60000
    });

    if (res.status >= 200 && res.status < 300) {
      try {
        const data = JSON.parse(res.data);
        const analysis = data.content?.[0]?.text || 'No analysis returned';
        return { success: true, analysis };
      } catch {
        return { success: false, error: 'Failed to parse AI response' };
      }
    }
    return { success: false, error: 'HTTP ' + res.status, body: res.data.slice(0, 500) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

let mcVersionList = [];

// ── MC Versions ────────────────────────────────────────────────────────────────
const versionCachePath = path.join(base, 'version_manifest_cache.json');

async function fetchVersionsWithCache() {
  // Try cache first (valid for 1 hour)
  try {
    const stat = await fs.promises.stat(versionCachePath);
    const age = Date.now() - stat.mtimeMs;
    if (age < 3600000) {
      const cached = JSON.parse(await fs.promises.readFile(versionCachePath, 'utf8'));
      mcVersionList = cached;
      return cached;
    }
  } catch {}

  // Fetch from network with 10s timeout
  return new Promise((res, rej) => {
    const req = https.get('https://launchermeta.mojang.com/mc/game/version_manifest.json', r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{
        try {
          const versions = JSON.parse(d).versions.map(v=>({id:v.id,type:v.type,url:v.url}));
          mcVersionList = versions;
          // Write cache (fire and forget)
          fs.promises.writeFile(versionCachePath, JSON.stringify(versions)).catch(()=>{});
          res(versions);
        } catch(e){rej(e);}
      });
    }).on('error',rej);
    req.setTimeout(10000, () => { req.destroy(); rej(new Error('Mojang API timeout')); });
  });
}

ipcMain.handle('get-versions', async () => {
  try {
    const versions = await fetchVersionsWithCache();
    // „Latest"-Profile haben erst jetzt eine konkrete Version.
    scheduleAutoPrecache(3000);
    return versions;
  } catch(e) {
    // If network fails, try stale cache
    try {
      const cached = JSON.parse(await fs.promises.readFile(versionCachePath, 'utf8'));
      mcVersionList = cached;
      scheduleAutoPrecache(3000);
      return cached;
    } catch { throw e; }
  }
});

// ── Java ───────────────────────────────────────────────────────────────────────
async function existsAsync(p) { try { await fs.promises.access(p); return true; } catch { return false; } }

async function findInstalledJavas(cb) {
  const found = []; const seenPaths = new Set(); let n=0;
  function addJava(p, v) {
    const resolved = path.resolve(p);
    if (seenPaths.has(resolved)) return;
    seenPaths.add(resolved);
    found.push({ path: p, version: v }); n++;
  }
  try {
    const out = await new Promise((r,rj)=>exec('where java', { timeout: 10000 }, (e,o)=>e?rj(e):r(o)));
    for (const p of out.trim().split('\n').map(s=>s.trim()).filter(Boolean)) {
      if(cb)cb(10, `Scanning ${path.basename(p)}`);
      const v=await getJavaVersion(p); if(v) addJava(p, v);
    }
  } catch { if(cb)cb(10,'No Java on PATH'); }

  const commonDirs=[
    'C:\\Program Files\\Java',
    'C:\\Program Files (x86)\\Java',
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Eclipse Foundation',
    'C:\\Program Files\\Microsoft',
    'C:\\Program Files\\OpenJDK',
    'C:\\Program Files\\Zulu',
    'C:\\Program Files\\BellSoft',
    'C:\\Program Files\\Semeru',
    path.join(process.env.LOCALAPPDATA||'','Programs','Eclipse Adoptium'),
    path.join(process.env.LOCALAPPDATA||'','Programs','Microsoft','jdk'),
    path.join(process.env.USERPROFILE||'','.jdks'),
    path.join(process.env.USERPROFILE||'','.gradle','jdks'),
    path.join(process.env.USERPROFILE||'','.sdkman','candidates','java'),
    path.join(process.env.USERPROFILE||'','scoop','apps','openjdk','current'),
    path.join(process.env.USERPROFILE||'','scoop','apps','openjdk17','current'),
    path.join(process.env.USERPROFILE||'','scoop','apps','openjdk21','current'),
    path.join(process.env.APPDATA||'','\.minecraft','runtime'),
    P.java,
  ];
  for (const dir of commonDirs) {
    if (!(await existsAsync(dir))) continue;
    if(cb)cb(Math.min(90, 20 + n*10), `Checking ${path.basename(dir)}`);
    let st;
    try { st = await fs.promises.stat(dir); } catch { continue; }
    if (st.isFile() && dir.toLowerCase().endsWith('java.exe')) {
      const v=await getJavaVersion(dir); if(v) addJava(dir, v);
    } else if (st.isDirectory()) {
      const direct = path.join(dir, 'bin', 'java.exe');
      if (await existsAsync(direct)) { const v=await getJavaVersion(direct); if(v) addJava(direct, v); }
      try {
        const items = await fs.promises.readdir(dir);
        for (const item of items) {
          const jp = path.join(dir, item, 'bin', 'java.exe');
          if (await existsAsync(jp)) { const v=await getJavaVersion(jp); if(v) addJava(jp, v); }
        }
      } catch {}
    }
  }
  if(cb)cb(100,'Scan complete');
  return found;
}

// ── Crux Client Mod (download from GitHub on EVERY start) ────────────────────
// Asset-Namensschema ist immer "cruxclient-<version>.jar". Es wird bei jedem
// Start frisch von der neuesten Release geladen (kein Cache-Treffer).
const CRUX_MOD_REPO = 'Dev-Reds/crux-client-mod';
const CRUX_JAR_RE = /^cruxclient-.*\.jar$/i;
const CRUX_LEGACY_RE = /^crux-client-features-.*\.jar$/i;

async function ensureCruxClientMod(mcVersion, send, instanceId) {
  const cacheDir = path.join(P.clientMods, 'cruxclient');
  await fs.promises.mkdir(cacheDir, { recursive: true });

  send('instance-log', { instanceId, line:`[CRUX-MOD] Fetching newest Crux Client mod from ${CRUX_MOD_REPO}...` });
  let release;
  try {
    release = await fetchJsonHttps(`https://api.github.com/repos/${CRUX_MOD_REPO}/releases/latest`);
  } catch (e) {
    send('instance-log', { instanceId, line:`[CRUX-MOD] GitHub check failed (${e.message}) — starting without Crux Client Features.` });
    return null;
  }

  const assets = ((release && release.assets) || []).filter(a => CRUX_JAR_RE.test(a.name));
  if (!assets.length) {
    send('instance-log', { instanceId, line:`[CRUX-MOD] No "cruxclient-<version>.jar" asset in the newest release (${release && release.tag_name}).` });
    send('instance-log', { instanceId, line:'[CRUX-MOD] Starting WITHOUT the Crux Client Features mod.' });
    return null;
  }
  // Es wird KEIN Fallback auf andere Versionen gemacht: die Mod muss exakt
  // "cruxclient-<mcVersion>.jar" heißen, sonst wird sie nicht geladen.
  const asset = assets.find(a => a.name === `cruxclient-${mcVersion}.jar`);
  if (!asset) {
    send('instance-log', { instanceId, line:`[CRUX-MOD] No "cruxclient-${mcVersion}.jar" in ${release.tag_name} — no Crux Client Features for MC ${mcVersion}.` });
    send('instance-log', { instanceId, line:'[CRUX-MOD] Starting WITHOUT the Crux Client Features mod.' });
    return null;
  }
  const cacheJar = path.join(cacheDir, asset.name);

  send('instance-log', { instanceId, line:`[CRUX-MOD] Downloading ${asset.name} (${release.tag_name})...` });
  try {
    await fs.promises.rm(cacheJar, { force: true }); // immer frisch
    await downloadFile(asset.browser_download_url, cacheJar);
    // Alte Crux-Jars im Cache entfernen
    try {
      for (const f of fs.readdirSync(cacheDir)) {
        if (f !== asset.name && (CRUX_JAR_RE.test(f) || CRUX_LEGACY_RE.test(f))) {
          try { fs.unlinkSync(path.join(cacheDir, f)); } catch {}
        }
      }
    } catch {}
    send('instance-log', { instanceId, line:`[CRUX-MOD] Downloaded fresh: ${asset.name}` });
    return { path: cacheJar, name: asset.name };
  } catch (e) {
    send('instance-log', { instanceId, line:`[CRUX-MOD] Download failed (${e.message}) — starting without Crux Client Features.` });
    return null;
  }
}

// Kopiert die frisch geladene Crux-Mod in den Mods-Ordner und entfernt alle
// anderen cruxclient-*.jar (sowie alte crux-client-features-*.jar), damit nur
// die passende Version aktiv bleibt.
async function deployCruxMod(modsDir, crux) {
  if (!crux || !crux.path) return false;
  const dest = path.join(modsDir, crux.name);
  try { await fs.promises.copyFile(crux.path, dest); } catch { return false; }
  try {
    for (const f of fs.readdirSync(modsDir)) {
      if (f === crux.name) continue;
      if (CRUX_JAR_RE.test(f) || CRUX_LEGACY_RE.test(f)) {
        try { fs.unlinkSync(path.join(modsDir, f)); } catch {}
      }
    }
  } catch {}
  return true;
}

// ── Auto-Fix: kaputte Mixin-Mods vor dem Start erkennen ────────────────────────
// Beispiel bringbacknightmares: die mixins.json haengt das Package doppelt an
// ("com.x.mixin.com.x.mixin.MixinTitleScreen"), wodurch der whole Launch an
// preLaunch scheitert. Solche JARs werden deaktiviert statt abstuerzen zu lassen.
function jarMatchesMod(file, mod){
  if (!mod || !file) return false;
  const base = String(file).replace(/\.jar$/i, '');
  if (String(mod.fileName || '') === file) return true;
  if (mod.modrinthId && base.startsWith(String(mod.modrinthId) + '-')) return true;
  if (mod.curseforgeId && base.startsWith(`cf-${mod.curseforgeId}-`)) return true;
  const byName = String(mod.name || '').replace(/[^a-zA-Z0-9._-]/g, '_');
  return !!byName && base === byName;
}

// Mods, die zur Kombination MC/Loader nachweislich crashen, werden gemerkt und
// beim spaeteren Generieren gar nicht erst in den Plan aufgenommen.
async function rememberBrokenMods(version, loader, ids, reason){
  const list = await load(P.broken, []);
  const clean = [...new Set((ids || []).map(x => String(x || '').trim().toLowerCase()).filter(Boolean))];
  if (!clean.length) return;
  let entry = list.find(x => x && x.v === version && x.l === loader);
  if (!entry) { entry = { v: version, l: loader, ids: [] }; list.push(entry); }
  for (const id of clean) if (!entry.ids.includes(id)) entry.ids.push(id);
  entry.reason = String(reason || '').slice(0, 300);
  entry.at = Date.now();
  await save(P.broken, list);
}

function normalizeBrokenId(v){
  return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
async function brokenIdsFor(version, loader){
  const list = await load(P.broken, []);
  const keys = new Set();
  for (const entry of list) {
    if (!entry || entry.v !== version || entry.l !== loader) continue;
    for (const id of (Array.isArray(entry.ids) ? entry.ids : [])) {
      const key = normalizeBrokenId(id);
      if (key) keys.add(key);
    }
  }
  return keys;
}
function modHasBrokenId(mod, keys){
  if (!mod || !keys || !keys.size) return false;
  return [mod.name, mod.title, mod.modrinthId, mod.curseforgeId, mod.curseforgeSlug]
    .some(v => { const key = normalizeBrokenId(v); return !!key && keys.has(key); });
}

async function findJarByFabricModId(modsDir, modId){
  let Zip;
  try { Zip = getJszip(); } catch { return null; }
  let files;
  try { files = fs.readdirSync(modsDir).filter(f => /\.jar$/i.test(f)); } catch { return null; }
  const want = String(modId || '').trim().toLowerCase();
  if (!want) return null;
  for (const file of files) {
    try {
      const zip = await Zip.loadAsync(await fs.promises.readFile(path.join(modsDir, file)));
      const metaFile = zip.file('fabric.mod.json') || zip.file('META-INF/fabric.mod.json');
      if (!metaFile) continue;
      const meta = JSON.parse(await metaFile.async('string'));
      if (String(meta.id || '').toLowerCase() === want) return file;
    } catch {}
  }
  return null;
}

// Aus einem echten Crash-Log die mods ziehen, deren Mixin fehlgeschlagen ist.
// Fabric schreibt z.B. "Mixin [x.mixins.json:Foo from mod distantdread] ... FAILED".
function extractMixinCrashMods(lines){
  const found = new Map();
  for (const raw of (Array.isArray(lines) ? lines : [])) {
    const s = String(raw || '');
    if (!/mixin/i.test(s)) continue;
    let m = s.match(/Mixin apply for mod\s+([A-Za-z0-9_.-]+)\s+failed/i);
    if (!m) m = s.match(/Mixin\s*\[[^\]]*?\bfrom mod\s+([A-Za-z0-9_.-]+)\][^\n]*\bFAILED\b/i);
    if (!m && /\bInvalidMixinException\b|\bMixinApplyError\b|\bMixinTransformerError\b/i.test(s)) {
      m = s.match(/\bfrom mod\s+([A-Za-z0-9_.-]+)/i);
    }
    if (!m) continue;
    const id = m[1].replace(/[)\],.;:]+$/, '');
    if (id && !found.has(id)) found.set(id, s.slice(0, 300));
  }
  return [...found.entries()].map(([id, reason]) => ({ id, reason }));
}

// Manche Mixin-Fehler stehen nur im crash-report, nicht im stdout.
async function collectMixinCrashMods(gameDir, logs, since){
  const fromLogs = extractMixinCrashMods(logs || []);
  if (fromLogs.length) return fromLogs;
  try {
    const dir = path.join(gameDir, 'crash-reports');
    const reports = fs.readdirSync(dir)
      .filter(f => f.endsWith('.txt'))
      .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .filter(x => !since || x.t >= since)
      .sort((a, b) => b.t - a.t)
      .slice(0, 3);
    for (const { f } of reports) {
      const text = await fs.promises.readFile(path.join(dir, f), 'utf8');
      const found = extractMixinCrashMods(text.split(/\r?\n/));
      if (found.length) return found;
    }
  } catch {}
  return [];
}

async function disableCrashModPersistent(modsDir, modId, profileId, profileMods, clientMods, mrpackMods, version, loader, reason){
  const file = await findJarByFabricModId(modsDir, modId);
  if (!file) return null;
  const ids = [modId];
  for (const m of [...(profileMods || []), ...(clientMods || []), ...(mrpackMods || [])]) {
    if (!jarMatchesMod(file, m)) continue;
    if (m.modrinthId) ids.push(String(m.modrinthId));
    if (m.curseforgeId) ids.push(String(m.curseforgeId));
    if (m.name) ids.push(String(m.name));
  }
  await disableBrokenModPersistent(file, profileId, profileMods, clientMods, mrpackMods);
  try { await fs.promises.rename(path.join(modsDir, file), path.join(modsDir, file + '.disabled')); } catch {}
  await rememberBrokenMods(version, loader, ids, reason);
  return { file, ids: [...new Set(ids.map(x => String(x || '').toLowerCase()).filter(Boolean))] };
}

async function disableBrokenModPersistent(file, profileId, profileMods, clientMods, mrpackMods){
  for (const m of [...(profileMods || []), ...(clientMods || []), ...(mrpackMods || [])]) if (jarMatchesMod(file, m)) m.disabled = true;
  let changedProfile = false;
  try {
    const profiles = await load(P.profiles, []);
    const prof = profiles.find(p => p.id === profileId);
    for (const key of ['mods','mrpackMods']){
      if (prof && Array.isArray(prof[key])) for (const m of prof[key]) if (jarMatchesMod(file, m)){ m.disabled = true; changedProfile = true; }
    }
    if (changedProfile) await save(P.profiles, profiles);
  } catch {}
  let changedClient = false;
  try {
    const mods = await load(P.mods, []);
    for (const m of mods) if (jarMatchesMod(file, m)){ m.disabled = true; changedClient = true; }
    if (changedClient) await save(P.mods, mods);
  } catch {}
  return changedProfile || changedClient;
}

async function autoFixBrokenMixinMods(modsDir, send, instanceId, profileId, profileMods, clientMods, mrpackMods, version, loader){
  let Zip;
  try { Zip = getJszip(); } catch { return []; }
  let files = [];
  try { files = fs.readdirSync(modsDir).filter(f => /\.jar$/i.test(f)); } catch { return []; }
  const fixed = [];
  for (const file of files){
    let reason = null;
    try {
      const zip = await Zip.loadAsync(await fs.promises.readFile(path.join(modsDir, file)));
      const configs = Object.keys(zip.files).filter(n => /mixins[^/]*\.json$/i.test(n) && !zip.files[n].dir);
      for (const cfgName of configs){
        let cfg = null;
        try { cfg = JSON.parse(await zip.file(cfgName).async('string')); } catch { continue; }
        const pkg = String(cfg.package || '').trim();
        const entries = ['mixins','client','server'].flatMap(k => Array.isArray(cfg[k]) ? cfg[k] : []);
        for (const raw of entries){
          if (typeof raw !== 'string' || !raw.trim()) continue;
          const entry = raw.trim();
          // Mixin haengt cfg.package IMMER vor - ein bereits qualifizierter Name
          // fuehrt zum ClassNotFoundException (genau dieser Crash).
          if (pkg && (entry === pkg || entry.startsWith(pkg + '.'))){
            reason = 'Mixin-Package doppelt: ' + entry;
            break;
          }
          const rel = entry.replace(/\./g, '/') + '.class';
          const expected = (pkg ? pkg.replace(/\./g, '/') + '/' : '') + rel;
          if (!zip.files[expected] && !Object.keys(zip.files).some(p => p.endsWith('/' + rel))){
            reason = 'Mixin-Klasse fehlt: ' + expected;
            break;
          }
        }
        if (reason) break;
      }
    } catch { continue; }
    if (!reason) continue;
    const ids = [file];
    for (const m of [...(profileMods || []), ...(clientMods || []), ...(mrpackMods || [])]) {
      if (!jarMatchesMod(file, m)) continue;
      if (m.modrinthId) ids.push(String(m.modrinthId));
      if (m.curseforgeId) ids.push(String(m.curseforgeId));
      if (m.name) ids.push(String(m.name));
    }
    await disableBrokenModPersistent(file, profileId, profileMods, clientMods, mrpackMods);
    try { await fs.promises.rename(path.join(modsDir, file), path.join(modsDir, file + '.disabled')); } catch {}
    await rememberBrokenMods(version, loader, ids, reason);
    fixed.push(file);
    send('instance-log', { instanceId, line:`[AUTO-FIX] ${file} deaktiviert (${reason}). Der Mod wird beim nächsten Start nicht mehr geladen.` });
  }
  if (fixed.length) send('launch-progress', { instanceId, percent:47, message:`${fixed.length} defekte Mod(s) automatisch deaktiviert.` });
  return fixed;
}

// Fragt die neueste GitHub-Release ab und meldet, ob es eine Mod-JAR für die
// angefragte MC-Version gibt. `unknown:true` bedeutet: Abfrage fehlgeschlagen
// (z.B. offline) — der Renderer lässt den Schalter dann unangetastet.
ipcMain.handle('crux-mod-available', async (e, mcVersion) => {
  const version = String(mcVersion || '');
  if (!version || version.startsWith('__')) return { unknown: true, reason: 'version' };
  let release;
  try {
    release = await fetchJsonHttps(`https://api.github.com/repos/${CRUX_MOD_REPO}/releases/latest`);
  } catch (err) {
    return { unknown: true, error: err.message };
  }
  const names = ((release && release.assets) || []).filter(a => CRUX_JAR_RE.test(a.name)).map(a => a.name);
  return {
    available: names.includes(`cruxclient-${version}.jar`),
    tag: release && release.tag_name,
    name: `cruxclient-${version}.jar`,
    versions: names
  };
});

async function getJavaVersion(p) {
  try {
    const o = await new Promise((r,rj)=>{
      const c = exec(`"${p}" -version`, { timeout: 10000 }, (e,o,se)=>e?rj(e):r(se));
      c.on('error', rj);
    });
    const m = o.match(/version "([^"]+)"/);
    if (!m) return null;
    const ver = m[1];
    const parts = ver.split('.');
    if (parts[0] === '1') return parts[1];
    return parts[0];
  } catch { return null; }
}

ipcMain.handle('get-java-versions', () => findInstalledJavas());
ipcMain.handle('scan-java', async () => {
  if (!mainWindow) return findInstalledJavas();
  mainWindow.webContents.send('scan-progress', { progress:5, message:'Starting scan...' });
  const r = await findInstalledJavas((p,m) => mainWindow.webContents.send('scan-progress', { progress:p, message:m }));
  mainWindow.webContents.send('scan-progress', { progress:100, message:'Done' });
  return r;
});

// ── Microsoft OAuth ────────────────────────────────────────────────────────────
const MS_CLIENT_ID = '00000000402b5328';
const MS_REDIRECT  = 'https://login.microsoftonline.com/common/oauth2/nativeclient';

ipcMain.handle('login-microsoft', async () => {
  return new Promise((resolve) => {
    if (authWindow) { try { authWindow.close(); } catch {} authWindow = null; }
    const authUrl = `https://login.live.com/oauth20_authorize.srf?client_id=${MS_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(MS_REDIRECT)}&scope=XboxLive.signin%20offline_access&prompt=select_account`;
    authWindow = new BrowserWindow({ width:520, height:680, title:'Microsoft Login', webPreferences:{ nodeIntegration:false, contextIsolation:true } });
    authWindow.setMenu(null);
    authWindow.loadURL(authUrl);
    let resolved = false;
    function tryResolve(url) {
      if (resolved) return;
      try {
        const u = new URL(url);
        if (u.origin + u.pathname === MS_REDIRECT || url.startsWith(MS_REDIRECT)) {
          const code = u.searchParams.get('code'), error = u.searchParams.get('error');
          resolved = true;
          try { authWindow.close(); } catch {} authWindow = null;
          if (error) { resolve({ error: 'OAuth error: ' + error }); return; }
          if (!code)  { resolve({ error: 'No code received' }); return; }
          exchangeMicrosoftCode(code).then(resolve).catch(err => resolve({ error: err.message }));
        }
      } catch {}
    }
    authWindow.webContents.on('will-redirect',            (e,url) => tryResolve(url));
    authWindow.webContents.on('will-navigate',            (e,url) => tryResolve(url));
    authWindow.webContents.on('did-navigate',             (e,url) => tryResolve(url));
    authWindow.webContents.on('did-get-redirect-request', (e,o,newUrl) => tryResolve(newUrl));
    authWindow.on('closed', () => { authWindow = null; if (!resolved) { resolved = true; resolve({ error: 'Login window closed' }); } });
  });
});

async function exchangeMicrosoftCode(code) {
  const msToken = await postForm('https://login.live.com/oauth20_token.srf', {
    client_id: MS_CLIENT_ID, code, grant_type: 'authorization_code',
    redirect_uri: MS_REDIRECT, scope: 'XboxLive.signin offline_access'
  });
  if (msToken.error) throw new Error(msToken.error_description || msToken.error);
  const xblRes = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod:'RPS', SiteName:'user.auth.xboxlive.com', RpsTicket:`d=${msToken.access_token}` },
    RelyingParty: 'http://auth.xboxlive.com', TokenType:'JWT'
  });
  const xblToken = xblRes.Token, userHash = xblRes.DisplayClaims.xui[0].uhs;
  const xstsRes = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId:'RETAIL', UserTokens:[xblToken] },
    RelyingParty: 'rp://api.minecraftservices.com/', TokenType:'JWT'
  });
  if (xstsRes.XErr) throw new Error(xstsRes.XErr===2148916238?'No Xbox Live account.':xstsRes.XErr===2148916233?'Xbox Live not available in your region.':`XSTS error: ${xstsRes.XErr}`);
  const mcRes = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', { identityToken:`XBL3.0 x=${userHash};${xstsRes.Token}` });
  const mcToken = mcRes.access_token;
  const profile = await getJson('https://api.minecraftservices.com/minecraft/profile', mcToken);
  if (profile.error) throw new Error('No Minecraft profile. Make sure you own Java Edition.');
  return {
    name:         profile.name,
    uuid:         profile.id,
    type:         'Microsoft',
    accessToken:  mcToken,
    skinUrl:      profile.skins?.find(s=>s.state==='ACTIVE')?.url || null,
    skinModel:    profile.skins?.find(s=>s.state==='ACTIVE')?.variant || 'classic',
    refreshToken: msToken.refresh_token,
    xuid:         xstsRes.DisplayClaims?.xui?.[0]?.xid || '',
  };
}

// ── Accounts ───────────────────────────────────────────────────────────────────
// Kein Mojang-Login mehr: nur Microsoft (OAuth). Der Token-Refresh unten bleibt
// bewusst erhalten, damit bereits gespeicherte "Mojang"-Konten nicht ungueltig werden.

// ── Skin upload ────────────────────────────────────────────────────────────────
ipcMain.handle('upload-skin', async (e, { accessToken, skinDataUrl, variant }) => {
  try {
    const skinBuffer = Buffer.from(skinDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
    const boundary = '----WebKitFormBoundary' + require('crypto').randomBytes(8).toString('hex');
    const CRLF = '\r\n';

    // Build multipart body correctly
    const parts = [
      // variant field
      `--${boundary}${CRLF}`,
      `Content-Disposition: form-data; name="variant"${CRLF}${CRLF}`,
      `${variant || 'classic'}${CRLF}`,
      // file field
      `--${boundary}${CRLF}`,
      `Content-Disposition: form-data; name="file"; filename="skin.png"${CRLF}`,
      `Content-Type: image/png${CRLF}${CRLF}`,
    ];

    const body = Buffer.concat([
      Buffer.from(parts.join('')),
      skinBuffer,
      Buffer.from(`${CRLF}--${boundary}--${CRLF}`)
    ]);

    return await new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.minecraftservices.com',
        path: '/minecraft/profile/skins',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length
        }
      }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true });
          } else {
            resolve({ success: false, error: `HTTP ${res.statusCode}: ${d}` });
          }
        });
      });
      req.on('error', err => resolve({ success: false, error: err.message }));
      req.write(body);
      req.end();
    });
  } catch(err) { return { success: false, error: err.message }; }
});

// ── Skin variant fetch ────────────────────────────────────────────────────────
ipcMain.handle('get-skin-variant', async (e, accessToken) => {
  try {
    const profile = await getJson('https://api.minecraftservices.com/minecraft/profile', accessToken);
    if (profile.error) return { variant: 'classic' };
    const active = profile.skins?.find(s => s.state === 'ACTIVE');
    return { variant: active?.variant || 'classic', url: active?.url || null };
  } catch { return { variant: 'classic' }; }
});

// ── Refresh account token (for profile/cape/skin API calls) ───────────────────
ipcMain.handle('refresh-mc-token', async (e, acc) => {
  try {
    if (!acc || !acc.accessToken) return { error: 'No account' };

    if (acc.type === 'Mojang') {
      try {
        const refreshRes = await postJson('https://authserver.mojang.com/refresh', {
          accessToken: acc.accessToken,
          clientToken: acc.clientToken || require('crypto').randomBytes(16).toString('hex')
        });
        if (refreshRes.error || refreshRes.errorMessage) return { error: refreshRes.errorMessage || 'Mojang session expired' };
        return { accessToken: refreshRes.accessToken, clientToken: refreshRes.clientToken, type: 'Mojang' };
      } catch (err) { return { error: err.message }; }
    }

    if (acc.refreshToken) {
      try {
        const refreshed = await postForm('https://login.live.com/oauth20_token.srf', {
          client_id: '00000000402b5328',
          refresh_token: acc.refreshToken,
          grant_type: 'refresh_token',
          scope: 'XboxLive.signin offline_access'
        });
        if (!refreshed.error && refreshed.access_token) {
          const xblRes = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
            Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${refreshed.access_token}` },
            RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT'
          });
          const xstsRes = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
            Properties: { SandboxId: 'RETAIL', UserTokens: [xblRes.Token] },
            RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT'
          });
          const mcRes = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
            identityToken: `XBL3.0 x=${xblRes.DisplayClaims.xui[0].uhs};${xstsRes.Token}`
          });
          if (mcRes.access_token) {
            return { accessToken: mcRes.access_token, refreshToken: refreshed.refresh_token, type: 'Microsoft' };
          }
        }
      } catch (err) {
        logDebug('[AUTH] Microsoft refresh failed: ' + err.message);
      }
    }

    // Fallback: existing token still valid?
    try {
      const profile = await getJson('https://api.minecraftservices.com/minecraft/profile', acc.accessToken);
      if (profile && !profile.error) return { accessToken: acc.accessToken, type: acc.type };
    } catch {}

    return { error: 'Session expired. Please log in again in the MC-Account tab.' };
  } catch (err) { return { error: err.message }; }
});

// ── Instances ──────────────────────────────────────────────────────────────────
const instances = {};
let instanceCounter = 0;
let lastLaunchData = null;
const stoppedInstances = new Set();
ipcMain.handle('get-instance-logs', (e, instanceId) => instances[instanceId]?.logs || []);
ipcMain.handle('get-instances', () => Object.values(instances).map(i=>({id:i.id,version:i.version,startTime:i.startTime,crashed:i.crashed})));

ipcMain.on('stop-minecraft', (e, instanceId) => {
  stoppedInstances.add(instanceId);
  const inst = instances[instanceId];
  if (!inst) return;
  inst.stopped = true;
  const cp = require('child_process');

  // 0. Bedrock is a Store/UWP process we did not spawn — no child to wait for,
  //    so kill the activated PID directly.
  if (inst.bedrockPid) {
    try { cp.exec(`taskkill /PID ${inst.bedrockPid} /F /T`, ()=>{}); } catch {}
  }

  // 1. Kill the direct child process (the one we spawned) - also kill javaw
  if (inst.process && inst.process.pid) {
    try { cp.exec(`taskkill /PID ${inst.process.pid} /F /T`, ()=>{}); } catch {}
  }

  // 2. Kill Java child processes spawned by the launcher (useOriginalLauncher case)
  // Use PowerShell Get-Process to reliably find java/javaw processes
  try {
    cp.exec('powershell -NoProfile -Command "Get-Process -Name java,javaw -ErrorAction SilentlyContinue | Select-Object Id,StartTime | ConvertTo-Json"', {timeout:8000}, (err, stdout) => {
      if (err || !stdout) return;
      try {
        const procs = JSON.parse(stdout);
        const arr = Array.isArray(procs) ? procs : [procs];
        const since = inst.startTime ? new Date(inst.startTime).getTime() : 0;
        for (const p of arr) {
          if (!p.Id) continue;
          // Kill processes that started after our instance
          if (since && p.StartTime) {
            const procTime = new Date(p.StartTime).getTime();
            if (procTime < since - 10000) continue; // Started before our instance, skip (10s buffer)
          }
          // Only kill processes that are children of our launcher process
          try {
            const parentPid = cp.execSync(`powershell -NoProfile -Command "(Get-WmiObject Win32_Process -Filter 'ProcessId=${p.Id}').ParentProcessId"`, {timeout:3000,encoding:'utf8'}).trim();
            if (parentPid && parseInt(parentPid) !== process.pid && parseInt(parentPid) !== (inst.process?.pid || -1)) continue;
          } catch { /* can't determine parent, kill anyway as fallback */ }
          try { cp.exec(`taskkill /PID ${p.Id} /F /T`, ()=>{}); } catch {}
        }
      } catch {}
    });
  } catch {}

  inst.crashed = false;
  if (inst.bedrockPid) { try { clearInterval(inst.bedrockWatcher); } catch {} }
  try { mainWindow.webContents.send('instance-closed', { instanceId, code: 0 }); } catch {}
});

// ── Bedrock ────────────────────────────────────────────────────────────────────
// Bedrock runs as a Store/UWP process that the launcher does not spawn, so there is
// no ChildProcess to wait for. Poll the PID returned by ActivateApplication instead:
// when the player closes Minecraft by hand the PID disappears and the instance has to
// flip to "closed" — otherwise the launcher keeps showing "running" forever.
function isProcessAlive(pid) {
  if (!pid || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e && e.code === 'EPERM'; }  // exists, but we may not open it
}

function watchBedrockProcess(instanceId, pid) {
  const inst = instances[instanceId];
  if (!inst || !pid) return;
  inst.bedrockPid = pid;
  if (inst.bedrockWatcher) { try { clearInterval(inst.bedrockWatcher); } catch {} }
  inst.bedrockWatcher = setInterval(() => {
    const live = instances[instanceId];
    if (!live || live !== inst) { try { clearInterval(inst.bedrockWatcher); } catch {} return; }
    if (isProcessAlive(pid)) return;
    try { clearInterval(inst.bedrockWatcher); } catch {}
    if (stoppedInstances.has(instanceId)) return;   // stop-minecraft already reported it
    inst.stopped = true;
    try { mainWindow.webContents.send('instance-closed', { instanceId, code: 0 }); } catch {}
  }, 3000);
  if (inst.bedrockWatcher.unref) inst.bedrockWatcher.unref();
}

// Bedrock is a Microsoft Store (UWP/MSIX) app — it cannot be downloaded as a plain
// file, so the Store itself has to deliver it. Flow: check the package with
// Get-AppxPackage, and if it is missing hand the download over to the Store
// (ms-windows-store://downloadsandopen), wait for the package to appear, then start
// the game by AUMID through IApplicationActivationManager.
const BEDROCK_PKG               = 'Microsoft.MinecraftUWP';            // stable
const BEDROCK_PKG_PRERELEASE    = 'Microsoft.MinecraftWindowsBeta';    // preview
const BEDROCK_PUBLISHER_SUFFIX  = '_8wekyb3d8bbwe';
const BEDROCK_AUMID             = BEDROCK_PKG            + BEDROCK_PUBLISHER_SUFFIX + '!Game';
const BEDROCK_PRERELEASE_AUMID  = BEDROCK_PKG_PRERELEASE + BEDROCK_PUBLISHER_SUFFIX + '!Game';
// Store product IDs for ms-windows-store://downloadsandopen.
const BEDROCK_STORE_ID            = '9NBLGGH2JHXJ'; // Minecraft for Windows
const BEDROCK_PRERELEASE_STORE_ID = '9P5X4QVLC2XR'; // Minecraft Preview for Windows

// Reports whether the Bedrock app is installed and which AUMID actually starts it.
const BEDROCK_INFO_PS = `
$ErrorActionPreference = 'SilentlyContinue'
$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8
$p = Get-AppxPackage -Name '__PKG__' | Where-Object { $_.Status -eq 'Ok' } | Select-Object -First 1
if (-not $p) { Write-Output 'NONE'; exit 0 }
$aumid = (Get-StartApps | Where-Object { $_.AppID -like ($p.Name + '_8wekyb3d8bbwe!*') } | Select-Object -First 1).AppID
if (-not $aumid) { $aumid = $p.Name + '_8wekyb3d8bbwe!Game' }
Write-Output ('OK|' + $p.Version + '|' + $aumid)
`.trim();

async function runPowerShellFile(scriptPath, args, timeout) {
  return new Promise((res, rej) => {
    execFile('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath, ...args],
      { timeout, windowsHide: true, encoding: 'utf8' },
      (err, stdout, stderr) => err ? rej(new Error(stderr || err.message)) : res(stdout || ''));
  });
}

// → { installed:boolean, version:string, aumid:string }
async function bedrockInfo(preRelease) {
  const pkg = preRelease ? BEDROCK_PKG_PRERELEASE : BEDROCK_PKG;
  const scriptPath = path.join(os.tmpdir(), 'crux-bedrock-info.ps1');
  try {
    fs.writeFileSync(scriptPath, '\uFEFF' + BEDROCK_INFO_PS.replace('__PKG__', pkg), 'utf8');
    const out = await runPowerShellFile(scriptPath, [], 45000);
    const m = /^OK\|([^|]*)\|(.+)$/m.exec((out || '').trim());
    if (!m) return { installed: false };
    return { installed: true, version: m[1].trim(), aumid: m[2].trim() };
  } catch (e) {
    return { installed: false, error: e.message };
  }
}

// Makes sure the app file is on disk, downloading it via the Store when it is missing.
async function ensureBedrockInstalled(preRelease, send, instanceId) {
  let info = await bedrockInfo(preRelease);
  if (info.installed) return info;

  const storeId = preRelease ? BEDROCK_PRERELEASE_STORE_ID : BEDROCK_STORE_ID;
  send('instance-log', { instanceId, line: `[BEDROCK] Not installed - downloading from Microsoft Store (product ${storeId})...` });
  send('launch-progress', { instanceId, percent:5, message:'Downloading Minecraft Bedrock Edition from the Microsoft Store...' });
  try { await shell.openExternal(`ms-windows-store://downloadsandopen?id=${storeId}`); }
  catch { try { await shell.openExternal(`ms-windows-store://pdp/?ProductId=${storeId}`); } catch {} }

  // ~900 MB download — poll for up to 5 minutes, then give up with a hint.
  for (let i = 1; i <= 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    info = await bedrockInfo(preRelease);
    if (info.installed) {
      send('instance-log', { instanceId, line: `[BEDROCK] Installed ${info.version} - starting...` });
      return info;
    }
    if (i % 4 === 0) send('launch-progress', { instanceId, percent:Math.min(90, 5 + i), message:'Installing Minecraft Bedrock Edition - this can take a few minutes...' });
  }
  try { await shell.openExternal(`ms-windows-store://pdp/?ProductId=${storeId}`); } catch {}
  throw new Error(`Minecraft Bedrock Edition is not installed. Install it from the Microsoft Store (product ${storeId}) and try again.`);
}

// Activates the Store/UWP app by AUMID through IApplicationActivationManager.
// This starts the game directly — no explorer.exe window and no game folder opens.
const BEDROCK_ACTIVATE_PS = `
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8
$aumid = $args[0]
$code = @"
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IApplicationActivationManager {
    IntPtr ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
        [MarshalAs(UnmanagedType.LPWStr)] string arguments, uint options, out uint processId);
    IntPtr ActivateForFile(IntPtr appUserModelId, IntPtr itemArray, IntPtr verb, out uint processId);
    IntPtr ActivateForProtocol(IntPtr appUserModelId, IntPtr itemArray, out uint processId);
}
[ComImport, Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")]
class ApplicationActivationManager { }
public static class Ctx {
    public static uint Activate(string aumid) {
        var mgr = (IApplicationActivationManager)new ApplicationActivationManager();
        uint pid = 0;
        int hr = (int)mgr.ActivateApplication(aumid, "", 0, out pid);
        if (hr < 0) Marshal.ThrowExceptionForHR(hr);
        return pid;
    }
}
"@
Add-Type -TypeDefinition $code -Language CSharp
try {
    $pid2 = [Ctx]::Activate($aumid)
    if ($pid2 -le 0) { Write-Output 'FAIL:activation returned no process id'; exit 1 }
    Write-Output "OK:$pid2"
} catch {
    $ex = $_.Exception
    while ($ex.InnerException) { $ex = $ex.InnerException }
    Write-Output ('FAIL:activation failed (HRESULT 0x' + ('{0:X8}' -f $ex.HResult) + ')')
    exit 1
}
`.trim();

async function launchBedrock(aumid, send, instanceId) {
  abortPrecache(); // Spielstart hat Vorrang vor dem Hintergrund-Cache
  const scriptPath = path.join(os.tmpdir(), 'crux-activate-app.ps1');
  try {
    fs.writeFileSync(scriptPath, '\uFEFF' + BEDROCK_ACTIVATE_PS, 'utf8');
  } catch (e) {
    send('instance-log', { instanceId, line: `[BEDROCK] Could not write activation script: ${e.message}` });
    throw e;
  }
  let out = '';
  try {
    out = await runPowerShellFile(scriptPath, [aumid], 30000);
  } catch (e) {
    out = e.message || '';
  }
  const m = /OK:(\d+)/.exec(out || '');
  if (!m || Number(m[1]) <= 0) {
    const fail = /FAIL:(.+)/.exec(out || '');
    throw new Error(fail ? fail[1].trim() : ('could not activate ' + aumid));
  }
  send('instance-log', { instanceId, line: `[BEDROCK] Activated ${aumid} (pid ${m[1]})` });
  return Number(m[1]);
}

// ── GPU/renderer history (per PC) ─────────────────────────────────────────────
// Der Launcher merkt sich pro Rechner, welcher Render-Modus gecrasht ist, und
// probiert beim nächsten Start zuerst die anderen. Das ist bewusst NICHT in
// settings.json (die Whitelist würde das Feld verwerfen) und nicht pro Profil.
const GPU_MODES = [
  { id:'native',   label:'Native GPU (OpenGL)', software:false, gallium:'' },
  { id:'zink',     label:'Mesa3D / Zink',       software:true,  gallium:'zink' },
  { id:'llvmpipe', label:'Mesa3D / llvmpipe',   software:true,  gallium:'llvmpipe' },
];
const GPU_CRASH_MEMORY_MS = 30 * 24 * 60 * 60 * 1000; // alte Crashes vergessen
// hs_err-Dateien nennen den Treiber (AMD/NVIDIA/Intel/Mesa/Vulkan) und die
// Exception in getrennten Zeilen — beides zusammen gilt als GPU-Crash.
const GPU_DRIVER_HINT = /(?:atio6axx|amdvlk64|nvoglv64|nvwgf2umx|ig9icd64|opengl32|vulkan-1)\.dll/i;

function gpuModeById(id){
  return GPU_MODES.find(m => m.id === id) || GPU_MODES[0];
}
async function gpuMachineKey(){
  try {
    const s = await load(P.settings, {});
    if (s && s.deviceId) return String(s.deviceId);
  } catch {}
  try {
    const id = fs.readFileSync(DEVICE_ID_FILE, 'utf8').trim();
    if (id) return id;
  } catch {}
  return String(os.hostname() || 'pc') + ':' + String(os.userInfo?.().username || process.env.USERNAME || 'user');
}
async function loadGpuHistory(){
  const all = await load(P.gpuDrivers, {});
  return all && typeof all === 'object' ? all : {};
}
async function gpuModeOrder(){
  const key = await gpuMachineKey();
  const all = await loadGpuHistory();
  const h = all[key] || {};
  const modes = (h && h.modes) || {};
  const now = Date.now();

  // Frühere Auto-Fixes haben nur global forceSoftwareGL gesetzt. Das als
  // "native gecrasht" übernehmen, damit genau dieses PC-Verhalten erhalten bleibt.
  try {
    const s = await load(P.settings, {});
    if (s && s.forceSoftwareGL === true && !modes.native?.lastCrash && h.preferred !== 'zink') {
      modes.native = Object.assign({}, modes.native, {
        crashes: Math.max(1, Number(modes.native?.crashes) || 1),
        lastCrash: now, reason: 'legacy forceSoftwareGL'
      });
      h.preferred = null;
      all[key] = Object.assign({}, h, { modes, updated: now });
      await save(P.gpuDrivers, all);
    }
  } catch {}

  const isRecent = (id) => {
    const e = modes[id];
    return !!(e && e.lastCrash && (now - Number(e.lastCrash)) < GPU_CRASH_MEMORY_MS);
  };
  const preferred = h.preferred && GPU_MODES.some(m => m.id === h.preferred) && !isRecent(h.preferred)
    ? h.preferred : null;

  // Sortierung: zuerst der zuletzt funktionierende, dann unauffällige Modi,
  // dann die mit den wenigsten (recenten) Crashes. Native bleibt Standard,
  // wenn alles unauffällig ist (beste Performance, korrekte Texturen).
  return [...GPU_MODES].sort((a, b) => {
    const ra = isRecent(a.id) ? 1 : 0, rb = isRecent(b.id) ? 1 : 0;
    if (ra !== rb) return ra - rb;
    const ca = ra ? (Number(modes[a.id]?.crashes) || 0) : 0;
    const cb = rb ? (Number(modes[b.id]?.crashes) || 0) : 0;
    if (ca !== cb) return ca - cb;
    if (preferred) {
      if (a.id === preferred) return -1;
      if (b.id === preferred) return 1;
    }
    return GPU_MODES.indexOf(a) - GPU_MODES.indexOf(b);
  });
}
let _gpuHistoryWrite = Promise.resolve();
async function markGpuModeResult(modeId, crashed, reason){
  // Erfolg und Crash können kurz hintereinander kommen (Spiel startet, crasht
  // später) — die Schreibzugriffe müssen nacheinander laufen, sonst überschreibt
  // einer den anderen. Die Historie wird deshalb serialisiert geschrieben.
  const apply = async () => {
    const key = await gpuMachineKey();
    const all = await loadGpuHistory();
    const h = Object.assign({ modes:{}, preferred:null }, all[key]);
    h.modes = Object.assign({}, h.modes);
    const e = Object.assign({}, h.modes[modeId]);
    if (crashed) {
      e.crashes = (Number(e.crashes) || 0) + 1;
      e.lastCrash = Date.now();
      e.lastSuccess = 0;
      e.reason = String(reason || '').slice(0, 240);
      if (h.preferred === modeId) h.preferred = null;
    } else {
      e.crashes = 0;
      e.lastCrash = 0;
      e.lastSuccess = Date.now();
      e.reason = '';
      h.preferred = modeId;
    }
    h.modes[modeId] = e;
    h.updated = Date.now();
    all[key] = h;
    await save(P.gpuDrivers, all);
  };
  _gpuHistoryWrite = _gpuHistoryWrite.then(apply, apply);
  return _gpuHistoryWrite;
}

// ── Launch ─────────────────────────────────────────────────────────────────────
ipcMain.on('launch-minecraft', async (event, data) => {
  lastLaunchData = data;

  // ── Ban-Schranke: Start über JEDEN Weg (Profil, Instanz, Welt, Server) verhindern ──
  try {
    const s = await load(P.settings, {});
    const bans = Array.isArray(s.bans) ? s.bans : [];
    const rawUuid = String((data && data.uuid) || '').replace(/-/g, '').toLowerCase();
    const rawName = String((data && (data.playerName || data.name)) || '').trim().toLowerCase();
    const uk = rawUuid ? 'u:' + rawUuid : null;
    const nk = rawName ? 'n:' + rawName : null;
    const now = Date.now();
    const hit = bans.find(b => {
      if (!b) return false;
      const bk = b.key || (b.uuid ? 'u:' + String(b.uuid).replace(/-/g, '').toLowerCase()
                                 : (b.name ? 'n:' + String(b.name).trim().toLowerCase() : null));
      if (!bk) return false;
      if (uk && bk === uk) return !b.end || b.end > now;
      if (nk && bk === nk) return !b.end || b.end > now;
      return false;
    });
    if (hit) {
      const disabled = (Array.isArray(hit.disabled) && hit.disabled.length) ? hit.disabled : ['launch', 'bugreport'];
      if (disabled.includes('launch')) {
        console.log('[Crux] Launch blocked: account is banned (' + (hit.reason || '') + ')');
        try { mainWindow.webContents.send('launch-blocked', { reason: hit.reason || '', end: hit.end || null }); } catch {}
        return;
      }
    }
  } catch (e) { /* bei Fehler nicht blockieren */ }

  const { version, javaPath, ram, ramUnit, clientMods, clientResourcePacks, profileResourcePacks, useClientMods, useClientRPs, accessToken, uuid, playerName: rawPlayerName, modLoader, useOriginalLauncher, profileId, profileName, mrpackMods, mrpackRPs, renderApi, useCruxClientMod } = data;
  let profileMods = data.profileMods || [];
  // Der Renderer kann noch einen alten Profil-Stand im Speicher haben (z. B.
  // nach einer Auto-Reparatur). Die gespeicherten Mods sind massgeblich.
  try {
    const savedProfiles = await load(P.profiles, []);
    const savedProfile = savedProfiles.find(p => p.id === profileId);
    if (savedProfile && Array.isArray(savedProfile.mods)) profileMods = savedProfile.mods;
  } catch {}

  // Valid Minecraft username (no spaces / invalid chars)
  const playerName = (rawPlayerName || 'Player').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 16);

  // RAM
  let maxRam, minRam;
  if (ramUnit === 'mb') {
    const mb = Math.max(512, Math.min(8192, parseInt(ram)||1024));
    maxRam=`${mb}M`; minRam=`${Math.max(512,Math.floor(mb/2))}M`;
  } else {
    const gb = Math.max(1, Math.min(8, parseInt(ram)||1));
    maxRam=`${gb}G`; minRam=`${Math.max(1,Math.floor(gb/2))}G`;
  }

  const instanceId = `inst_${++instanceCounter}`;
  const gameDir = instanceDir(profileId);
  try { await fs.promises.mkdir(gameDir, { recursive: true }); } catch {}
  instances[instanceId] = { id:instanceId, version, profileId, gameDir, startTime:Date.now(), logs:[], crashed:false, process:null, sessionRetried:false };
  // Wird vor dem ersten Start aus der pro-PC-Historie gesetzt und bei jedem
  // GPU-Auto-Retry auf den nächsten Modus gewechselt.
  let currentGpuMode = 'native';
  // Ein Spielstart hat Vorrang: laufende Hintergrund-Downloads sofort stoppen.
  abortPrecache();
  mainWindow.webContents.send('instance-started', { id:instanceId, version, profileId, profileName, startTime:instances[instanceId].startTime, serverAddress: data.serverAddress||null, serverPort: data.serverPort||null, serverName: data.serverName||null });

  const send = (ch,...a) => { try { if (ch === 'launch-progress' && a[0] && a[0].instanceId && stoppedInstances.has(a[0].instanceId)) return; mainWindow.webContents.send(ch,...a); } catch {} };

  // ── Bedrock Edition ───────────────────────────────────────────────────────────
  if (modLoader === 'bedrock') {
    // Bedrock has no version list in the launcher — only "Latest" and "Latest Pre-release".
    // Anything else in mcVersion is meaningless for UWP activation, so treat it as latest.
    const preRelease = version === '__latest_prerelease__';
    try {
      const info = await ensureBedrockInstalled(preRelease, send, instanceId);
      send('launch-progress', { instanceId, percent:50, message:'Launching Minecraft Bedrock Edition...' });
      const pid = await launchBedrock(info.aumid || (preRelease ? BEDROCK_PRERELEASE_AUMID : BEDROCK_AUMID), send, instanceId);
      watchBedrockProcess(instanceId, pid);
      send('launch-progress', { instanceId, percent:100, message:'Minecraft Bedrock Edition launched!', done:true });
    } catch (be) {
      send('instance-log', { instanceId, line: `[BEDROCK] Launch failed: ${be.message}` });
      send('launch-progress', { instanceId, percent:0, message:'', done:true });
      send('launch-status', 'Could not launch Bedrock: ' + be.message);
      instances[instanceId].crashed = true;
      try { mainWindow.webContents.send('instance-crashed', { instanceId }); } catch {}
    }
    return;
  }

  // Safety timeout: if nothing happens for 5 min, reset UI
  const fireSafetyTimeout = () => {
    try {
      if (instances[instanceId] && !instances[instanceId].crashed && !stoppedInstances.has(instanceId)) {
        send('launch-status', 'Something took too long — please try again.');
        send('launch-progress', { instanceId, percent:0, message:'', done:true });
      }
    } catch {}
  };
  let safetyTimer = setTimeout(fireSafetyTimeout, 5 * 60 * 1000);

  try {
    // ── Find Java ──────────────────────────────────────────────────────────────
    let resolvedJava = (javaPath && !javaPath.startsWith('No Java')) ? path.resolve(javaPath) : null;

    const versionType = mcVersionList.find(v=>v.id===version)?.type || (version.match(/^\d+w/)? 'snapshot':'release');

    // Look up the actual required Java version from Mojang's version JSON
    let needed = 8;
    try {
      const vInfo = mcVersionList.find(v=>v.id===version);
      if (vInfo && vInfo.url) {
        const vJson = await fetchJson(vInfo.url);
        if (vJson && vJson.javaVersion && vJson.javaVersion.majorVersion) {
          needed = vJson.javaVersion.majorVersion;
        }
      }
    } catch {}
    if (needed < 17) {
      // Fallback for versions not in manifest (snapshots, etc.)
      const verParts = version.split('.');
      const major = parseInt(verParts[0]) || 0;
      const minor = parseInt(verParts[1]) || 0;
      
      // New versioning scheme: 26.x = 1.21.x, 27.x = 1.22.x, etc.
      // These all need Java 21+
      if (major >= 26) {
        needed = 21;
      } else if (major >= 22) {
        needed = 25;
      } else if (major >= 21) {
        needed = 21;
      } else if (minor >= 17) {
        needed = 17;
      }
    }

    // NeoForge/Forge need exactly Java 21 — Java 24+ breaks their module system
    const maxJavaForModLoader = (modLoader === 'neoforge' || modLoader === 'forge' || modLoader === 'quilt') ? 21 : 99;
    const effectiveNeeded = (modLoader === 'forge' || modLoader === 'neoforge') ? Math.max(needed, 21) : needed;

    // For Forge/NeoForge: ALWAYS ignore dropdown and scan fresh
    const javaVer = resolvedJava ? (parseInt(await getJavaVersion(resolvedJava).catch(()=>'0')) || 0) : 0;
    send('instance-log', { instanceId, line: `[JAVA] Selected: ${resolvedJava||'none'} → Java ${javaVer}, need ${effectiveNeeded}+ (max ${maxJavaForModLoader})` });

    if (modLoader === 'forge' || modLoader === 'neoforge' || !resolvedJava || javaVer < effectiveNeeded || javaVer > maxJavaForModLoader) {
      send('launch-progress', { instanceId, percent:2, message:`Scanning for Java ${effectiveNeeded}...` });
      const javas = await findInstalledJavas();
      send('instance-log', { instanceId, line: `[JAVA] Scan found: ${javas.map(j=>`Java${j.version}@${j.path}`).join(' | ')||'none'}` });
      let valid = javas.filter(j => {
        const v = parseInt(j.version)||0;
        return v >= effectiveNeeded && v <= maxJavaForModLoader;
      });

      // Auto-download required Java from Adoptium if none found
      if (!valid.length) {
        const dlVer = Math.min(Math.max(effectiveNeeded, 17), 25);
        send('launch-progress', { instanceId, percent:3, message:`No Java ${effectiveNeeded}+ found. Downloading Java ${dlVer} from Adoptium...` });
        try {
          // Try JRE first, then JDK as fallback
          let assets = await fetchJson(`https://api.adoptium.net/v3/assets/latest/${dlVer}/hotspot?os=windows&arch=x64&image_type=jre&heap_size=normal&vendor=eclipse`);
          if (!assets || !assets.length) {
            assets = await fetchJson(`https://api.adoptium.net/v3/assets/latest/${dlVer}/hotspot?os=windows&arch=x64&image_type=jdk&heap_size=normal&vendor=eclipse`);
          }
          if (!assets || !assets.length) throw new Error('No Adoptium assets for Java ' + dlVer);
          const asset = assets.find(a=>a.binary.package.link.endsWith('.zip')) || assets[0];
          const url = asset.binary.package.link;
          const fn  = path.basename(url.split('?')[0]);
          const fp  = path.join(base, fn);
          const extractTo = path.join(P.java, `jre-${dlVer}`);
          const javaExeFound = findJavaExe(extractTo);
          if (javaExeFound) {
            valid = [{ path: javaExeFound, version: String(dlVer) }];
            send('launch-progress', { instanceId, percent:10, message:`Java ${dlVer} already installed.` });
          } else {
            send('launch-progress', { instanceId, percent:5, message:`Downloading Java ${dlVer}...` });
            if (!fs.existsSync(fp)) await downloadFile(url, fp);
            const AdmZip = require('adm-zip');
            await fs.promises.mkdir(extractTo, { recursive: true });
            new AdmZip(fp).extractAllTo(extractTo, true);
            const found = findJavaExe(extractTo);
            if (found) {
              valid = [{ path: found, version: String(dlVer) }];
              send('launch-progress', { instanceId, percent:10, message:`Java ${dlVer} downloaded and ready.` });
            }
          }
        } catch(dlErr) {
          send('launch-status', `Need Java ${effectiveNeeded}+, none found and auto-download failed: ${dlErr.message}`);
          send('launch-progress', { instanceId, percent:0, message:'', done:true });
          send('no-java-found', effectiveNeeded);
          clearTimeout(safetyTimer);
          return;
        }
      }

      if (!valid.length) {
        send('launch-status', `Need Java ${effectiveNeeded}+. None found. Install Java ${effectiveNeeded} and rescan in Settings.`);
        send('launch-progress', { instanceId, percent:0, message:'', done:true });
        send('no-java-found', effectiveNeeded);
        clearTimeout(safetyTimer);
        return;
      }

      // Prefer LTS versions (21, 17) over newer non-LTS (25, etc.)
      valid.sort((a,b) => {
        const va=parseInt(a.version)||0, vb=parseInt(b.version)||0;
        const aLts = (va===21||va===17) ? 1 : 0;
        const bLts = (vb===21||vb===17) ? 1 : 0;
        if (aLts !== bLts) return bLts - aLts;
        return va - vb;
      });
      resolvedJava = path.resolve(valid[0].path);
      send('instance-log', { instanceId, line: `[JAVA] Using Java ${valid[0].version} @ ${resolvedJava}` });
      send('launch-progress', { instanceId, percent:11, message:`Using Java ${valid[0].version}: ${path.basename(path.dirname(path.dirname(resolvedJava)))}` });
    }

    // ── Auth ───────────────────────────────────────────────────────────────────
    let Client;
    let auth = null;
    if (!useOriginalLauncher) {
      try {
        ({ Client } = require('minecraft-launcher-core'));
      } catch(e) {
        send('launch-status', `ERROR: minecraft-launcher-core not installed. Run "npm install" in the launcher folder.`);
        send('launch-progress', { instanceId, percent:0, message:'', done:true });
        clearTimeout(safetyTimer);
        return;
      }

      if (accessToken && uuid) {
      let validToken = accessToken;
      let tokenOk = true;

      if (data.accountType === 'Mojang') {
        // Mojang account — try refresh via Mojang auth server
        try {
          const refreshRes = await postJson('https://authserver.mojang.com/refresh', {
            accessToken, clientToken: data.clientToken || require('crypto').randomBytes(16).toString('hex')
          });
          if (refreshRes.error || refreshRes.errorMessage) {
            tokenOk = false;
          } else {
            validToken = refreshRes.accessToken;
            mainWindow.webContents.send('token-refreshed', { uuid, accessToken: validToken, clientToken: refreshRes.clientToken });
          }
        } catch {
          tokenOk = false;
        }
        if (!tokenOk) {
          send('launch-status', 'Mojang session expired. Please log in again in the MC-Account tab.');
          send('launch-progress', { instanceId, percent:0, message:'', done:true });
          clearTimeout(safetyTimer);
          return;
        }
      } else if (data.accountType === 'Microsoft' || data.refreshToken) {
        if (data.refreshToken) {
          send('launch-progress', { instanceId, percent:1, message:'Refreshing login token...' });
          try {
            const refreshed = await postForm('https://login.live.com/oauth20_token.srf', {
              client_id: '00000000402b5328',
              refresh_token: data.refreshToken,
              grant_type: 'refresh_token',
              scope: 'XboxLive.signin offline_access'
            });
            if (!refreshed.error && refreshed.access_token) {
              const xblRes = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
                Properties: { AuthMethod:'RPS', SiteName:'user.auth.xboxlive.com', RpsTicket:`d=${refreshed.access_token}` },
                RelyingParty: 'http://auth.xboxlive.com', TokenType:'JWT'
              });
              const xstsRes = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
                Properties: { SandboxId:'RETAIL', UserTokens:[xblRes.Token] },
                RelyingParty: 'rp://api.minecraftservices.com/', TokenType:'JWT'
              });
              const mcRes = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
                identityToken: `XBL3.0 x=${xblRes.DisplayClaims.xui[0].uhs};${xstsRes.Token}`
              });
              if (mcRes.access_token) {
                validToken = mcRes.access_token;
                tokenOk = true;
                send('launch-progress', { instanceId, percent:2, message:'Login token refreshed.' });
                mainWindow.webContents.send('token-refreshed', { uuid, accessToken: validToken, refreshToken: refreshed.refresh_token });
              }
            }
          } catch (e) {
            send('instance-log', { instanceId, line: `[AUTH] Refresh failed: ${e.message}` });
          }
        }
        if (!tokenOk) {
          try {
            const profileCheck = await getJson('https://api.minecraftservices.com/minecraft/profile', accessToken);
            if (profileCheck && !profileCheck.error) {
              validToken = accessToken;
              tokenOk = true;
              send('instance-log', { instanceId, line: '[AUTH] Using existing token (refresh failed)' });
            }
          } catch {}
        }
        if (!tokenOk) {
          send('launch-status', 'Session expired. Please log in again in the MC-Account tab.');
          send('launch-progress', { instanceId, percent:0, message:'', done:true });
          clearTimeout(safetyTimer);
          return;
        }
      }

      // Build proper MCLC auth object for online mode
      auth = {
        access_token:    validToken,
        client_token:    require('crypto').randomBytes(16).toString('hex'),
        uuid:            uuid.replace(/-/g, ''),
        name:            playerName || 'Player',
        user_properties: '{}',
        meta: {
          type:     'msa',
          demo:     false,
          xuid:     '',
          clientId: '00000000402b5328',
        }
      };
    } else {
      // No valid account — block launch
      send('launch-status', 'No valid account. Please log in with a Microsoft account in the MC-Account tab.');
      send('launch-progress', { instanceId, percent:0, message:'', done:true });
      send('no-account-found', 0);
      clearTimeout(safetyTimer);
      return;
    }
    }

    // ── Fabric installer ───────────────────────────────────────────────────────
    let versionObj = { number: version, type: versionType };

    // Always resolve to absolute path and always quote — paths may have spaces or start relative
    const quoteJava = (p) => `"${path.resolve(p)}"`;

    if (modLoader === 'fabric') {
      // Fabric installer creates: fabric-loader-{loaderVer}-{mcVer}
      // Find any existing fabric version for this MC version
      const versionsDir = path.join(P.mc, 'versions');
      let fabricId = null;

      fabricId = newestLoaderId(version, 'fabric-loader-');
      // Automatisch auf den neuesten Loader aktualisieren: alte Loader (z. B.
      // 0.19.5) bleiben sonst erhalten, obwohl neue Mods 0.20.1 verlangen.
      if (fabricId){
        const freshId = await refreshLoaderIfOutdated(version, 'fabric', resolvedJava,
          (msg) => send('launch-progress', { instanceId, percent:6, message: msg }));
        if (freshId) fabricId = freshId;
      }

      if (fabricId && fs.existsSync(path.join(versionsDir, fabricId, `${fabricId}.json`))) {
        versionObj.custom = fabricId;
        send('launch-progress', { instanceId, percent:5, message:`Using Fabric: ${fabricId}` });
      } else {
        send('launch-progress', { instanceId, percent:5, message:'Downloading Fabric installer...' });
        try {
          const loaders = await fetchJson(`https://meta.fabricmc.net/v2/versions/loader/${version}`);
          if (!loaders || !loaders.length) throw new Error('No Fabric loader for ' + version);

          const loaderVer = loaders[0].loader.version;

          // Get installer version from separate endpoint (more reliable)
          let instVer = loaders[0].installer?.version;
          if (!instVer) {
            try {
              const installerMeta = await fetchJson('https://meta.fabricmc.net/v2/versions/installer');
              instVer = installerMeta[0]?.version;
            } catch {}
          }
          if (!instVer) {
            // Hardcode a known-good installer version as last resort
            instVer = '0.11.2';
          }

          const expectedFabricId = `fabric-loader-${loaderVer}-${version}`;
          const instUrl  = `https://maven.fabricmc.net/net/fabricmc/fabric-installer/${instVer}/fabric-installer-${instVer}.jar`;
          const instPath = path.join(base, `fabric-installer-${instVer}.jar`);

          if (!fs.existsSync(instPath)) {
            send('launch-progress', { instanceId, percent:8, message:`Downloading fabric-installer-${instVer}.jar...` });
            await downloadFile(instUrl, instPath);
          }

          send('launch-progress', { instanceId, percent:12, message:'Running Fabric installer...' });
          const javaExe = quoteJava(resolvedJava);
          await new Promise((res,rej) => exec(
            `${javaExe} -jar "${path.resolve(instPath)}" client -dir "${path.resolve(P.mc)}" -mcversion ${version} -loader ${loaderVer} -noprofile`,
            { timeout: 120000 },
            (e,o,se) => {
              console.log('Fabric installer stdout:', o);
              console.log('Fabric installer stderr:', se);
              if(e) rej(new Error(se||e.message||String(e))); else res(o);
            }
          ));

          // Find the newly created fabric version dir
          if (fs.existsSync(versionsDir)) {
            const newDirs = fs.readdirSync(versionsDir);
            fabricId = newDirs.find(d => d.toLowerCase().startsWith('fabric-loader-') && d.includes(version)) || null;
          }

          if (fabricId && fs.existsSync(path.join(versionsDir, fabricId, `${fabricId}.json`))) {
            versionObj.custom = fabricId;
            send('launch-progress', { instanceId, percent:18, message:`Fabric installed: ${fabricId}` });
          } else {
            throw new Error(`Fabric installer ran but version dir not found (expected: ${expectedFabricId})`);
          }
        } catch(fe) {
          console.error('Fabric install error:', fe);
          send('instance-log', { instanceId, line:`[FABRIC ERROR] ${fe.message}` });
          send('launch-progress', { instanceId, percent:5, message:`Fabric failed: ${fe.message.slice(0,60)}` });
          versionObj = { number: version, type: versionType };
        }
      }
    }

    // ── Quilt ──────────────────────────────────────────────────────────────────
    if (modLoader === 'quilt') {
      const versionsDir = path.join(P.mc, 'versions');
      let quiltId = newestLoaderId(version, 'quilt-loader-');
      if (quiltId){
        const freshId = await refreshLoaderIfOutdated(version, 'quilt', resolvedJava,
          (msg) => send('launch-progress', { instanceId, percent:6, message: msg }));
        if (freshId) quiltId = freshId;
      }
      if (quiltId && fs.existsSync(path.join(versionsDir, quiltId, `${quiltId}.json`))) {
        versionObj.custom = quiltId;
        send('launch-progress', { instanceId, percent:5, message:`Using Quilt: ${quiltId}` });
      } else {
        send('launch-progress', { instanceId, percent:5, message:'Downloading Quilt installer...' });
        try {
          const loaders = await fetchJson(`https://meta.quiltmc.net/v3/versions/loader/${version}`);
          if (!loaders || !loaders.length) throw new Error('No Quilt loader for ' + version);
          const loaderVer = loaders[0].loader.version;
          const instVer = loaders[0].installer?.version || '0.5.1';
          const expectedQId = `quilt-loader-${loaderVer}-${version}`;
          const instUrl  = `https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/${instVer}/quilt-installer-${instVer}.jar`;
          const instPath = path.join(base, `quilt-installer-${instVer}.jar`);
          if (!fs.existsSync(instPath)) {
            send('launch-progress', { instanceId, percent:8, message:'Downloading Quilt installer...' });
            await downloadFile(instUrl, instPath);
          }
          send('launch-progress', { instanceId, percent:12, message:'Running Quilt installer...' });
          const javaExe = quoteJava(resolvedJava);
          await new Promise((res,rej) => exec(
            `${javaExe} -jar "${path.resolve(instPath)}" install client -dir "${path.resolve(P.mc)}" -mcversion ${version} -loader ${loaderVer} -noprofile`,
            { timeout: 120000 },
            (e,o,se) => {
              if(e) rej(new Error(se||e.message||String(e))); else res(o);
            }
          ));
          if (fs.existsSync(versionsDir)) {
            const newDirs = fs.readdirSync(versionsDir);
            quiltId = newDirs.find(d => d.toLowerCase().startsWith('quilt-loader-') && d.includes(version)) || null;
          }
          if (quiltId && fs.existsSync(path.join(versionsDir, quiltId, `${quiltId}.json`))) {
            versionObj.custom = quiltId;
            send('launch-progress', { instanceId, percent:18, message:`Quilt installed: ${quiltId}` });
          } else {
            throw new Error(`Quilt installer ran but version dir not found (expected: ${expectedQId})`);
          }
        } catch(qe) {
          console.error('Quilt install error:', qe);
          send('instance-log', { instanceId, line:`[QUILT ERROR] ${qe.message}` });
          versionObj = { number: version, type: versionType };
        }
      }
    }

    // ── NeoForge ───────────────────────────────────────────────────────────────
    if (modLoader === 'neoforge') {
      const versionsDir = path.join(P.mc, 'versions');
      // NeoForge dir names: "neoforge-21.1.235" → MC 1.21.1, "neoforge-21.4.xxx" → MC 1.21.4
      // NeoForge prefix = MC minor.patch (e.g. MC 1.21.1 → "21.1.", MC 1.20.6 → "20.6.")
      const neoPrefix = (() => { const p = version.split('.'); return `${p[1]||'0'}.${p[2]||'0'}.`; })();
      // NeoForge version can also be just major.minor (e.g. 1.21 → 21)
      const neoPrefixShort = (() => { const p = version.split('.'); return `neoforge-${p[1]||'0'}.`; })();
      let neoId = null;
      if (fs.existsSync(versionsDir)) {
        const dirs = fs.readdirSync(versionsDir);
        neoId = dirs.find(d => d.toLowerCase().startsWith('neoforge-' + neoPrefix)) || dirs.find(d => d.toLowerCase().startsWith(neoPrefixShort)) || null;
        if (neoId && !fs.existsSync(path.join(versionsDir, neoId, `${neoId}.json`))) neoId = null;
      }
      if (neoId) {
        versionObj.custom = neoId;
        send('launch-progress', { instanceId, percent:5, message:`Using NeoForge: ${neoId}` });
      } else {
        send('launch-progress', { instanceId, percent:5, message:'Finding NeoForge version...' });
        try {
          const latestNeoVer = await getNeoForgeLatestVersion(version);
          if (!latestNeoVer) throw new Error(`No NeoForge available for MC ${version}`);
          const neoFullVer = latestNeoVer;
          const instUrl  = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoFullVer}/neoforge-${neoFullVer}-installer.jar`;
          const instPath = path.join(base, `neoforge-installer-${neoFullVer}.jar`);
          if (!fs.existsSync(instPath)) {
            send('launch-progress', { instanceId, percent:8, message:`Downloading NeoForge ${neoFullVer}...` });
            await downloadFile(instUrl, instPath);
          }
          // NeoForge installer requires launcher_profiles.json to exist in target dir
          const launcherProfilesPath = path.join(path.resolve(P.mc), 'launcher_profiles.json');
          if (!fs.existsSync(launcherProfilesPath)) {
            try {
              fs.writeFileSync(launcherProfilesPath, JSON.stringify({
                profiles: {},
                selectedProfile: '(Default)',
                clientToken: require('crypto').randomBytes(8).toString('hex')
              }));
              send('instance-log', { instanceId, line: '[NEOFORGE] Created dummy launcher_profiles.json' });
            } catch(lpErr) {
              send('instance-log', { instanceId, line: `[NEOFORGE] Could not create launcher_profiles.json: ${lpErr.message}` });
            }
          }
          send('launch-progress', { instanceId, percent:15, message:'Installing NeoForge...' });
          const javaExe = quoteJava(resolvedJava);
          await new Promise((res,rej) => exec(
            `${javaExe} -jar "${path.resolve(instPath)}" --install-client "${path.resolve(P.mc)}"`,
            { timeout: 180000 },
            (e,o,se) => {
              const out = ((o||'')+(se||'')).trim();
              if (out) send('instance-log', { instanceId, line:`[NEOFORGE OUT] ${out.slice(0,800)}` });
              if(e) rej(new Error((se||o||e.message||'').slice(0,400))); else res(o);
            }
          ));
          if (fs.existsSync(versionsDir)) {
            const newDirs = fs.readdirSync(versionsDir);
            neoId = newDirs.find(d => d.toLowerCase().startsWith('neoforge-' + neoPrefix)) || newDirs.find(d => d.toLowerCase().startsWith(neoPrefixShort)) || null;
            if (neoId && !fs.existsSync(path.join(versionsDir, neoId, `${neoId}.json`))) neoId = null;
          }
          if (neoId) {
            versionObj.custom = neoId;
            send('launch-progress', { instanceId, percent:20, message:`NeoForge installed: ${neoId}` });
          } else {
            throw new Error('NeoForge installer ran but version directory not found');
          }
        } catch(ne) {
          console.error('NeoForge error:', ne);
          send('instance-log', { instanceId, line:`[NEOFORGE ERROR] ${ne.message}` });
          versionObj = { number: version, type: versionType };
        }
      }
    }

    // ── Forge ─────────────────────────────────────────────────────────────────
    if (modLoader === 'forge') {
      const versionsDir = path.join(P.mc, 'versions');
      let forgeId = null;

      if (fs.existsSync(versionsDir)) {
        const dirs = fs.readdirSync(versionsDir);
        forgeId = dirs.find(d => { const dl = d.toLowerCase(); return dl.includes('forge') && !dl.includes('neoforge') && d.includes(version); }) || null;
        if (forgeId && !fs.existsSync(path.join(versionsDir, forgeId, `${forgeId}.json`))) forgeId = null;
      }

      if (forgeId) {
        versionObj.custom = forgeId;
        send('launch-progress', { instanceId, percent:5, message:`Using Forge: ${forgeId}` });
      } else {
        send('launch-progress', { instanceId, percent:5, message:'Finding Forge version...' });
        try {
          // promotions_slim.json is the correct JSON endpoint for Forge versions
          const promos = await fetchJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
          const forgeShort = promos.promos[`${version}-recommended`] || promos.promos[`${version}-latest`];
          if (!forgeShort) throw new Error(`No Forge available for MC ${version}. Try a different MC version.`);

          const forgeFullVer = `${version}-${forgeShort}`;
          const mavenBase = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
          const installerUrl = `${mavenBase}/${forgeFullVer}/forge-${forgeFullVer}-installer.jar`;
          const installerPath = path.join(base, `forge-installer-${forgeFullVer}.jar`);

          if (!fs.existsSync(installerPath)) {
            send('launch-progress', { instanceId, percent:8, message:`Downloading Forge ${forgeFullVer}...` });
            await downloadFile(installerUrl, installerPath);
          }

          send('launch-progress', { instanceId, percent:15, message:'Installing Forge (this may take a minute)...' });
          const javaExe = quoteJava(resolvedJava);
          const absJava = path.resolve(resolvedJava);
          const absInstaller = path.resolve(installerPath);
          const absMc = path.resolve(P.mc);

          // Forge installer requires launcher_profiles.json to exist in target dir
          const launcherProfilesPath = path.join(absMc, 'launcher_profiles.json');
          if (!fs.existsSync(launcherProfilesPath)) {
            try {
              fs.writeFileSync(launcherProfilesPath, JSON.stringify({
                profiles: {},
                selectedProfile: '(Default)',
                clientToken: require('crypto').randomBytes(8).toString('hex')
              }));
              send('instance-log', { instanceId, line: '[FORGE] Created dummy launcher_profiles.json' });
            } catch(e) {
              send('instance-log', { instanceId, line: `[FORGE] Could not create launcher_profiles.json: ${e.message}` });
            }
          }

          // Forge installs to {cwd}/.minecraft/ — but our mc dir IS the .minecraft equivalent
          // So we set cwd to the parent of P.mc and rename if needed, OR
          // use the explicit path argument which Forge 1.17+ supports as the first positional arg
          let forgeInstallErr = null;
          const attempts = [
            // Modern Forge: first positional arg is the game dir
            { cmd: `${javaExe} -jar "${absInstaller}" --installClient "${absMc}"`, cwd: absMc },
            // Older style: no path arg, cwd is parent so Forge creates .minecraft there
            { cmd: `${javaExe} -jar "${absInstaller}" --installClient`, cwd: path.dirname(absMc) },
            // Fallback: cwd = absMc itself
            { cmd: `${javaExe} -jar "${absInstaller}" --installClient`, cwd: absMc },
          ];

          for (const attempt of attempts) {
            try {
              await new Promise((res,rej) => exec(attempt.cmd, {
                timeout: 300000,
                cwd: attempt.cwd,
                env: { ...process.env, JAVA_HOME: path.dirname(path.dirname(absJava)) }
              }, (e,o,se) => {
                const out = ((o||'')+(se||'')).trim();
                if (out) send('instance-log', { instanceId, line:`[FORGE OUT] ${out.slice(0,800)}` });
                if(e) rej(new Error(out.slice(0,400)||e.message)); else res(o);
              }));
              forgeInstallErr = null;
              break;
            } catch(tryErr) { forgeInstallErr = tryErr; }
          }

          // Also check if Forge installed into parent/.minecraft instead
          if (!forgeId || !fs.existsSync(path.join(versionsDir, forgeId||'', `${forgeId||''}.json`))) {
            const parentMcDir = path.join(path.dirname(absMc), '.minecraft');
            if (fs.existsSync(parentMcDir)) {
              const parentVersions = path.join(parentMcDir, 'versions');
              if (fs.existsSync(parentVersions)) {
                const pDirs = fs.readdirSync(parentVersions);
                const foundInParent = pDirs.find(d => { const dl = d.toLowerCase(); return dl.includes('forge') && !dl.includes('neoforge') && d.includes(version); });
                if (foundInParent) {
                  // Move from parent/.minecraft to our mc dir
                  send('instance-log', { instanceId, line:`[FORGE] Moving installed version from ${parentMcDir} to ${absMc}` });
                  try {
                    const src = path.join(parentVersions, foundInParent);
                    const dst = path.join(versionsDir, foundInParent);
                    await fs.promises.mkdir(dst, {recursive:true});
                    for (const f of fs.readdirSync(src)) fs.renameSync(path.join(src,f), path.join(dst,f));
                    forgeId = foundInParent;
                  } catch(mvErr) { send('instance-log', {instanceId, line:`[FORGE] Move failed: ${mvErr.message}`}); }
                }
              }
            }
          }

          if (forgeInstallErr) throw forgeInstallErr;

          if (fs.existsSync(versionsDir)) {
            const newDirs = fs.readdirSync(versionsDir);
            forgeId = newDirs.find(d => { const dl = d.toLowerCase(); return dl.includes('forge') && !dl.includes('neoforge') && d.includes(version); }) || null;
            if (forgeId && !fs.existsSync(path.join(versionsDir, forgeId, `${forgeId}.json`))) forgeId = null;
          }

          if (forgeId) {
            versionObj.custom = forgeId;
            send('launch-progress', { instanceId, percent:20, message:`Forge installed: ${forgeId}` });
          } else {
            throw new Error('Forge installer ran but version directory not found');
          }
        } catch(fe) {
          console.error('Forge error:', fe);
          send('instance-log', { instanceId, line:`[FORGE ERROR] ${fe.message}` });
          send('instance-log', { instanceId, line:`[FORGE] Falling back to vanilla launch` });
          send('launch-progress', { instanceId, percent:5, message:`Forge failed — launching vanilla` });
          versionObj = { number: version, type: versionType };
        }
      }
    }

    // ── Profile settings group (optional shared keybinds/settings) ────────────
    // Every profile has its own game dir. Only when a profile sets an explicit
    // group name, the group's options.txt is seeded into (and synced back from)
    // the instance so those profiles share keybinds/video settings.
    let settingsGroup = '';
    try {
      const profs = await load(P.profiles, []);
      const prof = profs.find(p => p.id === data.profileId);
      if (prof) {
        const g = effectiveDataGroup(prof);
        if (prof.group && String(prof.group).trim()) settingsGroup = g;
      }
    } catch {}
    if (settingsGroup) await applyGroupSettings(settingsGroup, gameDir);
    send('instance-log', { instanceId, line: settingsGroup ? `[GROUP] Shared settings group: "${settingsGroup}"` : `[INSTANCE] Eigener Spielordner: ${gameDir}` });

    // ── Deploy mrpack mods (modpack overrides) ────────────────────────────────
    if (mrpackMods && mrpackMods.length) {
      send('launch-progress', { instanceId, percent:22, message:`Deploying ${mrpackMods.length} modpack mods...` });
      const modsDir = path.join(gameDir, 'mods');
      await fs.promises.mkdir(modsDir, { recursive: true });
      let deployed = 0;
      for (const mod of mrpackMods) {
        if (mod.disabled) continue;
        try {
          if (mod.diskPath && fs.existsSync(mod.diskPath)) {
            const dest = path.join(modsDir, mod.fileName || `mod-${deployed}.jar`);
            if (!fs.existsSync(dest)) await fs.promises.copyFile(mod.diskPath, dest);
            deployed++;
          } else if (mod.data && mod.data.length) {
            const buf = Buffer.from(mod.data);
            const dest = path.join(modsDir, mod.fileName || `mod-${deployed}.jar`);
            if (!fs.existsSync(dest)) await fs.promises.writeFile(dest, buf);
            deployed++;
          } else if (mod.modrinthId) {
            const vd = await fetchJson(`https://api.modrinth.com/v2/project/${mod.modrinthId}/version`).catch(()=>null);
            if (vd && vd.length) {
              const file = vd[0].files?.find(f=>f.primary) || vd[0].files?.[0];
              if (file) {
                const destName = `${mod.modrinthId}-${file.filename}`;
                // Merken, damit der Eintrag nach dem Mods-Ordner-Cleanup aus
                // dem gleichen Cache-Eintrag wiederhergestellt werden kann.
                mod._cacheUrl = file.url;
                mod._cacheName = modrinthCacheName(mod.modrinthId, vd[0], file);
                mod._cacheDestName = destName;
                await deployModCachedOrDownload({
                  url: file.url,
                  cacheName: mod._cacheName,
                  dest: path.join(modsDir, destName),
                  label: mod.name || mod.modrinthId,
                  log: line => send('instance-log', { instanceId, line })
                });
                deployed++;
              }
            }
          }
        } catch(e) { send('instance-log', { instanceId, line:`[MODPACK] Failed ${mod.name}: ${e.message}` }); }
      }
      send('launch-progress', { instanceId, percent:30, message:`${deployed} modpack mods deployed.` });
    }

    // ── Deploy mods ────────────────────────────────────────────────────────────
    if (modLoader === 'fabric' || modLoader === 'forge' || modLoader === 'quilt' || modLoader === 'neoforge') {
      send('launch-progress', { instanceId, percent:22, message:'Preparing mods...' });

      const modsDir = path.join(gameDir, 'mods');
      await fs.promises.mkdir(modsDir, { recursive: true });

      const clientModsRaw  = (data.useClientMods !== false) ? (data.clientMods || []) : [];
      // WICHTIG: nicht data.profileMods verwenden — der Renderer kann einen
      // veralteten Stand haben. profileMods wurde oben aus profiles.json gelesen.
      const profileModsRaw = profileMods;
      const normalMods = clientModsRaw.filter(mod => mod.type !== 'jar');

      // Bereits bekannte Mixin-Crasher gar nicht erst deployen — das ist der
      // "immer automatisch" Teil: einmal erkannt, dauerhaft fuer MC/Loader aus.
      const broken = await brokenIdsFor(version, modLoader);
      if (broken.size) {
        const disableKnown = (m) => {
          if (!m || m.disabled || !modHasBrokenId(m, broken)) return false;
          m.disabled = true;
          send('instance-log', { instanceId, line:`[AUTO-FIX] ${m.name || m.modrinthId || 'Mod'} ist für MC ${version}/${modLoader} als Mixin-Crasher bekannt und bleibt deaktiviert.` });
          return true;
        };
        let profileChanged = false;
        let clientChanged = false;
        for (const m of profileModsRaw) profileChanged = disableKnown(m) || profileChanged;
        for (const m of clientModsRaw) clientChanged = disableKnown(m) || clientChanged;
        for (const m of (mrpackMods || [])) disableKnown(m);
        if (profileChanged) await persistProfileMods(profileId, profileModsRaw);
        if (clientChanged) {
          const mods = await load(P.mods, []);
          for (const m of mods) if (modHasBrokenId(m, broken)) m.disabled = true;
          await save(P.mods, mods);
        }
      }

      // Offline-Status vor dem Nachschlagen der Profil-Mods feststellen.
      const offline = !(await isNetworkAvailable());
      if (offline) {
        send('instance-log', { instanceId, line:'[OFFLINE] Keine Verbindung — überspringe Mod-Update-Prüfung, nutze gecachte Mods' });
      }

      // Aktive Profil-Mods ohne Quelle (z. B. aus dem KI-Plan) jetzt auflösen.
      // Was weder auf Modrinth noch CurseForge existiert, kann nicht starten und
      // wird deaktiviert, damit "aktiv" immer gleich "wird geladen" bedeutet.
      if (!offline && profileModsRaw.length) {
        await Promise.all(profileModsRaw
          .filter(m => !m.disabled && !m.modrinthId && !m.curseforgeId && !m.diskPath && !(m.data && m.data.length))
          .map(m => resolveProfileModIdentity(m, version, modLoader)));
        const fixes = await Promise.all(profileModsRaw
          .filter(m => !m.disabled)
          .map(m => ensureProfileModCompatible(m, version, modLoader,
            (line) => send('instance-log', { instanceId, line }))));
        const unresolved = profileModsRaw.filter(m =>
          !m.disabled && !m.modrinthId && !m.curseforgeId &&
          !(m.diskPath && fs.existsSync(m.diskPath)) && !(m.data && m.data.length));
        for (const m of unresolved) {
          m.disabled = true;
          m.unresolved = true;
          send('instance-log', { instanceId, line:`[AUTO-FIX] ${m.name} ist weder auf Modrinth noch CurseForge auffindbar und wurde deaktiviert.` });
        }
        if (fixes.some(f => f && (f.changed || f.disabled)) || unresolved.length) {
          await persistProfileMods(profileId, profileModsRaw);
        }
      }

      let toDeploy = [];
      for (const mod of normalMods) {
        if (mod.disabled) continue;
        if (mod.loader && mod.loader !== 'any' && mod.loader !== modLoader) continue;
        const vm = mod.downloadAllVersions || mod.mcVersion === version || mod.mcVersion === 'all' || mod.mcVersion === 'latest';
        if (!vm) continue;
        toDeploy.push(mod);
      }
      for (const mod of profileModsRaw) {
        if (mod.disabled) continue;
        if (mod.loader && mod.loader !== 'any' && mod.loader !== modLoader) continue;
        const duplicate = (mod.modrinthId && toDeploy.some(m => m.modrinthId === mod.modrinthId)) ||
          (mod.curseforgeId && toDeploy.some(m => m.curseforgeId === mod.curseforgeId));
        if (!duplicate) {
          mod._isProfileMod = true;
          toDeploy.push(mod);
        }
      }

      // Auto-add required Fabric dependencies when using Fabric or Quilt
      if (modLoader === 'fabric' || modLoader === 'quilt') {
        const fabricDeps = [
          { name:'Fabric API',               modrinthId:'P7dR8mSH', loader:'fabric' },
          { name:'Cloth Config',             modrinthId:'9s6osm5g', loader:'fabric' },
          { name:'Fabric Language Kotlin',   modrinthId:'Ha28R6CL', loader:'fabric' },
          { name:'YetAnotherConfigLib',      modrinthId:'1eAoo2KR', loader:'fabric' },
          { name:'TCDCommons',               modrinthId:'Eldc1g37', loader:'fabric' },
        ];
        for (const dep of fabricDeps) {
          if (!toDeploy.some(m => m.modrinthId === dep.modrinthId)) toDeploy.push(dep);
        }
      }

      const depCount = await addRequiredDependencies(toDeploy, version, modLoader, offline, broken);
      if (depCount) send('instance-log', { instanceId, line:`[MODS] ${depCount} erforderliche Abhängigkeit(en) der Profil-Mods hinzugefügt` });

      send('launch-progress', { instanceId, percent:23, message: offline ? 'Mods offline (gecacht)' : 'Checking for mod updates...' });

      // ── Pre-scan: check which mods have a version for this MC version ──────────
      const unavailableMods = new Set();
      const modDepInfo = new Map();
      const versionCache = new Map();
      const modsUpdated = [];

      const existingFiles = fs.existsSync(modsDir) ? fs.readdirSync(modsDir) : [];

      for (const mod of toDeploy) {
        if (offline) break;
        if (mod._isProfileMod) continue;
        if (!mod.modrinthId) continue;
        try {
          const gv = encodeURIComponent(`["${version}"]`);
          const ld = encodeURIComponent(`["${modLoader}"]`);
          let versions = await fetchJson(`https://api.modrinth.com/v2/project/${mod.modrinthId}/version?game_versions=${gv}&loaders=${ld}`);
          if (!versions || !versions.length) {
            send('instance-log', { instanceId, line:`[MODS] ${mod.name} — no ${modLoader} version for MC ${version}, scanning older ${modLoader} versions...` });
            const allV = await fetchJson(`https://api.modrinth.com/v2/project/${mod.modrinthId}/version`).catch(() => null);
            versions = (allV || []).filter(v => (v.game_versions || []).includes(version) && (v.loaders || []).includes(modLoader));
          }
          if (!versions || !versions.length) {
            unavailableMods.add(mod.modrinthId);
            send('instance-log', { instanceId, line:`[MODS] ${mod.name} — no ${modLoader} version supports MC ${version}, disabled` });
            continue;
          }
          const latestVer = versions[0];
          const deps = latestVer.dependencies || [];
          modDepInfo.set(mod.modrinthId, deps);
          versionCache.set(mod.modrinthId, latestVer);

          // Auto-update: check if newer version is available or download URL changed
          const latestFile = latestVer.files.find(f => f.primary) || latestVer.files[0];
          const storedVersion = mod.version || '';
          const latestVersionName = latestVer.version_number || latestVer.id || '';
          const storedUrl = mod.downloadUrl || '';
          const latestUrl = latestFile ? latestFile.url : '';

          if (storedVersion && (latestVersionName !== storedVersion || (storedUrl && latestUrl && storedUrl !== latestUrl))) {
            // Delete old jar(s) for this mod so it re-downloads
            const oldJars = existingFiles.filter(f => f.startsWith(mod.modrinthId + '-') && f.endsWith('.jar'));
            for (const oldJar of oldJars) {
              try { fs.unlinkSync(path.join(modsDir, oldJar)); } catch {}
            }
            // Update stored version
            mod.version = latestVersionName;
            mod.downloadUrl = latestUrl;
            modsUpdated.push({ modrinthId: mod.modrinthId, version: latestVersionName, downloadUrl: latestUrl });
            send('instance-log', { instanceId, line:`[MODS] ${mod.name} — updated: ${storedVersion} → ${latestVersionName}` });
            // Refresh existingFiles since we deleted jars
            existingFiles.length = 0;
            existingFiles.push(...fs.readdirSync(modsDir).filter(f => f.endsWith('.jar')));
          }
        } catch(e) {
          send('instance-log', { instanceId, line:`[MODS] Failed to check ${mod.name}: ${e.message}` });
          unavailableMods.add(mod.modrinthId);
        }
      }

      // Resolve transitive dependency failures
      let changed = true;
      while (changed) {
        changed = false;
        for (const [modId, deps] of modDepInfo) {
          if (unavailableMods.has(modId)) continue;
          for (const dep of deps) {
            if (dep.dependency_type === 'required' && unavailableMods.has(dep.project_id)) {
              unavailableMods.add(modId);
              const m = toDeploy.find(x => x.modrinthId === modId);
              send('instance-log', { instanceId, line:`[MODS] ${m ? m.name : modId} — disabled because a required mod is unavailable` });
              changed = true;
              break;
            }
          }
        }
      }

      // Remove unavailable mods from toDeploy (temporary — not saved)
      toDeploy = toDeploy.filter(mod => !unavailableMods.has(mod.modrinthId));

      // ── Clean mods folder: remove ALL old JARs to ensure per-profile isolation ─────
      // (Skipped in offline mode so cached mods survive without an internet connection.)
      if (offline) {
        send('instance-log', { instanceId, line:'[OFFLINE] Mods-Ordner wird nicht bereinigt — vorhandene JARs bleiben erhalten' });
      } else {
        const existingJars = fs.readdirSync(modsDir).filter(f => f.endsWith('.jar'));
        for (const jar of existingJars) {
          try { fs.unlinkSync(path.join(modsDir, jar)); } catch {}
        }
      }

      // Re-deploy mrpack mods (they were wiped by the cleanup above)
      if (mrpackMods && mrpackMods.length) {
        for (const mod of mrpackMods) {
          try {
            if (mod.diskPath && fs.existsSync(mod.diskPath)) {
              const dest = path.join(modsDir, mod.fileName || `mod-${(mod.name||'unknown').replace(/[^a-zA-Z0-9._-]/g,'_')}.jar`);
              if (!fs.existsSync(dest)) await fs.promises.copyFile(mod.diskPath, dest);
            } else if (mod.data && mod.data.length) {
              const buf = Buffer.from(mod.data);
              const dest = path.join(modsDir, mod.fileName || `mod-${(mod.name||'unknown').replace(/[^a-zA-Z0-9._-]/g,'_')}.jar`);
              if (!fs.existsSync(dest)) await fs.promises.writeFile(dest, buf);
            } else if (mod.modrinthId && mod._cacheUrl && mod._cacheName) {
              const dest = path.join(modsDir, mod._cacheDestName || `${mod.modrinthId}-mod.jar`);
              await deployModCachedOrDownload({
                url: mod._cacheUrl,
                cacheName: mod._cacheName,
                dest,
                label: mod.name || mod.modrinthId,
                log: line => send('instance-log', { instanceId, line })
              });
            }
          } catch(e) { send('instance-log', { instanceId, line:`[MODPACK] Re-deploy failed ${mod.name}: ${e.message}` }); }
        }
      }

      // ── Deploy Crux Client mod (fresh from GitHub on every start) ─────────────
      if (useCruxClientMod && (modLoader === 'fabric' || modLoader === 'quilt')) {
        clearTimeout(safetyTimer);
        const crux = await ensureCruxClientMod(version, send, instanceId);
        safetyTimer = setTimeout(fireSafetyTimeout, 5 * 60 * 1000);
        if (crux) {
          await deployCruxMod(modsDir, crux);
          send('instance-log', { instanceId, line:`[CRUX-MOD] Deployed Crux Client Features (${crux.name}) to mods folder.` });
        }
      }

      // Refresh existingFiles after cleanup + mrpack redeploy
      existingFiles.length = 0;
      existingFiles.push(...fs.readdirSync(modsDir).filter(f => f.endsWith('.jar')));

      // First pass: count already-downloaded mods
      let needsDownload = 0;
      for (const mod of toDeploy) {
        if (!mod.modrinthId && !mod.curseforgeId) continue;
        if (!modHasJar(mod, existingFiles)) needsDownload++;
      }

      if (needsDownload === 0) {
        send('launch-progress', { instanceId, percent:45, message:`${toDeploy.length} mods ready.` });
      } else {
        send('launch-progress', { instanceId, percent:24, message:`Mods vorbereiten: ${needsDownload}/${toDeploy.length} (Cache wird geprüft)...` });
      }

      let deployed = 0;
      const totalDeploy = toDeploy.length;
      for (const mod of toDeploy) {
        // CurseForge-Mod: Jar ueber cfwidget + Forge-CDN holen
        if (!mod.modrinthId && mod.curseforgeId) {
          if (offline) {
            if (modHasJar(mod, existingFiles)) deployed++;
            else send('instance-log', { instanceId, line:`[OFFLINE] ${mod.name} (CurseForge) ist nicht gecacht` });
          } else if (await deployCurseforgeMod(mod, modsDir, version, modLoader, (line) => send('instance-log', { instanceId, line }))) {
            deployed++;
          }
          continue;
        }
        // Local mod from disk (no download id) — copy the jar directly
        if (!mod.modrinthId) {
          try {
            if (mod.diskPath && fs.existsSync(mod.diskPath)) {
              const dest = path.join(modsDir, mod.fileName || (String(mod.name||'mod').replace(/[^a-zA-Z0-9._-]/g,'_') + '.jar'));
              if (!fs.existsSync(dest)) await fs.promises.copyFile(mod.diskPath, dest);
              deployed++;
            }
          } catch(e) { send('instance-log', { instanceId, line:`[MODS] Failed to copy local mod ${mod.name}: ${e.message}` }); }
          continue;
        }
        // Ein Eintrag kann beide Quellen haben (z. B. CurseForge-Name mit
        // Modrinth-Icon). Wenn Modrinth keine passende Datei hat, muss die
        // CurseForge-Version her - sonst fehlt ein aktiver Profil-Mod.
        const tryCurseforgeFallback = async () => {
          if (offline || !mod.curseforgeId || mod._cfFallbackTried) return false;
          mod._cfFallbackTried = true;
          return await deployCurseforgeMod(mod, modsDir, version, modLoader,
            (line) => send('instance-log', { instanceId, line }));
        };
        try {
          const hasJar = modHasJar(mod, existingFiles);
          if (hasJar) { deployed++; continue; }
          if (offline) {
            send('instance-log', { instanceId, line:`[OFFLINE] ${mod.name} ist nicht gecacht` });
            continue;
          }

          const cached = versionCache.get(mod.modrinthId);
          let versionData = cached;
          if (!versionData) {
            const allVersions = await fetchJson(`https://api.modrinth.com/v2/project/${mod.modrinthId}/version`).catch(() => null);
            if (!allVersions || !allVersions.length) {
              if (await tryCurseforgeFallback()) deployed++;
              continue;
            }
            // Pick the newest version that supports this MC version AND the profile's mod loader.
            // Deploying a wrong-loader jar (e.g. a NeoForge build into a Fabric profile) makes
            // Fabric Loader crash at startup on an unparseable fabric.mod.json.
            versionData = allVersions.find(v => (v.game_versions || []).includes(version) && (v.loaders || []).includes(modLoader));
            if (!versionData) {
              send('instance-log', { instanceId, line:`[MODS] ${mod.name} — no ${modLoader} version supports MC ${version}, trying CurseForge` });
              if (await tryCurseforgeFallback()) deployed++;
              continue;
            }
          }
          if (!versionData) continue;

          const file = versionData.files.find(f => f.primary) || versionData.files[0];
          if (!file) {
            if (await tryCurseforgeFallback()) deployed++;
            continue;
          }

          const jarPath = path.join(modsDir, `${mod.modrinthId}-${file.filename}`);
          const cacheSource = await deployModCachedOrDownload({
            url: file.url,
            cacheName: modrinthCacheName(mod.modrinthId, versionData, file),
            dest: jarPath,
            label: mod.name || mod.modrinthId,
            log: line => send('instance-log', { instanceId, line })
          });
          deployed++;
          send('launch-progress', { instanceId, percent:Math.min(45,24+Math.round(deployed/totalDeploy*21)), message:`${cacheSource==='cache'?'Aus Cache':'Downloaded'}: ${mod.name}` });
        } catch(e) {
          send('instance-log', { instanceId, line:`[MODS] Failed ${mod.name}: ${e.message}` });
          if (await tryCurseforgeFallback()) deployed++;
        }
      }
      if (needsDownload > 0) {
        send('launch-progress', { instanceId, percent:45, message:`${deployed} mods ready.` });
      }
      // Save updated mod versions back to client
      if (modsUpdated.length) {
        send('launch-progress', { instanceId, percent:46, message:`Updated ${modsUpdated.length} mod(s)...` });
        send('mods-updated', modsUpdated);
      }
    }

    // ── Auto-Fix: defekte Mixin-Mods entfernen, bevor Fabric sie laedt ────────
    try {
      await autoFixBrokenMixinMods(path.join(gameDir, 'mods'), send, instanceId, profileId, profileMods, clientMods, mrpackMods, version, modLoader);
    } catch (e){
      send('instance-log', { instanceId, line:`[AUTO-FIX] Mixin-Pruefung fehlgeschlagen: ${e.message}` });
    }

    // ── Deploy mrpack resource packs ──────────────────────────────────────────
    let mrpackDeployedNames = [];
    if (mrpackRPs && mrpackRPs.length) {
      const rpDir = path.join(gameDir, 'resourcepacks');
      await fs.promises.mkdir(rpDir, { recursive: true });
      for (const rp of mrpackRPs) {
        try {
          const packName = rp.name || rp.fileName || `rp-${Date.now()}`;
          let deployedName = null;
          if (rp.diskPath && fs.existsSync(rp.diskPath)) {
            const dest = path.join(rpDir, rp.fileName || `rp-${Date.now()}.zip`);
            if (!fs.existsSync(dest)) await fs.promises.copyFile(rp.diskPath, dest);
            deployedName = await deployResourcePack({ rpDir, version, packName, tempDest: dest });
          } else if (rp.data && rp.data.length) {
            const buf = Buffer.from(rp.data);
            const dest = path.join(rpDir, rp.fileName || `rp-${Date.now()}.zip`);
            if (!fs.existsSync(dest)) await fs.promises.writeFile(dest, buf);
            deployedName = await deployResourcePack({ rpDir, version, packName, tempDest: dest });
          }
          if (deployedName) mrpackDeployedNames.push(deployedName);
        } catch {}
      }
      if (mrpackDeployedNames.length) {
        send('instance-log', { instanceId, line:`[RP] Deployed ${mrpackDeployedNames.length} mrpack resource pack(s).` });
      }
    }

    // ── Deploy resource packs (all loaders, including vanilla) ─────────────
    const profileRPs = (profileResourcePacks || []).filter(rp => {
      const v = (rp && typeof rp === 'object') ? (rp.mcVersion || 'all') : 'all';
      if (rp && typeof rp === 'object' && rp.disabled) return false;
      return v === 'all' || v === version;
    });
    const clientRPs = (data.clientResourcePacks || []).filter(rp =>
      !(rp && typeof rp === 'object' && rp.disabled));
    const rpList = [...((data.useClientRPs !== false) ? clientRPs : []), ...profileRPs];

    // Reset ALL resource packs first, then the launcher re-enables the needed ones.
    // This prevents leftover packs from other profiles/groups staying enabled in-game.
    {
      const optionsPath = path.join(gameDir, 'options.txt');
      let options = '';
      if (fs.existsSync(optionsPath)) options = await fs.promises.readFile(optionsPath, 'utf8');
      if (options.match(/^resourcePacks:/m)) {
        options = options.replace(/^resourcePacks:.*$/m, 'resourcePacks:["vanilla"]');
      } else {
        options += `\nresourcePacks:["vanilla"]`;
      }
      if (options.match(/^incompatibleResourcePacks:/m)) {
        options = options.replace(/^incompatibleResourcePacks:.*$/m, 'incompatibleResourcePacks:[]');
      } else {
        options += `\nincompatibleResourcePacks:[]`;
      }
      await fs.promises.writeFile(optionsPath, options);
      send('instance-log', { instanceId, line: `[RP] Reset resource packs to ["vanilla"]` });
    }

    if (rpList.length || mrpackDeployedNames.length) {
      const rpDir = path.join(gameDir, 'resourcepacks');
      await fs.promises.mkdir(rpDir, { recursive: true });

      const deployedRpNames = [];

      for (const rp of rpList) {
        try {
          let downloadUrl = null, fname = null, packName = null;
          const rpStr = (rp && typeof rp === 'object') ? (rp.name || '') : rp;
          if (typeof rp === 'object' && rp.modrinthId) {
            const vd = await fetchJson(`https://api.modrinth.com/v2/project/${rp.modrinthId}/version`).catch(() => null);
            if (vd && vd.length) {
              let chosen = vd[0];
              if (version) chosen = vd.find(v => v.game_versions && v.game_versions.includes(version)) || vd[0];
              const file = chosen.files?.find(f => f.primary) || chosen.files?.[0];
              if (file) { downloadUrl = file.url; fname = file.filename; }
            }
            if (!downloadUrl) {
              send('instance-log', { instanceId, line:`[RP] Failed to fetch download for ${rp.name || rp.modrinthId}` });
              continue;
            }
            packName = rp.name || fname;
          } else if (typeof rpStr === 'string' && rpStr.startsWith('file://')) {
            const srcPath = rpStr.slice('file://'.length);
            const srcName = path.basename(srcPath);
            try {
              if (fs.existsSync(srcPath)) {
                await fs.promises.copyFile(srcPath, path.join(rpDir, srcName));
                deployedRpNames.push(srcName);
                send('instance-log', { instanceId, line:`[RP] Copied local pack: ${srcName}` });
              } else {
                send('instance-log', { instanceId, line:`[RP] Local pack not found: ${srcPath}` });
              }
            } catch(e){ send('instance-log', { instanceId, line:`[RP] Failed to copy local pack: ${e.message}` }); }
            continue;
          } else if (typeof rpStr === 'string' && (rpStr.startsWith('http://') || rpStr.startsWith('https://'))) {
            downloadUrl = rpStr;
            fname = path.basename(rpStr.split('?')[0]) || `rp-${Date.now()}.zip`;
            packName = fname;
          } else {
            const name = typeof rp === 'object' ? rp.name : rp;
            const candidates = fs.readdirSync(rpDir).filter(f =>
              f.toLowerCase().startsWith(name.toLowerCase().replace(/\.zip$/i,''))
            );
            if (candidates.length) { deployedRpNames.push(candidates[0]); }
            else { deployedRpNames.push(name.endsWith('.zip') ? name : name + '.zip'); }
            continue;
          }
          const dest = path.join(rpDir, fname);
          const finalName = await deployResourcePack({
            rpDir, version, packName, tempDest: dest, downloadUrl,
            onDownload: () => send('launch-progress', { instanceId, percent:47, message:`Downloading RP: ${fname}` })
          });
          if (finalName) deployedRpNames.push(finalName);
        } catch(e) { send('instance-log', { instanceId, line:`[RP] Failed: ${e.message}` }); }
      }

      if (deployedRpNames.length || mrpackDeployedNames.length) {
        const optionsPath = path.join(gameDir, 'options.txt');
        let options = '';
        if (fs.existsSync(optionsPath)) options = await fs.promises.readFile(optionsPath, 'utf8');

        const allRpNames = [...new Set([...mrpackDeployedNames, ...deployedRpNames])];
        const rpEntries = allRpNames.map(n => {
          if (n.startsWith('file/') || n === 'vanilla') return `"${n}"`;
          return `"file/${n}"`;
        });
        const rpEntry = `["vanilla",${rpEntries.join(',')}]`;

        const existingLine = options.match(/^resourcePacks:(.*)$/m)?.[1] || '(none)';
        send('instance-log', { instanceId, line: `[RP] options.txt existing: resourcePacks:${existingLine}` });

        if (options.match(/^resourcePacks:/m)) {
          options = options.replace(/^resourcePacks:.*$/m, `resourcePacks:${rpEntry}`);
        } else {
          options += `\nresourcePacks:${rpEntry}`;
        }
        if (options.match(/^incompatibleResourcePacks:/m)) {
          options = options.replace(/^incompatibleResourcePacks:.*$/m, `incompatibleResourcePacks:[]`);
        } else {
          options += `\nincompatibleResourcePacks:[]`;
        }

        await fs.promises.writeFile(optionsPath, options);
        send('instance-log', { instanceId, line: `[RP] Written to ${optionsPath}: resourcePacks:${rpEntry}` });
      }

      send('launch-progress', { instanceId, percent:50, message:`${new Set([...mrpackDeployedNames, ...deployedRpNames]).size} resource pack(s) activated.` });
    }
    // When no packs are configured, the reset to ["vanilla"] above stays active.

    // ── Deploy custom cape resource pack ──────────────────────────────────────
    try {
      const capeRpDeployed = await deployCustomCapeRp(path.join(gameDir, 'options.txt'), gameDir);
      if (capeRpDeployed) {
        send('instance-log', { instanceId, line: '[Cape] Custom cape resource pack deployed.' });
        send('launch-progress', { instanceId, percent:51, message:'Custom cape resource pack activated.' });
      }
    } catch(e) { send('instance-log', { instanceId, line: `[Cape] Deploy failed: ${e.message}` }); }

    // ── Original launcher ───────────────────────────────────────────────────────
    if (useOriginalLauncher) {
      const pf = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      const pf64 = process.env.ProgramFiles || 'C:\\Program Files';
      const localAppData = process.env.LOCALAPPDATA || '';
      const appData = process.env.APPDATA || '';
      const systemDrive = process.env.SystemDrive || 'C:';
      const exePaths = [
        path.join(pf, 'Minecraft Launcher', 'MinecraftLauncher.exe'),
        path.join(pf64, 'Minecraft Launcher', 'MinecraftLauncher.exe'),
        path.join(appData, '.minecraft', 'launcher', 'minecraft-launcher.exe'),
        path.join(appData, '.minecraft', 'launcher', 'launcher.exe'),
        path.join(localAppData, 'Packages', 'Microsoft.4297127D64EC6_8wekyb3d8bbwe', 'LocalCache', 'Local', 'MinecraftLauncher', 'minecraftlauncher.exe'),
        path.join(localAppData, 'MinecraftLauncher', 'MinecraftLauncher.exe'),
        path.join(systemDrive, 'XboxGames', 'Minecraft Launcher', 'Content', 'Minecraft.exe'),
      ];
      const exe = exePaths.find(p => fs.existsSync(p));
      if (!exe) {
        shell.openExternal('ms-windows-store://pdp/?productid=9PGW19NPB5B5');
        send('launch-status', 'Minecraft Launcher not installed. Opening Microsoft Store...');
        send('launch-progress', { instanceId, percent:100, message:'Install the Minecraft Launcher from the Store', done:true });
        send('instance-closed', { instanceId, code:0 });
        delete instances[instanceId];
        clearTimeout(safetyTimer);
        return;
      }
      // Write launcher_profiles.json into the DEFAULT .minecraft directory so the official launcher sees it
      const defaultMcDir = path.join(process.env.APPDATA || '', '.minecraft');
      const profilesPath = path.join(defaultMcDir, 'launcher_profiles.json');
      let originalProfiles = null;
      let deployedMods = [];
      let profileKey;
      try {
        originalProfiles = await fs.promises.readFile(profilesPath, 'utf8');
      } catch {}

      // Copy mod loader version to official launcher's versions dir so mods work
      let customVer = version;
      if (versionObj && versionObj.custom) {
        const srcVer = path.join(P.mc, 'versions', versionObj.custom);
        const dstVer = path.join(defaultMcDir, 'versions', versionObj.custom);
        if (fs.existsSync(srcVer) && !fs.existsSync(dstVer)) {
          try {
            const copyDir = async (s, d) => {
              await fs.promises.mkdir(d, { recursive: true });
              for (const item of await fs.promises.readdir(s)) {
                const sp = path.join(s, item);
                const dp = path.join(d, item);
                const stat = await fs.promises.stat(sp);
                if (stat.isDirectory()) await copyDir(sp, dp);
                else await fs.promises.copyFile(sp, dp);
              }
            };
            await copyDir(srcVer, dstVer);
            send('instance-log', { instanceId, line: `[LAUNCHER] Copied ${versionObj.custom} to official launcher` });
            customVer = versionObj.custom;
          } catch (copyErr) {
            send('instance-log', { instanceId, line: `[LAUNCHER] Copy failed: ${copyErr.message}` });
          }
        } else if (fs.existsSync(srcVer) && fs.existsSync(dstVer)) {
          customVer = versionObj.custom;
        }
        // The official launcher needs a JAR in the version directory (copy of base Minecraft JAR)
        const versionJar = path.join(dstVer, `${versionObj.custom}.jar`);
        const baseJar = path.join(defaultMcDir, 'versions', version, `${version}.jar`);
        if (!fs.existsSync(versionJar) && fs.existsSync(baseJar)) {
          try {
            fs.copyFileSync(baseJar, versionJar);
            send('instance-log', { instanceId, line: `[LAUNCHER] Copied base JAR as ${versionObj.custom}.jar` });
          } catch (jarErr) {
            send('instance-log', { instanceId, line: `[LAUNCHER] Copy JAR failed: ${jarErr.message}` });
          }
        }
        // Also ensure the fabric-loader library exists in the official launcher's libraries dir
        const match = versionObj.custom.match(/^fabric-loader-(\d+\.\d+(?:\.\d+)?)/);
        if (match) {
          const loaderVer = match[1];
          const libDir = path.join(defaultMcDir, 'libraries', 'net', 'fabricmc', 'fabric-loader', loaderVer);
          const libJar = path.join(libDir, `fabric-loader-${loaderVer}.jar`);
          if (!fs.existsSync(libJar)) {
            try {
              await fs.promises.mkdir(libDir, { recursive: true });
              const https = require('https');
              const mavenUrl = `https://maven.fabricmc.net/net/fabricmc/fabric-loader/${loaderVer}/fabric-loader-${loaderVer}.jar`;
              await new Promise((resolve, reject) => {
                const file = fs.createWriteStream(libJar);
                https.get(mavenUrl, (resp) => {
                  if (resp.statusCode !== 200) { reject(new Error(`HTTP ${resp.statusCode}`)); return; }
                  resp.pipe(file);
                  file.on('finish', () => { file.close(); resolve(); });
                }).on('error', reject);
              });
              send('instance-log', { instanceId, line: `[LAUNCHER] Downloaded fabric-loader-${loaderVer}.jar` });
            } catch (dlErr) {
              send('instance-log', { instanceId, line: `[LAUNCHER] Download fabric-loader failed: ${dlErr.message}` });
            }
          }
        }
      }

      try {
        profileKey = require('crypto').createHash('md5').update('mc-launcher-' + version + (modLoader||'')).digest('hex');
        let existing = null;
        try { existing = JSON.parse(await fs.promises.readFile(profilesPath,'utf8')); } catch {} 
        const data2 = existing && existing.profiles ? existing : {
          profiles: {},
          clientToken: require('crypto').randomBytes(8).toString('hex'),
          settings: { enableSnapshots: false, enableReleases: true, keepLauncherOpen: true, showGameLog: false },
          version: 6
        };
        // Deploy mods to official launcher's mods dir (so mods load without gameDir override)
        const officialModsDir = path.join(defaultMcDir, 'mods');
        const coreModsDir = path.join(gameDir, 'mods');
        const deployedMods = [];
        if (fs.existsSync(coreModsDir)) {
          try {
            // Clean entire official mods dir first (remove stale mods from previous versions)
            if (fs.existsSync(officialModsDir)) {
              for (const f of fs.readdirSync(officialModsDir)) {
                try { fs.unlinkSync(path.join(officialModsDir, f)); } catch {}
              }
            }
            await fs.promises.mkdir(officialModsDir, { recursive: true });
            for (const f of fs.readdirSync(coreModsDir)) {
              if (f.endsWith('.jar')) {
                const src = path.join(coreModsDir, f);
                const dst = path.join(officialModsDir, f);
                fs.copyFileSync(src, dst);
                deployedMods.push(f);
              }
            }
            if (deployedMods.length > 0) send('instance-log', { instanceId, line: `[LAUNCHER] Deployed ${deployedMods.length} mods to official launcher` });
          } catch (modErr) {
            send('instance-log', { instanceId, line: `[LAUNCHER] Deploy mods failed: ${modErr.message}` });
          }
        }
        data2.profiles[profileKey] = {
          name: `Crux Client (${version}${modLoader!=='vanilla'?' '+modLoader:''})`,
          type: 'custom',
          created: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          icon: (() => { try { const b=fs.readFileSync(path.join(__dirname,'icons','profile-icon-base64.txt'),'utf8'); return b.trim(); } catch { return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAASvUlEQVR4AeXBfYxl933X8ffne865d+7cmZ1Z73rjdWJFfto0jWsTi7gCAU3/IIRGeSChtAiKhFpABqEqIkH8USHUqkpLpajiQQHSkkqIqsQOrdu0UhsnapwH16ljx67tpPF617ve5+zOzu7MfTzn/D7Mmeu7Mzu+O7sOlH/8egkwb2DBG1zwBhe8wQVvcDmvU561yPM5QICxTSOlCjAT4jUEmKuJLQYEmA1mk8RrGBBgJsSrRF2PSani9ch5nbKsTatYQBK2MQkMVT3CrgHxf88YEBvEBgFmQswm7JqUKl6P4HUzYoMNmKuJ/xeMAXOFDQbMBoMNZpMQDfH9ybkBedZirr1MQwqMwWDMlDF2AoEQIKY6nTYgGikltpgJsZNtUqpJNgLMhFMi2YSClhZBiVG9jgV53iHP5wBRjtepU8X15FxHREaWtYjIANGQAQtIWImGMGaDAXGFgO/++XPsvWkvV5jZxFWcjG3AgEDwK7/ySX7+53+RhgCbCRvEJgGKHDlhJ3aTs4si71AU84QyGiZR12Num3uAu7o/yvHBE7y4/kUmjCR2MhskhLhC3BCFmDAgGgrRSK4Z1KtMiE4s85bOA/Tqc5waPk1EILVJdUmdKq4l2EVERp61iMiYshMtddmT3Uo7FgEDZkKAKIqCosgpipw8zxDbmQnzWgYMGDBgwGwnBIid5rOb+YH593Jb+wFsIwUROYpgNwLMDpJotItFWq0FwGS0ADOsLpPRpogOlYeUqc/VxKlTR9izuIdGWZYURY4UlFXJiRMnmBAIBJhXGRBgM2Xgpr17WV5apjEY9On3BzQeevhzfPSjH0fKmItlbm3fS7++wOnRsyiCRl2PqKox15Izw1x7mSKfY4t4YPFnsMxXV36VmhF1GmGbWYSQRKPVanGFoaoqJLFJYpMBAQYEmA3GbDA4GTAgOp15Op15GgsLXSbMsL7Ikf6XMWZKEnk+R57PkVLFeNxnp5wZxHamsV5/D5NAwslcYUC8SkggiQmzkwHREFsMFohtBBgExkyYCbHFgLEAm4YkbpQAs8Pc3DJF1sYkJgLREMk1VTVEEts9+8yT3HLLm2h0u/OAGA6HnDx1EkkgsXb5Mr//B39ASKytr/OZz/wGm2xuv+N2/vZ734uZsE3DKfHO++/nnne8g8bSniX27bsJEFVVMRoNAfGFRx/lJ//+P0QKQhlSAMaYRkoV43GfnXJ2YbPBSAkIpiSx03x3nm63y3a2qeoaSUiirCqGwyGhoNfrce7sOab2LC3R6/WQxIQwxjZlWZJSopFsJkye5+T5Ao25uTkwIIjIkHJMwqlkNzkz1PUYnEDiQOvtJCrOj14EzDXZTJgJMSVACCEaxogNYoPAIImIoGEmZDaFhCTMLAYEmKoekdGCjA0Gm+vJmcVmk+FQ529RM+L86EV2euaZb9DpdMBw4MABJsTJUycZj0vsxLlz53jqm99EEZw/f55Pfeq/0EgpgeHemz7IKK1x5OXH+G+f/jUaAoyZevHwYQ6/9BK2eduhQ9x33300FhYW2L9vH1O2aaRUg2puRM5MYurE8E+pqdhJEgdvOUi322Wnqq4pq5JGXVWsr68TWcba2horKytMieCBm3+CS+UpvrP6KCsrK8xy6dIl1i5fxobhcEhZloCo68SUbaaMEeJG5FzHy8OvMSUyGskVyTXGTJgJMSUmJCGJ7fJ8DhFg0+3MU+VdimyejAIkwNgGzLheIxQgwKYhCbOd+X7lXJPYTgghGrYBs92Zs2cpy5LGt55+ivX1dUAcOXqU3/nt3waJ4XBIQ4g8CpbbB5nLO1TsYX/nrVwangOMAQlEQzz/wvOcPXeWxpkzZ+j3+9im1W4z3+kgiaeeeopNNkJktChiHrtmVPfAYpacWcRrGGNqJhIpVUgCTGM0GjEuSxqXL6+xtrYGEqdPn+ZbzzzLdsk187HMv7n/j4gskMzP7vktfu5rP0yjpS5gEJtOnz7D6dNnaOxZXOSWW27BgG0aAl46coQtIlTQUpeakrH7YDFLzg2yE8kV//E//Cr33PMOQkG73QbETgZsI0CIRkROKGNKElkeKCAiyFNgG7EhTHICm4gCMI06lYBoCCGBzSZJXMVgzPXk7CLIaSRqjEmpZnl5mZv378eG8WhMndU0Vi+tMhqOMPDkk09y9sxZFOLUqVM0QhlZVtBIqQJMKIgACRQCDBLGWAlsInImTEolJ06c4Gtf/zpXmA1m5eJFGmaDoWLEWnkGZAggmVlydpHRRkBJH6dEXVfMdzosLixim5OnTpJsGs8+8yz9fh8kPv97n+fY8eNczdhmQkhBlonIZEMCKQMSZRogBUKAmTJw7Phxjh0/zoTZIiaMMbjCmIYQYGYJdiNjzCaBgDzPKYqCVqsFCAFii9ggIURERkRGRAaICXOgdTeHFt9NKAiCICg0x6GFd7OY3wIYSJjEhAETypACMSUaUhCR0SrmyaIFGJMAs0lgMVOwi9J9SvoYI7YTILrz83Tnu3Tnu0QEBsyrJLIoyKJFFi2kwCRSMvfv/TB/582/SDvPaWUZ7SynG0t86OC/57a5dwKBnTAGTMOYyHKyrIUUbBGhnDxrIwlJBBlBznZitpwZ7ISpmRANY4zZbq7dYcJkWYYAscVOgJgQWHzgwC9xa+seynLMoTuXUAjbDEeJF14cc9+eH2e59RYeX/l17IR5lcRURIFITIUyGrYBc0fnbzKf7eXZ3me5npwbYrYYMCAmDIivP/44rxw/gUKsr/UIZWRq8aNv/mdgERJSxj1Lf4UD+/awMFdAJAghQe7EnXctsXftbvb3luh25jEJAxI8d/EPOds/DBgkcAAG8SoDojFIF6jcAwnRECBmybkmIYQITMKuaKRkUjJgIgSIxlce+xrffv67dIv9ZFrgpvYSRczx3lv/FVKQRRCI+bmC2+4U812wahCb8hb8pXv3ceHcPs6cuIs7Fx4gKZFskBhUa4zrEckVKZlRusworSMmDAgD4sToSZCQAiSEADFLzgwSm3J1yGhReUTpEY3eep+1y+s09iwtIgFigzg4dw8//pb/zFJnmVZW0MoLbJDYYCSBACUIY4QxQoBBbLLBmGRjElh88K3/lve/5eco65rVtUt89cJ/5RurnyGyjJQqcAIFYEBgExFMCDFbzkxiSggBkmhkWSCJCbPJApnz45f43dP/k0wZRd4iV5t/dPd/opEsjBlXIiEsNhhJgAGDoU6mqo0xYGzT+MrZX+Pw6p9Qu6aqKlbK40hCEhEZtsGgyBANMSF2kzODU8Ikxu5TMsAkMFsEGMbjCgls+MG3v52Fbhd7xPPPf5v11R6tmOObFz4HCCEkcefCXyW90mZhoc0dty2DAEFZ1Rw5dp7VS2POXrrMqcFzpJRIJBA8c/73Od57hoYkpEASIKQADBhJCLGTmS3nGmw2JMyEMVMCLBgMBmA2ve99P0avt44kPvGJX2Z9fY3SI37ryMcxIDZY/MStn+KV8zcx39rD7bctgUHAaFzy2De+Q/KI0+Pn+NL5T2ISxjSEaCiCLMvZThIgTOL1yrlRZouEbISw2EaYDWKTEA0BxiDz8Omf5b6lD/NDy+/n8S+PUQgJxtWIoS7xpyv/g2ODb5Bcs0lch7EFGIkrfmD+A3SyZV4afonL5UmuJecGCdEYj8cMBgMaraIFYoMAA0YIIYyxE42IHGFsU3vM8f6TJMYc2vsuZIGg8oinVz/L98oXSZRIYkoSUtCQxGsZO1FXJVneRhK5CoIMzK5yZjAgYDG7lUJtVsqXmaqqinJc0mgVLYRo/NA77qWuExL8+qc/DYJev8+HPvRhwEgBGFPzvfFhSvrUqUIKJDGu+hxe/2NM4goJAVKgCBof+fCH+NjHPkqn00Fs+fJjj/Hgg/+CcI0VnBw/Ta6CYbrIhJklZxYDMmBASGCzSRIKgQEBAgwLC4sIguDuQ3cxP9+h1++DIKWaCKEIZJFSTXLFsBwiCSGG9YjkGklMhQJFIBoCzB133M59994LGBBgQBw+fBi7xk7gxEr5EkJMiGvJmUVsWq/PsNPD//tzfOWrX6Hx0//4p9m//2aQscEyshgNx+R5jpMRwkByjZIJBZsMw2qAJCQxqgdMGAgiAikQWwzYBkyj3+vT7/dRBGtraxhIqUYEjSwrALGbnBlEQxgjBAgkGo/87iNMfeD9H6TbXcDAXLtNKECQZUGrKDDmn/zTnwGz6ciRI3zxS39MUbRwStSpBIQEdV0BBgKFkAIwKSV+6qf+AZ1OB2Pe9a6/zNSFlRWOHjlG49ixEzQkIQVXMyBmybkGiQmDCIKcIjqYRHJNcsV4NKbX65Fs2q0WEhvEcDCirhMS/PInfolud57GQw8/xB994QssLizRW7vIZ0/+c35k379kkC7zJyv/nUZEhhQgSClR1yW/8Av/jjcdOECjLCsG/QGN4WAIBsQVUlDEPLnmGHsdU7ObnF0FP3brx3hg30/yh6c+yRMX/heJGieDQSGkIEggQELAaDxiXJZI0LHpdjuAQKIxHo+oXXJq8AJr1QqDdIEzwz9HEsYIgwEbMEJMleOStfV1GmVZkZwQwk40RNDN9rMYBzlXfZvSPSbMLDkziYYQnVhiT3aAVnTZSQgJjBAgwEAgJCZsDAiDISRG4wGSsBO96gKDehUwkgiJCYMgIkBcYYydAFGWYwaDAQJGozFTQ1+irsfUjNkiZhFgdmgVXbKsAIt2LNDSPMO0xth9UqpJqaSqR0SIqQcffJCb9u7FNn/jr72b5eVlbNOZm2Np7xJCFK2C5b1LCHH4pcO88/4fRs5IrkguefZbT3PXXXfSMBsMCE6ePEVKNSBOnTzJxdWLSOLMmTMcPXqUxpGjR3nooYdpFfNkWUGoQAg7kaipU8l4vM5OOdckEIzdY5z6mIQAIUBIwgZsDISEJAxIQoiG2ZJF0CoKGq1WG6cau8ZsMOR5TlEUbGeDnUgpgURywjaSkIQkJBESYKbmdRM5LUZaZ5Auci0512RAGANmQkSWEVlGwRxVOaJOI3ACCRDCSFxFTBiwQQLRSFggQBJI2IAAg8RrSKIhCUlIgSSQADEh9mdvYy4WWKmPMkirXIsAs0Or6JJlBSLAsBi3UjDP0Jfo+zzIGFOVQ+o0Jjmxd3mZyILG3/3IR7jl4EGwaRUtFhYWAbF3eZlDbzsEhpQSVVXTkASYLMtQCMwG0zDwyivHqVONJI6+/DLnzp4lInjhhRd49ItfpGGblEwrW2C+tY83ZT9IS11W0zG+V32XOpWMx+vslHNNYkKIIBTIQoiGMYoMHODExdWLTIj+YMBoOMRASqbVmiMiqFNNqhNINPI8Yycns51tyrKkqisignJckmxIpqprqqqmIUREQUROEFxOpwiCQVplwsySswtjJCjdx9RUjGjYgCAiyCiQAjthJ+yaK2wkIYmUEjZIomEEGEmAAANmQtimERGUVUVdVUQExgghgSQaUhDKaIQyRl4nZw7RBgyYa8m5DmOGXgUHYMyEHDSyEKGMVCcSY2rXPPLII2RZTuOuO+/kPe95D7bp9de5dHmV7SQxZZuGJDbZGPiz5/6MqqqQxBNPPMHRo0cBkeqaRihjb3E77VikpA+YIGdC7CZnhnHZg7JHns9R5HMkVYAQQs64uXUXb56/h5XxcV7uP4mdSC6xEyAuX15jam19jbIssRO26fXWASEJiVcJMDabJK6wTb/fp64qFMFwMGQ0GtMIZeTRJpRzd/evs2/uDr6z9ii96jwiAFFVQwblKteSc8MMCAyHFn6E9x38OE9dfIQTvecpSYBAQSDsBBiznRANIQlJNCQ2CAyITcaIhpDEJglJIDYJEWrRii5BxgP7/x5v7b6Tc6Pv0KsuMPAKY/co3Wc3Obuwa+p6DAqyyGlY5tzwME9f/DzHek9jKkwiixzbJGqMwWwwx44d53/+5m8CJiKQxIRoiC1mOyMEgl6vj20kWFtbR4hQQRBktAgFL60/zur4FJfKM9SUjOsepQfULtmNALMrkUVOq9VlQmS0yGiTGFN6gF2TMQeYUbWOSdgJO/EXIZSRq4MUHGzdS0mfUVqjYdUYs1aeoaoHGLObnOsyYLaYmhE1IzYJRHBTfjvJFd9L3yWlCkmYAAE2yTWzCGHMtYhG0IjIaYgAQRAggyFRA6YhNtgYcz05N6BOFYPhKo08b1MUHcBgEBsUjL1OckVkGXaiIbHJGDkxZSbEhBC7EoggU4spIazEpfoVapckakb1GmU9QIAxNyLn+2HTMBMC1tJpGqEgija2qaoxDUlkWRswtplFgAGJDcI2DSFCBdsJkUVBo/SAhpky5sblvE5ONVU95mpiSkwYY1dMiIYx12ImbK5iNpjXcEpIojZXJFe8XjmvU50q6lTx/1Oi5C9K8AYXvMEFb3DBG9z/ARTdOmwVTrx0AAAAAElFTkSuQmCC'; } })(),
          lastVersionId: customVer,
          javaArgs: `-Xmx${maxRam} -Xms${minRam}${renderApi==='vulkan'?' -Dorg.lwjgl.vulkan.libname=vulkan-1':''}`,
        };
        data2.selectedProfile = profileKey;
        await fs.promises.writeFile(profilesPath, JSON.stringify(data2, null, 2));
      } catch(e) { send('instance-log', { instanceId, line: `[LAUNCHER] Failed to write profile: ${e.message}` }); }

      // Launch official launcher and detect mod crashes
      const cp = require('child_process');
      (async () => {
        if (stoppedInstances.has(instanceId)) return;
        // Spawn launcher and wait for it to close
        await new Promise((resolve) => {
          const proc = cp.spawn(exe, [], { stdio: 'ignore' });
          if (proc) instances[instanceId].process = proc;
          send('instance-log', { instanceId, line: `[LAUNCHER] Opened official launcher` });
          proc.on('exit', () => resolve());
        });

        // Check for crash reports
        let modCrashDetected = false;
        let crashContent = '';
        const crashReportsDir = path.join(defaultMcDir, 'crash-reports');
        if (fs.existsSync(crashReportsDir)) {
          const reports = fs.readdirSync(crashReportsDir)
            .filter(f => f.endsWith('.txt') && f.startsWith('crash-'))
            .map(f => ({ name: f, time: fs.statSync(path.join(crashReportsDir, f)).mtimeMs }))
            .sort((a, b) => b.time - a.time);
          if (reports.length > 0) {
            const now = Date.now();
            const recent = reports.filter(r => (now - r.time) < 120000);
            for (const report of recent) {
              try {
                const content = await fs.promises.readFile(path.join(crashReportsDir, report.name), 'utf8');
                const cl = content.toLowerCase();
                if (cl.includes('incompatible mods found') || cl.includes('some of your mods are incompatible') || content.includes('FormattedException') || content.includes('Mod resolution failed') || cl.includes('error loading mod') || cl.includes('failed to load mod') || cl.includes('uncaught exception')) {
                  modCrashDetected = true;
                  crashContent = content;
                }
                break;
              } catch {}
            }
          }
        }

        // Normal exit — clean up
        if (fs.existsSync(officialModsDir)) {
          for (const f of fs.readdirSync(officialModsDir)) {
            if (f.endsWith('.jar')) { try { fs.unlinkSync(path.join(officialModsDir, f)); } catch {} }
          }
        }
        if (originalProfiles) {
          try { fs.writeFileSync(profilesPath, originalProfiles); } catch {}
        } else {
          try {
            const cur = JSON.parse(fs.readFileSync(profilesPath,'utf8'));
            if (cur && cur.profiles) { delete cur.profiles[profileKey]; fs.writeFileSync(profilesPath, JSON.stringify(cur, null, 2)); }
          } catch {}
        }
        send('instance-closed', { instanceId, code:0 });
        delete instances[instanceId];
      })();
      send('launch-status', 'Opening Minecraft Launcher...');
      send('launch-progress', { instanceId, percent:100, message:'Original launcher opened', done:true });
      clearTimeout(safetyTimer);
      return;
    }

    // ── Launch with auto-fix retry ──────────────────────────────────────────────

    // Build a manual launch for modern Forge/NeoForge (mclc can't handle module-path/arguments from version JSON)
    async function buildModernLoaderLaunch() {
      const loaderTag = modLoader === 'forge' ? 'FORGE' : 'NEOFORGE';
      const verDir = path.join(P.mc, 'versions', versionObj.custom);
      const verJsonPath = path.join(verDir, `${versionObj.custom}.json`);
      const childJson = JSON.parse(await fs.promises.readFile(verJsonPath, 'utf8'));
      let verJson = childJson;

      // Merge inherited parent JSON (libraries + arguments) — loader inherits vanilla MC
      if (verJson.inheritsFrom) {
        const parentPath = path.join(P.mc, 'versions', verJson.inheritsFrom, `${verJson.inheritsFrom}.json`);
        if (fs.existsSync(parentPath)) {
          const parentJson = JSON.parse(await fs.promises.readFile(parentPath, 'utf8'));
          // Merge parent libraries (parent first, child overrides)
          const mergedLibs = [...(parentJson.libraries || [])];
          for (const lib of (childJson.libraries || [])) {
            const existingIdx = mergedLibs.findIndex(l => l.name === lib.name);
            if (existingIdx >= 0) mergedLibs[existingIdx] = lib;
            else mergedLibs.push(lib);
          }
          // Merge arguments (parent game args first, loader args after — same as the official launcher)
          const parentGame = parentJson.arguments?.game || (parentJson.minecraftArguments ? parentJson.minecraftArguments.split(' ') : []);
          const parentJvm = parentJson.arguments?.jvm || [];
          verJson = {
            ...parentJson,
            ...childJson,
            libraries: mergedLibs,
            arguments: {
              game: [...parentGame, ...(childJson.arguments?.game || [])],
              jvm: [...parentJvm, ...(childJson.arguments?.jvm || [])]
            }
          };
          send('instance-log', { instanceId, line: `[${loaderTag}] Merged ${parentJson.libraries?.length||0} parent libs with ${childJson.libraries?.length||0} loader libs` });
        }
      }

      const libDir = path.join(P.mc, 'libraries');
      const assetsDir = path.join(P.mc, 'assets');
      const sep = path.delimiter;
      const versionName = versionObj.custom;
      const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';

      const argAllowed = (arg) => {
        if (!arg.rules || !arg.rules.length) return true;
        let allowed = false;
        for (const rule of arg.rules) {
          let matches = true;
          if (rule.os) {
            if (rule.os.name && rule.os.name !== osName) matches = false;
            if (rule.os.arch === 'x86' && process.arch !== 'ia32') matches = false;
          }
          // Launcher features (demo, custom resolution, quick play) are handled separately
          if (rule.features && Object.keys(rule.features).length) matches = false;
          if (matches) allowed = rule.action === 'allow';
        }
        return allowed;
      };

      const resolve = (s) => String(s)
        .replace(/\$\{library_directory\}/g, libDir)
        .replace(/\$\{classpath_separator\}/g, sep)
        .replace(/\$\{version_name\}/g, versionName)
        .replace(/\$\{assets_directory\}/g, assetsDir)
        .replace(/\$\{assets_root\}/g, assetsDir)
        .replace(/\$\{game_directory\}/g, gameDir)
        .replace(/\$\{natives_directory\}/g, P.mc)
        .replace(/\$\{launcher_name\}/g, 'Crux Client')
        .replace(/\$\{launcher_version\}/g, String(CURRENT_VERSION || ''))
        .replace(/\$\{version_type\}/g, versionType || 'release');

      // Build classpath from libraries — but EXCLUDE jars already on the module path (-p)
      const modulePathJars = new Set();
      const pIdx = (verJson.arguments?.jvm || []).indexOf('-p');
      if (pIdx >= 0 && typeof (verJson.arguments.jvm[pIdx+1]) === 'string') {
        const pArg = resolve(verJson.arguments.jvm[pIdx+1]);
        pArg.split(sep).forEach(j => modulePathJars.add(path.resolve(j)));
      }

      const classpath = [];
      const seenJars = new Set();
      for (const lib of (verJson.libraries || [])) {
        if (lib.rules) {
          let libAllowed = false;
          for (const lr of lib.rules) {
            if (lr.action === 'allow') libAllowed = true;
            if (lr.os) {
              if (lr.os.name === 'osx' && process.platform === 'darwin') libAllowed = lr.action === 'allow';
              else if (lr.os.name === 'windows' && process.platform === 'win32') libAllowed = lr.action === 'allow';
              else if (lr.os.name === 'linux' && process.platform === 'linux') libAllowed = lr.action === 'allow';
            }
          }
          if (!libAllowed) continue;
        }
        const name = lib.name;
        const parts = name.split(':');
        const group = parts[0], artifact = parts[1], ver2 = parts[2], classifier = parts[3];
        const jarName = classifier ? `${artifact}-${ver2}-${classifier}.jar` : `${artifact}-${ver2}.jar`;
        const rel = group.replace(/\./g, '/') + '/' + artifact + '/' + ver2 + '/' + jarName;
        const filePath = path.join(libDir, rel);
        const resolved = path.resolve(filePath);
        if (fs.existsSync(resolved) && !modulePathJars.has(resolved) && !seenJars.has(resolved)) {
          seenJars.add(resolved);
          classpath.push(resolved);
        }
      }

      // Add the client jar (loader version dirs usually only contain the JSON — fall back to the base jar)
      let clientJar = path.join(verDir, `${versionName}.jar`);
      if (!fs.existsSync(clientJar)) {
        const baseId = verJson.inheritsFrom || version;
        const baseJar = path.join(P.mc, 'versions', baseId, `${baseId}.jar`);
        clientJar = fs.existsSync(baseJar) ? baseJar : null;
      }
      if (clientJar) classpath.push(clientJar);

      // Build JVM args from version JSON (skip the inherited "-cp ${classpath}" pair — we build our own)
      const jvmArgs = [];
      const rawJvm = verJson.arguments?.jvm || [];
      for (let i = 0; i < rawJvm.length; i++) {
        const arg = rawJvm[i];
        if (typeof arg === 'string') {
          if (['-cp', '-classpath', '--class-path'].includes(arg)) { i++; continue; }
          if (arg === '${classpath}') continue;
          jvmArgs.push(resolve(arg));
        } else if (arg.value && argAllowed(arg)) {
          const vals = Array.isArray(arg.value) ? arg.value : [arg.value];
          for (const v of vals) jvmArgs.push(resolve(v));
        }
      }

      // If JSON has -p (module path), keep it — NeoForge requires module path, not classpath
      const hasModulePath = jvmArgs.includes('-p');

      // Add memory args
      jvmArgs.unshift(`-Xmx${maxRam}`, `-Xms${minRam}`);

      // Add classpath (client jar + non-module libs) — NeoForge also needs -cp for some libs
      const classpathStr = classpath.join(sep);
      if (!hasModulePath) {
        // Vanilla/Fabric: use -cp for everything
        jvmArgs.push('-cp', classpathStr);
      } else {
        // NeoForge: -p is already in jvmArgs from JSON, just add client jar to classpath
        jvmArgs.push('-cp', classpathStr);
      }

      // Main class
      const mainClass = verJson.mainClass || 'net.minecraft.client.main.Main';

      // Build game args (merged parent vanilla args + loader args e.g. "--launchTarget forge_client")
      const gameArgs = [];
      for (const arg of (verJson.arguments?.game || [])) {
        if (typeof arg === 'string') {
          gameArgs.push(resolve(arg));
        } else if (arg.value && argAllowed(arg)) {
          const vals = Array.isArray(arg.value) ? arg.value : [arg.value];
          for (const v of vals) gameArgs.push(resolve(v));
        }
      }

      // Auth placeholders
      const accessToken = data.accessToken || '0';
      const gameUuid = data.uuid || '00000000-0000-0000-0000-000000000000';
      const playerName = data.playerName || 'Player';
      const assetIndexId = verJson.assetIndex?.id || version;

      for (let i = 0; i < gameArgs.length; i++) {
        gameArgs[i] = gameArgs[i]
          .replace(/\$\{auth_player_name\}/g, playerName)
          .replace(/\$\{auth_session\}/g, accessToken)
          .replace(/\$\{auth_access_token\}/g, accessToken)
          .replace(/\$\{auth_uuid\}/g, gameUuid)
          .replace(/\$\{auth_xuid\}/g, data.xuid || '')
          .replace(/\$\{clientid\}/g, data.clientId || '')
          .replace(/\$\{user_properties\}/g, '{}')
          .replace(/\$\{user_type\}/g, 'msa')
          .replace(/\$\{version_name\}/g, version)
          .replace(/\$\{game_directory\}/g, gameDir)
          .replace(/\$\{assets_directory\}/g, assetsDir)
          .replace(/\$\{assets_root\}/g, assetsDir)
          .replace(/\$\{assets_index_name\}/g, assetIndexId)
          .replace(/\$\{asset_index\}/g, assetIndexId);
      }

      // Always add auth at end if not present
      if (!gameArgs.includes(accessToken)) gameArgs.push('--accessToken', accessToken);
      if (!gameArgs.includes(gameUuid)) gameArgs.push('--uuid', gameUuid);
      if (!gameArgs.includes(playerName)) gameArgs.push('--username', playerName);
      if (!gameArgs.some(a => a === '--version')) gameArgs.push('--version', version);
      if (!gameArgs.some(a => a === '--gameDir' || a === '-d')) gameArgs.push('--gameDir', gameDir);
      if (!gameArgs.some(a => a === '--assetsDir')) gameArgs.push('--assetsDir', path.join(P.mc, 'assets'));

      // Direct server connect from Recent
      if (data.serverAddress) {
        gameArgs.push('--server', data.serverAddress);
        if (data.serverPort) gameArgs.push('--port', String(data.serverPort));
      }

      // Direkter Welt-Join aus Recent > Welten
      gameArgs.push(...worldJoinArgs(data, line => send('instance-log', { instanceId, line }), gameDir));

      // Crux Client custom args — placed AFTER -cp but before mainClass
      if (modLoader === 'neoforge') {
        // forge.eagerDisplay=false disables NeoForge EarlyDisplay entirely
        // fml.earlyWindowControl=false is an alternative property name
        // forge.eagerGlVersion=4.5 forces GL 4.5 if early display still runs
        jvmArgs.push('-Dforge.eagerDisplay=false');
        jvmArgs.push('-Dfml.earlyWindowControl=false');
        jvmArgs.push('-Dforge.eagerGlVersion=4.5');
      }
      jvmArgs.push('-Dminecraft.window.title=Crux Client');
      // Render-Modus kommt aus der pro-PC-Historie: gecrashte Treiber werden
      // gemerkt und beim nächsten Start übersprungen.
      const gpuMode = gpuModeById(currentGpuMode);
      let mesaGL = null;
      if (gpuMode.software) {
        send('instance-log', { instanceId, line: `[GPU] Render-Modus ${gpuMode.label} (pro PC gemerkt)` });
        mesaGL = await ensureMesa();
        if (!mesaGL) {
          send('instance-log', { instanceId, line: '[GPU] Mesa3D-Setup erneut versuchen...' });
          mesaGL = await ensureMesa();
        }
        if (mesaGL) {
          const mesaDir = path.dirname(mesaGL);
          jvmArgs.push(`-Dorg.lwjgl.opengl.libpath=${mesaDir}`);
          jvmArgs.push('-Dorg.lwjgl.opengl.libname=opengl32');
          installMesaToGameDir(mesaGL, gameDir);
          // Preload Mesa via Java agent (runs in premain BEFORE any Minecraft code)
          const agentJar = await ensureMesaAgent(mesaGL, resolvedJava);
          if (agentJar) {
            jvmArgs.unshift(`-javaagent:${agentJar}=${mesaGL}`);
            send('instance-log', { instanceId, line: `[LAUNCH] Java Agent: preloads Mesa opengl32.dll via premain()` });
          }
          send('instance-log', { instanceId, line: `[GPU] Mesa3D von ${mesaDir} (${gpuMode.label})` });
        }
        jvmArgs.push('-Dorg.lwjgl.opengl.allowSoftwareOpenGL=true');
        if (!mesaGL) send('instance-log', { instanceId, line: `[GPU] ${gpuMode.label} nicht verfügbar — GPU-Crash kann nicht automatisch umgangen werden` });
      } else {
        send('instance-log', { instanceId, line: '[GPU] Render-Modus Native GPU (OpenGL)' });
      }
      if (data.renderApi === 'vulkan') jvmArgs.push('-Dorg.lwjgl.vulkan.libname=vulkan-1');

      return { javaPath: resolvedJava, mainClass, jvmArgs, gameArgs, mesaActive: !!mesaGL, gallium: gpuMode.gallium };

    }

    // Kurzer Grund aus dem echten Crash-Log, damit der PC die Ursache merkt.
    function gpuCrashReason(){
      const allLogs = instances[instanceId].logs || [];
      const start = instances[instanceId].gpuLogStart || 0;
      const lines = allLogs.slice(start).filter(l =>
        GPU_DRIVER_HINT.test(l) || String(l).includes('EXCEPTION_ACCESS_VIOLATION'));
      return lines.slice(-4).join(' | ').slice(0, 220);
    }

    async function mclcLaunchOnce() {
      // Nur die Zeilen dieses Laufs dürfen als Crash-Grund gemerkt werden.
      instances[instanceId].gpuLogStart = (instances[instanceId].logs || []).length;
      // For Forge/NeoForge: manual launch with resolved version JSON
      if ((modLoader === 'forge' || modLoader === 'neoforge') && versionObj.custom) {
        const loaderTag = modLoader === 'forge' ? 'FORGE' : 'NEOFORGE';
        let earlyDisplayJar = null;
        let earlyDisplayDisabled = null;
        try {
          if (modLoader === 'neoforge') {
            // Disable NeoForge EarlyDisplay by renaming its JAR (crashes on old AMD drivers)
            // Find the actual EarlyDisplay JAR dynamically instead of hardcoding a version
            try {
              const edmDir = path.join(P.mc, 'libraries', 'net', 'neoforged', 'fancymodloader', 'earlydisplay');
              if (fs.existsSync(edmDir)) {
                const edmVersions = fs.readdirSync(edmDir).filter(v => fs.existsSync(path.join(edmDir, v, `earlydisplay-${v}.jar`))).sort();
                if (edmVersions.length) earlyDisplayJar = path.join(edmDir, edmVersions[edmVersions.length - 1], `earlydisplay-${edmVersions[edmVersions.length - 1]}.jar`);
              }
            } catch {}
            earlyDisplayDisabled = earlyDisplayJar ? earlyDisplayJar + '.disabled' : null;
            try {
              if (earlyDisplayJar && fs.existsSync(earlyDisplayJar)) {
                await fs.promises.rename(earlyDisplayJar, earlyDisplayDisabled);
                send('instance-log', { instanceId, line: `[NEOFORGE] Disabled EarlyDisplay (renamed JAR)` });
              }
            } catch (e) {
              send('instance-log', { instanceId, line: `[NEOFORGE] EarlyDisplay disable failed: ${e.message}` });
            }

            // Also patch fml.toml as backup
            const fmlTomlPath = path.join(gameDir, 'config', 'fml.toml');
            try {
              let fmlToml = await fs.promises.readFile(fmlTomlPath, 'utf8');
              fmlToml = fmlToml.replace(/^earlyWindowControl\s*=\s*true/gm, 'earlyWindowControl = false');
              fmlToml = fmlToml.replace(/^earlyWindowProvider\s*=\s*"[^"]*"/gm, 'earlyWindowProvider = "disabled"');
              fmlToml = fmlToml.replace(/^earlyWindowSkipGLVersions\s*=\s*\[[^\]]*\]/gm, 'earlyWindowSkipGLVersions = ["4.6"]');
              await fs.promises.writeFile(fmlTomlPath, fmlToml, 'utf8');
              send('instance-log', { instanceId, line: `[NEOFORGE] Patched fml.toml: disabled early window` });
            } catch (e) {
              send('instance-log', { instanceId, line: `[NEOFORGE] fml.toml patch skipped: ${e.message}` });
            }
          }

          if (stoppedInstances.has(instanceId)) {
            try { if (earlyDisplayDisabled && fs.existsSync(earlyDisplayDisabled)) fs.renameSync(earlyDisplayDisabled, earlyDisplayJar); } catch {}
            cleanupMesaFromGameDir(gameDir);
            return { code: 0, modCrash: false };
          }

          const { javaPath, mainClass, jvmArgs, gameArgs, mesaActive, gallium } = await buildModernLoaderLaunch();
          send('launch-progress', { instanceId, percent:20, message:`Launching ${loaderTag === 'FORGE' ? 'Forge' : 'NeoForge'} with ${mainClass}...` });
          send('instance-log', { instanceId, line: `[${loaderTag}] Java: ${javaPath}` });

          const allArgs = [...jvmArgs, mainClass, ...gameArgs];
          send('instance-log', { instanceId, line: `[${loaderTag}] Args: ${allArgs.slice(0, 10).join(' ')}...` });

          const spawnOpts = { cwd: gameDir, detached: false, stdio: ['ignore', 'pipe', 'pipe'] };
          if (mesaActive) {
            const driver = gallium || 'zink';
            spawnOpts.env = { ...process.env, GALLIUM_DRIVER: driver };
            send('instance-log', { instanceId, line: `[GPU] GALLIUM_DRIVER=${driver} (${gpuModeById(currentGpuMode).label})` });
          }
          const proc = spawn(javaPath, allArgs, spawnOpts);
          if (proc) instances[instanceId].process = proc;

          let modCrash = false;
          let gpuDriverCrash = false;
          // Die hs_err-Zeilen kommen einzeln: "EXCEPTION_ACCESS_VIOLATION" und
          // der Treiber-DLL-Name stehen NICHT in derselben Zeile. Deshalb Total
          // merken statt pro Zeile zu prüfen.
          let sawGpuDriver = false, sawAccessViolation = false;
          const handleLine = (line) => {
            const s = String(line).trim(); if (!s) return;
            instances[instanceId].logs.push(s);
            send('instance-log', { instanceId, line: s });
            if (s.toLowerCase().includes('setting user')) {
              instances[instanceId].gameStartedAt = Date.now();
              // Der Modus hat das Spiel gestartet -> für diesen PC als funktionierend merken.
              markGpuModeResult(currentGpuMode, false, '').catch(()=>{});
              send('launch-progress', { instanceId, percent:100, message:'Minecraft running!' });
              send('mc-launched', instanceId);
            }
            if (s.toLowerCase().includes('incompatible mods found') || s.toLowerCase().includes('some of your mods are incompatible') || s.includes('FormattedException') || s.includes('Mod resolution failed') || s.toLowerCase().includes('error loading mod') || s.toLowerCase().includes('failed to load mod') || s.toLowerCase().includes('uncaught exception')) {
              modCrash = true;
            }
            if (GPU_DRIVER_HINT.test(s)) sawGpuDriver = true;
            if (s.includes('EXCEPTION_ACCESS_VIOLATION')) sawAccessViolation = true;
            if (sawGpuDriver && sawAccessViolation) gpuDriverCrash = true;
          };
          proc.stdout.on('data', d => d.toString().split('\n').forEach(handleLine));
          proc.stderr.on('data', d => d.toString().split('\n').forEach(handleLine));

          return new Promise((resolve) => {
              proc.on('close', async (code) => {
                // Restore EarlyDisplay JAR after launch
                try {
                  if (earlyDisplayDisabled && fs.existsSync(earlyDisplayDisabled)) {
                    fs.renameSync(earlyDisplayDisabled, earlyDisplayJar);
                  }
                } catch {}
                cleanupMesaFromGameDir(gameDir);
                // Der Auto-Retry passiert zentral nach mclcLaunchOnce().
                resolve({ code, modCrash, gpuDriverCrash, softwareAttempt: !!mesaActive });
            });
            proc.on('error', (err) => {
              try { if (earlyDisplayDisabled && fs.existsSync(earlyDisplayDisabled)) fs.renameSync(earlyDisplayDisabled, earlyDisplayJar); } catch {}
              cleanupMesaFromGameDir(gameDir);
              send('instance-log', { instanceId, line:`[LAUNCH ERROR] ${err.message}` });
              resolve({ code: -1, modCrash: false, gpuDriverCrash: false, softwareAttempt: !!mesaActive });
            });
          });
        } catch(neErr) {
          send('instance-log', { instanceId, line:`[${loaderTag} LAUNCH ERROR] ${neErr.message}` });
          // Fall through to mclc
        }
      }

      // For other loaders: use mclc
      const mclcMode = gpuModeById(currentGpuMode);
      let mclcMesaGL = null;
      const mclcCustomArgs = ['-Dminecraft.window.title=Crux Client'];
      if (mclcMode.software) {
        send('instance-log', { instanceId, line: `[GPU] Render-Modus ${mclcMode.label} (pro PC gemerkt)` });
        mclcMesaGL = await ensureMesa();
        if (!mclcMesaGL) {
          send('instance-log', { instanceId, line: '[GPU] Mesa3D-Setup erneut versuchen...' });
          mclcMesaGL = await ensureMesa();
        }
        if (mclcMesaGL) {
          const mclcMesaDir = path.dirname(mclcMesaGL);
          mclcCustomArgs.push(`-Dorg.lwjgl.opengl.libpath=${mclcMesaDir}`);
          mclcCustomArgs.push('-Dorg.lwjgl.opengl.libname=opengl32');
          installMesaToGameDir(mclcMesaGL, gameDir);
          const agentJar = await ensureMesaAgent(mclcMesaGL, resolvedJava);
          if (agentJar) {
            mclcCustomArgs.unshift(`-javaagent:${agentJar}=${mclcMesaGL}`);
            send('instance-log', { instanceId, line: `[LAUNCH] Java Agent: preloads Mesa opengl32.dll via premain()` });
          }
          send('instance-log', { instanceId, line: `[GPU] Mesa3D von ${mclcMesaDir} (${mclcMode.label})` });
        }
        mclcCustomArgs.push('-Dorg.lwjgl.opengl.allowSoftwareOpenGL=true');
        if (!mclcMesaGL) send('instance-log', { instanceId, line: `[GPU] ${mclcMode.label} nicht verfügbar — GPU-Crash kann nicht automatisch umgangen werden` });
      } else {
        send('instance-log', { instanceId, line: '[GPU] Render-Modus Native GPU (OpenGL)' });
      }
      // Direct server connect from Recent
      const mclcVersionObj = JSON.parse(JSON.stringify(versionObj));
      if (data.serverAddress) {
        if (!mclcVersionObj.arguments) mclcVersionObj.arguments = {};
        if (!mclcVersionObj.arguments.game) mclcVersionObj.arguments.game = [];
        mclcVersionObj.arguments.game.push('--server', data.serverAddress);
        if (data.serverPort) mclcVersionObj.arguments.game.push('--port', String(data.serverPort));
        send('instance-log', { instanceId, line: `[LAUNCH] Direct connect: ${data.serverAddress}:${data.serverPort || 25565}` });
      }
      // Direkter Welt-Join aus Recent > Welten
      const mclcWorldArgs = worldJoinArgs(data, line => send('instance-log', { instanceId, line }), gameDir);
      if (mclcWorldArgs.length) {
        if (!mclcVersionObj.arguments) mclcVersionObj.arguments = {};
        if (!mclcVersionObj.arguments.game) mclcVersionObj.arguments.game = [];
        mclcVersionObj.arguments.game.push(...mclcWorldArgs);
      }
      if (stoppedInstances.has(instanceId)) return { code: 0, modCrash: false, gpuDriverCrash: false, softwareAttempt: !!mclcMesaGL };
      return new Promise((resolve) => {
        const launcher = new Client();
        const launchOpts = {
          clientPackage: null,
          authorization: auth,
          root: P.mc,
          version: mclcVersionObj,
          memory: { max: maxRam, min: minRam },
          javaPath: resolvedJava,
          customArgs: mclcCustomArgs,
          overrides: { 
            detached: false,
            gameDirectory: gameDir,
            ...(mclcMesaGL ? { env: { ...process.env, GALLIUM_DRIVER: mclcMode.gallium || 'zink' } } : {}),
          },
        };
        let modCrash = false;
        let gpuDriverCrash = false;
        let sawGpuDriver = false, sawAccessViolation = false;

        launcher.on('download-status', s => {
          const pct = s.total>0 ? Math.round(s.current/s.total*100) : 0;
          send('launch-progress', { instanceId, percent:Math.min(90,pct+20), message:`Downloading: ${s.name} (${s.current}/${s.total})` });
        });
        launcher.on('progress', e => {
          const pct = e.total>0 ? Math.round(e.task/e.total*90) : 0;
          send('launch-progress', { instanceId, percent:Math.min(90,pct+20), message:`${e.type}: ${e.task}/${e.total}` });
        });
        launcher.on('data', line => {
          const s = String(line).trim(); if (!s) return;
          instances[instanceId].logs.push(s);
          send('instance-log', { instanceId, line: s });
          if (s.toLowerCase().includes('setting user')) {
            instances[instanceId].gameStartedAt = Date.now();
            // Modus hat das Spiel gestartet -> für diesen PC als gut merken.
            markGpuModeResult(currentGpuMode, false, '').catch(()=>{});
            send('launch-progress', { instanceId, percent:100, message:'Minecraft running!' });
            send('mc-launched', instanceId);
          }
          if (s.toLowerCase().includes('incompatible mods found') || s.toLowerCase().includes('some of your mods are incompatible') || s.includes('FormattedException') || s.includes('Mod resolution failed') || s.toLowerCase().includes('error loading mod') || s.toLowerCase().includes('failed to load mod') || s.toLowerCase().includes('uncaught exception')) {
            modCrash = true;
          }
          // hs_err verteilt die Hinweise auf mehrere Zeilen - nicht pro Zeile filtern.
          if (GPU_DRIVER_HINT.test(s)) sawGpuDriver = true;
          if (s.includes('EXCEPTION_ACCESS_VIOLATION')) sawAccessViolation = true;
          if (sawGpuDriver && sawAccessViolation) gpuDriverCrash = true;
          if ((s.toLowerCase().includes('invalid session') || s.toLowerCase().includes('failed to authenticate the session')) && !instances[instanceId].sessionRetried) {
            instances[instanceId].sessionRetried = true;
            send('instance-log', { instanceId, line: '[AUTH] Invalid session detected, refreshing token and relaunching...' });
            if (instances[instanceId].process) {
              try { instances[instanceId].process.kill(); } catch {}
            }
            const acc = accounts.find(a => a.uuid === uuid.replace(/-/g,'') || a.uuid === uuid);
            if (acc && acc.refreshToken) {
              send('launch-status', 'Invalid session — retrying with fresh token...');
            }
          }
        });
        launcher.on('error', err => {
          cleanupMesaFromGameDir(gameDir);
          const msg = err.message || String(err);
          instances[instanceId].logs.push('[ERROR] ' + msg);
          send('instance-log', { instanceId, line:'[ERROR] '+msg });
          send('launch-progress', { instanceId, percent:0, message:'', done:true });
        });
        launcher.on('close', (code) => {
          cleanupMesaFromGameDir(gameDir);
          resolve({ code, modCrash, gpuDriverCrash, softwareAttempt: !!mclcMesaGL });
        });

        launcher.launch(launchOpts).then(proc => {
          if (proc) instances[instanceId].process = proc;
        }).catch(err => {
          cleanupMesaFromGameDir(gameDir);
          send('instance-log', { instanceId, line:`[LAUNCH ERROR] ${err.message}` });
          resolve({ code: -1, modCrash: false, gpuDriverCrash: false, softwareAttempt: !!mclcMesaGL });
        });
      });
    }

    send('launch-status', 'Preparing Minecraft...');
    send('launch-progress', { instanceId, percent:20, message:'Starting Minecraft...' });

    // Pro-PC-Reihenfolge der Render-Modi: zuerst der zuletzt funktionierende,
    // dann alle, die auf diesem Rechner noch nicht gecrasht sind.
    const gpuPlan = await gpuModeOrder();
    let gpuIdx = 0;
    currentGpuMode = gpuPlan[0]?.id || 'native';
    send('instance-log', { instanceId, line:`[GPU] Treiber-Reihenfolge (dieser PC): ${gpuPlan.map(m => m.label).join(' → ')}` });

    let mclcResult = await mclcLaunchOnce();

    // Mixin-Crashes werden IMMER automatisch behoben: verantwortliche Mod
    // deaktivieren, fuer MC/Loader merken, neu starten — auch mehrfach hinter-
    // einander, wenn eine weitere Mod denselben Fehler verursacht.
    const fixMixinCrashes = async (result) => {
      let out = result;
      const handledMixinMods = new Set();
      let mixinFixRuns = 0;
      const MAX_MIXIN_FIX_RUNS = 8;
      while (out.code !== 0 && out.code !== null &&
             !stoppedInstances.has(instanceId) && mixinFixRuns < MAX_MIXIN_FIX_RUNS) {
        const crashMods = await collectMixinCrashMods(gameDir, instances[instanceId].logs || [], instances[instanceId].startTime);
        const fresh = crashMods.filter(x => {
          const key = normalizeBrokenId(x.id);
          return key && !handledMixinMods.has(key);
        });
        if (!fresh.length) break;
        let fixedAny = false;
        for (const { id, reason } of fresh) {
          handledMixinMods.add(normalizeBrokenId(id));
          const fixed = await disableCrashModPersistent(
            path.join(gameDir, 'mods'), id, profileId, profileMods, clientMods,
            mrpackMods, version, modLoader, reason);
          if (!fixed) continue;
          fixedAny = true;
          send('instance-log', { instanceId, line:`[AUTO-FIX ${mixinFixRuns + 1}] Mixin-Crash durch ${id} — Mod dauerhaft deaktiviert und für MC ${version}/${modLoader} gemerkt.` });
        }
        mixinFixRuns++;
        if (!fixedAny) break;
        send('launch-status', 'Mixin-Crash erkannt — Neustart ohne defekte Mods...');
        send('launch-progress', { instanceId, percent:20, message:`Neustart ohne defekte Mod (${mixinFixRuns})...` });
        clearTimeout(safetyTimer);
        safetyTimer = setTimeout(fireSafetyTimeout, 5 * 60 * 1000);
        out = await mclcLaunchOnce();
      }
      return out;
    };
    mclcResult = await fixMixinCrashes(mclcResult);

    // GPU-Crash: Treiber für DIESEN PC merken und mit dem nächsten Modus
    // automatisch neu starten. Beim nächsten Launch wird er dann zuerst
    // übersprungen — auch wenn der User das Profil wechselt.
    while (mclcResult.gpuDriverCrash && mclcResult.code !== 0 && mclcResult.code !== null &&
           !stoppedInstances.has(instanceId) && gpuIdx + 1 < gpuPlan.length) {
      const crashed = gpuModeById(currentGpuMode);
      await markGpuModeResult(crashed.id, true, gpuCrashReason());
      const next = gpuPlan[++gpuIdx];
      currentGpuMode = next.id;
      send('instance-log', { instanceId, line:`[GPU-AUTO-FIX] ${crashed.label} gecrasht — für diesen PC gemerkt. Neustart mit ${next.label}.` });
      send('launch-status', `GPU-Treiber-Crash — Neustart mit ${next.label}...`);
      send('launch-progress', { instanceId, percent:20, message:`Neustart mit ${next.label}...` });
      clearTimeout(safetyTimer);
      safetyTimer = setTimeout(fireSafetyTimeout, 5 * 60 * 1000);
      mclcResult = await mclcLaunchOnce();
      mclcResult = await fixMixinCrashes(mclcResult);
    }
    // Auch der letzte Modus gecrasht und kein Alternativmodus mehr übrig.
    if (mclcResult.gpuDriverCrash && mclcResult.code !== 0 && mclcResult.code !== null &&
        !stoppedInstances.has(instanceId)) {
      await markGpuModeResult(currentGpuMode, true, gpuCrashReason());
    }
    clearTimeout(safetyTimer);

    // Save the group's settings back after the game wrote options.txt on exit
    if (settingsGroup) await syncGroupSettings(settingsGroup, gameDir);

    send('instance-log', { instanceId, line:`--- Process exited (code ${mclcResult.code}) ---` });
    send('launch-progress', { instanceId, percent:0, message:'', done:true });
    send('instance-closed', { instanceId, code: mclcResult.code });
    if (mclcResult.code !== 0 && mclcResult.code !== null && !stoppedInstances.has(instanceId)) {
      instances[instanceId].crashed = true;
      if (!mclcResult.modCrash) showCrashWindow(instanceId, mclcResult.code, instances[instanceId].logs.slice(-80).join('\n'));
      send('instance-crashed', { instanceId, code: mclcResult.code });
    }

  } catch(err) {
    clearTimeout(safetyTimer);
    send('launch-status', 'Launch error: ' + err.message);
    send('launch-progress', { instanceId, percent:0, message:'', done:true });
    send('launch-error', err.message);
    console.error('Launch error:', err);
  }
});

// ── Crash-Assistent (lokale Log-Analyse + ein-Klick-Reparatur) ───────────────
// Kein externer KI-Dienst: bekannte Muster werden lokal erkannt und nur
// repariert, wenn eine konkrete, ruecknehmbare Aktion dazu passt.
function analyzeCrashLog(text){
  const log = String(text || '');
  const lower = log.toLowerCase();
  const mods = new Set();
  for(const m of log.matchAll(/(?:mods[\\/]|[\\/]mods[\\/])([^\\/\r\n"']+\.jar)/gi)) mods.add(m[1]);
  if(!mods.size){
    for(const m of log.matchAll(/\b([A-Za-z0-9._+\-]+\.jar)\b/g)){
      if(!/^(java|jre|minecraft|client|server|launcher)/i.test(m[1])) mods.add(m[1]);
    }
  }
  const modList = [...mods].slice(0, 4);
  const gpu = GPU_DRIVER_HINT.test(log) && /exception_access_violation|access violation|hs_err|fatal error/i.test(log);
  if(gpu){
    const usingZink = /gallium_driver\s*=\s*zink|mesa3d\s*\/\s*zink/i.test(log);
    const usingLlvm = /gallium_driver\s*=\s*llvmpipe|mesa3d\s*\/\s*llvmpipe/i.test(log);
    const target = usingZink ? 'llvmpipe' : 'zink';
    return {
      kind: 'gpu',
      summary: 'GPU driver crash',
      details: 'A graphics driver (OpenGL/Vulkan DLL) crashed the JVM. The launcher can remember this and use a different render mode on the next start.',
      fixes: [{ id:'gpu', label:'Use ' + gpuModeById(target).label, description:'Next launch switches the render mode for this PC.', target }]
    };
  }
  if(modList.length){
    return {
      kind: 'mod',
      summary: 'Mod-related crash',
      details: 'Crash log mentions: ' + modList.join(', ') + '. Disabling them is reversible — the JARs are only renamed to *.disabled.',
      fixes: [{ id:'mod', label:'Disable ' + (modList.length === 1 ? 'crashing mod' : modList.length + ' crashing mods'), description:'Disables the matching mod entries and renames their JAR files.', mods: modList }]
    };
  }
  if(/outofmemoryerror|java heap space|gc overhead limit/i.test(lower)){
    return {
      kind: 'memory',
      summary: 'Not enough memory',
      details: 'Minecraft ran out of Java heap. Increase the RAM value in Settings → Launch or close other programs.',
      fixes: []
    };
  }
  if(/unsupportedclassversionerror|class file version|wrong java version/i.test(lower)){
    return {
      kind: 'java',
      summary: 'Wrong Java version',
      details: 'This Minecraft version / mod loader needs a different Java major version. Select another Java installation in Settings.',
      fixes: []
    };
  }
  return {
    kind: 'unknown',
    summary: 'No known pattern found',
    details: 'The log does not contain a pattern the local analyzer knows. Check the full log above or the Logs tab.',
    fixes: []
  };
}

ipcMain.handle('crash-analyze', async (_e, instanceId) => {
  const inst = instances[instanceId];
  if(!inst) return { ok:false, error:'Instance not found.' };
  const analysis = analyzeCrashLog((inst.logs || []).join('\n'));
  return { ok:true, ...analysis };
});

ipcMain.handle('crash-apply-fix', async (_e, { instanceId, fix }) => {
  const inst = instances[instanceId];
  if(!inst) return { ok:false, error:'Instance not found.' };
  if(!fix || !fix.id) return { ok:false, error:'No fix selected.' };
  try {
    if(fix.id === 'gpu'){
      const target = GPU_MODES.some(m => m.id === fix.target) ? fix.target : 'zink';
      await markGpuModeResult('native', true, 'Crash assistant: GPU crash');
      await markGpuModeResult(target, false, '');
      return { ok:true, message:'Done. The next launch will use ' + gpuModeById(target).label + '.' };
    }
    if(fix.id === 'mod'){
      const modsDir = path.join(inst.gameDir || '', 'mods');
      const profiles = await load(P.profiles, []);
      const prof = profiles.find(p => p.id === inst.profileId);
      const loader = String(prof?.modLoader || 'fabric');
      let disabled = 0;
      for(const name of (Array.isArray(fix.mods) ? fix.mods : []).slice(0, 4)){
        const jar = path.basename(String(name));
        if(!/\.jar$/i.test(jar)) continue;
        await disableBrokenModPersistent(jar, inst.profileId, [], [], []);
        try {
          const src = path.join(modsDir, jar);
          if(fs.existsSync(src)){ await fs.promises.rename(src, src + '.disabled'); disabled++; }
        } catch {}
        await rememberBrokenMods(inst.version, loader, [jar, jar.replace(/-\d[\w.+-]*\.jar$/i, '')], 'Crash assistant: mod crash');
      }
      return { ok:disabled > 0, message: disabled ? ('Disabled ' + disabled + ' mod JAR(s). Relaunch the profile to test.') : 'No matching JAR files were found in the mods folder.' };
    }
    return { ok:false, error:'Unknown fix.' };
  } catch(e){
    return { ok:false, error:e.message || String(e) };
  }
});

// ── Crash window ───────────────────────────────────────────────────────────────
function showCrashWindow(instanceId, code, log) {
  const cw = new BrowserWindow({ width:700, height:500, title:'Minecraft Crashed', parent:mainWindow, webPreferences:{ nodeIntegration:true, contextIsolation:false } });
  cw.setMenu(null);
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{margin:0;background:#120e18;color:#eceaf5;font-family:Inter,system-ui,Arial,sans-serif;font-size:13px;display:flex;flex-direction:column;height:100vh;overflow:hidden;}
    .header{padding:16px 18px;background:#1b1524;border-bottom:1px solid rgba(255,255,255,.09);flex-shrink:0;}
    .header h2{margin:0;color:#ff6b6b;font-size:1.1rem;} .header p{margin:4px 0 0;color:#9b94af;font-size:12px;}
    .ai-bar{display:flex;gap:.6rem;align-items:center;padding:10px 18px;background:#181320;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0;flex-wrap:wrap;}
    .btn{padding:8px 16px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:#241d33;color:#eceaf5;cursor:pointer;font:inherit;}
    .btn.ai{background:linear-gradient(135deg,#c9a6ff,#a06cff);border-color:transparent;color:#17121f;font-weight:700;}
    .btn:disabled{opacity:.55;cursor:default;}
    #ai-result{padding:0 18px;flex-shrink:0;max-height:34vh;overflow:auto;}
    #ai-result:empty{display:none;}
    .analysis{margin:10px 0;padding:12px 14px;border:1px solid rgba(160,108,255,.35);border-radius:12px;background:rgba(160,108,255,.09);}
    .analysis h3{margin:0 0 6px;font-size:.95rem;color:#c9a6ff;} .analysis p{margin:0 0 10px;color:#c9c2dc;line-height:1.45;}
    .analysis .fix-note{color:#8fe2b0;font-size:12px;}
    pre{flex:1;overflow:auto;padding:16px 18px;margin:0;white-space:pre-wrap;word-break:break-all;line-height:1.4;color:#b9b2c9;background:#0e0b14;font-family:Consolas,monospace;font-size:11px;}
  </style></head><body>
    <div class="header"><h2>💥 Minecraft Crashed</h2><p>Exit code: ${code} · Instance: ${instanceId}</p></div>
    <div class="ai-bar">
      <button class="btn ai" id="ai-analyze">✨ Analyze with AI</button>
      <button class="btn" onclick="window.close()">Close</button>
      <span id="ai-status" style="color:#9b94af"></span>
    </div>
    <div id="ai-result"></div>
    <pre>${log.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
    <script>
      const { ipcRenderer } = require('electron');
      const instanceId = ${JSON.stringify(String(instanceId))};
      const statusEl = document.getElementById('ai-status');
      const resultEl = document.getElementById('ai-result');
      let current = null;
      document.getElementById('ai-analyze').addEventListener('click', async (ev) => {
        ev.currentTarget.disabled = true;
        statusEl.textContent = 'Analyzing crash log…';
        try {
          const r = await ipcRenderer.invoke('crash-analyze', instanceId);
          if (!r || !r.ok) throw new Error((r && r.error) || 'Analysis failed');
          current = r;
          resultEl.innerHTML = '';
          const box = document.createElement('div');
          box.className = 'analysis';
          const h = document.createElement('h3');
          h.textContent = r.summary;
          const p = document.createElement('p');
          p.textContent = r.details;
          box.appendChild(h); box.appendChild(p);
          if (r.fixes && r.fixes.length) {
            const btn = document.createElement('button');
            btn.className = 'btn ai';
            btn.textContent = '🔧 Fix with AI: ' + r.fixes[0].label;
            btn.addEventListener('click', async () => {
              btn.disabled = true;
              statusEl.textContent = 'Applying fix…';
              try {
                const f = await ipcRenderer.invoke('crash-apply-fix', { instanceId, fix: r.fixes[0] });
                const note = document.createElement('div');
                note.className = 'fix-note';
                note.textContent = (f && f.ok ? '✅ ' : '⚠️ ') + ((f && f.message) || 'Fix failed.');
                box.appendChild(note);
                statusEl.textContent = f && f.ok ? 'Fixed.' : 'Fix failed.';
              } catch (e) { statusEl.textContent = String(e && e.message || e); btn.disabled = false; }
            });
            box.appendChild(btn);
          }
          resultEl.appendChild(box);
          statusEl.textContent = '';
        } catch (e) { statusEl.textContent = String(e && e.message || e); }
        ev.currentTarget.disabled = false;
      });
    <\/script>
  </body></html>`;
  cw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

// ── Update ────────────────────────────────────────────────────────────────────
const CURRENT_VERSION = require('./package.json').version;
// Dev builds (version contains "-dev") never check for or install updates.
const IS_DEV_BUILD = /-dev\b/i.test(CURRENT_VERSION);
const GITHUB_REPO = 'Dev-Reds/crux-client';

function updateLog(msg) {
  console.log('[Crux Update]', msg);
  if (mainWindow && mainWindow.webContents) {
    try { mainWindow.webContents.send('update-log', msg); } catch {}
  }
}

function fetchJsonHttps(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'CruxClient', 'Accept': 'application/vnd.github.v3+json' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchJsonHttps(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode === 403) {
        return reject(new Error('GitHub API rate limited (403). Try again later.'));
      }
      if (res.statusCode !== 200) {
        return reject(new Error('GitHub API error: HTTP ' + res.statusCode));
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('JSON parse error')); }
      });
    }).on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout fetching GitHub API')); });
  });
}

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    const doRequest = (reqUrl) => {
      const lib = reqUrl.startsWith('https') ? https : http;
      const req = lib.get(reqUrl, { headers: { 'User-Agent': 'CruxClient' } }, res => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return doRequest(res.headers.location);
        }
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        const total = parseInt(res.headers['content-length'], 10) || 0;
        let downloaded = 0;
        const chunks = [];
        res.on('data', chunk => {
          chunks.push(chunk);
          downloaded += chunk.length;
          if (mainWindow) mainWindow.webContents.send('update-download-progress', { downloaded, total });
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject);
      req.setTimeout(120000, () => { req.destroy(); reject(new Error('Download timeout')); });
      req.on('timeout', () => { req.destroy(); reject(new Error('Download timeout')); });
    };
    doRequest(url);
  });
}

function parseVersion(v) {
  return v.replace(/^v/, '').split('.').map(Number);
}

function isNewer(remote, local) {
  const r = parseVersion(String(remote || '0'));
  const l = parseVersion(String(local || '0'));
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const diff = (r[i] || 0) - (l[i] || 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

// Remembers which version the user already updated to, so the silent startup
// check doesn't nag about a version that was already installed/handled.
const UPDATE_STATE_FILE = path.join(base, 'update-state.json');
function getUpdateState() {
  try { return JSON.parse(fs.readFileSync(UPDATE_STATE_FILE, 'utf8')) || {}; } catch { return {}; }
}
function setUpdateState(patch) {
  try {
    const s = getUpdateState();
    Object.assign(s, patch);
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(UPDATE_STATE_FILE, JSON.stringify(s, null, 2));
  } catch {}
}

ipcMain.handle('check-for-update', async (e, opts) => {
  return fetchUpdateInfo(!!(opts && opts.manual));
});

async function fetchUpdateInfo(manual) {
  if (IS_DEV_BUILD) {
    updateLog('Dev build — update detection disabled.');
    return { updateAvailable: false, devBuild: true, currentVersion: CURRENT_VERSION };
  }
  try {
    updateLog('Fetching releases from GitHub...');
    const releases = await fetchJsonHttps(`https://api.github.com/repos/${GITHUB_REPO}/releases`);
    updateLog(`Got ${Array.isArray(releases) ? releases.length : '?'} releases`);
    if (!Array.isArray(releases) || !releases.length) {
      updateLog('No releases found on GitHub');
      return { updateAvailable: false, error: 'No releases found' };
    }
    const versioned = releases.filter(r => r.tag_name && /^v?\d+\.\d+\.\d+/.test(r.tag_name) && !r.prerelease);
    updateLog(`Versioned: ${versioned.map(r => r.tag_name).join(', ') || 'none'}`);
    if (!versioned.length) {
      return { updateAvailable: false, error: 'No versioned releases found' };
    }
    versioned.sort((a, b) => {
      const av = parseVersion(a.tag_name), bv = parseVersion(b.tag_name);
      for (let i = 0; i < Math.max(av.length, bv.length); i++) {
        const diff = (av[i] || 0) - (bv[i] || 0);
        if (diff !== 0) return diff;
      }
      return 0;
    });
    const latest = versioned[versioned.length - 1];
    const latestVersion = latest.tag_name.replace(/^v/, '');
    const newer = isNewer(latestVersion, CURRENT_VERSION);
    updateLog(`Latest: v${latestVersion}, Local: v${CURRENT_VERSION}, Newer: ${newer}`);
    if (newer) {
      const launcherZip = latest.assets.find(a => a.name === 'Launcher.zip' || a.name === 'Crux-Client-Installer-All.zip');
      const installer = latest.assets.find(a => a.name === 'Crux-Client-Installer.exe' || (a.name.endsWith('.exe') && a.name.includes('Installer')));
      const url = launcherZip ? launcherZip.browser_download_url : null;
      const installerUrl = installer ? installer.browser_download_url : null;
      const alreadyHandled = !manual && getUpdateState().updatedTo === latestVersion;
      updateLog(`Update available! Launcher.zip: ${url ? 'yes' : 'NO'} | Installer: ${installerUrl ? installer.name : 'NO'} | alreadyHandled: ${alreadyHandled}`);
      return {
        updateAvailable: !alreadyHandled,
        alreadyHandled,
        currentVersion: CURRENT_VERSION,
        newVersion: latestVersion,
        releaseNotes: latest.body || '',
        downloadUrl: url,
        installerUrl: installerUrl,
      };
    }
    updateLog('Up to date!');
    return { updateAvailable: false, currentVersion: CURRENT_VERSION };
  } catch (e) {
    updateLog(`ERROR: ${e.message}`);
    return { updateAvailable: false, error: e.message };
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); },
                 e => { clearTimeout(t); reject(e); });
  });
}

async function preLaunchUpdateCheck() {
  if (IS_DEV_BUILD) return null;
  if (process.env.CRUX_NO_AUTO_UPDATE === '1') return null;
  try {
    const info = await withTimeout(fetchUpdateInfo(false), 15000);
    if (!info || !info.updateAvailable) return null;
    if (!info.installed) return null;
    if (!info.downloadUrl && !info.installerUrl) return null;
    updateLog(`Pre-launch update check: v${info.newVersion} verfügbar - öffne Update-Fenster.`);
    return info;
  } catch (e) {
    updateLog('Pre-launch update check failed: ' + (e && e.message));
    return null;
  }
}

// ── Update progress window (separate process, survives the launcher quitting) ──
const UPDATE_PROGRESS_FILE = path.join(os.tmpdir(), 'crux-update-progress.json');

function writeUpdateProgress(phase, percent) {
  try {
    fs.writeFileSync(UPDATE_PROGRESS_FILE, JSON.stringify({ phase, percent: Math.round(percent) }), 'utf8');
  } catch {}
}

// Only called once the update file is on disk - before that the download runs
// inside the launcher and is shown in the update overlay, so this window must
// not appear yet.
function startUpdateProgressWindow() {
  try {
    // Drop the state of a previous update, otherwise the new window would
    // instantly jump to "done" from the leftover file
    try { fs.unlinkSync(UPDATE_PROGRESS_FILE); } catch {}
    writeUpdateProgress('install', 15);
    const winScript = path.join(os.tmpdir(), 'crux-update-window.ps1');
    fs.writeFileSync(winScript, '\uFEFF' + fs.readFileSync(path.join(__dirname, 'update-window.ps1'), 'utf8'), 'utf8');
    spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-WindowStyle', 'Hidden', '-File', winScript], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return true;
  } catch (e) {
    updateLog('Failed to start update progress window: ' + (e && e.message));
    return false;
  }
}

// ── User data backup across updates (survives uninstall/reinstall) ──────────
const UPDATE_BACKUP_FILE = path.join(os.tmpdir(), 'crux-update-backup.json');
const UPDATE_INSTALLED_FLAG = path.join(os.tmpdir(), 'crux-update-installed.flag');

function backupUserDataForUpdate() {
  try {
    const data = {};
    for (const key of ['settings', 'accounts', 'profiles', 'mods', 'launched']) {
      try {
        data[key] = JSON.parse(fs.readFileSync(P[key], 'utf8'));
      } catch {}
    }
    fs.writeFileSync(UPDATE_BACKUP_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log('[UPDATE] User data backed up for update migration');
  } catch (e) {
    console.log('[UPDATE] Could not back up user data: ' + e.message);
  }
}

function restoreUserDataAfterUpdate() {
  if (!fs.existsSync(UPDATE_BACKUP_FILE)) return;
  // Only restore if the installer actually ran (flag written by the update batch).
  // Otherwise the update was interrupted and we must not overwrite current data.
  if (!fs.existsSync(UPDATE_INSTALLED_FLAG)) return;
  try {
    const data = JSON.parse(fs.readFileSync(UPDATE_BACKUP_FILE, 'utf8'));
    for (const key of Object.keys(data)) {
      if (!P[key] || data[key] === undefined || data[key] === null) continue;
      try {
        fs.writeFileSync(P[key], JSON.stringify(data[key], null, 2));
      } catch {}
    }
    fs.unlinkSync(UPDATE_BACKUP_FILE);
    fs.unlinkSync(UPDATE_INSTALLED_FLAG);
    console.log('[UPDATE] User data restored after update');
  } catch (e) {
    console.log('[UPDATE] Could not restore user data: ' + e.message);
  }
}

ipcMain.handle('download-and-install-update', async (e, downloadUrl, installerUrl, newVersion) => {
  if (IS_DEV_BUILD) throw new Error('Updates are disabled in dev builds');
  const isAsar = __dirname.endsWith('app.asar') || process.env.APPIMAGE;
  const send = (...a) => sendToWindows(...a);

  if (isAsar) {
    // Installed version: download installer, create batch script that waits for app to close, then run installer
    updateLog('Installed version detected — downloading installer...');
    const exeUrl = installerUrl || downloadUrl.replace(/Launcher\.zip$/i, 'Crux-Client-Installer.exe');
    updateLog(`Installer URL: ${exeUrl}`);
    const installerPath = path.join(base, 'Crux-Client-Installer.exe');

    // No progress window here on purpose: the download runs inside the launcher
    // and is shown in the update overlay. The window only appears once the
    // installer file is completely on disk.
    // Download installer with progress
    try {
      await new Promise((resolve, reject) => {
        const doRequest = (reqUrl) => {
          const lib = reqUrl.startsWith('https') ? https : http;
          const req = lib.get(reqUrl, { headers: { 'User-Agent': 'CruxClient' } }, res => {
            if (res.statusCode === 301 || res.statusCode === 302) return doRequest(res.headers.location);
            if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
            const total = parseInt(res.headers['content-length'], 10) || 0;
            let downloaded = 0;
            const ws = fs.createWriteStream(installerPath);
            res.on('data', chunk => {
              ws.write(chunk);
              downloaded += chunk.length;
              send('update-download-progress', { downloaded, total });
            });
            res.on('end', () => { ws.end(() => resolve()); });
            res.on('error', reject);
          }).on('error', reject);
          req.setTimeout(300000, () => { req.destroy(); reject(new Error('Download timeout')); });
          req.on('timeout', () => { req.destroy(); reject(new Error('Download timeout')); });
        };
        doRequest(exeUrl);
      });
    } catch (err) {
      updateLog('Installer download failed: ' + (err && err.message));
      throw err;
    }
    updateLog('Installer downloaded. Removing security block (Zone.Identifier)...');
    try {
      await new Promise((resolve, reject) => {
        exec(`powershell -NoProfile -WindowStyle Hidden -Command "Unblock-File -Path '${installerPath}'"`, { timeout: 10000, shell: true }, (err) => {
          if (err) updateLog('Unblock-File warning: ' + (err.message || err));
          resolve();
        });
      });
    } catch {}

    // Update file is complete - now the progress window may show up and take
    // over until the launcher comes back up
    startUpdateProgressWindow();

    // Tell the renderer the download is done and the installer window will take over
    send('update-install-start', { message: 'Download finished — installing now' });

    // Create a batch script that waits for the launcher to close, then runs the installer
    const launcherExe = path.basename(app.getPath('exe'));
    const batchPath = path.join(os.tmpdir(), 'crux-update-' + Date.now() + '.bat');
    // /S --updated = silent in-place update: the installer overwrites the app
    // files, the old version is NOT uninstalled first (profiles/accounts/settings
    // in %APPDATA%\Crux Client stay untouched).
    const batchContent = [
      '@echo off',
      ':waitloop',
      'timeout /t 1 /nobreak >nul',
      'tasklist /FI "IMAGENAME eq ' + launcherExe + '" 2>nul | find /I "' + launcherExe + '" >nul',
      'if %errorlevel%==0 goto waitloop',
      'start /wait "" "' + installerPath + '" /S --updated',
      'echo done > "%TEMP%\\crux-update-installed.flag"',
      'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%TEMP%\\crux-update-window.ps1" set launch',
      'start "" "' + path.dirname(app.getPath('exe')) + '\\' + launcherExe + '"',
      'del "%~f0"',
    ].join('\r\n');
    await fs.promises.writeFile(batchPath, batchContent, 'utf8');
    updateLog('Update batch script created. Closing launcher, installer window shows progress...');

    // Create a VBS wrapper to run the batch completely hidden (no console window)
    const vbsPath = path.join(os.tmpdir(), 'crux-update-hidden-' + Date.now() + '.vbs');
    const vbsContent = 'Set s = CreateObject("WScript.Shell")\r\ns.Run "cmd /c """ & WScript.Arguments(0) & """", 0, False\r\n';
    await fs.promises.writeFile(vbsPath, vbsContent, 'utf8');

    // Start via VBS wrapper (completely hidden), then quit the app
    try {
      spawn('wscript.exe', [vbsPath, batchPath], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } catch (e) {
      updateLog('VBS spawn failed: ' + e.message + ', trying PowerShell fallback...');
      try {
        spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', 'Start-Process cmd -ArgumentList \'/c\', \'' + batchPath.replace(/\\/g, '\\\\') + '\' -WindowStyle Hidden'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      } catch (e2) {
        updateLog('All spawn methods failed: ' + e2.message);
      }
    }
    await new Promise(r => setTimeout(r, 500));
    if (newVersion) setUpdateState({ updatedTo: String(newVersion).replace(/^v/, '') });
    app.quit();
  } else {
    // Dev mode: extract zip over source files
    updateLog('Dev mode detected — extracting zip...');
    if (!JSZip) throw new Error('jszip module not available');
    const buffer = await downloadBuffer(downloadUrl);
    const zip = await JSZip.loadAsync(buffer);
    const appDir = __dirname;
    const keepFiles = ['node_modules', '.git', 'installer', 'scripts', 'exe', 'icons', 'client-mod', '.github', '.vscode', '.opencode'];
    const promises = [];
    zip.forEach((relativePath, zipEntry) => {
      if (zipEntry.dir) return;
      const parts = relativePath.split('/');
      if (parts.length > 1 && keepFiles.includes(parts[0])) return;
      if (parts[0] === 'package-lock.json') return;
      if (relativePath.includes('..')) return;
      const dest = path.join(appDir, relativePath);
      promises.push(zipEntry.async('nodebuffer').then(data => {
        return fs.promises.writeFile(dest, data);
      }));
    });
    await Promise.all(promises);
    if (newVersion) setUpdateState({ updatedTo: String(newVersion).replace(/^v/, '') });
    app.relaunch();
    app.quit();
  }
});

ipcMain.handle('update-window-skip', () => {
  try { if (updateWindow && !updateWindow.isDestroyed()) updateWindow.close(); } catch {}
  showMainWindow();
  return { ok: true };
});

// ── Uninstall ─────────────────────────────────────────────────────────────────
ipcMain.handle('uninstall-app', async () => {
  // Stop all servers
  stopAllServers();

  // Kill running MC instances
  for (const inst of Object.values(instances)) {
    if (inst.process && inst.process.pid) {
      try { exec(`taskkill /PID ${inst.process.pid} /F /T`, () => {}); } catch {}
    }
  }

  if (mainWindow) mainWindow.destroy();

  // Delete client data folder
  const dataDir = path.join(process.env.APPDATA || process.env.LOCALAPPDATA || '', 'Crux Client');
  try {
    if (fs.existsSync(dataDir)) {
      await fs.promises.rm(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
    }
  } catch (e) {
    console.error('[Uninstall] Failed to delete data dir:', e.message);
  }

  // Find and run the NSIS uninstaller
  const exePath = app.getPath('exe');
  const appDir = path.dirname(exePath);
  const exeName = path.basename(exePath, '.exe');
  const uninstallName = `Uninstall ${exeName}.exe`;

  // Common installation directories
  const candidates = [
    path.join(appDir, uninstallName),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Crux Client', uninstallName),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', exeName, uninstallName),
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Crux Client', uninstallName),
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', exeName, uninstallName),
  ];

  for (const uninstallPath of candidates) {
    if (fs.existsSync(uninstallPath)) {
      try {
        // _?= prefix tells NSIS to run from its own directory for proper self-deletion
        const cmd = `"${uninstallPath}" _?="${path.dirname(uninstallPath)}"`;
        exec(cmd, (err) => {
          if (err) console.error('[Uninstall] Uninstaller error:', err.message);
          app.quit();
        });
        return;
      } catch (e) {
        console.error('[Uninstall] Failed to launch uninstaller:', e.message);
      }
    }
  }

  // No uninstaller found – just quit
  console.error('[Uninstall] No uninstaller found at any known location');
  app.quit();
});

// ── System info ──────────────────────────────────────────────────────────────
ipcMain.handle('get-total-ram', () => Math.round(os.totalmem() / (1024 * 1024 * 1024)));

// ── Servers ────────────────────────────────────────────────────────────────────
const serverProcesses = {}; // { serverId: { process, logs, status, config } }
let serverCounter = 0;

const serversPath = path.join(base, 'servers.json');
const loadServers = async () => { try { return JSON.parse(await fs.promises.readFile(serversPath, 'utf8')); } catch { return []; } };
const saveServers = async (data) => { try { await fs.promises.writeFile(serversPath, JSON.stringify(data, null, 2)); } catch {} };

ipcMain.handle('load-servers', async () => loadServers());
ipcMain.on('save-servers', async (e, data) => saveServers(data));

// Get server JAR download URL for a MC version
async function getServerJarUrl(mcVersion, serverType = 'vanilla') {
  if (serverType === 'vanilla') {
    const manifest = await fetchJson('https://launchermeta.mojang.com/mc/game/version_manifest.json');
    const ver = manifest.versions.find(v => v.id === mcVersion);
    if (!ver) throw new Error('Version not found: ' + mcVersion);
    const verJson = await fetchJson(ver.url);
    return verJson.downloads?.server?.url || null;
  }
  if (serverType === 'paper') {
    const builds = await fetchJson(`https://api.papermc.io/v2/projects/paper/versions/${mcVersion}/builds`);
    if (!builds || !builds.builds || !builds.builds.length) throw new Error('No Paper builds for ' + mcVersion);
    const latest = builds.builds[builds.builds.length - 1];
    return `https://api.papermc.io/v2/projects/paper/versions/${mcVersion}/builds/${latest.build}/downloads/${latest.downloads.application.name}`;
  }
  if (serverType === 'spigot') {
    const resp = await fetch(`https://hub.spigotmc.org/jenkins/job/Spigot-API/lastSuccessfulBuild/api/json`);
    const data = await resp.json();
    if (!data.artifacts || !data.artifacts.length) throw new Error('Could not get Spigot build info');
    return `https://hub.spigotmc.org/jenkins/job/Spigot-API/lastSuccessfulBuild/artifact/target/Spigot-API.jar`;
  }
  if (serverType === 'purpur') {
    const builds = await fetchJson(`https://api.purpurmc.org/v2/purpur/${mcVersion}/latest`);
    if (!builds || !builds.build) throw new Error('No Purpur builds for ' + mcVersion);
    return `https://api.purpurmc.org/v2/purpur/${mcVersion}/${builds.build}/download`;
  }
  if (serverType === 'fabric') {
    const installerMeta = await fetchJson('https://meta.fabricmc.net/v2/versions/loader');
    const loader = installerMeta[0];
    return `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${loader.version}/server/jar`;
  }
  if (serverType === 'quilt') {
    const loaderMeta = await fetchJson(`https://meta.quiltmc.net/v3/versions/loader/${mcVersion}`);
    if (!loaderMeta || !loaderMeta.length) throw new Error('No Quilt loader for ' + mcVersion);
    return `https://meta.quiltmc.net/v3/versions/loader/${mcVersion}/${loaderMeta[0].loader.version}/server/jar`;
  }
  if (serverType === 'neoforge') {
    const latestNeoVer = await getNeoForgeLatestVersion(mcVersion);
    if (!latestNeoVer) throw new Error('No NeoForge for ' + mcVersion);
    return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${latestNeoVer}/neoforge-${latestNeoVer}-installer.jar`;
  }
  if (serverType === 'forge') {
    const installer = await fetchJson(`https://files.minecraftforge.net/net/minecraftforge/forge/index_${mcVersion}.html`);
    if (installer && installer.includes) {
      // Forge installer download is complex; use a known URL pattern
    }
    throw new Error('Forge server setup requires manual jar download. Please download the forge installer from files.minecraftforge.net and place it as server.jar in the server folder.');
  }
  return null;
}

// Start a Minecraft server
ipcMain.on('start-server', async (event, serverConfig) => {
  const { id, name, port, mcVersion, maxPlayers, ram, gamemode, onlineMode, pvp, type, plugins, modpackLoader } = serverConfig;
  const effectiveType = type === 'modpack' ? (modpackLoader || 'fabric') : type;

  // Check if another server is already running
  const running = Object.values(serverProcesses).find(s => s.status === 'running');
  if (running) {
    mainWindow.webContents.send('server-error', { id, error: `Server "${running.config.name}" is already running. Stop it first.` });
    return;
  }

  const serverDir = path.join(base, 'servers', `server-${id}`);
  await fs.promises.mkdir(serverDir, { recursive: true }).catch(() => {});

  // Download server jar if not present
  const jarPath = path.join(serverDir, 'server.jar');
  if (!fs.existsSync(jarPath)) {
    try {
      mainWindow.webContents.send('server-log', { id, line: `[SERVER] Downloading ${type || 'vanilla'} server jar for MC ${mcVersion}...` });
      const url = await getServerJarUrl(mcVersion, effectiveType);
      if (!url) throw new Error('No server jar URL found');
      await downloadFile(url, jarPath);
      mainWindow.webContents.send('server-log', { id, line: `[SERVER] Server jar downloaded.` });
    } catch (e) {
      mainWindow.webContents.send('server-error', { id, error: 'Failed to download server jar: ' + e.message });
      return;
    }
  }

  // Accept EULA
  const eulaPath = path.join(serverDir, 'eula.txt');
  if (!fs.existsSync(eulaPath)) {
    await fs.promises.writeFile(eulaPath, 'eula=true\n');
  }

  // Download server mods/plugins
  const isPlugin = ['paper','spigot','purpur'].includes(type);
  const modsDir = path.join(serverDir, isPlugin ? 'plugins' : 'mods');
  if (plugins && plugins.length) {
    await fs.promises.mkdir(modsDir, { recursive: true }).catch(() => {});
    for (const mod of plugins) {
      try {
        mainWindow.webContents.send('server-log', { id, line: `[SERVER] ${isPlugin ? 'Plugin' : 'Mod'}: ${mod.name}...` });
        const loader = isPlugin ? 'paper' : type;
        const gv = mcVersion ? `[\"${mcVersion}\"]` : '[]';
        const ld = loader ? `[\"${loader}\"]` : '[]';
        let versions = await fetchJson(`https://api.modrinth.com/v2/project/${mod.id}/version?game_versions=${gv}&loaders=${ld}`).catch(() => null);
        if (!versions || !versions.length) versions = await fetchJson(`https://api.modrinth.com/v2/project/${mod.id}/version`).catch(() => null);
        if (versions && versions.length && versions[0].files && versions[0].files.length) {
          const file = versions[0].files[0];
          const dest = path.join(modsDir, file.filename);
          await deployModCachedOrDownload({
            url: file.url,
            cacheName: modrinthCacheName(mod.id, versions[0], file),
            dest,
            label: mod.name || mod.id,
            log: line => mainWindow.webContents.send('server-log', { id, line: line.replace(/^\[CACHE\]\s*/, '[SERVER] Cache: ') })
          });
        } else {
          mainWindow.webContents.send('server-log', { id, line: `[SERVER] ⚠ No compatible version found for ${mod.name}, skipping.` });
        }
      } catch (e) {
        mainWindow.webContents.send('server-log', { id, line: `[SERVER] ⚠ Failed to download ${mod.name}: ${e.message}` });
      }
    }
  }

  // Write server.properties
  const props = [
    `server-port=${port || 25565}`,
    `server-ip=0.0.0.0`,
    `max-players=${maxPlayers || 20}`,
    `gamemode=${gamemode || 'survival'}`,
    `online-mode=${onlineMode !== false}`,
    `pvp=${pvp !== false}`,
    `level-name=${serverConfig.levelName || 'world'}`,
    `level-type=${serverConfig.levelType || 'minecraft:normal'}`,
    `spawn-protection=${serverConfig.spawnProtection != null ? serverConfig.spawnProtection : 0}`,
    `view-distance=${serverConfig.viewDistance || 10}`,
    `simulation-distance=${serverConfig.simDistance || 10}`,
    `enable-command-block=${serverConfig.cmdblocks !== false}`,
    `difficulty=${serverConfig.difficulty || 'normal'}`,
    `motd=${serverConfig.motd || name || 'Crux Server'}`,
    `allow-flight=${serverConfig.allowFlight === true}`,
    `spawn-animals=${serverConfig.spawnAnimals !== false}`,
    `spawn-monsters=${serverConfig.spawnMonsters !== false}`,
    `spawn-npcs=${serverConfig.spawnNpcs !== false}`,
    `allow-nether=${serverConfig.allowNether !== false}`,
    `force-gamemode=${serverConfig.forceGamemode === true}`,
    `player-idle-timeout=${serverConfig.idleTimeout || 0}`,
    `max-tick-time=${serverConfig.maxTickTime || 60000}`,
    `op-permission-level=${serverConfig.opLevel || 4}`,
    `network-compression-threshold=${serverConfig.compression != null ? serverConfig.compression : 256}`,
    `entity-broadcast-range-percentage=${serverConfig.broadcastRange || 100}`,
    `enforce-whitelist=${serverConfig.whitelist === true}`,
    `white-list=${serverConfig.whitelist === true}`,
    `prevent-proxy-connections=${serverConfig.preventProxy === true}`,
    `sync-chunk-writes=${serverConfig.syncChunks !== false}`,
    `rate-limit=${serverConfig.rateLimit || 0}`,
    `level-seed=${serverConfig.seed || ''}`,
    `max-world-size=${(serverConfig.viewDistance || 10) * 2}`,
  ].join('\n');
  await fs.promises.writeFile(path.join(serverDir, 'server.properties'), props);

  // Find Java — pick the version that matches what MC needs
  let javaPath = null;
  let needed = 8;
  try {
    const manifest = await fetchJson('https://launchermeta.mojang.com/mc/game/version_manifest.json');
    const vInfo = manifest.versions.find(v => v.id === mcVersion);
    if (vInfo) {
      const vJson = await fetchJson(vInfo.url);
      if (vJson && vJson.javaVersion && vJson.javaVersion.majorVersion) needed = vJson.javaVersion.majorVersion;
    }
  } catch {}
  // Fallback for snapshots/new versions not in manifest
  if (needed < 17) {
    const verParts = mcVersion.split('.');
    const minor = parseInt(verParts[1]) || 0;
    if (minor >= 26) needed = 25;
    else if (minor >= 25) needed = 24;
    else if (minor >= 22) needed = 23;
    else if (minor >= 21) needed = 21;
    else if (minor >= 17) needed = 17;
  }
  try {
    const javas = await findInstalledJavas();
    mainWindow.webContents.send('server-log', { id, line: `[SERVER] Need Java ${needed}+, found: ${javas.map(j=>`Java${j.version}`).join(', ')||'none'}` });
    // Pick newest Java that is >= needed
    let valid = javas.filter(j => (parseInt(j.version)||0) >= needed);

    // Auto-download from Adoptium if none found
    if (!valid.length) {
      const dlVer = Math.min(Math.max(needed, 17), 21);
      mainWindow.webContents.send('server-log', { id, line: `[SERVER] No Java ${needed}+ found. Downloading Java ${dlVer} from Adoptium...` });
      try {
        const assets = await fetchJson(`https://api.adoptium.net/v3/assets/latest/${dlVer}/hotspot?os=windows&arch=x64&image_type=jre&heap_size=normal&vendor=eclipse`);
        if (!assets || !assets.length) throw new Error('No Adoptium assets');
        const asset = assets.find(a => a.binary.package.link.endsWith('.zip')) || assets[0];
        const url = asset.binary.package.link;
        const fn = path.basename(url.split('?')[0]);
        const fp = path.join(base, fn);
        const extractTo = path.join(P.java, `jre-${dlVer}`);
        const javaExeFound = findJavaExe(extractTo);
        if (javaExeFound) {
          // Already installed, reuse
          valid = [{ path: javaExeFound, version: String(dlVer) }];
        } else {
          if (!fs.existsSync(fp)) await downloadFile(url, fp);
          const AdmZip = require('adm-zip');
          await fs.promises.mkdir(extractTo, { recursive: true });
          new AdmZip(fp).extractAllTo(extractTo, true);
          const found = findJavaExe(extractTo);
          if (found) {
            valid = [{ path: found, version: String(dlVer) }];
            mainWindow.webContents.send('server-log', { id, line: `[SERVER] Java ${dlVer} downloaded and ready.` });
          }
        }
      } catch (dlErr) {
        mainWindow.webContents.send('server-log', { id, line: `[SERVER] ⚠ Auto-download failed: ${dlErr.message}` });
      }
    }

    if (valid.length) {
      valid.sort((a,b) => {
        const va=parseInt(a.version)||0, vb=parseInt(b.version)||0;
        const aLts = (va===21||va===17) ? 1 : 0;
        const bLts = (vb===21||vb===17) ? 1 : 0;
        if (aLts !== bLts) return bLts - aLts;
        return vb - va;
      });
      javaPath = valid[0].path;
    } else if (javas.length) {
      javas.sort((a,b) => parseInt(b.version) - parseInt(a.version));
      javaPath = javas[0].path;
      mainWindow.webContents.send('server-log', { id, line: `[SERVER] ⚠ No Java ${needed}+ found, using Java ${javas[0].version} (may not work)` });
    }
  } catch {}
  if (!javaPath) {
    mainWindow.webContents.send('server-error', { id, error: 'No Java installation found.' });
    return;
  }

  // Add Windows Firewall rule for LAN access
  const cp = require('child_process');
  try {
    const fwPort = String(port || 25565);
    cp.spawn('netsh', ['advfirewall', 'firewall', 'add', 'rule', `name=Crux Server ${fwPort}`, 'dir=in', 'action=allow', 'protocol=TCP', `localport=${fwPort}`], { shell: true, stdio: 'ignore' });
  } catch {}

  // Start server process
  const serverRam = Math.max(1, Math.min(8, parseInt(ram) || 2));
  const args = [
    `-Xmx${serverRam}G`, `-Xms${Math.max(1, Math.floor(serverRam / 2))}G`,
    '-jar', `"${jarPath}"`,
    'nogui',
    '-port', String(port || 25565),
  ];

  // Kill leftover java processes that still lock this server's files
  // (orphans from a previous launcher session would block session.lock / latest.log)
  await killOrphanedServerProcesses(serverDir);

  const proc = cp.spawn(`"${javaPath}"`, args, {
    cwd: serverDir,
    shell: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  serverProcesses[id] = {
    process: proc,
    logs: [],
    status: 'running',
    config: serverConfig,
    startTime: Date.now(),
  };

  mainWindow.webContents.send('server-started', { id, startTime: Date.now() });
  mainWindow.webContents.send('server-log', { id, line: `[SERVER] Starting MC ${mcVersion} on port ${port || 25565}...` });

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    for (const line of lines) {
      serverProcesses[id].logs.push(line);
      mainWindow.webContents.send('server-log', { id, line });
    }
  });
  proc.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    for (const line of lines) {
      serverProcesses[id].logs.push('[ERR] ' + line);
      mainWindow.webContents.send('server-log', { id, line: '[ERR] ' + line });
    }
  });
  proc.on('close', (code) => {
    if (serverProcesses[id]) {
      serverProcesses[id].status = 'stopped';
      mainWindow.webContents.send('server-log', { id, line: `[SERVER] Stopped (code ${code})` });
      mainWindow.webContents.send('server-stopped', { id, code });
    }
  });
  proc.on('error', (err) => {
    if (serverProcesses[id]) {
      serverProcesses[id].status = 'stopped';
      mainWindow.webContents.send('server-error', { id, error: err.message });
    }
  });
});

// Stop a server
ipcMain.on('stop-server', (event, serverId) => {
  const srv = serverProcesses[serverId];
  if (!srv || !srv.process) return;
  try {
    // Send "stop" command first for graceful shutdown
    srv.process.stdin.write('stop\n');
    // Force kill after 5 seconds if still running
    setTimeout(() => {
      if (srv.process && srv.status === 'running') {
        try { srv.process.kill('SIGKILL'); } catch {}
        try { srv.process.kill(); } catch {}
        if (srv.process.pid) {
          try { process.kill(srv.process.pid, 'SIGKILL'); } catch {}
          try { require('child_process').exec(`taskkill /PID ${srv.process.pid} /F /T`, () => {}); } catch {}
        }
      }
    }, 5000);
  } catch {}
});

// Send command to server
ipcMain.on('server-command', (event, { serverId, command }) => {
  const srv = serverProcesses[serverId];
  if (!srv || !srv.process || srv.status !== 'running') return;
  try {
    srv.process.stdin.write(command + '\n');
    srv.logs.push(`> ${command}`);
    mainWindow.webContents.send('server-log', { serverId, line: `> ${command}` });
  } catch {}
});

// Get server status
ipcMain.handle('get-server-status', (event, serverId) => {
  const srv = serverProcesses[serverId];
  if (!srv) return { status: 'stopped' };
  return { status: srv.status, logs: srv.logs.slice(-200) };
});

// Weltname -> Save-Ordner (Recent > Welten: damit "--quickPlaySingleplayer" greift)
ipcMain.handle('resolve-save-folder', (event, worldName, profileId) => {
  try { return resolveSaveFolder(worldName, profileId ? instanceDir(profileId) : undefined); } catch { return null; }
});

// ── Server Whitelist IPC ────────────────────────────────────────────────────────
ipcMain.handle('get-server-whitelist', async (event, serverId) => {
  const wlPath = path.join(base, 'servers', `server-${serverId}`, 'whitelist.json');
  try { return JSON.parse(await fs.promises.readFile(wlPath, 'utf8')); } catch { return []; }
});
ipcMain.handle('add-server-whitelist', async (event, { serverId, player }) => {
  const wlPath = path.join(base, 'servers', `server-${serverId}`, 'whitelist.json');
  let list = [];
  try { list = JSON.parse(await fs.promises.readFile(wlPath, 'utf8')); } catch {}
  if (!list.includes(player)) {
    list.push(player);
    await fs.promises.writeFile(wlPath, JSON.stringify(list, null, 2));
  }
  // Also whitelist on running server via command
  const srv = serverProcesses[serverId];
  if (srv && srv.status === 'running' && srv.process) {
    try { srv.process.stdin.write(`whitelist add ${player}\n`); } catch {}
  }
  return list;
});
ipcMain.handle('remove-server-whitelist', async (event, { serverId, player }) => {
  const wlPath = path.join(base, 'servers', `server-${serverId}`, 'whitelist.json');
  let list = [];
  try { list = JSON.parse(await fs.promises.readFile(wlPath, 'utf8')); } catch {}
  list = list.filter(p => p !== player);
  await fs.promises.writeFile(wlPath, JSON.stringify(list, null, 2));
  const srv = serverProcesses[serverId];
  if (srv && srv.status === 'running' && srv.process) {
    try { srv.process.stdin.write(`whitelist remove ${player}\n`); } catch {}
  }
  return list;
});
ipcMain.handle('upload-server-rp', async (event, { serverId, filename, data }) => {
  const rpDir = path.join(base, 'servers', `server-${serverId}`, 'resourcepacks');
  await fs.promises.mkdir(rpDir, { recursive: true }).catch(() => {});
  const dest = path.join(rpDir, filename);
  await fs.promises.writeFile(dest, Buffer.from(data));
  return true;
});

// ── Modpack download IPC (no CORS) ─────────────────────────────────────────────
function fetchBufferToPath(url, destPath) {
  return new Promise((r, rj) => {
    const go = (u, hops = 0) => {
      if (hops > 5) return rj(new Error('Too many redirects'));
      const lib = u.startsWith('https') ? https : http;
      const reqUrl = new URL(u);
      const opts = { hostname: reqUrl.hostname, path: reqUrl.pathname + reqUrl.search, method: 'GET',
        headers: { 'User-Agent': 'CruxClient/1.0' }
      };
      const req = lib.request(opts, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { go(res.headers.location, hops + 1); return; }
        if (res.statusCode !== 200) return rj(new Error('HTTP ' + res.statusCode + ' for ' + u.slice(0, 80)));
        const f = fs.createWriteStream(destPath);
        res.pipe(f);
        f.on('finish', () => { f.close(() => r(destPath)); });
        f.on('error', rj);
      }).on('error', rj);
      req.setTimeout(120000, () => { req.destroy(); rj(new Error('Download timeout')); });
      req.end();
    };
    go(url);
  });
}
function fetchJsonNoCors(url) {
  return new Promise((r, rj) => {
    const lib = url.startsWith('https') ? https : http;
    const u = new URL(url);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { 'User-Agent': 'CruxClient/1.0 (https://github.com/crux-client)', 'Accept': 'application/json' }
    };
    const req = lib.request(opts, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchJsonNoCors(res.headers.location).then(r).catch(rj); return;
      }
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { r(JSON.parse(d)); } catch (e) { rj(new Error('JSON parse error: ' + d.slice(0, 200))); } });
    }).on('error', rj);
    req.setTimeout(30000, () => { req.destroy(); rj(new Error('Timeout')); });
    req.end();
  });
}
ipcMain.handle('fetch-json-no-cors', async (e, url) => { logDebug('fetchJsonNoCors: ' + url); return fetchJsonNoCors(url); });
// Bekannt kaputte Mods (MC-Version + Loader) — der Plan-Generator filtert sie.
ipcMain.handle('get-broken-mods', async (e, version, loader) => {
  const list = await load(P.broken, []);
  const ids = [];
  for (const entry of list) {
    if (!entry || entry.v !== version || entry.l !== loader) continue;
    for (const id of (Array.isArray(entry.ids) ? entry.ids : [])) {
      const s = String(id || '').trim();
      if (s && !ids.includes(s)) ids.push(s);
    }
  }
  return ids;
});
ipcMain.handle('check-online', () => isNetworkAvailable());
ipcMain.handle('fetch-image-dataurl', async (e, url) => {
  logDebug('fetchImageDataUrl: ' + url);
  const tmpFile = path.join(base, 'Cache', `img_${Date.now()}_${Math.random().toString(36).slice(2,8)}`);
  await fetchBufferToPath(url, tmpFile);
  const buf = fs.readFileSync(tmpFile);
  fs.unlinkSync(tmpFile);
  let ext = 'image/jpeg';
  if (buf.length >= 8) {
    const magic = buf.slice(0, 8).toString('hex');
    if (magic.startsWith('89504e470d0a1a0a')) ext = 'image/png';
    else if (magic.startsWith('ffd8ff')) ext = 'image/jpeg';
    else if (magic.startsWith('47494638')) ext = 'image/gif';
    else if (magic.startsWith('524946')) ext = 'image/webp';
  }
  return `data:${ext};base64,` + buf.toString('base64');
});
ipcMain.handle('fetch-buffer', async (e, url) => {
  logDebug('fetchBuffer: ' + url);
  const tmpFile = path.join(base, 'Cache', `dl_${Date.now()}_${Math.random().toString(36).slice(2,8)}`);
  await fetchBufferToPath(url, tmpFile);
  const size = fs.statSync(tmpFile).size;
  logDebug('fetchBuffer done: ' + size + ' bytes -> ' + tmpFile);
  return tmpFile;
});
ipcMain.handle('delete-temp', async (e, filePath) => {
  try { await fs.promises.unlink(filePath); } catch {}
});
ipcMain.on('renderer-log', (e, msg) => { logDebug('[RENDERER] ' + msg); });

// ── playit.gg (free tunnel / custom domain for servers) ─────────────────────
const PLAYIT_AGENT_VERSION = '0.17.1';
const PLAYIT_DOWNLOAD_URL = 'https://github.com/playit-cloud/playit-agent/releases/download/v0.17.1/playit-windows-x86_64-signed.exe';
const PLAYIT_DIR = path.join(base, 'playit');
const PLAYIT_EXE = path.join(PLAYIT_DIR, 'playit.exe');
const PLAYIT_LOG = path.join(PLAYIT_DIR, 'playit.log');
const PLAYIT_API = 'https://api.playit.gg';
let playitProcess = null;

function playitConfigPath() {
  const local = process.env.LOCALAPPDATA || path.join(process.env.APPDATA || '', '..', 'Local');
  return path.join(local, 'playit_gg', 'playit.toml');
}
function readPlayitSecret() {
  try {
    const p = playitConfigPath();
    if (!fs.existsSync(p)) return null;
    let c = fs.readFileSync(p, 'utf8').trim();
    if (c.includes('=')) {
      const m = c.match(/secret_key\s*=\s*"([^"]+)"/) || c.match(/secret_key\s*=\s*'([^']+)'/);
      if (!m) return null;
      c = m[1].trim();
    }
    return /^[0-9a-fA-F]{16,}$/.test(c) ? c : null;
  } catch { return null; }
}
function writePlayitSecret(secret) {
  fs.mkdirSync(path.dirname(playitConfigPath()), { recursive: true });
  fs.writeFileSync(playitConfigPath(), 'secret_key = "' + secret + '"\n');
}
function playitApi(path_, body, secret) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body || {});
    const u = new URL(PLAYIT_API + path_);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Crux-Launcher'
    };
    if (secret) headers['Authorization'] = 'agent-key ' + secret;
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(new Error('playit parse error: ' + d.slice(0, 200))); }
      });
    });
    req.on('error', reject); req.write(payload); req.end();
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('playit api timeout')); });
  });
}
function stopPlayitAgent() {
  if (playitProcess && playitProcess.exitCode === null) {
    try { playitProcess.kill(); } catch {}
    playitProcess = null;
  }
}

ipcMain.handle('playit-download', async (e) => {
  try { if (fs.existsSync(PLAYIT_EXE) && fs.statSync(PLAYIT_EXE).size > 1000000) return { ok: true, path: PLAYIT_EXE }; } catch {}
  fs.mkdirSync(PLAYIT_DIR, { recursive: true });
  try {
    await downloadFile(PLAYIT_DOWNLOAD_URL, PLAYIT_EXE, (p) => {
      if (e.sender) e.sender.send('playit-download-progress', Math.round(p));
    });
    return { ok: true, path: PLAYIT_EXE };
  } catch (err) {
    logDebug('playit download failed: ' + err.message);
    return { ok: false, error: err.message };
  }
});
function playitTunnelTargetPort(t) {
  if (!t) return null;
  if (t.target != null) {
    const tg = t.target;
    if (typeof tg === 'number') return tg;
    if (typeof tg === 'object') return tg.port != null ? Number(tg.port) : null;
    const m = String(tg).match(/:(\d+)\s*$/);
    return m ? Number(m[1]) : null;
  }
  const fields = t.agent_config && t.agent_config.fields;
  if (Array.isArray(fields)) {
    const lp = fields.find(f => f && f.name === 'local_port' || f && f.name === 'localPort');
    if (lp && lp.value != null) return Number(lp.value);
  }
  return null;
}
ipcMain.handle('playit-status', async () => {
  const secret = readPlayitSecret();
  let claimed = !!secret, running = false, addresses = [], tunnels = [], agentId = null, accountUrl = null, error = null;
  if (playitProcess && playitProcess.exitCode === null) running = true;
  if (secret) {
    try {
      const res = await playitApi('/v1/agents/rundata', {}, secret);
      if (res.status === 'success' && res.data) {
        agentId = res.data.agent_id;
        addresses = (res.data.tunnels || []).map(t => t.display_address).filter(Boolean);
        tunnels = (res.data.tunnels || []).map(t => ({ address: t.display_address, targetPort: playitTunnelTargetPort(t) })).filter(t => t.address);
        accountUrl = 'https://playit.gg/account/agents/' + agentId;
      } else {
        error = (res.data && res.data.type) || 'playit-api-error';
        claimed = false;
      }
    } catch (err) { error = err.message; }
  }
  return { claimed, running, addresses, tunnels, agentId, accountUrl, error, secretExists: !!secret };
});
ipcMain.handle('playit-claim-begin', async () => {
  const code = crypto.randomBytes(5).toString('hex');
  return { code, url: 'https://playit.gg/claim/' + code };
});
ipcMain.handle('playit-claim-poll', async (e, code) => {
  try {
    const setup = await playitApi('/claim/setup', { code, agent_type: 'assignable', version: 'playit-cli ' + PLAYIT_AGENT_VERSION });
    const state = setup.status === 'success' ? setup.data : null;
    if (state === 'UserAccepted') {
      const exch = await playitApi('/claim/exchange', { code });
      if (exch.status === 'success' && exch.data && exch.data.secret_key) {
        writePlayitSecret(exch.data.secret_key);
        return { state: 'accepted' };
      }
      return { state: 'error', message: 'exchange failed' };
    }
    return { state: (state === 'WaitingForUserVisit' || state === 'WaitingForUser') ? 'waiting' : (state || 'error'), message: state === 'UserRejected' ? 'rejected' : undefined };
  } catch (err) { return { state: 'error', message: err.message }; }
});
ipcMain.handle('playit-start', async () => {
  const secret = readPlayitSecret();
  if (!secret) return { ok: false, error: 'not-claimed' };
  if (playitProcess && playitProcess.exitCode === null) return { ok: true, pid: playitProcess.pid };
  if (!fs.existsSync(PLAYIT_EXE)) return { ok: false, error: 'not-downloaded' };
  let logFds = [];
  try {
    logFds = [fs.openSync(PLAYIT_LOG, 'a'), fs.openSync(PLAYIT_LOG, 'a')];
  } catch (err) { return { ok: false, error: 'could not open playit log: ' + err.message }; }
  try {
    playitProcess = spawn(PLAYIT_EXE, ['--stdout'], { stdio: ['ignore', logFds[0], logFds[1]], windowsHide: true });
    playitProcess.on('exit', () => {
      for (const fd of logFds) { try { fs.closeSync(fd); } catch {} }
      playitProcess = null;
    });
  } catch (err) {
    for (const fd of logFds) { try { fs.closeSync(fd); } catch {} }
    return { ok: false, error: err.message };
  }
  return { ok: true, pid: playitProcess.pid };
});
ipcMain.handle('playit-create-tunnel', async (e, opts) => {
  const secret = readPlayitSecret();
  if (!secret) return { ok: false, error: 'not-claimed' };
  const port = opts && opts.port ? Number(opts.port) : 25565;
  const name = (opts && opts.name) || 'Crux Server';
  try {
    const rd = await playitApi('/v1/agents/rundata', {}, secret);
    if (rd.status !== 'success') {
      const t = rd.data && rd.data.type;
      return { ok: false, error: (t === 'auth' ? 'invalid-secret' : t) || 'rundata-failed' };
    }
    const agentId = rd.data.agent_id;
    const buildReq = (withPort) => ({
      name,
      protocol: { type: 'tunnel-type', details: 'minecraft-java' },
      origin: {
        type: 'agent',
        data: {
          agent_id: agentId,
          config: { fields: [{ name: 'local_ip', value: '127.0.0.1' }].concat(withPort ? [{ name: 'local_port', value: String(port) }] : []) }
        }
      },
      endpoint: { type: 'region', details: { region: 'global', port: null } },
      enabled: true
    });
    let created = await playitApi('/v1/tunnels/create', buildReq(true), secret);
    if (!(created.status === 'success' && created.data && created.data.id)) {
      created = await playitApi('/v1/tunnels/create', buildReq(false), secret);
    }
    if (!(created.status === 'success' && created.data && created.data.id)) {
      const authMsg = created.data && created.data.type === 'auth' ? (created.data.message || '') : '';
      if (authMsg) {
        return { ok: false, error: 'auth', message: authMsg, agentId };
      }
      const t = created.data && created.data.type;
      return { ok: false, error: (t === 'auth' ? 'invalid-secret' : t) || 'create-failed' };
    }
    const tunnelId = created.data.id;
    let address = null;
    for (let i = 0; i < 20 && !address; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const rd2 = await playitApi('/v1/agents/rundata', {}, secret);
      if (rd2.status === 'success') {
        const t = (rd2.data.tunnels || []).find(x => x.id === tunnelId);
        if (t && t.display_address) address = t.display_address;
      }
    }
    return { ok: true, tunnelId, address };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('playit-stop', async () => {
  stopPlayitAgent();
  return { ok: true };
});
ipcMain.handle('playit-log', async () => {
  try { return fs.readFileSync(PLAYIT_LOG, 'utf8').slice(-4000); } catch { return ''; }
});

ipcMain.handle('save-mrpack-mods', async (e, { profileId, files }) => {
  const dir = path.join(base, 'modpacks', profileId);
  await fs.promises.mkdir(dir, { recursive: true });
  const results = [];
  for (const f of files) {
    const dest = path.join(dir, f.fileName);
    try { await fs.promises.copyFile(f.tempPath, dest); results.push({ ...f, diskPath: dest }); }
    catch(err) { logDebug('save-mrpack-mods copy failed: ' + f.fileName + ' ' + err.message); }
    try { await fs.promises.unlink(f.tempPath); } catch {}
  }
  return results;
});

ipcMain.handle('open-profile-folder', async (e, profileId) => {
  try {
    const dir = instanceDir(profileId);
    await fs.promises.mkdir(dir, { recursive: true });
    shell.openPath(dir);
    return { ok: true };
  } catch (err) {
    logDebug('open-profile-folder failed: ' + err.message);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('get-loader-icon', async (event, loader) => {
  try {
    const iconPath = path.join(__dirname, 'icons', 'loader-icons', loader + '.png');
    if (fs.existsSync(iconPath)) {
      const buf = fs.readFileSync(iconPath);
      // Detect MIME type from file signature
      let mime = 'image/png';
      if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
        mime = 'image/png';
      } else if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
        // RIFF/WebP
        if (buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
          mime = 'image/webp';
        }
      } else if (buf[0] === 0x3C && buf[1] === 0x3F) {
        // XML/SVG
        mime = 'image/svg+xml';
      } else if (buf[0] === 0x3C && buf[1] === 0x73) {
        // SVG starts with <s
        mime = 'image/svg+xml';
      }
      return { ok: true, dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64') };
    }
  } catch {}
  return { ok: false };
});

// Scan Modrinth App installations (local profiles)
ipcMain.handle('scan-modrinth-app', async () => {
  try {
    const appData = process.env.APPDATA || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    const possiblePaths = [
      path.join(appData, 'ModrinthApp', 'profiles'),
      path.join(localAppData, 'ModrinthApp', 'profiles'),
      path.join(appData, 'Modrinth', 'profiles'),
      path.join(localAppData, 'Modrinth', 'profiles'),
    ];
    const profiles = [];
    for (const basePath of possiblePaths) {
      if (!fs.existsSync(basePath)) continue;
      const dirs = fs.readdirSync(basePath).filter(d => {
        try { return fs.statSync(path.join(basePath, d)).isDirectory(); } catch { return false; }
      });
      for (const dir of dirs) {
        const instancePath = path.join(basePath, dir);
        const metaFile = path.join(instancePath, 'instance.json');
        if (!fs.existsSync(metaFile)) continue;
        try {
          const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
          profiles.push({
            id: 'modrinth-' + dir,
            name: meta.name || dir,
            gameVersion: meta.gameVersion || '',
            loader: meta.loader || 'fabric',
            path: instancePath,
            modsPath: path.join(instancePath, 'mods'),
            icon: meta.iconPath ? path.join(instancePath, meta.iconPath) : null,
            source: 'modrinth-app'
          });
        } catch (e) {
          logDebug('Failed to parse Modrinth instance ' + dir + ': ' + e.message);
        }
      }
    }
    return { ok: true, profiles };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Scan CurseForge App installations (local instances)
ipcMain.handle('scan-curseforge-app', async () => {
  try {
    const appData = process.env.APPDATA || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    const possiblePaths = [
      path.join(appData, 'CurseForge', 'Minecraft', 'Instances'),
      path.join(localAppData, 'CurseForge', 'Minecraft', 'Instances'),
      path.join(appData, 'Overwolf', 'CurseForge', 'Minecraft', 'Instances'),
      path.join(localAppData, 'Overwolf', 'CurseForge', 'Minecraft', 'Instances'),
    ];
    const profiles = [];
    for (const basePath of possiblePaths) {
      if (!fs.existsSync(basePath)) continue;
      const dirs = fs.readdirSync(basePath).filter(d => {
        try { return fs.statSync(path.join(basePath, d)).isDirectory(); } catch { return false; }
      });
      for (const dir of dirs) {
        const instancePath = path.join(basePath, dir);
        // CurseForge instances have a manifest.json or minecraftinstance.json
        const manifestFile = path.join(instancePath, 'manifest.json');
        const mcInstanceFile = path.join(instancePath, 'minecraftinstance.json');
        let meta = {};
        let metaFile = null;
        if (fs.existsSync(manifestFile)) {
          metaFile = manifestFile;
        } else if (fs.existsSync(mcInstanceFile)) {
          metaFile = mcInstanceFile;
        }
        if (!metaFile) continue;
        try {
          meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
        } catch (e) {
          logDebug('Failed to parse CurseForge instance ' + dir + ': ' + e.message);
          continue;
        }
        profiles.push({
          id: 'curseforge-' + dir,
          name: meta.name || meta.installName || dir,
          gameVersion: meta.minecraftVersion || meta.gameVersion || '',
          loader: meta.loader || meta.modLoader || 'forge',
          path: instancePath,
          modsPath: path.join(instancePath, 'mods'),
          icon: meta.logoPath ? path.join(instancePath, meta.logoPath) : null,
          source: 'curseforge-app'
        });
      }
    }
    return { ok: true, profiles };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Import CurseForge instance — copy mods to Crux profile
ipcMain.handle('import-curseforge-instance', async (event, instancePath) => {
  try {
    // Handle both instance path and mods path
    const modsPath = instancePath.endsWith('mods') ? instancePath : path.join(instancePath, 'mods');
    if (!fs.existsSync(modsPath)) return { ok: true, mods: [] };
    const modFiles = fs.readdirSync(modsPath).filter(f => f.endsWith('.jar'));
    const mods = [];
    for (const f of modFiles) {
      mods.push({
        name: f.replace(/\.jar$/i, ''),
        fileName: f,
        diskPath: path.join(modsPath, f),
        path: 'mods/' + f,
        source: 'CurseForge App', modrinthId: null, version: 'latest',
        mcVersion: '', iconUrl: '', downloadAllVersions: false, disabled: false, loader: 'forge'
      });
    }
    return { ok: true, mods };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Import Modrinth App profile — copy mods to Crux profile
ipcMain.handle('import-modrinth-instance', async (event, instancePath) => {
  try {
    // Handle both instance path and mods path
    const modsPath = instancePath.endsWith('mods') ? instancePath : path.join(instancePath, 'mods');
    if (!fs.existsSync(modsPath)) return { ok: true, mods: [] };
    const modFiles = fs.readdirSync(modsPath).filter(f => f.endsWith('.jar'));
    const mods = [];
    for (const f of modFiles) {
      mods.push({
        name: f.replace(/\.jar$/i, ''),
        fileName: f,
        diskPath: path.join(modsPath, f),
        path: 'mods/' + f,
        source: 'Modrinth App', modrinthId: null, version: 'latest',
        mcVersion: '', iconUrl: '', downloadAllVersions: false, disabled: false, loader: 'fabric'
      });
    }
    return { ok: true, mods };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('get-mc-textures', async (event, type) => {
  try {
    const yauzl = require('yauzl');
    const versionsDir = path.join(P.mc, 'versions');
    if (!fs.existsSync(versionsDir)) return { ok: false, error: 'Keine Versions-Verzeichnisse gefunden' };
    const versionDirs = fs.readdirSync(versionsDir).filter(d => {
      try { return fs.statSync(path.join(versionsDir, d)).isDirectory(); } catch { return false; }
    });
    const textures = [];
    const seen = new Set();
    // Process newest versions first
    versionDirs.sort((a, b) => {
      try { return fs.statSync(path.join(versionsDir, b)).mtimeMs - fs.statSync(path.join(versionsDir, a)).mtimeMs; } catch { return 0; }
    });
    for (const verDir of versionDirs) {
      const jarPath = path.join(versionsDir, verDir, verDir + '.jar');
      if (!fs.existsSync(jarPath)) continue;
      await new Promise((resolve) => {
        yauzl.open(jarPath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
          if (err) { resolve(); return; }
          zipfile.readEntry();
          zipfile.on('entry', (entry) => {
            const name = entry.fileName;
            const prefix = type === 'item' ? 'assets/minecraft/textures/item/' : 'assets/minecraft/textures/block/';
            if (!name.startsWith(prefix) || !name.endsWith('.png')) { zipfile.readEntry(); return; }
            const key = name.slice(prefix.length, -4);
            if (seen.has(key)) { zipfile.readEntry(); return; }
            seen.add(key);
            zipfile.openReadStream(entry, (err, readStream) => {
              if (err) { zipfile.readEntry(); return; }
              const chunks = [];
              readStream.on('data', c => chunks.push(c));
              readStream.on('end', () => {
                const buf = Buffer.concat(chunks);
                textures.push({ name: key, dataUrl: 'data:image/png;base64,' + buf.toString('base64'), version: verDir });
                zipfile.readEntry();
              });
              readStream.on('error', () => { zipfile.readEntry(); });
            });
          });
          zipfile.on('end', () => resolve());
        });
      });
      if (textures.length > 500) break; // limit to avoid hanging
    }
    return { ok: true, textures };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Kill any leftover java process still holding a server directory's locks
// (orphans from a previous launcher session keep session.lock / logs/latest.log)
function killOrphanedServerProcesses(serverDir) {
  return new Promise((resolve) => {
    const cp = require('child_process');
    const needle = String(serverDir || '').replace(/\//g, '\\').toLowerCase();
    if (!needle) return resolve();
    const ps = 'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name=\'java.exe\' or Name=\'javaw.exe\'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"';
    cp.exec(ps, { timeout: 8000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve();
      let procs = [];
      try {
        const parsed = JSON.parse(stdout);
        procs = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
      } catch { return resolve(); }
      const targets = procs.filter(p => p && p.ProcessId && (String(p.CommandLine || '').replace(/\//g, '\\').toLowerCase().includes(needle)));
      let pending = targets.length;
      if (!pending) return resolve();
      for (const t of targets) {
        cp.exec(`taskkill /PID ${t.ProcessId} /F /T`, { windowsHide: true }, () => { if (--pending <= 0) resolve(); });
      }
    });
  });
}

// Stop all servers (called on app quit)
function stopAllServers() {
  const cp = require('child_process');
  for (const [id, srv] of Object.entries(serverProcesses)) {
    if (srv.status === 'running' && srv.process) {
      try { srv.process.stdin.write('stop\n'); } catch {}
      // kill the whole tree (cmd.exe -> java), proc.kill alone leaves java orphans
      if (srv.process.pid) { try { cp.exec(`taskkill /PID ${srv.process.pid} /F /T`, () => {}); } catch {} }
      srv.status = 'stopped';
    }
  }
}

// ── HTTP helpers ───────────────────────────────────────────────────────────────
function postForm(url, params) {
  return new Promise((resolve, reject) => {
    const body = Object.entries(params).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const u = new URL(url);
    const req = https.request({ hostname:u.hostname, path:u.pathname, method:'POST',
      headers:{ 'Content-Type':'application/x-www-form-urlencoded', 'Content-Length':Buffer.byteLength(body) }
    }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{resolve(JSON.parse(d));}catch(e){reject(e);} }); });
    req.on('error', reject); req.write(body); req.end();
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout: '+url.slice(0,80))); });
  });
}
function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const b = JSON.stringify(body), u = new URL(url);
    const req = https.request({ hostname:u.hostname, path:u.pathname, method:'POST',
      headers:{ 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(b) }
    }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{resolve(JSON.parse(d));}catch(e){reject(e);} }); });
    req.on('error', reject); req.write(b); req.end();
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout: '+url.slice(0,80))); });
  });
}
function getJson(url, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ hostname:u.hostname, path:u.pathname, method:'GET',
      headers:{ 'Authorization':`Bearer ${token}` }
    }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{resolve(JSON.parse(d));}catch(e){reject(e);} }); });
    req.on('error', reject); req.end();
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout: '+url.slice(0,80))); });
  });
}
function fetchJson(url) {
  return new Promise((r,rj) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, res => {
      let d='';
      res.on('data',c=>d+=c);
      res.on('end',()=>{
        if(!d.trim()){ rj(new Error('Empty response from '+url.slice(0,80))); return; }
        try{r(JSON.parse(d));}catch(e){rj(new Error('JSON parse error: '+e.message+' body: '+d.slice(0,100)));}
      });
    }).on('error',rj);
    req.setTimeout(15000, () => { req.destroy(); rj(new Error('Timeout: '+url.slice(0,80))); });
  });
}
// ── Hang-Erkennung ─────────────────────────────────────────────────────────────
// Wenn der Event-Loop haengt (Mod-Scan, Installer, Updates), laufen alle
// HTTP-Probes gleichzeitig in ein Timeout. Das ist kein Internetausfall und darf
// weder das Offline-Banner noch "alle Dienste down" ausloesen.
let _hangUntil = 0;
let _lastLoopTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const drift = now - _lastLoopTick - 1000;
  _lastLoopTick = now;
  if (drift > 1500) _hangUntil = now + Math.min(drift, 20000);
}, 1000).unref?.();
function launcherHanging(){ return Date.now() < _hangUntil; }

// ── Service health monitoring ──────────────────────────────────────────────────
// Each entry is probed with a plain HEAD/GET. Any 2xx/3xx counts as up; a 4xx from
// CurseForge means the host answered, so it counts as up too — we only care about
// "host unreachable / not answering", not about a 403 on a missing API key.
const SERVICE_PROBES = [
  { id: 'modrinth',   name: 'Modrinth',    url: 'https://api.modrinth.com/v2/tag/loader' },
  { id: 'curseforge', name: 'CurseForge',  url: 'https://www.curseforge.com/' },
  { id: 'discord',    name: 'Discord',     url: 'https://discord.com/api/v10/gateway' },
  { id: 'github',     name: 'GitHub',      url: 'https://api.github.com/rate_limit' },
  { id: 'minecraft',  name: 'Minecraft',   url: 'https://api.minecraftservices.com/minecraft/launcher' },
  { id: 'mojang',     name: 'Mojang',      url: 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json' },
];
let _svcState = {};        // id -> { up, dismissed, at }
let _svcTimer = null;

function probeService(svc) {
  return new Promise((resolve) => {
    const done = (up) => resolve({ id: svc.id, name: svc.name, up });
    let u;
    try { u = new URL(svc.url); } catch { return done(false); }
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { 'User-Agent': 'CruxClient/1.0 (service-health)', 'Accept': '*/*' }
    }, (res) => {
      // host answered -> service is reachable, whatever the status code says
      res.resume();
      done(res.statusCode < 500);
    });
    req.on('error', () => done(false));
    req.setTimeout(8000, () => { req.destroy(); done(false); });
    req.end();
  });
}

async function checkServices() {
  // Waehrend eines Haengers sind alle Probes wertlos - Zustand nicht antasten.
  if (launcherHanging()) return [];
  const results = await Promise.all(SERVICE_PROBES.map(probeService));
  if (launcherHanging()) return [];
  const changed = [];
  for (const r of results) {
    const prev = _svcState[r.id];
    if (!prev) {
      // Erster Probe: nur merken, nie sofort "down" - ein kalter Start ist oft langsam.
      _svcState[r.id] = { up: r.up, down: false, misses: r.up ? 0 : 1, dismissed: false, at: Date.now() };
      continue;
    }
    if (r.up){
      prev.misses = 0;
      if (prev.down){ prev.down = false; changed.push({ ...r, recovered: true }); }
    } else {
      // Erst nach 3 aufeinanderfolgenden Fehlschlaegen wirklich "down" melden.
      // Ein einzelner Timeout (z.B. durch einen kurz blockierten Event-Loop)
      // soll keine Warnung ausloesen.
      prev.misses = (prev.misses || 0) + 1;
      if (prev.misses >= 3 && !prev.down){ prev.down = true; prev.dismissed = false; changed.push({ ...r, recovered: false }); }
    }
    prev.up = r.up;
    prev.at = Date.now();
  }
  return changed;
}

function broadcastServices() {
  const list = Object.entries(_svcState).map(([id, s]) => ({
    id, name: (SERVICE_PROBES.find(p => p.id === id) || {}).name || id,
    up: s.down === undefined ? s.up !== false : !s.down, dismissed: s.dismissed,
  }));
  // mainWindow may not exist yet (first probe runs right after createWindow) and
  // webContents is briefly undefined while the window initialises
  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents)
      mainWindow.webContents.send('service-status', list);
  } catch {}
}

function startServiceMonitor() {
  if (_svcTimer) return;
  checkServices().then(() => broadcastServices());
  _svcTimer = setInterval(async () => {
    const changed = await checkServices();
    if (changed.length) broadcastServices();
  }, 60000);
  _svcTimer.unref?.();
}

ipcMain.handle('service-check-now', async () => { await checkServices(); broadcastServices(); return true; });
ipcMain.handle('service-dismiss', (e, id) => {
  if (_svcState[id]) _svcState[id].dismissed = true;
  broadcastServices();
  return true;
});

// ── Offline detection ──────────────────────────────────────────────────────────
let _netOnline = null;
let _netCheckAt = 0;
let _netFails = 0;
function isNetworkAvailable() {
  return new Promise((resolve) => {
    const now = Date.now();
    // Bei einem Haenger liefert der Check kein belastbares Ergebnis - lieber
    // optimistisch "online" als ein falsches Offline-Banner.
    if (launcherHanging()) return resolve(_netOnline !== false);
    if (_netOnline !== null && now - _netCheckAt < 15000) return resolve(_netOnline);
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      _netFails++;
      _netCheckAt = Date.now();
      if (_netFails >= 3) _netOnline = false;
      resolve(_netOnline !== false);
    };
    const req = https.get('https://api.modrinth.com/v2/tag/loader', { timeout: 5000 }, res => {
      _netOnline = res.statusCode >= 200 && res.statusCode < 500;
      if (_netOnline) _netFails = 0;
      _netCheckAt = Date.now();
      res.resume();
      resolve(_netOnline);
    });
    req.on('error', fail);
    req.setTimeout(5000, () => { req.destroy(); fail(); });
  });
}

function fetchText(url) {
  return new Promise((r,rj) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchText(res.headers.location).then(r).catch(rj); return;
      }
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>r(d));
    }).on('error',rj);
    req.setTimeout(15000, () => { req.destroy(); rj(new Error('Timeout: '+url.slice(0,80))); });
  });
}
function downloadFile(url, dest, progressCallback) {
  return new Promise((r,rj) => {
    const go=(u,hops=0)=>{
      if(hops>5)return rj(new Error('Too many redirects'));
      const lib=u.startsWith('https')?https:http;
      const req = lib.get(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, res=>{
        if(res.statusCode>=300&&res.statusCode<400&&res.headers.location){go(res.headers.location,hops+1);return;}
        if(res.statusCode!==200)return rj(new Error('Download failed: '+res.statusCode));
        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        const f=fs.createWriteStream(dest);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (progressCallback && totalBytes > 0) {
            progressCallback((received / totalBytes) * 100);
          }
        });
        res.pipe(f); f.on('finish',()=>f.close(r)); f.on('error',rj);
      }).on('error',rj);
      req.setTimeout(300000, () => { req.destroy(); rj(new Error('Download timeout: '+u.slice(0,80))); });
      req.on('timeout', () => { req.destroy(); rj(new Error('Download timeout')); });
    };
    go(url);
  });
}

// ── Profil-Mods: Identität + CurseForge-Download ────────────────────────────────
// Ein aktiver Profil-Mod muss immer eine Quelle haben: Modrinth-ID,
// CurseForge-ID oder eine lokale Datei. Namen-only Einträge aus dem KI-Plan
// werden beim Start nachgeschlagen und persistent gespeichert. Damit startet
// jedes Profil mit genau den Mods, die dort aktiviert sind.
const _profileIdentityCache = new Map();
const _cfFileCache = new Map();

function cfSlugCandidates(name) {
  const base = String(name || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  if (!base) return [];
  return [...new Set([
    base, 'the-' + base, base.replace(/^the-/, ''),
    base.replace(/-/g, ''), base.replace(/^the-/, '').replace(/-/g, '')
  ])];
}

function modNameScore(a, b) {
  const clean = (s) => String(s || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  const na = clean(a), nb = clean(b);
  if (!na || !nb) return -1;
  if (na === nb) return 1000;
  const ca = na.replace(/ /g, ''), cb = nb.replace(/ /g, '');
  if (ca === cb) return 900;
  if (ca && cb && (ca.includes(cb) || cb.includes(ca))) return 600;
  const wa = na.split(' ').filter(w => w.length > 2);
  const wb = nb.split(' ').filter(w => w.length > 2);
  if (!wa.length || !wb.length) return 0;
  const hits = wa.filter(w => wb.includes(w)).length;
  return Math.round(hits / Math.max(wa.length, wb.length) * 100);
}

async function resolveProfileModIdentity(mod, version, modLoader) {
  if (!mod || mod.disabled) return mod;
  if (mod.modrinthId || mod.curseforgeId || mod.diskPath || (mod.data && mod.data.length)) return mod;
  const name = String(mod.name || '').trim();
  if (!name) return mod;
  const key = [name, version, modLoader].join('|');
  if (_profileIdentityCache.has(key)) {
    const cached = _profileIdentityCache.get(key);
    if (cached && Object.keys(cached).length) Object.assign(mod, cached);
    return mod;
  }

  let found = null;
  const search = async (strict) => {
    const facet = strict
      ? '&facets=' + encodeURIComponent(JSON.stringify([
          ['project_type:mod'], ['versions:' + version], ['categories:' + modLoader]
        ]))
      : '';
    const d = await fetchJson(`https://api.modrinth.com/v2/search?query=${encodeURIComponent(name)}${facet}&limit=8`);
    let best = null, bestScore = -1;
    for (const h of (d && d.hits) || []) {
      const score = modNameScore(name, h.title || h.name || '');
      if (score > bestScore) { bestScore = score; best = h; }
    }
    if (!best || bestScore < 40) return null;
    // Ein Treffer ohne Loader/MC-Filter darf nur uebernommen werden, wenn die
    // Projektversionen wirklich zu dieser Kombination passen. Sonst landet ein
    // Forge-/Server-Mod in einem Fabric-Profil und wird nicht geladen.
    if (!strict) {
      const gv = encodeURIComponent(`["${version}"]`);
      const ld = encodeURIComponent(`["${modLoader}"]`);
      const vs = await fetchJson(`https://api.modrinth.com/v2/project/${best.project_id}/version?game_versions=${gv}&loaders=${ld}`).catch(() => []);
      if (!vs || !vs.length) return null;
    }
    return best;
  };
  try {
    const hit = await search(true) || await search(false);
    if (hit) found = {
      modrinthId: String(hit.project_id),
      title: hit.title || name,
      iconUrl: hit.icon_url || mod.iconUrl || ''
    };
  } catch {}

  if (!found) {
    const cfVersionsOf = (d) => [
      ...((d && d.download && d.download.versions) || []),
      ...((d && Array.isArray(d.files)) ? d.files.flatMap(f => f.versions || []) : [])
    ].map(String);
    const cfCompatible = (d) => {
      const vals = cfVersionsOf(d);
      const v = String(version || '');
      const okVersion = !v || v === 'latest' || vals.some(x =>
        x === v || v.startsWith(x + '.') || x.startsWith(v + '.'));
      const ld = String(modLoader || '').toLowerCase();
      const okLoader = !ld || ld === 'any' || ld === 'vanilla' ||
        vals.some(x => x.toLowerCase() === ld);
      return okVersion && okLoader;
    };
    for (const slug of cfSlugCandidates(name)) {
      try {
        const d = await fetchJsonNoCors(`https://api.cfwidget.com/minecraft/mc-mods/${slug}`);
        if (!d || !d.id || !cfCompatible(d)) continue;
        const score = modNameScore(name, d.title || '');
        if (score >= 40 || !found) {
          found = {
            curseforgeId: String(d.id), curseforgeSlug: slug,
            title: d.title || name, iconUrl: d.thumbnail || mod.iconUrl || ''
          };
          if (score >= 40) break;
        }
      } catch {}
    }
  }

  if (found) {
    Object.assign(mod, found);
    _profileIdentityCache.set(key, found);
  } else {
    _profileIdentityCache.set(key, {});
  }
  return mod;
}

async function curseforgeFileFor(mod, version, modLoader) {
  const id = String(mod.curseforgeId || '');
  if (!id) return null;
  const key = [id, version, modLoader].join('|');
  if (_cfFileCache.has(key)) return _cfFileCache.get(key);

  let data = null;
  const slugs = [mod.curseforgeSlug, id, ...cfSlugCandidates(mod.name)].filter(Boolean);
  for (const slug of [...new Set(slugs)]) {
    try {
      const d = await fetchJsonNoCors(`https://api.cfwidget.com/minecraft/mc-mods/${encodeURIComponent(slug)}`);
      if (d && Array.isArray(d.files) && d.files.length) { data = d; break; }
    } catch {}
  }
  if (!data) { _cfFileCache.set(key, null); return null; }

  const wantVersion = (versions) => {
    const arr = Array.isArray(versions) ? versions : [versions];
    const v = String(version || '');
    return !v || v === 'latest' || arr.some(x => {
      const s = String(x);
      return s === v || v.startsWith(s + '.') || s.startsWith(v + '.');
    });
  };
  const wantLoader = (versions) => {
    const arr = Array.isArray(versions) ? versions : [versions];
    return !modLoader || modLoader === 'any' || modLoader === 'vanilla' ||
      arr.some(v => String(v).toLowerCase() === String(modLoader).toLowerCase());
  };
  const jars = data.files.filter(f => /\.jar$/i.test(String(f.name || '')));
  const exact = jars.filter(f => wantVersion(f.versions) && wantLoader(f.versions));
  const loaderOnly = jars.filter(f => wantLoader(f.versions));
  // Falsche MC-Version wuerde den Launcher direkt wieder crashed - daher nur
  // bei explizitem "latest" auf loader-only zurueckfallen.
  const pool = (!version || version === 'latest')
    ? (loaderOnly.length ? loaderOnly : jars)
    : exact;
  const pick = pool.sort((a, b) =>
    ((a.type === 'release' ? 0 : 1) - (b.type === 'release' ? 0 : 1)) ||
    ((Date.parse(b.uploaded_at) || 0) - (Date.parse(a.uploaded_at) || 0))
  )[0];
  let result = null;
  if (pick && pick.id) {
    const fileId = Number(pick.id);
    result = {
      fileId,
      fileName: String(pick.name),
      url: `https://mediafilez.forgecdn.net/files/${Math.floor(fileId / 1000)}/${fileId % 1000}/${encodeURIComponent(String(pick.name))}`
    };
  }
  _cfFileCache.set(key, result);
  return result;
}

// Aktive Profil-Mods muessen zur gewaehlten MC-Version UND zum Loader passen.
// Ein Eintrag, den die KI erfunden hat oder der nur fuer einen anderen Loader
// existiert, wird nicht still uebersprungen, sondern sichtbar deaktiviert.
async function ensureProfileModCompatible(mod, version, modLoader, log) {
  if (!mod || mod.disabled) return { changed:false, disabled:false };
  const disable = (reason) => {
    mod.disabled = true;
    mod.unresolved = true;
    log(`[AUTO-FIX] ${mod.name} — ${reason}; Mod wurde deaktiviert.`);
    return { changed:true, disabled:true };
  };

  if (mod.modrinthId) {
    const gv = encodeURIComponent(`["${version}"]`);
    const ld = encodeURIComponent(`["${modLoader}"]`);
    const vs = await fetchJson(`https://api.modrinth.com/v2/project/${mod.modrinthId}/version?game_versions=${gv}&loaders=${ld}`).catch(() => []);
    if (vs && vs.length) return { changed:false, disabled:false };
  }
  if (mod.curseforgeId) {
    const file = await curseforgeFileFor(mod, version, modLoader);
    if (file) return { changed:false, disabled:false };
  }
  if (!mod.modrinthId && !mod.curseforgeId) return { changed:false, disabled:false };

  // Letzter Versuch: ein echtes Projekt mit demselben Namen, das exakt zur
  // Kombination passt (die relaxierte Suche liefert oft falsche Loader).
  if (mod.name) {
    try {
      const facets = encodeURIComponent(JSON.stringify([
        ['project_type:mod'], ['versions:' + version], ['categories:' + modLoader]
      ]));
      const d = await fetchJson(`https://api.modrinth.com/v2/search?query=${encodeURIComponent(mod.name)}&facets=${facets}&limit=5`);
      let best = null, bestScore = -1;
      for (const h of (d && d.hits) || []) {
        const score = modNameScore(mod.name, h.title || h.name || '');
        if (score > bestScore) { bestScore = score; best = h; }
      }
      if (best && bestScore >= 40) {
        const old = mod.modrinthId;
        mod.modrinthId = String(best.project_id);
        mod.title = best.title || mod.name;
        mod.iconUrl = best.icon_url || mod.iconUrl || '';
        delete mod.curseforgeId;
        delete mod.curseforgeSlug;
        log(`[AUTO-FIX] ${mod.name} — inkompatibles Projekt ${old} durch ${mod.modrinthId} ersetzt.`);
        return { changed:true, disabled:false };
      }
    } catch {}
  }
  return disable(`keine Version für MC ${version} / ${modLoader} gefunden`);
}

// ── Globaler Mod-Cache ────────────────────────────────────────────────────────
// Jede vom Launcher heruntergeladene Mod-JAR bleibt in %APPDATA%\Crux Client\
// mod-cache liegen. Wird genau diese Version wieder benoetigt, wird die Datei
// von dort kopiert statt erneut aus dem Internet zu kommen. Der Cache-Key
// enthaelt die Modrinth-Versions-ID bzw. die CurseForge-File-ID plus Dateiname
// — eine andere Mod-Version trifft den Eintrag nicht.
function modCacheFileName(prefix, parts) {
  const safe = s => String(s == null ? '' : s).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40);
  const hash = crypto.createHash('sha256')
    .update(parts.map(p => String(p == null ? '' : p)).join('|'))
    .digest('hex').slice(0, 20);
  return `${prefix}-${safe(parts[0])}-${hash}.jar`;
}
// Versions-ID bzw. File-ID reichen als Identitaet: dieselbe Mod-Version kann
// mehrere MC-Versionen/Loader tragen und muss dann nur einmal im Cache liegen.
function modrinthCacheName(projectId, versionData, file) {
  return modCacheFileName('mr', [
    projectId,
    (versionData && (versionData.id || versionData.version_number)) || '',
    (file && file.filename) || ''
  ]);
}
function curseforgeCacheName(projectId, file) {
  return modCacheFileName('cf', [
    projectId,
    (file && file.fileId) || (file && file.fileName) || '',
    (file && file.fileName) || ''
  ]);
}
async function deployModCachedOrDownload({ url, cacheName, dest, label, log, progress }) {
  if (!url || !cacheName) throw new Error('Kein Cache-Key fuer ' + (label || dest));
  await fs.promises.mkdir(P.modCache, { recursive: true });
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const cachePath = path.join(P.modCache, cacheName);
  const say = line => { if (typeof log === 'function') log(line); };
  let cached = false;
  try { cached = fs.statSync(cachePath).size > 0; } catch {}
  if (cached) {
    try {
      await fs.promises.copyFile(cachePath, dest);
      say(`[CACHE] ${label || cacheName} aus dem Mod-Cache (gleiche Version)`);
      return 'cache';
    } catch (e) {
      say(`[CACHE] ${label || cacheName}: Kopie fehlgeschlagen (${e.message}) — lade neu`);
    }
  }
  const temp = path.join(P.modCache, `${cacheName}.part-${process.pid}-${Date.now()}`);
  try {
    await downloadFile(url, temp, progress);
    try {
      await fs.promises.rename(temp, cachePath);
    } catch (e) {
      // Zwei Instanzen koennen gleichzeitig denselben Eintrag schreiben.
      let existing = false;
      try { existing = fs.statSync(cachePath).size > 0; } catch {}
      if (!existing) throw e;
      try { fs.unlinkSync(temp); } catch {}
      await fs.promises.copyFile(cachePath, dest);
      say(`[CACHE] ${label || cacheName} aus dem Mod-Cache (parallele Instanz)`);
      return 'cache';
    }
    await fs.promises.copyFile(cachePath, dest);
    say(`[CACHE] ${label || cacheName} heruntergeladen und gecacht`);
    return 'download';
  } catch (e) {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
    throw e;
  }
}

async function deployCurseforgeMod(mod, modsDir, version, modLoader, log) {
  try {
    const prefix = `cf-${mod.curseforgeId}-`;
    if (fs.readdirSync(modsDir).some(f => f.startsWith(prefix) && f.endsWith('.jar'))) return true;
    const file = await curseforgeFileFor(mod, version, modLoader);
    if (!file) {
      log(`[MODS] ${mod.name} — keine CurseForge-Datei für MC ${version} / ${modLoader} gefunden`);
      return false;
    }
    const source = await deployModCachedOrDownload({
      url: file.url,
      cacheName: curseforgeCacheName(mod.curseforgeId, file),
      dest: path.join(modsDir, `${prefix}${file.fileName}`),
      label: `${mod.name} (${file.fileName})`,
      log
    });
    log(`[MODS] ${mod.name} — CurseForge ${file.fileName} ${source==='cache'?'aus dem Cache':'heruntergeladen'}`);
    return true;
  } catch (e) {
    log(`[MODS] ${mod.name} (CurseForge) fehlgeschlagen: ${e.message}`);
    return false;
  }
}

function modHasJar(mod, files) {
  if (!mod || !Array.isArray(files)) return false;
  if (mod.modrinthId && files.some(f => f.startsWith(String(mod.modrinthId) + '-') && f.endsWith('.jar'))) return true;
  if (mod.curseforgeId && files.some(f => f.startsWith(`cf-${mod.curseforgeId}-`) && f.endsWith('.jar'))) return true;
  return false;
}

// Erforderliche Abhaengigkeiten aktiver Profil-Mods mitdeployen. Ohne das
// startet ein Profil zwar, aber einzelne Mods scheitern an fehlenden Libs.
async function addRequiredDependencies(toDeploy, version, modLoader, offline, exclude) {
  if (offline) return 0;
  const blocked = exclude || new Set();
  const seen = new Set(toDeploy.map(m => m && m.modrinthId).filter(Boolean).map(String));
  const processed = new Set();
  const wanted = new Set();
  for (const mod of toDeploy) {
    if (!mod || mod._isProfileMod !== true) continue;
    // seen enthaelt bereits ALLE deployten Mods — damit durfte die Mod selbst
    // nicht uebersprungen werden. Extra processed-Set verhindert nur Duplikate.
    if (!mod.modrinthId || processed.has(String(mod.modrinthId))) continue;
    processed.add(String(mod.modrinthId));
    try {
      const gv = encodeURIComponent(`["${version}"]`);
      const ld = encodeURIComponent(`["${modLoader}"]`);
      const vs = await fetchJson(`https://api.modrinth.com/v2/project/${mod.modrinthId}/version?game_versions=${gv}&loaders=${ld}`).catch(() => []);
      for (const dep of ((vs && vs[0] && vs[0].dependencies) || [])) {
        if (dep.dependency_type !== 'required') continue;
        let id = dep.project_id ? String(dep.project_id) : null;
        if (!id && dep.name) {
          try {
            const facets = encodeURIComponent(JSON.stringify([
              ['project_type:mod'], ['versions:' + version], ['categories:' + modLoader]
            ]));
            const d = await fetchJson(`https://api.modrinth.com/v2/search?query=${encodeURIComponent(dep.name)}&facets=${facets}&limit=3`).catch(() => null);
            const h = (d && d.hits || [])[0];
            if (h && modNameScore(dep.name, h.title || h.name || '') >= 40) id = String(h.project_id);
          } catch {}
        }
        if (id && !seen.has(id) && !blocked.has(normalizeBrokenId(id))) wanted.add(id);
      }
    } catch {}
  }
  let added = 0;
  for (const id of wanted) {
    try {
      const info = await fetchJson(`https://api.modrinth.com/v2/project/${id}`).catch(() => null);
      seen.add(id);
      toDeploy.push({
        name: (info && info.title) || id,
        modrinthId: id,
        version: 'latest', mcVersion: version,
        source: 'Modrinth', iconUrl: (info && info.icon_url) || '',
        downloadAllVersions: false, disabled: false, loader: modLoader,
        _isDependency: true
      });
      added++;
    } catch {}
  }
  return added;
}

async function persistProfileMods(profileId, profileMods) {
  try {
    const profiles = await load(P.profiles, []);
    const prof = profiles.find(p => p.id === profileId);
    if (!prof) return false;
    const byName = new Map();
    for (const m of Array.isArray(profileMods) ? profileMods : []) {
      if (!m || !m.name) continue;
      const key = String(m.name).toLowerCase();
      const old = byName.get(key);
      const hasSource = !!(m.modrinthId || m.curseforgeId || m.diskPath || (m.data && m.data.length));
      if (!old || (hasSource && !(old.modrinthId || old.curseforgeId || old.diskPath))) byName.set(key, m);
    }
    const fields = ['modrinthId', 'curseforgeId', 'curseforgeSlug', 'iconUrl', 'title',
      'version', 'downloadUrl', 'disabled', 'unresolved', 'fileName', 'diskPath'];
    let changed = false;
    for (const m of Array.isArray(prof.mods) ? prof.mods : []) {
      const src = byName.get(String(m.name || '').toLowerCase());
      if (!src) continue;
      for (const field of fields) {
        if (src[field] !== undefined && m[field] !== src[field]) { m[field] = src[field]; changed = true; }
      }
    }
    if (changed) {
      await save(P.profiles, profiles);
      try { mainWindow && mainWindow.webContents.send('profile-mods-updated', { profileId, mods: prof.mods }); } catch {}
    }
    return changed;
  } catch (e) {
    console.error('[PROFILE MODS] Persistieren fehlgeschlagen:', e.message);
    return false;
  }
}

function packFormatForVersion(version) {
  const v = String(version || '').split('.');
  const maj = parseInt(v[0], 10), min = parseInt(v[1], 10), pat = parseInt(v[2], 10);
  if (maj === 1) {
    if (min >= 22) return 75;
    if (min === 21) {
      if (pat >= 9) return 75;
      if (pat >= 8) return 72;
      if (pat >= 7) return 68;
      if (pat >= 6) return 63;
      if (pat >= 5) return 61;
      if (pat >= 4) return 55;
      if (pat >= 2) return 46;
      return 34;
    }
    if (min === 20) {
      if (pat >= 5) return 32;
      if (pat >= 3) return 22;
      if (pat >= 2) return 18;
      return 15;
    }
    if (min === 19) {
      if (pat >= 4) return 13;
      if (pat >= 3) return 12;
      return 9;
    }
    if (min === 18) return 8;
    if (min === 17) return 7;
    if (min === 16 && pat >= 2) return 6;
    if (min >= 15) return 5;
    if (min >= 13) return 4;
    if (min === 12) return 3;
    if (min === 11) return 3;
    if (min >= 9) return 2;
    if (min >= 6) return 1;
  }
  return null;
}

// Rewrite pack.mcmeta pack_format to match the target MC version so that older
// resource packs are treated as compatible and auto-enabled by the game.
async function patchResourcePackFormat(filePath, version) {
  const pf = packFormatForVersion(version);
  if (!pf) return false;
  try {
    const JSZip = getJszip();
    const buf = fs.readFileSync(filePath);
    const zip = await JSZip.loadAsync(buf);
    const meta = zip.file('pack.mcmeta');
    if (!meta) return false;
    const json = JSON.parse(await meta.async('string'));
    if (!json || typeof json !== 'object') return false;
    if (!json.pack) json.pack = {};
    if (json.pack.pack_format === pf) return false;
    json.pack.pack_format = pf;
    zip.file('pack.mcmeta', JSON.stringify(json));
    const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(filePath, out);
    return true;
  } catch (e) { return false; }
}

// Reverse map: pack_format → the MC version a resource pack was originally made for.
function versionFromPackFormat(pf) {
  const map = {
    75: '1.21.9', 72: '1.21.8', 68: '1.21.7', 63: '1.21.6', 61: '1.21.5',
    55: '1.21.4', 46: '1.21.2', 34: '1.21', 32: '1.20.5', 22: '1.20.3',
    18: '1.20.2', 15: '1.20', 13: '1.19.4', 12: '1.19.3', 9: '1.19',
    8: '1.18', 7: '1.17', 6: '1.16.2', 5: '1.15', 4: '1.13', 3: '1.11',
    2: '1.9', 1: '1.6.1'
  };
  return map[pf] || null;
}

function sanitizeFileName(name) {
  return String(name || 'pack')
    .replace(/\.zip$/i, '')
    .replace(/[^a-zA-Z0-9._ -]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'pack';
}

// Read the pack_format of a resource pack BEFORE it gets patched, so we know
// the original MC version it was designed for.
async function getOriginalPackVersion(filePath) {
  try {
    const JSZip = getJszip();
    const buf = fs.readFileSync(filePath);
    const zip = await JSZip.loadAsync(buf);
    const meta = zip.file('pack.mcmeta');
    if (!meta) return null;
    const json = JSON.parse(await meta.async('string'));
    const pf = json && json.pack && json.pack.pack_format;
    return versionFromPackFormat(pf);
  } catch { return null; }
}

// Deploy a resource pack into the shared resourcepacks folder. Always patches
// pack.mcmeta to the launched MC version (so it auto-loads) and names the file
// "<pack name>-<original MC version>.zip" so the original target version stays visible.
async function deployResourcePack({ rpDir, version, packName, tempDest, downloadUrl, onDownload }) {
  const safeName = sanitizeFileName(packName);
  // Reuse an already-deployed file for this pack name (from a previous launch)
  try {
    const files = fs.readdirSync(rpDir).filter(f =>
      f.toLowerCase().startsWith(safeName.toLowerCase() + '-') && f.toLowerCase().endsWith('.zip')
    );
    if (files.length) {
      const reuse = path.join(rpDir, files[0]);
      await patchResourcePackFormat(reuse, version);
      return files[0];
    }
  } catch {}
  // Download to a temp file if we don't already have one on disk
  if (tempDest && downloadUrl && !fs.existsSync(tempDest)) {
    if (onDownload) onDownload();
    await downloadFile(downloadUrl, tempDest);
  }
  if (!tempDest || !fs.existsSync(tempDest)) return null;
  const origVersion = await getOriginalPackVersion(tempDest);
  await patchResourcePackFormat(tempDest, version);
  const finalName = origVersion ? `${safeName}-${origVersion}.zip` : `${safeName}.zip`;
  const finalPath = path.join(rpDir, finalName);
  if (finalPath !== tempDest) {
    try { fs.renameSync(tempDest, finalPath); } catch {
      try { fs.copyFileSync(tempDest, finalPath); fs.unlinkSync(tempDest); } catch {}
    }
  }
  return finalName;
}

// ── Mesa3D helpers ──────────────────────────────────────────────────────────────
// Install Mesa DLLs into the game directory (cwd) so LoadLibrary("opengl32.dll")
// finds them before C:\Windows\System32\opengl32.dll.
const MESA_DLLS = [
  'opengl32.dll', 'libgallium_wgl.dll', 'libglapi.dll',
  'libEGL.dll', 'libGLESv1_CM.dll', 'libGLESv2.dll',
  'libdlclose-skip.dll', 'clon12compiler.dll', 'd3d10warp.dll',
  'dxil.dll', 'libspirv_to_dxil.dll', 'openclon12.dll',
  'spirv2dxil.exe', 'va.dll', 'vaon12_drv_video.dll',
  'va_win32.dll', 'vulkan_dzn.dll', 'vulkan_lvp.dll',
  'libVkLayer_MESA_anti_lag.dll', 'libVkLayer_MESA_overlay.dll', 'libVkLayer_MESA_vram_report_limit.dll',
];

function installMesaToGameDir(mesaGL, gameDir) {
  const srcDir = path.dirname(mesaGL);
  for (const file of MESA_DLLS) {
    const src = path.join(srcDir, file);
    try {
      if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(gameDir, file));
    } catch {}
  }
}

function cleanupMesaFromGameDir(gameDir) {
  for (const file of MESA_DLLS) {
    try { fs.unlinkSync(path.join(gameDir, file)); } catch {}
  }
}

// ── Mesa3D Java Agent ─────────────────────────────────────────────────────────
// Der Agent laedt in premain() Mesa's opengl32.dll, BEVOR GLFW die System-DLL
// laedt. Windows muss dabei libgallium_wgl.dll zuerst laden - sonst scheitert
// System.load() mit "Can't find dependent libraries" (MesaAgent.java).
const MESA_AGENT_DIR = path.join(__dirname, 'mesa-agent');
// Fallback-Quelle: das Verzeichnis ist gitignored und liegt nicht in build.files.
const MESA_AGENT_SOURCE = `import java.lang.instrument.Instrumentation;
import java.io.File;

public class MesaAgent {
  public static void premain(String args, Instrumentation inst) {
    if (args == null || args.isEmpty()) {
      System.err.println("[MESA_AGENT] No Mesa DLL path specified");
      return;
    }
    File dll = new File(args);
    File dir = dll.getParentFile();
    if (dir != null) preload(new File(dir, "libgallium_wgl.dll").getAbsolutePath());
    preload(dll.getAbsolutePath());
  }

  private static void preload(String path) {
    try {
      System.load(path);
      System.out.println("[MESA_AGENT] Loaded " + path);
    } catch (Throwable t) {
      System.err.println("[MESA_AGENT] Failed to preload " + path + ": " + t);
    }
  }
}
`;
let _cachedMesaAgentJar = null;
let _mesaJdkTools = null;
function findMesaJdkTools(javaPath) {
  if (_mesaJdkTools) return _mesaJdkTools;
  const roots = [path.dirname(javaPath)];
  if (process.env.JAVA_HOME) roots.push(path.join(process.env.JAVA_HOME, 'bin'));
  try {
    const jdks = path.join(os.homedir(), '.jdks');
    for (const d of fs.readdirSync(jdks)) roots.push(path.join(jdks, d, 'bin'));
  } catch {}
  for (const bin of roots) {
    const javac = path.join(bin, 'javac.exe');
    const jar = path.join(bin, 'jar.exe');
    if (fs.existsSync(javac) && fs.existsSync(jar)) return (_mesaJdkTools = { javac, jar });
  }
  return null;
}
async function ensureMesaAgent(mesaGL, javaPath) {
  try {
    const agentDir = MESA_AGENT_DIR;
    const javaFile = path.join(agentDir, 'MesaAgent.java');
    const jarFile = path.join(agentDir, 'MesaAgent.jar');
    const manifestFile = path.join(agentDir, 'MANIFEST.MF');
    const stampFile = path.join(agentDir, 'MesaAgent.version');
    await fs.promises.mkdir(agentDir, { recursive: true });

    let source = MESA_AGENT_SOURCE;
    try { source = (await fs.promises.readFile(javaFile, 'utf8')).replace(/^\uFEFF/, ''); }
    catch { await fs.promises.writeFile(javaFile, source, 'utf8'); }
    const version = 'v2-' + crypto.createHash('sha1').update(source).digest('hex').slice(0, 10);
    const upToDate = fs.existsSync(jarFile) && fs.existsSync(stampFile) &&
      fs.readFileSync(stampFile, 'utf8').trim() === version;
    if (!upToDate) {
      const tools = findMesaJdkTools(javaPath);
      if (!tools) throw new Error('Kein JDK mit javac.exe/jar.exe gefunden');
      await fs.promises.writeFile(manifestFile, 'Premain-Class: MesaAgent\n', 'utf8');
      execSync(`"${tools.javac}" MesaAgent.java`, { cwd: agentDir, stdio: 'ignore' });
      execSync(`"${tools.jar}" cfm MesaAgent.jar MANIFEST.MF MesaAgent.class`, { cwd: agentDir, stdio: 'ignore' });
      await fs.promises.writeFile(stampFile, version, 'utf8');
      console.log('[MESA_AGENT] Agent neu kompiliert (libgallium_wgl.dll zuerst).');
    }
    _cachedMesaAgentJar = jarFile;
    return jarFile;
  } catch (e) {
    console.error('[MESA_AGENT] Failed to create agent jar:', e.message);
    return null;
  }
}

// ── Mesa3D Auto-Setup ─────────────────────────────────────────────────────────
// Automatically downloads Mesa3D software OpenGL for systems with broken GPU drivers
const MESA_URL = 'https://github.com/pal1000/mesa-dist-win/releases/download/26.1.3/mesa3d-26.1.3-release-mingw.7z';

async function ensureMesa() {
  const mesaDir = path.join(base, 'mesa');
  const mesaGL = path.join(mesaDir, 'x64', 'opengl32.dll');
  if (fs.existsSync(mesaGL)) return mesaGL;

  const sendLog = (line) => {
    try { if (mainWindow) mainWindow.webContents.send('instance-log', { instanceId: '_mesa', line }); } catch {}
  };
  const sendStatus = (msg) => {
    try { if (mainWindow) mainWindow.webContents.send('launch-status', msg); } catch {}
  };

  const tmpDir = path.join(base, '_mesa_tmp');
  try { await fs.promises.mkdir(tmpDir, { recursive: true }); } catch { return null; }

  try {
    sendStatus('Lade Mesa3D Software-OpenGL herunter (~54MB)...');

    // Try 7z method first (needs node-7z)
    let extracted = false;
    try {
      sendLog('[MESA] Lade Mesa3D von GitHub herunter (7z, ~54MB)...');
      const mesa7z = path.join(tmpDir, 'mesa.7z');
      await downloadFile(MESA_URL, mesa7z, () => {});
      sendStatus('Entpacke Mesa3D...');

      const script = `
        const path = require('path');
        const fs = require('fs');
        const tmpDir = ${JSON.stringify(tmpDir)};
        const mesaDir = ${JSON.stringify(mesaDir)};
        const mesa7z = ${JSON.stringify(mesa7z)};
        async function extract() {
          let _7z;
          try { _7z = require('node-7z'); } catch(e) {
            const { execSync } = require('child_process');
            execSync('npm install node-7z --prefix ' + JSON.stringify(tmpDir) + ' --no-save', { stdio: 'ignore' });
            _7z = require(path.join(tmpDir, 'node_modules', 'node-7z'));
          }
          const stream = await _7z.extractFull(mesa7z, tmpDir, { recursive: true });
          return new Promise((resolve, reject) => {
            stream.on('end', resolve);
            stream.on('error', reject);
          });
        }
        extract().then(() => {
          fs.mkdirSync(mesaDir, { recursive: true });
          // List all files in tmpDir for debugging
          function listFiles(dir, indent) {
            if (!fs.existsSync(dir)) return;
            const items = fs.readdirSync(dir);
            for (const item of items) {
              const full = path.join(dir, item);
              try {
                const stat = fs.statSync(full);
                console.log(indent + item + (stat.isDirectory() ? '/' : ' (' + stat.size + ' bytes)'));
                if (stat.isDirectory()) listFiles(full, indent + '  ');
              } catch(e) { console.log(indent + item + ' (error: ' + e.message + ')'); }
            }
          }
          console.log('Extracted files in ' + tmpDir + ':');
          listFiles(tmpDir, '  ');
          // The archive may have a root folder like mesa3d-26.1.3-release-mingw/
          // Search recursively for x64/opengl32.dll anywhere in tmpDir
          function findOpengl32(dir) {
            if (!fs.existsSync(dir)) return null;
            const items = fs.readdirSync(dir);
            for (const item of items) {
              const full = path.join(dir, item);
              try {
                if (item === 'opengl32.dll' && path.basename(dir) === 'x64') return dir;
                if (fs.statSync(full).isDirectory()) {
                  const found = findOpengl32(full);
                  if (found) return found;
                }
              } catch {}
            }
            return null;
          }
          const x64Dir = findOpengl32(tmpDir);
          if (x64Dir) {
            console.log('Found x64 dir: ' + x64Dir);
            const dst = path.join(mesaDir, 'x64');
            fs.cpSync(x64Dir, dst, { recursive: true });
            console.log('OK:' + dst);
          } else {
            console.error('x64/opengl32.dll not found in extracted files');
            process.exit(1);
          }
        }).catch(e => { console.error(e.message); process.exit(1); });
      `;
      await new Promise((resolve, reject) => {
        const c = exec(`node -e "${script.replace(/"/g, '\\"')}"`, { stdio: 'pipe', timeout: 120000 }, (err, stdout) => {
          if (err) reject(err); else { console.log('[MESA] Extract stdout:', stdout); resolve(); }
        });
        c.on('error', reject);
      });

      if (fs.existsSync(mesaGL)) {
        sendLog('[MESA] Mesa3D erfolgreich installiert (7z).');
        sendStatus('Mesa3D installiert!');
        extracted = true;
      } else {
        sendLog('[MESA] 7z-Extraktion beendet, aber opengl32.dll nicht gefunden.');
      }
    } catch (e) {
      sendLog(`[MESA] 7z-Methode fehlgeschlagen: ${e.message}`);
    }

    // Fallback: download standalone 7zr.exe and extract
    if (!extracted) {
      try {
        sendLog('[MESA] Lade 7zr.exe (standalone 7-Zip) herunter...');
        const mesa7z = path.join(tmpDir, 'mesa.7z');
        const szExe = path.join(tmpDir, '7zr.exe');
        const SZR_URL = 'https://www.7-zip.org/a/7zr.exe';
        try {
          await downloadFile(SZR_URL, szExe, () => {});
        } catch {
          sendLog('[MESA] 7zr.exe Download fehlgeschlagen, versuche alternativen Mirror...');
          const SZR_MIRROR = 'https://github.com/ip7z/7zip/raw/main/7zr.exe';
          await downloadFile(SZR_MIRROR, szExe, () => {});
        }
        if (fs.existsSync(szExe)) {
          sendLog('[MESA] Extrahiere Mesa3D mit 7zr.exe...');
          await new Promise((resolve, reject) => {
            exec(`"${szExe}" x "${mesa7z}" -o"${tmpDir}" -y`, { timeout: 120000 }, (err) => {
              if (err) reject(err); else resolve();
            });
          });
        }

        // Copy x64/opengl32.dll to mesaDir (search recursively)
        function findOpengl32(dir) {
          if (!fs.existsSync(dir)) return null;
          const items = fs.readdirSync(dir);
          for (const item of items) {
            const full = path.join(dir, item);
            try {
              if (item === 'opengl32.dll' && path.basename(dir) === 'x64') return dir;
              if (fs.statSync(full).isDirectory()) { const f = findOpengl32(full); if (f) return f; }
            } catch {}
          }
          return null;
        }
        const x64Dir = findOpengl32(tmpDir);
        if (x64Dir) {
          await fs.promises.mkdir(path.join(mesaDir, 'x64'), { recursive: true });
          fs.cpSync(x64Dir, path.join(mesaDir, 'x64'), { recursive: true });
        }
        if (fs.existsSync(mesaGL)) {
          sendLog('[MESA] Mesa3D erfolgreich installiert (7zr.exe).');
          sendStatus('Mesa3D installiert!');
          extracted = true;
        } else {
          sendLog('[MESA] 7zr-Extraktion beendet, aber opengl32.dll nicht gefunden.');
        }
      } catch (e2) {
        sendLog(`[MESA] 7zr-Fallback fehlgeschlagen: ${e2.message}`);
      }
    }

    if (extracted) {
      try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
      return mesaGL;
    }

    // If all methods failed, clear temp and return null
    sendLog('[MESA] Alle Methoden fehlgeschlagen — Mesa3D nicht verfügbar.');
    sendStatus('Mesa3D Setup fehlgeschlagen');
  } catch (e) {
    sendLog(`[MESA] Setup fehlgeschlagen: ${e.message}`);
    sendStatus('Mesa3D Setup fehlgeschlagen');
  }
  try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
  return null;
}

function findJavaExe(dir, maxDepth = 5) {
  if (maxDepth <= 0) return null;
  let items;
  try { items = fs.readdirSync(dir); } catch { return null; }
  for (const i of items) {
    const f = path.join(dir, i);
    let st;
    try { st = fs.statSync(f); } catch { continue; }
    if (!st.isDirectory()) continue;
    const jp = path.join(f, 'bin', 'java.exe');
    try { if (fs.existsSync(jp)) return jp; } catch {}
    const found = findJavaExe(f, maxDepth - 1);
    if (found) return found;
  }
  return null;
}

async function getNeoForgeLatestVersion(mcVersion) {
  const xml = await fetchText('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml');
  const versionMatches = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
  // MC "1.21.1" → NeoForge prefix "21.1"; MC "1.20" → "20.0"
  const parts = mcVersion.split('.');
  const neoPrefix = `${parts[1] || '0'}.${parts[2] || '0'}`;
  const matching = versionMatches.filter(v => v.startsWith(neoPrefix + '.'));
  if (!matching.length) return null;
  // Prefer stable (non-beta) versions, then sort by neo build number descending
  const stable = matching.filter(v => !v.includes('-beta'));
  const pool = stable.length ? stable : matching;
  pool.sort((a, b) => {
    const na = parseInt(a.split('.')[2]) || 0;
    const nb = parseInt(b.split('.')[2]) || 0;
    return nb - na;
  });
  return pool[0];
}











