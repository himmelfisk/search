-- Search operations table
CREATE TABLE IF NOT EXISTS search_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  latitude REAL,
  longitude REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Participants table
CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id INTEGER NOT NULL,
  device_uuid TEXT NOT NULL,
  name TEXT,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (operation_id) REFERENCES search_operations(id) ON DELETE CASCADE,
  UNIQUE (operation_id, device_uuid)
);

-- GPS tracks table (append-only)
CREATE TABLE IF NOT EXISTS gps_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id INTEGER NOT NULL,
  device_uuid TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  accuracy REAL,
  recorded_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (operation_id) REFERENCES search_operations(id) ON DELETE CASCADE
);

-- Admins table
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_participants_operation ON participants(operation_id);
CREATE INDEX IF NOT EXISTS idx_participants_device ON participants(device_uuid);
CREATE INDEX IF NOT EXISTS idx_gps_tracks_operation ON gps_tracks(operation_id);
CREATE INDEX IF NOT EXISTS idx_gps_tracks_device ON gps_tracks(device_uuid);
CREATE INDEX IF NOT EXISTS idx_gps_tracks_recorded ON gps_tracks(recorded_at);
CREATE INDEX IF NOT EXISTS idx_search_operations_status ON search_operations(status);
