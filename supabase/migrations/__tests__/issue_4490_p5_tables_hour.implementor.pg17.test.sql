-- #4490 P5-1 (tables under spaces, floor plan, pick a table, minimum spend, joined tables, guest waitlist, by the hour;
-- 20281203164490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-ONE-TABLE-ONE-PARTY | issue #4490 | a guest table pick is checked under the venue's table lock against the one occupancy helper (table, joined tables, table-less reservations); two reservations never sit on one table at overlapping times through the guest writer.
-- MINGLA-INVARIANT: I-4490-SLOTS-MATCH-MAP | issue #4490 | pg_venue_available_slots and pg_venue_available_tables read issue_4490_table_slot_occupancy, so a time is offered exactly when the map shows a free option; with no joins the slot count equals the pre-P5 count.
-- MINGLA-INVARIANT: I-4490-WAITLIST-ACCESS | issue #4490 | a guest waitlist entry opens only with its token or for its own signed-in guest; messages never carry the token.
-- MINGLA-INVARIANT: I-4490-NO-DOUBLE-HOUR | issue #4490 | a by-the-hour unit is claimed through venue_space_claims (exclusion constraint, buffers included); "any one of" takes the next free unit.
--
-- T-1 features built, dependencies, two-way legacy mirror. T-2 tables under spaces, plan, joins, minimum-spend gate, floor read.
-- T-3 slots = old count (50 random cases), slots agree with the map, seating-area filter.
-- T-4 joined tables. T-5 pick a table: hold per guest, minimum spend, taken, joined, seating area, feature off.
-- T-6 Host suggest / give / move / clear a table. T-7 guest waitlist (join, access rule, table opened, staff offer, leave).
-- T-8 public page tables block. T-9 by the hour (authoring, day line, price with VAT, buffers, any-one-of units, no-show release).
-- T-10 big-party request, RLS and grants.
--
-- FAILS-ON-REVERT (seen): skip the taken check in issue_4490_resolve_table_pick -> T-5d books B3 twice ("no error").
\set ON_ERROR_STOP on
BEGIN;
-- (shared #4490 P2 suite fixture; copied into each suite)
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;
INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS', 'VENUE_OFFERS_WRITES', 'STAY_RESERVE_READS', 'STAY_RESERVE_WRITES']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

CREATE FUNCTION public.t4490_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490 FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;

CREATE FUNCTION public.t4490_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490 FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490 FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;

CREATE FUNCTION public.t4490_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN '{"role":"anon"}'
         ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
  PERFORM set_config('role', CASE WHEN p_user IS NULL THEN 'anon' ELSE 'authenticated' END, true);
END
$f$;

CREATE FUNCTION public.t4490_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;

CREATE FUNCTION public.t4490_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;

GRANT EXECUTE ON FUNCTION public.t4490_ok(boolean, text), public.t4490_expect(text, text, text, text),
  public.t4490_as(uuid), public.t4490_service(), public.t4490_reset() TO PUBLIC;


-- People: 01 owner, 05 outsider, 06 signed-in guest, 07 event manager.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44909000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p5u' || n || '-4490@example.test', now(), now()
FROM generate_series(1, 7) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44909000-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider, payout_hold_cutover_at, created_at, updated_at)
VALUES ('44909000-0000-4000-9000-000000000010', '44909000-0000-4000-8000-000000000001', 'Harmattan P5 4490',
        'harmattan-p5-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44909000-0000-4000-c000-000000000007', '44909000-0000-4000-9000-000000000010', '44909000-0000-4000-8000-000000000007', 'event_manager', now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44909000-0000-4000-9000-0000000000a1', '44909000-0000-4000-9000-000000000010', 'lanternp54490', 'Lantern P5', 6.45, 3.40, 'restaurant', 'verified', 'NG'),
  ('44909000-0000-4000-9000-0000000000a2', '44909000-0000-4000-9000-000000000010', 'korap54490', 'Kora P5', 6.45, 3.41, 'play', 'verified', 'NG');
INSERT INTO public.venue_availability_config (brand_id, venue_id, iana_timezone, service_periods, turn_times,
  slot_granularity_minutes, advance_window_days)
VALUES ('44909000-0000-4000-9000-000000000010', '44909000-0000-4000-9000-0000000000a1', 'Africa/Lagos',
        '[{"start":"12:00","end":"23:00","days":[0,1,2,3,4,5,6]}]'::jsonb, '{"p1":90}'::jsonb, 30, 30);
INSERT INTO public.venue_reservation_settings (brand_id, venue_id, reservations_enabled)
VALUES ('44909000-0000-4000-9000-000000000010', '44909000-0000-4000-9000-0000000000a1', true);

CREATE TEMP TABLE t4490_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490_ids TO PUBLIC;
CREATE FUNCTION public.t4490_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$ SELECT v FROM t4490_ids WHERE k = p_k $f$;
CREATE FUNCTION public.t4490_key(p_seed text) RETURNS text LANGUAGE sql AS $f$ SELECT encode(sha256(convert_to(p_seed, 'UTF8')), 'hex') $f$;
CREATE FUNCTION public.t4490_v(p_offer uuid) RETURNS bigint LANGUAGE sql AS $f$ SELECT version FROM public.stay_offerings WHERE id = p_offer $f$;
-- A day three days ahead, Lagos, and an instant on it.
CREATE FUNCTION public.t4490_day() RETURNS date LANGUAGE sql AS $f$ SELECT (now() AT TIME ZONE 'Africa/Lagos')::date + 3 $f$;
CREATE FUNCTION public.t4490_at(p_hhmm text, p_day date DEFAULT NULL) RETURNS timestamptz LANGUAGE sql AS $f$
  SELECT (COALESCE(p_day, public.t4490_day()) + p_hhmm::time) AT TIME ZONE 'Africa/Lagos' $f$;
-- The old (pre-P5) slot count, verbatim: cap - overlapping reservations on a fitting table or none.
CREATE FUNCTION public.t4490_old_remaining(p_venue uuid, p_slot timestamptz, p_party integer)
RETURNS integer LANGUAGE sql AS $f$
  WITH cfg AS (SELECT * FROM public.venue_availability_config WHERE venue_id = p_venue),
  elig AS (
    SELECT t.id FROM public.venue_tables t
    WHERE t.venue_id = p_venue AND t.is_active AND t.deleted_at IS NULL AND t.reservation_policy = 'reservable'
      AND p_party BETWEEN COALESCE(t.min_party, 1) AND LEAST(COALESCE(t.max_party, t.capacity), t.capacity))
  SELECT LEAST(COALESCE(cfg.max_reservations_per_slot, (SELECT count(*) FROM elig)::integer), (SELECT count(*) FROM elig)::integer)
    - (SELECT count(*)::integer FROM public.reservations r
       WHERE r.venue_id = p_venue AND r.status IN ('requested', 'confirmed', 'seated')
         AND (r.table_id IS NULL OR r.table_id IN (SELECT id FROM elig))
         AND r.reserved_for < p_slot + make_interval(mins => public.pg_venue_turn_minutes_for_party(cfg.turn_times, p_party) + cfg.buffer_minutes)
         AND r.reserved_for + make_interval(mins => public.pg_venue_turn_minutes_for_party(cfg.turn_times, r.party_size) + cfg.buffer_minutes) > p_slot)
  FROM cfg;
$f$;
CREATE FUNCTION public.t4490_res(p_at timestamptz, p_party integer, p_table uuid, p_tag text, p_joined uuid[] DEFAULT '{}')
RETURNS uuid LANGUAGE sql AS $f$
  INSERT INTO public.reservations (brand_id, venue_id, reserved_for, party_size, status, source, created_via, guest_name, table_id, joined_table_ids)
  VALUES ('44909000-0000-4000-9000-000000000010', '44909000-0000-4000-9000-0000000000a1', p_at, p_party, 'confirmed', 'phone', 'operator', p_tag, p_table, p_joined)
  RETURNING id;
$f$;
CREATE FUNCTION public.t4490_guest_res(p_at timestamptz, p_party integer, p_tables uuid[], p_fee integer, p_tag text,
  p_space uuid DEFAULT NULL)
RETURNS public.reservations LANGUAGE sql AS $f$
  SELECT public.pg_create_guest_reservation(
    '44909000-0000-4000-9000-0000000000a1', p_at, p_party, 'website', 'guest', NULL, 'Guest ' || p_tag, NULL,
    p_tag || '@example.test', NULLIF(p_fee, 0), 'NGN', CASE WHEN p_fee > 0 THEN 'pi_' || p_tag END,
    CASE WHEN p_fee > 0 THEN 'paid' ELSE 'none' END, NULL, NULL, NULL, 'confirmed', NULL, p_tables, p_space);
$f$;
GRANT EXECUTE ON FUNCTION public.t4490_id(text), public.t4490_key(text), public.t4490_v(uuid), public.t4490_day(),
  public.t4490_at(text, date), public.t4490_old_remaining(uuid, timestamptz, integer),
  public.t4490_res(timestamptz, integer, uuid, text, uuid[]),
  public.t4490_guest_res(timestamptz, integer, uuid[], integer, text, uuid) TO PUBLIC;

-- ===========================================================================
-- T-1 Features: built, dependencies, the two-way legacy mirror.
-- ===========================================================================
SELECT public.t4490_as('44909000-0000-4000-8000-000000000001');
DO $t1$
DECLARE
  a1 uuid := '44909000-0000-4000-9000-0000000000a1';
  v jsonb;
  s jsonb;
BEGIN
  PERFORM public.t4490_ok(ARRAY['floor_plan', 'pick_a_table', 'min_spend_tables', 'by_the_hour', 'waitlist']
                          <@ public.issue_4490_built_features(), 'T-1a floor plan, pick a table, minimum spend, by the hour, waitlist are built');
  s := public.issue_4490_manage_space('create', a1, '{"name":"Dining room","setting":"indoor","capacity_seated":60}'::jsonb, NULL);
  INSERT INTO t4490_ids VALUES ('dining', (s->>'id')::uuid);
  s := public.issue_4490_manage_space('create', a1, '{"name":"Amber Room","setting":"indoor","capacity_seated":12}'::jsonb, NULL);
  INSERT INTO t4490_ids VALUES ('amber', (s->>'id')::uuid);
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_set_venue_feature(%L, 'pick_a_table', true, NULL, NULL, NULL, 'p5-t1-pick-nocascade')$q$, a1),
    'P0001', 'feature_requires:floor_plan', 'T-1b pick a table needs the floor plan first');
  v := public.issue_4490_set_venue_feature(a1, 'pick_a_table', true, NULL, NULL, NULL, 'p5-t1-pick', true);
  PERFORM public.t4490_ok((SELECT bool_and(f.enabled) FROM public.venue_features f WHERE f.venue_id = a1
                           AND f.feature_key IN ('pick_a_table', 'floor_plan')), 'T-1c cascade turns on pick a table and the floor plan');
  v := public.issue_4490_set_venue_feature(a1, 'min_spend_tables', true, NULL, NULL, NULL, 'p5-t1-minspend');
  v := public.issue_4490_set_venue_feature(a1, 'waitlist', true, NULL, NULL, NULL, 'p5-t1-waitlist');
