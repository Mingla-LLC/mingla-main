-- MINGLA-INVARIANT: I-4572-SITES-COVER-STILL-ONE-RULE | issue #4572 | A video/gif event cover reaches the Sites feed as its still: a Mingla-storage poster as `cover` {path, type:'image'}, a stream-CDN still (https://<x>.b-cdn.net/<uuid>/thumbnail[_x].jpg) as `cover_stream_poster` {host, video_id, file}; anything else is NULL. Summaries keep their line breaks.
-- #4572 items 2 and 7a (pg17, BEGIN ... ROLLBACK, full replay).
--   * helpers: image covers unchanged; a video's storage poster becomes the
--     cover; a stream still is split into host / video_id / file; `..`, a
--     foreign host, http:, a 1001-char URL and a non-video type give NULL;
--   * the feed: a video event with a stream still carries
--     cover_stream_poster and cover NULL; a video event with a storage
--     poster carries cover; an image event is unchanged and has no
--     cover_stream_poster key; "week:\r\n- Stakeholders  forum\n\n\n\nEnd"
--     arrives as "week:\n- Stakeholders forum\n\nEnd";
--   * the re-emitted body joins events for the poster and keeps the view.
-- FAILS-ON-REVERT: with 20280807094453's feed body the video event's cover
-- and cover_stream_poster are both NULL and the summary is one line.

\set ON_ERROR_STOP on
\ir issue_2830_complete_brand_setup.fixture.sql
BEGIN;

DO $t4572feed$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_video uuid := gen_random_uuid();
  v_video_storage uuid := gen_random_uuid();
  v_image uuid := gen_random_uuid();
  v_vid text := '0f5f3a0e-2b9c-4c1e-9d55-7a3f2c1b0e9d';
  v_feed jsonb;
  v_row jsonb;
  v_cover jsonb;
