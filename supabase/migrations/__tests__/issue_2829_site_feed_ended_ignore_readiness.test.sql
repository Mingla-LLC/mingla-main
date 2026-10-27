-- #2829 W7c (amendment A13.5) — a brand's website keeps its ENDED trips while
-- the brand cannot take payments; upcoming paid trips still need readiness;
-- the shared public trip reader is unchanged (pg17, BEGIN ... ROLLBACK).
-- Apply every migration through
-- 20271229022829_issue_2829_site_feed_ended_ignore_readiness.sql first, then
-- run with ON_ERROR_STOP=1. Every fixture rolls back.

\set ON_ERROR_STOP on
BEGIN;

DO $w7c$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_unready uuid := gen_random_uuid();
  v_ready uuid := gen_random_uuid();
  v_site_unready uuid := gen_random_uuid();
  v_site_ready uuid := gen_random_uuid();
  v_ended_paid uuid := gen_random_uuid();
  v_past_scheduled_paid uuid := gen_random_uuid();
  v_upcoming_paid uuid := gen_random_uuid();
  v_upcoming_free uuid := gen_random_uuid();
  v_cancelled_paid uuid := gen_random_uuid();
  v_private_ended_paid uuid := gen_random_uuid();
  v_deleted_ended_paid uuid := gen_random_uuid();
  v_ready_ended_paid uuid := gen_random_uuid();
  v_trip uuid;
  v_tt uuid;
  v_ids text[];
  v_row jsonb;
  v_count integer;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'w7c-owner@2829.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now());
  INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
    (v_unready, v_owner, 'W7c Unready', 'w7c-unready', 'USD'),
    (v_ready, v_owner, 'W7c Ready', 'w7c-ready', 'USD');
  -- The ready brand collects through a Paystack subaccount; the unready brand
  -- has no way to take payments.
  UPDATE public.brands SET paystack_subaccount_code = 'ACCT_w7c_fixture' WHERE id = v_ready;
  INSERT INTO public.brand_sites(id, brand_id, status, created_by) VALUES
    (v_site_unready, v_unready, 'provisioning', v_owner),
    (v_site_ready, v_ready, 'provisioning', v_owner);
  IF public.pg_brand_can_collect(v_unready) OR NOT public.pg_brand_can_collect(v_ready) THEN
    RAISE EXCEPTION 'fixture readiness wrong';
  END IF;

  INSERT INTO public.events(id, brand_id, title, slug, event_type, visibility, status, timezone, currency, deleted_at) VALUES
    (v_ended_paid, v_unready, 'Ended paid', 'ended-paid', 'trip', 'public', 'ended', 'America/New_York', 'USD', NULL),
    (v_past_scheduled_paid, v_unready, 'Past scheduled paid', 'past-scheduled-paid', 'trip', 'public', 'scheduled', 'Asia/Makassar', 'USD', NULL),
    (v_upcoming_paid, v_unready, 'Upcoming paid', 'upcoming-paid', 'trip', 'public', 'scheduled', 'Europe/London', 'USD', NULL),
    (v_upcoming_free, v_unready, 'Upcoming free', 'upcoming-free', 'trip', 'public', 'scheduled', 'Europe/London', 'USD', NULL),
    (v_cancelled_paid, v_unready, 'Cancelled paid', 'cancelled-paid', 'trip', 'public', 'cancelled', 'Europe/London', 'USD', NULL),
    (v_private_ended_paid, v_unready, 'Private ended paid', 'private-ended-paid', 'trip', 'private', 'ended', 'Europe/London', 'USD', NULL),
    (v_deleted_ended_paid, v_unready, 'Deleted ended paid', 'deleted-ended-paid', 'trip', 'public', 'ended', 'Europe/London', 'USD', now()),
    (v_ready_ended_paid, v_ready, 'Ready ended paid', 'ready-ended-paid', 'trip', 'public', 'ended', 'Europe/London', 'USD', NULL);
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
    (v_ended_paid, now() - interval '60 days', now() - interval '53 days', 'America/New_York', true),
    (v_past_scheduled_paid, now() - interval '20 days', now() - interval '13 days', 'Asia/Makassar', true),
    (v_upcoming_paid, now() + interval '30 days', now() + interval '37 days', 'Europe/London', true),
    (v_upcoming_free, now() + interval '40 days', now() + interval '47 days', 'Europe/London', true),
    (v_cancelled_paid, now() - interval '30 days', now() - interval '23 days', 'Europe/London', true),
    (v_private_ended_paid, now() - interval '30 days', now() - interval '23 days', 'Europe/London', true),
    (v_deleted_ended_paid, now() - interval '30 days', now() - interval '23 days', 'Europe/London', true),
    (v_ready_ended_paid, now() - interval '30 days', now() - interval '23 days', 'Europe/London', true);
  -- One priced place per trip (the free trip's place is free).
  FOREACH v_trip IN ARRAY ARRAY[v_ended_paid, v_past_scheduled_paid, v_upcoming_paid, v_upcoming_free,
    v_cancelled_paid, v_private_ended_paid, v_deleted_ended_paid, v_ready_ended_paid] LOOP
    v_tt := gen_random_uuid();
    INSERT INTO public.ticket_types(id, event_id, name, price_cents, is_free, quantity_total)
    VALUES (v_tt, v_trip, 'Place', CASE WHEN v_trip = v_upcoming_free THEN 0 ELSE 125000 END, v_trip = v_upcoming_free, 12);
    INSERT INTO public.trip_pricing_tiers(event_id, ticket_type_id, tier_name) VALUES (v_trip, v_tt, 'Place');
  END LOOP;

  -- The shared public reader is unchanged: the unready brand's paid trips stay
  -- hidden there, ended or not.
  SELECT array_agg(t.trip_slug ORDER BY t.trip_slug) INTO v_ids FROM public.pg_public_trips_by_brand('w7c-unready') t;
  IF v_ids IS DISTINCT FROM ARRAY['upcoming-free'] THEN
    RAISE EXCEPTION 'the public trip reader changed: %', v_ids;
  END IF;

  -- The site feed: ended paid trips are back (status ended, and a scheduled
  -- trip whose local end date has passed); the upcoming paid trip stays out;
  -- cancelled, private and deleted trips stay out.
  SELECT array_agg(o->>'slug' ORDER BY ord) INTO v_ids
  FROM jsonb_array_elements(public.brand_site_offerings_feed(v_site_unready)->'offerings') WITH ORDINALITY AS t(o, ord);
  IF v_ids IS DISTINCT FROM ARRAY['upcoming-free', 'past-scheduled-paid', 'ended-paid'] THEN
    RAISE EXCEPTION 'unready site feed wrong: %', v_ids;
  END IF;
  SELECT o INTO v_row FROM jsonb_array_elements(public.brand_site_offerings_feed(v_site_unready)->'offerings') o
  WHERE o->>'slug' = 'ended-paid';
  IF v_row->>'status' <> 'ended' OR (v_row->>'min_price_minor')::bigint <> 125000 OR v_row->>'currency' <> 'USD'
     OR (v_row->>'capacity')::int <> 12 OR (v_row->>'spots_left')::int <> 12
     OR v_row->>'public_url' <> 'https://host.usemingla.com/t/w7c-unready/ended-paid' THEN
    RAISE EXCEPTION 'ended paid row wrong: %', v_row;
  END IF;

  -- A brand that can take payments: its ended trip comes from the public
  -- reader once, never twice.
  SELECT count(*) INTO v_count
  FROM jsonb_array_elements(public.brand_site_offerings_feed(v_site_ready)->'offerings') o
  WHERE o->>'slug' = 'ready-ended-paid';
  IF v_count <> 1 THEN RAISE EXCEPTION 'ready brand ended trip appears % times', v_count; END IF;
  IF EXISTS (SELECT 1 FROM public.brand_site_ended_trips_held_for_readiness(v_ready)) THEN
    RAISE EXCEPTION 'a ready brand has held-back trips';
  END IF;

  -- The moment the unready brand can collect, nothing is held back and the
  -- feed shows the same trips once each (now through the public reader).
  UPDATE public.brands SET paystack_subaccount_code = 'ACCT_w7c_fixture_2' WHERE id = v_unready;
  SELECT array_agg(o->>'slug' ORDER BY ord) INTO v_ids
  FROM jsonb_array_elements(public.brand_site_offerings_feed(v_site_unready)->'offerings') WITH ORDINALITY AS t(o, ord);
  IF v_ids IS DISTINCT FROM ARRAY['upcoming-paid', 'upcoming-free', 'past-scheduled-paid', 'cancelled-paid', 'ended-paid'] THEN
    RAISE EXCEPTION 'ready-again site feed wrong: %', v_ids;
  END IF;

  -- Private helper: service role only.
  IF has_function_privilege('anon', 'public.brand_site_ended_trips_held_for_readiness(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.brand_site_ended_trips_held_for_readiness(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.brand_site_ended_trips_held_for_readiness(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'held-back helper grants wrong';
  END IF;

  RAISE NOTICE 'ISSUE_2829_W7C_ENDED_IGNORE_READINESS_OK';
END;
$w7c$;

ROLLBACK;
