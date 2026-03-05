-- Purge stale adventure curated cards from the card pool.
-- These were generated using the old CURATED_TYPE_CATEGORIES pipeline (Mingla category names
-- as pairingKey). The new Adventure Groups pipeline produces cards with group labels
-- (e.g., "Outdoor|Exotic Eats|Adrenaline") instead. Old cards would serve inconsistent data.
-- This is a one-time cleanup — new adventure cards will be pooled with the correct format.

DELETE FROM card_pool
WHERE card_type = 'curated'
  AND experience_type = 'adventurous';
