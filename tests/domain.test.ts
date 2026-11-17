import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyCommand,
  createInitialSnapshot,
  dateStatus,
  effectiveSchedule,
  getDescendants,
  getProgress,
  isTaskLeaf,
  isProgressEditable,
  isNodeInPlanRange,
  localDate,
  periodRange,
  selectVisibleNodes,
  selectPlanNodes,
  migrateSnapshotV1,
  migrateSnapshotV2,
  migrateSnapshotV3,
  SYSTEM_MAP_ID,
  SYSTEM_ROOT_ID,
  validateSnapshot,
} from '../src/shared/domain';
import type { Command, Snapshot } from '../src/shared/types';

const add = (
  id: string,
  parentId = SYSTEM_ROOT_ID,
  extras: Partial<Extract<Command, { type: 'node.create' }>> = {},
): Command => ({ type: 'node.create', id, parentId, mapId: SYSTEM_MAP_ID, title: id, ...extras });
const run = (commands: Command[], initial = createInitialSnapshot()): Snapshot =>
  commands.reduce(applyCommand, initial);
afterEach(() => vi.useRealTimers());

describe('one canonical tree for maps and tasks', () => {
  it('validates background metadata without permitting file paths, scripts or inline image payloads', () => {
    const initial = createInitialSnapshot();
    expect(initial.settings.backgroundImage).toBeNull();
    const image = { id: 'background-01', name: '雨景.gif', mimeType: 'image/gif' as const };
    const next = applyCommand(initial, { type: 'settings.update', patch: { backgroundImage: image } });
    expect(next.settings.backgroundImage).toEqual(image);
    expect(
      applyCommand(next, { type: 'settings.update', patch: { backgroundImage: null } }).settings
        .backgroundImage,
    ).toBeNull();
    for (const invalid of [
      { ...image, id: '../secret' },
      { ...image, mimeType: 'text/html' },
      { ...image, name: '' },
      { ...image, data: 'base64' },
      { ...image, url: 'file:///private' },
    ]) {
      expect(() =>
        applyCommand(initial, {
          type: 'settings.update',
          patch: { backgroundImage: invalid },
        } as unknown as Command),
      ).toThrow();
    }
  });
  it('upgrades schema 3 with no image while retaining grid layout and exact task data', () => {
    const current = run([add('task'), { type: 'settings.update', patch: { gridColumns: 4 } }]);
    const { backgroundImage: _image, ...oldSettings } = current.settings;
    const legacy = { ...current, settings: oldSettings };
    const migrated = migrateSnapshotV3(legacy);
    expect(migrated.settings).toEqual({ ...oldSettings, backgroundImage: null });
    expect(migrated.nodes).toEqual(current.nodes);
    expect(migrated.revision).toBe(current.revision);
    expect(legacy.settings).not.toHaveProperty('backgroundImage');
  });
  it('defaults grid columns to three and accepts only the four explicit layouts', () => {
    const initial = createInitialSnapshot();
    expect(initial.settings.gridColumns).toBe(3);
    for (const gridColumns of [1, 2, 3, 4] as const) {
      const next = applyCommand(initial, { type: 'settings.update', patch: { gridColumns } });
      expect(next.settings.gridColumns).toBe(gridColumns);
      expect(next.nodes).toEqual(initial.nodes);
    }
    for (const gridColumns of [0, 5, 2.5, NaN, '3', null]) {
      expect(() =>
        applyCommand(initial, {
          type: 'settings.update',
          patch: { gridColumns },
        } as unknown as Command),
      ).toThrow('宫格列数');
    }
  });
  it('migrates schema 2 appearance without altering task IDs, progress or completion history', () => {
    const current = run([
      add('task'),
      {
        type: 'node.update',
        id: 'task',
        patch: { progress: 100, notes: { other: '保留复盘' } },
      },
      { type: 'settings.update', patch: { theme: 'dark', blur: 23, opacity: 0.64 } },
    ]);
    const { gridColumns: _columns, ...oldSettings } = current.settings;
    const old = { ...current, settings: oldSettings };
    const before = structuredClone(old);
    const migrated = migrateSnapshotV2(old);
    expect(migrated.nodes).toEqual(current.nodes);
    expect(migrated.maps).toEqual(current.maps);
    expect(migrated.settings).toEqual({ ...oldSettings, gridColumns: 3 });
    expect(old).toEqual(before);
    expect(() => migrateSnapshotV2({ ...old, settings: { ...oldSettings, opacity: 7 } })).toThrow('透明度');
  });
  it('creates unscheduled tasks in the system map and keeps IDs when scheduling', () => {
    let state = run([add('task-a')]);
    expect(selectVisibleNodes(state, 'inbox').matchedIds.has('task-a')).toBe(true);
    state = applyCommand(state, {
      type: 'node.update',
      id: 'task-a',
      patch: { schedule: { mode: 'range', start: '2026-11-13', end: '2026-11-13' } },
    });
    expect(state.nodes.filter((node) => node.id === 'task-a')).toHaveLength(1);
    expect(selectVisibleNodes(state, 'inbox').matchedIds.size).toBe(0);
    expect(selectVisibleNodes(state, 'today', '2026-11-13').matchedIds.has('task-a')).toBe(true);
  });
  it('converts only the selected node, not its ancestors or descendants, and preserves notes and IDs', () => {
    const state = run([
      { type: 'map.create', id: 'map-a', rootId: 'root-a', title: '读书计划' },
      add('branch-a', 'root-a', { mapId: 'map-a' }),
      add('branch-b', 'root-a', { mapId: 'map-a' }),
      add('child-a', 'branch-a', { mapId: 'map-a' }),
      { type: 'node.update', id: 'child-a', patch: { notes: { problems: '需要找参考书' } } },
      { type: 'node.convert', id: 'branch-a', start: '2026-11-01', end: '2026-11-30' },
    ]);
    expect(state.nodes.find((node) => node.id === 'branch-b')?.task).toBeNull();
    expect(state.nodes.find((node) => node.id === 'child-a')?.notes.problems).toBe('需要找参考书');
    expect(effectiveSchedule(state, 'branch-a')).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    expect(state.nodes.find((node) => node.id === 'child-a')?.task).toBeNull();
    expect(state.nodes.find((node) => node.id === 'root-a')?.task).toBeNull();
    expect(effectiveSchedule(state, 'child-a')).toBeNull();
    expect(selectPlanNodes(state, 'all').map((node) => node.id)).toEqual(['branch-a']);
    expect(state.nodes).toHaveLength(5);
  });
  it('system tasks stay planned, while independent project descendants remain ordinary nodes', () => {
    const state = run([add('a'), add('b', 'a', { task: false })]);
    expect(state.nodes.find((node) => node.id === 'b')?.task?.schedule).toEqual({ mode: 'inherit' });
    const independent = run([
      { type: 'map.create', id: 'map-a', rootId: 'root-a', title: '独立项目' },
      { type: 'node.convert', id: 'root-a', start: '2026-11-13', end: '2026-11-13' },
      add('plain', 'root-a', { mapId: 'map-a' }),
    ]);
    expect(independent.nodes.find((node) => node.id === 'plain')?.task).toBeNull();
    expect(selectPlanNodes(independent, 'all').map((node) => node.id)).toEqual(['root-a']);
  });
  it('rejects cycles, cross-map moves and deletion of the system map', () => {
    const state = run([
      add('a'),
      add('b', 'a'),
      { type: 'map.create', id: 'map-x', rootId: 'root-x', title: '另一张图' },
    ]);
    expect(() => applyCommand(state, { type: 'node.move', id: 'a', parentId: 'b' })).toThrow('自身');
    expect(() => applyCommand(state, { type: 'node.move', id: 'a', parentId: 'root-x' })).toThrow('跨导图');
    expect(() => applyCommand(state, { type: 'map.delete', id: SYSTEM_MAP_ID })).toThrow('系统导图');
    expect(state.nodes.find((node) => node.id === 'a')?.parentId).toBe(SYSTEM_ROOT_ID);
  });
  it('reorders siblings and removes complete subtrees atomically', () => {
    let state = run([add('a'), add('b'), add('c', 'a')]);
    state = applyCommand(state, { type: 'node.move', id: 'b', parentId: SYSTEM_ROOT_ID, index: 0 });
    expect(state.nodes.find((node) => node.id === 'b')?.order).toBe(0);
    state = applyCommand(state, { type: 'node.delete', id: 'a' });
    expect(state.nodes.map((node) => node.id)).toEqual([SYSTEM_ROOT_ID, 'b']);
  });
  it('a failed batch makes no partial changes', () => {
    const state = createInitialSnapshot();
    expect(() => applyCommand(state, { type: 'batch', commands: [add('a'), add('b', 'missing')] })).toThrow();
    expect(state.nodes).toHaveLength(1);
    expect(state.revision).toBe(0);
  });
  it('root renames update the map title without duplicating data', () => {
    const state = run([
      { type: 'map.create', id: 'map-a', rootId: 'root-a', title: '旧标题' },
      { type: 'node.update', id: 'root-a', patch: { title: '新标题' } },
    ]);
    expect(state.maps.find((map) => map.id === 'map-a')?.title).toBe('新标题');
    expect(() => validateSnapshot(state)).not.toThrow();
  });
});

