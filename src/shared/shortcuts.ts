export type AppShortcut = 'search' | 'new-task' | 'undo' | 'redo';

interface ShortcutKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
}

/** Keep native text editing and IME composition out of application history. */
export function appShortcut(
  event: ShortcutKey,
  platform: string,
  context: { editing: boolean; dialogOpen: boolean; inMindMap: boolean },
): AppShortcut | null {
  if (event.isComposing || event.defaultPrevented || event.altKey) return null;
  const modifier = platform === 'darwin' ? event.metaKey : event.ctrlKey;
  const key = event.key.toLowerCase();
  if (key === 'k' && (modifier || (platform !== 'darwin' && event.metaKey)))
    return context.dialogOpen ? null : 'search';
  if (!modifier) return null;
  if (context.editing || context.dialogOpen || context.inMindMap) return null;
  if (key === 'n') return 'new-task';
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && platform !== 'darwin') return 'redo';
  return null;
}
