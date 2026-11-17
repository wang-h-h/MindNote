import { describe, expect, it } from 'vitest';
import type { NodeObj } from 'mind-elixir';
import type { Command, Snapshot } from '../src/shared/types';
import {
  applyCommand,
  createInitialSnapshot,
  getChildren,
  SYSTEM_MAP_ID,
  SYSTEM_ROOT_ID,
} from '../src/shared/domain';
import {
  buildCanvasData,
  canvasSignature,
  canvasStructureSignature,
  fittedScale,
  findRenderedTopic,
  expansionPlan,
  operationCommands,
} from '../src/renderer/mindmapAdapter';

function add(state: Snapshot, id: string, parentId = SYSTEM_ROOT_ID) {
  return applyCommand(state, {
    type: 'node.create',
    id,
    parentId,
    mapId: SYSTEM_MAP_ID,
    title: `事项 ${id}`,
  });
}
function execute(state: Snapshot, commands: Command[]) {
  return applyCommand(state, { type: 'batch', commands });
}
function attach(parent: NodeObj, children: NodeObj[]) {
  parent.children = children;
  for (const child of children) child.parent = parent;
}

describe('mind-map adapter', () => {
  it('projects a shared tree with completion styles without mutating business state', () => {
    let state = add(createInitialSnapshot(), 'parent');
    state = add(state, 'leaf', 'parent');
    state = applyCommand(state, {
      type: 'node.update',
      id: 'leaf',
      patch: { progress: 100, notes: { problems: '完成后仍能记录问题' } },
    });
    const before = JSON.stringify(state);
    const data = buildCanvasData(state, SYSTEM_MAP_ID);
    expect(data.nodeData.children?.[0].style?.textDecoration).toBeUndefined();
    expect(data.nodeData.children?.[0].children?.[0].tags?.[0]).toMatchObject({
      text: '',
      className: 'mindmap-progress-tag',
    });
    expect(JSON.stringify(state)).toBe(before);
    expect(canvasSignature(data)).not.toContain('完成后仍能记录问题');
  });

  it('does not show incomplete near-100 progress as completed', () => {
    let state = add(createInitialSnapshot(), 'leaf');
    state = applyCommand(state, { type: 'node.update', id: 'leaf', patch: { progress: 99.99 } });
    const node = buildCanvasData(state, SYSTEM_MAP_ID).nodeData.children![0];
    expect(node.style?.textDecoration).toBeUndefined();
    expect(node.tags?.[0]).toMatchObject({ text: '', className: 'mindmap-progress-tag' });
    expect(typeof node.tags?.[0] === 'object' && node.tags[0].style?.background).toContain('99.99%');
  });

  it('saves title edits as a field patch and preserves schedule, progress and notes', () => {
    let state = add(createInitialSnapshot(), 'leaf');
    state = applyCommand(state, {
      type: 'node.update',
      id: 'leaf',
      patch: {
        progress: 35,
        notes: { other: '保留备注' },
        schedule: { mode: 'range', start: '2026-11-13', end: '2026-11-20' },
      },
    });
    state = execute(
      state,
      operationCommands(
        { name: 'finishEdit', target: { id: 'leaf', topic: '导图中的新名称', metadata: { stale: true } } },
        SYSTEM_MAP_ID,
      ),
    );
    const node = state.nodes.find((item) => item.id === 'leaf')!;
    expect(node.title).toBe('导图中的新名称');
    expect(node.task?.progress).toBe(35);
    expect(node.task?.schedule).toEqual({ mode: 'range', start: '2026-11-13', end: '2026-11-20' });
    expect(node.notes.other).toBe('保留备注');
  });

  it('does not persist implicit core-created siblings outside the date dialog', () => {
    const root: NodeObj = { id: SYSTEM_ROOT_ID, topic: '草稿箱' };
    const inserted: NodeObj = { id: 'new', topic: '新的想法' };
    attach(root, [{ id: 'a', topic: 'a' }, inserted, { id: 'b', topic: 'b' }]);
    expect(operationCommands({ name: 'insertSibling', target: inserted }, SYSTEM_MAP_ID)).toEqual([]);
    expect(operationCommands({ name: 'addChild', target: inserted }, SYSTEM_MAP_ID)).toEqual([]);
  });

  it.each([
    { old: ['a', 'b', 'c', 'd'], next: ['c', 'd', 'a', 'b'], moved: ['b', 'a'], name: 'moveNodesAfter' },
    { old: ['a', 'b', 'c', 'd'], next: ['c', 'd', 'a', 'b'], moved: ['c', 'd'], name: 'moveNodesBefore' },
  ])('preserves final ordering when a group is moved ($name)', ({ old, next, moved, name }) => {
    let state = createInitialSnapshot();
    for (const id of old) state = add(state, id);
    const parent: NodeObj = { id: SYSTEM_ROOT_ID, topic: '我的待办' };
    const children = next.map((id) => ({ id, topic: id }));
    attach(parent, children);
    state = execute(
      state,
      operationCommands(
        { name, target: moved.map((id) => children.find((node) => node.id === id)!) },
        SYSTEM_MAP_ID,
      ),
    );
    expect(getChildren(state, SYSTEM_ROOT_ID).map((item) => item.id)).toEqual(next);
  });

  it('moves a task between parents without losing its identity or notes', () => {
    let state = add(add(add(createInitialSnapshot(), 'a'), 'b'), 'leaf', 'a');
    state = applyCommand(state, {
      type: 'node.update',
      id: 'leaf',
      patch: { notes: { progress: '阶段记录' } },
    });
    const parent: NodeObj = { id: 'b', topic: 'b' };
    const leaf: NodeObj = { id: 'leaf', topic: 'leaf' };
    attach(parent, [leaf]);
    state = execute(state, operationCommands({ name: 'moveNodesIn', target: [leaf] }, SYSTEM_MAP_ID));
    expect(state.nodes.find((node) => node.id === 'leaf')?.parentId).toBe('b');
    expect(state.nodes.find((node) => node.id === 'leaf')?.notes.progress).toBe('阶段记录');
  });

  it('recursively persists folding and omits cyclic parent pointers', () => {
    const root: NodeObj = { id: 'parent', topic: 'parent', expanded: false };
    attach(root, [{ id: 'leaf', topic: 'leaf', expanded: false }]);
    expect(operationCommands({ name: 'collapseNode', target: root, recursive: true }, SYSTEM_MAP_ID)).toEqual(
      [
        { type: 'node.update', id: 'parent', patch: { expanded: false } },
        { type: 'node.update', id: 'leaf', patch: { expanded: false } },
      ],
    );
    expect(() => canvasSignature({ nodeData: root })).not.toThrow();
  });

  it('ignores renderer-injected defaults so selection does not replace the topic DOM', () => {
    const plain: NodeObj = { id: 'parent', topic: 'parent', children: [{ id: 'leaf', topic: 'leaf' }] };
    const decorated: NodeObj = {
      ...plain,
      expanded: true,
      direction: 1,
      branchColor: '#5B8FF9',
      children: [{ id: 'leaf', topic: 'leaf', expanded: true, direction: 1, children: [] }],
    };
    decorated.children![0].parent = decorated;
    expect(canvasSignature({ nodeData: decorated })).toBe(canvasSignature({ nodeData: plain }));
  });

  it('does not trigger automatic fitting for progress or note changes', () => {
    let state = add(createInitialSnapshot(), 'leaf');
    const signature = canvasStructureSignature(state, SYSTEM_MAP_ID);
    state = applyCommand(state, {
      type: 'node.update',
      id: 'leaf',
      patch: { progress: 75, notes: { other: '追加记录' } },
    });
    expect(canvasStructureSignature(state, SYSTEM_MAP_ID)).toBe(signature);
    state = add(state, 'child', 'leaf');
    expect(canvasStructureSignature(state, SYSTEM_MAP_ID)).not.toBe(signature);
  });

  it('fits a wide map inside horizontal padding and reserves space for the footer', () => {
    const scale = fittedScale(1600, 500, 800, 600);
    expect(scale * 1600).toBeLessThanOrEqual(800 - 48);
    expect(scale * 500).toBeLessThanOrEqual(600 - 96);
    expect(scale).toBeLessThan(1);
  });

  it('does not enlarge a small map or crop a tall map at the previous 20% zoom limit', () => {
    expect(fittedScale(200, 100, 800, 600)).toBe(1);
    expect(fittedScale(300, 10000, 800, 600)).toBeLessThan(0.2);
  });

  it('reconstructs all surviving descendants after deleting a different branch and switching maps', () => {
    let state = add(
      add(add(add(createInitialSnapshot(), 'a'), 'b'), 'a-child', 'a'),
      'a-grandchild',
      'a-child',
    );
    state = applyCommand(state, { type: 'node.delete', id: 'b' });
    state = applyCommand(state, { type: 'map.create', id: 'project', rootId: 'project-root', title: '项目' });
    buildCanvasData(state, 'project');
    const tree = buildCanvasData(state, SYSTEM_MAP_ID).nodeData;
    expect(tree.children?.map((node) => node.id)).toEqual(['a']);
    expect(tree.children?.[0].children?.[0].children?.[0].id).toBe('a-grandchild');
    expect(tree.metadata.container).toBe(true);
  });

  it('returns null for deleted or detached topics without invoking the library finder', () => {
    const connected = { nodeObj: { id: 'present' }, isConnected: true };
    const detached = { nodeObj: { id: 'deleted' }, isConnected: false };
    const hidden = { nodeObj: { id: 'hidden-root' }, isConnected: true, getClientRects: () => [] };
    const host = { querySelectorAll: () => [connected, detached, hidden] } as unknown as ParentNode;
    expect(findRenderedTopic(host, 'deleted')).toBeNull();
    expect(findRenderedTopic(host, 'missing')).toBeNull();
    expect(findRenderedTopic(host, 'hidden-root')).toBeNull();
    expect(findRenderedTopic(host, 'present')).toBe(connected);
  });

  it('folds draft branches at visual depth while retaining the hidden compatibility root', () => {
    let state = add(add(add(createInitialSnapshot(), 'parent'), 'child', 'parent'), 'grandchild', 'child');
    const plan = expansionPlan(state, SYSTEM_MAP_ID, 'main', 'grandchild');
    expect(plan.selectedId).toBe('parent');
    state = execute(state, plan.commands);
    expect(state.nodes.find((node) => node.id === SYSTEM_ROOT_ID)?.expanded).toBe(true);
    expect(state.nodes.find((node) => node.id === 'parent')?.expanded).toBe(false);
    const two = expansionPlan(state, SYSTEM_MAP_ID, 'two', 'grandchild');
    expect(two.selectedId).toBe('child');
    state = execute(state, two.commands);
    expect(state.nodes.find((node) => node.id === 'parent')?.expanded).toBe(true);
    expect(state.nodes.find((node) => node.id === 'child')?.expanded).toBe(false);
  });

  it('does not show plan progress on a node explicitly removed from plans', () => {
    let state = add(createInitialSnapshot(), 'leaf');
    state = applyCommand(state, { type: 'node.update', id: 'leaf', patch: { planned: false } });
    expect(buildCanvasData(state, SYSTEM_MAP_ID).nodeData.children?.[0].tags).toBeUndefined();
  });

  it('represents progress as a visual bar with no numeric or completed label', () => {
    let state = add(createInitialSnapshot(), 'leaf');
    state = applyCommand(state, { type: 'node.update', id: 'leaf', patch: { progress: 100 } });
    const node = buildCanvasData(state, SYSTEM_MAP_ID).nodeData.children![0];
    expect(node.tags?.[0]).toMatchObject({ text: '', className: 'mindmap-progress-tag' });
    expect(node.style?.textDecoration).toBe('line-through 3px #E5B73D');
  });

  it.each(['light', 'dark'] as const)(
    'keeps every completed node typography and fill unchanged in the %s theme',
    (theme) => {
      let state = applyCommand(createInitialSnapshot(), {
        type: 'settings.update',
        patch: { theme, fontSize: 18 },
      });
      state = applyCommand(state, {
        type: 'map.create',
        id: 'project',
        rootId: 'root',
        title: '项目根节点',
      });
      for (const [id, parentId] of [
        ['main', 'root'],
        ['leaf', 'main'],
      ]) {
        state = applyCommand(state, {
          type: 'node.create',
          id,
          parentId,
          mapId: 'project',
          title: `较长中文事项 ${id}`,
          task: true,
        });
      }
      state = applyCommand(state, {
        type: 'node.convert',
        id: 'root',
        start: '2026-11-17',
        end: '2026-11-17',
      });
      const flatten = (node: NodeObj): NodeObj[] => [node, ...(node.children ?? []).flatMap(flatten)];
      const original = buildCanvasData(state, 'project');
      const originalNodes = flatten(original.nodeData);
      state = execute(
        state,
        originalNodes.map(({ id }) => ({
          type: 'node.update',
          id,
          patch: { progress: 100 },
        })),
      );
      const complete = buildCanvasData(state, 'project');
      flatten(complete.nodeData).forEach((node, index) => {
        const { textDecoration, ...style } = node.style!;
        expect(textDecoration).toBe(`line-through 3px ${theme === 'dark' ? '#F1C75B' : '#E5B73D'}`);
        expect(style).toEqual(originalNodes[index].style);
        expect(node.style?.fontSize).toBeUndefined();
      });
      expect(complete.theme).toEqual(original.theme);
      expect(canvasSignature(complete)).not.toBe(canvasSignature(original));
      state = execute(
        state,
        originalNodes.map(({ id }) => ({
          type: 'node.update',
          id,
          patch: { progress: 0 },
        })),
      );
      expect(canvasSignature(buildCanvasData(state, 'project'))).toBe(canvasSignature(original));
    },
  );

  it('uses the approved mist-blue branches with readable text in both themes', () => {
    const luminance = (hex: string) => {
      const rgb = hex
        .replace('#', '')
        .match(/../g)!
        .map((part) => parseInt(part, 16) / 255)
        .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
      return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    };
    let state = createInitialSnapshot();
    for (let index = 0; index < 5; index++) state = add(state, `branch-${index}`);
    state = add(state, 'child', 'branch-0');
    for (const theme of ['light', 'dark'] as const) {
      state = applyCommand(state, { type: 'settings.update', patch: { theme } });
      const root = buildCanvasData(state, SYSTEM_MAP_ID).nodeData;
      expect(new Set(root.children!.map((node) => node.branchColor))).toEqual(
        new Set([theme === 'dark' ? '#8EA9CC' : '#718BAD']),
      );
      for (const node of [...root.children!, root.children![0].children![0]]) {
        const front = luminance(node.style!.color!),
          back = luminance(node.style!.background!);
        expect((Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
