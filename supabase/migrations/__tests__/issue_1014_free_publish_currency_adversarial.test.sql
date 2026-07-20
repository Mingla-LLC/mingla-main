-- issue #1014 — TESTER ADVERSARIAL behavioral probe (mingla-tester).
-- Complements (does NOT copy) the implementor's issue_1014_free_publish_currency.test.sql:
-- that file drives the TRIGGERS directly; THIS file drives the ACTUAL RPCs
-- (business_publish_event_draft / business_publish_rsvp_draft /
-- business_publish_trip_draft / biz_update_live_trip /
-- biz_ticket_checkout_create_session / business_cancel_event) — closing the
-- known headless-QA-on-RPCs gap — and attacks the SPEC §9 adversarial angles:
--   A-01  free publish end-to-end through the event RPC (SC-1 RPC leg)
--   A-02  §9(1) flag leakage: transaction-local, never session-local
--   A-03  §9(2) door-paid bypass: availableAt='door' price>0 on a bare brand
--         MUST raise event_currency_required (Stripe gate is skipped for door)
--   A-04  §9(3) 0-priced NON-isFree ticket publishes free (price is truth)
--   A-05  §9(4) trip: legacy fabricated-USD draft heals to NULL at publish;
--         0→paid flip via biz_update_live_trip fails close on a bare brand
--   A-06  §9(4) same flip AFTER the brand gains NGN → stamps event+ticket
--   A-07  SC-2/SC-4 RSVP RPC legs: free publishes NULL; chip-in ON bare brand
--         raises stripe_charges_disabled; chip-in ON with Paystack-can_collect
--         but NO resolvable currency raises event_currency_required
--   A-08  §9(5) mixed cart: cross-era free(NULL)+paid(NGN) rows on one event —
--         pins the actual RPC behavior (raises mixed_currency_cart on money);
--         all-free NULL-ticket cart on the SAME stamped event still succeeds
--   A-09  §9(8) lifecycle via the real RPC: business_cancel_event on a
--         NULL-currency scheduled event must not raise
--   A-10  §9(7) NGN stamp/unstamp sequencing: derive trigger fires; door-paid
--         publish stamps NGN (whitelist passes); unstamp → published event
--         steady-state keeps NGN; new money publish fails close again
--   A-11  fail-close INSERT leg: direct INSERT of a scheduled event on a bare
--         brand (the biz_create_experience shape) still raises
--   A-12  CHECK backstop: with the ticket trigger disabled, a paid NULL-
--         currency row is still rejected (23514) on ticket_types AND orders
--
-- Hand-run (like the implementor's .test.sql — needs a live DB, not CI):
--   psql "$DB_URL" -f supabase/migrations/__tests__/issue_1014_free_publish_currency_adversarial.test.sql
-- WRITE-SAFE: every case runs inside a transaction that ROLLBACKs.
-- NOTE: auth context is provided via request.jwt.claim.sub (auth.uid()).

\set ON_ERROR_STOP on

-- ─── A-01: SC-1 through the ACTUAL event RPC ────────────────────────────────
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_res jsonb;
  v_curr char(3);
  v_status text;
  v_tt record;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'i1014adv a01', 'i1014adv-a01-' || v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'a01 draft', 'a01-draft-' || v_event, 'event', 'draft', 'draft', 'UTC');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  v_res := public.business_publish_event_draft(v_event, jsonb_build_object(
    'title', 'A01 Free Party',
    'timezone', 'UTC',
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'tickets', jsonb_build_array(jsonb_build_object('name', 'Free entry', 'isFree', true, 'price', 0, 'capacity', 100)),
      'city', 'Lagos',
      'partyTypes', jsonb_build_array('club-night'),
      'whenMode', 'single',
      'when', jsonb_build_object('date', to_char(now() + interval '10 days', 'YYYY-MM-DD'), 'doorsOpen', '20:00', 'endsAt', '23:00')
    ))
  ));

  SELECT currency, status INTO v_curr, v_status FROM public.events WHERE id = v_event;
  IF v_status <> 'scheduled' THEN
    RAISE EXCEPTION 'A-01 FAIL: RPC free publish did not reach scheduled (got %)', v_status;
  END IF;
  IF v_curr IS NOT NULL THEN
    RAISE EXCEPTION 'A-01 FAIL: RPC free publish stamped currency % (expected NULL)', v_curr;
  END IF;
  SELECT price_cents, currency INTO v_tt FROM public.ticket_types WHERE event_id = v_event AND deleted_at IS NULL LIMIT 1;
  IF v_tt.price_cents <> 0 OR v_tt.currency IS NOT NULL THEN
    RAISE EXCEPTION 'A-01 FAIL: ticket row price % currency % (expected 0/NULL)', v_tt.price_cents, v_tt.currency;
  END IF;
  RAISE NOTICE 'A-01 PASS: bare brand publishes a free event through business_publish_event_draft; currency NULL end-to-end';
