-- Drop dead RPC functions that were defined but never wired to any
-- trigger, cron job, or application code.
--
-- cleanup_old_location_history  — initial_schema, never called
-- cleanup_stale_impressions     — card_pool_pipeline, never called
-- cleanup_stale_presence        — chat_presence_and_typing, never called

DROP FUNCTION IF EXISTS public.cleanup_old_location_history();
DROP FUNCTION IF EXISTS public.cleanup_stale_impressions();
DROP FUNCTION IF EXISTS public.cleanup_stale_presence();
