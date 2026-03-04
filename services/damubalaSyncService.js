const { BrowserWindow } = require('electron');

const DAMUBALA_URL = 'https://damubala.kz';
const API_BASE = `${DAMUBALA_URL}/v1`;
const PAGE_SIZE = 100;
const BATCH_SIZE = 6;
const TIMESHEET_PAGE_SIZE = 50;
const SIGNATURE_CONCURRENCY = 6;
let LAST_AUTH_TOKEN = '';
let LAST_CONNECTED_AT = '';
let LAST_SIGNING_STATS = {
  available: false,
  totalSigned: 0,
  totalUnsigned: 0,
  byApplication: [],
  updatedAt: ''
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function toIsoDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return '';
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayIso() {
  const dt = new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function childFullName(child) {
  return `${child?.lastName || ''} ${child?.firstName || ''} ${child?.middleName || ''}`.replace(/\s+/g, ' ').trim();
}

function pickBestToken(candidates = []) {
  const uniq = [...new Set(candidates.filter(Boolean))];
  if (!uniq.length) return '';

  function decodePayload(token) {
    try {
      const parts = String(token || '').split('.');
      if (parts.length < 2) return {};
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    } catch {
      return {};
    }
  }

  function score(token) {
    const payload = decodePayload(token);
    const nowSec = Math.floor(Date.now() / 1000);
    const exp = Number(payload.exp || 0);
    const roleClaim = payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'];
    const roles = Array.isArray(roleClaim) ? roleClaim : (typeof roleClaim === 'string' ? [roleClaim] : []);
    const upper = roles.map((x) => String(x || '').toUpperCase());
    const hasSupplier = upper.includes('SUPPLIER');
    const supplierOnly = hasSupplier && upper.length === 1;
    return (supplierOnly ? 2_000_000_000 : (hasSupplier ? 1_000_000_000 : 0)) + Math.max(0, exp - nowSec);
  }

  uniq.sort((a, b) => score(b) - score(a));
  return uniq[0] || '';
}

async function extractAuthTokenCandidatesFromWindow(authWindow) {
  if (!authWindow || authWindow.isDestroyed()) return [];

  try {
    const token = await authWindow.webContents.executeJavaScript(`(() => {
      const jwtRe = /eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g;
      const storages = [window.localStorage, window.sessionStorage];
      const candidates = [];

      function collectFrom(value) {
        if (typeof value !== 'string') return;
        const hits = value.match(jwtRe);
        if (hits?.length) candidates.push(...hits);
      }

      for (const store of storages) {
        for (let i = 0; i < store.length; i += 1) {
          const key = store.key(i);
          if (!key) continue;
          const value = store.getItem(key);
          if (!value) continue;
          collectFrom(value);
          try {
            const parsed = JSON.parse(value);
            const stack = [parsed];
            while (stack.length) {
              const item = stack.pop();
              if (!item || typeof item !== 'object') continue;
              for (const val of Object.values(item)) {
                if (typeof val === 'string') collectFrom(val);
                else if (val && typeof val === 'object') stack.push(val);
              }
            }
          } catch {
            // non-json storage value
          }
        }
      }

      const uniq = [...new Set(candidates)];
      return uniq;
    })()`, true);

    if (!Array.isArray(token)) return [];
    const uniq = [...new Set(token.filter(Boolean))];
    const best = pickBestToken(uniq);
    if (!best) return uniq;
    return [best, ...uniq.filter((x) => x !== best)];
  } catch {
    return [];
  }
}

async function waitForAuthToken(authWindow, timeoutMs = 5 * 60 * 1000) {
  const startedAt = Date.now();
  const badTokens = new Set();

  while (Date.now() - startedAt < timeoutMs) {
    if (!authWindow || authWindow.isDestroyed()) {
      throw new Error('Окно авторизации закрыто. Синхронизация отменена.');
    }

    const tokens = await extractAuthTokenCandidatesFromWindow(authWindow);
    if (tokens.length) {
      for (const token of tokens) {
        if (!token || badTokens.has(token)) continue;
        try {
          await fetchJsonWithToken(token, 'timeSheet/Get', {
            PageNumber: 1,
            PageSize: 1,
            childIIN: '',
            month: new Date().getMonth() + 1,
            year: new Date().getFullYear()
          });
          return token;
        } catch {
          badTokens.add(token);
        }
      }
    }
    await delay(1200);
  }

  throw new Error('Не удалось подтвердить вход в Damubala. Перезайдите и попробуйте снова.');
}

async function ensureDamubalaLoginWithWindow() {
  const authWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:damubala-sync'
    }
  });

  try {
    const ses = authWindow.webContents.session;
    await ses.clearStorageData();
    await ses.clearCache();
    await authWindow.loadURL(DAMUBALA_URL);
    const token = await waitForAuthToken(authWindow);
    LAST_AUTH_TOKEN = token;
    LAST_CONNECTED_AT = new Date().toISOString();
    if (!authWindow.isDestroyed()) authWindow.hide();
    return token;
  } finally {
    if (!authWindow.isDestroyed()) authWindow.destroy();
  }
}