END
$t1$;
SELECT public.t4490_reset();
-- Old Host build: reservations off directly on the legacy switch.
UPDATE public.venue_reservation_settings SET reservations_enabled = false WHERE venue_id = '44909000-0000-4000-9000-0000000000a1';
DO $t1d$
BEGIN
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.issue_4490_venue_feature_rows('44909000-0000-4000-9000-0000000000a1') r
                                      WHERE r.feature_key IN ('table_reservations', 'floor_plan', 'pick_a_table', 'min_spend_tables') AND r.enabled),
    'T-1d legacy switch off -> table reservations, floor plan, pick a table and minimum spend all off (mirror)');
END
$t1d$;
SELECT public.t4490_as('44909000-0000-4000-8000-000000000001');
DO $t1e$
DECLARE
  a1 uuid := '44909000-0000-4000-9000-0000000000a1';
BEGIN
  PERFORM public.issue_4490_set_venue_feature(a1, 'pick_a_table', true, NULL, NULL, NULL, 'p5-t1-pick-again', true);
  PERFORM public.issue_4490_set_venue_feature(a1, 'min_spend_tables', true, NULL, NULL, NULL, 'p5-t1-minspend-again');
  PERFORM public.t4490_ok((SELECT reservations_enabled FROM public.venue_reservation_settings WHERE venue_id = a1),
    'T-1e turning pick a table on (cascade) writes the legacy reservations switch on');
END
$t1e$;

-- ===========================================================================
-- T-2 Tables under spaces: create, plan, joins, minimum spend gate, floor read.
-- ===========================================================================
DO $t2$
DECLARE
  a1 uuid := '44909000-0000-4000-9000-0000000000a1';
  v jsonb;
  f jsonb;
  i integer;
BEGIN
  -- B1..B4 four-tops in the Dining room (combinable), B3 pickable with a N5,000 per guest hold.
  FOR i IN 1..4 LOOP
    v := public.issue_4490_manage_table('create', a1, jsonb_build_object('name', 'B' || i, 'capacity', 4,
      'spaceId', public.t4490_id('dining'), 'shape', CASE WHEN i = 1 THEN 'round' ELSE 'rect' END,
      'planX', 100 * i, 'planY', 200, 'rotation', 0, 'combinable', true,
      'depositPerGuestMinor', CASE WHEN i = 3 THEN 500000 END), 'p5-t2-b' || i);
    INSERT INTO t4490_ids VALUES ('b' || i, (v->>'id')::uuid);
  END LOOP;
  PERFORM public.t4490_ok((v->>'spaceId')::uuid = public.t4490_id('dining') AND v->>'shape' = 'rect'
                          AND (v->>'planX')::numeric = 400 AND (v->>'guestPickable')::boolean,
    'T-2a a table sits in a space with a shape, a place on the plan and "Guests can pick this table" on by default');
  v := public.issue_4490_manage_table('update', a1, jsonb_build_object('tableId', public.t4490_id('b1'),
    'joinsWith', jsonb_build_array(public.t4490_id('b2'))), 'p5-t2-join');
  PERFORM public.t4490_ok(v->'joinsWith' = jsonb_build_array(public.t4490_id('b2')), 'T-2b B1 joins B2');
  -- Amber Room booth: minimum spend N80,000, hold N20,000 per guest.
  v := public.issue_4490_manage_table('create', a1, jsonb_build_object('name', 'Amber booth', 'capacity', 6, 'minParty', 2,
    'spaceId', public.t4490_id('amber'), 'shape', 'booth', 'minSpendMinor', 8000000, 'depositPerGuestMinor', 2000000), 'p5-t2-amber');
  INSERT INTO t4490_ids VALUES ('booth', (v->>'id')::uuid);
  PERFORM public.t4490_ok((v->>'minSpendMinor')::bigint = 8000000 AND (v->>'depositPerGuestMinor')::bigint = 2000000,
    'T-2c Amber booth: minimum spend N80,000, hold N20,000 a guest');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_manage_table('update', %L, jsonb_build_object('tableId', %L, 'joinsWith', jsonb_build_array(%L)), 'p5-t2-badjoin')$q$,
    a1, public.t4490_id('b3'), public.t4490_id('booth')), '22023', 'table_join_invalid', 'T-2d a join across two spaces is refused');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_manage_table('create', %L, '{"name":"X","capacity":4,"spaceId":"00000000-0000-4000-8000-000000000000"}'::jsonb, 'p5-t2-badspace')$q$,
    a1), '22023', 'table_space_invalid', 'T-2e a table needs a space of this venue');
  f := public.issue_4490_floor_plan(a1, NULL, now());
  PERFORM public.t4490_ok(jsonb_array_length((SELECT x->'tables' FROM jsonb_array_elements(f->'spaces') x WHERE x->>'name' = 'Dining room')) = 4
                          AND (f->'features'->>'pickATable')::boolean AND (f->>'partyMax')::integer = 8,
    'T-2f floor read: 4 tables in the Dining room, pick a table on, party cap 8 (B1+B2 joined)');
  v := public.issue_4490_save_floor_plan(a1, public.t4490_id('dining'), jsonb_build_object('tables', jsonb_build_array(
    jsonb_build_object('tableId', public.t4490_id('b4'), 'planX', 700, 'planY', 300, 'rotation', 90, 'shape', 'high_top'))),
    (SELECT version FROM public.venue_spaces WHERE id = public.t4490_id('dining')), 'p5-t2-plan');
  PERFORM public.t4490_ok((SELECT plan_x = 700 AND plan_rotation = 90 AND shape = 'high_top' FROM public.venue_tables WHERE id = public.t4490_id('b4')),
    'T-2g save floor plan moves B4 (700,300), turns it 90 degrees, high top');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_save_floor_plan(%L, %L, '{"tables":[]}'::jsonb, 1, 'p5-t2-stale')$q$,
    a1, public.t4490_id('dining')), 'PT409', 'stale_write', 'T-2h a stale floor plan save is refused');
