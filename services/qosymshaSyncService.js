const { BrowserWindow } = require('electron');

const QOSYMSHA_LOGIN_URL = 'https://int.qosymsha.kz/ru/Auth/Login';
const WAIT_TIMEOUT_MS = 8 * 60 * 1000;
const LIST_PAGE_LIMIT = 500;
const FORM_BATCH_SIZE = 60;
const FORM_CONCURRENCY = 6;
const QOSYMSHA_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

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
  if (/^\d{2}\.\d{2}\.\d{4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?$/.test(raw)) {
    const [datePart] = raw.split(/\s+/);
    const [dd, mm, yyyy] = datePart.split('.');
    return `${yyyy}-${mm}-${dd}`;
  }
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

function normalizeChild(item = {}) {
  const childFullName = String(
    item.childFullName ||
      [item.childLastName, item.childFirstName, item.childMiddleName].filter(Boolean).join(' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
  const childIINRaw = digitsOnly(item.childIIN || '');
  const parentIINRaw = digitsOnly(item.parentIIN || '');
  const childIIN = /^\d{12}$/.test(childIINRaw) ? childIINRaw : '';
  const parentIIN = /^\d{12}$/.test(parentIINRaw) ? parentIINRaw : '';

  return {
    source: 'qosymsha',
    cityName: '',
    studioName: String(item.studioName || '').trim(),
    courseName: String(item.courseName || '').trim(),
    childFullName,
    childIIN,
    childBirthDate: toIsoDate(item.childBirthDate),
    parentFullName: String(item.parentFullName || '').replace(/\s+/g, ' ').trim(),
    parentPhone: String(item.parentPhone || '').trim(),
    parentIIN,
    parentEmail: String(item.parentEmail || '').trim(),
    voucherNumber: String(item.voucherNumber || 'QOSYMSHA').trim() || 'QOSYMSHA',
    enrollmentDate: toIsoDate(item.enrollmentDate) || todayIso(),
    voucherEndDate: toIsoDate(item.voucherEndDate) || ''
  };
}

function emitProgress(onProgress, payload) {
  if (typeof onProgress !== 'function') return;
  try {
    onProgress(payload);
  } catch {
    // ignore progress callback errors
  }
}

async function evalInWindow(win, jsCode) {
  if (!win || win.isDestroyed()) return null;
  try {
    return await win.webContents.executeJavaScript(jsCode, true);
  } catch {
    return null;
  }
}

async function waitUntil(win, predicateCode, timeoutMs = 10000, stepMs = 250) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!win || win.isDestroyed()) return false;
    const ok = await evalInWindow(win, predicateCode);
    if (ok) return true;
    await delay(stepMs);
  }
  return false;
}

async function safeLoadUrl(win, url, options = {}) {
  if (!win || win.isDestroyed()) throw new Error('Окно Qosymsha не создано.');

  const attempts = Math.max(1, Number(options.attempts || 3));
  const readyTimeoutMs = Math.max(5000, Number(options.timeoutMs || 45000));
  const webContents = win.webContents;
  webContents.setUserAgent(QOSYMSHA_USER_AGENT);

  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await webContents.loadURL(url, { userAgent: QOSYMSHA_USER_AGENT });
      lastError = null;
    } catch (error) {
      const msg = String(error?.message || '');
      if (!msg.includes('ERR_ABORTED')) {
        lastError = error instanceof Error ? error : new Error(msg || 'loadURL error');
      }
    }

    const ready = await waitUntil(
      win,
      String.raw`(() => {
        const href = String(location.href || '');
        if (!href.includes('qosymsha.kz')) return false;
        const state = String(document.readyState || '');
        return state === 'complete' || state === 'interactive';
      })()`,
      readyTimeoutMs,
      250
    );

    if (ready) return true;

    if (attempt < attempts && !win.isDestroyed()) {
      try {
        await webContents.reloadIgnoringCache();
      } catch {
        // noop
      }
      await delay(500);
    }
  }

  if (lastError) throw lastError;
  throw new Error('Не удалось открыть страницу авторизации Qosymsha.');
}

