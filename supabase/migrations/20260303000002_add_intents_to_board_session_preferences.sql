-- Migration: Add intents column to board_session_preferences
-- Mirrors the intents column added to preferences table in 20260302000002

-- Step 1: Add intents column
ALTER TABLE public.board_session_preferences
ADD COLUMN IF NOT EXISTS intents TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Step 2: Migrate existing data — extract intent values from categories
-- Known intent IDs (must match INTENT_IDS in cardConverters.ts)
DO $$
DECLARE
  known_intents TEXT[] := ARRAY['adventurous', 'first-date', 'romantic', 'friendly', 'group-fun', 'picnic-dates', 'take-a-stroll'];
BEGIN
  UPDATE public.board_session_preferences
  SET
    intents = (
      SELECT COALESCE(array_agg(elem), ARRAY[]::TEXT[])
      FROM unnest(categories) AS elem
      WHERE elem = ANY(known_intents)
    ),
    categories = (
      SELECT COALESCE(array_agg(elem), ARRAY[]::TEXT[])
      FROM unnest(categories) AS elem
      WHERE elem != ALL(known_intents)
    )
  WHERE categories && known_intents;
END $$;

-- Step 3: Set default categories for rows that became empty
UPDATE public.board_session_preferences
SET categories = ARRAY['Nature', 'Casual Eats', 'Drink']
WHERE categories = ARRAY[]::TEXT[] OR categories IS NULL;
