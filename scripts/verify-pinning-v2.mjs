import { _electron as electron } from 'playwright';
import defaultExecutable from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const packaged = process.argv.includes('--packaged');
const baseline = process.argv.includes('--baseline');
if (baseline && !packaged) throw new Error('--baseline must target the previous packaged application');
const label = baseline ? 'baseline' : packaged ? 'packaged' : 'dev';
const dataDir = resolve(`.local-data/pinning-${label}-${Date.now()}`);
const output = resolve('test-results');
await mkdir(output, { recursive: true });
const env = { ...process.env, MINDNOTE_TEST_MODE: '1', MINDNOTE_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
delete env.MINDNOTE_DEV_URL;
let app, sticky, main;
const results = { baseline, packaged, dataDir, checks: [], recoveries: [], compositor: [] };
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(fn, name) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await wait(40);
  }
  throw new Error(`Timed out: ${name}`);
}
async function start() {
  app = await electron.launch({
    executablePath: packaged ? resolve('out/MindNote-win32-x64/MindNote.exe') : defaultExecutable,
    args: packaged ? [] : ['.'],
    cwd: resolve('.'),
    env,
  });
  sticky = await app.firstWindow();
  await sticky.waitForFunction(() => !!window.mindnote);
  await until(async () => (await state()).visible, 'visible sticky');
  results.version = await app.evaluate(({ app }) => app.getVersion());
  await sticky.evaluate(() => window.mindnote.showMain());
  await until(async () => {
    main = app.windows().find((p) => p.url().includes('view=main'));
    return !!main;
  }, 'main');
  await main.waitForFunction(() => !!window.mindnote);
}
async function state() {
  return app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('view=sticky'));
    return window
      ? {
          id: window.id,
          pinned: window.isAlwaysOnTop(),
          visible: window.isVisible(),
          minimized: window.isMinimized(),
          focused: window.isFocused(),
        }
      : null;
  });
}
async function pin(value) {
  return main.evaluate(
    (pinned) => window.mindnote.dispatch({ type: 'settings.update', patch: { pinned } }),
    value,
  );
}
async function clearNativePin() {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('view=sticky'))
      .setAlwaysOnTop(false),
  );
}
async function recovered(name, action) {
  await action();
  await wait(120);
  const actual = await state();
  results.recoveries.push({ name, ...actual });
  if (!baseline) assert(actual.pinned && actual.visible && !actual.minimized, name);
}
async function captureOverlap(expectPinned) {
  const file = resolve(output, `pinning-${expectPinned ? 'on' : 'off'}-${label}.png`);
  const info = await app.evaluate(async ({ BrowserWindow, desktopCapturer, screen }, file) => {
    const note = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('view=sticky'));
    const bounds = note.getBounds(),
      display = screen.getDisplayMatching(bounds);
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(display.bounds.width * display.scaleFactor),
        height: Math.round(display.bounds.height * display.scaleFactor),
      },
    });
    const source = sources.find((s) => s.display_id === String(display.id));
    const size = source.thumbnail.getSize(),
      sx = size.width / display.bounds.width,
      sy = size.height / display.bounds.height;
    const rect = {
      x: Math.round((bounds.x - display.bounds.x) * sx),
      y: Math.round((bounds.y - display.bounds.y) * sy),
      width: Math.round(bounds.width * sx),
      height: Math.round(bounds.height * sy),
    };
    process.getBuiltinModule('node:fs').writeFileSync(file, source.thumbnail.crop(rect).toPNG());
    return { sx, sy };
  }, file);
  const { data, info: pixels } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const index = (Math.round(100 * info.sy) * pixels.width + Math.round(30 * info.sx)) * 3;
  const sample = [...data.subarray(index, index + 3)];
  const isMagenta = sample[0] > 150 && sample[1] < 110 && sample[2] > 100 && sample[0] > sample[1] + 70;
  assert.equal(isMagenta, !expectPinned, 'Actual desktop composition matches the pin state');
  results.compositor.push({ pinned: expectPinned, sample, file });
}

