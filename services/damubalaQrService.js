const QRCode = require('qrcode');

const BASE_URL = 'https://damubala.kz';
const API_URL = `${BASE_URL}/v1`;

function normalizeIin(value) {
  return String(value || '').replace(/\D/g, '').trim();
}

function buildEgovSignLink({ attendanceId, userId, subscriptionIds }) {
  const payload = subscriptionIds.join('-');
  return `mobileSign:${API_URL}/EgovMobile/mgovSign?id=${attendanceId}&egovMobileSignType=1&userId=${userId}&payload=${payload}`;
}

function buildChildLabel(children) {
  const names = children
    .map((child) => `${String(child?.childLastName || '').trim()} ${String(child?.childFirstName || '').trim()}`.trim())
    .filter(Boolean);
  if (!names.length) return 'Ребенок';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} и ${names[1]}`;
  return `${names[0]} и еще ${names.length - 1}`;
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function pickAuth(data) {
  const token = data?.token?.token || data?.token?.accessToken || data?.token;
  const userId = data?.userId;
  if (!token || !userId) return null;
  return { token, userId };
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function apiRequest(path, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${BASE_URL}${path}`, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function signIn(iin, password, timeoutMs) {
  const response = await apiRequest('/v1/Account/SignIn', {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ iin, password })
  }, timeoutMs);
  const data = await readJson(response);
  const auth = pickAuth(data);
  return {
    ok: response.ok,
    status: response.status,
    token: auth?.token || null,
    userId: auth?.userId || null,
    expired: Boolean(data?.expired),
    data
  };
}

function pickAlternatePassword(currentPassword, defaultPassword1, defaultPassword2) {
  const p1 = String(defaultPassword1 || '').trim();
  const p2 = String(defaultPassword2 || '').trim();
  if (!currentPassword) return p1 || p2;
  if (currentPassword === p1) return p2 || p1;
  if (currentPassword === p2) return p1 || p2;
  return p1 || p2;
}

async function updateExpiredPassword(token, currentPassword, newPassword, timeoutMs) {
  const response = await apiRequest('/v1/Account/UpdateUserPassword', {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ currentPassword, newPassword })
  }, timeoutMs);
  return response.ok;
}

async function signInWithFallback({ iin, rowPassword, defaultPassword1, defaultPassword2, timeoutMs }) {
  const tried = new Set();
  const passwords = [rowPassword, defaultPassword1, defaultPassword2]
    .map((value) => String(value || '').trim())
    .filter((value) => {
      if (!value) return false;
      if (tried.has(value)) return false;
      tried.add(value);
      return true;
    });

  for (const password of passwords) {
    const login = await signIn(iin, password, timeoutMs);
    if (!login.ok || !login.token || !login.userId) {
      continue;
    }

    if (login.expired) {
      const alternatePassword = pickAlternatePassword(password, defaultPassword1, defaultPassword2);
      if (!alternatePassword || alternatePassword === password) {
        continue;
      }

      const changed = await updateExpiredPassword(login.token, password, alternatePassword, timeoutMs);
      if (!changed) {
        continue;
      }

      const retry = await signIn(iin, alternatePassword, timeoutMs);
      if (retry.ok && retry.token && retry.userId) {
        return {
          token: retry.token,
          userId: retry.userId,
          passwordUsed: alternatePassword,
          passwordUpdated: true,
          previousPassword: password
        };
      }
      continue;
    }

    return {
      token: login.token,
      userId: login.userId,
      passwordUsed: password,
      passwordUpdated: false
    };
  }

  return null;
}

async function getTimeSheets(authHeaders, timeoutMs) {
  const response = await apiRequest('/v1/timeSheet/Get?PageNumber=1&PageSize=100&hVisitHistoryStatusIds=1', {
    method: 'GET',
    headers: authHeaders
  }, timeoutMs);
  if (!response.ok) return [];
  const data = await readJson(response);
  return Array.isArray(data?.data) ? data.data : [];
}

async function getSignatureDetails(attendanceId, authHeaders, timeoutMs) {
  const response = await apiRequest(`/v1/timeSheet/SignatureDetails/${attendanceId}?userId=`, {
    method: 'GET',
    headers: authHeaders
  }, timeoutMs);
  if (!response.ok) return [];
  const data = await readJson(response);
  return Array.isArray(data) ? data : [];
}

