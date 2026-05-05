-- Add audit columns for tighter AI place validation
ALTER TABLE place_pool ADD COLUMN IF NOT EXISTS ai_primary_identity TEXT;
ALTER TABLE place_pool ADD COLUMN IF NOT EXISTS ai_confidence REAL;
ALTER TABLE place_pool ADD COLUMN IF NOT EXISTS ai_web_evidence TEXT;
