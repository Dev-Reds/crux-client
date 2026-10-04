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
  const signScript = [
    `$file = '${installerPath}';`,
    '$cert = Get-ChildItem Cert:\\CurrentUser\\My | Where-Object { $_.Subject -like \'*Crux Client*\' } | Select-Object -First 1;',
    'if (-not $cert) { Write-Host \'WARNING: Crux Client certificate not found. Installer unsigned.\'; exit 0 }',
    `Set-AuthenticodeSignature -FilePath $file -Certificate $cert -TimestampServer 'http://timestamp.digicert.com' -HashAlgorithm SHA256 | Out-Null;`,
    // -Command "..." bricht, sobald das Skript Anfuehrungszeichen enthaelt (cmd.exe
    // schluckt das innere " ...). -EncodedCommand (UTF-16LE + Base64) ist robust.
    '$sig = Get-AuthenticodeSignature -FilePath $file;',
    "if ($sig.Status -eq 'Valid') { Write-Host 'Installer signed successfully.' }",
    "else { Write-Host ('SIGNING FAILED: ' + $sig.Status + ' - ' + $sig.StatusMessage) }",
  ].join('\n');
  const encoded = Buffer.from(signScript, 'utf16le').toString('base64');
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  });
} catch (e) {
  console.log('Signing skipped (certificate not found or error).');
}
