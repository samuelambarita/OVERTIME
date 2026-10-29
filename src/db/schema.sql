CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('IT','NON_IT'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  nik TEXT UNIQUE,
  email TEXT,
  level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 8),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  supervisor_id INTEGER REFERENCES users(id),
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS overtime_requests (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  requester_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('PERSONAL','GROUP')),
  work_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  activity TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PROCESSING','APPROVED','REJECTED','CANCELLED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS overtime_participants (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES overtime_requests(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  manager_approver_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL CHECK(status IN ('WAITING_MANAGER','WAITING_HR','APPROVED','REJECTED')),
  manager_decided_by INTEGER REFERENCES users(id),
  manager_decided_at TEXT,
  manager_note TEXT,
  hr_decided_by INTEGER REFERENCES users(id),
  hr_decided_at TEXT,
  hr_note TEXT,
  actual_start TEXT,
  actual_end TEXT,
  realized_at TEXT,
  UNIQUE(request_id, user_id)
);

CREATE TABLE IF NOT EXISTS participant_chain (
  participant_id INTEGER NOT NULL REFERENCES overtime_participants(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY(participant_id, user_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_participants_status_approver ON overtime_participants(status, manager_approver_id);
CREATE INDEX IF NOT EXISTS idx_participants_user ON overtime_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_requests_work_date ON overtime_requests(work_date);
