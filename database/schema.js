const schemaSql = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS Cities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS Studios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cityId INTEGER NOT NULL,
  name TEXT NOT NULL,
  FOREIGN KEY (cityId) REFERENCES Cities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  studioId INTEGER NOT NULL,
  name TEXT NOT NULL,
  FOREIGN KEY (studioId) REFERENCES Studios(id) ON DELETE CASCADE
);

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

CREATE TABLE IF NOT EXISTS Children (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  studioId INTEGER NOT NULL,
  courseId INTEGER NOT NULL,
  groupId INTEGER,
  type TEXT NOT NULL CHECK(type IN ('voucher', 'paid')),
  messageTag TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (studioId) REFERENCES Studios(id) ON DELETE CASCADE,
  FOREIGN KEY (courseId) REFERENCES Courses(id) ON DELETE CASCADE,
  FOREIGN KEY (groupId) REFERENCES CourseGroups(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS VoucherProfile (
  childId INTEGER PRIMARY KEY,
  parentFullName TEXT NOT NULL,
  parentIIN TEXT NOT NULL,
  parentEmail TEXT,
  parentPhone TEXT NOT NULL,
  childFullName TEXT NOT NULL,
  childIIN TEXT NOT NULL DEFAULT '',
  importSource TEXT NOT NULL DEFAULT '',
  childBirthDate TEXT,
  manualAge INTEGER,
  manualAgeSetDate TEXT,
  childAge INTEGER NOT NULL,
  voucherNumber TEXT NOT NULL,
  enrollmentDate TEXT NOT NULL,
  voucherEndDate TEXT NOT NULL,
  FOREIGN KEY (childId) REFERENCES Children(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS PaidProfile (
  childId INTEGER PRIMARY KEY,
  childFullName TEXT NOT NULL,
  childIIN TEXT,
  childBirthDate TEXT,
  manualAge INTEGER,
  manualAgeSetDate TEXT,
  childAge INTEGER NOT NULL,
  parentPhone TEXT NOT NULL,
  parentFullName TEXT,
  enrollmentDate TEXT NOT NULL,
  paymentStartDate TEXT,
  lastPaymentDate TEXT,
  lessonsCount INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (childId) REFERENCES Children(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS AttendanceSessions (
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

CREATE TABLE IF NOT EXISTS AttendancePlannedDates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  groupId INTEGER NOT NULL,
  sessionDate TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'schedule' CHECK(source IN ('schedule', 'manual')),
  createdAt TEXT NOT NULL,
  FOREIGN KEY (groupId) REFERENCES CourseGroups(id) ON DELETE CASCADE,
  UNIQUE(groupId, sessionDate)
);

CREATE TABLE IF NOT EXISTS AttendanceRecords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId INTEGER NOT NULL,
  childId INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('present', 'absent-valid', 'absent-other', 'sick')),
  note TEXT,
  FOREIGN KEY (sessionId) REFERENCES AttendanceSessions(id) ON DELETE CASCADE,
  FOREIGN KEY (childId) REFERENCES Children(id) ON DELETE CASCADE,
  UNIQUE(sessionId, childId)
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
  previousQueueNumber TEXT,
  queueShift INTEGER,
  queueUpdatedAt TEXT,
  queueCategory TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (cityId) REFERENCES Cities(id) ON DELETE CASCADE,
  FOREIGN KEY (studioId) REFERENCES Studios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS PipelineStages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entityType TEXT NOT NULL CHECK(entityType IN ('child', 'queue')),
  entityId INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queue', 'voucher-approved', 'attending', 'risk', 'churned')),
  managerName TEXT,
  taskText TEXT,
  deadlineDate TEXT,
  churnReason TEXT,
  taskDone INTEGER NOT NULL DEFAULT 0,
  taskDoneAt TEXT,
  taskDoneBy TEXT,
  updatedAt TEXT NOT NULL,
  UNIQUE(entityType, entityId)
);

CREATE TABLE IF NOT EXISTS PipelineStatusHistory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entityType TEXT NOT NULL CHECK(entityType IN ('child', 'queue')),
  entityId INTEGER NOT NULL,
  fromStatus TEXT,
  toStatus TEXT NOT NULL CHECK(toStatus IN ('queue', 'voucher-approved', 'attending', 'risk', 'churned')),
  reason TEXT,
  changedBy TEXT NOT NULL,
  changedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS PipelineAutoTaskCompletions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entityType TEXT NOT NULL CHECK(entityType IN ('child', 'queue')),
  entityId INTEGER NOT NULL,
  taskType TEXT NOT NULL,
  taskSignature TEXT NOT NULL,
  completedBy TEXT,
  completedAt TEXT NOT NULL,
  UNIQUE(entityType, entityId, taskType, taskSignature)
);

CREATE TABLE IF NOT EXISTS AuditLogs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actionType TEXT NOT NULL,
  entityType TEXT,
  entityId TEXT,
  actor TEXT NOT NULL,
  summary TEXT NOT NULL,
  payloadJson TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS PaymentComments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  childId INTEGER NOT NULL,
  comment TEXT NOT NULL,
  promisedDate TEXT,
  duePaymentIndex INTEGER,
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

CREATE TABLE IF NOT EXISTS ChildGroupTransfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  childId INTEGER NOT NULL,
  fromStudioId INTEGER,
  fromCourseId INTEGER,
  fromGroupId INTEGER,
  toStudioId INTEGER,
  toCourseId INTEGER,
  toGroupId INTEGER,
  effectiveDate TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (childId) REFERENCES Children(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS StudioWhatsApp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  studioId INTEGER NOT NULL UNIQUE,
  userId TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS ArchivedEntities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entityType TEXT NOT NULL CHECK(entityType IN ('child', 'queue')),
  entityCategory TEXT NOT NULL,
  entityName TEXT NOT NULL,
  sourceId INTEGER,
  snapshotJson TEXT NOT NULL,
  deletedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS AppSettings (
  key TEXT PRIMARY KEY,
  valueJson TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
`;

module.exports = { schemaSql };
