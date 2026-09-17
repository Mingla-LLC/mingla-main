-- Draft autosave keeps a cover the server applied. Pins the applied-cover guard
-- in 20270708003439_draft_autosave_keeps_pin_and_applied_cover.sql.
--
-- The production symptom (RSVP draft, 2026-09-15): the host picks a cover video,
-- the sheet says "You can close this sheet—we'll finish automatically", the host
-- closes it and keeps editing. Bunny finishes ~12 minutes later and
-- cover_video_apply_once writes events.cover_media_* (job status 'applied'
-- requires that UPDATE to hit exactly one row). The very next autosave carries
-- the client's stale cover (none) and writes it back: the RSVP receipt at the
-- first save after the apply already returns cover_media_url NULL. The ticketed
-- owner, business_update_event_draft, writes the payload cover unconditionally
-- and loses it the same way.
--
-- EVERY CASE EXECUTES THE REAL FUNCTIONS against the full migration chain: the
-- job is applied through cover_video_apply_once, the save through the owner the
-- wizard calls. Each case rolls back.
--
-- Within one transaction now() is constant (and an events trigger stamps
-- updated_at on every write), so "a save landed after the apply" is simulated
-- by moving the job's applied_at back in time.
--
-- FAILS-ON-REVERT (restore the #3288 / pin-only bodies of both owners):
--   C-01, C-05a, C-06a, C-07 — the stale save erases the applied video.
-- The adversarial half keeps the guard honest: C-02 / C-03 / C-06b (a deliberate
-- change or removal still saves), C-05b (the base-less fallback is one-shot) and
-- C-08 (without an applied job, nothing is protected).
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.cover_fixture(p_tag text, p_event_type text)
RETURNS TABLE(v_user uuid, v_brand uuid, v_event uuid)
LANGUAGE plpgsql AS $fixture$
BEGIN
  v_user := gen_random_uuid();
  v_brand := gen_random_uuid();
  v_event := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (v_user, 'applied-cover-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'Applied cover ' || p_tag, 'applied-cover-' || p_tag || '-' || v_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, theme)
  VALUES (v_event, v_brand, v_user, 'Harmattan Club', 'draft-applied-cover-' || v_event, p_event_type,
    'draft', 'draft', 'UTC', 'USD',
    jsonb_build_object('business_draft', jsonb_build_object(
      'isRsvp', p_event_type = 'rsvp', 'tickets', '[]'::jsonb, 'clientRevision', 0,
      'requestedVisibility', 'public')));
  RETURN NEXT;
END;
$fixture$;

CREATE OR REPLACE FUNCTION pg_temp.video_url(p_event uuid) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT 'https://vz-test.b-cdn.net/' || p_event || '/play_720p.mp4' $$;

-- A draft_auto event job, finished by the provider and applied the way the
-- Bunny webhook applies it.
CREATE OR REPLACE FUNCTION pg_temp.apply_cover_video(p_user uuid, p_brand uuid, p_event uuid)
RETURNS public.event_cover_video_jobs LANGUAGE plpgsql AS $apply$
DECLARE j public.event_cover_video_jobs;
BEGIN
  INSERT INTO public.event_cover_video_jobs(requested_by, event_id, brand_id, provider, status,
    apply_mode, target_kind, source_asset_id, source_duration_ms, trim_start_ms, trim_end_ms,
    processed_url, processed_poster_url, processed_mime_type, processed_bytes, processed_duration_ms)
  VALUES (p_user, p_event, p_brand, 'bunny', 'ready', 'draft_auto', 'event',
    'guid-' || p_event, 13000, 0, 13000, pg_temp.video_url(p_event),
    'https://vz-test.b-cdn.net/' || p_event || '/thumbnail.jpg', 'video/mp4', 4096, 13000)
  RETURNING * INTO j;
  j := public.cover_video_apply_once(j.id, 0, pg_temp.video_url(p_event), NULL);
  IF j.status <> 'applied' OR (SELECT cover_media_url FROM public.events WHERE id = p_event)
       IS DISTINCT FROM pg_temp.video_url(p_event) THEN
    RAISE EXCEPTION 'fixture FAIL: the job did not apply its video to the event (status %)', j.status;
  END IF;
  RETURN j;
END;
$apply$;

-- The RSVP wizard's autosave payload. p_cover = the client's cover; p_base =
-- the `__coverBase` it sends (pass the literal 'omit' for a pre-fix client).
CREATE OR REPLACE FUNCTION pg_temp.rsvp_save(p_revision integer, p_cover text, p_base text)
RETURNS jsonb LANGUAGE sql STABLE AS $payload$
  SELECT jsonb_build_object(
    '__expectedClientRevision', p_revision,
    'title', 'Harmattan Club',
    'cover_media_url', p_cover,
    'cover_media_type', CASE WHEN p_cover IS NULL THEN NULL WHEN p_cover LIKE '%.mp4' THEN 'video' ELSE 'image' END,
    'cover_media_poster_url', CASE WHEN p_cover IS NULL THEN NULL WHEN p_cover LIKE '%.mp4' THEN NULL ELSE p_cover END,
    'cover_media_provider', NULL,
    'timezone', 'UTC',
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'isRsvp', true, 'tickets', '[]'::jsonb, 'clientRevision', p_revision)))
  || CASE WHEN p_base = 'omit' THEN '{}'::jsonb ELSE jsonb_build_object('__coverBase', p_base) END
