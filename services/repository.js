const { getDb } = require('../database');
const { calculateAge, toIsoDate } = require('./childAge');
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

function normalizeMessageTag(value) {
  const tag = String(value || '').trim().toLowerCase();
  if (tag === 'qr') return 'qr';
  if (tag === 'reminder') return 'reminder';
  return '';
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

  studios.forEach((studio) => {
    const item = { ...studio, courses: [] };
    studioMap.set(studio.id, item);
    if (cityMap.has(studio.cityId)) {
      cityMap.get(studio.cityId).studios.push(item);
    }
  });

  courses.forEach((course) => {
    const item = { ...course, groups: [] };
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
        schedule: scheduleByGroup.get(g.id) || []
      });
    }
  });

  return cities;
}

function recalculateLessonsForGroup(db, groupId) {
  db.prepare(`
    UPDATE PaidProfile
    SET lessonsCount = (
      WITH attended AS (
        SELECT COUNT(*) AS total
        FROM AttendanceRecords r
        JOIN AttendanceSessions s ON s.id = r.sessionId
        WHERE r.childId = PaidProfile.childId
          AND s.status = 'conducted'
          AND r.status IN ('present', 'absent-other', 'absent-valid')
          AND s.sessionDate >= COALESCE(PaidProfile.paymentStartDate, PaidProfile.enrollmentDate)
      )
      SELECT CASE WHEN total <= 0 THEN 0 ELSE ((total - 1) % 8) + 1 END FROM attended
    )
    WHERE childId IN (
      SELECT id FROM Children WHERE groupId = ? AND type = 'paid'
    )
  `).run(groupId);
}

function recalculateLessonsForChild(db, childId) {
  db.prepare(`
    UPDATE PaidProfile
    SET lessonsCount = (
      WITH attended AS (
        SELECT COUNT(*) AS total
        FROM AttendanceRecords r
        JOIN AttendanceSessions s ON s.id = r.sessionId
        WHERE r.childId = PaidProfile.childId
          AND s.status = 'conducted'
          AND r.status IN ('present', 'absent-other', 'absent-valid')
          AND s.sessionDate >= COALESCE(PaidProfile.paymentStartDate, PaidProfile.enrollmentDate)
      )
      SELECT CASE WHEN total <= 0 THEN 0 ELSE ((total - 1) % 8) + 1 END FROM attended
    )
    WHERE childId = ?
  `).run(childId);
}

