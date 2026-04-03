-- Search Operations
CREATE TABLE search_operations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT
);

-- Participants (volunteers who join a search, no login required)
CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  search_id TEXT NOT NULL,
  device_uuid TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (search_id) REFERENCES search_operations(id)
);

-- GPS tracks (append-only for non-admins)
CREATE TABLE gps_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  search_id TEXT NOT NULL,
  device_uuid TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  accuracy REAL,
  recorded_at TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (search_id) REFERENCES search_operations(id)
);

-- Admins (authenticated via Google OAuth)
CREATE TABLE admins (
  id TEXT PRIMARY KEY,
  google_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for common queries
CREATE INDEX idx_participants_search ON participants(search_id);
CREATE INDEX idx_participants_device ON participants(device_uuid);
CREATE INDEX idx_gps_tracks_search ON gps_tracks(search_id);
CREATE INDEX idx_gps_tracks_device ON gps_tracks(device_uuid);
CREATE INDEX idx_gps_tracks_recorded ON gps_tracks(search_id, recorded_at);
CREATE INDEX idx_search_operations_status ON search_operations(status);