describe('explicit tasks own their progress independently of map hierarchy', () => {
  it('allows manual progress on parent tasks without changing descendants', () => {
    let state = run([
      add('parent'),
      add('branch', 'parent'),
      add('one', 'branch'),
      add('two', 'branch'),
      add('three', 'parent'),
      { type: 'node.update', id: 'one', patch: { progress: 100 } },
      { type: 'node.update', id: 'two', patch: { progress: 50 } },
      { type: 'node.update', id: 'parent', patch: { progress: 30 } },
      { type: 'node.update', id: 'branch', patch: { progress: 80 } },
    ]);
    expect(getProgress(state, 'parent')).toBe(30);
    expect(getProgress(state, 'branch')).toBe(80);
    expect(isTaskLeaf(state, 'branch')).toBe(false);
    expect(isProgressEditable(state, 'parent')).toBe(true);
    state = applyCommand(state, { type: 'node.update', id: 'parent', patch: { progress: 90 } });
    expect(getProgress(state, 'parent')).toBe(90);
    expect(getProgress(state, 'two')).toBe(50);
  });
  it('completed items accept notes and stay complete when a new child is added', () => {
    let state = run([add('a'), add('b', 'a'), { type: 'node.update', id: 'a', patch: { progress: 100 } }]);
    expect(getProgress(state, 'a')).toBe(100);
    state = applyCommand(state, { type: 'node.update', id: 'b', patch: { notes: { other: '完成后复盘' } } });
    expect(state.nodes.find((node) => node.id === 'b')?.notes.other).toBe('完成后复盘');
    state = applyCommand(state, add('c', 'a'));
    expect(getProgress(state, 'a')).toBe(100);
    expect(getProgress(state, 'b')).toBe(0);
  });
  it('does not change task progress when removing or moving its final child', () => {
    let state = run([
      add('a'),
      add('b', 'a'),
      add('other'),
      { type: 'node.update', id: 'b', patch: { progress: 65 } },
      { type: 'node.update', id: 'a', patch: { progress: 40 } },
      { type: 'node.update', id: 'other', patch: { progress: 20 } },
    ]);
    state = applyCommand(state, { type: 'node.move', id: 'b', parentId: 'other' });
    expect(isTaskLeaf(state, 'a')).toBe(true);
    expect(getProgress(state, 'a')).toBe(40);
    state = applyCommand(state, { type: 'node.delete', id: 'b' });
    expect(getProgress(state, 'other')).toBe(20);
  });
  it('moving a plain branch under a task does not enroll it in a plan', () => {
    let state = run([
      { type: 'map.create', id: 'map-a', rootId: 'root-a', title: '项目' },
      add('task-a', 'root-a', { mapId: 'map-a' }),
      add('plain-a', 'root-a', { mapId: 'map-a' }),
      add('plain-b', 'plain-a', { mapId: 'map-a' }),
      { type: 'node.convert', id: 'task-a', start: '2026-11-13', end: '2026-11-20' },
      { type: 'node.move', id: 'plain-a', parentId: 'task-a' },
    ]);
    expect(state.nodes.find((node) => node.id === 'plain-b')?.task).toBeNull();
    expect(effectiveSchedule(state, 'plain-b')).toBeNull();
    expect(() =>
      applyCommand(state, { type: 'node.update', id: 'plain-b', patch: { progress: 100 } }),
    ).toThrow('加入计划');
    state = applyCommand(state, {
      type: 'node.convert',
      id: 'plain-b',
      start: '2026-11-14',
      end: '2026-11-14',
    });
    state = applyCommand(state, { type: 'node.update', id: 'plain-b', patch: { progress: 100 } });
    expect(getProgress(state, 'task-a')).toBe(0);
    expect(getProgress(state, 'plain-b')).toBe(100);
  });
});