END$$;
ROLLBACK;

-- ─── A-02: §9(1) flag leakage — transaction-local, never session-local ──────
-- Inside the SAME transaction the flag set by the RPC remains visible (that is
-- exactly what set_config(..., is_local=>true) means — PostgREST gives every
-- RPC call its own transaction, so no HTTP caller can observe it). The sharp
-- claim is the SESSION boundary: after ROLLBACK the flag MUST be gone.
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_res jsonb;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'i1014adv a02', 'i1014adv-a02-' || v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'a02 draft', 'a02-draft-' || v_event, 'event', 'draft', 'draft', 'UTC');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  v_res := public.business_publish_event_draft(v_event, jsonb_build_object(
    'title', 'A02 Free Party', 'timezone', 'UTC',
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'tickets', jsonb_build_array(jsonb_build_object('name', 'Free entry', 'isFree', true, 'price', 0, 'capacity', 10)),
      'city', 'Lagos', 'partyTypes', jsonb_build_array('club-night'),
      'whenMode', 'single',
      'when', jsonb_build_object('date', to_char(now() + interval '10 days', 'YYYY-MM-DD'), 'doorsOpen', '20:00', 'endsAt', '23:00')
    ))
  ));
  IF current_setting('mingla.publish_free_only', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'A-02 FAIL: expected the flag to be visible INSIDE the RPC transaction';
  END IF;
END$$;
ROLLBACK;
DO $$
BEGIN
  IF COALESCE(current_setting('mingla.publish_free_only', true), '') = 'on' THEN
    RAISE EXCEPTION 'A-02 FAIL: mingla.publish_free_only LEAKED across the transaction boundary (session-level leak — pooled connections would carry it between HTTP requests)';
  END IF;
  RAISE NOTICE 'A-02 PASS: publish_free_only flag is transaction-local (visible in-tx, gone after rollback — no session leak)';
END$$;

-- ─── A-03: §9(2) door-paid bypass through the event RPC ─────────────────────
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_res jsonb;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'i1014adv a03', 'i1014adv-a03-' || v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'a03 draft', 'a03-draft-' || v_event, 'event', 'draft', 'draft', 'UTC');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  BEGIN
    v_res := public.business_publish_event_draft(v_event, jsonb_build_object(
      'title', 'A03 Door Party', 'timezone', 'UTC',
      'theme', jsonb_build_object('business_draft', jsonb_build_object(
        'tickets', jsonb_build_array(jsonb_build_object('name', 'Door only', 'isFree', false, 'price', 10, 'capacity', 50, 'availableAt', 'door')),
        'city', 'Lagos', 'partyTypes', jsonb_build_array('club-night'),
        'whenMode', 'single',
        'when', jsonb_build_object('date', to_char(now() + interval '10 days', 'YYYY-MM-DD'), 'doorsOpen', '20:00', 'endsAt', '23:00')
      ))
    ));
    RAISE EXCEPTION 'A-03 FAIL: door-paid publish on a bare brand did NOT raise (Stripe gate skip must not skip the currency gate)';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'event_currency_required' THEN
      RAISE EXCEPTION 'A-03 FAIL: expected event_currency_required for door-paid, got %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'A-03 PASS: door-only paid ticket on a bare brand raises event_currency_required (money != Stripe gate)';
