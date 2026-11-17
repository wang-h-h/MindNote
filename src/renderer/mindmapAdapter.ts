import type { MindElixirData, NodeObj, Theme } from 'mind-elixir';
import type { Command, Snapshot, ThemeName } from '../shared/types';
import { getProgress } from '../shared/domain';

const colors = {
  light: {
    accent: '#294574',
    pale: '#EAF0F7',
    ink: '#273448',
    panel: '#FFFFFF',
    border: '#718BAD',
    branches: ['#718BAD'],
  },
  dark: {
    accent: '#A9C6EF',
    pale: '#283B53',
    ink: '#F2F4F8',
    panel: '#2B3341',
    border: '#8EA9CC',
    branches: ['#8EA9CC'],
  },
};

export function canvasTheme(name: ThemeName): Theme {
  const dark = name === 'dark';
  const { accent, pale, ink, panel, border, branches } = colors[dark ? 'dark' : 'light'];
  return {
    name: `mindnote-${name}`,
    type: dark ? 'dark' : 'light',
    palette: branches,
    cssVar: {
      '--main-color': ink,
      '--main-bgcolor': pale,
      '--main-bgcolor-transparent': pale,
      '--color': ink,
      '--bgcolor': 'transparent',
      '--selected': accent,
      '--accent-color': accent,
      '--root-color': '#ffffff',
      '--root-bgcolor': dark ? '#44699B' : '#294574',
      '--root-border-color': 'transparent',
      '--root-radius': '18px',
      '--main-radius': '12px',
      '--topic-padding': '11px 17px',
      '--main-gap-x': '44px',
      '--main-gap-y': '18px',
      '--node-gap-x': '30px',
      '--node-gap-y': '14px',
      '--panel-color': ink,
      '--panel-bgcolor': panel,
      '--panel-border-color': border,
      '--map-padding': '36px',
    },
  };
}

/** Business properties are derived for display only; the library never owns task state. */
export function buildCanvasData(snapshot: Snapshot, mapId: string): MindElixirData {
  const map = snapshot.maps.find((item) => item.id === mapId);
  if (!map) throw new Error('这张导图已不存在');
  const nodes = snapshot.nodes.filter((node) => node.mapId === mapId);
  const children = new Map<string, typeof nodes>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const list = children.get(node.parentId) || [];
    list.push(node);
    children.set(node.parentId, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.order - b.order);
  const root = nodes.find((node) => node.id === map.rootId);
  if (!root) throw new Error('导图根节点缺失');
  const dark = snapshot.settings.theme === 'dark',
    palette = colors[dark ? 'dark' : 'light'];
  const project = (node: typeof root, branchColor = palette.accent, index = 0): NodeObj => {
    const main = node.parentId === map.rootId;
    if (main) branchColor = palette.branches[index % palette.branches.length];
    const value = node.task ? getProgress(snapshot, node.id) : 0;
    const done = !!node.task && value === 100;
    const completedDecoration = `line-through 3px ${dark ? '#F1C75B' : '#E5B73D'}`;
    const childNodes = (children.get(node.id) || []).map((child, childIndex) =>
      project(child, branchColor, childIndex),
    );
    return {
      id: node.id,
      topic: node.title,
      expanded: node.expanded,
      ...(node.parentId
        ? {
            branchColor,
            style: {
              background: main ? palette.pale : palette.panel,
              color: palette.ink,
              border: `1px solid ${main ? branchColor : palette.border}`,
              fontWeight: main ? '600' : '400',
              ...(done && node.task?.planned ? { textDecoration: completedDecoration } : {}),
            },
          }
        : { style: done && node.task?.planned ? { textDecoration: completedDecoration } : {} }),
      ...(node.direction === 0 || node.direction === 1 ? { direction: node.direction } : {}),
      ...(childNodes.length ? { children: childNodes } : {}),
      ...(node.task?.planned
        ? {
            tags: [
              {
                text: '',
                className: 'mindmap-progress-tag',
                style: {
                  display: 'block',
                  width: '44px',
                  height: '4px',
                  padding: '0',
                  borderRadius: '4px',
                  background: `linear-gradient(90deg, #C6A452 ${value}%, ${dark ? '#50617A' : '#D5DFEA'} ${value}%)`,
                },
              },
            ],
          }
        : {}),
      metadata: { mindnoteNodeId: node.id, container: map.system && node.id === root.id },
    };
  };
  return { nodeData: project(root), direction: 1, theme: canvasTheme(snapshot.settings.theme) };
}

export interface CanvasOperation {
  name: string;
  target: NodeObj | NodeObj[];
  recursive?: boolean;
  silent?: boolean;
}

