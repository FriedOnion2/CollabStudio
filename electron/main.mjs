import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { normalizeLanguage, translate } from '../public/translate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const isMac = process.platform === 'darwin';
const userData = app.getPath('userData');
const preferencesFile = path.join(userData, 'language.json');

process.env.NO_AUTO_EXIT = '1';
process.env.COLLAB_DATA_DIR = path.join(userData, 'data');

let mainWindow = null;
let localApp;
let language = 'zh';
const t = (message) => translate(language, message);

async function loadMacPath() {
  // Finder launches GUI apps with a minimal PATH. Read the login shell’s PATH
  // and keep common installation directories available as a fallback.
  const shell = os.userInfo().shell || '/bin/zsh';
  const marker = '__COLLABSTUDIO_PATH__=';
  let loginPath = '';
  try {
    const { stdout } = await promisify(execFile)(shell, ['-lc', `printf '\\n${marker}%s\\n' "$PATH"`], {
      timeout: 2000
    });
    loginPath = stdout.split(/\r?\n/).find((line) => line.startsWith(marker))?.slice(marker.length) || '';
  } catch {}
  const searchPaths = [loginPath, process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local/bin')];
  process.env.PATH = [...new Set(searchPaths.flatMap((entry) => (entry || '').split(path.delimiter)).filter(Boolean))].join(path.delimiter);
}

function updateMenu() {
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'CollabStudio', submenu: [
      { label: t('关于 CollabStudio'), role: 'about' },
      { type: 'separator' },
      { label: t('退出 CollabStudio'), role: 'quit' }
    ] },
    { label: t('编辑'), submenu: [
      { label: t('撤销'), role: 'undo' },
      { label: t('重做'), role: 'redo' },
      { type: 'separator' },
      { label: t('剪切'), role: 'cut' },
      { label: t('复制'), role: 'copy' },
      { label: t('粘贴'), role: 'paste' },
      { label: t('全选'), role: 'selectAll' }
    ] },
    { label: t('窗口'), role: 'windowMenu', submenu: [
      { label: t('最小化'), role: 'minimize' },
      { label: t('关闭窗口'), role: 'close' }
    ] }
  ]));
}

function createWindow() {
  const url = new URL(localApp.url);
  url.searchParams.set('lang', language);
  const win = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1020,
    minHeight: 680,
    title: 'CollabStudio · Antigravity × Claude × Codex',
    backgroundColor: '#0b0e14',
    ...(isMac ? {} : { icon: path.join(ROOT, 'assets', 'icon.ico'), autoHideMenuBar: true }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow = win;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, target) => {
    if (new URL(target).origin !== url.origin) event.preventDefault();
  });
  win.on('closed', () => { mainWindow = null; });
  return win.loadURL(url.href);
}

ipcMain.handle('dialog:pickFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: t('选择或新建项目文件夹'),
    properties: ['openDirectory', 'createDirectory']
  });
  return res.canceled ? '' : (res.filePaths[0] || '');
});

ipcMain.handle('dialog:pickFiles', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: t('选择要导入讨论的参考文件'),
    properties: ['openFile', 'multiSelections']
  });
  return res.canceled ? [] : res.filePaths;
});

ipcMain.handle('language:set', async (_event, next) => {
  const selected = normalizeLanguage(next);
  await fs.mkdir(userData, { recursive: true });
  const pending = preferencesFile + '.tmp';
  await fs.writeFile(pending, JSON.stringify(selected));
  await fs.rename(pending, preferencesFile);
  language = selected;
  updateMenu();
});

ipcMain.handle('shell:openExternal', async (_event, targetUrl) => {
  const u = String(targetUrl || '').trim();
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(u)) {
    throw new Error(t("仅允许在系统浏览器打开本机预览地址"));
  }
  await shell.openExternal(u);
  return true;
});


ipcMain.handle('app:quit', () => app.quit());

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) {
      if (localApp) createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on('activate', () => {
    if (!mainWindow && localApp) createWindow();
  });
  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
  app.on('before-quit', () => localApp?.stop());

  app.whenReady().then(async () => {
    try {
      language = normalizeLanguage(JSON.parse(await fs.readFile(preferencesFile, 'utf8')));
    } catch {}
    if (isMac) await loadMacPath();
    updateMenu();
    const { startServer, stopServer } = await import('../server.mjs');
    localApp = { ...await startServer(0, '127.0.0.1'), stop: stopServer };
    await createWindow();
  }).catch((error) => {
    dialog.showErrorBox(t('应用启动失败'), error.message);
    app.quit();
  });
}
