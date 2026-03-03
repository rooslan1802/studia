import React, { useEffect, useMemo, useState } from 'react';
import { api } from '@renderer/api';

const FB_APP_ID = '1332032695618761';
const FB_CONFIG_ID = '1254176560256357';

function loadFacebookSdk() {
  return new Promise((resolve, reject) => {
    if (window.FB) {
      window.FB.init({
        appId: FB_APP_ID,
        cookie: true,
        xfbml: false,
        version: 'v19.0'
      });
      resolve(window.FB);
      return;
    }

    const existing = document.getElementById('facebook-jssdk');
    if (existing) {
      const check = window.setInterval(() => {
        if (window.FB) {
          window.clearInterval(check);
          window.FB.init({
            appId: FB_APP_ID,
            cookie: true,
            xfbml: false,
            version: 'v19.0'
          });
          resolve(window.FB);
        }
      }, 120);
      window.setTimeout(() => {
        window.clearInterval(check);
        if (!window.FB) reject(new Error('Не удалось загрузить Facebook SDK'));
      }, 10000);
      return;
    }

    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.async = true;
    script.defer = true;
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.onload = () => {
      if (!window.FB) {
        reject(new Error('Facebook SDK не инициализирован'));
        return;
      }
      window.FB.init({
        appId: FB_APP_ID,
        cookie: true,
        xfbml: false,
        version: 'v19.0'
      });
      resolve(window.FB);
    };
    script.onerror = () => reject(new Error('Ошибка загрузки Facebook SDK'));
    document.head.appendChild(script);
  });
}

export default function WhatsAppConnectPage() {
  const [studios, setStudios] = useState([]);
  const [studioId, setStudioId] = useState('');
  const [status, setStatus] = useState({ loading: false, data: null, error: '' });
  const [connectError, setConnectError] = useState('');

  const selectedStudio = useMemo(
    () => studios.find((s) => Number(s.id) === Number(studioId)) || null,
    [studios, studioId]
  );

  async function loadStudios() {
    const list = await api.listStudios();
    setStudios(Array.isArray(list) ? list : []);
    if (Array.isArray(list) && list.length && !studioId) {
      setStudioId(String(list[0].id));
    }
  }

  async function loadStatus(targetStudioId) {
    if (!targetStudioId) {
      setStatus({ loading: false, data: null, error: '' });
      return;
    }

    setStatus((prev) => ({ ...prev, loading: true, error: '' }));
    const result = await api.getWhatsAppStatus(Number(targetStudioId));
    if (result?.success) {
      setStatus({ loading: false, data: result.data || { connected: false }, error: '' });
    } else {
      setStatus({ loading: false, data: null, error: result?.error || 'Ошибка чтения статуса' });
    }
  }

  useEffect(() => {
    loadStudios();
  }, []);

  useEffect(() => {
    loadStatus(studioId);
  }, [studioId]);

  async function connectWhatsApp() {
    setConnectError('');
    if (!studioId) {
      setConnectError('Сначала выберите студию');
      return;
    }

    let fb;
    try {
      fb = await loadFacebookSdk();
    } catch (error) {
      setConnectError(error?.message || 'Не удалось загрузить Embedded Signup');
      return;
    }

    const exactRedirectUri = `${window.location.origin}${window.location.pathname}`;

    fb.login((response) => {
      Promise.resolve().then(async () => {
        const code = response?.authResponse?.code;
        if (!code) {
          setConnectError('Подключение отменено или Meta не вернул code');
          return;
        }

        const result = await api.completeWhatsAppSignup({
          studioId: Number(studioId),
          code,
          redirectUri: exactRedirectUri
        });
        if (!result?.success) {
          setConnectError(result?.error || 'Ошибка обмена кода на токен');
          return;
        }

        loadStatus(studioId);
      }).catch((error) => {
        setConnectError(error?.message || 'Ошибка подключения WhatsApp');
      });
    }, {
      config_id: FB_CONFIG_ID,
      response_type: 'code',
      override_default_response_type: true,
      redirect_uri: exactRedirectUri
    });
  }

  return (
    <section>
      <h1 className="page-title">Подключение WhatsApp</h1>
      <p className="page-subtitle">Подключите WhatsApp Business каждой студии через Meta Embedded Signup.</p>

      <div className="panel whatsapp-connect-panel">
        <div className="whatsapp-connect-row">
          <label className="whatsapp-label" htmlFor="wa-connect-studio">Студия</label>
          <select
            id="wa-connect-studio"
            value={studioId}
            onChange={(event) => setStudioId(event.target.value)}
          >
            {!studios.length && <option value="">Нет студий</option>}
            {studios.map((studio) => (
              <option key={studio.id} value={studio.id}>{studio.name}</option>
            ))}
          </select>
        </div>

        <div className="whatsapp-connect-status">
          {status.loading && <span>Загрузка статуса...</span>}
          {!status.loading && status.error && <span className="status-error">{status.error}</span>}
          {!status.loading && !status.error && !status.data?.connected && <span className="status-off">Не подключен</span>}
          {!status.loading && !status.error && status.data?.connected && (
            <div>
              <div className="status-on">Подключен</div>
              <div>Номер: <b>{status.data.phone_number || '—'}</b></div>
              <div className="status-muted">ID номера: {status.data.phone_number_id}</div>
              <div className="status-muted">Бизнес: {status.data.business_name || '—'}</div>
            </div>
          )}
        </div>

        <div className="whatsapp-actions">
          <button type="button" className="primary" onClick={connectWhatsApp} disabled={!selectedStudio}>
            {status.data?.connected ? 'WhatsApp подключен' : 'Подключить WhatsApp'}
          </button>
        </div>

        {connectError ? <div className="whatsapp-status error">{connectError}</div> : null}
      </div>
    </section>
  );
}
