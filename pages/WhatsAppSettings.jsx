import React, { useEffect, useMemo, useState } from 'react';

const BACKEND_URLS = ['http://localhost:47831', 'http://127.0.0.1:47831'];

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

export default function WhatsAppSettings() {
  const [status, setStatus] = useState({ connected: false, connecting: false, error: '' });
  const [qrCode, setQrCode] = useState('');
  const [loadingQr, setLoadingQr] = useState(false);
  const [result, setResult] = useState('');
  const [phone, setPhone] = useState('');
  const [text, setText] = useState('Тестовое сообщение из приложения');

  async function loadStatus() {
    try {
      const { data } = await fetchBackendJson('/api/whatsapp/status');
      setStatus({
        connected: !!data?.connected,
        connecting: !!data?.connecting,
        error: data?.error || ''
      });
      if (data?.connected) {
        setQrCode('');
      }
    } catch (error) {
      setStatus((prev) => ({ ...prev, error: error?.message || 'Ошибка проверки статуса' }));
    }
  }

  async function loadQr() {
    if (status.connected) return;
    try {
      const { ok, data } = await fetchBackendJson('/api/whatsapp/qr');
      if (ok && data?.qr) {
        setQrCode(data.qr);
      }
    } catch (error) {
      // keep silent here; status polling shows connection errors
    }
  }

  useEffect(() => {
    loadStatus();
    loadQr();
    const poll = window.setInterval(() => {
      loadStatus();
      loadQr();
    }, 2500);
    return () => window.clearInterval(poll);
  }, [status.connected]);

  const connectButtonLabel = useMemo(() => {
    if (status.connected) return 'WhatsApp подключен';
    if (loadingQr || status.connecting) return 'Подключение...';
    return 'Подключить WhatsApp';
  }, [loadingQr, status.connected, status.connecting]);

  async function connectWhatsApp() {
    setResult('');
    setLoadingQr(true);
    try {
      const { ok, data } = await fetchBackendJson('/api/whatsapp/qr');
      if (!ok) {
        setResult(data?.error || 'Не удалось получить QR');
      } else {
        setQrCode(data?.qr || '');
        if (!data?.qr) {
          setResult('QR генерируется, подождите 2-5 секунд');
        }
      }
      await loadStatus();
    } catch (error) {
      setResult(error?.message || 'Ошибка подключения');
    } finally {
      setLoadingQr(false);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    setResult('');
    try {
      const { ok, data } = await fetchBackendJson('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, text })
      });
      if (!ok || !data?.success) {
        setResult(data?.error || 'Ошибка отправки');
        return;
      }
      setResult('Сообщение отправлено');
    } catch (error) {
      setResult(error?.message || 'Ошибка отправки');
    }
  }

  return (
    <section>
      <h1 className="page-title">Подключение WhatsApp</h1>
      <p className="page-subtitle">Бесплатное подключение через WhatsApp Web (Baileys).</p>

      <div className="panel whatsapp-connect-panel">
        <div className="whatsapp-connect-status">
          {status.connected ? (
            <span className="status-on">WhatsApp подключен</span>
          ) : (
            <span className="status-off">Не подключен</span>
          )}
          {status.error ? <div className="status-error">{status.error}</div> : null}
        </div>

        <div className="whatsapp-actions">
          <button
            type="button"
            className="primary"
            onClick={connectWhatsApp}
            disabled={status.connected || loadingQr || status.connecting}
          >
            {connectButtonLabel}
          </button>
        </div>

        {!status.connected ? (
          <div className="whatsapp-connect-row">
            <div className="status-muted">Сканируйте QR через WhatsApp → Связанные устройства</div>
            {loadingQr && !qrCode ? <div className="whatsapp-spinner" /> : null}
            {qrCode ? <img src={qrCode} alt="WhatsApp QR" className="whatsapp-qr" /> : null}
          </div>
        ) : null}

        <form className="whatsapp-form" onSubmit={sendMessage}>
          <label className="whatsapp-label" htmlFor="wa-phone-send">Номер телефона</label>
          <input
            id="wa-phone-send"
            type="tel"
            placeholder="77001234567"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            required
          />

          <label className="whatsapp-label" htmlFor="wa-text-send">Текст сообщения</label>
          <textarea
            id="wa-text-send"
            rows={4}
            value={text}
            onChange={(event) => setText(event.target.value)}
            required
          />

          <div className="whatsapp-actions">
            <button type="submit" className="primary" disabled={!status.connected}>
              Отправить сообщение
            </button>
          </div>
        </form>

        {result ? (
          <div className={`whatsapp-status ${result.includes('ошиб') || result.includes('Ошибка') ? 'error' : 'success'}`}>
            {result}
          </div>
        ) : null}
      </div>
    </section>
  );
}
