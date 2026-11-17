import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  Download,
  FolderOpen,
  GitBranch,
  Grip,
  Moon,
  Plus,
  Search,
  Sun,
  Trash2,
  Upload,
  ImagePlus,
  CalendarX2,
  X,
} from 'lucide-react';
import type { AppSettings, Command, MindNode, Schedule, Snapshot, WindowState } from '../shared/types';
import { effectiveSchedule, getDescendants, getProgress, isValidDate, localDate } from '../shared/domain';
import { DateFields, DraftField, IconButton, Logo, Modal } from './components';
import { ProgressSlider } from './PlanViews';
import { useBackgroundImage } from './Background';

type Dispatch = (command: Command) => Promise<Snapshot>;
// Modal installs its focus trap using onClose identity. Keep the callback stable
// while local form values change so typing a date never moves focus elsewhere.
function useGuardedClose(onClose: () => void, busy = false) {
  const current = useRef({ onClose, busy });
  current.current = { onClose, busy };
  return useCallback(() => {
    if (!current.current.busy) current.current.onClose();
  }, []);
}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const todaySchedule = (date?: string): Schedule => {
  const day = date && isValidDate(date) ? date : localDate();
  return { mode: 'range', start: day, end: day };
};
function scheduleError(schedule: Schedule, required = false): string | null {
  if (schedule.mode !== 'range') return required ? '请选择计划的开始和结束日期。' : null;
  if (!isValidDate(schedule.start) || !isValidDate(schedule.end)) return '请填写有效的开始和结束日期。';
  return schedule.end < schedule.start ? '结束日期不能早于开始日期。' : null;
}
function protectComposition(event: KeyboardEvent<HTMLFormElement>) {
  if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229))
    event.preventDefault();
}
function FormError({ error }: { error: string }) {
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null;
}

