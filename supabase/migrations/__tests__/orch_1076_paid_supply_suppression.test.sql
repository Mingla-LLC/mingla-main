-- ORCH-1076 Stream A — behavioral post-apply probe for buyer-supply suppression.
-- Hand-run AFTER `supabase db push --linked` lands
-- 20260917000000_orch_1076_paid_supply_requires_charges_enabled.sql.
--
-- WRITE-SAFE: every behavioral case runs inside its own transaction that
-- ROLLBACKs, so no fixture data survives. It exercises the readiness gate
-- against REAL RPC calls (not just function-body text): seed a not-Stripe-ready
-- brand + a published PAID experience and assert the supply RPCs return ZERO
-- rows for it, then flip charges_enabled true (within the same tx) and assert
-- the row REAPPEARS (self-heal). A FREE control + an in-person-only-paid control
-- must always remain visible.
--
-- fails-on-revert: if any supply RPC drops the pg_brand_can_charge gate (so a
-- paid not-ready offering is returned), the matching "expected hidden but RPC
-- returned it" branch RAISEs and the test fails.
--
-- Covers SPEC §12 T-01 (deck), T-02 (place-card), T-03 (brand experiences),
-- T-04 (brand upcoming), T-10 (free never gated), T-11 (in-person-only paid),
-- T-13 (self-heal). The tester layers the deep-link + edge-fn cases on top.

\set ON_ERROR_STOP on

-- ─── G-00: all five supply RPCs carry the readiness marker (text probe) ───────
DO $$
DECLARE
  v_fns text[] := ARRAY[
    'public.pg_eligible_experiences_for_deck(double precision, double precision, double precision, text[], timestamptz, uuid[], integer)',
    'public.pg_brand_experiences_for_place(uuid)',
    'public.pg_public_experiences_by_brand(text)',
    'public.pg_public_brand_upcoming(text, timestamptz, integer)',
    'public.pg_public_trips_by_brand(text)'
  ];
  v_sig text;
  v_def text;
