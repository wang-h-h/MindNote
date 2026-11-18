import type { App } from 'electron';
import Database from 'better-sqlite3';
import { constants, existsSync, mkdirSync, closeSync, openSync, unlinkSync } from 'node:fs';
import { copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function configureDataDirectory(
  app: App,
  platform: NodeJS.Platform = process.platform,
): { directory: string; legacy: string[] } {
  const explicit =
    process.env.MINDNOTE_DATA_DIR && (!app.isPackaged || process.env.MINDNOTE_TEST_MODE === '1');
  const appData = app.getPath('appData');
  const legacy = explicit
    ? []
    : [
        ...new Set([
          app.getPath('userData'),
          path.join(appData, 'MindNote'),
          path.join(appData, 'mindnote'),
          path.join(appData, '思维便签 MindNote'),
        ]),
      ];
  const directory = explicit
    ? path.resolve(process.env.MINDNOTE_DATA_DIR!)
    : app.isPackaged
      ? platform === 'darwin'
        ? path.join(appData, 'MindNote')
        : path.join(path.dirname(app.getPath('exe')), 'data')
      : app.getPath('userData');
  mkdirSync(directory, { recursive: true });
  const probe = path.join(directory, `.mindnote-write-${process.pid}-${Date.now()}`);
  try {
    closeSync(openSync(probe, 'wx'));
    unlinkSync(probe);
  } catch {
    throw new Error(
      `数据目录不可写：${directory}\n${
        platform === 'darwin'
          ? '请检查当前用户 Application Support 文件夹的写入权限。'
          : '请将 MindNote 安装到当前用户有写入权限的文件夹。'
      }`,
    );
  }
  app.setPath('userData', directory);
  for (const [key, folder] of [
    ['sessionData', 'session'],
    ['crashDumps', 'crashes'],
  ] as const) {
    const target = path.join(directory, folder);
    mkdirSync(target, { recursive: true });
    app.setPath(key, target);
  }
  const logs = path.join(directory, 'logs');
  mkdirSync(logs, { recursive: true });
  app.setAppLogsPath(logs);
  return {
    directory,
    legacy: app.isPackaged
      ? legacy.filter((item) => {
          const source = path.resolve(item);
          return platform === 'win32'
            ? source.toLowerCase() !== directory.toLowerCase()
            : source !== directory;
        })
      : [],
  };
}

/** Create a consistent SQLite backup before importing; leave the source intact. */
export async function migrateLegacyData(directory: string, legacy: string[]): Promise<void> {
  const target = path.join(directory, 'mindnote.sqlite');
  if (existsSync(target)) return;
  const source = legacy.map((item) => path.join(item, 'mindnote.sqlite')).find(existsSync);
  if (!source) return;
  const backups = path.join(directory, 'backups');
  mkdirSync(backups, { recursive: true });
  const backup = path.join(backups, `legacy-before-import-${Date.now()}.sqlite`);
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    if (
      db.pragma('application_id', { simple: true }) !== 0x4d4e4f54 ||
      db.pragma('quick_check', { simple: true }) !== 'ok'
    )
      throw new Error('旧版数据库验证失败，原始数据未修改。请在旧版中导出备份后恢复。');
    await db.backup(backup);
  } finally {
    db.close();
  }
  await copyFile(backup, target, constants.COPYFILE_EXCL);
  await writeFile(
    path.join(directory, 'migration.json'),
    JSON.stringify({ source, backup, importedAt: new Date().toISOString() }, null, 2),
    { flag: 'wx' },
  );
}
