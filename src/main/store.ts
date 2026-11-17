import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  applyCommand,
  createInitialSnapshot,
  migrateSnapshotV1,
  migrateSnapshotV2,
  migrateSnapshotV3,
  validateBackgroundImage,
  validateSnapshot,
} from '../shared/domain';
import type { BackgroundImage, Command, MindMap, MindNode, Snapshot, WindowState } from '../shared/types';

const APPLICATION_ID = 0x4d4e4f54;
const SCHEMA_VERSION = 4;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const CREATE_ASSETS =
  'CREATE TABLE background_assets (id TEXT PRIMARY KEY, name TEXT NOT NULL, mime_type TEXT NOT NULL, data BLOB NOT NULL)';
interface AssetRow {
  id: string;
  name: string;
  mime_type: BackgroundImage['mimeType'];
  data: Buffer;
}
interface HistoryEntry {
  maps: MindMap[];
  nodes: MindNode[];
}
interface SnapshotRow {
  payload: string;
}
interface WindowRow {
  key: string;
  payload: string;
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32'
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
    : resolve(a) === resolve(b);
}
function validWindowState(value: unknown): value is WindowState {
  if (!value || typeof value !== 'object') return false;
  const bounds = value as WindowState;
  return (
    ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(bounds[key as keyof WindowState])) &&
    bounds.width >= 100 &&
    bounds.width <= 20000 &&
    bounds.height >= 40 &&
    bounds.height <= 20000
  );
}
function verifyHeader(db: Database.Database): number {
  if (db.pragma('application_id', { simple: true }) !== APPLICATION_ID)
    throw new Error('这不是 MindNote 数据库备份');
  const version = db.pragma('user_version', { simple: true });
  if (version !== 1 && version !== 2 && version !== 3 && version !== SCHEMA_VERSION)
    throw new Error('备份格式版本不兼容，请使用对应版本的 MindNote');
  if (db.pragma('quick_check', { simple: true }) !== 'ok')
    throw new Error('数据库完整性检查失败，未更改现有数据');
  return version as number;
}
function readSnapshot(db: Database.Database, version = SCHEMA_VERSION): Snapshot {
  const row = db.prepare('SELECT payload FROM app_snapshot WHERE id = 1').get() as SnapshotRow | undefined;
  if (!row) throw new Error('数据库缺少事项数据');
  const payload: unknown = JSON.parse(row.payload);
  return version === 1
    ? migrateSnapshotV1(payload)
    : version === 2
      ? migrateSnapshotV2(payload)
      : version === 3
        ? migrateSnapshotV3(payload)
        : validateSnapshot(payload);
}

function validateAsset(row: AssetRow): void {
  validateBackgroundImage({ id: row.id, name: row.name, mimeType: row.mime_type });
  const data = row.data;
  if (!Buffer.isBuffer(data) || !data.length || data.length > MAX_IMAGE_BYTES)
    throw new Error('背景图片必须为不超过 20 MB 的图片文件');
  const kind = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? 'image/png'
    : data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255
      ? 'image/jpeg'
      : ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii'))
        ? 'image/gif'
        : data.subarray(0, 4).toString('ascii') === 'RIFF' &&
            data.subarray(8, 12).toString('ascii') === 'WEBP'
          ? 'image/webp'
          : null;
  if (kind !== row.mime_type) throw new Error('背景图片内容与格式不匹配');
}
function assertImageReference(db: Database.Database, image: BackgroundImage | null): void {
  if (!image) return;
  const row = db
    .prepare('SELECT id, name, mime_type, data FROM background_assets WHERE id = ?')
    .get(image.id) as AssetRow | undefined;
  if (!row || row.name !== image.name || row.mime_type !== image.mimeType)
    throw new Error('背景图片资源缺失或与设置不一致');
  validateAsset(row);
}

/** The main process owns this connection; renderers only submit narrow commands. */
export class MindNoteStore {
  private db: Database.Database;
  private current: Snapshot;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private restoring = false;
  private closed = false;
  readonly path: string;
  readonly migrationBackupPath?: string;

