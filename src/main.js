const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('fs/promises');
const path = require('path');

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac']);

let mainWindow;

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 600,
    minHeight: 430,
    backgroundColor: '#f5f7fb',
    title: 'Audio Control',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectAudioFilesFromDirectory(directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const filePath = path.join(directoryPath, entry.name);
    if (AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push({
        path: filePath,
        name: path.parse(entry.name).name
      });
    }
  }

  return files.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function readSettings() {
  const settingsPath = getSettingsPath();

  try {
    const raw = await fs.readFile(settingsPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Unable to read settings:', error);
    }

    return null;
  }
}

async function writeSettings(settings) {
  const settingsPath = getSettingsPath();
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('second-instance', () => {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.focus();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('dialog:add-audio-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择音频文件',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio Files', extensions: Array.from(AUDIO_EXTENSIONS, (extension) => extension.slice(1)) },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled) {
    return [];
  }

  return result.filePaths.map((filePath) => ({
    path: filePath,
    name: path.parse(filePath).name
  }));
});

ipcMain.handle('dialog:add-audio-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择音频文件夹',
    properties: ['openDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return [];
  }

  return collectAudioFilesFromDirectory(result.filePaths[0]);
});

ipcMain.handle('file:exists', async (_event, filePath) => {
  return pathExists(filePath);
});

ipcMain.handle('settings:load', async () => {
  return readSettings();
});

ipcMain.handle('settings:save', async (_event, settings) => {
  await writeSettings(settings);
  return true;
});
