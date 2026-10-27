\set ON_ERROR_STOP on

-- Issue #3801 — a cover video the server applies to a DRAFT trip keeps the
-- trip's revision (events.updated_at), so the host's next wizard save, which
-- carries the revision it loaded before the apply, is accepted. Pins
-- 20271231303801_issue_3801_draft_cover_video_keeps_revision.sql.
-- Run after the full migration chain on PostgreSQL 17.
--
-- Every case runs the REAL functions: the job is applied through
-- cover_video_apply_once, the save through biz_apply_trip_draft_graph.
-- Within one transaction now() is constant, so each fixture first moves its
-- trip's revision one hour into the past (triggers off for that one write),
-- which makes "the revision moved" observable.
--
-- A. A ready cover video applied to a DRAFT trip leaves updated_at unchanged,
--    and a save carrying the pre-apply revision then succeeds.
-- B. The same apply on a PUBLISHED trip still moves updated_at (public search
--    staleness and the sitemap read it).
-- C. A real edit to a draft still moves it, and a stale save is still refused
--    with trip_revision_conflict.
-- D. The flag does not leak: after the apply, a second UPDATE in the same
--    transaction moves updated_at, whether it changes the title or only the
--    cover, and the flag reads ''.
-- E. The flag set by hand without a cover-only change does not keep it; a
--    flagged cover change that also changes another column does not keep it.
--
-- Fails on revert: without the migration, A-02 (the apply moves the revision)
-- and A-04 (the pre-apply save is refused) fail. Without the reset after the
-- UPDATE, D-02 / D-04 fail. Without the cover-only check, E-02 fails.
-- MINGLA-INVARIANT: I-3801-COVER-APPLY-KEEPS-UNPUBLISHED-REVISION | issue #3801 | A cover video applied by cover_video_apply_once to an unpublished event leaves events.updated_at unchanged; on a published event it still moves; any other change to an unpublished event still moves it; the flag never outlives the apply's own UPDATE.

BEGIN;

