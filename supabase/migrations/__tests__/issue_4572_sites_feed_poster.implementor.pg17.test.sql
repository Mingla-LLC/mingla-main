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
SET LOCAL session_replication_role = replica;

DO $t4572feed$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_venue uuid := gen_random_uuid();
  v_hour uuid := gen_random_uuid();
  v_hour_option_high uuid := gen_random_uuid();
  v_hour_option_low uuid := gen_random_uuid();
  v_membership_offer uuid := gen_random_uuid();
  v_membership_option uuid := gen_random_uuid();
  v_plan uuid := gen_random_uuid();
  v_year_offer uuid := gen_random_uuid();
  v_year_option uuid := gen_random_uuid();
  v_year_plan uuid := gen_random_uuid();
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
  IF NOT 'venue_coworking' = ANY (public.brand_site_plan_offering_keys())
    OR cardinality(public.brand_site_plan_offering_keys()) <> 8 THEN
    RAISE EXCEPTION 'coworking is not an exact website plan option: %', public.brand_site_plan_offering_keys();
  END IF;
  IF position('public.venue_offer_price_options' IN pg_get_functiondef('public.brand_site_offerings_feed_for_brand(uuid)'::regprocedure)) = 0
    OR position('public.venue_membership_plans' IN pg_get_functiondef('public.brand_site_offerings_feed_for_brand(uuid)'::regprocedure)) = 0
    OR position('price_cadence' IN pg_get_functiondef('public.brand_site_offerings_feed_for_brand(uuid)'::regprocedure)) = 0
    OR position('''/book/''' IN pg_get_functiondef('public.brand_site_offerings_feed_for_brand(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'the feed does not project venue prices, cadence, memberships and buyer routes';
  END IF;

  -- ── the feed ───────────────────────────────────────────────────────────
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'owner-4572-feed@example.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now());
  INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES (v_brand, v_owner, 'Feed 4572', 'feed-4572', 'NGN');
  PERFORM pg_temp.issue_2830_complete_brand_setup(v_brand, v_owner);
  INSERT INTO public.venue_listings(id, brand_id, slug, name, lat, lng, venue_category, claim_status)
    VALUES (v_venue, v_brand, 'feed4572', 'Feed coworking', 6.45, 3.41, 'coworking', 'verified');
  INSERT INTO public.stay_offerings(
      id, venue_id, brand_id, kind, name, summary, status, inventory_basis,
      capacity, max_adults, max_children, place_pricing_basis
    ) VALUES
    (v_hour, v_venue, v_brand, 'by_the_hour', 'Meeting room', 'A quiet room.', 'live',
      'shared_capacity', 20, NULL, NULL, 'per_booking'),
    (v_membership_offer, v_venue, v_brand, 'membership', 'Membership', 'A monthly plan.', 'live',
      'shared_capacity', 100, NULL, NULL, 'per_guest'),
    (v_year_offer, v_venue, v_brand, 'membership', 'Annual membership', 'A yearly plan.', 'live',
      'shared_capacity', 100, NULL, NULL, 'per_guest');
  INSERT INTO public.venue_offer_price_options(
      id, offering_id, venue_id, brand_id, name, unit, guest_min, guest_max, sort_order
    ) VALUES
    (v_hour_option_high, v_hour, v_venue, v_brand, 'Large room', 'hour', 1, 10, 1),
    (v_hour_option_low, v_hour, v_venue, v_brand, 'Small room', 'hour', 1, 6, 2),
    (v_membership_option, v_membership_offer, v_venue, v_brand, 'Monthly', 'guest', 1, 1, 1),
    (v_year_option, v_year_offer, v_venue, v_brand, 'Annual', 'guest', 1, 1, 1);
  INSERT INTO public.stay_price_versions(
      offering_id, brand_id, venue_id, version_number, amount_minor,
      currency_code, pricing_unit, price_option_id
    ) VALUES
    (v_hour, v_brand, v_venue, 1, 2500000, 'NGN', 'place_hour', v_hour_option_high),
    (v_hour, v_brand, v_venue, 2, 1500000, 'NGN', 'place_hour', v_hour_option_low);
  INSERT INTO public.venue_membership_plans(
      id, offering_id, price_option_id, brand_id, name, summary,
      price_minor, currency_code, period, min_months, status
    ) VALUES
    (v_plan, v_membership_offer, v_membership_option, v_brand, 'Flexi monthly',
      'Flexible access.', 7200000, 'NGN', 'month', 1, 'live'),
    (v_year_plan, v_year_offer, v_year_option, v_brand, 'Annual membership',
      'A full year.', 84000000, 'NGN', 'year', 12, 'live');
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
  SELECT o INTO v_row FROM jsonb_array_elements(v_feed->'offerings') o WHERE o->>'id' = v_hour::text;
  IF v_row IS NULL
    OR v_row->>'kind' IS DISTINCT FROM 'venue'
    OR (v_row->>'min_price_minor')::bigint IS DISTINCT FROM 1500000
    OR v_row->>'currency' IS DISTINCT FROM 'NGN'
    OR v_row->>'price_cadence' IS DISTINCT FROM 'hour'
    OR v_row->>'public_url' IS DISTINCT FROM
      'https://host.usemingla.com/b/feed-4572/v/feed4572/book/' || v_hour::text THEN
    RAISE EXCEPTION 'the hourly venue offer did not use its lowest live price and buyer route: %', v_row;
  END IF;
  SELECT o INTO v_row FROM jsonb_array_elements(v_feed->'offerings') o WHERE o->>'id' = v_plan::text;
  IF v_row IS NULL
    OR v_row->>'kind' IS DISTINCT FROM 'venue'
    OR (v_row->>'min_price_minor')::bigint IS DISTINCT FROM 7200000
    OR v_row->>'currency' IS DISTINCT FROM 'NGN'
    OR v_row->>'price_cadence' IS DISTINCT FROM 'month'
    OR v_row->>'public_url' IS DISTINCT FROM
      'https://host.usemingla.com/b/feed-4572/v/feed4572/book/' || v_plan::text || '?k=plan' THEN
    RAISE EXCEPTION 'the membership did not use its plan price and buyer route: %', v_row;
  END IF;
  SELECT o INTO v_row FROM jsonb_array_elements(v_feed->'offerings') o WHERE o->>'id' = v_year_plan::text;
  IF v_row IS NULL
    OR (v_row->>'min_price_minor')::bigint IS DISTINCT FROM 84000000
    OR v_row->>'price_cadence' IS DISTINCT FROM 'year'
    OR v_row->>'public_url' IS DISTINCT FROM
      'https://host.usemingla.com/b/feed-4572/v/feed4572/book/' || v_year_plan::text || '?k=plan' THEN
    RAISE EXCEPTION 'the annual membership lost its yearly cadence or buyer route: %', v_row;
  END IF;
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
