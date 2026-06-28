const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');

const electronVersion = '41.2.1';
const outDir = path.join(__dirname, '..', 'exe');
const packageName = 'Crux Client-v1.0-6';
const appDirName = `${packageName}-darwin-x64`;
const appDir = path.join(outDir, appDirName);
const appBundleName = `${packageName}.app`;
const appBundlePath = path.join(appDir, appBundleName);
const zipUrl = `https://github.com/electron/electron/releases/download/v${electronVersion}/electron-v${electronVersion}-darwin-x64.zip`;
const zipFile = path.join(outDir, 'electron-darwin.zip');
const extractDir = path.join(outDir, 'electron-darwin-tmp');

console.log(`\n=== Packaging for macOS ===`);

function copyRecursive(src, dest, filter) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry);
    if (filter && filter(srcPath)) continue;
    const destPath = path.join(dest, entry);
    if (fs.statSync(srcPath).isDirectory()) {
      copyRecursive(srcPath, destPath, filter);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

try {
  // Download
  if (!fs.existsSync(zipFile)) {
    console.log('Downloading Electron for macOS (~70 MB)...');
    execSync(`curl -L -o "${zipFile}" "${zipUrl}"`, { stdio: 'inherit', timeout: 300000 });
    console.log('Downloaded.');
  }

  // Clean
  if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true });
  if (fs.existsSync(appDir)) fs.rmSync(appDir, { recursive: true });
  fs.mkdirSync(extractDir, { recursive: true });

  // Extract using tar (handles cross-platform zip)
  console.log('Extracting...');
  execSync(`tar -xf "${zipFile}" -C "${extractDir}"`, { stdio: 'inherit' });

  // Find extracted .app
  const entries = fs.readdirSync(extractDir);
  const electronApp = entries.find(e => e.endsWith('.app'));
  if (!electronApp) throw new Error('Electron.app not found');

  fs.mkdirSync(appDir, { recursive: true });
  fs.renameSync(path.join(extractDir, electronApp), appBundlePath);

  // Copy app files into Contents/Resources/app
  const appResDir = path.join(appBundlePath, 'Contents', 'Resources', 'app');
  fs.mkdirSync(appResDir, { recursive: true });

  const appRoot = path.join(__dirname, '..');
  for (const f of ['main.js', 'index.html', 'package.json']) {
    fs.copyFileSync(path.join(appRoot, f), path.join(appResDir, f));
  }

  // Copy node_modules
  const srcModules = path.join(appRoot, 'node_modules');
  const dstModules = path.join(appResDir, 'node_modules');
  for (const mod of ['minecraft-launcher-core', 'express', 'adm-zip']) {
    copyRecursive(path.join(srcModules, mod), path.join(dstModules, mod));
  }

  // Update Info.plist
  const plistPath = path.join(appBundlePath, 'Contents', 'Info.plist');
  if (fs.existsSync(plistPath)) {
    let plist = fs.readFileSync(plistPath, 'utf8');
    plist = plist.replace(/Electron/g, 'Crux Client');
    plist = plist.replace(/com\.github\.electron/g, 'com.cruxclient.launcher');
    fs.writeFileSync(plistPath, plist);
  }

  // Rename main binary
  const macosDir = path.join(appBundlePath, 'Contents', 'MacOS');
  const electronBin = path.join(macosDir, 'Electron');
  const cruxBin = path.join(macosDir, 'Crux Client');
  if (fs.existsSync(electronBin)) fs.renameSync(electronBin, cruxBin);

  // Clean
  fs.rmSync(extractDir, { recursive: true });
  fs.rmSync(zipFile, { force: true });

  // Create zip for distribution
  console.log('Creating zip archive...');
  const zipTarget = path.join(outDir, `${appDirName}.zip`);
  execSync(`tar -acf "${zipTarget}" "${appBundleName}"`, { stdio: 'inherit', cwd: appDir });
  // Also copy zip into installer folder
  const installerZip = path.join(outDir, '..', 'installer', `${appDirName}.zip`);
  fs.copyFileSync(zipTarget, installerZip);

  console.log(`macOS .app: ${appBundlePath}`);
  console.log(`macOS zip:  ${zipTarget}`);
  console.log('macOS packaging completed successfully.');
} catch (error) {
  console.error('macOS packaging failed:', error.message);
  try { fs.rmSync(zipFile, { force: true }); } catch {}
  try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
  process.exit(error.status || 1);
}
