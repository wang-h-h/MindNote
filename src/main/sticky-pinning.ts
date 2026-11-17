import type { BrowserWindow } from 'electron';

const applied = new WeakMap<BrowserWindow, boolean>();

/** Reassert topmost only on a user action or a native lifecycle transition. */
export function applyStickyPinning(window: BrowserWindow, pinned: boolean, reassert = false): void {
  if (window.isDestroyed()) return;
  const actual = window.isAlwaysOnTop();
  const changed = actual !== pinned || applied.get(window) !== pinned;
  if (!changed && !reassert) return;

  // Issue a fresh native z-order update on lifecycle transitions instead of
  // relying only on the cached topmost flag. The transition-only reset also
  // covers a window that reports true but no longer has the expected z-order.
  if (pinned && reassert && actual) window.setAlwaysOnTop(false);
  window.setAlwaysOnTop(pinned, pinned ? 'floating' : 'normal');
  applied.set(window, pinned);
  // floating stays above ordinary applications but below the Windows taskbar.
  // Raising the z-order must not activate the note or steal keyboard focus.
  if (pinned && window.isVisible() && !window.isMinimized()) window.moveTop();
}

export function observeStickyPinning(window: BrowserWindow, readPinned: () => boolean): void {
  const refresh = () => applyStickyPinning(window, readPinned(), true);
  window.on('show', refresh);
  window.on('restore', refresh);
  applyStickyPinning(window, readPinned());
}
