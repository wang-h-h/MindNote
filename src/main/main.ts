import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  powerMonitor,
  screen,
  shell,
  Tray,
} from 'electron';
import type { IpcMainInvokeEvent, Rectangle } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MindNoteStore } from './store';
import { configureDataDirectory, migrateLegacyData } from './data-directory';
import { backgroundURL, readBackgroundImage, registerBackgroundProtocol } from './background-images';
import { applyStickyPinning, observeStickyPinning } from './sticky-pinning';
import type { Command, Snapshot, WindowPresentation, WindowState } from '../shared/types';

const squirrelStartup: boolean = process.platform === 'win32' && require('electron-squirrel-startup');
const isMac = process.platform === 'darwin';
const PRODUCT_NAME = '思维便签 MindNote';
const APP_ID = 'com.whh.MindNote';
const MIN_STICKY_WIDTH = 300;
const MIN_STICKY_HEIGHT = 380;
const COLLAPSED_HEIGHT = 56;
const MAX_COMMAND_BYTES = 2 * 1024 * 1024;

// A separate data directory makes development and automated tests independent
// from the installed application's personal notes.
let dataConfiguration: ReturnType<typeof configureDataDirectory>;
let dataConfigurationError: unknown;
try {
  dataConfiguration = configureDataDirectory(app);
} catch (error) {
  dataConfigurationError = error;
}
app.setName('MindNote');
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

const devURL = !app.isPackaged && process.env.MINDNOTE_DEV_URL ? new URL(process.env.MINDNOTE_DEV_URL) : null;
const rendererPath = path.resolve(__dirname, '../renderer/index.html');
const preloadPath = path.resolve(__dirname, 'preload.js');
let store: MindNoteStore;
let mainWindow: BrowserWindow | null = null;
let stickyWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let restoring = false;
let activeBackups = 0;
let quitAfterDatabaseOperation = false;
let expandedStickyHeight = 560;
let appliedCollapsed: boolean | undefined;
let appliedLogin: boolean | undefined;
let pendingFocusNode: string | undefined;
let mainMaximized = false;
let mainNormalBounds: Rectangle | undefined;
let recoveryErrorShown = false;
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const readyWindows = new WeakSet<BrowserWindow>();

function assetPath(filename: string): string {
  return path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'assets', filename);
}

function configureApplicationMenu(): void {
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }
  const history = (action: 'undo' | 'redo') => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused && (focused === mainWindow || focused === stickyWindow))
      focused.webContents.send('mindnote:history-action', action);
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      {
        label: '文件',
        submenu: [
          { label: '打开完整窗口', click: () => showMain() },
          { label: '显示桌面便签', click: () => showSticky() },
          { type: 'separator' },
          { role: 'close', label: '关闭窗口' },
        ],
      },
      {
        label: '编辑',
        submenu: [
          { label: '撤销', accelerator: 'Command+Z', click: () => history('undo') },
          { label: '重做', accelerator: 'Command+Shift+Z', click: () => history('redo') },
          { type: 'separator' },
          { role: 'cut', label: '剪切' },
          { role: 'copy', label: '复制' },
          { role: 'paste', label: '粘贴' },
          { role: 'selectAll', label: '全选' },
        ],
      },
      { role: 'windowMenu' },
    ]),
  );
}

function finiteRectangle(value: unknown): value is WindowState {
  if (!value || typeof value !== 'object') return false;
  const bounds = value as WindowState;
  return (
    [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) &&
    bounds.width > 0 &&
    bounds.height > 0
  );
}

/** All dimensions are DIP, so Windows display scaling is handled by Electron. */
function keepOnScreen(bounds: Rectangle, sticky: boolean): Rectangle {
  const display = screen.getDisplayMatching(bounds);
  const work = display.workArea;
  // Chromium rounds both edges outward when DIP coordinates land on half a
  // physical pixel. Reapplying those rounded bounds can grow a frameless window
  // by one DIP each time at 125/150/175% scaling. Align to the integer-DIP grid
  // shared by physical pixels for standard Windows quarter-step scale factors.
  const quarters = Math.round(display.scaleFactor * 4);
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const quantum = Math.abs(quarters / 4 - display.scaleFactor) < 0.0001 ? 4 / gcd(quarters, 4) : 1;
  const minWidth = Math.min(sticky ? MIN_STICKY_WIDTH : 880, work.width);
  const minHeight = Math.min(sticky ? COLLAPSED_HEIGHT : 620, work.height);
  const width = Math.min(
    Math.floor(work.width / quantum) * quantum,
    Math.max(Math.ceil(minWidth / quantum) * quantum, Math.floor(bounds.width / quantum) * quantum),
  );
  const height = Math.min(
    Math.floor(work.height / quantum) * quantum,
    Math.max(Math.ceil(minHeight / quantum) * quantum, Math.floor(bounds.height / quantum) * quantum),
  );
  const x = Math.min(
    Math.floor((work.x + work.width - width) / quantum) * quantum,
    Math.max(Math.ceil(work.x / quantum) * quantum, Math.round(bounds.x / quantum) * quantum),
  );
  const y = Math.min(
    Math.floor((work.y + work.height - height) / quantum) * quantum,
    Math.max(Math.ceil(work.y / quantum) * quantum, Math.round(bounds.y / quantum) * quantum),
  );
  return { x, y, width, height };
}

