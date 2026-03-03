const { app, BrowserWindow } = require('electron');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { initializeDatabase } = require('../database');
const { registerIpcHandlers } = require('../services/ipcHandlers');
const { startWhatsAppCallbackServer } = require('./whatsappCallbackServer');
const whatsappBaileys = require('../backend/services/whatsappBaileys');

const isDev = !!process.env.VITE_DEV_SERVER_URL;
let callbackServer = null;

function createWindow() {
  const mainWindow = new BrowserWindow({
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

app.whenReady().then(() => {
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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
