const { app, BrowserWindow, ipcMain, shell } = require('electron');
const https = require('https');
const http  = require('http');
const { exec, execSync, spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { URL } = require('url');

let mainWindow;
let authWindow = null;

// ── Prevent crashes ──────────────────────────────────────────────────────────
const logFile = path.join(process.env.APPDATA || process.env.LOCALAPPDATA || '', 'Crux Client', 'crash.log');
function logDebug(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(logFile, line); } catch {}
}
process.on('uncaughtException', (err) => { logDebug('Uncaught: ' + err.stack); console.error('[Crux] Uncaught exception:', err); });
process.on('unhandledRejection', (reason) => { logDebug('Unhandled: ' + reason); console.error('[Crux] Unhandled rejection:', reason); });

// ── Launcher RAM limit ────────────────────────────────────────────────────────
try {
  const settingsFile = path.join(process.env.APPDATA || process.env.LOCALAPPDATA || '', 'Crux Client', 'settings.json');
  const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const launcherRam = parseInt(saved.launcherRam, 10) || 2;
  const mb = Math.max(256, Math.min(8192, launcherRam * 1024));
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
  clientMods: path.join(base,'client-mods'),
  java: path.join(base,'javaInstallations'),
  mc:   path.join(base,'minecraft'),
  servers: path.join(base,'servers'),
};
app.setPath('userData', base);
app.setPath('cache', path.join(base,'Cache'));

// ── Window ─────────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:1200, height:800, minWidth:900, minHeight:600,
    autoHideMenuBar:true,
    icon: path.join(__dirname, 'icons', 'icon.ico'),
    webPreferences:{ nodeIntegration:true, contextIsolation:false }
  });
  mainWindow.setMenu(null);
  mainWindow.loadFile('index.html');
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.on('before-input-event', (e, input) => {
      if (input.key === 'F12') { mainWindow.webContents.toggleDevTools(); }
    });
  });
}
app.whenReady().then(async () => {
  // Create directories async (non-blocking)
  await Promise.all(['Cache','javaInstallations','client-mods','minecraft','servers'].map(d =>
    fs.promises.mkdir(path.join(base, d), { recursive: true }).catch(()=>{})
  ));
  createWindow();
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
app.on('before-quit', () => { isQuitting = true; stopAllServers(); });

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
      'clientResourcePacks','autoUseResourcePacks'
    ];
    const clean = {};
    for (const k of Object.keys(existing)) { if (KNOWN_KEYS.includes(k)) clean[k] = existing[k]; }
    await fs.promises.writeFile(P.settings, JSON.stringify(clean,null,2));
  } catch {}
};