END
$t2$;
SELECT public.t4490_reset();
-- Minimum spend needs its feature.
UPDATE public.venue_features SET enabled = false WHERE venue_id = '44909000-0000-4000-9000-0000000000a1' AND feature_key = 'min_spend_tables';
SELECT public.t4490_as('44909000-0000-4000-8000-000000000001');
SELECT public.t4490_expect(format($q$SELECT public.issue_4490_manage_table('update', %L, jsonb_build_object('tableId', %L, 'minSpendMinor', 100), 'p5-t2-ms-off')$q$,
  '44909000-0000-4000-9000-0000000000a1', public.t4490_id('b3')), 'P0001', 'min_spend_tables_off',
  'T-2i a minimum spend needs "Minimum spend tables" on');
SELECT public.t4490_reset();
UPDATE public.venue_features SET enabled = true WHERE venue_id = '44909000-0000-4000-9000-0000000000a1' AND feature_key = 'min_spend_tables';
SELECT public.t4490_as('44909000-0000-4000-8000-000000000005');
SELECT public.t4490_expect(format($q$SELECT public.issue_4490_manage_table('create', %L, jsonb_build_object('name','Z','capacity',2,'spaceId',%L), 'p5-t2-outsider')$q$,
  '44909000-0000-4000-9000-0000000000a1', public.t4490_id('dining')), '42501', 'not_authorized', 'T-2j an outsider cannot add tables');
SELECT public.t4490_expect(format($q$SELECT public.issue_4490_floor_plan(%L, NULL, now())$q$, '44909000-0000-4000-9000-0000000000a1'),
  '42501', 'not_authorized', 'T-2k an outsider cannot read the floor');
SELECT public.t4490_reset();

-- ===========================================================================
-- T-3 Slots and the table map agree, and match the old count (no joins).
-- ===========================================================================
SELECT public.t4490_reset();
DO $t3$
DECLARE
  a1 uuid := '44909000-0000-4000-9000-0000000000a1';
  i integer;
  v_slot timestamptz;
  v_party integer;
  v_new integer;
  v_old integer;
  v_free boolean;
  v_full boolean;
  v_mism integer := 0;
  v_map_mism integer := 0;
  v_cases integer := 0;
BEGIN
  PERFORM setseed(0.4490);
  -- Some placed and some table-less reservations around the evening.
  PERFORM public.t4490_res(public.t4490_at('19:00'), 4, public.t4490_id('b4'), 'r-b4');
  PERFORM public.t4490_res(public.t4490_at('19:30'), 2, NULL, 'r-none-1');
  PERFORM public.t4490_res(public.t4490_at('20:00'), 3, public.t4490_id('b2'), 'r-b2');
  PERFORM public.t4490_res(public.t4490_at('21:00'), 5, public.t4490_id('booth'), 'r-booth');
  PERFORM public.t4490_res(public.t4490_at('18:00'), 2, NULL, 'r-none-2');
  -- The old count, for parties no join serves (1..4 and 5..6): identical.
  FOR i IN 1..50 LOOP
    v_slot := public.t4490_at('12:00') + make_interval(mins => 30 * floor(random() * 19)::integer);
    v_party := 1 + floor(random() * 4)::integer;
    SELECT s.remaining, s.is_full INTO v_new, v_full
    FROM public.pg_venue_available_slots(public.t4490_day(), v_party, a1) s WHERE s.slot_start_utc = v_slot;
    CONTINUE WHEN NOT FOUND;
    v_cases := v_cases + 1;
    v_old := GREATEST(public.t4490_old_remaining(a1, v_slot, v_party), 0);
    IF v_new <> v_old THEN
      v_mism := v_mism + 1;
      RAISE NOTICE 'mismatch % party % new % old %', v_slot, v_party, v_new, v_old;
    END IF;
    -- The map has a free (or free but not pickable) option exactly when the slot is open.
    SELECT EXISTS (SELECT 1 FROM public.pg_venue_available_tables(a1, public.t4490_day(), v_party, v_slot) t
                   WHERE t.status IN ('free', 'not_pickable')) INTO v_free;
    IF v_free = v_full THEN
      v_map_mism := v_map_mism + 1;
      RAISE NOTICE 'map mismatch % party % full % mapfree %', v_slot, v_party, v_full, v_free;
    END IF;
  END LOOP;
  PERFORM public.t4490_ok(v_cases >= 40 AND v_mism = 0,
    format('T-3a slots equal the old count in %s random cases (party 1-4, which no join serves)', v_cases));
  PERFORM public.t4490_ok(v_map_mism = 0, format('T-3b the table map and the slot list agree in %s random cases', v_cases));
  PERFORM public.t4490_ok((SELECT count(*) FROM public.pg_venue_available_slots(public.t4490_day(), 7, a1, NULL, public.t4490_id('amber'))) = 0
                          AND (SELECT count(*) FROM public.pg_venue_available_slots(public.t4490_day(), 7, a1, NULL, public.t4490_id('dining'))) > 0,
    'T-3c seating area: 7 guests get no time in the Amber Room (booth seats 6) but do in the Dining room (B1 + B2 joined)');
END
$t3$;

-- ===========================================================================
-- T-4 Joined tables seat a bigger party only when both are free.
-- ===========================================================================
DO $t4$
DECLARE
  a1 uuid := '44909000-0000-4000-9000-0000000000a1';
  v_slot timestamptz := public.t4490_at('13:00');
  v_r uuid;
BEGIN
  PERFORM public.t4490_ok((SELECT NOT s.is_full FROM public.pg_venue_available_slots(public.t4490_day(), 8, a1) s WHERE s.slot_start_utc = v_slot),
    'T-4a 8 guests at 13:00: offered (B1 + B2 joined, both free)');
  PERFORM public.t4490_ok((SELECT t.status FROM public.pg_venue_available_tables(a1, public.t4490_day(), 8, v_slot) t
                           WHERE t.option_kind = 'join') = 'free',
    'T-4b the map shows the B1 + B2 pair free for 8');
  v_r := public.t4490_res(public.t4490_at('12:30'), 2, public.t4490_id('b1'), 'r-b1-1230');
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.pg_venue_available_slots(public.t4490_day(), 8, a1) s
                                      WHERE s.slot_start_utc = v_slot AND NOT s.is_full),
    'T-4c B1 busy from 12:30 -> no time at 13:00 for 8 (the pair needs both)');
  PERFORM public.t4490_ok((SELECT t.status FROM public.pg_venue_available_tables(a1, public.t4490_day(), 8, v_slot) t
                           WHERE t.option_kind = 'join') = 'taken', 'T-4d the pair shows taken on the map');
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.pg_venue_available_slots(public.t4490_day(), 9, a1)),
    'T-4e 9 guests: no table or pair seats them -> no times');
  UPDATE public.reservations SET status = 'cancelled_by_venue' WHERE id = v_r;