function updateWindowBounds(window: BrowserWindow, desired: Rectangle, sticky: boolean): void {
  const current = window.getBounds();
  const target = keepOnScreen(desired, sticky);
  const changed: Partial<Rectangle> = {};
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (target[key] !== current[key]) changed[key] = target[key];
  }
  if (Object.keys(changed).length) window.setBounds(changed);
}

function initialBounds(key: 'main' | 'sticky'): Rectangle {
  const saved = store.getWindowState(key);
  const work = screen.getPrimaryDisplay().workArea;
  const defaults =
    key === 'sticky'
      ? { x: work.x + work.width - 384, y: work.y + 24, width: 360, height: 560 }
      : {
          x: work.x + (work.width - 1280) / 2,
          y: work.y + (work.height - 840) / 2,
          width: 1280,
          height: 840,
        };
  const base = finiteRectangle(saved) ? saved : defaults;
  if (key === 'sticky') {
    expandedStickyHeight = Math.max(MIN_STICKY_HEIGHT, base.height);
    return keepOnScreen(
      {
        ...base,
        height: store.snapshot().settings.stickyCollapsed ? COLLAPSED_HEIGHT : expandedStickyHeight,
      },
      true,
    );
  }
  return keepOnScreen(base, false);
}

function persistBounds(key: string, window: BrowserWindow): void {
  if (restoring || window.isDestroyed() || !store) return;
  // Maximized windows should reopen at their last normal size.
  const bounds = keepOnScreen(
    key === 'main' && mainMaximized && mainNormalBounds ? mainNormalBounds : window.getNormalBounds(),
    key === 'sticky',
  );
  if (key === 'sticky') {
    if (!store.snapshot().settings.stickyCollapsed)
      expandedStickyHeight = Math.max(MIN_STICKY_HEIGHT, bounds.height);
    bounds.height = expandedStickyHeight;
  }
  try {
    store.setWindowState(key, bounds);
  } catch (error) {
    reportPersistenceError(error);
  }
}

function reportPersistenceError(error: unknown): void {
  console.error('[MindNote] Window state could not be saved:', error);
  if (recoveryErrorShown || quitting) return;
  recoveryErrorShown = true;
  void dialog
    .showMessageBox({
      type: 'error',
      title: PRODUCT_NAME,
      message: '窗口位置暂时无法保存',
      detail: error instanceof Error ? error.message : String(error),
    })
    .finally(() => {
      recoveryErrorShown = false;
    });
}

