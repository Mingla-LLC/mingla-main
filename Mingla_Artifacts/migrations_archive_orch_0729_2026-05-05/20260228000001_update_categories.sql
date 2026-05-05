-- Migration: Category System Overhaul v2
-- Date: 2026-02-28
-- Replaces old 9-category system with new 10-category system

BEGIN;

-- 1. Update default value for new users
ALTER TABLE public.preferences
  ALTER COLUMN categories SET DEFAULT ARRAY['Nature', 'Casual Eats', 'Drink'];

-- 2. Migrate existing user preferences (old name -> new name)
UPDATE public.preferences
SET categories = (
  SELECT array_agg(DISTINCT new_name)
  FROM unnest(categories) AS old_cat
  JOIN (VALUES
    ('Stroll',                'Nature'),
    ('stroll',                'Nature'),
    ('Take a Stroll',         'Nature'),
    ('take a stroll',         'Nature'),
    ('take_a_stroll',         'Nature'),
    ('Sip & Chill',           'Drink'),
    ('sip',                   'Drink'),
    ('sip & chill',           'Drink'),
    ('sip_and_chill',         'Drink'),
    ('Casual Eats',           'Casual Eats'),
    ('casual_eats',           'Casual Eats'),
    ('casual eats',           'Casual Eats'),
    ('screenRelax',           'Watch'),
    ('Screen & Relax',        'Watch'),
    ('screen_relax',          'Watch'),
    ('screen & relax',        'Watch'),
    ('Creative & Hands-On',   'Creative & Arts'),
    ('creative',              'Creative & Arts'),
    ('creative_and_hands_on', 'Creative & Arts'),
    ('Picnics',               'Picnic'),
    ('picnics',               'Picnic'),
    ('picnic',                'Picnic'),
    ('Play & Move',           'Play'),
    ('play_move',             'Play'),
    ('play & move',           'Play'),
    ('play_and_move',         'Play'),
    ('Dining Experiences',    'Fine Dining'),
    ('dining',                'Fine Dining'),
    ('dining_experiences',    'Fine Dining'),
    ('Dining Experience',     'Fine Dining'),
    ('Wellness Dates',        'Wellness'),
    ('wellness',              'Wellness'),
    ('wellness_dates',        'Wellness'),
    ('wellness dates',        'Wellness'),
    ('Freestyle',             'Nature'),
    ('freestyle',             'Nature')
  ) AS mapping(old_name, new_name) ON lower(old_cat) = lower(old_name)
  WHERE new_name IS NOT NULL
)
WHERE categories IS NOT NULL AND array_length(categories, 1) > 0;

-- 3. Handle users with unmapped or null categories (give them safe defaults)
UPDATE public.preferences
SET categories = ARRAY['Nature', 'Casual Eats', 'Drink']
WHERE categories IS NULL OR array_length(categories, 1) = 0;

-- 4. Migrate experiences.category values
UPDATE public.experiences
SET category = CASE lower(category)
  WHEN 'stroll'                THEN 'nature'
  WHEN 'take a stroll'         THEN 'nature'
  WHEN 'take_a_stroll'         THEN 'nature'
  WHEN 'sip'                   THEN 'drink'
  WHEN 'sip & chill'           THEN 'drink'
  WHEN 'sip_and_chill'         THEN 'drink'
  WHEN 'casual_eats'           THEN 'casual_eats'
  WHEN 'casual eats'           THEN 'casual_eats'
  WHEN 'screenrelax'           THEN 'watch'
  WHEN 'screen & relax'        THEN 'watch'
  WHEN 'screen_relax'          THEN 'watch'
  WHEN 'creative'              THEN 'creative_arts'
  WHEN 'creative & hands-on'   THEN 'creative_arts'
  WHEN 'creative_and_hands_on' THEN 'creative_arts'
  WHEN 'picnics'               THEN 'picnic'
  WHEN 'play_move'             THEN 'play'
  WHEN 'play & move'           THEN 'play'
  WHEN 'play_and_move'         THEN 'play'
  WHEN 'dining'                THEN 'fine_dining'
  WHEN 'dining experiences'    THEN 'fine_dining'
  WHEN 'dining_experiences'    THEN 'fine_dining'
  WHEN 'wellness dates'        THEN 'wellness'
  WHEN 'wellness_dates'        THEN 'wellness'
  WHEN 'freestyle'             THEN 'nature'
  ELSE category
END
WHERE category IS NOT NULL;

COMMIT;
