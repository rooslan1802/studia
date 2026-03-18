const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getDashboard: () => ipcRenderer.invoke('dashboard:get'),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  createBackup: () => ipcRenderer.invoke('backup:create'),
  restoreBackup: (payload) => ipcRenderer.invoke('backup:restore', payload),
  deleteBackup: (payload) => ipcRenderer.invoke('backup:delete', payload),
  exportBackup: (payload) => ipcRenderer.invoke('backup:export', payload),
  exportDatabase: () => ipcRenderer.invoke('database:export'),
  importDatabase: () => ipcRenderer.invoke('database:import'),

  listCities: () => ipcRenderer.invoke('cities:list'),
  saveCity: (payload) => ipcRenderer.invoke('cities:save', payload),
  deleteCity: (id) => ipcRenderer.invoke('cities:delete', id),

  listStudios: (filters) => ipcRenderer.invoke('studios:list', filters),
  saveStudio: (payload) => ipcRenderer.invoke('studios:save', payload),
  deleteStudio: (id) => ipcRenderer.invoke('studios:delete', id),

  listCourses: (filters) => ipcRenderer.invoke('courses:list', filters),
  saveCourse: (payload) => ipcRenderer.invoke('courses:save', payload),
  deleteCourse: (id) => ipcRenderer.invoke('courses:delete', id),

  listGroups: (courseId) => ipcRenderer.invoke('groups:list', courseId),
  saveGroup: (payload) => ipcRenderer.invoke('groups:save', payload),
  deleteGroup: (id) => ipcRenderer.invoke('groups:delete', id),

  listGroupSchedule: (groupId) => ipcRenderer.invoke('group-schedule:list', groupId),
  saveGroupSchedule: (payload) => ipcRenderer.invoke('group-schedule:save', payload),

  listStructure: () => ipcRenderer.invoke('structure:list'),

  listChildren: (filters) => ipcRenderer.invoke('children:list', filters),
  listArchivedEntities: (filters) => ipcRenderer.invoke('archive:list', filters),
  deleteArchivedEntity: (payload) => ipcRenderer.invoke('archive:delete', payload),
  restoreArchivedEntity: (payload) => ipcRenderer.invoke('archive:restore', payload),
  listQueueChildren: (filters) => ipcRenderer.invoke('queue:list', filters),
  saveQueueChild: (payload) => ipcRenderer.invoke('queue:save', payload),
  deleteQueueChild: (id) => ipcRenderer.invoke('queue:delete', id),
  refreshQueueChildren: (payload) => ipcRenderer.invoke('queue:refresh', payload),
  getChild: (childId) => ipcRenderer.invoke('children:get', childId),
  saveChild: (payload) => ipcRenderer.invoke('children:save', payload),
  deleteChild: (id) => ipcRenderer.invoke('children:delete', id),
  setChildrenMessageTag: (payload) => ipcRenderer.invoke('children:set-message-tag', payload),
  setChildrenCourse: (payload) => ipcRenderer.invoke('children:set-course', payload),
  clearAllChildren: () => ipcRenderer.invoke('children:clear-all'),

  listPayments: (filters) => ipcRenderer.invoke('payments:list', filters),
  listPaymentTransactions: (filters) => ipcRenderer.invoke('payments:transactions', filters),
  getPaymentHistory: (childId) => ipcRenderer.invoke('payments:history', childId),
  getMonthlyPaymentsReport: (filters) => ipcRenderer.invoke('payments:report-monthly', filters),
  savePaymentComment: (payload) => ipcRenderer.invoke('payments:comment', payload),
  markPaymentPaid: (payload) => ipcRenderer.invoke('payments:mark-paid', payload),
  cancelPaymentTransaction: (payload) => ipcRenderer.invoke('payments:cancel-transaction', payload),

  getAttendanceSheet: (payload) => ipcRenderer.invoke('attendance:sheet', payload),
  saveAttendanceSheet: (payload) => ipcRenderer.invoke('attendance:sheet-save', payload),
  listAttendanceSessions: (filters) => ipcRenderer.invoke('attendance:list', filters),
  listAttendanceBoards: (filters) => ipcRenderer.invoke('attendance:boards', filters),
  addAttendanceDate: (payload) => ipcRenderer.invoke('attendance:add-date', payload),
  removeAttendanceDate: (payload) => ipcRenderer.invoke('attendance:remove-date', payload),

  listNotifications: () => ipcRenderer.invoke('notifications:list'),
  listAuditLogs: (filters) => ipcRenderer.invoke('audit:list', filters),
  deleteAuditLog: (id) => ipcRenderer.invoke('audit:delete', id),
  clearAuditLogs: () => ipcRenderer.invoke('audit:clear'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (payload) => ipcRenderer.invoke('settings:save', payload),
  getUpdateStatus: () => ipcRenderer.invoke('app:updates:status'),
  checkForUpdates: () => ipcRenderer.invoke('app:updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('app:updates:download'),
  installUpdate: () => ipcRenderer.invoke('app:updates:install'),
  onUpdateState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_, payload) => callback(payload || {});
    ipcRenderer.on('app:update-state', listener);
    return () => ipcRenderer.removeListener('app:update-state', listener);
  },

  getWhatsAppSettings: () => ipcRenderer.invoke('whatsapp:settings-get'),
  saveWhatsAppSettings: (payload) => ipcRenderer.invoke('whatsapp:settings-save', payload),
  sendWhatsAppMessage: (payload) => ipcRenderer.invoke('whatsapp:send', payload),

  fetchDamubalaVouchersPreview: () => ipcRenderer.invoke('damubala:fetch-vouchers-preview'),
  syncDamubalaVouchers: (payload) => ipcRenderer.invoke('damubala:sync-vouchers', payload),
  fetchQosymshaChildrenPreview: () => ipcRenderer.invoke('qosymsha:fetch-children-preview'),
  syncQosymshaVouchers: (payload) => ipcRenderer.invoke('qosymsha:sync-vouchers', payload),
  onQosymshaProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_, payload) => callback(payload || {});
    ipcRenderer.on('qosymsha:progress', listener);
    return () => ipcRenderer.removeListener('qosymsha:progress', listener);
  },
  fetchArtsportChildrenPreview: () => ipcRenderer.invoke('artsport:fetch-children-preview'),
  syncArtsportVouchers: (payload) => ipcRenderer.invoke('artsport:sync-vouchers', payload),
  onArtsportProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_, payload) => callback(payload || {});
    ipcRenderer.on('artsport:progress', listener);
    return () => ipcRenderer.removeListener('artsport:progress', listener);
  },
});