describe('calendar dates, filters and context', () => {
  it('uses local calendar boundaries, Monday weeks and month ends', () => {
    expect(periodRange('week', '2026-11-01')).toEqual({ start: '2026-10-26', end: '2026-11-01' });
    expect(periodRange('month', '2028-02-10')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(localDate(new Date(2026, 0, 1, 23, 59))).toBe('2026-01-01');
  });
  it('distinguishes date inheritance, explicit none, and overriding ranges', () => {
    const state = run([
      add('a', SYSTEM_ROOT_ID, { schedule: { mode: 'range', start: '2026-11-13', end: '2026-11-20' } }),
      add('inherit', 'a'),
      add('none', 'a', { schedule: { mode: 'none' } }),
      add('different', 'a', { schedule: { mode: 'range', start: '2026-12-01', end: '2026-12-03' } }),
    ]);
    expect(effectiveSchedule(state, 'inherit')?.end).toBe('2026-11-20');
    expect(effectiveSchedule(state, 'none')).toBeNull();
    expect(effectiveSchedule(state, 'different')?.start).toBe('2026-12-01');
  });
  it('includes range intersections and overdue tasks with their ancestor context', () => {
    const state = run([
      add('a'),
      add('dated', 'a', { schedule: { mode: 'range', start: '2026-10-30', end: '2026-11-03' } }),
      add('overdue', SYSTEM_ROOT_ID, { schedule: { mode: 'range', start: '2026-10-01', end: '2026-10-01' } }),
      add('future', SYSTEM_ROOT_ID, { schedule: { mode: 'range', start: '2026-12-01', end: '2026-12-01' } }),
    ]);
    const result = selectVisibleNodes(state, 'today', '2026-11-02');
    expect(result.matchedIds).toEqual(new Set(['dated', 'overdue']));
    expect(result.nodes.map((node) => node.id)).toContain('a');
    expect(result.matchedIds.has('a')).toBe(false);
    expect(dateStatus(state, 'overdue', '2026-11-02')).toBe('overdue');
    expect(dateStatus(state, 'dated', '2026-11-03')).toBe('today');
  });
  it('retains a completed overdue task in its plan and local completion periods until the next period', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 15, 23, 59, 55));
    let state = run([
      add('a', SYSTEM_ROOT_ID, { schedule: { mode: 'range', start: '2026-11-01', end: '2026-11-01' } }),
    ]);
    expect(selectPlanNodes(state, 'today', '2026-11-15').map((node) => node.id)).toEqual(['a']);
    state = applyCommand(state, { type: 'node.update', id: 'a', patch: { progress: 100 } });
    for (const filter of ['today', 'week', 'month'] as const) {
      expect(selectPlanNodes(state, filter, '2026-11-15').map((node) => node.id)).toEqual(['a']);
      expect(selectVisibleNodes(state, filter, '2026-11-15').matchedIds.has('a')).toBe(true);
    }
    expect(selectPlanNodes(state, 'today', '2026-11-01').map((node) => node.id)).toEqual(['a']);
    expect(selectPlanNodes(state, 'week', '2026-11-01').map((node) => node.id)).toEqual(['a']);
    expect(selectPlanNodes(state, 'today', '2026-11-16')).toHaveLength(0);
    expect(selectPlanNodes(state, 'week', '2026-11-16')).toHaveLength(0);
    const hidden = applyCommand(state, { type: 'settings.update', patch: { hideCompleted: true } });
    expect(selectPlanNodes(hidden, 'today', '2026-11-15')).toHaveLength(0);
    expect(selectVisibleNodes(hidden, 'week', '2026-11-15').matchedIds.size).toBe(0);
    const reopened = applyCommand(state, { type: 'node.update', id: 'a', patch: { progress: 90 } });
    expect(reopened.nodes.find((node) => node.id === 'a')?.completedAt).toBeNull();
    expect(selectPlanNodes(reopened, 'today', '2026-11-16').map((node) => node.id)).toEqual(['a']);
  });
  it('uses the local completion date at midnight without importing undated completions into dated plans', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 11, 1, 0, 5));
    let state = run([
      add('dated', SYSTEM_ROOT_ID, { schedule: { mode: 'range', start: '2026-10-20', end: '2026-10-20' } }),
      add('undated'),
    ]);
    state = run(
      [
        { type: 'node.update', id: 'dated', patch: { progress: 100 } },
        { type: 'node.update', id: 'undated', patch: { progress: 100 } },
      ],
      state,
    );
    expect(selectPlanNodes(state, 'today', '2026-12-01').map((node) => node.id)).toEqual(['dated']);
    expect(selectPlanNodes(state, 'today', '2026-11-30')).toHaveLength(0);
    expect(selectPlanNodes(state, 'month', '2026-12-01').map((node) => node.id)).toEqual(['dated']);
    expect(selectPlanNodes(state, 'inbox', '2026-12-01').map((node) => node.id)).toEqual(['undated']);
  });
  it('does not fabricate a completion date when an old completed node has no timestamp', () => {
    let state = run([
      add('legacy', SYSTEM_ROOT_ID, { schedule: { mode: 'range', start: '2026-11-01', end: '2026-11-01' } }),
    ]);
    state = applyCommand(state, { type: 'node.update', id: 'legacy', patch: { progress: 100 } });
    state = {
      ...state,
      nodes: state.nodes.map((node) => (node.id === 'legacy' ? { ...node, completedAt: null } : node)),
    };
    expect(isNodeInPlanRange(state, 'legacy', { start: '2026-11-01', end: '2026-11-01' }, '2026-11-17')).toBe(
      true,
    );
    expect(isNodeInPlanRange(state, 'legacy', { start: '2026-11-17', end: '2026-11-17' }, '2026-11-17')).toBe(
      false,
    );
  });
  it('rejects malformed dates and invalid progress without corrupting the previous snapshot', () => {
    const state = run([add('a')]);
    for (const [start, end] of [
      ['2026-02-29', '2026-03-01'],
      ['2026-11-20', '2026-11-13'],
      ['13/11/2026', '2026-11-20'],
    ]) {
      expect(() =>
        applyCommand(state, {
          type: 'node.update',
          id: 'a',
          patch: { schedule: { mode: 'range', start, end } },
        }),
      ).toThrow();
    }
    expect(() =>
      applyCommand(state, { type: 'node.update', id: 'a', patch: { progress: Number.NaN } }),
    ).toThrow();
    expect(state.nodes.find((node) => node.id === 'a')?.task?.schedule.mode).toBe('none');
  });
});

