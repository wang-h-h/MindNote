import { _electron as electron } from 'playwright';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import executablePath from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const data = resolve(`.local-data/map-layout-${Date.now()}`),
  output = resolve('test-results');
await mkdir(data, { recursive: true });
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: false,
  root: resolve('.'),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5190,
    strictPort: true,
    hmr: false,
    watch: { ignored: ['**/.local-data/**', '**/test-results/**', '**/out/**'] },
  },
});
await server.listen();
const env = {
  ...process.env,
  MINDNOTE_MAP_TEST_DATA: data,
  MINDNOTE_MAP_TEST_URL: 'http://127.0.0.1:5190/tests/mindmap-harness.html',
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
let stage = 'launch';
const timeout = setTimeout(() => {
  console.error(`Layout regression timed out at ${stage}`);
  app?.process().kill();
  process.exitCode = 1;
}, 90000);
timeout.unref();
try {
  app = await electron.launch({ executablePath, args: [resolve('tests/mindmap-electron-main.cjs')], env });
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const topic = (id) => page.locator(`.me-tpc[data-nodeid="me${id}"]`);
  const settle = () => page.waitForTimeout(70);
  const transform = () => page.locator('.map-canvas').evaluate((element) => element.style.transform);
  const geometry = () =>
    page.evaluate(() => {
      const topics = [...document.querySelectorAll('.me-tpc')].filter(
        (topic) => topic.getBoundingClientRect().width,
      );
      const rect = (element) => {
        const r = element.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      };
      const boxes = topics.map((topic) => ({ id: topic.nodeObj.id, ...rect(topic) }));
      const endpoints = [];
      for (const path of document.querySelectorAll('.lines path, .subLines path')) {
        if (!path.getClientRects().length || getComputedStyle(path).visibility === 'hidden') continue;
        for (const segment of (path.getAttribute('d') || '').split(/(?=M\s)/).filter(Boolean)) {
          const copy = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          copy.setAttribute('d', segment);
          const point = copy.getPointAtLength(copy.getTotalLength());
          const global = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM());
          endpoints.push({ x: global.x, y: global.y });
        }
      }
      const distances = topics
        .filter((topic) => topic.nodeObj.parent)
        .map((topic) => {
          const r = topic.getBoundingClientRect();
          const first = !topic.nodeObj.parent.parent;
          const expected = {
            x: first ? r.left : r.right,
            y: first ? r.top + r.height / 2 : topic.parentElement.getBoundingClientRect().bottom,
          };
          return {
            id: topic.nodeObj.id,
            distance: Math.min(
              ...endpoints.map((point) => Math.hypot(point.x - expected.x, point.y - expected.y)),
            ),
          };
        });
      const overlaps = [];
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i],
            b = boxes[j];
          if (
            Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1
          )
            overlaps.push([a.id, b.id]);
        }
      const input = document.querySelector('#input-box');
      return { distances, overlaps, boxes, input: input ? rect(input) : null };
    });
  const checkGeometry = async (label) => {
    await settle();
    const result = await geometry();
    assert.deepEqual(result.overlaps, [], `${label}: nodes must not overlap`);
    assert(
      result.distances.every((item) => item.distance < 4),
      `${label}: connector endpoints must follow live nodes: ${JSON.stringify(result.distances)}`,
    );
    return result;
  };
  await topic('grandchild-a').waitFor();
  stage = 'create fixture';
  console.log(stage);
  await page.evaluate(async () => {
    const commands = [{ type: 'map.create', id: 'layout-map', rootId: 'layout-root', title: '导图布局回归' }];
    for (const [id, parentId, title] of [
      ['layout-a', 'layout-root', '项目甲'],
      ['layout-b', 'layout-root', '项目乙'],
      ['layout-c', 'layout-root', '项目丙'],
      ['layout-a1', 'layout-a', '待编辑事项'],
      ['layout-a2', 'layout-a', '相邻事项不应重叠'],
      ['layout-g1', 'layout-a1', '子项保持正常间距'],
      ['layout-b1', 'layout-b', '第二分支的事项'],
      ['layout-b2', 'layout-b', '第二分支的另一事项'],
    ])
      commands.push({ type: 'node.create', id, parentId, title, mapId: 'layout-map', task: true });
    await window.mindmapHarness.dispatch({ type: 'batch', commands });
    await window.mindmapHarness.dispatch({
      type: 'settings.update',
      patch: { fontSize: 18, theme: 'light' },
    });
    window.mindmapHarness.switchTo('layout-map');
  });
  await topic('layout-g1').waitFor();
  await settle();
  const initial = await checkGeometry('initial');
  stage = 'repeat level expansion';
  console.log(stage);
  const foldResults = [];
  for (let i = 0; i < 12; i++) {
    const before = await transform();
    await page.getByRole('combobox', { name: '导图展开层级' }).selectOption('main');
    await settle();
    assert.equal(await transform(), before, 'folding must not pan or zoom');
    await page.getByRole('combobox', { name: '导图展开层级' }).selectOption('all');
    await topic('layout-g1').waitFor();
    const result = await checkGeometry(`expand iteration ${i + 1}`);
    assert.equal(await transform(), before, 'expanding must not pan or zoom');
    foldResults.push(Math.max(...result.distances.map((item) => item.distance)));
  }
  const cases = [];
  for (const fontSize of [14, 18])
    for (const steps of [-3, 0, 4]) {
      stage = `edit ${fontSize}px ${steps}`;
      console.log(stage);
      await page.evaluate(async (font) => {
        await window.mindmapHarness.dispatch({ type: 'settings.update', patch: { fontSize: font } });
        await window.mindmapHarness.dispatch({
          type: 'node.update',
          id: 'layout-a1',
          patch: { title: '待编辑事项' },
        });
        window.mindmapHarness.select(null);
      }, fontSize);
      await page.getByTitle('恢复原始比例', { exact: true }).click();
      for (let step = 0; step < Math.abs(steps); step++)
        await page.getByRole('button', { name: steps < 0 ? '缩小导图' : '放大导图', exact: true }).click();
      await page.evaluate(() => window.mindmapHarness.select('layout-a1'));
      await settle();
      const baseline = await topic('layout-a1').boundingBox(),
        before = await transform();
      await topic('layout-a1').dblclick();
      const editor = page.locator('#input-box');
      await editor.waitFor();
      await settle();
      const initialEditor = await editor.boundingBox();
      assert(
        initialEditor.width >= baseline.width - 1 && initialEditor.height >= baseline.height - 1,
        'opening the editor must not shrink the node',
      );
      const title = '较长中文标题需要保留节点完整尺寸与子项间距。'.repeat(6);
      await editor.fill(title);
      const result = await checkGeometry(`editing at ${fontSize}px / ${100 + steps * 10}%`);
      const current = result.boxes.find((box) => box.id === 'layout-a1');
      assert(current.height > baseline.height, 'the flow node must grow with a multiline draft');
      assert(
        Math.abs(result.input.x - current.x) < 1 && Math.abs(result.input.y - current.y) < 1,
        'editor must stay on its flow node',
      );
      assert(
        result.input.width >= current.width - 1 && result.input.height >= current.height - 1,
        'editor must cover its full node',
      );
      for (const other of result.boxes.filter((box) => box.id !== 'layout-a1')) {
        const overlap =
          Math.min(result.input.right, other.right) - Math.max(result.input.x, other.x) > 1 &&
          Math.min(result.input.bottom, other.bottom) - Math.max(result.input.y, other.y) > 1;
        assert.equal(overlap, false, `editor must not overlap ${other.id}`);
      }
      assert.equal(await transform(), before, 'typing must not pan or zoom');
      if (steps === 0) {
        await editor.press('Escape');
        await page.waitForFunction(() => !document.querySelector('#input-box'));
        assert.equal(
          await topic('layout-a1').locator('.text').innerText(),
          '待编辑事项',
          'cancel must restore the original invisible placeholder text',
        );
      } else {
        await editor.press('Enter');
        await page.waitForFunction(
          (expected) =>
            window.mindmapHarness.state().nodes.find((node) => node.id === 'layout-a1').title === expected,
          title,
        );
      }
      await checkGeometry('after editor close');
      cases.push({
        fontSize,
        zoom: 100 + steps * 10,
        nodeHeight: current.height,
        maxConnectionError: Math.max(...result.distances.map((item) => item.distance)),
      });
    }
  const colors = {};
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (theme) => window.mindmapHarness.dispatch({ type: 'settings.update', patch: { theme } }),
      theme,
    );
    await settle();
    colors[theme] = await page.evaluate(() => ({
      root: getComputedStyle(document.querySelector('[data-nodeid="melayout-root"]')).backgroundColor,
      main: getComputedStyle(document.querySelector('[data-nodeid="melayout-a"]')).backgroundColor,
      leaf: getComputedStyle(document.querySelector('[data-nodeid="melayout-a1"]')).backgroundColor,
      lines: [
        ...new Set(
          [...document.querySelectorAll('.lines path,.subLines path')].map((path) =>
            path.getAttribute('stroke'),
          ),
        ),
      ],
    }));
  }
  assert.deepEqual(colors.light, {
    root: 'rgb(41, 69, 116)',
    main: 'rgb(234, 240, 247)',
    leaf: 'rgb(255, 255, 255)',
    lines: ['#718BAD'],
  });
  assert.deepEqual(colors.dark, {
    root: 'rgb(68, 105, 155)',
    main: 'rgb(40, 59, 83)',
    leaf: 'rgb(43, 51, 65)',
    lines: ['#8EA9CC'],
  });
  const completed = {};
  await page.evaluate(() =>
    window.mindmapHarness.dispatch({ type: 'node.update', id: 'layout-a1', patch: { progress: 100 } }),
  );
  for (const theme of ['dark', 'light']) {
    await page.evaluate(
      (theme) => window.mindmapHarness.dispatch({ type: 'settings.update', patch: { theme } }),
      theme,
    );
    await settle();
    completed[theme] = await topic('layout-a1').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        color: style.textDecorationColor,
        thickness: style.textDecorationThickness,
        line: style.textDecorationLine,
        fill: style.backgroundColor,
      };
    });
  }
  assert.deepEqual(completed.dark, {
    color: 'rgb(241, 199, 91)',
    thickness: '3px',
    line: 'line-through',
    fill: 'rgb(43, 51, 65)',
  });
  assert.deepEqual(completed.light, {
    color: 'rgb(229, 183, 61)',
    thickness: '3px',
    line: 'line-through',
    fill: 'rgb(255, 255, 255)',
  });
  const bottomGap = await page
    .locator('.mindmap-footer')
    .evaluate(
      (element) =>
        element.parentElement.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom,
    );
  assert(bottomGap <= 9, 'toolbar and hints should sit close to the canvas bottom');
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.mindmapHarness.errors()), []);
  await writeFile(
    resolve(output, 'mindmap-v12-layout-regression.json'),
    JSON.stringify(
      {
        ok: true,
        initialMaxConnectionError: Math.max(...initial.distances.map((item) => item.distance)),
        foldResults,
        cases,
        colors,
        completed,
        bottomGap,
      },
      null,
      2,
    ),
  );
  console.log('Mind-map V1.2 layout regressions passed.');
} finally {
  clearTimeout(timeout);
  if (app) {
    const timer = setTimeout(() => app.process().kill(), 5000);
    timer.unref();
    await app.close().catch(() => {});
    clearTimeout(timer);
  }
  await server.close();
}
