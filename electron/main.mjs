import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

process.env.NO_AUTO_EXIT = '1';
process.env.COLLAB_DATA_DIR = path.join(app.getPath('userData'), 'data');

let mainWindow = null;
let serverRef = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

async function createWindow() {
  const { startServer } = await import('../server.mjs');
  const started = await startServer(0);
  serverRef = started.server;

  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1020,
    minHeight: 680,
    title: 'CollabStudio · Antigravity × Claude × Codex',
    backgroundColor: '#0b0e14',
    icon: path.join(ROOT, 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await mainWindow.loadURL(started.url);
  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('dialog:pickFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '选择或新建项目文件夹',
    properties: ['openDirectory', 'createDirectory']
  });
  return res.canceled ? '' : (res.filePaths[0] || '');
});

ipcMain.handle('dialog:pickFiles', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '选择要导入讨论的参考文件（支持多选）',
    properties: ['openFile', 'multiSelections']
  });
  return res.canceled ? [] : (res.filePaths || []);
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (serverRef) serverRef.close();
  app.quit();
});
