import { _electron as electron } from 'playwright';
import defaultExecutable from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';

// Capture the composed Windows desktop against a known-color native backing
// window. webContents screenshots cannot detect a square DWM backdrop.
const packaged = process.argv.includes('--packaged');
const label = packaged ? 'packaged' : 'dev';
const output = resolve('test-results');
await mkdir(output, { recursive: true });
const env = {
  ...process.env,
  MINDNOTE_TEST_MODE: '1',
  MINDNOTE_DATA_DIR: resolve(`.local-data/shape-${label}-${Date.now()}`),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: packaged ? resolve('out/MindNote-win32-x64/MindNote.exe') : defaultExecutable,
  args: packaged ? [] : ['.'],
  env,
  cwd: resolve('.'),
});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(callback, label) {
  for (let i = 0; i < 100; i++) {
    if (await callback()) return;
    await wait(50);
  }
  throw new Error(`Timed out: ${label}`);
}
const results = { packaged, captures: [], checks: [] };
try {
  const sticky = await app.firstWindow();
  await sticky.waitForFunction(() => !!window.mindnote);
  await until(
    () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    'visible sticky',
  );
  await sticky.evaluate(() => window.mindnote.showMain());
  let main;
  await until(async () => {
    main = app.windows().find((page) => page.url().includes('view=main'));
    return !!main;
  }, 'main creation');
  await main.waitForFunction(() => !!window.mindnote);
  await until(
    () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((window) => window.webContents.getURL().includes('view=main'))
          .isVisible(),
      ),
    'visible main',
  );
  await main.evaluate(() => {
    window.nativeStates = [];
    window.nativeUnsubscribe = window.mindnote.onWindowPresentation((state) =>
      window.nativeStates.push(state),
    );
  });
  assert.deepEqual(await main.evaluate(() => window.mindnote.getWindowPresentation()), {
    maximized: false,
    fullscreen: false,
  });
  await main.evaluate(() => window.mindnote.toggleMaximize());
  await until(
    () =>
      main.evaluate(
        async () =>
          (await window.mindnote.getWindowPresentation()).maximized &&
          window.nativeStates.some((state) => state.maximized),
      ),
    'maximized IPC event',
  );
  await main.evaluate(() => window.mindnote.toggleMaximize());
  await until(
    () => main.evaluate(async () => !(await window.mindnote.getWindowPresentation()).maximized),
    'restored IPC state',
  );
  assert.equal((await main.evaluate(() => window.mindnote.getWindowPresentation())).fullscreen, false);
  results.checks.push('app-managed maximized/restored state query and event bridge');
  for (const view of ['sticky', 'main']) {
    // Use the real saved preference: V2 restores it on show instead of allowing
    // a test-only native topmost flag to override an unpinned note.
    await main.evaluate(
      (pinned) => window.mindnote.dispatch({ type: 'settings.update', patch: { pinned } }),
      view === 'sticky',
    );
    await app.evaluate(async ({ BrowserWindow, screen }, view) => {
      const target = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().includes(`view=${view}`),
      );
      for (const window of BrowserWindow.getAllWindows()) if (window !== target) window.hide();
      const work = screen.getPrimaryDisplay().workArea;
      target.setBounds({
        x: work.x + 80,
        y: work.y + 60,
        width: view === 'main' ? 980 : 360,
        height: view === 'main' ? Math.min(700, work.height - 100) : 560,
      });
      const bounds = target.getBounds();
      const background = new BrowserWindow({
        x: bounds.x - 20,
        y: bounds.y - 20,
        width: bounds.width + 40,
        height: bounds.height + 40,
        frame: false,
        show: false,
        resizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        backgroundColor: '#DC2D93',
        webPreferences: { sandbox: true },
      });
      await background.loadURL(
        'data:text/html,<html><body style="margin:0;background:%23DC2D93"></body></html>',
      );
      background.show();
      target.setAlwaysOnTop(true);
      target.show();
      target.moveTop();
      target.focus();
    }, view);
    await wait(350);
    const file = resolve(output, `native-window-corners-${view}-${label}.png`);
    const capture = await app.evaluate(
      async ({ BrowserWindow, desktopCapturer, screen }, { view, file }) => {
        const target = BrowserWindow.getAllWindows().find((window) =>
          window.webContents.getURL().includes(`view=${view}`),
        );
        const bounds = target.getBounds();
        const display = screen.getDisplayMatching(bounds);
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: {
            width: Math.round(display.bounds.width * display.scaleFactor),
            height: Math.round(display.bounds.height * display.scaleFactor),
          },
        });
        const source = sources.find((source) => source.display_id === String(display.id));
        if (!source || source.thumbnail.isEmpty())
          throw new Error('Windows desktop capture returned no image');
        const size = source.thumbnail.getSize();
        const scaleX = size.width / display.bounds.width;
        const scaleY = size.height / display.bounds.height;
        const margin = 10;
        const crop = {
          x: Math.round((bounds.x - display.bounds.x - margin) * scaleX),
          y: Math.round((bounds.y - display.bounds.y - margin) * scaleY),
          width: Math.round((bounds.width + margin * 2) * scaleX),
          height: Math.round((bounds.height + margin * 2) * scaleY),
        };
        process.getBuiltinModule('node:fs').writeFileSync(file, source.thumbnail.crop(crop).toPNG());
        return { view, file, bounds, scaleX, scaleY, margin };
      },
      { view, file },
    );
    const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const sample = (x, y) => [
      ...data.subarray(
        (Math.round(y) * info.width + Math.round(x)) * 3,
        (Math.round(y) * info.width + Math.round(x)) * 3 + 3,
      ),
    ];
    const background = sample(2, 2);
    const isBackground = (pixel) => pixel.every((channel, i) => Math.abs(channel - background[i]) <= 3);
    // Desktop capture can color-manage the requested pink. Compare corners with
    // the captured control pixel instead of assuming an exact sRGB transform.
    assert(
      background[0] > 150 && background[1] < 110 && background[2] > 100 && background[0] > background[1] + 70,
      'Known-color native backdrop is visible',
    );
    const left = capture.margin * capture.scaleX,
      top = capture.margin * capture.scaleY;
    const right = (capture.margin + capture.bounds.width - 1) * capture.scaleX;
    const bottom = (capture.margin + capture.bounds.height - 1) * capture.scaleY;
    const corners = [
      [left + 1, top + 1],
      [right - 1, top + 1],
      [left + 1, bottom - 1],
      [right - 1, bottom - 1],
    ].map(([x, y]) => sample(x, y));
    corners.forEach((pixel) =>
      assert(isBackground(pixel), `${view}: actual HWND corner shows only the underlying window`),
    );
    assert(
      !isBackground(sample(left + 30 * capture.scaleX, top + 30 * capture.scaleY)),
      `${view}: interior remains painted`,
    );
    results.captures.push({ ...capture, background, corners });
    results.checks.push(`${view} native composed corners are clipped, with no rectangular backdrop`);
  }
  await writeFile(
    resolve(output, `window-shape-${label}.json`),
    JSON.stringify({ ...results, ok: true }, null, 2),
  );
  console.log(JSON.stringify({ ...results, ok: true }, null, 2));
} finally {
  await app.close();
}