END$$;
ROLLBACK;

-- ─── A-04: §9(3) 0-priced NON-isFree ticket → price is truth, publishes free ─
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_res jsonb;
  v_curr char(3);
  v_tt record;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'i1014adv a04', 'i1014adv-a04-' || v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'a04 draft', 'a04-draft-' || v_event, 'event', 'draft', 'draft', 'UTC');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  v_res := public.business_publish_event_draft(v_event, jsonb_build_object(
    'title', 'A04 Zero NonFree', 'timezone', 'UTC',
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      -- isFree ABSENT (defaults false) and price 0: the money predicate is
      -- price-based, so this is a FREE publish; no currency may be fabricated.
      'tickets', jsonb_build_array(jsonb_build_object('name', 'GA', 'price', 0, 'capacity', 25)),
      'city', 'Lagos', 'partyTypes', jsonb_build_array('club-night'),
      'whenMode', 'single',
      'when', jsonb_build_object('date', to_char(now() + interval '10 days', 'YYYY-MM-DD'), 'doorsOpen', '20:00', 'endsAt', '23:00')
    ))
  ));

  SELECT currency INTO v_curr FROM public.events WHERE id = v_event;
  IF (SELECT status FROM public.events WHERE id = v_event) <> 'scheduled' OR v_curr IS NOT NULL THEN
    RAISE EXCEPTION 'A-04 FAIL: 0-priced non-isFree publish expected scheduled/NULL, got %/%',
      (SELECT status FROM public.events WHERE id = v_event), v_curr;
  END IF;
  SELECT price_cents, currency, is_free INTO v_tt FROM public.ticket_types WHERE event_id = v_event AND deleted_at IS NULL LIMIT 1;
  IF v_tt.price_cents <> 0 OR v_tt.currency IS NOT NULL THEN
    RAISE EXCEPTION 'A-04 FAIL: 0-priced non-isFree ticket landed price % currency %', v_tt.price_cents, v_tt.currency;
  END IF;
  RAISE NOTICE 'A-04 PASS: 0-priced non-isFree ticket publishes as free (price is truth); currency NULL';
END$$;
ROLLBACK;

-- ─── A-05: §9(4) trip — legacy USD draft heals to NULL; 0→paid flip via
--     biz_update_live_trip fails close on a bare brand ────────────────────────
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_tt uuid := gen_random_uuid();
  v_tier uuid := gen_random_uuid();
  v_res jsonb;
  v_curr char(3);
  v_tt_curr char(3);
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'i1014adv a05', 'i1014adv-a05-' || v_brand);
  -- Legacy fabricated-USD trip draft (pre-#1014 createTripDraft shape).
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone, currency)
    VALUES (v_event, v_brand, 'a05 trip', 'a05-trip-' || v_event, 'trip', 'draft', 'draft', 'UTC', 'USD');
  INSERT INTO public.ticket_types (id, event_id, name, price_cents, currency, is_free, quantity_total, min_purchase_qty, available_online, available_in_person, display_order)
    VALUES (v_tt, v_event, 'Trip spot', 0, 'USD', true, 12, 1, true, false, 0);
  INSERT INTO public.trip_pricing_tiers (id, event_id, ticket_type_id, tier_name)
    VALUES (v_tier, v_event, v_tt, 'Standard');
  INSERT INTO public.trip_days (event_id, ordinal, title, stops, media)
    VALUES (v_event, 1, 'Day 1', '[]'::jsonb, '[]'::jsonb);
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  v_res := public.business_publish_trip_draft(v_event, jsonb_build_object(
    'title', 'A05 Free Trip', 'timezone', 'UTC',
    'theme', jsonb_build_object('business_trip', jsonb_build_object(
      'destinationLocationText', 'Lagos, Nigeria',
      'startAt', (now() + interval '30 days')::text,
      'endAt', (now() + interval '33 days')::text
    ))
  ));

  SELECT currency INTO v_curr FROM public.events WHERE id = v_event;
  SELECT currency INTO v_tt_curr FROM public.ticket_types WHERE id = v_tt;
  IF v_curr IS NOT NULL OR v_tt_curr IS NOT NULL THEN
    RAISE EXCEPTION 'A-05 FAIL: published free trip kept fabricated USD (event %, ticket %)', v_curr, v_tt_curr;
  END IF;

  -- 0→paid flip through the LIVE-trip RPC while the brand is still bare.
  BEGIN
    v_res := public.biz_update_live_trip(v_event,
      jsonb_build_object('pricing_tiers', jsonb_build_array(
        jsonb_build_object('ticket_type_id', v_tt, 'price_cents', 5000))),
      'issue-1014 adversarial 0->paid flip');
    RAISE EXCEPTION 'A-05 FAIL: 0->paid flip via biz_update_live_trip on a bare brand did NOT raise';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'event_currency_required' THEN
      RAISE EXCEPTION 'A-05 FAIL: expected event_currency_required on the RPC price flip, got %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'A-05 PASS: legacy USD trip draft publishes free with NULL currency; RPC 0->paid flip fails close on a bare brand';