/** Translate only the fields touched by an operation, never a whole stale library snapshot. */
export function operationCommands(operation: CanvasOperation, mapId: string): Command[] {
  if (operation.silent || operation.name === 'beginEdit') return [];
  const targets = Array.isArray(operation.target) ? operation.target : [operation.target];
  const first = targets[0];
  if (!first) return [];
  if (operation.name === 'finishEdit') {
    return [{ type: 'node.update', id: first.id, patch: { title: first.topic } }];
  }
  // Creation is intentionally owned by the application date dialog. The core
  // must never silently manufacture an unscheduled task from its own menu.
  if (operation.name === 'addChild' || operation.name === 'insertSibling') return [];
  if (operation.name === 'removeNodes') {
    return targets.filter((node) => node.parent).map((node) => ({ type: 'node.delete', id: node.id }));
  }
  if (['moveNodesIn', 'moveNodesBefore', 'moveNodesAfter'].includes(operation.name)) {
    // Reordering only the dragged group is insufficient: moving [A,B] after D
    // shifts B's old index while A is being placed. Reconcile the affected
    // sibling order from its first slot, without copying any business fields.
    const parents = new Map<string, NodeObj>();
    for (const node of targets) if (node.parent) parents.set(node.parent.id, node.parent);
    const commands: Command[] = [];
    for (const parent of parents.values()) {
      parent.children?.forEach((node, index) => {
        commands.push({ type: 'node.move', id: node.id, parentId: parent.id, index });
      });
      commands.push({ type: 'node.update', id: parent.id, patch: { expanded: true } });
    }
    for (const node of targets) {
      if (node.direction === 0 || node.direction === 1) {
        commands.push({ type: 'node.update', id: node.id, patch: { direction: node.direction } });
      }
    }
    return commands;
  }
  if (operation.name === 'expandNode' || operation.name === 'collapseNode') {
    const commands: Command[] = [];
    const visit = (node: NodeObj) => {
      commands.push({ type: 'node.update', id: node.id, patch: { expanded: node.expanded !== false } });
      if (operation.recursive) node.children?.forEach(visit);
    };
    targets.forEach(visit);
    return commands;
  }
  return [];
}

/** Resolve DOM nodes without calling Core's throwing/logging findEle on stale IDs. */
export function findRenderedTopic(container: ParentNode, id: string): import('mind-elixir').Topic | null {
  const topics = container.querySelectorAll<HTMLElement>('.me-tpc');
  for (const element of topics) {
    const topic = element as import('mind-elixir').Topic;
    if (
      topic.nodeObj?.id === id &&
      topic.isConnected &&
      (!topic.getClientRects || topic.getClientRects().length > 0)
    )
      return topic;
  }
  return null;
}

export function expansionPlan(
  snapshot: Snapshot,
  mapId: string,
  level: 'main' | 'two' | 'all',
  selectedId: string | null,
): { commands: Command[]; selectedId: string | null } {
  const map = snapshot.maps.find((item) => item.id === mapId);
  if (!map) return { commands: [], selectedId: null };
  const index = new Map(snapshot.nodes.filter((node) => node.mapId === mapId).map((node) => [node.id, node]));
  const depth = (id: string): number => {
    let node = index.get(id),
      value = map.system ? -1 : 0;
    while (node?.parentId) {
      value++;
      node = index.get(node.parentId);
    }
    return value;
  };
  const visibleDepth = level === 'main' ? 0 : level === 'two' ? 1 : Infinity;
  const commands: Command[] = [];
  for (const node of index.values()) {
    const expanded = level === 'all' || depth(node.id) < visibleDepth;
    if (node.expanded !== expanded) commands.push({ type: 'node.update', id: node.id, patch: { expanded } });
  }
  let selected = selectedId ? index.get(selectedId) : undefined;
  while (selected?.parentId && depth(selected.id) > visibleDepth) selected = index.get(selected.parentId);
  return { commands, selectedId: selected?.id ?? null };
}

/** Parent pointers are library-internal cycles and must not enter comparison or IPC. */
export function canvasSignature(data: MindElixirData): string {
  // Rendering may add parent pointers, directions and branch colors. Comparing
  // those transient defaults to our projection would replace the DOM after a
  // harmless focus change, interrupting a native double-click gesture.
  const normalize = (node: NodeObj): unknown => [
    node.id,
    node.topic,
    node.expanded !== false,
    node.direction ?? 1,
    node.tags ?? [],
    node.style?.textDecoration ?? '',
    node.style?.color ?? '',
    node.style?.background ?? '',
    node.style?.border ?? '',
    node.style?.fontWeight ?? '',
    (node.children ?? []).map(normalize),
  ];
  return JSON.stringify(normalize(data.nodeData));
}

/** Structural fingerprint for tests/tools; edits never trigger automatic fitting. */
export function canvasStructureSignature(snapshot: Snapshot, mapId: string): string {
  return JSON.stringify(
    snapshot.nodes
      .filter((node) => node.mapId === mapId)
      .map((node) => [node.id, node.parentId, node.order, node.title, node.expanded, node.direction ?? 1]),
  );
}

export function fittedScale(
  contentWidth: number,
  contentHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): number {
  const usableWidth = Math.max(1, viewportWidth - 48);
  const usableHeight = Math.max(1, viewportHeight - 96);
  return Math.max(
    0.001,
    Math.min(1, usableWidth / Math.max(1, contentWidth), usableHeight / Math.max(1, contentHeight)),
  );
}
