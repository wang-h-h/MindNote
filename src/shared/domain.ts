import type { AppSettings, BackgroundImage, Command, Filter, MindNode, Schedule, Snapshot } from './types';

export const SYSTEM_MAP_ID = 'system-tasks';
export const SYSTEM_ROOT_ID = 'system-tasks-root';
export interface DateRange {
  start: string;
  end: string;
}
const THEMES = ['light', 'dark'];
const FILTERS = ['inbox', 'today', 'week', 'month', 'all'];
const SETTINGS_KEYS = [
  'theme',
  'opacity',
  'pinned',
  'hideCompleted',
  'filter',
  'launchAtLogin',
  'stickyCollapsed',
  'blur',
  'fontSize',
  'reduceMotion',
  'gridColumns',
  'backgroundImage',
];
const emptyNotes = () => ({ progress: '', problems: '', other: '' });

function fail(message: string): never {
  throw new Error(message);
}
function record(value: unknown, label = '数据'): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}格式不正确`);
}
function onlyKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) fail('包含不支持的字段');
}
function validId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) fail('事项标识无效');
}
function title(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 500)
    fail('名称不能为空，且不能超过 500 字');
  return value.trim();
}
export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(year, month, 0).getDate();
}
export function validateSchedule(value: unknown): Schedule {
  record(value, '日期');
  if (value.mode === 'none' || value.mode === 'inherit') {
    onlyKeys(value, ['mode']);
    return { mode: value.mode };
  }
  if (value.mode !== 'range') fail('日期模式无效');
  onlyKeys(value, ['mode', 'start', 'end']);
  if (!isValidDate(value.start) || !isValidDate(value.end)) fail('请选择有效的起止日期');
  if (value.end < value.start) fail('结束日期不能早于开始日期');
  return { mode: 'range', start: value.start, end: value.end };
}
function validateProgress(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)
    fail('进度必须介于 0 和 100 之间');
  return value;
}
export function validateBackgroundImage(value: unknown): BackgroundImage | null {
  if (value === null) return null;
  record(value, '背景图片');
  onlyKeys(value, ['id', 'name', 'mimeType']);
  validId(value.id);
  if (
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 255 ||
    /[\u0000-\u001f]/.test(value.name)
  )
    fail('背景图片名称无效');
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(String(value.mimeType)))
    fail('背景图片格式不支持');
  return { id: value.id, name: value.name, mimeType: value.mimeType as BackgroundImage['mimeType'] };
}
function validateSettings(value: unknown, partial: boolean): Partial<AppSettings> {
  record(value, '设置');
  onlyKeys(value, SETTINGS_KEYS);
  if (!partial && SETTINGS_KEYS.some((key) => !(key in value))) fail('设置数据不完整');
  if ('theme' in value && !THEMES.includes(String(value.theme))) fail('主题无效');
  if ('filter' in value && !FILTERS.includes(String(value.filter))) fail('筛选条件无效');
  if ('gridColumns' in value && ![1, 2, 3, 4].includes(value.gridColumns as number))
    fail('宫格列数必须为 1、2、3 或 4');
  if ('backgroundImage' in value) validateBackgroundImage(value.backgroundImage);
  if (
    'opacity' in value &&
    (typeof value.opacity !== 'number' ||
      !Number.isFinite(value.opacity) ||
      value.opacity < 0.35 ||
      value.opacity > 1)
  )
    fail('透明度必须介于 35% 和 100% 之间');
  if (
    'blur' in value &&
    (typeof value.blur !== 'number' || !Number.isFinite(value.blur) || value.blur < 0 || value.blur > 36)
  )
    fail('背景模糊必须介于 0 和 36 之间');
  if (
    'fontSize' in value &&
    (typeof value.fontSize !== 'number' ||
      !Number.isFinite(value.fontSize) ||
      value.fontSize < 12 ||
      value.fontSize > 18)
  )
    fail('字号必须介于 12 和 18 之间');
  for (const key of ['pinned', 'hideCompleted', 'launchAtLogin', 'stickyCollapsed', 'reduceMotion']) {
    if (key in value && typeof value[key] !== 'boolean') fail('开关设置无效');
  }
  return { ...value } as Partial<AppSettings>;
}

export function createInitialSnapshot(): Snapshot {
  const now = new Date().toISOString();
  return {
    revision: 0,
    canUndo: false,
    canRedo: false,
    maps: [
      {
        id: SYSTEM_MAP_ID,
        rootId: SYSTEM_ROOT_ID,
        title: '草稿箱',
        system: true,
        createdAt: now,
      },
    ],
    nodes: [
      {
        id: SYSTEM_ROOT_ID,
        mapId: SYSTEM_MAP_ID,
        parentId: null,
        order: 0,
        title: '草稿箱',
        expanded: true,
        notes: emptyNotes(),
        task: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      },
    ],
    settings: {
      theme: 'light',
      opacity: 0.82,
      pinned: false,
      hideCompleted: false,
      filter: 'today',
      launchAtLogin: false,
      stickyCollapsed: false,
      blur: 18,
      fontSize: 14,
      reduceMotion: false,
      gridColumns: 3,
      backgroundImage: null,
    },
  };
}

interface Index {
  nodes: Map<string, MindNode>;
  children: Map<string, MindNode[]>;
  progress: Map<string, number>;
  leafCounts: Map<string, number>;
  dates: Map<string, DateRange | null>;
}
const indexes = new WeakMap<Snapshot, Index>();
function indexOf(state: Snapshot): Index {
  const cached = indexes.get(state);
  if (cached) return cached;
  const nodes = new Map(state.nodes.map((node) => [node.id, node]));
  const children = new Map<string, MindNode[]>();
  for (const node of state.nodes)
    if (node.parentId) {
      const list = children.get(node.parentId) || [];
      list.push(node);
      children.set(node.parentId, list);
    }
  for (const list of children.values()) list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const progress = new Map<string, number>();
  const leafCounts = new Map<string, number>();
  const sums = new Map<string, number>();
  const dates = new Map<string, DateRange | null>();
  const ordered: MindNode[] = [];
  const stack = state.nodes.filter((node) => node.parentId === null).slice();
  while (stack.length) {
    const node = stack.pop()!;
    ordered.push(node);
    const schedule = node.task?.schedule;
    dates.set(
      node.id,
      !node.task
        ? null
        : schedule?.mode === 'range'
          ? { start: schedule.start, end: schedule.end }
          : schedule?.mode === 'none'
            ? null
            : node.parentId
              ? (dates.get(node.parentId) ?? null)
              : null,
    );
    const childNodes = children.get(node.id);
    if (childNodes) stack.push(...childNodes);
  }
  for (let i = ordered.length - 1; i >= 0; i--) {
    const node = ordered[i];
    let sum = 0,
      count = 0;
    for (const child of children.get(node.id) || []) {
      sum += sums.get(child.id) || 0;
      count += leafCounts.get(child.id) || 0;
    }
    if (node.task) {
      sum += node.task.progress;
      count += 1;
    }
    sums.set(node.id, sum);
    leafCounts.set(node.id, count);
    progress.set(node.id, node.task ? node.task.progress : count ? sum / count : 0);
  }
  const result = { nodes, children, progress, leafCounts, dates };
  indexes.set(state, result);
  return result;
}
export function getChildren(state: Snapshot, id: string): MindNode[] {
  return [...(indexOf(state).children.get(id) || [])];
}
export function getDescendants(state: Snapshot, id: string): MindNode[] {
  const index = indexOf(state);
  const result: MindNode[] = [];
  const stack = [...(index.children.get(id) || [])].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    result.push(node);
    stack.push(...[...(index.children.get(node.id) || [])].reverse());
  }
  return result;
}
export function effectiveSchedule(state: Snapshot, id: string): DateRange | null {
  return indexOf(state).dates.get(id) ?? null;
}
export function getProgress(state: Snapshot, id: string): number {
  return indexOf(state).progress.get(id) ?? 0;
}
export function isTaskLeaf(state: Snapshot, id: string): boolean {
  const index = indexOf(state);
  const node = index.nodes.get(id);
  return (
    !!node?.task && !(index.children.get(id) || []).some((child) => (index.leafCounts.get(child.id) || 0) > 0)
  );
}
/** Explicitly planned tasks own their progress, regardless of their map descendants. */
export function isProgressEditable(state: Snapshot, id: string): boolean {
  return !!indexOf(state).nodes.get(id)?.task;
}
export function localDate(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function asLocalDate(value: Date | string): Date {
  if (value instanceof Date && Number.isFinite(value.getTime()))
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  if (!isValidDate(value)) fail('日期无效');
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function periodRange(filter: Filter, date: Date | string = new Date()): DateRange | null {
  const start = asLocalDate(date),
    end = asLocalDate(date);
  if (filter === 'all' || filter === 'inbox') return null;
  if (filter === 'week') {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 6);
  } else if (filter === 'month') {
    start.setDate(1);
    end.setMonth(end.getMonth() + 1, 0);
  } else if (filter !== 'today') fail('筛选条件无效');
  return { start: localDate(start), end: localDate(end) };
}
export function dateStatus(
  state: Snapshot,
  id: string,
  today: string = localDate(),
): 'none' | 'upcoming' | 'today' | 'overdue' | 'done' {
  if (getProgress(state, id) >= 100 && indexOf(state).nodes.get(id)?.task) return 'done';
  const range = effectiveSchedule(state, id);
  if (!range) return 'none';
  return range.end < today ? 'overdue' : range.end === today ? 'today' : 'upcoming';
}

/** A completed dated task remains in its original plan and its local completion
 * period. This lets overdue carry-over tasks finish without vanishing instantly,
 * while avoiding an ever-growing completed backlog in subsequent periods. */
export function isNodeInPlanRange(
  state: Snapshot,
  id: string,
  range: DateRange,
  today: string = localDate(),
  includeOverdue = true,
): boolean {
  const node = indexOf(state).nodes.get(id);
  if (!node?.task?.planned) return false;
  const done = getProgress(state, id) >= 100;
  if (done && state.settings.hideCompleted) return false;
  const schedule = effectiveSchedule(state, id);
  if (!schedule) return false;
  if (schedule.start <= range.end && schedule.end >= range.start) return true;
  if (!done) return includeOverdue && schedule.end < today;
  if (!node.completedAt) return false;
  const completed = new Date(node.completedAt);
  if (!Number.isFinite(completed.getTime())) return false;
  const completedDay = localDate(completed);
  return completedDay >= range.start && completedDay <= range.end;
}

export function selectVisibleNodes(
  state: Snapshot,
  filter: Filter,
  today: string = localDate(),
  mapId?: string,
): { nodes: MindNode[]; matchedIds: Set<string> } {
  const index = indexOf(state);
  const range = periodRange(filter, today);
  const matchedIds = new Set<string>();
  const visible = new Set<string>();
  for (const node of state.nodes) {
    if (
      !node.task?.planned ||
      (mapId && node.mapId !== mapId) ||
      (state.settings.hideCompleted && getProgress(state, node.id) >= 100)
    )
      continue;
    const schedule = effectiveSchedule(state, node.id);
    const matches =
      filter === 'all' ||
      (filter === 'inbox' ? !schedule : !!range && isNodeInPlanRange(state, node.id, range, today));
    if (!matches) continue;
    matchedIds.add(node.id);
    let current: MindNode | undefined = node;
    while (current && !visible.has(current.id)) {
      visible.add(current.id);
      current = current.parentId ? index.nodes.get(current.parentId) : undefined;
    }
  }
  const result: MindNode[] = [];
  for (const map of state.maps) {
    if (mapId && map.id !== mapId) continue;
    const root = index.nodes.get(map.rootId);
    if (!root) continue;
    const stack = [root];
    while (stack.length) {
      const node = stack.pop()!;
      if (!visible.has(node.id)) continue;
      result.push(node);
      stack.push(...[...(index.children.get(node.id) || [])].reverse());
    }
  }
  return { nodes: result, matchedIds };
}

/** A plan is a flat projection of explicitly selected nodes; ancestry never implies membership. */
export function selectPlanNodes(
  state: Snapshot,
  filter: Filter,
  today: string = localDate(),
  mapId?: string,
): MindNode[] {
  const range = periodRange(filter, today);
  return state.nodes
    .filter((node) => {
      if (!node.task?.planned || (mapId && node.mapId !== mapId)) return false;
      const done = getProgress(state, node.id) >= 100;
      if (state.settings.hideCompleted && done) return false;
      const schedule = effectiveSchedule(state, node.id);
      if (filter === 'all') return true;
      if (filter === 'inbox') return !schedule;
      return !!range && isNodeInPlanRange(state, node.id, range, today);
    })
    .sort((a, b) => {
      const aDone = getProgress(state, a.id) >= 100,
        bDone = getProgress(state, b.id) >= 100;
      if (aDone !== bDone) return aDone ? 1 : -1;
      if (aDone) {
        const recent = (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt);
        if (recent) return recent;
      } else {
        const due = (effectiveSchedule(state, a.id)?.end ?? '9999-12-31').localeCompare(
          effectiveSchedule(state, b.id)?.end ?? '9999-12-31',
        );
        if (due) return due;
      }
      return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
    });
}

function findNode(state: Snapshot, id: unknown): MindNode {
  validId(id);
  return state.nodes.find((node) => node.id === id) || fail('该事项已不存在，请刷新后重试');
}
function findMap(state: Snapshot, id: unknown) {
  validId(id);
  return state.maps.find((map) => map.id === id) || fail('该导图已不存在');
}
function uniqueId(state: Snapshot, id: unknown) {
  validId(id);
  if (state.nodes.some((node) => node.id === id) || state.maps.some((map) => map.id === id))
    fail('标识已存在');
}
function normalizeOrders(state: Snapshot, parentId: string) {
  indexes.delete(state);
  getChildren(state, parentId).forEach((node, order) => {
    node.order = order;
  });
  indexes.delete(state);
}
function mutate(state: Snapshot, command: Command, depth = 0, now = new Date().toISOString()): void {
  record(command, '操作');
  indexes.delete(state);
  if (depth > 20) fail('操作嵌套过深');
  switch (command.type) {
    case 'batch': {
      onlyKeys(command, ['type', 'commands']);
      if (!Array.isArray(command.commands) || command.commands.length > 10000) fail('批量操作无效');
      for (const child of command.commands) {
        if (child?.type === 'settings.update' || child?.type?.startsWith('history.'))
          fail('批量操作不支持设置或历史记录');
        mutate(state, child, depth + 1, now);
      }
      break;
    }
    case 'map.create': {
      onlyKeys(command, ['type', 'id', 'rootId', 'title']);
      uniqueId(state, command.id);
      uniqueId(state, command.rootId);
      if (command.id === command.rootId) fail('导图与根节点标识不能相同');
      const name = title(command.title);
      state.maps.push({
        id: command.id,
        rootId: command.rootId,
        title: name,
        system: false,
        createdAt: now,
      });
      state.nodes.push({
        id: command.rootId,
        mapId: command.id,
        parentId: null,
        order: 0,
        title: name,
        expanded: true,
        notes: emptyNotes(),
        task: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      });
      break;
    }
    case 'map.rename': {
      onlyKeys(command, ['type', 'id', 'title']);
      const map = findMap(state, command.id);
      if (map.system) fail('系统导图不能重命名');
      map.title = title(command.title);
      findNode(state, map.rootId).title = map.title;
      break;
    }
    case 'map.delete': {
      onlyKeys(command, ['type', 'id']);
      const map = findMap(state, command.id);
      if (map.system) fail('系统导图不能删除');
      state.maps = state.maps.filter((item) => item.id !== map.id);
      state.nodes = state.nodes.filter((node) => node.mapId !== map.id);
      break;
    }
    case 'node.create': {
      onlyKeys(command, ['type', 'id', 'mapId', 'parentId', 'title', 'task', 'schedule']);
      uniqueId(state, command.id);
      const map = findMap(state, command.mapId),
        parent = findNode(state, command.parentId);
      if (parent.mapId !== map.id) fail('子事项必须与父事项属于同一张导图');
      if (command.task !== undefined && typeof command.task !== 'boolean') fail('任务属性无效');
      const task = !!(map.system || command.task);
      const schedule =
        command.schedule === undefined
          ? task && parent.task
            ? { mode: 'inherit' as const }
            : { mode: 'none' as const }
          : validateSchedule(command.schedule);
      if (!task && command.schedule !== undefined) fail('普通节点不能设置任务日期');
      state.nodes.push({
        id: command.id,
        mapId: map.id,
        parentId: parent.id,
        order: getChildren(state, parent.id).length,
        title: title(command.title),
        expanded: true,
        notes: emptyNotes(),
        task: task ? { schedule, progress: 0, planned: true } : null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      });
      parent.expanded = true;
      break;
    }
    case 'node.update': {
      onlyKeys(command, ['type', 'id', 'patch']);
      const node = findNode(state, command.id);
      record(command.patch, '修改');
      onlyKeys(command.patch, ['title', 'notes', 'progress', 'schedule', 'expanded', 'direction', 'planned']);
      const patch = command.patch;
      if (patch.title !== undefined) {
        const name = title(patch.title);
        const map = findMap(state, node.mapId);
        if (map.system && node.id === map.rootId) fail('系统导图不能重命名');
        node.title = name;
        if (node.id === map.rootId) map.title = name;
      }
      if (patch.notes !== undefined) {
        record(patch.notes, '备注');
        onlyKeys(patch.notes, ['progress', 'problems', 'other']);
        for (const [key, value] of Object.entries(patch.notes)) {
          if (typeof value !== 'string' || value.length > 200000) fail('备注不能超过 200,000 字');
          node.notes[key as keyof typeof node.notes] = value;
        }
      }
      if (patch.progress !== undefined) {
        if (!isProgressEditable(state, node.id)) fail('请先将节点加入计划');
        node.task!.progress = validateProgress(patch.progress);
      }
      if (patch.schedule !== undefined) {
        if (!node.task) fail('请先将节点加入计划');
        node.task.schedule = validateSchedule(patch.schedule);
      }
      if (patch.expanded !== undefined) {
        if (typeof patch.expanded !== 'boolean') fail('展开状态无效');
        node.expanded = patch.expanded;
      }
      if (patch.direction !== undefined) {
        if (patch.direction !== 0 && patch.direction !== 1) fail('布局方向无效');
        node.direction = patch.direction;
      }
      if (patch.planned !== undefined) {
        if (!node.task || typeof patch.planned !== 'boolean') fail('计划关联状态无效');
        node.task.planned = patch.planned;
      }
      break;
    }
    case 'node.move': {
      onlyKeys(command, ['type', 'id', 'parentId', 'index']);
      const node = findNode(state, command.id),
        parent = findNode(state, command.parentId);
      if (!node.parentId) fail('根节点不能移动');
      if (node.mapId !== parent.mapId) fail('暂不支持跨导图移动节点');
      if (node.id === parent.id || getDescendants(state, node.id).some((item) => item.id === parent.id))
        fail('不能将事项移动到自身或其子事项之下');
      const oldParentId = node.parentId;
      const siblings = getChildren(state, parent.id).filter((item) => item.id !== node.id);
      const position = command.index === undefined ? siblings.length : command.index;
      if (!Number.isInteger(position) || position < 0 || position > siblings.length) fail('排序位置无效');
      node.parentId = parent.id;
      parent.expanded = true;
      siblings.splice(position, 0, node);
      siblings.forEach((item, order) => {
        item.order = order;
      });
      if (oldParentId !== parent.id) normalizeOrders(state, oldParentId);
      break;
    }
    case 'node.delete': {
      onlyKeys(command, ['type', 'id']);
      const node = findNode(state, command.id);
      if (!node.parentId) fail('请通过导图列表删除整张导图');
      const ids = new Set([node.id, ...getDescendants(state, node.id).map((item) => item.id)]);
      state.nodes = state.nodes.filter((item) => !ids.has(item.id));
      normalizeOrders(state, node.parentId);
      break;
    }
    case 'node.convert': {
      onlyKeys(command, ['type', 'id', 'start', 'end']);
      const node = findNode(state, command.id);
      if (node.id === SYSTEM_ROOT_ID) fail('系统根节点仅用作容器');
      const schedule = validateSchedule({ mode: 'range', start: command.start, end: command.end });
      if (!node.task) node.task = { progress: 0, schedule, planned: true };
      node.task!.schedule = schedule;
      node.task!.planned = true;
      break;
    }
    case 'settings.update': {
      onlyKeys(command, ['type', 'patch']);
      Object.assign(state.settings, validateSettings(command.patch, true));
      break;
    }
    case 'history.undo':
    case 'history.redo':
      fail('请通过数据服务撤销或重做');
    default:
      fail('不支持的操作');
  }
  indexes.delete(state);
}

export function applyCommand(state: Snapshot, command: Command): Snapshot {
  const next = structuredClone(state);
  const now = new Date().toISOString();
  mutate(next, command, 0, now);
  const previous = new Map(state.nodes.map((node) => [node.id, node]));
  for (const node of next.nodes) {
    const before = previous.get(node.id);
    if (!before || JSON.stringify(node) !== JSON.stringify(before)) node.updatedAt = now;
    if (node.task && node.task.progress >= 100) {
      node.completedAt = before?.task && before.task.progress >= 100 ? (before.completedAt ?? now) : now;
    } else node.completedAt = null;
  }
  next.revision = state.revision + 1;
  return next;
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

/** Upgrade schema-1 payloads without changing any map/node identity or user text. */
export function migrateSnapshotV1(value: unknown): Snapshot {
  record(value, '数据库');
  if (!Array.isArray(value.maps) || !Array.isArray(value.nodes)) fail('数据库结构无效');
  const migrated = structuredClone(value) as unknown as Snapshot;
  record(migrated.settings, '设置');
  if (!['blue', 'mint', 'lavender', 'apricot'].includes(String(migrated.settings.theme)))
    fail('旧版主题数据无效');
  migrated.settings = {
    ...migrated.settings,
    theme: 'light',
    blur: 18,
    fontSize: 14,
    reduceMotion: false,
    gridColumns: 3,
    backgroundImage: null,
  };
  const mapDates = new Map<string, string>();
  for (const map of migrated.maps) {
    record(map);
    if (typeof map.createdAt !== 'string' || !Number.isFinite(Date.parse(map.createdAt)))
      fail('旧版导图时间无效');
    mapDates.set(map.id, new Date(map.createdAt).toISOString());
    if (map.id === SYSTEM_MAP_ID) map.title = '草稿箱';
  }
  for (const node of migrated.nodes) {
    record(node);
    const fallback = mapDates.get(node.mapId);
    if (!fallback) fail('旧版节点所属导图无效');
    node.createdAt = isTimestamp(node.createdAt) ? node.createdAt : fallback;
    node.updatedAt = isTimestamp(node.updatedAt) ? node.updatedAt : node.createdAt;
    if (node.id === SYSTEM_ROOT_ID) node.title = '草稿箱';
    if (node.task) {
      record(node.task);
      node.task.planned = true;
    }
    node.completedAt =
      node.task && node.task.progress >= 100
        ? isTimestamp(node.completedAt)
          ? node.completedAt
          : node.updatedAt
        : null;
  }
  const valid = validateSnapshot(migrated);
  // Schema 1 displayed parents as the mean of task leaves. Freeze that visible value
  // before enabling independent progress, so migration does not reopen completed work.
  const children = new Map<string, MindNode[]>();
  for (const node of valid.nodes)
    if (node.parentId) {
      const list = children.get(node.parentId) ?? [];
      list.push(node);
      children.set(node.parentId, list);
    }
  const order: MindNode[] = [],
    pending = valid.nodes.filter((node) => !node.parentId);
  while (pending.length) {
    const node = pending.pop()!;
    order.push(node);
    pending.push(...(children.get(node.id) ?? []));
  }
  const totals = new Map<string, { sum: number; count: number }>();
  for (let i = order.length - 1; i >= 0; i--) {
    const node = order[i];
    let sum = 0,
      count = 0;
    for (const child of children.get(node.id) ?? []) {
      const total = totals.get(child.id)!;
      sum += total.sum;
      count += total.count;
    }
    if (!count && node.task) {
      sum = node.task.progress;
      count = 1;
    }
    totals.set(node.id, { sum, count });
    if (node.task) {
      node.task.progress = count ? sum / count : node.task.progress;
      node.completedAt = node.task.progress >= 100 ? (node.completedAt ?? node.updatedAt) : null;
    }
  }
  return validateSnapshot(valid);
}

/** Schema 2 adds only the grid preference; existing business data stays exact. */
export function migrateSnapshotV2(value: unknown): Snapshot {
  record(value, '数据库');
  record(value.settings, '设置');
  return validateSnapshot({
    ...structuredClone(value),
    settings: { gridColumns: 3, backgroundImage: null, ...structuredClone(value.settings) },
  });
}

/** Schema 3 has no image asset; all prior settings and node history stay exact. */
export function migrateSnapshotV3(value: unknown): Snapshot {
  record(value, '数据库');
  record(value.settings, '设置');
  return validateSnapshot({
    ...structuredClone(value),
    settings: { backgroundImage: null, ...structuredClone(value.settings) },
  });
}

/** Strict validation is used for SQLite startup and backups before any replacement. */
export function validateSnapshot(value: unknown): Snapshot {
  record(value, '数据库');
  if (
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !Array.isArray(value.maps) ||
    !Array.isArray(value.nodes)
  )
    fail('数据库结构无效');
  if (value.maps.length > 10000 || value.nodes.length > 100000) fail('数据库节点数量超出支持范围');
  validateSettings(value.settings, false);
  const state = value as unknown as Snapshot;
  const ids = new Set<string>();
  const mapIds = new Set<string>();
  for (const map of state.maps) {
    record(map);
    validId(map.id);
    validId(map.rootId);
    title(map.title);
    if (
      typeof map.system !== 'boolean' ||
      typeof map.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(map.createdAt))
    )
      fail('导图数据无效');
    if (mapIds.has(map.id)) fail('导图标识重复');
    mapIds.add(map.id);
  }
  const systems = state.maps.filter((map) => map.system);
  if (systems.length !== 1 || systems[0].id !== SYSTEM_MAP_ID || systems[0].rootId !== SYSTEM_ROOT_ID)
    fail('缺少系统待办导图');
  for (const node of state.nodes) {
    record(node);
    validId(node.id);
    validId(node.mapId);
    title(node.title);
    if (ids.has(node.id) || mapIds.has(node.id)) fail('节点标识重复');
    ids.add(node.id);
    if (
      !mapIds.has(node.mapId) ||
      !Number.isInteger(node.order) ||
      node.order < 0 ||
      typeof node.expanded !== 'boolean'
    )
      fail('节点数据无效');
    if (node.parentId !== null) validId(node.parentId);
    if (node.direction !== undefined && node.direction !== 0 && node.direction !== 1) fail('节点方向无效');
    if (
      !isTimestamp(node.createdAt) ||
      !isTimestamp(node.updatedAt) ||
      (node.completedAt !== null && !isTimestamp(node.completedAt))
    )
      fail('节点时间数据无效');
    record(node.notes, '备注');
    onlyKeys(node.notes, ['progress', 'problems', 'other']);
    for (const key of ['progress', 'problems', 'other'] as const)
      if (typeof node.notes[key] !== 'string' || node.notes[key].length > 200000) fail('备注数据无效');
    if (node.task !== null) {
      record(node.task, '任务');
      validateSchedule(node.task.schedule);
      validateProgress(node.task.progress);
      if (typeof node.task.planned !== 'boolean') fail('计划关联状态无效');
    }
    if ((!!node.task && node.task.progress >= 100) !== (node.completedAt !== null))
      fail('完成状态与完成时间不一致');
    if (node.mapId === SYSTEM_MAP_ID && node.id !== SYSTEM_ROOT_ID && !node.task)
      fail('待办导图内存在非任务节点');
    if (node.id === SYSTEM_ROOT_ID && node.task) fail('系统根节点不能作为任务');
  }
  const byId = new Map(state.nodes.map((node) => [node.id, node]));
  const rootIds = new Set(state.maps.map((map) => map.rootId));
  for (const map of state.maps) {
    const root = byId.get(map.rootId);
    if (!root || root.mapId !== map.id || root.parentId !== null || root.title !== map.title)
      fail('导图根节点无效');
  }
  for (const node of state.nodes) {
    if (node.parentId === null) {
      if (!rootIds.has(node.id)) fail('存在未关联根节点');
    } else {
      const parent = byId.get(node.parentId);
      if (!parent || parent.mapId !== node.mapId || parent.id === node.id) fail('父子关系无效');
    }
  }
  // Detect cycles without relying on recursion, including disconnected cycles.
  const visited = new Set<string>();
  for (const node of state.nodes) {
    let current: MindNode | undefined = node;
    const path = new Set<string>();
    while (current && !visited.has(current.id)) {
      if (path.has(current.id)) fail('节点层级存在循环');
      path.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    for (const id of path) visited.add(id);
  }
  return { ...structuredClone(state), canUndo: false, canRedo: false };
}
