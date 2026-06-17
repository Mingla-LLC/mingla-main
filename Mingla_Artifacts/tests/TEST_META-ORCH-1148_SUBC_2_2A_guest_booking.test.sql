-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.2a — BACKEND behavioral test harness (live)
-- ---------------------------------------------------------------------------
-- Proves the 2.2a guest-booking backend LIVE against a real Postgres 17.4.1
-- with the FULL migration chain applied. Self-contained: builds an isolated
-- reservable venue inside a txn and ROLLS BACK. Each C-xx RAISEs on a wrong
-- answer (fails-on-revert). Run: psql -v ON_ERROR_STOP=1 -f <thisfile>.
--
-- C-01  the engine is now ANON-EXECUTE-able (SET ROLE anon) AND returns the 4
--       aggregate columns (SC-1/SC-2).
-- C-02  the turn-time helper stays anon-DENIED (definer-rights only).
-- C-03  anon reads NO ROWS from reservations (RLS deny-by-default; the inert
--       table grant does not expose rows).
-- C-04  the guest writer creates a brand-scoped CONFIRMED reservation for a
--       valid slot, source/created_via correct, place_pool linked (SC-3).
-- C-05  slot re-validation REJECTS a reserved_for not emitted by the engine
--       (fabricated/stale slot) → slot_unavailable (SC-8).
-- C-06  double-book: fill the last seat of a slot, then a second guest write
--       for the SAME slot → slot_unavailable (SC-8 capacity at write time).
-- C-07  capacity: a party no table can seat → engine emits no slot → the guest
--       write for that instant → slot_unavailable (SC-9 party_fit).
-- C-08  deposit_threshold on a free write → deposit_required (SC-9).
-- C-09  a PAID write for a deposit party SUCCEEDS (payment_status='paid').
-- C-10  consumer-own-read RLS: user A sees only their own reservation, not B's
--       (SC-15).
-- C-11  cancel-before-cutoff via pg_cancel_guest_reservation: status →
--       cancelled_by_guest, refund_eligible reflects paid+refundable+before
--       cutoff; wrong token → reservation_not_found (SC-13).
-- C-12  the FEE-session table accepts a pending row + flips to completed.
-- ===========================================================================

\set ON_ERROR_STOP on
BEGIN;

DO $t$
DECLARE
  v_account uuid;
  v_uid_a   uuid := gen_random_uuid();
  v_uid_b   uuid := gen_random_uuid();
  v_brand   uuid := gen_random_uuid();
  v_pp      uuid := gen_random_uuid();
  v_t4      uuid := gen_random_uuid();
  v_wed     date;
  v_slot_utc timestamptz;
  v_label   text;
  v_rem     int;
  v_cnt     int;
  v_row     public.reservations;
  v_res_a   uuid;
  v_res_b   uuid;
  v_tok     text := 'tok-' || gen_random_uuid()::text;
  v_refund  boolean;
  v_sess    uuid := gen_random_uuid();
  v_ok      boolean;
