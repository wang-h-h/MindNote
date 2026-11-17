import { contextBridge, ipcRenderer } from 'electron';
import type { Command, MindNoteAPI, Snapshot, WindowPresentation } from '../shared/types';

const focusListeners = new Set<(id: string) => void>();
let pendingFocus: string | undefined;
ipcRenderer.on('mindnote:focus-node', (_event, id: string) => {
  if (focusListeners.size === 0) pendingFocus = id;
  else for (const listener of focusListeners) listener(id);
});

/** Only this small, typed surface crosses the renderer/main trust boundary. */
const api: MindNoteAPI = {
  getSnapshot: () => ipcRenderer.invoke('mindnote:snapshot'),
  dispatch: (command: Command) => ipcRenderer.invoke('mindnote:dispatch', command),
  onChange: (listener: (snapshot: Snapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: Snapshot) => listener(snapshot);
    ipcRenderer.on('mindnote:changed', handler);
    return () => ipcRenderer.removeListener('mindnote:changed', handler);
  },
  onFocusNode: (listener: (id: string) => void) => {
    focusListeners.add(listener);
    if (pendingFocus) {
      const id = pendingFocus;
      pendingFocus = undefined;
      queueMicrotask(() => {
        if (focusListeners.has(listener)) listener(id);
      });
    }
    return () => {
      focusListeners.delete(listener);
    };
  },
  showMain: (nodeId?: string) => ipcRenderer.invoke('mindnote:show-main', nodeId),
  showSticky: () => ipcRenderer.invoke('mindnote:show-sticky'),
  hideWindow: () => ipcRenderer.invoke('mindnote:hide-window'),
  minimizeWindow: () => ipcRenderer.invoke('mindnote:minimize-window'),
  toggleMaximize: () => ipcRenderer.invoke('mindnote:toggle-maximize'),
  resizeSticky: (width: number, height: number) =>
    ipcRenderer.invoke('mindnote:resize-sticky', width, height),
  resizeMain: (bounds) => ipcRenderer.invoke('mindnote:resize-main', bounds),
  importBackgroundImage: () => ipcRenderer.invoke('mindnote:import-background'),
  getBackgroundImageURL: (id, still) => ipcRenderer.invoke('mindnote:background-url', id, still),
  getWindowBounds: () => ipcRenderer.invoke('mindnote:window-bounds'),
  getWindowPresentation: () => ipcRenderer.invoke('mindnote:window-presentation'),
  onWindowPresentation: (listener: (state: WindowPresentation) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: WindowPresentation) => listener(state);
    ipcRenderer.on('mindnote:window-presentation-changed', handler);
    return () => ipcRenderer.removeListener('mindnote:window-presentation-changed', handler);
  },
  backup: () => ipcRenderer.invoke('mindnote:backup'),
  restore: () => ipcRenderer.invoke('mindnote:restore'),
  openDataFolder: () => ipcRenderer.invoke('mindnote:open-data-folder'),
  quit: () => ipcRenderer.invoke('mindnote:quit'),
};

contextBridge.exposeInMainWorld('mindnote', Object.freeze(api));
