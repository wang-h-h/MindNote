import { _electron as electron } from 'playwright';
import executablePath from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const dir = resolve('test-results');
await mkdir(dir, { recursive: true });
const env = {
  ...process.env,
  MINDNOTE_TEST_MODE: '1',
  MINDNOTE_DATA_DIR: resolve(`.local-data/smoke-${Date.now()}`),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath, args: ['.'], env, timeout: 30000 });
const failures = [];
app.process().stderr.on('data', (data) => {
  const text = String(data);
  if (/Error|error/i.test(text)) console.log('Electron:', text.trim());
});
let main, sticky;
async function state(page) {
  return page.evaluate(() => window.mindnote.getSnapshot());
}
async function command(c) {
  return main.evaluate((c) => window.mindnote.dispatch(c), c);
}
async function until(fn, label) {
  for (let i = 0; i < 50; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timeout: ${label}`);
}
try {
  await until(async () => {
    const pages = app.windows();
    main = pages.find((p) => p.url().includes('view=main'));
    sticky = pages.find((p) => p.url().includes('view=sticky'));
    return main && sticky;
  }, 'windows');
  for (const page of [main, sticky]) {
    page.on('pageerror', (e) => failures.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') failures.push(m.text());
    });
  }
  await main.getByRole('button', { name: '新建事项', exact: true }).waitFor();
  await main.screenshot({ path: resolve(dir, 'empty-main.png') });
  await main.getByRole('button', { name: '新建事项', exact: true }).click();
  await main.getByRole('textbox', { name: '新事项名称' }).fill('发布思维便签首版');
  await main.getByRole('button', { name: '选择日期', exact: true }).click();
  await main.getByRole('button', { name: '添加', exact: true }).click();
  let s = await state(main);
  const parent = s.nodes.find((n) => n.title === '发布思维便签首版');
  assert(parent?.task);
  await main.getByRole('button', { name: '添加子项', exact: true }).click();
  await main.getByRole('textbox', { name: '新事项名称' }).fill('完善交互细节');
  await main.getByRole('button', { name: '添加', exact: true }).click();
  s = await state(main);
  const child = s.nodes.find((n) => n.title === '完善交互细节');
  assert.equal(child.parentId, parent.id);
  assert.equal(child.task.schedule.mode, 'inherit');
  const today = new Date().toLocaleDateString('en-CA');
  await command({
    type: 'batch',
    commands: [
      {
        type: 'node.create',
        id: 'task-2',
        mapId: parent.mapId,
        parentId: parent.id,
        title: '检查本地保存与备份',
      },
      { type: 'node.create', id: 'task-3', mapId: parent.mapId, parentId: parent.id, title: '整理使用说明' },
      {
        type: 'node.update',
        id: child.id,
        patch: {
          progress: 100,
          notes: {
            progress: '已完成日期选择、层级展开和四套主题。',
            problems: '继续检查不同缩放比例下的显示。',
          },
        },
      },
      { type: 'node.update', id: 'task-2', patch: { progress: 50 } },
      {
        type: 'node.create',
        id: 'task-read',
        mapId: parent.mapId,
        parentId: 'system-tasks-root',
        title: '留半小时，读一章喜欢的书',
        task: true,
        schedule: { mode: 'range', start: today, end: today },
      },
      {
        type: 'node.create',
        id: 'task-inbox',
        mapId: parent.mapId,
        parentId: 'system-tasks-root',
        title: '周末去公园走走，收集一些灵感',
        task: true,
        schedule: { mode: 'none' },
      },
      {
        type: 'node.create',
        id: 'task-overdue',
        mapId: parent.mapId,
        parentId: 'system-tasks-root',
        title: '回顾上一次计划，记录新的发现',
        task: true,
        schedule: { mode: 'range', start: '2025-01-01', end: '2025-01-02' },
      },
    ],
  });
  await until(
    async () => (await state(sticky)).nodes.some((n) => n.id === 'task-2' && n.task.progress === 50),
    'cross-window sync',
  );
  await main.locator('.task-row').filter({ hasText: '完善交互细节' }).click();
  await main.getByRole('textbox', { name: '其他备注', exact: true }).fill('完成后仍然可以补充复盘。');
  await main.getByText('完成进度', { exact: true }).click();
  await until(
    async () =>
      (await state(sticky)).nodes.find((n) => n.id === child.id).notes.other === '完成后仍然可以补充复盘。',
    'notes sync',
  );
  console.log('Task, dates, two-window sync and completed-note checks passed.');
  await main.locator('.inspector-scroll').evaluate((el) => {
    el.scrollTop = 0;
  });
  await main.screenshot({ path: resolve(dir, 'main.png') });
  await sticky.screenshot({ path: resolve(dir, 'sticky.png'), omitBackground: true });
  await main.getByRole('button', { name: '新建思维导图', exact: true }).click();
  await main.getByRole('textbox', { name: '导图名称', exact: true }).fill('让想法慢慢生长');
  await main.getByRole('button', { name: '创建导图', exact: true }).click();
  s = await state(main);
  const map = s.maps.find((m) => m.title === '让想法慢慢生长');
  assert(map && !map.system);
  await command({
    type: 'batch',
    commands: [
      {
        type: 'node.create',
        id: 'idea-1',
        mapId: map.id,
        parentId: map.rootId,
        title: '阅读与表达',
        task: false,
      },
      {
        type: 'node.create',
        id: 'idea-2',
        mapId: map.id,
        parentId: 'idea-1',
        title: '建立自己的阅读清单',
        task: false,
      },
      {
        type: 'node.create',
        id: 'idea-3',
        mapId: map.id,
        parentId: 'idea-1',
        title: '每周写下一个收获',
        task: false,
      },
      {
        type: 'node.create',
        id: 'idea-4',
        mapId: map.id,
        parentId: map.rootId,
        title: '生活的小小探索',
        task: false,
      },
      {
        type: 'node.create',
        id: 'idea-5',
        mapId: map.id,
        parentId: 'idea-4',
        title: '散步时发现新的路线',
        task: false,
      },
      {
        type: 'node.create',
        id: 'idea-6',
        mapId: map.id,
        parentId: map.rootId,
        title: '把产品做得更好',
        task: false,
      },
    ],
  });
  await main.locator('.me-tpc[data-nodeid="meidea-1"]').click();
  await main.getByRole('button', { name: '将分支关联为待办', exact: true }).click();
  await main.getByRole('button', { name: '本周', exact: true }).last().click();
  await main.getByRole('button', { name: '关联待办', exact: true }).click();
  s = await state(main);
  assert(s.nodes.find((n) => n.id === 'idea-2').task);
  assert.equal(s.nodes.find((n) => n.id === 'idea-4').task, null);
  await main.locator('.me-tpc[data-nodeid="meidea-3"]').dblclick();
  const edit = main.locator('#input-box');
  await edit.waitFor();
  await edit.fill('写下这一周的收获');
  await edit.press('Enter');
  await until(
    async () => (await state(sticky)).nodes.find((n) => n.id === 'idea-3').title === '写下这一周的收获',
    'mindmap edit persistence',
  );
  await main.getByRole('button', { name: '适应画布', exact: true }).click();
  await main.screenshot({ path: resolve(dir, 'mindmap.png') });
  await command({ type: 'history.undo' });
  s = await state(main);
  assert.equal(s.nodes.find((n) => n.id === 'idea-3').title, '每周写下一个收获');
  await command({ type: 'history.redo' });
  s = await state(main);
  assert.equal(s.nodes.find((n) => n.id === 'idea-3').title, '写下这一周的收获');
  for (const theme of ['blue', 'mint', 'lavender', 'apricot']) {
    await command({ type: 'settings.update', patch: { theme } });
    await until(
      () =>
        sticky.evaluate(
          (theme) => document.querySelector('.sticky-shell').classList.contains(`theme-${theme}`),
          theme,
        ),
      'theme',
    );
  }
  await command({ type: 'settings.update', patch: { theme: 'blue', opacity: 0.82, stickyCollapsed: true } });
  await until(
    () => sticky.evaluate(() => window.mindnote.getWindowBounds()).then((b) => b.height === 56),
    'collapse',
  );
  await command({ type: 'settings.update', patch: { stickyCollapsed: false } });
  await sticky.evaluate(() => window.mindnote.resizeSticky(400, 600));
  const bounds = await sticky.evaluate(() => window.mindnote.getWindowBounds());
  assert(Math.abs(bounds.width - 400) <= 1);
  assert(Math.abs(bounds.height - 600) <= 1);
  await sticky.evaluate(() => window.mindnote.resizeSticky(360, 560));
  const windowChecks = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({
      transparent: w.getBackgroundColor(),
      size: w.getSize(),
      onTop: w.isAlwaysOnTop(),
      webPreferences: w.webContents.getLastWebPreferences(),
    })),
  );
  assert(
    windowChecks.every(
      (w) =>
        w.webPreferences.contextIsolation && !w.webPreferences.nodeIntegration && w.webPreferences.sandbox,
    ),
  );
  assert.equal(failures.length, 0, JSON.stringify(failures));
  await writeFile(
    resolve(dir, 'smoke-result.json'),
    JSON.stringify(
      {
        ok: true,
        checks: [
          'create via UI',
          'inherited dates',
          'two-window sync',
          'completed notes',
          'branch conversion',
          'mind-map edit',
          'undo redo',
          'four themes',
          'collapse',
          'transparent custom resize',
          'isolated renderers',
        ],
        dataDir: env.MINDNOTE_DATA_DIR,
        windowChecks: windowChecks.map(({ webPreferences, ...rest }) => rest),
      },
      null,
      2,
    ),
  );
  console.log('Desktop smoke checks passed. Screenshots in test-results/.');
} catch (error) {
  console.error(error);
  console.error('Renderer errors:', failures);
  if (main) await main.screenshot({ path: resolve(dir, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await app.close();
}
