-- #2829 W4 — the trip guide sidecar and the offerings feed a site reads
-- (pg17, BEGIN ... ROLLBACK). Apply every migration through
-- 20271228002829_issue_2829_trip_guides_and_offerings_feed.sql first, then run
-- with ON_ERROR_STOP=1. Every fixture rolls back.
-- see I-PROPOSED-2829-11 (declared beside the builder test) — ended or cancelled offerings stay in
-- the feed with their status (they never fail a publish or vanish from
-- "past trips"); only public, non-deleted offerings of the site's own brand
-- are ever in it.

\set ON_ERROR_STOP on
BEGIN;

DO $w4$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_event_mgr uuid := gen_random_uuid();
  v_marketing uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_brand_a uuid := gen_random_uuid();
  v_text text;
  v_brand_b uuid := gen_random_uuid();
  v_site_a uuid := gen_random_uuid();
  v_site_b uuid := gen_random_uuid();
  v_upcoming uuid := gen_random_uuid();
  v_running uuid := gen_random_uuid();
  v_ended uuid := gen_random_uuid();
  v_cancelled uuid := gen_random_uuid();
  v_soldout uuid := gen_random_uuid();
  v_private uuid := gen_random_uuid();
  v_deleted uuid := gen_random_uuid();
  v_draft uuid := gen_random_uuid();
  v_other_brand_trip uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_tt uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_feed jsonb;
  v_ids text[];
  v_row jsonb;
  v_guide jsonb;
  v_failed boolean;
  v_logs integer;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'w4-owner@2829.invalid'), (v_event_mgr, 'w4-event@2829.invalid'),
    (v_marketing, 'w4-marketing@2829.invalid'), (v_stranger, 'w4-stranger@2829.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now());
  INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
    (v_brand_a, v_owner, 'W4 Brand A', 'w4-brand-a', 'USD'),
    (v_brand_b, v_owner, 'W4 Brand B', 'w4-brand-b', 'GBP');
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at) VALUES
    (v_brand_a, v_event_mgr, 'event_manager', now()),
    (v_brand_a, v_marketing, 'marketing_manager', now());
  INSERT INTO public.brand_sites(id, brand_id, status, created_by) VALUES
    (v_site_a, v_brand_a, 'provisioning', v_owner),
    (v_site_b, v_brand_b, 'provisioning', v_owner);

  -- Trips of brand A in different states and timezones.
  INSERT INTO public.events(id, brand_id, title, slug, event_type, visibility, status, timezone, currency, description,
    cover_media_url, cover_media_type, deleted_at) VALUES
    (v_upcoming, v_brand_a, 'Upcoming trip', 'upcoming-trip', 'trip', 'public', 'scheduled', 'Asia/Makassar', 'USD',
     E'Seven   days\non the coast.', 'http://127.0.0.1:55321/storage/v1/object/public/event_covers/a/cover.jpg', 'image', NULL),
    (v_running, v_brand_a, 'Running trip', 'running-trip', 'trip', 'public', 'live', 'Europe/Tirane', 'USD',
     NULL, 'https://cdn.example.com/x.jpg', 'image', NULL),
    (v_ended, v_brand_a, 'Ended trip', 'ended-trip', 'trip', 'public', 'ended', 'Pacific/Kiritimati', 'USD',
     NULL, NULL, NULL, NULL),
    (v_cancelled, v_brand_a, 'Cancelled trip', 'cancelled-trip', 'trip', 'public', 'cancelled', 'America/New_York', 'USD',
     NULL, NULL, NULL, NULL),
    (v_soldout, v_brand_a, 'Sold out trip', 'sold-out-trip', 'trip', 'public', 'scheduled', 'Europe/London', 'USD',
     NULL, NULL, NULL, NULL),
    (v_private, v_brand_a, 'Private trip', 'private-trip', 'trip', 'private', 'scheduled', 'Europe/London', 'USD',
     NULL, NULL, NULL, NULL),
    (v_deleted, v_brand_a, 'Deleted trip', 'deleted-trip', 'trip', 'public', 'scheduled', 'Europe/London', 'USD',
     NULL, NULL, NULL, now()),
    (v_draft, v_brand_a, 'Draft trip', 'draft-trip', 'trip', 'public', 'draft', 'Europe/London', 'USD',
     NULL, NULL, NULL, NULL),
    (v_other_brand_trip, v_brand_b, 'Brand B trip', 'brand-b-trip', 'trip', 'public', 'scheduled', 'Europe/London', 'GBP',
     NULL, NULL, NULL, NULL),
    (v_event, v_brand_a, 'An evening event', 'evening-event', 'event', 'public', 'scheduled', 'Europe/London', 'USD',
     NULL, NULL, NULL, NULL);
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
    (v_upcoming, now() + interval '30 days', now() + interval '37 days', 'Asia/Makassar', true),
    (v_running, now() - interval '2 days', now() + interval '3 days', 'Europe/Tirane', true),
    (v_ended, now() - interval '40 days', now() - interval '33 days', 'Pacific/Kiritimati', true),
    (v_cancelled, now() + interval '50 days', now() + interval '55 days', 'America/New_York', true),
    (v_soldout, now() + interval '20 days', now() + interval '22 days', 'Europe/London', true),
    (v_private, now() + interval '20 days', now() + interval '22 days', 'Europe/London', true),
    (v_deleted, now() + interval '20 days', now() + interval '22 days', 'Europe/London', true),
    (v_draft, now() + interval '20 days', now() + interval '22 days', 'Europe/London', true),
    (v_other_brand_trip, now() + interval '20 days', now() + interval '22 days', 'Europe/London', true),
    (v_event, now() + interval '10 days', now() + interval '10 days 3 hours', 'Europe/London', true);
  -- Sold out: one free place, one valid ticket.
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, is_free, quantity_total)
  VALUES (v_tt, v_soldout, 'Place', 0, true, 1);
  INSERT INTO public.trip_pricing_tiers(event_id, ticket_type_id, tier_name) VALUES (v_soldout, v_tt, 'Place');
  INSERT INTO public.orders(id, event_id, buyer_phone_e164) VALUES (v_order, v_soldout, '+15555550100');
  INSERT INTO public.tickets(event_id, order_id, qr_code, ticket_type_id, status)
  VALUES (v_soldout, v_order, 'w4-qr-' || v_order, v_tt, 'valid');

  -- ---------------- feed ----------------
  v_feed := public.brand_site_offerings_feed(v_site_a);
  SELECT array_agg(o->>'slug' ORDER BY ord) INTO v_ids
  FROM jsonb_array_elements(v_feed->'offerings') WITH ORDINALITY AS t(o, ord);
  -- Upcoming soonest first (running, event, sold out, upcoming), then past
  -- newest first (cancelled sorts as past; ended).
  IF v_ids IS DISTINCT FROM ARRAY['running-trip','evening-event','sold-out-trip','upcoming-trip','cancelled-trip','ended-trip'] THEN
    RAISE EXCEPTION 'feed set/order wrong: %', v_ids;
  END IF;
  IF v_feed->'brand' <> jsonb_build_object('slug', 'w4-brand-a', 'currency', 'USD', 'payment_rails', 'stripe') THEN
    RAISE EXCEPTION 'feed brand wrong: %', v_feed->'brand';
  END IF;
  SELECT o INTO v_row FROM jsonb_array_elements(v_feed->'offerings') o WHERE o->>'slug' = 'upcoming-trip';
  IF v_row->>'kind' <> 'trip' OR v_row->>'timezone' <> 'Asia/Makassar' OR v_row->>'status' <> 'scheduled'
     OR v_row->>'public_url' <> 'https://host.usemingla.com/t/w4-brand-a/upcoming-trip'
     OR v_row->>'summary' <> 'Seven days on the coast.'
     OR v_row->'cover' <> '{"path":"event_covers/a/cover.jpg","type":"image"}'::jsonb THEN
    RAISE EXCEPTION 'upcoming row wrong: %', v_row;
  END IF;
  SELECT o INTO v_row FROM jsonb_array_elements(v_feed->'offerings') o WHERE o->>'slug' = 'running-trip';
  IF v_row->'cover' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'a third-party cover must not become a site cover: %', v_row;
  END IF;
  SELECT o INTO v_row FROM jsonb_array_elements(v_feed->'offerings') o WHERE o->>'slug' = 'sold-out-trip';
  IF (v_row->>'spots_left')::int <> 0 OR (v_row->>'capacity')::int <> 1 OR (v_row->>'has_free_tier')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'sold out row wrong: %', v_row;
  END IF;
  SELECT o INTO v_row FROM jsonb_array_elements(v_feed->'offerings') o WHERE o->>'slug' = 'cancelled-trip';
  IF v_row->>'status' <> 'cancelled' THEN RAISE EXCEPTION 'cancelled row wrong: %', v_row; END IF;
  SELECT o INTO v_row FROM jsonb_array_elements(v_feed->'offerings') o WHERE o->>'slug' = 'evening-event';
  IF v_row->>'kind' <> 'event' OR v_row->>'public_url' <> 'https://host.usemingla.com/e/w4-brand-a/evening-event' THEN
    RAISE EXCEPTION 'event row wrong: %', v_row;
  END IF;

  -- Cross-tenant: brand B's site never sees brand A, and the reverse.
  v_feed := public.brand_site_offerings_feed(v_site_b);
  SELECT array_agg(o->>'slug') INTO v_ids FROM jsonb_array_elements(v_feed->'offerings') o;
  IF v_ids IS DISTINCT FROM ARRAY['brand-b-trip'] THEN
    RAISE EXCEPTION 'brand B feed wrong: %', v_ids;
  END IF;

  -- A deleted brand has no feed.
  UPDATE public.events SET deleted_at = now() WHERE id = v_other_brand_trip;
  UPDATE public.brands SET deleted_at = now() WHERE id = v_brand_b;
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_offerings_feed(v_site_b);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_not_found'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a deleted brand still has a feed'; END IF;

  -- Only the service role may read the feed.
  IF has_function_privilege('anon', 'public.brand_site_offerings_feed(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.brand_site_offerings_feed(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.brand_site_offerings_feed(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'feed grants wrong';
  END IF;
  IF has_table_privilege('anon', 'public.trip_guides', 'SELECT')
     OR has_table_privilege('authenticated', 'public.trip_guides', 'SELECT')
     OR has_table_privilege('authenticated', 'public.trip_guides', 'INSERT') THEN
    RAISE EXCEPTION 'trip_guides must have no direct grants';
  END IF;

  -- ---------------- trip guide ----------------
  -- Marketing manager (20) cannot write; event manager (40) can.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_marketing, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_marketing::text, true);
  v_failed := false;
  BEGIN
    PERFORM public.biz_upsert_trip_guide(v_upcoming, '{"highlights":["Sunrise hike"]}'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'insufficient_event_permission'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a marketing manager wrote a trip guide'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  v_failed := false;
  BEGIN
    PERFORM public.biz_get_trip_guide(v_upcoming);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'insufficient_event_permission'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a stranger read a trip guide through the editor read'; END IF;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_event_mgr, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_event_mgr::text, true);
  v_guide := public.biz_upsert_trip_guide(v_upcoming, jsonb_build_object(
    'highlights', jsonb_build_array('  Sunrise hike  ', '', 'Night market'),
    'what_to_prepare', 'Reef-safe sunscreen.',
    'good_to_know', '   ',
    'faqs', jsonb_build_array(jsonb_build_object('question', 'Is it suitable for beginners?', 'answer', 'Yes.'),
                              jsonb_build_object('question', '', 'answer', '')),
    'group_minimum', 6,
    'activity_level', 'moderate'));
  IF v_guide->'highlights' <> '["Sunrise hike","Night market"]'::jsonb OR v_guide->'good_to_know' <> 'null'::jsonb
     OR jsonb_array_length(v_guide->'faqs') <> 1 OR (v_guide->>'group_minimum')::int <> 6 THEN
    RAISE EXCEPTION 'guide not normalised: %', v_guide;
  END IF;
  SELECT count(*) INTO v_logs FROM public.trip_edit_log WHERE event_id = v_upcoming AND 'guide' = ANY(changed_field_keys);
  IF v_logs <> 1 THEN RAISE EXCEPTION 'published trip guide edit not logged (% rows)', v_logs; END IF;
  -- The feed carries the group minimum for the site's card.
  SELECT o INTO v_row FROM jsonb_array_elements(public.brand_site_offerings_feed(v_site_a)->'offerings') o
  WHERE o->>'slug' = 'upcoming-trip';
  IF (v_row->>'group_minimum')::int <> 6 THEN RAISE EXCEPTION 'feed lacks the group minimum: %', v_row; END IF;

  -- A draft trip's guide saves without a log row.
  PERFORM public.biz_upsert_trip_guide(v_draft, '{"what_to_prepare":"Boots."}'::jsonb);
  IF EXISTS (SELECT 1 FROM public.trip_edit_log WHERE event_id = v_draft) THEN
    RAISE EXCEPTION 'a draft trip guide edit was logged';
  END IF;

  -- Invalid input is refused (unknown key, half FAQ, too many highlights,
  -- bad level, out-of-range minimum, not a trip).
  FOR v_row IN SELECT * FROM (VALUES
      ('{"price":1}'::jsonb),
      ('{"faqs":[{"question":"Q?","answer":""}]}'::jsonb),
      (jsonb_build_object('highlights', (SELECT jsonb_agg('h' || g) FROM generate_series(1, 13) g))),
      ('{"activity_level":"extreme"}'::jsonb),
      ('{"group_minimum":0}'::jsonb),
      ('{"group_minimum":1.5}'::jsonb),
      (jsonb_build_object('highlights', jsonb_build_array(repeat('x', 141))))
    ) AS bad(guide) LOOP
    v_failed := false;
    BEGIN
      PERFORM public.biz_upsert_trip_guide(v_upcoming, v_row);
    EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'trip_guide_invalid'; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'invalid guide accepted: %', v_row; END IF;
  END LOOP;
  v_failed := false;
  BEGIN
    PERFORM public.biz_upsert_trip_guide(v_event, '{"what_to_prepare":"x"}'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'event_not_a_trip'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a guide was written on an event'; END IF;

  -- The editor read returns the stored guide.
  IF public.biz_get_trip_guide(v_upcoming)->'highlights' <> '["Sunrise hike","Night market"]'::jsonb THEN
    RAISE EXCEPTION 'editor read wrong';
  END IF;

  -- Public read: a public trip's guide, never a private, deleted or draft one.
  PERFORM public.biz_upsert_trip_guide(v_private, '{"what_to_prepare":"Secret."}'::jsonb);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF public.pg_public_trip_guide(v_upcoming)->>'what_to_prepare' <> 'Reef-safe sunscreen.' THEN
    RAISE EXCEPTION 'public guide not readable';
  END IF;
  IF public.pg_public_trip_guide(v_private) IS NOT NULL THEN
    RAISE EXCEPTION 'a private trip''s guide was public';
  END IF;
  IF public.pg_public_trip_guide(v_draft) IS NOT NULL THEN
    RAISE EXCEPTION 'a draft trip''s guide was public';
  END IF;
  IF NOT has_function_privilege('anon', 'public.pg_public_trip_guide(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon cannot read a public guide';
  END IF;

  -- Clearing everything removes the row (a trip without a guide again).
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_event_mgr, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_event_mgr::text, true);
  v_guide := public.biz_upsert_trip_guide(v_upcoming, '{"highlights":[],"faqs":[],"what_to_prepare":null}'::jsonb);
  IF v_guide IS NOT NULL OR EXISTS (SELECT 1 FROM public.trip_guides WHERE event_id = v_upcoming) THEN
    RAISE EXCEPTION 'an empty guide was kept';
  END IF;

  -- #2829 W11 — instalments on a site follow Mingla's one shared rule
  -- (pg_trip_installments_supported, #3859) and nothing else: for every
  -- offering, under either payment rail, the feed says exactly what that rule
  -- says, so sites follow automatically when a rail gains payment plans. The
  -- feed also names the brand's rails.
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  FOREACH v_text IN ARRAY ARRAY['stripe', 'paystack'] LOOP
    UPDATE public.brands SET payment_provider = v_text WHERE id = v_brand_a;
    v_feed := public.brand_site_offerings_feed(v_site_a);
    IF v_feed->'brand'->>'payment_rails' IS DISTINCT FROM v_text THEN
      RAISE EXCEPTION 'feed names the wrong rails under %: %', v_text, v_feed->'brand';
    END IF;
    IF jsonb_array_length(v_feed->'offerings') = 0 OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_feed->'offerings') o
      WHERE (o->>'installments_available')::boolean
        IS DISTINCT FROM public.pg_trip_installments_supported((o->>'id')::uuid)
    ) THEN
      RAISE EXCEPTION 'feed instalments differ from Mingla''s rule under %: %', v_text, v_feed->'offerings';
    END IF;
  END LOOP;

  RAISE NOTICE 'ISSUE_2829_W4_TRIP_GUIDES_AND_FEED_OK';
END
$w4$;

ROLLBACK;