END
$t4$;

-- ===========================================================================
-- T-5 Pick a table (guest writer): hold per guest, minimum spend, taken.
-- ===========================================================================
SELECT public.t4490_service();
DO $t5$
DECLARE
  v_r public.reservations;
  v_terms jsonb;
BEGIN
  v_terms := public.issue_4490_table_pick_terms('44909000-0000-4000-9000-0000000000a1', ARRAY[public.t4490_id('b3')], 4);
  PERFORM public.t4490_ok((v_terms->>'holdMinor')::bigint = 2000000 AND (v_terms->>'minSpendMinor')::bigint = 0,
    'T-5a B3 for 4: hold N5,000 x 4 = N20,000, no minimum spend');
  PERFORM public.t4490_expect($q$SELECT public.t4490_guest_res(public.t4490_at('20:00'), 4, ARRAY[public.t4490_id('b3')], 0, 'p5-t5-nohold')$q$,
    'P0001', 'deposit_required', 'T-5b picking B3 without paying its hold is refused');
  v_r := public.t4490_guest_res(public.t4490_at('20:00'), 4, ARRAY[public.t4490_id('b3')], 2000000, 'p5-t5-b3');
  INSERT INTO t4490_ids VALUES ('res_b3', v_r.id);
  PERFORM public.t4490_ok(v_r.table_id = public.t4490_id('b3') AND v_r.fee_cents = 2000000,
    'T-5c guest picked B3 at 20:00, N20,000 hold paid: the booking sits on B3');
  PERFORM public.t4490_expect($q$SELECT public.t4490_guest_res(public.t4490_at('20:30'), 2, ARRAY[public.t4490_id('b3')], 1000000, 'p5-t5-b3-again')$q$,
    'PT409', 'table_taken', 'T-5d B3 again at 20:30 (overlaps) -> table_taken');
  PERFORM public.t4490_ok((SELECT t.status FROM public.pg_venue_available_tables('44909000-0000-4000-9000-0000000000a1',
                             public.t4490_day(), 2, public.t4490_at('20:30')) t WHERE t.table_ids = ARRAY[public.t4490_id('b3')]) = 'taken',
    'T-5e the map shows B3 taken at 20:30');
  v_terms := public.issue_4490_table_pick_terms('44909000-0000-4000-9000-0000000000a1', ARRAY[public.t4490_id('booth')], 4);
  PERFORM public.t4490_ok((v_terms->>'holdMinor')::bigint = 8000000 AND (v_terms->>'minSpendMinor')::bigint = 8000000,
    'T-5f Amber booth for 4: hold N20,000 x 4 = N80,000; spend at least N80,000');
  v_r := public.t4490_guest_res(public.t4490_at('14:00'), 4, ARRAY[public.t4490_id('booth')], 8000000, 'p5-t5-booth');
  PERFORM public.t4490_ok(v_r.min_spend_minor = 8000000 AND v_r.table_id = public.t4490_id('booth'),
    'T-5g the booth booking keeps its minimum spend (N80,000, settled at the venue)');
  v_r := public.t4490_guest_res(public.t4490_at('15:00'), 8, ARRAY[public.t4490_id('b1'), public.t4490_id('b2')], 0, 'p5-t5-join');
  PERFORM public.t4490_ok(v_r.table_id = LEAST(public.t4490_id('b1'), public.t4490_id('b2'))
                          AND v_r.joined_table_ids = ARRAY[GREATEST(public.t4490_id('b1'), public.t4490_id('b2'))],
    'T-5h 8 guests on B1 + B2 joined: one booking, both tables');
  PERFORM public.t4490_expect($q$SELECT public.t4490_guest_res(public.t4490_at('15:30'), 3, ARRAY[public.t4490_id('b2')], 0, 'p5-t5-b2-joined')$q$,
    'PT409', 'table_taken', 'T-5i B2 is taken while joined to B1');
  v_r := public.t4490_guest_res(public.t4490_at('16:00'), 2, NULL, 0, 'p5-t5-area', public.t4490_id('amber'));
  PERFORM public.t4490_ok(v_r.table_id = public.t4490_id('booth'), 'T-5j "Amber Room" chosen with no table: the booking gets the room''s free table');
END
$t5$;
SELECT public.t4490_reset();
UPDATE public.venue_features SET enabled = false WHERE venue_id = '44909000-0000-4000-9000-0000000000a1' AND feature_key = 'pick_a_table';
SELECT public.t4490_service();
SELECT public.t4490_expect($q$SELECT public.t4490_guest_res(public.t4490_at('12:00'), 2, ARRAY[public.t4490_id('b4')], 0, 'p5-t5-off')$q$,
  'P0001', 'table_pick_unavailable', 'T-5k with "Pick a table" off a guest cannot pick a table');
SELECT public.t4490_reset();
DO $t5l$
BEGIN
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.pg_venue_available_tables('44909000-0000-4000-9000-0000000000a1',
                             public.t4490_day(), 2, public.t4490_at('12:00'))), 'T-5l and the map is empty');
END
$t5l$;
UPDATE public.venue_features SET enabled = true WHERE venue_id = '44909000-0000-4000-9000-0000000000a1' AND feature_key = 'pick_a_table';

-- ===========================================================================
-- T-6 Host: suggest a table, give a table, move, clear.
-- ===========================================================================
SELECT public.t4490_reset();
INSERT INTO t4490_ids SELECT 'walkin', public.t4490_res(public.t4490_at('13:00'), 3, NULL, 'r-walkin');
SELECT public.t4490_as('44909000-0000-4000-8000-000000000007');
DO $t6$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_suggest_tables('44909000-0000-4000-9000-0000000000a1', public.t4490_at('13:00'), 3, NULL, public.t4490_id('walkin'));
  PERFORM public.t4490_ok(v->'bestFit'->>'kind' = 'table' AND (v->'bestFit'->>'capacity')::integer = 4
                          AND NOT (v->'bestFit'->'tableIds') ? public.t4490_id('booth')::text,
    'T-6a best fit for 3 at 13:00 is a free four-top (the booth is taken from 14:00): ' || (v->'bestFit')::text);
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_assign_table(%L, ARRAY[%L]::uuid[], 1)$q$,
    public.t4490_id('walkin'), public.t4490_id('booth')), 'PT409', 'table_taken', 'T-6b giving the walk-in the booth (taken from 14:00) is refused');
  v := public.issue_4490_assign_table(public.t4490_id('walkin'), ARRAY[public.t4490_id('b2')], 1);
  PERFORM public.t4490_ok((v->>'tableId')::uuid = public.t4490_id('b2') AND (v->>'version')::bigint = 2, 'T-6c the walk-in gets B2');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_assign_table(%L, '{}'::uuid[], 1)$q$, public.t4490_id('walkin')),
    'PT409', 'stale_write', 'T-6d a stale move is refused');
  v := public.issue_4490_assign_table(public.t4490_id('walkin'), '{}'::uuid[], 2);
  PERFORM public.t4490_ok(v->>'tableId' IS NULL, 'T-6e clear: the booking has no table again');
END
$t6$;
SELECT public.t4490_reset();

-- ===========================================================================
-- T-7 Guest waitlist: join, read, leave (token or own account only), a
--     freed table tells the oldest guest once, staff offering a table.
-- ===========================================================================
SELECT public.t4490_service();
DO $t7$
DECLARE
  a1 uuid := '44909000-0000-4000-9000-0000000000a1';
  v jsonb;
  w1 uuid;
  w2 uuid;
  w3 uuid;
  v_res uuid;
