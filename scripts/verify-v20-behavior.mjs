import { _electron as electron } from 'playwright';
import defaultExecutable from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

// Exercises the built application and its real SQLite/IPC bridge, without using
// the user's data. Fixture creation uses commands; completion uses real drags.
const packaged = process.argv.includes('--packaged');
const output = resolve('test-results');
const prefix = `v20-${packaged ? 'packaged-' : ''}behavior`;
const dataDir = resolve(`.local-data/${prefix}-${Date.now()}`);
await mkdir(output, { recursive: true });
const env = { ...process.env, MINDNOTE_TEST_MODE: '1', MINDNOTE_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: packaged ? resolve('out/MindNote-win32-x64/MindNote.exe') : defaultExecutable,
  args: packaged ? [] : ['.'],
  env,
});
const checks = [],
  errors = [],
  metrics = [];
let sticky, main;
const wait = async (fn, label) => {
  for (let i = 0; i < 120; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 60));
  }
  throw Error(`Condition timed out: ${label}`);
};
const check = (label) => {
  checks.push(label);
  console.log('PASS', label);
};
const state = (page = main) => page.evaluate(() => window.mindnote.getSnapshot());
const cmd = (command) => main.evaluate((c) => window.mindnote.dispatch(c), command);
const row = (page, id) => page.locator(`[data-task-id="${id}"]`);
const nav = async (name) =>
  main
    .locator('.nav-main')
    .getByRole('button', { name, exact: name !== '今日概览' })
    .click();
const tab = async (name) => sticky.locator('.sticky-tabs').getByRole('button', { name, exact: true }).click();
const present = async (scope, id) => {
  const item = row(scope, id);
  await wait(async () => (await item.count()) === 1 && (await item.isVisible()), `${id} remains displayed`);
};
const absent = async (scope, id) => wait(async () => (await row(scope, id).count()) === 0, `${id} is hidden`);
const dateText = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const shift = (day, delta) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return dateText(d);
};
const typography = (locator) =>
  locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      color: style.color,
      size: style.fontSize,
      weight: style.fontWeight,
      decoration: style.textDecorationLine,
      decorationColor: style.textDecorationColor,
      thickness: style.textDecorationThickness,
      opacity: style.opacity,
    };
  });
