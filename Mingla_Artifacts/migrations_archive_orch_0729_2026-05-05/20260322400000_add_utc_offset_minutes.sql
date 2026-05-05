-- Add UTC offset to place_pool (source of truth for venue timezone)
ALTER TABLE place_pool ADD COLUMN IF NOT EXISTS utc_offset_minutes INTEGER;

-- Add UTC offset to card_pool (propagated from place_pool at card generation time)
ALTER TABLE card_pool ADD COLUMN IF NOT EXISTS utc_offset_minutes INTEGER;

-- Comment for future developers
COMMENT ON COLUMN place_pool.utc_offset_minutes IS 'Venue UTC offset in minutes from Google Places API. E.g., EST = -300, GMT = 0, IST = 330. Null for places seeded before this field was added.';
COMMENT ON COLUMN card_pool.utc_offset_minutes IS 'Propagated from place_pool.utc_offset_minutes at card generation time. Null for cards generated before this field was added.';