BEGIN
  -- Fixture: a creator account (needs an auth.users row) + a reservable venue.
  INSERT INTO auth.users (id, instance_id, aud, role, email)
  VALUES (v_uid_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@probe.test'),
         (v_uid_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@probe.test');
  INSERT INTO public.creator_accounts (id) VALUES (v_uid_a);
  v_account := v_uid_a;

  INSERT INTO public.place_pool (id, google_place_id, name, lat, lng, utc_offset_minutes, country)
  VALUES (v_pp, 'gp-' || substr(v_pp::text,1,8), 'Probe Venue', 51.5, -0.12, 0, 'GB');

  INSERT INTO public.brands (id, account_id, name, slug, pricing_region, pricing_currency)
  VALUES (v_brand, v_account, 'Probe Brand', 'probe-' || substr(v_brand::text,1,8), 'GB', 'GBP');

  INSERT INTO public.venue_reservation_settings (brand_id, place_pool_id, reservations_enabled, cancel_cutoff_hours, fee_refundable)
  VALUES (v_brand, v_pp, true, 24, true);

  -- Dinner every day 17:00–21:00 UTC. turn p2=60,p4=120. buffer 0. cap 1
  -- (so the single table = 1 seat per slot). granularity 60. advance 365.
  INSERT INTO public.venue_availability_config
    (brand_id, place_pool_id, service_periods, turn_times, buffer_minutes,
     max_reservations_per_slot, slot_granularity_minutes, advance_window_days, min_notice_minutes, iana_timezone)
  VALUES (v_brand, v_pp,
    jsonb_build_array(jsonb_build_object('name','Dinner','days',jsonb_build_array(0,1,2,3,4,5,6),'start','17:00','end','21:00')),
    '{"p2":60,"p4":120}'::jsonb, 0, 1, 60, 365, 0, 'UTC');

  -- one reservable table seating 1..4.
  INSERT INTO public.venue_tables (id, brand_id, name, capacity, min_party, max_party, reservation_policy, is_active, zone)
  VALUES (v_t4, v_brand, 'T4', 4, 1, 4, 'reservable', true, 'indoor');

  -- pick a slot 3 days out at 18:00 UTC.
  v_wed := (now() + interval '3 days')::date;
  v_slot_utc := (v_wed::timestamp + interval '18 hours');

  -- ===================== C-01: engine is anon-EXECUTE-able ===================
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_cnt FROM public.pg_venue_available_slots(v_brand, v_wed, 2);
  IF v_cnt < 1 THEN
    RAISE EXCEPTION 'C-01 FAIL: anon must be able to call the engine and get slots; got %', v_cnt;
  END IF;
  -- the return shape exposes the 4 aggregate cols (selectable, no error).
  PERFORM slot_start_utc, slot_local_label, remaining, is_full
    FROM public.pg_venue_available_slots(v_brand, v_wed, 2) LIMIT 1;
  RESET ROLE;
  RAISE NOTICE 'C-01 PASS: anon can call the engine + read the 4 aggregate columns';

  -- ===================== C-02: helper stays anon-DENIED ======================
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.pg_venue_turn_minutes_for_party('{"p2":60}'::jsonb, 2);
    RESET ROLE;
    RAISE EXCEPTION 'C-02 FAIL: anon must NOT be able to call the turn-time helper';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    RAISE NOTICE 'C-02 PASS: turn-time helper is anon-denied (definer-rights only)';
  END;

  -- ===================== C-03: anon reads no reservation rows ================
  INSERT INTO public.reservations (brand_id, reserved_for, party_size, status, source, created_via, guest_name)
  VALUES (v_brand, v_slot_utc, 2, 'confirmed', 'phone', 'operator', 'Secret');
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_cnt FROM public.reservations;
  RESET ROLE;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'C-03 FAIL: anon must read 0 reservation rows (RLS); got %', v_cnt;
  END IF;
  RAISE NOTICE 'C-03 PASS: anon reads 0 reservation rows (RLS deny-by-default)';
  -- clean that operator row so the cap-1 slot is free again for C-04.
  DELETE FROM public.reservations WHERE brand_id = v_brand;

  -- ===================== C-04: guest writer creates a brand-scoped row =======
  v_row := public.pg_create_guest_reservation(
    v_brand, v_slot_utc, 2, 'website', 'guest', NULL,
    'Jane Guest', '+447700900000', 'jane@probe.test',
    NULL, NULL, NULL, 'none', v_tok, NULL, NULL, 'confirmed');
  IF v_row.id IS NULL OR v_row.status <> 'confirmed' OR v_row.source <> 'website'
     OR v_row.created_via <> 'guest' OR v_row.brand_id <> v_brand
     OR v_row.place_pool_id <> v_pp OR v_row.guest_cancel_token <> v_tok THEN
    RAISE EXCEPTION 'C-04 FAIL: guest writer produced a wrong row: %', row_to_json(v_row);
  END IF;
  v_res_a := v_row.id;
  RAISE NOTICE 'C-04 PASS: guest writer created a brand-scoped confirmed reservation';

  -- ===================== C-05: fabricated/stale slot rejected ================
  BEGIN
    PERFORM public.pg_create_guest_reservation(
      v_brand, (v_wed::timestamp + interval '14 hours'), 2, 'website', 'guest', NULL,
      'Mallory', '+447700900001', 'm@probe.test', NULL, NULL, NULL, 'none', 'tok2', NULL, NULL, 'confirmed');
    RAISE EXCEPTION 'C-05 FAIL: a reserved_for not emitted by the engine must be rejected';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM NOT LIKE '%slot_unavailable%' THEN RAISE; END IF;
    RAISE NOTICE 'C-05 PASS: fabricated slot → slot_unavailable';
  END;

  -- ===================== C-06: double-book the last seat =====================
  -- C-04 already filled the cap-1 18:00 slot. A second write for 18:00 → reject.
  BEGIN
    PERFORM public.pg_create_guest_reservation(
      v_brand, v_slot_utc, 2, 'website', 'guest', NULL,
      'Racer', '+447700900002', 'r@probe.test', NULL, NULL, NULL, 'none', 'tok3', NULL, NULL, 'confirmed');
    RAISE EXCEPTION 'C-06 FAIL: a second write for the full slot must be rejected (double-book)';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM NOT LIKE '%slot_unavailable%' THEN RAISE; END IF;
    RAISE NOTICE 'C-06 PASS: last-seat double-book → slot_unavailable';
  END;

  -- ===================== C-07: party no table can seat =======================
  BEGIN
    PERFORM public.pg_create_guest_reservation(
      v_brand, (v_wed::timestamp + interval '19 hours'), 9, 'website', 'guest', NULL,
      'BigParty', '+447700900003', 'big@probe.test', NULL, NULL, NULL, 'none', 'tok4', NULL, NULL, 'confirmed');
    RAISE EXCEPTION 'C-07 FAIL: a party larger than any table must be rejected (no slot)';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM NOT LIKE '%slot_unavailable%' THEN RAISE; END IF;
    RAISE NOTICE 'C-07 PASS: oversize party → no slot → slot_unavailable (party_fit)';
  END;

  -- ===================== C-08/C-09: deposit_threshold ========================
  INSERT INTO public.venue_capacity_rules (brand_id, kind, params, is_active)
  VALUES (v_brand, 'deposit_threshold', '{"min_party_for_fee": 2, "fee_cents": 2000}'::jsonb, true);
  -- a FREE write for a party-2 19:00 slot (open) must be rejected.
  BEGIN
    PERFORM public.pg_create_guest_reservation(
      v_brand, (v_wed::timestamp + interval '19 hours'), 2, 'website', 'guest', NULL,
      'NoDeposit', '+447700900004', 'nd@probe.test', NULL, NULL, NULL, 'none', 'tok5', NULL, NULL, 'confirmed');
    RAISE EXCEPTION 'C-08 FAIL: a free write for a deposit-required party must be rejected';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM NOT LIKE '%deposit_required%' THEN RAISE; END IF;
    RAISE NOTICE 'C-08 PASS: free write for deposit party → deposit_required';
  END;
  -- a PAID write for the same party-2 19:00 slot SUCCEEDS.
  v_row := public.pg_create_guest_reservation(
    v_brand, (v_wed::timestamp + interval '19 hours'), 2, 'website', 'guest', NULL,
    'Paid', '+447700900005', 'paid@probe.test',
    2150, 'GBP', 'pi_test_123', 'paid', 'tok6', NULL, NULL, 'confirmed');
  IF v_row.payment_status <> 'paid' OR v_row.fee_cents <> 2150 THEN
    RAISE EXCEPTION 'C-09 FAIL: paid deposit write should persist fee/paid: %', row_to_json(v_row);
  END IF;
  RAISE NOTICE 'C-09 PASS: paid deposit write succeeds (payment_status=paid)';

  -- ===================== C-10: consumer-own-read RLS =========================
  -- a DIFFERENT day (4 days out) so this booking is independent of the day-3
  -- bookings above (cap-1 single table). 18:00 party-1 turn=120 → window
  -- [18:00,20:00), a valid candidate on the fresh day.
  v_res_b := (public.pg_create_guest_reservation(
    v_brand, ((now() + interval '4 days')::date::timestamp + interval '18 hours'), 1,
    'mingla', 'consumer', v_uid_b,
    'B User', '+447700900006', 'b@probe.test', NULL, NULL, NULL, 'none', NULL, NULL, NULL, 'confirmed')).id;
  -- attribute v_res_a to user A as a consumer row for the RLS test. User B is
  -- NOT a brand member (the brand owner is user A), so B is gated PURELY by the
  -- consumer-own-read policy → B sees ONLY v_res_b, never A's v_res_a.
  UPDATE public.reservations SET consumer_user_id = v_uid_a WHERE id = v_res_a;
  -- simulate user B's JWT context. auth.uid() reads request.jwt.claim.sub.
  PERFORM set_config('request.jwt.claim.sub', v_uid_b::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_cnt FROM public.reservations WHERE id IN (v_res_a, v_res_b);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'C-10 FAIL: user B (non-member) must see ONLY their own reservation via RLS; saw %', v_cnt;
  END IF;
  RAISE NOTICE 'C-10 PASS: consumer-own-read RLS scopes to auth.uid() (non-member sees only own)';

  -- ===================== C-11: cancel-before-cutoff + token ==================
  SELECT cgr.refund_eligible INTO v_refund
  FROM public.pg_cancel_guest_reservation(v_res_a, v_tok) cgr;
  SELECT status INTO v_label FROM public.reservations WHERE id = v_res_a;
  IF v_label <> 'cancelled_by_guest' THEN
    RAISE EXCEPTION 'C-11 FAIL: cancel must set status cancelled_by_guest; got %', v_label;
  END IF;
  -- v_res_a was a FREE (payment_status none) row → refund not eligible.
  IF v_refund THEN
    RAISE EXCEPTION 'C-11 FAIL: a free reservation cancel must NOT be refund-eligible';
  END IF;
  RAISE NOTICE 'C-11 PASS: cancel-by-token → cancelled_by_guest (free → not refund-eligible)';
  -- wrong token → reservation_not_found.
  BEGIN
    PERFORM public.pg_cancel_guest_reservation(v_res_b, 'WRONG-TOKEN');
    RAISE EXCEPTION 'C-11b FAIL: a wrong cancel token must be rejected';
  EXCEPTION WHEN sqlstate 'P0002' THEN
    RAISE NOTICE 'C-11b PASS: wrong cancel token → reservation_not_found';
  END;

  -- ===================== C-12: reservation_checkout_sessions =================
  INSERT INTO public.reservation_checkout_sessions
    (id, brand_id, reserved_for, party_size, buyer_name, buyer_email, buyer_phone_e164,
     amount_cents, currency, created_via, status, buyer_status_token_hash)
  VALUES (v_sess, v_brand, (v_wed::timestamp + interval '18 hours'), 2, 'Fee Buyer',
          'fee@probe.test', '+447700900007', 2150, 'GBP', 'web', 'pending', 'hash123');
  SELECT EXISTS (SELECT 1 FROM public.reservation_checkout_sessions WHERE id=v_sess AND status='pending') INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'C-12 FAIL: pending fee session not inserted'; END IF;
  UPDATE public.reservation_checkout_sessions
    SET status='completed', reservation_id=v_res_b WHERE id=v_sess;
  SELECT EXISTS (SELECT 1 FROM public.reservation_checkout_sessions WHERE id=v_sess AND status='completed' AND reservation_id=v_res_b) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'C-12 FAIL: fee session did not flip to completed+linked'; END IF;
  -- anon reads no session rows (deny-by-default).
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_cnt FROM public.reservation_checkout_sessions;
  RESET ROLE;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'C-12 FAIL: anon must read 0 fee-session rows; got %', v_cnt; END IF;
  RAISE NOTICE 'C-12 PASS: fee-session pending→completed+linked, anon-unreadable';

  RAISE NOTICE '=== ALL 2.2a BACKEND TESTS PASSED (C-01..C-12) ===';
END;
$t$;

ROLLBACK;
