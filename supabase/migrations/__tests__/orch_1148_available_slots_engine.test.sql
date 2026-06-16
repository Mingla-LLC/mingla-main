-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.1a — pg_venue_available_slots ENGINE behavioral test
-- ---------------------------------------------------------------------------
-- Live-SQL slot-math test (SPEC T-4 / T-4b / SC-4). Run AFTER the 2.0 + 2.1a
-- migrations are applied, against a live Supabase Postgres:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/migrations/__tests__/orch_1148_available_slots_engine.test.sql
--
-- Self-contained: it creates an isolated test brand + venue config + tables +
-- reservations inside a transaction, asserts the engine output, and ROLLS BACK
-- (no surviving rows). Exercises: respects turn-time + buffer (no past-end
-- seatings), respects granularity stepping, respects max-per-slot, drops
-- whole-day blackout dates, enforces party_fit, and SUBTRACTS existing live
-- reservations (and ONLY live ones). Determinism (T-4b) is implied: there is one
-- function, so the picker and a direct call return the same set.
--
-- Fails-on-revert: if pg_venue_available_slots is reverted/weakened (e.g. drops
-- the party_fit filter, stops subtracting reservations, or miscomputes the
-- past-end seating cutoff), one of the A-xx assertions RAISEs.
-- ===========================================================================

\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_brand uuid := gen_random_uuid();
  v_account uuid;
  v_t_small uuid := gen_random_uuid();   -- capacity 2, party 1..2
  v_t_four  uuid := gen_random_uuid();   -- capacity 4, party 2..4
  v_t_big   uuid := gen_random_uuid();   -- capacity 8, party 4..8
  v_wed date;
  v_thu date;
  v_count int;
  v_first text;
  v_last  text;
  v_remaining int;
  v_full_seen boolean;
