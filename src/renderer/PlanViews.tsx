import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ChevronDown, Plus, ArrowUpRight } from 'lucide-react';
import type { Snapshot, MindNode, Command, Filter } from '../shared/types';
import {
  effectiveSchedule,
  getProgress,
  isNodeInPlanRange,
  localDate,
  periodRange,
  selectPlanNodes,
  type DateRange,
} from '../shared/domain';
import { EmptyState, IconButton } from './components';

export function shiftDay(day: string, delta: number) {
  const d = new Date(day + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  return localDate(d);
}
export function planDateText(range: DateRange | null, today = localDate()): string {
  if (!range) return '未安排';
  const short = (date: string, year: boolean) => date.slice(year ? 2 : 5).replaceAll('-', '/');
  const currentYear = today.slice(0, 4);
  const crossYear = range.start.slice(0, 4) !== range.end.slice(0, 4);
  const start = short(range.start, crossYear || range.start.slice(0, 4) !== currentYear);
  if (range.start === range.end) return start;
  return `${start}–${short(range.end, crossYear)}`;
}
export function selectPlanViewNodes(
  snapshot: Snapshot,
  filter: Filter,
  today = localDate(),
  status: 'all' | 'active' | 'finished' = 'all',
): MindNode[] {
  // Explicitly opening the archive is more specific than the global hide switch.
  // Keep that preference unchanged for all other views and windows.
  const source =
    filter === 'all' && status === 'finished' && snapshot.settings.hideCompleted
      ? { ...snapshot, settings: { ...snapshot.settings, hideCompleted: false } }
      : snapshot;
  return selectPlanNodes(source, filter, today).filter(
    (node) =>
      filter !== 'all' || status === 'all' || (node.task?.progress ?? 0) >= 100 === (status === 'finished'),
  );
}

export function adjacentPlanWeeks(today = localDate()) {
  return ([-1, 0, 1] as const).map((offset, index) => ({
    key: (['previous', 'current', 'next'] as const)[index],
    label: ['上周', '本周', '下周'][index],
    ...periodRange('week', shiftDay(today, offset * 7))!,
  }));
}
export function progressTone(state: Snapshot, node: MindNode, today = localDate()) {
  const p = node.task?.progress ?? getProgress(state, node.id),
    r = effectiveSchedule(state, node.id);
  if (p >= 100) return 'finished';
  if (!r) return 'calm';
  const days = Math.round(
    (new Date(r.end + 'T12:00:00').getTime() - new Date(today + 'T12:00:00').getTime()) / 86400000,
  );
  if (days < 0 || (days === 0 && p < 80)) return 'urgent';
  if (days <= 2 && p < 80) return 'soon';
  return 'calm';
}
export function ProgressSlider({
  snapshot,
  node,
  dispatch,
}: {
  snapshot: Snapshot;
  node: MindNode;
  dispatch: (c: Command) => Promise<Snapshot>;
}) {
  const progress = getProgress(snapshot, node.id);
  const [value, setValue] = useState(progress);
  const active = useRef(false),
    dirty = useRef(false),
    pending = useRef(false),
    requested = useRef(false),
    mounted = useRef(true),
    authoritative = useRef({ revision: snapshot.revision, progress }),
    draft = useRef(progress);
  const drainRef = useRef<() => Promise<void>>(async () => {});
  // A command result may arrive before React has rendered its broadcast. Never
  // let an older prop roll that acknowledged value back during this interval.
  if (snapshot.revision >= authoritative.current.revision)
    authoritative.current = { revision: snapshot.revision, progress };
  const display = (next: number) => {
    draft.current = next;
    if (mounted.current) setValue(next);
  };
  const reconcile = () => {
    if (!active.current && !pending.current && !dirty.current) display(authoritative.current.progress);
  };
  useEffect(() => {
    reconcile();
  }, [snapshot.revision, progress]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const drain = async () => {
    if (pending.current || active.current || !requested.current) return;
    requested.current = false;
    if (!dirty.current) {
      reconcile();
      return;
    }
    const submitted = draft.current;
    if (submitted === authoritative.current.progress) {
      dirty.current = false;
      reconcile();
      return;
    }
    pending.current = true;
    try {
      const result = await dispatch({ type: 'node.update', id: node.id, patch: { progress: submitted } });
      const resultNode = result.nodes.find((item) => item.id === node.id);
      if (resultNode?.task && result.revision >= authoritative.current.revision)
        authoritative.current = { revision: result.revision, progress: resultNode.task.progress };
      if (draft.current === submitted) dirty.current = false;
    } catch {
      // App reports the error. A later drag stays queued instead of being reset
      // by a failed earlier request.
      if (draft.current === submitted) dirty.current = false;
    } finally {
      pending.current = false;
      if (!dirty.current) requested.current = false;
      if (!active.current && requested.current && dirty.current) void drainRef.current();
      else reconcile();
    }
  };
  drainRef.current = drain;
  const save = (next: number) => {
    active.current = false;
    // Merely tabbing through a legacy fractional value must not snap/write it.
    if (!dirty.current) {
      reconcile();
      return;
    }
    const snapped = Math.round(next / 10) * 10;
    display(snapped);
    requested.current = true;
    void drainRef.current();
  };
  return (
    <div
      className={`progress-slider ${progressTone(snapshot, { ...node, task: node.task ? { ...node.task, progress: value } : null })}`}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        aria-label={`${node.title}进度`}
        aria-valuetext={`进度 ${Math.round(value)}%`}
        type="range"
        min="0"
        max="100"
        step="10"
        value={value}
        style={{ '--fill': `${value}%` } as React.CSSProperties}
        onPointerDown={() => {
          active.current = true;
        }}
        onChange={(e) => {
          active.current = true;
          const next = Number(e.target.value);
          if (next === draft.current) return;
          dirty.current = true;
          display(next);
        }}
        onPointerUp={(e) => save(Number(e.currentTarget.value))}
        onPointerCancel={() => save(draft.current)}
        onKeyUp={(e) => {
          if (
            ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(
              e.key,
            )
          )
            save(Number(e.currentTarget.value));
        }}
        onBlur={() => save(draft.current)}
        onWheel={(e) => e.currentTarget.blur()}
      />
      <span className="progress-value" aria-hidden="true">
        {Math.round(value)}%
      </span>
    </div>
  );
}
export function PlanItem({
  snapshot,
  node,
  dispatch,
  onSelect,
  onLocate,
  card = false,
}: {
  snapshot: Snapshot;
  node: MindNode;
  dispatch: (c: Command) => Promise<Snapshot>;
  onSelect: (id: string) => void;
  onLocate: (id: string) => void;
  card?: boolean;
}) {
  const range = effectiveSchedule(snapshot, node.id),
    done = getProgress(snapshot, node.id) >= 100,
    map = snapshot.maps.find((m) => m.id === node.mapId)!;
  const dateLabel = range
    ? range.start === range.end
      ? range.start
      : `${range.start} 至 ${range.end}`
    : '未安排';
  const due = !done && !!range && range.end <= localDate();
  return (
    <article
      className={`${card ? 'note-card plan-note' : 'plan-item'} ${done ? 'done' : ''} plan-item-v11 ${card ? (progressTone(snapshot, node) === 'urgent' ? 'note-yellow' : map.system ? 'note-gray' : 'note-blue') : ''}`}
      data-task-id={node.id}
    >
      <div className="plan-item-top">
        <button
          className="task-open"
          draggable
          onDragStart={(e) => e.dataTransfer.setData('text/mindnote-task', node.id)}
          onClick={() => onSelect(node.id)}
        >
          <strong title={node.title}>{node.title}</strong>
        </button>
        <span className="project-tag" title={map.title}>
          {map.title}
        </span>
        <div className="plan-item-actions">
          <IconButton title={`在导图中查看 ${node.title}`} onClick={() => onLocate(node.id)}>
            <ArrowUpRight size={15} />
          </IconButton>
          <IconButton title={`展开 ${node.title}`} onClick={() => onSelect(node.id)}>
            <ChevronRight size={15} />
          </IconButton>
        </div>
      </div>
      <div className="plan-item-bottom">
        <span className={`plan-date${due ? ' is-due' : ''}`} title={dateLabel}>
          <CalendarDays size={12} />
          <span>{planDateText(range)}</span>
        </span>
        <ProgressSlider snapshot={snapshot} node={node} dispatch={dispatch} />
      </div>
      {card && Object.values(node.notes).some((text) => text.trim()) && (
        <div className="plan-note-body">
          {(
            [
              ['progress', '进展'],
              ['problems', '问题'],
              ['other', '备注'],
            ] as const
          ).map(([kind, label]) =>
            node.notes[kind].trim() ? (
              <section className="plan-note-field" data-note-kind={kind} key={kind}>
                <h3>{label}</h3>
                <p>{node.notes[kind]}</p>
              </section>
            ) : null,
          )}
        </div>
      )}
    </article>
  );
}

/** Input is already in plan priority order. First appearance ranks each group,
 * while preserving that same order within its project. */
export function groupPlanNodes(nodes: MindNode[]): { mapId: string; nodes: MindNode[] }[] {
  const groups = new Map<string, MindNode[]>();
  for (const node of nodes) {
    const group = groups.get(node.mapId);
    if (group) group.push(node);
    else groups.set(node.mapId, [node]);
  }
  return Array.from(groups, ([mapId, items]) => ({ mapId, nodes: items }));
}

/** A completion should only displace an item when the current list needs scrolling.
 * Geometry-only changes never reorder an already displayed list. */
export function resolvePlanOrder(
  previousIds: readonly string[],
  canonical: readonly MindNode[],
  previousCompletion: ReadonlyMap<string, boolean>,
  overflowing: boolean,
  collapsedProjects: ReadonlySet<string> = new Set(),
): string[] {
  const changedCompletion = canonical.some(
    (node) =>
      !collapsedProjects.has(node.mapId) &&
      previousCompletion.has(node.id) &&
      previousCompletion.get(node.id) !== (node.task?.progress ?? 0) >= 100,
  );
  const flatten = (items: readonly MindNode[]) =>
    groupPlanNodes([...items]).flatMap((group) => group.nodes.map((node) => node.id));
  if (overflowing && changedCompletion) return flatten(canonical);
  const available = new Set(canonical.map((node) => node.id));
  const stable = previousIds.filter((id) => available.delete(id));
  const byId = new Map(canonical.map((node) => [node.id, node]));
  return flatten([
    ...stable.map((id) => byId.get(id)!),
    ...canonical.filter((node) => available.has(node.id)),
  ]);
}

/** Inspect actual scroll boxes, including the viewport around a week column and
 * the horizontal track of a narrow card grid. Scrolling position is irrelevant. */
export function isPlanOverflowing(element: HTMLElement): boolean {
  const boxes: HTMLElement[] = [element, ...element.querySelectorAll<HTMLElement>('.plan-project-grid')];
  for (let parent = element.parentElement; parent; parent = parent.parentElement) boxes.push(parent);
  return boxes.some((box) => {
    if (!box.clientWidth || !box.clientHeight) return false;
    const style = getComputedStyle(box);
    const scrolls = (value: string) => /auto|scroll|overlay/.test(value);
    return (
      (scrolls(style.overflowY) && box.scrollHeight > box.clientHeight + 2) ||
      (scrolls(style.overflowX) && box.scrollWidth > box.clientWidth + 2)
    );
  });
}

export function ProjectGroups({
  snapshot,
  nodes,
  render,
  card = false,
}: {
  snapshot: Snapshot;
  nodes: MindNode[];
  render: (node: MindNode, card?: boolean) => React.ReactNode;
  card?: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [order, setOrder] = useState(() =>
    groupPlanNodes(nodes).flatMap((group) => group.nodes.map((node) => node.id)),
  );
  const lastCompletion = useRef(new Map(nodes.map((node) => [node.id, (node.task?.progress ?? 0) >= 100])));
  const host = useRef<HTMLDivElement>(null);
  const overflow = useRef(false);
  const prefix = useId();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const stableIds = resolvePlanOrder(order, nodes, lastCompletion.current, false);
  const ordered = stableIds.map((id) => byId.get(id)!);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => {
      overflow.current = isPlanOverflowing(element);
      element.dataset.planOverflow = String(overflow.current);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (let parent = element.parentElement; parent; parent = parent.parentElement) observer.observe(parent);
    measure();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    // The next frame includes parent appearance effects and the card's full notes.
    // Keep the old completion map until this frame, so rapid renders cannot lose
    // a pending completion or turn an immediate undo into two movements.
    const frame = requestAnimationFrame(() => {
      if (!host.current) return;
      overflow.current = isPlanOverflowing(host.current);
      host.current.dataset.planOverflow = String(overflow.current);
      const next = resolvePlanOrder(order, nodes, lastCompletion.current, overflow.current, collapsed);
      lastCompletion.current = new Map(nodes.map((node) => [node.id, (node.task?.progress ?? 0) >= 100]));
      if (next.length !== order.length || next.some((id, index) => order[index] !== id)) setOrder(next);
    });
    return () => cancelAnimationFrame(frame);
  });
  return (
    <div ref={host} className={`plan-projects${card ? ' plan-card-groups' : ''}`}>
      {groupPlanNodes(ordered).map((group) => {
        const title = snapshot.maps.find((map) => map.id === group.mapId)?.title ?? '项目';
        const folded = collapsed.has(group.mapId);
        return (
          <section className="plan-project" data-project-id={group.mapId} key={group.mapId}>
            <button
              className="plan-project-toggle"
              aria-label={`${folded ? '展开' : '收起'}项目 ${title}`}
              aria-expanded={!folded}
              aria-controls={`${prefix}-${group.mapId}`}
              onClick={() =>
                setCollapsed((previous) => {
                  const next = new Set(previous);
                  if (next.has(group.mapId)) next.delete(group.mapId);
                  else next.add(group.mapId);
                  return next;
                })
              }
            >
              <ChevronDown size={14} className={folded ? 'is-collapsed' : ''} />
              <strong>{title}</strong>
              <span>{group.nodes.length}</span>
            </button>
            <div
              id={`${prefix}-${group.mapId}`}
              hidden={folded}
              className={card ? 'notes-grid plan-project-grid' : 'plan-project-list'}
              style={
                card
                  ? ({ '--plan-columns': snapshot.settings.gridColumns } as React.CSSProperties)
                  : undefined
              }
            >
              {!folded && group.nodes.map((node) => render(node, card))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
interface Props {
  snapshot: Snapshot;
  filter: Filter;
  day: string;
  setDay: (d: string) => void;
  dispatch: (c: Command) => Promise<Snapshot>;
  onSelect: (id: string) => void;
  onLocate: (id: string) => void;
  onAdd: (day?: string) => void;
  search?: string;
  compact?: boolean;
}
export default function PlanViews(p: Props) {
  const { snapshot, filter, day, setDay, dispatch, onAdd, compact } = p;
  const [status, setStatus] = useState<'all' | 'active' | 'finished'>('all');
  const today = localDate();
  const all = selectPlanViewNodes(snapshot, 'all', today, filter === 'all' ? status : 'all');
  const matches = (n: MindNode) =>
    !p.search ||
    [n.title, ...Object.values(n.notes), snapshot.maps.find((m) => m.id === n.mapId)?.title]
      .join(' ')
      .toLowerCase()
      .includes(p.search.toLowerCase());
  // The selected calendar day is not the clock: browsing forward must not make
  // tasks between today and that day look overdue.
  const nodes = (
    filter === 'today' && !compact
      ? all.filter((n) => isNodeInPlanRange(snapshot, n.id, { start: day, end: day }, today))
      : filter === 'all'
        ? all
        : selectPlanViewNodes(snapshot, filter, compact ? today : day, status)
  ).filter(matches);
  const onDay = (d: string) =>
    all.filter((n) => isNodeInPlanRange(snapshot, n.id, { start: d, end: d }, today, false) && matches(n));
  const render = (n: MindNode, card = false) => (
    <PlanItem
      key={n.id}
      snapshot={snapshot}
      node={n}
      dispatch={dispatch}
      onSelect={p.onSelect}
      onLocate={p.onLocate}
      card={card}
    />
  );
  const grouped = (items: MindNode[], card = false) => (
    <ProjectGroups
      key={`${filter}:${compact ? today : day}:${today}:${status}:${p.search ?? ''}:${snapshot.settings.hideCompleted}`}
      snapshot={snapshot}
      nodes={items}
      render={render}
      card={card}
    />
  );
  async function drop(e: React.DragEvent, date: string) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/mindnote-task');
    if (!id) return;
    const node = snapshot.nodes.find((n) => n.id === id);
    if (!node?.task) return;
    const r = effectiveSchedule(snapshot, id);
    const span = r
      ? Math.round(
          (new Date(r.end + 'T12:00:00').getTime() - new Date(r.start + 'T12:00:00').getTime()) / 86400000,
        )
      : 0;
    await dispatch({
      type: 'node.update',
      id,
      patch: { schedule: { mode: 'range', start: date, end: shiftDay(date, span) } },
    }).catch(() => {});
  }
  const empty = (
    <EmptyState title="暂无待办" detail="">
      <button className="button primary" onClick={() => onAdd(day)}>
        <Plus size={15} />
        新增待办
      </button>
    </EmptyState>
  );
  const week = periodRange('week', day)!;
  const dates = Array.from({ length: 7 }, (_, i) => shiftDay(week.start, i));
  const navigator = (month = false) => (
    <div className="period-toolbar">
      <IconButton
        title={month ? '上个月' : '上一周'}
        onClick={() => {
          if (month) {
            const d = new Date(day + 'T12:00:00');
            d.setDate(1);
            d.setMonth(d.getMonth() - 1);
            setDay(localDate(d));
          } else setDay(shiftDay(day, -7));
        }}
      >
        <ChevronLeft size={17} />
      </IconButton>
      <strong>{month ? day.slice(0, 7).replace('-', ' 年 ') + ' 月' : `${week.start} — ${week.end}`}</strong>
      <IconButton
        title={month ? '下个月' : '下一周'}
        onClick={() => {
          if (month) {
            const d = new Date(day + 'T12:00:00');
            d.setDate(1);
            d.setMonth(d.getMonth() + 1);
            setDay(localDate(d));
          } else setDay(shiftDay(day, 7));
        }}
      >
        <ChevronRight size={17} />
      </IconButton>
      {month && (
        <button className="text-button" onClick={() => setDay(localDate())}>
          回到今天
        </button>
      )}
    </div>
  );
  if (compact) return <div className="compact-plan plan-v11">{nodes.length ? grouped(nodes) : empty}</div>;
  if (filter === 'all')
    return (
      <>
        <div className="notes-toolbar plan-toolbar-v11">
          <div className="segmented">
            {(['all', 'active', 'finished'] as const).map((s, i) => (
              <button key={s} className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>
                {['全部', '待推进', '已归档'][i]}
              </button>
            ))}
          </div>
          <div className="plan-grid-controls">
            <span className="muted">{nodes.length} 项</span>
            <div className="grid-column-options" role="group" aria-label="宫格列数">
              {([1, 2, 3, 4] as const).map((columns) => (
                <button
                  key={columns}
                  aria-label={`${columns} 列`}
                  aria-pressed={snapshot.settings.gridColumns === columns}
                  onClick={() => {
                    if (snapshot.settings.gridColumns !== columns)
                      void dispatch({ type: 'settings.update', patch: { gridColumns: columns } }).catch(
                        () => {},
                      );
                  }}
                >
                  {columns}
                </button>
              ))}
            </div>
          </div>
        </div>
        {nodes.length ? grouped(nodes, true) : empty}
      </>
    );
  if (filter === 'week')
    return (
      <div className="week-board week-overview">
        {adjacentPlanWeeks(today).map((week) => {
          const items = all.filter(
            (node) =>
              isNodeInPlanRange(snapshot, node.id, week, today, week.key === 'current') && matches(node),
          );
          const addDate = week.key === 'current' ? today : week.start;
          return (
            <section
              className={`week-column week-summary ${week.key === 'current' ? 'is-today' : ''}`}
              key={week.start}
              data-week={week.key}
              data-week-start={week.start}
              data-week-end={week.end}
              aria-label={`${week.label}计划`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => void drop(e, week.start)}
            >
              <header>
                <strong>{week.label}</strong>
                <span className="week-range" title={`${week.start} 至 ${week.end}`}>
                  {planDateText(week, today)}
                </span>
                <IconButton title={`${week.label}新增待办`} onClick={() => onAdd(addDate)}>
                  <Plus size={15} />
                </IconButton>
              </header>
              {grouped(items)}
              {!items.length && (
                <button className="empty-day" onClick={() => onAdd(addDate)}>
                  ＋ 添加
                </button>
              )}
            </section>
          );
        })}
      </div>
    );
  if (filter === 'month') {
    const first = day.slice(0, 8) + '01',
      start = periodRange('week', first)!.start;
    return (
      <>
        {navigator(true)}
        <div className="calendar-card">
          <div className="month-grid">
            {'一二三四五六日'.split('').map((d) => (
              <div className="weekday-label" key={d}>
                周{d}
              </div>
            ))}
            {Array.from({ length: 42 }, (_, i) => {
              const d = shiftDay(start, i),
                items = onDay(d);
              return (
                <button
                  key={d}
                  className={`month-cell ${d.slice(0, 7) !== day.slice(0, 7) ? 'other-month' : ''} ${d === localDate() ? 'today' : ''} ${d === day ? 'selected-day' : ''}`}
                  aria-label={`查看 ${d}`}
                  onClick={() => setDay(d)}
                  onDoubleClick={() => onAdd(d)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => void drop(e, d)}
                >
                  <span className="date-number">{Number(d.slice(-2))}</span>
                  {items.slice(0, 2).map((n) => (
                    <span
                      key={n.id}
                      className={`calendar-task ${getProgress(snapshot, n.id) >= 100 ? 'done' : ''}`}
                    >
                      {n.title}
                    </span>
                  ))}
                  {items.length > 2 && <small>另有 {items.length - 2} 项</small>}
                </button>
              );
            })}
          </div>
        </div>
        <section className="card day-agenda">
          <div className="card-heading">
            <h2>{day} 的安排</h2>
            <button className="button" onClick={() => onAdd(day)}>
              <Plus size={14} />
              添加待办
            </button>
          </div>
          {onDay(day).length ? grouped(onDay(day)) : <p className="muted">暂无待办</p>}
        </section>
        <Overdue
          nodes={all.filter(
            (n) =>
              effectiveSchedule(snapshot, n.id)?.end! < localDate() &&
              getProgress(snapshot, n.id) < 100 &&
              matches(n),
          )}
          render={grouped}
        />
      </>
    );
  }
  return (
    <div className="today-layout plan-today-v11">
      <div className="today-main">
        {filter === 'today' && (
          <>
            <div className="date-strip-shell">
              {navigator()}
              <div className="week-strip">
                {dates.map((d, i) => (
                  <button
                    key={d}
                    onClick={() => setDay(d)}
                    className={`day-chip ${day === d ? 'selected' : ''} ${d === localDate() ? 'is-today' : ''}`}
                  >
                    <span>周{'一二三四五六日'[i]}</span>
                    <strong>{Number(d.slice(-2))}</strong>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        <section className="card">
          <div className="card-heading">
            <h2>{filter === 'inbox' ? '尚未安排' : '待办清单'}</h2>
            <span className="muted">{nodes.length} 件事</span>
          </div>
          {nodes.length ? grouped(nodes) : empty}
          <button className="list-add" onClick={() => onAdd(filter === 'inbox' ? undefined : day)}>
            <Plus size={16} />
            添加待办
          </button>
        </section>
      </div>
    </div>
  );
}
function Overdue({ nodes, render }: { nodes: MindNode[]; render: (nodes: MindNode[]) => React.ReactNode }) {
  return nodes.length ? (
    <section className="card overdue-section">
      <div className="card-heading">
        <h2>逾期待办</h2>
      </div>
      {render(nodes)}
    </section>
  ) : null;
}
