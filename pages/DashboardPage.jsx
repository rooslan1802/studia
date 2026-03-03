import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@renderer/api';
import StatCard from '@components/StatCard';
import Modal from '@components/Modal';

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [selectedSoonVoucherChild, setSelectedSoonVoucherChild] = useState(null);
  const navigate = useNavigate();

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
          <div className="card-grid">
            <StatCard label="Всего детей" value={data.totalChildren} onClick={() => navigate('/children')} />
            <StatCard label="Ваучеры" value={data.totalVouchers} onClick={() => navigate('/children?type=voucher')} />
            <StatCard label="Платники" value={data.totalPaid} onClick={() => navigate('/children?type=paid')} />
            <StatCard label="Неподписанные (согласование)" value={data.signingStats?.totalUnsigned || 0} onClick={() => navigate('/')} />
          </div>

          <div className="dashboard-widgets">
            <div className="panel widget-card">
              <h3 className="widget-title">Структура детей</h3>
              <div className="widget-bar-row">
                <span>Платники</span>
                <b>{data.totalPaid}</b>
              </div>
              <div className="widget-bar-track">
                <div
                  className="widget-bar-fill paid"
                  style={{ width: `${Math.round((safePct(data.totalPaid, data.totalChildren) || 0) * 100) / 100}%` }}
                />
              </div>
              <div className="widget-bar-row">
                <span>Ваучеры</span>
                <b>{data.totalVouchers}</b>
              </div>
              <div className="widget-bar-track">
                <div
                  className="widget-bar-fill voucher"
                  style={{ width: `${Math.round((safePct(data.totalVouchers, data.totalChildren) || 0) * 100) / 100}%` }}
                />
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
              <h3 className="widget-title">Подписание табелей</h3>
              <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                <div className="profile-card voucher" style={{ margin: 0 }}>
                  <b>Неподписанные</b>
                  <div>{data.signingStats?.totalUnsigned || 0}</div>
                </div>
                <div className="profile-card paid" style={{ margin: 0 }}>
                  <b>Подписанные</b>
                  <div>{data.signingStats?.totalSigned || 0}</div>
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

function safePct(value, total) {
  if (!total) return 0;
  return (Number(value || 0) * 100) / Number(total || 1);
}
