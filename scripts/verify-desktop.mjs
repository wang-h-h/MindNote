import { _electron as electron } from 'playwright';
import defaultExecutable from 'electron';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';

// Native regression intentionally talks to the public preload bridge. UI flows
// belong in smoke.mjs so visual redesigns do not silently remove native checks.
const packaged = process.argv.includes('--packaged');
const label = packaged ? 'packaged' : 'dev';
const executablePath = packaged ? resolve('out/MindNote-win32-x64/MindNote.exe') : defaultExecutable;
const dataDir = resolve(`.local-data/native-${label}-${Date.now()}`);
const output = resolve('test-results');
await mkdir(output, { recursive: true });
const env = { ...process.env, MINDNOTE_TEST_MODE: '1', MINDNOTE_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
const baseArgs = packaged ? [] : ['.'];
let app, sticky, main;
const errors = [];
const version = JSON.parse(await readFile(resolve('package.json'), 'utf8')).version;
const results = { version, packaged, dataDir, checks: [], dpi: [], screenshots: [] };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(condition, label) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await condition()) return;
    await wait(50);
  }
  throw new Error(`Timed out: ${label}`);
}
function watchPage(page) {
  page.on('pageerror', (error) => errors.push(error.message));
}
async function start(scale = 1.5) {
  app = await electron.launch({
    executablePath,
    args: [...baseArgs, `--force-device-scale-factor=${scale}`],
    cwd: resolve('.'),
    env,
    timeout: 30000,
  });
  app.on('window', watchPage);
  sticky = await app.firstWindow();
  watchPage(sticky);
  await sticky.waitForURL('**view=sticky');
  await sticky.waitForFunction(() => !!window.mindnote && !document.querySelector('.startup'));
  await waitFor(
    () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (window) => window.webContents.getURL().includes('view=sticky') && window.isVisible(),
        ),
      ),
    'sticky ready-to-show',
  );
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    1,
    'Only the sticky note is created at startup',
  );
  main = undefined;
}
async function openMain() {
  await sticky.evaluate(() => window.mindnote.showMain());
  await waitFor(async () => {
    main = app.windows().find((page) => page.url().includes('view=main'));
    return !!main;
  }, 'lazy main window');
  await main.waitForFunction(() => !!window.mindnote && !document.querySelector('.startup'));
  await waitFor(
    () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (window) => window.webContents.getURL().includes('view=main') && window.isVisible(),
        ),
      ),
    'main ready-to-show',
  );
}
async function snapshot() {
  return sticky.evaluate(() => window.mindnote.getSnapshot());
}
async function dispatch(command) {
  return sticky.evaluate((command) => window.mindnote.dispatch(command), command);
}
async function nativeState() {
  return app.evaluate(({ BrowserWindow, screen, nativeTheme }) => ({
    theme: nativeTheme.themeSource,
    windows: BrowserWindow.getAllWindows().map((window) => ({
      view: new URL(window.webContents.getURL()).searchParams.get('view'),
      visible: window.isVisible(),
      maximized: window.isMaximized(),
      pinned: window.isAlwaysOnTop(),
      bounds: window.getBounds(),
      workArea: screen.getDisplayMatching(window.getBounds()).workArea,
    })),
  }));
}
function onScreen(bounds, workArea) {
  return (
    bounds.x >= workArea.x - 1 &&
    bounds.y >= workArea.y - 1 &&
    bounds.x + bounds.width <= workArea.x + workArea.width + 1 &&
    bounds.y + bounds.height <= workArea.y + workArea.height + 1
  );
}
async function capture(page, name, alpha = false) {
  const file = resolve(output, `${name}-${label}.png`);
  await page.screenshot({ path: file, omitBackground: alpha });
  results.screenshots.push(file);
  return file;
}
async function checkSecondInstance() {
  await main.evaluate(() => window.mindnote.hideWindow());
  await sticky.evaluate(() => window.mindnote.hideWindow());
  const second = spawn(executablePath, baseArgs, {
    cwd: resolve('.'),
    env,
    windowsHide: true,
    stdio: 'ignore',
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      second.kill();
      reject(new Error('Second instance did not exit'));
    }, 15000);
    second.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    second.once('exit', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`Second instance exited ${code}`));
    });
  });
  await waitFor(
    async () => (await nativeState()).windows.find((window) => window.view === 'sticky')?.visible,
    'second instance restores sticky',
  );
  assert.equal(
    (await nativeState()).windows.find((window) => window.view === 'main')?.visible,
    false,
    'Second instance must not open the main window',
  );
}

