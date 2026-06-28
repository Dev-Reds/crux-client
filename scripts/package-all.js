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

const platforms = [
  { platform: 'win32',  suffix: 'win32-x64' },
  { platform: 'darwin', suffix: 'darwin-x64' },
  { platform: 'linux',  suffix: 'linux-x64' },
];

for (const { platform, suffix } of platforms) {
  let packageName = baseName;
  let targetPath = path.join(outDir, `${packageName}-${suffix}`);
  let index = 1;
  while (fs.existsSync(targetPath)) {
    packageName = `${baseName}-${index}`;
    targetPath = path.join(outDir, `${packageName}-${suffix}`);
    index += 1;
  }

  const command = `npx electron-packager . "${packageName}" --platform=${platform} --arch=x64 --out=exe --overwrite=false --asar=false`;
  console.log(`\n=== Packaging for ${platform} ===`);
  console.log(`Package name: ${packageName}`);
  console.log(`Output folder: ${targetPath}`);
  console.log('Running:', command);

  try {
    execSync(command, { stdio: 'inherit' });
    console.log(`Packaging for ${platform} completed successfully.`);
  } catch (error) {
    console.error(`Packaging for ${platform} failed:`, error.message);
    process.exit(error.status || 1);
  }
}

console.log('\nAll platforms packaged successfully.');
