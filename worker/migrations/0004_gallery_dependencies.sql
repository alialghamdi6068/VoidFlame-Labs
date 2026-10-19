ALTER TABLE projects ADD COLUMN requirements TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN gallery TEXT NOT NULL DEFAULT '[]';
ALTER TABLE versions ADD COLUMN dependencies TEXT NOT NULL DEFAULT '[]';
CREATE TABLE IF NOT EXISTS project_media (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_project_media_project_created ON project_media(project_id,created_at DESC);
