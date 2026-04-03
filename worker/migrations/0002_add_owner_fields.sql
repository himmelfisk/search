-- Add owner fields to search operations for Google-authenticated creators
-- Uses table recreation to be idempotent (SQLite lacks ALTER TABLE ADD COLUMN IF NOT EXISTS)

-- Step 1: Create new table with full schema including owner fields
CREATE TABLE IF NOT EXISTS _search_operations_new (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT,
  owner_google_id TEXT,
  owner_name TEXT,
  owner_email TEXT
);

-- Step 2: Copy existing data (owner fields default to NULL)
INSERT OR IGNORE INTO _search_operations_new (id, title, description, status, created_at, created_by)
  SELECT id, title, description, status, created_at, created_by FROM search_operations;

-- Step 3: Replace old table
DROP TABLE IF EXISTS search_operations;
ALTER TABLE _search_operations_new RENAME TO search_operations;

-- Step 4: Recreate base indexes (dropped with old table) and add owner index
CREATE INDEX IF NOT EXISTS idx_search_operations_status ON search_operations(status);
CREATE INDEX IF NOT EXISTS idx_search_operations_owner ON search_operations(owner_google_id);