async function waitForQosymshaLogin(win, onProgress, timeoutMs = WAIT_TIMEOUT_MS) {
  const startedAt = Date.now();
  emitProgress(onProgress, { stage: 'login', percent: 6, message: 'Окно Qosymsha открыто. Войдите в аккаунт...' });

  while (Date.now() - startedAt < timeoutMs) {
    if (!win || win.isDestroyed()) {
      throw new Error('Окно Qosymsha закрыто. Синхронизация отменена.');
    }

    const state = await evalInWindow(
      win,
      String.raw`(() => {
        const href = String(location.href || '');
        const txt = String(document.body?.innerText || '');
        const isLoginPage = href.includes('/Auth/Login');
        const looksLoggedIn = txt.includes('Выйти') || href.includes('#!personNotifications') || href.includes('/Dashboard');
        return {
          isLoginPage,
          looksLoggedIn
        };
      })()`
    );

    if (state?.looksLoggedIn || state?.isLoginPage === false) {
      return;
    }
    await delay(700);
  }

  throw new Error('Не удалось войти в Qosymsha. Проверьте логин/пароль и попробуйте снова.');
}

async function openPupilsPage(win, onProgress) {
  emitProgress(onProgress, { stage: 'navigate', percent: 10, message: 'Открываем раздел «Воспитанники»...' });

  const opened = await evalInWindow(
    win,
    String.raw`(() => {
      function text(v) { return String(v || '').replace(/\s+/g, ' ').trim(); }
      if (String(location.href || '').includes('#!pupils')) return true;
      const nodes = Array.from(document.querySelectorAll('a,span,div,button'));
      const item = nodes.find((el) => text(el.textContent) === 'Воспитанники');
      const clickable = item ? (item.closest('a,button') || item) : null;
      if (clickable) {
        clickable.click();
        return true;
      }
      try {
        location.hash = '!pupils';
        return true;
      } catch {
        return false;
      }
    })()`
  );

  if (!opened) return false;

  return waitUntil(
    win,
    String.raw`(() => {
      const href = String(location.href || '');
      if (!href.includes('pupils')) return false;
      const hasExt = !!window.Ext;
      const hasGridHint = String(document.body?.innerText || '').includes('Воспитанники');
      return hasExt || hasGridHint;
    })()`,
    20000,
    250
  );
}

async function detectLocalePrefix(win) {
  const prefix = await evalInWindow(
    win,
    String.raw`(() => {
      const parts = String(location.pathname || '/ru').split('/').filter(Boolean);
      const first = String(parts[0] || 'ru').toLowerCase();
      if (first === 'ru' || first === 'kz' || first === 'kk') return '/' + first;
      return '/ru';
    })()`
  );
  return typeof prefix === 'string' && prefix.startsWith('/') ? prefix : '/ru';
}

