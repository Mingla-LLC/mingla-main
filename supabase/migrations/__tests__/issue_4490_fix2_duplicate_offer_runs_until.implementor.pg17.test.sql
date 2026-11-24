-- #4490 fix round 2 (20281203234490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-OFFER-COPY-IS-A-DRAFT | issue #4490 | issue_4490_duplicate_offer copies an offer of the venue (prices, rules, schedule, spaces, pool) as a new unpublished copy that sells nothing until published; never an offer of another venue, never for someone without venue.manage_offers.
-- MINGLA-INVARIANT: I-4490-SCHEDULE-SAVE-KEEPS-SELLING | issue #4490 | saving a live offer's schedule keeps every session the new rule makes again on sale; only sessions the rule no longer makes stop.
-- MINGLA-INVARIANT: I-4490-RUNS-UNTIL | issue #4490 | an offer's schedule end date ("Runs until") is enforced by the window maker: nothing is on sale after it, and an end before the start is refused (schedule_end_before_start).
--
-- D copy an offer (N5). R runs until (N82).
--
-- FAILS-ON-REVERT (seen): without 20281203234490 D-1a fails (function issue_4490_duplicate_offer does not exist)
-- and R-2 fails (an end date in the past is stored); without the reopen trigger R-0 fails (0 of 16 on sale).
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;
INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS', 'VENUE_OFFERS_WRITES']) k
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

-- People: 01 owner, 05 outsider, 06 signed-in member, 07 event manager (no money rights),
-- 08 venue staff with check-in only, 09 venue staff with venue.manage_members, 10 Mingla admin.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44907000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'f2u' || n || '-4490@example.test', now(), now()
FROM generate_series(1, 10) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44907000-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider, payout_hold_cutover_at, created_at, updated_at)
VALUES ('44907000-0000-4000-9000-000000000010', '44907000-0000-4000-8000-000000000001', 'Harmattan F2 4490',
        'harmattan-f2-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44907000-0000-4000-9000-0000000000a1', '44907000-0000-4000-9000-000000000010', 'koraf24490', 'Kora F2', 6.45, 3.41, 'coworking', 'verified', 'NG'),
  ('44907000-0000-4000-9000-0000000000a2', '44907000-0000-4000-9000-000000000010', 'studiof24490', 'Studio F2', 6.45, 3.42, 'creative_and_arts', 'verified', 'NG');
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44907000-0000-4000-c000-000000000007', '44907000-0000-4000-9000-000000000010', '44907000-0000-4000-8000-000000000007', 'event_manager', now()),
  ('44907000-0000-4000-c000-000000000008', '44907000-0000-4000-9000-000000000010', '44907000-0000-4000-8000-000000000008', 'venue_staff', now()),
  ('44907000-0000-4000-c000-000000000009', '44907000-0000-4000-9000-000000000010', '44907000-0000-4000-8000-000000000009', 'venue_staff', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44907000-0000-4000-c000-000000000008', '44907000-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.check_in']),
  ('44907000-0000-4000-c000-000000000009', '44907000-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.manage_members']);


CREATE TEMP TABLE t4490_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490_ids TO PUBLIC;
CREATE FUNCTION public.t4490_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$ SELECT v FROM t4490_ids WHERE k = p_k $f$;
GRANT EXECUTE ON FUNCTION public.t4490_id(text) TO PUBLIC;

-- ===========================================================================
-- Fixture (owner): a timed Entry at Kora (Mon-Sun 10:00-18:00, 30-minute
-- sessions every 30 minutes, 25 a session), two prices (Adult N4,000 and a
-- free Child with an Age 21+ check), a refund rule; published.
-- ===========================================================================
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
DO $fx$
DECLARE
  a1 uuid := '44907000-0000-4000-9000-0000000000a1';
  v jsonb;
  v_pool uuid;
  v_offer uuid;
