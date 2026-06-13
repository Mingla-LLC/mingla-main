-- ORCH-1119 [trip-day-media-gallery] — Layer 1 (SPEC §4.1)
--
-- Adds an OPTIONAL ordered per-day media gallery column to trip_days. Idempotent
-- + additive: existing rows backfill to '[]' (Constitution #9 — a zero-media day
-- renders NO gallery on any surface). The per-item url/type validation is
-- enforced application-side (coerceTripDayMedia) + by the event_covers bucket MIME
-- allowlist; this CHECK only guards against a non-array scalar landing in the
-- column.
--
-- NO RLS change: the column inherits the existing trip_days row policies
-- (trip_days_read_published_or_member SELECT + trip_days_write_brand_members ALL).
--
-- Version note: SPEC §4.1 planned 20260927000000, but sibling worktree ORCH-1116
-- [booking-gate-rls] claimed 20260927000000 after the SPEC was written. Bumped to
-- 20260928000000 to stay strictly-greater than the remote max (20260926000000) AND
-- every sibling-worktree max (the migration-monotonicity invariant, cross-host
-- rule 10).

BEGIN;

ALTER TABLE public.trip_days
  ADD COLUMN IF NOT EXISTS media jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Shape guard: media must be a jsonb ARRAY.
ALTER TABLE public.trip_days
  DROP CONSTRAINT IF EXISTS trip_days_media_is_array;
ALTER TABLE public.trip_days
  ADD CONSTRAINT trip_days_media_is_array
  CHECK (jsonb_typeof(media) = 'array');

COMMENT ON COLUMN public.trip_days.media IS
  'ORCH-1119: optional ordered per-day media gallery. jsonb array of {url:text, type:"image"|"video", provider?:text, width?:int, height?:int}. Default [] = no gallery (rendered as absent, Constitution #9). Brand-authored uploads land in the event_covers bucket under {brandId}/{eventId}/trip-day-media/.';

COMMIT;
