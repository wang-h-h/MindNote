import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PlanViews, {
  PlanItem,
  ProgressSlider,
  progressTone,
  groupPlanNodes,
  planDateText,
  resolvePlanOrder,
  adjacentPlanWeeks,
  selectPlanViewNodes,
} from '../src/renderer/PlanViews';
import {
  applyCommand,
  createInitialSnapshot,
  selectPlanNodes,
  SYSTEM_MAP_ID,
  SYSTEM_ROOT_ID,
} from '../src/shared/domain';
import type { Command, Snapshot, Filter } from '../src/shared/types';

function fixture() {
  return applyCommand(createInitialSnapshot(), {
    type: 'batch',
    commands: [
      { type: 'map.create', id: 'project', rootId: 'project-root', title: '论文项目' },
      { type: 'node.create', id: 'parent', mapId: 'project', parentId: 'project-root', title: '研究阶段' },
      { type: 'node.create', id: 'selected', mapId: 'project', parentId: 'parent', title: '整理资料' },
      { type: 'node.create', id: 'child', mapId: 'project', parentId: 'selected', title: '阅读论文' },
      { type: 'node.convert', id: 'selected', start: '2026-11-14', end: '2026-11-20' },
      { type: 'node.update', id: 'selected', patch: { progress: 40, notes: { other: '整理研究素材' } } },
    ],
  });
}
function dispatchFor(snapshot: Snapshot) {
  return async (command: Command) => applyCommand(snapshot, command);
}
function renderPlan(
  snapshot: Snapshot,
  search = '',
  day = '2026-11-14',
  compact = false,
  filter: Filter = 'today',
) {
  return renderToStaticMarkup(
    createElement(PlanViews, {
      snapshot,
      filter,
      day,
      search,
      compact,
      setDay() {},
      onSelect() {},
      onLocate() {},
      onAdd() {},
      dispatch: dispatchFor(snapshot),
    }),
  );
}
afterEach(() => vi.useRealTimers());

