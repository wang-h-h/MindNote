import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Sun,
  Moon,
  Inbox,
  CalendarDays,
  CalendarRange,
  StickyNote,
  GitBranch,
  Search,
  SlidersHorizontal,
  Minus,
  X,
  Maximize2,
  ArrowUpRight,
  Pin,
  PinOff,
  ChevronDown,
  Undo2,
  Redo2,
  Trash2,
  AlertCircle,
} from 'lucide-react';
import type { Snapshot, Command, Filter } from '../shared/types';
import { localDate, effectiveSchedule, selectPlanNodes } from '../shared/domain';
import { Logo, IconButton, Modal } from './components';
import PlanViews from './PlanViews';
import MindMapCanvas from './MindMapCanvas';
import { BackgroundLayer } from './Background';
import {
  Details,
  AddDialog,
  ProjectDialog,
  DateDialog,
  SearchDialog,
  Appearance,
  ResizeHandle,
  MainResizeHandles,
} from './V1Dialogs';

const FILTERS: { id: Filter; label: string; icon: typeof Sun }[] = [
  { id: 'inbox', label: '收集箱', icon: Inbox },
  { id: 'today', label: '今日概览', icon: Sun },
  { id: 'week', label: '周计划', icon: CalendarDays },
  { id: 'month', label: '月历', icon: CalendarRange },
  { id: 'all', label: '全部事项', icon: StickyNote },
];
type Dialog =
  | { type: 'add'; parentId?: string; mapId?: string; date?: string; siblingOf?: string }
  | { type: 'project' }
  | { type: 'date'; id: string }
  | { type: 'search' }
  | { type: 'settings' }
  | null;
