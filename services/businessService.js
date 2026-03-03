const { getDb } = require('../database');
const { calculateAge, toIsoDate } = require('./childAge');
const { getDamubalaConnectionStatus } = require('./damubalaSyncService');

function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const from = toIsoDate(new Date(y, m - 1, 1));
  const to = toIsoDate(new Date(y, m, 0));
  return { from, to };
}

function cycleProgress(totalAttended) {
  if (!totalAttended) return 0;
  return ((totalAttended - 1) % 8) + 1;
}

function requiredPayments(totalAttended) {
  if (!totalAttended) return 0;
  return 1 + Math.floor(totalAttended / 8);
}

function getPaymentsList(filters = {}) {
  const where = [];
  const params = [];

  if (filters.cityId) {
    where.push('city.id = ?');
    params.push(Number(filters.cityId));
  }
  if (filters.courseId) {
    where.push('co.id = ?');
    params.push(Number(filters.courseId));
  }
  if (filters.groupId) {
    where.push('g.id = ?');
    params.push(Number(filters.groupId));
  }
  if (filters.parentQuery) {
    where.push('(LOWER(pp.parentFullName) LIKE ? OR pp.parentPhone LIKE ?)');
    const q = `%${String(filters.parentQuery).trim().toLowerCase()}%`;
    params.push(q, `%${String(filters.parentQuery).trim()}%`);
  }

  const rows = getDb()
    .prepare(`
      SELECT
        ch.id AS childId,
        pp.childFullName,
        pp.parentFullName,
        pp.parentPhone,
        city.id AS cityId,
        city.name AS cityName,
        st.id AS studioId,
        st.name AS studioName,
        co.id AS courseId,
        co.name AS courseName,
        g.id AS groupId,
        g.name AS groupName,
        pp.paymentStartDate,
        pp.enrollmentDate,
        tx.id AS txId,
        tx.paidDate AS txPaidDate,
        tx.amount AS txAmount,
        tx.comment AS txComment,
        tx.paymentMethod AS txPaymentMethod,
        (
          SELECT COUNT(*)
          FROM PaymentTransactions pt
          WHERE pt.childId = ch.id
        ) AS paymentsDone,
        (
          SELECT COUNT(*)
          FROM AttendanceRecords r
          JOIN AttendanceSessions s ON s.id = r.sessionId
          WHERE r.childId = ch.id
            AND s.status = 'conducted'
            AND s.sessionDate >= COALESCE(pp.paymentStartDate, pp.enrollmentDate)
            AND r.status IN ('present', 'absent-other', 'absent-valid')
        ) AS attendedTotal,
        (
          SELECT MAX(s.sessionDate)
          FROM AttendanceRecords r
          JOIN AttendanceSessions s ON s.id = r.sessionId
          WHERE r.childId = ch.id
            AND s.status = 'conducted'
            AND s.sessionDate >= COALESCE(pp.paymentStartDate, pp.enrollmentDate)
            AND r.status IN ('present', 'absent-other', 'absent-valid')
        ) AS lastAttendanceDate,
        pc.comment AS paymentComment,
        pc.promisedDate,
        pc.status AS commentStatus
      FROM Children ch
      JOIN PaidProfile pp ON pp.childId = ch.id
      JOIN Studios st ON st.id = ch.studioId
      JOIN Cities city ON city.id = st.cityId
      JOIN Courses co ON co.id = ch.courseId
      LEFT JOIN CourseGroups g ON g.id = ch.groupId
      LEFT JOIN (
        SELECT pt1.*
        FROM PaymentTransactions pt1
        JOIN (
          SELECT childId, MAX(id) AS maxId
          FROM PaymentTransactions
          GROUP BY childId
        ) latestTx ON latestTx.maxId = pt1.id
      ) tx ON tx.childId = ch.id
      LEFT JOIN (
        SELECT pc1.*
        FROM PaymentComments pc1
        JOIN (
          SELECT childId, MAX(id) AS maxId
          FROM PaymentComments
          GROUP BY childId
        ) latest ON latest.maxId = pc1.id
      ) pc ON pc.childId = ch.id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    `)
    .all(...params);

  const items = rows.map((row) => {
    const total = Number(row.attendedTotal || 0);
    const paid = Number(row.paymentsDone || 0);
    const need = requiredPayments(total);
    const due = need > paid;
    const cycle = cycleProgress(total);

    let reason = '';
    if (due && paid === 0 && total >= 1) {
      reason = 'После первого занятия нужно оплатить пакет на 8 занятий';
    } else if (due) {
      reason = 'Требуется оплата (наступило 8-е занятие цикла)';
    }

    return {
      ...row,
      lessonsCount: cycle,
      attendedTotal: total,
      paymentsDone: paid,
      requiredPayments: need,
      paymentState: due ? 'unpaid' : 'hidden',
      status: due ? 'overdue' : 'ok',
      reason,
      billingMonth: row.lastAttendanceDate
        ? row.lastAttendanceDate.slice(0, 7)
        : (row.paymentStartDate || row.enrollmentDate || toIsoDate(new Date())).slice(0, 7),
      paidStatusLabel: 'Оплачено'
    };
  }).filter((x) => x.paymentState === 'unpaid');

  return items.sort((a, b) => a.childFullName.localeCompare(b.childFullName, 'ru'));
}