function observeBounds(key: string, window: BrowserWindow): void {
  const saveLater = () => {
    clearTimeout(saveTimers.get(key));
    saveTimers.set(
      key,
      setTimeout(() => {
        saveTimers.delete(key);
        persistBounds(key, window);
      }, 250),
    );
  };
  window.on('move', saveLater);
  window.on('resize', saveLater);
  if (key === 'sticky') {
    let userMoving = false;
    let snapTimer: ReturnType<typeof setTimeout> | undefined;
    window.on('will-move', () => {
      userMoving = true;
    });
    const snap = () => {
      if (!userMoving || window.isDestroyed()) return;
      userMoving = false;
      const bounds = window.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      const threshold = 16;
      const target = { ...bounds };
      if (Math.abs(bounds.x - area.x) <= threshold) target.x = area.x;
      else if (Math.abs(bounds.x + bounds.width - area.x - area.width) <= threshold)
        target.x = area.x + area.width - bounds.width;
      if (Math.abs(bounds.y - area.y) <= threshold) target.y = area.y;
      else if (Math.abs(bounds.y + bounds.height - area.y - area.height) <= threshold)
        target.y = area.y + area.height - bounds.height;
      updateWindowBounds(window, target, true);
    };
    window.on('moved', () => {
      // On macOS "moved" is an alias of "move" and fires during dragging.
      // Wait for movement to settle instead of fighting the pointer each frame.
      if (isMac) {
        clearTimeout(snapTimer);
        snapTimer = setTimeout(snap, 120);
      } else snap();
    });
    window.on('closed', () => clearTimeout(snapTimer));
  }
  window.on('close', (event) => {
    persistBounds(key, window);
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
}

function getWindowPresentation(window: BrowserWindow): WindowPresentation {
  return {
    maximized: window === mainWindow ? mainMaximized || window.isMaximized() : window.isMaximized(),
    fullscreen: window.isFullScreen(),
  };
}

function publishWindowPresentation(window: BrowserWindow): void {
  if (!window.isDestroyed())
    window.webContents.send('mindnote:window-presentation-changed', getWindowPresentation(window));
}

function observePresentation(window: BrowserWindow): void {
  const publish = () => {
    if (window.isDestroyed()) return;
    publishWindowPresentation(window);
  };
  window.on('maximize', publish);
  window.on('unmaximize', publish);
  window.on('enter-full-screen', publish);
  window.on('leave-full-screen', publish);
  window.webContents.on('did-finish-load', publish);
}

function secureWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
}

function loadWindow(window: BrowserWindow, view: 'main' | 'sticky'): Promise<void> {
  if (devURL) {
    const url = new URL(devURL.href);
    url.searchParams.set('view', view);
    return window.loadURL(url.href);
  }
  return window.loadFile(rendererPath, { query: { view } });
}

function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  const bounds = initialBounds('main');
  const window = new BrowserWindow({
    ...bounds,
    minWidth: Math.min(880, bounds.width),
    minHeight: Math.min(620, bounds.height),
    title: PRODUCT_NAME,
    icon: assetPath(process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    frame: false,
    transparent: true,
    resizable: false,
    ...(process.platform === 'win32' ? { thickFrame: false, roundedCorners: false } : {}),
    hasShadow: false,
    ...(process.platform === 'win32' ? { backgroundMaterial: 'none' as const } : {}),
    show: false,
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWindow = window;
  secureWindow(window);
  observeBounds('main', window);
  observePresentation(window);
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) {
      window.show();
      updateWindowBounds(window, bounds, false);
      readyWindows.add(window);
    }
  });
  window.webContents.on('did-finish-load', () => {
    if (pendingFocusNode) {
      window.webContents.send('mindnote:focus-node', pendingFocusNode);
      pendingFocusNode = undefined;
    }
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  void loadWindow(window, 'main').catch(reportLoadError);
  return window;
}

function createStickyWindow(): BrowserWindow {
  if (stickyWindow && !stickyWindow.isDestroyed()) return stickyWindow;
  const settings = store.snapshot().settings;
  const bounds = initialBounds('sticky');
  const window = new BrowserWindow({
    ...bounds,
    minWidth: MIN_STICKY_WIDTH,
    minHeight: COLLAPSED_HEIGHT,
    title: '思维便签',
    icon: assetPath(process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    frame: false,
    ...(process.platform === 'win32' ? { roundedCorners: false, backgroundMaterial: 'none' as const } : {}),
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: settings.pinned,
    hasShadow: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });
  stickyWindow = window;
  appliedCollapsed = settings.stickyCollapsed;
  secureWindow(window);
  observeBounds('sticky', window);
  observePresentation(window);
  observeStickyPinning(window, () => store.snapshot().settings.pinned);
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) {
      window.showInactive();
      updateWindowBounds(window, bounds, true);
      readyWindows.add(window);
    }
  });
  window.on('closed', () => {
    if (stickyWindow === window) stickyWindow = null;
  });
  void loadWindow(window, 'sticky').catch(reportLoadError);
  return window;
}

function reportLoadError(error: unknown): void {
  console.error('[MindNote] Failed to load window:', error);
  if (!quitting)
    dialog.showErrorBox('思维便签启动失败', error instanceof Error ? error.message : String(error));
}

function showMain(nodeId?: string): void {
  if (nodeId) pendingFocusNode = nodeId;
  const window = createMainWindow();
  if (!readyWindows.has(window)) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  if (pendingFocusNode && !window.webContents.isLoadingMainFrame()) {
    window.webContents.send('mindnote:focus-node', pendingFocusNode);
    pendingFocusNode = undefined;
  }
}

