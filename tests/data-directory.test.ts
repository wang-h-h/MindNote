import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { App } from 'electron';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { configureDataDirectory, migrateLegacyData } from '../src/main/data-directory';

const root = path.resolve('.local-data', `migration-tests-${Date.now()}`);
mkdirSync(root, { recursive: true });
const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
afterEach(() => vi.unstubAllEnvs());

function packagedApp(name: string) {
  const paths: Record<string, string> = {
    appData: path.join(root, name, 'Application Support'),
    userData: path.join(root, name, 'Application Support', 'mindnote'),
    exe: path.join(root, name, 'Applications', 'MindNote.app', 'Contents', 'MacOS', 'MindNote'),
  };
  const app = {
    isPackaged: true,
    getPath: (key: string) => paths[key],
    setPath: (key: string, value: string) => {
      paths[key] = value;
    },
    setAppLogsPath: (value: string) => {
      paths.logs = value;
    },
  } as unknown as App;
  return { app, paths };
}
describe('installation-linked data and safe legacy migration', () => {
  it('puts database, session, logs and crash dumps beside the packaged executable', () => {
    const paths: Record<string, string> = {
      appData: path.join(root, 'roaming'),
      userData: path.join(root, 'roaming', 'old'),
      exe: path.join(root, 'chosen', 'MindNote.exe'),
    };
    const prior = process.env.MINDNOTE_DATA_DIR;
    delete process.env.MINDNOTE_DATA_DIR;
    try {
      const result = configureDataDirectory(
        {
          isPackaged: true,
          getPath: (key: string) => paths[key],
          setPath: (key: string, value: string) => {
            paths[key] = value;
          },
          setAppLogsPath: (value: string) => {
            paths.logs = value;
          },
        } as unknown as App,
        'win32',
      );
      expect(result.directory).toBe(path.join(root, 'chosen', 'data'));
      for (const key of ['userData', 'sessionData', 'logs', 'crashDumps'])
        expect(paths[key].startsWith(result.directory)).toBe(true);
      expect(paths.sessionData).toBe(path.join(result.directory, 'session'));
    } finally {
      if (prior === undefined) delete process.env.MINDNOTE_DATA_DIR;
      else process.env.MINDNOTE_DATA_DIR = prior;
    }
  });
  it('keeps macOS packaged data outside the application bundle and preserves its legacy location', () => {
    vi.stubEnv('MINDNOTE_DATA_DIR', '');
    const { app, paths } = packagedApp('mac-default');
    const legacyUserData = paths.userData;
    const bundleDirectory = path.dirname(paths.exe);
    const result = configureDataDirectory(app, 'darwin');
    expect(result.directory).toBe(path.join(paths.appData, 'MindNote'));
    expect(result.legacy).toContain(legacyUserData);
    expect(result.legacy).not.toContain(result.directory);
    expect(existsSync(bundleDirectory)).toBe(false);
    for (const key of ['userData', 'sessionData', 'logs', 'crashDumps'])
      expect(paths[key].startsWith(result.directory)).toBe(true);
    expect(paths.sessionData).toBe(path.join(result.directory, 'session'));
    expect(paths.logs).toBe(path.join(result.directory, 'logs'));
  });
  it('does not redirect an installed macOS app using a development data override', () => {
    const { app, paths } = packagedApp('mac-override');
    const unwanted = path.join(root, 'unwanted-override');
    vi.stubEnv('MINDNOTE_DATA_DIR', unwanted);
    vi.stubEnv('MINDNOTE_TEST_MODE', '');
    const result = configureDataDirectory(app, 'darwin');
    expect(result.directory).toBe(path.join(paths.appData, 'MindNote'));
    expect(existsSync(unwanted)).toBe(false);
  });
  it('isolates packaged macOS tests without looking for or migrating personal data', () => {
    const { app } = packagedApp('mac-isolated');
    const isolated = path.join(root, 'explicit-mac-test');
    vi.stubEnv('MINDNOTE_DATA_DIR', isolated);
    vi.stubEnv('MINDNOTE_TEST_MODE', '1');
    const result = configureDataDirectory(app, 'darwin');
    expect(result).toEqual({ directory: isolated, legacy: [] });
  });
  it('backs up a live WAL database, preserves source bytes and skips an existing destination', async () => {
    const sourceDir = path.join(root, 'legacy');
    const destination = path.join(root, 'new-data');
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(destination, { recursive: true });
    const source = path.join(sourceDir, 'mindnote.sqlite');
    const db = new Database(source);
    try {
      db.pragma('application_id=1296977748');
      db.pragma('journal_mode=WAL');
      db.exec("CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES ('committed in WAL');");
      const before = { database: hash(source), wal: hash(`${source}-wal`) };
      await migrateLegacyData(destination, [sourceDir]);
      expect(hash(source)).toBe(before.database);
      expect(hash(`${source}-wal`)).toBe(before.wal);
      const target = new Database(path.join(destination, 'mindnote.sqlite'));
      try {
        expect(target.prepare('SELECT value FROM proof').pluck().get()).toBe('committed in WAL');
        target.prepare('UPDATE proof SET value=?').run('new version edit');
      } finally {
        target.close();
      }
      expect(
        readdirSync(path.join(destination, 'backups')).some((file) =>
          file.startsWith('legacy-before-import-'),
        ),
      ).toBe(true);
      await migrateLegacyData(destination, [sourceDir]);
      const reopened = new Database(path.join(destination, 'mindnote.sqlite'));
      try {
        expect(reopened.prepare('SELECT value FROM proof').pluck().get()).toBe('new version edit');
      } finally {
        reopened.close();
      }
    } finally {
      db.close();
    }
  });
  it('rejects an unrelated database without creating a replacement database', async () => {
    const sourceDir = path.join(root, 'unrelated');
    const destination = path.join(root, 'failed-import');
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(destination, { recursive: true });
    const file = path.join(sourceDir, 'mindnote.sqlite');
    const db = new Database(file);
    db.exec('CREATE TABLE example(id INTEGER)');
    db.close();
    const before = hash(file);
    await expect(migrateLegacyData(destination, [sourceDir])).rejects.toThrow('旧版数据库验证失败');
    expect(hash(file)).toBe(before);
    expect(existsSync(path.join(destination, 'mindnote.sqlite'))).toBe(false);
  });
});
