-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.2a — DEFECT-1 fix proof: idempotent fee finalize
-- ---------------------------------------------------------------------------
-- Exercises the REAL confirm flow (pg_finalize_guest_reservation), not just the
-- bare writer. Self-contained: builds an isolated reservable venue, asserts,
-- ROLLS BACK. Run: psql -v ON_ERROR_STOP=1 -f <thisfile>.
--   F-1  finalize is idempotent — same session finalized twice → ONE reservation,
--        same id both calls, session atomically linked + completed (no TOCTOU).
--   F-2  the UNIQUE partial index physically rejects a duplicate-PI insert (23505);
--   F-2b NULL payment_intent_id (free rows) is NOT constrained.
--   F-3  finalize early-returns an already-linked reservation (no second mint).
-- ===========================================================================

\set ON_ERROR_STOP on
BEGIN;
-- isolated reservable venue with TWO tables → party-2 slot has remaining=2.
DO $fix$
DECLARE v_uid uuid := gen_random_uuid(); v_brand uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id) VALUES (v_uid);
  INSERT INTO public.creator_accounts (id) VALUES (v_uid);
  INSERT INTO public.brands (id, account_id, name, slug, pricing_region, pricing_currency)
    VALUES (v_brand, v_uid, 'FIN venue', 'fin-'||replace(v_brand::text,'-',''), 'GB','GBP');
  INSERT INTO public.venue_reservation_settings
    (brand_id, reservations_enabled, fee_enabled, fee_refundable, cancel_cutoff_hours, no_show_fee_policy)
    VALUES (v_brand, true, true, true, 24, 'none');
  INSERT INTO public.venue_availability_config
    (brand_id, service_periods, turn_times, buffer_minutes, slot_granularity_minutes,
     advance_window_days, min_notice_minutes, iana_timezone, max_reservations_per_slot)
    VALUES (v_brand,'[{"start":"10:00","end":"23:00","days":["0","1","2","3","4","5","6"]}]'::jsonb,
      '{"p2":60}'::jsonb, 0, 60, 365, 0, 'UTC', NULL);
  INSERT INTO public.venue_tables (brand_id, name, capacity, min_party, max_party, reservation_policy, is_active)
    VALUES (v_brand,'A',2,1,2,'reservable',true), (v_brand,'B',2,1,2,'reservable',true);
  PERFORM set_config('fin.brand', v_brand::text, true);
END $fix$;

-- F-1: finalize is idempotent — same session finalized twice → ONE reservation,
-- same id returned both times (the early-return path, the REAL confirm flow).
DO $f1$
DECLARE
  v_brand uuid := current_setting('fin.brand')::uuid;
  v_slot timestamptz; v_sess uuid; v_r1 uuid; v_r2 uuid; v_n int; v_sess_link uuid; v_sess_status text;
BEGIN
  SELECT slot_start_utc INTO v_slot FROM public.pg_venue_available_slots(v_brand,(now()+interval '9 days')::date,2)
   WHERE remaining>=2 ORDER BY slot_start_utc LIMIT 1;
  IF v_slot IS NULL THEN RAISE EXCEPTION 'F-1 fixture: no remaining>=2 slot'; END IF;

  INSERT INTO public.reservation_checkout_sessions
    (id, brand_id, reserved_for, party_size, buyer_name, buyer_email, buyer_phone_e164,
     amount_cents, currency, stripe_payment_intent_id, stripe_account_id, created_via, status)
  VALUES (gen_random_uuid(), v_brand, v_slot, 2, 'Fee Buyer','fee@test.com','+447700900301',
     5000,'GBP','pi_fin_001','acct_test','web','pending')
  RETURNING id INTO v_sess;

  -- first finalize → mint
  SELECT (f.reservation).id INTO v_r1 FROM public.pg_finalize_guest_reservation(v_sess,'pi_fin_001') f;
  -- second finalize (double-fire / replay / flip-retry) → MUST return the same id
  SELECT (f.reservation).id INTO v_r2 FROM public.pg_finalize_guest_reservation(v_sess,'pi_fin_001') f;

  SELECT count(*) INTO v_n FROM public.reservations WHERE payment_intent_id='pi_fin_001';
  IF v_n <> 1 THEN RAISE EXCEPTION 'F-1 FAIL: % reservations for one PI (expected 1)', v_n; END IF;
  IF v_r1 IS DISTINCT FROM v_r2 THEN RAISE EXCEPTION 'F-1 FAIL: re-finalize returned a DIFFERENT id (% vs %)', v_r1, v_r2; END IF;

  SELECT reservation_id, status INTO v_sess_link, v_sess_status FROM public.reservation_checkout_sessions WHERE id=v_sess;
  IF v_sess_link <> v_r1 OR v_sess_status <> 'completed' THEN
    RAISE EXCEPTION 'F-1 FAIL: session not atomically linked/completed (link=% status=%)', v_sess_link, v_sess_status;
  END IF;
  RAISE NOTICE 'F-1 PASS: finalize idempotent — one reservation per charge, same id, session atomically linked+completed.';
