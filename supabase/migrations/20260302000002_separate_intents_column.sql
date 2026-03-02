-- ============================================================================
-- Migration: Separate intents and categories into distinct columns
-- ============================================================================
-- Previously, both intents (e.g. 'adventurous', 'romantic') and place categories
-- (e.g. 'Nature', 'Drink') were stored in a single `categories` TEXT[] column.
-- This caused fragile parsing and the 0-card bug when only intents were present.
--
-- This migration:
--   1. Adds an `intents` column to store experience intents separately
--   2. Migrates existing data: moves intent values from categories to intents
--   3. Leaves categories containing only actual place categories
-- ============================================================================

-- Step 1: Add the intents column
ALTER TABLE preferences ADD COLUMN IF NOT EXISTS intents TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Step 2: Migrate existing data — move intent values from categories to intents
-- Known intent IDs that were stored in categories:
UPDATE preferences
SET intents = ARRAY(
  SELECT unnest(categories)
  INTERSECT
  SELECT unnest(ARRAY[
    'adventurous', 'first-date', 'romantic', 'friendly',
    'group-fun', 'picnic-dates', 'take-a-stroll'
  ])
),
categories = ARRAY(
  SELECT unnest(categories)
  EXCEPT
  SELECT unnest(ARRAY[
    'adventurous', 'first-date', 'romantic', 'friendly',
    'group-fun', 'picnic-dates', 'take-a-stroll'
  ])
)
WHERE categories && ARRAY[
  'adventurous', 'first-date', 'romantic', 'friendly',
  'group-fun', 'picnic-dates', 'take-a-stroll'
];

-- Step 3: Ensure categories with empty arrays after migration get defaults
UPDATE preferences
SET categories = ARRAY['Nature', 'Casual Eats', 'Drink']
WHERE categories = ARRAY[]::TEXT[]
   OR categories IS NULL;
