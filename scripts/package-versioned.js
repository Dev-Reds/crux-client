const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');

const version = pkg.version || '1.0.0';
const [major, minor] = version.split('.').map(v => parseInt(v, 10) || 0);
const versionLabel = `v${major}.${minor}`;
const suffix = major > 1 || minor > 1 ? '-higher' : '';
const baseName = `Crux Client-${versionLabel}${suffix}`;
const outDir = path.join(__dirname, '..', 'exe');

let packageName = baseName;
let targetPath = path.join(outDir, `${packageName}-win32-x64`);
let index = 1;
while (fs.existsSync(targetPath)) {
  packageName = `${baseName}-${index}`;
  targetPath = path.join(outDir, `${packageName}-win32-x64`);
  index += 1;
}

const command = `npx electron-packager . "${packageName}" --platform=win32 --arch=x64 --out=exe --overwrite=false --asar=false`;
console.log(`Packaging app as: ${packageName}`);
console.log(`Output folder: ${targetPath}`);
console.log('Running:', command);

try {
  execSync(command, { stdio: 'inherit' });
  console.log('Packaging completed successfully.');
} catch (error) {
  console.error('Packaging failed.');
  process.exit(error.status || 1);
}