END$$;
ROLLBACK;

-- ─── A-06: §9(4) same flip AFTER the brand gains NGN → stamps event+ticket ──
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_tt uuid := gen_random_uuid();
  v_tier uuid := gen_random_uuid();
  v_res jsonb;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'i1014adv a06', 'i1014adv-a06-' || v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'a06 trip', 'a06-trip-' || v_event, 'trip', 'draft', 'draft', 'UTC');
  INSERT INTO public.ticket_types (id, event_id, name, price_cents, is_free, quantity_total, min_purchase_qty, available_online, available_in_person, display_order)
    VALUES (v_tt, v_event, 'Trip spot', 0, true, 12, 1, true, false, 0);
  INSERT INTO public.trip_pricing_tiers (id, event_id, ticket_type_id, tier_name)
    VALUES (v_tier, v_event, v_tt, 'Standard');
  INSERT INTO public.trip_days (event_id, ordinal, title, stops, media)
    VALUES (v_event, 1, 'Day 1', '[]'::jsonb, '[]'::jsonb);
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  v_res := public.business_publish_trip_draft(v_event, jsonb_build_object(
    'title', 'A06 Trip', 'timezone', 'UTC',
    'theme', jsonb_build_object('business_trip', jsonb_build_object(
      'destinationLocationText', 'Lagos, Nigeria',
      'startAt', (now() + interval '30 days')::text,
      'endAt', (now() + interval '33 days')::text
    ))
  ));
  IF (SELECT currency FROM public.events WHERE id = v_event) IS NOT NULL THEN
    RAISE EXCEPTION 'A-06 FAIL: free trip publish stamped a currency';
  END IF;

  -- Paystack onboarding stamps NGN (the edge-fn write, simulated at DB level).
  UPDATE public.brands SET default_currency = 'NGN' WHERE id = v_brand;

  v_res := public.biz_update_live_trip(v_event,
    jsonb_build_object('pricing_tiers', jsonb_build_array(
      jsonb_build_object('ticket_type_id', v_tt, 'price_cents', 750000))),
    'issue-1014 adversarial NGN price flip');

  IF (SELECT currency FROM public.events WHERE id = v_event) IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'A-06 FAIL: RPC price flip did not stamp events.currency=NGN (got %)',
      (SELECT currency FROM public.events WHERE id = v_event);
  END IF;
  IF (SELECT currency FROM public.ticket_types WHERE id = v_tt) IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'A-06 FAIL: RPC price flip did not stamp the ticket NGN (got %)',
      (SELECT currency FROM public.ticket_types WHERE id = v_tt);
  END IF;
  RAISE NOTICE 'A-06 PASS: 0->paid flip via biz_update_live_trip stamps event+ticket NGN at the money moment';
