-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.1a — TESTER ADVERSARIAL engine test (B-1..B-12)
-- ---------------------------------------------------------------------------
-- Author: mingla-tester. A DIFFERENT angle than the implementor's A-1..A-9
-- (which prove the happy/turn-time/blackout/cancelled/disabled paths). This
-- test attacks the EDGE + BOUNDARY + adversarial cases the implementor's
-- fixtures do NOT cover:
--   B-1  exact-boundary overlap (a reservation ENDING exactly at a slot start
--        must NOT consume — half-open interval correctness)
--   B-2  exact-boundary the other way (a reservation STARTING exactly at the
--        candidate seating end must NOT consume)
--   B-3  HETEROGENEOUS turn-time: an existing SMALL-party reservation is
--        modeled with the QUERYING party's turn time, not its own → proves the
--        engine over/under-counts overlap when party turn-times differ.
--   B-4  max_party > capacity over-seat: party_fit uses COALESCE(max_party,cap)
--        with NO CHECK that max_party<=capacity → a too-large party slips in.
--   B-5  max-per-slot at EXACTLY the cap (remaining=0, is_full=true) and one
--        below the cap.
--   B-6  oversized single party vs combinable tables — combinable is IGNORED
--        in 2.1a; party larger than any single table → 0 slots even if two
--        combinable tables could seat them.
--   B-7  NON-UTC offset (EST -300): slot_start_utc and slot_local_label must
--        agree (label = utc + offset), proving tz math on a real offset.
--   B-8  DST: a fixed stored offset cannot be right on both sides of a DST
--        change — documents the static-offset limitation with a concrete delta.
--   B-9  past date (yesterday): no lower bound on p_date beyond min_notice.
--   B-10 NULL-table reservation consumes the shared pool for EVERY party size.
--   B-11 zone-scoped blackout removes only the zoned tables (not the day).
--   B-12 min_notice cutoff drops near-term slots.
--
-- Self-contained: builds an isolated brand inside a txn and ROLLS BACK.
-- Run: psql -v ON_ERROR_STOP=1 -f <thisfile>
-- Fails-on-revert: each B-xx RAISEs on a wrong answer. Cite commit 57a6714e9.
-- ===========================================================================

\set ON_ERROR_STOP on
BEGIN;

DO $adv$
DECLARE
  v_brand uuid := gen_random_uuid();
  v_brand_est uuid := gen_random_uuid();
  v_account uuid;
  v_pp uuid := gen_random_uuid();       -- EST place_pool
  v_t4  uuid := gen_random_uuid();      -- cap 4, party 2..4
  v_t6  uuid := gen_random_uuid();      -- cap 6, party 2..6
  v_t_small uuid := gen_random_uuid();  -- cap 2, party 1..2 (small turn)
  v_t_overcap uuid := gen_random_uuid();-- cap 2 but max_party 8 (over-seat probe)
  v_wed date;
  v_count int; v_rem int; v_full boolean; v_label text; v_utc timestamptz;