export default function App() {
  const sticky = new URLSearchParams(location.search).get('view') === 'sticky';
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [filter, setFilter] = useState<Filter>('today'),
    [day, setDay] = useState(localDate()),
    [mapId, setMapId] = useState<string | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [dialog, setDialog] = useState<Dialog>(null),
    [settingsPage, setSettingsPage] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const accept = useCallback(
    (s: Snapshot) => setSnapshot((old) => (!old || s.revision >= old.revision ? s : old)),
    [],
  );
  const dispatch = useCallback(
    async (c: Command) => {
      try {
        const s = await window.mindnote.dispatch(c);
        accept(s);
        return s;
      } catch (e) {
        setError(String(e).replace(/^Error: Error invoking remote method '[^']+': Error: /, ''));
        throw e;
      }
    },
    [accept],
  );
  const fire = (c: Command) => void dispatch(c).catch(() => {});
  const closeDialog = useCallback(() => setDialog(null), []);
  useEffect(() => {
    if (!window.mindnote) {
      setError('请通过 MindNote 桌面程序打开。');
      return;
    }
    const off = window.mindnote.onChange(accept);
    void window.mindnote
      .getSnapshot()
      .then(accept)
      .catch((e) => setError(String(e)));
    const focus = window.mindnote.onFocusNode((id) => {
      (document.activeElement as HTMLElement)?.blur();
      void window.mindnote.getSnapshot().then((s) => {
        accept(s);
        const n = s.nodes.find((n) => n.id === id);
        if (n) {
          setSelected(id);
          setMapId(n.mapId);
          setSettingsPage(false);
        }
      });
    });
    return () => {
      off();
      focus();
    };
  }, [accept]);
  useEffect(() => {
    const apply = (state: { maximized: boolean; fullscreen: boolean }) => {
      document.documentElement.dataset.maximized = String(state.maximized);
      document.documentElement.dataset.fullscreen = String(state.fullscreen);
    };
    if (!window.mindnote) return;
    const off = window.mindnote.onWindowPresentation(apply);
    void window.mindnote.getWindowPresentation().then(apply);
    return off;
  }, []);
  useEffect(() => {
    if (!snapshot) return;
    const s = snapshot.settings;
    document.documentElement.dataset.theme = s.theme;
    document.documentElement.dataset.motion = s.reduceMotion ? 'reduced' : 'full';
    document.documentElement.dataset.view = sticky ? 'sticky' : 'main';
    document.documentElement.style.setProperty('--base-font', s.fontSize + 'px');
    document.documentElement.style.setProperty('--saved-blur', s.blur + 'px');
    document.documentElement.style.setProperty('--saved-panel-alpha', String(s.opacity));
    document.documentElement.style.setProperty('--ui-scale', String(s.fontSize / 14));
  }, [snapshot?.settings, sticky]);
  useEffect(() => {
    let previous = localDate();
    const update = () => {
      const now = localDate();
      if (now !== previous) {
        const old = previous;
        previous = now;
        setDay((d) => (d === old ? now : d));
        setSnapshot((s) => (s ? { ...s } : s));
      }
    };
    const timer = setInterval(update, 15000);
    window.addEventListener('focus', update);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', update);
    };
  }, []);
  useEffect(() => {
    if (!snapshot) return;
    if (selected && !snapshot.nodes.some((n) => n.id === selected)) setSelected(null);
    if (mapId && !snapshot.maps.some((m) => m.id === mapId)) setMapId(null);
    const target = dialog?.type === 'date' ? dialog.id : dialog?.type === 'add' ? dialog.parentId : undefined;
    if (target && !snapshot.nodes.some((n) => n.id === target)) {
      setDialog(null);
      setNotice('该节点已删除，请重新选择。');
    }
  }, [snapshot, selected, mapId, dialog]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        // Search must not replace an unfinished or currently saving form.
        if (dialog && dialog.type !== 'search') return;
        setDialog({ type: 'search' });
        return;
      }
      if (dialog || (e.target as HTMLElement).closest('input,textarea,[contenteditable],.mindmap-shell'))
        return;
      if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setDialog({ type: 'add', date: localDate() });
      }
      if (e.ctrlKey && ['z', 'y'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        void dispatch({
          type: e.shiftKey || e.key.toLowerCase() === 'y' ? 'history.redo' : 'history.undo',
        }).catch(() => {});
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [dialog, dispatch]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  if (!snapshot)
    return (
      <div className="startup">
        <Logo size={70} />
        <h2>MindNote</h2>
        <p>{error || '正在打开你的便签…'}</p>
      </div>
    );
  const selectedNode = snapshot.nodes.find((n) => n.id === selected),
    project = snapshot.maps.find((m) => m.id === mapId);
  const choose = (f: Filter) => {
    setFilter(f);
    setDay(localDate());
    setMapId(null);
    setSettingsPage(false);
    setSelected(null);
  };
  const add = (date?: string) => setDialog({ type: 'add', date: date ?? localDate() });
  const locate = (id: string) => {
    if (sticky) {
      void window.mindnote.showMain(id);
      return;
    }
    const node = snapshot.nodes.find((n) => n.id === id);
    if (node) {
      setMapId(node.mapId);
      setSelected(id);
      setSettingsPage(false);
    }
  };
  const addMapNode = (id: string, sibling = false) => {
    const n = snapshot.nodes.find((n) => n.id === id);
    if (!n) return;
    setDialog({
      type: 'add',
      mapId: n.mapId,
      parentId: sibling && n.parentId ? n.parentId : n.id,
      siblingOf: sibling && n.parentId ? n.id : undefined,
      date: localDate(),
    });
  };
  const toggleTheme = () =>
    fire({
      type: 'settings.update',
      patch: { theme: snapshot.settings.theme === 'light' ? 'dark' : 'light' },
    });
  const planProps = {
    snapshot,
    filter,
    day,
    setDay,
    dispatch,
    onSelect: setSelected,
    onLocate: locate,
    onAdd: add,
  };
  const settings = (
    <Appearance
      snapshot={snapshot}
      dispatch={dispatch}
      onError={(e) => setError(String(e))}
      onNotice={setNotice}
    />
  );
  const details = selectedNode && (
    <Details
      key={selectedNode.id}
      node={selectedNode}
      snapshot={snapshot}
      dispatch={dispatch}
      onClose={() => setSelected(null)}
      onDate={() => setDialog({ type: 'date', id: selectedNode.id })}
      onLocate={() => locate(selectedNode.id)}
      onAdd={() => addMapNode(selectedNode.id)}
    />
  );
  const nav = FILTERS.find((f) => f.id === filter)!;
  return (
    <div
      className={`${sticky ? `sticky-shell ${snapshot.settings.stickyCollapsed ? 'collapsed' : ''}` : 'desktop-app'} ${snapshot.settings.backgroundImage ? 'has-custom-background' : ''}`}
    >
      <BackgroundLayer settings={snapshot.settings} />
      {sticky ? (
        <>
          <header className="sticky-header drag-region">
            <div className="sticky-brand">
              <Logo size={29} />
              <strong>
                MindNote<span>思维便签</span>
              </strong>
            </div>
            <div className="no-drag window-actions">
              <IconButton
                title="外观设置"
                onClick={() => {
                  if (snapshot.settings.stickyCollapsed) {
                    void dispatch({ type: 'settings.update', patch: { stickyCollapsed: false } })
                      .then(() => setDialog({ type: 'settings' }))
                      .catch(() => {});
                  } else setDialog({ type: 'settings' });
                }}
              >
                <SlidersHorizontal size={15} />
              </IconButton>
              <IconButton
                title={snapshot.settings.pinned ? '取消置顶' : '置顶便签'}
                active={snapshot.settings.pinned}
                onClick={() =>
                  fire({ type: 'settings.update', patch: { pinned: !snapshot.settings.pinned } })
                }
              >
                {snapshot.settings.pinned ? <Pin size={15} /> : <PinOff size={15} />}
              </IconButton>
              <IconButton
                title={snapshot.settings.stickyCollapsed ? '展开便签' : '收起便签'}
                onClick={() =>
                  fire({
                    type: 'settings.update',
                    patch: { stickyCollapsed: !snapshot.settings.stickyCollapsed },
                  })
                }
              >
                {snapshot.settings.stickyCollapsed ? <ChevronDown size={16} /> : <Minus size={16} />}
              </IconButton>
              <IconButton title="打开完整窗口" onClick={() => void window.mindnote.showMain()}>
                <ArrowUpRight size={17} />
              </IconButton>
              <IconButton title="关闭便签" onClick={() => void window.mindnote.hideWindow()}>
                <X size={16} />
              </IconButton>
            </div>
          </header>
          {!snapshot.settings.stickyCollapsed && (
            <>
              <div className="sticky-date">
                <span>
                  {new Date(localDate() + 'T12:00:00').toLocaleDateString('zh-CN', {
                    month: 'long',
                    day: 'numeric',
                    weekday: 'long',
                  })}
                </span>
              </div>
              <nav className="sticky-tabs">
                {FILTERS.filter((f) => f.id !== 'all').map((f) => (
                  <button key={f.id} className={filter === f.id ? 'active' : ''} onClick={() => choose(f.id)}>
                    {
                      (
                        { inbox: '收集箱', today: '今日', week: '本周', month: '本月' } as Record<
                          string,
                          string
                        >
                      )[f.id]
                    }
                  </button>
                ))}
              </nav>
              <div className="sticky-list">
                <PlanViews {...planProps} compact />
              </div>
              <footer className="sticky-footer">
                <button className="quick-add" onClick={() => add()}>
                  <Plus size={16} />
                  新增待办<kbd>Ctrl N</kbd>
                </button>
              </footer>
              <ResizeHandle />
              {details && <div className="sticky-details">{details}</div>}
            </>
          )}
        </>
      ) : (
        <div className="window-shell">
          <aside className="sidebar">
            <div className="brand drag-region">
              <Logo size={45} />
              <span>
                <strong>MindNote</strong>
                <small className="brand-chinese">思维便签</small>
              </span>
            </div>
            <div className="nav-label">我的计划</div>
            <nav className="nav-main">
              {FILTERS.map((f) => (
                <button
                  className={`nav-button ${!mapId && !settingsPage && filter === f.id ? 'active' : ''}`}
                  key={f.id}
                  onClick={() => choose(f.id)}
                >
                  <f.icon size={18} />
                  <span>{f.label}</span>
                  {f.id === 'today' && !!selectPlanNodes(snapshot, 'today').length && (
                    <span className="nav-count">{selectPlanNodes(snapshot, 'today').length}</span>
                  )}
                </button>
              ))}
            </nav>
            <div className="sidebar-separator" />
            <div className="project-heading">
              <span className="nav-label">思维空间</span>
              <IconButton title="新建项目" onClick={() => setDialog({ type: 'project' })}>
                <Plus size={16} />
              </IconButton>
            </div>
            <nav className="project-nav">
              {snapshot.maps.map((m) => (
                <button
                  key={m.id}
                  className={`nav-button ${mapId === m.id && !settingsPage ? 'active' : ''}`}
                  onClick={() => {
                    setMapId(m.id);
                    setSelected(null);
                    setSettingsPage(false);
                  }}
                >
                  {m.system ? <Inbox size={16} /> : <GitBranch size={16} />}
                  <span>{m.title}</span>
                </button>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <button
                className={`nav-button ${settingsPage ? 'active' : ''}`}
                onClick={() => {
                  setSettingsPage(true);
                  setSelected(null);
                }}
              >
                <SlidersHorizontal size={17} />
                <span>外观设置</span>
              </button>
              <div className="profile">
                <div className="avatar">M</div>
                <span>
                  <strong>我的工作空间</strong>
                </span>
                <small className="version">V2.0</small>
              </div>
            </div>
          </aside>
          <main className="main-area">
            <header className="topbar drag-region">
              <div className="breadcrumb">
                我的空间<span>/</span>
                <strong>{settingsPage ? '外观设置' : (project?.title ?? nav.label)}</strong>
              </div>
              <div className="topbar-actions no-drag">
                <button className="search-trigger" onClick={() => setDialog({ type: 'search' })}>
                  <Search size={15} />
                  搜索你的想法<kbd>Ctrl K</kbd>
                </button>
                <IconButton
                  title={snapshot.settings.theme === 'light' ? '切换到深色' : '切换到浅色'}
                  onClick={toggleTheme}
                >
                  {snapshot.settings.theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
                </IconButton>
                <span className="topbar-divider" />
                <IconButton title="显示桌面便签" onClick={() => void window.mindnote.showSticky()}>
                  <StickyNote size={17} />
                </IconButton>
                <IconButton title="最小化" onClick={() => void window.mindnote.minimizeWindow()}>
                  <Minus size={17} />
                </IconButton>
                <IconButton title="最大化／还原" onClick={() => void window.mindnote.toggleMaximize()}>
                  <Maximize2 size={16} />
                </IconButton>
                <IconButton title="关闭到托盘" onClick={() => void window.mindnote.hideWindow()}>
                  <X size={18} />
                </IconButton>
              </div>
            </header>
            <div className={`view-content ${mapId && !settingsPage ? 'map-view' : ''} `}>
              <div className="page-top">
                <div className="page-heading">
                  <h1>{settingsPage ? '外观设置' : project ? project.title : nav.label}</h1>
                </div>
                {!settingsPage && (
                  <div className="heading-actions">
                    <IconButton
                      title="撤销"
                      disabled={!snapshot.canUndo}
                      onClick={() => fire({ type: 'history.undo' })}
                    >
                      <Undo2 size={17} />
                    </IconButton>
                    <IconButton
                      title="重做"
                      disabled={!snapshot.canRedo}
                      onClick={() => fire({ type: 'history.redo' })}
                    >
                      <Redo2 size={17} />
                    </IconButton>
                    {project && !project.system && (
                      <IconButton
                        title="删除项目"
                        onClick={() => {
                          if (window.confirm(`删除项目“${project.title}”及全部节点？可撤销。`))
                            fire({ type: 'map.delete', id: project.id });
                        }}
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    )}
                    <button
                      className="button primary"
                      onClick={() =>
                        project
                          ? addMapNode(
                              selectedNode && selectedNode.mapId === project.id
                                ? selectedNode.id
                                : project.rootId,
                            )
                          : add(day)
                      }
                    >
                      <Plus size={16} />
                      {project ? '新增事项' : '新增待办'}
                    </button>
                  </div>
                )}
              </div>
              {settingsPage ? (
                settings
              ) : project ? (
                <div className="map-workspace">
                  <div className="map-canvas-card">
                    <MindMapCanvas
                      snapshot={snapshot}
                      mapId={project.id}
                      selectedId={selected}
                      onSelect={setSelected}
                      dispatch={dispatch}
                      onError={setError}
                      onAdd={addMapNode}
                      onPlan={(id) => setDialog({ type: 'date', id })}
                    />
                  </div>
                  {details && <aside className="map-detail">{details}</aside>}
                </div>
              ) : (
                <PlanViews {...planProps} />
              )}
            </div>
          </main>
          {details && !settingsPage && !project && <aside className="detail-drawer">{details}</aside>}
          <MainResizeHandles />
        </div>
      )}
      {(error || notice) && (
        <div className={`toast ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>
          <AlertCircle size={16} />
          <span>{error || notice}</span>
          <button
            aria-label="关闭提示"
            onClick={() => {
              setError('');
              setNotice('');
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {dialog?.type === 'add' && (
        <AddDialog
          snapshot={snapshot}
          config={dialog}
          dispatch={dispatch}
          onClose={closeDialog}
          onCreated={(id, s) => {
            setDialog(null);
            if (!mapId) {
              const r = effectiveSchedule(s, id);
              setFilter(r ? 'today' : 'inbox');
              if (r) setDay(r.start);
            }
          }}
        />
      )}
      {dialog?.type === 'project' && (
        <ProjectDialog
          dispatch={dispatch}
          onClose={closeDialog}
          onCreated={(id) => {
            setMapId(id);
            setSettingsPage(false);
            setSelected(null);
            setDialog(null);
          }}
        />
      )}
      {dialog?.type === 'date' && snapshot.nodes.some((n) => n.id === dialog.id) && (
        <DateDialog
          snapshot={snapshot}
          node={snapshot.nodes.find((n) => n.id === dialog.id)!}
          dispatch={dispatch}
          onClose={closeDialog}
        />
      )}
      {dialog?.type === 'search' && (
        <SearchDialog
          snapshot={snapshot}
          onClose={closeDialog}
          onSelect={(id) => {
            closeDialog();
            const n = snapshot.nodes.find((n) => n.id === id)!;
            if (sticky) {
              void window.mindnote.showMain(id);
            } else {
              setSettingsPage(false);
              if (!n.task?.planned) setMapId(n.mapId);
              else {
                setMapId(null);
                setFilter('all');
              }
              setSelected(id);
            }
          }}
        />
      )}
      {dialog?.type === 'settings' && (
        <Modal title="外观设置" onClose={closeDialog} wide>
          {settings}
        </Modal>
      )}
    </div>
  );
}
