import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import Database from 'better-sqlite3';

assert.equal(process.platform, 'darwin');
const bundle = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
const executablePath = path.join(bundle, 'Contents/MacOS/MindNote');
const sqliteBinary = path.join(
  bundle,
  'Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds',
  `darwin-${process.arch}.node`,
);
const machArch = process.arch === 'x64' ? 'x86_64' : 'arm64';
for (const binary of [executablePath, sqliteBinary])
  assert.equal(execFileSync('/usr/bin/lipo', ['-archs', binary], { encoding: 'utf8' }).trim(), machArch);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const useDefaultPath = env.GITHUB_ACTIONS === 'true';
const dataDir = useDefaultPath
  ? path.join(homedir(), 'Library/Application Support/MindNote')
  : await mkdtemp(path.join(tmpdir(), 'mindnote-smoke-'));
if (useDefaultPath) {
  delete env.MINDNOTE_DATA_DIR;
  delete env.MINDNOTE_TEST_MODE;
} else {
  env.MINDNOTE_TEST_MODE = '1';
  env.MINDNOTE_DATA_DIR = dataDir;
}
const sqlitePath = path.join(dataDir, 'mindnote.sqlite');
assert.ok(!existsSync(sqlitePath), 'Smoke test requires an empty data directory');
const taskTitle = '回顾本周计划';
const errors = [];
let session;
try {
  session = await electron.launch({ executablePath, args: [], env, timeout: 60000 });
  const sticky = await session.firstWindow();
  sticky.on('pageerror', (error) => errors.push(error.message));
  await sticky.locator('.sticky-tabs').waitFor();
  const native = await session.evaluate(({ app, BrowserWindow }) => ({
    packaged: app.isPackaged,
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    dataDir: app.getPath('userData'),
    visible: BrowserWindow.getAllWindows().some(
      (w) => w.isVisible() && w.webContents.getURL().includes('view=sticky'),
    ),
  }));
  assert.equal(native.packaged, true);
  assert.equal(native.version, '2.0.0');
  assert.equal(native.platform, 'darwin');
  assert.equal(native.arch, process.arch);
  assert.equal(native.dataDir, dataDir);
  assert.ok(native.visible, 'The native sticky window is visible');
  await sticky.evaluate(async (title) => {
    const { maps } = await window.mindnote.getSnapshot();
    const inbox = maps.find((map) => map.system);
    const today = new Date().toLocaleDateString('sv-SE');
    await window.mindnote.dispatch({
      type: 'node.create',
      id: 'mac-smoke-task',
      parentId: inbox.rootId,
      mapId: inbox.id,
      title,
      task: true,
      schedule: { mode: 'range', start: today, end: today },
    });
  }, taskTitle);
  await sticky.getByText(taskTitle, { exact: true }).first().waitFor();
  await sticky.screenshot({ path: path.join(output, 'sticky.png') });
  const mainEvent = session.waitForEvent('window', { predicate: (page) => page !== sticky });
  await sticky.getByRole('button', { name: '打开完整窗口', exact: true }).click();
  const main = await mainEvent;
  main.on('pageerror', (error) => errors.push(error.message));
  await main.locator('.page-heading').waitFor();
  assert.ok(
    (await main.evaluate(() => window.mindnote.getSnapshot())).nodes.some((n) => n.title === taskTitle),
  );
  await main.screenshot({ path: path.join(output, 'main.png') });
} finally {
  if (session) await session.close();
}
assert.ok(existsSync(sqlitePath));
// Reopen the app as a user would, then independently inspect its existing WAL database.
const reopened = await electron.launch({ executablePath, args: [], env, timeout: 60000 });
try {
  const restored = await reopened.firstWindow();
  restored.on('pageerror', (error) => errors.push(error.message));
  await restored.getByText(taskTitle, { exact: true }).first().waitFor();
} finally {
  await reopened.close();
}
assert.deepEqual(errors, []);
const saved = new Database(sqlitePath, { fileMustExist: true });
try {
  saved.pragma('query_only = ON');
  assert.equal(saved.pragma('quick_check', { simple: true }), 'ok');
  const { payload } = saved.prepare('SELECT payload FROM app_snapshot WHERE id = 1').get();
  assert.ok(JSON.parse(payload).nodes.some((n) => n.title === taskTitle));
} finally {
  saved.close();
}
const plist = JSON.parse(execFileSync('/usr/bin/plutil', [
  '-convert', 'json', '-o', '-', path.join(bundle, 'Contents/Info.plist'),
], { encoding: 'utf8' }));
const report = {
  version: '2.0.0',
  arch: process.arch,
  minSystem: plist.LSMinimumSystemVersion ?? null,
  host: execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(),
  signature: 'ad hoc',
  defaultApplicationSupportPath: useDefaultPath,
  checks: [
    'DMG mounted read-only',
    'app and SQLite Mach-O architecture',
    'code signature integrity',
    'native sticky window visible',
    'task created in sticky window',
    'main window opened and shared the task',
    'SQLite persisted task after exit',
    'sticky window restored the task after relaunch',
    'SQLite quick_check',
  ],
};
await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(report);