async function fetchChildrenGrid(win, localePrefix, limit = LIST_PAGE_LIMIT) {
  const result = await evalInWindow(
    win,
    `(() => {
      const pageLimit = ${Number(limit)};
      const localePrefix = ${JSON.stringify(String(localePrefix || '/ru'))};

      function text(value) {
        return String(value ?? '').replace(/\\s+/g, ' ').trim();
      }

      function pickByKeyLike(obj, patterns) {
        if (!obj || typeof obj !== 'object') return '';
        const entries = Object.entries(obj);
        for (const [key, value] of entries) {
          const k = String(key || '').toLowerCase();
          if (patterns.some((p) => k.includes(p)) && text(value) !== '') {
            return text(value);
          }
        }
        return '';
      }

      function pickRows(payload) {
        const candidates = [
          payload?.rows,
          payload?.result?.rows,
          payload?.result?.data?.rows,
          payload?.result?.items,
          payload?.data?.rows,
          payload?.data?.items,
          payload?.items,
          payload?.Rows,
          payload?.Result?.Rows
        ];
        for (const c of candidates) {
          if (Array.isArray(c)) return c;
        }
        return [];
      }

      function pickTotal(payload, rowsLength) {
        const candidates = [
          payload?.total,
          payload?.result?.total,
          payload?.result?.Total,
          payload?.result?.count,
          payload?.result?.Count,
          payload?.data?.total,
          payload?.data?.Total,
          payload?.Total
        ];
        for (const c of candidates) {
          const n = Number(c);
          if (Number.isFinite(n) && n >= 0) return n;
        }
        return rowsLength;
      }

      function normalizeRow(row) {
        const childLastName =
          text(row?.ChildLastName ?? row?.LastName ?? row?.childLastName ?? row?.lastName) ||
          pickByKeyLike(row, ['childlastname', 'lastname', 'surname']);
        const childFirstName =
          text(row?.ChildFirstName ?? row?.FirstName ?? row?.childFirstName ?? row?.firstName) ||
          pickByKeyLike(row, ['childfirstname', 'firstname', 'name']);
        const childMiddleName =
          text(row?.ChildMiddleName ?? row?.MiddleName ?? row?.childMiddleName ?? row?.middleName) ||
          pickByKeyLike(row, ['childmiddlename', 'middlename', 'patronymic']);
        const id = Number(
          row?.Id ??
            row?.id ??
            row?.PupilId ??
            row?.pupilId ??
            row?.ChildId ??
            row?.childId ??
            0
        );
        if (!Number.isFinite(id) || id <= 0) return null;
        return {
          id,
          voucherNumber: text(row?.Number ?? row?.DocumentNumber ?? row?.number),
          studioName: text(row?.OrganizationNameRu ?? row?.OrganizationName ?? row?.organizationName),
          courseName: text(row?.GroupNameRu ?? row?.GroupName ?? row?.groupName),
          enrollmentDate: text(row?.ChildEnrollDate ?? row?.EnrollDate ?? row?.enrollmentDate),
          childIIN: text(row?.Iin ?? row?.ChildIin ?? row?.iin ?? row?.childIin),
          childBirthDate: text(row?.ChildBirthDate ?? row?.BirthDate ?? row?.childBirthDate ?? row?.birthDate),
          childFullName: text([childLastName, childFirstName, childMiddleName].filter(Boolean).join(' ')),
          childLastName,
          childFirstName,
          childMiddleName,
          parentIIN: text(row?.RepresentativeIin ?? row?.ParentIin ?? row?.representativeIin ?? row?.parentIin),
          parentPhone: text(
            row?.RepresentativePhoneNumber ??
              row?.ParentPhone ??
              row?.representativePhoneNumber ??
              row?.parentPhone
          ),
          parentFullName: text(
            row?.RepresentativeFullName ??
              row?.ParentFullName ??
              row?.representativeFullName ??
              row?.parentFullName
          ),
          parentEmail: text(row?.RepresentativeEmail ?? row?.ParentEmail ?? row?.representativeEmail ?? row?.parentEmail)
        };
      }

      async function requestPage(page, filter) {
        const start = (page - 1) * pageLimit;
        const query =
          '?page=' + page +
          '&start=' + start +
          '&limit=' + pageLimit +
          (filter ? '&filter=' + encodeURIComponent(filter) : '');
        const url = localePrefix + '/Pupil/GetForGrid' + query;
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: {
            Accept: 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest'
          }
        });

        const raw = await response.text();
        let payload = null;
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = null;
        }

        const rows = pickRows(payload).map(normalizeRow).filter(Boolean);
        const total = pickTotal(payload, rows.length);
        return {
          ok: response.ok,
          status: Number(response.status || 0),
          redirectedToLogin: String(response.url || '').includes('/Auth/Login'),
          rows,
          total
        };
      }

      async function loadAllPages(filter) {
        const first = await requestPage(1, filter);
        if (!first.ok || first.redirectedToLogin) {
          return {
            ok: false,
            status: first.status,
            message: 'Qosymsha API недоступен. Требуется повторный вход.'
          };
        }

        const total = Math.max(first.total, first.rows.length);
        const pages = Math.max(1, Math.ceil(total / pageLimit));
        const map = new Map(first.rows.map((x) => [x.id, x]));

        for (let page = 2; page <= pages; page += 1) {
          const next = await requestPage(page, filter);
          if (!next.ok || next.redirectedToLogin) break;
          next.rows.forEach((row) => map.set(row.id, row));
        }

        return {
          ok: true,
          total,
          rows: Array.from(map.values())
        };
      }

      return (async () => {
        const filters = [
          JSON.stringify([{ property: 'ActiveState', value: 1 }]),
          JSON.stringify([{ property: 'ActiveState', value: '1' }]),
          ''
        ];

        let best = { ok: true, total: 0, rows: [] };
        for (const filter of filters) {
          const data = await loadAllPages(filter);
          if (!data.ok) return data;
          if (Array.isArray(data.rows) && data.rows.length > 0) return data;
          if (Number(data.total || 0) > Number(best.total || 0)) best = data;
        }

        return best;
      })();
    })()`
  );

  if (!result?.ok) {
    throw new Error(result?.message || 'Не удалось получить список детей из Qosymsha.');
  }

  return {
    total: Number(result.total || 0),
    rows: Array.isArray(result.rows) ? result.rows : []
  };
}

