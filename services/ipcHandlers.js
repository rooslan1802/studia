const { ipcMain, dialog, BrowserWindow, app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { getDb, getDbPath, closeDatabase } = require('../database');
const repository = require('./repository');
const {
  getDashboardData,
  getPaymentsList,
  getPaymentTransactions,
  getPaymentHistory,
  getMonthlyPaymentsReport,
  getNotificationsList
} = require('./businessService');
const whatsappService = require('./whatsappService');
const { generateQrForIin, buildChildQrModal } = require('./damubalaQrService');
const {
  fetchActiveVouchersPreviewWithLogin,
  getDamubalaConnectionStatus,
  ensureDamubalaLoginWithWindow,
  getDamubalaSigningStats
} = require('./damubalaSyncService');
const { fetchQosymshaChildrenPreviewWithLogin } = require('./qosymshaSyncService');
const { fetchArtsportChildrenPreviewWithLogin } = require('./artsportSyncService');

const DEFAULT_USER_ID = 'local-user';
const BACKUP_FILE_EXT = '.sqlite';
const RESTORE_HISTORY_FILE = 'restore-history.json';

function backupTimestamp(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function resolveBackupsDir() {
  const rootPath = app.getAppPath();
  return path.join(rootPath, 'database', 'backups');
}

function ensureBackupsDir() {
  const dir = resolveBackupsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveRestoreHistoryPath() {
  return path.join(ensureBackupsDir(), RESTORE_HISTORY_FILE);
}

function readRestoreHistory() {
  const filePath = resolveRestoreHistoryPath();
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRestoreHistory(items) {
  const trimmed = Array.isArray(items) ? items.slice(0, 100) : [];
  fs.writeFileSync(resolveRestoreHistoryPath(), JSON.stringify(trimmed, null, 2), 'utf8');
}

function appendRestoreHistory(entry) {
  const current = readRestoreHistory();
  current.unshift(entry);
  saveRestoreHistory(current);
}

function toBackupEntry(fileName) {
  const backupsDir = resolveBackupsDir();
  const fullPath = path.join(backupsDir, fileName);
  const stat = fs.statSync(fullPath);
  const createdAt = stat.birthtime?.toISOString?.() || stat.mtime.toISOString();
  return {
    id: fileName,
    fileName,
    fullPath,
    size: stat.size,
    createdAt
  };
}

function listBackupEntries() {
  const dir = ensureBackupsDir();
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(BACKUP_FILE_EXT))
    .map((entry) => entry.name);

  return files
    .map((fileName) => toBackupEntry(fileName))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function sanitizeFileName(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s._-]/gu, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_') || 'qr';
}

function uniquePath(filePath) {
  if (!fs.existsSync(filePath)) return filePath;
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  let idx = 2;
  while (true) {
    const candidate = path.join(dir, `${base}_${idx}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
    idx += 1;
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildModalHtml(qrDataUrl, childName) {
  const safeName = escapeHtml(childName || '');
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Egov QR modal</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      width: 920px;
      height: 1100px;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      background: #d4ccc1;
    }
    body {
      min-height: 100vh;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 24px;
      color: #1a1f3b;
    }
    .modal {
      width: 880px;
      min-height: 1030px;
      background: #f4f5f8;
      border-radius: 10px;
      padding: 52px 84px 44px;
      position: relative;
    }
    .close {
      position: absolute;
      right: 34px;
      top: 26px;
      font-size: 56px;
      line-height: 44px;
      color: #111;
      font-weight: 300;
    }
    h1 {
      margin: 0 0 14px;
      font-size: 50px;
      line-height: 1.12;
      font-weight: 800;
      color: #1f2440;
    }
    .subtitle {
      margin: 0;
      font-size: 46px;
      line-height: 1.24;
      color: #7b819b;
      max-width: 690px;
    }
    .hint {
      margin-top: 30px;
      border: 2px solid #f2b17f;
      background: #f7dec8;
      border-radius: 14px;
      padding: 22px 26px;
      font-size: 47px;
      line-height: 1.25;
      font-weight: 700;
      color: #1f2440;
    }
    .child {
      margin-top: 14px;
      font-size: 34px;
      color: #6b7088;
      font-weight: 700;
    }
    .qr-wrap {
      margin-top: 42px;
      display: flex;
      justify-content: center;
    }
    .qr-wrap img {
      width: 430px;
      height: 430px;
      image-rendering: pixelated;
      image-rendering: crisp-edges;
    }
    .cta {
      margin-top: 52px;
      width: 100%;
      height: 86px;
      border-radius: 14px;
      border: none;
      background: #ff7400;
      color: #fff;
      font-size: 46px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  </style>
</head>
<body>
  <div class="modal">
    <div class="close">×</div>
    <h1>Подписание с помощью QR</h1>
    <p class="subtitle">Отсканируйте QR-код с помощью мобильного приложения Egov Mobile</p>
    <div class="hint">После подписания в Egov Mobile, можете нажать на кнопку "Продолжить" или закрыть модальное окно</div>
    <div class="child">${safeName}</div>
    <div class="qr-wrap">
      <img src="${qrDataUrl}" alt="QR" />
    </div>
    <div class="cta">Продолжить</div>
  </div>
</body>
</html>`;
}

async function renderModalPngBuffer({ qrDataUrl, childName }) {
  const win = new BrowserWindow({
    width: 920,
    height: 1100,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    movable: false
  });

  try {
    const html = buildModalHtml(qrDataUrl, childName);
    const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await win.loadURL(url);
    await new Promise((resolve) => setTimeout(resolve, 120));

    const pageMetrics = await win.webContents.executeJavaScript(`
      ({
        width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, 920),
        height: Math.max(
          document.documentElement.scrollHeight,
          document.body.scrollHeight,
          document.documentElement.offsetHeight,
          document.body.offsetHeight,
          1100
        )
      })
    `);

    const captureWidth = Math.max(920, Number(pageMetrics?.width || 920));
    const captureHeight = Math.max(1100, Number(pageMetrics?.height || 1100));
    win.setContentSize(captureWidth, captureHeight);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const image = await win.webContents.capturePage({
      x: 0,
      y: 0,
      width: captureWidth,
      height: captureHeight
    });
    return image.toPNG();
  } finally {
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
}

function registerIpcHandlers() {
  const actor = 'local-user';

  ipcMain.handle('backup:list', async () => {
    try {
      return {
        success: true,
        backups: listBackupEntries(),
        restoreHistory: readRestoreHistory()
      };
    } catch (error) {
      return { success: false, message: error?.message || 'Не удалось загрузить список резервных копий.' };
    }
  });

  ipcMain.handle('backup:create', async () => {
    try {
      const backupsDir = ensureBackupsDir();
      const fileName = `studia-backup-${backupTimestamp()}${BACKUP_FILE_EXT}`;
      const filePath = path.join(backupsDir, fileName);
      await getDb().backup(filePath);
      repository.addAuditLog({
        actionType: 'backup.create',
        entityType: 'backup',
        entityId: fileName,
        actor,
        summary: 'Создана резервная копия',
        payloadJson: { backupId: fileName }
      });
      return { success: true, backup: toBackupEntry(fileName) };
    } catch (error) {
      return { success: false, message: error?.message || 'Не удалось создать резервную копию.' };
    }
  });

  ipcMain.handle('backup:restore', async (_, payload = {}) => {
    try {
      const backupId = String(payload.backupId || '').trim();
      if (!backupId) {
        return { success: false, message: 'Не выбрана резервная копия.' };
      }
      const fileName = path.basename(backupId);
      const backupPath = path.join(resolveBackupsDir(), fileName);
      if (!fs.existsSync(backupPath)) {
        return { success: false, message: 'Резервная копия не найдена.' };
      }

      appendRestoreHistory({
        id: `${Date.now()}-${fileName}`,
        backupId: fileName,
        restoredAt: new Date().toISOString()
      });
      repository.addAuditLog({
        actionType: 'backup.restore',
        entityType: 'backup',
        entityId: fileName,
        actor,
        summary: 'Выполнено восстановление из резервной копии',
        payloadJson: { backupId: fileName }
      });
      closeDatabase();
      fs.copyFileSync(backupPath, getDbPath());
      app.relaunch();
      app.exit(0);
      return { success: true, restarting: true };
    } catch (error) {
      return { success: false, message: error?.message || 'Не удалось восстановить резервную копию.' };
    }
  });

  ipcMain.handle('database:export', async () => {
    try {
      const defaultPath = path.join(
        app.getPath('documents'),
        `studia-export-${backupTimestamp()}${BACKUP_FILE_EXT}`
      );
      const saveDialog = await dialog.showSaveDialog({
        title: 'Экспорт базы данных',
        defaultPath,
        filters: [{ name: 'SQLite database', extensions: ['sqlite', 'db'] }]
      });

      if (saveDialog.canceled || !saveDialog.filePath) {
        return { success: false, canceled: true };
      }

      await getDb().backup(saveDialog.filePath);
      repository.addAuditLog({
        actionType: 'database.export',
        entityType: 'database',
        actor,
        summary: 'Экспортирована база данных',
        payloadJson: { filePath: saveDialog.filePath }
      });
      return { success: true, filePath: saveDialog.filePath };
    } catch (error) {
      return { success: false, message: error?.message || 'Не удалось экспортировать базу данных.' };
    }
  });

  ipcMain.handle('backup:delete', async (_, payload = {}) => {
    try {
      const backupId = String(payload.backupId || '').trim();
      if (!backupId) {
        return { success: false, message: 'Не выбрана резервная копия.' };
      }
      const fileName = path.basename(backupId);
      const backupPath = path.join(resolveBackupsDir(), fileName);
      if (!fs.existsSync(backupPath)) {
        return { success: false, message: 'Резервная копия не найдена.' };
      }
      fs.unlinkSync(backupPath);
      repository.addAuditLog({
        actionType: 'backup.delete',
        entityType: 'backup',
        entityId: fileName,
        actor,
        summary: 'Удалена резервная копия',
        payloadJson: { backupId: fileName }
      });
      return { success: true };
    } catch (error) {
      return { success: false, message: error?.message || 'Не удалось удалить резервную копию.' };
    }
  });

  ipcMain.handle('backup:export', async (_, payload = {}) => {
    try {
      const backupId = String(payload.backupId || '').trim();
      if (!backupId) {
        return { success: false, message: 'Выберите резервную копию для экспорта.' };
      }
      const fileName = path.basename(backupId);
      const sourcePath = path.join(resolveBackupsDir(), fileName);
      if (!fs.existsSync(sourcePath)) {
        return { success: false, message: 'Резервная копия не найдена.' };
      }

      const saveDialog = await dialog.showSaveDialog({
        title: 'Экспорт резервной копии',
        defaultPath: path.join(app.getPath('documents'), fileName),
        filters: [{ name: 'SQLite database', extensions: ['sqlite', 'db'] }]
      });

      if (saveDialog.canceled || !saveDialog.filePath) {
        return { success: false, canceled: true };
      }

      fs.copyFileSync(sourcePath, saveDialog.filePath);
      repository.addAuditLog({
        actionType: 'backup.export',
        entityType: 'backup',
        entityId: fileName,
        actor,
        summary: 'Экспортирована резервная копия',
        payloadJson: { backupId: fileName, filePath: saveDialog.filePath }
      });
      return { success: true, filePath: saveDialog.filePath };
    } catch (error) {
      return { success: false, message: error?.message || 'Не удалось экспортировать резервную копию.' };
    }
  });

  ipcMain.handle('database:import', async () => {
    try {
      const openDialog = await dialog.showOpenDialog({
        title: 'Импорт базы данных',
        properties: ['openFile'],
        filters: [{ name: 'SQLite database', extensions: ['sqlite', 'db'] }]
      });

      if (openDialog.canceled || !openDialog.filePaths?.length) {
        return { success: false, canceled: true };
      }

      const sourcePath = openDialog.filePaths[0];
      repository.addAuditLog({
        actionType: 'database.import',
        entityType: 'database',
        actor,
        summary: 'Импортирована внешняя база данных',
        payloadJson: { sourcePath }
      });
      closeDatabase();
      fs.copyFileSync(sourcePath, getDbPath());
      app.relaunch();
      app.exit(0);
      return { success: true, restarting: true };
    } catch (error) {
      return { success: false, message: error?.message || 'Не удалось импортировать базу данных.' };
    }
  });

  ipcMain.handle('dashboard:get', async () => getDashboardData());

  ipcMain.handle('cities:list', async () => repository.listCities());
  ipcMain.handle('cities:save', async (_, payload) => repository.saveCity(payload));
  ipcMain.handle('cities:delete', async (_, id) => repository.deleteCity(id));

  ipcMain.handle('studios:list', async (_, filters) => repository.listStudios(filters));
  ipcMain.handle('studios:save', async (_, payload) => repository.saveStudio(payload));
  ipcMain.handle('studios:delete', async (_, id) => repository.deleteStudio(id));

  ipcMain.handle('courses:list', async (_, filters) => repository.listCourses(filters));
  ipcMain.handle('courses:save', async (_, payload) => repository.saveCourse(payload));
  ipcMain.handle('courses:delete', async (_, id) => repository.deleteCourse(id));

  ipcMain.handle('groups:list', async (_, courseId) => repository.listGroups(courseId));
  ipcMain.handle('groups:save', async (_, payload) => repository.saveGroup(payload));
  ipcMain.handle('groups:delete', async (_, id) => repository.deleteGroup(id));

  ipcMain.handle('group-schedule:list', async (_, groupId) => repository.listGroupSchedule(groupId));
  ipcMain.handle('group-schedule:save', async (_, payload) => repository.saveGroupSchedule(payload));

  ipcMain.handle('structure:list', async () => repository.listStructureTree());

  ipcMain.handle('children:list', async (_, filters) => repository.listChildren(filters));
  ipcMain.handle('archive:list', async (_, filters) => repository.listArchivedEntities(filters || {}));
  ipcMain.handle('archive:delete', async (_, payload) => repository.deleteArchivedEntity(payload || {}));
  ipcMain.handle('archive:restore', async (_, payload) => repository.restoreArchivedEntity(payload || {}));
  ipcMain.handle('queue:list', async (_, filters) => repository.listQueueChildren(filters || {}));
  ipcMain.handle('queue:save', async (_, payload) => repository.saveQueueChild(payload));
  ipcMain.handle('queue:delete', async (_, id) => repository.deleteQueueChild(id));
  ipcMain.handle('queue:refresh', async (_, payload) => repository.refreshQueueChildren(payload || {}));
  ipcMain.handle('children:get', async (_, childId) => repository.getChildById(childId));
  ipcMain.handle('children:save', async (_, payload) => repository.saveChild(payload));
  ipcMain.handle('children:delete', async (_, id) => repository.deleteChild(id));
  ipcMain.handle('children:set-message-tag', async (_, payload) => repository.setChildrenMessageTag(payload || {}));
  ipcMain.handle('children:set-course', async (_, payload) => repository.setChildrenCourse(payload || {}));
  ipcMain.handle('children:clear-all', async () => repository.clearAllChildrenData());

  ipcMain.handle('payments:list', async (_, filters) => getPaymentsList(filters || {}));
  ipcMain.handle('payments:transactions', async (_, filters) => getPaymentTransactions(filters || {}));
  ipcMain.handle('payments:history', async (_, childId) => getPaymentHistory(childId));
  ipcMain.handle('payments:report-monthly', async (_, filters) => getMonthlyPaymentsReport(filters || {}));
  ipcMain.handle('payments:comment', async (_, payload) => repository.savePaymentComment(payload));
  ipcMain.handle('payments:mark-paid', async (_, payload) => repository.markPaymentPaid(payload));
  ipcMain.handle('payments:cancel-transaction', async (_, payload) => repository.cancelPaymentTransaction(payload));

  ipcMain.handle('attendance:sheet', async (_, payload) => repository.getAttendanceSheet(payload));
  ipcMain.handle('attendance:sheet-save', async (_, payload) => repository.saveAttendanceSheet(payload));
  ipcMain.handle('attendance:list', async (_, filters) => repository.listAttendanceSessions(filters));
  ipcMain.handle('attendance:boards', async (_, filters) => repository.listAttendanceBoards(filters || {}));
  ipcMain.handle('attendance:add-date', async (_, payload) => repository.addAttendanceDate(payload));
  ipcMain.handle('attendance:remove-date', async (_, payload) => repository.removeAttendanceDate(payload));

  ipcMain.handle('notifications:list', async () => getNotificationsList());
  ipcMain.handle('audit:list', async (_, filters) => repository.listAuditLogs(filters || {}));
  ipcMain.handle('audit:delete', async (_, id) => repository.deleteAuditLog(id));
  ipcMain.handle('settings:get', async () => repository.getAppSettings());
  ipcMain.handle('settings:save', async (_, payload) => repository.saveAppSettings(payload || {}));

  ipcMain.handle('whatsapp:settings-get', async () => {
    try {
      const data = whatsappService.getStatus(DEFAULT_USER_ID);
      return {
        success: true,
        data
      };
    } catch (error) {
      return { success: false, error: error?.message || 'Не удалось загрузить настройки WhatsApp' };
    }
  });

  ipcMain.handle('whatsapp:settings-save', async (_, payload = {}) => {
    try {
      const saved = await whatsappService.saveConfig({
        userId: DEFAULT_USER_ID,
        whatsappApiKey: payload.whatsappApiKey,
        whatsappPhoneId: payload.whatsappPhoneId,
        testPhone: payload.testPhone
      });
      return {
        success: true,
        data: saved
      };
    } catch (error) {
      return { success: false, error: error?.message || 'Не удалось сохранить настройки WhatsApp' };
    }
  });

  ipcMain.handle('whatsapp:send', async (_, payload = {}) => {
    try {
      const data = await whatsappService.sendMessage({
        userId: DEFAULT_USER_ID,
        phone: payload.phone,
        message: payload.message
      });
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error?.message || 'Ошибка отправки WhatsApp сообщения' };
    }
  });

  ipcMain.handle('damubala:generate-qr', async (_, payload = {}) => {
    try {
      return await generateQrForIin(payload);
    } catch (error) {
      return {
        success: false,
        code: 'internal-error',
        message: error?.message || 'Не удалось сгенерировать QR'
      };
    }
  });

  ipcMain.handle('damubala:refresh-password', async (_, payload = {}) => {
    try {
      return await generateQrForIin({ ...payload, passwordOnly: true });
    } catch (error) {
      return {
        success: false,
        code: 'internal-error',
        message: error?.message || 'Не удалось обновить пароль'
      };
    }
  });

  ipcMain.handle('damubala:build-child-modal', async (_, payload = {}) => {
    try {
      const result = await buildChildQrModal(payload);
      if (!result?.success || !result?.item?.qrDataUrl) {
        return result;
      }
      const buffer = await renderModalPngBuffer({
        qrDataUrl: result.item.qrDataUrl,
        childName: payload.childName || result.item.childLabel || 'Ребенок'
      });
      return {
        ...result,
        modalImageDataUrl: `data:image/png;base64,${buffer.toString('base64')}`
      };
    } catch (error) {
      return {
        success: false,
        code: 'internal-error',
        message: error?.message || 'Не удалось подготовить QR модалку'
      };
    }
  });

  ipcMain.handle('damubala:fetch-vouchers-preview', async () => {
    try {
      const syncData = await fetchActiveVouchersPreviewWithLogin();
      return { success: true, ...syncData };
    } catch (error) {
      return {
        success: false,
        message: error?.message || 'Не удалось получить данные из Damubala.'
      };
    }
  });

  ipcMain.handle('damubala:connection-status', async () => {
    try {
      return { success: true, ...getDamubalaConnectionStatus() };
    } catch (error) {
      return { success: false, message: error?.message || 'Не удалось получить статус Damubala.' };
    }
  });

  ipcMain.handle('damubala:connect', async () => {
    try {
      await ensureDamubalaLoginWithWindow();
      const signingStats = await getDamubalaSigningStats();
      return { success: true, connected: true, signingStats };
    } catch (error) {
      return { success: false, message: error?.message || 'Не удалось подключиться к Damubala.' };
    }
  });

  ipcMain.handle('damubala:signing-stats-refresh', async () => {
    try {
      const signingStats = await getDamubalaSigningStats();
      return { success: true, signingStats };
    } catch (error) {
      return { success: false, message: error?.message || 'Не удалось обновить статистику подписей.' };
    }
  });

  ipcMain.handle('damubala:sync-vouchers', async (_, payload = {}) => {
    try {
      const imported = repository.importDamubalaVouchers({
        cityId: Number(payload.cityId || 0),
        studioId: Number(payload.studioId || 0),
        fetched: Number(payload.fetched || 0),
        items: Array.isArray(payload.items) ? payload.items : []
      });
      return { success: true, ...imported };
    } catch (error) {
      return {
        success: false,
        message: error?.message || 'Не удалось синхронизировать детей из Damubala.'
      };
    }
  });

  ipcMain.handle('qosymsha:fetch-children-preview', async (event) => {
    const sendProgress = (payload) => {
      try {
        event.sender.send('qosymsha:progress', payload || {});
      } catch {
        // renderer may be closed
      }
    };

    try {
      sendProgress({ stage: 'start', percent: 1, message: 'Запускаем загрузку Qosymsha...' });
      const syncData = await fetchQosymshaChildrenPreviewWithLogin(sendProgress);
      return { success: true, ...syncData };
    } catch (error) {
      sendProgress({ stage: 'error', percent: 0, message: error?.message || 'Ошибка загрузки Qosymsha.' });
      return {
        success: false,
        message: error?.message || 'Не удалось получить данные из Qosymsha.'
      };
    }
  });

  ipcMain.handle('qosymsha:sync-vouchers', async (_, payload = {}) => {
    try {
      const imported = repository.importQosymshaVouchers({
        cityId: Number(payload.cityId || 0),
        studioId: Number(payload.studioId || 0),
        fetched: Number(payload.fetched || 0),
        items: Array.isArray(payload.items) ? payload.items : []
      });
      return { success: true, ...imported };
    } catch (error) {
      return {
        success: false,
        message: error?.message || 'Не удалось синхронизировать детей из Qosymsha.'
      };
    }
  });

  ipcMain.handle('artsport:fetch-children-preview', async (event) => {
    const sendProgress = (payload) => {
      try {
        event.sender.send('artsport:progress', payload || {});
      } catch {
        // renderer may be closed
      }
    };

    try {
      sendProgress({ stage: 'start', percent: 1, message: 'Запускаем загрузку Artsport...' });
      const syncData = await fetchArtsportChildrenPreviewWithLogin(sendProgress);
      return { success: true, ...syncData };
    } catch (error) {
      sendProgress({ stage: 'error', percent: 0, message: error?.message || 'Ошибка загрузки Artsport.' });
      return {
        success: false,
        message: error?.message || 'Не удалось получить данные из Artsport.'
      };
    }
  });

  ipcMain.handle('artsport:sync-vouchers', async (_, payload = {}) => {
    try {
      const imported = repository.importArtsportVouchers({
        cityId: Number(payload.cityId || 0),
        studioId: Number(payload.studioId || 0),
        fetched: Number(payload.fetched || 0),
        items: Array.isArray(payload.items) ? payload.items : []
      });
      return { success: true, ...imported };
    } catch (error) {
      return {
        success: false,
        message: error?.message || 'Не удалось синхронизировать детей из Artsport.'
      };
    }
  });

  ipcMain.handle('damubala:pick-save-dir', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Выберите папку для сохранения QR'
    });

    if (result.canceled || !result.filePaths?.length) {
      return { success: false, canceled: true };
    }

    return { success: true, directoryPath: result.filePaths[0] };
  });

  ipcMain.handle('damubala:save-images', async (_, payload = {}) => {
    try {
      const directoryPath = String(payload.directoryPath || '').trim();
      const files = Array.isArray(payload.files) ? payload.files : [];
      if (!directoryPath || !files.length) {
        return { success: false, message: 'Нет данных для сохранения' };
      }

      fs.mkdirSync(directoryPath, { recursive: true });

      const savedPaths = [];
      for (const file of files) {
        const title = sanitizeFileName(file?.name || 'qr');
        const filePath = uniquePath(path.join(directoryPath, `${title}.png`));
        const qrDataUrl = String(file?.qrDataUrl || '');
        if (!qrDataUrl) continue;
        let buffer = null;
        const m = qrDataUrl.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
        if (m?.[1]) {
          buffer = Buffer.from(m[1], 'base64');
        } else {
          buffer = await renderModalPngBuffer({
            qrDataUrl,
            childName: file?.childLabel || file?.name || 'Ребенок'
          });
        }
        if (!buffer) continue;
        fs.writeFileSync(filePath, buffer);
        savedPaths.push(filePath);
      }

      return {
        success: true,
        savedCount: savedPaths.length,
        savedPaths
      };
    } catch (error) {
      return {
        success: false,
        message: error?.message || 'Не удалось сохранить файлы'
      };
    }
  });
}

module.exports = { registerIpcHandlers };
