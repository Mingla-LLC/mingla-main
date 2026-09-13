-- Issue #3288 — an event draft lost its additional photos, and publishing then
-- put the event live with none.
--
-- The server half of the fix: every writer of `events.cover_media_gallery` on
-- the Business authoring path treats an ABSENT gallery key as "keep what is
-- stored", while a PRESENT key — including an explicit [] from "remove all
-- photos" — is written exactly as before. Removing a published event's cover no
-- longer wipes its gallery, and the published-event editor can save a gallery.
--
-- EVERY CASE EXECUTES THE REAL FUNCTION against the full migration chain. Each
-- case runs in its own transaction and rolls back.
--
-- FAILS-ON-REVERT (delete 20270629003288_issue_3288_gallery_absent_key_preserves.sql):
--   G-01, G-02, G-03 — the pre-#3288 bodies write COALESCE(payload, []) and
--     erase the stored photos when the key is absent.
--   G-05 — the pre-#3288 cover clear sets the gallery to [].
--   G-06 — the pre-#3288 atomic owner has no `gallery` key, so the edit is lost.
--   G-04b — the pre-#3288 live RSVP branch never writes the gallery.
-- The explicit-[] half of G-01 / G-02 is the adversarial pair: a fix that simply
-- stopped writing the gallery would pass the absent-key half and fail these.
--
-- Run after the full migration chain on fresh PostgreSQL 17.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.issue_3288_gallery(p_count integer)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $gallery$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'url', 'https://cdn.example.test/issue-3288/photo-' || n || '.jpg',
    'type', 'image') ORDER BY n), '[]'::jsonb)
  FROM generate_series(1, p_count) AS n
$gallery$;

-- The event-draft payload the Business client sends, WITHOUT the gallery key —
-- what `draftToServerUpdate` now emits when the draft's gallery is unknown.
CREATE OR REPLACE FUNCTION pg_temp.issue_3288_event_payload(p_revision integer)
RETURNS jsonb LANGUAGE sql STABLE AS $payload$
  SELECT jsonb_build_object(
    'title', 'Issue 3288 online weekender',
    'timezone', 'UTC',
    'is_online', true,
    'online_url', 'https://meet.example.test/issue-3288',
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'format', 'online',
      'requestedVisibility', 'public',
      'clientRevision', p_revision,
      'tickets', jsonb_build_array(jsonb_build_object(
        'name', 'Free entry', 'isFree', true, 'price', 0, 'capacity', 100)),
      'partyTypes', jsonb_build_array('festival'),
      'vibeTags', jsonb_build_array('social'),
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char(now() + interval '12 days', 'YYYY-MM-DD'),
        'doorsOpen', '20:00', 'endsAt', '23:00')
    ))
  )
$payload$;