async function fetchChildrenGridFromExtStore(win) {
  const result = await evalInWindow(
    win,
    `(() => {
      function text(value) {
        return String(value ?? '').replace(/\\s+/g, ' ').trim();
      }

      function getField(record, keys) {
        for (const key of keys) {
          const v = record?.get ? record.get(key) : record?.data?.[key];
          if (v !== undefined && v !== null && text(v) !== '') return text(v);
        }
        return '';
      }

      function mapRecord(record) {
        const data = record?.data && typeof record.data === 'object' ? record.data : {};
        function pickDataLike(patterns) {
          for (const [key, value] of Object.entries(data)) {
            const k = String(key || '').toLowerCase();
            if (patterns.some((p) => k.includes(p)) && text(value) !== '') return text(value);
          }
          return '';
        }

        const childLastName =
          getField(record, ['ChildLastName', 'LastName', 'childLastName', 'lastName', 'Surname', 'surname']) ||
          pickDataLike(['childlastname', 'lastname', 'surname']);
        const childFirstName =
          getField(record, ['ChildFirstName', 'FirstName', 'childFirstName', 'firstName', 'Name', 'name']) ||
          pickDataLike(['childfirstname', 'firstname', 'name']);
        const childMiddleName =
          getField(record, ['ChildMiddleName', 'MiddleName', 'childMiddleName', 'middleName', 'Patronymic', 'patronymic']) ||
          pickDataLike(['childmiddlename', 'middlename', 'patronymic']);

        const id = Number(getField(record, ['Id', 'id', 'PupilId', 'pupilId']));
        if (!Number.isFinite(id) || id <= 0) return null;
        return {
          id,
          voucherNumber: getField(record, ['Number', 'DocumentNumber', 'number']),
          studioName: getField(record, ['OrganizationNameRu', 'OrganizationName', 'organizationName']),
          courseName: getField(record, ['GroupNameRu', 'GroupName', 'groupName']),
          enrollmentDate: getField(record, ['ChildEnrollDate', 'EnrollDate', 'enrollmentDate']),
          childIIN: getField(record, ['Iin', 'ChildIin', 'iin', 'childIin']),
          childBirthDate: getField(record, ['ChildBirthDate', 'BirthDate', 'childBirthDate', 'birthDate']),
          childFullName:
            getField(record, ['ChildFullName', 'FullName', 'childFullName', 'fullName']) ||
            text([childLastName, childFirstName, childMiddleName].filter(Boolean).join(' ')),
          childLastName,
          childFirstName,
          childMiddleName,
          parentIIN: getField(record, ['RepresentativeIin', 'ParentIin', 'representativeIin', 'parentIin']),
          parentPhone: getField(record, ['RepresentativePhoneNumber', 'ParentPhone', 'representativePhoneNumber', 'parentPhone']),
          parentFullName: getField(record, ['RepresentativeFullName', 'ParentFullName', 'representativeFullName', 'parentFullName']),
          parentEmail: getField(record, ['RepresentativeEmail', 'ParentEmail', 'representativeEmail', 'parentEmail'])
        };
      }

      function findPupilsGridStore() {
        const ExtRef = window.Ext;
        if (!ExtRef) return null;

        const stores = [];
        try {
          if (ExtRef.data?.StoreManager?.each) {
            ExtRef.data.StoreManager.each((store) => stores.push(store));
          }
        } catch {
          // ignore
        }

        const scored = stores
          .map((store) => {
            const proxyUrl = text(store?.proxy?.url || store?.getProxy?.()?.url || '');
            const storeId = text(store?.storeId || store?.getStoreId?.() || '');
            const score =
              (proxyUrl.includes('Pupil/GetForGrid') ? 4 : 0) +
              (storeId.toLowerCase().includes('pupil') ? 2 : 0) +
              (storeId.toLowerCase().includes('child') ? 1 : 0);
            return { store, score };
          })
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score);

        if (scored.length) return scored[0].store;

        try {
          if (ExtRef.ComponentQuery?.query) {
            const grids = ExtRef.ComponentQuery.query('gridpanel');
            const grid = grids.find((g) => text(g?.title || '').includes('Воспитан')) || grids[0];
            const store = grid?.getStore?.();
            if (store) return store;
          }
        } catch {
          // ignore
        }
        return null;
      }

      return new Promise((resolve) => {
        try {
          const store = findPupilsGridStore();
          if (!store) return resolve({ ok: true, total: 0, rows: [] });

          const proxy = store.getProxy ? store.getProxy() : store.proxy;
          const pageSize = Number(store.pageSize || proxy?.extraParams?.limit || 25);
          const map = new Map();
          let discoveredTotal = 0;

          function collectCurrentPage() {
            const records = store.getRange ? store.getRange() : [];
            records.forEach((record) => {
              const row = mapRecord(record);
              if (row) map.set(row.id, row);
            });
            discoveredTotal = Math.max(
              discoveredTotal,
              Number(store.totalCount || store.getTotalCount?.() || 0),
              map.size
            );
          }

          function finish() {
            resolve({
              ok: true,
              total: Math.max(discoveredTotal, map.size),
              rows: Array.from(map.values())
            });
          }

          function loadByPages(totalPages) {
            let page = 2;
            function next() {
              if (page > totalPages) return finish();
              store.loadPage(page, {
                callback: () => {
                  collectCurrentPage();
                  page += 1;
                  next();
                }
              });
            }
            next();
          }

          function loadFirst() {
            store.loadPage(1, {
              callback: () => {
                collectCurrentPage();
                const totalPages = Math.max(
                  1,
                  Math.ceil(Math.max(discoveredTotal, map.size) / Math.max(1, pageSize))
                );
                if (totalPages <= 1) return finish();
                loadByPages(totalPages);
              }
            });
          }

          if (proxy?.setExtraParam) {
            proxy.setExtraParam('page', 1);
            proxy.setExtraParam('start', 0);
            proxy.setExtraParam('limit', 500);
          }

          loadFirst();
        } catch {
          resolve({ ok: true, total: 0, rows: [] });
        }
      });
    })()`
  );

  return {
    total: Number(result?.total || 0),
    rows: Array.isArray(result?.rows) ? result.rows : []
  };
}

