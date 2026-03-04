const { BrowserWindow } = require('electron');

const ARTSPORT_LOGIN_URL = 'https://artsport.edu.kz/ru/login';
const WAIT_TIMEOUT_MS = 8 * 60 * 1000;

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

function emitProgress(onProgress, payload) {
  if (typeof onProgress !== 'function') return;
  try {
    onProgress(payload);
  } catch {
    // ignore callback errors
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

async function waitForArtsportLogin(win, onProgress, timeoutMs = WAIT_TIMEOUT_MS) {
  const startedAt = Date.now();
  emitProgress(onProgress, { stage: 'login', percent: 6, message: 'Окно Artsport открыто. Войдите в аккаунт...' });

  while (Date.now() - startedAt < timeoutMs) {
    if (!win || win.isDestroyed()) throw new Error('Окно Artsport закрыто. Синхронизация отменена.');

    const loggedIn = await evalInWindow(
      win,
      String.raw`(() => {
        const href = String(location.href || '').toLowerCase();
        const txt = String(document.body?.innerText || '').toLowerCase();
        if (href.includes('/login')) return false;
        if (txt.includes('мои ваучеры') || txt.includes('мои заявки') || txt.includes('мои документы')) return true;
        return false;
      })()`
    );
    if (loggedIn) return true;
    await delay(700);
  }

  throw new Error('Не удалось войти в Artsport. Проверьте логин/пароль и попробуйте снова.');
}

async function openVouchersSection(win, onProgress) {
  emitProgress(onProgress, { stage: 'navigate', percent: 14, message: 'Открываем раздел «Мои ваучеры»...' });

  await evalInWindow(
    win,
    String.raw`(() => {
      function text(v) { return String(v || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
      const nodes = Array.from(document.querySelectorAll('a,span,div,button'));
      const item = nodes.find((el) => text(el.textContent).includes('мои ваучеры'));
      const clickable = item ? (item.closest('a,button') || item) : null;
      if (clickable) {
        clickable.click();
        return true;
      }
      return false;
    })()`
  );

  const ready = await waitUntil(
    win,
    String.raw`(() => {
      const txt = String(document.body?.innerText || '').toLowerCase();
      const hasTitle = txt.includes('список заявок') || txt.includes('мои ваучеры');
      const hasTable = !!document.querySelector('table tbody tr');
      return hasTitle && hasTable;
    })()`,
    25000,
    300
  );
  if (!ready) throw new Error('Раздел «Мои ваучеры» в Artsport не загрузился.');
}

function normalizeArtsportRow(row = {}) {
  const parentPhoneRaw = digitsOnly(row.parentPhone || '');
  const parentPhone = parentPhoneRaw.length ? parentPhoneRaw : '';
  const childIINRaw = digitsOnly(row.childIIN || '');
  const parentIINRaw = digitsOnly(row.parentIIN || '');
  return {
    source: 'artsport',
    cityName: String(row.cityName || '').trim(),
    studioName: String(row.studioName || '').trim(),
    courseName: String(row.courseName || '').trim(),
    childFullName: String(row.childFullName || '').replace(/\s+/g, ' ').trim(),
    childIIN: childIINRaw,
    childBirthDate: toIsoDate(row.childBirthDate),
    parentFullName: String(row.parentFullName || '').replace(/\s+/g, ' ').trim(),
    parentPhone,
    parentIIN: parentIINRaw,
    parentEmail: String(row.parentEmail || '').trim(),
    voucherNumber: String(row.voucherNumber || 'ARTSPORT').trim() || 'ARTSPORT',
    enrollmentDate: toIsoDate(row.enrollmentDate) || todayIso(),
    voucherEndDate: ''
  };
}

async function collectActiveArtsportRows(win, onProgress) {
  emitProgress(onProgress, { stage: 'collect', percent: 22, message: 'Собираем активированные ваучеры Artsport...' });

  const rows = await evalInWindow(
    win,
    String.raw`(() => {
      function text(v) { return String(v || '').replace(/\s+/g, ' ').trim(); }
      function lower(v) { return text(v).toLowerCase(); }
      function byLabel(lines, prefix) {
        const row = lines.find((x) => lower(x).startsWith(prefix));
        if (!row) return '';
        return text(row.split(':').slice(1).join(':'));
      }

      function parseEmailFromText(raw) {
        const m = String(raw || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig);
        return m?.[0] ? text(m[0]) : '';
      }

      function parseIinFromText(raw) {
        const m = String(raw || '').match(/\b\d{12}\b/g);
        return m?.[0] ? String(m[0]) : '';
      }

      function parseIinFromHtmlComment(html) {
        const raw = String(html || '');
        const byComment = raw.match(/<!--\s*иин\s*:\s*([0-9\-\s]{12,20})\s*<br>\s*-->/i);
        if (byComment?.[1]) {
          const clean = String(byComment[1]).replace(/\D/g, '');
          if (/^\d{12}$/.test(clean)) return clean;
        }
        const byGeneric = raw.match(/иин\s*[:\-]?\s*([0-9\-\s]{12,20})/i);
        if (byGeneric?.[1]) {
          const clean = String(byGeneric[1]).replace(/\D/g, '');
          if (/^\d{12}$/.test(clean)) return clean;
        }
        return '';
      }

      function parseIinFromLines(lines, who) {
        const variants = who === 'child'
          ? ['иин ребенка', 'иин ребёнка', 'ии ребенка', 'ии ребёнка', 'иин']
          : ['иин родителя', 'иин законного представителя', 'иин'];
        const line = lines.find((x) => variants.some((v) => lower(x).startsWith(v)));
        if (!line) return '';
        return String(line).replace(/\D/g, '');
      }

      function parseTableRows() {
        const out = [];
        const trs = Array.from(document.querySelectorAll('table tbody tr'));
        trs.forEach((tr) => {
          const tds = Array.from(tr.querySelectorAll('td'));
          if (tds.length < 8) return;

          const voucherNumber = text(tds[0].innerText || tds[0].textContent || '');
          const parentBlockRaw = String(tds[1].textContent || tds[1].innerText || '');
          const childBlockRaw = String(tds[2].textContent || tds[2].innerText || '');
          const parentHtmlRaw = String(tds[1].innerHTML || '');
          const childHtmlRaw = String(tds[2].innerHTML || '');
          const studioName = text(tds[3].innerText || tds[3].textContent || '');
          const courseName = text(tds[4].innerText || tds[4].textContent || '');
          const status = lower(tds[6].innerText || tds[6].textContent || '');
          const submitDateRaw = text(tds[7].innerText || tds[7].textContent || '');
          const activationDateRaw = text(tds[8]?.innerText || tds[8]?.textContent || '');
          const detailHref = tds[0].querySelector('a[href]')?.getAttribute('href') || '';

          if (!status.includes('активирован')) return;

          const parentLines = parentBlockRaw.split(/\n+/).map((x) => text(x)).filter(Boolean);
          const childLines = childBlockRaw.split(/\n+/).map((x) => text(x)).filter(Boolean);

          const parentFullName = parentLines[0] || '';
          const parentPhone = byLabel(parentLines, 'телефон');
          const parentEmail = byLabel(parentLines, 'email') || parseEmailFromText(parentBlockRaw);
          const parentIIN =
            parseIinFromLines(parentLines, 'parent') ||
            parseIinFromHtmlComment(parentHtmlRaw) ||
            parseIinFromText(parentBlockRaw);
          const childFullName = childLines[0] || '';
          const childBirthDate = byLabel(childLines, 'дата рождения');
          const childIIN =
            parseIinFromLines(childLines, 'child') ||
            parseIinFromHtmlComment(childHtmlRaw) ||
            parseIinFromText(childBlockRaw);

          out.push({
            voucherNumber,
            parentFullName,
            parentPhone,
            parentEmail,
            parentIIN,
            childFullName,
            childBirthDate,
            childIIN,
            studioName,
            courseName,
            enrollmentDate: activationDateRaw || submitDateRaw,
            detailPath: detailHref ? String(detailHref) : ''
          });
        });
        return out;
      }

      function parseFromDetailHtml(html) {
        const raw = String(html || '');
        if (!raw) return {};
        const doc = new DOMParser().parseFromString(raw, 'text/html');
        const allText = text(doc?.body?.textContent || raw);

        function valueByRegex(regex) {
          const m = regex.exec(allText);
          return m?.[1] ? text(m[1]) : '';
        }

        function iinByRegex(regex) {
          const m = regex.exec(allText);
          if (!m?.[1]) return '';
          const v = String(m[1]).replace(/\D/g, '');
          return /^\d{12}$/.test(v) ? v : '';
        }

        const parentIIN =
          iinByRegex(/иин\s*родител[яь]\s*[:\-]?\s*([0-9\-\s]{12,20})/i) ||
          iinByRegex(/иин\s*законн(?:ого|ый)\s*представител[яь]\s*[:\-]?\s*([0-9\-\s]{12,20})/i);
        const childIIN =
          iinByRegex(/иин\s*реб[её]нка\s*[:\-]?\s*([0-9\-\s]{12,20})/i) ||
          iinByRegex(/реб[её]нок.*?иин\s*[:\-]?\s*([0-9\-\s]{12,20})/i);
        const parentEmail =
          valueByRegex(/(?:e-?mail|email)\s*[:\-]?\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i) ||
          parseEmailFromText(allText);

        return { parentIIN, childIIN, parentEmail };
      }

      function parseRowsFromTicketsHtml(html) {
        if (!html || typeof html !== 'string') return [];
        const doc = new DOMParser().parseFromString(html, 'text/html');
        if (!doc) return [];
        const out = [];
        const trs = Array.from(doc.querySelectorAll('table tbody tr'));
        trs.forEach((tr) => {
          const tds = Array.from(tr.querySelectorAll('td'));
          if (tds.length < 8) return;
          const status = lower(tds[6].innerText || tds[6].textContent || '');
          if (!status.includes('активирован')) return;

          const voucherNumber = text(tds[0].innerText || tds[0].textContent || '');
          const parentRaw = String(tds[1].textContent || tds[1].innerText || '');
          const childRaw = String(tds[2].textContent || tds[2].innerText || '');
          const parentHtmlRaw = String(tds[1].innerHTML || '');
          const childHtmlRaw = String(tds[2].innerHTML || '');
          const parentLines = parentRaw.split(/\n+/).map((x) => text(x)).filter(Boolean);
          const childLines = childRaw.split(/\n+/).map((x) => text(x)).filter(Boolean);

          const parentFullName = parentLines[0] || '';
          const parentPhone = byLabel(parentLines, 'телефон');
          const parentEmail = byLabel(parentLines, 'email') || parseEmailFromText(parentRaw);
          const parentIIN =
            parseIinFromLines(parentLines, 'parent') ||
            parseIinFromHtmlComment(parentHtmlRaw) ||
            parseIinFromText(parentRaw);
          const childFullName = childLines[0] || '';
          const childBirthDate = byLabel(childLines, 'дата рождения');
          const childIIN =
            parseIinFromLines(childLines, 'child') ||
            parseIinFromHtmlComment(childHtmlRaw) ||
            parseIinFromText(childRaw);
          const studioName = text(tds[3].innerText || tds[3].textContent || '');
          const courseName = text(tds[4].innerText || tds[4].textContent || '');
          const submitDateRaw = text(tds[7].innerText || tds[7].textContent || '');
          const activationDateRaw = text(tds[8]?.innerText || tds[8]?.textContent || '');
          const detailHref = tds[0].querySelector('a[href]')?.getAttribute('href') || '';

          out.push({
            voucherNumber,
            parentFullName,
            parentPhone,
            parentEmail,
            parentIIN,
            childFullName,
            childBirthDate,
            childIIN,
            studioName,
            courseName,
            enrollmentDate: activationDateRaw || submitDateRaw,
            detailPath: detailHref ? String(detailHref) : ''
          });
        });
        return out;
      }

      function setMaxPerPage() {
        const selects = Array.from(document.querySelectorAll('select'));
        const target = selects.find((s) => {
          const parent = s.closest('label,div');
          const txt = lower(parent?.textContent || '');
          return txt.includes('отображать по') || txt.includes('записей');
        });
        if (!target) return false;
        const options = Array.from(target.options || []);
        if (!options.length) return false;
        const sorted = options
          .map((opt) => ({ value: String(opt.value || ''), n: Number(opt.value || 0) }))
          .sort((a, b) => b.n - a.n);
        const best = sorted[0];
        if (!best?.value) return false;
        if (String(target.value) === best.value) return false;
        target.value = best.value;
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }

      function nextButton() {
        const candidates = Array.from(document.querySelectorAll('a,button'));
        const btn = candidates.find((el) => {
          const t = lower(el.textContent || '');
          const cls = lower(el.className || '');
          return t === 'следующая' || t === 'next' || cls.includes('next');
        });
        if (!btn) return null;
        const cls = lower(btn.className || '');
        if (cls.includes('disabled') || cls.includes('paginate_button disabled')) return null;
        return btn;
      }

      return (async () => {
        setMaxPerPage();
        await new Promise((r) => setTimeout(r, 350));

        const all = [];
        const seen = new Set();
        let guard = 0;

        while (guard < 100) {
          guard += 1;
          const pageRows = parseTableRows();
          pageRows.forEach((row) => {
            const key = String(row.voucherNumber || '') + '|' + String(row.childFullName || '') + '|' + String(row.parentFullName || '');
            if (seen.has(key)) return;
            seen.add(key);
            all.push(row);
          });

          const btn = nextButton();
          if (!btn) break;
          const firstKey = String(pageRows[0]?.voucherNumber || '') + '|' + String(pageRows[0]?.childFullName || '');
          btn.click();
          await new Promise((r) => setTimeout(r, 450));
          const changed = (() => {
            const rows = parseTableRows();
            const nextFirst = String(rows[0]?.voucherNumber || '') + '|' + String(rows[0]?.childFullName || '');
            return nextFirst !== firstKey;
          })();
          if (!changed) break;
        }

        try {
          const resp = await fetch('/ru/tickets', {
            method: 'GET',
            credentials: 'include',
            headers: {
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
          });
          const html = await resp.text();
          const fromTickets = parseRowsFromTicketsHtml(html);
          fromTickets.forEach((row) => {
            const key = String(row.voucherNumber || '') + '|' + String(row.childFullName || '') + '|' + String(row.parentFullName || '');
            if (seen.has(key)) return;
            seen.add(key);
            all.push(row);
          });
        } catch {
          // ignore html fallback errors
        }

        const needDetails = all.filter((row) => (!row.childIIN || !row.parentIIN || !row.parentEmail) && row.detailPath);
        const base = location.origin;
        for (let i = 0; i < needDetails.length; i += 1) {
          const row = needDetails[i];
          try {
            const path = String(row.detailPath || '').startsWith('http')
              ? String(row.detailPath || '')
              : base + String(row.detailPath || '');
            const resp = await fetch(path, { method: 'GET', credentials: 'include' });
            const html = await resp.text();
            const extra = parseFromDetailHtml(html);
            if (!row.parentIIN && extra.parentIIN) row.parentIIN = extra.parentIIN;
            if (!row.childIIN && extra.childIIN) row.childIIN = extra.childIIN;
            if (!row.parentEmail && extra.parentEmail) row.parentEmail = extra.parentEmail;
          } catch {
            // ignore detail fetch errors
          }
        }

        return all;
      })();
    })()`
  );

  const list = Array.isArray(rows) ? rows : [];
  const normalized = list.map(normalizeArtsportRow).filter((row) => row.childFullName);

  emitProgress(onProgress, {
    stage: 'done',
    percent: 100,
    message: `Artsport: найдено активированных детей ${normalized.length}`,
    processed: normalized.length,
    total: normalized.length
  });

  return normalized;
}

async function fetchArtsportChildrenPreviewWithLogin(onProgress) {
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
      partition: 'persist:artsport-sync'
    }
  });

  try {
    await authWindow.loadURL(ARTSPORT_LOGIN_URL);
    await waitForArtsportLogin(authWindow, onProgress);
    await openVouchersSection(authWindow, onProgress);

    if (!authWindow.isDestroyed()) {
      authWindow.setSkipTaskbar(true);
      authWindow.hide();
    }

    const items = await collectActiveArtsportRows(authWindow, onProgress);
    return {
      fetched: items.length,
      applications: [
        {
          applicationId: 'artsport',
          applicationName: 'Artsport',
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
  fetchArtsportChildrenPreviewWithLogin
};
