export type ThemeName = 'light' | 'dark';
export type Filter = 'inbox' | 'today' | 'week' | 'month' | 'all';
export type Schedule = { mode: 'none' } | { mode: 'inherit' } | { mode: 'range'; start: string; end: string };
export interface Notes {
  progress: string;
  problems: string;
  other: string;
}
export interface TaskAttributes {
  schedule: Schedule;
  progress: number;
  planned: boolean;
}
export interface MindNode {
  id: string;
  mapId: string;
  parentId: string | null;
  order: number;
  title: string;
  expanded: boolean;
  notes: Notes;
  task: TaskAttributes | null;
  direction?: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}
export interface MindMap {
  id: string;
  rootId: string;
  title: string;
  system: boolean;
  createdAt: string;
}
export interface BackgroundImage {
  id: string;
  name: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
}
export interface AppSettings {
  theme: ThemeName;
  opacity: number;
  pinned: boolean;
  hideCompleted: boolean;
  filter: Filter;
  launchAtLogin: boolean;
  stickyCollapsed: boolean;
  blur: number;
  fontSize: number;
  reduceMotion: boolean;
  gridColumns: 1 | 2 | 3 | 4;
  backgroundImage: BackgroundImage | null;
}
export interface Snapshot {
  revision: number;
  maps: MindMap[];
  nodes: MindNode[];
  settings: AppSettings;
  canUndo: boolean;
  canRedo: boolean;
}
export type Command =
  | { type: 'map.create'; id: string; rootId: string; title: string }
  | { type: 'map.rename'; id: string; title: string }
  | { type: 'map.delete'; id: string }
  | {
      type: 'node.create';
      id: string;
      mapId: string;
      parentId: string;
      title: string;
      task?: boolean;
      schedule?: Schedule;
    }
  | {
      type: 'node.update';
      id: string;
      patch: {
        title?: string;
        notes?: Partial<Notes>;
        progress?: number;
        schedule?: Schedule;
        expanded?: boolean;
        direction?: number;
        planned?: boolean;
      };
    }
  | { type: 'node.move'; id: string; parentId: string; index?: number }
  | { type: 'node.delete'; id: string }
  | { type: 'node.convert'; id: string; start: string; end: string }
  | { type: 'settings.update'; patch: Partial<AppSettings> }
  | { type: 'batch'; commands: Command[] }
  | { type: 'history.undo' }
  | { type: 'history.redo' };
export interface WindowState {
  width: number;
  height: number;
  x: number;
  y: number;
}
export interface WindowPresentation {
  maximized: boolean;
  fullscreen: boolean;
}
export interface MindNoteAPI {
  /** Provided by the sandboxed preload, never inferred from the user agent. */
  readonly platform?: string;
  onHistoryAction?(listener: (action: 'undo' | 'redo') => void): () => void;
  getSnapshot(): Promise<Snapshot>;
  dispatch(command: Command): Promise<Snapshot>;
  onChange(listener: (snapshot: Snapshot) => void): () => void;
  onFocusNode(listener: (id: string) => void): () => void;
  showMain(nodeId?: string): Promise<void>;
  showSticky(): Promise<void>;
  hideWindow(): Promise<void>;
  minimizeWindow(): Promise<void>;
  toggleMaximize(): Promise<void>;
  resizeSticky(width: number, height: number): Promise<void>;
  resizeMain(bounds: WindowState): Promise<void>;
  getWindowBounds(): Promise<WindowState>;
  getWindowPresentation(): Promise<WindowPresentation>;
  onWindowPresentation(listener: (state: WindowPresentation) => void): () => void;
  importBackgroundImage(): Promise<{ canceled: boolean; snapshot?: Snapshot }>;
  getBackgroundImageURL(id: string, still?: boolean): Promise<string | null>;
  backup(): Promise<{ canceled: boolean; path?: string }>;
  restore(): Promise<{ canceled: boolean; path?: string }>;
  openDataFolder(): Promise<void>;
  quit(): Promise<void>;
}
declare global {
  interface Window {
    mindnote: MindNoteAPI;
  }
}
