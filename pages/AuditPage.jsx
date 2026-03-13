import React, { useEffect, useState } from 'react';
import { api } from '@renderer/api';
import Modal from '@components/Modal';

function formatDateTime(value) {
  if (!value) return '—';
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-');
    return `${d}.${m}.${y} • время не сохранено`;
  }
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleString('ru-RU', {
    timeZone: 'Asia/Almaty',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function describeAudit(row) {
  const payload = row.payloadJson || {};
  if (row.actionType === 'children.transfer') return row.summary || 'Ребенок переведен в другую группу';
  if (row.actionType === 'children.delete') return `Удален ребенок: ${payload.childName || row.entityId || '—'}`;
  if (row.actionType === 'queue.delete') return `Удален очередник: ${payload.childName || row.summary}`;
  if (row.actionType === 'children.tag.update') return `Изменена пометка: ${payload.messageTag || 'без пометки'}`;
  if (row.actionType === 'children.update') return row.summary;
  if (row.actionType === 'children.create') return row.summary;
  if (row.actionType === 'payments.mark-paid') return `Оплата отмечена: ${Number(payload.amount || 0).toLocaleString('ru-RU')} тг`;
  if (row.actionType === 'payments.cancel') return 'Оплата отменена';
  if (row.actionType === 'backup.create') return 'Создана резервная копия';
  if (row.actionType === 'backup.restore') return 'Восстановлена резервная копия';
  if (row.actionType === 'backup.delete') return 'Удалена резервная копия';
  if (row.actionType === 'backup.export') return 'Экспортирована резервная копия';
  if (row.actionType === 'database.import') return 'Импортирована база данных';
  if (row.actionType === 'database.export') return 'Экспортирована база данных';
  if (row.actionType === 'settings.update') return 'Изменены настройки циклов и оплат';
  if (String(row.actionType || '').startsWith('import.')) return row.summary;
  return row.summary || row.actionType || 'Изменение';
}

function describeDetails(row) {
  const payload = row.payloadJson || {};
  if (row.actionType === 'children.transfer') {
    return `Из ${payload.fromGroupName || '—'} в ${payload.toGroupName || '—'} • Дата перевода: ${payload.effectiveDate || '—'}`;
  }
  if (row.actionType === 'children.delete') {
    return `Раздел: ${payload.childType === 'paid' ? 'Платники' : 'Ваучеры'} • Архивированная запись`;
  }
  if (row.actionType === 'queue.delete') {
    return `Очередь • Заявка №${payload.queueNumber || '—'}`;
  }
  if (row.actionType === 'children.tag.update') {
    const tag = String(payload.messageTag || '').trim();
    return `Изменено детей: ${(payload.ids || []).length}${tag ? ` • Пометка: ${tag}` : ''}`;
  }
  if (row.actionType === 'payments.mark-paid') {
    return `Сумма: ${Number(payload.amount || 0).toLocaleString('ru-RU')} тг • ${payload.paymentMethod || 'Способ не указан'} • ${payload.paidDate || '—'}`;
  }
  if (row.actionType === 'payments.cancel') {
    return 'Платеж удален из истории оплат';
  }
  if (row.actionType === 'payments.comment.save') {
    return payload.promisedDate ? `Обещанная дата оплаты: ${payload.promisedDate}` : 'Комментарий по оплате обновлен';
  }
  if (row.actionType === 'settings.update') {
    return `Цикл по умолчанию: ${payload.defaultCycleLength || 8} • Первая оплата после ${payload.defaultFirstPaymentLesson || 1} занятия`;
  }
  if (row.actionType === 'backup.create' || row.actionType === 'backup.restore' || row.actionType === 'backup.delete' || row.actionType === 'backup.export') {
    return `Копия: ${payload.backupId || '—'}`;
  }
  if (String(row.actionType || '').startsWith('import.')) {
    return `Добавлено: ${payload.added || 0} • Обновлено: ${payload.updated || 0} • Пропущено: ${payload.skipped || 0}`;
  }
  if (row.actionType === 'archive.restore') {
    return 'Запись восстановлена из архива';
  }
  return row.summary || 'Изменение сохранено в журнале';
}

export default function AuditPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [backupModalOpen, setBackupModalOpen] = useState(false);
  const [backups, setBackups] = useState([]);
  const [restoreHistory, setRestoreHistory] = useState([]);
  const [selectedBackupId, setSelectedBackupId] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState('');
  const [backupInfo, setBackupInfo] = useState('');
  const [filters, setFilters] = useState({
    actionType: '',
    dateFrom: '',
    dateTo: '',
    query: ''
  });

  async function load() {
    setLoading(true);
    setError('');
    try {
      const rows = await api.listAuditLogs({ ...filters, limit: 500 });
      setLogs(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(e?.message || 'Не удалось загрузить аудит.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function loadBackups() {
    const res = await api.listBackups();
    if (!res?.success) {
      setBackupError(res?.message || 'Не удалось загрузить резервные копии.');
      return;
    }
    const items = Array.isArray(res.backups) ? res.backups : [];
    setBackups(items);
    setRestoreHistory(Array.isArray(res.restoreHistory) ? res.restoreHistory : []);
    setSelectedBackupId((prev) => (prev && items.some((item) => item.id === prev) ? prev : (items[0]?.id || '')));
  }

  async function openBackupModal() {
    setBackupModalOpen(true);
    setBackupError('');
    setBackupInfo('');
    await loadBackups();
  }

  async function handleCreateBackup() {
    setBackupBusy(true);
    setBackupError('');
    setBackupInfo('');
    try {
      const res = await api.createBackup();
      if (!res?.success) throw new Error(res?.message || 'Не удалось создать резервную копию.');
      setBackupInfo(`Копия создана: ${formatDateTime(res.backup?.createdAt)}`);
      await loadBackups();
      await load();
    } catch (e) {
      setBackupError(e?.message || 'Не удалось создать резервную копию.');
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleRestoreBackup(backupId) {
    if (!window.confirm('Восстановить эту копию? Приложение перезапустится.')) return;
    setBackupBusy(true);
    setBackupError('');
    try {
      const res = await api.restoreBackup({ backupId });
      if (!res?.success) throw new Error(res?.message || 'Не удалось восстановить резервную копию.');
      setBackupInfo('Приложение перезапускается...');
    } catch (e) {
      setBackupError(e?.message || 'Не удалось восстановить резервную копию.');
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleDeleteBackup(backupId) {
    if (!window.confirm('Удалить выбранную резервную копию?')) return;
    setBackupBusy(true);
    setBackupError('');
    try {
      const res = await api.deleteBackup({ backupId });
      if (!res?.success) throw new Error(res?.message || 'Не удалось удалить резервную копию.');
      await loadBackups();
      await load();
    } catch (e) {
      setBackupError(e?.message || 'Не удалось удалить резервную копию.');
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleExportBackup() {
    if (!selectedBackupId) return;
    setBackupBusy(true);
    setBackupError('');
    try {
      const res = await api.exportBackup({ backupId: selectedBackupId });
      if (!res?.canceled && !res?.success) throw new Error(res?.message || 'Не удалось экспортировать резервную копию.');
      await load();
    } catch (e) {
      setBackupError(e?.message || 'Не удалось экспортировать резервную копию.');
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleImportDatabase() {
    if (!window.confirm('Импорт заменит текущую базу. Приложение перезапустится. Продолжить?')) return;
    setBackupBusy(true);
    setBackupError('');
    try {
      const res = await api.importDatabase();
      if (!res?.canceled && !res?.success) throw new Error(res?.message || 'Не удалось импортировать базу.');
    } catch (e) {
      setBackupError(e?.message || 'Не удалось импортировать базу.');
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleDeleteLog(id) {
    if (!window.confirm('Удалить эту запись из истории?')) return;
    try {
      await api.deleteAuditLog(id);
      setLogs((prev) => prev.filter((row) => Number(row.id) !== Number(id)));
    } catch (e) {
      setError(e?.message || 'Не удалось удалить запись истории.');
    }
  }

  async function handleClearLogs() {
    if (!window.confirm('Очистить всю историю аудита? Это действие нельзя отменить.')) return;
    try {
      setLoading(true);
      setError('');
      await api.clearAuditLogs();
      setLogs([]);
    } catch (e) {
      setError(e?.message || 'Не удалось очистить историю аудита.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <h1 className="page-title">История действий</h1>
      <p className="page-subtitle">Понятная история изменений по детям, оплатам, импортам и резервным копиям.</p>

      <div className="panel">
        <div className="toolbar">
          <button type="button" className="primary" onClick={openBackupModal}>Резервные копии</button>
          <select
            value={filters.actionType}
            onChange={(e) => setFilters((prev) => ({ ...prev, actionType: e.target.value }))}
            title="Фильтр событий"
          >
            <option value="">Все события</option>
            <option value="children.transfer">Переводы между группами</option>
            <option value="children.update">Изменения детей</option>
            <option value="children.delete">Удаления детей</option>
            <option value="payments.mark-paid">Оплаты</option>
            <option value="backup.create">Создание резервных копий</option>
            <option value="backup.restore">Восстановления</option>
          </select>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters((prev) => ({ ...prev, dateFrom: e.target.value }))}
            title="Дата с"
          />
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters((prev) => ({ ...prev, dateTo: e.target.value }))}
            title="Дата по"
          />
          <input
            value={filters.query}
            onChange={(e) => setFilters((prev) => ({ ...prev, query: e.target.value }))}
            placeholder="Поиск по описанию"
          />
          <button type="button" className="danger" onClick={handleClearLogs} disabled={loading || !logs.length}>
            Очистить историю
          </button>
          <button type="button" className="primary" onClick={load} disabled={loading}>
            {loading ? 'Загрузка...' : 'Обновить'}
          </button>
        </div>

        {error && <div className="alert-error">{error}</div>}

        <table className="children-table">
          <thead>
            <tr>
              <th style={{ width: 170 }}>Дата</th>
              <th style={{ width: 220 }}>Событие</th>
              <th>Подробности</th>
              <th style={{ width: 140 }}>Удаление</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((row) => (
              <tr key={row.id}>
                <td>{formatDateTime(row.createdAt)}</td>
                <td>{describeAudit(row)}</td>
                <td>{describeDetails(row)}</td>
                <td>
                  <button type="button" className="danger" onClick={() => handleDeleteLog(row.id)}>
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
            {!logs.length && !loading && (
              <tr>
                <td colSpan={4} style={{ color: '#9eb4d4' }}>Записей пока нет.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {backupModalOpen && (
        <Modal title="Резервные копии" onClose={() => setBackupModalOpen(false)}>
          <div className="toolbar" style={{ marginBottom: 14 }}>
            <button type="button" className="primary" onClick={handleCreateBackup} disabled={backupBusy}>Создать копию</button>
            <button type="button" onClick={handleExportBackup} disabled={backupBusy || !selectedBackupId}>Экспорт копии</button>
            <button type="button" onClick={handleImportDatabase} disabled={backupBusy}>Импорт базы</button>
          </div>
          <div className="toolbar" style={{ marginBottom: 14 }}>
            <select value={selectedBackupId} onChange={(e) => setSelectedBackupId(e.target.value)} disabled={backupBusy || !backups.length}>
              {!backups.length && <option value="">Нет резервных копий</option>}
              {backups.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label} • {formatDateTime(entry.createdAt)}
                </option>
              ))}
            </select>
          </div>
          {!!backupError && <div className="dashboard-signing-error" style={{ marginBottom: 10 }}>{backupError}</div>}
          {!!backupInfo && <div style={{ color: '#73e7d5', marginBottom: 10 }}>{backupInfo}</div>}
          <table className="children-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Размер</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {backups.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDateTime(entry.createdAt)}</td>
                  <td>{entry.sizeLabel || '—'}</td>
                  <td>
                    <div className="icon-actions">
                      <button type="button" onClick={() => handleRestoreBackup(entry.id)} disabled={backupBusy}>Восстановить</button>
                      <button type="button" onClick={() => setSelectedBackupId(entry.id)} disabled={backupBusy}>Выбрать</button>
                      <button type="button" className="danger" onClick={() => handleDeleteBackup(entry.id)} disabled={backupBusy}>Удалить</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!backups.length && (
                <tr><td colSpan={3} style={{ color: '#9eb4d4' }}>Резервных копий пока нет.</td></tr>
              )}
            </tbody>
          </table>
          <div style={{ marginTop: 18, fontWeight: 700 }}>История восстановлений</div>
          <table className="children-table" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Когда</th>
                <th>Какая копия</th>
              </tr>
            </thead>
            <tbody>
              {restoreHistory.map((item) => (
                <tr key={item.id}>
                  <td>{formatDateTime(item.restoredAt)}</td>
                  <td>{item.backupId || '—'}</td>
                </tr>
              ))}
              {!restoreHistory.length && (
                <tr><td colSpan={2} style={{ color: '#9eb4d4' }}>История восстановлений пуста.</td></tr>
              )}
            </tbody>
          </table>
        </Modal>
      )}
    </section>
  );
}