CREATE OR REPLACE FUNCTION pg_temp.issue_3288_fixture(p_tag text)
RETURNS TABLE(v_user uuid, v_brand uuid, v_event uuid)
LANGUAGE plpgsql AS $fixture$
BEGIN
  v_user := gen_random_uuid();
  v_brand := gen_random_uuid();
  v_event := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (v_user, 'issue-3288-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'Issue 3288 ' || p_tag, 'issue-3288-' || p_tag || '-' || v_brand, 'GBP');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  RETURN NEXT;
END;
$fixture$;

-- ─── G-01: event draft autosave ─────────────────────────────────────────────────
BEGIN;
DO $g01$
DECLARE
  f record;
  v_count integer;
BEGIN
  SELECT * INTO f FROM pg_temp.issue_3288_fixture('g01');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, theme, cover_media_gallery)
  VALUES (f.v_event, f.v_brand, f.v_user, 'G01 draft', 'g01-draft-' || f.v_event, 'event', 'draft',
    'draft', 'UTC', jsonb_build_object('business_draft', jsonb_build_object('clientRevision', 0,
      'requestedVisibility', 'public')), pg_temp.issue_3288_gallery(3));

  -- Absent key: the three stored photos survive the save.
  PERFORM public.business_update_event_draft(f.v_event, pg_temp.issue_3288_event_payload(1), 1);
  SELECT jsonb_array_length(cover_media_gallery) INTO v_count FROM public.events WHERE id = f.v_event;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'G-01a FAIL: an autosave WITHOUT the gallery key left % photos (expected the stored 3)', v_count;
  END IF;

  -- Explicit []: "remove all photos" is still honoured.
  PERFORM public.business_update_event_draft(f.v_event,
    pg_temp.issue_3288_event_payload(2) || jsonb_build_object('cover_media_gallery', '[]'::jsonb), 2);
  SELECT jsonb_array_length(cover_media_gallery) INTO v_count FROM public.events WHERE id = f.v_event;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'G-01b FAIL: an explicit [] left % photos — deliberate remove-all no longer saves', v_count;
  END IF;

  -- Present array: written as sent.
  PERFORM public.business_update_event_draft(f.v_event,
    pg_temp.issue_3288_event_payload(3) || jsonb_build_object('cover_media_gallery', pg_temp.issue_3288_gallery(2)), 3);
  SELECT jsonb_array_length(cover_media_gallery) INTO v_count FROM public.events WHERE id = f.v_event;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'G-01c FAIL: a sent gallery of 2 stored % photos', v_count;
  END IF;
  RAISE NOTICE 'G-01 PASS: event draft autosave keeps an unsent gallery, honours [] and writes a sent one';
END $g01$;
ROLLBACK;

-- ─── G-02: event publish ────────────────────────────────────────────────────────
BEGIN;
DO $g02$
DECLARE
  f record;
  v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.issue_3288_fixture('g02');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, cover_media_gallery)
  VALUES (f.v_event, f.v_brand, f.v_user, 'G02 draft', 'g02-draft-' || f.v_event, 'event', 'draft',
    'draft', 'UTC', pg_temp.issue_3288_gallery(3));

  -- The exact production entry point the wizard calls.
  PERFORM public.issue_1719_publish_event_with_poster(f.v_event, pg_temp.issue_3288_event_payload(1), 1);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.status <> 'scheduled' THEN
    RAISE EXCEPTION 'G-02 fixture FAIL: publish did not reach scheduled (got %)', v_row.status;
  END IF;
  IF jsonb_array_length(v_row.cover_media_gallery) <> 3 THEN
    RAISE EXCEPTION 'G-02a FAIL: publishing WITHOUT the gallery key put the event live with % photos (expected the stored 3) — this is the production loss',
      jsonb_array_length(v_row.cover_media_gallery);
  END IF;
  RAISE NOTICE 'G-02a PASS: publish without the gallery key keeps the stored photos';
END $g02$;
ROLLBACK;

BEGIN;
DO $g02b$
DECLARE
  f record;
  v_count integer;
BEGIN
  SELECT * INTO f FROM pg_temp.issue_3288_fixture('g02b');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, cover_media_gallery)
  VALUES (f.v_event, f.v_brand, f.v_user, 'G02b draft', 'g02b-draft-' || f.v_event, 'event', 'draft',
    'draft', 'UTC', pg_temp.issue_3288_gallery(3));
  PERFORM public.issue_1719_publish_event_with_poster(f.v_event,
    pg_temp.issue_3288_event_payload(1) || jsonb_build_object('cover_media_gallery', '[]'::jsonb), 1);
  SELECT jsonb_array_length(cover_media_gallery) INTO v_count FROM public.events WHERE id = f.v_event;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'G-02b FAIL: publishing an explicit [] kept % photos — deliberate remove-all no longer publishes', v_count;
  END IF;
  RAISE NOTICE 'G-02b PASS: publish with an explicit [] publishes no photos';
END $g02b$;
ROLLBACK;

-- ─── G-03: RSVP publish ─────────────────────────────────────────────────────────
BEGIN;
DO $g03$
DECLARE
  f record;
  v_payload jsonb;
  v_count integer;
