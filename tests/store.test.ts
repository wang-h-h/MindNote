import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MindNoteStore } from '../src/main/store';
import {
  applyCommand,
  createInitialSnapshot,
  getProgress,
  SYSTEM_MAP_ID,
  SYSTEM_ROOT_ID,
} from '../src/shared/domain';
import type { Command } from '../src/shared/types';

const folders: string[] = [];
const stores: MindNoteStore[] = [];
function folder() {
  const path = mkdtempSync(join(tmpdir(), 'mindnote-test-'));
  folders.push(path);
  return path;
}
function open(path: string) {
  const store = new MindNoteStore(path);
  stores.push(store);
  return store;
}
const add = (id: string): Extract<Command, { type: 'node.create' }> => ({
  type: 'node.create',
  id,
  mapId: SYSTEM_MAP_ID,
  parentId: SYSTEM_ROOT_ID,
  title: id,
});
const gifBytes = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const background = (id: string) => ({
  id,
  name: '动画背景.gif',
  mimeType: 'image/gif' as const,
  data: Buffer.from(gifBytes),
});
afterEach(() => {
  vi.useRealTimers();
  for (const store of stores.splice(0)) store.close();
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('SQLite persistence and shared command history', () => {
  it('persists Chinese text, notes, settings and window position over restart', () => {
    const path = join(folder(), '中文目录', 'mindnote.db');
    const store = open(path);
    store.dispatch(add('task-a'));
    store.dispatch({
      type: 'node.update',
      id: 'task-a',
      patch: { title: '整理本周阅读', notes: { other: '这是完成后的复盘。' }, progress: 100 },
    });
    store.dispatch({
      type: 'settings.update',
      patch: { theme: 'dark', opacity: 0.7, blur: 24, fontSize: 16, reduceMotion: true, gridColumns: 4 },
    });
    store.setWindowState('sticky', { x: 20, y: 30, width: 360, height: 560 });
    store.close();
    const restarted = open(path);
    expect(restarted.snapshot().nodes.find((node) => node.id === 'task-a')?.notes.other).toBe(
      '这是完成后的复盘。',
    );
    expect(restarted.snapshot().settings).toMatchObject({
      theme: 'dark',
      blur: 24,
      fontSize: 16,
      reduceMotion: true,
      gridColumns: 4,
    });
    expect(restarted.snapshot().canUndo).toBe(false);
    expect(restarted.getWindowState('sticky')).toEqual({ x: 20, y: 30, width: 360, height: 560 });
  });
  it('undoes and redoes business edits while preserving settings across windows', () => {
    const store = open(join(folder(), 'mindnote.db'));
    store.dispatch(add('a'));
    store.dispatch({ type: 'node.update', id: 'a', patch: { title: '从导图编辑' } });
    store.dispatch({ type: 'settings.update', patch: { theme: 'dark' } });
    const before = store.snapshot().revision;
    const undone = store.dispatch({ type: 'history.undo' });
    expect(undone.nodes.find((node) => node.id === 'a')?.title).toBe('a');
    expect(undone.settings.theme).toBe('dark');
    expect(undone.canRedo).toBe(true);
    expect(undone.revision).toBe(before + 1);
    expect(store.dispatch({ type: 'history.redo' }).nodes.find((node) => node.id === 'a')?.title).toBe(
      '从导图编辑',
    );
    store.dispatch({ type: 'history.undo' });
    store.dispatch(add('b'));
    expect(store.snapshot().canRedo).toBe(false);
  });
  it('commits a batch as one history entry and leaves no writes on invalid commands', () => {
    const store = open(join(folder(), 'mindnote.db'));
    store.dispatch({ type: 'batch', commands: [add('a'), add('b')] });
    expect(store.dispatch({ type: 'history.undo' }).nodes).toHaveLength(1);
    const snapshot = store.snapshot();
    expect(() => store.dispatch({ type: 'batch', commands: [add('c'), add('c')] })).toThrow();
    expect(store.snapshot()).toEqual(snapshot);
  });
  it('retains at most 100 undo entries', () => {
    const store = open(join(folder(), 'mindnote.db'));
    store.dispatch(add('a'));
    for (let i = 0; i < 110; i++)
      store.dispatch({ type: 'node.update', id: 'a', patch: { title: `revision-${i}` } });
    for (let i = 0; i < 100; i++) store.dispatch({ type: 'history.undo' });
    expect(store.snapshot().canUndo).toBe(false);
    expect(store.snapshot().nodes.find((node) => node.id === 'a')?.title).toBe('revision-9');
  });
});

describe('validated backups and safe restore', () => {
  it('preserves image bytes separately from snapshots and keeps the current image through undo and restart', () => {
    const path = join(folder(), 'image.db');
    const store = open(path);
    store.dispatch(add('image-task'));
    const next = store.setBackgroundImage(background('image-1'));
    expect(next.settings.backgroundImage).toEqual({
      id: 'image-1',
      name: '动画背景.gif',
      mimeType: 'image/gif',
    });
    expect(JSON.stringify(next)).not.toContain(gifBytes.toString('base64'));
    expect(store.getBackgroundImage('image-1')?.data).toEqual(gifBytes);
    expect(store.dispatch({ type: 'history.undo' }).settings.backgroundImage?.id).toBe('image-1');
    expect(store.snapshot().nodes.some((node) => node.id === 'image-task')).toBe(false);
    store.close();
    const reopened = open(path);
    expect(reopened.snapshot().settings.backgroundImage?.id).toBe('image-1');
    expect(reopened.getBackgroundImage('image-1')?.data).toEqual(gifBytes);
    const loaded = reopened.getBackgroundImage('image-1')!;
    loaded.data.fill(0);
    expect(reopened.getBackgroundImage('image-1')?.data).toEqual(gifBytes);
  });
  it('backs up and atomically restores image assets along with settings and preserves the replaced image in the safety copy', async () => {
    const dir = folder(),
      store = open(join(dir, 'images.db')),
      saved = join(dir, 'with-image.mindnote');
    store.setBackgroundImage(background('image-a'));
    await store.backup(saved);
    store.setBackgroundImage(background('image-b'));
    expect(store.getBackgroundImage('image-a')?.data).toEqual(gifBytes);
    const safety = await store.restore(saved);
    expect(store.snapshot().settings.backgroundImage?.id).toBe('image-a');
    expect(store.getBackgroundImage('image-a')?.data).toEqual(gifBytes);
    expect(store.getBackgroundImage('image-b')).toBeNull();
    const before = open(safety);
    expect(before.snapshot().settings.backgroundImage?.id).toBe('image-b');
    expect(before.getBackgroundImage('image-b')?.data).toEqual(gifBytes);
  });
  it('rejects missing, mismatched or oversized image resources before changing live state', () => {
    const store = open(join(folder(), 'images.db'));
    store.setBackgroundImage(background('good'));
    const before = store.snapshot();
    expect(() =>
      store.dispatch({
        type: 'settings.update',
        patch: { backgroundImage: { id: 'missing', name: 'lost.gif', mimeType: 'image/gif' } },
      }),
    ).toThrow('缺失');
    expect(() => store.setBackgroundImage({ ...background('wrong'), mimeType: 'image/png' })).toThrow(
      '不匹配',
    );
    expect(() =>
      store.setBackgroundImage({ ...background('large'), data: Buffer.alloc(20 * 1024 * 1024 + 1) }),
    ).toThrow('20 MB');
    expect(() => store.setBackgroundImage(background('good'))).toThrow();
    expect(store.snapshot()).toEqual(before);
    expect(store.getBackgroundImage('wrong')).toBeNull();
  });
  it('rejects a backup with a missing active image without replacing tasks or appearance', async () => {
    const dir = folder(),
      store = open(join(dir, 'images.db')),
      bad = join(dir, 'missing-image.mindnote');
    store.setBackgroundImage(background('saved-image'));
    await store.backup(bad);
    const corrupt = new Database(bad);
    corrupt.prepare('DELETE FROM background_assets').run();
    corrupt.close();
    store.dispatch(add('valuable-task'));
    const before = store.snapshot();
    await expect(store.restore(bad)).rejects.toThrow('缺失');
    expect(store.snapshot()).toEqual(before);
    expect(store.getBackgroundImage('saved-image')?.data).toEqual(gifBytes);
  });
  it('uses a complete SQLite backup, makes a safety copy, then restores state atomically', async () => {
    const dir = folder(),
      store = open(join(dir, 'mindnote.db')),
      backup = join(dir, 'saved.mindnote');
    store.dispatch(add('saved'));
    store.setWindowState('sticky', { x: 100, y: 100, width: 360, height: 560 });
    await store.backup(backup);
    store.dispatch(add('later'));
    store.dispatch({ type: 'settings.update', patch: { theme: 'dark' } });
    const revision = store.snapshot().revision;
    const safety = await store.restore(backup);
    expect(readFileSync(safety).subarray(0, 15).toString()).toBe('SQLite format 3');
    expect(store.snapshot().nodes.map((node) => node.id)).toEqual([SYSTEM_ROOT_ID, 'saved']);
    expect(store.snapshot().settings.theme).toBe('light');
    expect(store.snapshot().revision).toBe(revision + 1);
    expect(store.snapshot().canUndo).toBe(false);
    expect(store.snapshot().canRedo).toBe(false);
    const safetyStore = open(safety);
    expect(safetyStore.snapshot().nodes.some((node) => node.id === 'later')).toBe(true);
  });
  it('does not replace live data with a corrupt or non-MindNote file', async () => {
    const dir = folder(),
      store = open(join(dir, 'mindnote.db')),
      bad = join(dir, 'bad.mindnote');
    store.dispatch(add('important'));
    const before = store.snapshot();
    writeFileSync(bad, 'not a sqlite database');
    await expect(store.restore(bad)).rejects.toThrow();
    expect(store.snapshot()).toEqual(before);
    await expect(store.backup(join(dir, 'mindnote.db'))).rejects.toThrow('覆盖');
    await expect(store.restore(join(dir, 'mindnote.db'))).rejects.toThrow('独立');
  });
});

function writeV1Database(path: string, broken = false) {
  const current = applyCommand(createInitialSnapshot(), {
    type: 'batch',
    commands: [
      add('legacy-parent'),
      { ...add('legacy-child'), parentId: 'legacy-parent' },
      { type: 'node.update', id: 'legacy-child', patch: { progress: 100, notes: { other: '旧版完成记录' } } },
    ],
  });
  const legacy = {
    ...current,
    maps: current.maps.map((map) => ({ ...map, title: '我的待办', createdAt: '2026-01-02T03:04:05.000Z' })),
    nodes: current.nodes.map(
      ({ createdAt: _created, updatedAt: _updated, completedAt: _completed, ...node }) => ({
        ...node,
        title: node.id === SYSTEM_ROOT_ID ? '我的待办' : node.title,
        task: node.task ? { schedule: node.task.schedule, progress: node.task.progress } : null,
      }),
    ),
    settings: {
      theme: 'apricot',
      opacity: 0.76,
      pinned: true,
      hideCompleted: false,
      filter: 'week',
      launchAtLogin: false,
      stickyCollapsed: false,
    },
  };
  if (broken) legacy.nodes.find((node) => node.id === 'legacy-parent')!.parentId = 'legacy-child';
  const database = new Database(path);
  database.pragma('application_id = 1296977748');
  database.pragma('user_version = 1');
  database.exec(
    'CREATE TABLE app_snapshot (id INTEGER PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE window_state (key TEXT PRIMARY KEY, payload TEXT NOT NULL);',
  );
  database.prepare('INSERT INTO app_snapshot (id, payload) VALUES (1, ?)').run(JSON.stringify(legacy));
  database
    .prepare('INSERT INTO window_state (key, payload) VALUES (?, ?)')
    .run('sticky', JSON.stringify({ x: 100, y: 100, width: 360, height: 560 }));
  database.close();
  return legacy;
}

function writeV2Database(path: string) {
  const current = applyCommand(createInitialSnapshot(), {
    type: 'batch',
    commands: [
      add('v2-task'),
      { type: 'node.update', id: 'v2-task', patch: { progress: 100, notes: { problems: '升级前的备注' } } },
    ],
  });
  const { gridColumns: _columns, ...settings } = current.settings;
  const legacy = { ...current, settings: { ...settings, theme: 'dark' as const, opacity: 0.65 } };
  const database = new Database(path);
  database.pragma('application_id = 1296977748');
  database.pragma('user_version = 2');
  database.exec(
    'CREATE TABLE app_snapshot (id INTEGER PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE window_state (key TEXT PRIMARY KEY, payload TEXT NOT NULL);',
  );
  database.prepare('INSERT INTO app_snapshot (id, payload) VALUES (1, ?)').run(JSON.stringify(legacy));
  database
    .prepare('INSERT INTO window_state (key, payload) VALUES (?, ?)')
    .run('main', JSON.stringify({ x: 70, y: 90, width: 1200, height: 820 }));
  database.close();
  return legacy;
}

describe('schema 4 migration and completion history', () => {
  it('backs up schema 3 before adding the image table and restores a schema-3 backup without a dangling image', async () => {
    const dir = folder(),
      path = join(dir, 'v3.db');
    const current = applyCommand(createInitialSnapshot(), {
      type: 'settings.update',
      patch: { gridColumns: 4 },
    });
    const { backgroundImage: _image, ...settings } = current.settings;
    const legacy = { ...current, settings };
    const db = new Database(path);
    db.pragma('application_id = 1296977748');
    db.pragma('user_version = 3');
    db.exec(
      'CREATE TABLE app_snapshot (id INTEGER PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE window_state (key TEXT PRIMARY KEY, payload TEXT NOT NULL);',
    );
    db.prepare('INSERT INTO app_snapshot (id, payload) VALUES (1, ?)').run(JSON.stringify(legacy));
    db.close();
    const store = open(path);
    expect(store.snapshot().settings).toEqual({ ...settings, backgroundImage: null });
    expect(store.snapshot().nodes).toEqual(legacy.nodes);
    const old = new Database(store.migrationBackupPath!, { readonly: true });
    try {
      expect(old.pragma('user_version', { simple: true })).toBe(3);
      expect(
        JSON.parse(
          (old.prepare('SELECT payload FROM app_snapshot WHERE id = 1').get() as { payload: string }).payload,
        ),
      ).toEqual(legacy);
    } finally {
      old.close();
    }
    store.setBackgroundImage(background('new-image'));
    await store.restore(store.migrationBackupPath!);
    expect(store.snapshot().settings.backgroundImage).toBeNull();
    expect(store.getBackgroundImage('new-image')).toBeNull();
    store.close();
    expect(open(path).migrationBackupPath).toBeUndefined();
  });
  it('backs up schema 2 before adding the grid preference and preserves all task data and window bounds', () => {
    const path = join(folder(), 'v2.db');
    const legacy = writeV2Database(path);
    const store = open(path),
      migrated = store.snapshot();
    expect(migrated.nodes).toEqual(legacy.nodes);
    expect(migrated.maps).toEqual(legacy.maps);
    expect(migrated.settings).toEqual({ ...legacy.settings, gridColumns: 3 });
    expect(migrated.revision).toBe(legacy.revision + 1);
    expect(store.getWindowState('main')).toEqual({ x: 70, y: 90, width: 1200, height: 820 });
    const backup = new Database(store.migrationBackupPath!, { readonly: true });
    try {
      expect(backup.pragma('user_version', { simple: true })).toBe(2);
      expect(
        JSON.parse(
          (backup.prepare('SELECT payload FROM app_snapshot WHERE id = 1').get() as { payload: string })
            .payload,
        ),
      ).toEqual(legacy);
    } finally {
      backup.close();
    }
    store.close();
    const reopened = open(path);
    expect(reopened.snapshot()).toEqual(migrated);
    expect(reopened.migrationBackupPath).toBeUndefined();
    const current = new Database(path, { readonly: true });
    try {
      expect(current.pragma('user_version', { simple: true })).toBe(4);
    } finally {
      current.close();
    }
  });
  it('imports schema 2 backups without modifying their format or losing the current safety copy', async () => {
    const dir = folder(),
      sourcePath = join(dir, 'v2.mindnote');
    const legacy = writeV2Database(sourcePath);
    const store = open(join(dir, 'current.db'));
    store.dispatch(add('current-task'));
    store.dispatch({ type: 'settings.update', patch: { gridColumns: 1 } });
    const safety = await store.restore(sourcePath);
    expect(store.snapshot().nodes).toEqual(legacy.nodes);
    expect(store.snapshot().settings.gridColumns).toBe(3);
    expect(open(safety).snapshot().settings.gridColumns).toBe(1);
    const source = new Database(sourcePath, { readonly: true });
    try {
      expect(source.pragma('user_version', { simple: true })).toBe(2);
      expect(
        JSON.parse(
          (source.prepare('SELECT payload FROM app_snapshot WHERE id = 1').get() as { payload: string })
            .payload,
        ),
      ).toEqual(legacy);
    } finally {
      source.close();
    }
  });
  it('backs up schema 1 before transactionally migrating appearance, timestamps and displayed progress', () => {
    const path = join(folder(), 'mindnote.db');
    const legacy = writeV1Database(path);
    const store = open(path),
      migrated = store.snapshot();
    expect(migrated.nodes.map((node) => node.id)).toEqual(legacy.nodes.map((node) => node.id));
    expect(migrated.maps[0].title).toBe('草稿箱');
    expect(migrated.settings).toMatchObject({
      theme: 'light',
      opacity: 0.76,
      pinned: true,
      blur: 18,
      fontSize: 14,
      reduceMotion: false,
    });
    expect(getProgress(migrated, 'legacy-parent')).toBe(100);
    expect(migrated.nodes.find((node) => node.id === 'legacy-child')?.notes.other).toBe('旧版完成记录');
    expect(migrated.nodes.find((node) => node.id === 'legacy-parent')?.completedAt).toBe(
      '2026-01-02T03:04:05.000Z',
    );
    expect(store.migrationBackupPath).toBeTruthy();
    const backup = new Database(store.migrationBackupPath!, { readonly: true });
    try {
      expect(backup.pragma('user_version', { simple: true })).toBe(1);
      const row = backup.prepare('SELECT payload FROM app_snapshot WHERE id = 1').get() as {
        payload: string;
      };
      expect(JSON.parse(row.payload)).toEqual(legacy);
    } finally {
      backup.close();
    }
    store.close();
    const reopened = open(path);
    expect(reopened.migrationBackupPath).toBeUndefined();
    expect(reopened.snapshot()).toEqual(migrated);
  });
  it('leaves an invalid legacy database unchanged when migration validation fails', () => {
    const path = join(folder(), 'bad-legacy.db');
    const original = writeV1Database(path, true);
    expect(() => new MindNoteStore(path)).toThrow('循环');
    const database = new Database(path, { readonly: true });
    try {
      expect(database.pragma('user_version', { simple: true })).toBe(1);
      expect(
        JSON.parse(
          (database.prepare('SELECT payload FROM app_snapshot WHERE id = 1').get() as { payload: string })
            .payload,
        ),
      ).toEqual(original);
    } finally {
      database.close();
    }
  });
  it('imports schema-1 backups into the current schema without modifying the source backup', async () => {
    const dir = folder(),
      oldPath = join(dir, 'old-backup.mindnote');
    writeV1Database(oldPath);
    const store = open(join(dir, 'mindnote.db'));
    store.dispatch(add('current-work'));
    const safety = await store.restore(oldPath);
    expect(store.snapshot().nodes.some((node) => node.id === 'legacy-child')).toBe(true);
    expect(getProgress(store.snapshot(), 'legacy-parent')).toBe(100);
    const original = new Database(oldPath, { readonly: true });
    try {
      expect(original.pragma('user_version', { simple: true })).toBe(1);
    } finally {
      original.close();
    }
    expect(
      open(safety)
        .snapshot()
        .nodes.some((node) => node.id === 'current-work'),
    ).toBe(true);
  });
  it('restores exact completion timestamps with undo and redo, and resets on reopening', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime('2026-11-14T01:00:00.000Z');
    const store = open(join(folder(), 'mindnote.db'));
    store.dispatch(add('task'));
    vi.setSystemTime('2026-11-14T02:00:00.000Z');
    store.dispatch({ type: 'node.update', id: 'task', patch: { progress: 100 } });
    const completion = store.snapshot().nodes.find((node) => node.id === 'task')!.completedAt;
    expect(completion).toBe('2026-11-14T02:00:00.000Z');
    expect(
      store.dispatch({ type: 'history.undo' }).nodes.find((node) => node.id === 'task')?.completedAt,
    ).toBeNull();
    vi.setSystemTime('2026-11-14T03:00:00.000Z');
    expect(
      store.dispatch({ type: 'history.redo' }).nodes.find((node) => node.id === 'task')?.completedAt,
    ).toBe(completion);
    store.dispatch({ type: 'node.update', id: 'task', patch: { progress: 90 } });
    expect(store.snapshot().nodes.find((node) => node.id === 'task')?.completedAt).toBeNull();
    store.dispatch({ type: 'node.update', id: 'task', patch: { progress: 100 } });
    expect(store.snapshot().nodes.find((node) => node.id === 'task')?.completedAt).toBe(
      '2026-11-14T03:00:00.000Z',
    );
  });
});
