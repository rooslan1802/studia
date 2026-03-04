import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@renderer/api';
import StatCard from '@components/StatCard';
import Modal from '@components/Modal';

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [selectedSoonVoucherChild, setSelectedSoonVoucherChild] = useState(null);
  const [signingRefreshing, setSigningRefreshing] = useState(false);
  const [signingError, setSigningError] = useState('');
  const navigate = useNavigate();

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

  async function refreshSigningStats() {
    setSigningRefreshing(true);
    setSigningError('');
    try {
      const connectResult = await api.connectDamubala();
      if (!connectResult?.success) {
        throw new Error(connectResult?.message || 'Не удалось войти в Damubala.');
      }
      const refreshed = await api.refreshDamubalaSigningStats();
      if (!refreshed?.success) {
        throw new Error(refreshed?.message || 'Не удалось обновить табели Damubala.');
      }
      await loadDashboard();
    } catch (error) {
      setSigningError(error?.message || 'Ошибка обновления подписаний.');
    } finally {
      setSigningRefreshing(false);
    }
  }

  const damubalaSigning = data?.signingPlatforms?.damubala || { signed: 0, unsigned: 0, available: false };
  const qosymshaSigning = data?.signingPlatforms?.qosymsha || { signed: 0, unsigned: 0, available: false };

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
          <div className="card-grid dashboard-top-cards">
            <StatCard label="Всего детей" value={data.totalChildren} onClick={() => navigate('/children')} />
          </div>

          <div className="dashboard-widgets">
            <div className="panel widget-card">
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

            <div className="panel widget-card">
              <h3 className="widget-title">Посещаемость Сегодня</h3>
              <div className="widget-kpis">
                <div>
                  <div className="kpi-label">Всего занятий</div>
                  <div className="kpi-value">{data.attendance?.todaySessions || 0}</div>
                </div>
                <div>
                  <div className="kpi-label">Проведено</div>
                  <div className="kpi-value">{data.attendance?.todayConducted || 0}</div>
                </div>
                <div>
                  <div className="kpi-label">Отменено</div>
                  <div className="kpi-value">{data.attendance?.todayCancelled || 0}</div>
                </div>
              </div>
            </div>

            <div className="panel widget-card">
              <div className="widget-signing-head">
                <h3 className="widget-title" style={{ margin: 0 }}>Подписание табелей</h3>
                <button
                  type="button"
                  className="icon-btn"
                  title="Обновить подписи"
                  onClick={refreshSigningStats}
                  disabled={signingRefreshing}
                >
                  {signingRefreshing ? '…' : '↻'}
                </button>
              </div>
              <div className="dashboard-signing-grid">
                <div className="dashboard-signing-platform">
                  <div className="dashboard-signing-platform-title">Damubala</div>
                  {signingRefreshing ? (
                    <div className="dashboard-signing-loading">
                      <div className="dashboard-signing-spinner" />
                      <div className="dashboard-signing-loading-text">Идет подсчет детей...</div>
                    </div>
                  ) : (
                    <>
                      <div className="dashboard-signing-row">
                        <span>Подписано</span>
                        <b>{damubalaSigning.signed || 0}</b>
                      </div>
                      <div className="dashboard-signing-row unsigned">
                        <span>Не подписано</span>
                        <b>{damubalaSigning.unsigned || 0}</b>
                      </div>
                    </>
                  )}
                  {!!signingError && <div className="dashboard-signing-error">{signingError}</div>}
                </div>
                <div className="dashboard-signing-platform">
                  <div className="dashboard-signing-platform-title">Qosymsha</div>
                  <div className="dashboard-signing-row">
                    <span>Подписано</span>
                    <b>{qosymshaSigning.signed || 0}</b>
                  </div>
                  <div className="dashboard-signing-row unsigned">
                    <span>Не подписано</span>
                    <b>{qosymshaSigning.unsigned || 0}</b>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
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
    </section>
  );
}
