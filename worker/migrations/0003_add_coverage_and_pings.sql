-- Add coverage_radius to search_operations and create observation_pings table

-- Step 1: Recreate search_operations with coverage_radius column
CREATE TABLE IF NOT EXISTS _search_operations_new (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT,
  owner_google_id TEXT,
  owner_name TEXT,
  owner_email TEXT,
  coverage_radius INTEGER DEFAULT 10
);

INSERT OR IGNORE INTO _search_operations_new (id, title, description, status, created_at, created_by, owner_google_id, owner_name, owner_email)
  SELECT id, title, description, status, created_at, created_by, owner_google_id, owner_name, owner_email FROM search_operations;

DROP TABLE IF EXISTS search_operations;
ALTER TABLE _search_operations_new RENAME TO search_operations;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_search_operations_status ON search_operations(status);
CREATE INDEX IF NOT EXISTS idx_search_operations_owner ON search_operations(owner_google_id);

-- Step 2: Create observation_pings table
CREATE TABLE IF NOT EXISTS observation_pings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  search_id TEXT NOT NULL,
  device_uuid TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (search_id) REFERENCES search_operations(id)
);

CREATE INDEX IF NOT EXISTS idx_observation_pings_search ON observation_pings(search_id);
