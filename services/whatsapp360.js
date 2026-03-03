function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

async function sendWhatsAppMessage(phone, text, apiKey) {
  const to = normalizePhone(phone);
  const body = String(text || '').trim();
  const key = String(apiKey || '').trim();

  if (!key) throw new Error('Неверный API key');
  if (!to) throw new Error('Укажите номер телефона');
  if (!body) throw new Error('Введите текст сообщения');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch('https://waba-v2.360dialog.io/messages', {
      method: 'POST',
      headers: {
        'D360-API-KEY': key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: {
          body
        }
      }),
      signal: controller.signal
    });

    const rawText = await response.text();
    let data = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (error) {
      data = {};
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Неправильный API key');
      }
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

module.exports = { sendWhatsAppMessage };