async function fetchJsonWithToken(token, endpoint, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = qs ? `${API_BASE}/${endpoint}?${qs}` : `${API_BASE}/${endpoint}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json, text/plain, */*',
      authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Damubala API вернул ошибку ${response.status}.`);
  }

  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function getApplicationIds(token) {
  const payload = await fetchJsonWithToken(token, 'Course/GetToSubscriptions', { type: 2 });
  if (!Array.isArray(payload)) return [];
  return payload
    .map((item) => {
      const applicationId = Number(item?.applicationId || item?.id || 0);
      if (!applicationId) return null;
      return {
        applicationId,
        applicationName: String(item?.nameRu || item?.name || item?.applicationName || item?.applicationNumber || `Заявка ${applicationId}`),
        cityName: String(item?.hRegion?.nameRu || item?.regionNameRu || item?.regionName || item?.cityName || '').trim(),
        studioName: String(item?.organization?.nameRu || item?.organizationNameRu || item?.organizationName || item?.nameRu || '').trim(),
        courseName: String(item?.hCourseDirection?.nameRu || item?.courseDirectionNameRu || item?.courseName || '').trim()
      };
    })
    .filter(Boolean);
}

async function getActiveVouchersByApplication(token, application) {
  const applicationId = Number(application?.applicationId || 0);
  if (!applicationId) return [];
  const out = [];
  let page = 1;

  while (true) {
    const payload = await fetchJsonWithToken(token, 'Subscription/Get', {
      applicationId,
      hSubscriptionStatusId: 3,
      PageNumber: page,
      PageSize: PAGE_SIZE
    });

    const rows = Array.isArray(payload?.data) ? payload.data : [];
    if (!rows.length) break;

    out.push(...rows.map((row) => ({ ...row, __applicationMeta: application })));
    const total = Number(payload?.count || out.length);
    if (out.length >= total) break;
    page += 1;
  }

  return out;
}

async function getAllActiveVouchers(token) {
  const applications = await getApplicationIds(token);
  if (!applications.length) return [];

  const all = [];
  for (let i = 0; i < applications.length; i += BATCH_SIZE) {
    const batch = applications.slice(i, i + BATCH_SIZE);
    const chunk = await Promise.all(batch.map((app) => getActiveVouchersByApplication(token, app)));
    chunk.forEach((rows) => all.push(...rows));
  }

  return all;
}

function normalizeVoucher(voucher) {
  const child = voucher?.child || {};
  const parent = voucher?.parent || {};
  const appMeta = voucher?.__applicationMeta || {};
  const course = voucher?.class?.course || {};
  const direction = course?.hCourseDirection || {};
  const organization = course?.organization || {};

  const enrollmentDate = toIsoDate(voucher?.activationDt) || todayIso();
  const voucherEndDate = toIsoDate(voucher?.expiresDt) || enrollmentDate;
  const childIIN = digitsOnly(child?.iin || '');

  return {
    applicationId: Number(voucher?.applicationId || 0),
    applicationName: String(appMeta.applicationName || `Заявка ${voucher?.applicationId || ''}`).trim(),
    cityName: String(appMeta.cityName || voucher?.hRegion?.nameRu || '').trim(),
    studioName: String(appMeta.studioName || organization?.nameRu || '').trim(),
    courseName: String(appMeta.courseName || direction?.nameRu || '').trim(),
    childFullName: childFullName(child),
    childIIN: /^\d{12}$/.test(childIIN) ? childIIN : '',
    childBirthDate: toIsoDate(child?.birthDate),
    parentFullName: String(parent?.fullName || '').trim(),
    parentPhone: String(parent?.phoneNumber || '').trim(),
    parentIIN: digitsOnly(parent?.iin || ''),
    parentEmail: String(parent?.email || '').trim(),
    voucherNumber: String(voucher?.subscriptionNumber || voucher?.id || 'DAMUBALA').trim() || 'DAMUBALA',
    enrollmentDate,
    voucherEndDate
  };
}