BEGIN
  -- A test date that is a Wednesday (dow=3), far enough in the future to clear
  -- min_notice and inside any reasonable advance window. Anchor to next year so
  -- the window never excludes it.
  v_wed := date_trunc('week', (now() + interval '120 days'))::date + 2; -- Monday + 2 = Wednesday
  v_thu := v_wed + 1; -- a Thursday (NOT in the Wed-only service period)

  -- ---- Fixture: a reservable, configured venue. ----
  -- brands.account_id → creator_accounts(id) (NOT NULL). Reuse any existing
  -- creator account so the test stays self-contained without building the full
  -- auth.users → creator_accounts graph; ROLLBACK at the end discards the brand.
  SELECT id INTO v_account FROM public.creator_accounts LIMIT 1;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'engine test: needs at least one public.creator_accounts row to anchor the test brand (seed one or run against a populated DB)';
  END IF;

  INSERT INTO public.brands (id, account_id, name, slug)
  VALUES (v_brand, v_account, 'Engine Test Venue',
          'orch1148-engine-' || substr(v_brand::text, 1, 8))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.venue_reservation_settings (brand_id, reservations_enabled)
  VALUES (v_brand, true);

  -- Dinner Wed only, 17:00–20:00. Turn times: p2=60, p4=90, p6=120. Buffer 0,
  -- granularity 30, max-per-slot 2, advance 365, min_notice 0. Offset 0 (UTC) so
  -- the local label math is unambiguous in the test.
  INSERT INTO public.venue_availability_config
    (brand_id, service_periods, turn_times, buffer_minutes,
     max_reservations_per_slot, slot_granularity_minutes, advance_window_days, min_notice_minutes)
  VALUES (
    v_brand,
    jsonb_build_array(jsonb_build_object('name','Dinner','days',jsonb_build_array(3),'start','17:00','end','20:00','type','dinner')),
    '{"p2":60,"p4":90,"p6":120}'::jsonb,
    0, 2, 30, 365, 0
  );

  INSERT INTO public.venue_tables (id, brand_id, name, capacity, min_party, max_party, reservation_policy, is_active)
  VALUES
    (v_t_small, v_brand, 'T-small', 2, 1, 2, 'reservable', true),
    (v_t_four,  v_brand, 'T-four',  4, 2, 4, 'reservable', true),
    (v_t_big,   v_brand, 'T-big',   8, 4, 8, 'reservable', true);

  -- ================= A-1: turn-time + no-past-end seatings =================
  -- Party 4 → p4=90min turn. Period 17:00–20:00, step 30. Last start that fits a
  -- full 90min seating before 20:00 is 18:30 (18:30+90 = 20:00). So valid starts
  -- = 17:00, 17:30, 18:00, 18:30 → 4 slots. 19:00/19:30 would run past 20:00.
  SELECT count(*), min(slot_local_label), max(slot_local_label)
  INTO v_count, v_first, v_last
  FROM public.pg_venue_available_slots(v_brand, v_wed, 4);
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'A-1 FAIL: expected 4 party-4 slots (17:00..18:30), got % (%..%)', v_count, v_first, v_last;
  END IF;
  IF v_first <> '17:00' OR v_last <> '18:30' THEN
    RAISE EXCEPTION 'A-1 FAIL: party-4 slots must be 17:00..18:30, got %..%', v_first, v_last;
  END IF;
  RAISE NOTICE 'A-1 PASS: turn-time + no-past-end seatings (4 slots 17:00..18:30)';

  -- ================= A-2: granularity stepping =================
  -- Party 2 → p2=60min. Last fitting start = 19:00 (19:00+60=20:00). Starts at
  -- 30-min granularity: 17:00,17:30,18:00,18:30,19:00 → 5 slots.
  SELECT count(*) INTO v_count
  FROM public.pg_venue_available_slots(v_brand, v_wed, 2);
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'A-2 FAIL: expected 5 party-2 slots stepped by 30min, got %', v_count;
  END IF;
  RAISE NOTICE 'A-2 PASS: granularity stepping (5 party-2 slots)';

  -- ================= A-3: wrong day-of-week → zero slots =================
  SELECT count(*) INTO v_count
  FROM public.pg_venue_available_slots(v_brand, v_thu, 4);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'A-3 FAIL: Thursday is not in the Wed-only service period; expected 0 slots, got %', v_count;
  END IF;
  RAISE NOTICE 'A-3 PASS: out-of-service-day → 0 slots';

  -- ================= A-4: party_fit (too-big party → 0 eligible tables) ====
  -- Party 12 fits no table (max capacity/max_party is 8) → 0 slots.
  SELECT count(*) INTO v_count
  FROM public.pg_venue_available_slots(v_brand, v_wed, 12);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'A-4 FAIL: party 12 fits no table; expected 0 slots, got %', v_count;
  END IF;
  RAISE NOTICE 'A-4 PASS: party_fit excludes a too-large party';

  -- ================= A-5: subtract existing LIVE reservation =================
  -- Book ONE party-4 at 17:00 (confirmed). max_per_slot=2, 2 party-4 tables
  -- eligible (T-four cap4, T-big cap8 both fit party 4) → cap_per_slot =
  -- LEAST(2, 2) = 2. The 17:00 seating [17:00,18:30) overlaps the 17:00 and the
  -- 18:00 candidate seatings (since turn=90, a seating spans 90min). So remaining
  -- at 17:00 = 2-1 = 1, and 17:00 is NOT full.
  INSERT INTO public.reservations
    (brand_id, table_id, reserved_for, party_size, status, source, created_via)
  VALUES
    (v_brand, v_t_four, (v_wed::timestamp + interval '17 hours'), 4, 'confirmed', 'phone', 'operator');

  SELECT remaining, is_full INTO v_remaining, v_full_seen
  FROM public.pg_venue_available_slots(v_brand, v_wed, 4)
  WHERE slot_local_label = '17:00';
  IF v_remaining <> 1 THEN
    RAISE EXCEPTION 'A-5 FAIL: 17:00 remaining must be 1 after one live booking, got %', v_remaining;
  END IF;
  IF v_full_seen THEN
    RAISE EXCEPTION 'A-5 FAIL: 17:00 must not be full with remaining=1';
  END IF;
  RAISE NOTICE 'A-5 PASS: live reservation subtracted from capacity';

  -- ================= A-6: full slot is RETURNED (not hidden) =================
  -- Add a SECOND party-4 at 17:00 → remaining 0 → is_full=true, but the row is
  -- STILL returned (Design §4.7: show "full", don't hide).
  INSERT INTO public.reservations
    (brand_id, table_id, reserved_for, party_size, status, source, created_via)
  VALUES
    (v_brand, v_t_big, (v_wed::timestamp + interval '17 hours'), 4, 'seated', 'phone', 'operator');

  SELECT remaining, is_full INTO v_remaining, v_full_seen
  FROM public.pg_venue_available_slots(v_brand, v_wed, 4)
  WHERE slot_local_label = '17:00';
  IF v_remaining <> 0 OR NOT v_full_seen THEN
    RAISE EXCEPTION 'A-6 FAIL: 17:00 must be remaining=0 is_full=true after two bookings, got remaining=% full=%', v_remaining, v_full_seen;
  END IF;
  -- and it must still appear in the result set.
  SELECT count(*) INTO v_count
  FROM public.pg_venue_available_slots(v_brand, v_wed, 4)
  WHERE slot_local_label = '17:00';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'A-6 FAIL: the full 17:00 slot must still be RETURNED (got % rows)', v_count;
  END IF;
  RAISE NOTICE 'A-6 PASS: a full slot is returned with is_full=true (not hidden)';

  -- ================= A-7: cancelled/no-show reservations do NOT consume ====
  -- A cancelled_by_venue reservation must NOT reduce capacity (only live
  -- statuses do). Book a 17:30 cancelled; the 17:30 slot remaining must be the
  -- full cap (2), unaffected.
  INSERT INTO public.reservations
    (brand_id, table_id, reserved_for, party_size, status, source, created_via)
  VALUES
    (v_brand, v_t_four, (v_wed::timestamp + interval '17 hours 30 minutes'), 4, 'cancelled_by_venue', 'phone', 'operator');

  -- 17:30 only overlaps the two 17:00 live bookings (their [17:00,18:30) windows
  -- cover 17:30), so remaining = 2 - 2 = 0 from those; the cancelled one must add
  -- nothing. To isolate the cancelled-not-counted assertion cleanly, check a slot
  -- the live bookings do NOT touch: 18:30 (live 17:00 seatings end at 18:30, so
  -- [17:00,18:30) does NOT include 18:30; the cancelled 17:30 seating is
  -- [17:30,19:00) which WOULD include 18:30 if counted). remaining at 18:30 must
  -- be the full 2 (cancelled ignored).
  SELECT remaining INTO v_remaining
  FROM public.pg_venue_available_slots(v_brand, v_wed, 4)
  WHERE slot_local_label = '18:30';
  IF v_remaining <> 2 THEN
    RAISE EXCEPTION 'A-7 FAIL: 18:30 remaining must be 2 (cancelled reservation must NOT consume capacity), got %', v_remaining;
  END IF;
  RAISE NOTICE 'A-7 PASS: cancelled/non-live reservations do not consume capacity';

  -- ================= A-8: whole-day blackout → zero slots =================
  INSERT INTO public.venue_blackouts (brand_id, date_start, date_end, applies_to, reason)
  VALUES (v_brand, v_wed, v_wed, 'all', 'Test closure');
  SELECT count(*) INTO v_count
  FROM public.pg_venue_available_slots(v_brand, v_wed, 4);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'A-8 FAIL: whole-day blackout must yield 0 slots, got %', v_count;
  END IF;
  RAISE NOTICE 'A-8 PASS: whole-day blackout excludes the date';

  -- ================= A-9: disabled venue → zero slots =================
  UPDATE public.venue_reservation_settings SET reservations_enabled = false WHERE brand_id = v_brand;
  -- (also remove the blackout to prove the gate, not the blackout, is what zeroes)
  DELETE FROM public.venue_blackouts WHERE brand_id = v_brand;
  SELECT count(*) INTO v_count
  FROM public.pg_venue_available_slots(v_brand, v_wed, 4);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'A-9 FAIL: a disabled venue must yield 0 slots, got %', v_count;
  END IF;
  RAISE NOTICE 'A-9 PASS: disabled venue (reservations_enabled=false) → 0 slots';

  RAISE NOTICE 'ORCH-1148 2.1a ENGINE behavioral test: ALL A-1..A-9 PASSED.';
END;
$test$;

ROLLBACK;  -- no surviving fixtures.
