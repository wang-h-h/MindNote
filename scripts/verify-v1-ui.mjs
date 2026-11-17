import { _electron as electron } from 'playwright';
import defaultExecutable from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const packaged = process.argv.includes('--packaged');
const output = resolve('test-results');
await mkdir(output, { recursive: true });
const env = {
  ...process.env,
  MINDNOTE_TEST_MODE: '1',
  MINDNOTE_DATA_DIR: resolve(`.local-data/v1-ui-${Date.now()}`),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: packaged ? resolve('out/MindNote-win32-x64/MindNote.exe') : defaultExecutable,
  args: packaged ? [] : ['.'],
  env,
});
const errors = [],
  checks = [];
let main, sticky;
const wait = async (fn) => {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 60));
  }
  throw Error('Condition timed out');
};
const check = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
const state = (p) => p.evaluate(() => window.mindnote.getSnapshot());
const cmd = (c) => main.evaluate((c) => window.mindnote.dispatch(c), c);
const shot = async (page, name) => {
  await page.waitForTimeout(450);
  await page.screenshot({ path: resolve(output, `v1-${packaged ? 'packaged-' : ''}${name}.png`) });
};
try {
  sticky = await app.firstWindow();
  sticky.on('pageerror', (e) => errors.push(e.message));
  await sticky.locator('.sticky-tabs').waitFor();
  assert.equal(app.windows().length, 1);
  assert.deepEqual(await sticky.locator('.sticky-tabs button').allTextContents(), [
    '收集箱',
    '今日',
    '本周',
    '本月',
  ]);
  assert.equal(await sticky.locator('.sticky-tabs .active').textContent(), '今日');
  check('Startup: only sticky, Today default, four tabs');
  await sticky.locator('.quick-add').click();
  await sticky.getByLabel('事项名称', { exact: true }).fill('整理今天的工作安排');
  await sticky.keyboard.press('Control+k');
  assert.equal(await sticky.getByLabel('事项名称', { exact: true }).inputValue(), '整理今天的工作安排');
  const today = await sticky.locator('input[type=date]').first().inputValue();
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(await sticky.locator('input[type=date]').count(), 2);
  await shot(sticky, 'sticky-add');
  await sticky.getByRole('button', { name: '添加待办', exact: true }).click();
  await sticky.locator('.plan-item').waitFor();
  check('Default creation uses local calendar date');
  await sticky.locator('.quick-add').click();
  await sticky.getByLabel('事项名称', { exact: true }).fill('灵感：让工作空间更舒适');
  await sticky.getByRole('checkbox', { name: /暂不安排/ }).check();
  await sticky.getByRole('button', { name: '添加待办', exact: true }).click();
  await wait(async () => (await sticky.locator('.sticky-tabs .active').textContent()) === '收集箱');
  check('Unscheduled compound option places task in inbox');
  await sticky.getByRole('button', { name: '打开完整窗口', exact: true }).click();
  await wait(() => !!(main = app.windows().find((p) => p.url().includes('view=main'))));
  main.on('pageerror', (e) => errors.push(e.message));
  await main.locator('.page-heading').waitFor();
  const initial = await state(main);
  const draft = initial.maps.find((m) => m.system);
  assert.equal(draft.title, '草稿箱');
  await cmd({ type: 'map.create', id: 'v1-project', rootId: 'v1-project-root', title: '品牌网站焕新' });
  const dayBefore = (() => {
    const d = new Date(today + 'T12:00:00');
    d.setDate(d.getDate() - 2);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  await cmd({
    type: 'batch',
    commands: [
      {
        type: 'node.create',
        id: 'major',
        mapId: 'v1-project',
        parentId: 'v1-project-root',
        title: '视觉与内容设计',
        task: false,
      },
      {
        type: 'node.create',
        id: 'idea',
        mapId: 'v1-project',
        parentId: 'major',
        title: '梳理首页的信息层级',
        task: false,
      },
      {
        type: 'node.create',
        id: 'child',
        mapId: 'v1-project',
        parentId: 'idea',
        title: '收集参考与灵感',
        task: false,
      },
      { type: 'node.convert', id: 'idea', start: today, end: today },
      {
        type: 'node.update',
        id: 'idea',
        patch: {
          progress: 40,
          notes: {
            progress: '首页以内容为中心，让访问者轻松找到想了解的部分。',
            other: '参考简洁、清晰、留白充足的排版。',
          },
        },
      },
      {
        type: 'node.create',
        id: 'overdue',
        mapId: draft.id,
        parentId: draft.rootId,
        title: '整理上周的会议记录',
        task: true,
        schedule: { mode: 'range', start: dayBefore, end: dayBefore },
      },
      { type: 'node.update', id: 'overdue', patch: { progress: 60 } },
      {
        type: 'node.create',
        id: 'finished',
        mapId: draft.id,
        parentId: draft.rootId,
        title: '读完设计笔记',
        task: true,
        schedule: { mode: 'range', start: today, end: today },
      },
      {
        type: 'node.update',
        id: 'finished',
        patch: { progress: 100, notes: { other: '清晰来自有意识的取舍。' } },
      },
    ],
  });
  await main.getByRole('button', { name: '全部事项', exact: true }).click();
  await main.locator('.notes-grid').waitFor();
  assert.equal(await main.locator('[data-task-id=major]').count(), 0);
  assert.equal(await main.locator('[data-task-id=child]').count(), 0);
  assert.equal(await main.locator('[data-task-id=idea] .project-tag').textContent(), '品牌网站焕新');
  assert.equal(await main.locator('.plan-note').last().getAttribute('data-task-id'), 'finished');
  check('Flat single-node project plan and unfinished-first card order');
  await shot(main, 'all');
  const slider = main.getByRole('slider', { name: '梳理首页的信息层级进度' });
  await slider.focus();
  const before = (await state(main)).revision;
  await slider.press('ArrowRight');
  await slider.blur();
  await wait(async () => (await state(main)).nodes.find((n) => n.id === 'idea').task.progress === 50);
  assert.equal((await state(main)).revision, before + 1);
  assert.equal((await state(main)).nodes.find((n) => n.id === 'child').task, null);
  check('Independent progress snaps by ten; keyboard+blur sends one update');
  await cmd({ type: 'node.update', id: 'idea', patch: { progress: 33.333 } });
  await main.waitForTimeout(100);
  const untouched = (await state(main)).revision;
  await slider.focus();
  await slider.blur();
  await main.waitForTimeout(100);
  assert.equal((await state(main)).revision, untouched);
  assert.equal((await state(main)).nodes.find((n) => n.id === 'idea').task.progress, 33.333);
  const bar = await slider.boundingBox();
  await main.mouse.move(bar.x + bar.width * 0.33, bar.y + bar.height / 2);
  await main.mouse.down();
  await main.mouse.move(bar.x + bar.width * 0.6, bar.y + bar.height / 2);
  await main.mouse.up();
  await wait(async () => (await state(main)).nodes.find((n) => n.id === 'idea').task.progress === 60);
  check('Untouched legacy progress is preserved; mouse dragging snaps correctly');
  await slider.press('End');
  await wait(async () => (await state(main)).nodes.find((n) => n.id === 'idea').task.progress === 100);
  assert(await main.locator('[data-task-id=idea]').evaluate((el) => el.classList.contains('done')));
  await main.locator('[data-task-id=idea] .task-open').click();
  await main
    .getByRole('textbox', { name: '进展说明', exact: true })
    .fill('内容结构已理清，完成后依然可以补充记录。');
  await main.getByRole('button', { name: '关闭详情', exact: true }).click();
  await wait(async () =>
    (await state(main)).nodes.find((n) => n.id === 'idea').notes.progress.startsWith('内容结构'),
  );
  check('Strike-through and notes editable after completion');
  await cmd({ type: 'node.update', id: 'idea', patch: { progress: 50 } });
  await main.getByRole('button', { name: /今日概览/ }).click();
  await shot(main, 'today');
  assert.equal(await main.locator('.mindmap-shell').count(), 0);
  await sticky.getByRole('button', { name: '今日', exact: true }).click();
  await wait(
    async () => (await sticky.getByRole('slider', { name: '梳理首页的信息层级进度' }).inputValue()) === '50',
  );
  await shot(sticky, 'sticky');
  check('Two windows stay synchronized');
  await main.getByRole('button', { name: '周计划', exact: true }).click();
  assert.equal(await main.locator('.week-column').count(), 7);
  await shot(main, 'week');
  await main.getByRole('button', { name: '月历', exact: true }).click();
  assert.equal(await main.locator('.month-cell').count(), 42);
  await shot(main, 'month');
  check('Week and month use calendar dates only');
  await main.keyboard.press('Control+k');
  await main.locator('.modal input').fill('信息层级');
  await main.locator('.search-result').first().click();
  await main.locator('.detail-drawer').waitFor();
  await main.getByRole('button', { name: '关闭详情', exact: true }).click();
  check('Global search opens matching task');
  await main.getByRole('button', { name: '切换到深色', exact: true }).click();
  await wait(async () => (await sticky.locator('html').getAttribute('data-theme')) === 'dark');
  await shot(main, 'dark');
  await main.getByRole('button', { name: '外观设置', exact: true }).click();
  await shot(main, 'settings');
  await cmd({ type: 'settings.update', patch: { fontSize: 18, reduceMotion: true, blur: 24 } });
  await wait(async () => (await sticky.locator('html').getAttribute('data-motion')) === 'reduced');
  await shot(main, 'settings-large');
  check('Theme, font size and reduced motion sync');
  await cmd({ type: 'settings.update', patch: { fontSize: 14, theme: 'light' } });
  await main.getByRole('button', { name: '品牌网站焕新', exact: true }).click();
  await main.locator('.mindmap-shell').waitFor();
  await shot(main, 'mindmap');
  const topic = main.locator('.me-tpc').filter({ hasText: '视觉与内容设计' });
  await topic.click({ button: 'right' });
  await main.getByRole('menuitem', { name: /添加子项/ }).click();
  await main.locator('.modal').getByLabel('事项名称', { exact: true }).fill('核对页面文案');
  assert.equal(await main.locator('input[type=date]').first().inputValue(), today);
  await main.getByRole('button', { name: '添加待办', exact: true }).click();
  await wait(async () => (await state(main)).nodes.some((n) => n.title === '核对页面文案'));
  const added = (await state(main)).nodes.find((n) => n.title === '核对页面文案');
  assert.equal(added.parentId, 'major');
  await main.getByRole('button', { name: '关闭详情', exact: true }).click();
  await main.getByRole('combobox', { name: '导图展开层级' }).selectOption('main');
  await wait(async () => (await state(main)).nodes.find((n) => n.id === 'major').expanded === false);
  await main.getByRole('combobox', { name: '导图展开层级' }).selectOption('all');
  await wait(async () => (await state(main)).nodes.find((n) => n.id === 'major').expanded === true);
  check('Integrated right-click creation and approved depth expansion');
  assert.deepEqual(errors, []);
  check('No renderer exceptions');
} catch (error) {
  if (main) await main.screenshot({ path: resolve(output, 'v1-ui-failure.png') }).catch(() => {});
  throw error;
} finally {
  await writeFile(
    resolve(output, `v1-${packaged ? 'packaged-' : ''}ui-results.json`),
    JSON.stringify({ checks, errors }, null, 2),
  );
  await app.close();
}
