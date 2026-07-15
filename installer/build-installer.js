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