BEGIN
  SELECT * INTO f FROM pg_temp.issue_3288_fixture('g03');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, theme, cover_media_gallery)
  VALUES (f.v_event, f.v_brand, f.v_user, 'G03 RSVP', 'draft-g03-' || f.v_event, 'rsvp', 'draft',
    'draft', 'Europe/London', 'GBP', '{}'::jsonb, pg_temp.issue_3288_gallery(3));

  v_payload := jsonb_build_object(
    'title', 'Issue 3288 RSVP',
    'timezone', 'Europe/London',
    'location_text', 'Somewhere real',
    'currency', 'GBP',
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'format', 'in_person',
      'partyTypes', jsonb_build_array('house-party'),
      'requestedVisibility', 'public',
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char((now() + interval '30 days')::date, 'YYYY-MM-DD'),
        'doorsOpen', '19:00', 'endsAt', '23:00', 'timezone', 'Europe/London'),
      'location', jsonb_build_object('venueName', NULL, 'address', 'Somewhere real'),
      'tickets', '[]'::jsonb,
      'isRsvp', true,
      'clientRevision', 1)));

  PERFORM public.business_publish_rsvp_draft(f.v_event, v_payload, 1);
  SELECT jsonb_array_length(cover_media_gallery) INTO v_count FROM public.events WHERE id = f.v_event;
  IF (SELECT status FROM public.events WHERE id = f.v_event) = 'draft' THEN
    RAISE EXCEPTION 'G-03 fixture FAIL: the RSVP did not publish';
  END IF;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'G-03 FAIL: an RSVP publish WITHOUT the gallery key left % photos (expected the stored 3)', v_count;
  END IF;
  RAISE NOTICE 'G-03 PASS: RSVP publish without the gallery key keeps the stored photos';
END $g03$;
ROLLBACK;

-- ─── G-04: the published RSVP editor ───────────────────────────────────────────
BEGIN;
DO $g04$
DECLARE
  f record;
  v_count integer;
BEGIN
  SELECT * INTO f FROM pg_temp.issue_3288_fixture('g04');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, theme, cover_media_gallery, party_types)
  VALUES (f.v_event, f.v_brand, f.v_user, 'G04 RSVP', 'g04-rsvp-' || f.v_event, 'rsvp', 'scheduled',
    'public', 'Europe/London', 'GBP',
    jsonb_build_object('business_event', jsonb_build_object('isRsvp', true, 'requestedVisibility', 'public')),
    pg_temp.issue_3288_gallery(3), ARRAY['house-party']);

  -- G-04a — an unrelated live edit (no gallery key) keeps the photos.
  PERFORM public.business_update_rsvp_graph(f.v_event,
    jsonb_build_object('title', 'Issue 3288 RSVP renamed'), 'Renaming the RSVP for issue 3288', NULL);
  SELECT jsonb_array_length(cover_media_gallery) INTO v_count FROM public.events WHERE id = f.v_event;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'G-04a FAIL: an unrelated live RSVP edit left % photos', v_count;
  END IF;
  -- G-04b — a live edit that sends the gallery writes it.
  PERFORM public.business_update_rsvp_graph(f.v_event,
    jsonb_build_object('title', 'Issue 3288 RSVP renamed', 'cover_media_gallery', pg_temp.issue_3288_gallery(1)),
    'Trimming the RSVP photos for issue 3288', NULL);
  SELECT jsonb_array_length(cover_media_gallery) INTO v_count FROM public.events WHERE id = f.v_event;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'G-04b FAIL: a live RSVP edit that sent 1 photo stored % — the published RSVP editor cannot save its gallery', v_count;
  END IF;
  RAISE NOTICE 'G-04 PASS: the live RSVP editor keeps an unsent gallery and writes a sent one';
END $g04$;
ROLLBACK;