ipcMain.handle('load-settings',          async () => load(P.settings, {}));
ipcMain.handle('load-accounts',          async () => load(P.accounts, []));
ipcMain.handle('load-profiles',          async () => load(P.profiles, [{ id:'default', name:'Default', mcVersion:'', modLoader:'fabric', mods:[], datapacks:[], resourcePacks:[], shaderPacks:[] }]));
ipcMain.handle('load-mods',              async () => load(P.mods, []));
ipcMain.handle('load-launched-versions', async () => load(P.launched, []));
ipcMain.on('save-settings',          async (e,d) => saveSettings(d));
ipcMain.on('save-accounts',          async (e,d) => save(P.accounts, d));
ipcMain.on('save-profiles',          async (e,d) => save(P.profiles, d));
ipcMain.on('save-launched-versions', async (e,d) => save(P.launched, d));
ipcMain.on('show-launcher', () => { if(mainWindow) mainWindow.show(); });
ipcMain.on('save-mods', async (e, data) => {
  save(P.mods, data);
  const byVer = {};
  for (const m of data) { if (!byVer[m.mcVersion]) byVer[m.mcVersion]=[]; byVer[m.mcVersion].push(m); }
  for (const [ver,mods] of Object.entries(byVer)) {
    const dir = path.join(P.clientMods, ver); await fs.promises.mkdir(dir, { recursive:true }).catch(()=>{});
    for (const m of mods) { const safe = m.name.replace(/[^a-zA-Z0-9_\-. ]/g,'_'); await save(path.join(dir,`${safe}.json`), m); }
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
    return await fetchVersionsWithCache();
  } catch(e) {
    // If network fails, try stale cache
    try {
      const cached = JSON.parse(await fs.promises.readFile(versionCachePath, 'utf8'));
      mcVersionList = cached;
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

// ── Mojang ─────────────────────────────────────────────────────────────────────
ipcMain.handle('login-mojang', async (e, { email, password }) => {
  try {
    const res = await postJson('https://authserver.mojang.com/authenticate', {
      agent:{ name:'Minecraft', version:1 }, username:email, password,
      clientToken:require('crypto').randomBytes(16).toString('hex'), requestUser:true
    });
    const profile = res.selectedProfile;
    return { name:profile.name, uuid:profile.id, type:'Mojang', accessToken:res.accessToken, clientToken:res.clientToken, skinUrl:null };
  } catch(err) { return { error: err.message }; }
});

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

// ── Instances ──────────────────────────────────────────────────────────────────
const instances = {};
let instanceCounter = 0;
let lastLaunchData = null;
ipcMain.handle('get-instance-logs', (e, instanceId) => instances[instanceId]?.logs || []);
ipcMain.handle('get-instances', () => Object.values(instances).map(i=>({id:i.id,version:i.version,startTime:i.startTime,crashed:i.crashed})));

ipcMain.on('stop-minecraft', (e, instanceId) => {
  const inst = instances[instanceId];
  if (!inst) return;
  const cp = require('child_process');

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
  try { mainWindow.webContents.send('instance-closed', { instanceId, code: 0 }); } catch {}
  delete instances[instanceId];
});

// ── Launch ─────────────────────────────────────────────────────────────────────
ipcMain.on('launch-minecraft', async (event, data) => {
  lastLaunchData = data;
  const { version, javaPath, ram, ramUnit, profileMods, clientMods, clientResourcePacks, useClientMods, useClientRPs, accessToken, uuid, playerName, modLoader, useOriginalLauncher, profileId, profileName, mrpackMods, mrpackRPs, renderApi } = data;

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
  instances[instanceId] = { id:instanceId, version, startTime:Date.now(), logs:[], crashed:false, process:null, sessionRetried:false };
  mainWindow.webContents.send('instance-started', { id:instanceId, version, profileId, profileName, startTime:instances[instanceId].startTime, serverAddress: data.serverAddress||null, serverPort: data.serverPort||null, serverName: data.serverName||null });

  const send = (ch,...a) => { try { mainWindow.webContents.send(ch,...a); } catch {} };

  // Safety timeout: if nothing happens for 5 min, reset UI
  const safetyTimer = setTimeout(() => {
    try {
      if (instances[instanceId] && !instances[instanceId].crashed) {
        send('launch-status', 'Something took too long — please try again.');
        send('launch-progress', { instanceId, percent:0, message:'', done:true });
      }
    } catch {}
  }, 5 * 60 * 1000);

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
      const minor = parseInt(verParts[1]) || 0;
      if (minor >= 22) needed = 25;
      else if (minor >= 21) needed = 21;
      else if (minor >= 17) needed = 17;
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
      send('launch-status', 'No valid account. Please log in with a Microsoft or Mojang account in the MC-Account tab.');
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

      if (fs.existsSync(versionsDir)) {
        const dirs = fs.readdirSync(versionsDir);
        // Match pattern: fabric-loader-*-{mcVersion}
        fabricId = dirs.find(d => {
          const lower = d.toLowerCase();
          return lower.startsWith('fabric-loader-') && (d.endsWith(`-${version}`) || d.endsWith(version));
        }) || null;
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
      let quiltId = null;
      if (fs.existsSync(versionsDir)) {
        const dirs = fs.readdirSync(versionsDir);
        quiltId = dirs.find(d => {
          const lower = d.toLowerCase();
          return lower.startsWith('quilt-loader-') && d.includes(version);
        }) || null;
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
            neoId = newDirs.find(d => d.toLowerCase().startsWith('neoforge-' + neoPrefix)) || null;
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
        forgeId = dirs.find(d => d.toLowerCase().includes('forge') && d.includes(version)) || null;
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
                const foundInParent = pDirs.find(d => d.toLowerCase().includes('forge') && d.includes(version));
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
            forgeId = newDirs.find(d => d.toLowerCase().includes('forge') && d.includes(version)) || null;
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

    // ── Deploy mrpack mods (modpack overrides) ────────────────────────────────
    if (mrpackMods && mrpackMods.length) {
      send('launch-progress', { instanceId, percent:22, message:`Deploying ${mrpackMods.length} modpack mods...` });
      const modsDir = path.join(P.mc, 'mods');
      await fs.promises.mkdir(modsDir, { recursive: true });
      let deployed = 0;
      for (const mod of mrpackMods) {
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
                const dest = path.join(modsDir, `${mod.modrinthId}-${file.filename}`);
                if (!fs.existsSync(dest)) await downloadFile(file.url, dest);
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

      const modsDir = path.join(P.mc, 'mods');
      await fs.promises.mkdir(modsDir, { recursive: true });

      const clientModsRaw  = (data.useClientMods !== false) ? (data.clientMods || []) : [];
      const profileModsRaw = data.profileMods || [];
      const normalMods = clientModsRaw.filter(mod => mod.type !== 'jar');

      let toDeploy = [];
      for (const mod of normalMods) {
        if (mod.disabled) continue;
        if (mod.loader && mod.loader !== modLoader) continue;
        const vm = mod.downloadAllVersions || mod.mcVersion === version || mod.mcVersion === 'all' || mod.mcVersion === 'latest';
        if (!vm) continue;
        toDeploy.push(mod);
      }
      for (const mod of profileModsRaw) {
        if (mod.disabled) continue;
        if (!toDeploy.some(m => m.modrinthId && m.modrinthId === mod.modrinthId)) {
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

      send('launch-progress', { instanceId, percent:23, message:'Checking for mod updates...' });

      // ── Pre-scan: check which mods have a version for this MC version ──────────
      const unavailableMods = new Set();
      const modDepInfo = new Map();
      const versionCache = new Map();
      const modsUpdated = [];

      const existingFiles = fs.existsSync(modsDir) ? fs.readdirSync(modsDir) : [];

      for (const mod of toDeploy) {
        if (mod._isProfileMod) continue;
        if (!mod.modrinthId) continue;
        try {
          const gv = encodeURIComponent(`["${version}"]`);
          const ld = encodeURIComponent(`["${modLoader}"]`);
          let versions = await fetchJson(`https://api.modrinth.com/v2/project/${mod.modrinthId}/version?game_versions=${gv}&loaders=${ld}`);
          if (!versions || !versions.length) versions = await fetchJson(`https://api.modrinth.com/v2/project/${mod.modrinthId}/version?game_versions=${gv}`);
          if (!versions || !versions.length) {
            send('instance-log', { instanceId, line:`[MODS] ${mod.name} — not available for MC ${version}, trying latest version anyway...` });
            versions = await fetchJson(`https://api.modrinth.com/v2/project/${mod.modrinthId}/version`).catch(() => null);
            if (!versions || !versions.length) {
              unavailableMods.add(mod.modrinthId);
              send('instance-log', { instanceId, line:`[MODS] ${mod.name} — no version found at all, disabled` });
              continue;
            }
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
      const existingJars = fs.readdirSync(modsDir).filter(f => f.endsWith('.jar'));
      for (const jar of existingJars) {
        try { fs.unlinkSync(path.join(modsDir, jar)); } catch {}
      }

      // Refresh existingFiles after cleanup
      existingFiles.length = 0;
      existingFiles.push(...fs.readdirSync(modsDir).filter(f => f.endsWith('.jar')));

      // First pass: count already-downloaded mods
      let needsDownload = 0;
      for (const mod of toDeploy) {
        if (!mod.modrinthId) continue;
        const hasJar = existingFiles.some(f => f.startsWith(mod.modrinthId + '-') && f.endsWith('.jar'));
        if (!hasJar) needsDownload++;
      }

      if (needsDownload === 0) {
        send('launch-progress', { instanceId, percent:45, message:`${toDeploy.length} mods ready.` });
      } else {
        send('launch-progress', { instanceId, percent:24, message:`Downloading ${needsDownload}/${toDeploy.length} mods...` });
      }

      let deployed = 0;
      const totalDeploy = toDeploy.length;
      for (const mod of toDeploy) {
        if (!mod.modrinthId) continue;
        try {
          const hasJar = existingFiles.some(f => f.startsWith(mod.modrinthId + '-') && f.endsWith('.jar'));
          if (hasJar) { deployed++; continue; }

          const cached = versionCache.get(mod.modrinthId);
          const versionData = cached || await fetchJson(`https://api.modrinth.com/v2/project/${mod.modrinthId}/version`).catch(() => null);
          if (!versionData) continue;

          const file = versionData.files.find(f => f.primary) || versionData.files[0];
          if (!file) continue;

          const jarPath = path.join(modsDir, `${mod.modrinthId}-${file.filename}`);
          if (!fs.existsSync(jarPath)) await downloadFile(file.url, jarPath);
          deployed++;
          send('launch-progress', { instanceId, percent:Math.min(45,24+Math.round(deployed/totalDeploy*21)), message:`Downloaded: ${mod.name}` });
        } catch(e) {
          send('instance-log', { instanceId, line:`[MODS] Failed ${mod.name}: ${e.message}` });
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

    // ── Deploy mrpack resource packs ──────────────────────────────────────────
    if (mrpackRPs && mrpackRPs.length) {
      const rpDir = path.join(P.mc, 'resourcepacks');
      await fs.promises.mkdir(rpDir, { recursive: true });
      for (const rp of mrpackRPs) {
        try {
          if (rp.diskPath && fs.existsSync(rp.diskPath)) {
            const dest = path.join(rpDir, rp.fileName || `rp-${Date.now()}.zip`);
            if (!fs.existsSync(dest)) await fs.promises.copyFile(rp.diskPath, dest);
          } else if (rp.data && rp.data.length) {
            const buf = Buffer.from(rp.data);
            const dest = path.join(rpDir, rp.fileName || `rp-${Date.now()}.zip`);
            if (!fs.existsSync(dest)) await fs.promises.writeFile(dest, buf);
          }
        } catch {}
      }
    }

    // ── Deploy resource packs (all loaders, including vanilla) ─────────────
    const rpList = (data.useClientRPs !== false) ? (data.clientResourcePacks || []) : [];
    if (rpList.length) {
      const rpDir = path.join(P.mc, 'resourcepacks');
      await fs.promises.mkdir(rpDir, { recursive: true });

      const deployedRpNames = [];

      for (const rp of rpList) {
        try {
          let downloadUrl = null, fname = null;
          if (typeof rp === 'object' && rp.modrinthId) {
            const vd = await fetchJson(`https://api.modrinth.com/v2/project/${rp.modrinthId}/version`).catch(() => null);
            if (vd && vd.length) {
              const file = vd[0].files?.find(f => f.primary) || vd[0].files?.[0];
              if (file) { downloadUrl = file.url; fname = `rp-${rp.modrinthId}-${file.filename}`; }
            }
            if (!downloadUrl) {
              send('instance-log', { instanceId, line:`[RP] Failed to fetch download for ${rp.name || rp.modrinthId}` });
              continue;
            }
          } else if (typeof rp === 'string' && (rp.startsWith('http://') || rp.startsWith('https://'))) {
            downloadUrl = rp;
            fname = path.basename(rp.split('?')[0]) || `rp-${Date.now()}.zip`;
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
          if (!fs.existsSync(dest)) {
            send('launch-progress', { instanceId, percent:47, message:`Downloading RP: ${fname}` });
            await downloadFile(downloadUrl, dest);
          }
          deployedRpNames.push(fname);
        } catch(e) { send('instance-log', { instanceId, line:`[RP] Failed: ${e.message}` }); }
      }

      if (deployedRpNames.length) {
        const optionsPath = path.join(P.mc, 'options.txt');
        let options = '';
        if (fs.existsSync(optionsPath)) options = await fs.promises.readFile(optionsPath, 'utf8');

        const rpEntries = deployedRpNames.map(n => {
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

      send('launch-progress', { instanceId, percent:50, message:`${deployedRpNames.length} resource pack(s) activated.` });
    } else {
      // If no RPs configured, don't clear user's existing options.txt RP settings
    }

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
        const coreModsDir = path.join(P.mc, 'mods');
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
          icon: (() => { try { const b=fs.readFileSync(path.join(__dirname,'icons','profile-icon-base64.txt'),'utf8'); return b.trim(); } catch { return 'data:image/png;base64,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'; } })(),
          lastVersionId: customVer,
          javaArgs: `-Xmx${maxRam} -Xms${minRam}${renderApi==='vulkan'?' -Dorg.lwjgl.vulkan.libname=vulkan-1':''}`,
        };
        data2.selectedProfile = profileKey;
        await fs.promises.writeFile(profilesPath, JSON.stringify(data2, null, 2));
      } catch(e) { send('instance-log', { instanceId, line: `[LAUNCHER] Failed to write profile: ${e.message}` }); }

      // Launch official launcher and detect mod crashes
      const cp = require('child_process');
      (async () => {
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

    // Build a manual launch for NeoForge (mclc can't handle module-path from version JSON)
    async function buildNeoForgeLaunch() {
      const verDir = path.join(P.mc, 'versions', versionObj.custom);
      const verJsonPath = path.join(verDir, `${versionObj.custom}.json`);
      let verJson = JSON.parse(await fs.promises.readFile(verJsonPath, 'utf8'));

      // Merge inherited parent JSON libraries (NeoForge inherits vanilla MC libraries incl. LWJGL)
      if (verJson.inheritsFrom) {
        const parentPath = path.join(P.mc, 'versions', verJson.inheritsFrom, `${verJson.inheritsFrom}.json`);
        if (fs.existsSync(parentPath)) {
          const parentJson = JSON.parse(await fs.promises.readFile(parentPath, 'utf8'));
          // Merge parent libraries (parent first, child overrides)
          const mergedLibs = [...(parentJson.libraries || [])];
          for (const lib of (verJson.libraries || [])) {
            const existingIdx = mergedLibs.findIndex(l => l.name === lib.name);
            if (existingIdx >= 0) mergedLibs[existingIdx] = lib;
            else mergedLibs.push(lib);
          }
          verJson = { ...parentJson, ...verJson, libraries: mergedLibs };
          send('instance-log', { instanceId, line: `[NEOFORGE] Merged ${parentJson.libraries?.length||0} parent libs with ${verJson.libraries?.length||0} NeoForge libs` });
        }
      }

      const libDir = path.join(P.mc, 'libraries');
      const sep = path.delimiter;
      const versionName = versionObj.custom;

      const resolve = (s) => String(s)
        .replace(/\$\{library_directory\}/g, libDir)
        .replace(/\$\{classpath_separator\}/g, sep)
        .replace(/\$\{version_name\}/g, versionName)
        .replace(/\$\{assets_directory\}/g, path.join(P.mc, 'assets'))
        .replace(/\$\{game_directory\}/g, P.mc)
        .replace(/\$\{version_type\}/g, 'release');

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

      // Add the client jar
      const clientJar = path.join(verDir, `${versionName}.jar`);
      if (fs.existsSync(clientJar)) classpath.push(clientJar);

      // Build JVM args from version JSON
      const jvmArgs = [];
      for (const arg of (verJson.arguments?.jvm || [])) {
        if (typeof arg === 'string') {
          jvmArgs.push(resolve(arg));
        } else if (arg.rules) {
          // Feature-based rule check
          let allowed = true;
          if (arg.rules) {
            for (const rule of arg.rules) {
              if (rule.features) {
                for (const [k, v] of Object.entries(rule.features)) {
                  if (k === 'is_demo_user' && v === true && acc?.isDemo) { /* ok */ }
                  else if (k === 'has_custom_resolution' && v === true) { /* ok */ }
                  else { allowed = rule.action === 'allow'; }
                }
              }
              if (rule.os) {
                if (rule.os.name === 'osx' && process.platform !== 'darwin') allowed = rule.action === 'allow' ? false : true;
                if (rule.os.name === 'windows' && process.platform !== 'win32') allowed = rule.action === 'allow' ? false : true;
                if (rule.os.name === 'linux' && process.platform !== 'linux') allowed = rule.action === 'allow' ? false : true;
              }
            }
          }
          if (allowed && arg.value) {
            const vals = Array.isArray(arg.value) ? arg.value : [arg.value];
            for (const v of vals) jvmArgs.push(resolve(v));
          }
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

      // Build game args
      const gameArgs = [];
      for (const arg of (verJson.arguments?.game || [])) {
        if (typeof arg === 'string') {
          gameArgs.push(resolve(arg));
        } else if (arg.rules) {
          let allowed = true;
          for (const rule of (arg.rules || [])) {
            if (rule.features) {
              for (const [k, v] of Object.entries(rule.features)) {
                if (k === 'is_demo_user') allowed = (v === true) === !!acc?.isDemo;
                else if (k === 'has_custom_resolution') allowed = v === true;
              }
            }
          }
          if (allowed && arg.value) {
            const vals = Array.isArray(arg.value) ? arg.value : [arg.value];
            for (const v of vals) gameArgs.push(resolve(v));
          }
        }
      }

      // Auth placeholders
      const accessToken = data.accessToken || '0';
      const gameUuid = data.uuid || '00000000-0000-0000-0000-000000000000';
      const playerName = data.playerName || 'Player';

      for (let i = 0; i < gameArgs.length; i++) {
        gameArgs[i] = gameArgs[i]
          .replace(/\$\{auth_player_name\}/g, playerName)
          .replace(/\$\{auth_session\}/g, accessToken)
          .replace(/\$\{auth_access_token\}/g, accessToken)
          .replace(/\$\{auth_uuid\}/g, gameUuid)
          .replace(/\$\{user_properties\}/g, '{}')
          .replace(/\$\{user_type\}/g, 'msa')
          .replace(/\$\{version_name\}/g, version)
          .replace(/\$\{game_directory\}/g, P.mc)
          .replace(/\$\{assets_directory\}/g, path.join(P.mc, 'assets'))
          .replace(/\$\{asset_index\}/g, verJson.assetIndex?.id || version);
      }

      // Always add auth at end if not present
      if (!gameArgs.includes(accessToken)) gameArgs.push('--accessToken', accessToken);
      if (!gameArgs.includes(gameUuid)) gameArgs.push('--uuid', gameUuid);
      if (!gameArgs.includes(playerName)) gameArgs.push('--username', playerName);
      if (!gameArgs.some(a => a === '--version')) gameArgs.push('--version', version);
      if (!gameArgs.some(a => a === '--gameDir' || a === '-d')) gameArgs.push('--gameDir', P.mc);
      if (!gameArgs.some(a => a === '--assetsDir')) gameArgs.push('--assetsDir', path.join(P.mc, 'assets'));

      // Direct server connect from Recent
      if (data.serverAddress) {
        gameArgs.push('--server', data.serverAddress);
        if (data.serverPort) gameArgs.push('--port', String(data.serverPort));
      }

      // Crux Client custom arg — placed AFTER -cp but before mainClass
      // forge.eagerDisplay=false disables NeoForge EarlyDisplay entirely
      // fml.earlyWindowControl=false is an alternative property name
      // forge.eagerGlVersion=4.5 forces GL 4.5 if early display still runs
      jvmArgs.push('-Dforge.eagerDisplay=false');
      jvmArgs.push('-Dfml.earlyWindowControl=false');
      jvmArgs.push('-Dforge.eagerGlVersion=4.5');
      jvmArgs.push('-Dminecraft.window.title=Crux Client');
      // Use Mesa3D software OpenGL if available (for broken GPU drivers)
      const mesaGL = await ensureMesa();
      if (mesaGL) {
        const mesaDir = path.dirname(mesaGL);
        jvmArgs.push(`-Dorg.lwjgl.opengl.libpath=${mesaDir}`);
        jvmArgs.push('-Dorg.lwjgl.opengl.libname=opengl32');
        send('instance-log', { instanceId, line: `[LAUNCH] Using Mesa3D software OpenGL from: ${mesaDir}` });
      }
      if (data.renderApi === 'vulkan') jvmArgs.push('-Dorg.lwjgl.vulkan.libname=vulkan-1');

      return { javaPath: resolvedJava, mainClass, jvmArgs, gameArgs };
    }

    async function mclcLaunchOnce() {
      // For NeoForge: manual launch with resolved version JSON
      if (modLoader === 'neoforge' && versionObj.custom) {
        try {
          // Disable NeoForge EarlyDisplay by renaming its JAR (crashes on old AMD drivers)
          const earlyDisplayJar = path.join(P.mc, 'libraries', 'net', 'neoforged', 'fancymodloader', 'earlydisplay', '4.0.42', 'earlydisplay-4.0.42.jar');
          const earlyDisplayDisabled = earlyDisplayJar + '.disabled';
          try {
            if (fs.existsSync(earlyDisplayJar)) {
              await fs.promises.rename(earlyDisplayJar, earlyDisplayDisabled);
              send('instance-log', { instanceId, line: `[NEOFORGE] Disabled EarlyDisplay (renamed JAR)` });
            }
          } catch (e) {
            send('instance-log', { instanceId, line: `[NEOFORGE] EarlyDisplay disable failed: ${e.message}` });
          }

          // Also patch fml.toml as backup
          const fmlTomlPath = path.join(P.mc, 'config', 'fml.toml');
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

          const { javaPath, mainClass, jvmArgs, gameArgs } = await buildNeoForgeLaunch();
          send('launch-progress', { instanceId, percent:20, message:`Launching NeoForge with ${mainClass}...` });
          send('instance-log', { instanceId, line: `[NEOFORGE] Java: ${javaPath}` });
          send('instance-log', { instanceId, line: `[NEOFORGE] Main: ${mainClass}` });

          const allArgs = [...jvmArgs, mainClass, ...gameArgs];
          send('instance-log', { instanceId, line: `[NEOFORGE] Args: ${allArgs.slice(0, 10).join(' ')}...` });

          const proc = spawn(javaPath, allArgs, { cwd: P.mc, detached: false, stdio: ['ignore', 'pipe', 'pipe'] });
          if (proc) instances[instanceId].process = proc;

          let modCrash = false;
          let gpuDriverCrash = false;
          const handleLine = (line) => {
            const s = String(line).trim(); if (!s) return;
            instances[instanceId].logs.push(s);
            send('instance-log', { instanceId, line: s });
            if (s.toLowerCase().includes('setting user')) {
              send('launch-progress', { instanceId, percent:100, message:'Minecraft running!' });
              send('mc-launched', instanceId);
            }
            if (s.toLowerCase().includes('incompatible mods found') || s.toLowerCase().includes('some of your mods are incompatible') || s.includes('FormattedException') || s.includes('Mod resolution failed') || s.toLowerCase().includes('error loading mod') || s.toLowerCase().includes('failed to load mod') || s.toLowerCase().includes('uncaught exception')) {
              modCrash = true;
            }
            if (s.includes('atio6axx.dll') || s.includes('EXCEPTION_ACCESS_VIOLATION') && s.includes('Video')) {
              gpuDriverCrash = true;
            }
          };
          proc.stdout.on('data', d => d.toString().split('\n').forEach(handleLine));
          proc.stderr.on('data', d => d.toString().split('\n').forEach(handleLine));

          return new Promise((resolve) => {
            proc.on('close', (code) => {
              // Restore EarlyDisplay JAR after launch
              try {
                if (fs.existsSync(earlyDisplayDisabled)) {
                  fs.renameSync(earlyDisplayDisabled, earlyDisplayJar);
                }
              } catch {}
              if (gpuDriverCrash) {
                send('launch-error', 'GPU-Treiber-Problem: atio6axx.dll crasht bei OpenGL. Bitte aktualisiere deinen AMD Radeon Treiber auf Version 26.6.4 oder neuer: https://www.amd.com/en/support/download/drivers.html');
              }
              resolve({ code, modCrash });
            });
            proc.on('error', (err) => {
              try { if (fs.existsSync(earlyDisplayDisabled)) fs.renameSync(earlyDisplayDisabled, earlyDisplayJar); } catch {}
              send('instance-log', { instanceId, line:`[LAUNCH ERROR] ${err.message}` });
              resolve({ code: -1, modCrash: false });
            });
          });
        } catch(neErr) {
          send('instance-log', { instanceId, line:`[NEOFORGE LAUNCH ERROR] ${neErr.message}` });
          // Fall through to mclc
        }
      }

      // For other loaders: use mclc
      const mclcMesaGL = await ensureMesa();
      const mclcCustomArgs = ['-Dminecraft.window.title=Crux Client'];
      if (mclcMesaGL) {
        const mclcMesaDir = path.dirname(mclcMesaGL);
        mclcCustomArgs.push(`-Dorg.lwjgl.opengl.libpath=${mclcMesaDir}`);
        mclcCustomArgs.push('-Dorg.lwjgl.opengl.libname=opengl32');
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
          overrides: { detached: false },
        };
        let modCrash = false;

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
            send('launch-progress', { instanceId, percent:100, message:'Minecraft running!' });
            send('mc-launched', instanceId);
          }
          if (s.toLowerCase().includes('incompatible mods found') || s.toLowerCase().includes('some of your mods are incompatible') || s.includes('FormattedException') || s.includes('Mod resolution failed') || s.toLowerCase().includes('error loading mod') || s.toLowerCase().includes('failed to load mod') || s.toLowerCase().includes('uncaught exception')) {
            modCrash = true;
          }
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
          const msg = err.message || String(err);
          instances[instanceId].logs.push('[ERROR] ' + msg);
          send('instance-log', { instanceId, line:'[ERROR] '+msg });
          send('launch-progress', { instanceId, percent:0, message:'', done:true });
        });
        launcher.on('close', (code) => {
          resolve({ code, modCrash });
        });

        launcher.launch(launchOpts).then(proc => {
          if (proc) instances[instanceId].process = proc;
        }).catch(err => {
          send('instance-log', { instanceId, line:`[LAUNCH ERROR] ${err.message}` });
          resolve({ code: -1, modCrash: false });
        });
      });
    }

    send('launch-status', 'Preparing Minecraft...');
    send('launch-progress', { instanceId, percent:20, message:'Starting Minecraft...' });

    const mclcResult = await mclcLaunchOnce();
    clearTimeout(safetyTimer);

    send('instance-log', { instanceId, line:`--- Process exited (code ${mclcResult.code}) ---` });
    send('launch-progress', { instanceId, percent:0, message:'', done:true });
    send('instance-closed', { instanceId, code: mclcResult.code });
    if (mclcResult.code !== 0 && mclcResult.code !== null) {
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

// ── Crash window ───────────────────────────────────────────────────────────────
function showCrashWindow(instanceId, code, log) {
  const cw = new BrowserWindow({ width:700, height:500, title:'Minecraft Crashed', parent:mainWindow, webPreferences:{ nodeIntegration:true, contextIsolation:false } });
  cw.setMenu(null);
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{margin:0;background:#1a0000;color:#ff6b6b;font-family:monospace;font-size:12px;display:flex;flex-direction:column;height:100vh;overflow:hidden;}
    .header{padding:16px;background:#2a0000;border-bottom:1px solid #550000;flex-shrink:0;}
    .header h2{margin:0;color:#ff4444;} .header p{margin:4px 0 0;color:#cc4444;font-size:12px;}
    pre{flex:1;overflow:auto;padding:16px;margin:0;white-space:pre-wrap;word-break:break-all;line-height:1.4;}
    .close-btn{padding:8px 20px;background:#550000;border:1px solid #880000;color:#ff6b6b;cursor:pointer;margin:12px;border-radius:4px;}
  </style></head><body>
    <div class="header"><h2>💥 Minecraft Crashed</h2><p>Exit code: ${code} · Instance: ${instanceId}</p></div>
    <pre>${log.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
    <button class="close-btn" onclick="window.close()">Close</button>
  </body></html>`;
  cw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

// ── Update ────────────────────────────────────────────────────────────────────
const CURRENT_VERSION = require('./package.json').version;
const GITHUB_REPO = 'Dev-Reds/crux-client';
const JSZip = require('jszip');

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
  const r = parseVersion(remote);
  const l = parseVersion(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const a = r[i] || 0, b = l[i] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

ipcMain.handle('check-for-update', async () => {
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
      updateLog(`Update available! Launcher.zip: ${url ? 'yes' : 'NO'} | Installer: ${installerUrl ? installer.name : 'NO'}`);
      return {
        updateAvailable: true,
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
});

ipcMain.handle('download-and-install-update', async (e, downloadUrl, installerUrl) => {
  const isAsar = __dirname.endsWith('app.asar') || process.env.APPIMAGE;
  const send = (...a) => { try { mainWindow.webContents.send(...a); } catch {} };

  if (isAsar) {
    // Installed version: download installer exe and run it
    updateLog('Installed version detected — downloading installer...');
    const exeUrl = installerUrl || downloadUrl.replace(/Launcher\.zip$/i, 'Crux-Client-Installer.exe');
    updateLog(`Installer URL: ${exeUrl}`);
    const installerPath = path.join(base, 'Crux-Client-Installer.exe');

    // Download installer with progress
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

    updateLog('Installer downloaded. Removing security block (Zone.Identifier)...');
    try {
      await new Promise((resolve, reject) => {
        exec(`powershell -NoProfile -Command "Unblock-File -Path '${installerPath}'"`, { timeout: 10000, shell: true }, (err) => {
          if (err) updateLog('Unblock-File warning: ' + (err.message || err));
          resolve();
        });
      });
    } catch {}
    updateLog('Starting silent install...');
    try {
      await new Promise((resolve, reject) => {
        const c = exec(`"${installerPath}" /S`, { timeout: 300000, shell: true }, (err) => {
          if (err) reject(err); else resolve();
        });
        c.on('error', reject);
      });
      updateLog('Install finished. Restarting...');
    } catch (e) {
      updateLog('Silent install failed, trying normal launch: ' + (e.message || e));
      try {
        spawn(`"${installerPath}"`, [], { shell: true, detached: true, stdio: 'ignore' }).unref();
      } catch (e2) {
        updateLog('Spawn also failed, trying exec start: ' + (e2.message || e2));
        exec(`start "" "${installerPath}"`, { shell: true });
      }
    }
    await new Promise(r => setTimeout(r, 2000));
    app.quit();
  } else {
    // Dev mode: extract zip over source files
    updateLog('Dev mode detected — extracting zip...');
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
    app.relaunch();
    app.quit();
  }
});

// ── Uninstall ─────────────────────────────────────────────────────────────────
ipcMain.handle('uninstall-app', async () => {
  if (mainWindow) mainWindow.destroy();

  // Delete client data folder
  try {
    const dataDir = path.join(process.env.APPDATA || process.env.LOCALAPPDATA || '', 'Crux Client');
    if (fs.existsSync(dataDir)) {
      await fs.promises.rm(dataDir, { recursive: true, force: true });
    }
  } catch {}

  const exePath = app.getPath('exe');
  const appDir = path.dirname(exePath);
  const uninstallName = `Uninstall ${path.basename(exePath, '.exe')}.exe`;
  const uninstallPath = path.join(appDir, uninstallName);
  if (fs.existsSync(uninstallPath)) {
    exec(`"${uninstallPath}"`, () => app.quit());
  } else {
    const altDir = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Crux Client');
    const altPath = path.join(altDir, uninstallName);
    if (fs.existsSync(altPath)) {
      exec(`"${altPath}"`, () => app.quit());
    } else {
      app.quit();
    }
  }
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
        mainWindow.webContents.send('server-log', { id, line: `[SERVER] Downloading ${isPlugin ? 'plugin' : 'mod'}: ${mod.name}...` });
        const loader = isPlugin ? 'paper' : type;
        const gv = mcVersion ? `[\"${mcVersion}\"]` : '[]';
        const ld = loader ? `[\"${loader}\"]` : '[]';
        let versions = await fetchJson(`https://api.modrinth.com/v2/project/${mod.id}/version?game_versions=${gv}&loaders=${ld}`).catch(() => null);
        if (!versions || !versions.length) versions = await fetchJson(`https://api.modrinth.com/v2/project/${mod.id}/version`).catch(() => null);
        if (versions && versions.length && versions[0].files && versions[0].files.length) {
          const file = versions[0].files[0];
          const dest = path.join(modsDir, file.filename);
          if (!fs.existsSync(dest)) await downloadFile(file.url, dest);
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

// Stop all servers (called on app quit)
function stopAllServers() {
  for (const [id, srv] of Object.entries(serverProcesses)) {
    if (srv.status === 'running' && srv.process) {
      try { srv.process.stdin.write('stop\n'); } catch {}
      try { srv.process.kill('SIGKILL'); } catch {}
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

// ── Mesa3D Auto-Setup ─────────────────────────────────────────────────────────
// Automatically downloads Mesa3D software OpenGL for systems with broken GPU drivers
const MESA_URL = 'https://github.com/pal1000/mesa-dist-win/releases/download/26.1.3/mesa3d-26.1.3-release-mingw.7z';
const MESA_7Z_SIZE = 57000000; // ~54MB

async function ensureMesa() {
  const mesaDir = path.join(base, 'mesa');
  const mesaGL = path.join(mesaDir, 'x64', 'opengl32.dll');
  if (fs.existsSync(mesaGL)) return mesaGL;

  const tmpDir = path.join(base, '_mesa_tmp');
  const mesa7z = path.join(tmpDir, 'mesa.7z');
  try { await fs.promises.mkdir(tmpDir, { recursive: true }); } catch {}

  try {
    mainWindow.webContents.send('launch-status', 'Lade Mesa3D Software-OpenGL herunter (~54MB)...');

    await downloadFile(MESA_URL, mesa7z, (pct) => {
      const msg = `Mesa3D Download: ${Math.round(pct)}%`;
      try { mainWindow.webContents.send('launch-progress', { instanceId: '_mesa', percent: Math.round(pct * 0.7), message: msg }); } catch {}
    });

    mainWindow.webContents.send('launch-status', 'Entpacke Mesa3D...');

    const script = `
      const path = require('path');
      const fs = require('fs');
      const tmpDir = ${JSON.stringify(tmpDir)};
      const mesaDir = ${JSON.stringify(mesaDir)};

      async function extract() {
        let _7z;
        try { _7z = require('node-7z'); } catch(e) {
          const { execSync } = require('child_process');
          execSync('npm install node-7z --prefix ' + JSON.stringify(tmpDir) + ' --no-save', { stdio: 'ignore' });
          _7z = require(path.join(tmpDir, 'node_modules', 'node-7z'));
        }
        const stream = await _7z.extractFull(path.join(tmpDir, 'mesa.7z'), tmpDir, { recursive: true });
        return new Promise((resolve, reject) => {
          stream.on('end', resolve);
          stream.on('error', reject);
        });
      }
      extract().then(() => {
        fs.mkdirSync(mesaDir, { recursive: true });
        const src = path.join(tmpDir, 'x64');
        const dst = path.join(mesaDir, 'x64');
        if (fs.existsSync(src)) fs.cpSync(src, dst, { recursive: true });
        console.log('OK');
      }).catch(e => { console.error(e.message); process.exit(1); });
    `;
    await new Promise((resolve, reject) => {
      const c = exec(`node -e "${script.replace(/"/g, '\\"')}"`, { stdio: 'pipe', timeout: 120000 }, (err) => {
        if (err) reject(err); else resolve();
      });
      c.on('error', reject);
    });

    if (fs.existsSync(mesaGL)) {
      mainWindow.webContents.send('launch-status', 'Mesa3D installiert!');
      try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
      return mesaGL;
    }
  } catch (e) {
    try { mainWindow.webContents.send('instance-log', { instanceId: '_mesa', line: `[MESA] Setup failed: ${e.message}` }); } catch {}
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