BEGIN
  -- Fill 21:00-22:00 for 4 so a 4-top is wanted.
  v := public.pg_join_venue_waitlist(a1, 4, public.t4490_day(), '20:00', '22:00',
    '{"name":"Ada Obi","email":"ada-4490@example.test"}'::jsonb, sha256('wl-ada'::bytea));
  w1 := (v->>'waitlistId')::uuid;
  PERFORM public.t4490_ok(v->>'status' = 'waiting' AND (v->>'position')::integer = 1 AND NOT (v->>'replayed')::boolean,
    'T-7a Ada joins (4 guests, 20:00-22:00): waiting, first in line');
  v := public.pg_join_venue_waitlist(a1, 4, public.t4490_day(), '20:00', '22:00',
    '{"name":"Ada Obi","email":"ada-4490@example.test"}'::jsonb, sha256('wl-ada'::bytea));
  PERFORM public.t4490_ok((v->>'replayed')::boolean AND (v->>'waitlistId')::uuid = w1, 'T-7b joining again with the same link replays');
  PERFORM public.t4490_expect(format($q$SELECT public.pg_join_venue_waitlist(%L, 2, public.t4490_day(), NULL, NULL,
      '{"name":"Ada Obi","email":"ada-4490@example.test"}'::jsonb, sha256('wl-other'::bytea))$q$, a1),
    'PT409', 'waitlist_already_joined', 'T-7c the same guest cannot hold two places that day');
  v := public.pg_join_venue_waitlist(a1, 2, public.t4490_day(), NULL, NULL,
    '{"name":"Bola","phone":"+2348030000001","phoneCountryIso":"NG"}'::jsonb, sha256('wl-bola'::bytea),
    '44909000-0000-4000-8000-000000000006');
  w2 := (v->>'waitlistId')::uuid;
  PERFORM public.t4490_ok((v->>'position')::integer = 2, 'T-7d Bola joins tonight''s waitlist (any time): second');
  PERFORM public.t4490_expect(format($q$SELECT public.pg_join_venue_waitlist(%L, 20, public.t4490_day(), NULL, NULL,
      '{"name":"Big","email":"big-4490@example.test"}'::jsonb, sha256('wl-big'::bytea))$q$, a1),
    '22023', 'waitlist_party_too_large', 'T-7e a party bigger than any table or pair cannot wait');
  -- Access: token, own account; never a stranger.
  v := public.pg_get_venue_waitlist_entry(w1, sha256('wl-ada'::bytea), NULL);
  PERFORM public.t4490_ok(v->>'status' = 'waiting' AND v->'venue'->>'name' = 'Lantern P5', 'T-7f Ada reads her place with her link');
  PERFORM public.t4490_expect(format($q$SELECT public.pg_get_venue_waitlist_entry(%L, sha256('wl-wrong'::bytea), NULL)$q$, w1),
    'P0002', 'waitlist_not_found', 'T-7g a wrong link reads nothing');
  PERFORM public.t4490_expect(format($q$SELECT public.pg_get_venue_waitlist_entry(%L, NULL, '44909000-0000-4000-8000-000000000005')$q$, w1),
    'P0002', 'waitlist_not_found', 'T-7h a stranger''s account (no link) reads nothing');
  PERFORM public.t4490_expect(format($q$SELECT public.pg_get_venue_waitlist_entry(%L, NULL, '44909000-0000-4000-8000-000000000006')$q$, w1),
    'P0002', 'waitlist_not_found', 'T-7i another guest''s account reads nothing');
  v := public.pg_get_venue_waitlist_entry(w2, NULL, '44909000-0000-4000-8000-000000000006');
  PERFORM public.t4490_ok(v->>'guestName' = 'Bola', 'T-7j Bola reads her own place while signed in');
  PERFORM public.t4490_expect(format($q$SELECT public.pg_leave_venue_waitlist(%L, NULL, '44909000-0000-4000-8000-000000000005')$q$, w2),
    'P0002', 'waitlist_not_found', 'T-7k a stranger cannot take Bola off the list');
  -- The evening is full for 4 at 21:00: book every table that seats 4 around it.
  INSERT INTO t4490_ids VALUES ('wl_ada', w1), ('wl_bola', w2);
END
$t7$;
SELECT public.t4490_reset();
DO $t7b$
DECLARE
  v_res uuid;
  v_notified integer;
BEGIN
  -- B1, B2, B4 busy all evening (B3 already booked at 20:00), booth busy too.
  PERFORM public.t4490_res(public.t4490_at('19:30'), 4, public.t4490_id('b1'), 'r-wl-b1');
  PERFORM public.t4490_res(public.t4490_at('19:30'), 4, public.t4490_id('b2'), 'r-wl-b2');
  v_res := public.t4490_res(public.t4490_at('20:30'), 4, public.t4490_id('b4'), 'r-wl-b4');
  PERFORM public.t4490_res(public.t4490_at('21:00'), 4, public.t4490_id('b1'), 'r-wl-b1b');
  PERFORM public.t4490_res(public.t4490_at('21:00'), 4, public.t4490_id('b2'), 'r-wl-b2b');
  PERFORM public.t4490_res(public.t4490_at('19:00'), 4, public.t4490_id('booth'), 'r-wl-booth');
  PERFORM public.t4490_res(public.t4490_at('20:30'), 4, public.t4490_id('booth'), 'r-wl-booth2');
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.pg_venue_available_slots(public.t4490_day(), 4, '44909000-0000-4000-9000-0000000000a1') s
                                      WHERE NOT s.is_full AND s.slot_start_utc BETWEEN public.t4490_at('20:00') AND public.t4490_at('22:00')),
    'T-7l no table for 4 between 20:00 and 22:00');
  UPDATE public.reservations SET status = 'cancelled_by_guest' WHERE id = v_res;
  SELECT count(*) INTO v_notified FROM public.venue_waitlist WHERE id IN (public.t4490_id('wl_ada'), public.t4490_id('wl_bola')) AND status = 'notified';
  PERFORM public.t4490_ok(v_notified = 1
    AND (SELECT status FROM public.venue_waitlist WHERE id = public.t4490_id('wl_ada')) = 'notified'
    AND (SELECT offered_slot_at FROM public.venue_waitlist WHERE id = public.t4490_id('wl_ada')) BETWEEN public.t4490_at('20:00') AND public.t4490_at('22:00'),
    'T-7m B4 freed at 20:30: Ada (oldest, 4 guests, 20:00-22:00) is told once with a time in her range; Bola still waiting');
  PERFORM public.t4490_ok((SELECT count(*) FROM public.notification_outbox WHERE category_key = 'venue_table_opened'
                             AND payload->>'waitlist_id' = public.t4490_id('wl_ada')::text) = 1
                          AND (SELECT count(*) FROM public.notification_outbox WHERE category_key = 'venue_waitlist_joined'
                             AND payload->>'waitlist_id' = public.t4490_id('wl_ada')::text) = 1,
    'T-7n Ada has one "joined" and one "a table opened" message (no private link in the payload)');
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key LIKE 'venue_%'
                                      AND payload->>'waitlist_id' IS NOT NULL AND (payload::text LIKE '%#t=%' OR payload ? 'token')),
    'T-7o waitlist messages never carry the token');
  -- Staff offers Bola a table (old Host path: a direct status write).
  UPDATE public.venue_waitlist SET status = 'notified', notified_at = now() WHERE id = public.t4490_id('wl_bola');
  PERFORM public.t4490_ok((SELECT count(*) FROM public.notification_outbox WHERE category_key = 'venue_waitlist_ready'
                             AND payload->>'waitlist_id' = public.t4490_id('wl_bola')::text) = 1,
    'T-7p staff "Offer the table" tells Bola her table is ready');
END
$t7b$;
SELECT public.t4490_service();
DO $t7c$
DECLARE
  v jsonb;
