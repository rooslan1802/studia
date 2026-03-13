const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36';

function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFirst(html, regex) {
  const m = regex.exec(html);
  return m ? cleanText(m[1]) : '';
}

function flattenHtml(html) {
  return cleanText(
    String(html || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(div|p|section|article|h[1-6]|li|tr|td|th)>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  );
}

function extractTextByLabel(text, label, stopLabels = []) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stops = stopLabels
    .map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const regex = stops
    ? new RegExp(`${escapedLabel}\\s*:?\\s*([\\s\\S]*?)(?=\\s*(?:${stops})\\s*:?)`, 'i')
    : new RegExp(`${escapedLabel}\\s*:?\\s*([\\s\\S]+)$`, 'i');
  const match = regex.exec(text);
  return match ? cleanText(match[1]) : '';
}

function extractCsrf(html) {
  return (
    extractFirst(html, /<meta[^>]*name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i) ||
    extractFirst(html, /<input[^>]*name=["']_csrf-frontend["'][^>]*value=["']([^"']+)["']/i)
  );
}

function extractQueueData(html) {
  const text = flattenHtml(html);
  const submittedAt = extractTextByLabel(text, 'Подано', ['Статус', 'Вид очереди', 'Категория очереди', 'Очередность']);
  const category = extractTextByLabel(text, 'Категория очереди', ['Очередность', 'СВЕДЕНИЯ О ЗАЧИСЛЕНИИ', 'Информация не найдена']);
  const status = extractTextByLabel(text, 'Статус', ['Вид очереди', 'Категория очереди', 'Очередность', 'СВЕДЕНИЯ О ЗАЧИСЛЕНИИ']);
  const queuePositionRaw = extractTextByLabel(text, 'Очередность', ['СВЕДЕНИЯ О ЗАЧИСЛЕНИИ', 'Информация не найдена']);
  const queueNumber = extractFirst(queuePositionRaw, /(\d+)\s*(?:из|\/)\s*\d+/i) || extractFirst(queuePositionRaw, /(\d+)/i);

  return {
    queueNumber,
    queueDate: submittedAt,
    queueCategory: category,
    queueStatus: status
  };
}

async function checkQueueByIin(iin) {
  const cleanIin = String(iin || '').replace(/\D/g, '');
  if (!cleanIin) throw new Error('ИИН не указан');

  const pageRes = await fetch('https://qosymsha.kz/ru/request/check/', {
    method: 'GET',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'ru,en;q=0.9'
    }
  });
  const pageHtml = await pageRes.text();
  const csrf = extractCsrf(pageHtml);
  if (!csrf) throw new Error('CSRF token не найден');

  const cookies = pageRes.headers.getSetCookie
    ? pageRes.headers.getSetCookie()
    : (pageRes.headers.get('set-cookie') ? [pageRes.headers.get('set-cookie')] : []);
  const cookieHeader = cookies
    .flatMap((c) => String(c || '').split(/,(?=[^;]+=[^;]+)/))
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
  const body = new URLSearchParams({ '_csrf-frontend': csrf, iin: cleanIin }).toString();

  const checkRes = await fetch(`https://qosymsha.kz/ru/request/check/${cleanIin}`, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'ru,en;q=0.9',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-CSRF-Token': csrf,
      'X-Requested-With': 'XMLHttpRequest',
      Referer: 'https://qosymsha.kz/ru/request/check/',
      ...(cookieHeader ? { Cookie: cookieHeader } : {})
    },
    body
  });

  const html = await checkRes.text();
  if (!html || !/Проверка\s+для\s+ИИН|СВЕДЕНИЯ\s+ОБ\s+ОЧЕРЕДНОСТИ|Очередность/i.test(html)) {
    throw new Error('Очередь не найдена');
  }

  const data = extractQueueData(html);
  if (!data.queueNumber && !data.queueDate && !data.queueCategory) {
    throw new Error('Не удалось распарсить данные очереди');
  }
  return data;
}

module.exports = { checkQueueByIin };
