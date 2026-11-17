import sharp from 'sharp';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// The user-supplied image is the artwork of record. Preserve its complete
// composition and alpha rather than cropping, tracing, recoloring, or redrawing.
const sourceURL = new URL('../UI Reference/MindNote-1.1-用户图标.png', import.meta.url);
const assetsURL = new URL('../assets/', import.meta.url);
const source = await readFile(sourceURL);
const metadata = await sharp(source).metadata();
if (!metadata.width || !metadata.height || !metadata.hasAlpha) {
  throw new Error('MindNote 图标源文件必须是带透明通道的 PNG 图像。');
}
await mkdir(assetsURL, { recursive: true });
await copyFile(sourceURL, new URL('icon.png', assetsURL));

const resize = (size) =>
  sharp(source)
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: 'lanczos3',
    })
    .png()
    .toBuffer();
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = await Promise.all(sizes.map(resize));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const p = 6 + i * 16;
  header[p] = size === 256 ? 0 : size;
  header[p + 1] = header[p];
  header.writeUInt16LE(1, p + 4);
  header.writeUInt16LE(32, p + 6);
  header.writeUInt32LE(pngs[i].length, p + 8);
  header.writeUInt32LE(offset, p + 12);
  offset += pngs[i].length;
});
await writeFile(new URL('icon.ico', assetsURL), Buffer.concat([header, ...pngs]));
const tray = await resize(32);
await writeFile(new URL('tray.png', assetsURL), tray);

// Keep compatible SVG asset names as explicit raster wrappers, not an invented
// vector recreation of the supplied design.
const wrapper = (png, width, height) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>MindNote user-supplied artwork</title><image width="${width}" height="${height}" href="data:image/png;base64,${png.toString('base64')}"/></svg>\n`;
await writeFile(new URL('icon.svg', assetsURL), wrapper(source, metadata.width, metadata.height));
await writeFile(new URL('tray.svg', assetsURL), wrapper(tray, 32, 32));
console.log(
  JSON.stringify(
    {
      source: fileURLToPath(sourceURL),
      sha256: createHash('sha256').update(source).digest('hex'),
      png: 'exact copy',
      icoSizes: sizes,
      traySize: 32,
    },
    null,
    2,
  ),
);
