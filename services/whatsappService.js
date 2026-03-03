const repository = require('./repository');

const DEFAULT_USER_ID = 'local-user';

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function getTestPhone(explicitPhone) {
  const fromPayload = normalizePhone(explicitPhone);
  if (fromPayload) return fromPayload;

  const fromEnv = normalizePhone(process.env.WHATSAPP_TEST_PHONE || '');
  return fromEnv;
}

async function post360Dialog({ apiKey, phone, text }) {
  const key = String(apiKey || '').trim();
  const to = normalizePhone(phone);
  const bodyText = String(text || '').trim();

  if (!key) throw new Error('Неправильный API key');
  if (!to) throw new Error('Укажите номер телефона');
  if (!bodyText) throw new Error('Введите текст сообщения');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch('https://waba-v2.360dialog.io/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: {
          body: bodyText
        }
      }),
      signal: controller.signal
    });

    const raw = await response.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (error) {
      data = {};
    }

    if (!response.ok) {
      const details = data?.message || data?.error?.message || `Ошибка отправки (${response.status})`;
      throw new Error(details);
    }

    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Сервис 360dialog не ответил вовремя');
    }
    throw new Error(error?.message || 'Ошибка отправки');
  } finally {
    clearTimeout(timeout);
  }
}

function getStatus(userId = DEFAULT_USER_ID) {
  const cfg = repository.getUserWhatsAppConfig(userId);
  if (!cfg) {
    return {
      connected: false,
      whatsappPhoneId: '',
      hasApiKey: false
    };
  }

  return {
    connected: true,
    whatsappPhoneId: cfg.whatsappPhoneId || '',
    hasApiKey: !!cfg.whatsappApiKey
  };
}

async function sendTestMessage({ apiKey, testPhone }) {
  const phone = getTestPhone(testPhone);
  if (!phone) {
    throw new Error('Укажите тестовый номер телефона');
  }

  return post360Dialog({
    apiKey,
    phone,
    text: 'Тест подключения WhatsApp'
  });
}

async function saveConfig({ userId = DEFAULT_USER_ID, whatsappApiKey, whatsappPhoneId, testPhone }) {
  const apiKey = String(whatsappApiKey || '').trim();
  const phoneId = String(whatsappPhoneId || '').trim();

  if (!apiKey) throw new Error('Укажите API KEY');
  if (!phoneId) throw new Error('Укажите WhatsApp Number ID');

  await sendTestMessage({ apiKey, testPhone });

  repository.saveUserWhatsAppConfig({
    userId,
    whatsappApiKey: apiKey,
    whatsappPhoneId: phoneId
  });

  return getStatus(userId);
}

async function sendMessage({ userId = DEFAULT_USER_ID, phone, message }) {
  const cfg = repository.getUserWhatsAppConfig(userId);
  if (!cfg) throw new Error('WhatsApp не подключен');

  return post360Dialog({
    apiKey: cfg.whatsappApiKey,
    phone,
    text: message
  });
}

module.exports = {
  saveConfig,
  sendTestMessage,
  getStatus,
  sendMessage
};