try {
  await start();
  assert.equal((await state()).pinned, false);
  await pin(true);
  assert((await state()).pinned);
  results.checks.push('settings enable and disable a real topmost window');

  await app.evaluate(async ({ BrowserWindow, screen }) => {
    const note = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('view=sticky'));
    const area = screen.getPrimaryDisplay().workArea;
    note.setBounds({ x: area.x + 80, y: area.y + 60, width: 360, height: 560 });
    const b = note.getBounds();
    const helper = new BrowserWindow({
      ...b,
      show: false,
      frame: false,
      backgroundColor: '#DC2D93',
      title: 'MindNote pinning verification',
      webPreferences: { sandbox: true },
    });
    await helper.loadURL('data:text/html,<body style="margin:0;background:%23DC2D93"></body>');
    helper.show();
    helper.focus();
    helper.moveTop();
  });
  await wait(200);
  await captureOverlap(true);
  assert(!(await state()).focused, 'Pinning does not steal focus from a normal foreground window');
  await pin(false);
  await app.evaluate(({ BrowserWindow }) => {
    const helper = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('data:'));
    helper.focus();
    helper.moveTop();
  });
  await wait(160);
  await captureOverlap(false);
  results.checks.push(
    'desktop compositor: pinned note stays over a focused ordinary window; unpinned note yields',
  );

  await pin(true);
  await sticky.evaluate(() => window.mindnote.hideWindow());
  await clearNativePin();
  await recovered('hidden note recovers pin when the shared tray/showSticky route reopens it', () =>
    main.evaluate(() => window.mindnote.showSticky()),
  );

  await pin(true);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('view=sticky'))
      .close(),
  );
  assert.equal((await state()).visible, false);
  await clearNativePin();
  await recovered('native close hides without destroying; tray route restores the saved pin', () =>
    main.evaluate(() => window.mindnote.showSticky()),
  );

  await pin(true);
  await sticky.evaluate(() => window.mindnote.minimizeWindow());
  await until(async () => (await state()).minimized, 'minimized sticky');
  await clearNativePin();
  await recovered('showSticky restores a minimized note and its pin', () =>
    main.evaluate(() => window.mindnote.showSticky()),
  );

  await pin(true);
  await sticky.evaluate(() => window.mindnote.minimizeWindow());
  await clearNativePin();
  await recovered('native restore event reasserts the saved pin', () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('view=sticky'))
        .restore(),
    ),
  );

  for (const event of ['resume', 'unlock-screen']) {
    await pin(true);
    await clearNativePin();
    await app.evaluate(({ BrowserWindow }) => {
      const helper = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('data:'));
      helper.focus();
    });
    await recovered(`${event} lifecycle event repairs native flag drift`, () =>
      app.evaluate(({ powerMonitor }, event) => powerMonitor.emit(event), event),
    );
    if (!baseline) assert(!(await state()).focused, `${event} must not steal keyboard focus`);
  }
  await pin(true);
  await clearNativePin();
  await recovered('display reconfiguration repairs visible native pin', () =>
    app.evaluate(({ screen }) =>
      screen.emit('display-metrics-changed', {}, screen.getPrimaryDisplay(), ['workArea']),
    ),
  );
  results.checks.push(
    'fault injection covers show, close-to-tray, minimize, native restore, resume, unlock and display events',
  );

  await pin(false);
  await sticky.evaluate(() => window.mindnote.hideWindow());
  await app.evaluate(({ powerMonitor }) => {
    powerMonitor.emit('resume');
    powerMonitor.emit('unlock-screen');
  });
  assert.equal((await state()).visible, false, 'Lifecycle events do not reopen a hidden note');
  await main.evaluate(() => window.mindnote.showSticky());
  assert.equal((await state()).pinned, false, 'Reopening preserves the explicit unpinned setting');
  results.checks.push('unpin remains off and hidden notes stay hidden across system lifecycle events');

  await pin(true);
  const oldId = (await state()).id;
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('view=sticky'))
      .destroy(),
  );
  await main.evaluate(() => window.mindnote.showSticky());
  await until(async () => (await state())?.visible, 'recreated sticky');
  assert((await state()).id !== oldId && (await state()).pinned);
  results.checks.push('recreated sticky reads the persisted pin setting');

  await app.close();
  app = null;
  await start();
  assert((await state()).pinned, 'Restart restores the persisted pin');
  results.checks.push('restart retains pin state');
  if (baseline)
    assert(
      results.recoveries.some((r) => !r.pinned),
      'Previous package reproduces a lifecycle gap',
    );
  await writeFile(
    resolve(output, `pinning-v2-${label}.json`),
    JSON.stringify({ ...results, ok: true }, null, 2),
  );
  console.log(JSON.stringify({ ...results, ok: true }, null, 2));
} finally {
  if (app) await app.close();
}