BEGIN
  PERFORM public.issue_4490_set_venue_feature(a1, 'entry', true, NULL, NULL, NULL, 'f2-fx-entry');
  v := public.issue_4490_manage_capacity_pool('create', a1, '{"name":"Kora day","dailyLimit":400,"keptForWalkIns":0}'::jsonb, NULL, 'f2-fx-pool');
  v_pool := (v->>'id')::uuid;
  INSERT INTO t4490_ids VALUES ('pool', v_pool);
  v := public.issue_4490_manage_offer('create_draft', a1, '{"kind":"entry","name":"Play session","summary":"Socks on","entryStyle":"timed_session","sessionCapacity":25}'::jsonb, NULL, 'f2-fx-e1');
  v_offer := (v->>'id')::uuid;
  INSERT INTO t4490_ids VALUES ('timed', v_offer);
  v := public.issue_4490_manage_offer('set_pool', a1, jsonb_build_object('offerId', v_offer, 'poolId', v_pool), (v->>'version')::bigint, 'f2-fx-e2');
  v := public.issue_4490_manage_offer('upsert_price_option', a1, jsonb_build_object('offerId', v_offer, 'name', 'Adult', 'unit', 'guest',
    'guestMin', 1, 'guestMax', 6, 'priceMinor', 400000), (v->>'version')::bigint, 'f2-fx-e3');
  v := public.issue_4490_manage_offer('upsert_price_option', a1, jsonb_build_object('offerId', v_offer, 'name', 'Child', 'unit', 'guest',
    'guestMin', 1, 'guestMax', 4, 'priceMinor', 0, 'eligibility', jsonb_build_object('label', 'Age 21+', 'checkAtGate', true)),
    (v->>'version')::bigint, 'f2-fx-e4');
  v := public.issue_4490_manage_offer('set_policy', a1, jsonb_build_object('offerId', v_offer, 'refundLadder',
    jsonb_build_array(jsonb_build_object('minMinutesBefore', 1440, 'refundBps', 10000))), (v->>'version')::bigint, 'f2-fx-e5');
  v := public.issue_4490_manage_offer('set_schedule', a1, jsonb_build_object('offerId', v_offer, 'mode', 'sessions',
    'weekdays', jsonb_build_array(0,1,2,3,4,5,6), 'startTime', '10:00', 'endTime', '18:00',
    'sessionMinutes', 30, 'sessionEveryMinutes', 30), (v->>'version')::bigint, 'f2-fx-e6');
  v := public.issue_4490_manage_offer('publish', a1, jsonb_build_object('offerId', v_offer), (v->>'version')::bigint, 'f2-fx-e7');
  PERFORM public.t4490_ok(v->>'status' = 'live', 'fixture: the timed Play session is live');
  PERFORM public.t4490_ok((SELECT count(*) FROM public.stay_place_windows w WHERE w.offering_id = v_offer
                            AND w.local_date = (now() AT TIME ZONE 'Africa/Lagos')::date + 3 AND NOT w.stop_sell) = 16,
    'fixture: 10:00-18:00 with 30-minute sessions makes 16 sessions a day');
END
$fx$;

-- ===========================================================================
-- D Copy an offer as a draft (N5).
-- ===========================================================================
DO $d$
DECLARE
  a1 uuid := '44907000-0000-4000-9000-0000000000a1';
  v_src uuid := public.t4490_id('timed');
  v jsonb;
  v2 jsonb;
  v_copy uuid;
  v_pub jsonb;
BEGIN
  v := public.issue_4490_duplicate_offer(a1, v_src, 'f2-dup-1');
  v_copy := (v->>'id')::uuid;
  INSERT INTO t4490_ids VALUES ('copy', v_copy);
  PERFORM public.t4490_ok(v_copy IS NOT NULL AND v_copy <> v_src AND v->>'status' = 'draft' AND v->>'name' = 'Play session (copy)',
    'D-1a the copy is a new draft named "Play session (copy)"');
  PERFORM public.t4490_ok(
    (SELECT string_agg(o->>'name' || ':' || (o->>'priceMinor') || ':' || COALESCE(o->'eligibility'->>'label', '-'), ',' ORDER BY o->>'name')
     FROM jsonb_array_elements(v->'options') o) = 'Adult:400000:-,Child:0:Age 21+',
    'D-1b both prices come across with their amounts and the Age 21+ check');
  PERFORM public.t4490_ok((SELECT entry_style || ':' || capacity_pool_id || ':' || summary FROM public.stay_offerings WHERE id = v_copy)
      = 'timed_session:' || public.t4490_id('pool') || ':Socks on',
    'D-1c same style, same shared day pool, same one line');
  PERFORM public.t4490_ok((SELECT count(*) FROM public.stay_place_schedule_rules r WHERE r.offering_id = v_copy AND r.active
                            AND r.slot_duration_minutes = 30 AND r.slot_interval_minutes = 30 AND r.local_start_time = '10:00') = 1,
    'D-1d the session schedule comes across (30 minutes, every 30, from 10:00)');
  PERFORM public.t4490_ok((SELECT refund_ladder FROM public.stay_policy_versions WHERE offering_id = v_copy AND effective_to IS NULL)
      = jsonb_build_array(jsonb_build_object('min_minutes_before', 1440, 'refund_bps', 10000)),
    'D-1e the refund rule comes across');
  PERFORM public.t4490_ok((v->>'windowsCreated')::integer = 0, 'D-1f nothing is put on sale on the copy until it is published');
  PERFORM public.t4490_ok(jsonb_array_length(COALESCE(v->'readiness', '[]'::jsonb)) = 0,
    'D-2a the copy is ready to publish with no changes');
  v_pub := public.issue_4490_manage_offer('publish', a1, jsonb_build_object('offerId', v_copy), (v->>'version')::bigint, 'f2-dup-pub');
  PERFORM public.t4490_ok(v_pub->>'status' = 'live'
      AND (SELECT count(*) FROM public.venue_offer_price_options WHERE offering_id = v_src AND status = 'active') = 2
      AND (SELECT status FROM public.stay_offerings WHERE id = v_src) = 'live',
    'D-2b the copy publishes; the original keeps its two prices and stays live');
  v2 := public.issue_4490_duplicate_offer(a1, v_src, 'f2-dup-1');
  PERFORM public.t4490_ok((v2->>'id')::uuid = v_copy AND (v2->>'replayed')::boolean,
    'D-3 the same request again returns the same copy (no second copy)');
