import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@renderer/api';

const BACKEND_URLS = ['http://localhost:47831', 'http://127.0.0.1:47831'];
const QR_STATUS_KEY = 'studia.damubala.qr.status.v1';
const WHATSAPP_LOGS_KEY = 'studia.whatsapp.logs.v1';

function getGlobalWhatsAppLogsCache() {
  if (!window.__studiaWhatsAppLogsCache) {
    window.__studiaWhatsAppLogsCache = [];
  }
  return window.__studiaWhatsAppLogsCache;
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits;
}

function monthIso(offset = 0) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function monthTitle(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchBackendJson(path, init) {
  let lastError = null;
  for (const baseUrl of BACKEND_URLS) {
    try {
      const response = await fetch(`${baseUrl}${path}`, init);
      const data = await response.json();
      return { ok: response.ok, data };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Failed to fetch');
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

function loadQrStatusMap() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(QR_STATUS_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function qrStatusText(value) {
  if (value === 'has-qr') return 'QR есть';
  if (value === 'no-qr') return 'QR нет';
  return 'Не проверен';
}

function loadCachedWhatsAppLogs() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WHATSAPP_LOGS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(-300) : [];
  } catch {
    return [];
  }
}

export default function WhatsAppPage() {
  const [status, setStatus] = useState({ connected: false, connecting: false, error: '' });
  const [showStatusPanel, setShowStatusPanel] = useState(false);
  const [qrCode, setQrCode] = useState('');
  const [loadingQr, setLoadingQr] = useState(false);

  const [mode, setMode] = useState('paid');
  const [monthOffset, setMonthOffset] = useState(0);
  const [allPayments, setAllPayments] = useState([]);
  const [allChildren, setAllChildren] = useState([]);
  const [qrStatusMap, setQrStatusMap] = useState({});

  const [paidMessage, setPaidMessage] = useState('Здравствуйте! Подошло время оплаты.');
  const [qrMessage, setQrMessage] = useState('Здравствуйте! Подпишите, пожалуйста, табель.');
  const [reminderMessage, setReminderMessage] = useState('Здравствуйте! Напоминание по ребенку.');

  const [intervalSec, setIntervalSec] = useState(35);
  const [selectedPaid, setSelectedPaid] = useState({});
  const [selectedQr, setSelectedQr] = useState({});
  const [selectedReminder, setSelectedReminder] = useState({});

  const [sending, setSending] = useState(false);
  const [result, setResult] = useState('');
  const [progress, setProgress] = useState({ total: 0, sent: 0, failed: 0, current: '' });
  const [log, setLog] = useState([]);
  const logsHydratedRef = useRef(false);

  const [paidSort, setPaidSort] = useState({ key: 'childFullName', direction: 'asc' });
  const [qrSort, setQrSort] = useState({ key: 'childFullName', direction: 'asc' });
  const [reminderSort, setReminderSort] = useState({ key: 'childFullName', direction: 'asc' });

  const selectedMonth = useMemo(() => monthIso(monthOffset), [monthOffset]);

  const paidRecipients = useMemo(
    () => allPayments
      .filter((x) => x.paymentState === 'unpaid' && String(x.billingMonth || '').slice(0, 7) === selectedMonth)
      .map((x) => ({
        id: `paid-${x.childId}`,
        childId: x.childId,
        childFullName: x.childFullName,
        parentFullName: x.parentFullName || '—',
        parentPhone: normalizePhone(x.parentPhone),
        reason: x.reason || ''
      }))
      .filter((x) => x.parentPhone),
    [allPayments, selectedMonth]
  );

  const qrRecipients = useMemo(
    () => allChildren
      .filter((x) => String(x.messageTag || '').trim().toLowerCase() === 'qr')
      .map((x) => ({
        id: `qr-${x.id}`,
        childId: x.id,
        childFullName: x.childName,
        childAge: x.childAge,
        cityName: x.cityName,
        studioName: x.studioName,
        courseName: x.courseName,
        parentPhone: normalizePhone(x.parentPhone),
        parentIIN: String(x.parentIIN || '').replace(/\D/g, ''),
        qrStatus: qrStatusMap[x.id] || ''
      }))
      .filter((x) => x.parentPhone && x.qrStatus === 'has-qr'),
    [allChildren, qrStatusMap]
  );

  const reminderRecipients = useMemo(
    () => allChildren
      .filter((x) => String(x.messageTag || '').trim().toLowerCase() === 'reminder')
      .map((x) => ({
        id: `rem-${x.id}`,
        childId: x.id,
        childFullName: x.childName,
        childAge: x.childAge,
        cityName: x.cityName,
        studioName: x.studioName,
        courseName: x.courseName,
        parentPhone: normalizePhone(x.parentPhone)
      }))
      .filter((x) => x.parentPhone),
    [allChildren]
  );

  const paidRows = useMemo(() => {
    const rows = [...paidRecipients];
    rows.sort((a, b) => compareValues(a[paidSort.key], b[paidSort.key], paidSort.direction));
    return rows;
  }, [paidRecipients, paidSort]);

  const qrRows = useMemo(() => {
    const rows = [...qrRecipients];
    rows.sort((a, b) => compareValues(a[qrSort.key], b[qrSort.key], qrSort.direction));
    return rows;
  }, [qrRecipients, qrSort]);

  const reminderRows = useMemo(() => {
    const rows = [...reminderRecipients];
    rows.sort((a, b) => compareValues(a[reminderSort.key], b[reminderSort.key], reminderSort.direction));
    return rows;
  }, [reminderRecipients, reminderSort]);

  const selectedPaidRecipients = useMemo(() => paidRows.filter((x) => selectedPaid[x.id]), [paidRows, selectedPaid]);
  const selectedQrRecipients = useMemo(() => qrRows.filter((x) => selectedQr[x.id]), [qrRows, selectedQr]);
  const selectedReminderRecipients = useMemo(() => reminderRows.filter((x) => selectedReminder[x.id]), [reminderRows, selectedReminder]);

  async function loadStatus() {
    try {
      const { data } = await fetchBackendJson('/api/whatsapp/status');
      setStatus({
        connected: !!data?.connected,
        connecting: !!data?.connecting,
        error: data?.error || ''
      });
      if (data?.connected) setQrCode('');
    } catch (error) {
      setStatus((prev) => ({ ...prev, error: error?.message || 'Ошибка проверки статуса' }));
    }
  }

  async function loadQr() {
    if (status.connected) return;
    setLoadingQr(true);
    try {
      const { ok, data } = await fetchBackendJson('/api/whatsapp/qr');
      if (ok && data?.qr) {
        setQrCode(data.qr);
      } else if (!ok) {
        setResult(data?.error || 'Не удалось получить QR');
      }
    } catch (error) {
      setResult(error?.message || 'Ошибка подключения');
    } finally {
      setLoadingQr(false);
    }
  }

  async function loadRecipients() {
    const [payments, children] = await Promise.all([
      api.listPayments({}),
      api.listChildren({})
    ]);
    setAllPayments(Array.isArray(payments) ? payments : []);
    setAllChildren(Array.isArray(children) ? children : []);
    setQrStatusMap(loadQrStatusMap());
  }

  useEffect(() => {
    loadStatus();
    loadRecipients();
    const runtimeLogs = getGlobalWhatsAppLogsCache();
    setLog(runtimeLogs.length ? runtimeLogs : loadCachedWhatsAppLogs());
    logsHydratedRef.current = true;
    const timer = window.setInterval(loadStatus, 3000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!logsHydratedRef.current) return;
    const sliced = (log || []).slice(-300);
    window.__studiaWhatsAppLogsCache = sliced;
    window.localStorage.setItem(WHATSAPP_LOGS_KEY, JSON.stringify(sliced));
  }, [log]);

  useEffect(() => {
    setSelectedPaid((prev) => {
      const next = {};
      paidRows.forEach((item) => { next[item.id] = prev[item.id] ?? true; });
      return next;
    });
  }, [paidRows]);

  useEffect(() => {
    setSelectedQr((prev) => {
      const next = {};
      qrRows.forEach((item) => { next[item.id] = prev[item.id] ?? true; });
      return next;
    });
  }, [qrRows]);

  useEffect(() => {
    setSelectedReminder((prev) => {
      const next = {};
      reminderRows.forEach((item) => { next[item.id] = prev[item.id] ?? true; });
      return next;
    });
  }, [reminderRows]);

  async function toggleStatusPanel() {
    const next = !showStatusPanel;
    setShowStatusPanel(next);
    if (next && !status.connected && !qrCode) {
      await loadQr();
    }
  }

  async function sendRows(rows, renderMessage, modeName) {
    if (sending) return;
    if (!status.connected) {
      setResult('WhatsApp не подключен. Откройте Статус и подключите через QR.');
      return;
    }
    if (!rows.length) {
      setResult('Выберите получателей для отправки.');
      return;
    }

    setResult('');
    setLog((prev) => [...prev, `--- Старт рассылки (${modeName}) ${new Date().toLocaleString()} ---`]);
    setSending(true);
    setProgress({ total: rows.length, sent: 0, failed: 0, current: '' });

    let sent = 0;
    let failed = 0;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      setProgress((prev) => ({ ...prev, current: `${row.childFullName} (${row.parentPhone})` }));

      try {
        const payload = await renderMessage(row);
        const { ok, data } = await fetchBackendJson('/api/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: row.parentPhone, ...payload })
        });
        if (!ok || !data?.success) {
          failed += 1;
          setLog((prev) => [...prev, `Ошибка: ${row.childFullName} — ${data?.error || 'Ошибка отправки'}`]);
        } else {
          sent += 1;
          setLog((prev) => [...prev, `Отправлено (${modeName}): ${row.childFullName} (${row.parentPhone})`]);
        }
      } catch (error) {
        failed += 1;
        setLog((prev) => [...prev, `Ошибка: ${row.childFullName} — ${error?.message || 'Failed to fetch'}`]);
      }

      setProgress((prev) => ({ ...prev, sent, failed }));
      if (index < rows.length - 1) {
        const delayMs = Math.max(1, Number(intervalSec || 0)) * 1000;
        await sleep(delayMs);
      }
    }

    setProgress((prev) => ({ ...prev, current: '' }));
    setSending(false);
    await loadRecipients();
    setResult(`Готово. Отправлено: ${sent}, ошибок: ${failed}`);
  }

  async function sendPaidBulk() {
    const text = (paidMessage || '').trim();
    if (!text) {
      setResult('Введите текст сообщения для платников.');
      return;
    }
    await sendRows(selectedPaidRecipients, async () => ({ text }), 'платники');
  }

  async function sendReminderBulk() {
    const text = (reminderMessage || '').trim();
    if (!text) {
      setResult('Введите текст сообщения для вкладки Напоминание.');
      return;
    }
    await sendRows(selectedReminderRecipients, async () => ({ text }), 'напоминание');
  }

  async function sendQrBulk() {
    if (sending) return;
    if (!status.connected) {
      setResult('WhatsApp не подключен. Откройте Статус и подключите через QR.');
      return;
    }
    if (!selectedQrRecipients.length) {
      setResult('Выберите получателей для отправки.');
      return;
    }

    const text = (qrMessage || '').trim();
    if (!text) {
      setResult('Введите текст сообщения для вкладки QR.');
      return;
    }

    setResult('');
    setLog((prev) => [...prev, `--- Старт рассылки (QR) ${new Date().toLocaleString()} ---`]);
    setSending(true);
    setProgress({ total: selectedQrRecipients.length, sent: 0, failed: 0, current: '' });

    let sent = 0;
    let failed = 0;

    for (let index = 0; index < selectedQrRecipients.length; index += 1) {
      const row = selectedQrRecipients[index];
      setProgress((prev) => ({ ...prev, current: `${row.childFullName} (${row.parentPhone})` }));

      try {
        if (!row.parentIIN || row.parentIIN.length !== 12) {
          throw new Error('Нет валидного ИИН родителя для генерации QR');
        }

        const modal = await api.buildDamubalaChildModal({
          iin: row.parentIIN,
          childName: row.childFullName,
          defaultPassword1: 'Aa123456@',
          defaultPassword2: 'Aa123456!'
        });

        if (!modal?.success || !modal?.modalImageDataUrl) {
          throw new Error(modal?.message || 'Не удалось подготовить QR модалку');
        }

        const { ok, data } = await fetchBackendJson('/api/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: row.parentPhone,
            text,
            imageDataUrl: modal.modalImageDataUrl
          })
        });

        if (!ok || !data?.success) {
          throw new Error(data?.error || 'Ошибка отправки');
        }

        sent += 1;
        setLog((prev) => [...prev, `Отправлено (QR): ${row.childFullName} (${row.parentPhone})`]);
      } catch (error) {
        failed += 1;
        setLog((prev) => [...prev, `Ошибка (QR): ${row.childFullName} — ${error?.message || 'Failed to fetch'}`]);
      }

      setProgress((prev) => ({ ...prev, sent, failed }));
      if (index < selectedQrRecipients.length - 1) {
        const delayMs = Math.max(1, Number(intervalSec || 0)) * 1000;
        await sleep(delayMs);
      }
    }

    setProgress((prev) => ({ ...prev, current: '' }));
    setSending(false);
    await loadRecipients();
    setResult(`Готово. Отправлено: ${sent}, ошибок: ${failed}`);
  }

  function togglePaidSort(key) {
    setPaidSort((prev) => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));
  }

  function toggleQrSort(key) {
    setQrSort((prev) => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));
  }

  function toggleReminderSort(key) {
    setReminderSort((prev) => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));
  }

  function sortArrow(sortState, key) {
    if (sortState.key !== key) return '⇅';
    return sortState.direction === 'asc' ? '↑' : '↓';
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <h1 className="page-title">WhatsApp</h1>
          <p className="page-subtitle" style={{ marginBottom: 0 }}>Рассылка: платники, QR для подписи и отдельная вкладка Напоминание.</p>
        </div>
        <button type="button" className="primary" onClick={toggleStatusPanel}>
          {status.connected ? 'Статус: подключен' : 'Статус: не подключено'}
        </button>
      </div>

      {showStatusPanel && (
        <div className="panel whatsapp-connect-panel" style={{ marginTop: 16 }}>
          <div className="whatsapp-connect-status">
            {status.connected ? <span className="status-on">WhatsApp подключен</span> : <span className="status-off">Не подключен</span>}
            {status.error ? <div className="status-error">{status.error}</div> : null}
          </div>

          {!status.connected && (
            <div className="whatsapp-connect-row">
              <div className="status-muted">Сканируйте QR через WhatsApp → Связанные устройства</div>
              {loadingQr && !qrCode ? <div className="whatsapp-spinner" /> : null}
              {qrCode ? <img src={qrCode} alt="WhatsApp QR" className="whatsapp-qr" /> : null}
              <div className="whatsapp-actions">
                <button type="button" onClick={loadQr}>Обновить QR</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="children-list-tabs" style={{ marginTop: 16 }}>
        <button className={mode === 'paid' ? 'tab-active' : ''} onClick={() => setMode('paid')}>Платники</button>
        <button className={mode === 'qr' ? 'tab-active' : ''} onClick={() => setMode('qr')}>QR для подписи</button>
        <button className={mode === 'reminder' ? 'tab-active' : ''} onClick={() => setMode('reminder')}>Напоминание</button>
      </div>

      {mode === 'paid' && (
        <div className="panel" style={{ marginTop: 16 }}>
          <p className="page-subtitle" style={{ marginBottom: 12 }}>Рассылка напоминаний об оплате.</p>
          <div className="toolbar payment-toolbar">
            <button onClick={() => setMonthOffset((v) => v - 1)}>←</button>
            <div className="month-chip">{monthTitle(selectedMonth)}</div>
            <button onClick={() => setMonthOffset((v) => v + 1)}>→</button>
          </div>

          <div className="form-grid">
            <label className="full">
              <div style={{ marginBottom: 6, color: '#97a7c3' }}>Сообщение (ручной ввод)</div>
              <textarea rows={3} value={paidMessage} onChange={(e) => setPaidMessage(e.target.value)} />
            </label>
          </div>

          <div className="row-actions" style={{ marginTop: 12 }}>
            <button type="button" onClick={() => setSelectedPaid(Object.fromEntries(paidRows.map((x) => [x.id, true])))}>Выбрать всех</button>
            <button type="button" onClick={() => setSelectedPaid(Object.fromEntries(paidRows.map((x) => [x.id, false])))}>Снять всех</button>
            <button type="button" className="primary" disabled={sending || !selectedPaidRecipients.length} onClick={sendPaidBulk}>
              {sending ? 'Отправка...' : `Отправить (${selectedPaidRecipients.length})`}
            </button>
          </div>

          <div className="panel" style={{ marginTop: 12, padding: 0, overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Выбор</th>
                  <th><button type="button" className="th-sort-btn" onClick={() => togglePaidSort('childFullName')}>Ребенок {sortArrow(paidSort, 'childFullName')}</button></th>
                  <th><button type="button" className="th-sort-btn" onClick={() => togglePaidSort('parentFullName')}>Родитель {sortArrow(paidSort, 'parentFullName')}</button></th>
                  <th><button type="button" className="th-sort-btn" onClick={() => togglePaidSort('parentPhone')}>Телефон {sortArrow(paidSort, 'parentPhone')}</button></th>
                  <th><button type="button" className="th-sort-btn" onClick={() => togglePaidSort('reason')}>Причина {sortArrow(paidSort, 'reason')}</button></th>
                </tr>
              </thead>
              <tbody>
                {paidRows.map((row) => (
                  <tr key={row.id}>
                    <td><input type="checkbox" checked={!!selectedPaid[row.id]} onChange={(e) => setSelectedPaid((prev) => ({ ...prev, [row.id]: e.target.checked }))} /></td>
                    <td>{row.childFullName}</td>
                    <td>{row.parentFullName}</td>
                    <td>{row.parentPhone}</td>
                    <td>{row.reason}</td>
                  </tr>
                ))}
                {!paidRows.length && <tr><td colSpan={5}>Нет получателей за выбранный месяц</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mode === 'qr' && (
        <div className="panel" style={{ marginTop: 16 }}>
          <p className="page-subtitle" style={{ marginBottom: 12 }}>Список только тех детей, у кого уже есть QR для подписи.</p>
          <div className="form-grid">
            <label className="full">
              <div style={{ marginBottom: 6, color: '#97a7c3' }}>Сообщение (ручной ввод)</div>
              <textarea rows={3} value={qrMessage} onChange={(e) => setQrMessage(e.target.value)} />
            </label>
          </div>

          <div className="row-actions" style={{ marginTop: 12 }}>
            <button type="button" onClick={() => setSelectedQr(Object.fromEntries(qrRows.map((x) => [x.id, true])))}>Выбрать всех</button>
            <button type="button" onClick={() => setSelectedQr(Object.fromEntries(qrRows.map((x) => [x.id, false])))}>Снять всех</button>
            <button type="button" className="primary" disabled={sending || !selectedQrRecipients.length} onClick={sendQrBulk}>
              {sending ? 'Отправка...' : `Отправить (${selectedQrRecipients.length})`}
            </button>
          </div>

          <div className="panel" style={{ marginTop: 12, padding: 0, overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Выбор</th>
                  <th><button type="button" className="th-sort-btn" onClick={() => toggleQrSort('childFullName')}>Ребенок {sortArrow(qrSort, 'childFullName')}</button></th>
                  <th><button type="button" className="th-sort-btn" onClick={() => toggleQrSort('childAge')}>Возраст {sortArrow(qrSort, 'childAge')}</button></th>
                  <th><button type="button" className="th-sort-btn" onClick={() => toggleQrSort('cityName')}>Город {sortArrow(qrSort, 'cityName')}</button></th>
                  <th><button type="button" className="th-sort-btn" onClick={() => toggleQrSort('studioName')}>Студия {sortArrow(qrSort, 'studioName')}</button></th>
                  <th><button type="button" className="th-sort-btn" onClick={() => toggleQrSort('courseName')}>Кружок {sortArrow(qrSort, 'courseName')}</button></th>
                  <th><button type="button" className="th-sort-btn" onClick={() => toggleQrSort('parentPhone')}>Телефон {sortArrow(qrSort, 'parentPhone')}</button></th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {qrRows.map((row) => (
                  <tr key={row.id}>
                    <td><input type="checkbox" checked={!!selectedQr[row.id]} onChange={(e) => setSelectedQr((prev) => ({ ...prev, [row.id]: e.target.checked }))} /></td>
                    <td>{row.childFullName}</td>
                    <td>{row.childAge ?? '—'}</td>
                    <td>{row.cityName || '—'}</td>
                    <td>{row.studioName || '—'}</td>
                    <td>{row.courseName || '—'}</td>
                    <td>{row.parentPhone}</td>
                    <td>{qrStatusText(row.qrStatus)}</td>
                  </tr>
                ))}
                {!qrRows.length && <tr><td colSpan={8}>Нет детей с готовым QR</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mode === 'reminder' && (
        <div className="panel" style={{ marginTop: 16 }}>
          <p className="page-subtitle" style={{ marginBottom: 12 }}>Отдельная рассылка для детей с пометкой Напоминание.</p>
          <div className="form-grid">
            <label className="full">
              <div style={{ marginBottom: 6, color: '#97a7c3' }}>Сообщение (ручной ввод)</div>
              <textarea rows={3} value={reminderMessage} onChange={(e) => setReminderMessage(e.target.value)} />
            </label>
          </div>

          <div className="row-actions" style={{ marginTop: 12 }}>
            <button type="button" onClick={() => setSelectedReminder(Object.fromEntries(reminderRows.map((x) => [x.id, true])))}>Выбрать всех</button>
            <button type="button" onClick={() => setSelectedReminder(Object.fromEntries(reminderRows.map((x) => [x.id, false])))}>Снять всех</button>
            <button type="button" className="primary" disabled={sending || !selectedReminderRecipients.length} onClick={sendReminderBulk}>
              {sending ? 'Отправка...' : `Отправить (${selectedReminderRecipients.length})`}
            </button>
          </div>

          <div className="panel" style={{ marginTop: 12, padding: 0, overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Выбор</th>
                  <th><button type="button" className="th-sort-btn" onClick={() => toggleReminderSort('childFullName')}>Ребенок {sortArrow(reminderSort, 'childFullName')}</button></th>
                  <th><button type="button" className="th-sort-btn" onClick={() => toggleReminderSort('childAge')}>Возраст {sortArrow(reminderSort, 'childAge')}</button></th>
                  <th><button type="button" className="th-sort-btn" onClick={() => toggleReminderSort('cityName')}>Город {sortArrow(reminderSort, 'cityName')}</button></th>
                  <th><button type="button" className="th-sort-btn" onClick={() => toggleReminderSort('studioName')}>Студия {sortArrow(reminderSort, 'studioName')}</button></th>
                  <th><button type="button" className="th-sort-btn" onClick={() => toggleReminderSort('courseName')}>Кружок {sortArrow(reminderSort, 'courseName')}</button></th>
                  <th><button type="button" className="th-sort-btn" onClick={() => toggleReminderSort('parentPhone')}>Телефон {sortArrow(reminderSort, 'parentPhone')}</button></th>
                </tr>
              </thead>
              <tbody>
                {reminderRows.map((row) => (
                  <tr key={row.id}>
                    <td><input type="checkbox" checked={!!selectedReminder[row.id]} onChange={(e) => setSelectedReminder((prev) => ({ ...prev, [row.id]: e.target.checked }))} /></td>
                    <td>{row.childFullName}</td>
                    <td>{row.childAge ?? '—'}</td>
                    <td>{row.cityName || '—'}</td>
                    <td>{row.studioName || '—'}</td>
                    <td>{row.courseName || '—'}</td>
                    <td>{row.parentPhone}</td>
                  </tr>
                ))}
                {!reminderRows.length && <tr><td colSpan={7}>Нет детей с пометкой Напоминание</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="form-grid">
          <label>
            <div style={{ marginBottom: 6, color: '#97a7c3' }}>Пауза между отправками (сек)</div>
            <input type="number" min="1" value={intervalSec} onChange={(e) => setIntervalSec(e.target.value)} />
          </label>
        </div>

        {!!progress.total && (
          <div className="whatsapp-connect-status" style={{ marginTop: 12 }}>
            <div>Прогресс: {progress.sent + progress.failed} / {progress.total}</div>
            <div className="status-on">Успешно: {progress.sent}</div>
            <div className="status-error">Ошибок: {progress.failed}</div>
            {progress.current ? <div className="status-muted">Текущий: {progress.current}</div> : null}
          </div>
        )}

        {result ? (
          <div className={`whatsapp-status ${result.includes('ошиб') || result.includes('Ошибка') ? 'error' : 'success'}`}>
            {result}
          </div>
        ) : null}

        {!!log.length && (
          <div className="panel" style={{ marginTop: 12, maxHeight: 220, overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => {
                  setLog([]);
                  window.localStorage.removeItem(WHATSAPP_LOGS_KEY);
                }}
              >
                Очистить логи
              </button>
            </div>
            {log.map((line, index) => (
              <div key={`${line}-${index}`} style={{ fontSize: 13, marginBottom: 4 }}>{line}</div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
