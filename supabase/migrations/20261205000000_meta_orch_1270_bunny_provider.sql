-- META-ORCH-1270 (Phase 1) — Bunny Stream provider branch.
--
-- Extends the provider-agnostic event_cover_video_jobs pipeline (ORCH-0770 /
-- ORCH-0989) to ALSO accept a 'bunny' provider value, and adds a lookup index
-- on source_asset_id so the LIBRARY-level Bunny webhook can find a job by its
-- Bunny video guid (which is persisted into source_asset_id at upload-intent).
--
-- Cloudinary behavior is UNCHANGED: this migration only WIDENS the provider
-- CHECK allowlist and ADDS a partial index. No existing rows are rewritten,
-- no columns are dropped, no data migration (prod DB was wiped 2026-06-22;
-- there are 0 live cover videos). Cloudinary retirement is Phase 4.

-- 1) Widen the provider allowlist to include 'bunny'. The original CHECK was an
--    inline anonymous column constraint in the ORCH-0770 CREATE TABLE, which
--    Postgres names `event_cover_video_jobs_provider_check`. Drop-if-exists then
--    re-add under the same canonical name so the constraint is idempotent and
--    self-documenting.
ALTER TABLE public.event_cover_video_jobs
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_provider_check;
ALTER TABLE public.event_cover_video_jobs
  ADD CONSTRAINT event_cover_video_jobs_provider_check
    CHECK (provider IN ('cloudinary', 'transloadit', 'bunny'));

-- 2) Webhook lookup key. The Bunny webhook is configured ONCE at the library
--    level and identifies the asset only by its VideoGuid, so the webhook edge
--    function looks up the owning job via `source_asset_id = VideoGuid`. Index
--    that column (partial: only rows that carry a provider asset id) so the
--    library webhook lookup is a single index probe, never a table scan.
CREATE INDEX IF NOT EXISTS idx_event_cover_video_jobs_source_asset
ON public.event_cover_video_jobs (source_asset_id)
WHERE source_asset_id IS NOT NULL;

COMMENT ON CONSTRAINT event_cover_video_jobs_provider_check
  ON public.event_cover_video_jobs IS
  'META-ORCH-1270: provider allowlist. cloudinary (legacy, retires Phase 4), transloadit (unused), bunny (Bunny Stream host).';
