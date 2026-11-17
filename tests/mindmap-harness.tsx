import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import MindMapCanvas from '../src/renderer/MindMapCanvas';
import { applyCommand, createInitialSnapshot, SYSTEM_MAP_ID, SYSTEM_ROOT_ID } from '../src/shared/domain';
import type { Command, Snapshot } from '../src/shared/types';

const seed: Command[] = [
  {
    type: 'node.create',
    id: 'branch-a',
    mapId: SYSTEM_MAP_ID,
    parentId: SYSTEM_ROOT_ID,
    title: '第一张独立思维分支',
  },
  {
    type: 'node.create',
    id: 'child-a',
    mapId: SYSTEM_MAP_ID,
    parentId: 'branch-a',
    title: '缩放后仍准确编辑的子节点',
  },
  {
    type: 'node.create',
    id: 'grandchild-a',
    mapId: SYSTEM_MAP_ID,
    parentId: 'child-a',
    title: '切换后保留的第三层节点',
  },
  {
    type: 'node.create',
    id: 'branch-b',
    mapId: SYSTEM_MAP_ID,
    parentId: SYSTEM_ROOT_ID,
    title: '删除测试分支',
  },
  { type: 'map.create', id: 'project-b', rootId: 'project-b-root', title: '另一张项目导图' },
  {
    type: 'node.create',
    id: 'project-b-child',
    mapId: 'project-b',
    parentId: 'project-b-root',
    title: '项目子节点',
  },
];
function Harness() {
  const [snapshot, setSnapshot] = useState(() => seed.reduce(applyCommand, createInitialSnapshot()));
  const stateRef = useRef(snapshot);
  stateRef.current = snapshot;
  const [mapId, setMapId] = useState(SYSTEM_MAP_ID);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const actions = useRef<unknown[]>([]),
    errors = useRef<string[]>([]);
  const dispatch = async (command: Command): Promise<Snapshot> => {
    actions.current.push(command);
    const next = applyCommand(stateRef.current, command);
    stateRef.current = next;
    setSnapshot(next);
    return next;
  };
  Object.assign(window, {
    mindmapHarness: {
      state: () => stateRef.current,
      actions: () => actions.current,
      errors: () => errors.current,
      selected: () => selectedId,
      dispatch,
      switchTo: (id: string) => {
        setMapId(id);
        setSelectedId(null);
      },
      select: (id: string) => {
        const node = stateRef.current.nodes.find((node) => node.id === id);
        if (node) setMapId(node.mapId);
        setSelectedId(id);
      },
    },
  });
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: snapshot.settings.theme === 'dark' ? '#142035' : '#f9fafc',
        fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif',
      }}
    >
      <MindMapCanvas
        snapshot={snapshot}
        mapId={mapId}
        selectedId={selectedId}
        onSelect={setSelectedId}
        dispatch={dispatch}
        onError={(message) => errors.current.push(message)}
        onAdd={(id, sibling) => actions.current.push({ callback: 'add', id, sibling })}
        onPlan={(id) => actions.current.push({ callback: 'plan', id })}
      />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Harness />);
