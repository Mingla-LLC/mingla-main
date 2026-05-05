-- ============================================================
-- Fix user_visits: add NOT NULL constraints per spec §4.3
-- ============================================================

-- Ensure no existing nulls before adding constraints
UPDATE public.user_visits SET card_data = '{}'::jsonb WHERE card_data IS NULL;
UPDATE public.user_visits SET visited_at = now() WHERE visited_at IS NULL;
UPDATE public.user_visits SET source = 'manual' WHERE source IS NULL;

ALTER TABLE public.user_visits ALTER COLUMN card_data SET NOT NULL;
ALTER TABLE public.user_visits ALTER COLUMN card_data SET DEFAULT '{}'::jsonb;
ALTER TABLE public.user_visits ALTER COLUMN visited_at SET NOT NULL;
ALTER TABLE public.user_visits ALTER COLUMN visited_at SET DEFAULT now();
ALTER TABLE public.user_visits ALTER COLUMN source SET NOT NULL;
ALTER TABLE public.user_visits ALTER COLUMN source SET DEFAULT 'manual';