async function verifyBeforeSign(attendanceId, subscriptionIds, authHeaders, timeoutMs) {
  const response = await apiRequest('/v1/timeSheet/ParentVerifyBeforeSign', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ attendanceId, subscriptionIds })
  }, timeoutMs);
  return response.ok;
}

async function generateQrForIin(payload = {}) {
  const iin = normalizeIin(payload.iin);
  const timeoutMs = Number(payload.timeoutMs || 45000);

  if (!iin || iin.length !== 12) {
    return { success: false, code: 'invalid-iin', message: 'Некорректный ИИН' };
  }

  const auth = await signInWithFallback({
    iin,
    rowPassword: payload.rowPassword,
    defaultPassword1: payload.defaultPassword1 || 'Aa123456@',
    defaultPassword2: payload.defaultPassword2 || 'Aa123456!',
    timeoutMs
  });

  if (!auth) {
    return { success: false, code: 'login-failed', message: 'Не удалось войти в аккаунт' };
  }

  const notices = [];
  if (auth.passwordUpdated) {
    notices.push({
      type: 'password-updated',
      iin,
      message: 'Обнаружен устаревший пароль, выполнена смена на запасной пароль.'
    });
  }

  const authHeaders = {
    accept: 'application/json, text/plain, */*',
    authorization: `Bearer ${auth.token}`,
    pragma: 'no-cache',
    'cache-control': 'no-cache',
    'content-type': 'application/json'
  };

  const timeSheets = await getTimeSheets(authHeaders, timeoutMs);
  if (payload.passwordOnly) {
    return {
      success: true,
      iin,
      passwordUsed: auth.passwordUsed,
      passwordUpdated: Boolean(auth.passwordUpdated),
      count: 0,
      items: [],
      notices
    };
  }

  if (!timeSheets.length) {
    return { success: false, code: 'no-timesheets', message: 'Нет табелей на подпись', notices };
  }

  const items = [];

  for (const sheet of timeSheets) {
    const attendanceId = sheet?.id;
    if (!attendanceId) continue;

    const details = await getSignatureDetails(attendanceId, authHeaders, timeoutMs);
    const signableChildren = details.filter((item) => item?.hVisitHistoryStatus?.id === 6 && item?.subscriptionId);
    if (!signableChildren.length) continue;

    const subscriptionIds = signableChildren.map((item) => item.subscriptionId);
    const verifyOk = await verifyBeforeSign(attendanceId, subscriptionIds, authHeaders, timeoutMs);
    if (!verifyOk) continue;

    const qrValue = buildEgovSignLink({
      attendanceId,
      userId: auth.userId,
      subscriptionIds
    });
    const qrDataUrl = await QRCode.toDataURL(qrValue, {
      type: 'image/png',
      margin: 2,
      width: 1024,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    items.push({
      attendanceId,
      childLabel: buildChildLabel(signableChildren),
      children: signableChildren.map((item) => ({
        fullName: `${String(item?.childLastName || '').trim()} ${String(item?.childFirstName || '').trim()}`.trim()
      })),
      qrDataUrl
    });
  }

  if (!items.length) {
    return { success: false, code: 'no-signable', message: 'Не найдено записей для подписания', notices };
  }

  return {
    success: true,
    iin,
    passwordUsed: auth.passwordUsed,
    passwordUpdated: Boolean(auth.passwordUpdated),
    count: items.length,
    items,
    notices
  };
}

async function buildChildQrModal(payload = {}) {
  const childName = String(payload.childName || '').trim();
  const result = await generateQrForIin(payload);
  if (!result?.success) return result;
  if (!Array.isArray(result.items) || !result.items.length) {
    return { success: false, code: 'no-signable', message: 'Не найден QR для отправки' };
  }

  const targetName = normalizeName(childName);
  let matched = result.items[0];
  if (targetName) {
    const byName = result.items.find((item) =>
      (item.children || []).some((child) => normalizeName(child.fullName).includes(targetName) || targetName.includes(normalizeName(child.fullName)))
    );
    if (byName) matched = byName;
  }

  return {
    success: true,
    iin: result.iin,
    passwordUsed: result.passwordUsed,
    passwordUpdated: result.passwordUpdated,
    notices: result.notices || [],
    item: matched
  };
}

module.exports = { generateQrForIin, buildChildQrModal };