BEGIN
  v := public.pg_get_venue_waitlist_entry(public.t4490_id('wl_bola'), sha256('wl-bola'::bytea), NULL);
  PERFORM public.t4490_ok(v->>'status' = 'notified', 'T-7q Bola''s page shows the offer');
  v := public.pg_leave_venue_waitlist(public.t4490_id('wl_bola'), sha256('wl-bola'::bytea), NULL);
  PERFORM public.t4490_ok(v->>'status' = 'left' AND v->'position' = 'null'::jsonb, 'T-7r Bola leaves with her link: "left"');
END
$t7c$;
SELECT public.t4490_reset();
UPDATE public.venue_features SET settings = '{"guestJoin":false}'::jsonb WHERE venue_id = '44909000-0000-4000-9000-0000000000a1' AND feature_key = 'waitlist';
SELECT public.t4490_service();
SELECT public.t4490_expect(format($q$SELECT public.pg_join_venue_waitlist(%L, 2, public.t4490_day(), NULL, NULL,
    '{"name":"Chi","email":"chi-4490@example.test"}'::jsonb, sha256('wl-chi'::bytea))$q$, '44909000-0000-4000-9000-0000000000a1'),
  'P0001', 'waitlist_closed', 'T-7s guests cannot join when the venue turned guest joining off');
SELECT public.t4490_reset();
UPDATE public.venue_features SET settings = '{}'::jsonb WHERE venue_id = '44909000-0000-4000-9000-0000000000a1' AND feature_key = 'waitlist';
SELECT public.t4490_as(NULL);
SELECT public.t4490_expect(format($q$SELECT public.pg_join_venue_waitlist(%L, 2, public.t4490_day(), NULL, NULL,
    '{"name":"Anon","email":"anon-4490@example.test"}'::jsonb, sha256('wl-anon'::bytea))$q$, '44909000-0000-4000-9000-0000000000a1'),
  '42501', NULL, 'T-7t anon cannot call the waitlist writer directly (edge only)');
SELECT public.t4490_reset();

-- ===========================================================================
-- T-8 Public page: the tables block.
-- ===========================================================================
SELECT public.t4490_as(NULL);
DO $t8$
DECLARE
  v jsonb;
BEGIN
  v := public.pg_public_venue_page('harmattan-p5-4490', 'lanternp54490');
  PERFORM public.t4490_ok((v->'tables'->>'partyMax')::integer = 8 AND (v->'tables'->>'pickATable')::boolean
                          AND (v->'tables'->>'holdFromMinor')::bigint = 500000 AND (v->'tables'->>'minSpendFromMinor')::bigint = 8000000
                          AND (v->'tables'->>'guestWaitlist')::boolean AND (v->'tables'->>'largePartyRequest')::boolean
                          AND jsonb_array_length(v->'tables'->'seatingAreas') = 2,
    'T-8a public page: party up to 8, pick a table, hold from N5,000, minimum spend from N80,000, waitlist, big-party request, 2 seating areas: ' || (v->'tables')::text);
END
$t8$;
SELECT public.t4490_reset();

-- ===========================================================================
-- T-9 By the hour: Boardroom N12,000 an hour, 30-minute steps, 1 to 2 hours,
--     15-minute cleanup, release a no-show after 15 minutes; Pool table x3.
-- ===========================================================================
CREATE FUNCTION public.t4490_pay(p_group uuid, p_seed text)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_p jsonb;
  v_ref text;
BEGIN
  v_p := public.issue_4490_prepare_offer_payment(p_group, sha256(convert_to('tok:' || p_seed, 'UTF8')), NULL, 'pay-key-' || p_seed,
    (SELECT version FROM public.stay_reservation_groups WHERE id = p_group));
  v_ref := 'mingla_stay_' || replace(v_p->>'attemptId', '-', '');
  PERFORM public.issue_1389_bind_payment_attempt((v_p->>'attemptId')::uuid, v_ref, NULL, NULL);
  RETURN public.issue_1389_finalize_payment('paystack', 'evt-' || p_seed, 'charge.success', v_ref, 'ch-' || p_seed,
    (v_p->>'amountMinor')::bigint, 'NGN', 0, NULL);
END
$f$;
-- Quote + hold one flexible booking (what edge venue-offers does).
CREATE FUNCTION public.t4490_hour(p_offer uuid, p_at timestamptz, p_minutes integer, p_guests integer, p_seed text)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_q jsonb;
BEGIN
  v_q := public.issue_4490_quote_offer(p_offer, public.issue_4490_flexible_window(p_offer, p_at, p_minutes),
    jsonb_build_array(jsonb_build_object('guests', p_guests)), public.t4490_key('cart:' || p_seed), NULL, 'quote-' || p_seed);
  RETURN public.issue_4490_create_offer_group(gen_random_uuid(), (v_q->>'quoteId')::uuid,
    jsonb_build_object('name', 'Guest ' || p_seed, 'email', p_seed || '@example.test'), public.t4490_key('cart:' || p_seed), NULL,
    sha256(convert_to('tok:' || p_seed, 'UTF8')), 'hold-' || p_seed) || jsonb_build_object('quote', v_q);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490_pay(uuid, text), public.t4490_hour(uuid, timestamptz, integer, integer, text) TO PUBLIC;

SELECT public.t4490_as('44909000-0000-4000-8000-000000000001');
DO $t9$
DECLARE
  a2 uuid := '44909000-0000-4000-9000-0000000000a2';
  v jsonb;
  s jsonb;
  v_offer uuid;
  v_pool uuid;
