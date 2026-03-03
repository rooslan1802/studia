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

function extractCsrf(html) {
  return (
    extractFirst(html, /<meta[^>]*name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i) ||
    extractFirst(html, /<input[^>]*name=["']_csrf-frontend["'][^>]*value=["']([^"']+)["']/i)
  );
}

function extractQueueData(html) {
  const queueNumberRaw = extractFirst(
    html,
    /class=["'][^"']*check-voucher-row__number[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i
  );
  const queueNumber = queueNumberRaw.replace('#', '').trim();

  const statementBlockMatch = /class=["'][^"']*voucher-box--statement[^"']*["'][^>]*>([\s\S]*?)<\/section>/i.exec(html);
  const statementBlock = statementBlockMatch ? statementBlockMatch[1] : html;
  const submittedAt = extractFirst(statementBlock, /<p[^>]*>[\s\S]*?Подано([\s\S]*?)<\/p>/i);

  const category = extractFirst(
    html,
    /class=["'][^"']*enrollment-bar--violet[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i
  );

  return {
    queueNumber,
    queueDate: submittedAt,
    queueCategory: category
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
  if (!html || !html.includes('check-voucher-row')) {
    throw new Error('Очередь не найдена');
  }

  const data = extractQueueData(html);
  if (!data.queueNumber && !data.queueDate && !data.queueCategory) {
    throw new Error('Не удалось распарсить данные очереди');
  }
  return data;
}

module.exports = { checkQueueByIin };