  constructor(path: string) {
    this.path = resolve(path);
    mkdirSync(dirname(this.path), { recursive: true });
    this.db = new Database(this.path);
    try {
      this.db.pragma('busy_timeout = 5000');
      const applicationId = this.db.pragma('application_id', { simple: true });
      const tables = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all();
      if (applicationId === 0 && !tables.length) {
        this.db.transaction(() => {
          this.db.exec(
            'CREATE TABLE app_snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL); CREATE TABLE window_state (key TEXT PRIMARY KEY, payload TEXT NOT NULL);',
          );
          this.db.exec(CREATE_ASSETS);
          this.db.pragma(`application_id = ${APPLICATION_ID}`);
          this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
          this.db
            .prepare('INSERT INTO app_snapshot (id, payload) VALUES (1, ?)')
            .run(JSON.stringify(createInitialSnapshot()));
        })();
      }
      const version = verifyHeader(this.db);
      const loaded = readSnapshot(this.db, version);
      if (version < SCHEMA_VERSION) {
        if (loaded.settings.backgroundImage !== null) throw new Error('旧版数据库包含不支持的背景资源');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupDirectory = resolve(dirname(this.path), 'backups');
        mkdirSync(backupDirectory, { recursive: true });
        const backupPath = resolve(
          backupDirectory,
          `before-upgrade-v${SCHEMA_VERSION}-${stamp}-${Math.random().toString(16).slice(2, 8)}.mindnote`,
        );
        // VACUUM INTO is SQLite's synchronous, consistent copy and includes committed WAL data.
        // Never copy a live .db file with the filesystem while a WAL might contain edits.
        this.db.prepare('VACUUM INTO ?').run(backupPath);
        loaded.revision += 1;
        this.db.transaction(() => {
          this.db.exec(CREATE_ASSETS);
          this.db.prepare('UPDATE app_snapshot SET payload = ? WHERE id = 1').run(JSON.stringify(loaded));
          this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
        })();
        this.migrationBackupPath = backupPath;
      }
      assertImageReference(this.db, loaded.settings.backgroundImage);
      this.current = loaded;
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = FULL');
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('数据库已经关闭');
  }
  private assertWritable(): void {
    this.assertOpen();
    if (this.restoring) throw new Error('正在恢复备份，请稍后重试');
  }
  private persist(next: Snapshot): void {
    if (
      JSON.stringify(next.settings.backgroundImage) !== JSON.stringify(this.current.settings.backgroundImage)
    )
      assertImageReference(this.db, next.settings.backgroundImage);
    const payload = JSON.stringify({ ...next, canUndo: false, canRedo: false });
    this.db.transaction(() => {
      this.db.prepare('UPDATE app_snapshot SET payload = ? WHERE id = 1').run(payload);
    })();
  }
  private historyEntry(): HistoryEntry {
    return structuredClone({ maps: this.current.maps, nodes: this.current.nodes });
  }
  snapshot(): Snapshot {
    this.assertOpen();
    return structuredClone({
      ...this.current,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    });
  }
  /** Store image bytes only once, in the same transaction as their active reference. */
  setBackgroundImage(image: BackgroundImage & { data: Buffer }): Snapshot {
    this.assertWritable();
    const metadata = validateBackgroundImage({ id: image.id, name: image.name, mimeType: image.mimeType })!;
    validateAsset({ id: image.id, name: image.name, mime_type: image.mimeType, data: image.data });
    const next = applyCommand(this.current, {
      type: 'settings.update',
      patch: { backgroundImage: metadata },
    });
    this.db.transaction(() => {
      // IDs are immutable. Retain previous assets for in-flight protocol requests.
      this.db
        .prepare('INSERT INTO background_assets (id, name, mime_type, data) VALUES (?, ?, ?, ?)')
        .run(metadata.id, metadata.name, metadata.mimeType, image.data);
      this.db
        .prepare('UPDATE app_snapshot SET payload = ? WHERE id = 1')
        .run(JSON.stringify({ ...next, canUndo: false, canRedo: false }));
    })();
    this.current = next;
    return this.snapshot();
  }
  getBackgroundImage(id: string): { mimeType: BackgroundImage['mimeType']; data: Buffer } | null {
    this.assertOpen();
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id))
      throw new Error('背景图片标识无效');
    const row = this.db
      .prepare('SELECT id, name, mime_type, data FROM background_assets WHERE id = ?')
      .get(id) as AssetRow | undefined;
    if (!row) return null;
    validateAsset(row);
    return { mimeType: row.mime_type, data: Buffer.from(row.data) };
  }
  dispatch(command: Command): Snapshot {
    this.assertWritable();
    if (!command || typeof command !== 'object' || typeof command.type !== 'string')
      throw new Error('操作格式无效');
    if (command.type === 'history.undo' || command.type === 'history.redo') {
      if (Object.keys(command).some((key) => key !== 'type')) throw new Error('历史操作格式无效');
      const source = command.type === 'history.undo' ? this.undoStack : this.redoStack;
      const target = command.type === 'history.undo' ? this.redoStack : this.undoStack;
      const entry = source.at(-1);
      if (!entry) return this.snapshot();
      const next: Snapshot = {
        ...this.current,
        ...structuredClone(entry),
        revision: this.current.revision + 1,
        canUndo: false,
        canRedo: false,
      };
      this.persist(next);
      target.push(this.historyEntry());
      source.pop();
      this.current = next;
      return this.snapshot();
    }
    const next = applyCommand(this.current, command);
    this.persist(next);
    if (command.type !== 'settings.update') {
      this.undoStack.push(this.historyEntry());
      if (this.undoStack.length > 100) this.undoStack.shift();
      this.redoStack = [];
    }
    this.current = next;
    return this.snapshot();
  }
  getWindowState(key: string): WindowState | null {
    this.assertOpen();
    if (key !== 'main' && key !== 'sticky') throw new Error('窗口标识无效');
    const row = this.db.prepare('SELECT payload FROM window_state WHERE key = ?').get(key) as
      SnapshotRow | undefined;
    if (!row) return null;
    try {
      const value: unknown = JSON.parse(row.payload);
      return validWindowState(value) ? value : null;
    } catch {
      return null;
    }
  }
  setWindowState(key: string, value: WindowState): void {
    this.assertWritable();
    if (key !== 'main' && key !== 'sticky') throw new Error('窗口标识无效');
    if (!validWindowState(value)) throw new Error('窗口尺寸无效');
    this.db
      .prepare(
        'INSERT INTO window_state (key, payload) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET payload = excluded.payload',
      )
      .run(key, JSON.stringify(value));
  }
  async backup(path: string): Promise<void> {
    this.assertOpen();
    if (samePath(path, this.path)) throw new Error('备份不能覆盖正在使用的数据库');
    mkdirSync(dirname(resolve(path)), { recursive: true });
    await this.db.backup(resolve(path));
  }
  async restore(path: string): Promise<string> {
    this.assertWritable();
    if (samePath(path, this.path)) throw new Error('请选择独立的备份文件');
    if (!existsSync(path)) throw new Error('备份文件不存在');
    let incoming: Snapshot;
    let windows: WindowRow[];
    let assets: AssetRow[];
    const source = new Database(resolve(path), { readonly: true, fileMustExist: true });
    try {
      const version = verifyHeader(source);
      incoming = readSnapshot(source, version);
      assets =
        version >= 4
          ? (source.prepare('SELECT id, name, mime_type, data FROM background_assets').all() as AssetRow[])
          : [];
      for (const asset of assets) validateAsset(asset);
      if (incoming.settings.backgroundImage) assertImageReference(source, incoming.settings.backgroundImage);
      windows = source.prepare('SELECT key, payload FROM window_state').all() as WindowRow[];
      for (const row of windows) {
        if (!['main', 'sticky'].includes(row.key) || !validWindowState(JSON.parse(row.payload)))
          throw new Error('备份中的窗口状态无效');
      }
    } finally {
      source.close();
    }
    this.restoring = true;
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safetyPath = resolve(
        dirname(this.path),
        'backups',
        `before-restore-${stamp}-${Math.random().toString(16).slice(2, 8)}.mindnote`,
      );
      await this.backup(safetyPath);
      const next: Snapshot = {
        ...incoming,
        revision: this.current.revision + 1,
        canUndo: false,
        canRedo: false,
      };
      this.db.transaction(() => {
        this.db.prepare('UPDATE app_snapshot SET payload = ? WHERE id = 1').run(JSON.stringify(next));
        this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
        this.db.prepare('DELETE FROM window_state').run();
        const insertWindow = this.db.prepare('INSERT INTO window_state (key, payload) VALUES (?, ?)');
        for (const row of windows) insertWindow.run(row.key, row.payload);
        this.db.prepare('DELETE FROM background_assets').run();
        const insertAsset = this.db.prepare(
          'INSERT INTO background_assets (id, name, mime_type, data) VALUES (?, ?, ?, ?)',
        );
        for (const asset of assets) insertAsset.run(asset.id, asset.name, asset.mime_type, asset.data);
      })();
      this.current = next;
      this.undoStack = [];
      this.redoStack = [];
      return safetyPath;
    } finally {
      this.restoring = false;
    }
  }
  close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }
}