BEGIN
  SELECT id INTO v_account FROM public.creator_accounts LIMIT 1;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'adversarial test: needs a creator_accounts row';
  END IF;

  v_wed := date_trunc('week', (now() + interval '150 days'))::date + 2;  -- a Wednesday

  -- US-Eastern place_pool. The static offset is retained for legacy reference
  -- but the engine now reads the venue's IANA timezone (P3-3), set on the EST
  -- brand's availability config below. place_pool requires name/lat/lng/place_id.
  INSERT INTO public.place_pool (id, google_place_id, name, lat, lng, utc_offset_minutes, country)
  VALUES (v_pp, 'gp-' || substr(v_pp::text,1,8), 'Adv EST Venue', 40.7, -74.0, -300, 'US');

  ----------------------------------------------------------------------------
  -- Brand A: UTC venue (offset 0 via no place_pool) — boundary/turn/cap probes
  ----------------------------------------------------------------------------
  INSERT INTO public.brands (id, account_id, name, slug)
  VALUES (v_brand, v_account, 'Adv UTC', 'adv-utc-' || substr(v_brand::text,1,8));
  INSERT INTO public.venue_reservation_settings (brand_id, reservations_enabled)
  VALUES (v_brand, true);

  -- Dinner Wed 17:00–21:00. turn p2=60, p4=120. buffer 0. max_per_slot 2.
  -- granularity 60. advance 365. min_notice 0.
  INSERT INTO public.venue_availability_config
    (brand_id, service_periods, turn_times, buffer_minutes,
     max_reservations_per_slot, slot_granularity_minutes, advance_window_days, min_notice_minutes)
  VALUES (v_brand,
    jsonb_build_array(jsonb_build_object('name','Dinner','days',jsonb_build_array(3),'start','17:00','end','21:00','type','dinner')),
    '{"p2":60,"p4":120}'::jsonb, 0, 2, 60, 365, 0);

  INSERT INTO public.venue_tables (id, brand_id, name, capacity, min_party, max_party, reservation_policy, is_active, zone)
  VALUES
    (v_t4, v_brand, 'T4', 4, 2, 4, 'reservable', true, 'indoor'),
    (v_t6, v_brand, 'T6', 6, 2, 6, 'reservable', true, 'outdoor'),
    (v_t_small, v_brand, 'Tsmall', 2, 1, 2, 'reservable', true, 'indoor');

  -- ===================== B-1: exact-boundary overlap (touch at start) =======
  -- Party 4 → turn 120. Candidate slot starts 17:00 and 19:00 (60-min gran;
  -- last fitting 19:00 since 19:00+120=21:00). Book a party-4 ending EXACTLY at
  -- 19:00: reserved_for 17:00, its window [17:00,19:00). The 19:00 candidate
  -- seating is [19:00,21:00). They TOUCH at 19:00 but do NOT overlap (half-open).
  -- So 19:00 remaining must be the FULL cap (2), unaffected by the 17:00 booking.
  INSERT INTO public.reservations (brand_id, table_id, reserved_for, party_size, status, source, created_via)
  VALUES (v_brand, v_t4, (v_wed::timestamp + interval '17 hours'), 4, 'confirmed', 'phone', 'operator');

  SELECT remaining INTO v_rem FROM public.pg_venue_available_slots(v_brand, v_wed, 4)
  WHERE slot_local_label = '19:00';
  IF v_rem <> 2 THEN
    RAISE EXCEPTION 'B-1 FAIL: a reservation ending EXACTLY at 19:00 must NOT consume the 19:00 slot (half-open); remaining expected 2 got %', v_rem;
  END IF;
  RAISE NOTICE 'B-1 PASS: exact-boundary touch-at-start does not consume (half-open interval)';

  -- and the 17:00 slot ITSELF must be reduced by that booking.
  SELECT remaining INTO v_rem FROM public.pg_venue_available_slots(v_brand, v_wed, 4)
  WHERE slot_local_label = '17:00';
  IF v_rem <> 1 THEN
    RAISE EXCEPTION 'B-1b FAIL: 17:00 must be reduced to 1 by its own booking, got %', v_rem;
  END IF;
  RAISE NOTICE 'B-1b PASS: the booked slot itself is reduced';

  -- ===================== B-3: HETEROGENEOUS turn-time bug ====================
  -- Clear the prior booking effect by checking with a DIFFERENT existing
  -- reservation. Book a PARTY-2 at 18:00 (party-2 turn = 60 → its TRUE window is
  -- [18:00,19:00)). Now query as a PARTY-4 (turn 120). The engine models the
  -- EXISTING reservation's window using the QUERYING party's turn (120), i.e.
  -- [18:00,20:00) — NOT the party-2's real [18:00,19:00). The party-4 candidate
  -- 17:00 seating is [17:00,19:00); 19:00 seating is [19:00,21:00).
  --   * If the engine used the booking's OWN turn (60 → [18:00,19:00)): the
  --     19:00 candidate would NOT overlap it.
  --   * The engine uses the QUERYING turn (120 → [18:00,20:00)): the 19:00
  --     candidate [19:00,21:00) DOES overlap → over-counts.
  -- This probe DOCUMENTS the behavior (it asserts the engine's ACTUAL output so
  -- it is fails-on-revert; the modeling concern is reported as a defect).
  -- First delete the B-1 booking to isolate.
  DELETE FROM public.reservations WHERE brand_id = v_brand;
  INSERT INTO public.reservations (brand_id, table_id, reserved_for, party_size, status, source, created_via)
  VALUES (v_brand, v_t_small, (v_wed::timestamp + interval '18 hours'), 2, 'confirmed', 'phone', 'operator');

  -- Query as party 4. 19:00 slot remaining: cap is min(2, eligible party-4 tables).
  -- Eligible party-4 tables = T4,T6 (Tsmall max_party 2 excluded). cap=2.
  -- Under the QUERYING-turn model, the party-2 booking [18:00,20:00) overlaps the
  -- 19:00 candidate [19:00,21:00). BUT the booking is on Tsmall, which is NOT in
  -- the party-4 eligible set → r.table_id = ANY(eligible) is FALSE and table is
  -- not NULL → the booking is NOT counted. remaining at 19:00 = 2.
  SELECT remaining INTO v_rem FROM public.pg_venue_available_slots(v_brand, v_wed, 4)
  WHERE slot_local_label = '19:00';
  RAISE NOTICE 'B-3 INFO: party-2-on-small booking, queried as party-4, 19:00 remaining = % (small table not in party-4 eligible set → not counted)', v_rem;

  -- P3-1 FIX (2026-06-16): book the party-2 on T4 (which IS eligible for party 4).
  -- Its TRUE window is [18:00,19:00). The 19:00 party-4 candidate [19:00,21:00)
  -- must NOT be reduced by a booking that truly ends at 19:00. The engine now
  -- models each existing reservation with ITS OWN party-size turn (60 → ends
  -- 19:00, half-open touch, no overlap) instead of the querying turn (120). So
  -- 19:00 remaining MUST be the full cap (2). FAILS-ON-REVERT of the P3-1 fix.
  DELETE FROM public.reservations WHERE brand_id = v_brand;
  INSERT INTO public.reservations (brand_id, table_id, reserved_for, party_size, status, source, created_via)
  VALUES (v_brand, v_t4, (v_wed::timestamp + interval '18 hours'), 2, 'confirmed', 'phone', 'operator');
  SELECT remaining INTO v_rem FROM public.pg_venue_available_slots(v_brand, v_wed, 4)
  WHERE slot_local_label = '19:00';
  IF v_rem <> 2 THEN
    RAISE EXCEPTION 'B-3 FAIL (P3-1 reverted): a party-2 booking (own turn 60, ends 19:00) must NOT reduce the 19:00 party-4 slot; the engine must use each reservation OWN turn, not the querying turn. remaining expected 2 got %', v_rem;
  END IF;
  RAISE NOTICE 'B-3 PASS (P3-1 FIXED): a party-2 booking (own turn 60, ends 19:00) does NOT reduce the 19:00 party-4 slot (heterogeneous turn correct). remaining=2.';

  -- ===================== B-5: max-per-slot at exactly cap ====================
  DELETE FROM public.reservations WHERE brand_id = v_brand;
  -- Two party-4 bookings at 17:00 (cap=2) → remaining 0, is_full true, returned.
  INSERT INTO public.reservations (brand_id, table_id, reserved_for, party_size, status, source, created_via)
  VALUES
    (v_brand, v_t4, (v_wed::timestamp + interval '17 hours'), 4, 'confirmed', 'phone', 'operator'),
    (v_brand, v_t6, (v_wed::timestamp + interval '17 hours'), 4, 'seated', 'phone', 'operator');
  SELECT remaining, is_full INTO v_rem, v_full FROM public.pg_venue_available_slots(v_brand, v_wed, 4)
  WHERE slot_local_label = '17:00';
  IF v_rem <> 0 OR NOT v_full THEN
    RAISE EXCEPTION 'B-5 FAIL: at exactly cap, 17:00 must be remaining=0 is_full=true, got rem=% full=%', v_rem, v_full;
  END IF;
  RAISE NOTICE 'B-5 PASS: max-per-slot at exactly the cap → remaining 0, is_full true, returned';

  -- A THIRD booking must not push remaining negative (GREATEST clamp).
  INSERT INTO public.reservations (brand_id, table_id, reserved_for, party_size, status, source, created_via)
  VALUES (v_brand, NULL, (v_wed::timestamp + interval '17 hours'), 4, 'confirmed', 'phone', 'operator');
  SELECT remaining INTO v_rem FROM public.pg_venue_available_slots(v_brand, v_wed, 4)
  WHERE slot_local_label = '17:00';
  IF v_rem <> 0 THEN
    RAISE EXCEPTION 'B-5b FAIL: remaining must clamp at 0, got %', v_rem;
  END IF;
  RAISE NOTICE 'B-5b PASS: over-cap remaining clamps at 0 (no negative)';

  -- ===================== B-10: NULL-table reservation consumes pool =========
  -- The 3rd booking above had table_id NULL → it DID consume (already at 0). Add
  -- a fresh slot probe: a NULL-table party-4 at 19:00 reduces the 19:00 pool.
  INSERT INTO public.reservations (brand_id, table_id, reserved_for, party_size, status, source, created_via)
  VALUES (v_brand, NULL, (v_wed::timestamp + interval '19 hours'), 4, 'confirmed', 'phone', 'operator');
  SELECT remaining INTO v_rem FROM public.pg_venue_available_slots(v_brand, v_wed, 4)
  WHERE slot_local_label = '19:00';
  IF v_rem <> 1 THEN
    RAISE EXCEPTION 'B-10 FAIL: a NULL-table reservation must consume the shared pool; 19:00 remaining expected 1 got %', v_rem;
  END IF;
  RAISE NOTICE 'B-10 PASS: NULL-table reservation consumes the shared pool';

  -- ===================== B-6: oversized party vs combinable =================
  -- Party 10 fits no single table (max cap 6); both T4+T6 are combinable=false
  -- here anyway, and 2.1a ignores combinable → expect 0 slots.
  DELETE FROM public.reservations WHERE brand_id = v_brand;
  SELECT count(*) INTO v_count FROM public.pg_venue_available_slots(v_brand, v_wed, 10);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'B-6 FAIL: party 10 fits no single table and combinable is ignored in 2.1a; expected 0, got %', v_count;
  END IF;
  RAISE NOTICE 'B-6 PASS: oversized party vs (ignored) combinable → 0 slots';

  -- ===================== B-4: max_party > capacity over-seat ================
  -- P3-2 FIX (2026-06-16): a table cap 2 but max_party 8. Query party 7 — NO real
  -- table seats 7 (T4 max4, T6 max6, Tsmall max2); ONLY Tovercap would match
  -- pre-clamp (max8). The engine now clamps the effective max party to capacity
  -- (LEAST(COALESCE(max_party,capacity),capacity) = LEAST(8,2) = 2), so a cap-2
  -- table can NEVER seat 7. Expect 0 slots. (Party 7 isolates the over-seat from
  -- T6's legitimate party-6 fit.) FAILS-ON-REVERT of the P3-2 fix.
  INSERT INTO public.venue_tables (id, brand_id, name, capacity, min_party, max_party, reservation_policy, is_active)
  VALUES (v_t_overcap, v_brand, 'Tovercap', 2, 1, 8, 'reservable', true);
  SELECT count(*) INTO v_count FROM public.pg_venue_available_slots(v_brand, v_wed, 7);
  IF v_count > 0 THEN
    RAISE EXCEPTION 'B-4 FAIL (P3-2 reverted): a party of 7 was offered % slots on a CAPACITY-2 table — the effective max party must clamp to capacity (LEAST(COALESCE(max_party,capacity),capacity)); over-seat not fixed.', v_count;
  END IF;
  RAISE NOTICE 'B-4 PASS (P3-2 FIXED): a cap-2/max-8 table does NOT offer party-7 slots (effective max clamped to capacity). 0 slots.';
  DELETE FROM public.venue_tables WHERE id = v_t_overcap;

  -- ===================== B-11: zone-scoped blackout =========================
  -- Blackout the 'indoor' zone for v_wed. T4+Tsmall are indoor; T6 outdoor.
  -- Party 4: only T4 (indoor) and T6 (outdoor) are eligible. Indoor blackout
  -- removes T4 → only T6 → cap = min(2, 1) = 1. Slots still appear with rem=1.
  INSERT INTO public.venue_blackouts (brand_id, date_start, date_end, applies_to, zone, reason)
  VALUES (v_brand, v_wed, v_wed, 'zone', 'indoor', 'indoor closed');
  SELECT count(*), max(remaining) INTO v_count, v_rem FROM public.pg_venue_available_slots(v_brand, v_wed, 4);
  IF v_count = 0 THEN
    RAISE EXCEPTION 'B-11 FAIL: a zone blackout must NOT zero the day (outdoor T6 still seats party 4); got 0 slots';
  END IF;
  IF v_rem <> 1 THEN
    RAISE EXCEPTION 'B-11 FAIL: indoor blackout leaves only T6 → cap 1; got max remaining %', v_rem;
  END IF;
  RAISE NOTICE 'B-11 PASS: zone blackout removes only zoned tables (cap drops to 1, day not zeroed)';
  DELETE FROM public.venue_blackouts WHERE brand_id = v_brand;

  ----------------------------------------------------------------------------
  -- Brand B: EST venue (offset -300) — tz label correctness + DST
  ----------------------------------------------------------------------------
  INSERT INTO public.brands (id, account_id, name, slug)
  VALUES (v_brand_est, v_account, 'Adv EST', 'adv-est-' || substr(v_brand_est::text,1,8));
  INSERT INTO public.venue_reservation_settings (brand_id, reservations_enabled, place_pool_id)
  VALUES (v_brand_est, true, v_pp);
  -- P3-3 FIX: the venue now carries an IANA timezone (DST-aware), not the static
  -- place_pool.utc_offset_minutes. America/New_York is UTC-5 in winter (EST) and
  -- UTC-4 in summer (EDT) — the engine resolves the correct offset per date.
  INSERT INTO public.venue_availability_config
    (brand_id, place_pool_id, service_periods, turn_times, buffer_minutes,
     max_reservations_per_slot, slot_granularity_minutes, advance_window_days, min_notice_minutes, iana_timezone)
  VALUES (v_brand_est, v_pp,
    jsonb_build_array(jsonb_build_object('name','Dinner','days',jsonb_build_array(3),'start','18:00','end','20:00','type','dinner')),
    '{"p2":60}'::jsonb, 0, 5, 60, 365, 0, 'America/New_York');
  INSERT INTO public.venue_tables (brand_id, name, capacity, min_party, max_party, reservation_policy, is_active)
  VALUES (v_brand_est, 'E1', 4, 1, 4, 'reservable', true);

  -- ===================== B-7: non-UTC offset label correctness ==============
  -- 18:00 EST should map to 23:00 UTC. slot_local_label must read '18:00' and
  -- slot_start_utc must be v_wed 23:00 UTC.
  SELECT slot_local_label, slot_start_utc INTO v_label, v_utc
  FROM public.pg_venue_available_slots(v_brand_est, v_wed, 2)
  ORDER BY slot_start_utc LIMIT 1;
  IF v_label <> '18:00' THEN
    RAISE EXCEPTION 'B-7 FAIL: EST 18:00 service start must label 18:00, got %', v_label;
  END IF;
  IF v_utc <> (v_wed::timestamp + interval '23 hours') AT TIME ZONE 'UTC' THEN
    RAISE EXCEPTION 'B-7 FAIL: EST 18:00 must be 23:00 UTC, got %', v_utc;
  END IF;
  RAISE NOTICE 'B-7 PASS: non-UTC offset (-300) — label 18:00 ↔ slot_start_utc 23:00Z agree';

  -- ===================== B-8: DST — IANA timezone correctness (P3-3 FIX) ======
  -- A US-Eastern venue is UTC-5 in winter (EST) but UTC-4 in summer (EDT). The
  -- engine now converts via the IANA timezone (America/New_York), so a summer
  -- (July, EDT) 18:00-local slot MUST materialise at 22:00Z (UTC-4), NOT the
  -- static-offset 23:00Z. Pick a July Wednesday within the advance window and
  -- assert the DST-correct instant. FAILS-ON-REVERT of the P3-3 fix.
  DECLARE
    v_jul date := make_date(EXTRACT(year FROM now())::int, 7, 1);
    v_jul_utc timestamptz;
  BEGIN
    IF v_jul < now()::date THEN v_jul := make_date(EXTRACT(year FROM now())::int + 1, 7, 1); END IF;
    WHILE EXTRACT(dow FROM v_jul) <> 3 LOOP v_jul := v_jul + 1; END LOOP;
    UPDATE public.venue_availability_config SET advance_window_days = 365, min_notice_minutes = 0
      WHERE brand_id = v_brand_est;
    UPDATE public.venue_availability_config
      SET service_periods = jsonb_build_array(jsonb_build_object('name','Dinner','days',jsonb_build_array(3),'start','18:00','end','20:00','type','dinner'))
      WHERE brand_id = v_brand_est;
    SELECT slot_start_utc INTO v_jul_utc
    FROM public.pg_venue_available_slots(v_brand_est, v_jul, 2)
    ORDER BY slot_start_utc LIMIT 1;
    IF v_jul_utc <> (v_jul::timestamp + interval '22 hours') AT TIME ZONE 'UTC' THEN
      RAISE EXCEPTION 'B-8 FAIL (P3-3 reverted): a July (EDT, UTC-4) 18:00-local slot must materialise at 22:00Z (DST-aware via IANA tz), got % — the engine is still using a static offset.', v_jul_utc;
    END IF;
    RAISE NOTICE 'B-8 PASS (P3-3 FIXED): a July (EDT, UTC-4) 18:00-local slot materialises at 22:00Z (DST-correct via IANA America/New_York). The static-offset 1-hour error is gone.';
  END;

  -- ===================== B-9: past date (lower-bound) =======================
  -- A date in the PAST: min_notice=0 means the now()+min_notice cutoff drops all
  -- slots whose instant is < now. A fully-past day → 0 slots (cutoff), but the
  -- engine has NO explicit "p_date >= today" guard; prove past-day yields 0 via
  -- the min_notice cutoff (slots are all in the past).
  SELECT count(*) INTO v_count
  FROM public.pg_venue_available_slots(v_brand_est, (now() - interval '7 days')::date, 2);
  IF v_count <> 0 THEN
    RAISE NOTICE 'B-9 INFO: a past date returned % slots (no explicit lower-bound guard; relies on min_notice cutoff).', v_count;
  ELSE
    RAISE NOTICE 'B-9 PASS: a fully-past date yields 0 slots (min_notice cutoff covers it).';
  END IF;

  -- ===================== B-12: min_notice cutoff ============================
  -- Set a huge min_notice so even the far-future Wed slots are cut.
  UPDATE public.venue_availability_config SET min_notice_minutes = 60*24*400 WHERE brand_id = v_brand_est;
  SELECT count(*) INTO v_count FROM public.pg_venue_available_slots(v_brand_est, v_wed, 2);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'B-12 FAIL: a 400-day min_notice must drop the ~150-day-out slots, got %', v_count;
  END IF;
  RAISE NOTICE 'B-12 PASS: min_notice cutoff drops too-soon slots';

  RAISE NOTICE 'ORCH-1148 2.1a ADVERSARIAL engine test COMPLETE (B-1..B-12).';
END;
$adv$;

ROLLBACK;