BEGIN
  -- ── helpers ────────────────────────────────────────────────────────────
  IF public.brand_site_offering_cover('https://x.supabase.co/storage/v1/object/public/event_covers/a/b.jpg', 'image', NULL)
     IS DISTINCT FROM '{"path":"event_covers/a/b.jpg","type":"image"}'::jsonb THEN
    RAISE EXCEPTION 'an image cover changed';
  END IF;
  IF public.brand_site_offering_cover('https://vz-a.b-cdn.net/x/play_720p.mp4', 'video', 'https://x.supabase.co/storage/v1/object/public/event_covers/a/poster.jpg')
     IS DISTINCT FROM '{"path":"event_covers/a/poster.jpg","type":"image"}'::jsonb THEN
    RAISE EXCEPTION 'a video cover''s storage poster is not the cover';
  END IF;
  v_cover := public.brand_site_offering_cover_stream_poster('video', 'https://vz-abc123.b-cdn.net/' || v_vid || '/thumbnail_3f2a.jpg');
  IF v_cover IS DISTINCT FROM jsonb_build_object('host', 'vz-abc123.b-cdn.net', 'video_id', v_vid, 'file', 'thumbnail_3f2a.jpg') THEN
    RAISE EXCEPTION 'the stream still was not split: %', v_cover;
  END IF;
  IF public.brand_site_offering_cover_stream_poster('gif', 'https://vz-abc123.b-cdn.net/' || v_vid || '/thumbnail.jpg') IS NULL THEN
    RAISE EXCEPTION 'a gif cover''s still was refused';
  END IF;
  IF public.brand_site_offering_cover_stream_poster('video', 'https://vz-abc123.b-cdn.net/' || v_vid || '/../thumbnail.jpg') IS NOT NULL
    OR public.brand_site_offering_cover_stream_poster('video', 'https://evil.example.com/' || v_vid || '/thumbnail.jpg') IS NOT NULL
    OR public.brand_site_offering_cover_stream_poster('video', 'http://vz-abc123.b-cdn.net/' || v_vid || '/thumbnail.jpg') IS NOT NULL
    OR public.brand_site_offering_cover_stream_poster('video', 'https://vz-abc123.b-cdn.net/' || v_vid || '/thumbnail.jpg?x=1') IS NOT NULL
    OR public.brand_site_offering_cover_stream_poster('video', 'https://vz-abc123.b-cdn.net/' || v_vid || '/' || repeat('a', 1000) || '.jpg') IS NOT NULL
    OR public.brand_site_offering_cover_stream_poster('image', 'https://vz-abc123.b-cdn.net/' || v_vid || '/thumbnail.jpg') IS NOT NULL THEN
    RAISE EXCEPTION 'a still that should be refused was accepted';
  END IF;
  IF has_function_privilege('anon', 'public.brand_site_offering_cover_stream_poster(text, text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.brand_site_offering_cover(text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'clients can run the cover helpers';
  END IF;
  IF position('LEFT JOIN public.events ev ON ev.id = er.id' IN pg_get_functiondef('public.brand_site_offerings_feed_for_brand(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'the feed does not read the poster from events';
  END IF;

  -- ── the feed ───────────────────────────────────────────────────────────
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'owner-4572-feed@example.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now());
  INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES (v_brand, v_owner, 'Feed 4572', 'feed-4572', 'NGN');
  PERFORM pg_temp.issue_2830_complete_brand_setup(v_brand, v_owner);
  INSERT INTO public.events(id, brand_id, title, slug, event_type, visibility, status, timezone, currency, description,
      cover_media_url, cover_media_type, cover_media_poster_url) VALUES
    (v_video, v_brand, 'Inhabited Forms', 'inhabited-forms', 'event', 'public', 'scheduled', 'Africa/Lagos', 'NGN',
      E'week:\r\n- Stakeholders  forum\n\n\n\nEnd',
      'https://vz-abc123.b-cdn.net/' || v_vid || '/play_720p.mp4', 'video', 'https://vz-abc123.b-cdn.net/' || v_vid || '/thumbnail_3f2a.jpg'),
    (v_video_storage, v_brand, 'Film Club', 'film-club', 'event', 'public', 'scheduled', 'Africa/Lagos', 'NGN', NULL,
      'https://vz-abc123.b-cdn.net/' || v_vid || '/play_720p.mp4', 'video', 'https://x.supabase.co/storage/v1/object/public/event_covers/f/poster.jpg'),
    (v_image, v_brand, 'Art Talk', 'art-talk', 'event', 'public', 'scheduled', 'Africa/Lagos', 'NGN', 'One line',
      'https://x.supabase.co/storage/v1/object/public/event_covers/t/talk.jpg', 'image', NULL);
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
    (v_video, now() + interval '3 days', now() + interval '3 days 4 hours', 'Africa/Lagos', true),
    (v_video_storage, now() + interval '4 days', now() + interval '4 days 2 hours', 'Africa/Lagos', true),
    (v_image, now() + interval '5 days', now() + interval '5 days 2 hours', 'Africa/Lagos', true);

  v_feed := public.brand_site_offerings_feed_for_brand(v_brand);
  SELECT o INTO v_row FROM jsonb_array_elements(v_feed->'offerings') o WHERE o->>'id' = v_video::text;
  IF v_row IS NULL THEN RAISE EXCEPTION 'the video event is not in the feed: %', v_feed; END IF;
  IF v_row->'cover' <> 'null'::jsonb OR v_row->'cover_stream_poster' IS DISTINCT FROM jsonb_build_object('host', 'vz-abc123.b-cdn.net', 'video_id', v_vid, 'file', 'thumbnail_3f2a.jpg') THEN
    RAISE EXCEPTION 'the stream-still event is wrong: %', v_row;
  END IF;
  IF v_row->>'summary' IS DISTINCT FROM E'week:\n- Stakeholders forum\n\nEnd' THEN
    RAISE EXCEPTION 'the summary lost its line breaks: %', v_row->>'summary';
  END IF;
  SELECT o INTO v_row FROM jsonb_array_elements(v_feed->'offerings') o WHERE o->>'id' = v_video_storage::text;
  IF v_row->'cover' IS DISTINCT FROM '{"path":"event_covers/f/poster.jpg","type":"image"}'::jsonb OR v_row->'cover_stream_poster' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'the storage-poster event is wrong: %', v_row;
  END IF;
  SELECT o INTO v_row FROM jsonb_array_elements(v_feed->'offerings') o WHERE o->>'id' = v_image::text;
  IF v_row->'cover' IS DISTINCT FROM '{"path":"event_covers/t/talk.jpg","type":"image"}'::jsonb OR v_row->>'summary' <> 'One line' THEN
    RAISE EXCEPTION 'the image event changed: %', v_row;
  END IF;

  RAISE NOTICE '#4572 feed poster and breaks: PASS';
END;
$t4572feed$;

ROLLBACK;
