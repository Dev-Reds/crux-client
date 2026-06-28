const { app, BrowserWindow, ipcMain, shell } = require('electron');
const https = require('https');
const http  = require('http');
const { exec, execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { URL } = require('url');

let mainWindow;
let authWindow = null;

// ── Paths ──────────────────────────────────────────────────────────────────────
const base = path.join(process.env.APPDATA || process.env.LOCALAPPDATA || '', 'Crux Client');
['Cache','javaInstallations','client-mods','minecraft'].forEach(d => fs.mkdirSync(path.join(base, d), { recursive: true }));
const P = {
  settings: path.join(base,'settings.json'),
  accounts: path.join(base,'accounts.json'),
  profiles: path.join(base,'profiles.json'),
  mods:     path.join(base,'mods.json'),
  launched: path.join(base,'launched-versions.json'),
  clientMods: path.join(base,'client-mods'),
  java: path.join(base,'javaInstallations'),
  mc:   path.join(base,'minecraft'),
};
app.setPath('userData', base);
app.setPath('cache', path.join(base,'Cache'));

// ── Window ─────────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:1200, height:800, minWidth:900, minHeight:600,
    autoHideMenuBar:true,
    webPreferences:{ nodeIntegration:true, contextIsolation:false }
  });
  mainWindow.setMenu(null);
  mainWindow.loadFile('index.html');
}
app.whenReady().then(async () => {
  createWindow();
  // Auto-scan Java in background after window loads
  mainWindow.webContents.on('did-finish-load', async () => {
    try {
      const javas = await findInstalledJavas();
      mainWindow.webContents.send('java-scan-result', javas);
    } catch {}
  });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── Persist ────────────────────────────────────────────────────────────────────
const load = (file, def) => { try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return def; } };
const save = (file, data) => { try { fs.writeFileSync(file, JSON.stringify(data,null,2)); } catch {} };

ipcMain.handle('load-settings',          () => load(P.settings, {}));
ipcMain.handle('load-accounts',          () => load(P.accounts, []));
ipcMain.handle('load-profiles',          () => load(P.profiles, [{ id:'default', name:'Default', mcVersion:'', modLoader:'fabric', mods:[], datapacks:[], resourcePacks:[], shaderPacks:[] }]));
ipcMain.handle('load-mods',              () => load(P.mods, []));
ipcMain.handle('load-launched-versions', () => load(P.launched, []));
ipcMain.on('save-settings',          (e,d) => save(P.settings, d));
ipcMain.on('save-accounts',          (e,d) => save(P.accounts, d));
ipcMain.on('save-profiles',          (e,d) => save(P.profiles, d));
ipcMain.on('save-launched-versions', (e,d) => save(P.launched, d));
ipcMain.on('close-launcher', () => { if(mainWindow) mainWindow.hide(); });
ipcMain.on('show-launcher', () => { if(mainWindow) mainWindow.show(); });
ipcMain.on('save-mods', (e, data) => {
  save(P.mods, data);
  const byVer = {};
  for (const m of data) { if (!byVer[m.mcVersion]) byVer[m.mcVersion]=[]; byVer[m.mcVersion].push(m); }
  for (const [ver,mods] of Object.entries(byVer)) {
    const dir = path.join(P.clientMods, ver); fs.mkdirSync(dir, { recursive:true });
    for (const m of mods) { const safe = m.name.replace(/[^a-zA-Z0-9_\-. ]/g,'_'); save(path.join(dir,`${safe}.json`), m); }
  }
});

let mcVersionList = [];

// ── MC Versions ────────────────────────────────────────────────────────────────
ipcMain.handle('get-versions', async () => {
  return new Promise((res, rej) => {
    https.get('https://launchermeta.mojang.com/mc/game/version_manifest.json', r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{
        try {
          const versions = JSON.parse(d).versions.map(v=>({id:v.id,type:v.type,url:v.url}));
          mcVersionList = versions;
          res(versions);
        } catch(e){rej(e);}
      });
    }).on('error',rej);
  });
});