function buildPreview(appItems) {
  const map = new Map();
  appItems.forEach((item) => {
    const appId = Number(item.applicationId || 0);
    if (!appId) return;
    if (!map.has(appId)) {
      map.set(appId, {
        applicationId: appId,
        applicationName: item.applicationName || `Заявка ${appId}`,
        courseName: item.courseName || 'Без кружка',
        cityName: item.cityName || 'Без города',
        studioName: item.studioName || 'Без студии',
        childrenCount: 0,
        childNames: []
      });
    }
    const entry = map.get(appId);
    entry.childrenCount += 1;
    if (entry.childNames.length < 6 && item.childFullName) {
      entry.childNames.push(item.childFullName);
    }
  });
  return [...map.values()].sort((a, b) => a.applicationId - b.applicationId);
}

async function asyncPool(limit, items, iterator) {
  const ret = [];
  const executing = [];
  for (const item of items) {
    const p = Promise.resolve().then(() => iterator(item));
    ret.push(p);
    if (limit <= items.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(ret);
}

async function fetchTimesheetsByMonth(token, month, year) {
  let page = 1;
  const all = [];
  while (true) {
    const payload = await fetchJsonWithToken(token, 'timeSheet/Get', {
      PageNumber: page,
      PageSize: TIMESHEET_PAGE_SIZE,
      childIIN: '',
      month,
      year
    });
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    if (!rows.length) break;
    all.push(...rows);
    const total = Number(payload?.count || all.length);
    if ((page * TIMESHEET_PAGE_SIZE) >= total) break;
    page += 1;
  }
  return all;
}

async function fetchTimesheetsByMonthWithStatus(token, month, year, statusId) {
  let page = 1;
  const all = [];
  while (true) {
    const payload = await fetchJsonWithToken(token, 'timeSheet/Get', {
      PageNumber: page,
      PageSize: TIMESHEET_PAGE_SIZE,
      childIIN: '',
      month,
      year,
      hVisitHistoryStatusIds: statusId
    });
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    if (!rows.length) break;
    all.push(...rows);
    const total = Number(payload?.count || all.length);
    if ((page * TIMESHEET_PAGE_SIZE) >= total) break;
    page += 1;
  }
  return all;
}

async function getTimesheetsInApproval(token) {
  const now = new Date();
  const thisMonth = { month: now.getMonth() + 1, year: now.getFullYear() };
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = { month: prev.getMonth() + 1, year: prev.getFullYear() };

  const [currentRows, previousRows] = await Promise.all([
    fetchTimesheetsByMonth(token, thisMonth.month, thisMonth.year),
    fetchTimesheetsByMonth(token, prevMonth.month, prevMonth.year)
  ]);

  const unique = new Map();
  [...currentRows, ...previousRows].forEach((row) => {
    const id = Number(row?.id || 0);
    if (!id) return;
    if (!unique.has(id)) unique.set(id, row);
  });
  return [...unique.values()];
}

async function getUnsignedTimesheets(token) {
  const now = new Date();
  const thisMonth = { month: now.getMonth() + 1, year: now.getFullYear() };
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = { month: prev.getMonth() + 1, year: prev.getFullYear() };

  const [currentRows, previousRows] = await Promise.all([
    fetchTimesheetsByMonthWithStatus(token, thisMonth.month, thisMonth.year, 1),
    fetchTimesheetsByMonthWithStatus(token, prevMonth.month, prevMonth.year, 1)
  ]);

  const unique = new Map();
  [...currentRows, ...previousRows].forEach((row) => {
    const id = Number(row?.id || 0);
    if (!id) return;
    if (!unique.has(id)) unique.set(id, row);
  });
  return [...unique.values()];
}

function rowKey(applicationId, courseName) {
  return `${Number(applicationId || 0)}:${String(courseName || 'Без кружка').trim() || 'Без кружка'}`;
}

function mergeRowsByApplication(rows = []) {
  const grouped = new Map();
  rows.forEach((row) => {
    const appId = Number(row?.applicationId || 0);
    const courseName = String(row?.courseName || 'Без кружка').trim() || 'Без кружка';
    const key = rowKey(appId, courseName);
    if (!grouped.has(key)) {
      grouped.set(key, {
        applicationId: appId,
        courseName,
        signedCount: 0,
        unsignedCount: 0
      });
    }
    const current = grouped.get(key);
    current.signedCount += Number(row?.signedCount || 0);
    current.unsignedCount += Number(row?.unsignedCount || 0);
  });
  return [...grouped.values()];
}

function normalizeHistory(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.result)) return raw.result;
  return [];
}

function monthParamsNowAndPrev() {
  const now = new Date();
  const thisMonth = { month: now.getMonth() + 1, year: now.getFullYear() };
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = { month: prev.getMonth() + 1, year: prev.getFullYear() };
  return { thisMonth, prevMonth };
}