$payload$;

-- The ticketed wizard's autosave payload for business_update_event_draft.
CREATE OR REPLACE FUNCTION pg_temp.event_save(p_revision integer, p_cover text, p_base text)
RETURNS jsonb LANGUAGE sql STABLE AS $payload$
  SELECT jsonb_build_object(
    'title', 'Harmattan Club',
    'timezone', 'UTC',
    'is_online', false,
    'cover_media_url', p_cover,
    'cover_media_type', CASE WHEN p_cover IS NULL THEN NULL WHEN p_cover LIKE '%.mp4' THEN 'video' ELSE 'image' END,
    'cover_media_poster_url', CASE WHEN p_cover IS NULL THEN NULL ELSE p_cover || '.jpg' END,
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'requestedVisibility', 'public', 'clientRevision', p_revision, 'tickets', '[]'::jsonb)))
  || CASE WHEN p_base = 'omit' THEN '{}'::jsonb ELSE jsonb_build_object('__coverBase', p_base) END
$payload$;

-- ─── C-01: RSVP — a client that never saw the video cannot erase it ──────────
BEGIN;
DO $c01$
DECLARE f record; g jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.cover_fixture('c01', 'rsvp');
  PERFORM pg_temp.apply_cover_video(f.v_user, f.v_brand, f.v_event);

  -- The wizard last saw no cover (base NULL) and still has none.
  g := public.business_update_rsvp_graph(f.v_event, pg_temp.rsvp_save(1, NULL, NULL), NULL, NULL);
  IF g->'event'->>'cover_media_url' IS DISTINCT FROM pg_temp.video_url(f.v_event) THEN
    RAISE EXCEPTION 'C-01 FAIL: the first save after the apply erased the video cover (now %) — this is the production loss',
      g->'event'->>'cover_media_url';
  END IF;
  IF g->'event'->>'cover_media_type' IS DISTINCT FROM 'video' THEN
    RAISE EXCEPTION 'C-01 FAIL: the kept cover lost its type (%)', g->'event'->>'cover_media_type';
  END IF;
  -- Later saves from the same unaware client (not a timing window).
  UPDATE public.event_cover_video_jobs SET applied_at = applied_at - interval '10 minutes'
    WHERE event_id = f.v_event;
  g := public.business_update_rsvp_graph(f.v_event, pg_temp.rsvp_save(2, NULL, NULL), NULL, NULL);
  IF g->'event'->>'cover_media_url' IS DISTINCT FROM pg_temp.video_url(f.v_event) THEN
    RAISE EXCEPTION 'C-01 FAIL: a later save from a client whose base is still NULL erased the video';
  END IF;
  IF (SELECT theme#>'{business_draft}' ? '__coverBase' FROM public.events WHERE id = f.v_event) THEN
    RAISE EXCEPTION 'C-01 FAIL: __coverBase leaked into the stored draft blob';
  END IF;
  RAISE NOTICE 'C-01 PASS: an RSVP save that never saw the applied video keeps it';
END $c01$;
ROLLBACK;

-- ─── C-02 / C-03: RSVP — deliberate changes still save ───────────────────────
BEGIN;
DO $c02$
DECLARE f record; g jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.cover_fixture('c02', 'rsvp');
  PERFORM pg_temp.apply_cover_video(f.v_user, f.v_brand, f.v_event);

  -- C-02 — the host picks a photo without ever having seen the video.
  g := public.business_update_rsvp_graph(f.v_event,
    pg_temp.rsvp_save(1, 'https://images.example.test/photo.jpg', NULL), NULL, NULL);
  IF g->'event'->>'cover_media_url' IS DISTINCT FROM 'https://images.example.test/photo.jpg' THEN
    RAISE EXCEPTION 'C-02 FAIL: a deliberate photo pick was replaced by the server cover (%)', g->'event'->>'cover_media_url';
  END IF;
  RAISE NOTICE 'C-02 PASS: a cover the host changed is saved';
END $c02$;
ROLLBACK;

BEGIN;
DO $c03$
DECLARE f record; g jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.cover_fixture('c03', 'rsvp');
  PERFORM pg_temp.apply_cover_video(f.v_user, f.v_brand, f.v_event);
  -- The client adopted the video (base = video) and then removed it.
  g := public.business_update_rsvp_graph(f.v_event,
    pg_temp.rsvp_save(1, NULL, pg_temp.video_url(f.v_event)), NULL, NULL);
  IF g->'event'->>'cover_media_url' IS NOT NULL THEN
    RAISE EXCEPTION 'C-03 FAIL: removing an adopted video cover did not save (still %)', g->'event'->>'cover_media_url';
  END IF;
  RAISE NOTICE 'C-03 PASS: removing a cover the client had seen is saved';
END $c03$;
ROLLBACK;

-- ─── C-05: RSVP — a pre-fix client (no __coverBase) gets a one-shot guard ─────
BEGIN;
DO $c05$
DECLARE f record; g jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.cover_fixture('c05', 'rsvp');
  PERFORM pg_temp.apply_cover_video(f.v_user, f.v_brand, f.v_event);

  -- C-05a — the first save after the apply keeps the video; its echo hands the
  -- video to the installed app.
  g := public.business_update_rsvp_graph(f.v_event, pg_temp.rsvp_save(1, NULL, 'omit'), NULL, NULL);
  IF g->'event'->>'cover_media_url' IS DISTINCT FROM pg_temp.video_url(f.v_event) THEN
    RAISE EXCEPTION 'C-05a FAIL: a pre-fix client''s first save after the apply erased the video';
  END IF;

  -- C-05b — once a save has landed after the apply, a base-less save is trusted
  -- again (that client had the chance to adopt the echo).
  UPDATE public.event_cover_video_jobs SET applied_at = applied_at - interval '1 minute'
    WHERE event_id = f.v_event;
  g := public.business_update_rsvp_graph(f.v_event, pg_temp.rsvp_save(2, NULL, 'omit'), NULL, NULL);
  IF g->'event'->>'cover_media_url' IS NOT NULL THEN
    RAISE EXCEPTION 'C-05b FAIL: the base-less fallback is not one-shot — a later removal cannot save';
  END IF;
  RAISE NOTICE 'C-05 PASS: pre-fix clients keep the video on the first save after it applies';
END $c05$;
ROLLBACK;

-- ─── C-06: ticketed event draft owner ────────────────────────────────────────
BEGIN;
DO $c06$
DECLARE f record; g jsonb; v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.cover_fixture('c06', 'event');
  PERFORM pg_temp.apply_cover_video(f.v_user, f.v_brand, f.v_event);

  -- C-06a — unaware client, with and without a base.
  g := public.business_update_event_draft(f.v_event, pg_temp.event_save(1, NULL, NULL), 1);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.cover_media_url IS DISTINCT FROM pg_temp.video_url(f.v_event) THEN
    RAISE EXCEPTION 'C-06a FAIL: a ticketed draft save erased the applied video (now %)', v_row.cover_media_url;
  END IF;
  g := public.business_update_event_draft(f.v_event, pg_temp.event_save(2, NULL, 'omit'), 2);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.cover_media_url IS DISTINCT FROM pg_temp.video_url(f.v_event) THEN
    RAISE EXCEPTION 'C-06a FAIL: a pre-fix ticketed save right after the apply erased the video';
  END IF;

  -- C-06b — the client adopted it and removed it.
  g := public.business_update_event_draft(f.v_event,
    pg_temp.event_save(3, NULL, pg_temp.video_url(f.v_event)), 3);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.cover_media_url IS NOT NULL THEN
    RAISE EXCEPTION 'C-06b FAIL: removing an adopted cover on a ticketed draft did not save';
  END IF;
  RAISE NOTICE 'C-06 PASS: the ticketed draft owner keeps an unseen video and saves a real removal';
END $c06$;
ROLLBACK;

-- ─── C-07: the RSVP publish the app calls ships the video ────────────────────
BEGIN;
DO $c07$
DECLARE f record; v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.cover_fixture('c07', 'rsvp');
  PERFORM public.business_update_rsvp_graph(f.v_event,
    pg_temp.rsvp_save(1, NULL, NULL)
      || jsonb_build_object('theme', jsonb_build_object('business_draft', jsonb_build_object(
        'isRsvp', true, 'tickets', '[]'::jsonb, 'clientRevision', 1, 'format', 'in_person',
        'partyTypes', jsonb_build_array('house-party'), 'requestedVisibility', 'public',
        'whenMode', 'single',
        'when', jsonb_build_object('date', to_char((now() + interval '30 days')::date, 'YYYY-MM-DD'),
          'doorsOpen', '19:00', 'endsAt', '23:00', 'timezone', 'UTC')))),
    NULL, NULL);
  PERFORM pg_temp.apply_cover_video(f.v_user, f.v_brand, f.v_event);
  -- The host keeps editing settings with no cover on the client, then publishes.
  PERFORM public.business_update_rsvp_graph(f.v_event, pg_temp.rsvp_save(2, NULL, NULL), NULL, NULL);
  PERFORM public.business_publish_rsvp_graph(f.v_event, gen_random_uuid());
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.status = 'draft' THEN
    RAISE EXCEPTION 'C-07 fixture FAIL: the RSVP did not publish';
  END IF;
  IF v_row.cover_media_url IS DISTINCT FROM pg_temp.video_url(f.v_event) OR v_row.cover_media_type IS DISTINCT FROM 'video' THEN
    RAISE EXCEPTION 'C-07 FAIL: the published RSVP has cover % (%), expected the applied video',
      v_row.cover_media_url, v_row.cover_media_type;
  END IF;
  RAISE NOTICE 'C-07 PASS: an RSVP published after a stale save ships the applied video';
END $c07$;
ROLLBACK;

-- ─── C-08: no applied job, no protection (the guard is not a cover freeze) ────
BEGIN;
DO $c08$
DECLARE f record; g jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.cover_fixture('c08', 'rsvp');
  UPDATE public.events SET cover_media_url = 'https://images.example.test/old.jpg',
    cover_media_type = 'image', cover_media_poster_url = 'https://images.example.test/old.jpg'
    WHERE id = f.v_event;
  g := public.business_update_rsvp_graph(f.v_event, pg_temp.rsvp_save(1, NULL, 'omit'), NULL, NULL);
  IF g->'event'->>'cover_media_url' IS NOT NULL THEN
    RAISE EXCEPTION 'C-08 FAIL: a cover no job applied was protected from a pre-fix client''s removal';
  END IF;
  RAISE NOTICE 'C-08 PASS: without an applied job the save behaves exactly as before';
END $c08$;
ROLLBACK;
