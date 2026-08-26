-- ===========================================================================
-- Issue #2614 — restore the column that a VERSION COLLISION swallowed.
-- ---------------------------------------------------------------------------
-- `20260615000000_orch_426_discover_cache_gzip.sql` adds
-- `discover_merged_events_cache.response_gzip_base64`. It merged, and it never
-- reached production.
--
-- It shares its 14-digit version prefix with
-- `20260615000000_orch_0877_patch_event_when_rpc.sql`. `schema_migrations` is
-- keyed on VERSION ALONE, so the receipt written for orch_0877 made the whole
-- version read as applied — `migration up` skips the second file, and a
-- version-comparing audit reports a clean ledger. Six such pairs exist; this is
-- the only one where the swallowed file carried unapplied DDL.
--
-- The damage was silent because BOTH code paths tolerate the missing column:
-- `readDbDiscoverCacheGzip` does `if (error || !data) return null`, turning
-- PostgREST's 42703 into an ordinary cache miss, and `writeDbDiscoverCache`
-- never checks its upsert error at all. Verified 2026-08-26: the table holds
-- 0 rows and has NEVER held one, so every discover-merged-events request has
-- recomputed the full merged feed since 2026-06-15.
--
-- Additive, idempotent, non-destructive: a nullable text column. The original
-- file is left untouched — rewriting a merged migration's version is a worse
-- hazard than superseding it.
-- ===========================================================================

BEGIN;

ALTER TABLE public.discover_merged_events_cache
  ADD COLUMN IF NOT EXISTS response_gzip_base64 text;

COMMIT;
