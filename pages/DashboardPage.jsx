import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@renderer/api';
import StatCard from '@components/StatCard';
import Modal from '@components/Modal';

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('ru-RU');
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes <= 0) return '0 Б';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
}

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [selectedSoonVoucherChild, setSelectedSoonVoucherChild] = useState(null);
  const [backupModalOpen, setBackupModalOpen] = useState(false);
  const [backups, setBackups] = useState([]);
  const [restoreHistory, setRestoreHistory] = useState([]);
  const [selectedBackupId, setSelectedBackupId] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState('');
  const [backupInfo, setBackupInfo] = useState('');
  const navigate = useNavigate();
  const totalCities = data?.cityStructure?.length || 0;
  const totalQueueSoon = data?.soonVoucherQueue?.length || 0;

  async function loadDashboard() {
    const res = await api.getDashboard();
    setData(res || null);
  }

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const res = await api.getDashboard();
      if (mounted) setData(res);
    };
    load();
    const timer = window.setInterval(load, 15000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
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
    setSelectedBackupId((prev) => {
      if (prev && items.some((item) => item.id === prev)) return prev;
      return items[0]?.id || '';
    });
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
      if (!res?.success) {
        throw new Error(res?.message || 'Не удалось создать резервную копию.');
      }
      setBackupInfo(`Копия создана: ${formatDateTime(res.backup?.createdAt)}`);
      if (res?.backup?.id) setSelectedBackupId(res.backup.id);
      await loadBackups();
    } catch (error) {
      setBackupError(error?.message || 'Не удалось создать резервную копию.');
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleRestoreBackup(backupId) {
    const approve = window.confirm('Восстановить эту копию? Приложение перезапустится.');
    if (!approve) return;
    setBackupBusy(true);
    setBackupError('');
    setBackupInfo('');
    try {
      const res = await api.restoreBackup({ backupId });
      if (!res?.success) {
        throw new Error(res?.message || 'Не удалось восстановить резервную копию.');
      }
      setBackupInfo('Приложение перезапускается для восстановления...');
    } catch (error) {
      setBackupError(error?.message || 'Не удалось восстановить резервную копию.');
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleDeleteBackup(backupId) {
    const approve = window.confirm('Удалить выбранную резервную копию?');
    if (!approve) return;
    setBackupBusy(true);
    setBackupError('');
    setBackupInfo('');
    try {
      const res = await api.deleteBackup({ backupId });
      if (!res?.success) {
        throw new Error(res?.message || 'Не удалось удалить резервную копию.');
      }
      setBackupInfo('Резервная копия удалена.');
      await loadBackups();
    } catch (error) {
      setBackupError(error?.message || 'Не удалось удалить резервную копию.');
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleExportBackup() {
    if (!selectedBackupId) {
      setBackupError('Выберите резервную копию для экспорта.');
      return;
    }
    setBackupBusy(true);
    setBackupError('');
    setBackupInfo('');
    try {
      const res = await api.exportBackup({ backupId: selectedBackupId });
      if (res?.canceled) return;
      if (!res?.success) {
        throw new Error(res?.message || 'Не удалось экспортировать резервную копию.');
      }
      setBackupInfo(`Резервная копия экспортирована: ${res.filePath}`);
    } catch (error) {
      setBackupError(error?.message || 'Не удалось экспортировать резервную копию.');
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleImportDatabase() {
    const approve = window.confirm('Импорт заменит текущую базу. Приложение перезапустится. Продолжить?');
    if (!approve) return;
    setBackupBusy(true);
    setBackupError('');
    setBackupInfo('');
    try {
      const res = await api.importDatabase();
      if (res?.canceled) return;
      if (!res?.success) {
        throw new Error(res?.message || 'Не удалось импортировать базу.');
      }
      setBackupInfo('Приложение перезапускается после импорта...');
    } catch (error) {
      setBackupError(error?.message || 'Не удалось импортировать базу.');
    } finally {
      setBackupBusy(false);
    }
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 6 }}>Главная</h1>
          <p className="page-subtitle" style={{ marginBottom: 0 }}>Обзор по всем студиям, оплатам и ваучерам.</p>
        </div>
      </div>

      {data && (
        <>
          <div className="card-grid dashboard-top-cards dashboard-top-cards-rich">
            <StatCard label="Всего детей" value={data.totalChildren} onClick={() => navigate('/children')} />
            <StatCard label="Платники" value={data.totalPaid || 0} onClick={() => navigate('/children?type=paid')} />
            <StatCard label="Ваучеры" value={data.totalVouchers || 0} onClick={() => navigate('/children?type=voucher')} />
            <StatCard label="Городов в работе" value={totalCities} onClick={() => navigate('/structure')} />
          </div>

          <div className="dashboard-widgets">
            <div className="panel widget-card widget-card-wide">
              <h3 className="widget-title">Структура детей</h3>
              <div className="dashboard-city-list">
                {(data.cityStructure || []).map((row) => (
                  <div className="dashboard-city-item" key={row.cityId || row.cityName}>
                    <div className="dashboard-city-top">
                      <b>{row.cityName}</b>
                      <span>{row.totalChildren}</span>
                    </div>
                    <div className="dashboard-city-meta">
                      Ваучеры: {row.totalVouchers} • Платники: {row.totalPaid}
                    </div>
                  </div>
                ))}
                {!data.cityStructure?.length && (
                  <div className="dashboard-city-empty">Пока нет данных по городам.</div>
                )}
              </div>
            </div>

            <div className="panel widget-card dashboard-focus-card">
              <h3 className="widget-title">Быстрый обзор</h3>
              <div className="dashboard-focus-grid">
                <div className="dashboard-focus-item">
                  <span>Скоро ваучер</span>
                  <b>{totalQueueSoon}</b>
                </div>
                <div className="dashboard-focus-item">
                  <span>Ваучеров</span>
                  <b>{data.totalVouchers || 0}</b>
                </div>
                <div className="dashboard-focus-item">
                  <span>Платников</span>
                  <b>{data.totalPaid || 0}</b>
                </div>
                <div className="dashboard-focus-item">
                  <span>Городов</span>
                  <b>{totalCities}</b>
                </div>
              </div>
            </div>

          </div>

          <div className="panel dashboard-queue-panel" style={{ marginTop: 16 }}>
            <h3 className="widget-title">Скоро получат Ваучер</h3>
            <table className="children-table queue-table">
              <thead>
                <tr>
                  <th>ФИО ребенка</th>
                  <th>Возраст</th>
                  <th>Город</th>
                  <th>Студия</th>
                  <th>Номер очереди</th>
                </tr>
              </thead>
              <tbody>
                {(data.soonVoucherQueue || []).map((child) => (
                  <tr
                    key={child.id}
                    className="child-row"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedSoonVoucherChild(child)}
                  >
                    <td>{child.childFullName}</td>
                    <td>{child.childAge ?? '—'}</td>
                    <td>{child.cityName || '—'}</td>
                    <td>{child.studioName || '—'}</td>
                    <td>{child.queueNumber}</td>
                  </tr>
                ))}
                {!data.soonVoucherQueue?.length && (
                  <tr><td colSpan={5}>Нет детей с номером очереди меньше 1000</td></tr>
                )}
              </tbody>
            </table>
          </div>

        </>
      )}

      {selectedSoonVoucherChild && (
        <Modal title="Карточка очередника" onClose={() => setSelectedSoonVoucherChild(null)}>
          <div className="form-grid child-profile-grid">
            <div className="profile-card accent"><b>ФИО ребенка:</b><div>{selectedSoonVoucherChild.childFullName}</div></div>
            <div className="profile-card accent"><b>Возраст:</b><div>{selectedSoonVoucherChild.childAge ?? '—'}</div></div>
            <div className="profile-card"><b>ИИН ребенка:</b><div>{selectedSoonVoucherChild.childIIN || '—'}</div></div>
            <div className="profile-card"><b>ФИО родителя:</b><div>{selectedSoonVoucherChild.parentFullName || '—'}</div></div>
            <div className="profile-card"><b>ИИН родителя:</b><div>{selectedSoonVoucherChild.parentIIN || '—'}</div></div>
            <div className="profile-card"><b>Телефон:</b><div>{selectedSoonVoucherChild.phone || '—'}</div></div>
            <div className="profile-card"><b>Город:</b><div>{selectedSoonVoucherChild.cityName || '—'}</div></div>
            <div className="profile-card"><b>Студия:</b><div>{selectedSoonVoucherChild.studioName || '—'}</div></div>
            <div className="profile-card voucher"><b>Номер очереди:</b><div>{selectedSoonVoucherChild.queueNumber || '—'}</div></div>
            <div className="profile-card voucher"><b>Дата очереди:</b><div>{selectedSoonVoucherChild.queueDate || '—'}</div></div>
            <div className="profile-card paid"><b>Категория очереди:</b><div>{selectedSoonVoucherChild.queueCategory || '—'}</div></div>
          </div>
        </Modal>
      )}

      {backupModalOpen && (
        <Modal title="Резервные копии и база данных" onClose={() => setBackupModalOpen(false)}>
          <div className="toolbar" style={{ marginBottom: 10 }}>
            <button type="button" className="primary" onClick={handleCreateBackup} disabled={backupBusy}>
              Создать резервную копию
            </button>
            <button type="button" onClick={handleExportBackup} disabled={backupBusy || !selectedBackupId}>
              Экспорт выбранной копии
            </button>
            <button type="button" onClick={handleImportDatabase} disabled={backupBusy}>
              Импорт базы
            </button>
          </div>

          <div className="toolbar" style={{ marginBottom: 10 }}>
            <select value={selectedBackupId} onChange={(e) => setSelectedBackupId(e.target.value)} disabled={backupBusy || !backups.length}>
              {!backups.length && <option value="">Нет резервных копий</option>}
              {backups.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {formatDateTime(entry.createdAt)} • {entry.fileName}
                </option>
              ))}
            </select>
          </div>

          {!!backupError && <div className="dashboard-signing-error" style={{ marginBottom: 10 }}>{backupError}</div>}
          {!!backupInfo && <div style={{ color: '#73e7d5', marginBottom: 10, fontSize: 13 }}>{backupInfo}</div>}

          <div className="panel" style={{ padding: 12 }}>
            <h4 style={{ margin: '0 0 8px' }}>История резервных копий</h4>
            <table className="children-table queue-table">
              <thead>
                <tr>
                  <th>Дата создания</th>
                  <th>Размер</th>
                  <th>Файл</th>
                  <th style={{ width: 320 }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDateTime(entry.createdAt)}</td>
                    <td>{formatBytes(entry.size)}</td>
                    <td>{entry.fileName}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button type="button" onClick={() => handleRestoreBackup(entry.id)} disabled={backupBusy}>
                          Восстановить
                        </button>
                        <button type="button" onClick={() => setSelectedBackupId(entry.id)} disabled={backupBusy}>
                          Выбрать
                        </button>
                        <button type="button" onClick={() => handleDeleteBackup(entry.id)} disabled={backupBusy}>
                          Удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!backups.length && (
                  <tr>
                    <td colSpan={4}>Пока нет резервных копий.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="panel" style={{ padding: 12, marginTop: 10 }}>
            <h4 style={{ margin: '0 0 8px' }}>История восстановлений</h4>
            <table className="children-table queue-table">
              <thead>
                <tr>
                  <th>Когда восстановили</th>
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
                  <tr>
                    <td colSpan={2}>Пока нет восстановлений.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </section>
  );
}