async function fetchChildrenFormsBatch(win, ids, fallbackMap) {
  const fallbackJson = JSON.stringify(fallbackMap || {});
  const localePrefix = await detectLocalePrefix(win);
  const result = await evalInWindow(
    win,
    `(() => {
      const ids = ${JSON.stringify(ids || [])};
      const fallback = ${fallbackJson};
      const localePrefix = ${JSON.stringify(localePrefix)};
      const concurrency = ${Number(FORM_CONCURRENCY)};

      function text(value) {
        return String(value ?? '').replace(/\\s+/g, ' ').trim();
      }

      function pick(obj, keys) {
        if (!obj || typeof obj !== 'object') return '';
        for (const key of keys) {
          const value = obj?.[key];
          if (value !== undefined && value !== null && text(value) !== '') {
            return text(value);
          }
        }
        return '';
      }

      function joinName(lastName, firstName, middleName) {
        return text([lastName, firstName, middleName].filter(Boolean).join(' '));
      }

      function parseHtmlToItem(raw, id) {
        if (!raw || typeof raw !== 'string' || raw.indexOf('<') === -1) return null;
        const doc = new DOMParser().parseFromString(raw, 'text/html');
        if (!doc) return null;

        function inputValue(token) {
          const el = doc.querySelector('input[id*="' + token + '"], textarea[id*="' + token + '"]');
          return text(el?.value ?? el?.getAttribute('value') ?? '');
        }

        function valueByLabel(labelText) {
          const labels = Array.from(doc.querySelectorAll('label, td, div, span'));
          const label = labels.find((el) => text(el.textContent).startsWith(labelText));
          if (!label) return '';
          const row = label.closest('tr') || label.parentElement;
          if (!row) return '';
          const input = row.querySelector('input, textarea');
          return text(input?.value ?? input?.getAttribute('value') ?? '');
        }

        const fallbackRow = fallback[String(id)] || {};
        const childLastName = inputValue('pupChildLastNameId-inputEl') || valueByLabel('Фамилия');
        const childFirstName = inputValue('pupChildFirstNameId-inputEl') || valueByLabel('Имя');
        const childMiddleName = inputValue('pupChildMiddleNameId-inputEl') || valueByLabel('Отчество');
        const parentLastName = inputValue('pupRepresentativeLastNameId-inputEl');
        const parentFirstName = inputValue('pupRepresentativeFirstNameId-inputEl');
        const parentMiddleName = inputValue('pupRepresentativeMiddleNameId-inputEl');

        const item = {
          cityName: '',
          studioName: inputValue('pupOrganizationNameRuId-inputEl') || text(fallbackRow.studioName),
          courseName: inputValue('pupGroupNameRuId-inputEl') || text(fallbackRow.courseName),
          childFullName: joinName(childLastName, childFirstName, childMiddleName) || text(fallbackRow.childFullName),
          childLastName: childLastName || text(fallbackRow.childLastName),
          childFirstName: childFirstName || text(fallbackRow.childFirstName),
          childMiddleName: childMiddleName || text(fallbackRow.childMiddleName),
          childIIN: inputValue('pupChildIinId-inputEl') || text(fallbackRow.childIIN),
          childBirthDate: inputValue('pupChildBirthDateId-inputEl') || text(fallbackRow.childBirthDate),
          parentFullName: joinName(parentLastName, parentFirstName, parentMiddleName) || text(fallbackRow.parentFullName),
          parentIIN: inputValue('pupRepresentativeIinId-inputEl') || text(fallbackRow.parentIIN),
          parentPhone: inputValue('pupRepresentativePhoneNumberId-inputEl') || text(fallbackRow.parentPhone),
          parentEmail: inputValue('pupRepresentativeEmailId-inputEl') || text(fallbackRow.parentEmail),
          voucherNumber: inputValue('pupNumberId-inputEl') || text(fallbackRow.voucherNumber),
          enrollmentDate: inputValue('pupChildEnrollDateId-inputEl') || text(fallbackRow.enrollmentDate)
        };

        if (!item.childFullName && !item.childIIN) return null;
        return item;
      }

      function parsePayloadToItem(payload, id) {
        if (!payload || typeof payload !== 'object') return null;
        const root = payload?.result ?? payload?.Result ?? payload;
        if (!root || typeof root !== 'object') return null;
        const childSources = [root, root?.Child, root?.Pupil, root?.child, root?.pupil].filter(Boolean);
        const repList = Array.isArray(root?.Representatives)
          ? root.Representatives
          : Array.isArray(root?.representatives)
            ? root.representatives
            : [];
        const rep =
          repList.find((x) => pick(x, ['Iin', 'iin', 'PhoneNumber', 'phoneNumber', 'Email', 'email'])) ||
          repList[0] ||
          null;

        const fallbackRow = fallback[String(id)] || {};
        const childLastName =
          pick(childSources[0], ['LastName', 'lastName', 'ChildLastName', 'childLastName']) ||
          pick(childSources[1], ['LastName', 'lastName']) ||
          pick(childSources[2], ['LastName', 'lastName']) ||
          '';
        const childFirstName =
          pick(childSources[0], ['FirstName', 'firstName', 'ChildFirstName', 'childFirstName']) ||
          pick(childSources[1], ['FirstName', 'firstName']) ||
          pick(childSources[2], ['FirstName', 'firstName']) ||
          '';
        const childMiddleName =
          pick(childSources[0], ['MiddleName', 'middleName', 'ChildMiddleName', 'childMiddleName']) ||
          pick(childSources[1], ['MiddleName', 'middleName']) ||
          pick(childSources[2], ['MiddleName', 'middleName']) ||
          '';

        const parentLastName = pick(rep, ['LastName', 'lastName']);
        const parentFirstName = pick(rep, ['FirstName', 'firstName']);
        const parentMiddleName = pick(rep, ['MiddleName', 'middleName']);

        const item = {
          cityName: '',
          studioName:
            pick(root, ['OrganizationNameRu', 'organizationNameRu', 'OrganizationName', 'organizationName']) ||
            text(fallbackRow.studioName),
          courseName:
            pick(root, ['GroupNameRu', 'groupNameRu', 'GroupName', 'groupName']) || text(fallbackRow.courseName),
          childFullName: joinName(childLastName, childFirstName, childMiddleName) || text(fallbackRow.childFullName),
          childLastName: childLastName || text(fallbackRow.childLastName),
          childFirstName: childFirstName || text(fallbackRow.childFirstName),
          childMiddleName: childMiddleName || text(fallbackRow.childMiddleName),
          childIIN:
            pick(root, ['Iin', 'iin', 'ChildIin', 'childIin']) ||
            pick(root?.Child, ['Iin', 'iin']) ||
            pick(root?.Pupil, ['Iin', 'iin']) ||
            text(fallbackRow.childIIN),
          childBirthDate:
            pick(root, ['BirthDate', 'birthDate', 'ChildBirthDate', 'childBirthDate']) ||
            pick(root?.Child, ['BirthDate', 'birthDate']) ||
            pick(root?.Pupil, ['BirthDate', 'birthDate']) ||
            text(fallbackRow.childBirthDate),
          parentFullName: joinName(parentLastName, parentFirstName, parentMiddleName) || text(fallbackRow.parentFullName),
          parentIIN: pick(rep, ['Iin', 'iin']) || text(fallbackRow.parentIIN),
          parentPhone: pick(rep, ['PhoneNumber', 'phoneNumber', 'Phone', 'phone']) || text(fallbackRow.parentPhone),
          parentEmail: pick(rep, ['Email', 'email']) || text(fallbackRow.parentEmail),
          voucherNumber:
            pick(root, ['Number', 'DocumentNumber', 'documentNumber']) ||
            text(fallbackRow.voucherNumber),
          enrollmentDate:
            pick(root, ['ChildEnrollDate', 'EnrollDate', 'enrollmentDate']) || text(fallbackRow.enrollmentDate)
        };

        if (!item.childFullName && !item.childIIN) return null;
        return item;
      }

      async function requestForm(id, method) {
        const ExtRef = window.Ext;
        if (ExtRef?.Ajax?.request) {
          try {
            const extResponse = await new Promise((resolve) => {
              const cfg = {
                url: localePrefix + '/Pupil/GetForm',
                method: 'POST',
                params: { id: String(id) },
                timeout: 25000,
                success: (resp) => resolve({ ok: true, responseText: String(resp?.responseText || '') }),
                failure: (resp) =>
                  resolve({
                    ok: false,
                    responseText: String(resp?.responseText || ''),
                    status: Number(resp?.status || 0)
                  })
              };
              ExtRef.Ajax.request(cfg);
            });
            if (extResponse?.responseText) {
              return {
                ok: !!extResponse.ok,
                raw: extResponse.responseText,
                redirectedToLogin: false
              };
            }
          } catch {
            // fallback below
          }
        }

        if (method === 'GET') {
          const response = await fetch(localePrefix + '/Pupil/GetForm?id=' + encodeURIComponent(String(id)), {
            method: 'GET',
            credentials: 'include',
            headers: {
              Accept: 'application/json, text/javascript, text/html, */*; q=0.01',
              'X-Requested-With': 'XMLHttpRequest'
            }
          });
          return {
            ok: response.ok,
            raw: await response.text(),
            redirectedToLogin: String(response.url || '').includes('/Auth/Login')
          };
        }
        const body = new URLSearchParams({ id: String(id) }).toString();
        const response = await fetch(localePrefix + '/Pupil/GetForm', {
          method: 'POST',
          credentials: 'include',
          headers: {
            Accept: 'application/json, text/javascript, text/html, */*; q=0.01',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body
        });
        return {
          ok: response.ok,
          raw: await response.text(),
          redirectedToLogin: String(response.url || '').includes('/Auth/Login')
        };
      }

      async function fetchForm(id) {
        const methods = ['POST', 'GET'];
        for (const method of methods) {
          const response = await requestForm(id, method);
          const raw = String(response?.raw || '');
          if (response?.redirectedToLogin) {
            return { __loginRedirect: true };
          }
          if (!response?.ok && !raw) continue;

          let payload = null;
          try {
            payload = JSON.parse(raw);
          } catch {
            payload = null;
          }

          const fromPayload = parsePayloadToItem(payload, id);
          if (fromPayload) return fromPayload;

          const fromHtml = parseHtmlToItem(raw, id);
          if (fromHtml) return fromHtml;
        }
        return null;
      }

      return (async () => {
        const out = [];
        let failed = 0;
        let loginRedirects = 0;
        let index = 0;
        const workers = new Array(Math.max(1, concurrency)).fill(null).map(async () => {
          while (index < ids.length) {
            const currentIndex = index;
            index += 1;
            const id = ids[currentIndex];
            try {
              const item = await fetchForm(id);
              if (item?.__loginRedirect) {
                loginRedirects += 1;
                failed += 1;
                continue;
              }
              if (item) {
                out.push(item);
              } else {
                failed += 1;
              }
            } catch {
              failed += 1;
            }
          }
        });
        await Promise.all(workers);
        return { items: out, failed, loginRedirects };
      })();
    })()`
  );

  return {
    items: Array.isArray(result?.items) ? result.items : [],
    failed: Number(result?.failed || 0),
    loginRedirects: Number(result?.loginRedirects || 0)
  };
}

