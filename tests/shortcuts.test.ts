import { describe, expect, it } from 'vitest';
import { appShortcut } from '../src/shared/shortcuts';

const context = { editing: false, dialogOpen: false, inMindMap: false };
const key = (value: string, overrides = {}) => ({
  key: value,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...overrides,
});

describe('platform application shortcuts', () => {
  it('uses Command for macOS capture, search and application history', () => {
    expect(appShortcut(key('n', { metaKey: true }), 'darwin', context)).toBe('new-task');
    expect(appShortcut(key('k', { metaKey: true }), 'darwin', context)).toBe('search');
    expect(appShortcut(key('z', { metaKey: true }), 'darwin', context)).toBe('undo');
    expect(appShortcut(key('Z', { metaKey: true, shiftKey: true }), 'darwin', context)).toBe('redo');
    expect(appShortcut(key('n', { ctrlKey: true }), 'darwin', context)).toBeNull();
    expect(appShortcut(key('y', { metaKey: true }), 'darwin', context)).toBeNull();
  });
  it('retains Control shortcuts and both Windows redo combinations', () => {
    expect(appShortcut(key('n', { ctrlKey: true }), 'win32', context)).toBe('new-task');
    expect(appShortcut(key('k', { ctrlKey: true }), 'win32', context)).toBe('search');
    expect(appShortcut(key('z', { ctrlKey: true }), 'win32', context)).toBe('undo');
    expect(appShortcut(key('y', { ctrlKey: true }), 'win32', context)).toBe('redo');
    expect(appShortcut(key('Z', { ctrlKey: true, shiftKey: true }), 'win32', context)).toBe('redo');
  });
  it('leaves native text undo and mind-map keyboard handling in control', () => {
    for (const platform of ['win32', 'darwin']) {
      const modifier = platform === 'darwin' ? { metaKey: true } : { ctrlKey: true };
      expect(appShortcut(key('z', modifier), platform, { ...context, editing: true })).toBeNull();
      expect(appShortcut(key('n', modifier), platform, { ...context, dialogOpen: true })).toBeNull();
      expect(appShortcut(key('z', modifier), platform, { ...context, inMindMap: true })).toBeNull();
      expect(appShortcut(key('k', modifier), platform, { ...context, dialogOpen: true })).toBeNull();
    }
  });
  it('does not consume composition, handled events or Option/Alt shortcuts', () => {
    for (const flag of ['isComposing', 'defaultPrevented', 'altKey'])
      expect(appShortcut(key('n', { metaKey: true, [flag]: true }), 'darwin', context)).toBeNull();
  });
});