// ── Java ───────────────────────────────────────────────────────────────────────
async function findInstalledJavas(cb) {
  const found = []; const seenPaths = new Set(); let n=0;
  function addJava(p, v) {
    const resolved = path.resolve(p);
    if (seenPaths.has(resolved)) return;
    seenPaths.add(resolved);
    found.push({ path: p, version: v }); n++;
  }
  try {
    const out = await new Promise((r,rj)=>exec('where java',(e,o)=>e?rj(e):r(o)));
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
    if (!fs.existsSync(dir)) continue;
    if(cb)cb(Math.min(90, 20 + n*10), `Checking ${path.basename(dir)}`);
    const st = fs.statSync(dir);
    if (st.isFile() && dir.toLowerCase().endsWith('java.exe')) {
      const v=await getJavaVersion(dir); if(v) addJava(dir, v);
    } else if (st.isDirectory()) {
      const direct = path.join(dir, 'bin', 'java.exe');
      if (fs.existsSync(direct)) { const v=await getJavaVersion(direct); if(v) addJava(direct, v); }
      try {
        for (const item of fs.readdirSync(dir)) {
          const jp = path.join(dir, item, 'bin', 'java.exe');
          if (fs.existsSync(jp)) { const v=await getJavaVersion(jp); if(v) addJava(jp, v); }
        }
      } catch {}
    }
  }
  if(cb)cb(100,'Scan complete');
  return found;
}

