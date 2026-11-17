import { useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, KeyboardEvent, ReactNode } from 'react';
import {
  ChevronRight,
  Plus,
  MessageSquare,
  GitBranch,
  CalendarDays,
  Check,
  GripVertical,
} from 'lucide-react';
import type { Snapshot, Filter, Command, MindNode } from '../shared/types';
import {
  selectVisibleNodes,
  getProgress,
  getChildren,
  getDescendants,
  effectiveSchedule,
  dateStatus,
  isTaskLeaf,
  isProgressEditable,
} from '../shared/domain';
import { IconButton, EmptyState } from './components';

type DropPosition = 'before' | 'after' | 'inside';
interface Props {
  snapshot: Snapshot;
  filter: Filter;
  today: string;
  mapId?: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (parentId?: string) => void;
  onLocate: (id: string) => void;
  dispatch: (command: Command) => Promise<Snapshot>;
  compact?: boolean;
  search?: string;
}
const DRAG_TYPE = 'text/mindnote-node';

/** Search changes the projection only; progress and dates always use the complete snapshot. */
export default function TaskTree({
  snapshot,
  filter,
  today,
  mapId,
  selectedId,
  onSelect,
  onAdd,
  onLocate,
  dispatch,
  compact = false,
  search = '',
}: Props) {
  const tree = useRef<HTMLDivElement>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; where: DropPosition } | null>(null);
  const query = search.trim().toLocaleLowerCase();
  const byId = useMemo(() => new Map(snapshot.nodes.map((node) => [node.id, node])), [snapshot]);
  const visible = useMemo(() => {
    const base = selectVisibleNodes(snapshot, filter, today, mapId);
    if (!query) return base;
    const matchedIds = new Set<string>();
    const visibleIds = new Set<string>();
    for (const node of base.nodes) {
      if (
        !base.matchedIds.has(node.id) ||
        ![node.title, ...Object.values(node.notes)].some((text) => text.toLocaleLowerCase().includes(query))
      )
        continue;
      matchedIds.add(node.id);
      let ancestor: MindNode | undefined = node;
      while (ancestor && !visibleIds.has(ancestor.id)) {
        visibleIds.add(ancestor.id);
        ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined;
      }
    }
    return { nodes: base.nodes.filter((node) => visibleIds.has(node.id)), matchedIds };
  }, [snapshot, filter, today, mapId, query, byId]);
  const visibleIds = useMemo(() => new Set(visible.nodes.map((node) => node.id)), [visible]);
  const childrenById = useMemo(() => {
    const result = new Map<string, MindNode[]>();
    for (const node of visible.nodes)
      if (node.parentId) {
        const children = result.get(node.parentId) ?? [];
        children.push(node);
        result.set(node.parentId, children);
      }
    for (const children of result.values())
      children.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    return result;
  }, [visible]);
  const forbiddenTargets = useMemo(
    () =>
      dragged
        ? new Set([dragged, ...getDescendants(snapshot, dragged).map((node) => node.id)])
        : new Set<string>(),
    [snapshot, dragged],
  );
  const matched = visible.nodes.filter((node) => node.task && visible.matchedIds.has(node.id));
  const fire = (command: Command) => {
    void dispatch(command).catch(() => {
      /* App displays and retains the error. */
    });
  };

  function rowElements(): HTMLElement[] {
    return [...(tree.current?.querySelectorAll<HTMLElement>('[data-task-node]') ?? [])];
  }
  function focusNode(id: string | null) {
    rowElements()
      .find((element) => element.dataset.taskNode === id)
      ?.focus();
  }
  function dropPosition(event: DragEvent, target: MindNode): DropPosition {
    if (!target.parentId) return 'inside';
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - bounds.top) / bounds.height;
    return ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside';
  }
  function canDrop(target: MindNode): boolean {
    const source = dragged ? byId.get(dragged) : undefined;
    return !!source?.parentId && source.mapId === target.mapId && !forbiddenTargets.has(target.id);
  }
  function moveRelative(sourceId: string, target: MindNode, where: DropPosition) {
    const source = byId.get(sourceId);
    if (!source?.parentId || source.mapId !== target.mapId || source.id === target.id) return;
    if (getDescendants(snapshot, source.id).some((node) => node.id === target.id)) return;
    const parentId = where === 'inside' ? target.id : target.parentId;
    if (!parentId) return;
    const siblings = getChildren(snapshot, parentId).filter((node) => node.id !== source.id);
    const position =
      where === 'inside'
        ? siblings.length
        : siblings.findIndex((node) => node.id === target.id) + (where === 'after' ? 1 : 0);
    if (position < 0) return;
    fire({ type: 'node.move', id: source.id, parentId, index: position });
  }
  function keyboard(
    event: KeyboardEvent<HTMLDivElement>,
    node: MindNode,
    children: MindNode[],
    expanded: boolean,
  ) {
    if (event.target !== event.currentTarget) return;
    const siblings = node.parentId ? getChildren(snapshot, node.parentId) : [];
    const position = siblings.findIndex((sibling) => sibling.id === node.id);
    if (event.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (!node.parentId) return;
      if (event.key === 'ArrowUp' && position > 0) moveRelative(node.id, siblings[position - 1], 'before');
      if (event.key === 'ArrowDown' && position >= 0 && position < siblings.length - 1)
        moveRelative(node.id, siblings[position + 1], 'after');
      if (event.key === 'ArrowRight' && position > 0) moveRelative(node.id, siblings[position - 1], 'inside');
      if (event.key === 'ArrowLeft') {
        const parent = byId.get(node.parentId);
        if (parent?.parentId) moveRelative(node.id, parent, 'after');
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      onSelect(node.id);
    } else if (event.key === ' ') {
      event.preventDefault();
      if (isProgressEditable(snapshot, node.id))
        fire({
          type: 'node.update',
          id: node.id,
          patch: { progress: getProgress(snapshot, node.id) >= 100 ? 0 : 100 },
        });
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (children.length && !expanded) fire({ type: 'node.update', id: node.id, patch: { expanded: true } });
      else if (children.length) focusNode(children[0].id);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (children.length && expanded && !query)
        fire({ type: 'node.update', id: node.id, patch: { expanded: false } });
      else focusNode(node.parentId);
    } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const rows = rowElements();
      const current = rows.indexOf(event.currentTarget);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? rows.length - 1
            : current + (event.key === 'ArrowDown' ? 1 : -1);
      rows[next]?.focus();
    }
  }
  function dateLabel(start: string, end: string): string {
    const includeYear = start.slice(0, 4) !== today.slice(0, 4) || end.slice(0, 4) !== today.slice(0, 4);
    const label = (value: string) => (includeYear ? value : value.slice(5)).replaceAll('-', '/');
    return start === end ? label(end) : `${label(start)} – ${label(end)}`;
  }
  function renderNode(node: MindNode, depth: number): ReactNode {
    if (!visibleIds.has(node.id)) return null;
    const children = childrenById.get(node.id) ?? [],
      allChildren = getChildren(snapshot, node.id);
    const progress = node.task ? getProgress(snapshot, node.id) : 0,
      complete = !!node.task && progress >= 100;
    const context = !visible.matchedIds.has(node.id),
      leaf = isTaskLeaf(snapshot, node.id), editable = isProgressEditable(snapshot, node.id);
    const schedule = effectiveSchedule(snapshot, node.id),
      status = node.task ? dateStatus(snapshot, node.id, today) : 'none';
    const note = Object.values(node.notes).some(Boolean),
      expanded = !!query || node.expanded;
    const percent = complete ? 100 : Math.min(99.9, Math.round(progress * 10) / 10);
    return (
      <div
        key={node.id}
        role="treeitem"
        tabIndex={0}
        data-task-node={node.id}
        aria-label={`${node.title}${node.task ? `，进度 ${percent}%` : ''}${context ? '，上级事项' : ''}`}
        aria-expanded={children.length ? expanded : undefined}
        aria-selected={selectedId === node.id}
        aria-level={depth + 1}
        onFocus={(event) => {
          if (event.target === event.currentTarget) onSelect(node.id);
        }}
        onKeyDown={(event) => keyboard(event, node, children, expanded)}
      >
        <div
          className={`task-row ${selectedId === node.id ? 'selected' : ''} ${complete ? 'completed' : ''} ${context ? 'context' : ''} ${drop?.id === node.id ? `drop-${drop.where}` : ''}`}
          style={{ '--depth': Math.min(depth, compact ? 5 : 10) } as CSSProperties}
          onDragOver={(event) => {
            if (canDrop(node)) {
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = 'move';
              setDrop({ id: node.id, where: dropPosition(event, node) });
            }
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null))
              setDrop((current) => (current?.id === node.id ? null : current));
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setDrop(null);
            if (!canDrop(node)) return;
            const id = event.dataTransfer.getData(DRAG_TYPE);
            if (id === dragged) moveRelative(id, node, dropPosition(event, node));
            setDragged(null);
          }}
          onClick={() => onSelect(node.id)}
        >
          <span
            className={`row-grip ${!node.parentId ? 'invisible' : ''}`}
            draggable={!!node.parentId}
            title="拖到中间设为子项，拖到边缘调整顺序；Alt+方向键也可调整层级和顺序"
            onDragStart={(event) => {
              event.stopPropagation();
              if (!node.parentId) {
                event.preventDefault();
                return;
              }
              setDragged(node.id);
              event.dataTransfer.setData(DRAG_TYPE, node.id);
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => {
              setDragged(null);
              setDrop(null);
            }}
          >
            <GripVertical size={12} />
          </span>
          <button
            type="button"
            className={`expand-button ${expanded ? 'expanded' : ''} ${!children.length ? 'invisible' : ''}`}
            disabled={!children.length || !!query}
            tabIndex={children.length ? 0 : -1}
            title={query ? '搜索结果自动展开' : undefined}
            aria-label={`${expanded ? '折叠' : '展开'} ${node.title}`}
            onClick={(event) => {
              event.stopPropagation();
              fire({ type: 'node.update', id: node.id, patch: { expanded: !expanded } });
            }}
          >
            <ChevronRight size={14} />
          </button>
          {node.task ? (
            <button
              type="button"
              className={`task-check ${complete ? 'checked' : ''}`}
              role="checkbox"
              aria-checked={complete}
              aria-label={
                `${complete ? '取消完成' : '完成'} ${node.title}`
              }
              disabled={!editable}
              title={complete ? '取消完成' : '标记完成'}
              onClick={(event) => {
                event.stopPropagation();
                fire({ type: 'node.update', id: node.id, patch: { progress: complete ? 0 : 100 } });
              }}
            >
              {complete && <Check size={12} strokeWidth={3} />}
            </button>
          ) : (
            <GitBranch size={15} className="context-icon" />
          )}
          <div className="task-content">
            <span className="task-title">{node.title}</span>
            <div className="task-meta">
              {schedule && (
                <span className={`date-tag ${status}`} title={`${schedule.start} 至 ${schedule.end}`}>
                  <CalendarDays size={10} />
                  {status === 'overdue' ? '逾期 · ' : status === 'today' ? '今天到期 · ' : ''}
                  {dateLabel(schedule.start, schedule.end)}
                </span>
              )}
              {!leaf && node.task && <span>{allChildren.length} 个子事项</span>}
              {note && <MessageSquare size={11} aria-label="有备注" />}
            </div>
          </div>
          {node.task && (
            <span className={`row-progress ${complete ? 'done' : ''}`}>
              {percent}
              <small>%</small>
            </span>
          )}
          <span
            className="row-actions"
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <IconButton title={`为 ${node.title} 添加子事项`} onClick={() => onAdd(node.id)}>
              <Plus size={14} />
            </IconButton>
            <IconButton title={`在导图中查看 ${node.title}`} onClick={() => onLocate(node.id)}>
              <GitBranch size={14} />
            </IconButton>
          </span>
        </div>
        {expanded && children.length > 0 && (
          <div role="group">{children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  }

  if (!matched.length)
    return (
      <EmptyState
        title={query ? '没有找到匹配事项' : filter === 'inbox' ? '给灵感一个落脚点' : '留一点空间，给下一步'}
        detail={
          query
            ? '换个关键词，或切换计划范围再试试。'
            : filter === 'inbox'
              ? '暂未安排日期的事项，会在这里等你。'
              : '写下一件小事，让想法慢慢成为行动。'
        }
      >
        {!query && (
          <button className="button primary" onClick={() => onAdd()}>
            <Plus size={15} />
            添加事项
          </button>
        )}
      </EmptyState>
    );
  return (
    <div className={`task-tree ${compact ? 'compact' : ''}`} role="tree" aria-label="层级待办" ref={tree}>
      {snapshot.maps
        .filter((map) => !mapId || map.id === mapId)
        .map((map) => {
          const roots = childrenById.get(map.rootId) ?? [],
            root = byId.get(map.rootId);
          if (!roots.length && (!root?.task || !visibleIds.has(root.id))) return null;
          return (
            <section className="task-group" key={map.id} role="presentation">
              {!compact && (
                <div className="task-group-heading" role="presentation">
                  <span>{map.title}</span>
                  <span>{matched.filter((node) => node.mapId === map.id).length} 项</span>
                </div>
              )}
              {root?.task ? renderNode(root, 0) : roots.map((node) => renderNode(node, 0))}
            </section>
          );
        })}
    </div>
  );
}
