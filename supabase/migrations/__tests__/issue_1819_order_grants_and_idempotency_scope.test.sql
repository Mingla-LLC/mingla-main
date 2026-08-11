-- ===========================================================================
-- Issue #1819 — the tester's two HIGH findings against Phase 2, executed.
--
-- Both groups assert the LIVE state, never the presence of a line in source:
-- H-1 reads pg_catalog's actual ACL (a REVOKE that does not work still looks
-- like a REVOKE), and H-2 writes real rows through the real unique index.
--
-- Runs inside ONE transaction and ROLLBACKs.
-- ===========================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- H-1 — ANON HOLDS NOTHING ON THE FIVE MONEY TABLES.
--
-- The tester TRUNCATEd these as anon on production. RLS was enabled and
-- correct the whole time and did not help, because RLS DOES NOT GATE TRUNCATE —
-- so the only thing standing between anon and an empty money table was the
-- absence of a route to reach it.
--
-- Asserted per PRIVILEGE, not as a single "has any" question, so a partial
-- revoke (the shape that produced the bug: GRANTs written, defaults never
-- removed) fails loudly and names the privilege it left behind.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_tbl text;
  v_priv text;
  v_checked int := 0;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'venue_order_sessions','venue_orders','venue_order_items',
    'venue_order_item_modifiers','venue_order_rate_limits'
  ] LOOP
    -- Vacuity guard: a renamed or dropped table must FAIL here rather than
    -- pass by asking about nothing.
    IF to_regclass('public.' || v_tbl) IS NULL THEN
      RAISE EXCEPTION 'issue_1819 H-1 VACUITY: public.% does not exist', v_tbl;
    END IF;

    FOREACH v_priv IN ARRAY ARRAY[
      'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
    ] LOOP
      IF has_table_privilege('anon', 'public.' || v_tbl, v_priv) THEN
        RAISE EXCEPTION
          'issue_1819 H-1: anon still holds % on public.% — RLS does not gate TRUNCATE',
          v_priv, v_tbl;
      END IF;
      v_checked := v_checked + 1;
    END LOOP;
  END LOOP;

  IF v_checked <> 35 THEN
    RAISE EXCEPTION 'issue_1819 H-1 VACUITY: checked % privilege pairs, expected 35', v_checked;
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- H-1b — TRUNCATE specifically, and the WRITE privileges, are gone from
-- `authenticated` too; SELECT SURVIVES on the four order-family tables.
--
-- Over-revoking is its own outage: Supabase evaluates RLS per subscriber for
-- postgres_changes, so dropping authenticated's SELECT would silently kill the
-- Phase-3 Orders queue's realtime — the ORCH-0854 failure class. This asserts
-- BOTH directions so the fix cannot swing past correct.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_tbl text;
  v_priv text;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'venue_order_sessions','venue_orders','venue_order_items','venue_order_item_modifiers'
  ] LOOP
    IF NOT has_table_privilege('authenticated', 'public.' || v_tbl, 'SELECT') THEN
      RAISE EXCEPTION
        'issue_1819 H-1b: authenticated lost SELECT on public.% — realtime for the Orders queue dies SILENTLY',
        v_tbl;
    END IF;
    FOREACH v_priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
      IF has_table_privilege('authenticated', 'public.' || v_tbl, v_priv) THEN
        RAISE EXCEPTION
          'issue_1819 H-1b: authenticated still holds % on public.% — order writes are service-role only',
          v_priv, v_tbl;
      END IF;
    END LOOP;
  END LOOP;

  -- The limiter has no RLS policy at all, so authenticated must hold NOTHING.
  FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
    IF has_table_privilege('authenticated', 'public.venue_order_rate_limits', v_priv) THEN
      RAISE EXCEPTION
        'issue_1819 H-1b: authenticated still holds % on venue_order_rate_limits', v_priv;
    END IF;
  END LOOP;

  -- ...and service_role still does its job, or the whole rail is dead.
  IF NOT has_table_privilege('service_role', 'public.venue_orders', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.venue_order_rate_limits', 'INSERT') THEN
    RAISE EXCEPTION 'issue_1819 H-1b: service_role cannot write the order rail';
  END IF;
END $t$;

-- ---------------------------------------------------------------------------
-- H-1c — THE PROOF THE TESTER RAN, EXECUTED. Become anon and attempt the
-- TRUNCATE that succeeded on production. It must be refused for lack of
-- privilege, asserted on SQLSTATE 42501 rather than on any message text.
--
-- Deliberately aimed at the two LEAF tables (nothing holds an FK to them).
-- `venue_orders` is referenced by stripe_disputes, so TRUNCATEing it raises an
-- FK error (0A000) the moment the PRIVILEGE check PASSES — which would make a
-- refusal look identical to the bug. On a leaf, 42501 is the only way to fail,
-- so this cannot pass for the wrong reason. All five tables are covered by the
-- per-privilege ACL sweep above; this is the executable half.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_tbl text;
  v_state text;
  v_refused boolean;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY['venue_order_item_modifiers','venue_order_rate_limits'] LOOP
    v_refused := false;
    v_state := NULL;
    BEGIN
      SET LOCAL ROLE anon;
      EXECUTE format('TRUNCATE public.%I', v_tbl);
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN
      v_state := SQLSTATE;
      v_refused := (v_state = '42501');
    END;
    RESET ROLE;
    IF NOT v_refused THEN
      RAISE EXCEPTION
        'issue_1819 H-1c: anon TRUNCATE of public.% was not refused for lack of privilege (sqlstate %)',
        v_tbl, coalesce(v_state, 'none — it SUCCEEDED');
    END IF;
  END LOOP;
END $t$;

-- ---------------------------------------------------------------------------
-- H-2 — THE IDEMPOTENCY NAMESPACE IS PER TENANT.
--
-- Two brands submitting the SAME client-chosen key must both get their own
-- order. Before the fix the second INSERT was rejected by a global unique
-- index, and — worse — order-create's replay read matched the FIRST brand's row
-- and returned its id, total and payment status to the second brand's guest.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_user uuid := '00000000-1819-4000-8000-000000000001';
  v_brand_a uuid := '00000000-1819-4000-8000-00000000000a';
  v_brand_b uuid := '00000000-1819-4000-8000-00000000000b';
  v_venue_a uuid := '00000000-1819-4000-8000-0000000000aa';
  v_venue_b uuid := '00000000-1819-4000-8000-0000000000bb';
  v_venue_a2 uuid := '00000000-1819-4000-8000-0000000000a2';
  v_session_a uuid; v_session_b uuid; v_session_a2 uuid;
  v_order_a uuid; v_order_b uuid;
  v_shared_key text := 'client-chosen-key-collision';
  v_leaked uuid;
  v_dupe_rejected boolean := false;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated', 'owner-1819@example.test', now(), now());
  INSERT INTO public.creator_accounts (id, created_at) VALUES (v_user, now());

  INSERT INTO public.brands (id, account_id, name, slug, default_currency, created_at, updated_at)
  VALUES (v_brand_a, v_user, 'Issue 1819 A', 'issue1819a', 'GBP', now(), now()),
         (v_brand_b, v_user, 'Issue 1819 B', 'issue1819b', 'GBP', now(), now());

  INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status)
  VALUES (v_venue_a,  v_brand_a, 'i1819a',  'Venue A',  51.50, -0.12, 'restaurant', 'verified'),
         (v_venue_a2, v_brand_a, 'i1819a2', 'Venue A2', 51.51, -0.13, 'restaurant', 'verified'),
         (v_venue_b,  v_brand_b, 'i1819b',  'Venue B',  51.52, -0.14, 'restaurant', 'verified');

  INSERT INTO public.venue_order_sessions (brand_id, venue_id, currency)
  VALUES (v_brand_a, v_venue_a, 'GBP') RETURNING id INTO v_session_a;
  INSERT INTO public.venue_order_sessions (brand_id, venue_id, currency)
  VALUES (v_brand_b, v_venue_b, 'GBP') RETURNING id INTO v_session_b;
  INSERT INTO public.venue_order_sessions (brand_id, venue_id, currency)
  VALUES (v_brand_a, v_venue_a2, 'GBP') RETURNING id INTO v_session_a2;

  -- Brand A's guest orders first, for GBP99.00.
  INSERT INTO public.venue_orders (
    session_id, brand_id, venue_id, source, pickup_code, buyer_name,
    money_path, currency, subtotal_cents, service_charge_cents,
    effective_take_rate_bps, service_fee_bps, mingla_fee_cents,
    platform_service_fee_cents, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, total_cents, provider, idempotency_key
  ) VALUES (
    v_session_a, v_brand_a, v_venue_a, 'guest_page', '11', 'Ada',
    'mingla', 'GBP', 9900, 0, 0, 0, 0, 0, false, false, false,
    9900, 9900, 'stripe', v_shared_key
  ) RETURNING id INTO v_order_a;

  -- Brand B's guest submits the SAME key. Before #1819 this INSERT was rejected
  -- outright by the global unique index.
  INSERT INTO public.venue_orders (
    session_id, brand_id, venue_id, source, pickup_code, buyer_name,
    money_path, currency, subtotal_cents, service_charge_cents,
    effective_take_rate_bps, service_fee_bps, mingla_fee_cents,
    platform_service_fee_cents, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, total_cents, provider, idempotency_key
  ) VALUES (
    v_session_b, v_brand_b, v_venue_b, 'guest_page', '12', 'Bola',
    'mingla', 'GBP', 500, 0, 0, 0, 0, 0, false, false, false,
    500, 500, 'stripe', v_shared_key
  ) RETURNING id INTO v_order_b;

  IF v_order_a = v_order_b THEN
    RAISE EXCEPTION 'issue_1819 H-2 VACUITY: the two brands share one order row';
  END IF;

  -- THE LEAK ITSELF: the replay read order-create performs, scoped as the code
  -- now scopes it. Brand B must see ITS OWN order — never brand A's GBP99.00.
  SELECT id INTO v_leaked FROM public.venue_orders
   WHERE brand_id = v_brand_b AND venue_id = v_venue_b
     AND idempotency_key = v_shared_key;
  IF v_leaked IS DISTINCT FROM v_order_b THEN
    RAISE EXCEPTION
      'issue_1819 H-2: the scoped replay read returned % for brand B, expected its own order %',
      v_leaked, v_order_b;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.venue_orders
     WHERE brand_id = v_brand_b AND venue_id = v_venue_b
       AND idempotency_key = v_shared_key AND id = v_order_a
  ) THEN
    RAISE EXCEPTION 'issue_1819 H-2: brand A''s order is visible on brand B''s scoped replay read';
  END IF;

  -- THE LEAK, DEMONSTRATED rather than asserted in the abstract. This is the
  -- read order-create actually shipped: match on the client-supplied key alone.
  -- With both rows present it is ambiguous, and `maybeSingle()` on the edge
  -- would hand back whichever row Postgres returned first — brand A's GBP99.00
  -- to brand B's guest. It doubles as the group's vacuity guard: if only one row
  -- carries the key, the scoped assertions above proved nothing.
  IF (SELECT count(*) FROM public.venue_orders WHERE idempotency_key = v_shared_key) <> 2 THEN
    RAISE EXCEPTION
      'issue_1819 H-2 VACUITY: the collision was never actually created, so the scoped read was not tested';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.venue_orders
     WHERE idempotency_key = v_shared_key AND brand_id <> v_brand_b
  ) THEN
    RAISE EXCEPTION
      'issue_1819 H-2 VACUITY: no foreign-brand row shares the key, so the unscoped read could not have leaked';
  END IF;

  -- Uniqueness still BITES inside one tenant: a true duplicate is refused.
  BEGIN
    INSERT INTO public.venue_orders (
      session_id, brand_id, venue_id, source, pickup_code, buyer_name,
      money_path, currency, subtotal_cents, service_charge_cents,
      effective_take_rate_bps, service_fee_bps, mingla_fee_cents,
      platform_service_fee_cents, pass_mingla_fee, pass_service_fee, pass_tax,
      buyer_subtotal_cents, total_cents, provider, idempotency_key
    ) VALUES (
      v_session_a, v_brand_a, v_venue_a, 'guest_page', '13', 'Ada again',
      'mingla', 'GBP', 9900, 0, 0, 0, 0, 0, false, false, false,
      9900, 9900, 'stripe', v_shared_key
    );
  EXCEPTION WHEN unique_violation THEN v_dupe_rejected := true;
  END;
  IF NOT v_dupe_rejected THEN
    RAISE EXCEPTION
      'issue_1819 H-2: a genuine duplicate inside ONE brand+venue was ACCEPTED — the scoping went too far and idempotency is gone';
  END IF;

  -- Two VENUES of the SAME brand are also separate namespaces: a session belongs
  -- to exactly one venue, which is the grain the derived key already uses.
  INSERT INTO public.venue_orders (
    session_id, brand_id, venue_id, source, pickup_code, buyer_name,
    money_path, currency, subtotal_cents, service_charge_cents,
    effective_take_rate_bps, service_fee_bps, mingla_fee_cents,
    platform_service_fee_cents, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, total_cents, provider, idempotency_key
  ) VALUES (
    v_session_a2, v_brand_a, v_venue_a2, 'guest_page', '14', 'Chi',
    'mingla', 'GBP', 700, 0, 0, 0, 0, 0, false, false, false,
    700, 700, 'stripe', v_shared_key
  );
END $t$;

-- ---------------------------------------------------------------------------
-- H-2b — the index itself carries the tenant columns. Asserted on the live
-- catalogue, so a re-created index that quietly drops the scoping is caught
-- even if no test happens to collide that day.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_def text;
BEGIN
  SELECT indexdef INTO v_def FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'venue_orders_idempotency_uniq';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'issue_1819 H-2b VACUITY: venue_orders_idempotency_uniq does not exist';
  END IF;
  IF v_def !~* 'UNIQUE' THEN
    RAISE EXCEPTION 'issue_1819 H-2b: the idempotency index is no longer UNIQUE — replay protection is gone';
  END IF;
  IF v_def !~* '\(brand_id, venue_id, idempotency_key\)' THEN
    RAISE EXCEPTION
      'issue_1819 H-2b: the idempotency index is not scoped to (brand_id, venue_id, idempotency_key) — it is %',
      v_def;
  END IF;
END $t$;

ROLLBACK;
