import { _electron as electron } from 'playwright';
import defaultExecutable from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const packaged = process.argv.includes('--packaged');
const label = packaged ? 'packaged' : 'dev';
const dataDir = resolve(`.local-data/native-v12-${label}-${Date.now()}`);
await mkdir(dataDir, { recursive: true });
await mkdir('test-results', { recursive: true });
const env = { ...process.env, MINDNOTE_TEST_MODE: '1', MINDNOTE_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: packaged ? resolve('out/MindNote-win32-x64/MindNote.exe') : defaultExecutable,
  args: packaged ? [] : ['.'],
  env,
  cwd: resolve('.'),
});
const checks = [];
const result = {
  version: JSON.parse(await readFile('package.json', 'utf8')).version,
  packaged,
  checks,
  animations: [],
  corners: [],
};
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const hash = (data) => createHash('sha256').update(data).digest('hex');
try {
  const sticky = await app.firstWindow();
  await sticky.waitForFunction(() => !!window.mindnote);
  const paths = await app.evaluate(({ app }) =>
    Object.fromEntries(
      ['userData', 'sessionData', 'logs', 'crashDumps'].map((key) => [key, app.getPath(key)]),
    ),
  );
  for (const value of Object.values(paths)) assert(value.toLowerCase().startsWith(dataDir.toLowerCase()));
  result.paths = paths;
  checks.push('database, Chromium session, logs and crash dumps use the isolated data directory');
  await sticky.evaluate(() => window.mindnote.showMain());
  let main;
  for (let i = 0; i < 100; i++) {
    main = app.windows().find((p) => p.url().includes('view=main'));
    if (main) break;
    await wait(30);
  }
  await main.waitForFunction(() => !!window.mindnote);
  await wait(200);
  for (const side of ['left', 'right', 'top', 'bottom']) {
    const bounds = await app.evaluate(({ BrowserWindow, screen }, side) => {
      const window = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('view=sticky'),
      );
      const work = screen.getPrimaryDisplay().workArea;
      const b = { x: work.x + 80, y: work.y + 80, width: 360, height: 560 };
      if (side === 'left') b.x = work.x + 8;
      if (side === 'right') b.x = work.x + work.width - b.width - 8;
      if (side === 'top') b.y = work.y + 8;
      if (side === 'bottom') b.y = work.y + work.height - b.height - 8;
      window.setBounds(b);
      window.emit('will-move', { preventDefault() {} }, b);
      window.emit('moved');
      return { bounds: window.getBounds(), work };
    }, side);
    const b = bounds.bounds,
      w = bounds.work;
    const gap =
      side === 'left'
        ? b.x - w.x
        : side === 'right'
          ? w.x + w.width - b.x - b.width
          : side === 'top'
            ? b.y - w.y
            : w.y + w.height - b.y - b.height;
    assert(Math.abs(gap) <= 2, `${side} snap gap ${gap}`);
  }
  checks.push('all four display edges snap within the 16-DIP threshold');
  const raw = Buffer.alloc(16 * 32 * 4);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 16; x++) {
      const i = (y * 16 + x) * 4;
      raw[i] = y < 16 ? 255 : 0;
      raw[i + 2] = y < 16 ? 0 : 255;
      raw[i + 3] = 255;
    }
  for (const format of ['gif', 'webp']) {
    const file = join(dataDir, `two-frames.${format}`);
    await sharp(raw, { raw: { width: 16, height: 32, channels: 4, pageHeight: 16 } })
      [format]({ loop: 0, delay: [120, 120], lossless: true })
      .toFile(file);
    assert.equal((await sharp(file, { animated: true }).metadata()).pages, 2);
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, file);
    const imported = await main.evaluate(() => window.mindnote.importBackgroundImage());
    const image = imported.snapshot.settings.backgroundImage;
    assert(image && image.mimeType === `image/${format}`);
    const regular = await main.evaluate((id) => window.mindnote.getBackgroundImageURL(id), image.id);
    const still = await main.evaluate((id) => window.mindnote.getBackgroundImageURL(id, true), image.id);
    assert(regular.startsWith('mindnote-image://background/'));
    assert(still.endsWith('?still=1'));
    const bytes = await app.evaluate(async ({ net }, url) => {
      const res = await net.fetch(url);
      return {
        mime: res.headers.get('content-type'),
        cache: res.headers.get('cache-control'),
        bytes: [...new Uint8Array(await res.arrayBuffer())],
      };
    }, regular);
    assert.equal(hash(Buffer.from(bytes.bytes)), hash(await readFile(file)));
    assert.equal(bytes.cache, 'no-store');
    const frozen = await app.evaluate(async ({ net }, url) => {
      const res = await net.fetch(url);
      return { mime: res.headers.get('content-type'), bytes: [...new Uint8Array(await res.arrayBuffer())] };
    }, still);
    assert.equal(frozen.mime, 'image/png');
    const { data } = await sharp(Buffer.from(frozen.bytes))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert(data[0] > 200 && data[2] < 40, 'Reduced-motion image is the red first frame');
    const canLoad = await sticky.evaluate(
      (url) =>
        new Promise((done) => {
          const image = new Image();
          image.onload = () => done(image.naturalWidth === 16);
          image.onerror = () => done(false);
          image.src = url;
        }),
      regular,
    );
    assert(canLoad, 'Another window loads the stored animation');
    result.animations.push({
      format,
      sha256: hash(Buffer.from(bytes.bytes)),
      firstFrame: [...data.subarray(0, 4)],
    });
  }
  checks.push(
    'GIF and animated WebP remain byte-identical; reduce-motion returns the actual first PNG frame across windows',
  );
  assert(
    await main.evaluate(async () => {
      try {
        await window.mindnote.getBackgroundImageURL('../mindnote.sqlite');
        return false;
      } catch {
        return true;
      }
    }),
  );
  const invalid = join(dataDir, 'fake.png');
  await writeFile(invalid, 'not an image');
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, invalid);
  assert(
    await main.evaluate(async () => {
      try {
        await window.mindnote.importBackgroundImage();
        return false;
      } catch {
        return true;
      }
    }),
  );
  checks.push('invalid paths and spoofed image extensions are rejected');
  await main.evaluate(() =>
    window.mindnote.dispatch({ type: 'settings.update', patch: { backgroundImage: null } }),
  );
  for (const [name, page] of [
    ['sticky', sticky],
    ['main', main],
  ]) {
    await page.bringToFront();
    await wait(150);
    const file = resolve('test-results', `v12-aa-${name}-${label}.png`);
    await page.screenshot({ path: file, omitBackground: true });
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = new Set();
    for (let y = 0; y < 35; y++) for (let x = 0; x < 35; x++) alpha.add(data[(y * info.width + x) * 4 + 3]);
    const partial = [...alpha].filter((v) => v > 0 && v < 255);
    assert(partial.length >= 8, `${name} corner has smooth intermediate alpha coverage`);
    result.corners.push({ name, distinctPartialAlpha: partial.length, file });
  }
  checks.push(
    'both Chromium-rendered corners contain antialiased alpha coverage, without a binary native region',
  );
  await writeFile(
    resolve('test-results', `native-v12-${label}.json`),
    JSON.stringify({ ...result, ok: true }, null, 2),
  );
  console.log(JSON.stringify({ ...result, ok: true }, null, 2));
} finally {
  await app.close();
}