END$$;
ROLLBACK;

-- ─── A-07: RSVP RPC legs — free NULL; chip-in bare → stripe_charges_disabled;
--     chip-in with Paystack-can_collect but NO currency → event_currency_required
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_event2 uuid := gen_random_uuid();
  v_event3 uuid := gen_random_uuid();
  v_res jsonb;
  v_payload jsonb;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'i1014adv a07', 'i1014adv-a07-' || v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'a07 rsvp', 'a07-rsvp-' || v_event, 'rsvp', 'draft', 'draft', 'UTC'),
           (v_event2, v_brand, 'a07 rsvp2', 'a07-rsvp2-' || v_event2, 'rsvp', 'draft', 'draft', 'UTC'),
           (v_event3, v_brand, 'a07 rsvp3', 'a07-rsvp3-' || v_event3, 'rsvp', 'draft', 'draft', 'UTC');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  v_payload := jsonb_build_object(
    'title', 'A07 RSVP', 'timezone', 'UTC',
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'city', 'Lagos', 'partyTypes', jsonb_build_array('house-party'),
      'when', jsonb_build_object('date', to_char(now() + interval '10 days', 'YYYY-MM-DD'), 'doorsOpen', '19:00', 'endsAt', '22:00')
    ))
  );

  -- Leg 1: chip-in OFF → free publish, NULL currency (SC-2 RSVP RPC leg).
  v_res := public.business_publish_rsvp_draft(v_event, v_payload);
  IF (SELECT status FROM public.events WHERE id = v_event) <> 'scheduled'
     OR (SELECT currency FROM public.events WHERE id = v_event) IS NOT NULL THEN
    RAISE EXCEPTION 'A-07 FAIL: free RSVP publish expected scheduled/NULL, got %/%',
      (SELECT status FROM public.events WHERE id = v_event),
      (SELECT currency FROM public.events WHERE id = v_event);
  END IF;

  -- §9(1) demonstrated: leg 1's RPC left mingla.publish_free_only='on' for the
  -- REST OF THIS TRANSACTION — without the reset below, leg 3's money-bearing
  -- publish would sail through trigger (c) (verified live during authoring).
  -- Bounded in production: PostgREST wraps every RPC call in its own
  -- transaction, so no HTTP caller can chain a free publish and a money
  -- publish inside one transaction. Reset to mirror per-request reality.
  PERFORM set_config('mingla.publish_free_only', '', true);

  -- Leg 2: chip-in ON, bank-less brand → ORCH-1291 gate (SC-4 server leg).
  BEGIN
    v_res := public.business_publish_rsvp_draft(v_event2, jsonb_set(
      v_payload, '{theme,business_draft,rsvpContributionEnabled}', 'true'::jsonb));
    RAISE EXCEPTION 'A-07 FAIL: chip-in ON for a bank-less brand did NOT raise';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'stripe_charges_disabled' THEN
      RAISE EXCEPTION 'A-07 FAIL: expected stripe_charges_disabled, got %', SQLERRM;
    END IF;
  END;

  -- Leg 3: chip-in ON, Paystack subaccount present (pg_brand_can_collect =
  -- TRUE) but default_currency NULL — the legacy pre-#1014 NG-brand shape:
  -- the trigger's strict path must fail close with the ONE token.
  UPDATE public.brands SET paystack_subaccount_code = 'ACCT_i1014adv' WHERE id = v_brand;
  BEGIN
    v_res := public.business_publish_rsvp_draft(v_event3, jsonb_set(
      v_payload, '{theme,business_draft,rsvpContributionEnabled}', 'true'::jsonb));
    RAISE EXCEPTION 'A-07 FAIL: chip-in ON with can_collect-but-no-currency did NOT raise';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'event_currency_required' THEN
      RAISE EXCEPTION 'A-07 FAIL: expected event_currency_required for can_collect-no-currency, got %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'A-07 PASS: RSVP RPC — free publishes NULL; chip-in bare raises stripe_charges_disabled; chip-in with subaccount-but-no-currency raises event_currency_required';
