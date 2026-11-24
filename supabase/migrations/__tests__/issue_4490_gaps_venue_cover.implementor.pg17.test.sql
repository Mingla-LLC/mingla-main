-- #4490 gap list 07-L (20281203284490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-EVENT-USES-VENUE-COVER | issue #4490 | an event cover with provider 'upload' and type video is accepted only when it is the event's own ready video job, or the CURRENT video cover of the venue the event is linked to (events.venue_id), produced by a ready venue or venue_draft job of the same brand; a foreign venue's or a replaced venue video is refused, and no new provider value exists.
--
-- L-1 the linked venue's current video passes.  L-2 a foreign venue's video is refused.
-- L-3 a replaced venue video (cover changed) is refused.  L-4 the provider list is unchanged.
--
-- FAILS-ON-REVERT (seen 20 Nov): with the 1972 body (event jobs only) L-1 raises cover_selection_source_unverified.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '44902900-0000-4000-8000-000000000001';
  v_brand uuid := '44902900-0000-4000-9000-000000000010';
  v_venue uuid := '44902900-0000-4000-9000-0000000000a1';
  v_venue2 uuid := '44902900-0000-4000-9000-0000000000a2';
  v_event uuid;
  v_url text := 'https://media.example.test/venue-4490/cover.mp4';
  v_poster text := 'https://media.example.test/venue-4490/cover.jpg';
  v_failed boolean;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'venue-cover-4490@example.test');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'venue-cover-4490@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country, pricing_region, pricing_currency)
    VALUES (v_brand, v_owner, 'Venue cover 4490', 'venue-cover-4490', 'NGN', 'paystack', 'NG', 'NG', 'NGN');
  INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code,
      cover_media_type, cover_media_url, cover_media_poster_url) VALUES
    (v_venue, v_brand, 'venuecover4490', 'Cover Hall', 6.45, 3.41, 'play', 'verified', 'NG', 'video', v_url, v_poster),
    (v_venue2, v_brand, 'venuecover24490', 'Other Hall', 6.45, 3.42, 'play', 'verified', 'NG', 'video', v_url, v_poster);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_event := (public.business_create_event_draft(v_brand, jsonb_build_object(
    'title', 'Cover night', 'timezone', 'Africa/Lagos', 'currency', 'NGN',
    'theme', '{"business_draft":{"requestedVisibility":"public"}}'::jsonb)) #>> '{event,id}')::uuid;
  PERFORM public.issue_4490_set_event_venue(v_event, v_venue, NULL, 'shared', NULL, NULL);

  SET LOCAL session_replication_role = replica;
  INSERT INTO public.event_cover_video_jobs (brand_id, venue_id, target_kind, requested_by, provider, status, apply_mode,
      trim_start_ms, trim_end_ms, processed_url, processed_poster_url, processed_mime_type, processed_bytes, processed_duration_ms)
    VALUES (v_brand, v_venue, 'venue', v_owner, 'bunny', 'ready', 'published_manual', 0, 6000, v_url, v_poster, 'video/mp4', 1000000, 6000);
  SET LOCAL session_replication_role = origin;

  -- L-1
  PERFORM public.assert_event_cover_selection_source(v_event, v_brand, v_url, 'video', v_poster, 'upload', NULL);
  RAISE NOTICE 'PASS  L-1 the linked venue''s current video cover is accepted for the event';

  -- L-2 the event moves to the other venue, whose cover has no venue job
  PERFORM public.issue_4490_set_event_venue(v_event, v_venue2, NULL, 'shared', NULL, NULL);
  v_failed := false;
  BEGIN PERFORM public.assert_event_cover_selection_source(v_event, v_brand, v_url, 'video', v_poster, 'upload', NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'cover_selection_source_unverified';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'L-2 FAIL: a video made for another venue was accepted'; END IF;
  RAISE NOTICE 'PASS  L-2 a foreign venue''s video is refused';

  -- L-3 back at the venue, but the venue's cover was replaced
  PERFORM public.issue_4490_set_event_venue(v_event, v_venue, NULL, 'shared', NULL, NULL);
  UPDATE public.venue_listings SET cover_media_url = 'https://media.example.test/venue-4490/new.mp4' WHERE id = v_venue;
  v_failed := false;
  BEGIN PERFORM public.assert_event_cover_selection_source(v_event, v_brand, v_url, 'video', v_poster, 'upload', NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'cover_selection_source_unverified';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'L-3 FAIL: a replaced venue video was accepted'; END IF;
  RAISE NOTICE 'PASS  L-3 a replaced venue video is refused';

  -- L-5 a cover made in the venue wizard (venue_draft job, no venue id) is accepted too
  UPDATE public.venue_listings SET cover_media_url = 'https://media.example.test/venue-4490/draft.mp4',
    cover_media_poster_url = 'https://media.example.test/venue-4490/draft.jpg' WHERE id = v_venue;
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.event_cover_video_jobs (brand_id, draft_owner_key, target_kind, requested_by, provider, status, apply_mode,
      trim_start_ms, trim_end_ms, processed_url, processed_poster_url, processed_mime_type, processed_bytes, processed_duration_ms)
    VALUES (v_brand, 'venue-wizard-4490', 'venue_draft', v_owner, 'bunny', 'ready', 'draft_auto', 0, 6000,
      'https://media.example.test/venue-4490/draft.mp4', 'https://media.example.test/venue-4490/draft.jpg', 'video/mp4', 1000000, 6000);
  SET LOCAL session_replication_role = origin;
  PERFORM public.assert_event_cover_selection_source(v_event, v_brand, 'https://media.example.test/venue-4490/draft.mp4', 'video',
    'https://media.example.test/venue-4490/draft.jpg', 'upload', NULL);
  RAISE NOTICE 'PASS  L-5 a venue wizard (venue_draft) video cover is accepted';
  -- L-6 a ready video job of ANOTHER brand never counts
  SET LOCAL session_replication_role = replica;
  UPDATE public.event_cover_video_jobs SET brand_id = gen_random_uuid() WHERE draft_owner_key = 'venue-wizard-4490';
  SET LOCAL session_replication_role = origin;
  v_failed := false;
  BEGIN PERFORM public.assert_event_cover_selection_source(v_event, v_brand, 'https://media.example.test/venue-4490/draft.mp4', 'video',
    'https://media.example.test/venue-4490/draft.jpg', 'upload', NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'cover_selection_source_unverified';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'L-6 FAIL: another brand''s video job was accepted'; END IF;
  RAISE NOTICE 'PASS  L-6 another brand''s video job is refused';

  -- L-4 no new provider
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'events_cover_media_provider_check')) LIKE '%venue%' THEN
    RAISE EXCEPTION 'L-4 FAIL: a venue provider value was added';
  END IF;
  RAISE NOTICE 'PASS  L-4 the provider stays upload (no new value)';
END
$test$;

ROLLBACK;
\echo 'issue #4490 07-L: all cases passed'