-- ─── G-05: removing an event cover keeps the gallery ───────────────────────────
BEGIN;
DO $g05$
DECLARE
  f record;
  v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.issue_3288_fixture('g05');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, cover_media_url, cover_media_type, cover_media_poster_url, cover_media_gallery)
  VALUES (f.v_event, f.v_brand, f.v_user, 'G05 event', 'g05-event-' || f.v_event, 'event', 'draft',
    'draft', 'UTC', 'https://cdn.example.test/issue-3288/cover.jpg', 'image',
    'https://cdn.example.test/issue-3288/cover.jpg', pg_temp.issue_3288_gallery(3));

  PERFORM public.business_clear_event_cover_media(f.v_event);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.cover_media_url IS NOT NULL OR v_row.cover_media_type IS NOT NULL
     OR v_row.cover_media_poster_url IS NOT NULL THEN
    RAISE EXCEPTION 'G-05 FAIL: the cover clear no longer clears the cover';
  END IF;
  IF jsonb_array_length(v_row.cover_media_gallery) <> 3 THEN
    RAISE EXCEPTION 'G-05 FAIL: removing the cover left % additional photos (expected 3)',
      jsonb_array_length(v_row.cover_media_gallery);
  END IF;
  RAISE NOTICE 'G-05 PASS: removing the cover keeps the additional photos';
END $g05$;
ROLLBACK;

-- ─── G-06: the published event editor saves the gallery ────────────────────────
BEGIN;
DO $g06$
DECLARE
  f record;
  v_revision integer;
  v_row public.events%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.issue_3288_fixture('g06');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, cover_media_gallery)
  VALUES (f.v_event, f.v_brand, f.v_user, 'G06 draft', 'g06-draft-' || f.v_event, 'event', 'draft',
    'draft', 'UTC', pg_temp.issue_3288_gallery(3));
  PERFORM public.issue_1719_publish_event_with_poster(f.v_event, pg_temp.issue_3288_event_payload(1), 1);
  SELECT COALESCE((theme#>>'{business_event,clientRevision}')::integer, 0) INTO v_revision
    FROM public.events WHERE id = f.v_event;

  -- G-06a — the editor sends the changed gallery.
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', '{}'::jsonb, 'gallery', pg_temp.issue_3288_gallery(1)),
    'Trimming the photos for issue 3288', v_revision + 1);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF jsonb_array_length(v_row.cover_media_gallery) <> 1 THEN
    RAISE EXCEPTION 'G-06a FAIL: the published editor sent 1 photo and % were stored — gallery edits are dropped',
      jsonb_array_length(v_row.cover_media_gallery);
  END IF;

  -- G-06b — an unrelated edit (no gallery key) keeps it.
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('name', 'Issue 3288 renamed')),
    'Renaming the event for issue 3288', v_revision + 2);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF jsonb_array_length(v_row.cover_media_gallery) <> 1 THEN
    RAISE EXCEPTION 'G-06b FAIL: an unrelated published edit left % photos (expected 1)',
      jsonb_array_length(v_row.cover_media_gallery);
  END IF;

  -- G-06c — removing the cover AND changing the gallery in one save keeps the
  -- NEW gallery: the gallery write runs after the cover block.
  UPDATE public.events SET cover_media_url = 'https://cdn.example.test/issue-3288/cover.jpg',
    cover_media_type = 'image', cover_media_poster_url = 'https://cdn.example.test/issue-3288/cover.jpg'
    WHERE id = f.v_event;
  PERFORM public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', '{}'::jsonb, 'cover', jsonb_build_object('clear', true),
      'gallery', pg_temp.issue_3288_gallery(2)),
    'Swapping cover for photos, issue 3288', v_revision + 3);
  SELECT * INTO v_row FROM public.events WHERE id = f.v_event;
  IF v_row.cover_media_url IS NOT NULL THEN
    RAISE EXCEPTION 'G-06c FAIL: the cover was not removed';
  END IF;
  IF jsonb_array_length(v_row.cover_media_gallery) <> 2 THEN
    RAISE EXCEPTION 'G-06c FAIL: removing the cover with a new gallery of 2 left % photos',
      jsonb_array_length(v_row.cover_media_gallery);
  END IF;
  RAISE NOTICE 'G-06 PASS: the published event editor saves, keeps, and survives a cover removal';
END $g06$;
ROLLBACK;
