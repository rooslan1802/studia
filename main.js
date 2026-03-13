const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

function loadEnvIfExists() {
  try {
    const dotenv = require('dotenv');
    const envPaths = [
      path.join(__dirname, '..', '.env'),
      path.join(app.getPath('userData'), '.env')
    ];
    envPaths.forEach((envPath) => {
      if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath, override: false });
      }
    });
  } catch {
    // Packaged app should not crash if dotenv is unavailable.
  }
}

loadEnvIfExists();
const { initializeDatabase } = require('../database');
const { registerIpcHandlers } = require('../services/ipcHandlers');
const { startWhatsAppCallbackServer } = require('./whatsappCallbackServer');
const whatsappBaileys = require('../backend/services/whatsappBaileys');

const isDev = !!process.env.VITE_DEV_SERVER_URL;
let callbackServer = null;
let mainWindow = null;
let updateState = {
  checking: false,
  available: false,
  downloaded: false,
  downloading: false,
  version: app.getVersion(),
  latestVersion: '',
  progressPercent: 0,
  message: ''
};

function sendUpdateState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('app:update-state', updateState);
}

function setUpdateState(patch = {}) {
  updateState = { ...updateState, ...patch };
  sendUpdateState();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/dist/index.html'));
  }
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    setUpdateState({
      checking: true,
      available: false,
      downloaded: false,
      downloading: false,
      latestVersion: '',
      progressPercent: 0,
      message: 'Проверяем обновления...'
    });
  });

  autoUpdater.on('update-available', (info) => {
    setUpdateState({
      checking: false,
      available: true,
      downloaded: false,
      downloading: false,
      latestVersion: String(info?.version || ''),
      progressPercent: 0,
      message: `Доступно обновление ${info?.version || ''}`.trim()
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    setUpdateState({
      checking: false,
      available: false,
      downloaded: false,
      downloading: false,
      latestVersion: String(info?.version || app.getVersion()),
      progressPercent: 0,
      message: 'Установлена актуальная версия.'
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    setUpdateState({
      checking: false,
      available: true,
      downloading: true,
      downloaded: false,
      progressPercent: Number(progress?.percent || 0),
      message: `Скачивание обновления: ${Math.round(Number(progress?.percent || 0))}%`
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    setUpdateState({
      checking: false,
      available: true,
      downloading: false,
      downloaded: true,
      latestVersion: String(info?.version || ''),
      progressPercent: 100,
      message: 'Обновление скачано. Можно установить.'
    });
  });

  autoUpdater.on('error', (error) => {
    setUpdateState({
      checking: false,
      downloading: false,
      message: error?.message || 'Не удалось проверить обновления.'
    });
  });

  ipcMain.handle('app:updates:status', async () => updateState);
  ipcMain.handle('app:updates:check', async () => {
    if (isDev) {
      throw new Error('Проверка обновлений доступна только в собранном приложении.');
    }
    await autoUpdater.checkForUpdates();
    return updateState;
  });
  ipcMain.handle('app:updates:download', async () => {
    if (isDev) {
      throw new Error('Скачивание обновлений доступно только в собранном приложении.');
    }
    await autoUpdater.downloadUpdate();
    return updateState;
  });
  ipcMain.handle('app:updates:install', async () => {
    if (!updateState.downloaded) {
      throw new Error('Обновление еще не скачано.');
    }
    const response = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Установить сейчас', 'Позже'],
      defaultId: 0,
      cancelId: 1,
      title: 'Установка обновления',
      message: 'Приложение будет перезапущено для установки обновления.'
    });
    if (response.response === 0) {
      setImmediate(() => autoUpdater.quitAndInstall());
      return { success: true, installing: true };
    }
    return { success: true, installing: false };
  });
}

app.whenReady().then(() => {
  const dbPath = path.join(app.getPath('userData'), 'studia.sqlite');
  initializeDatabase(dbPath);
  registerIpcHandlers();
  configureAutoUpdater();
  callbackServer = startWhatsAppCallbackServer();
  whatsappBaileys.start().catch(() => {});
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (callbackServer) {
    callbackServer.close();
    callbackServer = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
