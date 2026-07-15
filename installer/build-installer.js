const { execSync } = require('child_process');
const path = require('path');

const buildAll = process.argv.includes('--all');
const targets = buildAll ? '--win --linux' : '--win';

console.log(`Building Crux Client installer${buildAll ? ' (Windows + Linux)' : ' (Windows only)'} (x64)...`);
console.log('Output folder:', path.join(__dirname));

try {
  execSync(`npx electron-builder ${targets} --x64`, {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  });
  console.log('Installer built successfully in installer/ folder.');
} catch (error) {
  console.error('Installer build failed.');
  process.exit(error.status || 1);
}

const installerPath = path.join(__dirname, 'Crux-Client-Installer.exe');
try {
  console.log('Signing installer with Crux Client certificate...');
  execSync(`powershell -NoProfile -Command "$cert = Get-ChildItem Cert:\\CurrentUser\\My | Where-Object { \\$_.Subject -like '*Crux Client*' } | Select-Object -First 1; if (\\$cert) { Set-AuthenticodeSignature -FilePath '${installerPath}' -Certificate \\$cert -TimestampServer 'http://timestamp.digicert.com' -HashAlgorithm SHA256; Write-Host 'Installer signed successfully.' } else { Write-Host 'WARNING: Crux Client certificate not found. Installer unsigned.' }"`, {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  });
} catch (e) {
  console.log('Signing skipped (certificate not found or error).');
}
