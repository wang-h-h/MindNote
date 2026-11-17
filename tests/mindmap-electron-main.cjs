const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration();
app.setPath('userData', process.env.MINDNOTE_MAP_TEST_DATA);
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  await window.loadURL(process.env.MINDNOTE_MAP_TEST_URL);
});
app.on('window-all-closed', () => app.quit());
