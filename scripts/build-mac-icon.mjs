import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Modern ICNS stores separately encoded PNGs for each display density.
const source = await readFile(new URL('../assets/icon.png', import.meta.url));
const sizes = {
  icp4: 16,
  icp5: 32,
  icp6: 64,
  ic07: 128,
  ic08: 256,
  ic09: 512,
  ic10: 1024,
  ic11: 32,
  ic12: 64,
  ic13: 256,
  ic14: 512,
};
const chunk = (type, bytes) => {
  const header = Buffer.alloc(8);
  header.write(type, 'ascii');
  header.writeUInt32BE(bytes.length + 8, 4);
  return Buffer.concat([header, bytes]);
};
const images = await Promise.all(
  Object.entries(sizes).map(async ([type, size]) => {
    const png = await sharp(source)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    return chunk(type, png);
  }),
);
const directory = new URL('../.local-data/mac-icon/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('icon.icns', directory), chunk('icns', Buffer.concat(images)));