function getCycleMetrics(db, childId) {
  const row = db
    .prepare(`
      SELECT
        (
          SELECT COUNT(*)
          FROM AttendanceRecords r
          JOIN AttendanceSessions s ON s.id = r.sessionId
          WHERE r.childId = c.id
            AND s.status = 'conducted'
            AND r.status IN ('present', 'absent-other', 'absent-valid')
            AND s.sessionDate >= COALESCE(pp.paymentStartDate, pp.enrollmentDate)
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
  const requiredPayments = attendedTotal > 0 ? 1 + Math.floor(attendedTotal / 8) : 0;
  const cycleProgress = attendedTotal > 0 ? ((attendedTotal - 1) % 8) + 1 : 0;

  return { attendedTotal, paymentsDone, requiredPayments, cycleProgress };
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
      where.push('ch.messageTag = ?');
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

    return {
      ...row,
      childName: row.type === 'voucher' ? row.voucherChildName : row.paidChildName,
      parentPhone: row.type === 'voucher' ? row.voucherParentPhone : row.paidParentPhone,
      parentIIN: row.type === 'voucher' ? row.voucherParentIIN : '',
      childIIN,
      childBirthDate: ageCalc.birthDate || childBirthDate || null,
      childAge: ageCalc.age,
      importSource: row.type === 'voucher' ? String(row.importSource || '').trim().toLowerCase() : ''
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
      childAge: ageInfo.age
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

  return { id: result.lastInsertRowid };
}

function deleteQueueChild(id) {
  getDb().prepare('DELETE FROM QueueChildren WHERE id = ?').run(id);
  return { success: true };
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
    'UPDATE QueueChildren SET queueNumber = ?, queueDate = ?, queueCategory = ? WHERE id = ?'
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
      update.run(normalizedQueueNumber || 'ВАУЧЕР', data.queueDate || '', data.queueCategory || '', row.id);
      result.updated += 1;
      const ageInfo = calculateAge({ childIIN: row.childIIN });
      result.items.push({
        id: row.id,
        iin: row.childIIN,
        childFullName: row.childFullName,
        childAge: ageInfo.age,
        cityName: row.cityName || '',
        studioName: row.studioName || '',
        queueNumber: normalizedQueueNumber || 'ВАУЧЕР',
        queueDate: data.queueDate || '',
        queueCategory: data.queueCategory || '',
        status: 'ok'
      });
    } catch (e) {
      const message = e?.message || 'Ошибка обновления';
      if (
        /очередь не найдена|не удалось распарсить данные очереди|check-voucher-row|statement|not found|fetch failed|network/i.test(message)
      ) {
        update.run('ВАУЧЕР', '', '', row.id);
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
          queueNumber: 'ВАУЧЕР',
          queueDate: '',
          queueCategory: '',
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

    if (childId) {
      previousProfile = payload.type === 'voucher'
        ? db.prepare('SELECT * FROM VoucherProfile WHERE childId = ?').get(childId)
        : db.prepare('SELECT * FROM PaidProfile WHERE childId = ?').get(childId);

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

    return childId;
  });

  return { id: txn() };
}

function getChildById(childId) {
  const db = getDb();
  const child = db.prepare('SELECT id, studioId, courseId, groupId, type, messageTag FROM Children WHERE id = ?').get(childId);
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
  }

  return child;
}

function deleteChild(id) {
  getDb().prepare('DELETE FROM Children WHERE id = ?').run(id);
  return { success: true };
}

function setChildrenMessageTag(payload = {}) {
  const ids = Array.isArray(payload.ids) ? payload.ids.map(Number).filter(Boolean) : [];
  const rawTag = String(payload.messageTag || '').trim().toLowerCase();
  const tag = normalizeMessageTag(payload.messageTag);
  if (!ids.length) throw new Error('Не выбраны дети.');
  if (rawTag && !tag) throw new Error('Некорректная пометка.');

  const db = getDb();
  const result = db.prepare(`
    UPDATE Children
    SET messageTag = ?
    WHERE type = 'voucher' AND id IN (${ids.map(() => '?').join(',')})
  `).run(tag, ...ids);

  return { success: true, updated: Number(result.changes || 0) };
}

function setChildrenCourse(payload = {}) {
  const ids = Array.isArray(payload.ids) ? payload.ids.map(Number).filter(Boolean) : [];
  const courseId = Number(payload.courseId || 0);
  if (!ids.length) throw new Error('Не выбраны дети.');
  if (!courseId) throw new Error('Не выбран кружок.');

  const db = getDb();
  const course = db.prepare('SELECT id, studioId FROM Courses WHERE id = ?').get(courseId);
  if (!course) throw new Error('Кружок не найден.');

  const result = db.prepare(`
    UPDATE Children
    SET courseId = ?, groupId = NULL
    WHERE type = 'voucher'
      AND studioId = ?
      AND id IN (${ids.map(() => '?').join(',')})
  `).run(course.id, course.studioId, ...ids);

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

      if (existing?.id) result.updated += 1;
      else result.added += 1;
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

  const existing = db
    .prepare('SELECT id FROM PaymentComments WHERE childId = ? AND status = ? ORDER BY id DESC LIMIT 1')
    .get(payload.childId, 'pending');

  if (existing) {
    db.prepare('UPDATE PaymentComments SET comment = ?, promisedDate = ?, updatedAt = ? WHERE id = ?').run(
      payload.comment,
      payload.promisedDate || null,
      now,
      existing.id
    );
    return { id: existing.id };
  }

  const result = db
    .prepare(
      'INSERT INTO PaymentComments (childId, comment, promisedDate, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(payload.childId, payload.comment, payload.promisedDate || null, 'pending', now, now);

  return { id: result.lastInsertRowid };
}

function markPaymentPaid(payload) {
  const db = getDb();
  const paidDate = payload.paidDate || toIsoDate(new Date());
  const amount = Number(payload.amount || 0);
  const paymentMethod = String(payload.paymentMethod || 'Каспи');
  const comment = String(payload.comment || 'Оплата отмечена вручную').trim();

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
        'INSERT INTO PaymentComments (childId, comment, promisedDate, status, paidDate, paidOnTime, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(payload.childId, comment || 'Оплата отмечена вручную', null, 'paid', paidDate, null, paidDate, paidDate);
    }

    recalculateLessonsForChild(db, payload.childId);
  });

  txn();
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
    .filter((r) => r?.status === 'present' || r?.status === 'absent-other' || r?.status === 'absent-valid')
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
      ORDER BY childName
    `)
    .all(payload.groupId);

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
      marks: Object.fromEntries(
        dates.map((d) => [
          d.date,
          recordsByDate.get(d.date)?.get(child.childId)?.status || ''
        ])
      )
    }))
  };
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
      upsertSessionAndRecords(
        db,
        payload.groupId,
        entry.date,
        entry.sessionStatus || 'conducted',
        entry.records || []
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