try {
  await start();
  results.checks.push('startup creates only the sticky window');
  const initial = await snapshot();
  assert.equal(initial.settings.theme, 'light');
  assert.equal(initial.settings.launchAtLogin, false);
  await openMain();
  assert.equal((await nativeState()).windows.length, 2);
  results.checks.push('main window is created only on request');

  await main.evaluate(() => window.mindnote.toggleMaximize());
  await waitFor(
    async () => (await main.evaluate(() => window.mindnote.getWindowPresentation())).maximized,
    'maximize',
  );
  await main.evaluate(() => window.mindnote.toggleMaximize());
  await waitFor(
    async () => !(await main.evaluate(() => window.mindnote.getWindowPresentation())).maximized,
    'restore from maximize',
  );
  assert.equal(
    await sticky.evaluate(() =>
      window.mindnote.toggleMaximize().then(
        () => false,
        () => true,
      ),
    ),
    true,
  );
  results.checks.push('main maximize/restore and sticky maximize rejection');

  await checkSecondInstance();
  results.checks.push('real second process exits and restores only the sticky window');

  const system = initial.maps.find((map) => map.system);
  const local = await sticky.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  await dispatch({
    type: 'node.create',
    id: 'native-check-task',
    mapId: system.id,
    parentId: system.rootId,
    title: '桌面与本地保存验证',
    task: true,
    schedule: { mode: 'range', start: local, end: local },
  });
  await dispatch({
    type: 'node.update',
    id: 'native-check-task',
    patch: { progress: 40, notes: { other: '这条记录只存在于自动化测试目录。' } },
  });
  await dispatch({
    type: 'settings.update',
    patch: {
      theme: 'dark',
      opacity: 0.72,
      blur: 24,
      fontSize: 16,
      reduceMotion: true,
      pinned: true,
      filter: 'today',
    },
  });
  await waitFor(async () => (await nativeState()).theme === 'dark', 'native dark theme');
  assert((await nativeState()).windows.find((window) => window.view === 'sticky').pinned);
  await sticky.evaluate(() => window.mindnote.resizeSticky(390, 610));
  const expectedBounds = await sticky.evaluate(() => window.mindnote.getWindowBounds());
  await dispatch({ type: 'settings.update', patch: { stickyCollapsed: true } });
  assert.equal((await sticky.evaluate(() => window.mindnote.getWindowBounds())).height, 56);
  await dispatch({ type: 'settings.update', patch: { stickyCollapsed: false } });
  assert.equal(
    (await sticky.evaluate(() => window.mindnote.getWindowBounds())).height,
    expectedBounds.height,
  );
  results.checks.push('sticky resize, pinning, collapse and expanded-height recovery');
  await wait(400);

  const backupPath = resolve(dataDir, 'verification.sqlite');
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, backupPath);
  assert(!(await sticky.evaluate(() => window.mindnote.backup())).canceled);
  await dispatch({
    type: 'node.update',
    id: 'native-check-task',
    patch: { title: '恢复前临时内容', progress: 90 },
  });
  await dispatch({ type: 'settings.update', patch: { theme: 'light', blur: 0 } });
  const restore = await sticky.evaluate(() => window.mindnote.restore());
  assert(!restore.canceled && restore.path);
  assert((await readdir(resolve(dataDir, 'backups'))).length > 0);
  const restored = await snapshot();
  assert.equal(restored.nodes.find((node) => node.id === 'native-check-task').task.progress, 40);
  assert.equal(restored.settings.theme, 'dark');
  results.checks.push('backup/restore over IPC and automatic pre-restore backup');
  await wait(400);
  await app.close();
  app = null;

  await start();
  const persisted = await snapshot();
  for (const [key, value] of Object.entries({
    theme: 'dark',
    opacity: 0.72,
    blur: 24,
    fontSize: 16,
    reduceMotion: true,
    pinned: true,
  }))
    assert.equal(persisted.settings[key], value, `Persisted setting ${key}`);
  assert.equal(
    persisted.nodes.find((node) => node.id === 'native-check-task').notes.other,
    '这条记录只存在于自动化测试目录。',
  );
  const recoveredBounds = await sticky.evaluate(() => window.mindnote.getWindowBounds());
  assert.equal(recoveredBounds.width, expectedBounds.width);
  assert.equal(recoveredBounds.height, expectedBounds.height);
  results.checks.push('restart retains data, appearance and sticky dimensions without opening main');

  await app.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes('view=sticky'),
    );
    window.setBounds({ x: -20000, y: -20000, width: 390, height: 610 });
    screen.emit('display-removed', {}, screen.getPrimaryDisplay());
  });
  const recoveredDisplay = (await nativeState()).windows.find((window) => window.view === 'sticky');
  assert(onScreen(recoveredDisplay.bounds, recoveredDisplay.workArea));
  results.checks.push('display-change recovery brings an off-screen note back into the work area');

  await dispatch({
    type: 'settings.update',
    patch: { blur: 0, opacity: 0.72, theme: 'light', fontSize: 14, reduceMotion: false, pinned: false },
  });
  await wait(250);
  const alphaFile = await capture(sticky, 'native-alpha', true);
  const pixels = await sharp(alphaFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = (x, y) => pixels.data[(y * pixels.info.width + x) * 4 + 3];
  assert(alpha(0, 0) < 30, 'Rounded corner remains transparent');
  results.alpha = {
    corner: alpha(0, 0),
    panel: alpha(Math.min(30, pixels.info.width - 1), Math.min(200, pixels.info.height - 1)),
  };
  results.checks.push('rounded transparent renderer surface; native acrylic remains disabled');
  await dispatch({ type: 'settings.update', patch: { blur: 18 } });

  for (const scale of [1, 1.5, 2]) {
    await app.close();
    app = null;
    await start(scale);
    await sticky.evaluate(() => window.mindnote.resizeSticky(360, 560));
    const metrics = await sticky.evaluate(() => ({
      dpr: devicePixelRatio,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    assert(Math.abs(metrics.dpr - scale) < 0.01);
    assert(!metrics.overflow);
    const native = (await nativeState()).windows.find((window) => window.view === 'sticky');
    assert(onScreen(native.bounds, native.workArea));
    // Outward physical-pixel rounding may differ by one DIP on a secondary
    // monitor. Repeated visibility changes and restarts must never accumulate it.
    for (let repeat = 0; repeat < 12; repeat++) {
      await sticky.evaluate(() => window.mindnote.showSticky());
      const repeated = await sticky.evaluate(() => window.mindnote.getWindowBounds());
      assert(Math.abs(repeated.width - native.bounds.width) <= 1, 'Repeated show does not grow width');
      assert(Math.abs(repeated.height - native.bounds.height) <= 1, 'Repeated show does not grow height');
    }
    for (let restart = 0; restart < 3; restart++) {
      await app.close();
      app = null;
      await start(scale);
      const repeated = await sticky.evaluate(() => window.mindnote.getWindowBounds());
      assert(Math.abs(repeated.width - native.bounds.width) <= 1, 'Repeated restart does not grow width');
      assert(Math.abs(repeated.height - native.bounds.height) <= 1, 'Repeated restart does not grow height');
    }
    await capture(sticky, `native-sticky-${scale}`, true);
    results.dpi.push({ scale, metrics, bounds: native.bounds });
    if (scale === 1.5) {
      await openMain();
      await capture(main, 'native-main');
    }
  }
  assert.deepEqual([...new Set(errors)], [], 'Renderer runtime errors');
  results.checks.push('100%, 150% and 200% DPI keep the note usable and on-screen');
  await writeFile(
    resolve(output, `verification-${label}.json`),
    JSON.stringify({ ...results, ok: true }, null, 2),
  );
  console.log(JSON.stringify({ ...results, ok: true }, null, 2));
} finally {
  if (app) await app.close();
}