SELECT set_config('request.jwt.claim.sub', '38010000-0000-4000-8000-00000000c001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
INSERT INTO auth.users(id, email)
VALUES ('38010000-0000-4000-8000-00000000c001', 'issue3801-cover@example.test');
INSERT INTO public.creator_accounts(id) VALUES ('38010000-0000-4000-8000-00000000c001');
INSERT INTO public.brands(id, account_id, name, slug, default_currency)
VALUES ('38010000-0000-4000-8000-00000000c010', '38010000-0000-4000-8000-00000000c001',
        'Issue 3801 Cover Brand', 'issue-3801-cover', 'GBP');

-- A trip draft whose revision is one hour old. Returns the event id.
CREATE FUNCTION pg_temp.aged_trip(p_title text) RETURNS uuid
LANGUAGE plpgsql AS $fx$
DECLARE v_event uuid;
BEGIN
  SELECT (public.biz_create_trip_draft(
    '38010000-0000-4000-8000-00000000c010',
    jsonb_build_object('title', p_title, 'timezone', 'Europe/London'),
    gen_random_uuid())#>>'{event,id}')::uuid INTO v_event;
  IF v_event IS NULL THEN RAISE EXCEPTION 'ISSUE-3801 fixture FAIL: trip draft not created'; END IF;
  PERFORM pg_temp.age_revision(v_event);
  RETURN v_event;
END
$fx$;

-- Move a trip's revision one hour back without firing any trigger.
CREATE FUNCTION pg_temp.age_revision(p_event uuid) RETURNS timestamptz
LANGUAGE plpgsql AS $fx$
DECLARE v_rev timestamptz;
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.events SET updated_at = now() - interval '1 hour' WHERE id = p_event
  RETURNING updated_at INTO v_rev;
  PERFORM set_config('session_replication_role', 'origin', true);
  RETURN v_rev;
END
$fx$;

-- A ready cover video job for the event, applied the way the webhook does.
CREATE FUNCTION pg_temp.apply_video(p_event uuid) RETURNS public.event_cover_video_jobs
LANGUAGE plpgsql AS $fx$
DECLARE j public.event_cover_video_jobs; v_url text := 'https://vz-test.b-cdn.net/' || p_event || '/play_720p.mp4';
BEGIN
  INSERT INTO public.event_cover_video_jobs(requested_by, event_id, brand_id, provider, status,
    apply_mode, target_kind, source_asset_id, source_duration_ms, trim_start_ms, trim_end_ms,
    processed_url, processed_poster_url, processed_mime_type, processed_bytes, processed_duration_ms)
  VALUES ('38010000-0000-4000-8000-00000000c001', p_event, '38010000-0000-4000-8000-00000000c010',
    'bunny', 'ready', 'draft_auto', 'event', 'guid-' || p_event, 13000, 0, 13000, v_url,
    'https://vz-test.b-cdn.net/' || p_event || '/thumbnail.jpg', 'video/mp4', 4096, 13000)
  RETURNING * INTO j;
  j := public.cover_video_apply_once(j.id, 0, v_url, NULL);
  IF j.status <> 'applied'
     OR (SELECT cover_media_url FROM public.events WHERE id = p_event) IS DISTINCT FROM v_url THEN
    RAISE EXCEPTION 'ISSUE-3801 fixture FAIL: the job did not apply its video (status %)', j.status;
  END IF;
  RETURN j;
END
$fx$;

CREATE FUNCTION pg_temp.rev(p_event uuid) RETURNS timestamptz
LANGUAGE sql STABLE AS $$ SELECT updated_at FROM public.events WHERE id = p_event $$;

-- A Step 1 save: a title change, no cover keys (the wizard holds the cover).
CREATE FUNCTION pg_temp.save(p_event uuid, p_rev timestamptz, p_title text) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT public.biz_apply_trip_draft_graph(p_event,
    jsonb_build_object('event', jsonb_build_object('title', p_title)), p_rev, gen_random_uuid())
$$;

DO $cases$
DECLARE
  v_event uuid;
  v_rev timestamptz;
  v_graph jsonb;
  v_state text;
  v_message text;
BEGIN
  -- ── A: a draft keeps its revision through the server's cover apply ──────
  v_event := pg_temp.aged_trip('Issue 3801 A');
  v_rev := pg_temp.rev(v_event);
  IF v_rev >= now() THEN RAISE EXCEPTION 'ISSUE-3801 A-01 FAIL: fixture revision was not aged'; END IF;
  PERFORM pg_temp.apply_video(v_event);
  IF pg_temp.rev(v_event) IS DISTINCT FROM v_rev THEN
    RAISE EXCEPTION 'ISSUE-3801 A-02 FAIL: applying a cover video to a draft moved its revision from % to %',
      v_rev, pg_temp.rev(v_event);
  END IF;
  IF (SELECT cover_media_type FROM public.events WHERE id = v_event) IS DISTINCT FROM 'video' THEN
    RAISE EXCEPTION 'ISSUE-3801 A-03 FAIL: the video was not written to the draft';
  END IF;
  BEGIN
    v_graph := pg_temp.save(v_event, v_rev, 'Issue 3801 A saved');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    RAISE EXCEPTION 'ISSUE-3801 A-04 FAIL: the save carrying the pre-apply revision was refused: % / %',
      v_state, v_message;
  END;
  IF (SELECT title FROM public.events WHERE id = v_event) IS DISTINCT FROM 'Issue 3801 A saved'
     OR (SELECT cover_media_type FROM public.events WHERE id = v_event) IS DISTINCT FROM 'video'
     OR pg_temp.rev(v_event) = v_rev THEN
    RAISE EXCEPTION 'ISSUE-3801 A-05 FAIL: the save did not land, lost the video, or did not move the revision';
  END IF;
  RAISE NOTICE 'ISSUE-3801 A PASS: a draft keeps its revision through a cover apply; the pre-apply save lands';

  -- ── B: a published trip still moves ────────────────────────────────────
  v_event := pg_temp.aged_trip('Issue 3801 B');
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.events SET status = 'scheduled' WHERE id = v_event;
  PERFORM set_config('session_replication_role', 'origin', true);
  v_rev := pg_temp.rev(v_event);
  PERFORM pg_temp.apply_video(v_event);
  IF pg_temp.rev(v_event) IS NOT DISTINCT FROM v_rev OR pg_temp.rev(v_event) <> now() THEN
    RAISE EXCEPTION 'ISSUE-3801 B-01 FAIL: a cover video applied to a published trip did not move updated_at (still %)',
      pg_temp.rev(v_event);
  END IF;
  RAISE NOTICE 'ISSUE-3801 B PASS: a published trip''s revision still moves on a cover apply';

  -- ── C: a real edit to a draft still moves it; a stale save is refused ──
  v_event := pg_temp.aged_trip('Issue 3801 C');
  v_rev := pg_temp.rev(v_event);
  UPDATE public.events SET title = 'Renamed somewhere else' WHERE id = v_event;
  IF pg_temp.rev(v_event) IS NOT DISTINCT FROM v_rev THEN
    RAISE EXCEPTION 'ISSUE-3801 C-01 FAIL: a real edit to a draft did not move its revision';
  END IF;
  v_state := NULL; v_message := NULL;
  BEGIN
    PERFORM pg_temp.save(v_event, v_rev, 'A stale title that must not win');
    RAISE EXCEPTION 'ISSUE-3801 C-02 FAIL: a stale save was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
  END;
  -- #4134 moves this condition from 40001 to PT409; the message is the contract.
  IF v_message IS DISTINCT FROM 'trip_revision_conflict' OR v_state NOT IN ('40001', 'PT409') THEN
    RAISE EXCEPTION 'ISSUE-3801 C-03 FAIL: stale save returned % / %', v_state, v_message;
  END IF;
  IF (SELECT title FROM public.events WHERE id = v_event) IS DISTINCT FROM 'Renamed somewhere else' THEN
    RAISE EXCEPTION 'ISSUE-3801 C-04 FAIL: the refused save changed the title';
  END IF;
  -- A rename elsewhere, then a video applied: the host's pre-rename save is
  -- still refused and overwrites nothing.
  v_rev := pg_temp.age_revision(v_event);
  UPDATE public.events SET title = 'Renamed again' WHERE id = v_event;
  PERFORM pg_temp.apply_video(v_event);
  v_state := NULL; v_message := NULL;
  BEGIN
    PERFORM pg_temp.save(v_event, v_rev, 'Stale again');
    RAISE EXCEPTION 'ISSUE-3801 C-05 FAIL: a stale save after a video apply was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
  END;
  IF v_message IS DISTINCT FROM 'trip_revision_conflict'
     OR (SELECT title FROM public.events WHERE id = v_event) IS DISTINCT FROM 'Renamed again' THEN
    RAISE EXCEPTION 'ISSUE-3801 C-06 FAIL: stale save after a video apply returned % / % or overwrote the title',
      v_state, v_message;
  END IF;
  RAISE NOTICE 'ISSUE-3801 C PASS: a real draft edit moves the revision; a stale save is refused with trip_revision_conflict';

  -- ── D: the flag does not leak past the apply's own UPDATE ──────────────
  v_event := pg_temp.aged_trip('Issue 3801 D');
  v_rev := pg_temp.rev(v_event);
  PERFORM pg_temp.apply_video(v_event);
  IF pg_temp.rev(v_event) IS DISTINCT FROM v_rev THEN
    RAISE EXCEPTION 'ISSUE-3801 D-01 FAIL: fixture apply moved the draft revision';
  END IF;
  IF pg_catalog.current_setting('mingla.cover_video_apply', true) IS DISTINCT FROM '' THEN
    RAISE EXCEPTION 'ISSUE-3801 D-02 FAIL: the flag outlived the apply (%)',
      pg_catalog.current_setting('mingla.cover_video_apply', true);
  END IF;
  UPDATE public.events SET title = 'Second write' WHERE id = v_event;
  IF pg_temp.rev(v_event) IS NOT DISTINCT FROM v_rev THEN
    RAISE EXCEPTION 'ISSUE-3801 D-03 FAIL: a non-cover UPDATE after the apply kept the revision';
  END IF;
  v_rev := pg_temp.age_revision(v_event);
  PERFORM pg_temp.apply_video(v_event);
  UPDATE public.events SET cover_media_url = 'https://images.example.test/host-photo.jpg',
         cover_media_type = 'image' WHERE id = v_event;
  IF pg_temp.rev(v_event) IS NOT DISTINCT FROM v_rev THEN
    RAISE EXCEPTION 'ISSUE-3801 D-04 FAIL: a cover-only UPDATE after the apply kept the revision (the flag leaked)';
  END IF;
  RAISE NOTICE 'ISSUE-3801 D PASS: the flag is reset after the apply; later UPDATEs move the revision';

  -- ── E: the flag alone, or a flagged change beyond the cover, bumps ─────
  v_event := pg_temp.aged_trip('Issue 3801 E');
  v_rev := pg_temp.rev(v_event);
  PERFORM pg_catalog.set_config('mingla.cover_video_apply', 'on', true);
  UPDATE public.events SET title = 'Flagged but not a cover change' WHERE id = v_event;
  IF pg_temp.rev(v_event) IS NOT DISTINCT FROM v_rev THEN
    PERFORM pg_catalog.set_config('mingla.cover_video_apply', '', true);
    RAISE EXCEPTION 'ISSUE-3801 E-01 FAIL: the flag kept the revision through a title change';
  END IF;
  v_rev := pg_temp.age_revision(v_event);
  UPDATE public.events SET cover_media_url = 'https://images.example.test/x.jpg',
         cover_media_type = 'image', title = 'Cover and title' WHERE id = v_event;
  IF pg_temp.rev(v_event) IS NOT DISTINCT FROM v_rev THEN
    PERFORM pg_catalog.set_config('mingla.cover_video_apply', '', true);
    RAISE EXCEPTION 'ISSUE-3801 E-02 FAIL: a flagged cover change that also changed the title kept the revision';
  END IF;
  -- Control: the flagged cover-only change on a draft is what keeps it.
  v_rev := pg_temp.age_revision(v_event);
  UPDATE public.events SET cover_media_url = 'https://images.example.test/y.jpg' WHERE id = v_event;
  PERFORM pg_catalog.set_config('mingla.cover_video_apply', '', true);
  IF pg_temp.rev(v_event) IS DISTINCT FROM v_rev THEN
    RAISE EXCEPTION 'ISSUE-3801 E-03 FAIL: the flagged cover-only change on a draft moved the revision';
  END IF;
  RAISE NOTICE 'ISSUE-3801 E PASS: only a flagged, cover-only change to a draft keeps the revision';

  -- ── F: other tables keep the shared function ───────────────────────────
  IF (SELECT tgfoid::regproc::text FROM pg_trigger
       WHERE tgrelid = 'public.brands'::regclass AND tgname = 'trg_brands_updated_at')
     IS DISTINCT FROM 'update_updated_at_column'
     OR (SELECT tgfoid::regproc::text FROM pg_trigger
          WHERE tgrelid = 'public.events'::regclass AND tgname = 'trg_events_updated_at')
     IS DISTINCT FROM 'events_set_updated_at' THEN
    RAISE EXCEPTION 'ISSUE-3801 F-01 FAIL: trigger functions are not events-only / shared as expected';
  END IF;
  RAISE NOTICE 'ISSUE-3801 F PASS: only the events trigger moved to events_set_updated_at';
END
$cases$;

ROLLBACK;

\echo 'issue_3801_draft_cover_video_keeps_revision.implementor.pg17: PASS'