export function Details({
  node,
  snapshot,
  dispatch,
  onClose,
  onDate,
  onLocate,
  onAdd,
}: {
  node: MindNode;
  snapshot: Snapshot;
  dispatch: Dispatch;
  onClose: () => void;
  onDate: () => void;
  onLocate: () => void;
  onAdd: () => void;
}) {
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const closeDelete = useGuardedClose(() => setConfirmDelete(false), deleting);
  const map = snapshot.maps.find((item) => item.id === node.mapId)!;
  const systemRoot = map.system && node.id === map.rootId;
  const children = getDescendants(snapshot, node.id);
  const range = effectiveSchedule(snapshot, node.id);
  const planned = !!node.task?.planned;
  const done = planned && getProgress(snapshot, node.id) >= 100;
  useEffect(() => {
    setError('');
    setConfirmDelete(false);
  }, [node.id]);
  async function remove() {
    if (deleting) return;
    setDeleting(true);
    setError('');
    try {
      await dispatch(
        node.parentId ? { type: 'node.delete', id: node.id } : { type: 'map.delete', id: map.id },
      );
      setConfirmDelete(false);
      onClose();
    } catch (error) {
      setError(message(error));
    } finally {
      setDeleting(false);
    }
  }
  return (
    <aside className="inspector" aria-label="事项详情">
      <header className="inspector-header">
        <span>事项详情</span>
        <IconButton title="关闭详情" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </header>
      <div className="inspector-scroll">
        <div className="node-type">
          <span className="project-dot" />
          {map.title}
          <span>· {planned ? '我的计划' : '思维导图'}</span>
        </div>
        <DraftField
          key={`${node.id}:title`}
          draftKey={`${node.id}:title`}
          value={node.title}
          label="事项名称"
          readOnly={systemRoot}
          className={`inspector-title ${done ? 'completed-title' : ''}`}
          onCommit={(title) => dispatch({ type: 'node.update', id: node.id, patch: { title } })}
        />
        {!systemRoot && (
          <section className="detail-section">
            {planned ? (
              <>
                <div className="detail-label">计划日期</div>
                <div className="schedule-actions">
                  <button type="button" className="schedule-button" onClick={onDate}>
                    <CalendarDays size={15} />
                    {range
                      ? range.start === range.end
                        ? range.start
                        : `${range.start} 至 ${range.end}`
                      : '暂不安排日期'}
                  </button>
                  <button
                    type="button"
                    className="button primary cancel-plan"
                    onClick={() => {
                      setError('');
                      void dispatch({ type: 'node.update', id: node.id, patch: { planned: false } }).catch(
                        (error) => setError(message(error)),
                      );
                    }}
                  >
                    <CalendarX2 size={15} />
                    取消计划
                  </button>
                </div>
                <div className="detail-label" style={{ marginTop: 18 }}>
                  完成进度
                </div>
                <ProgressSlider snapshot={snapshot} node={node} dispatch={dispatch} />
              </>
            ) : (
              <button type="button" className="button primary" onClick={onDate}>
                <CalendarDays size={15} />
                加入计划
              </button>
            )}
          </section>
        )}
        <section className="detail-section">
          <div className="card-heading">
            <h3>记录与备注</h3>
          </div>
          {(
            [
              ['progress', '进展说明', ''],
              ['problems', '问题与阻碍', ''],
              ['other', '其他备注', ''],
            ] as const
          ).map(([key, label, placeholder]) => (
            <div className="note-field" key={`${node.id}:${key}`}>
              <label className="field-label">{label}</label>
              <DraftField
                draftKey={`${node.id}:notes:${key}`}
                value={node.notes[key]}
                label={label}
                multiline
                placeholder={placeholder}
                onCommit={(value) =>
                  dispatch({ type: 'node.update', id: node.id, patch: { notes: { [key]: value } } })
                }
              />
            </div>
          ))}
        </section>
        <FormError error={error} />
      </div>
      <footer className="inspector-bottom">
        <button type="button" className="text-button" onClick={onAdd}>
          <Plus size={14} />
          添加子事项
        </button>
        <button type="button" className="text-button" onClick={onLocate}>
          <ArrowUpRight size={14} />
          定位导图
        </button>
        {!systemRoot && (
          <IconButton
            title={node.parentId ? '删除事项' : '删除项目'}
            disabled={deleting}
            onClick={() => (children.length || !node.parentId ? setConfirmDelete(true) : void remove())}
          >
            <Trash2 size={15} />
          </IconButton>
        )}
      </footer>
      {confirmDelete && (
        <Modal
          title={node.parentId ? '删除这个事项分支？' : '删除整个项目？'}
          subtitle={`“${node.title}”${children.length ? `及其 ${children.length} 个子事项` : ''}将一同删除，可通过撤销恢复。`}
          onClose={closeDelete}
        >
          <FormError error={error} />
          <div className="modal-actions">
            <button
              type="button"
              className="button secondary"
              disabled={deleting}
              onClick={() => setConfirmDelete(false)}
            >
              取消
            </button>
            <button type="button" className="button danger" disabled={deleting} onClick={() => void remove()}>
              {deleting ? '正在删除…' : '确认删除'}
            </button>
          </div>
        </Modal>
      )}
    </aside>
  );
}

