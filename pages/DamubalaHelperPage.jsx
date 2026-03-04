import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@renderer/api';

const QR_SELECTED_MODAL_KEY = 'studia.damubala.qr.selected-modal.v1';
const QR_FULL_MODAL_MAP_KEY = 'studia.damubala.qr.map.v1';
const QR_SELECTED_CHILD_KEY = 'studia.damubala.qr.selected.v1';
const QR_LOGS_KEY = 'studia.damubala.qr.logs.v1';
const QR_STATUS_KEY = 'studia.damubala.qr.status.v1';

function getGlobalDamubalaCache() {
  if (!window.__studiaDamubalaCache) {
    window.__studiaDamubalaCache = {
      qrByChild: {},
      pinnedModal: null,
      logs: []
    };
  }
  return window.__studiaDamubalaCache;
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits;
}

function formatRemaining(ms) {
  if (ms <= 0) return 'истек';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function compareValues(a, b, direction = 'asc') {
  const dir = direction === 'desc' ? -1 : 1;
  const av = a ?? '';
  const bv = b ?? '';
  const an = Number(av);
  const bn = Number(bv);
  if (!Number.isNaN(an) && !Number.isNaN(bn) && String(av).trim() !== '' && String(bv).trim() !== '') {
    return (an - bn) * dir;
  }
  return String(av).localeCompare(String(bv), 'ru', { sensitivity: 'base' }) * dir;
}

export default function DamubalaHelperPage() {
  const [children, setChildren] = useState([]);
  const [sortState, setSortState] = useState({ key: 'childName', direction: 'asc' });
  const [showOnlyUnsigned, setShowOnlyUnsigned] = useState(false);
  const [selectedChildId, setSelectedChildId] = useState(null);
  const [qrByChild, setQrByChild] = useState({});
  const [pinnedModal, setPinnedModal] = useState(null);
  const [selectedForSave, setSelectedForSave] = useState({});
  const [qrStatusByChild, setQrStatusByChild] = useState({});
  const [processing, setProcessing] = useState(false);
  const [processingChildId, setProcessingChildId] = useState(null);
  const [previewLoadingChildId, setPreviewLoadingChildId] = useState(null);
  const [passwordProcessing, setPasswordProcessing] = useState(false);
  const [log, setLog] = useState([]);
  const [qrProgress, setQrProgress] = useState(0);
  const [passwordProgress, setPasswordProgress] = useState(0);
  const [error, setError] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [defaultPassword1, setDefaultPassword1] = useState('Aa123456@');
  const [defaultPassword2, setDefaultPassword2] = useState('Aa123456!');
  const [tick, setTick] = useState(Date.now());
  const qrHydratedRef = useRef(false);
  const logHydratedRef = useRef(false);
  const statusHydratedRef = useRef(false);

  function loadCachedQrMap() {
    try {
      const now = Date.now();
      const fullParsed = JSON.parse(window.localStorage.getItem(QR_FULL_MODAL_MAP_KEY) || '{}');
      const fromFull = fullParsed && typeof fullParsed === 'object' ? fullParsed : {};
      const selectedParsed = JSON.parse(window.localStorage.getItem(QR_SELECTED_MODAL_KEY) || 'null');
      const selectedMap = {};
      const selectedChildId = Number(selectedParsed?.childId || 0);
      const selectedValue = selectedParsed?.value;
      const selectedExpires = new Date(selectedValue?.expiresAt || '').getTime();
      if (selectedChildId && selectedValue?.imageDataUrl && Number.isFinite(selectedExpires) && selectedExpires > now) {
        selectedMap[selectedChildId] = selectedValue;
      }

      const merged = { ...fromFull, ...selectedMap };
      const valid = {};
      Object.entries(merged).forEach(([id, item]) => {
        const expiresAt = new Date(item?.expiresAt || '').getTime();
        if (item?.imageDataUrl && Number.isFinite(expiresAt) && expiresAt > now) {
          valid[Number(id)] = item;
        }
      });
      return valid;
    } catch {
      return {};
    }
  }

  function loadCachedLogs() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(QR_LOGS_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.slice(-120) : [];
    } catch {
      return [];
    }
  }

  function loadCachedStatuses() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(QR_STATUS_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function loadChildren() {
    const list = await api.listChildren({ messageTag: 'qr' });
    const normalized = (Array.isArray(list) ? list : []).map((row) => ({
      ...row,
      parentPhone: normalizePhone(row.parentPhone),
      parentIIN: String(row.parentIIN || '').replace(/\D/g, '')
    }));
    setChildren(normalized);
    const savedSelected = Number(window.localStorage.getItem(QR_SELECTED_CHILD_KEY) || 0);
    const globalCache = getGlobalDamubalaCache();
    const cachedModalMap = {
      ...(globalCache.qrByChild || {}),
      ...loadCachedQrMap()
    };
    const cachedModalChildId = Number(Object.keys(cachedModalMap)[0] || 0);
    if (!selectedChildId && cachedModalChildId && normalized.some((row) => row.id === cachedModalChildId)) {
      setSelectedChildId(cachedModalChildId);
    } else if (!selectedChildId && savedSelected && normalized.some((row) => row.id === savedSelected)) {
      setSelectedChildId(savedSelected);
    } else if (!selectedChildId && normalized[0]?.id) {
      setSelectedChildId(normalized[0].id);
    } else if (selectedChildId && !normalized.some((row) => row.id === selectedChildId)) {
      setSelectedChildId(normalized[0]?.id || null);
    }
  }

  useEffect(() => {
    const globalCache = getGlobalDamubalaCache();
    const cachedModalMap = {
      ...(globalCache.qrByChild || {}),
      ...loadCachedQrMap()
    };
    setQrByChild(cachedModalMap);
    const cachedModalChildId = Number(Object.keys(cachedModalMap)[0] || 0);
    const cachedModalValue = cachedModalChildId ? cachedModalMap[cachedModalChildId] : null;
    if (globalCache.pinnedModal?.value) {
      setPinnedModal(globalCache.pinnedModal);
    } else if (cachedModalValue) {
      setPinnedModal({ childId: cachedModalChildId, value: cachedModalValue });
    }
    setLog(globalCache.logs?.length ? globalCache.logs : loadCachedLogs());
    setQrStatusByChild(loadCachedStatuses());
    qrHydratedRef.current = true;
    logHydratedRef.current = true;
    loadChildren().catch((e) => setError(e?.message || 'Не удалось загрузить детей с пометкой QR'));
  }, []);

  useEffect(() => {
    if (!logHydratedRef.current) return;
    const sliced = (log || []).slice(-120);
    getGlobalDamubalaCache().logs = sliced;
    window.localStorage.setItem(QR_LOGS_KEY, JSON.stringify(sliced));
  }, [log]);

  useEffect(() => {
    const globalCache = getGlobalDamubalaCache();
    globalCache.qrByChild = { ...(qrByChild || {}) };
    try {
      window.localStorage.setItem(QR_FULL_MODAL_MAP_KEY, JSON.stringify(globalCache.qrByChild || {}));
    } catch {
      // ignore quota and keep runtime cache
    }
  }, [qrByChild]);

  useEffect(() => {
    getGlobalDamubalaCache().pinnedModal = pinnedModal || null;
  }, [pinnedModal]);

  useEffect(() => {
    if (!statusHydratedRef.current) {
      statusHydratedRef.current = true;
      return;
    }
    window.localStorage.setItem(QR_STATUS_KEY, JSON.stringify(qrStatusByChild || {}));
  }, [qrStatusByChild]);

  useEffect(() => {
    if (!selectedChildId) return;
    window.localStorage.setItem(QR_SELECTED_CHILD_KEY, String(selectedChildId));
  }, [selectedChildId]);

  const sortedChildren = useMemo(() => {
    const rows = [...children];
    rows.sort((a, b) => compareValues(a[sortState.key], b[sortState.key], sortState.direction));
    return rows;
  }, [children, sortState]);
  const visibleChildren = useMemo(
    () => (showOnlyUnsigned ? sortedChildren.filter((row) => qrStatusByChild[row.id] === 'has-qr') : sortedChildren),
    [showOnlyUnsigned, sortedChildren, qrStatusByChild]
  );

  useEffect(() => {
    if (!showOnlyUnsigned) return;
    if (selectedChildId && visibleChildren.some((row) => row.id === selectedChildId)) return;
    setSelectedChildId(visibleChildren[0]?.id || null);
  }, [showOnlyUnsigned, selectedChildId, visibleChildren]);

  const selectedChild = useMemo(
    () => sortedChildren.find((row) => row.id === selectedChildId) || null,
    [sortedChildren, selectedChildId]
  );

  const selectedQr = selectedChild ? qrByChild[selectedChild.id] : null;
  const displayModal = selectedChild
    ? (selectedQr ? { childId: selectedChild?.id, value: selectedQr } : null)
    : pinnedModal;
  const displayQr = displayModal?.value || null;
  const displayChild = selectedChild || sortedChildren.find((row) => row.id === displayModal?.childId) || null;
  const remainingMs = displayQr?.expiresAt ? new Date(displayQr.expiresAt).getTime() - tick : 0;
  const hasQrCount = sortedChildren.filter((row) => qrStatusByChild[row.id] === 'has-qr').length;
  const noQrCount = sortedChildren.filter((row) => qrStatusByChild[row.id] === 'no-qr').length;

  useEffect(() => {
    if (!qrHydratedRef.current) return;
    if (!selectedChildId || !selectedQr) return;
    setPinnedModal({ childId: selectedChildId, value: selectedQr });
    window.localStorage.setItem(QR_SELECTED_MODAL_KEY, JSON.stringify({
      childId: selectedChildId,
      value: selectedQr
    }));
  }, [selectedChildId, selectedQr]);

  function toggleSort(key) {
    setSortState((prev) => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));
  }

  function sortArrow(key) {
    if (sortState.key !== key) return '⇅';
    return sortState.direction === 'asc' ? '↑' : '↓';
  }

  async function ensurePreviewForChild(row) {
    if (!row || qrByChild[row.id]?.imageDataUrl) return;
    if (qrStatusByChild[row.id] !== 'has-qr') return;
    if (!row.parentIIN || String(row.parentIIN || '').length !== 12) return;
    try {
      setPreviewLoadingChildId(row.id);
      const modal = await api.buildDamubalaChildModal({
        iin: row.parentIIN,
        childName: row.childName,
        defaultPassword1,
        defaultPassword2
      });
      if (modal?.success && modal?.modalImageDataUrl) {
        const value = {
          imageDataUrl: modal.modalImageDataUrl,
          qrDataUrl: modal?.item?.qrDataUrl || '',
          generatedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          parentIIN: row.parentIIN,
          parentPhone: row.parentPhone
        };
        setQrByChild((prev) => ({ ...prev, [row.id]: value }));
        setPinnedModal({ childId: row.id, value });
      }
    } catch {
      // ignore preview warm-up errors
    } finally {
      setPreviewLoadingChildId(null);
    }
  }

  async function refreshPasswordsForList() {
    if (!sortedChildren.length || passwordProcessing || processing) return;
    setPasswordProcessing(true);
    setPasswordProgress(6);
    setError('');
    setLog((prev) => [...prev, `Старт обновления паролей: ${new Date().toLocaleString()}`]);

    const uniqueParents = Array.from(
      new Map(
        sortedChildren
          .filter((row) => row.parentIIN && row.parentIIN.length === 12)
          .map((row) => [row.parentIIN, row])
      ).values()
    );

    let success = 0;
    let failed = 0;
    for (let idx = 0; idx < uniqueParents.length; idx += 1) {
      const parent = uniqueParents[idx];
      const result = await api.refreshDamubalaPassword({
        iin: parent.parentIIN,
        defaultPassword1,
        defaultPassword2
      });
      if (result?.success) {
        success += 1;
        setLog((prev) => [...prev, `Пароль проверен: ${parent.childName}`]);
      } else {
        failed += 1;
        setLog((prev) => [...prev, `Ошибка пароля: ${parent.childName} — ${result?.message || 'не удалось'}`]);
      }
      setPasswordProgress(Math.min(100, Math.round(((idx + 1) / Math.max(1, uniqueParents.length)) * 100)));
    }

    setPasswordProcessing(false);
    setPasswordProgress(100);
    setLog((prev) => [...prev, `Итого: успешно ${success}, ошибок ${failed}`]);
    window.setTimeout(() => setPasswordProgress(0), 700);
  }

  async function refreshQrForList(forceAll = false) {
    if (!sortedChildren.length || processing || passwordProcessing) return;
    setProcessing(true);
    setProcessingChildId(null);
    setQrProgress(6);
    setError('');
    setLog((prev) => [...prev, `${forceAll ? 'Старт полной проверки QR' : 'Старт обновления QR'}: ${new Date().toLocaleString()}`]);
    const targetChildren = forceAll
      ? sortedChildren
      : sortedChildren.filter((row) => qrStatusByChild[row.id] !== 'no-qr');

    let success = 0;
    let failed = 0;

    for (let idx = 0; idx < targetChildren.length; idx += 1) {
      const child = targetChildren[idx];
      setProcessingChildId(child.id);
      setSelectedChildId(child.id);
      const cachedForChild = qrByChild[child.id];
      if (cachedForChild?.imageDataUrl) {
        setPinnedModal({ childId: child.id, value: cachedForChild });
      }
      if (!child.parentIIN || child.parentIIN.length !== 12) {
        failed += 1;
        setLog((prev) => [...prev, `Ошибка QR: ${child.childName} — нет валидного ИИН родителя`]);
        setQrStatusByChild((prev) => ({ ...prev, [child.id]: 'no-qr' }));
        setQrProgress(Math.min(100, Math.round(((idx + 1) / Math.max(1, targetChildren.length)) * 100)));
        continue;
      }

      const modal = await api.buildDamubalaChildModal({
        iin: child.parentIIN,
        childName: child.childName,
        defaultPassword1,
        defaultPassword2
      });

      if (modal?.success && modal?.modalImageDataUrl) {
        success += 1;
        const value = {
          imageDataUrl: modal.modalImageDataUrl,
          qrDataUrl: modal?.item?.qrDataUrl || '',
          generatedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          parentIIN: child.parentIIN,
          parentPhone: child.parentPhone
        };
        setQrByChild((prev) => ({ ...prev, [child.id]: value }));
        setPinnedModal({ childId: child.id, value });
        window.localStorage.setItem(QR_SELECTED_MODAL_KEY, JSON.stringify({ childId: child.id, value }));
        setQrStatusByChild((prev) => ({ ...prev, [child.id]: 'has-qr' }));
        setLog((prev) => [...prev, `QR обновлен: ${child.childName}`]);
      } else {
        failed += 1;
        setQrStatusByChild((prev) => ({ ...prev, [child.id]: 'no-qr' }));
        setLog((prev) => [...prev, `Ошибка QR: ${child.childName} — ${modal?.message || 'не удалось'}`]);
      }
      setQrProgress(Math.min(100, Math.round(((idx + 1) / Math.max(1, targetChildren.length)) * 100)));
    }

    if (!selectedChildId && sortedChildren[0]?.id) setSelectedChildId(sortedChildren[0].id);
    setProcessing(false);
    setProcessingChildId(null);
    setQrProgress(100);
    setLog((prev) => [...prev, `Итого: QR обновлен ${success}, ошибок ${failed}`]);
    window.setTimeout(() => setQrProgress(0), 700);
  }

  function toggleSelectedForSave(childId, checked) {
    setSelectedForSave((prev) => ({ ...prev, [childId]: checked }));
  }

  function selectAllForSave(checked) {
    const eligible = visibleChildren.filter((row) => qrStatusByChild[row.id] === 'has-qr');
    setSelectedForSave(Object.fromEntries(eligible.map((row) => [row.id, checked])));
  }

  async function saveSelectedQrImages() {
    const selectedRows = visibleChildren.filter((row) => !!selectedForSave[row.id]);
    if (!selectedRows.length) {
      setError('Выберите детей для сохранения QR.');
      return;
    }
    const files = selectedRows
      .map((row) => {
        const qr = qrByChild[row.id];
        if (!qr?.imageDataUrl) return null;
        return {
          name: row.childName || `child-${row.id}`,
          childLabel: row.childName || '',
          qrDataUrl: qr.imageDataUrl
        };
      })
      .filter(Boolean);
    if (!files.length) {
      setError('Для выбранных детей еще нет QR.');
      return;
    }

    const dir = await api.pickDamubalaSaveDir();
    if (!dir?.success || !dir?.directoryPath) return;
    const saveRes = await api.saveDamubalaImages({
      directoryPath: dir.directoryPath,
      files
    });
    if (saveRes?.success) {
      setLog((prev) => [...prev, `Сохранено QR: ${saveRes.savedCount || 0}`]);
      setError('');
    } else {
      setError(saveRes?.message || 'Не удалось сохранить изображения QR.');
    }
  }

  return (
    <section>
      <h1 className="page-title">Дамубала помощник</h1>
      <p className="page-subtitle">Список детей с пометкой QR. Выберите ребенка и подпишите табель через QR.</p>
      {error ? <p style={{ color: '#ff7d91' }}>{error}</p> : null}

      <div className="panel damubala-controls">
        {(processing || passwordProcessing || qrProgress > 0 || passwordProgress > 0) && (
          <div className="damubala-progress-panel" style={{ marginBottom: 10 }}>
            {!!passwordProgress && (
              <>
                <div className="damubala-progress-head">
                  <span>Обновление паролей</span>
                  <b>{Math.round(passwordProgress)}%</b>
                </div>
                <div className="damubala-progress-track">
                  <div className={`damubala-progress-fill ${passwordProcessing ? 'active' : ''}`} style={{ width: `${passwordProgress}%` }} />
                </div>
              </>
            )}
            {!!qrProgress && (
              <>
                <div className="damubala-progress-head" style={{ marginTop: 8 }}>
                  <span>Обновление QR</span>
                  <b>{Math.round(qrProgress)}%</b>
                </div>
                <div className="damubala-progress-track">
                  <div className={`damubala-progress-fill ${processing ? 'active' : ''}`} style={{ width: `${qrProgress}%` }} />
                </div>
              </>
            )}
          </div>
        )}
        <div className="damubala-upload-row">
          <button type="button" onClick={() => setShowPasswords((v) => !v)}>Пароль</button>
          <button type="button" onClick={refreshPasswordsForList} disabled={passwordProcessing || processing || !sortedChildren.length}>
            {passwordProcessing ? 'Обновление паролей...' : 'Обновить пароли у списка детей'}
          </button>
          <button type="button" className="primary" onClick={refreshQrForList} disabled={processing || passwordProcessing || !sortedChildren.length}>
            {processing ? 'Обновление QR...' : 'Обновить QR'}
          </button>
          <button
            type="button"
            onClick={() => refreshQrForList(true)}
            disabled={processing || passwordProcessing || !sortedChildren.length}
          >
            Проверить все QR
          </button>
          <button type="button" onClick={() => selectAllForSave(true)}>Выбрать всех QR</button>
          <button type="button" onClick={() => selectAllForSave(false)}>Снять выбор QR</button>
          <button type="button" onClick={() => setShowOnlyUnsigned((prev) => !prev)} className={showOnlyUnsigned ? 'primary' : ''}>
            {showOnlyUnsigned ? 'Показать всех' : 'Оставить неподписанные'}
          </button>
          <button type="button" className="primary" onClick={saveSelectedQrImages}>Сохранить выборочно QR</button>
        </div>

        {showPasswords && (
          <div className="damubala-password-grid" style={{ marginTop: 12 }}>
            <label>
              <div className="damubala-label">Основной пароль</div>
              <input type="text" value={defaultPassword1} onChange={(event) => setDefaultPassword1(event.target.value)} />
            </label>
            <label>
              <div className="damubala-label">Запасной пароль</div>
              <input type="text" value={defaultPassword2} onChange={(event) => setDefaultPassword2(event.target.value)} />
            </label>
          </div>
        )}
      </div>

      <div className="damubala-layout">
        <div className="panel damubala-list-panel">
          <div className="damubala-list-title">Список детей с пометкой QR</div>
          <div className="panel" style={{ marginTop: 10, padding: 0, overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>✓</th>
                  <th>Статус QR</th>
                  <th><button type="button" className="th-sort-btn" onClick={() => toggleSort('childName')}>ФИО ребенка {sortArrow('childName')}</button></th>
                  <th><button type="button" className="th-sort-btn" onClick={() => toggleSort('childAge')}>Возраст {sortArrow('childAge')}</button></th>
                  <th><button type="button" className="th-sort-btn" onClick={() => toggleSort('cityName')}>Город {sortArrow('cityName')}</button></th>
                  <th><button type="button" className="th-sort-btn" onClick={() => toggleSort('studioName')}>Студия {sortArrow('studioName')}</button></th>
                  <th><button type="button" className="th-sort-btn" onClick={() => toggleSort('courseName')}>Кружок {sortArrow('courseName')}</button></th>
                </tr>
              </thead>
              <tbody>
                {visibleChildren.map((row) => (
                  <tr
                    key={row.id}
                    className={`child-row${processingChildId === row.id ? ' damubala-row-processing' : ''}`}
                    style={{ cursor: 'pointer', background: row.id === selectedChildId ? 'rgba(72, 178, 255, 0.08)' : undefined }}
                    onClick={async () => {
                      setSelectedChildId(row.id);
                      const rowQr = qrByChild[row.id];
                      if (rowQr?.imageDataUrl) {
                        setPinnedModal({ childId: row.id, value: rowQr });
                      } else {
                        await ensurePreviewForChild(row);
                      }
                    }}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={!!selectedForSave[row.id]}
                        disabled={qrStatusByChild[row.id] !== 'has-qr'}
                        onChange={(e) => toggleSelectedForSave(row.id, e.target.checked)}
                      />
                    </td>
                    <td>
                      {processingChildId === row.id ? (
                        <span className="badge info">Обработка...</span>
                      ) : qrStatusByChild[row.id] === 'has-qr' ? (
                        <span className="badge ok">QR есть</span>
                      ) : qrStatusByChild[row.id] === 'no-qr' ? (
                        <span className="badge danger">QR нет</span>
                      ) : (
                        <span className="badge info">Не проверен</span>
                      )}
                    </td>
                    <td>{row.childName}</td>
                    <td>{row.childAge ?? '—'}</td>
                    <td>{row.cityName || '—'}</td>
                    <td>{row.studioName || '—'}</td>
                    <td>{row.courseName || '—'}</td>
                  </tr>
                ))}
                {!visibleChildren.length && <tr><td colSpan={7}>Нет детей по текущему фильтру</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel damubala-preview-panel">
          <div className="damubala-list-title">QR модалка</div>
          {!displayQr?.imageDataUrl ? (
            <div className="damubala-empty">
              {selectedChild
                ? (previewLoadingChildId === selectedChild.id ? 'Загружаем QR выбранного ребенка...' : 'Для выбранного ребенка QR пока нет. Обновите QR.')
                : 'Нажмите «Обновить QR», чтобы получить актуальную QR модалку.'}
            </div>
          ) : (
            <div className="damubala-preview-card">
              <img
                src={displayQr.imageDataUrl}
                alt="Damubala QR modal"
                className={`damubala-qr-image${processing && processingChildId === (displayChild?.id || displayModal?.childId) ? ' updating' : ''}`}
              />
              {processing && processingChildId === (displayChild?.id || displayModal?.childId) ? <div className="damubala-updating-chip">Обновляем QR...</div> : null}
              <div className="damubala-preview-meta">
                <b>{displayChild?.childName || 'Выбранный ребенок'}</b>
                <span>ИИН родителя: {displayQr.parentIIN || '—'}</span>
                <span>Телефон: {displayQr.parentPhone || '—'}</span>
                <span style={{ opacity: 0.74, fontSize: 12 }}>QR действует: {formatRemaining(remainingMs)}</span>
              </div>
            </div>
          )}
          {!!log.length && (
            <div className="panel" style={{ marginTop: 12, maxHeight: 220, overflow: 'auto' }}>
              {log.map((line, index) => (
                <div key={`${line}-${index}`} style={{ fontSize: 13, marginBottom: 4 }}>{line}</div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 8, color: '#9cb5d3', fontSize: 13 }}>
            Итого: QR есть — <b style={{ color: '#6be28c' }}>{hasQrCount}</b>, QR нет — <b style={{ color: '#ff7b93' }}>{noQrCount}</b>, всего — {sortedChildren.length}, показано — {visibleChildren.length}
          </div>
        </div>
      </div>
    </section>
  );
}