BEGIN
  PERFORM public.issue_4490_set_venue_feature(a2, 'by_the_hour', true, NULL, NULL, NULL, 'p5-t9-feature');
  PERFORM public.issue_4490_save_booking_settings(a2, '{"vatMode":"added"}'::jsonb, NULL, 'p5-t9-vat');
  s := public.issue_4490_manage_space('create', a2, '{"name":"Boardroom","setting":"indoor","capacity_seated":10}'::jsonb, NULL);
  v := public.issue_4490_manage_offer('create_draft', a2, '{"kind":"by_the_hour","name":"Boardroom"}'::jsonb, NULL, 'p5-t9-draft');
  v_offer := (v->>'id')::uuid;
  INSERT INTO t4490_ids VALUES ('board', v_offer);
  PERFORM public.t4490_ok(v->>'confirmationMode' = 'instant' AND (v->'hour'->>'stepMinutes')::integer = 60
                          AND v->'readiness' ? 'no_hours', 'T-9a a by-the-hour draft books instantly; it needs opening hours');
  v := public.issue_4490_manage_hour('set_place', a2, jsonb_build_object('offerId', v_offer, 'spaceIds', jsonb_build_array(s->>'id')),
    (v->>'version')::bigint, 'p5-t9-place');
  v := public.issue_4490_manage_offer('upsert_price_option', a2, jsonb_build_object('offerId', v_offer, 'name', 'Per hour',
    'unit', 'hour', 'guestMin', 1, 'guestMax', 10, 'priceMinor', 1200000), (v->>'version')::bigint, 'p5-t9-price');
  v := public.issue_4490_manage_offer('set_policy', a2, jsonb_build_object('offerId', v_offer, 'refundLadder', jsonb_build_array(
    jsonb_build_object('minMinutesBefore', 1440, 'refundBps', 10000))), (v->>'version')::bigint, 'p5-t9-policy');
  v := public.issue_4490_manage_hour('set_hours', a2, jsonb_build_object('offerId', v_offer, 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
    'startTime', '08:00', 'endTime', '20:00'), (v->>'version')::bigint, 'p5-t9-hours');
  PERFORM public.t4490_ok((v->>'windowsCreated')::integer > 300, 'T-9b opening hours 08:00-20:00 every day: ' || (v->>'windowsCreated') || ' days');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_manage_hour('set_length', %L, jsonb_build_object('offerId', %L,
      'stepMinutes', 30, 'minMinutes', 45, 'maxMinutes', 120), %s, 'p5-t9-badlen')$q$, a2, v_offer, (v->>'version')),
    '22023', 'hour_length_invalid', 'T-9c a shortest booking off the 30-minute step is refused');
  v := public.issue_4490_manage_hour('set_length', a2, jsonb_build_object('offerId', v_offer, 'stepMinutes', 30, 'minMinutes', 60,
    'maxMinutes', 120), (v->>'version')::bigint, 'p5-t9-len');
  v := public.issue_4490_manage_hour('set_rules', a2, jsonb_build_object('offerId', v_offer, 'bufferBeforeMinutes', 0,
    'bufferAfterMinutes', 15, 'noShowReleaseMinutes', 15, 'staffCanStart', true), (v->>'version')::bigint, 'p5-t9-rules');
  PERFORM public.t4490_ok(v->'readiness' = '[]'::jsonb AND (v->'hour'->>'maxMinutes')::integer = 120
                          AND (v->'hour'->>'noShowReleaseMinutes')::integer = 15 AND (v->'hour'->>'pricePerHourMinor')::bigint = 1200000,
    'T-9d ready: N12,000 an hour, 30-minute steps, 1-2 hours, release after 15 min: ' || (v->'readiness')::text);
  v := public.issue_4490_manage_offer('publish', a2, jsonb_build_object('offerId', v_offer), (v->>'version')::bigint, 'p5-t9-pub');
  PERFORM public.t4490_ok(v->>'status' = 'live', 'T-9e the Boardroom is live');
  -- Pool table: 3 units, any one of them.
  v := public.issue_4490_manage_offer('create_draft', a2, '{"kind":"by_the_hour","name":"Pool table"}'::jsonb, NULL, 'p5-t9-pool-draft');
  v_pool := (v->>'id')::uuid;
  INSERT INTO t4490_ids VALUES ('pool', v_pool);
  v := public.issue_4490_manage_hour('set_place', a2, jsonb_build_object('offerId', v_pool,
    'units', jsonb_build_object('count', 3, 'name', 'Pool table', 'seats', 4)), (v->>'version')::bigint, 'p5-t9-pool-units');
  PERFORM public.t4490_ok(v->'hour'->>'allocation' = 'any_one' AND jsonb_array_length(v->'hour'->'places') = 3
                          AND v->'hour'->'places'->0->>'name' = 'Pool table 1', 'T-9f 3 units auto-named Pool table 1..3 (any one of)');
  v := public.issue_4490_manage_offer('upsert_price_option', a2, jsonb_build_object('offerId', v_pool, 'name', 'Per hour',
    'unit', 'hour', 'guestMin', 1, 'guestMax', 4, 'priceMinor', 500000), (v->>'version')::bigint, 'p5-t9-pool-price');
  v := public.issue_4490_manage_offer('set_policy', a2, jsonb_build_object('offerId', v_pool, 'refundLadder', '[]'::jsonb),
    (v->>'version')::bigint, 'p5-t9-pool-policy');
  v := public.issue_4490_manage_hour('set_hours', a2, jsonb_build_object('offerId', v_pool, 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
    'startTime', '12:00', 'endTime', '23:00'), (v->>'version')::bigint, 'p5-t9-pool-hours');
  v := public.issue_4490_manage_hour('set_length', a2, jsonb_build_object('offerId', v_pool, 'stepMinutes', 60, 'minMinutes', 60,
    'maxMinutes', 240), (v->>'version')::bigint, 'p5-t9-pool-len');
  v := public.issue_4490_manage_offer('publish', a2, jsonb_build_object('offerId', v_pool), (v->>'version')::bigint, 'p5-t9-pool-pub');
  PERFORM public.t4490_ok(v->>'status' = 'live', 'T-9g the pool tables are live');
END
$t9$;
SELECT public.t4490_reset();

SELECT public.t4490_as(NULL);
DO $t9b$
DECLARE
  v jsonb;
  v_row record;
BEGIN
  v := public.pg_venue_hour_day(public.t4490_id('board'), public.t4490_day(), 4);
  PERFORM public.t4490_ok(v->>'status' = 'open' AND (v->>'stepMinutes')::integer = 30
                          AND EXISTS (SELECT 1 FROM jsonb_array_elements(v->'starts') x
                                      WHERE (x->>'startsAt')::timestamptz = public.t4490_at('14:00') AND (x->>'maxMinutes')::integer = 120),
    'T-9h anyone reads the Boardroom day line: 14:00 free for up to 2 hours');
  SELECT * INTO v_row FROM public.pg_venue_offer_availability(public.t4490_id('board'), public.t4490_day(), public.t4490_day(), 4) a;
  PERFORM public.t4490_ok(v_row.status = 'available' AND v_row.price_minor = 1200000 AND v_row.remaining > 10,
    'T-9i the date strip says available, N12,000 an hour');
  PERFORM public.t4490_ok((SELECT x->>'unit' = 'hour' AND (x->>'fromMinor')::bigint = 500000
                           FROM jsonb_array_elements(public.pg_public_venue_page('harmattan-p5-4490', 'korap54490')->'offers') x
                           WHERE x->>'name' = 'Pool table'), 'T-9j the public page lists the pool tables from N5,000 an hour');
END
$t9b$;
SELECT public.t4490_reset();

SELECT public.t4490_service();
DO $t9c$
DECLARE
  v jsonb;
  g uuid;
BEGIN
  v := public.t4490_hour(public.t4490_id('board'), public.t4490_at('14:00'), 120, 4, 'p5-board-1');
  g := (v->>'groupId')::uuid;
  INSERT INTO t4490_ids VALUES ('board_g1', g);
  PERFORM public.t4490_ok((v->'quote'->>'subtotalMinor')::bigint = 2400000 AND (v->'quote'->>'taxMinor')::bigint = 180000
                          AND (v->'quote'->>'totalMinor')::bigint = 2580000,
    'T-9k Boardroom Thu 14:00 for 2 hours: 2 x N12,000 = N24,000 + VAT N1,800 = N25,800');
  PERFORM public.t4490_ok(v->>'state' = 'instant_payment_pending' AND v->'hour'->>'placeName' = 'Boardroom'
                          AND (SELECT count(*) FROM public.venue_space_claims c WHERE c.group_id = g AND c.state = 'held') = 1,
    'T-9l the hold claims the Boardroom (held until paid)');
  PERFORM public.t4490_expect($q$SELECT public.issue_4490_flexible_window(public.t4490_id('board'), public.t4490_at('09:00'), 150)$q$,
    '22023', 'offer_length_invalid', 'T-9m 2 hours 30 is longer than the longest booking');
  PERFORM public.t4490_expect($q$SELECT public.issue_4490_flexible_window(public.t4490_id('board'), public.t4490_at('09:10'), 60)$q$,
    'PT409', 'offer_wrong_time', 'T-9n 09:10 is not on the 30-minute steps');
  PERFORM public.t4490_expect($q$SELECT public.issue_4490_flexible_window(public.t4490_id('board'), public.t4490_at('19:30'), 60)$q$,
    'P0002', 'offer_window_unavailable', 'T-9o 19:30 for an hour runs past closing (20:00)');
  PERFORM public.t4490_expect($q$SELECT public.t4490_hour(public.t4490_id('board'), public.t4490_at('15:00'), 60, 2, 'p5-board-clash')$q$,
    'PT409', 'offer_space_taken', 'T-9p 15:00-16:00 overlaps the held 14:00-16:00');
  PERFORM public.t4490_expect($q$SELECT public.t4490_hour(public.t4490_id('board'), public.t4490_at('16:00'), 60, 2, 'p5-board-cleanup')$q$,
    'PT409', 'offer_space_taken', 'T-9q 16:00 collides with the 15-minute cleanup');
  v := public.t4490_hour(public.t4490_id('board'), public.t4490_at('16:30'), 60, 2, 'p5-board-after');
  PERFORM public.t4490_ok(v->>'state' = 'instant_payment_pending', 'T-9r 16:30 (after the cleanup) is free');
  v := public.t4490_pay(g, 'p5-board-1');
  PERFORM public.t4490_ok((SELECT state FROM public.stay_reservation_groups WHERE id = g) = 'confirmed'
                          AND (SELECT count(*) FROM public.venue_space_claims c WHERE c.group_id = g AND c.state = 'committed') = 1
                          AND (SELECT admits FROM public.venue_passes WHERE group_id = g) = 4,
    'T-9s paid: confirmed, the Boardroom committed, one pass for 4');
  v := public.issue_4490_booking_projection(g, NULL);
  PERFORM public.t4490_ok((v->'hour'->>'minutes')::integer = 120 AND v->'hour'->>'placeName' = 'Boardroom'
                          AND (v->'hour'->>'releaseIfNoShowAt')::timestamptz = public.t4490_at('14:15'),
    'T-9t the booking reads 2 hours in the Boardroom, released if nobody checks in by 14:15');
  v := public.pg_venue_hour_day(public.t4490_id('board'), public.t4490_day(), 2);
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'starts') x
                                      WHERE (x->>'startsAt')::timestamptz IN (public.t4490_at('13:00'), public.t4490_at('14:00'), public.t4490_at('15:00'), public.t4490_at('16:00')))
                          AND EXISTS (SELECT 1 FROM jsonb_array_elements(v->'starts') x
                                      WHERE (x->>'startsAt')::timestamptz = public.t4490_at('12:30') AND (x->>'maxMinutes')::integer = 60),
    'T-9u the day line: no start 13:00-16:00 (an hour from 13:00 would run into 14:00 with its cleanup), 12:30 free for 1 hour only');