END$$;
ROLLBACK;

-- ─── A-08: §9(5) mixed cart — cross-era free(NULL) + paid(NGN) rows ─────────
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_free_tt uuid;
  v_paid_tt uuid;
  v_res jsonb;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'i1014adv a08', 'i1014adv-a08-' || v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'a08 party', 'a08-party-' || v_event, 'event', 'draft', 'draft', 'UTC');
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, now() + interval '7 days', now() + interval '7 days 4 hours', 'UTC', true);
  INSERT INTO public.ticket_types (event_id, name, price_cents, is_free, quantity_total, min_purchase_qty, available_online, available_in_person, display_order)
    VALUES (v_event, 'Free entry', 0, true, 100, 1, true, true, 0)
    RETURNING id INTO v_free_tt;
  PERFORM set_config('mingla.publish_free_only', 'on', true);
  UPDATE public.events SET status = 'scheduled', visibility = 'public', published_at = now() WHERE id = v_event;
  PERFORM set_config('mingla.publish_free_only', '', true);

  -- Brand gains NGN; money enters; event stamps NGN — but the OLD free ticket
  -- row keeps its NULL currency (stay-NULL-until-money never rewrites siblings).
  UPDATE public.brands SET default_currency = 'NGN' WHERE id = v_brand;
  INSERT INTO public.ticket_types (event_id, name, price_cents, is_free, quantity_total, min_purchase_qty, available_online, available_in_person, display_order)
    VALUES (v_event, 'VIP', 500000, false, 20, 1, true, false, 1)
    RETURNING id INTO v_paid_tt;
  IF (SELECT currency FROM public.ticket_types WHERE id = v_free_tt) IS NOT NULL THEN
    RAISE EXCEPTION 'A-08 SETUP DRIFT: the legacy free ticket unexpectedly gained a currency';
  END IF;

  -- Leg 1: the cross-era mixed cart (money present) — pins the RPC's actual
  -- fail-close: mixed_currency_cart. (Product note for the report: buyers on
  -- such events cannot combine the legacy free ticket with a paid one in a
  -- single cart; they claim free separately. This assertion is the tripwire
  -- that forces a conscious decision if that trade-off is ever revisited.)
  BEGIN
    v_res := public.biz_ticket_checkout_create_session(
      v_event, NULL, 'Adv Tester', 'i1014adv@example.com', '+14155550100',
      false,
      jsonb_build_array(
        jsonb_build_object('ticketTypeId', v_free_tt, 'quantity', 1),
        jsonb_build_object('ticketTypeId', v_paid_tt, 'quantity', 1)),
      'i1014adv-a08-mixed-' || v_event, now() + interval '15 minutes', 0, 'auto');
    RAISE EXCEPTION 'A-08 FAIL: cross-era free(NULL)+paid(NGN) cart did NOT raise (money crossed a NULL-currency row)';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'mixed_currency_cart' THEN
      RAISE EXCEPTION 'A-08 FAIL: expected mixed_currency_cart, got %', SQLERRM;
    END IF;
  END;

  -- Leg 2: the SAME stamped event still serves an all-free NULL-ticket cart.
  v_res := public.biz_ticket_checkout_create_session(
    v_event, NULL, 'Adv Tester', 'i1014adv@example.com', '+14155550100',
    false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', v_free_tt, 'quantity', 1)),
    'i1014adv-a08-free-' || v_event, now() + interval '15 minutes', 0, 'auto');
  IF v_res->>'status' <> 'pending_free' THEN
    RAISE EXCEPTION 'A-08 FAIL: legacy free ticket alone expected pending_free, got %', v_res->>'status';
  END IF;
  RAISE NOTICE 'A-08 PASS: cross-era mixed cart fails close (mixed_currency_cart); all-free NULL cart on the stamped event still checks out';