async function getJavaVersion(p) {
  try {
    const o = await new Promise((r,rj)=>exec(`"${p}" -version`,(e,o,se)=>e?rj(e):r(se)));
    const m = o.match(/version "([^"]+)"/);
    if (!m) return null;
    const ver = m[1];
    // Parse: "21.0.2" -> "21", "1.8.0_291" -> "8"
    const parts = ver.split('.');
    if (parts[0] === '1') return parts[1]; // old format
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

// ── Instances ──────────────────────────────────────────────────────────────────
const instances = {};
let instanceCounter = 0;
let lastLaunchData = null;
ipcMain.handle('get-instance-logs', (e, instanceId) => instances[instanceId]?.logs || []);
ipcMain.handle('get-instances', () => Object.values(instances).map(i=>({id:i.id,version:i.version,startTime:i.startTime,crashed:i.crashed})));

ipcMain.on('stop-minecraft', (e, instanceId) => {
  const inst = instances[instanceId];
  if (!inst) return;
  if (inst.process) {
    try { inst.process.kill('SIGTERM'); } catch {}
    setTimeout(() => { try { inst.process.kill('SIGKILL'); } catch {} }, 2000);
  }
  // Only use taskkill as absolute last resort — it kills ALL java instances
  // so we avoid it when multiple instances may be running
});

// ── Launch ─────────────────────────────────────────────────────────────────────
ipcMain.on('launch-minecraft', async (event, data) => {
  lastLaunchData = data;
  const { version, javaPath, ram, ramUnit, profileMods, clientMods, clientResourcePacks, useClientMods, useClientRPs, accessToken, uuid, playerName, modLoader, useOriginalLauncher, profileId, profileName } = data;

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
  instances[instanceId] = { id:instanceId, version, startTime:Date.now(), logs:[], crashed:false, process:null };
  mainWindow.webContents.send('instance-started', { id:instanceId, version, profileId, profileName, startTime:instances[instanceId].startTime });

  const send = (ch,...a) => { try { mainWindow.webContents.send(ch,...a); } catch {} };

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

    const effectiveNeeded = modLoader === 'forge' ? Math.max(needed, 21) : needed;

    // For Forge: ALWAYS ignore dropdown and scan fresh — the installer needs Java 21+
    // For others: check selected first, scan only if insufficient
    const javaVer = resolvedJava ? (parseInt(await getJavaVersion(resolvedJava).catch(()=>'0')) || 0) : 0;
    send('instance-log', { instanceId, line: `[JAVA] Selected: ${resolvedJava||'none'} → Java ${javaVer}, need ${effectiveNeeded}+` });

    if (modLoader === 'forge' || !resolvedJava || javaVer < effectiveNeeded) {
      send('launch-progress', { instanceId, percent:2, message:`Scanning for Java ${effectiveNeeded}+...` });
      const javas = await findInstalledJavas();
      send('instance-log', { instanceId, line: `[JAVA] Scan found: ${javas.map(j=>`Java${j.version}@${j.path}`).join(' | ')||'none'}` });
      let valid = javas.filter(j => (parseInt(j.version)||0) >= effectiveNeeded);

      // Auto-download required Java from Adoptium if none found
      if (!valid.length) {
        const dlVer = Math.min(Math.max(effectiveNeeded, 17), 25);
        send('launch-progress', { instanceId, percent:3, message:`No Java ${effectiveNeeded}+ found. Downloading Java ${dlVer} from Adoptium...` });
        try {
          const assets = await fetchJson(`https://api.adoptium.net/v3/assets/latest/${dlVer}/hotspot?os=windows&arch=x64&image_type=jre&heap_size=normal&vendor=eclipse`);
          if (!assets || !assets.length) throw new Error('No Adoptium assets');
          const asset = assets.find(a=>a.binary.package.link.endsWith('.zip')) || assets[0];
          const url = asset.binary.package.link;
          const fn  = path.basename(url.split('?')[0]);
          const fp  = path.join(base, fn);
          if (!fs.existsSync(fp)) await downloadFile(url, fp);
          const AdmZip = require('adm-zip');
          const extractTo = path.join(P.java, `jre-${dlVer}`);
          fs.mkdirSync(extractTo, {recursive:true});
          new AdmZip(fp).extractAllTo(extractTo, true);
          const javaExeFound = findJavaExe(extractTo);
          if (javaExeFound) {
            valid = [{ path: javaExeFound, version: String(dlVer) }];
            send('launch-progress', { instanceId, percent:10, message:`Java ${dlVer} downloaded and ready.` });
          }
        } catch(dlErr) {
          send('launch-status', `Need Java ${effectiveNeeded}+, none found and auto-download failed: ${dlErr.message}`);
          send('launch-progress', { instanceId, percent:0, message:'', done:true });
          send('no-java-found', effectiveNeeded);
          return;
        }
      }

      if (!valid.length) {
        send('launch-status', `Need Java ${effectiveNeeded}+. None found. Install Java ${effectiveNeeded} and rescan in Settings.`);
        send('launch-progress', { instanceId, percent:0, message:'', done:true });
        send('no-java-found', effectiveNeeded);
        return;
      }

      valid.sort((a,b) => (parseInt(a.version)||0) - (parseInt(b.version)||0));
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
          return;
        }
      } else if (data.accountType === 'Microsoft' || data.refreshToken) {
        // Microsoft account — verify token, refresh via MS OAuth if expired
        try {
          const profileCheck = await getJson('https://api.minecraftservices.com/minecraft/profile', accessToken);
          if (profileCheck && profileCheck.error === 'Unauthorized') {
            tokenOk = false;
          }
        } catch {
          // Network error — proceed anyway, might still work
        }

        if (!tokenOk) {
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
            } catch {}
          }

          if (!tokenOk) {
            send('launch-status', 'Session expired. Please log in again in the MC-Account tab.');
            send('launch-progress', { instanceId, percent:0, message:'', done:true });
            return;
          }
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
      // Offline mode — no server access, default skin
      const { Authenticator } = require('minecraft-launcher-core');
      auth = Authenticator.getAuth(playerName || 'Player');
      send('instance-log', { instanceId, line: '[AUTH] Offline mode — skin and multiplayer not available. Add a Microsoft account in MC-Account tab.' });
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
                    fs.mkdirSync(dst, {recursive:true});
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

    // ── Deploy mods ────────────────────────────────────────────────────────────
    if (modLoader === 'fabric' || modLoader === 'forge') {
      send('launch-progress', { instanceId, percent:22, message:'Preparing mods...' });

      const modsDir = path.join(P.mc, 'mods');
      fs.mkdirSync(modsDir, { recursive: true });

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

      // Auto-add required Fabric dependencies when using Fabric
      if (modLoader === 'fabric') {
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

      send('launch-progress', { instanceId, percent:23, message:'Checking mod availability...' });

      // ── Pre-scan: check which mods have a version for this MC version ──────────
      const unavailableMods = new Set();
      const modDepInfo = new Map();
      const versionCache = new Map();

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
          const deps = versions[0].dependencies || [];
          modDepInfo.set(mod.modrinthId, deps);
          versionCache.set(mod.modrinthId, versions[0]);
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

      // ── Clean mods folder: remove JARs not in toDeploy ─────────────────────────────
      const deployIds = new Set(toDeploy.map(m => m.modrinthId).filter(Boolean));
      const existingJars = fs.readdirSync(modsDir).filter(f => f.endsWith('.jar'));
      for (const jar of existingJars) {
        const idMatch = jar.match(/^([^-]+)-/);
        if (idMatch && !deployIds.has(idMatch[1])) {
          try { fs.unlinkSync(path.join(modsDir, jar)); } catch {}
        }
      }

      const existingFiles = fs.existsSync(modsDir) ? fs.readdirSync(modsDir) : [];

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
    }

    // ── Deploy resource packs (all loaders, including vanilla) ─────────────
    const rpList = (data.useClientRPs !== false) ? (data.clientResourcePacks || []) : [];
    if (rpList.length) {
      const rpDir = path.join(P.mc, 'resourcepacks');
      fs.mkdirSync(rpDir, { recursive: true });

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
        if (fs.existsSync(optionsPath)) options = fs.readFileSync(optionsPath, 'utf8');

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

        fs.writeFileSync(optionsPath, options);
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
        return;
      }
      // Write launcher_profiles.json into the DEFAULT .minecraft directory so the official launcher sees it
      const defaultMcDir = path.join(process.env.APPDATA || '', '.minecraft');
      const profilesPath = path.join(defaultMcDir, 'launcher_profiles.json');
      let originalProfiles = null;
      let deployedMods = [];
      let profileKey;
      try {
        originalProfiles = fs.readFileSync(profilesPath, 'utf8');
      } catch {}

      // Copy mod loader version to official launcher's versions dir so mods work
      let customVer = version;
      if (versionObj && versionObj.custom) {
        const srcVer = path.join(P.mc, 'versions', versionObj.custom);
        const dstVer = path.join(defaultMcDir, 'versions', versionObj.custom);
        if (fs.existsSync(srcVer) && !fs.existsSync(dstVer)) {
          try {
            const copyDir = (s, d) => {
              fs.mkdirSync(d, { recursive: true });
              for (const item of fs.readdirSync(s)) {
                const sp = path.join(s, item);
                const dp = path.join(d, item);
                if (fs.statSync(sp).isDirectory()) copyDir(sp, dp);
                else fs.copyFileSync(sp, dp);
              }
            };
            copyDir(srcVer, dstVer);
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
              fs.mkdirSync(libDir, { recursive: true });
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
        const existing = (() => { try { return JSON.parse(fs.readFileSync(profilesPath,'utf8')); } catch { return null; } })();
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
            fs.mkdirSync(officialModsDir, { recursive: true });
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
          javaArgs: `-Xmx${maxRam} -Xms${minRam}`,
        };
        data2.selectedProfile = profileKey;
        fs.writeFileSync(profilesPath, JSON.stringify(data2, null, 2));
      } catch(e) { send('instance-log', { instanceId, line: `[LAUNCHER] Failed to write profile: ${e.message}` }); }

      // Launch official launcher and detect mod crashes
      const cp = require('child_process');
      (async () => {
        // Spawn launcher and wait for it to close
        await new Promise((resolve) => {
          const proc = cp.spawn(exe, [], { stdio: 'ignore' });
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
                const content = fs.readFileSync(path.join(crashReportsDir, report.name), 'utf8');
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
      return;
    }

    // ── Launch with auto-fix retry ──────────────────────────────────────────────
    async function mclcLaunchOnce() {
      return new Promise((resolve) => {
        const launcher = new Client();
        const launchOpts = {
          clientPackage: null,
          authorization: auth,
          root: P.mc,
          version: versionObj,
          memory: { max: maxRam, min: minRam },
          javaPath: resolvedJava,
          customArgs: ['-Dminecraft.window.title=Crux Client'],
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

    send('instance-log', { instanceId, line:`--- Process exited (code ${mclcResult.code}) ---` });
    send('launch-progress', { instanceId, percent:0, message:'', done:true });
    send('instance-closed', { instanceId, code: mclcResult.code });
    if (mclcResult.code !== 0 && mclcResult.code !== null) {
      instances[instanceId].crashed = true;
      if (!mclcResult.modCrash) showCrashWindow(instanceId, mclcResult.code, instances[instanceId].logs.slice(-80).join('\n'));
      send('instance-crashed', { instanceId, code: mclcResult.code });
    }

  } catch(err) {
    send('launch-status', 'Launch error: ' + err.message);
    send('launch-progress', { instanceId, percent:0, message:'', done:true });
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

// ── Uninstall ─────────────────────────────────────────────────────────────────
ipcMain.handle('uninstall-app', async () => {
  if (mainWindow) mainWindow.destroy();
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

// ── HTTP helpers ───────────────────────────────────────────────────────────────
function postForm(url, params) {
  return new Promise((resolve, reject) => {
    const body = Object.entries(params).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const u = new URL(url);
    const req = https.request({ hostname:u.hostname, path:u.pathname, method:'POST',
      headers:{ 'Content-Type':'application/x-www-form-urlencoded', 'Content-Length':Buffer.byteLength(body) }
    }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{resolve(JSON.parse(d));}catch(e){reject(e);} }); });
    req.on('error', reject); req.write(body); req.end();
  });
}
function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const b = JSON.stringify(body), u = new URL(url);
    const req = https.request({ hostname:u.hostname, path:u.pathname, method:'POST',
      headers:{ 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(b) }
    }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{resolve(JSON.parse(d));}catch(e){reject(e);} }); });
    req.on('error', reject); req.write(b); req.end();
  });
}
function getJson(url, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.request({ hostname:u.hostname, path:u.pathname, method:'GET',
      headers:{ 'Authorization':`Bearer ${token}` }
    }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{resolve(JSON.parse(d));}catch(e){reject(e);} }); }).on('error',reject).end();
  });
}
function fetchJson(url) {
  return new Promise((r,rj) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, res => {
      let d='';
      res.on('data',c=>d+=c);
      res.on('end',()=>{
        if(!d.trim()){ rj(new Error('Empty response from '+url.slice(0,80))); return; }
        try{r(JSON.parse(d));}catch(e){rj(new Error('JSON parse error: '+e.message+' body: '+d.slice(0,100)));}
      });
    }).on('error',rj);
  });
}
function fetchText(url) {
  return new Promise((r,rj) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchText(res.headers.location).then(r).catch(rj); return;
      }
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>r(d));
    }).on('error',rj);
  });
}
function downloadFile(url, dest) {
  return new Promise((r,rj) => {
    const go=(u,hops=0)=>{
      if(hops>5)return rj(new Error('Too many redirects'));
      const lib=u.startsWith('https')?https:http;
      lib.get(u, res=>{
        if(res.statusCode>=300&&res.statusCode<400&&res.headers.location){go(res.headers.location,hops+1);return;}
        if(res.statusCode!==200)return rj(new Error('Download failed: '+res.statusCode));
        const f=fs.createWriteStream(dest); res.pipe(f); f.on('finish',()=>f.close(r)); f.on('error',rj);
      }).on('error',rj);
    };
    go(url);
  });
}
function findJavaExe(dir) {
  for(const i of fs.readdirSync(dir)){
    const f=path.join(dir,i);
    if(fs.statSync(f).isDirectory()){
      const jp=path.join(f,'bin','java.exe'); if(fs.existsSync(jp)) return jp;
      const found=findJavaExe(f); if(found) return found;
    }
  }
  return null;
}

