const Database = require('better-sqlite3');
const { schemaSql } = require('./schema');
const { seedData } = require('./seed');

let db;

function hasColumn(database, tableName, columnName) {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((col) => col.name === columnName);
}

function hasTable(database, tableName) {
  const row = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return !!row;
}

function migrateAttendanceToGroups(database) {
  const hasGroupId = hasColumn(database, 'AttendanceSessions', 'groupId');
  if (hasGroupId) return;

  database.exec(`
    ALTER TABLE AttendanceSessions RENAME TO AttendanceSessions_old;

    CREATE TABLE AttendanceSessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      groupId INTEGER NOT NULL,
      sessionDate TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('conducted', 'cancelled')),
      note TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (groupId) REFERENCES CourseGroups(id) ON DELETE CASCADE,
      UNIQUE(groupId, sessionDate)
    );
  `);

  const oldRows = database
    .prepare('SELECT id, courseId, sessionDate, status, note, createdAt, updatedAt FROM AttendanceSessions_old')
    .all();

  const findAnyGroup = database.prepare('SELECT id FROM CourseGroups WHERE courseId = ? ORDER BY id LIMIT 1');
  const insertNew = database.prepare(
    'INSERT OR IGNORE INTO AttendanceSessions (id, groupId, sessionDate, status, note, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  oldRows.forEach((row) => {
    const g = findAnyGroup.get(row.courseId);
    if (g) {
      insertNew.run(row.id, g.id, row.sessionDate, row.status, row.note || '', row.createdAt, row.updatedAt);
    }
  });

  database.exec('DROP TABLE AttendanceSessions_old;');
}