function showSticky(): void {
  const window = createStickyWindow();
  if (!readyWindows.has(window)) return;
  const alreadyVisible = window.isVisible() && !window.isMinimized();
  if (window.isMinimized()) window.restore();
  updateWindowBounds(window, window.getBounds(), true);
  window.show();
  // show/restore listeners cover hidden and minimized windows. An already
  // visible note still needs a refresh when explicitly requested from the tray.
  if (alreadyVisible) applyStickyPinning(window, store.snapshot().settings.pinned, true);
}

function refreshVisibleStickyPinning(): void {
  if (!stickyWindow || stickyWindow.isDestroyed() || !stickyWindow.isVisible() || stickyWindow.isMinimized())
    return;
  applyStickyPinning(stickyWindow, store.snapshot().settings.pinned, true);
}

function applySettings(snapshot: Snapshot): void {
  const settings = snapshot.settings;
  nativeTheme.themeSource = settings.theme;
  if (stickyWindow && !stickyWindow.isDestroyed()) {
    applyStickyPinning(stickyWindow, settings.pinned);
    // Keep the native backdrop disabled. Acrylic paints outside the renderer's
    // rounded translucent panel; blur is a renderer-only surface setting.
    if (appliedCollapsed !== settings.stickyCollapsed) {
      const bounds = stickyWindow.getBounds();
      if (settings.stickyCollapsed) expandedStickyHeight = Math.max(MIN_STICKY_HEIGHT, bounds.height);
      updateWindowBounds(
        stickyWindow,
        { ...bounds, height: settings.stickyCollapsed ? COLLAPSED_HEIGHT : expandedStickyHeight },
        true,
      );
      appliedCollapsed = settings.stickyCollapsed;
    }
  }
  if (appliedLogin !== settings.launchAtLogin) {
    // Register the installed executable, never the shared development Electron.
    if (app.isPackaged && process.env.MINDNOTE_TEST_MODE !== '1' && (process.platform === 'win32' || isMac))
      app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
    appliedLogin = settings.launchAtLogin;
  }
  updateTray();
}

function broadcast(snapshot: Snapshot): void {
  applySettings(snapshot);
  for (const window of [mainWindow, stickyWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send('mindnote:changed', snapshot);
  }
}

function updateTray(): void {
  if (!tray || tray.isDestroyed() || !store) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开思维导图', click: () => showMain() },
      { label: '显示桌面便签', click: () => showSticky() },
      { type: 'separator' },
      {
        label: '便签置顶',
        type: 'checkbox',
        checked: store.snapshot().settings.pinned,
        click: (item) => {
          if (restoring) return;
          try {
            broadcast(store.dispatch({ type: 'settings.update', patch: { pinned: item.checked } }));
          } catch (error) {
            reportPersistenceError(error);
          }
        },
      },
      { type: 'separator' },
      { label: '退出思维便签', click: () => app.quit() },
    ]),
  );
}

function createTray(): void {
  let icon = nativeImage.createFromPath(assetPath('tray.png'));
  if (icon.isEmpty())
    icon = nativeImage.createFromPath(assetPath(process.platform === 'win32' ? 'icon.ico' : 'icon.png'));
  const size = isMac ? 18 : 20;
  tray = new Tray(icon.resize({ width: size, height: size }));
  tray.setToolTip(PRODUCT_NAME);
  // macOS opens the attached status-item menu on click. Do not also pop a
  // window underneath that menu; both windows are available from menu items.
  if (!isMac) {
    tray.on('double-click', () => showMain());
    tray.on('click', () => showSticky());
  }
  updateTray();
}

function assertTrustedSender(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (
    !window ||
    (window !== mainWindow && window !== stickyWindow) ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    throw new Error('无法访问此窗口的数据接口。');
  }
  const url = new URL(event.senderFrame.url);
  const trusted = devURL
    ? url.origin === devURL.origin && url.pathname === devURL.pathname
    : url.protocol === 'file:' &&
      (process.platform === 'win32'
        ? path.resolve(fileURLToPath(url)).toLowerCase() === rendererPath.toLowerCase()
        : path.resolve(fileURLToPath(url)) === rendererPath);
  if (!trusted) throw new Error('只允许思维便签界面访问本地数据。');
  return window;
}

function assertAvailable(): void {
  if (restoring) throw new Error('正在恢复备份，请稍后重试。');
  if (quitting) throw new Error('应用正在退出，请稍后重试。');
}