END
$t9c$;
DO $t9d$
DECLARE
  v jsonb;
  i integer;
  v_units uuid[] := '{}';
BEGIN
  FOR i IN 1..3 LOOP
    v := public.t4490_hour(public.t4490_id('pool'), public.t4490_at('19:00'), 180, 2, 'p5-pool-' || i);
    v_units := v_units || (SELECT c.space_id FROM public.venue_space_claims c WHERE c.group_id = (v->>'groupId')::uuid);
  END LOOP;
  PERFORM public.t4490_ok((SELECT count(DISTINCT u) FROM unnest(v_units) u) = 3, 'T-9v three 19:00-22:00 bookings take Pool table 1, 2 and 3');
  PERFORM public.t4490_expect($q$SELECT public.t4490_hour(public.t4490_id('pool'), public.t4490_at('20:00'), 60, 2, 'p5-pool-4')$q$,
    'PT409', 'offer_space_taken', 'T-9w a fourth table at 20:00 for an hour: all three are taken (3-hour bookings block an overlapping hour)');
  v := public.t4490_hour(public.t4490_id('pool'), public.t4490_at('22:00'), 60, 2, 'p5-pool-5');
  PERFORM public.t4490_ok(v->>'state' = 'instant_payment_pending', 'T-9x 22:00 is free again');
END
$t9d$;
SELECT public.t4490_reset();
-- No-show: move the paid Boardroom booking's window to 20 minutes ago (time travel).
UPDATE public.stay_place_windows w SET starts_at = now() - interval '20 minutes', ends_at = now() + interval '100 minutes'
WHERE w.id = (SELECT public.issue_4490_group_window_id(public.t4490_id('board_g1')));
SELECT public.t4490_service();
DO $t9e$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_offer_sweep(50);
  PERFORM public.t4490_ok((v->>'noShowReleased')::integer = 1, 'T-9y the sweep releases the no-show: ' || v::text);
  PERFORM public.t4490_ok((SELECT count(*) FROM public.venue_space_claims c WHERE c.group_id = public.t4490_id('board_g1') AND c.state <> 'released') = 0
                          AND (SELECT status FROM public.venue_passes WHERE group_id = public.t4490_id('board_g1')) = 'void'
                          AND (public.issue_4490_booking_projection(public.t4490_id('board_g1'), NULL)->'hour'->>'released')::boolean,
    'T-9z the Boardroom is free again, the pass is void, the booking says released');
  v := public.issue_4490_offer_sweep(50);
  PERFORM public.t4490_ok((v->>'noShowReleased')::integer = 0, 'T-9aa a second sweep releases nothing more');
END
$t9e$;
SELECT public.t4490_reset();

-- ===========================================================================
-- T-10 Big-party request, RLS and grants.
-- ===========================================================================
SELECT public.t4490_service();
DO $t10$
DECLARE
  v_r public.reservations;
BEGIN
  v_r := public.pg_create_guest_reservation('44909000-0000-4000-9000-0000000000a1', public.t4490_at('19:00'), 20,
    'website', 'guest', NULL, 'Big Party', NULL, 'big-4490@example.test', NULL, 'NGN', NULL, 'none', NULL,
    NULL, 'Birthday', 'requested');
  PERFORM public.t4490_ok(v_r.status = 'requested' AND v_r.party_size = 20, 'T-10a 20 guests (above 8) send a big-party request');
END
$t10$;
SELECT public.t4490_reset();
UPDATE public.venue_features SET settings = '{"largePartyRequest":false}'::jsonb
WHERE venue_id = '44909000-0000-4000-9000-0000000000a1' AND feature_key = 'table_reservations';
SELECT public.t4490_service();
SELECT public.t4490_expect($q$SELECT public.pg_create_guest_reservation('44909000-0000-4000-9000-0000000000a1', public.t4490_at('19:00'), 20,
    'website', 'guest', NULL, 'Big Party', NULL, 'big2-4490@example.test', NULL, 'NGN', NULL, 'none', NULL,
    NULL, NULL, 'requested')$q$, 'P0001', 'slot_unavailable', 'T-10b with big-party requests off, 20 guests cannot book');
SELECT public.t4490_reset();
SELECT public.t4490_as('44909000-0000-4000-8000-000000000001');
SELECT public.t4490_ok((SELECT count(*) FROM public.venue_table_joins) = 1, 'T-10c the owner reads the venue''s table joins');
SELECT public.t4490_as('44909000-0000-4000-8000-000000000005');
SELECT public.t4490_ok((SELECT count(*) FROM public.venue_table_joins) = 0, 'T-10d an outsider reads no joins');
SELECT public.t4490_expect($q$INSERT INTO public.venue_table_joins (table_a, table_b) VALUES (gen_random_uuid(), gen_random_uuid())$q$,
  '42501', NULL, 'T-10e nobody writes joins directly');
SELECT public.t4490_expect($q$SELECT public.issue_4490_manage_hour('set_rules', '44909000-0000-4000-9000-0000000000a2', '{"offerId":"00000000-0000-4000-8000-000000000000"}'::jsonb, 1, 'p5-t10-outsider')$q$,
  '42501', 'not_authorized', 'T-10f an outsider cannot author by-the-hour offers');
SELECT public.t4490_as(NULL);
SELECT public.t4490_expect($q$SELECT public.issue_4490_flexible_window(gen_random_uuid(), now(), 60)$q$, '42501', NULL,
  'T-10g anon cannot make booking windows (service only)');
SELECT public.t4490_expect($q$SELECT public.issue_4490_table_slot_occupancy(gen_random_uuid(), now(), 2)$q$, '42501', NULL,
  'T-10h anon cannot call the occupancy helper');
SELECT public.t4490_expect($q$SELECT * FROM public.venue_table_joins$q$, '42501', NULL, 'T-10i anon cannot read joins');
-- N150 (#4490): issue_4490_enqueue_waitlist_message is a #1529 populating producer that writes an
-- explicit NULL country_code (the row's contact is an email; no SMS leg can
-- reach a handset from it). Assert it on the rows this suite enqueued.
SELECT public.t4490_service();
SELECT public.t4490_ok((SELECT count(*) FROM public.notification_outbox WHERE category_key LIKE 'venue\_waitlist\_%') > 0
  AND NOT EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key LIKE 'venue\_waitlist\_%' AND country_code IS NOT NULL),
  'T-11 the #4490 outbox rows carry an explicit NULL country_code (#1529)');
SELECT public.t4490_reset();
ROLLBACK;
