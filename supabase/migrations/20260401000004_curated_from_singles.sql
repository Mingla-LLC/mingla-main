-- Add reference from curated card stops to the single card used as the building block
ALTER TABLE card_pool_stops
  ADD COLUMN IF NOT EXISTS stop_card_pool_id UUID REFERENCES card_pool(id);
