-- AI Validation Restructure: add ai_reason to place_pool + backfill from card_pool

ALTER TABLE place_pool ADD COLUMN IF NOT EXISTS ai_reason TEXT;

-- Backfill ai_reason from card_pool for already-validated places (~809)
UPDATE place_pool pp
SET ai_reason = cp.ai_reason
FROM card_pool cp
WHERE cp.place_pool_id = pp.id
  AND cp.card_type = 'single'
  AND cp.is_active = true
  AND cp.ai_reason IS NOT NULL
  AND pp.ai_reason IS NULL;
