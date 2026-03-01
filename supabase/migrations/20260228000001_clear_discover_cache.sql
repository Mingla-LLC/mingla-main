-- Clear the discover daily cache to force fresh card generation
TRUNCATE TABLE public.discover_daily_cache CASCADE;