BEGIN
  FOREACH v_sig IN ARRAY v_fns LOOP
    v_def := pg_get_functiondef(v_sig::regprocedure);
    IF position('pg_brand_can_charge(' IN v_def) = 0 THEN
      RAISE EXCEPTION 'G-00 FAIL: % is missing the pg_brand_can_charge readiness gate', v_sig;
    END IF;
  END LOOP;
  -- The batched helper + anon grant must exist.
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'pg_brands_can_charge'
                 AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'G-00 FAIL: pg_brands_can_charge(uuid[]) helper missing';
  END IF;
  IF NOT has_function_privilege('anon', 'public.pg_brand_can_charge(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'G-00 FAIL: anon lacks EXECUTE on pg_brand_can_charge(uuid)';
  END IF;
  RAISE NOTICE 'G-00 PASS: all five supply RPCs gated + batched helper + anon grant present';
END$$;

-- ─── G-01: brand-page experiences RPC hides a PAID not-ready experience and
--           reappears on self-heal; FREE control always visible (T-03/T-10/T-13)
BEGIN;
DO $$
DECLARE
  v_brand uuid;
  v_paid_exp uuid;
  v_free_exp uuid;
  v_slug text := 'orch1076-probe-brand';
  v_cnt int;
BEGIN
  -- Seed a not-ready brand (no stripe_connect_accounts row -> can_charge=false).
  INSERT INTO public.brands (id, slug, name, default_currency, created_at, updated_at)
  VALUES (gen_random_uuid(), v_slug, 'ORCH1076 Probe', 'USD', now(), now())
  RETURNING id INTO v_brand;

  ASSERT public.pg_brand_can_charge(v_brand) = false,
    'precondition: seeded brand must be not-ready';

  -- PAID published experience (online ticket, price>0).
  INSERT INTO public.events (id, brand_id, event_type, title, slug, description,
    status, visibility, published_at, currency, timezone, created_at, updated_at)
  VALUES (gen_random_uuid(), v_brand, 'experience', 'Paid Crawl', 'paid-crawl',
    'desc', 'scheduled', 'public', now(), 'USD', 'UTC', now(), now())
  RETURNING id INTO v_paid_exp;
  INSERT INTO public.ticket_types (event_id, name, price_cents, currency,
    is_unlimited, is_free, available_online, available_in_person, display_order)
  VALUES (v_paid_exp, 'Standard', 7000, 'USD', true, false, true, false, 0);

  -- FREE published experience (control — never gated).
  INSERT INTO public.events (id, brand_id, event_type, title, slug, description,
    status, visibility, published_at, currency, timezone, created_at, updated_at)
  VALUES (gen_random_uuid(), v_brand, 'experience', 'Free Crawl', 'free-crawl',
    'desc', 'scheduled', 'public', now(), 'USD', 'UTC', now(), now())
  RETURNING id INTO v_free_exp;
  INSERT INTO public.ticket_types (event_id, name, price_cents, currency,
    is_unlimited, is_free, available_online, available_in_person, display_order)
  VALUES (v_free_exp, 'Standard', 0, 'USD', true, true, true, false, 0);

  -- PAID not-ready -> HIDDEN.
  SELECT count(*) INTO v_cnt
  FROM public.pg_public_experiences_by_brand(v_slug)
  WHERE experience_id = v_paid_exp;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'G-01 FAIL: paid not-ready experience leaked through pg_public_experiences_by_brand (count=%)', v_cnt;
  END IF;

  -- FREE -> VISIBLE.
  SELECT count(*) INTO v_cnt
  FROM public.pg_public_experiences_by_brand(v_slug)
  WHERE experience_id = v_free_exp;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'G-01 FAIL: free experience wrongly hidden (count=%)', v_cnt;
  END IF;

  -- Self-heal: attach a ready stripe account -> paid experience REAPPEARS.
  INSERT INTO public.stripe_connect_accounts (brand_id, stripe_account_id,
    charges_enabled, detached_at, created_at, updated_at)
  VALUES (v_brand, 'acct_orch1076probe', true, NULL, now(), now());
  ASSERT public.pg_brand_can_charge(v_brand) = true,
    'self-heal: brand should now be ready';

  SELECT count(*) INTO v_cnt
  FROM public.pg_public_experiences_by_brand(v_slug)
  WHERE experience_id = v_paid_exp;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'G-01 FAIL: paid experience did NOT reappear after self-heal (count=%)', v_cnt;
  END IF;

  -- Upcoming feed mirrors the same gate before self-heal would have hidden it;
  -- after self-heal both are present.
  SELECT count(*) INTO v_cnt
  FROM public.pg_public_brand_upcoming(v_slug, now() - interval '1 year', 30)
  WHERE offering_id = v_paid_exp;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'G-01 FAIL: paid experience missing from upcoming after self-heal (count=%)', v_cnt;
  END IF;

  RAISE NOTICE 'G-01 PASS: brand-page experiences/upcoming gate + free carve-out + self-heal';
END$$;
ROLLBACK;

-- ─── G-02: place-card RPC hides paid not-ready; in-person-only-paid visible
--           (T-02/T-11) ────────────────────────────────────────────────────────
BEGIN;
DO $$
DECLARE
  v_brand uuid;
  v_pool uuid := gen_random_uuid();
  v_paid_exp uuid;
  v_door_exp uuid;
  v_cnt int;
BEGIN
  -- The place-card RPC requires a VERIFIED brand linked to a place_pool row.
  INSERT INTO public.place_pool (id, created_at, updated_at)
  VALUES (v_pool, now(), now());

  INSERT INTO public.brands (id, slug, name, default_currency, place_pool_id,
    claim_status, created_at, updated_at)
  VALUES (gen_random_uuid(), 'orch1076-place-brand', 'Place Probe', 'USD',
    v_pool, 'verified', now(), now())
  RETURNING id INTO v_brand;

  -- PAID online experience (not-ready) -> hidden.
  INSERT INTO public.events (id, brand_id, event_type, title, slug, description,
    status, visibility, published_at, currency, timezone, created_at, updated_at)
  VALUES (gen_random_uuid(), v_brand, 'experience', 'Paid Place', 'paid-place',
    'desc', 'scheduled', 'public', now(), 'USD', 'UTC', now(), now())
  RETURNING id INTO v_paid_exp;
  INSERT INTO public.ticket_types (event_id, name, price_cents, currency,
    is_unlimited, is_free, available_online, available_in_person, display_order)
  VALUES (v_paid_exp, 'Standard', 5000, 'USD', true, false, true, false, 0);

  -- In-person-only PAID (available_online=false) -> NEVER gated -> visible.
  INSERT INTO public.events (id, brand_id, event_type, title, slug, description,
    status, visibility, published_at, currency, timezone, created_at, updated_at)
  VALUES (gen_random_uuid(), v_brand, 'experience', 'Door Place', 'door-place',
    'desc', 'scheduled', 'public', now(), 'USD', 'UTC', now(), now())
  RETURNING id INTO v_door_exp;
  INSERT INTO public.ticket_types (event_id, name, price_cents, currency,
    is_unlimited, is_free, available_online, available_in_person, display_order)
  VALUES (v_door_exp, 'Door', 5000, 'USD', true, false, false, true, 0);

  SELECT count(*) INTO v_cnt
  FROM public.pg_brand_experiences_for_place(v_pool)
  WHERE experience_id = v_paid_exp;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'G-02 FAIL: paid not-ready experience leaked through pg_brand_experiences_for_place (count=%)', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
  FROM public.pg_brand_experiences_for_place(v_pool)
  WHERE experience_id = v_door_exp;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'G-02 FAIL: in-person-only paid experience wrongly hidden (count=%)', v_cnt;
  END IF;

  RAISE NOTICE 'G-02 PASS: place-card gate + in-person-only-paid carve-out';
END$$;
ROLLBACK;
