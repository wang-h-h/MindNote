import { _electron as electron } from 'playwright';
import defaultExecutable from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const packaged = process.argv.includes('--packaged');
const output = resolve('test-results');
await mkdir(output, { recursive: true });
const env = {
  ...process.env,
  MINDNOTE_TEST_MODE: '1',
  MINDNOTE_DATA_DIR: resolve(`.local-data/v20-ui-${Date.now()}`),
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
  await page.screenshot({ path: resolve(output, `v20-${packaged ? 'packaged-' : ''}${name}.png`) });
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
  const headerSettings = await sticky
    .locator('.sticky-header')
    .getByRole('button', { name: '外观设置', exact: true })
    .boundingBox();
  const pin = await sticky.locator('.sticky-header').getByRole('button', { name: /置顶/ }).boundingBox();
  assert(headerSettings.x < pin.x && Math.abs(headerSettings.y - pin.y) < 2);
  check('Sticky appearance action is in the title bar before pinning');
  await sticky.getByRole('button', { name: '收起便签', exact: true }).click();
  await wait(async () => (await sticky.evaluate(() => window.mindnote.getWindowBounds())).height < 80);
  await sticky.getByRole('button', { name: '外观设置', exact: true }).click();
  await sticky.locator('.modal').waitFor();
  await wait(async () => (await sticky.locator('.modal').boundingBox()).height > 380);
  assert.equal((await state(sticky)).settings.stickyCollapsed, false);
  await sticky.getByRole('button', { name: '关闭对话框', exact: true }).click();
  check('Collapsed note expands before opening appearance settings');
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
  await sticky.getByRole('button', { name: '暂不安排', exact: true }).click();
  assert.equal(await sticky.locator('input[type=date]').count(), 2);
  assert.equal(await sticky.getByLabel('开始日期').inputValue(), '');
  assert.equal(await sticky.getByLabel('结束日期').inputValue(), '');
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
  await main.locator('.notes-grid').first().waitFor();
  assert.equal(await main.locator('[data-task-id=major]').count(), 0);
  assert.equal(await main.locator('[data-task-id=child]').count(), 0);
  assert.equal(await main.locator('[data-task-id=idea] .project-tag').textContent(), '品牌网站焕新');
  assert.equal(
    await main.locator('[data-project-id=system-tasks] .plan-note').last().getAttribute('data-task-id'),
    'finished',
  );
  check('Flat single-node project plan and unfinished-first card order');
  assert((await main.locator('[data-task-id=finished]').textContent()).includes('清晰来自有意识的取舍。'));
  assert.equal(await main.locator('.brand .brand-chinese').textContent(), '思维便签');
  assert.equal(await main.locator('.project-heading .nav-label').textContent(), '思维空间');
  check('Note grid includes saved remarks; bilingual branding and larger space headings');
  await main.getByRole('button', { name: '2 列', exact: true }).click();
  await wait(async () => (await state(main)).settings.gridColumns === 2);
  await wait(
    async () =>
      (await main
        .locator('.plan-project-grid')
        .first()
        .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)) === 2,
  );
  assert.equal(
    await main
      .locator('.plan-project-grid')
      .first()
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length),
    2,
  );
  await main.getByRole('button', { name: '4 列', exact: true }).click();
  await wait(async () => (await state(main)).settings.gridColumns === 4);
  await main.getByRole('button', { name: '3 列', exact: true }).click();
  await wait(async () => (await state(main)).settings.gridColumns === 3);
  await main.getByRole('button', { name: '收起项目 品牌网站焕新', exact: true }).click();
  assert.equal(await main.locator('[data-task-id=idea]').count(), 0);
  await main.getByRole('button', { name: '展开项目 品牌网站焕新', exact: true }).click();
  await main.locator('[data-task-id=idea]').waitFor();
  const card = main.locator('[data-task-id=idea]');
  const cardBounds = await card.boundingBox(),
    cardBottom = await card.locator('.plan-item-bottom').boundingBox();
  assert(cardBottom.y + cardBottom.height - cardBounds.y < 110, 'compact two-line header above full notes');
  assert.equal(await card.locator('.plan-note-field').count(), 2);
  assert.equal(
    await card.locator('[data-note-kind=progress] p').textContent(),
    '首页以内容为中心，让访问者轻松找到想了解的部分。',
  );
  assert.equal(await card.locator('.progress-value').textContent(), '40%');
  assert.equal(await main.getByText('今日到期', { exact: true }).count(), 0);
  assert(await card.locator('.plan-date').evaluate((el) => el.classList.contains('is-due')));
  check('Two-line cards, project folding, due-date color and persistent grid columns');
  await shot(main, 'all');
  await cmd({
    type: 'batch',
    commands: [
      { type: 'node.convert', id: 'major', start: today, end: today },
      { type: 'node.update', id: 'major', patch: { planned: false } },
    ],
  });
  await main.locator('[data-task-id=idea] .task-open').click();
  const dateBounds = await main.locator('.schedule-button').boundingBox();
  const cancelBounds = await main.getByRole('button', { name: '取消计划', exact: true }).boundingBox();
  assert(cancelBounds.x > dateBounds.x && Math.abs(cancelBounds.y - dateBounds.y) < 2);
  assert(
    await main
      .getByRole('button', { name: '取消计划', exact: true })
      .evaluate((el) => el.classList.contains('primary')),
  );
  check('Cancel plan shares the date row and primary action style');
  await main.locator('.schedule-button').click();
  await main.getByRole('button', { name: '跟随父项', exact: true }).click();
  assert.equal(await main.getByLabel('开始日期', { exact: true }).inputValue(), today);
  assert.equal(await main.getByLabel('结束日期', { exact: true }).inputValue(), today);
  await main.getByRole('button', { name: '暂不安排', exact: true }).click();
  assert.equal(await main.getByLabel('开始日期', { exact: true }).inputValue(), '');
  assert.equal(await main.locator('input[type=date]').count(), 2);
  await main.getByRole('button', { name: '跟随父项', exact: true }).click();
  await shot(main, 'date-modes');
  await main.getByRole('button', { name: '保存日期', exact: true }).click();
  assert.equal((await state(main)).nodes.find((n) => n.id === 'idea').task.schedule.mode, 'inherit');
  await main.getByRole('button', { name: '关闭详情', exact: true }).click();
  check('Schedule modes keep both fields visible and display parent dates');
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
  const stickyRow = sticky.locator('[data-task-id=idea]');
  assert((await stickyRow.boundingBox()).height < 90);
  await sticky.getByRole('button', { name: '收起项目 品牌网站焕新', exact: true }).click();
  assert.equal(await sticky.locator('[data-task-id=idea]').count(), 0);
  await sticky.getByRole('button', { name: '展开项目 品牌网站焕新', exact: true }).click();
  await sticky.getByRole('button', { name: '外观设置', exact: true }).click();
  await sticky.locator('.modal-body').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  assert(await sticky.getByRole('button', { name: '关闭对话框', exact: true }).isVisible());
  const closeBounds = await sticky.getByRole('button', { name: '关闭对话框', exact: true }).boundingBox();
  assert(closeBounds.y < 80);
  const modalBounds = await sticky.locator('.modal').boundingBox();
  assert(modalBounds.x <= 1 && modalBounds.y <= 1);
  await shot(sticky, 'sticky-settings-scrolled');
  await sticky.getByRole('button', { name: '关闭对话框', exact: true }).click();
  check('Two-window sync, compact groups and fixed sticky settings close button');
  await main.getByRole('button', { name: '周计划', exact: true }).click();
  assert.equal(await main.locator('.week-column').count(), 3);
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
  const themeBounds = await main.locator('.settings-theme').boundingBox(),
    previewBounds = await main.locator('.settings-background').boundingBox();
  assert(Math.abs(themeBounds.y - previewBounds.y) < 2);
  assert(Math.abs(themeBounds.height - previewBounds.height) < 2);
  assert(previewBounds.x > themeBounds.x);
  const readingBounds = await main.locator('.settings-reading').boundingBox();
  const livePreviewBounds = await main.locator('.settings-live-preview').boundingBox();
  assert(
    Math.abs(readingBounds.y - livePreviewBounds.y) < 2 &&
      Math.abs(readingBounds.height - livePreviewBounds.height) < 2,
  );
  const dataBounds = await main.locator('.settings-data').boundingBox(),
    desktopBounds = await main.locator('.settings-desktop').boundingBox();
  assert(
    Math.abs(dataBounds.y - desktopBounds.y) < 2 && Math.abs(dataBounds.width - desktopBounds.width) < 2,
  );
  assert(
    await main
      .getByRole('button', { name: '打开数据文件夹', exact: true })
      .evaluate((el) => el.classList.contains('secondary')),
  );
  const backgroundFile = resolve(env.MINDNOTE_DATA_DIR, 'test-background.png');
  await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#4f81a1"/><path d="M0 0H200V150H0ZM200 150H400V300H200Z" fill="#d7b56a"/></svg>',
    ),
  )
    .png()
    .toFile(backgroundFile);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, backgroundFile);
  await main.getByRole('button', { name: '添加背景', exact: true }).click();
  await wait(async () => !!(await state(main)).settings.backgroundImage);
  await wait(
    async () =>
      await sticky
        .locator('.app-background img')
        .evaluate((el) => el.complete && el.naturalWidth > 0)
        .catch(() => false),
  );
  assert(await main.locator('.app-background img').evaluate((el) => el.complete && el.naturalWidth > 0));
  const blurSlider = main.getByRole('slider', { name: '背景模糊', exact: true });
  await blurSlider.focus();
  await blurSlider.press('Home');
  await wait(
    async () =>
      (await main.locator('.app-background img').evaluate((el) => getComputedStyle(el).filter)) ===
      'blur(0px)',
  );
  await blurSlider.press('End');
  await wait(
    async () =>
      (await sticky.locator('.app-background img').evaluate((el) => getComputedStyle(el).filter)) ===
      'blur(36px)',
  );
  await shot(main, 'custom-background');
  await main.getByRole('button', { name: '移除', exact: true }).click();
  await wait(async () => !(await state(main)).settings.backgroundImage);
  assert.equal(await main.locator('.app-background').count(), 0);
  check('Background import, cross-window image display, visible blur control, removal and balanced settings');
  assert.equal(await main.getByText('版本 1.0.0 · 本地离线', { exact: true }).count(), 0);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('view=main'));
    w.setBounds({ width: 1000, height: 640 });
  });
  await main.waitForTimeout(150);
  const profile = await main.locator('.profile').boundingBox();
  assert(
    profile.y + profile.height <= (await main.evaluate(() => innerHeight)) + 1,
    'workspace footer visible',
  );
  const shell = await main.locator('.window-shell').boundingBox();
  assert(shell.x < 1 && shell.y < 1, 'No outer frame');
  await shot(main, 'main-small');
  await main.getByRole('button', { name: '最大化／还原', exact: true }).click();
  await wait(async () => (await main.locator('html').getAttribute('data-maximized')) === 'true');
  assert.equal(
    await main.locator('.window-shell').evaluate((el) => getComputedStyle(el).borderRadius),
    '0px',
  );
  await main.getByRole('button', { name: '最大化／还原', exact: true }).click();
  await wait(async () => (await main.locator('html').getAttribute('data-maximized')) === 'false');
  assert.equal(
    await main.locator('.window-shell').evaluate((el) => getComputedStyle(el).borderRadius),
    '20px',
  );
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('view=main'));
    w.setBounds({ width: 1280, height: 840 });
  });
  for (const edge of ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw']) {
    const initialBounds = await main.evaluate(() => window.mindnote.getWindowBounds());
    const handle = main.locator(`[data-resize-edge=${edge}]`);
    const box = await handle.boundingBox();
    const dx = edge.includes('e') ? 12 : edge.includes('w') ? -12 : 0;
    const dy = edge.includes('s') ? 12 : edge.includes('n') ? -12 : 0;
    await main.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await main.mouse.down();
    await main.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 3 });
    await main.mouse.up();
    await wait(async () => {
      const b = await main.evaluate(() => window.mindnote.getWindowBounds());
      return Math.abs(dx ? b.width - initialBounds.width : b.height - initialBounds.height) > 3;
    });
    await main.evaluate((b) => window.mindnote.resizeMain(b), initialBounds);
  }
  check('Transparent main window supports all eight resize directions');
  check('Balanced preview, visible workspace footer, single round frame and maximized fill');
  check('Theme, font size and reduced motion sync');
  await cmd({ type: 'settings.update', patch: { fontSize: 14, theme: 'light' } });
  await main.getByRole('button', { name: '品牌网站焕新', exact: true }).click();
  await main.locator('.mindmap-shell').waitFor();
  await shot(main, 'mindmap');
  const topic = main.locator('.me-tpc').filter({ hasText: '视觉与内容设计' });
  await topic.click({ button: 'right' });
  await main.getByRole('menuitem', { name: /添加子项/ }).waitFor();
  const canvasBounds = await main.locator('.map-canvas-card').boundingBox(),
    detailBounds = await main.locator('.map-detail').boundingBox();
  assert(
    Math.abs(canvasBounds.y - detailBounds.y) < 2 && Math.abs(canvasBounds.height - detailBounds.height) < 2,
    'map and inspector aligned',
  );
  await main.keyboard.press('Escape');
  const note = main.getByRole('textbox', { name: '进展说明', exact: true });
  const emptyHeight = (await note.boundingBox()).height;
  assert(emptyHeight < 75, 'two-line default');
  await note.fill('一行\n二行\n三行\n四行\n五行');
  await main.waitForTimeout(100);
  assert((await note.boundingBox()).height > emptyHeight + 25);
  await note.fill('只保留一行');
  await main.waitForTimeout(100);
  assert(Math.abs((await note.boundingBox()).height - emptyHeight) < 2);
  await main.getByRole('textbox', { name: '事项名称', exact: true }).focus();
  await shot(main, 'mindmap-details');
  check('Aligned map inspector and automatically expanding two-line notes');
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
  if (main) await main.screenshot({ path: resolve(output, 'v20-ui-failure.png') }).catch(() => {});
  throw error;
} finally {
  await writeFile(
    resolve(output, `v20-${packaged ? 'packaged-' : ''}ui-results.json`),
    JSON.stringify({ checks, errors }, null, 2),
  );
  await app.close();
}