function getPaymentTransactions(filters = {}) {
  const where = [];
  const params = [];

  if (filters.cityId) {
    where.push('city.id = ?');
    params.push(Number(filters.cityId));
  }
  if (filters.courseId) {
    where.push('co.id = ?');
    params.push(Number(filters.courseId));
  }
  if (filters.groupId) {
    where.push('g.id = ?');
    params.push(Number(filters.groupId));
  }
  if (filters.parentQuery) {
    where.push('(LOWER(pp.parentFullName) LIKE ? OR pp.parentPhone LIKE ?)');
    const q = `%${String(filters.parentQuery).trim().toLowerCase()}%`;
    params.push(q, `%${String(filters.parentQuery).trim()}%`);
  }

  return getDb()
    .prepare(`
      SELECT
        pt.id,
        pt.childId,
        pt.paidDate,
        pt.amount,
        pt.comment,
        pt.paymentMethod,
        pt.cycleLessons,
        pp.childFullName,
        pp.parentFullName,
        pp.parentPhone,
        city.id AS cityId,
        city.name AS cityName,
        co.id AS courseId,
        co.name AS courseName,
        g.id AS groupId,
        g.name AS groupName
      FROM PaymentTransactions pt
      JOIN Children ch ON ch.id = pt.childId
      JOIN PaidProfile pp ON pp.childId = ch.id
      JOIN Studios st ON st.id = ch.studioId
      JOIN Cities city ON city.id = st.cityId
      JOIN Courses co ON co.id = ch.courseId
      LEFT JOIN CourseGroups g ON g.id = ch.groupId
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY pt.paidDate DESC, pt.id DESC
    `)
    .all(...params)
    .map((row) => ({
      ...row,
      billingMonth: String(row.paidDate || '').slice(0, 7),
      paidStatusLabel: `Оплачено (${Number(row.amount || 0).toLocaleString('ru-RU')} тг, ${row.paymentMethod || 'не указан'})`,
      paymentState: 'paid'
    }));
}