async function collectChildrenViaApi(win, onProgress) {
  emitProgress(onProgress, {
    stage: 'collect',
    percent: 14,
    message: 'Получаем список детей из таблицы Qosymsha...'
  });

  const extData = await fetchChildrenGridFromExtStore(win);
  let uniqueRows = Array.isArray(extData.rows) ? extData.rows.filter((x) => Number(x?.id || 0) > 0) : [];
  let total = Number(extData.total || 0);

  if (!uniqueRows.length) {
    emitProgress(onProgress, {
      stage: 'collect',
      percent: 18,
      message: 'Таблица вернула пусто, пробуем прямой API Qosymsha...'
    });
    const localePrefix = await detectLocalePrefix(win);
    const apiData = await fetchChildrenGrid(win, localePrefix, LIST_PAGE_LIMIT);
    uniqueRows = Array.isArray(apiData.rows) ? apiData.rows.filter((x) => Number(x?.id || 0) > 0) : [];
    total = Math.max(total, Number(apiData.total || 0), uniqueRows.length);
  }

  emitProgress(onProgress, {
    stage: 'collect',
    percent: 22,
    message: `Найдено детей: ${Math.max(total, uniqueRows.length)}. Загружаем карточки API...`,
    processed: 0,
    total: Math.max(total, uniqueRows.length)
  });

  if (!uniqueRows.length) {
    throw new Error('Не удалось получить список детей из Qosymsha (0 записей). Проверьте фильтр "Показать воспитанников" в Qosymsha.');
  }

  const fallbackMap = Object.fromEntries(uniqueRows.map((row) => [String(row.id), row]));
  const ids = uniqueRows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
  const totalIds = ids.length;
  const collected = [];

  for (let offset = 0; offset < totalIds; offset += FORM_BATCH_SIZE) {
    const batchIds = ids.slice(offset, offset + FORM_BATCH_SIZE);
    const batch = await fetchChildrenFormsBatch(win, batchIds, fallbackMap);
    collected.push(...batch.items);

    const processed = Math.min(totalIds, offset + batchIds.length);
    const percent = 22 + Math.round((processed / totalIds) * 74);
    emitProgress(onProgress, {
      stage: 'collect',
      percent: Math.min(96, percent),
      message: `Загружаем данные детей: ${processed}/${totalIds}`,
      processed,
      total: totalIds
    });
  }

  return collected;
}

