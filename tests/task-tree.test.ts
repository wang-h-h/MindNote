import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import TaskTree from '../src/renderer/TaskTree';
import { applyCommand, createInitialSnapshot, SYSTEM_MAP_ID, SYSTEM_ROOT_ID } from '../src/shared/domain';
import type { Command, Snapshot } from '../src/shared/types';

function fixture(): Snapshot {
  const commands: Command[] = [
    { type: 'node.create', id: 'parent', mapId: SYSTEM_MAP_ID, parentId: SYSTEM_ROOT_ID, title: '父事项' },
    { type: 'node.create', id: 'finished', mapId: SYSTEM_MAP_ID, parentId: 'parent', title: '目标事项' },
    { type: 'node.create', id: 'other', mapId: SYSTEM_MAP_ID, parentId: 'parent', title: '另一个事项' },
    { type: 'node.update', id: 'finished', patch: { progress: 100, notes: { other: '阅读回顾' } } },
    { type: 'node.update', id: 'parent', patch: { progress: 40 } },
    { type: 'node.update', id: 'parent', patch: { expanded: false } },
  ];
  return applyCommand(createInitialSnapshot(), { type: 'batch', commands });
}
function render(snapshot: Snapshot, search = '', filter: 'all' | 'today' = 'all'): string {
  return renderToStaticMarkup(
    createElement(TaskTree, {
      snapshot,
      search,
      filter,
      today: '2026-11-13',
      selectedId: null,
      onSelect() {},
      onAdd() {},
      onLocate() {},
      dispatch: async (command) => applyCommand(snapshot, command),
    }),
  );
}

describe('task tree search remains a projection of the complete document', () => {
  it('keeps independent parent progress and reveals matching descendants under collapsed parents', () => {
    const snapshot = fixture(),
      html = render(snapshot, '目标');
    expect(html).toContain('父事项，进度 40%');
    expect(html).toContain('目标事项，进度 100%');
    expect(html).not.toContain('另一个事项');
    expect(snapshot.nodes.find((node) => node.id === 'parent')?.expanded).toBe(false);
    expect(render(snapshot)).not.toContain('目标事项');
  });
  it('matches notes while keeping hide-completed authoritative', () => {
    const snapshot = fixture();
    expect(render(snapshot, '阅读回顾')).toContain('目标事项');
    const hidden = applyCommand(snapshot, { type: 'settings.update', patch: { hideCompleted: true } });
    expect(render(hidden, '阅读回顾')).toContain('没有找到匹配事项');
  });
  it('retains overdue search matches in date filters with full ancestor progress', () => {
    const snapshot = applyCommand(fixture(), {
      type: 'node.update',
      id: 'other',
      patch: { schedule: { mode: 'range', start: '2026-11-01', end: '2026-11-01' } },
    });
    const html = render(snapshot, '另一个', 'today');
    expect(html).toContain('父事项，进度 40%');
    expect(html).toContain('逾期 · ');
    expect(html).not.toContain('目标事项');
  });
  it('renders a converted map root as a task and respects its collapsed state', () => {
    const snapshot = applyCommand(createInitialSnapshot(), {
      type: 'batch',
      commands: [
        { type: 'map.create', id: 'map-a', rootId: 'map-root', title: '计划根节点' },
        { type: 'node.create', id: 'map-child', mapId: 'map-a', parentId: 'map-root', title: '分支内容' },
        { type: 'node.convert', id: 'map-root', start: '2026-11-13', end: '2026-11-20' },
        { type: 'node.update', id: 'map-root', patch: { expanded: false } },
      ],
    });
    expect(render(snapshot)).toContain('计划根节点，进度 0%');
    expect(render(snapshot)).not.toContain('分支内容');
    expect(render(snapshot, '分支内容')).toContain('没有找到匹配事项');
    const separatelyPlanned = applyCommand(snapshot, { type: 'node.convert', id: 'map-child', start: '2026-11-13', end: '2026-11-13' });
    expect(render(separatelyPlanned, '分支内容')).toContain('分支内容');
  });
  it('allows explicitly planned parents to be completed independently', () => {
    const html = render(fixture());
    const parentCheckbox = html.match(/<button[^>]+role="checkbox"[^>]+aria-label="完成 父事项"[^>]*>/)?.[0];
    expect(parentCheckbox).toBeTruthy();
    expect(parentCheckbox).not.toContain('disabled');
    expect(html).not.toContain('由子事项自动汇总');
  });
});