END$$;
ROLLBACK;

-- ─── A-09: §9(8) lifecycle via the REAL RPC — cancel a NULL-currency event ──
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_res jsonb;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'i1014adv a09', 'i1014adv-a09-' || v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'a09 party', 'a09-party-' || v_event, 'event', 'draft', 'draft', 'UTC');
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, now() + interval '7 days', now() + interval '7 days 4 hours', 'UTC', true);
  PERFORM set_config('mingla.publish_free_only', 'on', true);
  UPDATE public.events SET status = 'scheduled', visibility = 'public', published_at = now() WHERE id = v_event;
  PERFORM set_config('mingla.publish_free_only', '', true);
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  v_res := public.business_cancel_event(v_event);
  IF (SELECT status FROM public.events WHERE id = v_event) <> 'cancelled' THEN
    RAISE EXCEPTION 'A-09 FAIL: business_cancel_event on a NULL-currency event did not cancel (status %)',
      (SELECT status FROM public.events WHERE id = v_event);
  END IF;
  IF (SELECT currency FROM public.events WHERE id = v_event) IS NOT NULL THEN
    RAISE EXCEPTION 'A-09 FAIL: cancel stamped a currency on a still-bare brand';
  END IF;
  RAISE NOTICE 'A-09 PASS: business_cancel_event cancels a NULL-currency published event on a still-bare brand without raising';
END$$;
ROLLBACK;

-- ─── A-10: §9(7) NGN stamp/unstamp sequencing (derive trigger + whitelist +
--     steady-state survival of the unstamp) ──────────────────────────────────
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_event2 uuid := gen_random_uuid();
  v_res jsonb;
  v_pricing record;
  v_payload jsonb;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'i1014adv a10', 'i1014adv-a10-' || v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'a10 party', 'a10-party-' || v_event, 'event', 'draft', 'draft', 'UTC'),
           (v_event2, v_brand, 'a10 party2', 'a10-party2-' || v_event2, 'event', 'draft', 'draft', 'UTC');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  -- The brand-paystack-onboard stamp (DB effect) + ORCH-1236 derive trigger.
  UPDATE public.brands SET default_currency = 'NGN', payment_provider = 'paystack',
         paystack_subaccount_code = 'ACCT_i1014a10' WHERE id = v_brand;
  SELECT pricing_currency, pricing_region INTO v_pricing FROM public.brands WHERE id = v_brand;
  IF v_pricing.pricing_currency IS DISTINCT FROM 'NGN' OR v_pricing.pricing_region IS DISTINCT FROM 'NG' THEN
    RAISE EXCEPTION 'A-10 FAIL: derive trigger did not map NGN -> pricing NGN/NG (got %/%)',
      v_pricing.pricing_currency, v_pricing.pricing_region;
  END IF;

  -- Door-paid publish (Stripe Guard A is N/A for door) → whitelist must admit
  -- NGN and stamp the event.
  v_payload := jsonb_build_object(
    'title', 'A10 Lagos Door Party', 'timezone', 'UTC',
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'tickets', jsonb_build_array(jsonb_build_object('name', 'Door', 'isFree', false, 'price', 5000, 'capacity', 100, 'availableAt', 'door')),
      'city', 'Lagos', 'partyTypes', jsonb_build_array('club-night'),
      'whenMode', 'single',
      'when', jsonb_build_object('date', to_char(now() + interval '10 days', 'YYYY-MM-DD'), 'doorsOpen', '20:00', 'endsAt', '23:00')
    ))
  );
  v_res := public.business_publish_event_draft(v_event, v_payload);
  IF (SELECT currency FROM public.events WHERE id = v_event) IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'A-10 FAIL: NGN door-paid publish expected events.currency=NGN, got %',
      (SELECT currency FROM public.events WHERE id = v_event);
  END IF;

  -- clear_provider pre-subaccount semantics: the NGN stamp is removed.
  UPDATE public.brands SET default_currency = NULL, paystack_subaccount_code = NULL WHERE id = v_brand;

  -- Published NGN event must keep working: steady-state transitions keep NGN.
  UPDATE public.events SET status = 'live' WHERE id = v_event;
  IF (SELECT currency FROM public.events WHERE id = v_event) IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'A-10 FAIL: unstamp broke the published event steady-state (currency %)',
      (SELECT currency FROM public.events WHERE id = v_event);
  END IF;

  -- And NEW money publishes fail close again (door-paid, brand bare again).
  BEGIN
    v_res := public.business_publish_event_draft(v_event2, jsonb_set(v_payload, '{title}', '"A10 Second Party"'::jsonb));
    RAISE EXCEPTION 'A-10 FAIL: door-paid publish after unstamp did NOT raise';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'event_currency_required' THEN
      RAISE EXCEPTION 'A-10 FAIL: expected event_currency_required after unstamp, got %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'A-10 PASS: NGN stamp derives pricing NGN/NG; door-paid publish stamps NGN; unstamp keeps published events alive and re-arms the fail-close';
