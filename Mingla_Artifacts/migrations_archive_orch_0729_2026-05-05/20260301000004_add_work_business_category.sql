-- Migration: Add Work & Business category
-- Date: 2026-03-01
-- Adds 'Work & Business' to the valid categories in the system.
-- No schema change needed — categories is TEXT[]. Just update defaults.

BEGIN;

-- Clean up any legacy intent IDs accidentally stored as categories
UPDATE public.preferences
SET categories = array_remove(
  array_remove(
    array_remove(
      array_remove(
        array_remove(
          array_remove(
            array_remove(categories, 'adventurous'),
          'first-date'),
        'romantic'),
      'friendly'),
    'group-fun'),
  'picnic-dates'),
'take-a-stroll')
WHERE categories && ARRAY[
  'adventurous', 'first-date', 'romantic', 'friendly',
  'group-fun', 'picnic-dates', 'take-a-stroll'
];

COMMIT;
