const { getDb } = require('../database');
const { calculateAge, toIsoDate, toIsoDateTime } = require('./childAge');
const { checkQueueByIin } = require('./qosymshaQueueService');

function cleanDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function validatePhone(phone) {
  const cleaned = cleanDigits(phone);
  return cleaned.length >= 10 && cleaned.length <= 15;
}

function validateIin(iin) {
  if (!iin) return true;
  return /^\d{12}$/.test(String(iin));
}

function normalizeIsoDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return '';
  return toIsoDate(dt);
}

function addDaysIso(baseIso, days) {
  const date = new Date(`${baseIso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return baseIso;
  date.setDate(date.getDate() + Number(days || 0));
  return toIsoDate(date);
}

function formatHumanDate(value) {
  const iso = normalizeIsoDate(value);
  if (!iso) return String(value || '');
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

function getGroupNameById(db, groupId) {
  if (!groupId) return '';
  return String(db.prepare('SELECT name FROM CourseGroups WHERE id = ?').get(Number(groupId))?.name || '');
}

function normalizeMessageTag(value) {
  const tag = String(value || '').trim().toLowerCase();
  if (!tag) return '';
  if (tag === 'qr') return 'qr';
  if (tag === 'reminder' || tag === 'напоминание') return 'reminder';
  return String(value || '').trim();
}

function getDefaultAppSettings() {
  return {
    payments: {
      defaultCycleLength: 8,
      defaultFirstPaymentLesson: 1,
      courseOverrides: []
    }
  };
}

function getAppSettings() {
  const db = getDb();
  const rows = db.prepare('SELECT key, valueJson FROM AppSettings').all();
  const defaults = getDefaultAppSettings();
  rows.forEach((row) => {
    try {
      defaults[row.key] = JSON.parse(row.valueJson);
    } catch {
      defaults[row.key] = defaults[row.key] || null;
    }
  });
  if (!Array.isArray(defaults.payments?.courseOverrides)) {
    defaults.payments = {
      defaultCycleLength: 8,
      defaultFirstPaymentLesson: 1,
      courseOverrides: []
    };
  }
  return defaults;
}

function saveAppSettings(payload = {}) {
  const db = getDb();
  const now = toIsoDate(new Date());
  const next = getDefaultAppSettings();
  const payments = payload.payments || {};
  next.payments = {
    defaultCycleLength: Math.max(1, Number(payments.defaultCycleLength || 8)),
    defaultFirstPaymentLesson: Math.max(1, Number(payments.defaultFirstPaymentLesson || 1)),
    courseOverrides: Array.isArray(payments.courseOverrides)
      ? payments.courseOverrides
        .map((row) => ({
          courseId: Number(row.courseId || 0),
          cycleLength: Math.max(1, Number(row.cycleLength || 8)),
          firstPaymentLesson: Math.max(1, Number(row.firstPaymentLesson || 1))
        }))
        .filter((row) => row.courseId)
      : []
  };

  db.prepare(`
    INSERT INTO AppSettings (key, valueJson, updatedAt)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      valueJson = excluded.valueJson,
      updatedAt = excluded.updatedAt
  `).run('payments', JSON.stringify(next.payments), now);

  addAuditLog({
    actionType: 'settings.update',
    entityType: 'settings',
    actor: 'local-user',
    summary: 'Обновлены настройки оплат и циклов',
    payloadJson: next.payments
  });

  return getAppSettings();
}

function getPaymentConfigForCourse(db, courseId) {
  const settings = getAppSettings();
  const payments = settings.payments || getDefaultAppSettings().payments;
  const override = Array.isArray(payments.courseOverrides)
    ? payments.courseOverrides.find((row) => Number(row.courseId) === Number(courseId))
    : null;
  const cycleLength = Math.max(1, Number(override?.cycleLength || payments.defaultCycleLength || 8));
  const firstPaymentLesson = Math.max(1, Number(override?.firstPaymentLesson || payments.defaultFirstPaymentLesson || 1));
  return { cycleLength, firstPaymentLesson };
}

function computePaymentMetrics(totalAttended, paymentsDone, config) {
  const cycleLength = Math.max(1, Number(config?.cycleLength || 8));
  const firstPaymentLesson = Math.max(1, Number(config?.firstPaymentLesson || 1));
  const attended = Math.max(0, Number(totalAttended || 0));
  const paid = Math.max(0, Number(paymentsDone || 0));

  let requiredPayments = 0;
  if (attended >= firstPaymentLesson) {
    requiredPayments = 1 + Math.floor(Math.max(0, attended - firstPaymentLesson) / cycleLength);
  }

  const cycleProgress = attended > 0
    ? ((attended - 1) % cycleLength) + 1
    : 0;

  return {
    cycleLength,
    firstPaymentLesson,
    attendedTotal: attended,
    paymentsDone: paid,
    requiredPayments,
    cycleProgress
  };
}

function archiveEntity(payload = {}) {
  const db = getDb();
  const now = toIsoDate(new Date());
  const result = db.prepare(`
    INSERT INTO ArchivedEntities (entityType, entityCategory, entityName, sourceId, snapshotJson, deletedAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    String(payload.entityType || ''),
    String(payload.entityCategory || ''),
    String(payload.entityName || ''),
    payload.sourceId == null ? null : Number(payload.sourceId),
    JSON.stringify(payload.snapshot || {}),
    now
  );
  return { id: Number(result.lastInsertRowid || 0), deletedAt: now };
}

function listArchivedEntities(filters = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  if (filters.entityCategory) {
    where.push('entityCategory = ?');
    params.push(String(filters.entityCategory));
  }
  const query = String(filters.query || '').trim();
  if (query) {
    where.push('(LOWER(entityName) LIKE LOWER(?) OR LOWER(snapshotJson) LIKE LOWER(?))');
    params.push(`%${query}%`, `%${query}%`);
  }
  const rows = db.prepare(`
    SELECT id, entityType, entityCategory, entityName, sourceId, snapshotJson, deletedAt
    FROM ArchivedEntities
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY id DESC
  `).all(...params);

  return rows.map((row) => {
    let snapshot = {};
    try {
      snapshot = JSON.parse(row.snapshotJson || '{}');
    } catch {
      snapshot = {};
    }
    return { ...row, snapshot };
  });
}

function deleteArchivedEntity(payload = {}) {
  const id = Number(typeof payload === 'object' ? payload.id : payload);
  if (!id) throw new Error('Не выбран архивный элемент.');
  const db = getDb();
  const archived = db.prepare('SELECT id, entityType, entityCategory, entityName FROM ArchivedEntities WHERE id = ?').get(id);
  if (!archived) return { success: false };
  db.prepare('DELETE FROM ArchivedEntities WHERE id = ?').run(id);
  addAuditLog({
    actionType: 'archive.delete',
    entityType: archived.entityType,
    entityId: archived.id,
    actor: 'local-user',
    summary: `Архив удален навсегда: ${archived.entityName}`,
    payloadJson: {
      archiveId: archived.id,
      entityCategory: archived.entityCategory
    }
  });
  return { success: true };
}

function restoreArchivedEntity(payload = {}) {
  const id = Number(typeof payload === 'object' ? payload.id : payload);
  if (!id) throw new Error('Не выбрана архивная запись.');
  const db = getDb();
  const archived = db.prepare('SELECT id, entityType, entityCategory, entityName, snapshotJson FROM ArchivedEntities WHERE id = ?').get(id);
  if (!archived) throw new Error('Архивная запись не найдена.');

  let snapshot = {};
  try {
    snapshot = JSON.parse(archived.snapshotJson || '{}');
  } catch {
    throw new Error('Архивная запись повреждена.');
  }

  const txn = db.transaction(() => {
    if (archived.entityType === 'queue' || archived.entityCategory === 'queue') {
      const result = db.prepare(`
        INSERT INTO QueueChildren (
          cityId, studioId, childFullName, childIIN, parentFullName, parentIIN, comment,
          phone, queueDate, queueNumber, queueCategory, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        Number(snapshot.cityId || 0),
        Number(snapshot.studioId || 0),
        snapshot.childFullName || archived.entityName,
        snapshot.childIIN || '',
        snapshot.parentFullName || '',
        snapshot.parentIIN || '',
        snapshot.comment || '',
        snapshot.phone || '',
        snapshot.queueDate || '',
        snapshot.queueNumber || '',
        snapshot.queueCategory || '',
        toIsoDate(new Date())
      );
      db.prepare('DELETE FROM ArchivedEntities WHERE id = ?').run(id);
      return { restoredId: Number(result.lastInsertRowid || 0), entityType: 'queue' };
    }

    const childInsert = db.prepare('INSERT INTO Children (studioId, courseId, groupId, type, messageTag) VALUES (?, ?, ?, ?, ?)');
    const childResult = childInsert.run(
      Number(snapshot.studioId || 0),
      Number(snapshot.courseId || 0),
      snapshot.groupId ? Number(snapshot.groupId) : null,
      archived.entityCategory === 'paid' ? 'paid' : 'voucher',
      snapshot.messageTag || ''
    );
    const childId = Number(childResult.lastInsertRowid || 0);

    if (archived.entityCategory === 'paid') {
      db.prepare(`
        INSERT INTO PaidProfile (
          childId, childFullName, childIIN, childBirthDate, manualAge, manualAgeSetDate, childAge,
          parentPhone, parentFullName, enrollmentDate, paymentStartDate, lastPaymentDate, lessonsCount
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        childId,
        snapshot.childFullName || archived.entityName,
        snapshot.childIIN || '',
        snapshot.childBirthDate || null,
        snapshot.manualAge ?? null,
        snapshot.manualAgeSetDate || null,
        Number(snapshot.childAge || 0),
        snapshot.parentPhone || '',
        snapshot.parentFullName || '',
        snapshot.enrollmentDate || toIsoDate(new Date()),
        snapshot.paymentStartDate || snapshot.enrollmentDate || toIsoDate(new Date()),
        snapshot.lastPaymentDate || null,
        Number(snapshot.lessonsCount || 0)
      );
    } else {
      db.prepare(`
        INSERT INTO VoucherProfile (
          childId, parentFullName, parentIIN, parentEmail, parentPhone, childFullName, childIIN, importSource,
          childBirthDate, manualAge, manualAgeSetDate, childAge, voucherNumber, enrollmentDate, voucherEndDate
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        childId,
        snapshot.parentFullName || '',
        snapshot.parentIIN || '',
        snapshot.parentEmail || '',
        snapshot.parentPhone || '',
        snapshot.childFullName || archived.entityName,
        snapshot.childIIN || '',
        snapshot.importSource || '',
        snapshot.childBirthDate || null,
        snapshot.manualAge ?? null,
        snapshot.manualAgeSetDate || null,
        Number(snapshot.childAge || 0),
        snapshot.voucherNumber || '',
        snapshot.enrollmentDate || toIsoDate(new Date()),
        snapshot.voucherEndDate || snapshot.enrollmentDate || toIsoDate(new Date())
      );
    }

    db.prepare('DELETE FROM ArchivedEntities WHERE id = ?').run(id);
    return { restoredId: childId, entityType: 'child' };
  });

  const result = txn();
  addAuditLog({
    actionType: 'archive.restore',
    entityType: result.entityType,
    entityId: result.restoredId,
    actor: 'local-user',
    summary: `Восстановлена запись из архива: ${archived.entityName}`,
    payloadJson: {
      archiveId: id,
      entityCategory: archived.entityCategory
    }
  });
  return { success: true, ...result };
}

function addAuditLog(payload = {}) {
  const db = getDb();
  const actionType = String(payload.actionType || '').trim();
  const actor = String(payload.actor || 'local-user').trim() || 'local-user';
  const summary = String(payload.summary || '').trim();
  if (!actionType || !summary) return null;

  const entityType = payload.entityType ? String(payload.entityType).trim() : null;
  const entityId = payload.entityId === undefined || payload.entityId === null ? null : String(payload.entityId);
  const payloadJson = payload.payloadJson == null ? null : JSON.stringify(payload.payloadJson);
  const createdAt = toIsoDateTime(new Date());

  const result = db.prepare(`
    INSERT INTO AuditLogs (actionType, entityType, entityId, actor, summary, payloadJson, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(actionType, entityType, entityId, actor, summary, payloadJson, createdAt);

  return { id: Number(result.lastInsertRowid || 0) };
}

function listAuditLogs(filters = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  const actionType = String(filters.actionType || '').trim();
  const actor = String(filters.actor || '').trim();
  const dateFrom = normalizeIsoDate(filters.dateFrom);
  const dateTo = normalizeIsoDate(filters.dateTo);
  const query = String(filters.query || '').trim();
  const limitRaw = Number(filters.limit || 200);
  const limit = Number.isFinite(limitRaw) ? Math.min(1000, Math.max(1, Math.floor(limitRaw))) : 200;

  if (actionType) {
    where.push('al.actionType = ?');
    params.push(actionType);
  }
  if (actor) {
    where.push('LOWER(al.actor) LIKE LOWER(?)');
    params.push(`%${actor}%`);
  }
  if (dateFrom) {
    where.push('date(al.createdAt) >= date(?)');
    params.push(dateFrom);
  }
  if (dateTo) {
    where.push('date(al.createdAt) <= date(?)');
    params.push(dateTo);
  }
  if (query) {
    where.push('(LOWER(al.summary) LIKE LOWER(?) OR LOWER(COALESCE(al.payloadJson, \'\')) LIKE LOWER(?))');
    params.push(`%${query}%`, `%${query}%`);
  }

  let sql = `
    SELECT al.id, al.actionType, al.entityType, al.entityId, al.actor, al.summary, al.payloadJson, al.createdAt
    FROM AuditLogs al
  `;
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY al.id DESC LIMIT ?';

  const rows = db.prepare(sql).all(...params, limit);
  return rows.map((row) => {
    let payloadJson = null;
    try {
      payloadJson = row.payloadJson ? JSON.parse(row.payloadJson) : null;
    } catch {
      payloadJson = null;
    }
    return {
      ...row,
      payloadJson
    };
  });
}

function deleteAuditLog(id) {
  const db = getDb();
  const auditId = Number(id);
  if (!auditId) throw new Error('Не указана запись аудита.');
  db.prepare('DELETE FROM AuditLogs WHERE id = ?').run(auditId);
  return { success: true, id: auditId };
}

function computeAgeForProfile(profile, previousProfile) {
  const today = toIsoDate(new Date());
  const hasManualAge = String(profile.manualAge ?? '').trim() !== '';
  const calc = calculateAge({
    childIIN: profile.childIIN,
    childBirthDate: profile.childBirthDate,
    manualAge: hasManualAge ? Number(profile.manualAge) : null,
    manualAgeSetDate: hasManualAge ? previousProfile?.manualAgeSetDate || today : null
  });

  if (calc.age === null) {
    throw new Error('Укажите ИИН ребенка, дату рождения или возраст.');
  }

  return {
    childBirthDate: calc.birthDate,
    childAge: calc.age,
    manualAge: calc.source === 'manualAge' ? Number(profile.manualAge) : null,
    manualAgeSetDate: calc.source === 'manualAge' ? previousProfile?.manualAgeSetDate || today : null
  };
}

function validateChildPayload(payload) {
  if (!payload.studioId || !payload.courseId || !payload.type) {
    throw new Error('Заполните студию, кружок и тип ребенка.');
  }

  const profile = payload.profile || {};

  if (!validatePhone(profile.parentPhone)) {
    throw new Error('Телефон родителя должен содержать от 10 до 15 цифр.');
  }

  if (!validateIin(profile.childIIN)) {
    throw new Error('ИИН ребенка должен содержать 12 цифр.');
  }

  if (payload.type === 'voucher' && !validateIin(profile.parentIIN)) {
    throw new Error('ИИН родителя должен содержать 12 цифр.');
  }
}

function listCities() {
  return getDb().prepare('SELECT id, name FROM Cities ORDER BY name').all();
}

function saveCity(payload) {
  const db = getDb();
  if (payload.id) {
    db.prepare('UPDATE Cities SET name = ? WHERE id = ?').run(payload.name, payload.id);
    return { id: payload.id };
  }

  const result = db.prepare('INSERT INTO Cities (name) VALUES (?)').run(payload.name);
  return { id: result.lastInsertRowid };
}

function deleteCity(id) {
  getDb().prepare('DELETE FROM Cities WHERE id = ?').run(id);
  return { success: true };
}

function listStudios(filters = {}) {
  const db = getDb();
  if (filters.cityId) {
    return db
      .prepare(`
        SELECT s.id, s.name, s.cityId, c.name AS cityName
        FROM Studios s
        JOIN Cities c ON c.id = s.cityId
        WHERE s.cityId = ?
        ORDER BY s.name
      `)
      .all(filters.cityId);
  }

  return db
    .prepare(`
      SELECT s.id, s.name, s.cityId, c.name AS cityName
      FROM Studios s
      JOIN Cities c ON c.id = s.cityId
      ORDER BY c.name, s.name
    `)
    .all();
}

function saveStudio(payload) {
  const db = getDb();
  if (payload.id) {
    db.prepare('UPDATE Studios SET name = ?, cityId = ? WHERE id = ?').run(payload.name, payload.cityId, payload.id);
    return { id: payload.id };
  }

  const result = db.prepare('INSERT INTO Studios (name, cityId) VALUES (?, ?)').run(payload.name, payload.cityId);
  return { id: result.lastInsertRowid };
}

function deleteStudio(id) {
  getDb().prepare('DELETE FROM Studios WHERE id = ?').run(id);
  return { success: true };
}

function listCourses(filters = {}) {
  const db = getDb();
  let sql = `
    SELECT co.id, co.name, co.studioId, s.name AS studioName, c.id AS cityId, c.name AS cityName
    FROM Courses co
    JOIN Studios s ON s.id = co.studioId
    JOIN Cities c ON c.id = s.cityId
  `;
  const params = [];
  const where = [];

  if (filters.studioId) {
    where.push('co.studioId = ?');
    params.push(filters.studioId);
  }
  if (filters.cityId) {
    where.push('c.id = ?');
    params.push(filters.cityId);
  }

  if (where.length) {
    sql += ` WHERE ${where.join(' AND ')}`;
  }

  sql += ' ORDER BY c.name, s.name, co.name';
  return db.prepare(sql).all(...params);
}

function saveCourse(payload) {
  const db = getDb();

  const txn = db.transaction(() => {
    if (payload.id) {
      db.prepare('UPDATE Courses SET name = ?, studioId = ? WHERE id = ?').run(payload.name, payload.studioId, payload.id);
      return { id: payload.id };
    }

    const result = db.prepare('INSERT INTO Courses (name, studioId) VALUES (?, ?)').run(payload.name, payload.studioId);
    const courseId = result.lastInsertRowid;
    db.prepare('INSERT INTO CourseGroups (courseId, name) VALUES (?, ?)').run(courseId, 'Группа 1');
    return { id: courseId };
  });

  return txn();
}

function deleteCourse(id) {
  getDb().prepare('DELETE FROM Courses WHERE id = ?').run(id);
  return { success: true };
}

function listGroups(courseId) {
  return getDb().prepare('SELECT id, courseId, name FROM CourseGroups WHERE courseId = ? ORDER BY name').all(courseId);
}

function saveGroup(payload) {
  const db = getDb();
  if (payload.id) {
    db.prepare('UPDATE CourseGroups SET name = ? WHERE id = ?').run(payload.name, payload.id);
    return { id: payload.id };
  }
  const result = db.prepare('INSERT INTO CourseGroups (courseId, name) VALUES (?, ?)').run(payload.courseId, payload.name);
  return { id: result.lastInsertRowid };
}

function deleteGroup(id) {
  getDb().prepare('DELETE FROM CourseGroups WHERE id = ?').run(id);
  return { success: true };
}

function listGroupSchedule(groupId) {
  return getDb().prepare('SELECT id, groupId, weekday, startTime, endTime FROM GroupSchedule WHERE groupId = ? ORDER BY weekday').all(groupId);
}

function monthStartFromIso(isoDate) {
  const [y, m] = String(isoDate).slice(0, 7).split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

function monthEndFromIso(isoDate) {
  const [y, m] = String(isoDate).slice(0, 7).split('-').map(Number);
  return toIsoDate(new Date(y, m, 0));
}

function nextMonthStartIso() {
  const now = new Date();
  return toIsoDate(new Date(now.getFullYear(), now.getMonth() + 1, 1));
}

function monthKeysBetween(dateFrom, dateTo) {
  const out = [];
  const from = new Date(`${dateFrom}T00:00:00`);
  const to = new Date(`${dateTo}T00:00:00`);
  let y = from.getFullYear();
  let m = from.getMonth();
  while (true) {
    out.push(`${y}-${String(m + 1).padStart(2, '0')}`);
    if (y === to.getFullYear() && m === to.getMonth()) break;
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

function ensurePlannedDatesForMonth(db, groupId, ym, weekdays) {
  const monthStart = `${ym}-01`;
  const monthEnd = monthEndFromIso(monthStart);
  const hasSnapshot = db
    .prepare('SELECT 1 FROM AttendancePlannedDates WHERE groupId = ? AND sessionDate BETWEEN ? AND ? LIMIT 1')
    .get(groupId, monthStart, monthEnd);
  const hasSessions = db
    .prepare('SELECT 1 FROM AttendanceSessions WHERE groupId = ? AND sessionDate BETWEEN ? AND ? LIMIT 1')
    .get(groupId, monthStart, monthEnd);

  if (hasSnapshot || hasSessions || !weekdays?.size) return;

  const nowIso = toIsoDate(new Date());
  const insert = db.prepare(
    'INSERT OR IGNORE INTO AttendancePlannedDates (groupId, sessionDate, source, createdAt) VALUES (?, ?, ?, ?)'
  );
  iterateDates(monthStart, monthEnd).forEach((date) => {
    if (weekdays.has(weekdayFromIsoDate(date))) {
      insert.run(groupId, date, 'schedule', nowIso);
    }
  });
}

function ensurePlannedDatesForRange(db, groupId, dateFrom, dateTo) {
  const schedule = listGroupSchedule(groupId);
  const weekdays = new Set(schedule.map((x) => Number(x.weekday)));
  monthKeysBetween(dateFrom, dateTo).forEach((ym) => ensurePlannedDatesForMonth(db, groupId, ym, weekdays));
}

function rebuildFuturePlannedDates(db, groupId) {
  const start = nextMonthStartIso();
  const from = new Date(`${start}T00:00:00`);
  const end = new Date(from.getFullYear(), from.getMonth() + 12, 0);
  const endIso = toIsoDate(end);
  const schedule = listGroupSchedule(groupId);
  const weekdays = new Set(schedule.map((x) => Number(x.weekday)));
  const nowIso = toIsoDate(new Date());
  const insert = db.prepare(
    'INSERT OR IGNORE INTO AttendancePlannedDates (groupId, sessionDate, source, createdAt) VALUES (?, ?, ?, ?)'
  );

  db.prepare('DELETE FROM AttendancePlannedDates WHERE groupId = ? AND sessionDate >= ?').run(groupId, start);
  if (!weekdays.size) return;

  iterateDates(start, endIso).forEach((date) => {
    if (weekdays.has(weekdayFromIsoDate(date))) {
      insert.run(groupId, date, 'schedule', nowIso);
    }
  });
}

function saveGroupSchedule(payload) {
  const db = getDb();
  const items = (payload.items || []).filter((x) => Number(x.weekday) >= 1 && Number(x.weekday) <= 7);

  const txn = db.transaction(() => {
    db.prepare('DELETE FROM GroupSchedule WHERE groupId = ?').run(payload.groupId);
    const stmt = db.prepare('INSERT INTO GroupSchedule (groupId, weekday, startTime, endTime) VALUES (?, ?, ?, ?)');
    items.forEach((item) => stmt.run(payload.groupId, Number(item.weekday), item.startTime || null, item.endTime || null));
    rebuildFuturePlannedDates(db, payload.groupId);
  });

  txn();
  return { success: true };
}

function listStructureTree() {
  const cities = listCities().map((city) => ({ ...city, studios: [] }));
  const studios = listStudios();
  const courses = listCourses();
  const groups = getDb().prepare('SELECT id, courseId, name FROM CourseGroups ORDER BY name').all();
  const schedules = getDb()
    .prepare('SELECT groupId, weekday, startTime, endTime FROM GroupSchedule ORDER BY weekday')
    .all();

  const cityMap = new Map(cities.map((x) => [x.id, x]));
  const studioMap = new Map();
  const courseMap = new Map();
  const childrenByStudio = new Map();
  const childrenByCourse = new Map();
  const childrenByGroup = new Map();
  const childrenByCity = new Map();

  getDb()
    .prepare(`
      SELECT ch.studioId, ch.courseId, ch.groupId, st.cityId, COUNT(*) AS childrenCount
      FROM Children ch
      JOIN Studios st ON st.id = ch.studioId
      GROUP BY ch.studioId, ch.courseId, ch.groupId, st.cityId
    `)
    .all()
    .forEach((row) => {
      const count = Number(row.childrenCount || 0);
      childrenByStudio.set(row.studioId, Number(childrenByStudio.get(row.studioId) || 0) + count);
      childrenByCourse.set(row.courseId, Number(childrenByCourse.get(row.courseId) || 0) + count);
      if (row.groupId) {
        childrenByGroup.set(row.groupId, Number(childrenByGroup.get(row.groupId) || 0) + count);
      }
      childrenByCity.set(row.cityId, Number(childrenByCity.get(row.cityId) || 0) + count);
    });

  studios.forEach((studio) => {
    const item = { ...studio, courses: [], childrenCount: Number(childrenByStudio.get(studio.id) || 0) };
    studioMap.set(studio.id, item);
    if (cityMap.has(studio.cityId)) {
      cityMap.get(studio.cityId).studios.push(item);
    }
  });

  courses.forEach((course) => {
    const item = { ...course, groups: [], childrenCount: Number(childrenByCourse.get(course.id) || 0) };
    courseMap.set(course.id, item);
    if (studioMap.has(course.studioId)) {
      studioMap.get(course.studioId).courses.push(item);
    }
  });

  const scheduleByGroup = new Map();
  schedules.forEach((s) => {
    if (!scheduleByGroup.has(s.groupId)) scheduleByGroup.set(s.groupId, []);
    scheduleByGroup.get(s.groupId).push({
      weekday: s.weekday,
      startTime: s.startTime || '',
      endTime: s.endTime || ''
    });
  });

  groups.forEach((g) => {
    if (courseMap.has(g.courseId)) {
      courseMap.get(g.courseId).groups.push({
        ...g,
        childrenCount: Number(childrenByGroup.get(g.id) || 0),
        schedule: scheduleByGroup.get(g.id) || []
      });
    }
  });

  return cities.map((city) => ({
    ...city,
    childrenCount: Number(childrenByCity.get(city.id) || 0)
  }));
}

function recalculateLessonsForGroup(db, groupId) {
  const childIds = db.prepare('SELECT id FROM Children WHERE groupId = ? AND type = ?').all(groupId, 'paid');
  childIds.forEach((row) => recalculateLessonsForChild(db, row.id));
}

function recalculateLessonsForChild(db, childId) {
  const child = db.prepare('SELECT id, courseId FROM Children WHERE id = ? AND type = ?').get(childId, 'paid');
  if (!child) return;
  const metrics = getCycleMetrics(db, childId);
  db.prepare('UPDATE PaidProfile SET lessonsCount = ? WHERE childId = ?').run(metrics.cycleProgress, childId);
}

function getCycleMetrics(db, childId) {
  const row = db
    .prepare(`
      SELECT
        c.courseId,
        (
          SELECT COUNT(*)
          FROM AttendanceRecords r
          JOIN AttendanceSessions s ON s.id = r.sessionId
          WHERE r.childId = c.id
            AND s.status = 'conducted'
            AND r.status IN ('present', 'absent-other', 'absent-valid')
        ) AS attendedTotal,
        (
          SELECT COUNT(*)
          FROM PaymentTransactions pt
          WHERE pt.childId = c.id
        ) AS paymentsDone
      FROM Children c
      JOIN PaidProfile pp ON pp.childId = c.id
      WHERE c.id = ?
    `)
    .get(childId);

  const attendedTotal = Number(row?.attendedTotal || 0);
  const paymentsDone = Number(row?.paymentsDone || 0);
  const config = getPaymentConfigForCourse(db, row?.courseId);
  return computePaymentMetrics(attendedTotal, paymentsDone, config);
}

function listChildren(filters = {}) {
  const db = getDb();
  let query = `
    SELECT
      ch.id,
      ch.type,
      ch.studioId,
      ch.courseId,
      ch.groupId,
      ch.messageTag,
      city.id AS cityId,
      city.name AS cityName,
      st.name AS studioName,
      co.name AS courseName,
      gr.name AS groupName,
      vp.childFullName AS voucherChildName,
      pp.childFullName AS paidChildName,
      vp.parentPhone AS voucherParentPhone,
      pp.parentPhone AS paidParentPhone,
      vp.parentFullName AS voucherParentName,
      pp.parentFullName AS paidParentName,
      vp.parentEmail AS voucherParentEmail,
      vp.parentIIN AS voucherParentIIN,
      vp.childIIN AS voucherChildIIN,
      pp.childIIN AS paidChildIIN,
      vp.childBirthDate AS voucherBirthDate,
      pp.childBirthDate AS paidBirthDate,
      vp.manualAge AS voucherManualAge,
      pp.manualAge AS paidManualAge,
      vp.manualAgeSetDate AS voucherManualAgeSetDate,
      vp.importSource AS importSource,
      pp.manualAgeSetDate AS paidManualAgeSetDate,
      vp.voucherEndDate,
      pp.lastPaymentDate,
      pp.lessonsCount,
      pc.comment AS paymentComment
    FROM Children ch
    JOIN Studios st ON st.id = ch.studioId
    JOIN Cities city ON city.id = st.cityId
    JOIN Courses co ON co.id = ch.courseId
    LEFT JOIN CourseGroups gr ON gr.id = ch.groupId
    LEFT JOIN VoucherProfile vp ON vp.childId = ch.id
    LEFT JOIN PaidProfile pp ON pp.childId = ch.id
    LEFT JOIN (
      SELECT pc1.*
      FROM PaymentComments pc1
      JOIN (
        SELECT childId, MAX(id) AS maxId
        FROM PaymentComments
        GROUP BY childId
      ) latest ON latest.maxId = pc1.id
    ) pc ON pc.childId = ch.id
  `;

  const params = [];
  const where = [];
  if (filters.cityId) {
    where.push('city.id = ?');
    params.push(filters.cityId);
  }
  if (filters.studioId) {
    where.push('ch.studioId = ?');
    params.push(filters.studioId);
  }
  if (filters.courseId) {
    where.push('ch.courseId = ?');
    params.push(filters.courseId);
  }
  if (filters.groupId) {
    where.push('ch.groupId = ?');
    params.push(filters.groupId);
  }
  if (filters.type) {
    where.push('ch.type = ?');
    params.push(filters.type);
  }
  if (filters.messageTag !== undefined) {
    if (String(filters.messageTag).trim()) {
      where.push('LOWER(ch.messageTag) = LOWER(?)');
      params.push(normalizeMessageTag(filters.messageTag));
    } else {
      where.push("(ch.messageTag IS NULL OR ch.messageTag = '')");
    }
  }

  if (where.length) query += ` WHERE ${where.join(' AND ')}`;
  query += ' ORDER BY city.name, st.name, co.name, gr.name, COALESCE(vp.childFullName, pp.childFullName)';

  const rows = db.prepare(query).all(...params);
  return rows.map((row) => {
    const childIIN = row.type === 'voucher' ? row.voucherChildIIN : row.paidChildIIN;
    const childBirthDate = row.type === 'voucher' ? row.voucherBirthDate : row.paidBirthDate;
    const manualAge = row.type === 'voucher' ? row.voucherManualAge : row.paidManualAge;
    const manualAgeSetDate = row.type === 'voucher' ? row.voucherManualAgeSetDate : row.paidManualAgeSetDate;
    const ageCalc = calculateAge({ childIIN, childBirthDate, manualAge, manualAgeSetDate });

    const paymentConfig = row.type === 'paid' ? getPaymentConfigForCourse(db, row.courseId) : null;
    return {
      ...row,
      childName: row.type === 'voucher' ? row.voucherChildName : row.paidChildName,
      parentPhone: row.type === 'voucher' ? row.voucherParentPhone : row.paidParentPhone,
      parentName: row.type === 'voucher' ? row.voucherParentName : row.paidParentName,
      parentEmail: row.type === 'voucher' ? row.voucherParentEmail : '',
      parentIIN: row.type === 'voucher' ? row.voucherParentIIN : '',
      childIIN,
      childBirthDate: ageCalc.birthDate || childBirthDate || null,
      childAge: ageCalc.age,
      importSource: row.type === 'voucher' ? String(row.importSource || '').trim().toLowerCase() : '',
      cycleLength: paymentConfig?.cycleLength || null,
      firstPaymentLesson: paymentConfig?.firstPaymentLesson || null
    };
  });
}

function listQueueChildren(filters = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  if (filters.cityId) {
    where.push('qc.cityId = ?');
    params.push(Number(filters.cityId));
  }
  if (filters.studioId) {
    where.push('qc.studioId = ?');
    params.push(Number(filters.studioId));
  }

  const rows = db
    .prepare(`
      SELECT
        qc.id,
        qc.cityId,
        qc.studioId,
        qc.childFullName,
        qc.childIIN,
        qc.parentFullName,
        qc.parentIIN,
        qc.comment,
        qc.phone,
        qc.queueDate,
        qc.queueNumber,
        qc.previousQueueNumber,
        qc.queueShift,
        qc.queueUpdatedAt,
        qc.queueCategory,
        city.name AS cityName,
        st.name AS studioName
      FROM QueueChildren qc
      LEFT JOIN Cities city ON city.id = qc.cityId
      LEFT JOIN Studios st ON st.id = qc.studioId
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY
        CASE WHEN UPPER(CAST(qc.queueNumber AS TEXT)) = 'ВАУЧЕР' THEN 1 ELSE 0 END ASC,
        CAST(qc.queueNumber AS INTEGER) ASC,
        qc.id ASC
    `)
    .all(...params);

  return rows.map((row) => {
    const ageInfo = calculateAge({ childIIN: row.childIIN });
    return {
      ...row,
      childBirthDate: ageInfo.birthDate,
      childAge: ageInfo.age,
      queueShift: row.queueShift == null ? null : Number(row.queueShift)
    };
  });
}

function saveQueueChild(payload) {
  const db = getDb();
  const now = toIsoDate(new Date());
  const queueNumberRaw = String(payload.queueNumber || '').trim();
  const isVoucherMark = queueNumberRaw.toUpperCase() === 'ВАУЧЕР';
  const queueNumber = isVoucherMark ? 'ВАУЧЕР' : Number(queueNumberRaw || 0);
  if (!payload.childFullName || !payload.childIIN || !payload.parentFullName || !payload.parentIIN || !payload.phone) {
    throw new Error('Заполните обязательные поля очередника.');
  }
  if (!isVoucherMark && (!payload.queueDate || !queueNumber || !payload.queueCategory)) {
    throw new Error('Заполните данные очереди: дата, номер и категория.');
  }
  if (!payload.cityId || !payload.studioId) {
    throw new Error('Выберите город и студию.');
  }

  if (payload.id) {
    db.prepare(`
      UPDATE QueueChildren
      SET cityId = ?, studioId = ?, childFullName = ?, childIIN = ?, parentFullName = ?, parentIIN = ?,
          comment = ?, phone = ?, queueDate = ?, queueNumber = ?, queueCategory = ?
      WHERE id = ?
    `).run(
      Number(payload.cityId),
      Number(payload.studioId),
      payload.childFullName,
      payload.childIIN,
      payload.parentFullName,
      payload.parentIIN,
      payload.comment || '',
      payload.phone,
      payload.queueDate || '',
      queueNumber,
      payload.queueCategory || '',
      payload.id
    );
    addAuditLog({
      actionType: 'queue.update',
      entityType: 'queue',
      entityId: payload.id,
      actor: 'local-user',
      summary: `Изменены данные очередника: ${payload.childFullName}`,
      payloadJson: {
        queueNumber,
        queueCategory: payload.queueCategory || ''
      }
    });
    return { id: payload.id };
  }

  const result = db.prepare(`
    INSERT INTO QueueChildren (
      cityId, studioId, childFullName, childIIN, parentFullName, parentIIN, comment,
      phone, queueDate, queueNumber, queueCategory, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Number(payload.cityId),
    Number(payload.studioId),
    payload.childFullName,
    payload.childIIN,
    payload.parentFullName,
    payload.parentIIN,
    payload.comment || '',
    payload.phone,
    payload.queueDate || '',
    queueNumber,
    payload.queueCategory || '',
    now
  );

  addAuditLog({
    actionType: 'queue.create',
    entityType: 'queue',
    entityId: result.lastInsertRowid,
    actor: 'local-user',
    summary: `Добавлен очередник: ${payload.childFullName}`,
    payloadJson: {
      queueNumber,
      queueCategory: payload.queueCategory || ''
    }
  });

  return { id: result.lastInsertRowid };
}

function deleteQueueChild(payload) {
  const db = getDb();
  const queueId = Number(typeof payload === 'object' && payload !== null ? payload.id : payload);
  if (!queueId) throw new Error('Не выбрана запись очереди.');
  const row = db.prepare(`
    SELECT id, cityId, studioId, childFullName, childIIN, parentFullName, parentIIN, comment, phone, queueDate, queueNumber, queueCategory
    FROM QueueChildren
    WHERE id = ?
  `).get(queueId);
  const result = db.transaction(() => {
    if (row) {
      archiveEntity({
        entityType: 'queue',
        entityCategory: 'queue',
        entityName: row.childFullName || `ID ${queueId}`,
        sourceId: queueId,
        snapshot: row
      });
    }
    return db.prepare('DELETE FROM QueueChildren WHERE id = ?').run(queueId);
  })();
  if (result.changes) {
    addAuditLog({
      actionType: 'queue.delete',
      entityType: 'queue',
      entityId: queueId,
      actor: 'local-user',
      summary: `Удален очередник: ${row?.childFullName || `ID ${queueId}`}`,
      payloadJson: {
        queueId,
        queueNumber: row?.queueNumber || ''
      }
    });
  }
  return { success: true };
}

const PIPELINE_STATUSES = ['queue', 'voucher-approved', 'attending', 'risk', 'churned'];

function defaultPipelineStatusForItem() {
  return 'queue';
}

function daysSinceIso(dateIso, todayIsoDate) {
  const iso = normalizeIsoDate(dateIso);
  const today = normalizeIsoDate(todayIsoDate) || toIsoDate(new Date());
  if (!iso || !today) return null;
  const from = new Date(`${iso}T00:00:00`);
  const to = new Date(`${today}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.floor((to.getTime() - from.getTime()) / (24 * 3600 * 1000));
}

function resolveAutoPipelineStatus(row) {
  const manual = String(row.stageStatus || '').trim();
  if (manual === 'churned') return 'churned';

  const presentCount = Number(row.presentCount || 0);
  const recentAbsences = Number(row.recentAbsences || 0);
  const attendedTotal = Number(row.attendedTotal || 0);
  const paymentsDone = Number(row.paymentsDone || 0);
  const requiredPayments = attendedTotal > 0 ? 1 + Math.floor(attendedTotal / 8) : 0;
  const hasDebt = requiredPayments > paymentsDone;
  const hasAbsenceRisk = recentAbsences >= 3;

  if (hasDebt || hasAbsenceRisk) return 'risk';
  if (presentCount > 0) return 'attending';
  return 'queue';
}

function resolveAutoTaskList(row, today) {
  const tasks = [];
  const attendedTotal = Number(row.attendedTotal || 0);
  const paymentsDone = Number(row.paymentsDone || 0);
  const requiredPayments = attendedTotal > 0 ? 1 + Math.floor(attendedTotal / 8) : 0;
  const debtCount = Math.max(0, requiredPayments - paymentsDone);
  const debtDays = daysSinceIso(row.lastPaymentDate || row.enrollmentDate || row.paymentStartDate, today);
  if (debtCount > 0 && Number(debtDays || 0) >= 3) {
    const signature = `debt:${debtCount}:${debtDays}`;
    tasks.push({
      taskType: 'debt-3days',
      taskSignature: signature,
      title: 'Долг 3+ дня',
      description: `Долг по оплате: ${debtCount}. Без оплаты уже ${debtDays} дн.`,
      deadlineDate: today
    });
  }

  const noAttendanceDays = daysSinceIso(row.lastPresentDate || row.lastAttendanceDate || row.enrollmentDate, today);
  if (Number(noAttendanceDays || 0) >= 7) {
    const signature = `attendance-gap:${noAttendanceDays}`;
    tasks.push({
      taskType: 'no-attendance-7days',
      taskSignature: signature,
      title: 'Не было посещений 7+ дней',
      description: `Нет посещений уже ${noAttendanceDays} дн.`,
      deadlineDate: today
    });
  }
  return tasks;
}

function isoNow() {
  return new Date();
}

function isOlderThanHours(isoDateTime, hours) {
  if (!isoDateTime) return false;
  const dt = new Date(isoDateTime);
  if (Number.isNaN(dt.getTime())) return false;
  return (isoNow().getTime() - dt.getTime()) >= hours * 3600 * 1000;
}

function ensurePipelineStageRow(db, row, autoStatus, reason) {
  const now = toIsoDate(new Date());
  const existing = db.prepare('SELECT id FROM PipelineStages WHERE entityType = ? AND entityId = ?').get('child', row.entityId);
  if (!existing) {
    db.prepare(`
      INSERT INTO PipelineStages (
        entityType, entityId, status, managerName, taskText, deadlineDate, churnReason, taskDone, taskDoneAt, taskDoneBy, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('child', row.entityId, autoStatus, '', '', null, null, 0, null, null, now);
    db.prepare(`
      INSERT INTO PipelineStatusHistory (entityType, entityId, fromStatus, toStatus, reason, changedBy, changedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('child', row.entityId, null, autoStatus, reason || 'auto-init', 'system:auto', now);
    return;
  }

  const current = String(row.stageStatus || '').trim();
  if (current && current === autoStatus) return;
  if (current === 'churned' && autoStatus !== 'churned') return;

  db.prepare(`
    UPDATE PipelineStages
    SET status = ?, updatedAt = ?
    WHERE entityType = ? AND entityId = ?
  `).run(autoStatus, now, 'child', row.entityId);

  db.prepare(`
    INSERT INTO PipelineStatusHistory (entityType, entityId, fromStatus, toStatus, reason, changedBy, changedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('child', row.entityId, current || null, autoStatus, reason || 'auto-sync', 'system:auto', now);
}

function listPipelineItems(filters = {}) {
  const db = getDb();
  const today = toIsoDate(new Date());
  const childRows = db
    .prepare(`
      SELECT
        'child' AS entityType,
        ch.id AS entityId,
        ch.type AS childType,
        COALESCE(vp.childFullName, pp.childFullName, '') AS childFullName,
        COALESCE(vp.parentFullName, pp.parentFullName, '') AS parentFullName,
        COALESCE(vp.parentPhone, pp.parentPhone, '') AS parentPhone,
        city.id AS cityId,
        city.name AS cityName,
        st.id AS studioId,
        st.name AS studioName,
        co.name AS courseName,
        ps.status AS stageStatus,
        ps.managerName,
        ps.taskText,
        ps.deadlineDate,
        ps.churnReason,
        ps.taskDone,
        ps.taskDoneAt,
        ps.taskDoneBy,
        ps.updatedAt,
        (
          SELECT COUNT(*)
          FROM AttendanceRecords r
          JOIN AttendanceSessions s ON s.id = r.sessionId
          WHERE r.childId = ch.id
            AND s.status = 'conducted'
            AND r.status = 'present'
        ) AS presentCount,
        (
          SELECT COUNT(*)
          FROM AttendanceRecords r
          JOIN AttendanceSessions s ON s.id = r.sessionId
          WHERE r.childId = ch.id
            AND s.status = 'conducted'
            AND r.status IN ('present', 'absent-other', 'absent-valid')
        ) AS attendedTotal,
        (
          SELECT COUNT(*)
          FROM PaymentTransactions pt
          WHERE pt.childId = ch.id
        ) AS paymentsDone,
        pp.paymentStartDate,
        pp.enrollmentDate,
        pp.lastPaymentDate,
        (
          SELECT COUNT(*)
          FROM (
            SELECT r.status
            FROM AttendanceRecords r
            JOIN AttendanceSessions s ON s.id = r.sessionId
            WHERE r.childId = ch.id
              AND s.status = 'conducted'
            ORDER BY s.sessionDate DESC, s.id DESC
            LIMIT 3
          ) last3
          WHERE last3.status <> 'present'
        ) AS recentAbsences
        ,
        (
          SELECT MAX(s.sessionDate)
          FROM AttendanceRecords r
          JOIN AttendanceSessions s ON s.id = r.sessionId
          WHERE r.childId = ch.id
            AND s.status = 'conducted'
            AND r.status = 'present'
        ) AS lastPresentDate,
        (
          SELECT MAX(s.sessionDate)
          FROM AttendanceRecords r
          JOIN AttendanceSessions s ON s.id = r.sessionId
          WHERE r.childId = ch.id
            AND s.status = 'conducted'
            AND r.status IN ('present', 'absent-other', 'absent-valid')
        ) AS lastAttendanceDate
      FROM Children ch
      LEFT JOIN VoucherProfile vp ON vp.childId = ch.id
      LEFT JOIN PaidProfile pp ON pp.childId = ch.id
      JOIN Studios st ON st.id = ch.studioId
      JOIN Cities city ON city.id = st.cityId
      JOIN Courses co ON co.id = ch.courseId
      LEFT JOIN PipelineStages ps ON ps.entityType = 'child' AND ps.entityId = ch.id
      WHERE ch.type = 'paid'
    `)
    .all();

  childRows.forEach((row) => {
    const autoStatus = resolveAutoPipelineStatus(row);
    const reason = autoStatus === 'risk'
      ? (Number(row.recentAbsences || 0) >= 3 ? 'auto:absence-3' : 'auto:debt')
      : (autoStatus === 'attending' ? 'auto:first-visit' : 'auto:new-paid');
    ensurePipelineStageRow(db, row, autoStatus, reason);
  });

  const completedAutoRows = db
    .prepare(`
      SELECT entityType, entityId, taskType, taskSignature, completedAt
      FROM PipelineAutoTaskCompletions
      WHERE entityType = 'child'
    `)
    .all();
  const completedMap = new Set(
    completedAutoRows.map((x) => `${x.entityType}:${x.entityId}:${x.taskType}:${x.taskSignature}`)
  );
  const completionByTypeMap = new Map();
  completedAutoRows.forEach((row) => {
    const key = `${row.entityType}:${row.entityId}:${row.taskType}`;
    const prev = completionByTypeMap.get(key);
    if (!prev || String(prev.completedAt || '') < String(row.completedAt || '')) {
      completionByTypeMap.set(key, row);
    }
  });

  const rows = childRows
    .map((row) => {
      const attendedTotal = Number(row.attendedTotal || 0);
      const paymentsDone = Number(row.paymentsDone || 0);
      const requiredPayments = attendedTotal > 0 ? 1 + Math.floor(attendedTotal / 8) : 0;
      const hasDebt = requiredPayments > paymentsDone;
      const recentAbsences = Number(row.recentAbsences || 0);
      const hasAbsenceRisk = recentAbsences >= 3;
      const riskReason = hasDebt
        ? 'Долг по оплате'
        : (hasAbsenceRisk ? `Пропуски: ${recentAbsences} подряд` : '');
      const autoTasks = resolveAutoTaskList(row, today)
        .map((task) => {
          const isDone = completedMap.has(`child:${row.entityId}:${task.taskType}:${task.taskSignature}`);
          const key = `child:${row.entityId}:${task.taskType}`;
          const last = completionByTypeMap.get(key);
          const isCooldown = !isDone && !!last?.completedAt && !isOlderThanHours(last.completedAt, 72);
          return {
            ...task,
            isDone,
            isCooldown
          };
        })
        .filter((task) => !task.isCooldown);

      return {
        ...row,
        status: resolveAutoPipelineStatus(row) || defaultPipelineStatusForItem(row),
        managerName: String(row.managerName || '').trim(),
        taskText: String(row.taskText || '').trim(),
        deadlineDate: String(row.deadlineDate || '').trim(),
        churnReason: String(row.churnReason || '').trim(),
        updatedAt: String(row.updatedAt || ''),
        taskDone: Number(row.taskDone || 0) === 1,
        taskDoneAt: String(row.taskDoneAt || ''),
        taskDoneBy: String(row.taskDoneBy || ''),
        presentCount: Number(row.presentCount || 0),
        attendedTotal,
        paymentsDone,
        requiredPayments,
        recentAbsences,
        riskReason,
        autoTasks
      };
    })
    .filter((row) => {
      if (filters.cityId && Number(row.cityId) !== Number(filters.cityId)) return false;
      if (filters.studioId && Number(row.studioId) !== Number(filters.studioId)) return false;
      if (filters.status && row.status !== String(filters.status)) return false;
      if (filters.search) {
        const q = String(filters.search).trim().toLowerCase();
        if (q) {
          const hay = `${row.childFullName} ${row.parentFullName} ${row.parentPhone} ${row.cityName} ${row.studioName}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
      }
      return true;
    })
    .sort((a, b) => a.childFullName.localeCompare(b.childFullName, 'ru'));

  return rows;
}

function savePipelineItem(payload = {}) {
  const db = getDb();
  const entityType = String(payload.entityType || '').trim();
  const entityId = Number(payload.entityId || 0);
  const status = String(payload.status || '').trim();
  const managerName = String(payload.managerName || '').trim();
  let taskText = String(payload.taskText || '').trim();
  const deadlineDate = normalizeIsoDate(payload.deadlineDate);
  const churnReason = String(payload.churnReason || '').trim();
  const taskDone = Number(payload.taskDone ? 1 : 0);
  const taskDoneAt = taskDone ? toIsoDate(new Date()) : null;
  const taskDoneBy = taskDone ? String(payload.taskDoneBy || 'manager').trim() : null;
  const reason = String(payload.reason || '').trim();
  const changedBy = String(payload.changedBy || 'manager').trim() || 'manager';
  const updatedAt = toIsoDate(new Date());
  if (status === 'risk' && !taskText) {
    taskText = 'Связаться с родителем: звонок / WhatsApp / перенос встречи.';
  }

  if (entityType !== 'child') throw new Error('Воронка доступна только для платников.');
  if (!entityId) throw new Error('Некорректный элемент воронки.');
  if (!PIPELINE_STATUSES.includes(status)) throw new Error('Некорректный статус воронки.');

  const exists = db.prepare("SELECT id FROM Children WHERE id = ? AND type = 'paid'").get(entityId);
  if (!exists) throw new Error('Платник не найден.');

  const prev = db.prepare('SELECT status FROM PipelineStages WHERE entityType = ? AND entityId = ?').get(entityType, entityId);

  db.prepare(`
    INSERT INTO PipelineStages (
      entityType, entityId, status, managerName, taskText, deadlineDate, churnReason, taskDone, taskDoneAt, taskDoneBy, updatedAt
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entityType, entityId) DO UPDATE SET
      status = excluded.status,
      managerName = excluded.managerName,
      taskText = excluded.taskText,
      deadlineDate = excluded.deadlineDate,
      churnReason = excluded.churnReason,
      taskDone = excluded.taskDone,
      taskDoneAt = excluded.taskDoneAt,
      taskDoneBy = excluded.taskDoneBy,
      updatedAt = excluded.updatedAt
  `).run(
    entityType,
    entityId,
    status,
    managerName,
    taskText,
    deadlineDate || null,
    churnReason || null,
    taskDone,
    taskDoneAt,
    taskDoneBy,
    updatedAt
  );

  const prevStatus = String(prev?.status || '').trim();
  if (prevStatus !== status) {
    db.prepare(`
      INSERT INTO PipelineStatusHistory (entityType, entityId, fromStatus, toStatus, reason, changedBy, changedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(entityType, entityId, prevStatus || null, status, reason || 'manual-update', changedBy, updatedAt);
  }

  return { success: true };
}

function listPipelineStatusHistory(filters = {}) {
  const db = getDb();
  const limit = Math.max(1, Math.min(500, Number(filters.limit || 120)));
  const where = ['h.entityType = ?'];
  const params = ['child'];
  if (filters.mode === 'auto') {
    where.push("h.changedBy = 'system:auto'");
  } else if (filters.mode === 'manual') {
    where.push("h.changedBy <> 'system:auto'");
  }
  if (filters.managerName) {
    where.push('LOWER(h.changedBy) LIKE ?');
    params.push(`%${String(filters.managerName).trim().toLowerCase()}%`);
  }
  if (filters.dateFrom) {
    where.push('h.changedAt >= ?');
    params.push(String(filters.dateFrom));
  }
  if (filters.dateTo) {
    where.push('h.changedAt <= ?');
    params.push(String(filters.dateTo));
  }
  const rows = db
    .prepare(`
      SELECT
        h.id,
        h.entityType,
        h.entityId,
        h.fromStatus,
        h.toStatus,
        h.reason,
        h.changedBy,
        h.changedAt,
        COALESCE(vp.childFullName, pp.childFullName, '') AS childFullName
      FROM PipelineStatusHistory h
      LEFT JOIN Children ch ON ch.id = h.entityId
      LEFT JOIN VoucherProfile vp ON vp.childId = ch.id
      LEFT JOIN PaidProfile pp ON pp.childId = ch.id
      WHERE ${where.join(' AND ')}
      ORDER BY h.id DESC
      LIMIT ?
    `)
    .all(...params, limit);
  return rows;
}

function completePipelineAutoTask(payload = {}) {
  const db = getDb();
  const entityType = String(payload.entityType || '').trim();
  const entityId = Number(payload.entityId || 0);
  const taskType = String(payload.taskType || '').trim();
  const taskSignature = String(payload.taskSignature || '').trim();
  const completedBy = String(payload.completedBy || 'manager').trim() || 'manager';
  const completedAt = toIsoDate(new Date());

  if (entityType !== 'child') throw new Error('Некорректный тип задачи.');
  if (!entityId || !taskType || !taskSignature) throw new Error('Некорректные данные задачи.');

  db.prepare(`
    INSERT INTO PipelineAutoTaskCompletions (entityType, entityId, taskType, taskSignature, completedBy, completedAt)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(entityType, entityId, taskType, taskSignature) DO UPDATE SET
      completedBy = excluded.completedBy,
      completedAt = excluded.completedAt
  `).run(entityType, entityId, taskType, taskSignature, completedBy, completedAt);

  return { success: true };
}

function getPipelineManagerKpi(filters = {}) {
  const rows = listPipelineItems(filters);
  const byManager = new Map();

  const ensure = (name) => {
    const key = String(name || 'Без менеджера').trim() || 'Без менеджера';
    if (!byManager.has(key)) {
      byManager.set(key, {
        managerName: key,
        cardsTotal: 0,
        manualTasksDone: 0,
        attendingCount: 0,
        churnedCount: 0
      });
    }
    return byManager.get(key);
  };

  rows.forEach((row) => {
    const bucket = ensure(row.managerName);
    bucket.cardsTotal += 1;
    if (row.taskDone) bucket.manualTasksDone += 1;
    if (row.status === 'attending') bucket.attendingCount += 1;
    if (row.status === 'churned') bucket.churnedCount += 1;
  });

  return Array.from(byManager.values())
    .map((row) => ({
      ...row,
      conversionRate: row.cardsTotal > 0 ? Math.round((row.attendingCount * 100) / row.cardsTotal) : 0,
      churnRate: row.cardsTotal > 0 ? Math.round((row.churnedCount * 100) / row.cardsTotal) : 0
    }))
    .sort((a, b) => b.cardsTotal - a.cardsTotal);
}

function getPipelineTaskSlaStats(filters = {}) {
  const rows = listPipelineItems(filters);
  const today = toIsoDate(new Date());
  let overdueToday = 0;
  let noReaction24h = 0;

  rows.forEach((row) => {
    const manualOpen = !!(row.taskText && !row.taskDone);
    const autoOpen = (row.autoTasks || []).some((task) => !task.isDone);
    if (!manualOpen && !autoOpen) return;

    const manualOverdue = manualOpen && row.deadlineDate && row.deadlineDate <= today;
    const autoOverdue = (row.autoTasks || []).some((task) => !task.isDone && task.deadlineDate && task.deadlineDate <= today);
    if (manualOverdue || autoOverdue) overdueToday += 1;

    const anchor = row.updatedAt || '';
    if (isOlderThanHours(anchor, 24)) noReaction24h += 1;
  });

  return {
    overdueToday,
    noReaction24h,
    redTotal: overdueToday + noReaction24h
  };
}

function getPipelineTimeline(payload = {}) {
  const db = getDb();
  const childId = Number(payload.childId || 0);
  if (!childId) throw new Error('Не указан ребенок для таймлайна.');

  const statusRows = db.prepare(`
    SELECT changedAt AS eventAt, 'status' AS eventType, fromStatus, toStatus, reason, changedBy
    FROM PipelineStatusHistory
    WHERE entityType = 'child' AND entityId = ?
  `).all(childId);

  const paymentRows = db.prepare(`
    SELECT paidDate AS eventAt, 'payment' AS eventType, amount, paymentMethod, comment
    FROM PaymentTransactions
    WHERE childId = ?
  `).all(childId);

  const attendanceRows = db.prepare(`
    SELECT s.sessionDate AS eventAt, 'attendance' AS eventType, r.status, s.status AS sessionStatus, r.note
    FROM AttendanceRecords r
    JOIN AttendanceSessions s ON s.id = r.sessionId
    WHERE r.childId = ?
  `).all(childId);

  const manualTaskRows = db.prepare(`
    SELECT updatedAt AS eventAt, 'task' AS eventType, taskText, deadlineDate, taskDone, taskDoneAt, taskDoneBy
    FROM PipelineStages
    WHERE entityType = 'child' AND entityId = ? AND taskText IS NOT NULL AND taskText <> ''
  `).all(childId);

  const autoTaskRows = db.prepare(`
    SELECT completedAt AS eventAt, 'auto-task' AS eventType, taskType, taskSignature, completedBy
    FROM PipelineAutoTaskCompletions
    WHERE entityType = 'child' AND entityId = ?
  `).all(childId);

  return [...statusRows, ...paymentRows, ...attendanceRows, ...manualTaskRows, ...autoTaskRows]
    .sort((a, b) => String(b.eventAt || '').localeCompare(String(a.eventAt || '')));
}

async function refreshQueueChildren(payload = {}) {
  const db = getDb();
  const ids = Array.isArray(payload.ids) ? payload.ids.map(Number).filter(Boolean) : [];
  const where = ids.length ? `WHERE qc.id IN (${ids.map(() => '?').join(',')})` : '';
  const rows = db
    .prepare(`
      SELECT
        qc.id,
        qc.childIIN,
        qc.childFullName,
        qc.queueNumber,
        qc.queueNumber AS previousQueueNumber,
        city.name AS cityName,
        st.name AS studioName
      FROM QueueChildren qc
      LEFT JOIN Cities city ON city.id = qc.cityId
      LEFT JOIN Studios st ON st.id = qc.studioId
      ${where}
      ORDER BY qc.id
    `)
    .all(...ids);

  const update = db.prepare(
    'UPDATE QueueChildren SET previousQueueNumber = ?, queueShift = ?, queueNumber = ?, queueDate = ?, queueCategory = ?, queueUpdatedAt = ? WHERE id = ?'
  );

  const result = {
    total: rows.length,
    updated: 0,
    failed: 0,
    voucherCount: 0,
    items: []
  };

  for (const row of rows) {
    try {
      const data = await checkQueueByIin(row.childIIN);
      const normalizedQueueNumber = String(data.queueNumber || '').replace(/\D+/g, '').trim();
      const previousQueueNumber = String(row.previousQueueNumber || row.queueNumber || '').trim();
      const nextQueueNumber = normalizedQueueNumber || 'ВАУЧЕР';
      const previousNumeric = /^\d+$/.test(previousQueueNumber) ? Number(previousQueueNumber) : null;
      const nextNumeric = /^\d+$/.test(nextQueueNumber) ? Number(nextQueueNumber) : null;
      const queueShift = previousNumeric !== null && nextNumeric !== null ? nextNumeric - previousNumeric : null;
      update.run(previousQueueNumber, queueShift, nextQueueNumber, data.queueDate || '', data.queueCategory || '', toIsoDateTime(new Date()), row.id);
      result.updated += 1;
      const ageInfo = calculateAge({ childIIN: row.childIIN });
      result.items.push({
        id: row.id,
        iin: row.childIIN,
        childFullName: row.childFullName,
        childAge: ageInfo.age,
        cityName: row.cityName || '',
        studioName: row.studioName || '',
        previousQueueNumber,
        queueNumber: nextQueueNumber,
        queueDate: data.queueDate || '',
        queueCategory: data.queueCategory || '',
        queueShift,
        status: 'ok'
      });
    } catch (e) {
      const message = e?.message || 'Ошибка обновления';
      if (
        /очередь не найдена|не удалось распарсить данные очереди|check-voucher-row|statement|not found|fetch failed|network/i.test(message)
      ) {
        update.run(String(row.previousQueueNumber || row.queueNumber || '').trim(), null, 'ВАУЧЕР', '', '', toIsoDateTime(new Date()), row.id);
        result.updated += 1;
        result.voucherCount += 1;
        const ageInfo = calculateAge({ childIIN: row.childIIN });
        result.items.push({
          id: row.id,
          iin: row.childIIN,
          childFullName: row.childFullName,
          childAge: ageInfo.age,
          cityName: row.cityName || '',
          studioName: row.studioName || '',
          previousQueueNumber: String(row.previousQueueNumber || '').trim(),
          queueNumber: 'ВАУЧЕР',
          queueDate: '',
          queueCategory: '',
          queueShift: null,
          status: 'voucher'
        });
      } else {
        result.failed += 1;
        result.items.push({
          id: row.id,
          iin: row.childIIN,
          childFullName: row.childFullName,
          status: 'error',
          error: message
        });
      }
    }
  }

  return result;
}

function saveChild(payload) {
  validateChildPayload(payload);
  const db = getDb();
  const profile = payload.profile || {};
  const messageTag = payload.type === 'voucher' ? normalizeMessageTag(payload.messageTag) : '';

  const txn = db.transaction(() => {
    let childId = payload.id;
    let previousProfile = null;
    let previousChild = null;
    let transferCreated = null;

    if (childId) {
      previousChild = db.prepare('SELECT * FROM Children WHERE id = ?').get(childId);
      previousProfile = payload.type === 'voucher'
        ? db.prepare('SELECT * FROM VoucherProfile WHERE childId = ?').get(childId)
        : db.prepare('SELECT * FROM PaidProfile WHERE childId = ?').get(childId);

      const shouldTrackTransfer =
        previousChild
        && previousChild.groupId
        && payload.groupId
        && Number(previousChild.groupId) !== Number(payload.groupId)
        && payload.type === 'paid'
        && previousChild.type === 'paid';

      if (shouldTrackTransfer) {
        const createdAt = toIsoDate(new Date());
        const effectiveDate = normalizeIsoDate(payload.transferEffectiveDate) || addDaysIso(createdAt, 1);
        const fromGroupName = getGroupNameById(db, previousChild.groupId);
        const toGroupName = getGroupNameById(db, payload.groupId);
        db.prepare(`
          INSERT INTO ChildGroupTransfers (
            childId, fromStudioId, fromCourseId, fromGroupId, toStudioId, toCourseId, toGroupId, effectiveDate, createdAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          childId,
          previousChild.studioId || null,
          previousChild.courseId || null,
          previousChild.groupId || null,
          payload.studioId || null,
          payload.courseId || null,
          payload.groupId || null,
          effectiveDate,
          createdAt
        );
        transferCreated = {
          fromGroupId: previousChild.groupId,
          toGroupId: payload.groupId,
          fromGroupName,
          toGroupName,
          effectiveDate
        };
      }

      db.prepare('UPDATE Children SET studioId = ?, courseId = ?, groupId = ?, type = ?, messageTag = ? WHERE id = ?').run(
        payload.studioId,
        payload.courseId,
        payload.groupId || null,
        payload.type,
        messageTag,
        childId
      );
      db.prepare('DELETE FROM VoucherProfile WHERE childId = ?').run(childId);
      db.prepare('DELETE FROM PaidProfile WHERE childId = ?').run(childId);
    } else {
      const result = db
        .prepare('INSERT INTO Children (studioId, courseId, groupId, type, messageTag) VALUES (?, ?, ?, ?, ?)')
        .run(payload.studioId, payload.courseId, payload.groupId || null, payload.type, messageTag);
      childId = result.lastInsertRowid;
    }

    const ageFields = computeAgeForProfile(profile, previousProfile);

    if (payload.type === 'voucher') {
      const importSource = String(profile.importSource || previousProfile?.importSource || '').trim().toLowerCase();
      db.prepare(`
        INSERT INTO VoucherProfile (
          childId, parentFullName, parentIIN, parentEmail, parentPhone,
          childFullName, childIIN, importSource, childBirthDate, manualAge, manualAgeSetDate, childAge,
          voucherNumber, enrollmentDate, voucherEndDate
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        childId,
        profile.parentFullName,
        profile.parentIIN,
        profile.parentEmail || '',
        profile.parentPhone,
        profile.childFullName,
        profile.childIIN || '',
        importSource,
        ageFields.childBirthDate,
        ageFields.manualAge,
        ageFields.manualAgeSetDate,
        ageFields.childAge,
        profile.voucherNumber,
        profile.enrollmentDate,
        profile.voucherEndDate
      );
    } else {
      db.prepare(`
        INSERT INTO PaidProfile (
          childId, childFullName, childIIN, childBirthDate, manualAge, manualAgeSetDate, childAge,
          parentPhone, parentFullName, enrollmentDate, paymentStartDate, lastPaymentDate, lessonsCount
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        childId,
        profile.childFullName,
        profile.childIIN || '',
        ageFields.childBirthDate,
        ageFields.manualAge,
        ageFields.manualAgeSetDate,
        ageFields.childAge,
        profile.parentPhone,
        profile.parentFullName || '',
        profile.enrollmentDate,
        profile.paymentStartDate || profile.enrollmentDate,
        profile.lastPaymentDate || null,
        Number(profile.lessonsCount || 0)
      );
    }

    return { childId, transferCreated };
  });

  const { childId, transferCreated } = txn();
  addAuditLog({
    actionType: payload.id ? 'children.update' : 'children.create',
    entityType: 'child',
    entityId: childId,
    actor: payload.actor || 'local-user',
    summary: `${payload.id ? 'Изменены данные' : 'Добавлен ребенок'}: ${profile.childFullName || `ID ${childId}`}`,
    payloadJson: {
      childId,
      type: payload.type,
      messageTag,
      transferCreated
    }
  });
  if (transferCreated) {
    addAuditLog({
      actionType: 'children.transfer',
      entityType: 'child',
      entityId: childId,
      actor: payload.actor || 'local-user',
      summary: `Ребенок переведен из группы ${transferCreated.fromGroupName || '—'} в группу ${transferCreated.toGroupName || '—'} с ${formatHumanDate(transferCreated.effectiveDate)}`,
      payloadJson: {
        childId,
        fromGroupId: transferCreated.fromGroupId,
        fromGroupName: transferCreated.fromGroupName || '',
        toGroupId: transferCreated.toGroupId,
        toGroupName: transferCreated.toGroupName || '',
        effectiveDate: transferCreated.effectiveDate
      }
    });
  }
  return { id: childId };
}

function getChildById(childId) {
  const db = getDb();
  const child = db.prepare(`
    SELECT
      ch.id,
      ch.studioId,
      ch.courseId,
      ch.groupId,
      ch.type,
      ch.messageTag,
      city.name AS cityName,
      st.name AS studioName,
      co.name AS courseName,
      gr.name AS groupName
    FROM Children ch
    JOIN Studios st ON st.id = ch.studioId
    JOIN Cities city ON city.id = st.cityId
    JOIN Courses co ON co.id = ch.courseId
    LEFT JOIN CourseGroups gr ON gr.id = ch.groupId
    WHERE ch.id = ?
  `).get(childId);
  if (!child) return null;

  child.profile = child.type === 'voucher'
    ? db.prepare('SELECT * FROM VoucherProfile WHERE childId = ?').get(childId)
    : db.prepare('SELECT * FROM PaidProfile WHERE childId = ?').get(childId);

  const ageCalc = calculateAge(child.profile || {});
  child.profile.childBirthDate = ageCalc.birthDate || child.profile.childBirthDate || '';
  child.profile.childAge = ageCalc.age;

  if (child.type === 'paid') {
    const cycle = getCycleMetrics(db, childId);
    child.profile.lessonsCount = cycle.cycleProgress;
    child.profile.attendedTotal = cycle.attendedTotal;
    child.profile.requiredPayments = cycle.requiredPayments;
    child.profile.paymentsDone = cycle.paymentsDone;
    child.profile.cycleLength = cycle.cycleLength;
    child.profile.firstPaymentLesson = cycle.firstPaymentLesson;
  }

  return child;
}

function deleteChild(payload) {
  const db = getDb();
  const childId = Number(typeof payload === 'object' && payload !== null ? payload.id : payload);
  const actor = String(typeof payload === 'object' && payload !== null ? (payload.actor || 'local-user') : 'local-user');
  if (!childId) throw new Error('Не выбран ребенок для удаления.');

  const child = db.prepare(`
    SELECT
      ch.id,
      ch.type,
      ch.studioId,
      ch.courseId,
      ch.groupId,
      ch.messageTag,
      COALESCE(vp.childFullName, pp.childFullName) AS childFullName,
      COALESCE(vp.parentPhone, pp.parentPhone) AS parentPhone,
      COALESCE(vp.childIIN, pp.childIIN) AS childIIN,
      vp.parentIIN,
      vp.voucherNumber,
      vp.importSource,
      pp.lastPaymentDate
    FROM Children ch
    LEFT JOIN VoucherProfile vp ON vp.childId = ch.id
    LEFT JOIN PaidProfile pp ON pp.childId = ch.id
    WHERE ch.id = ?
  `).get(childId);

  const result = db.transaction(() => {
    if (child) {
      archiveEntity({
        entityType: 'child',
        entityCategory: child.type,
        entityName: child.childFullName || `ID ${childId}`,
        sourceId: childId,
        snapshot: child
      });
    }
    return db.prepare('DELETE FROM Children WHERE id = ?').run(childId);
  })();
  if (!result.changes) return { success: false, deleted: 0 };

  addAuditLog({
    actionType: 'children.delete',
    entityType: 'child',
    entityId: childId,
    actor,
    summary: `Удален ребенок: ${child?.childFullName || `ID ${childId}`}`,
    payloadJson: {
      childId,
      childName: child?.childFullName || '',
      childType: child?.type || ''
    }
  });

  return { success: true };
}

function setChildrenMessageTag(payload = {}) {
  const ids = Array.isArray(payload.ids) ? payload.ids.map(Number).filter(Boolean) : [];
  const tag = normalizeMessageTag(payload.messageTag);
  if (!ids.length) throw new Error('Не выбраны дети.');

  const db = getDb();
  const result = db.prepare(`
    UPDATE Children
    SET messageTag = ?
    WHERE type = 'voucher' AND id IN (${ids.map(() => '?').join(',')})
  `).run(tag, ...ids);

  addAuditLog({
    actionType: 'children.tag.update',
    entityType: 'child',
    entityId: ids.length === 1 ? ids[0] : null,
    actor: payload.actor || 'local-user',
    summary: `Изменена пометка у ${Number(result.changes || 0)} учеников`,
    payloadJson: {
      ids,
      messageTag: tag
    }
  });

  return { success: true, updated: Number(result.changes || 0) };
}

function setChildrenCourse(payload = {}) {
  const ids = Array.isArray(payload.ids) ? payload.ids.map(Number).filter(Boolean) : [];
  const courseId = Number(payload.courseId || 0);
  if (!ids.length) throw new Error('Не выбраны дети.');
  if (!courseId) throw new Error('Не выбран кружок.');

  const db = getDb();
  const course = db.prepare('SELECT id, studioId, name FROM Courses WHERE id = ?').get(courseId);
  if (!course) throw new Error('Кружок не найден.');

  const result = db.prepare(`
    UPDATE Children
    SET courseId = ?, groupId = NULL
    WHERE type = 'voucher'
      AND studioId = ?
      AND id IN (${ids.map(() => '?').join(',')})
  `).run(course.id, course.studioId, ...ids);

  addAuditLog({
    actionType: 'children.course.update',
    entityType: 'child',
    actor: payload.actor || 'local-user',
    summary: `Назначен кружок "${course.name}" для ${Number(result.changes || 0)} учеников`,
    payloadJson: {
      ids,
      courseId: course.id,
      courseName: course.name
    }
  });

  return { success: true, updated: Number(result.changes || 0) };
}

function importExternalVouchers(payload = {}, options = {}) {
  const rows = Array.isArray(payload.items) ? payload.items : [];
  const db = getDb();
  const fallbackStudioId = Number(payload.studioId || 0);
  const fallbackCityId = Number(payload.cityId || 0);
  const sourceName = String(options.sourceName || 'External').trim() || 'External';
  const voucherPrefix = String(options.voucherPrefix || sourceName).trim().toUpperCase() || 'EXTERNAL';
  const importSource = String(options.importSource || '').trim().toLowerCase();

  const findCityByName = db.prepare('SELECT id, name FROM Cities WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1');
  const insertCity = db.prepare('INSERT INTO Cities (name) VALUES (?)');
  const findStudioByName = db.prepare(
    'SELECT id, cityId, name FROM Studios WHERE cityId = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1'
  );
  const insertStudio = db.prepare('INSERT INTO Studios (name, cityId) VALUES (?, ?)');
  const findCourseByName = db.prepare(
    'SELECT id, studioId, name FROM Courses WHERE studioId = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1'
  );
  const insertCourse = db.prepare('INSERT INTO Courses (name, studioId) VALUES (?, ?)');
  const ensureDefaultGroup = db.prepare('INSERT INTO CourseGroups (courseId, name) VALUES (?, ?)');
  const fallbackCity = fallbackCityId ? db.prepare('SELECT id, name FROM Cities WHERE id = ?').get(fallbackCityId) : null;
  const fallbackStudio = fallbackStudioId ? db.prepare('SELECT id, cityId, name FROM Studios WHERE id = ?').get(fallbackStudioId) : null;

  function ensureCity(cityNameRaw) {
    const cityName = String(cityNameRaw || '').trim() || fallbackCity?.name || 'Не указан';
    let city = findCityByName.get(cityName);
    if (!city) {
      const res = insertCity.run(cityName);
      city = { id: Number(res.lastInsertRowid), name: cityName };
    }
    return city;
  }

  function ensureStudio(city, studioNameRaw) {
    const studioName = String(studioNameRaw || '').trim() || fallbackStudio?.name || `${sourceName} Studio`;
    let studio = findStudioByName.get(city.id, studioName);
    if (!studio) {
      const res = insertStudio.run(studioName, city.id);
      studio = { id: Number(res.lastInsertRowid), cityId: city.id, name: studioName };
    }
    return studio;
  }

  function ensureCourse(studio, courseNameRaw) {
    const courseName = String(courseNameRaw || '').trim() || sourceName;
    let course = findCourseByName.get(studio.id, courseName);
    if (!course) {
      const res = insertCourse.run(courseName, studio.id);
      course = { id: Number(res.lastInsertRowid), studioId: studio.id, name: courseName };
      ensureDefaultGroup.run(course.id, 'Группа 1');
    }
    return course;
  }

  const findByIin = db.prepare(`
    SELECT ch.id, ch.messageTag
    FROM Children ch
    JOIN VoucherProfile vp ON vp.childId = ch.id
    WHERE ch.type = 'voucher'
      AND ch.studioId = ?
      AND vp.parentIIN = ?
      AND vp.childIIN = ?
    ORDER BY ch.id
    LIMIT 1
  `);
  const findByName = db.prepare(`
    SELECT ch.id, ch.messageTag
    FROM Children ch
    JOIN VoucherProfile vp ON vp.childId = ch.id
    WHERE ch.type = 'voucher'
      AND ch.studioId = ?
      AND vp.parentIIN = ?
      AND LOWER(TRIM(vp.childFullName)) = LOWER(TRIM(?))
    ORDER BY ch.id
    LIMIT 1
  `);

  const result = {
    success: true,
    total: rows.length,
    fetched: Number(payload.fetched || rows.length),
    added: 0,
    updated: 0,
    skipped: 0,
    newChildren: [],
    courseId: null,
    courseName: '',
    errors: []
  };

  rows.forEach((raw, index) => {
    try {
      const childFullName = String(raw?.childFullName || '').replace(/\s+/g, ' ').trim();
      const childIINRaw = cleanDigits(raw?.childIIN || '');
      const childIIN = validateIin(childIINRaw) ? childIINRaw : '';
      const childBirthDate = normalizeIsoDate(raw?.childBirthDate);
      const parentPhone = String(raw?.parentPhone || '').trim();
      const parentIIN = cleanDigits(raw?.parentIIN || '');
      const parentFullName = String(raw?.parentFullName || '').replace(/\s+/g, ' ').trim();
      const parentEmail = String(raw?.parentEmail || '').trim();
      const voucherNumber = String(raw?.voucherNumber || voucherPrefix).trim() || voucherPrefix;
      const enrollmentDate = normalizeIsoDate(raw?.enrollmentDate) || toIsoDate(new Date());
      const voucherEndDate = normalizeIsoDate(raw?.voucherEndDate) || enrollmentDate;
      const city = ensureCity(raw?.cityName || raw?.regionName);
      const studio = ensureStudio(city, raw?.studioName || raw?.organizationName);
      const course = ensureCourse(studio, raw?.courseName || raw?.applicationName);

      if (!childFullName) throw new Error('Пустое ФИО ребенка');
      if (!validatePhone(parentPhone)) throw new Error('Некорректный телефон родителя');
      if (!validateIin(parentIIN)) throw new Error('Некорректный ИИН родителя');

      let existing = null;
      if (childIIN) {
        existing = findByIin.get(studio.id, parentIIN, childIIN);
      }
      if (!existing) {
        existing = findByName.get(studio.id, parentIIN, childFullName);
      }

      saveChild({
        id: existing?.id || undefined,
        studioId: studio.id,
        courseId: course.id,
        groupId: null,
        type: 'voucher',
        messageTag: existing?.messageTag || '',
        profile: {
          childFullName,
          childIIN,
          importSource,
          childBirthDate,
          manualAge: null,
          parentPhone,
          parentFullName: parentFullName || 'Не указано',
          parentIIN,
          parentEmail,
          enrollmentDate,
          voucherNumber,
          voucherEndDate
        }
      });

      if (existing?.id) {
        result.updated += 1;
      } else {
        result.added += 1;
        if (result.newChildren.length < 50) {
          result.newChildren.push(childFullName);
        }
      }
      if (!result.courseId) {
        result.courseId = course.id;
        result.courseName = course.name;
      }
    } catch (error) {
      result.skipped += 1;
      if (result.errors.length < 20) {
        result.errors.push(`Строка ${index + 1}: ${error?.message || 'ошибка импорта'}`);
      }
    }
  });

  addAuditLog({
    actionType: `import.${importSource || sourceName.toLowerCase()}`,
    entityType: 'children',
    actor: payload.actor || 'local-user',
    summary: `Импорт ${sourceName}: добавлено ${result.added}, обновлено ${result.updated}, пропущено ${result.skipped}`,
    payloadJson: {
      source: sourceName,
      total: result.total,
      fetched: result.fetched,
      added: result.added,
      updated: result.updated,
      skipped: result.skipped,
      courseName: result.courseName || '',
      errors: result.errors
    }
  });

  return result;
}

function importDamubalaVouchers(payload = {}) {
  return importExternalVouchers(payload, {
    sourceName: 'Damubala',
    voucherPrefix: 'DAMUBALA',
    importSource: 'damubala'
  });
}

function importQosymshaVouchers(payload = {}) {
  return importExternalVouchers(payload, {
    sourceName: 'Qosymsha',
    voucherPrefix: 'QOSYMSHA',
    importSource: 'qosymsha'
  });
}

function importArtsportVouchers(payload = {}) {
  return importExternalVouchers(payload, {
    sourceName: 'Artsport',
    voucherPrefix: 'ARTSPORT',
    importSource: 'artsport'
  });
}

function clearAllChildrenData() {
  const db = getDb();
  const txn = db.transaction(() => {
    const counters = {};
    counters.queue = Number(db.prepare('SELECT COUNT(*) AS c FROM QueueChildren').get()?.c || 0);
    counters.children = Number(db.prepare('SELECT COUNT(*) AS c FROM Children').get()?.c || 0);

    db.prepare('DELETE FROM QueueChildren').run();
    db.prepare('DELETE FROM PaymentTransactions').run();
    db.prepare('DELETE FROM PaymentComments').run();
    db.prepare('DELETE FROM AttendanceRecords').run();
    db.prepare('DELETE FROM AttendanceSessions').run();
    db.prepare('DELETE FROM AttendancePlannedDates').run();
    db.prepare('DELETE FROM VoucherProfile').run();
    db.prepare('DELETE FROM PaidProfile').run();
    db.prepare('DELETE FROM Children').run();
    return counters;
  });

  return { success: true, ...txn() };
}

function savePaymentComment(payload) {
  const db = getDb();
  const now = toIsoDate(new Date());
  const cycle = getCycleMetrics(db, payload.childId);
  const duePaymentIndex = Number(cycle.requiredPayments || 0) || null;

  const existing = db
    .prepare('SELECT id FROM PaymentComments WHERE childId = ? AND status = ? ORDER BY id DESC LIMIT 1')
    .get(payload.childId, 'pending');

  if (existing) {
    db.prepare('UPDATE PaymentComments SET comment = ?, promisedDate = ?, duePaymentIndex = ?, updatedAt = ? WHERE id = ?').run(
      payload.comment,
      payload.promisedDate || null,
      duePaymentIndex,
      now,
      existing.id
    );
    addAuditLog({
      actionType: 'payments.comment.save',
      entityType: 'child',
      entityId: payload.childId,
      actor: payload.actor || 'local-user',
      summary: 'Обновлен комментарий по оплате',
      payloadJson: {
        childId: payload.childId,
        promisedDate: payload.promisedDate || null
      }
    });
    return { id: existing.id };
  }

  const result = db
    .prepare(
      'INSERT INTO PaymentComments (childId, comment, promisedDate, duePaymentIndex, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(payload.childId, payload.comment, payload.promisedDate || null, duePaymentIndex, 'pending', now, now);

  addAuditLog({
    actionType: 'payments.comment.save',
    entityType: 'child',
    entityId: payload.childId,
    actor: payload.actor || 'local-user',
    summary: 'Добавлен комментарий по оплате',
    payloadJson: {
      childId: payload.childId,
      promisedDate: payload.promisedDate || null
    }
  });

  return { id: result.lastInsertRowid };
}

function markPaymentPaid(payload) {
  const db = getDb();
  const paidDate = payload.paidDate || toIsoDate(new Date());
  const amount = Number(payload.amount || 0);
  const paymentMethod = String(payload.paymentMethod || 'Каспи');
  const comment = String(payload.comment || '').trim();

  const txn = db.transaction(() => {
    const demand = getCycleMetrics(db, payload.childId);
    if (demand.requiredPayments <= demand.paymentsDone) {
      throw new Error('Оплата сейчас не требуется по циклу.');
    }

    db.prepare(
      'INSERT INTO PaymentTransactions (childId, paidDate, amount, comment, paymentMethod, cycleLessons, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(payload.childId, paidDate, amount, comment, paymentMethod, demand.attendedTotal, paidDate);

    db.prepare('UPDATE PaidProfile SET lastPaymentDate = ? WHERE childId = ?').run(paidDate, payload.childId);
    const pendingRows = db
      .prepare('SELECT id, promisedDate FROM PaymentComments WHERE childId = ? AND status = ?')
      .all(payload.childId, 'pending');

    pendingRows.forEach((row) => {
      let paidOnTime = null;
      if (row.promisedDate) paidOnTime = paidDate <= row.promisedDate ? 1 : 0;
      db.prepare('UPDATE PaymentComments SET status = ?, paidDate = ?, paidOnTime = ?, updatedAt = ? WHERE id = ?').run(
        'paid',
        paidDate,
        paidOnTime,
        paidDate,
        row.id
      );
    });

    if (!pendingRows.length) {
      db.prepare(
        'INSERT INTO PaymentComments (childId, comment, promisedDate, duePaymentIndex, status, paidDate, paidOnTime, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(payload.childId, comment, null, demand.requiredPayments || null, 'paid', paidDate, null, paidDate, paidDate);
    }

    recalculateLessonsForChild(db, payload.childId);
  });

  txn();
  addAuditLog({
    actionType: 'payments.mark-paid',
    entityType: 'child',
    entityId: payload.childId,
    actor: payload.actor || 'local-user',
    summary: `Оплата отмечена вручную: ${amount} тг`,
    payloadJson: {
      childId: payload.childId,
      paidDate,
      amount,
      paymentMethod
    }
  });
  return { success: true, paidDate, amount, paymentMethod, comment };
}

function cancelPaymentTransaction(payload) {
  const db = getDb();
  const txId = Number(payload.transactionId);
  if (!txId) throw new Error('Не указан платеж для отмены.');

  const txn = db.transaction(() => {
    const tx = db.prepare('SELECT id, childId FROM PaymentTransactions WHERE id = ?').get(txId);
    if (!tx) throw new Error('Платеж не найден.');

    db.prepare('DELETE FROM PaymentTransactions WHERE id = ?').run(txId);

    const lastTx = db
      .prepare('SELECT paidDate FROM PaymentTransactions WHERE childId = ? ORDER BY id DESC LIMIT 1')
      .get(tx.childId);

    db.prepare('UPDATE PaidProfile SET lastPaymentDate = ? WHERE childId = ?').run(lastTx?.paidDate || null, tx.childId);
    recalculateLessonsForChild(db, tx.childId);
    return tx.childId;
  });

  const childId = txn();
  addAuditLog({
    actionType: 'payments.cancel',
    entityType: 'child',
    entityId: childId,
    actor: payload.actor || 'local-user',
    summary: 'Отменена проведенная оплата',
    payloadJson: {
      childId,
      transactionId: txId
    }
  });
  return { success: true, childId };
}

function weekdayFromIsoDate(isoDate) {
  const day = new Date(isoDate).getDay();
  return day === 0 ? 7 : day;
}

function iterateDates(from, to) {
  const arr = [];
  let cur = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cur <= end) {
    arr.push(toIsoDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return arr;
}

function upsertSessionAndRecords(db, groupId, date, sessionStatus, records) {
  const now = toIsoDate(new Date());
  const existing = db.prepare('SELECT id, status FROM AttendanceSessions WHERE groupId = ? AND sessionDate = ?').get(groupId, date);

  let sessionId;

  if (existing) {
    sessionId = existing.id;
    db.prepare('UPDATE AttendanceSessions SET status = ?, updatedAt = ? WHERE id = ?').run(sessionStatus, now, sessionId);
    db.prepare('DELETE FROM AttendanceRecords WHERE sessionId = ?').run(sessionId);
  } else {
    const result = db
      .prepare('INSERT INTO AttendanceSessions (groupId, sessionDate, status, note, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(groupId, date, sessionStatus, '', now, now);
    sessionId = result.lastInsertRowid;
  }

  const insert = db.prepare('INSERT INTO AttendanceRecords (sessionId, childId, status, note) VALUES (?, ?, ?, ?)');
  records
    .filter((r) => r?.status === 'present' || r?.status === 'absent-other' || r?.status === 'absent-valid' || r?.status === 'sick')
    .forEach((r) => insert.run(sessionId, r.childId, r.status, r.note || ''));
}

function getAttendanceSheet(payload) {
  const db = getDb();
  ensurePlannedDatesForRange(db, payload.groupId, payload.dateFrom, payload.dateTo);

  const plannedDates = db
    .prepare(`
      SELECT sessionDate, source
      FROM AttendancePlannedDates
      WHERE groupId = ? AND sessionDate BETWEEN ? AND ?
      ORDER BY sessionDate
    `)
    .all(payload.groupId, payload.dateFrom, payload.dateTo);

  const sessions = db
    .prepare(`
      SELECT id, sessionDate, status
      FROM AttendanceSessions
      WHERE groupId = ? AND sessionDate BETWEEN ? AND ?
    `)
    .all(payload.groupId, payload.dateFrom, payload.dateTo);

  const sessionByDate = new Map(sessions.map((s) => [s.sessionDate, s]));
  const plannedByDate = new Map(plannedDates.map((d) => [d.sessionDate, d]));
  const allDateSet = new Set([...plannedByDate.keys(), ...sessionByDate.keys()]);
  const dates = Array.from(allDateSet)
    .sort()
    .map((date) => ({ date, source: plannedByDate.get(date)?.source || 'session' }));

  const records = db
    .prepare(`
      SELECT r.sessionId, r.childId, r.status, r.note, s.sessionDate
      FROM AttendanceRecords r
      JOIN AttendanceSessions s ON s.id = r.sessionId
      WHERE s.groupId = ? AND s.sessionDate BETWEEN ? AND ?
    `)
    .all(payload.groupId, payload.dateFrom, payload.dateTo);

  const recordsByDate = new Map();
  records.forEach((r) => {
    if (!recordsByDate.has(r.sessionDate)) recordsByDate.set(r.sessionDate, new Map());
    recordsByDate.get(r.sessionDate).set(r.childId, { status: r.status, note: r.note || '' });
  });

  const transfers = db.prepare(`
    SELECT
      t.childId,
      t.fromGroupId,
      t.toGroupId,
      t.effectiveDate,
      fg.name AS fromGroupName,
      tg.name AS toGroupName
    FROM ChildGroupTransfers t
    LEFT JOIN CourseGroups fg ON fg.id = t.fromGroupId
    LEFT JOIN CourseGroups tg ON tg.id = t.toGroupId
    WHERE (t.fromGroupId = ? OR t.toGroupId = ?)
      AND t.effectiveDate <= ?
    ORDER BY t.effectiveDate DESC, t.id DESC
  `).all(payload.groupId, payload.groupId, payload.dateTo);

  const transferByChild = new Map();
  transfers.forEach((row) => {
    if (!transferByChild.has(row.childId)) {
      transferByChild.set(row.childId, row);
    }
  });

  const children = db
    .prepare(`
      SELECT
        ch.id AS childId,
        ch.type,
        COALESCE(vp.childFullName, pp.childFullName) AS childName,
        pp.lessonsCount
      FROM Children ch
      LEFT JOIN VoucherProfile vp ON vp.childId = ch.id
      LEFT JOIN PaidProfile pp ON pp.childId = ch.id
      WHERE ch.groupId = ?
         OR ch.id IN (
           SELECT childId
           FROM ChildGroupTransfers
           WHERE fromGroupId = ?
             AND effectiveDate <= ?
         )
      ORDER BY childName
    `)
    .all(payload.groupId, payload.groupId, payload.dateTo);

  return {
    dates: dates.map((d) => ({
      date: d.date,
      source: d.source,
      sessionStatus: sessionByDate.get(d.date)?.status || null,
      monthLabel: new Date(d.date).toLocaleDateString('ru-RU', { month: 'long' }),
      dayLabel: new Date(d.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
    })),
    children: children.map((child) => ({
      ...child,
      transferMeta: (() => {
        const transfer = transferByChild.get(child.childId);
        if (!transfer) return null;
        if (Number(transfer.fromGroupId) === Number(payload.groupId)) {
          return {
            mode: 'out',
            effectiveDate: transfer.effectiveDate,
            note: `Перенесен в группу ${transfer.toGroupName || '—'} с ${transfer.effectiveDate}`
          };
        }
        if (Number(transfer.toGroupId) === Number(payload.groupId)) {
          return {
            mode: 'in',
            effectiveDate: transfer.effectiveDate,
            note: `Переведен из группы ${transfer.fromGroupName || '—'} с ${transfer.effectiveDate}`
          };
        }
        return null;
      })(),
      marks: Object.fromEntries(
        dates.map((d) => [
          d.date,
          recordsByDate.get(d.date)?.get(child.childId)?.status || ''
        ])
      )
    }))
  };
}

function canChildBeMarkedInGroupOnDate(db, childId, groupId, date) {
  const transfer = db.prepare(`
    SELECT fromGroupId, toGroupId, effectiveDate
    FROM ChildGroupTransfers
    WHERE childId = ?
      AND (fromGroupId = ? OR toGroupId = ?)
      AND effectiveDate <= ?
    ORDER BY effectiveDate DESC, id DESC
    LIMIT 1
  `).get(childId, groupId, groupId, date);

  if (!transfer) return true;
  if (Number(transfer.fromGroupId) === Number(groupId)) {
    return String(date) < String(transfer.effectiveDate);
  }
  if (Number(transfer.toGroupId) === Number(groupId)) {
    return String(date) >= String(transfer.effectiveDate);
  }
  return true;
}

function addAttendanceDate(payload) {
  if (!payload?.groupId || !payload?.date) {
    throw new Error('Укажите группу и дату.');
  }
  const db = getDb();
  const nowIso = toIsoDate(new Date());
  db.prepare(
    'INSERT OR IGNORE INTO AttendancePlannedDates (groupId, sessionDate, source, createdAt) VALUES (?, ?, ?, ?)'
  ).run(Number(payload.groupId), payload.date, 'manual', nowIso);
  return { success: true };
}

function removeAttendanceDate(payload) {
  if (!payload?.groupId || !payload?.date) {
    throw new Error('Укажите группу и дату.');
  }
  const db = getDb();
  const txn = db.transaction(() => {
    const session = db
      .prepare('SELECT id FROM AttendanceSessions WHERE groupId = ? AND sessionDate = ?')
      .get(Number(payload.groupId), payload.date);

    db.prepare('DELETE FROM AttendancePlannedDates WHERE groupId = ? AND sessionDate = ?').run(Number(payload.groupId), payload.date);
    if (session?.id) {
      db.prepare('DELETE FROM AttendanceRecords WHERE sessionId = ?').run(session.id);
      db.prepare('DELETE FROM AttendanceSessions WHERE id = ?').run(session.id);
      recalculateLessonsForGroup(db, Number(payload.groupId));
    }
  });
  txn();
  return { success: true };
}

function listAttendanceBoards(filters = {}) {
  const db = getDb();
  const month = String(filters.month || toIsoDate(new Date()).slice(0, 7));
  const monthStart = `${month}-01`;
  const monthEnd = monthEndFromIso(monthStart);

  let sql = `
    SELECT
      g.id AS groupId,
      g.name AS groupName,
      c.id AS courseId,
      c.name AS courseName,
      st.id AS studioId,
      st.name AS studioName,
      city.id AS cityId,
      city.name AS cityName,
      (SELECT COUNT(*) FROM Children ch WHERE ch.groupId = g.id) AS childrenCount
    FROM CourseGroups g
    JOIN Courses c ON c.id = g.courseId
    JOIN Studios st ON st.id = c.studioId
    JOIN Cities city ON city.id = st.cityId
  `;
  const where = [];
  const params = [];
  if (filters.cityId) {
    where.push('city.id = ?');
    params.push(Number(filters.cityId));
  }
  if (filters.courseId) {
    where.push('c.id = ?');
    params.push(Number(filters.courseId));
  }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY city.name, c.name, g.name';

  const groups = db.prepare(sql).all(...params);

  const countPlanned = db.prepare(
    'SELECT COUNT(*) AS cnt FROM AttendancePlannedDates WHERE groupId = ? AND sessionDate BETWEEN ? AND ?'
  );
  const countCancelled = db.prepare(
    "SELECT COUNT(*) AS cnt FROM AttendanceSessions WHERE groupId = ? AND sessionDate BETWEEN ? AND ? AND status = 'cancelled'"
  );
  const countRecorded = db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM AttendanceRecords r
    JOIN AttendanceSessions s ON s.id = r.sessionId
    WHERE s.groupId = ?
      AND s.sessionDate BETWEEN ? AND ?
      AND s.status = 'conducted'
  `);

  return groups.map((g) => {
    ensurePlannedDatesForRange(db, g.groupId, monthStart, monthEnd);
    const plannedDays = Number(countPlanned.get(g.groupId, monthStart, monthEnd)?.cnt || 0);
    const childrenCount = Number(g.childrenCount || 0);
    const expectedCells = plannedDays * childrenCount;
    const cancelledDays = Number(countCancelled.get(g.groupId, monthStart, monthEnd)?.cnt || 0);
    const recordedCells = Number(countRecorded.get(g.groupId, monthStart, monthEnd)?.cnt || 0);
    const filledCells = recordedCells + (cancelledDays * childrenCount);
    const fillPercent = expectedCells > 0 ? Math.min(100, Math.round((filledCells * 100) / expectedCells)) : 0;

    return {
      ...g,
      month,
      plannedDays,
      cancelledDays,
      childrenCount,
      expectedCells,
      filledCells,
      fillPercent
    };
  });
}

function saveAttendanceSheet(payload) {
  const db = getDb();

  const txn = db.transaction(() => {
    payload.entries.forEach((entry) => {
      const filteredRecords = (entry.records || []).filter((record) =>
        canChildBeMarkedInGroupOnDate(db, record.childId, payload.groupId, entry.date)
      );
      upsertSessionAndRecords(
        db,
        payload.groupId,
        entry.date,
        entry.sessionStatus || 'conducted',
        filteredRecords
      );
    });

    recalculateLessonsForGroup(db, payload.groupId);
  });

  txn();
  return { success: true };
}

function listAttendanceSessions(filters = {}) {
  const db = getDb();
  let query = `
    SELECT
      s.id,
      s.groupId,
      s.sessionDate,
      s.status,
      g.name AS groupName,
      c.name AS courseName,
      st.name AS studioName,
      city.name AS cityName,
      SUM(CASE WHEN r.status = 'present' THEN 1 ELSE 0 END) AS presentCount,
      SUM(CASE WHEN r.status != 'present' THEN 1 ELSE 0 END) AS absentCount
    FROM AttendanceSessions s
    JOIN CourseGroups g ON g.id = s.groupId
    JOIN Courses c ON c.id = g.courseId
    JOIN Studios st ON st.id = c.studioId
    JOIN Cities city ON city.id = st.cityId
    LEFT JOIN AttendanceRecords r ON r.sessionId = s.id
  `;

  const params = [];
  const where = [];

  if (filters.groupId) {
    where.push('s.groupId = ?');
    params.push(filters.groupId);
  }
  if (filters.courseId) {
    where.push('g.courseId = ?');
    params.push(filters.courseId);
  }
  if (filters.cityId) {
    where.push('city.id = ?');
    params.push(filters.cityId);
  }

  if (where.length) query += ` WHERE ${where.join(' AND ')}`;
  query += ' GROUP BY s.id ORDER BY s.sessionDate DESC';

  return db.prepare(query).all(...params);
}

function getStudioWhatsAppConnection(studioId) {
  const db = getDb();
  return db
    .prepare(`
      SELECT
        sw.id,
        sw.studioId,
        sw.userId,
        sw.businessId,
        sw.phoneNumberId,
        sw.businessAccountId,
        sw.businessName,
        sw.phoneNumber,
        sw.createdAt,
        s.name AS studioName
      FROM StudioWhatsApp sw
      JOIN Studios s ON s.id = sw.studioId
      WHERE sw.studioId = ?
    `)
    .get(Number(studioId));
}

function getStudioWhatsAppConnectionWithToken(studioId) {
  const db = getDb();
  return db
    .prepare(`
      SELECT
        sw.id,
        sw.studioId,
        sw.userId,
        sw.accessToken,
        sw.businessId,
        sw.phoneNumberId,
        sw.businessAccountId,
        sw.businessName,
        sw.phoneNumber,
        sw.createdAt
      FROM StudioWhatsApp sw
      WHERE sw.studioId = ?
    `)
    .get(Number(studioId));
}

function getStudioWhatsAppConnectionByUserId(userId) {
  const db = getDb();
  return db
    .prepare(`
      SELECT
        sw.id,
        sw.studioId,
        sw.userId,
        sw.businessId,
        sw.phoneNumberId,
        sw.businessAccountId,
        sw.businessName,
        sw.phoneNumber,
        sw.createdAt,
        s.name AS studioName
      FROM StudioWhatsApp sw
      JOIN Studios s ON s.id = sw.studioId
      WHERE sw.userId = ?
      ORDER BY sw.id DESC
      LIMIT 1
    `)
    .get(String(userId || ''));
}

function upsertStudioWhatsAppConnection(payload) {
  const db = getDb();
  const studioId = Number(payload.studioId);
  const now = toIsoDate(new Date());

  db.prepare(`
    INSERT INTO StudioWhatsApp (
      studioId, userId, accessToken, businessId, phoneNumberId, businessAccountId, businessName, phoneNumber, createdAt
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(studioId) DO UPDATE SET
      userId = excluded.userId,
      accessToken = excluded.accessToken,
      businessId = excluded.businessId,
      phoneNumberId = excluded.phoneNumberId,
      businessAccountId = excluded.businessAccountId,
      businessName = excluded.businessName,
      phoneNumber = excluded.phoneNumber,
      createdAt = excluded.createdAt
  `).run(
    studioId,
    String(payload.userId || studioId),
    payload.accessToken,
    payload.businessId || null,
    payload.phoneNumberId,
    payload.businessAccountId,
    payload.businessName || null,
    payload.phoneNumber,
    now
  );

  return getStudioWhatsAppConnection(studioId);
}

function getUserWhatsAppConfig(userId) {
  const db = getDb();
  return db
    .prepare(`
      SELECT id, userId, whatsappApiKey, whatsappPhoneId, createdAt
      FROM UserWhatsAppConfig
      WHERE userId = ?
    `)
    .get(String(userId || ''));
}

function saveUserWhatsAppConfig(payload) {
  const db = getDb();
  const now = toIsoDate(new Date());
  const userId = String(payload.userId || 'local-user');
  const apiKey = String(payload.whatsappApiKey || '').trim();
  const phoneId = String(payload.whatsappPhoneId || '').trim();

  if (!apiKey) throw new Error('Укажите API KEY');
  if (!phoneId) throw new Error('Укажите WhatsApp Number ID');

  db.prepare(`
    INSERT INTO UserWhatsAppConfig (userId, whatsappApiKey, whatsappPhoneId, createdAt)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(userId) DO UPDATE SET
      whatsappApiKey = excluded.whatsappApiKey,
      whatsappPhoneId = excluded.whatsappPhoneId,
      createdAt = excluded.createdAt
  `).run(userId, apiKey, phoneId, now);

  return getUserWhatsAppConfig(userId);
}

module.exports = {
  listCities,
  saveCity,
  deleteCity,
  listStudios,
  saveStudio,
  deleteStudio,
  listCourses,
  saveCourse,
  deleteCourse,
  listGroups,
  saveGroup,
  deleteGroup,
  listGroupSchedule,
  saveGroupSchedule,
  listStructureTree,
  listChildren,
  listQueueChildren,
  saveQueueChild,
  deleteQueueChild,
  refreshQueueChildren,
  saveChild,
  getChildById,
  deleteChild,
  setChildrenMessageTag,
  addAuditLog,
  listAuditLogs,
  deleteAuditLog,
  getAppSettings,
  saveAppSettings,
  listArchivedEntities,
  deleteArchivedEntity,
  restoreArchivedEntity,
  setChildrenCourse,
  importDamubalaVouchers,
  importQosymshaVouchers,
  importArtsportVouchers,
  clearAllChildrenData,
  savePaymentComment,
  markPaymentPaid,
  cancelPaymentTransaction,
  listAttendanceBoards,
  getAttendanceSheet,
  addAttendanceDate,
  removeAttendanceDate,
  saveAttendanceSheet,
  listAttendanceSessions,
  getStudioWhatsAppConnection,
  getStudioWhatsAppConnectionByUserId,
  getStudioWhatsAppConnectionWithToken,
  upsertStudioWhatsAppConnection,
  getUserWhatsAppConfig,
  saveUserWhatsAppConfig
};
