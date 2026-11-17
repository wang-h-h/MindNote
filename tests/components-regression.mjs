import { _electron as electron } from 'playwright';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import executablePath from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const data = resolve(`.local-data/components-regression-${Date.now()}`);
await mkdir(data, { recursive: true });
await mkdir(resolve('test-results'), { recursive: true });
const server = await createServer({
  configFile: false,
  root: resolve('.'),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5189,
    strictPort: true,
    hmr: false,
    watch: { ignored: ['**/.local-data/**', '**/test-results/**', '**/out/**'] },
  },
});
await server.listen();
const env = {
  ...process.env,
  MINDNOTE_MAP_TEST_DATA: data,
  MINDNOTE_MAP_TEST_URL: 'http://127.0.0.1:5189/tests/components-harness.html',
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath, args: [resolve('tests/mindmap-electron-main.cjs')], env });
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const start = page.getByLabel('开始日期'),
    end = page.getByLabel('结束日期');
  await start.waitFor();
  assert.equal(await start.inputValue(), '');
  assert.equal(await end.inputValue(), '');
  assert.equal(
    await page.getByRole('button', { name: '暂不安排', exact: true }).getAttribute('aria-pressed'),
    'true',
  );
  await page.getByRole('button', { name: '跟随父项', exact: true }).click();
  assert.equal(await start.inputValue(), '2026-11-14');
  assert.equal(await end.inputValue(), '2026-11-18');
  await end.fill('2026-11-20');
  assert.deepEqual(await page.evaluate(() => window.componentsHarness.schedule()), {
    mode: 'range',
    start: '2026-11-14',
    end: '2026-11-20',
  });
  assert.equal(
    await page.getByRole('button', { name: '跟随父项', exact: true }).getAttribute('aria-pressed'),
    'false',
  );
  await page.getByRole('button', { name: '暂不安排', exact: true }).click();
  assert.equal(await start.inputValue(), '');
  assert.equal(await end.inputValue(), '');
  await start.fill('2026-12-01');
  assert.deepEqual(await page.evaluate(() => window.componentsHarness.schedule()), {
    mode: 'range',
    start: '2026-12-01',
    end: '2026-12-01',
  });
  for (const [name, icon] of [
    ['今天', '.lucide-sun'],
    ['本周', '.lucide-calendar-days'],
    ['本月', '.lucide-calendar-range'],
  ]) {
    const button = page.getByRole('button', { name, exact: true });
    assert.equal(await button.locator(icon).count(), 1);
  }

  const note = page.getByRole('textbox', { name: '自适应备注', exact: true });
  assert.equal(await note.getAttribute('rows'), '2');
  const initialHeight = await note.evaluate((element) => element.getBoundingClientRect().height);
  assert.equal(await note.evaluate((element) => getComputedStyle(element).resize), 'none');
  await note.dispatchEvent('compositionstart');
  await note.fill('中文输入法还在组合');
  await page.waitForTimeout(750);
  assert.equal(
    await page.evaluate(() => window.componentsHarness.saves().length),
    0,
    'composition must not autosave partial input',
  );
  await note.dispatchEvent('compositionend', { data: '中文输入法还在组合' });
  await page.waitForFunction(() => window.componentsHarness.note() === '中文输入法还在组合');
  const lines = Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 行记录`).join('\n');
  await note.fill(lines);
  assert(
    (await note.evaluate((element) => element.getBoundingClientRect().height)) > initialHeight * 3,
    'multiline content should expand the field',
  );
  await note.fill('中文备注自动换行并随着面板宽度变化重新计算高度。'.repeat(15));
  const wideHeight = await note.evaluate((element) => element.getBoundingClientRect().height);
  await page.evaluate(() => window.componentsHarness.width(280));
  await page.waitForFunction(
    (before) => document.querySelector('textarea').getBoundingClientRect().height > before,
    wideHeight,
  );
  const beforeFont = await note.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
    font: parseFloat(getComputedStyle(element).fontSize),
  }));
  await page.evaluate(() => window.componentsHarness.rootFont(18));
  await page.waitForFunction((before) => {
    const field = document.querySelector('textarea');
    return (
      parseFloat(getComputedStyle(field).fontSize) > before.font &&
      field.getBoundingClientRect().height > before.height &&
      field.scrollHeight <= field.clientHeight + 1
    );
  }, beforeFont);
  const afterFont = await note.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  assert.equal(afterFont.width, beforeFont.width, 'font regression must keep the text field width fixed');
  assert(
    afterFont.scrollHeight <= afterFont.clientHeight + 1,
    'asynchronous root-font changes must not clip notes',
  );
  await page.evaluate(() => window.componentsHarness.rootFont(14));
  await page.waitForFunction(
    (before) => parseFloat(getComputedStyle(document.querySelector('textarea')).fontSize) === before.font,
    beforeFont,
  );
  await note.fill('');
  await page.waitForFunction(
    (before) => document.querySelector('textarea').getBoundingClientRect().height <= before + 1,
    initialHeight,
  );
  await page.evaluate(() => window.componentsHarness.fail(true));
  await note.fill('失败后保留的备注');
  await note.blur();
  await page.getByRole('button', { name: '保存失败，点击重试' }).waitFor();
  assert.equal(await note.inputValue(), '失败后保留的备注');
  await page.evaluate(() => window.componentsHarness.fail(false));
  await page.getByRole('button', { name: '保存失败，点击重试' }).click();
  await page.waitForFunction(() => window.componentsHarness.note() === '失败后保留的备注');

  await page.getByRole('button', { name: '打开长对话框' }).click();
  const close = page.getByRole('button', { name: '关闭对话框' });
  const headingBefore = await close.boundingBox();
  await page.locator('.modal-body').evaluate((element) => {
    element.scrollTop = 1000;
  });
  assert(
    (await page.locator('.modal-body').evaluate((element) => element.scrollTop)) > 0,
    'only modal body must scroll',
  );
  const headingAfter = await close.boundingBox();
  assert.equal(headingAfter.y, headingBefore.y);
  await close.click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.deepEqual(errors, []);
  await writeFile(
    resolve('test-results/components-v11-regression.json'),
    JSON.stringify(
      {
        ok: true,
        initialHeight,
        wideHeight,
        rootFontResize: { before: beforeFont, after: afterFont },
        checks: [
          'date fields always visible',
          'inherit dates and editing to explicit range',
          'same-row mode buttons',
          'distinct period icons',
          'two-line notes',
          'content and width autosizing',
          'asynchronous root-font autosizing at fixed width',
          'IME autosave guard',
          'failed save retry',
          'fixed close button with scrolling modal body',
        ],
      },
      null,
      2,
    ),
  );
  console.log('V1.1 components Electron regressions passed.');
} finally {
  if (app) {
    const timer = setTimeout(() => app.process().kill(), 5000);
    timer.unref();
    await app.close().catch(() => {});
    clearTimeout(timer);
  }
  await server.close();
}