describe('scale and backup validation', () => {
  it('filters and computes a 1,000-node tree with cached aggregates', () => {
    const commands: Command[] = [add('parent')];
    for (let i = 0; i < 999; i++)
      commands.push(
        add(`leaf-${i}`, 'parent', { schedule: { mode: 'range', start: '2026-11-01', end: '2026-11-30' } }),
      );
    const state = applyCommand(createInitialSnapshot(), { type: 'batch', commands });
    const start = performance.now();
    expect(selectVisibleNodes(state, 'today', '2026-11-13').matchedIds.size).toBe(999);
    for (const node of state.nodes) getProgress(state, node.id);
    expect(getDescendants(state, 'parent')).toHaveLength(999);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(() => validateSnapshot(state)).not.toThrow();
  });
  it('rejects disconnected cycles and broken map roots in imported data', () => {
    const state = run([add('a'), add('b', 'a')]);
    state.nodes.find((node) => node.id === 'a')!.parentId = 'b';
    expect(() => validateSnapshot(state)).toThrow('循环');
    const invalid = createInitialSnapshot();
    invalid.nodes = [];
    expect(() => validateSnapshot(invalid)).toThrow('根节点');
  });
});

describe('flat plan membership, order and timestamps', () => {
  it('never includes context parents or unselected descendants in a plan', () => {
    const state = run([
      { type: 'map.create', id: 'project', rootId: 'project-root', title: '项目' },
      add('parent', 'project-root', { mapId: 'project' }),
      add('selected', 'parent', { mapId: 'project' }),
      add('child', 'selected', { mapId: 'project' }),
      { type: 'node.convert', id: 'selected', start: '2026-11-14', end: '2026-11-15' },
    ]);
    expect(selectPlanNodes(state, 'today', '2026-11-14').map((node) => node.id)).toEqual(['selected']);
    expect(selectVisibleNodes(state, 'today', '2026-11-14').nodes.map((node) => node.id)).toEqual([
      'project-root',
      'parent',
      'selected',
    ]);
    const removed = applyCommand(state, {
      type: 'node.update',
      id: 'selected',
      patch: { planned: false, notes: { other: '保留记录' } },
    });
    expect(selectPlanNodes(removed, 'all')).toHaveLength(0);
    expect(removed.nodes.find((node) => node.id === 'selected')?.notes.other).toBe('保留记录');
  });
  it('sorts unfinished tasks by due date, then completed tasks by most recent completion', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime('2026-11-14T01:00:00.000Z');
    let state = run([
      add('later', SYSTEM_ROOT_ID, { schedule: { mode: 'range', start: '2026-11-14', end: '2026-11-20' } }),
      add('no-date'),
      add('earlier', SYSTEM_ROOT_ID, { schedule: { mode: 'range', start: '2026-11-14', end: '2026-11-15' } }),
      add('done-old'),
      add('done-new'),
      { type: 'node.update', id: 'done-old', patch: { progress: 100 } },
    ]);
    vi.setSystemTime('2026-11-14T02:00:00.000Z');
    state = applyCommand(state, { type: 'node.update', id: 'done-new', patch: { progress: 100 } });
    expect(selectPlanNodes(state, 'all').map((node) => node.id)).toEqual([
      'earlier',
      'later',
      'no-date',
      'done-new',
      'done-old',
    ]);
    const hidden = applyCommand(state, { type: 'settings.update', patch: { hideCompleted: true } });
    expect(selectPlanNodes(hidden, 'all').map((node) => node.id)).toEqual(['earlier', 'later', 'no-date']);
  });
  it('updates edit/completion timestamps only at their relevant transitions', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime('2026-11-14T01:00:00.000Z');
    let state = run([add('task')]);
    expect(state.nodes.find((node) => node.id === 'task')?.createdAt).toBe('2026-11-14T01:00:00.000Z');
    vi.setSystemTime('2026-11-14T02:00:00.000Z');
    state = applyCommand(state, { type: 'node.update', id: 'task', patch: { progress: 100 } });
    expect(state.nodes.find((node) => node.id === 'task')?.completedAt).toBe('2026-11-14T02:00:00.000Z');
    vi.setSystemTime('2026-11-14T03:00:00.000Z');
    state = applyCommand(state, {
      type: 'node.update',
      id: 'task',
      patch: { notes: { other: '完成后的备注' } },
    });
    expect(state.nodes.find((node) => node.id === 'task')?.updatedAt).toBe('2026-11-14T03:00:00.000Z');
    expect(state.nodes.find((node) => node.id === 'task')?.completedAt).toBe('2026-11-14T02:00:00.000Z');
    state = applyCommand(state, { type: 'node.update', id: 'task', patch: { progress: 60 } });
    expect(state.nodes.find((node) => node.id === 'task')?.completedAt).toBeNull();
  });
  it('validates light/dark appearance ranges and retains legacy fractional progress', () => {
    let state = run([add('task')]);
    state = applyCommand(state, {
      type: 'settings.update',
      patch: { theme: 'dark', blur: 36, fontSize: 18, reduceMotion: true },
    });
    expect(state.settings.theme).toBe('dark');
    expect(() => applyCommand(state, { type: 'settings.update', patch: { blur: 37 } })).toThrow();
    expect(() => applyCommand(state, { type: 'settings.update', patch: { fontSize: 11 } })).toThrow();
    state = applyCommand(state, { type: 'node.update', id: 'task', patch: { progress: 33.33 } });
    expect(getProgress(state, 'task')).toBe(33.33);
    expect(createInitialSnapshot().maps[0].title).toBe('草稿箱');
  });
  it('migrates old theme, IDs, hierarchy, notes and visible parent progress deterministically', () => {
    const current = run([
      add('parent'),
      add('child', 'parent'),
      { type: 'node.update', id: 'child', patch: { progress: 100, notes: { other: '不能丢失' } } },
    ]);
    const legacy = {
      ...current,
      maps: current.maps.map((map) => ({ ...map, title: '我的待办', createdAt: '2026-01-01T00:00:00.000Z' })),
      nodes: current.nodes.map(
        ({ createdAt: _created, updatedAt: _updated, completedAt: _completed, ...node }) => ({
          ...node,
          title: node.id === SYSTEM_ROOT_ID ? '我的待办' : node.title,
          task: node.task ? { schedule: node.task.schedule, progress: node.task.progress } : null,
        }),
      ),
      settings: {
        theme: 'mint',
        opacity: 0.82,
        pinned: false,
        hideCompleted: false,
        filter: 'today',
        launchAtLogin: false,
        stickyCollapsed: false,
      },
    };
    const migrated = migrateSnapshotV1(legacy);
    expect(migrated.nodes.map((node) => node.id)).toEqual(current.nodes.map((node) => node.id));
    expect(migrated.settings).toMatchObject({ theme: 'light', blur: 18, fontSize: 14, reduceMotion: false });
    expect(getProgress(migrated, 'parent')).toBe(100);
    expect(migrated.nodes.find((node) => node.id === 'parent')?.completedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(migrated.nodes.find((node) => node.id === 'child')?.notes.other).toBe('不能丢失');
    expect(migrateSnapshotV1(legacy)).toEqual(migrated);
  });
});
