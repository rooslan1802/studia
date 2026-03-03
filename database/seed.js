const { calculateAge, toIsoDate } = require('../services/childAge');

function iinFromDate(yyyyMmDd, suffix = '000001') {
  const [y, m, d] = yyyyMmDd.split('-');
  return `${y.slice(2)}${m}${d}${suffix.slice(0, 6)}`;
}

function seedQueueChildren(db) {
  const queueCount = Number(db.prepare('SELECT COUNT(*) AS count FROM QueueChildren').get()?.count || 0);
  if (queueCount > 0) return;

  const city = db.prepare('SELECT id FROM Cities ORDER BY id LIMIT 1').get();
  const studio = db.prepare('SELECT id FROM Studios ORDER BY id LIMIT 1').get();
  if (!city?.id || !studio?.id) return;

  const insertQueue = db.prepare(`
    INSERT INTO QueueChildren (
      cityId, studioId, childFullName, childIIN, parentFullName, parentIIN, comment,
      phone, queueDate, queueNumber, queueCategory, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const rows = [
    ['Ибраев Нурсултан', '140622505475', 'Ибраева Айгуль', '900423400111', 'Ожидает группу после собеседования', '+77071001101', '2026-01-12', 101, 'Льготная'],
    ['Калиева Алина', '150730501002', 'Калиев Ерлан', '880305300222', 'Документы поданы полностью', '+77071001102', '2026-01-13', 102, 'Общая'],
    ['Токтаров Арсен', '131018501003', 'Токтарова Сауле', '910918400333', 'Ожидание места в вечерней группе', '+77071001103', '2026-01-14', 103, 'Общая'],
    ['Мустафина Диана', '160924501004', 'Мустафин Руслан', '870222300444', 'Рекомендовано начать с февраля', '+77071001104', '2026-01-15', 104, 'Льготная'],
    ['Сеитов Тимур', '140607501005', 'Сеитова Жанна', '890714400555', 'Перевод из другой студии', '+77071001105', '2026-01-16', 105, 'Общая'],
    ['Омарова Камилла', '151201501006', 'Омаров Данияр', '900109300666', 'Очередь на направление танцы', '+77071001106', '2026-01-17', 106, 'Общая'],
    ['Абдрахманов Адилет', '130915501007', 'Абдрахманова Гульнар', '920601400777', 'Ожидает подтверждение времени занятий', '+77071001107', '2026-01-18', 107, 'Льготная'],
    ['Рахимова София', '161114501008', 'Рахимов Арман', '880830300888', 'Приоритет по району проживания', '+77071001108', '2026-01-19', 108, 'Общая'],
    ['Жаксылыков Мирон', '140401501009', 'Жаксылыкова Айжан', '910212400999', 'Запрос на утреннюю группу', '+77071001109', '2026-01-20', 109, 'Общая'],
    ['Баймуханова Лейла', '150825501010', 'Баймуханов Марат', '890517301010', 'В листе ожидания до марта', '+77071001110', '2026-01-21', 110, 'Льготная']
  ];

  const now = toIsoDate(new Date());
  rows.forEach((row) => insertQueue.run(city.id, studio.id, ...row, now));
}

function seedData(db) {
  const cityCount = db.prepare('SELECT COUNT(*) AS count FROM Cities').get().count;
  if (cityCount > 0) {
    seedQueueChildren(db);
    return;
  }

  const insertCity = db.prepare('INSERT INTO Cities (name) VALUES (?)');
  const insertStudio = db.prepare('INSERT INTO Studios (cityId, name) VALUES (?, ?)');
  const insertCourse = db.prepare('INSERT INTO Courses (studioId, name) VALUES (?, ?)');
  const insertGroup = db.prepare('INSERT INTO CourseGroups (courseId, name) VALUES (?, ?)');
  const insertSchedule = db.prepare('INSERT INTO GroupSchedule (groupId, weekday, startTime, endTime) VALUES (?, ?, ?, ?)');
  const insertChild = db.prepare('INSERT INTO Children (studioId, courseId, groupId, type) VALUES (?, ?, ?, ?)');

  const insertVoucher = db.prepare(`
    INSERT INTO VoucherProfile (
      childId, parentFullName, parentIIN, parentEmail, parentPhone,
      childFullName, childIIN, childBirthDate, manualAge, manualAgeSetDate, childAge,
      voucherNumber, enrollmentDate, voucherEndDate
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPaid = db.prepare(`
    INSERT INTO PaidProfile (
      childId, childFullName, childIIN, childBirthDate, manualAge, manualAgeSetDate, childAge,
      parentPhone, parentFullName, enrollmentDate, paymentStartDate, lastPaymentDate, lessonsCount
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const courseDefs = [
    { name: 'Живопись', groups: [{ name: 'Младшая', weekdays: [1, 3], time: '17:00' }, { name: 'Старшая', weekdays: [5], time: '17:30' }] },
    { name: 'Футбол', groups: [{ name: 'Младшая', weekdays: [2, 4], time: '18:00' }, { name: 'Старшая', weekdays: [6], time: '11:00' }] },
    { name: 'Танцы', groups: [{ name: 'Младшая', weekdays: [1, 4], time: '16:30' }, { name: 'Старшая', weekdays: [3, 6], time: '18:30' }] },
    { name: 'Шахматы', groups: [{ name: 'Младшая', weekdays: [2, 5], time: '17:00' }, { name: 'Старшая', weekdays: [7], time: '12:00' }] }
  ];

  const firstNames = ['Алихан', 'Амина', 'Дамир', 'Айлин', 'Нурали', 'Томирис', 'Ернур', 'Аружан', 'Диас', 'Малика'];
  const lastNames = ['Сериков', 'Ахметов', 'Ким', 'Иманов', 'Касенов', 'Жумагалиева', 'Беков', 'Садыкова', 'Тулеуов', 'Нургалиева'];

  const txn = db.transaction(() => {
    const astanaId = insertCity.run('Астана').lastInsertRowid;
    const studioId = insertStudio.run(astanaId, 'Astana Kids Center').lastInsertRowid;

    let voucherCounter = 1;

    courseDefs.forEach((courseDef, courseIndex) => {
      const courseId = insertCourse.run(studioId, courseDef.name).lastInsertRowid;
      const groupIds = [];

      courseDef.groups.forEach((g) => {
        const groupId = insertGroup.run(courseId, `${courseDef.name} ${g.name}`).lastInsertRowid;
        groupIds.push(groupId);
        g.weekdays.forEach((weekday) => {
          const [hh, mm] = g.time.split(':').map(Number);
          const end = `${String((hh + 1) % 24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
          insertSchedule.run(groupId, weekday, g.time, end);
        });
      });

      for (let i = 0; i < 10; i += 1) {
        const childType = i < 5 ? 'voucher' : 'paid';
        const groupId = groupIds[i % groupIds.length];
        const childId = insertChild.run(studioId, courseId, groupId, childType).lastInsertRowid;

        const fullName = `${lastNames[(i + courseIndex) % lastNames.length]} ${firstNames[i % firstNames.length]}`;
        const parentName = `${lastNames[(i + 3) % lastNames.length]} ${firstNames[(i + 4) % firstNames.length]} Сергеевич`;

        const month = String(((i + 2) % 12) + 1).padStart(2, '0');
        const day = String(((i + 5) % 27) + 1).padStart(2, '0');
        const birthDate = `201${i % 6}-${month}-${day}`;
        const childIIN = i % 2 === 0 ? iinFromDate(birthDate, `${courseIndex}${i}1122`) : '';
        const ageCalc = calculateAge({ childIIN, childBirthDate: childIIN ? '' : birthDate });

        if (childType === 'voucher') {
          insertVoucher.run(
            childId,
            parentName,
            iinFromDate('1988-01-01', `${courseIndex}${i}7744`),
            `parent${courseIndex}${i}@example.com`,
            `+7701${String(100000 + i * 93 + courseIndex * 11).slice(0, 6)}`,
            fullName,
            childIIN,
            ageCalc.birthDate,
            null,
            null,
            ageCalc.age || 0,
            `VCH-2026-${String(voucherCounter).padStart(4, '0')}`,
            '2026-01-10',
            '2026-05-20'
          );
          voucherCounter += 1;
        } else {
          const useManualAge = i % 3 === 0;
          insertPaid.run(
            childId,
            fullName,
            childIIN,
            useManualAge ? null : ageCalc.birthDate,
            useManualAge ? 9 : null,
            useManualAge ? '2026-01-15' : null,
            useManualAge ? calculateAge({ manualAge: 9, manualAgeSetDate: '2026-01-15' }).age : ageCalc.age || 0,
            `+7702${String(100000 + i * 77 + courseIndex * 9).slice(0, 6)}`,
            parentName,
            '2026-01-10',
            '2026-01-10',
            '2026-02-10',
            i % 4 === 0 ? 8 : 5
          );
        }
      }
    });

    const now = toIsoDate(new Date());
    const anyPaid = db.prepare('SELECT childId FROM PaidProfile ORDER BY childId LIMIT 1').get();
    if (anyPaid) {
      db.prepare(
        'INSERT INTO PaymentComments (childId, comment, promisedDate, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(anyPaid.childId, 'Обещали оплатить на следующей неделе.', '2026-03-05', 'pending', now, now);
    }
  });

  txn();
  seedQueueChildren(db);
}

module.exports = { seedData };