END$$;
ROLLBACK;

-- ─── A-11: fail-close INSERT leg — a directly-INSERTed scheduled event on a
--     bare brand (the biz_create_experience shape) still raises ──────────────
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'i1014adv a11', 'i1014adv-a11-' || v_brand);
  BEGIN
    INSERT INTO public.events (brand_id, title, slug, event_type, status, visibility, timezone)
      VALUES (v_brand, 'a11 direct', 'a11-direct-' || v_brand, 'experience', 'scheduled', 'public', 'UTC');
    RAISE EXCEPTION 'A-11 FAIL: direct INSERT of a scheduled event on a bare brand did NOT raise';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'event_currency_required' THEN
      RAISE EXCEPTION 'A-11 FAIL: expected event_currency_required on the INSERT leg, got %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'A-11 PASS: TG_OP=INSERT leg still fails close (biz_create_experience shape unchanged)';
END$$;
ROLLBACK;

-- ─── A-12: CHECK backstop with the ticket trigger DISABLED — the schema alone
--     rejects money without a currency (23514) on ticket_types AND orders ────
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'i1014adv a12', 'i1014adv-a12-' || v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'a12 draft', 'a12-draft-' || v_event, 'event', 'draft', 'draft', 'UTC');

  EXECUTE 'ALTER TABLE public.ticket_types DISABLE TRIGGER trg_enforce_event_ticket_currency';
  BEGIN
    INSERT INTO public.ticket_types (event_id, name, price_cents, is_free, quantity_total, min_purchase_qty, available_online, available_in_person, display_order)
      VALUES (v_event, 'Bypass VIP', 5000, false, 10, 1, true, false, 0);
    RAISE EXCEPTION 'A-12 FAIL: paid NULL-currency ticket row committed with the trigger disabled (CHECK missing)';
  EXCEPTION WHEN check_violation THEN
    NULL; -- 23514: ticket_types_paid_currency_required_check holds.
  END;
  EXECUTE 'ALTER TABLE public.ticket_types ENABLE TRIGGER trg_enforce_event_ticket_currency';

  BEGIN
    INSERT INTO public.orders (event_id, buyer_email, total_cents, currency)
      VALUES (v_event, 'i1014adv@example.com', 5000, NULL);
    RAISE EXCEPTION 'A-12 FAIL: money order with NULL currency committed (CHECK missing)';
  EXCEPTION WHEN check_violation THEN
    NULL; -- 23514: orders_paid_currency_required_check holds.
  WHEN not_null_violation THEN
    NULL; -- schema variants with stricter order columns still reject.
  END;
  RAISE NOTICE 'A-12 PASS: schema CHECKs alone reject money-without-currency on ticket_types and orders';
END$$;
ROLLBACK;

DO $$ BEGIN RAISE NOTICE 'issue #1014 ADVERSARIAL probe complete: A-01..A-12 all passed.'; END $$;
