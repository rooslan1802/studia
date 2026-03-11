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
  const [updateState, setUpdateState] = useState({
    checking: false,
    available: false,
    downloaded: false,
    downloading: false,
    version: '',
    latestVersion: '',
    progressPercent: 0,
    message: ''
  });
  const [updateBusy, setUpdateBusy] = useState(false);

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
    let unsubscribe = () => {};
    api.getUpdateStatus?.().then((state) => {
      if (state) setUpdateState((prev) => ({ ...prev, ...state }));
    }).catch(() => {});
    if (api.onUpdateState) {
      unsubscribe = api.onUpdateState((state) => {
        setUpdateState((prev) => ({ ...prev, ...(state || {}) }));
      });
    }
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
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

  async function handleCheckUpdates() {
    setUpdateBusy(true);
    setError('');
    setInfo('');
    try {
      const state = await api.checkForUpdates();
      if (state) setUpdateState((prev) => ({ ...prev, ...state }));
    } catch (e) {
      setError(e?.message || 'Не удалось проверить обновления.');
    } finally {
      setUpdateBusy(false);
    }
  }

  async function handleDownloadUpdate() {
    setUpdateBusy(true);
    setError('');
    try {
      const state = await api.downloadUpdate();
      if (state) setUpdateState((prev) => ({ ...prev, ...state }));
    } catch (e) {
      setError(e?.message || 'Не удалось скачать обновление.');
    } finally {
      setUpdateBusy(false);
    }
  }

  async function handleInstallUpdate() {
    setUpdateBusy(true);
    setError('');
    try {
      await api.installUpdate();
    } catch (e) {
      setError(e?.message || 'Не удалось установить обновление.');
    } finally {
      setUpdateBusy(false);
    }
  }

  return (
    <section>
      <h1 className="page-title">Настройки</h1>
      <p className="page-subtitle">Глобальные циклы оплат и отдельные правила для нужных кружков.</p>

      <div className="panel">
        {loading ? (
          <div style={{ color: '#97a7c3' }}>Загрузка...</div>
        ) : (
          <>
            <div className="panel" style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>Обновления приложения</div>
              <div className="form-grid">
                <label>
                  <div style={{ marginBottom: 6, color: '#97a7c3' }}>Текущая версия</div>
                  <input value={updateState.version || '—'} readOnly />
                </label>
                <label>
                  <div style={{ marginBottom: 6, color: '#97a7c3' }}>Доступная версия</div>
                  <input value={updateState.latestVersion || '—'} readOnly />
                </label>
              </div>
              <div style={{ color: '#97a7c3', marginTop: 10 }}>
                {updateState.message || 'Проверка обновлений через GitHub Releases.'}
              </div>
              {updateState.downloading && (
                <div style={{ marginTop: 10, color: '#73e7d5' }}>
                  Скачивание: {Math.round(Number(updateState.progressPercent || 0))}%
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                <button type="button" onClick={handleCheckUpdates} disabled={updateBusy || updateState.checking}>
                  {updateState.checking ? 'Проверяем...' : 'Проверить обновления'}
                </button>
                {updateState.available && !updateState.downloaded && (
                  <button type="button" className="primary" onClick={handleDownloadUpdate} disabled={updateBusy || updateState.downloading}>
                    {updateState.downloading ? 'Скачивание...' : 'Скачать обновление'}
                  </button>
                )}
                {updateState.downloaded && (
                  <button type="button" className="primary" onClick={handleInstallUpdate} disabled={updateBusy}>
                    Установить обновление
                  </button>
                )}
              </div>
            </div>

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
    </section>
  );
}