END $f1$;

-- F-2: unique partial index physically rejects a duplicate-PI insert.
DO $f2$
DECLARE v_brand uuid := current_setting('fin.brand')::uuid; v_slot timestamptz;
BEGIN
  SELECT slot_start_utc INTO v_slot FROM public.pg_venue_available_slots(v_brand,(now()+interval '10 days')::date,2)
   WHERE remaining>=2 ORDER BY slot_start_utc LIMIT 1;
  INSERT INTO public.reservations (brand_id, reserved_for, party_size, status, source, created_via,
    guest_name, guest_phone_e164, guest_email, payment_intent_id, payment_status)
  VALUES (v_brand, v_slot, 2,'confirmed','website','guest','U1','+447700900401','u1@test.com','pi_dup_idx','paid');
  BEGIN
    INSERT INTO public.reservations (brand_id, reserved_for, party_size, status, source, created_via,
      guest_name, guest_phone_e164, guest_email, payment_intent_id, payment_status)
    VALUES (v_brand, v_slot, 2,'confirmed','website','guest','U2','+447700900402','u2@test.com','pi_dup_idx','paid');
    RAISE EXCEPTION 'F-2 FAIL: unique index allowed a duplicate payment_intent_id insert';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'F-2 PASS: unique partial index rejects a duplicate payment_intent_id (23505).';
  END;
  -- NULL PIs (free rows) are NOT constrained: two NULLs allowed.
  INSERT INTO public.reservations (brand_id, reserved_for, party_size, status, source, created_via,
    guest_name, guest_phone_e164, guest_email, payment_intent_id, payment_status)
  VALUES (v_brand, v_slot, 2,'confirmed','website','guest','F1','+447700900403','f1@test.com',NULL,'none'),
         (v_brand, v_slot, 2,'confirmed','website','guest','F2','+447700900404','f2@test.com',NULL,'none');
  RAISE NOTICE 'F-2b PASS: NULL payment_intent_id (free rows) not constrained by the partial index.';
END $f2$;

-- F-3: finalize early-returns the existing row if it was minted out-of-band and
-- linked to the session (the prior-confirm-won path) — no second mint.
DO $f3$
DECLARE v_brand uuid := current_setting('fin.brand')::uuid; v_slot timestamptz; v_sess uuid; v_pre uuid; v_ret uuid; v_n int;
BEGIN
  SELECT slot_start_utc INTO v_slot FROM public.pg_venue_available_slots(v_brand,(now()+interval '11 days')::date,2)
   WHERE remaining>=2 ORDER BY slot_start_utc LIMIT 1;
  v_pre := (public.pg_create_guest_reservation(v_brand, v_slot, 2,'website','guest',NULL,
    'Pre','+447700900501','pre@test.com',5000,'GBP'::char(3),'pi_fin_pre','paid','tokPre')).id;
  INSERT INTO public.reservation_checkout_sessions
    (id, brand_id, reserved_for, party_size, buyer_name, buyer_email, buyer_phone_e164,
     amount_cents, currency, stripe_payment_intent_id, stripe_account_id, created_via, status, reservation_id)
  VALUES (gen_random_uuid(), v_brand, v_slot, 2,'Pre','pre@test.com','+447700900501',
     5000,'GBP','pi_fin_pre','acct_test','web','completed', v_pre) RETURNING id INTO v_sess;
  SELECT (f.reservation).id INTO v_ret FROM public.pg_finalize_guest_reservation(v_sess,'pi_fin_pre') f;
  IF v_ret <> v_pre THEN RAISE EXCEPTION 'F-3 FAIL: finalize did not early-return the linked reservation'; END IF;
  SELECT count(*) INTO v_n FROM public.reservations WHERE payment_intent_id='pi_fin_pre';
  IF v_n <> 1 THEN RAISE EXCEPTION 'F-3 FAIL: % rows for one PI after early-return', v_n; END IF;
  RAISE NOTICE 'F-3 PASS: finalize early-returns the already-linked reservation (no second mint).';
END $f3$;

ROLLBACK;
