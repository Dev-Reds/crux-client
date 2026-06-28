const { Jimp } = require('jimp');
const fs = require('fs');
const path = require('path');

const srcPng = path.join(__dirname, '..', 'Crux-Client.png');
const outDir = path.join(__dirname, '..', 'icons');

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const image = await Jimp.read(srcPng);

  // Resize for electron app icon (256x256)
  const appIcon = image.clone().resize({ w: 256, h: 256 });
  await appIcon.write(path.join(outDir, 'icon.png'));

  // Resize for favicon (32x32)
  const favicon = image.clone().resize({ w: 32, h: 32 });
  await favicon.write(path.join(outDir, 'favicon.png'));

  // Resize for launcher profile icon (64x64)
  const profileIcon = image.clone().resize({ w: 64, h: 64 });
  const profileBuf = await profileIcon.getBuffer('image/png');
  const profileBase64 = 'data:image/png;base64,' + profileBuf.toString('base64');
  fs.writeFileSync(path.join(outDir, 'profile-icon-base64.txt'), profileBase64);

  // Also create .ico for Windows (just the PNG wrapped as ico)
  const icoBuf = await appIcon.getBuffer('image/png');
  const ico = createIco(icoBuf);
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);

  console.log('Icons generated:');
  console.log(`  icons/icon.png        (256x256)`);
  console.log(`  icons/icon.ico        (Windows)`);
  console.log(`  icons/favicon.png     (32x32)`);
  console.log(`  icons/profile-icon-base64.txt`);
}

function createIco(pngData) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);       // Reserved
  header.writeUInt16LE(1, 2);       // ICO type
  header.writeUInt16LE(1, 4);       // 1 image

  const dir = Buffer.alloc(16);
  dir.writeUInt8(0, 0);             // Width (0=256)
  dir.writeUInt8(0, 1);             // Height (0=256)
  dir.writeUInt8(0, 2);             // Colors
  dir.writeUInt8(0, 3);             // Reserved
  dir.writeUInt16LE(1, 4);          // Color planes
  dir.writeUInt16LE(32, 6);         // Bits per pixel
  dir.writeUInt32LE(pngData.length, 8);   // Image size
  dir.writeUInt32LE(22, 12);        // Image offset (header + dir)

  return Buffer.concat([header, dir, pngData]);
}

main().catch(console.error);
