-- Add owner fields to search operations for Google-authenticated creators
ALTER TABLE search_operations ADD COLUMN owner_google_id TEXT;
ALTER TABLE search_operations ADD COLUMN owner_name TEXT;
ALTER TABLE search_operations ADD COLUMN owner_email TEXT;

-- Index for owner lookups
CREATE INDEX IF NOT EXISTS idx_search_operations_owner ON search_operations(owner_google_id);
