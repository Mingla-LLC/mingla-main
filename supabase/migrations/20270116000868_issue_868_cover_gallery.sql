-- issue #868 [cover-gallery] — Layer 1 (SPEC-868 §B)
--
-- Adds an ADDITIVE ordered cover-gallery column to public.events. Item #1 of the
-- hero sequence stays the PRIMARY cover (cover_media_url/_type, image OR video);
-- this column holds ONLY the ADDITIONAL image/GIF items (hero indices 1..N).
-- Idempotent + additive: existing rows backfill to '[]' (Constitution #9 — a
-- zero-extra-photo offering renders exactly as today: single cover, no row, no
-- pager). Per-item {url,type?,alt?,credit?,w?,h?} validation is enforced
-- application-side (never 'video'), exactly like trip_days.media /
-- coerceTripDayMedia; this CHECK only guards against a non-array scalar.
--
-- INDEPENDENT of cover_media_url/_type: NO write path syncs, derives, or clears
-- one column from the other (I-PROPOSED-868-GALLERY-ADDITIVE-INDEPENDENT). A
-- video cover and a photo gallery COEXIST.
--
-- NO RLS change: the column inherits the existing public.events row policies,
-- exactly as ORCH-1119's trip_days.media inherited trip_days' policies. Anon read
-- is via the SECURITY DEFINER hero RPCs / views (Section C), which already gate
-- visibility.
--
-- Version note: collision-scanned against the anchor and every sibling worktree
-- under ~/Desktop/mingla-orchs/*/supabase/migrations on 2026-07-28; the
-- strictly-greatest existing migration everywhere is
-- 20270115000865_issue_865_rollup_rls_reservation_attribution.sql. 20270116000868
-- is strictly greater than every observed max (migration-monotonicity invariant,
-- cross-host rule 10) and encodes the issue number (…000868).
--
-- Mirrors VERBATIM the pattern in
-- 20260928000000_orch_1119_trip_day_media.sql:19-34.

BEGIN;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS cover_media_gallery jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Shape guard ONLY (item {url,type?,alt?,credit?,w?,h?} validation is app-side,
-- exactly like trip_days.media / coerceTripDayMedia). This CHECK only blocks a
-- non-array scalar. NO exclusion/sync CHECK — the gallery is independent of the
-- cover columns.
ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_cover_media_gallery_is_array;
ALTER TABLE public.events
  ADD CONSTRAINT events_cover_media_gallery_is_array
  CHECK (jsonb_typeof(cover_media_gallery) = 'array');

COMMENT ON COLUMN public.events.cover_media_gallery IS
  'issue #868: ADDITIONAL cover-gallery items (image/GIF ONLY, never video), ordered, hero indices 1..N. jsonb array of {url:text, type?:"image"|"gif", alt?:text, credit?:text, w?:int, h?:int}. Default [] = single-cover behavior (Constitution #9). INDEPENDENT of cover_media_url/_type — no write path syncs or derives between the two. The primary cover (image OR video) stays in cover_media_url/_type as today.';

COMMIT;
NOTIFY pgrst, 'reload schema';