describe('flat plan presentation', () => {
  it('keeps overdue completions visible in the current day and week until the hide switch is enabled', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 17, 13));
    let snapshot = applyCommand(createInitialSnapshot(), {
      type: 'node.create',
      id: 'late',
      mapId: SYSTEM_MAP_ID,
      parentId: SYSTEM_ROOT_ID,
      title: '延续到今天的旧计划',
      schedule: { mode: 'range', start: '2026-10-01', end: '2026-10-01' },
    });
    expect(renderPlan(snapshot, '', '2026-11-17')).toContain('data-task-id="late"');
    snapshot = applyCommand(snapshot, { type: 'node.update', id: 'late', patch: { progress: 100 } });
    for (const compact of [false, true])
      for (const filter of ['today', 'week'] as const) {
        const html = renderPlan(snapshot, '', '2026-11-17', compact, filter);
        expect(html.match(/data-task-id="late"/g)).toHaveLength(1);
        expect(html).toContain('plan-item done');
      }
    snapshot = applyCommand(snapshot, { type: 'settings.update', patch: { hideCompleted: true } });
    expect(renderPlan(snapshot, '', '2026-11-17')).not.toContain('data-task-id="late"');
    expect(renderPlan(snapshot, '', '2026-11-17', false, 'week')).not.toContain('data-task-id="late"');
  });
  it('renders exactly three Monday-aligned week notes around the real date, independent of another view selected day', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 17, 13));
    const commands: Command[] = [
      ['previous-task', '2026-11-10'],
      ['current-task', '2026-11-17'],
      ['next-task', '2026-11-24'],
      ['carry-over', '2026-10-01'],
    ].map(([id, date]) => ({
      type: 'node.create',
      id,
      mapId: SYSTEM_MAP_ID,
      parentId: SYSTEM_ROOT_ID,
      title: id,
      schedule: { mode: 'range', start: date, end: date },
    }));
    const snapshot = applyCommand(createInitialSnapshot(), { type: 'batch', commands });
    const html = renderPlan(snapshot, '', '2027-06-19', false, 'week');
    expect(html.match(/data-week="/g)).toHaveLength(3);
    expect(html).toContain('data-week="previous" data-week-start="2026-11-09" data-week-end="2026-11-15"');
    expect(html).toContain('data-week="current" data-week-start="2026-11-16" data-week-end="2026-11-22"');
    expect(html).toContain('data-week="next" data-week-start="2026-11-23" data-week-end="2026-11-29"');
    const previous = html.slice(html.indexOf('data-week="previous"'), html.indexOf('data-week="current"'));
    const current = html.slice(html.indexOf('data-week="current"'), html.indexOf('data-week="next"'));
    const next = html.slice(html.indexOf('data-week="next"'));
    expect(previous).toContain('data-task-id="previous-task"');
    expect(previous).not.toContain('data-task-id="carry-over"');
    expect(current).toContain('data-task-id="current-task"');
    expect(current).toContain('data-task-id="carry-over"');
    expect(next).toContain('data-task-id="next-task"');
    expect(next).not.toContain('data-task-id="current-task"');
    expect(next).not.toContain('data-task-id="carry-over"');
    expect(html).not.toMatch(/回到今天|aria-label="上一周"|aria-label="下一周"/);
    expect(renderPlan(snapshot, '', '2026-11-17')).not.toContain('回到今天');
    expect(adjacentPlanWeeks('2027-01-01').map(({ start, end }) => [start, end])).toEqual([
      ['2026-12-21', '2026-12-27'],
      ['2026-12-28', '2027-01-03'],
      ['2027-01-04', '2027-01-10'],
    ]);
  });
  it('lets an explicit archive selection reveal completed items without changing the global hide preference', () => {
    let snapshot = applyCommand(fixture(), { type: 'node.update', id: 'selected', patch: { progress: 100 } });
    snapshot = applyCommand(snapshot, { type: 'settings.update', patch: { hideCompleted: true } });
    expect(selectPlanViewNodes(snapshot, 'all', '2026-11-17', 'all')).toHaveLength(0);
    expect(selectPlanViewNodes(snapshot, 'all', '2026-11-17', 'active')).toHaveLength(0);
    const archive = selectPlanViewNodes(snapshot, 'all', '2026-11-17', 'finished');
    expect(archive.map((node) => node.id)).toEqual(['selected']);
    const html = renderToStaticMarkup(
      createElement(PlanItem, {
        snapshot,
        node: archive[0],
        card: true,
        dispatch: dispatchFor(snapshot),
        onSelect() {},
        onLocate() {},
      }),
    );
    expect(html).toContain('plan-note done');
    expect(snapshot.settings.hideCompleted).toBe(true);
    expect(selectPlanViewNodes(snapshot, 'today', '2026-11-17', 'finished')).toHaveLength(0);
  });
  it('keeps two-line headers and displays full notes only on cards', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 20, 12));
    const snapshot = fixture();
    const node = snapshot.nodes.find((item) => item.id === 'selected')!;
    for (const card of [false, true]) {
      const html = renderToStaticMarkup(
        createElement(PlanItem, {
          snapshot,
          node,
          card,
          dispatch: dispatchFor(snapshot),
          onSelect() {},
          onLocate() {},
        }),
      );
      expect(html).toContain('class="plan-item-top"');
      expect(html).toContain('class="plan-item-bottom"');
      expect(html).toContain('class="plan-date is-due"');
      expect(html).toContain('title="2026-11-14 至 2026-11-20"');
      expect(html).toContain('11/14–11/20');
      expect(html).toContain('class="progress-value" aria-hidden="true">40%</span>');
      expect(html).toContain('aria-label="展开 整理资料"');
      expect(html).toContain('aria-label="在导图中查看 整理资料"');
      expect(html).not.toMatch(/今日到期|已逾期|note-excerpt|note-bottom/);
      if (card) expect(html).toContain('<p>整理研究素材</p>');
      else expect(html).not.toContain('整理研究素材');
    }
    const done = applyCommand(snapshot, { type: 'node.update', id: node.id, patch: { progress: 100 } });
    const html = renderPlan(done);
    expect(html).not.toContain('class="plan-date is-due"');
  });
  it('renders complete nonempty note fields without placeholders or interpreting note text as HTML', () => {
    const full = '完整第一行\n第二行\n第三行\n第四行';
    const snapshot = applyCommand(fixture(), {
      type: 'node.update',
      id: 'selected',
      patch: { notes: { progress: full, problems: '  ', other: '<img src=x onerror=alert(1)>' } },
    });
    const node = snapshot.nodes.find((item) => item.id === 'selected')!;
    const html = renderToStaticMarkup(
      createElement(PlanItem, {
        snapshot,
        node,
        card: true,
        dispatch: dispatchFor(snapshot),
        onSelect() {},
        onLocate() {},
      }),
    );
    expect(html).toContain(full);
    expect(html).toContain('data-note-kind="progress"');
    expect(html).toContain('data-note-kind="other"');
    expect(html).not.toContain('data-note-kind="problems"');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
  it('keeps a fitting list stable on completion and sinks completed items only for an overflowing list', () => {
    let snapshot = applyCommand(fixture(), {
      type: 'node.create',
      id: 'later-task',
      mapId: 'project',
      parentId: 'project-root',
      title: '后续',
      task: true,
      schedule: { mode: 'range', start: '2026-11-21', end: '2026-11-21' },
    });
    const before = selectPlanNodes(snapshot, 'all');
    const ids = before.map((node) => node.id);
    const previous = new Map(before.map((node) => [node.id, false]));
    snapshot = applyCommand(snapshot, { type: 'node.update', id: 'selected', patch: { progress: 100 } });
    const after = selectPlanNodes(snapshot, 'all');
    expect(resolvePlanOrder(ids, after, previous, false)).toEqual(['selected', 'later-task']);
    expect(resolvePlanOrder(ids, after, previous, true)).toEqual(['later-task', 'selected']);
    const current = new Map(after.map((node) => [node.id, node.task!.progress === 100]));
    // Geometry alone (including a resize or longer notes) must not cause a later jump.
    expect(resolvePlanOrder(ids, after, current, true)).toEqual(ids);
    expect(resolvePlanOrder(['later-task', 'selected'], after, current, false)).toEqual([
      'later-task',
      'selected',
    ]);
    // A collapsed project's remote completion is not a visible completion action.
    expect(resolvePlanOrder(ids, after, previous, true, new Set(['project']))).toEqual(ids);
  });
  it('removes hidden IDs without shuffling survivors and can start fresh for a new filter/date', () => {
    const snapshot = applyCommand(fixture(), {
      type: 'batch',
      commands: [
        {
          type: 'node.create',
          id: 'middle',
          mapId: 'project',
          parentId: 'project-root',
          title: '中',
          task: true,
        },
        {
          type: 'node.create',
          id: 'last',
          mapId: 'project',
          parentId: 'project-root',
          title: '后',
          task: true,
        },
      ],
    });
    const canonical = selectPlanNodes(snapshot, 'all').filter((node) => node.id !== 'selected');
    expect(resolvePlanOrder(['selected', 'middle', 'last'], canonical, new Map(), true)).toEqual([
      'middle',
      'last',
    ]);
    expect(resolvePlanOrder([], canonical, new Map(), false)).toEqual(canonical.map((node) => node.id));
  });
  it('keeps cross-year dates unambiguous while shortening ordinary ranges', () => {
    expect(planDateText({ start: '2026-11-15', end: '2026-11-22' }, '2026-11-15')).toBe('11/15–11/22');
    expect(planDateText({ start: '2026-12-31', end: '2027-01-02' }, '2026-11-15')).toBe('26/12/31–27/01/02');
    expect(planDateText({ start: '2027-02-01', end: '2027-02-02' }, '2026-11-15')).toBe('27/02/01–02/02');
    expect(planDateText({ start: '2027-02-01', end: '2027-02-01' }, '2026-11-15')).toBe('27/02/01');
  });
  it('groups by project priority while preserving unfinished-first and newest-completion order within each project', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 14, 12));
    let snapshot = applyCommand(fixture(), {
      type: 'batch',
      commands: [
        { type: 'map.create', id: 'urgent-project', rootId: 'urgent-root', title: '优先项目' },
        {
          type: 'node.create',
          id: 'urgent-task',
          mapId: 'urgent-project',
          parentId: 'urgent-root',
          title: '先处理',
          task: true,
          schedule: { mode: 'range', start: '2026-11-13', end: '2026-11-13' },
        },
        {
          type: 'node.create',
          id: 'done-old',
          mapId: 'project',
          parentId: 'project-root',
          title: '早完成',
          task: true,
        },
        {
          type: 'node.create',
          id: 'done-new',
          mapId: 'project',
          parentId: 'project-root',
          title: '晚完成',
          task: true,
        },
        { type: 'node.update', id: 'done-old', patch: { progress: 100 } },
      ],
    });
    vi.setSystemTime(new Date(2026, 10, 14, 13));
    snapshot = applyCommand(snapshot, { type: 'node.update', id: 'done-new', patch: { progress: 100 } });
    snapshot = applyCommand(snapshot, { type: 'settings.update', patch: { gridColumns: 4 } });
    const groups = groupPlanNodes(selectPlanNodes(snapshot, 'all'));
    expect(groups.map((group) => group.mapId)).toEqual(['urgent-project', 'project']);
    expect(groups[1].nodes.map((node) => node.id)).toEqual(['selected', 'done-new', 'done-old']);
    const html = renderPlan(snapshot, '', '2026-11-14', false, 'all');
    expect(html.match(/data-project-id=/g)).toHaveLength(2);
    expect(html.match(/class="notes-grid plan-project-grid"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="收起项目 优先项目" aria-expanded="true"');
    expect(html).toContain('aria-label="宫格列数"');
    expect(html).toContain('aria-label="4 列" aria-pressed="true"');
    expect(html.match(/--plan-columns:4/g)).toHaveLength(2);
    expect(html.indexOf('data-project-id="urgent-project"')).toBeLessThan(
      html.indexOf('data-project-id="project"'),
    );
    expect(html.indexOf('data-task-id="done-new"')).toBeLessThan(html.indexOf('data-task-id="done-old"'));
  });
  it('uses the real date for overdue tasks when browsing a future day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 14, 12));
    let snapshot = fixture();
    for (const [id, date] of [
      ['overdue', '2026-11-13'],
      ['future-before-selection', '2026-11-16'],
      ['on-selected-day', '2026-11-18'],
      ['finished-before-selection', '2026-11-13'],
    ]) {
      snapshot = applyCommand(snapshot, {
        type: 'node.create',
        id,
        mapId: 'project',
        parentId: 'project-root',
        title: id,
        task: true,
        schedule: { mode: 'range', start: date, end: date },
      });
    }
    snapshot = applyCommand(snapshot, {
      type: 'node.update',
      id: 'finished-before-selection',
      patch: { progress: 100 },
    });
    const html = renderPlan(snapshot, '', '2026-11-18');
    expect(html).toContain('data-task-id="selected"');
    expect(html).toContain('data-task-id="overdue"');
    expect(html).toContain('data-task-id="on-selected-day"');
    expect(html).not.toContain('data-task-id="future-before-selection"');
    expect(html).not.toContain('data-task-id="finished-before-selection"');
    // The sticky's Today tab always follows the actual date, regardless of a
    // full window's currently selected calendar day.
    const compact = renderPlan(snapshot, '', '2026-11-18', true);
    expect(compact).toContain('data-task-id="overdue"');
    expect(compact).not.toContain('data-task-id="on-selected-day"');
    expect(compact).not.toContain('data-task-id="future-before-selection"');
  });
  it('shows only the selected item and its project name, without hierarchy context', () => {
    const html = renderPlan(fixture());
    expect(html.match(/data-task-id=/g)).toHaveLength(1);
    expect(html).toContain('data-task-id="selected"');
    expect(html).toContain('论文项目');
    expect(html).toContain('整理资料');
    expect(html).not.toContain('研究阶段');
    expect(html).not.toContain('阅读论文');
    expect(html).not.toContain('role="tree"');
  });
  it('uses a 10% step slider with no numeric progress input or completion button', () => {
    const snapshot = fixture(),
      node = snapshot.nodes.find((node) => node.id === 'selected')!;
    const html = renderToStaticMarkup(
      createElement(PlanItem, {
        snapshot,
        node,
        dispatch: dispatchFor(snapshot),
        onSelect() {},
        onLocate() {},
      }),
    );
    expect(html).toMatch(/<input[^>]*type="range"[^>]*min="0"[^>]*max="100"[^>]*step="10"/);
    expect(html).not.toContain('type="number"');
    expect(html).not.toContain('role="checkbox"');
    expect(html).not.toMatch(/标记完成|标记为已完成|取消完成|完成全部/);
    expect(html).toContain('2026-11-14 至 2026-11-20');
    expect(html).not.toMatch(/2026-11-14T/);
  });
  it('makes an explicitly planned parent slider editable despite its ordinary children', () => {
    const snapshot = fixture(),
      node = snapshot.nodes.find((node) => node.id === 'selected')!;
    const html = renderToStaticMarkup(
      createElement(ProgressSlider, { snapshot, node, dispatch: dispatchFor(snapshot) }),
    );
    expect(html).toContain('value="40"');
    expect(html).not.toContain('disabled');
  });
  it('searches by project and notes without adding the other map nodes', () => {
    expect(renderPlan(fixture(), '论文项目')).toContain('data-task-id="selected"');
    expect(renderPlan(fixture(), '研究素材')).toContain('data-task-id="selected"');
    expect(renderPlan(fixture(), '阅读论文')).not.toContain('data-task-id=');
  });
  it('preserves completion styling while removing completed items when requested', () => {
    let snapshot = applyCommand(fixture(), { type: 'node.update', id: 'selected', patch: { progress: 100 } });
    expect(renderPlan(snapshot)).toContain('plan-item done');
    snapshot = applyCommand(snapshot, { type: 'settings.update', patch: { hideCompleted: true } });
    expect(renderPlan(snapshot)).not.toContain('data-task-id=');
  });
  it('combines remaining time and progress to choose urgency without numeric badges', () => {
    const snapshot = fixture(),
      node = snapshot.nodes.find((node) => node.id === 'selected')!;
    expect(progressTone(snapshot, node, '2026-11-20')).toBe('urgent');
    expect(progressTone(snapshot, node, '2026-11-18')).toBe('soon');
    expect(progressTone(snapshot, node, '2026-11-14')).toBe('calm');
    const done = applyCommand(snapshot, { type: 'node.update', id: node.id, patch: { progress: 100 } });
    expect(
      progressTone(
        done,
        done.nodes.find((item) => item.id === node.id)!,
        '2026-11-21',
      ),
    ).toBe('finished');
  });
});
