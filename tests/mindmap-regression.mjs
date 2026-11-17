import { _electron as electron } from 'playwright';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import executablePath from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const output = resolve('test-results');
const data = resolve(`.local-data/map-regression-${Date.now()}`);
await mkdir(output, { recursive: true });
await mkdir(data, { recursive: true });
const server = await createServer({
  configFile: false,
  root: resolve('.'),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
    hmr: false,
    watch: { ignored: ['**/.local-data/**', '**/test-results/**', '**/out/**'] },
  },
});
await server.listen();
const env = {
  ...process.env,
  MINDNOTE_MAP_TEST_DATA: data,
  MINDNOTE_MAP_TEST_URL: 'http://127.0.0.1:5188/tests/mindmap-harness.html',
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const capture = async (filename) => {
  let timer;
  try {
    const png = await Promise.race([
      app.evaluate(async ({ BrowserWindow }) => {
        const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, {
          stayHidden: true,
          stayAwake: true,
        });
        return image.toPNG().toString('base64');
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Hidden-window capture timed out')), 5000);
      }),
    ]);
    await writeFile(resolve(output, filename), Buffer.from(png, 'base64'));
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};
try {
  app = await electron.launch({ executablePath, args: [resolve('tests/mindmap-electron-main.cjs')], env });
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const topic = (id) => page.locator(`.me-tpc[data-nodeid="me${id}"]`);
  await topic('grandchild-a').waitFor();
  assert.equal(
    await page.locator('.me-root').isVisible(),
    false,
    'draft compatibility root must be visually hidden',
  );
  assert.equal(
    await page.locator('.mindmap-root-links').evaluate((element) => getComputedStyle(element).visibility),
    'hidden',
    'draft root connectors must be hidden while descendants remain connected',
  );
  assert.equal(await page.getByRole('button', { name: '导图居中', exact: true }).count(), 0);

  await topic('branch-a').click({ button: 'right' });
  await page.evaluate(() => {
    document.querySelector('#root > div').style.width = 'calc(100vw - 340px)';
  });
  await page.waitForTimeout(40);
  await page.getByRole('menuitem', { name: '添加子项' }).click();
  assert.deepEqual(await page.evaluate(() => window.mindmapHarness.actions().at(-1)), {
    callback: 'add',
    id: 'branch-a',
    sibling: false,
  });
  assert.equal(
    await page.evaluate(() => window.mindmapHarness.state().nodes.length),
    7,
    'context action must not create an undated node',
  );
  await page.evaluate(() => {
    document.querySelector('#root > div').style.width = '100vw';
  });
  await topic('branch-a').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '添加同级' }).click();
  assert.deepEqual(await page.evaluate(() => window.mindmapHarness.actions().at(-1)), {
    callback: 'add',
    id: 'branch-a',
    sibling: true,
  });

  const canvas = await page.locator('.mindmap-surface').boundingBox();
  await page.mouse.move(canvas.x + 24, canvas.y + 24);
  const scaleBefore = await page.locator('.mindmap-zoom-value').innerText();
  await page.mouse.wheel(0, 350);
  await page.waitForFunction(
    (value) => document.querySelector('.mindmap-zoom-value').textContent !== value,
    scaleBefore,
  );
  const transformBefore = await page.locator('.map-canvas').evaluate((element) => element.style.transform);
  await page.mouse.move(canvas.x + 25, canvas.y + 25);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 145, canvas.y + 95, { steps: 8 });
  await page.mouse.up();
  assert.notEqual(
    await page.locator('.map-canvas').evaluate((element) => element.style.transform),
    transformBefore,
    'blank left drag must pan',
  );

  await page.evaluate(() =>
    window.mindmapHarness.dispatch({ type: 'settings.update', patch: { fontSize: 18 } }),
  );
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('[data-nodeid="mechild-a"]')).fontSize === '18px',
  );
  assert.equal(
    await topic('child-a').evaluate((element) => getComputedStyle(element).fontSize),
    '18px',
    'map text follows the font-size setting',
  );
  await topic('child-a').dblclick();
  const editor = page.locator('#input-box');
  await editor.waitFor();
  await page.waitForTimeout(80);
  const alignment = await topic('child-a').evaluate((topic) => {
    const input = document.querySelector('#input-box'),
      range = document.createRange();
    range.selectNodeContents(input);
    const inputText = range.getBoundingClientRect(),
      target = topic.text.getBoundingClientRect();
    return { x: Math.abs(inputText.left - target.left), y: Math.abs(inputText.top - target.top) };
  });
  assert(
    alignment.x < 5 && alignment.y < 5,
    `editor must align with node text after scaling: ${JSON.stringify(alignment)}`,
  );
  await editor.fill('切换时提交的编辑内容');
  await page.evaluate(() => window.mindmapHarness.switchTo('project-b'));
  await topic('project-b-child').waitFor();
  assert.equal(
    await page.locator('.mindmap-root-links').evaluate((element) => getComputedStyle(element).visibility),
    'visible',
    'project root connectors remain visible',
  );
  await page.evaluate(() => window.mindmapHarness.select('project-b-child'));
  await page.getByRole('combobox', { name: '导图展开层级' }).selectOption('main');
  await page.waitForFunction(
    () => window.mindmapHarness.state().nodes.find((node) => node.id === 'project-b-root').expanded === false,
  );
  assert.equal(
    await topic('project-b-child').isVisible(),
    false,
    'project main level must visually fold its branches',
  );
  assert.equal(await page.evaluate(() => window.mindmapHarness.selected()), 'project-b-root');
  await page.getByRole('combobox', { name: '导图展开层级' }).selectOption('all');
  await topic('project-b-child').waitFor();
  await page.waitForFunction(
    () =>
      window.mindmapHarness.state().nodes.find((node) => node.id === 'child-a').title ===
      '切换时提交的编辑内容',
  );
  await page.evaluate(() => window.mindmapHarness.switchTo('system-tasks'));
  await topic('grandchild-a').waitFor();
  assert.equal((await topic('child-a').innerText()).trim(), '切换时提交的编辑内容');

  await topic('branch-b').click();
  await page.locator('.map-container').focus();
  await page.keyboard.press('Delete');
  await page.waitForFunction(
    () => !window.mindmapHarness.state().nodes.some((node) => node.id === 'branch-b'),
  );
  await page.evaluate(() => window.mindmapHarness.select('branch-b'));
  await page.evaluate(() =>
    window.mindmapHarness.dispatch({ type: 'settings.update', patch: { theme: 'dark' } }),
  );
  await page.evaluate(() => window.mindmapHarness.switchTo('project-b'));
  await topic('project-b-child').waitFor();
  await page.evaluate(() => window.mindmapHarness.switchTo('system-tasks'));
  await topic('grandchild-a').waitFor();
  assert.equal(await topic('branch-b').count(), 0);

  await page.evaluate(() => window.mindmapHarness.select('grandchild-a'));
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const beforeLevelTransform = await page
    .locator('.map-canvas')
    .evaluate((element) => element.style.transform);
  const countBefore = await page.evaluate(() => window.mindmapHarness.actions().length);
  await page.getByRole('combobox', { name: '导图展开层级' }).selectOption('main');
  await page.waitForFunction(
    () => window.mindmapHarness.state().nodes.find((node) => node.id === 'branch-a').expanded === false,
  );
  const levelAction = await page.evaluate(
    (count) => window.mindmapHarness.actions().slice(count),
    countBefore,
  );
  assert.equal(levelAction.length, 1, 'level changes must be one undoable batch');
  assert.equal(levelAction[0].type, 'batch');
  assert.equal(await page.evaluate(() => window.mindmapHarness.selected()), 'branch-a');
  assert.equal(
    await page.locator('.map-canvas').evaluate((element) => element.style.transform),
    beforeLevelTransform,
    'collapsing levels must keep the viewport transform',
  );
  await page.getByRole('combobox', { name: '导图展开层级' }).selectOption('all');
  await topic('grandchild-a').waitFor();
  assert.equal(
    await page.locator('.map-canvas').evaluate((element) => element.style.transform),
    beforeLevelTransform,
    'expanding levels must keep the viewport transform',
  );
  assert.equal(
    await page.locator('.mindmap-progress-tag').first().innerText(),
    '',
    'progress indicators must have no percentage or completed text',
  );
  await page.getByRole('button', { name: '适应画布', exact: true }).click();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const fitGeometry = await page.evaluate(() => {
    const host = document.querySelector('.mindmap-surface').getBoundingClientRect();
    const rects = [...document.querySelectorAll('.me-tpc')]
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width && rect.height);
    const left = Math.min(...rects.map((rect) => rect.left)),
      right = Math.max(...rects.map((rect) => rect.right));
    return {
      left,
      right,
      hostLeft: host.left,
      hostRight: host.right,
      centerDifference: Math.abs((left + right) / 2 - (host.left + host.right) / 2),
    };
  });
  assert(
    fitGeometry.left >= fitGeometry.hostLeft &&
      fitGeometry.right <= fitGeometry.hostRight &&
      fitGeometry.centerDifference < 2,
    `fit must keep all visible topics centered: ${JSON.stringify(fitGeometry)}`,
  );
  assert.deepEqual(await page.evaluate(() => window.mindmapHarness.errors()), []);
  assert.deepEqual(errors, []);
  const screenshotCaptured = await capture('mindmap-v1-regression.png');
  await page.evaluate(() => window.mindmapHarness.select(null));
  const beforeEditTransform = await page
    .locator('.map-canvas')
    .evaluate((element) => element.style.transform);
  await page.evaluate(() =>
    window.mindmapHarness.dispatch({
      type: 'node.update',
      id: 'child-a',
      patch: { title: '普通标题修改保持视口位置与缩放', progress: 50 },
    }),
  );
  await page.waitForFunction(
    () =>
      document.querySelector('[data-nodeid="mechild-a"]').textContent === '普通标题修改保持视口位置与缩放',
  );
  assert.equal(
    await page.locator('.map-canvas').evaluate((element) => element.style.transform),
    beforeEditTransform,
    'ordinary edits without a selection must not fit or pan',
  );
  await page.evaluate(() =>
    window.mindmapHarness.dispatch({
      type: 'node.create',
      id: 'stable-new-node',
      mapId: 'system-tasks',
      parentId: 'branch-a',
      title: '添加子项后仍保留视口',
    }),
  );
  await topic('stable-new-node').waitFor();
  assert.equal(
    await page.locator('.map-canvas').evaluate((element) => element.style.transform),
    beforeEditTransform,
    'structural edits without a selection must not fit or pan',
  );
  const performance = {};
  let started = Date.now();
  await page.evaluate(async () => {
    const commands = [
      { type: 'map.create', id: 'performance-map', rootId: 'performance-root', title: '1000 节点性能验证' },
    ];
    for (let group = 0; group < 10; group++)
      commands.push({
        type: 'node.create',
        id: `performance-group-${group}`,
        mapId: 'performance-map',
        parentId: 'performance-root',
        title: `分组 ${group}`,
      });
    for (let index = 0; index < 989; index++)
      commands.push({
        type: 'node.create',
        id: `performance-leaf-${index}`,
        mapId: 'performance-map',
        parentId: `performance-group-${index % 10}`,
        title: `验证事项 ${index}`,
      });
    await window.mindmapHarness.dispatch({ type: 'batch', commands });
    window.mindmapHarness.switchTo('performance-map');
  });
  await topic('performance-leaf-988').waitFor();
  assert.equal(await page.locator('.me-tpc').count(), 1000);
  performance.createAndRender1000Ms = Date.now() - started;
  started = Date.now();
  await page.getByRole('combobox', { name: '导图展开层级' }).selectOption('two');
  await page.waitForFunction(() => document.querySelectorAll('.me-tpc').length === 11);
  performance.foldMs = Date.now() - started;
  // V1.1 intentionally retains the overview scale after folding. Restoring a
  // readable scale is explicit; the subsequent external locate may pan only.
  await page.getByTitle('恢复原始比例', { exact: true }).click();
  started = Date.now();
  await page.evaluate(() => window.mindmapHarness.select('performance-leaf-988'));
  await topic('performance-leaf-988').waitFor();
  performance.locateAndExpandMs = Date.now() - started;
  started = Date.now();
  await page.evaluate(() =>
    window.mindmapHarness.dispatch({
      type: 'node.update',
      id: 'performance-leaf-988',
      patch: { title: '外部修改同步导图' },
    }),
  );
  await page.waitForFunction(
    () => document.querySelector('[data-nodeid="meperformance-leaf-988"]').textContent === '外部修改同步导图',
  );
  performance.externalEditMs = Date.now() - started;
  started = Date.now();
  await topic('performance-leaf-988').dblclick();
  await page.locator('#input-box').fill('导图修改同步数据');
  await page.locator('#input-box').press('Enter');
  await page.waitForFunction(
    () =>
      window.mindmapHarness.state().nodes.find((node) => node.id === 'performance-leaf-988').title ===
      '导图修改同步数据',
  );
  performance.canvasEditMs = Date.now() - started;
  assert.deepEqual(await page.evaluate(() => window.mindmapHarness.errors()), []);
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, 'mindmap-v1-regression.json'),
    JSON.stringify(
      {
        ok: true,
        alignment,
        fitGeometry,
        screenshotCaptured,
        performance,
        checks: [
          'hidden draft root and its connectors',
          'context add callbacks',
          'no implicit creation',
          'blank left drag',
          'wheel zoom',
          'font-size setting at 18px',
          'scaled double-click alignment',
          'commit on map switch',
          'delete and stale selection',
          'map-switch descendant retention',
          'one-batch depth expansion with stable viewport',
          'ordinary and structural edits with stable viewport',
          'project root folding',
          'progress without numeric text',
          'dark theme',
          '1000-node folding, locating and bidirectional editing',
        ],
      },
      null,
      2,
    ),
  );
  console.log('Mind-map V1 Electron regressions passed.');
} catch (error) {
  if (app) await capture('mindmap-v1-failure.png').catch(() => {});
  throw error;
} finally {
  if (app) {
    // A minimized/locked Windows session can stall the optional capture. Only
    // this isolated test process may be terminated if normal close is delayed.
    const shutdown = setTimeout(() => app.process().kill(), 5000);
    shutdown.unref();
    await app.close().catch(() => {});
    clearTimeout(shutdown);
  }
  await server.close();
}
