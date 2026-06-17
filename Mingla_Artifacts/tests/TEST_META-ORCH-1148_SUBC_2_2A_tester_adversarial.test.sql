-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.2a — TESTER adversarial harness (DIFFERENT angle)
-- ---------------------------------------------------------------------------
-- Written by the BRUTAL tester. Distinct from the implementor's C-01..C-12:
-- those proved single-shot behaviors; this attacks CONCURRENCY + IDEMPOTENCY +
-- cross-guest isolation + anon-PII-coax — the seams where money + the anon
-- engine grant + double-book races actually break.
--
-- Self-contained: builds an isolated reservable venue inside a txn, asserts,
-- and ROLLS BACK. Run: psql -v ON_ERROR_STOP=1 -f <thisfile>.
-- (The true-concurrency advisory-lock race [ADV-2] cannot be exercised inside a
--  single txn — it requires two concurrent sessions; it is proven in the TEST
--  report via two background psql sessions and cited there. This file covers
--  the parts provable single-session.)
--
--   T-A1  IDEMPOTENCY (THE DEFECT): minting the SAME payment_intent_id twice for
--         a slot with remaining>=2 must NOT create two reservations. The writer
--         has no idempotency key → it DOES create two. This assertion encodes
--         the CORRECT contract and therefore FAILS against HEAD 7e090cd9e,
--         documenting the P1. (Mirror: ticket-checkout-confirm's finalize RPC is
--         idempotent via FOR UPDATE + early-return-if-order-exists; the venue
--         writer dropped that guard.)
--   T-A2  ANON PII-COAX: crafted engine args (negative/huge party, other-brand,
--         nonexistent brand) leak ZERO rows; engine returns EXACTLY 4 cols.
--   T-A3  CROSS-GUEST CANCEL: guest B's token cannot cancel guest A's row.
--   T-A4  KEYSTONE fails-on-revert: with the anon grant revoked, anon loses
--         engine EXECUTE (the exposure boundary is grant-gated).
-- ===========================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---- isolated fixture ------------------------------------------------------
DO $fix$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_acct uuid;
  v_brand uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id) VALUES (v_uid);
  INSERT INTO public.creator_accounts (id) VALUES (v_uid);
  INSERT INTO public.brands (id, account_id, name, slug, pricing_region, pricing_currency)
    VALUES (v_brand, v_uid, 'TESTER ADV venue', 'tester-adv-'||replace(v_brand::text,'-',''), 'GB','GBP');
  INSERT INTO public.venue_reservation_settings
    (brand_id, reservations_enabled, fee_enabled, fee_refundable, cancel_cutoff_hours, no_show_fee_policy)
    VALUES (v_brand, true, false, true, 24, 'none');
  INSERT INTO public.venue_availability_config
    (brand_id, service_periods, turn_times, buffer_minutes, slot_granularity_minutes,
     advance_window_days, min_notice_minutes, iana_timezone, max_reservations_per_slot)
    VALUES (v_brand,
      '[{"start":"10:00","end":"23:00","days":["0","1","2","3","4","5","6"]}]'::jsonb,
      '{"p2":60}'::jsonb, 0, 60, 365, 0, 'UTC', NULL);
  -- TWO reservable tables → a party-2 slot has remaining=2 (the defect window).
  INSERT INTO public.venue_tables (brand_id, name, capacity, min_party, max_party, reservation_policy, is_active)
    VALUES (v_brand,'A',2,1,2,'reservable',true), (v_brand,'B',2,1,2,'reservable',true);
  PERFORM set_config('tester.brand', v_brand::text, true);
END $fix$;

-- ---- T-A2  anon PII-coax (the keystone) -----------------------------------
DO $ta2$
DECLARE
  v_brand uuid := current_setting('tester.brand')::uuid;
  v_slot timestamptz;
  v_cols int;
BEGIN
  -- pick a real future slot as the service role first (engine emits it).
  SELECT slot_start_utc INTO v_slot
  FROM public.pg_venue_available_slots(v_brand, (now()+interval '7 days')::date, 2)
  ORDER BY slot_start_utc LIMIT 1;
  IF v_slot IS NULL THEN RAISE EXCEPTION 'T-A2 fixture: engine emitted no slot'; END IF;

  -- seed a PII reservation so a leak would be observable.
  INSERT INTO public.reservations (brand_id, reserved_for, party_size, status, source, created_via,
    guest_name, guest_phone_e164, guest_email)
  VALUES (v_brand, v_slot, 2, 'confirmed','website','guest','LEAK CANARY','+447700900777','canary@leak.test');

  SET LOCAL ROLE anon;
  -- negative / huge / other / nonexistent brand → 0 rows, never an error, never PII.
  IF (SELECT count(*) FROM public.pg_venue_available_slots(v_brand,(now()+interval '7 days')::date,-1)) <> 0
     OR (SELECT count(*) FROM public.pg_venue_available_slots(v_brand,(now()+interval '7 days')::date,99999)) <> 0
     OR (SELECT count(*) FROM public.pg_venue_available_slots('11111111-1111-1111-1111-111111111111'::uuid,(now()+interval '7 days')::date,2)) <> 0 THEN
    RAISE EXCEPTION 'T-A2 FAIL: engine returned rows for an adversarial arg';
  END IF;
  -- anon reads 0 PII rows despite the canary present.
  IF (SELECT count(*) FROM public.reservations WHERE guest_email='canary@leak.test') <> 0 THEN
    RAISE EXCEPTION 'T-A2 FAIL: anon read a reservation PII row (RLS breach)';
  END IF;
  -- engine return is exactly the 4 aggregate columns (introspect by name).
  RESET ROLE;
  SELECT cardinality(string_to_array(
           regexp_replace(pg_get_function_result(p.oid), '^TABLE\(|\)$', '', 'g'), ','))
    INTO v_cols
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='pg_venue_available_slots';
  IF v_cols <> 4 THEN RAISE EXCEPTION 'T-A2 FAIL: engine return is not exactly 4 columns (got %)', v_cols; END IF;
  RAISE NOTICE 'T-A2 PASS: anon PII-coax leaks nothing; engine returns exactly 4 aggregate columns.';
