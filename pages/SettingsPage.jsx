import React, { useEffect, useState } from 'react';
import { api } from '@renderer/api';

function emptyOverride() {
  return {
    courseId: '',
    cycleLength: 8,
    firstPaymentLesson: 1
  };
}

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    payments: {
      defaultCycleLength: 8,
      defaultFirstPaymentLesson: 1,
      courseOverrides: []
    }
  });
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [updateStatus, setUpdateStatus] = useState({
    checking: false,
    available: false,
    downloaded: false,
    downloading: false,
    version: '',
    latestVersion: '',
    progressPercent: 0,
    message: ''
  });
  const [updateError, setUpdateError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [savedSettings, courseList] = await Promise.all([api.getSettings(), api.listCourses()]);
      setSettings(savedSettings || settings);
      setCourses(Array.isArray(courseList) ? courseList : []);
    } catch (e) {
      setError(e?.message || 'Не удалось загрузить настройки.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    return undefined;
  }, []);

  useEffect(() => {
    api.getUpdateStatus().then((state) => setUpdateStatus(state || {})).catch(() => {});
    const off = api.onUpdateState((state) => setUpdateStatus(state || {}));
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  function updatePayments(key, value) {
    setSettings((prev) => ({
      ...prev,
      payments: {
        ...prev.payments,
        [key]: value
      }
    }));
  }

  function updateOverride(index, key, value) {
    setSettings((prev) => {
      const next = [...(prev.payments?.courseOverrides || [])];
      next[index] = { ...next[index], [key]: value };
      return {
        ...prev,
        payments: {
          ...prev.payments,
          courseOverrides: next
        }
      };
    });
  }

  function addOverride() {
    updatePayments('courseOverrides', [...(settings.payments?.courseOverrides || []), emptyOverride()]);
  }

  function removeOverride(index) {
    updatePayments('courseOverrides', (settings.payments?.courseOverrides || []).filter((_, idx) => idx !== index));
  }

  async function save() {
    setSaving(true);
    setError('');
    setInfo('');
    try {
      const saved = await api.saveSettings(settings);
      setSettings(saved || settings);
      setInfo('Настройки сохранены.');
    } catch (e) {
      setError(e?.message || 'Не удалось сохранить настройки.');
    } finally {
      setSaving(false);
    }
  }

  async function checkUpdates() {
    setUpdateError('');
    try {
      const state = await api.checkForUpdates();
      setUpdateStatus(state || {});
    } catch (e) {
      const msg = String(e?.message || 'Не удалось проверить обновления.');
      setUpdateError(msg.split('\n')[0].slice(0, 200));
    }
  }

  async function downloadUpdate() {
    setUpdateError('');
    try {
      const state = await api.downloadUpdate();
      setUpdateStatus(state || {});
    } catch (e) {
      const msg = String(e?.message || 'Не удалось скачать обновление.');
      setUpdateError(msg.split('\n')[0].slice(0, 200));
    }
  }

  async function installUpdate() {
    setUpdateError('');
    try {
      await api.installUpdate();
    } catch (e) {
      const msg = String(e?.message || 'Не удалось установить обновление.');
      setUpdateError(msg.split('\n')[0].slice(0, 200));
    }
  }

  return (
    <section>
      <h1 className="page-title">Настройки</h1>
      <p className="page-subtitle">Глобальные циклы оплат и обновления приложения.</p>

      <div className="panel">
        {loading ? (
          <div style={{ color: '#97a7c3' }}>Загрузка...</div>
        ) : (
          <>
            <div className="form-grid">
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Цикл по умолчанию</div>
                <input
                  type="number"
                  min="1"
                  value={settings.payments?.defaultCycleLength || 8}
                  onChange={(e) => updatePayments('defaultCycleLength', Number(e.target.value || 8))}
                />
              </label>

              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Первая оплата после занятия №</div>
                <input
                  type="number"
                  min="1"
                  value={settings.payments?.defaultFirstPaymentLesson || 1}
                  onChange={(e) => updatePayments('defaultFirstPaymentLesson', Number(e.target.value || 1))}
                />
              </label>
            </div>

            <div style={{ marginTop: 18, marginBottom: 10, fontWeight: 700 }}>Отдельные кружки</div>
            <div style={{ display: 'grid', gap: 10 }}>
              {(settings.payments?.courseOverrides || []).map((row, index) => (
                <div key={`${row.courseId || 'new'}-${index}`} className="panel" style={{ padding: 12 }}>
                  <div className="form-grid">
                    <label>
                      <div style={{ marginBottom: 6, color: '#97a7c3' }}>Кружок</div>
                      <select value={row.courseId || ''} onChange={(e) => updateOverride(index, 'courseId', e.target.value)}>
                        <option value="">Выберите кружок</option>
                        {courses.map((course) => (
                          <option key={course.id} value={course.id}>
                            {course.cityName ? `${course.cityName} / ` : ''}{course.studioName ? `${course.studioName} / ` : ''}{course.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <div style={{ marginBottom: 6, color: '#97a7c3' }}>Цикл</div>
                      <input
                        type="number"
                        min="1"
                        value={row.cycleLength || 8}
                        onChange={(e) => updateOverride(index, 'cycleLength', Number(e.target.value || 8))}
                      />
                    </label>
                    <label>
                      <div style={{ marginBottom: 6, color: '#97a7c3' }}>Первая оплата после занятия №</div>
                      <input
                        type="number"
                        min="1"
                        value={row.firstPaymentLesson || 1}
                        onChange={(e) => updateOverride(index, 'firstPaymentLesson', Number(e.target.value || 1))}
                      />
                    </label>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                    <button type="button" className="danger" onClick={() => removeOverride(index)}>Удалить правило</button>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16 }}>
              <button type="button" onClick={addOverride}>Добавить правило для кружка</button>
              <button type="button" className="primary" onClick={save} disabled={saving}>
                {saving ? 'Сохранение...' : 'Сохранить настройки'}
              </button>
            </div>

            {!!error && <div className="dashboard-signing-error" style={{ marginTop: 12 }}>{error}</div>}
            {!!info && <div style={{ color: '#73e7d5', marginTop: 12 }}>{info}</div>}
          </>
        )}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Обновления приложения</div>
            <div style={{ color: '#97a7c3' }}>
              Текущая версия: {updateStatus.version || '—'} {updateStatus.latestVersion ? `• Доступна: ${updateStatus.latestVersion}` : ''}
            </div>
            <div style={{ color: '#97a7c3', marginTop: 4, maxWidth: 480, whiteSpace: 'pre-line' }}>
              {updateStatus.message || 'Нажмите “Проверить обновления”.'}
            </div>
            {updateStatus.downloading && (
              <div style={{ color: '#73e7d5', marginTop: 4 }}>Скачивание: {Math.round(updateStatus.progressPercent || 0)}%</div>
            )}
            {!!updateError && <div className="dashboard-signing-error" style={{ marginTop: 6, maxWidth: 480 }}>{updateError}</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button type="button" onClick={checkUpdates} disabled={updateStatus.checking || updateStatus.downloading}>
              {updateStatus.checking ? 'Проверяем...' : 'Проверить обновления'}
            </button>
            <button
              type="button"
              onClick={downloadUpdate}
              disabled={!updateStatus.available || updateStatus.downloading || updateStatus.downloaded}
            >
              {updateStatus.downloading ? 'Скачиваем...' : 'Скачать'}
            </button>
            <button
              type="button"
              className="primary"
              onClick={installUpdate}
              disabled={!updateStatus.downloaded}
            >
              Установить
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
