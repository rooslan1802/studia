const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0d1117',
    icon: process.platform === 'win32'
      ? path.join(__dirname, '..', 'build', 'app.ico')
      : path.join(__dirname, '..', 'build', 'app.icns'),
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

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.studia.manager');
  }
  const dbPath = path.join(app.getPath('userData'), 'studia.sqlite');
  initializeDatabase(dbPath);
  registerIpcHandlers();
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
  app.quit();
});