function registerIPC(): void {
  const handle = (channel: string, callback: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) => {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      assertTrustedSender(event);
      return callback(event, ...args);
    });
  };
  handle('mindnote:snapshot', () => store.snapshot());
  handle('mindnote:dispatch', (_event, command: unknown) => {
    assertAvailable();
    if (
      !command ||
      typeof command !== 'object' ||
      Array.isArray(command) ||
      Buffer.byteLength(JSON.stringify(command), 'utf8') > MAX_COMMAND_BYTES
    ) {
      throw new Error('编辑内容无效或过大。');
    }
    const snapshot = store.dispatch(command as Command);
    broadcast(snapshot);
    return snapshot;
  });
  handle('mindnote:show-main', (_event, nodeId?: unknown) => {
    if (nodeId !== undefined && (typeof nodeId !== 'string' || nodeId.length > 200))
      throw new Error('事项标识无效。');
    if (typeof nodeId === 'string' && !store.snapshot().nodes.some((node) => node.id === nodeId))
      throw new Error('该事项已不存在。');
    showMain(nodeId as string | undefined);
  });
  handle('mindnote:show-sticky', () => showSticky());
  handle('mindnote:hide-window', (event) => {
    assertTrustedSender(event).hide();
  });
  handle('mindnote:minimize-window', (event) => {
    assertTrustedSender(event).minimize();
  });
  handle('mindnote:toggle-maximize', (event) => {
    const window = assertTrustedSender(event);
    if (window !== mainWindow) throw new Error('桌面便签不支持最大化，请使用右下角调整尺寸。');
    if (window.isFullScreen()) return;
    if (mainMaximized) {
      mainMaximized = false;
      updateWindowBounds(window, mainNormalBounds ?? initialBounds('main'), false);
    } else {
      mainNormalBounds = window.getBounds();
      mainMaximized = true;
      updateWindowBounds(window, screen.getDisplayMatching(window.getBounds()).workArea, false);
    }
    publishWindowPresentation(window);
  });
  handle('mindnote:resize-main', (event, bounds: unknown) => {
    const window = assertTrustedSender(event);
    if (window !== mainWindow || !finiteRectangle(bounds)) throw new Error('窗口尺寸无效。');
    if (mainMaximized || window.isFullScreen()) return;
    updateWindowBounds(window, bounds, false);
  });
  handle('mindnote:window-bounds', (event) => assertTrustedSender(event).getBounds());
  handle('mindnote:window-presentation', (event) => getWindowPresentation(assertTrustedSender(event)));
  handle('mindnote:background-url', (_event, id: unknown, still?: unknown) =>
    backgroundURL(store, id, still),
  );
  handle('mindnote:import-background', async (event) => {
    assertAvailable();
    const result = await dialog.showOpenDialog(assertTrustedSender(event), {
      title: '选择背景图片',
      properties: ['openFile'],
      filters: [{ name: '图片与动图（最大 20 MB）', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const asset = await readBackgroundImage(result.filePaths[0]);
    assertAvailable();
    const snapshot = store.setBackgroundImage(asset);
    broadcast(snapshot);
    return { canceled: false, snapshot };
  });
  handle('mindnote:resize-sticky', (event, width: unknown, height: unknown) => {
    assertAvailable();
    const window = assertTrustedSender(event);
    if (
      window !== stickyWindow ||
      typeof width !== 'number' ||
      typeof height !== 'number' ||
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    )
      throw new Error('窗口尺寸无效。');
    const collapsed = store.snapshot().settings.stickyCollapsed;
    const bounds = keepOnScreen(
      {
        ...window.getBounds(),
        width: Math.max(MIN_STICKY_WIDTH, Math.min(1000, width)),
        height: collapsed ? COLLAPSED_HEIGHT : Math.max(MIN_STICKY_HEIGHT, Math.min(1400, height)),
      },
      true,
    );
    updateWindowBounds(window, bounds, true);
  });
  handle('mindnote:backup', async (event) => {
    assertAvailable();
    const date = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(assertTrustedSender(event), {
      title: '备份思维便签',
      defaultPath: path.join(app.getPath('documents'), `MindNote-${date}.sqlite`),
      filters: [{ name: 'MindNote 数据库备份', extensions: ['sqlite'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    assertAvailable();
    activeBackups += 1;
    try {
      await store.backup(result.filePath);
      return { canceled: false, path: result.filePath };
    } finally {
      activeBackups -= 1;
      if (quitAfterDatabaseOperation && activeBackups === 0 && !restoring) setImmediate(() => app.quit());
    }
  });
  handle('mindnote:restore', async (event) => {
    assertAvailable();
    const window = assertTrustedSender(event);
    const result = await dialog.showOpenDialog(window, {
      title: '选择思维便签备份',
      properties: ['openFile'],
      filters: [{ name: 'MindNote 数据库备份', extensions: ['sqlite', 'mindnote', 'db'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const confirmation = await dialog.showMessageBox(window, {
      type: 'question',
      title: '恢复备份',
      message: '使用备份替换当前内容？',
      detail: '恢复前会自动备份当前数据。恢复后，所有导图、待办和设置将以所选备份为准。',
      buttons: ['取消', '恢复备份'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (confirmation.response !== 1) return { canceled: true };
    assertAvailable();
    if (activeBackups > 0) throw new Error('正在写入备份，请完成后再恢复。');
    restoring = true;
    try {
      const safetyBackupPath = await store.restore(result.filePaths[0]);
      const restored = store.snapshot();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainMaximized = false;
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        updateWindowBounds(mainWindow, initialBounds('main'), false);
        publishWindowPresentation(mainWindow);
      }
      if (stickyWindow && !stickyWindow.isDestroyed()) {
        updateWindowBounds(stickyWindow, initialBounds('sticky'), true);
        appliedCollapsed = restored.settings.stickyCollapsed;
      }
      broadcast(restored);
      return { canceled: false, path: safetyBackupPath };
    } finally {
      restoring = false;
      if (quitAfterDatabaseOperation && activeBackups === 0) setImmediate(() => app.quit());
    }
  });
  handle('mindnote:open-data-folder', async () => {
    const error = await shell.openPath(app.getPath('userData'));
    if (error) throw new Error(error);
  });
  handle('mindnote:quit', () => {
    assertAvailable();
    // Return the IPC result before disposing its originating webContents.
    setImmediate(() => app.quit());
  });
}

function recoverDisplayBounds(): void {
  for (const [key, window] of [
    ['main', mainWindow],
    ['sticky', stickyWindow],
  ] as const) {
    if (!window || window.isDestroyed() || window.isMaximized() || window.isFullScreen()) continue;
    if (key === 'main' && mainMaximized) {
      updateWindowBounds(window, screen.getDisplayMatching(window.getBounds()).workArea, false);
      continue;
    }
    updateWindowBounds(window, window.getBounds(), key === 'sticky');
  }
  refreshVisibleStickyPinning();
}

const hasInstanceLock = !squirrelStartup && app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (app.isReady() && store) showSticky();
  });
  app.on('activate', () => {
    if (store) showSticky();
  });
  app.on('window-all-closed', () => {
    /* Windows remain accessible from the tray. */
  });
  app.on('before-quit', (event) => {
    if (restoring || activeBackups > 0) {
      quitAfterDatabaseOperation = true;
      event.preventDefault();
      return;
    }
    quitting = true;
    for (const timer of saveTimers.values()) clearTimeout(timer);
    saveTimers.clear();
    if (mainWindow && !mainWindow.isDestroyed()) persistBounds('main', mainWindow);
    if (stickyWindow && !stickyWindow.isDestroyed()) persistBounds('sticky', stickyWindow);
  });
  app.on('will-quit', () => {
    tray?.destroy();
    if (store) store.close();
  });
  void app.whenReady().then(async () => {
    try {
      if (dataConfigurationError) throw dataConfigurationError;
      await migrateLegacyData(dataConfiguration.directory, dataConfiguration.legacy);
      store = new MindNoteStore(path.join(app.getPath('userData'), 'mindnote.sqlite'));
      registerBackgroundProtocol(store);
      configureApplicationMenu();
      registerIPC();
      createStickyWindow();
      createTray();
      applySettings(store.snapshot());
      screen.on('display-added', recoverDisplayBounds);
      screen.on('display-removed', recoverDisplayBounds);
      screen.on('display-metrics-changed', recoverDisplayBounds);
      powerMonitor.on('resume', refreshVisibleStickyPinning);
      powerMonitor.on('unlock-screen', refreshVisibleStickyPinning);
    } catch (error) {
      dialog.showErrorBox(
        '思维便签无法启动',
        `本地数据无法打开。原始数据不会被覆盖。\n\n${error instanceof Error ? error.message : String(error)}`,
      );
      quitting = true;
      app.quit();
    }
  });
}