function getAttendanceSummary() {
  const db = getDb();
  const today = toIsoDate(new Date());

  const todayStats = db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'conducted' THEN 1 ELSE 0 END) AS conducted,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
      FROM AttendanceSessions
      WHERE sessionDate = ?`
    )
    .get(today);

  return {
    todaySessions: todayStats.total || 0,
    todayConducted: todayStats.conducted || 0,
    todayCancelled: todayStats.cancelled || 0
  };
}

function getNotificationsList() {
  const db = getDb();
  const notifications = [];
  const today = toIsoDate(new Date());

  const payments = getPaymentsList();
  payments.forEach((payment) => {
    notifications.push({
      id: `pay-${payment.childId}`,
      type: 'payment-overdue',
      category: 'payments',
      childId: payment.childId,
      title: 'Требуется оплата',
      message: `${payment.childFullName} — ${payment.reason}`,
      studioName: payment.studioName,
      createdAt: today
    });
  });

  const voucherSoonRows = db
    .prepare(`
      SELECT
        ch.id AS childId,
        vp.childFullName,
        vp.voucherEndDate,
        st.name AS studioName
      FROM Children ch
      JOIN VoucherProfile vp ON vp.childId = ch.id
      JOIN Studios st ON st.id = ch.studioId
      WHERE ch.type = 'voucher'
        AND vp.voucherEndDate IS NOT NULL
        AND vp.voucherEndDate <> ''
      ORDER BY vp.voucherEndDate ASC
    `)
    .all();
  voucherSoonRows.forEach((row) => {
    const end = new Date(`${row.voucherEndDate}T00:00:00`);
    if (Number.isNaN(end.getTime())) return;
    const days = Math.ceil((end.getTime() - new Date(`${today}T00:00:00`).getTime()) / (24 * 3600 * 1000));
    if (days < 0 || days > 10) return;
    notifications.push({
      id: `voucher-end-${row.childId}`,
      type: 'voucher-ending-soon',
      category: 'vouchers',
      childId: row.childId,
      title: 'Скоро окончание ваучера',
      message: `${row.childFullName} — до окончания ${days} дн.`,
      studioName: row.studioName,
      createdAt: today
    });
  });

  const readyQueueRows = db
    .prepare(`
      SELECT
        qc.id AS queueId,
        qc.childFullName,
        st.name AS studioName
      FROM QueueChildren qc
      JOIN Studios st ON st.id = qc.studioId
      WHERE UPPER(CAST(qc.queueNumber AS TEXT)) = 'ВАУЧЕР'
      ORDER BY qc.id DESC
      LIMIT 60
    `)
    .all();
  readyQueueRows.forEach((row) => {
    notifications.push({
      id: `queue-ready-${row.queueId}`,
      type: 'queue-voucher-ready',
      category: 'queue',
      sourceId: row.queueId,
      title: 'Очередь получила ваучер',
      message: `${row.childFullName} — можно переводить в ваучеры`,
      studioName: row.studioName,
      createdAt: today
    });
  });

  const cancelledToday = db
    .prepare(`
      SELECT COUNT(*) AS c
      FROM AttendanceSessions
      WHERE status = 'cancelled' AND sessionDate = ?
    `)
    .get(today);
  const cancelledCount = Number(cancelledToday?.c || 0);
  if (cancelledCount > 0) {
    notifications.push({
      id: `attendance-cancelled-${today}`,
      type: 'attendance-cancelled',
      category: 'attendance',
      sourceId: today,
      title: 'Отмененные занятия',
      message: `Сегодня отменено занятий: ${cancelledCount}`,
      studioName: 'Все студии',
      createdAt: today
    });
  }

  return notifications.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

async function getDashboardData() {
  const db = getDb();
  const counts = db
    .prepare(`
      SELECT
        COUNT(*) AS totalChildren,
        SUM(CASE WHEN type = 'voucher' THEN 1 ELSE 0 END) AS totalVouchers,
        SUM(CASE WHEN type = 'paid' THEN 1 ELSE 0 END) AS totalPaid
      FROM Children
    `)
    .get();

  const payments = getPaymentsList();
  const notifications = getNotificationsList();
  const attendance = getAttendanceSummary();
  const soonVoucherQueue = db
    .prepare(`
      SELECT
        qc.id,
        qc.childFullName,
        qc.childIIN,
        qc.parentFullName,
        qc.parentIIN,
        qc.phone,
        qc.queueDate,
        qc.queueNumber,
        qc.queueCategory,
        city.name AS cityName,
        st.name AS studioName
      FROM QueueChildren qc
      LEFT JOIN Cities city ON city.id = qc.cityId
      LEFT JOIN Studios st ON st.id = qc.studioId
      WHERE UPPER(CAST(qc.queueNumber AS TEXT)) <> 'ВАУЧЕР'
      ORDER BY qc.id ASC
    `)
    .all()
    .map((row) => {
      const queueNum = Number(String(row.queueNumber || '').replace(/\D+/g, ''));
      if (!queueNum || queueNum >= 1000) return null;
      const ageInfo = calculateAge({ childIIN: row.childIIN });
      return {
        ...row,
        queueNumber: queueNum,
        childAge: ageInfo.age
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.queueNumber - b.queueNumber)
    .slice(0, 50);

  const signingStats = getDamubalaConnectionStatus().signingStats || {
    available: false,
    totalSigned: 0,
    totalUnsigned: 0,
    byApplication: [],
    updatedAt: ''
  };

  return {
    totalChildren: counts.totalChildren || 0,
    totalVouchers: counts.totalVouchers || 0,
    totalPaid: counts.totalPaid || 0,
    nearestPayments: payments.slice(0, 5),
    overduePayments: payments.slice(0, 5),
    voucherEndingSoon: notifications.filter((x) => x.type === 'voucher-ending-soon').slice(0, 5),
    soonVoucherQueue,
    attendance,
    signingStats
  };
}

function getPaymentHistory(childId) {
  return getDb()
    .prepare(`
      SELECT
        id,
        childId,
        paidDate,
        amount,
        comment,
        paymentMethod,
        cycleLessons,
        createdAt
      FROM PaymentTransactions
      WHERE childId = ?
      ORDER BY paidDate DESC, id DESC
    `)
    .all(childId);
}

function getMonthlyPaymentsReport(filters = {}) {
  const month = filters.month || toIsoDate(new Date()).slice(0, 7);
  const debts = getPaymentsList(filters).filter((x) => (x.billingMonth || '').slice(0, 7) === month);
  const { from, to } = monthRange(month);
  const txRows = getPaymentTransactions(filters).filter((x) => x.paidDate >= from && x.paidDate <= to);
  const db = getDb();

  const attendanceStats = db
    .prepare(`
      SELECT
        COUNT(*) AS totalSessions,
        SUM(CASE WHEN status = 'conducted' THEN 1 ELSE 0 END) AS conductedSessions,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelledSessions
      FROM AttendanceSessions
      WHERE sessionDate BETWEEN ? AND ?
    `)
    .get(from, to);

  return {
    month,
    totals: {
      debtsCount: debts.length,
      paidCount: txRows.length,
      paidAmount: txRows.reduce((sum, x) => sum + Number(x.amount || 0), 0),
      totalSessions: attendanceStats.totalSessions || 0,
      conductedSessions: attendanceStats.conductedSessions || 0,
      cancelledSessions: attendanceStats.cancelledSessions || 0
    },
    debts,
    paid: txRows,
    transactions: txRows
  };
}

module.exports = {
  getDashboardData,
  getPaymentsList,
  getPaymentTransactions,
  getPaymentHistory,
  getMonthlyPaymentsReport,
  getNotificationsList,
  PAYMENT_THRESHOLD_LESSONS: 8
};
