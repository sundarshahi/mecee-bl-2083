-- One row per phone that turned on reminders. Holds only the push address and reminder settings.
CREATE TABLE IF NOT EXISTS subs (
  id TEXT PRIMARY KEY,            -- random id the phone keeps, used to update or delete
  endpoint TEXT NOT NULL UNIQUE,  -- push service address for this phone
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  settings TEXT NOT NULL,         -- JSON: study window, reminder types, exam date, paper time, time zone
  fired TEXT NOT NULL DEFAULT '{}', -- JSON {d: local date, ids: [...]} so a reminder is sent once
  updated INTEGER NOT NULL
);

-- Optional online copy of progress, stored under a secret code only the phone knows.
CREATE TABLE IF NOT EXISTS backups (
  code TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated INTEGER NOT NULL
);
