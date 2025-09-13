-- Add category_slug column to experiences table
ALTER TABLE public.experiences 
ADD COLUMN category_slug text;

-- Create a mapping function to convert old categories to new slugs
CREATE OR REPLACE FUNCTION map_category_to_slug(old_category text)
RETURNS text AS $$
BEGIN
  CASE old_category
    WHEN 'Coffee & Walk' THEN RETURN 'sip';
    WHEN 'Sip & Chill' THEN RETURN 'sip';
    WHEN 'Creative Date' THEN RETURN 'creative';
    WHEN 'Creative & Hands-On' THEN RETURN 'creative';
    WHEN 'Brunch' THEN RETURN 'casual_eats';
    WHEN 'Casual Eats' THEN RETURN 'casual_eats';
    WHEN 'Quick Bite' THEN RETURN 'casual_eats';
    WHEN 'Activity Date' THEN RETURN 'play_move';
    WHEN 'Play & Move' THEN RETURN 'play_move';
    WHEN 'Dinner' THEN RETURN 'dining';
    WHEN 'Dining Experience' THEN RETURN 'dining';
    WHEN 'Take a Stroll' THEN RETURN 'stroll';
    WHEN 'Screen & Relax' THEN RETURN 'screen_relax';
    WHEN 'Freestyle' THEN RETURN 'freestyle';
    ELSE RETURN 'freestyle'; -- Default fallback
  END CASE;
END;
$$ LANGUAGE plpgsql;

-- Backfill category_slug from existing category column
UPDATE public.experiences 
SET category_slug = map_category_to_slug(category)
WHERE category_slug IS NULL;

-- Make category_slug non-nullable and add constraint for valid slugs
ALTER TABLE public.experiences 
ALTER COLUMN category_slug SET NOT NULL;

-- Add constraint to ensure only valid category slugs
ALTER TABLE public.experiences 
ADD CONSTRAINT valid_category_slug 
CHECK (category_slug IN ('stroll', 'sip', 'casual_eats', 'screen_relax', 'creative', 'play_move', 'dining', 'freestyle'));

-- Add index for better query performance
CREATE INDEX idx_experiences_category_slug ON public.experiences(category_slug);

-- Drop the mapping function as it's no longer needed
DROP FUNCTION map_category_to_slug(text);