export interface AddConfig {
  type: 'add';
  parentId?: string;
  mapId?: string;
  date?: string;
  siblingOf?: string;
}
export function AddDialog({
  snapshot,
  config,
  dispatch,
  onClose,
  onCreated,
}: {
  snapshot: Snapshot;
  config: AddConfig;
  dispatch: Dispatch;
  onClose: () => void;
  onCreated: (id: string, snapshot: Snapshot) => void;
}) {
  const sibling = config.siblingOf ? snapshot.nodes.find((node) => node.id === config.siblingOf) : undefined;
  const parentId = sibling?.parentId ?? config.parentId;
  const parent = parentId ? snapshot.nodes.find((node) => node.id === parentId) : undefined;
  const [mapId, setMapId] = useState(
    parent?.mapId ??
      sibling?.mapId ??
      config.mapId ??
      snapshot.maps.find((map) => map.system)?.id ??
      snapshot.maps[0]?.id ??
      '',
  );
  const [title, setTitle] = useState('');
  const [schedule, setSchedule] = useState<Schedule>(() => todaySchedule(config.date));
  const [planned, setPlanned] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const closeDialog = useGuardedClose(onClose, saving);
  const selectedMap = snapshot.maps.find((map) => map.id === (parent?.mapId ?? mapId));
  const makeTask = !!selectedMap?.system || planned;
  async function submit() {
    if (saving) return;
    if (!title.trim()) {
      setError('先给这个事项起个名字。');
      return;
    }
    if (!selectedMap) {
      setError('所选项目已不存在，请重新选择。');
      return;
    }
    if ((config.parentId && !parent) || (config.siblingOf && !sibling?.parentId)) {
      setError('目标位置已不存在，请重新选择事项位置。');
      return;
    }
    const invalid = makeTask ? scheduleError(schedule) : null;
    if (invalid) {
      setError(invalid);
      return;
    }
    const id = crypto.randomUUID();
    const destination = parent?.id ?? selectedMap.rootId;
    const create: Command = {
      type: 'node.create',
      id,
      mapId: selectedMap.id,
      parentId: destination,
      title: title.trim(),
      task: makeTask,
      ...(makeTask ? { schedule } : {}),
    };
    const command: Command = sibling
      ? {
          type: 'batch',
          commands: [create, { type: 'node.move', id, parentId: destination, index: sibling.order + 1 }],
        }
      : create;
    setSaving(true);
    setError('');
    try {
      const next = await dispatch(command);
      onCreated(id, next);
      onClose();
    } catch (error) {
      setError(message(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={sibling ? '添加同级事项' : parent ? '添加子事项' : '新增待办'} onClose={closeDialog}>
      <form
        onKeyDown={protectComposition}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="field-label" htmlFor="add-title">
          事项名称
        </label>
        <input
          id="add-title"
          className="large-input"
          autoFocus
          value={title}
          maxLength={500}
          placeholder="准备做点什么？"
          disabled={saving}
          onChange={(event) => setTitle(event.target.value)}
        />
        {!parent && !sibling && (
          <>
            <label className="field-label" htmlFor="add-project">
              所属项目
            </label>
            <select
              id="add-project"
              className="large-input"
              value={mapId}
              disabled={saving}
              onChange={(event) => setMapId(event.target.value)}
            >
              {snapshot.maps.map((map) => (
                <option key={map.id} value={map.id}>
                  {map.title}
                </option>
              ))}
            </select>
          </>
        )}
        {(parent || sibling) && (
          <p className="field-hint">
            <GitBranch size={13} /> {selectedMap?.title}
            {parent ? ` / ${parent.title}` : ''}
          </p>
        )}
        {!selectedMap?.system && (
          <label className="unscheduled-option">
            <input
              type="checkbox"
              checked={planned}
              disabled={saving}
              onChange={(event) => setPlanned(event.target.checked)}
            />
            <span>
              <strong>加入我的计划</strong>
            </span>
          </label>
        )}
        {makeTask && (
          <DateFields
            value={schedule}
            onChange={setSchedule}
            allowInherit={!!parent?.task}
            inheritedRange={parent ? effectiveSchedule(snapshot, parent.id) : null}
          />
        )}
        <FormError error={error} />
        <div className="modal-actions">
          <button type="button" className="button secondary" disabled={saving} onClick={onClose}>
            取消
          </button>
          <button type="submit" className="button primary" disabled={saving || !title.trim()}>
            <Plus size={15} />
            {saving ? '正在保存…' : makeTask ? '添加待办' : '添加想法'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ProjectDialog({
  dispatch,
  onClose,
  onCreated,
}: {
  dispatch: Dispatch;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const closeDialog = useGuardedClose(onClose, saving);
  async function submit() {
    if (saving || !title.trim()) return;
    setSaving(true);
    setError('');
    try {
      const id = crypto.randomUUID();
      await dispatch({ type: 'map.create', id, rootId: crypto.randomUUID(), title: title.trim() });
      onCreated(id);
      onClose();
    } catch (error) {
      setError(message(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title="创建项目" onClose={closeDialog}>
      <form
        onKeyDown={protectComposition}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="field-label" htmlFor="project-title">
          项目名称
        </label>
        <input
          className="large-input"
          id="project-title"
          autoFocus
          value={title}
          maxLength={500}
          disabled={saving}
          placeholder="例如：我的新计划"
          onChange={(event) => setTitle(event.target.value)}
        />

        <FormError error={error} />
        <div className="modal-actions">
          <button type="button" className="button secondary" disabled={saving} onClick={onClose}>
            取消
          </button>
          <button type="submit" className="button primary" disabled={saving || !title.trim()}>
            {saving ? '正在创建…' : '创建项目'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function DateDialog({
  snapshot,
  node,
  dispatch,
  onClose,
}: {
  snapshot: Snapshot;
  node: MindNode;
  dispatch: Dispatch;
  onClose: () => void;
}) {
  const [schedule, setSchedule] = useState<Schedule>(() => node.task?.schedule ?? todaySchedule());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const closeDialog = useGuardedClose(onClose, saving);
  const converting = !node.task;
  async function save() {
    if (saving) return;
    const invalid = scheduleError(schedule, converting);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (node.task) await dispatch({ type: 'node.update', id: node.id, patch: { schedule, planned: true } });
      else if (schedule.mode === 'range')
        await dispatch({ type: 'node.convert', id: node.id, start: schedule.start, end: schedule.end });
      onClose();
    } catch (error) {
      setError(message(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={node.task?.planned ? '安排计划日期' : '将此事项加入计划'} onClose={closeDialog}>
      <form
        onKeyDown={protectComposition}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <DateFields
          value={schedule}
          onChange={setSchedule}
          required={converting}
          allowInherit={!!node.task && !!node.parentId}
          inheritedRange={node.parentId ? effectiveSchedule(snapshot, node.parentId) : null}
        />
        <FormError error={error} />
        <div className="modal-actions">
          <button type="button" className="button secondary" disabled={saving} onClick={onClose}>
            取消
          </button>
          <button type="submit" className="button primary" disabled={saving}>
            {saving ? '正在保存…' : node.task?.planned ? '保存日期' : '加入计划'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function SearchDialog({
  snapshot,
  onClose,
  onSelect,
}: {
  snapshot: Snapshot;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const closeDialog = useGuardedClose(onClose);
  const maps = useMemo(() => new Map(snapshot.maps.map((map) => [map.id, map])), [snapshot.maps]);
  const results = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return snapshot.nodes
      .filter(
        (node) =>
          (node.parentId || !maps.get(node.mapId)?.system) &&
          (!search ||
            [node.title, ...Object.values(node.notes), maps.get(node.mapId)?.title ?? '']
              .join('\n')
              .toLocaleLowerCase()
              .includes(search)),
      )
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title, 'zh-CN'),
      );
  }, [snapshot.nodes, maps, query]);
  return (
    <Modal title="搜索事项与想法" onClose={closeDialog} wide>
      <div className="search-input-wrap">
        <Search size={18} />
        <input
          autoFocus
          className="search-input"
          aria-label="搜索事项与想法"
          placeholder="搜索任务、便签或项目…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="search-results" aria-live="polite">
        <p className="section-label">
          {query.trim() ? `找到 ${results.length} 个结果` : `最近更新 · ${results.length} 个事项`}
        </p>
        {results.length ? (
          results.map((node) => (
            <button
              type="button"
              className="search-result"
              key={node.id}
              onClick={() => {
                onSelect(node.id);
                onClose();
              }}
            >
              {node.task?.planned ? <CalendarDays size={17} /> : <GitBranch size={17} />}
              <span className="result-copy">
                <strong>{node.title}</strong>
                <small>
                  {maps.get(node.mapId)?.title} · {node.task?.planned ? '计划事项' : '自由想法'}
                </small>
                {Object.values(node.notes).some(Boolean) && (
                  <small>{Object.values(node.notes).filter(Boolean).join(' · ').slice(0, 120)}</small>
                )}
              </span>
              <ArrowUpRight size={16} />
            </button>
          ))
        ) : (
          <div className="empty-search">
            <Search size={24} />
            <p>没有找到相关内容</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

// Keep the last explicit choice across settings-panel instances. Closing the
// panel still saves queued input, but an older instance cannot overwrite a
// newer choice made after reopening it in the same window.
const settingRangeIntents = new Map<string, symbol>();
function SettingRange({
  settingKey,
  label,
  detail,
  value,
  revision,
  min,
  max,
  unit = '',
  onCommit,
  onPreview,
}: {
  settingKey: 'opacity' | 'blur' | 'fontSize';
  label: string;
  detail?: string;
  value: number;
  revision: number;
  min: number;
  max: number;
  unit?: string;
  onCommit: (value: number) => Promise<Snapshot>;
  onPreview?: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const latest = useRef(value);
  const intent = useRef<symbol | null>(null);
  const active = useRef(false),
    dirty = useRef(false),
    saving = useRef(false),
    requested = useRef(false);
  const mounted = useRef(true);
  const authoritative = useRef({ revision, value });
  if (revision >= authoritative.current.revision) authoritative.current = { revision, value };
  const callbacks = useRef({ onCommit, onPreview });
  callbacks.current = { onCommit, onPreview };
  const reconcile = () => {
    if (active.current || dirty.current || saving.current) return;
    latest.current = authoritative.current.value;
    if (mounted.current) {
      setDraft(latest.current);
      callbacks.current.onPreview?.(latest.current);
    }
  };
  useEffect(() => {
    reconcile();
  }, [value, revision]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function drain() {
    if (saving.current) return;
    saving.current = true;
    try {
      while (requested.current && !active.current) {
        requested.current = false;
        if (!dirty.current) continue;
        const next = latest.current;
        dirty.current = false;
        if (intent.current !== settingRangeIntents.get(settingKey)) continue;
        if (next === authoritative.current.value) continue;
        try {
          const result = await callbacks.current.onCommit(next);
          if (result.revision >= authoritative.current.revision)
            authoritative.current = { revision: result.revision, value: next };
        } catch {
          // Appearance reports the failure; preserve a newer local draft for
          // the next queued commit instead of rolling it back with this one.
        }
      }
    } finally {
      saving.current = false;
      reconcile();
    }
  }
  function commit() {
    active.current = false;
    if (dirty.current) {
      intent.current = Symbol(settingKey);
      settingRangeIntents.set(settingKey, intent.current);
      requested.current = true;
      void drain();
    } else reconcile();
  }
  return (
    <div className="setting-row">
      <div>
        <label>{label}</label>
        {detail && <p>{detail}</p>}
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={1}
        value={draft}
        onPointerDown={() => {
          active.current = true;
        }}
        onChange={(event) => {
          active.current = true;
          dirty.current = true;
          latest.current = Number(event.target.value);
          setDraft(latest.current);
          onPreview?.(latest.current);
        }}
        onPointerCancel={() => {
          active.current = false;
          dirty.current = false;
          requested.current = false;
          reconcile();
        }}
        onPointerUp={() => void commit()}
        onBlur={() => void commit()}
        onKeyUp={(event) => {
          if (
            ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(
              event.key,
            )
          )
            void commit();
        }}
      />
      <output>
        {draft}
        {unit}
      </output>
    </div>
  );
}
function SettingSwitch({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{label}</strong>
        {detail && <p>{detail}</p>}
      </div>
      <input
        className="switch"
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </div>
  );
}

export function Appearance({
  snapshot,
  dispatch,
  onError,
  onNotice,
}: {
  snapshot: Snapshot;
  dispatch: Dispatch;
  onError: (error: string) => void;
  onNotice: (message: string) => void;
}) {
  const settings = snapshot.settings;
  const [busy, setBusy] = useState(false);
  const background = useBackgroundImage(settings);
  const [previewBlur, setPreviewBlur] = useState(settings.blur);
  const [previewOpacity, setPreviewOpacity] = useState(settings.opacity);
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty('--preview-blur');
      document.documentElement.style.removeProperty('--preview-alpha');
    },
    [],
  );
  async function addBackground() {
    if (busy) return;
    setBusy(true);
    try {
      await window.mindnote.importBackgroundImage();
    } catch (error) {
      onError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function update(patch: Partial<AppSettings>) {
    try {
      return await dispatch({ type: 'settings.update', patch });
    } catch (error) {
      onError(message(error));
      throw error;
    }
  }
  const toggle = (patch: Partial<AppSettings>) => {
    void update(patch).catch(() => {});
  };
  async function dataAction(action: 'backup' | 'restore' | 'folder') {
    if (busy) return;
    setBusy(true);
    try {
      if (action === 'folder') await window.mindnote.openDataFolder();
      else {
        const result = await window.mindnote[action]();
        if (!result.canceled)
          onNotice(
            action === 'backup'
              ? `备份已保存${result.path ? `：${result.path}` : ''}`
              : `已恢复备份${result.path ? `，恢复前的数据保存在：${result.path}` : ''}`,
          );
      }
    } catch (error) {
      onError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-grid settings-v11 settings-v12">
      <section className="setting-card settings-theme">
        <h2>主题</h2>
        <div className="theme-options">
          {(['light', 'dark'] as const).map((theme, index) => (
            <button
              type="button"
              className={`theme-option ${settings.theme === theme ? 'selected' : ''}`}
              aria-pressed={settings.theme === theme}
              aria-label={index ? '深色主题' : '浅色主题'}
              key={theme}
              onClick={() => toggle({ theme })}
            >
              <span className={`theme-sample ${theme}`} aria-hidden="true" />
              <span>
                {index ? <Moon size={15} /> : <Sun size={15} />} {index ? '深色' : '浅色'}
                {settings.theme === theme && <Check size={15} />}
              </span>
            </button>
          ))}
        </div>
        <SettingRange
          settingKey="opacity"
          label="背景不透明度"
          revision={snapshot.revision}
          value={Math.round(settings.opacity * 100)}
          min={35}
          max={100}
          unit="%"
          onPreview={(value) => {
            setPreviewOpacity(value / 100);
            document.documentElement.style.setProperty('--preview-alpha', String(value / 100));
          }}
          onCommit={(value) => update({ opacity: value / 100 })}
        />
        <SettingRange
          settingKey="blur"
          label="背景模糊"
          revision={snapshot.revision}
          detail="柔化添加的背景图片，不模糊桌面壁纸。"
          value={settings.blur}
          min={0}
          max={36}
          onPreview={(value) => {
            setPreviewBlur(value);
            document.documentElement.style.setProperty('--preview-blur', value + 'px');
          }}
          onCommit={(blur) => update({ blur })}
        />
      </section>
      <section className="setting-card settings-background">
        <h2>背景图片</h2>
        <div className={`background-image-sample ${background.url ? 'has-image' : ''}`}>
          {background.url ? (
            <img src={background.url} alt="当前背景" />
          ) : (
            <ImagePlus size={36} strokeWidth={1.4} />
          )}
        </div>
        <div className="background-image-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => void addBackground()}
          >
            <ImagePlus size={15} />
            {settings.backgroundImage ? '更换背景' : '添加背景'}
          </button>
          {settings.backgroundImage && (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => toggle({ backgroundImage: null })}
            >
              <X size={15} />
              移除
            </button>
          )}
        </div>
        <p className="background-file-name" title={settings.backgroundImage?.name}>
          {settings.backgroundImage?.name ?? 'PNG · JPG · GIF · WebP，最大 20 MB'}
        </p>
        {background.error && (
          <p className="form-error" role="alert">
            {background.error}
          </p>
        )}
      </section>
      <section className="setting-card settings-live-preview">
        <h2>效果预览</h2>
        <div className="appearance-preview-scene">
          {background.url && (
            <img
              className="preview-background-image"
              src={background.url}
              alt=""
              style={{ filter: `blur(${previewBlur}px)` }}
            />
          )}
          <div
            className="appearance-preview-note"
            style={{
              fontSize: settings.fontSize,
              background:
                settings.theme === 'dark'
                  ? `rgba(37,44,57,${previewOpacity})`
                  : `rgba(246,248,251,${previewOpacity})`,
              backdropFilter: 'none',
            }}
          >
            <div className="preview-title">
              <Logo size={24} />
              <strong>MindNote</strong>
              <span>今日</span>
            </div>
            <div className="preview-item">
              <span>整理项目资料</span>
              <small>项目</small>
            </div>
            <div className="preview-progress">
              <span>{localDate().slice(5).replace('-', '/')}</span>
              <i />
              <span>60%</span>
            </div>
            <div className="preview-item">
              <span>校对设计稿</span>
              <small>项目</small>
            </div>
            <div className="preview-progress">
              <span>{localDate().slice(5).replace('-', '/')}</span>
              <i className="short" />
              <span>30%</span>
            </div>
          </div>
        </div>
      </section>
      <section className="setting-card settings-reading">
        <h2>显示</h2>
        <SettingRange
          settingKey="fontSize"
          label="界面字号"
          revision={snapshot.revision}
          value={settings.fontSize}
          min={12}
          max={18}
          unit="px"
          onCommit={(fontSize) => update({ fontSize })}
        />
        <SettingSwitch
          label="减少动效"
          checked={settings.reduceMotion}
          onChange={(reduceMotion) => toggle({ reduceMotion })}
        />
        <SettingSwitch
          label="隐藏划线事项"
          checked={settings.hideCompleted}
          onChange={(hideCompleted) => toggle({ hideCompleted })}
        />
      </section>
      <section className="setting-card settings-desktop">
        <h2>桌面</h2>
        <SettingSwitch
          label="便签始终置顶"
          checked={settings.pinned}
          onChange={(pinned) => toggle({ pinned })}
        />
        <SettingSwitch
          label="开机启动"
          checked={settings.launchAtLogin}
          onChange={(launchAtLogin) => toggle({ launchAtLogin })}
        />
      </section>
      <section className="setting-card settings-data">
        <h2>数据</h2>
        <div className="data-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => void dataAction('backup')}
          >
            <Download size={15} />
            备份数据
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => void dataAction('restore')}
          >
            <Upload size={15} />
            恢复备份
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => void dataAction('folder')}
          >
            <FolderOpen size={15} />
            打开数据文件夹
          </button>
        </div>
      </section>
    </div>
  );
}

export function MainResizeHandles() {
  const generation = useRef(0);
  const drag = useRef<{
    edge: string;
    startX: number;
    startY: number;
    x: number;
    y: number;
    bounds?: WindowState;
  } | null>(null);
  const frame = useRef<number | null>(null);
  const pending = useRef<WindowState | null>(null);
  const sending = useRef(false);
  const [error, setError] = useState('');
  const send = async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      while (pending.current) {
        const bounds = pending.current;
        pending.current = null;
        await window.mindnote.resizeMain(bounds);
      }
    } catch {
      setError('调整窗口失败，请重试。');
    } finally {
      sending.current = false;
    }
  };
  const apply = (current = drag.current) => {
    if (!current?.bounds) return;
    const b = current.bounds;
    const dx = current.x - current.startX,
      dy = current.y - current.startY;
    const next = { ...b };
    if (current.edge.includes('e')) next.width = Math.max(880, b.width + dx);
    if (current.edge.includes('s')) next.height = Math.max(620, b.height + dy);
    if (current.edge.includes('w')) {
      next.width = Math.max(880, b.width - dx);
      next.x = b.x + b.width - next.width;
    }
    if (current.edge.includes('n')) {
      next.height = Math.max(620, b.height - dy);
      next.y = b.y + b.height - next.height;
    }
    pending.current = next;
    void send();
  };
  useEffect(
    () => () => {
      generation.current++;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  return (
    <>
      {['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'].map((edge) => (
        <div
          key={edge}
          className={`main-resize-edge resize-${edge}`}
          data-resize-edge={edge}
          aria-hidden="true"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            setError('');
            const session = ++generation.current;
            pending.current = null;
            const current = {
              edge,
              startX: event.screenX,
              startY: event.screenY,
              x: event.screenX,
              y: event.screenY,
            } as NonNullable<typeof drag.current>;
            drag.current = current;
            void window.mindnote
              .getWindowBounds()
              .then((bounds) => {
                if (session !== generation.current) return;
                current.bounds = bounds;
                apply(current);
              })
              .catch(() => {
                if (session === generation.current) setError('无法读取窗口大小。');
              });
          }}
          onPointerMove={(event) => {
            if (!drag.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
            drag.current.x = event.screenX;
            drag.current.y = event.screenY;
            if (frame.current === null)
              frame.current = requestAnimationFrame(() => {
                frame.current = null;
                apply();
              });
          }}
          onPointerUp={(event) => {
            if (!drag.current) return;
            drag.current.x = event.screenX;
            drag.current.y = event.screenY;
            if (frame.current !== null) {
              cancelAnimationFrame(frame.current);
              frame.current = null;
            }
            apply();
            drag.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            apply();
            drag.current = null;
          }}
        />
      ))}
      {error && (
        <div className="resize-error" role="alert" onClick={() => setError('')}>
          {error}
        </div>
      )}
    </>
  );
}

export function ResizeHandle() {
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    lastX: number;
    lastY: number;
    width: number;
    height: number;
    ready: boolean;
  } | null>(null);
  const frame = useRef<number | null>(null);
  const [error, setError] = useState('');
  async function resize() {
    const current = drag.current;
    if (!current?.ready) return;
    try {
      await window.mindnote.resizeSticky(
        current.width + current.lastX - current.x,
        current.height + current.lastY - current.y,
      );
    } catch {
      setError('调整尺寸失败，请重试');
    }
  }
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      drag.current = null;
    },
    [],
  );
  function end(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    void resize();
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return (
    <button
      type="button"
      className="resize-handle"
      aria-label="调整便签大小"
      title={error || '拖动调整大小；方向键微调'}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        setError('');
        const pointerId = event.pointerId;
        event.currentTarget.setPointerCapture(pointerId);
        drag.current = {
          pointerId,
          x: event.screenX,
          y: event.screenY,
          lastX: event.screenX,
          lastY: event.screenY,
          width: 0,
          height: 0,
          ready: false,
        };
        void window.mindnote
          .getWindowBounds()
          .then((bounds) => {
            if (drag.current?.pointerId === pointerId)
              Object.assign(drag.current, { width: bounds.width, height: bounds.height, ready: true });
          })
          .catch(() => {
            drag.current = null;
            setError('无法读取窗口尺寸，请重试');
          });
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current.lastX = event.screenX;
        drag.current.lastY = event.screenY;
        if (frame.current === null)
          frame.current = requestAnimationFrame(() => {
            frame.current = null;
            void resize();
          });
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const step = event.shiftKey ? 50 : 10,
          key = event.key;
        void window.mindnote
          .getWindowBounds()
          .then((bounds) =>
            window.mindnote.resizeSticky(
              bounds.width + (key === 'ArrowRight' ? step : key === 'ArrowLeft' ? -step : 0),
              bounds.height + (key === 'ArrowDown' ? step : key === 'ArrowUp' ? -step : 0),
            ),
          )
          .catch(() => setError('调整尺寸失败，请重试'));
      }}
    >
      <Grip size={13} />
    </button>
  );
}
