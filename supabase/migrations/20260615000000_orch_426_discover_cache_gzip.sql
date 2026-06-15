-- ORCH-426 G1 — store pre-compressed discover payload for cross-isolate hot path.
-- Cold isolates serve gzip bytes without JSON parse + re-stringify.

BEGIN;

ALTER TABLE public.discover_merged_events_cache
  ADD COLUMN IF NOT EXISTS response_gzip_base64 text;

COMMIT;