async function ensureValidTokenForSigningStats() {
  const { thisMonth } = monthParamsNowAndPrev();

  async function probe(token) {
    await fetchJsonWithToken(token, 'timeSheet/Get', {
      PageNumber: 1,
      PageSize: 1,
      childIIN: '',
      month: thisMonth.month,
      year: thisMonth.year
    });
  }

  if (LAST_AUTH_TOKEN) {
    try {
      await probe(LAST_AUTH_TOKEN);
      return LAST_AUTH_TOKEN;
    } catch {
      LAST_AUTH_TOKEN = '';
    }
  }

  const token = await ensureDamubalaLoginWithWindow();
  await probe(token);
  return token;
}

async function getDamubalaSigningStats() {
  try {
    const token = await ensureValidTokenForSigningStats();
    const { thisMonth, prevMonth } = monthParamsNowAndPrev();
    const [currentRows, previousRows] = await Promise.all([
      fetchTimesheetsByMonth(token, thisMonth.month, thisMonth.year),
      fetchTimesheetsByMonth(token, prevMonth.month, prevMonth.year)
    ]);
    const uniqueSheets = new Map();
    [...currentRows, ...previousRows].forEach((row) => {
      const id = Number(row?.id || 0);
      if (!id) return;
      if (!uniqueSheets.has(id)) uniqueSheets.set(id, row);
    });

    const sheets = [...uniqueSheets.values()];
    if (!sheets.length) {
      LAST_SIGNING_STATS = {
        available: true,
        totalSigned: 0,
        totalUnsigned: 0,
        byApplication: [],
        updatedAt: new Date().toISOString()
      };
      return LAST_SIGNING_STATS;
    }

    const rows = [];
    await asyncPool(SIGNATURE_CONCURRENCY, sheets, async (sheet) => {
      const attendanceId = Number(sheet?.id || 0);
      if (!attendanceId) return;
      const detailsRaw = await fetchJsonWithToken(token, `timeSheet/SignatureDetails/${attendanceId}`, { userId: '' });
      const details = Array.isArray(detailsRaw) ? detailsRaw : [];
      if (!details.length) return;

      let unsignedCount = 0;
      let signedCount = 0;
      details.forEach((row) => {
        const statusId = Number(row?.hVisitHistoryStatus?.id || 0);
        if (!statusId) return;
        if (statusId === 6) unsignedCount += 1;
        else signedCount += 1;
      });
      if (!unsignedCount && !signedCount) return;

      const applicationId = Number(sheet?.class?.course?.application?.id || 0);
      const courseName = String(
        sheet?.class?.hCourseDirectionNameRu ||
        sheet?.class?.course?.hCourseDirection?.nameRu ||
        'Без кружка'
      ).trim();
      rows.push({
        applicationId: applicationId || 0,
        courseName: courseName || 'Без кружка',
        signedCount,
        unsignedCount
      });
    });

    const byApplication = mergeRowsByApplication(rows)
      .filter((row) => row.unsignedCount > 0 || row.signedCount > 0)
      .sort((a, b) => b.unsignedCount - a.unsignedCount);

    const totalSigned = byApplication.reduce((sum, row) => sum + Number(row.signedCount || 0), 0);
    const totalUnsigned = byApplication.reduce((sum, row) => sum + Number(row.unsignedCount || 0), 0);

    LAST_SIGNING_STATS = {
      available: true,
      totalSigned,
      totalUnsigned,
      byApplication,
      updatedAt: new Date().toISOString()
    };
    return LAST_SIGNING_STATS;
  } catch (error) {
    LAST_SIGNING_STATS = {
      available: false,
      totalSigned: 0,
      totalUnsigned: 0,
      byApplication: [],
      updatedAt: new Date().toISOString()
    };
    throw new Error(error?.message || 'Не удалось получить данные табелей Damubala.');
  }
}

async function fetchActiveVouchersPreviewWithLogin() {
  const token = await ensureDamubalaLoginWithWindow();
  const vouchers = await getAllActiveVouchers(token);
  const normalized = vouchers.map(normalizeVoucher);
  return {
    fetched: vouchers.length,
    applications: buildPreview(normalized),
    items: normalized
  };
}

function getDamubalaConnectionStatus() {
  return {
    connected: Boolean(LAST_AUTH_TOKEN),
    connectedAt: LAST_CONNECTED_AT || '',
    signingStats: LAST_SIGNING_STATS
  };
}

module.exports = {
  fetchActiveVouchersPreviewWithLogin,
  getDamubalaSigningStats,
  getDamubalaConnectionStatus,
  ensureDamubalaLoginWithWindow
};
