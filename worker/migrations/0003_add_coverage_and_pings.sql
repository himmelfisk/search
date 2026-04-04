-- Add coverage_radius to search_operations and create observation_pings table

-- Clean up temp table from any previous failed attempt of this migration
DROP TABLE IF EXISTS _search_operations_new;

-- Add coverage_radius directly via ALTER TABLE to avoid FOREIGN KEY constraint
-- violations (participants and gps_tracks reference search_operations).
ALTER TABLE search_operations ADD COLUMN coverage_radius INTEGER DEFAULT 10;

-- Create observation_pings table
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