const assertCompletionStyle = (before, after, theme, label) => {
  for (const key of ['color', 'size', 'weight', 'opacity'])
    assert.equal(after[key], before[key], `${label}: completion preserves ${key}`);
  assert.equal(after.decoration, 'line-through', `${label}: visible completion line`);
  assert.equal(after.thickness, '3px', `${label}: line is 3px`);
  assert.equal(
    after.decorationColor,
    theme === 'dark' ? 'rgb(241, 199, 91)' : 'rgb(229, 183, 61)',
    `${label}: yellow line`,
  );
  metrics.push({ label, theme, before, after });
};
async function dragToComplete(page, id) {
  const input = row(page, id).locator('input[type=range]');
  await input.scrollIntoViewIfNeeded();
  const rect = await input.boundingBox();
  assert(rect && rect.width > 20, 'progress slider has usable hit area');
  const value = Number(await input.inputValue());
  const x = rect.x + 7 + ((rect.width - 14) * value) / 100;
  await page.bringToFront();
  await page.mouse.move(x, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width - 2, rect.y + rect.height / 2, { steps: 10 });
  await page.mouse.up();
  await wait(
    async () => (await state(page)).nodes.find((n) => n.id === id)?.task?.progress === 100,
    `drag ${id} to 100`,
  );
  await wait(
    async () => (await typography(row(page, id).locator('.task-open strong'))).decoration === 'line-through',
    `drag ${id} completion rendered`,
  );
}
try {
  sticky = await app.firstWindow();
  sticky.on('pageerror', (error) => errors.push(error.message));
  await sticky.locator('.sticky-tabs').waitFor();
  await sticky.getByRole('button', { name: '打开完整窗口', exact: true }).click();
  await wait(() => !!(main = app.windows().find((page) => page.url().includes('view=main'))), 'main opens');
  main.on('pageerror', (error) => errors.push(error.message));
  await main.locator('.page-heading').waitFor();
  const today = await main.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const weekday = new Date(`${today}T12:00:00`).getDay();
  const monday = shift(today, -((weekday + 6) % 7));
  const subjects = [
    ['overdue-yesterday', '昨日逾期待办', shift(today, -1)],
    ['overdue-old', '三周前逾期待办', shift(today, -21)],
    ['due-today', '今日待办', today],
  ];
  await cmd({
    type: 'settings.update',
    patch: { theme: 'light', hideCompleted: false, fontSize: 14, pinned: false },
  });
  await cmd({
    type: 'batch',
    commands: [
      { type: 'map.create', id: 'behavior-project', rootId: 'behavior-root', title: '行为验证项目' },
      { type: 'map.create', id: 'other-project', rootId: 'other-root', title: '另一项目' },
      ...[
        ...subjects,
        ['control-today', '对照事项', today],
        ['previous-monday', '上周一事项', shift(monday, -7)],
        ['next-monday', '下周一事项', shift(monday, 7)],
      ].map(([id, title, date]) => ({
        type: 'node.create',
        id,
        title,
        mapId: 'behavior-project',
        parentId: 'behavior-root',
        task: true,
        schedule: { mode: 'range', start: date, end: date },
      })),
      {
        type: 'node.create',
        id: 'other-today',
        title: '另一项目事项',
        mapId: 'other-project',
        parentId: 'other-root',
        task: true,
        schedule: { mode: 'range', start: today, end: today },
      },
    ],
  });
  await tab('今日');
  await nav('今日概览');
  assert.equal(await main.getByRole('button', { name: '回到今天', exact: true }).count(), 0);
  const before = {};
  for (const [id] of subjects) {
    await present(sticky, id);
    await present(main, id);
    before[id] = {
      sticky: await typography(row(sticky, id).locator('.task-open strong')),
      main: await typography(row(main, id).locator('.task-open strong')),
    };
    await dragToComplete(sticky, id);
    await present(sticky, id);
    await present(main, id);
    assertCompletionStyle(
      before[id].sticky,
      await typography(row(sticky, id).locator('.task-open strong')),
      'light',
      `sticky today ${id}`,
    );
    assertCompletionStyle(
      before[id].main,
      await typography(row(main, id).locator('.task-open strong')),
      'light',
      `main today ${id}`,
    );
  }
  check('Real slider drags keep yesterday, 21-day overdue and today completions visible in both Today views');
  await tab('本周');
  for (const [id] of subjects) await present(sticky, id);
  await nav('周计划');
  await main.locator('.week-board.week-overview').waitFor();
  const columns = main.locator('.week-column.week-summary');
  assert.equal(await columns.count(), 3);
  const expectedWeeks = [
    ['previous', '上周', -7],
    ['current', '本周', 0],
    ['next', '下周', 7],
  ];
  for (const [key, label, delta] of expectedWeeks) {
    const column = main.locator(`.week-column[data-week="${key}"]`);
    assert.equal(await column.getAttribute('data-week-start'), shift(monday, delta));
    assert.equal(await column.getAttribute('data-week-end'), shift(monday, delta + 6));
    assert.equal(await column.getAttribute('aria-label'), `${label}计划`);
    assert.equal(new Date(`${await column.getAttribute('data-week-start')}T12:00:00`).getDay(), 1);
    assert.equal(await column.locator(':scope > header > strong').textContent(), label);
  }
  const current = main.locator('.week-column[data-week=current]');
  for (const [id] of subjects) await present(current, id);
  await present(main.locator('.week-column[data-week=previous]'), 'previous-monday');
  await present(main.locator('.week-column[data-week=next]'), 'next-monday');
  assert.equal(await current.locator('[data-project-id=behavior-project]').count(), 1);
  for (const [id] of subjects) await present(current.locator('[data-project-id=behavior-project]'), id);
  assert.equal(await current.locator('[data-project-id=other-project]').count(), 1);
  for (const name of ['回到今天', '上一周', '下一周'])
    assert.equal(await main.getByRole('button', { name, exact: true }).count(), 0);
  metrics.push({
    today,
    monday,
    weekStarts: await columns.evaluateAll((els) => els.map((el) => el.dataset.weekStart)),
  });
  check(
    'Three Monday-based weeks, project grouping and completed overdue retention; no obsolete Today/week navigation',
  );

  for (const theme of ['light', 'dark']) {
    await cmd({ type: 'settings.update', patch: { theme } });
    await wait(
      async () =>
        (await main.locator('html').getAttribute('data-theme')) === theme &&
        (await sticky.locator('html').getAttribute('data-theme')) === theme,
      `${theme} theme sync`,
    );
    await tab('今日');
    await nav('今日概览');
    await cmd({ type: 'node.update', id: 'overdue-old', patch: { progress: 0 } });
    await wait(
      async () =>
        (await typography(row(main, 'overdue-old').locator('.task-open strong'))).decoration === 'none' &&
        (await typography(row(sticky, 'overdue-old').locator('.task-open strong'))).decoration === 'none',
      'Today reset rendered in both windows',
    );
    const todayBefore = await typography(row(main, 'overdue-old').locator('.task-open strong'));
    const stickyTodayBefore = await typography(row(sticky, 'overdue-old').locator('.task-open strong'));
    await dragToComplete(sticky, 'overdue-old');
    await wait(
      async () =>
        (await typography(row(main, 'overdue-old').locator('.task-open strong'))).decoration ===
        'line-through',
      'Today completion rendered in main window',
    );
    assertCompletionStyle(
      todayBefore,
      await typography(row(main, 'overdue-old').locator('.task-open strong')),
      theme,
      'main today',
    );
    assertCompletionStyle(
      stickyTodayBefore,
      await typography(row(sticky, 'overdue-old').locator('.task-open strong')),
      theme,
      'sticky today',
    );
    await tab('本周');
    await nav('周计划');
    await cmd({ type: 'node.update', id: 'overdue-old', patch: { progress: 0 } });
    await wait(
      async () => (await row(sticky, 'overdue-old').locator('input[type=range]').inputValue()) === '0',
      'reset progress rendered',
    );
    const stickyBefore = await typography(row(sticky, 'overdue-old').locator('.task-open strong'));
    const weekBefore = await typography(row(current, 'overdue-old').locator('.task-open strong'));
    await dragToComplete(sticky, 'overdue-old');
    await present(current, 'overdue-old');
    await wait(
      async () =>
        (await typography(row(current, 'overdue-old').locator('.task-open strong'))).decoration ===
        'line-through',
      'week completion style rendered',
    );
    assertCompletionStyle(
      stickyBefore,
      await typography(row(sticky, 'overdue-old').locator('.task-open strong')),
      theme,
      'sticky week',
    );
    assertCompletionStyle(
      weekBefore,
      await typography(row(current, 'overdue-old').locator('.task-open strong')),
      theme,
      'main current week',
    );
    await cmd({ type: 'node.update', id: 'overdue-old', patch: { progress: 0 } });
    await main.getByRole('button', { name: '行为验证项目', exact: true }).click();
    const mapNode = main.locator('.me-tpc[data-nodeid="meoverdue-old"]');
    await mapNode.waitFor();
    const mapBefore = await typography(mapNode);
    await cmd({ type: 'node.update', id: 'overdue-old', patch: { progress: 100 } });
    await wait(
      async () => (await typography(mapNode)).decoration === 'line-through',
      'map completion style rendered',
    );
    assertCompletionStyle(mapBefore, await typography(mapNode), theme, 'mind map');
    await nav('周计划');
  }
  check(
    'Light/dark Today, week and mind-map completion preserve font size, weight and text color; yellow 3px line only',
  );

  await main.getByRole('button', { name: '外观设置', exact: true }).click();
  await main.getByRole('switch', { name: '隐藏划线事项', exact: true }).click();
  await wait(
    async () => (await state()).settings.hideCompleted && (await state(sticky)).settings.hideCompleted,
    'hide setting sync',
  );
  await nav('今日概览');
  for (const [id] of subjects) {
    await absent(sticky, id);
    await absent(main, id);
  }
  await present(sticky, 'control-today');
  await present(main, 'control-today');
  await nav('全部事项');
  await main.getByRole('button', { name: '已归档', exact: true }).click();
  for (const [id] of subjects) await present(main, id);
  await main.getByRole('button', { name: '外观设置', exact: true }).click();
  await main.getByRole('switch', { name: '隐藏划线事项', exact: true }).click();
  await wait(
    async () => !(await state()).settings.hideCompleted && !(await state(sticky)).settings.hideCompleted,
    'show setting sync',
  );
  await nav('今日概览');
  for (const [id] of subjects) {
    await present(sticky, id);
    await present(main, id);
  }
  check(
    'Only explicit hide-completed removes completed rows; turning it off restores them, and archive remains accessible',
  );

  await sticky.bringToFront();
  const headerButtons = await sticky.locator('.sticky-header button').evaluateAll((buttons) =>
    buttons
      .filter((b) => b.getClientRects().length)
      .map((b) => ({
        label: b.getAttribute('title') || b.getAttribute('aria-label'),
        x: b.getBoundingClientRect().x,
      })),
  );
  assert.equal(headerButtons.at(-1).label, '关闭便签');
  assert(
    headerButtons.slice(0, -1).every((b) => b.x < headerButtons.at(-1).x),
    'close is rightmost header button',
  );
  const idsBeforeClose = (await state(sticky)).nodes.map((n) => n.id).sort();
  await sticky.getByRole('button', { name: '关闭便签', exact: true }).click();
  const stickyNative = () =>
    app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('view=sticky'));
      return w ? { visible: w.isVisible(), destroyed: w.isDestroyed() } : null;
    });
  await wait(async () => (await stickyNative())?.visible === false, 'native note hidden');
  assert.deepEqual((await state(sticky)).nodes.map((n) => n.id).sort(), idsBeforeClose);
  await main.evaluate(() => window.mindnote.showSticky());
  await wait(async () => (await stickyNative())?.visible === true, 'native note restored');
  for (const [id] of subjects) await present(sticky, id);
  assert.deepEqual((await state()).nodes.map((n) => n.id).sort(), idsBeforeClose);
  check('Rightmost close button hides the native note without destroying data; showSticky restores it');
  await sticky.screenshot({ path: resolve(output, `${prefix}-sticky.png`) });
  await nav('周计划');
  await main.screenshot({ path: resolve(output, `${prefix}-weeks.png`) });
  assert.deepEqual(errors, []);
  check('No renderer exceptions');
} catch (error) {
  errors.push(error.stack || String(error));
  await main?.screenshot({ path: resolve(output, `${prefix}-failure-main.png`) }).catch(() => {});
  await sticky?.screenshot({ path: resolve(output, `${prefix}-failure-sticky.png`) }).catch(() => {});
  throw error;
} finally {
  await writeFile(
    resolve(output, `${prefix}-results.json`),
    JSON.stringify({ packaged, dataDir, checks, errors, metrics }, null, 2),
  );
  await app.close();
}