END $ta2$;

-- ---- T-A3  cross-guest token cancel ---------------------------------------
DO $ta3$
DECLARE
  v_brand uuid := current_setting('tester.brand')::uuid;
  v_slotA timestamptz; v_resA uuid;
BEGIN
  SELECT slot_start_utc INTO v_slotA
  FROM public.pg_venue_available_slots(v_brand,(now()+interval '8 days')::date,2)
  ORDER BY slot_start_utc LIMIT 1;
  v_resA := (public.pg_create_guest_reservation(
    v_brand, v_slotA, 2, 'website','guest', NULL,
    'Guest A','+447700900101','ga@test.com', NULL,NULL,NULL,'none','TOK_A')).id;
  BEGIN
    PERFORM public.pg_cancel_guest_reservation(v_resA, 'TOK_B_WRONG');
    RAISE EXCEPTION 'T-A3 FAIL: a wrong/cross-guest token cancelled the reservation';
  EXCEPTION WHEN sqlstate 'P0002' THEN
    NULL; -- reservation_not_found = correct (no oracle)
  END;
  IF (SELECT status FROM public.reservations WHERE id=v_resA) <> 'confirmed' THEN
    RAISE EXCEPTION 'T-A3 FAIL: reservation status changed under a wrong token';
  END IF;
  RAISE NOTICE 'T-A3 PASS: cross-guest token cannot cancel another guest''s reservation.';
END $ta3$;

-- ---- T-A4  keystone fails-on-revert ---------------------------------------
DO $ta4$
DECLARE v_has boolean;
BEGIN
  REVOKE EXECUTE ON FUNCTION public.pg_venue_available_slots(uuid,date,int) FROM anon;
  SELECT EXISTS(SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
    WHERE p.proname='pg_venue_available_slots' AND a.grantee='anon'::regrole AND a.privilege_type='EXECUTE')
  INTO v_has;
  IF v_has THEN RAISE EXCEPTION 'T-A4 FAIL: anon still has engine EXECUTE after REVOKE'; END IF;
  -- restore so the txn rollback is clean either way.
  GRANT EXECUTE ON FUNCTION public.pg_venue_available_slots(uuid,date,int) TO anon;
  RAISE NOTICE 'T-A4 PASS: anon engine EXECUTE is grant-gated (fails-on-revert of the keystone).';
END $ta4$;

-- ---- T-A1  IDEMPOTENCY DEFECT (asserts the CORRECT contract → FAILS on HEAD) -
DO $ta1$
DECLARE
  v_brand uuid := current_setting('tester.brand')::uuid;
  v_slot timestamptz;
  v_n int;
BEGIN
  SELECT slot_start_utc INTO v_slot
  FROM public.pg_venue_available_slots(v_brand,(now()+interval '9 days')::date,2)
  WHERE remaining >= 2 ORDER BY slot_start_utc LIMIT 1;
  IF v_slot IS NULL THEN RAISE EXCEPTION 'T-A1 fixture: no remaining>=2 slot'; END IF;

  -- mint the SAME payment_intent_id twice (a double-fired confirm / replay / flip-fail re-confirm).
  PERFORM public.pg_create_guest_reservation(v_brand, v_slot, 2, 'website','guest', NULL,
    'Dup Buyer','+447700900201','dup@test.com', 5000,'GBP'::char(3),'pi_idem_001','paid','tokDup');
  BEGIN
    PERFORM public.pg_create_guest_reservation(v_brand, v_slot, 2, 'website','guest', NULL,
      'Dup Buyer','+447700900201','dup@test.com', 5000,'GBP'::char(3),'pi_idem_001','paid','tokDup');
  EXCEPTION WHEN OTHERS THEN
    NULL; -- a reject on the 2nd call would be the FIX (e.g. capacity exhausted or an idempotency guard)
  END;

  SELECT count(*) INTO v_n FROM public.reservations WHERE payment_intent_id='pi_idem_001';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'T-A1 FAIL (P1 DEFECT): % reservations created for ONE payment_intent_id (expected 1). The writer is not idempotent on payment_intent_id and the confirm fn has no FOR-UPDATE/early-return guard → a double-fired or replayed confirm on a remaining>=2 slot double-books one charge.', v_n;
  END IF;
  RAISE NOTICE 'T-A1 PASS: writer is idempotent on payment_intent_id (one reservation per charge).';
END $ta1$;

ROLLBACK;