END
$d$;

SELECT public.t4490_reset();
SELECT public.t4490_ok((SELECT count(*) FROM public.stay_inventory_commitments WHERE offering_id = public.t4490_id('copy')) = 0
    AND (SELECT count(*) FROM public.stay_inventory_holds h JOIN public.stay_inventory_hold_slices sl ON sl.hold_id = h.id
         WHERE sl.offering_id = public.t4490_id('copy')) = 0,
  'D-1g nothing sold or held on the original is copied');
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT public.t4490_expect(
  format('SELECT public.issue_4490_duplicate_offer(%L, %L, %L)', '44907000-0000-4000-9000-0000000000a2', public.t4490_id('timed'), 'f2-dup-other'),
  'P0002', 'offer_not_found', 'D-5 an offer cannot be copied through another venue');
SELECT public.t4490_as('44907000-0000-4000-8000-000000000005');
SELECT public.t4490_expect(
  format('SELECT public.issue_4490_duplicate_offer(%L, %L, %L)', '44907000-0000-4000-9000-0000000000a1', public.t4490_id('timed'), 'f2-dup-out'),
  '42501', 'not_authorized', 'D-4a a signed-in stranger cannot copy an offer');
SELECT public.t4490_as(NULL);
SELECT public.t4490_expect(
  format('SELECT public.issue_4490_duplicate_offer(%L, %L, %L)', '44907000-0000-4000-9000-0000000000a1', public.t4490_id('timed'), 'f2-dup-anon'),
  '42501', NULL, 'D-4b a signed-out caller cannot copy an offer');

-- ===========================================================================
-- R Runs until (N82): the server stops selling after the end date.
-- ===========================================================================
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
DO $r$
DECLARE
  a1 uuid := '44907000-0000-4000-9000-0000000000a1';
  v_offer uuid := public.t4490_id('timed');
  v_today date := (now() AT TIME ZONE 'Africa/Lagos')::date;
  v jsonb;
BEGIN
  v := public.issue_4490_manage_offer('set_schedule', a1, jsonb_build_object('offerId', v_offer, 'mode', 'sessions',
    'weekdays', jsonb_build_array(0,1,2,3,4,5,6), 'startTime', '10:00', 'endTime', '18:00',
    'sessionMinutes', 30, 'sessionEveryMinutes', 30),
    (SELECT o.version FROM public.stay_offerings o WHERE o.id = v_offer), 'f2-same-schedule');
  PERFORM public.t4490_ok((SELECT count(*) FROM public.stay_place_windows w WHERE w.offering_id = v_offer
                            AND w.local_date = v_today + 3 AND NOT w.stop_sell) = 16,
    'R-0 saving the same schedule again keeps all 16 sessions of a day on sale (they were all stopped before)');
  v := public.issue_4490_manage_offer('set_schedule', a1, jsonb_build_object('offerId', v_offer, 'mode', 'sessions',
    'weekdays', jsonb_build_array(0,1,2,3,4,5,6), 'startTime', '10:00', 'endTime', '18:00',
    'sessionMinutes', 30, 'sessionEveryMinutes', 30, 'endDate', (v_today + 2)::text),
    (SELECT o.version FROM public.stay_offerings o WHERE o.id = v_offer), 'f2-runs-until');
  PERFORM public.t4490_ok((v->'schedule'->>'endDate') = (v_today + 2)::text, 'R-1a the schedule reads "runs until" two days from now');
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.stay_place_windows w WHERE w.offering_id = v_offer
                            AND w.local_date > v_today + 2 AND NOT w.stop_sell),
    'R-1b no session is on sale after the end date');
  PERFORM public.t4490_ok((SELECT count(*) FROM public.stay_place_windows w WHERE w.offering_id = v_offer
                            AND w.local_date = v_today + 2 AND NOT w.stop_sell) = 16,
    'R-1c the last day still has its 16 sessions');
  PERFORM public.t4490_ok(NOT EXISTS (
      SELECT 1 FROM public.pg_venue_offer_availability(v_offer, v_today + 3, v_today + 5, NULL, NULL) a
      WHERE a.status = 'available'),
    'R-1d a guest finds nothing to buy after the end date');
END
$r$;
SELECT public.t4490_expect(
  format($q$SELECT public.issue_4490_manage_offer('set_schedule', %L, jsonb_build_object('offerId', %L, 'mode', 'sessions',
    'weekdays', jsonb_build_array(0,1,2,3,4,5,6), 'startTime', '10:00', 'endTime', '18:00', 'sessionMinutes', 30,
    'sessionEveryMinutes', 30, 'endDate', %L), (SELECT o.version FROM public.stay_offerings o WHERE o.id = %L), 'f2-runs-past')$q$,
    '44907000-0000-4000-9000-0000000000a1', public.t4490_id('timed'), ((now() AT TIME ZONE 'Africa/Lagos')::date - 1)::text,
    public.t4490_id('timed')),
  '22023', 'schedule_end_before_start', 'R-2 an end date before today is refused in plain terms');

SELECT public.t4490_reset();
ROLLBACK;
