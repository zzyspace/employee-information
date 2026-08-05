CREATE TABLE IF NOT EXISTS employee_submissions (
  submit_id INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  position TEXT CHECK (position IN ('front_of_house', 'back_of_house')),
  store_key TEXT NOT NULL CHECK (store_key IN ('fuzzy', 'fuzzy_qz', 'peanut')),
  current_id_card_front_attachment_id TEXT,
  current_id_card_back_attachment_id TEXT,
  current_health_certificate_attachment_id TEXT,
  current_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (current_id_card_front_attachment_id)
    REFERENCES employee_attachment_versions(attachment_version_id) ON DELETE RESTRICT,
  FOREIGN KEY (current_id_card_back_attachment_id)
    REFERENCES employee_attachment_versions(attachment_version_id) ON DELETE RESTRICT,
  FOREIGN KEY (current_health_certificate_attachment_id)
    REFERENCES employee_attachment_versions(attachment_version_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS employee_attachment_versions (
  attachment_version_id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('id_card_front', 'id_card_back', 'health_certificate')),
  storage_path TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES employee_submissions(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS employee_submission_revisions (
  revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'deleted', 'restored')),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  position TEXT CHECK (position IN ('front_of_house', 'back_of_house')),
  store_key TEXT NOT NULL,
  id_card_front_attachment_id TEXT NOT NULL,
  id_card_back_attachment_id TEXT NOT NULL,
  health_certificate_attachment_id TEXT,
  changed_at TEXT NOT NULL,
  actor_username TEXT,
  UNIQUE (submission_id, version),
  FOREIGN KEY (submission_id) REFERENCES employee_submissions(id) ON DELETE RESTRICT,
  FOREIGN KEY (id_card_front_attachment_id)
    REFERENCES employee_attachment_versions(attachment_version_id) ON DELETE RESTRICT,
  FOREIGN KEY (id_card_back_attachment_id)
    REFERENCES employee_attachment_versions(attachment_version_id) ON DELETE RESTRICT,
  FOREIGN KEY (health_certificate_attachment_id)
    REFERENCES employee_attachment_versions(attachment_version_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_employee_submissions_created_at
  ON employee_submissions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_submissions_phone
  ON employee_submissions(phone);
CREATE INDEX IF NOT EXISTS idx_employee_submissions_store_key
  ON employee_submissions(store_key);
CREATE INDEX IF NOT EXISTS idx_employee_submissions_deleted_at
  ON employee_submissions(deleted_at);
CREATE INDEX IF NOT EXISTS idx_employee_attachment_versions_submission
  ON employee_attachment_versions(submission_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_submission_revisions_submission
  ON employee_submission_revisions(submission_id, version DESC);