function migrate(database) {
  const alterStatements = [];

  if (!hasColumn(database, 'VoucherProfile', 'childBirthDate')) {
    alterStatements.push('ALTER TABLE VoucherProfile ADD COLUMN childBirthDate TEXT');
  }
  if (!hasColumn(database, 'VoucherProfile', 'manualAge')) {
    alterStatements.push('ALTER TABLE VoucherProfile ADD COLUMN manualAge INTEGER');
  }
  if (!hasColumn(database, 'VoucherProfile', 'manualAgeSetDate')) {
    alterStatements.push('ALTER TABLE VoucherProfile ADD COLUMN manualAgeSetDate TEXT');
  }
  if (!hasColumn(database, 'VoucherProfile', 'importSource')) {
    alterStatements.push("ALTER TABLE VoucherProfile ADD COLUMN importSource TEXT NOT NULL DEFAULT ''");
  }

  if (!hasColumn(database, 'PaidProfile', 'childIIN')) {
    alterStatements.push('ALTER TABLE PaidProfile ADD COLUMN childIIN TEXT');
  }
  if (!hasColumn(database, 'PaidProfile', 'childBirthDate')) {
    alterStatements.push('ALTER TABLE PaidProfile ADD COLUMN childBirthDate TEXT');
  }
  if (!hasColumn(database, 'PaidProfile', 'manualAge')) {
    alterStatements.push('ALTER TABLE PaidProfile ADD COLUMN manualAge INTEGER');
  }
  if (!hasColumn(database, 'PaidProfile', 'manualAgeSetDate')) {
    alterStatements.push('ALTER TABLE PaidProfile ADD COLUMN manualAgeSetDate TEXT');
  }
  if (!hasColumn(database, 'PaidProfile', 'paymentStartDate')) {
    alterStatements.push('ALTER TABLE PaidProfile ADD COLUMN paymentStartDate TEXT');
  }

  if (!hasColumn(database, 'Children', 'groupId')) {
    alterStatements.push('ALTER TABLE Children ADD COLUMN groupId INTEGER');
  }
  if (!hasColumn(database, 'Children', 'messageTag')) {
    alterStatements.push("ALTER TABLE Children ADD COLUMN messageTag TEXT NOT NULL DEFAULT ''");
  }
  if (!hasColumn(database, 'GroupSchedule', 'endTime')) {
    alterStatements.push('ALTER TABLE GroupSchedule ADD COLUMN endTime TEXT');
  }

  alterStatements.forEach((sql) => database.exec(sql));

  database.exec(`
    CREATE TABLE IF NOT EXISTS CourseGroups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      courseId INTEGER NOT NULL,
      name TEXT NOT NULL,
      FOREIGN KEY (courseId) REFERENCES Courses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS GroupSchedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      groupId INTEGER NOT NULL,
      weekday INTEGER NOT NULL CHECK(weekday BETWEEN 1 AND 7),
      startTime TEXT,
      endTime TEXT,
      FOREIGN KEY (groupId) REFERENCES CourseGroups(id) ON DELETE CASCADE,
      UNIQUE(groupId, weekday)
    );

    CREATE TABLE IF NOT EXISTS PaymentComments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      childId INTEGER NOT NULL,
      comment TEXT NOT NULL,
      promisedDate TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'paid')),
      paidDate TEXT,
      paidOnTime INTEGER,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (childId) REFERENCES Children(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS PaymentTransactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      childId INTEGER NOT NULL,
      paidDate TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      comment TEXT,
      paymentMethod TEXT,
      cycleLessons INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (childId) REFERENCES Children(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS AttendancePlannedDates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      groupId INTEGER NOT NULL,
      sessionDate TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'schedule' CHECK(source IN ('schedule', 'manual')),
      createdAt TEXT NOT NULL,
      FOREIGN KEY (groupId) REFERENCES CourseGroups(id) ON DELETE CASCADE,
      UNIQUE(groupId, sessionDate)
    );

    CREATE TABLE IF NOT EXISTS QueueChildren (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cityId INTEGER NOT NULL,
      studioId INTEGER NOT NULL,
      childFullName TEXT NOT NULL,
      childIIN TEXT NOT NULL,
      parentFullName TEXT NOT NULL,
      parentIIN TEXT NOT NULL,
      comment TEXT,
      phone TEXT NOT NULL,
      queueDate TEXT NOT NULL,
      queueNumber INTEGER NOT NULL,
      queueCategory TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (cityId) REFERENCES Cities(id) ON DELETE CASCADE,
      FOREIGN KEY (studioId) REFERENCES Studios(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS StudioWhatsApp (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studioId INTEGER NOT NULL UNIQUE,
      userId TEXT NOT NULL DEFAULT '',
      accessToken TEXT NOT NULL,
      businessId TEXT,
      phoneNumberId TEXT NOT NULL,
      businessAccountId TEXT NOT NULL,
      businessName TEXT,
      phoneNumber TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (studioId) REFERENCES Studios(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS UserWhatsAppConfig (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL UNIQUE,
      whatsappApiKey TEXT NOT NULL,
      whatsappPhoneId TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
  `);

  if (hasTable(database, 'StudioWhatsApp')) {
    if (!hasColumn(database, 'StudioWhatsApp', 'userId')) {
      database.exec("ALTER TABLE StudioWhatsApp ADD COLUMN userId TEXT NOT NULL DEFAULT ''");
    }
    if (!hasColumn(database, 'StudioWhatsApp', 'businessId')) {
      database.exec('ALTER TABLE StudioWhatsApp ADD COLUMN businessId TEXT');
    }
    if (!hasColumn(database, 'StudioWhatsApp', 'businessName')) {
      database.exec('ALTER TABLE StudioWhatsApp ADD COLUMN businessName TEXT');
    }
  }

  if (hasTable(database, 'QueueChildren')) {
    if (!hasColumn(database, 'QueueChildren', 'cityId')) {
      database.exec('ALTER TABLE QueueChildren ADD COLUMN cityId INTEGER');
    }
    if (!hasColumn(database, 'QueueChildren', 'studioId')) {
      database.exec('ALTER TABLE QueueChildren ADD COLUMN studioId INTEGER');
    }
    database.exec(`
      UPDATE QueueChildren
      SET cityId = COALESCE(cityId, (SELECT id FROM Cities ORDER BY id LIMIT 1)),
          studioId = COALESCE(studioId, (SELECT id FROM Studios ORDER BY id LIMIT 1))
      WHERE cityId IS NULL OR studioId IS NULL
    `);
  }

  if (hasTable(database, 'PaymentTransactions')) {
    const txAlters = [];
    if (!hasColumn(database, 'PaymentTransactions', 'amount')) txAlters.push('ALTER TABLE PaymentTransactions ADD COLUMN amount REAL NOT NULL DEFAULT 0');
    if (!hasColumn(database, 'PaymentTransactions', 'comment')) txAlters.push('ALTER TABLE PaymentTransactions ADD COLUMN comment TEXT');
    if (!hasColumn(database, 'PaymentTransactions', 'paymentMethod')) txAlters.push('ALTER TABLE PaymentTransactions ADD COLUMN paymentMethod TEXT');
    if (!hasColumn(database, 'PaymentTransactions', 'cycleLessons')) txAlters.push('ALTER TABLE PaymentTransactions ADD COLUMN cycleLessons INTEGER NOT NULL DEFAULT 0');
    if (!hasColumn(database, 'PaymentTransactions', 'createdAt')) txAlters.push('ALTER TABLE PaymentTransactions ADD COLUMN createdAt TEXT');
    txAlters.forEach((sql) => database.exec(sql));

    database.exec(`
      INSERT INTO PaymentTransactions (childId, paidDate, amount, comment, paymentMethod, cycleLessons, createdAt)
      SELECT
        pc.childId,
        pc.paidDate,
        0,
        COALESCE(pc.comment, 'Импорт старой оплаты'),
        'Не указан',
        0,
        COALESCE(pc.updatedAt, pc.paidDate)
      FROM PaymentComments pc
      WHERE pc.status = 'paid'
        AND pc.paidDate IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM PaymentTransactions pt
          WHERE pt.childId = pc.childId
            AND pt.paidDate = pc.paidDate
        );
    `);
  }

  database.exec(`
    UPDATE PaidProfile
    SET paymentStartDate = COALESCE(paymentStartDate, enrollmentDate)
    WHERE paymentStartDate IS NULL OR paymentStartDate = '';

    UPDATE PaidProfile
    SET lessonsCount = (
      WITH attended AS (
        SELECT COUNT(*) AS total
        FROM AttendanceRecords r
        JOIN AttendanceSessions s ON s.id = r.sessionId
        WHERE r.childId = PaidProfile.childId
          AND s.status = 'conducted'
          AND r.status = 'present'
          AND s.sessionDate >= COALESCE(PaidProfile.paymentStartDate, PaidProfile.enrollmentDate)
      )
      SELECT CASE WHEN total <= 0 THEN 0 ELSE ((total - 1) % 8) + 1 END
      FROM attended
    );
  `);

  const courses = database.prepare('SELECT id FROM Courses').all();
  const findGroup = database.prepare('SELECT id FROM CourseGroups WHERE courseId = ? ORDER BY id LIMIT 1');
  const insertGroup = database.prepare('INSERT INTO CourseGroups (courseId, name) VALUES (?, ?)');
  const setChildGroup = database.prepare('UPDATE Children SET groupId = ? WHERE courseId = ? AND groupId IS NULL');

  courses.forEach((c) => {
    let group = findGroup.get(c.id);
    if (!group) {
      const res = insertGroup.run(c.id, 'Группа 1');
      group = { id: res.lastInsertRowid };
    }
    setChildGroup.run(group.id, c.id);
  });

  migrateAttendanceToGroups(database);

  database.exec(`
    CREATE TABLE IF NOT EXISTS AttendanceRecords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sessionId INTEGER NOT NULL,
      childId INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('present', 'absent-valid', 'absent-other')),
      note TEXT,
      FOREIGN KEY (sessionId) REFERENCES AttendanceSessions(id) ON DELETE CASCADE,
      FOREIGN KEY (childId) REFERENCES Children(id) ON DELETE CASCADE,
      UNIQUE(sessionId, childId)
    );

    UPDATE VoucherProfile
    SET manualAge = childAge,
        manualAgeSetDate = COALESCE(manualAgeSetDate, enrollmentDate)
    WHERE (childBirthDate IS NULL OR childBirthDate = '')
      AND (manualAge IS NULL);

    UPDATE PaidProfile
    SET manualAge = childAge,
        manualAgeSetDate = COALESCE(manualAgeSetDate, enrollmentDate)
    WHERE (childBirthDate IS NULL OR childBirthDate = '')
      AND (manualAge IS NULL);
  `);
}

function initializeDatabase(dbPath) {
  if (db) return db;

  db = new Database(dbPath);
  db.exec(schemaSql);
  migrate(db);
  seedData(db);
  return db;
}

function getDb() {
  if (!db) throw new Error('Database is not initialized');
  return db;
}

module.exports = { initializeDatabase, getDb };
