import { useEffect, useRef, useState } from 'react';
import MindElixir, { type NodeObj, type Topic } from 'mind-elixir';
import 'mind-elixir/style.css';
import type { Command, Snapshot } from '../shared/types';
import { getDescendants } from '../shared/domain';
import {
  buildCanvasData,
  canvasSignature,
  canvasTheme,
  fittedScale,
  findRenderedTopic,
  expansionPlan,
  operationCommands,
  type CanvasOperation,
} from './mindmapAdapter';
import './mindmap.css';

interface Props {
  snapshot: Snapshot;
  mapId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  dispatch: (command: Command) => Promise<Snapshot>;
  onError: (message: string) => void;
  onAdd?: (parentId: string, sibling?: boolean) => void;
  onPlan?: (id: string) => void;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export default function MindMapCanvas(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mindRef = useRef<MindElixir | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const snapshotRef = useRef(props.snapshot);
  if (props.snapshot.revision >= snapshotRef.current.revision) snapshotRef.current = props.snapshot;
  const queueRef = useRef<Command[]>([]);
  const savingRef = useRef(false);
  const failedRef = useRef(false);
  const syncRef = useRef<() => void>(() => {});
  const fitRef = useRef<() => void>(() => {});
  const editRef = useRef<(id: string) => void>(() => {});
  const deleteRef = useRef<(ids: string[]) => void>(() => {});
  const levelRef = useRef<(level: 'main' | 'two' | 'all') => void>(() => {});
  const pendingFocusRef = useRef<string | null>(null);
  const userSelectionRef = useRef<string | null>(null);
  const [saveError, setSaveError] = useState('');
  const [zoom, setZoom] = useState(100);
  const [ready, setReady] = useState(false);
  const [menu, setMenu] = useState<{ id: string | null; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const aliveRef = useRef(true);

  const drain = async () => {
    if (savingRef.current || failedRef.current) return;
    savingRef.current = true;
    try {
      while (queueRef.current.length) {
        const result = await propsRef.current.dispatch(queueRef.current[0]);
        if (result.revision >= snapshotRef.current.revision) snapshotRef.current = result;
        queueRef.current.shift();
      }
    } catch (error) {
      failedRef.current = true;
      const message = messageOf(error);
      if (aliveRef.current) setSaveError(message);
      propsRef.current.onError(`导图暂未保存：${message}`);
      mindRef.current?.disableEdit();
    } finally {
      savingRef.current = false;
      if (aliveRef.current) syncRef.current();
    }
  };

  const enqueue = (commands: Command[]) => {
    if (!commands.length) return;
    queueRef.current.push(commands.length === 1 ? commands[0] : { type: 'batch', commands });
    void drain();
  };

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let syncing = false;
    let initialized = false;
    let lastTheme = snapshotRef.current.settings.theme;
    let lastFontSize = snapshotRef.current.settings.fontSize;
    let editingNodeId: string | null = null;
    let editStarting = false;
    let editFrame = 0;
    let focusFrame = 0;
    let layoutFrame = 0;
    let layoutTimer: ReturnType<typeof setTimeout> | null = null;
    let alignEditor = () => {};
    let cleanupEditor = () => {};
    userSelectionRef.current = null;
    pendingFocusRef.current = propsRef.current.selectedId;
    setReady(false);
    setMenu(null);
    const mind: MindElixir = new MindElixir({
      el: host,
      direction: 1,
      alignment: 'nodes',
      allowUndo: false,
      editable: !failedRef.current,
      contextMenu: false,
      toolBar: false,
      keypress: false,
      mouseSelectionButton: 2,
      newTopicName: '新想法',
      scaleMin: 0.001,
      scaleMax: 2,
      handleWheel: (event: WheelEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (editStarting) return;
        setMenu(null);
        const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
        const scale = Math.min(2, Math.max(0.05, mind.scaleVal * Math.exp(-delta * 0.0018)));
        mind.scale(scale, { x: event.clientX, y: event.clientY });
      },
      theme: canvasTheme(lastTheme),
      before: {
        beginEdit: (topic?: Topic) => {
          const node = topic?.nodeObj || mind.currentNode?.nodeObj;
          const map = snapshotRef.current.maps.find((item) => item.id === props.mapId);
          if (
            !node ||
            !snapshotRef.current.nodes.some((item) => item.id === node.id) ||
            (topic && !topic.isConnected) ||
            (map?.system && node.id === map.rootId)
          )
            return false;
          editingNodeId = node.id;
          // Core's before hook is async; hold refresh until editTopic has had
          // one frame to create its IME-safe contenteditable element.
          editStarting = true;
          cancelAnimationFrame(editFrame);
          editFrame = requestAnimationFrame(() => {
            editStarting = false;
          });
          return true;
        },
        addChild: (topic?: Topic) => {
          const id = topic?.nodeObj.id || mind.currentNode?.nodeObj.id;
          if (id) propsRef.current.onAdd?.(id, false);
          return false;
        },
        insertSibling: (_position, topic?: Topic) => {
          const id = topic?.nodeObj.id || mind.currentNode?.nodeObj.id;
          if (id) propsRef.current.onAdd?.(id, true);
          return false;
        },
        removeNodes: (topics: Topic[]) => {
          deleteRef.current(topics.map((topic) => topic.nodeObj.id));
          return false;
        },
        insertParent: () => false,
        copyNodes: () => false,
      },
    });
    mindRef.current = mind;
    // A percentage transform origin moves when folding changes the map's
    // dimensions. Keep a fixed canvas origin and zoom around the user's pointer
    // so a document refresh never changes the viewport coordinate system.
    mind.map.style.transformOrigin = '0px 0px';
    mind.scale = (requested, point) => {
      const next = Math.min(mind.scaleMax, Math.max(mind.scaleMin, requested));
      const ratio = next / mind.scaleVal;
      const viewport = mind.container.getBoundingClientRect();
      const before = mind.map.getBoundingClientRect();
      const x = point?.x ?? viewport.left + viewport.width / 2;
      const y = point?.y ?? viewport.top + viewport.height / 2;
      const transform = new DOMMatrixReadOnly(mind.map.style.transform);
      const tx = transform.m41 + (x - before.left) * (1 - ratio);
      const ty = transform.m42 + (y - before.top) * (1 - ratio);
      mind.map.style.transition = 'none';
      mind.map.style.transformOrigin = '0px 0px';
      mind.map.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${next})`;
      mind.scaleVal = next;
      mind.bus.fire('scale', next);
    };
    // Core owns this SVG container for links between its root and the first
    // level. Descendant links live in each branch and remain visible.
    mind.lines.classList.add('mindmap-root-links');
    const scheduleLayout = () => {
      if (disposed || !initialized || layoutFrame || layoutTimer !== null) return;
      const measure = () => {
        cancelAnimationFrame(layoutFrame);
        if (layoutTimer !== null) clearTimeout(layoutTimer);
        layoutFrame = 0;
        layoutTimer = null;
        if (disposed || !initialized) return;
        // React can commit the root-collapse class after an IPC response has
        // already refreshed Core. Measure after that commit, never while the
        // expanded branches still inherit display:none from the old state.
        alignEditor();
        mind.linkDiv();
      };
      layoutFrame = requestAnimationFrame(measure);
      // Windows may suspend animation frames for hidden or occluded windows;
      // cross-window edits still need correct geometry when they reappear.
      layoutTimer = setTimeout(measure, 32);
    };

    const requestEdit = (id: string) => {
      if (disposed || !initialized || failedRef.current || host.querySelector('#input-box')) return;
      const topic = findRenderedTopic(host, id);
      if (!topic) return;
      setMenu(null);
      mind.selectNodes([topic]);
      void mind.beginEdit(topic);
    };
    editRef.current = requestEdit;

    const requestDelete = (ids: string[]) => {
      if (disposed || failedRef.current) return;
      const state = snapshotRef.current;
      const wanted = new Set(ids);
      const nodes = state.nodes.filter(
        (node) => wanted.has(node.id) && node.parentId && node.mapId === props.mapId,
      );
      const roots = nodes.filter(
        (node) =>
          !nodes.some(
            (other) =>
              other.id !== node.id &&
              getDescendants(state, other.id).some((descendant) => descendant.id === node.id),
          ),
      );
      if (!roots.length) return;
      const count = roots.reduce((sum, node) => sum + getDescendants(state, node.id).length, 0);
      if (
        count &&
        !window.confirm(
          `将删除所选节点及 ${count} 个子节点，导图和待办会同步删除，可通过撤销恢复。\n\n确定删除？`,
        )
      )
        return;
      setMenu(null);
      const activeInput = host.querySelector<HTMLElement>('#input-box');
      activeInput?.blur();
      mind.clearSelection();
      pendingFocusRef.current = null;
      const removed = new Set(
        roots.flatMap((node) => [node.id, ...getDescendants(state, node.id).map((child) => child.id)]),
      );
      const fallback =
        state.nodes.find((node) => node.id === roots[0].parentId && node.parentId) ??
        state.nodes.find((node) => node.parentId === roots[0].parentId && !removed.has(node.id));
      if (fallback) propsRef.current.onSelect(fallback.id);
      enqueue(roots.map((node) => ({ type: 'node.delete', id: node.id })));
    };
    deleteRef.current = requestDelete;

    levelRef.current = (level) => {
      const state = snapshotRef.current;
      const plan = expansionPlan(state, props.mapId, level, propsRef.current.selectedId);
      pendingFocusRef.current = null;
      if (plan.selectedId) {
        userSelectionRef.current = plan.selectedId;
        propsRef.current.onSelect(plan.selectedId);
      }
      enqueue(plan.commands);
    };

    const selectVisible = (id: string | null, center: boolean) => {
      if (!id || disposed || !initialized) return false;
      if (!snapshotRef.current.nodes.some((node) => node.id === id && node.mapId === props.mapId))
        return false;
      const target = findRenderedTopic(host, id);
      if (!target) return false;
      if (mind.currentNode?.nodeObj.id !== id) {
        // selectNode always scrolls, which would make every progress update
        // jump back to the selection after refresh clears its DOM reference.
        mind.clearSelection();
        mind.selectNodes([target]);
      }
      if (center) {
        const rect = target.getBoundingClientRect(),
          viewport = host.getBoundingClientRect();
        if (
          rect.left < viewport.left + 16 ||
          rect.right > viewport.right - 16 ||
          rect.top < viewport.top + 16 ||
          rect.bottom > viewport.bottom - 64
        ) {
          const transform = new DOMMatrixReadOnly(mind.map.style.transform);
          const x = transform.m41 + viewport.left + viewport.width / 2 - rect.left - rect.width / 2;
          const y = transform.m42 + viewport.top + (viewport.height - 48) / 2 - rect.top - rect.height / 2;
          mind.map.style.transition = 'none';
          mind.map.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${mind.scaleVal})`;
        }
      }
      return true;
    };

    const fit = () => {
      if (disposed || !initialized || editStarting || host.querySelector('#input-box')) return;
      const topics = [...mind.nodes.querySelectorAll<HTMLElement>('.me-tpc')];
      if (!topics.length || !mind.container.clientWidth || !mind.container.clientHeight) return;
      const bounds = () => {
        const rectangles = topics
          .map((topic) => topic.getBoundingClientRect())
          .filter((rect) => rect.width && rect.height);
        if (!rectangles.length) return null;
        const left = Math.min(...rectangles.map((rect) => rect.left)),
          right = Math.max(...rectangles.map((rect) => rect.right));
        const top = Math.min(...rectangles.map((rect) => rect.top)),
          bottom = Math.max(...rectangles.map((rect) => rect.bottom));
        return { left, right, top, bottom, width: right - left, height: bottom - top };
      };
      mind.map.style.transition = 'none';
      mind.scaleFit();
      mind.map.style.transformOrigin = '0px 0px';
      const before = bounds(),
        viewport = mind.container.getBoundingClientRect();
      if (!before) return;
      const scale = fittedScale(
        before.width / mind.scaleVal,
        before.height / mind.scaleVal,
        viewport.width,
        viewport.height,
      );
      mind.scale(scale);
      const after = bounds();
      if (after) {
        // Core constrains move() using its invisible compatibility root's
        // layout bounds. Fitting uses actual visible topics instead.
        const transform = new DOMMatrixReadOnly(mind.map.style.transform);
        const x = transform.m41 + viewport.left + viewport.width / 2 - (after.left + after.right) / 2;
        const y = transform.m42 + viewport.top + (viewport.height - 48) / 2 - (after.top + after.bottom) / 2;
        mind.map.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${mind.scaleVal})`;
      }
    };
    fitRef.current = fit;

    const sync = () => {
      if (
        disposed ||
        !initialized ||
        syncing ||
        queueRef.current.length ||
        savingRef.current ||
        failedRef.current
      )
        return;
      // A remote update must not discard a local Chinese IME composition/draft.
      if (editStarting || host.querySelector('#input-box')) return;
      const current = { ...propsRef.current, snapshot: snapshotRef.current };
      if (current.mapId !== props.mapId || !current.snapshot.maps.some((map) => map.id === props.mapId))
        return;
      try {
        const data = buildCanvasData(current.snapshot, props.mapId);
        const themeChanged = current.snapshot.settings.theme !== lastTheme;
        const fontChanged = current.snapshot.settings.fontSize !== lastFontSize;
        const dataChanged = canvasSignature(mind.getData()) !== canvasSignature(data);
        syncing = true;
        if (themeChanged) {
          mind.changeTheme(canvasTheme(current.snapshot.settings.theme), false);
          lastTheme = current.snapshot.settings.theme;
        }
        if (dataChanged || themeChanged) {
          const transform = mind.map.style.transform;
          mind.refresh(data);
          mind.map.style.transformOrigin = '0px 0px';
          mind.map.style.transform = transform;
        }
        if (fontChanged) {
          mind.linkDiv();
          lastFontSize = current.snapshot.settings.fontSize;
        }
        if (
          pendingFocusRef.current &&
          !current.snapshot.nodes.some(
            (node) => node.id === pendingFocusRef.current && node.mapId === props.mapId,
          )
        )
          pendingFocusRef.current = null;
        if (pendingFocusRef.current && selectVisible(pendingFocusRef.current, true)) {
          pendingFocusRef.current = null;
        } else if (current.selectedId) {
          if (!selectVisible(current.selectedId, false) && !pendingFocusRef.current) {
            // If a selected descendant is folded away locally or remotely,
            // keep a visible selection on the outermost folded ancestor. A
            // later "locate" request can then select the descendant anew.
            const index = new Map(current.snapshot.nodes.map((node) => [node.id, node]));
            let ancestor = index.get(current.selectedId),
              collapsed: string | null = null;
            while (ancestor?.parentId) {
              ancestor = index.get(ancestor.parentId);
              if (ancestor && !ancestor.expanded) collapsed = ancestor.id;
            }
            if (collapsed) {
              userSelectionRef.current = collapsed;
              selectVisible(collapsed, false);
              current.onSelect(collapsed);
            }
          }
        }
      } catch (error) {
        current.onError(messageOf(error));
      } finally {
        syncing = false;
        scheduleLayout();
      }
    };
    syncRef.current = sync;

    const operation = (event: CanvasOperation) => {
      if (syncing || disposed) return;
      if (event.name === 'beginEdit') {
        const node = Array.isArray(event.target) ? event.target[0] : event.target;
        if (!node) return;
        // The contenteditable now exists and becomes the refresh guard. Do
        // not leave the async-before lock waiting for a suspended hidden frame.
        editStarting = false;
        cancelAnimationFrame(editFrame);
        cleanupEditor();
        editingNodeId = node.id;
        const input = host.querySelector<HTMLElement>('#input-box');
        const topic = findRenderedTopic(host, node.id);
        if (!input || !topic || disposed) return;
        const text = topic.text ?? topic;
        const originalText = text.textContent;
        const originalMinWidth = topic.style.minWidth,
          originalMinHeight = topic.style.minHeight;
        const originalRect = topic.getBoundingClientRect();
        topic.style.minWidth = `${originalRect.width / mind.scaleVal}px`;
        topic.style.minHeight = `${originalRect.height / mind.scaleVal}px`;
        alignEditor = () => {
          if (!input.isConnected || !topic.isConnected) return;
          const rect = topic.getBoundingClientRect(),
            nodesRect = mind.nodes.getBoundingClientRect();
          const style = getComputedStyle(topic),
            scale = mind.scaleVal || 1;
          // The editor covers the complete node, including the progress area.
          // Its invisible text stays in normal flow while typing, so children,
          // siblings and connectors reserve the real draft dimensions.
          input.style.boxSizing = 'border-box';
          input.style.left = `${(rect.left - nodesRect.left) / scale}px`;
          input.style.top = `${(rect.top - nodesRect.top) / scale}px`;
          input.style.right = 'auto';
          input.style.margin = '0';
          input.style.fontFamily = style.fontFamily;
          input.style.fontWeight = style.fontWeight;
          input.style.fontSize = style.fontSize;
          input.style.lineHeight = getComputedStyle(text).lineHeight;
          input.style.width = `${rect.width / scale}px`;
          input.style.minWidth = `${rect.width / scale}px`;
          input.style.maxWidth = 'none';
          input.style.minHeight = `${rect.height / scale}px`;
        };
        const measureDraft = () => {
          text.textContent = input.innerText;
          alignEditor();
          mind.linkDiv();
          scheduleLayout();
        };
        cleanupEditor = () => {
          input.removeEventListener('input', measureDraft);
          input.removeEventListener('blur', cleanupEditor, true);
          text.textContent = originalText;
          topic.style.minWidth = originalMinWidth;
          topic.style.minHeight = originalMinHeight;
          editingNodeId = null;
          alignEditor = () => {};
          cleanupEditor = () => {};
          scheduleLayout();
          queueMicrotask(sync);
        };
        input.addEventListener('input', measureDraft);
        input.addEventListener('blur', cleanupEditor, true);
        alignEditor();
        scheduleLayout();
        return;
      }
      if (event.name === 'finishEdit') editingNodeId = null;
      const commands = operationCommands(event, props.mapId);
      enqueue(commands);
    };
    const select = (nodes: NodeObj[]) => {
      if (syncing || disposed || !nodes.length) return;
      userSelectionRef.current = nodes[nodes.length - 1].id;
      propsRef.current.onSelect(nodes[nodes.length - 1].id);
    };
    mind.bus.addListener('operation', (event) => {
      if (Array.isArray(event.target) || 'topic' in event.target) operation(event as CanvasOperation);
    });
    mind.bus.addListener('selectNodes', select);
    mind.bus.addListener('selectNewNode', (node) => {
      userSelectionRef.current = node.id;
      propsRef.current.onSelect(node.id);
    });
    mind.bus.addListener('scale', (value) => {
      if (!disposed) setZoom(Math.round(value * 100));
    });

    const keydown = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        (event.target instanceof HTMLElement &&
          (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)))
      )
        return;
      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (ctrl && (key === 'z' || key === 'y')) {
        event.preventDefault();
        event.stopPropagation();
        if (failedRef.current) return;
        enqueue([{ type: key === 'y' || event.shiftKey ? 'history.redo' : 'history.undo' }]);
        return;
      }
      if (ctrl && ['+', '=', '-', '0'].includes(key)) {
        event.preventDefault();
        event.stopPropagation();
        mind.scale(key === '0' ? 1 : mind.scaleVal + (key === '-' ? -0.1 : 0.1));
        return;
      }
      if (failedRef.current || !mind.currentNode) return;
      if (event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        propsRef.current.onAdd?.(mind.currentNode.nodeObj.id, false);
      } else if (event.key === 'Enter' && !ctrl) {
        event.preventDefault();
        event.stopPropagation();
        propsRef.current.onAdd?.(mind.currentNode.nodeObj.id, true);
      } else if (event.key === 'F2') {
        event.preventDefault();
        event.stopPropagation();
        requestEdit(mind.currentNode.nodeObj.id);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        event.stopPropagation();
        requestDelete(mind.currentNodes.map((topic) => topic.nodeObj.id));
      } else if (event.key.startsWith('Arrow')) {
        const node = mind.currentNode.nodeObj;
        let target: NodeObj | undefined;
        if (event.key === 'ArrowLeft') target = node.parent;
        if (event.key === 'ArrowRight') target = node.children?.[0];
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          const siblings = node.parent?.children || [];
          const index = siblings.findIndex((item) => item.id === node.id);
          target = siblings[index + (event.key === 'ArrowUp' ? -1 : 1)];
        }
        if (target) {
          event.preventDefault();
          event.stopPropagation();
          selectVisible(target.id, false);
        }
      }
    };
    host.addEventListener('keydown', keydown);
    const doubleClick = (event: MouseEvent) => {
      if (
        failedRef.current ||
        editStarting ||
        host.querySelector('#input-box') ||
        !(event.target instanceof Element)
      )
        return;
      const topic = event.target.closest<HTMLElement>('.me-tpc') as Topic | null;
      if (!topic || !host.contains(topic) || !topic.nodeObj) return;
      event.preventDefault();
      event.stopPropagation();
      // Core uses its own pointer-up detector. Native dblclick is a fallback
      // for desktop event sequences where that detector only selected a node.
      requestEdit(topic.nodeObj.id);
    };
    host.addEventListener('dblclick', doubleClick);
    const contextMenu = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || event.target.closest('#input-box')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const topic = event.target.closest<HTMLElement>('.me-tpc') as Topic | null;
      const id = topic?.nodeObj.id ?? null;
      if (id && !snapshotRef.current.nodes.some((node) => node.id === id)) return;
      if (id) {
        mind.clearSelection();
        mind.selectNodes([topic!]);
      }
      const rect = host.getBoundingClientRect();
      setMenu({
        id,
        x: Math.max(8, Math.min(event.clientX - rect.left, rect.width - 194)),
        y: Math.max(8, Math.min(event.clientY - rect.top, rect.height - (id ? 248 : 104))),
      });
    };
    host.addEventListener('contextmenu', contextMenu, true);
    const onBlur = () => {
      cancelAnimationFrame(focusFrame);
      focusFrame = requestAnimationFrame(sync);
    };
    host.addEventListener('focusout', onBlur);
    const resizeObserver = new ResizeObserver(() => {
      if (initialized && !disposed) {
        scheduleLayout();
        setMenu((previous) =>
          previous
            ? {
                ...previous,
                x: Math.max(8, Math.min(previous.x, host.clientWidth - 194)),
                y: Math.max(8, Math.min(previous.y, host.clientHeight - (previous.id ? 248 : 104))),
              }
            : null,
        );
      }
    });
    resizeObserver.observe(host);
    const nodeSizeObserver = new ResizeObserver(scheduleLayout);
    nodeSizeObserver.observe(mind.nodes);
    const cssObserver = new MutationObserver(scheduleLayout);
    if (host.parentElement)
      cssObserver.observe(host.parentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    Promise.resolve(mind.init(buildCanvasData(snapshotRef.current, props.mapId)))
      .then(() => {
        if (disposed) return;
        initialized = true;
        setReady(true);
        setZoom(100);
        fit();
        sync();
      })
      .catch((error) => {
        if (!disposed) propsRef.current.onError(messageOf(error));
      });

    return () => {
      // Removing a focused DOM element does not reliably dispatch blur. Commit
      // the current title before switching maps/views instead of losing it.
      const editor = host.querySelector<HTMLElement>('#input-box');
      const draft = editor?.innerText.trim();
      const oldNode = editingNodeId
        ? snapshotRef.current.nodes.find((node) => node.id === editingNodeId)
        : undefined;
      if (oldNode && draft && draft !== oldNode.title)
        enqueue([{ type: 'node.update', id: oldNode.id, patch: { title: draft } }]);
      disposed = true;
      cleanupEditor();
      cancelAnimationFrame(focusFrame);
      cancelAnimationFrame(editFrame);
      cancelAnimationFrame(layoutFrame);
      if (layoutTimer !== null) clearTimeout(layoutTimer);
      resizeObserver.disconnect();
      nodeSizeObserver.disconnect();
      cssObserver.disconnect();
      host.removeEventListener('keydown', keydown);
      host.removeEventListener('focusout', onBlur);
      host.removeEventListener('dblclick', doubleClick);
      host.removeEventListener('contextmenu', contextMenu, true);
      if (mindRef.current === mind) mindRef.current = null;
      fitRef.current = () => {};
      editRef.current = () => {};
      deleteRef.current = () => {};
      levelRef.current = () => {};
      mind.destroy();
    };
    // A map change creates a fresh canvas; document revisions use granular refresh below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mapId]);

  useEffect(() => {
    syncRef.current();
  }, [props.snapshot]);

  useEffect(() => {
    if (!menu) return;
    if (menu.id && !props.snapshot.nodes.some((node) => node.id === menu.id)) {
      setMenu(null);
      return;
    }
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setMenu(null);
    };
    window.addEventListener('pointerdown', dismiss, true);
    return () => window.removeEventListener('pointerdown', dismiss, true);
  }, [menu, props.snapshot.nodes]);

  useEffect(() => {
    if (!ready || !props.selectedId) {
      pendingFocusRef.current = null;
      return;
    }
    const selected = props.snapshot.nodes.find(
      (node) => node.id === props.selectedId && node.mapId === props.mapId,
    );
    if (!selected) return;
    const commands: Command[] = [];
    let parent = props.snapshot.nodes.find((node) => node.id === selected.parentId);
    while (parent) {
      if (!parent.expanded) commands.push({ type: 'node.update', id: parent.id, patch: { expanded: true } });
      parent = props.snapshot.nodes.find((node) => node.id === parent!.parentId);
    }
    if (commands.length || userSelectionRef.current !== props.selectedId)
      pendingFocusRef.current = props.selectedId;
    if (commands.length) {
      enqueue(commands);
      return;
    }
    syncRef.current();
    // Only explicit selection/map changes should re-center, never ordinary edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectedId, props.mapId, ready]);

  return (
    <div
      style={{ fontSize: props.snapshot.settings.fontSize }}
      className={`mindmap-shell mindmap-${props.snapshot.settings.theme}${props.snapshot.maps.find((map) => map.id === props.mapId)?.system ? ' mindmap-draft' : props.snapshot.nodes.find((node) => node.mapId === props.mapId && !node.parentId)?.expanded === false ? ' mindmap-root-collapsed' : ''}`}
    >
      <div className="mindmap-surface" ref={hostRef} aria-label="思维导图画布" />
      {!ready && <div className="mindmap-loading">正在展开你的想法…</div>}
      {saveError && (
        <div className="mindmap-save-error" role="alert">
          <span>修改尚未保存：{saveError}</span>
          <button
            type="button"
            onClick={() => {
              failedRef.current = false;
              setSaveError('');
              mindRef.current?.enableEdit();
              void drain();
            }}
          >
            重试保存
          </button>
          <button
            type="button"
            onClick={() => {
              queueRef.current = [];
              failedRef.current = false;
              setSaveError('');
              mindRef.current?.enableEdit();
              syncRef.current();
            }}
          >
            放弃修改
          </button>
        </div>
      )}
      {menu && (
        <div
          ref={menuRef}
          className="mindmap-context-menu"
          role="menu"
          aria-label="节点操作"
          style={{ left: menu.x, top: menu.y }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setMenu(null);
              mindRef.current?.container.focus();
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              event.stopPropagation();
              const buttons = [
                ...menuRef.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
              ];
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              buttons[
                (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
              ]?.focus();
            }
          }}
        >
          {menu.id ? (
            <>
              <button
                role="menuitem"
                disabled={!props.onAdd}
                onClick={() => {
                  props.onAdd?.(menu.id!, false);
                  setMenu(null);
                }}
              >
                添加子项<span>Tab</span>
              </button>
              <button
                role="menuitem"
                disabled={!props.onAdd || !props.snapshot.nodes.find((node) => node.id === menu.id)?.parentId}
                onClick={() => {
                  props.onAdd?.(menu.id!, true);
                  setMenu(null);
                }}
              >
                添加同级<span>Enter</span>
              </button>
              <button role="menuitem" onClick={() => editRef.current(menu.id!)}>
                编辑名称<span>F2</span>
              </button>
              <button
                role="menuitem"
                disabled={!props.onPlan}
                onClick={() => {
                  props.onPlan?.(menu.id!);
                  setMenu(null);
                }}
              >
                {props.snapshot.nodes.find((node) => node.id === menu.id)?.task?.planned
                  ? '调整计划'
                  : '关联计划'}
              </button>
              <div className="mindmap-menu-divider" />
              <button
                role="menuitem"
                className="mindmap-menu-danger"
                disabled={!props.snapshot.nodes.find((node) => node.id === menu.id)?.parentId}
                onClick={() => deleteRef.current([menu.id!])}
              >
                删除节点<span>Delete</span>
              </button>
            </>
          ) : (
            <>
              <button
                role="menuitem"
                disabled={!props.onAdd}
                onClick={() => {
                  const map = props.snapshot.maps.find((item) => item.id === props.mapId);
                  if (map) props.onAdd?.(map.rootId, false);
                  setMenu(null);
                }}
              >
                新建分支
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  fitRef.current();
                  setMenu(null);
                }}
              >
                适应画布
              </button>
            </>
          )}
        </div>
      )}
      <div className="mindmap-footer">
        <span className="mindmap-help">空白拖动平移 · 滚轮缩放 · 右键操作</span>
        <div className="mindmap-zoom" aria-label="导图缩放">
          <select
            className="mindmap-level"
            aria-label="导图展开层级"
            value=""
            onChange={(event) => levelRef.current(event.target.value as 'main' | 'two' | 'all')}
          >
            <option value="" disabled>
              展开层级
            </option>
            <option value="main">主干一层</option>
            <option value="two">展开两层</option>
            <option value="all">展开全部</option>
          </select>
          <span className="mindmap-zoom-divider" />
          <button
            type="button"
            title="缩小导图"
            aria-label="缩小导图"
            onClick={() => {
              const mind = mindRef.current;
              if (mind) mind.scale(mind.scaleVal - 0.1);
            }}
          >
            −
          </button>
          <button
            type="button"
            className="mindmap-zoom-value"
            title="恢复原始比例"
            onClick={() => mindRef.current?.scale(1)}
          >
            {zoom}%
          </button>
          <button
            type="button"
            title="放大导图"
            aria-label="放大导图"
            onClick={() => {
              const mind = mindRef.current;
              if (mind) mind.scale(mind.scaleVal + 0.1);
            }}
          >
            +
          </button>
          <span className="mindmap-zoom-divider" />
          <button
            type="button"
            className="mindmap-fit"
            title="适应画布，显示完整导图"
            aria-label="适应画布"
            onClick={() => fitRef.current()}
          >
            适应画布
          </button>
        </div>
      </div>
    </div>
  );
}