async function fetchQosymshaChildrenPreviewWithLogin(onProgress) {
  const authWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 1020,
    minHeight: 700,
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      partition: 'persist:qosymsha-sync'
    }
  });

  try {
    await safeLoadUrl(authWindow, QOSYMSHA_LOGIN_URL, { attempts: 4, timeoutMs: 20000 });
    await waitForQosymshaLogin(authWindow, onProgress);
    await openPupilsPage(authWindow, onProgress);

    if (!authWindow.isDestroyed()) {
      authWindow.setSkipTaskbar(true);
      authWindow.hide();
    }

    emitProgress(onProgress, {
      stage: 'collect',
      percent: 12,
      message: 'Авторизация успешна. Импорт выполняется в фоне...'
    });

    const rows = await collectChildrenViaApi(authWindow, onProgress);
    const items = rows.map(normalizeChild).filter((row) => row.childFullName || row.childIIN);

    emitProgress(onProgress, {
      stage: 'done',
      percent: 100,
      message: `Загрузка завершена. Получено детей: ${items.length}`,
      processed: items.length,
      total: items.length
    });

    return {
      fetched: items.length,
      applications: [
        {
          applicationId: 'qosymsha',
          applicationName: 'Qosymsha',
          childrenCount: items.length,
          childNames: items.map((x) => x.childFullName).filter(Boolean).slice(0, 10),
          cityName: '',
          studioName: '',
          courseName: ''
        }
      ],
      items
    };
  } finally {
    if (!authWindow.isDestroyed()) authWindow.destroy();
  }
}

module.exports = {
  fetchQosymshaChildrenPreviewWithLogin
};
