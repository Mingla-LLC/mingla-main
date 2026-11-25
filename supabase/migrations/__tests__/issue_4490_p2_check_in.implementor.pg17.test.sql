-- #4490 P2-3 (check-in, 20281203094490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-CHECK-IN | issue #4490 | a pass admits at most its guests, only on its day, at its venue, after the ID check when its options need one; undo is for 10 minutes and once; the log is append-only; event tickets at the venue are delegated to biz_ticket_scan.
--
-- K-1 partial admits, already used, wrong day, ID check, forged / random codes.
-- K-2 undo (once, within 10 minutes). K-3 authority and venue scope, pepper. K-4 append-only log.
-- K-5 gate sale draws kept seats, cash creates no payment row, replay, pay-by-code, list, Today numbers.
-- K-6 event tickets: delegated admit, duplicate, another venue's event -> wrong_venue. K-7 void after cancel.
--
-- FAILS-ON-REVERT: drop the id_check branch in issue_4490_admit_pass -> K-1e.
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

-- People: 01 owner, 02 finance manager, 03 venue staff (check-in), 04 scanner member,
-- 05 outsider, 06 signed-in guest, 07 event manager.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44907000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p2u' || n || '-4490@example.test', now(), now()
FROM generate_series(1, 7) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44907000-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider, payout_hold_cutover_at, created_at, updated_at)
VALUES ('44907000-0000-4000-9000-000000000010', '44907000-0000-4000-8000-000000000001', 'Harmattan P2 4490',
        'harmattan-p2-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44907000-0000-4000-c000-000000000002', '44907000-0000-4000-9000-000000000010', '44907000-0000-4000-8000-000000000002', 'finance_manager', now()),
  ('44907000-0000-4000-c000-000000000003', '44907000-0000-4000-9000-000000000010', '44907000-0000-4000-8000-000000000003', 'venue_staff', now()),
  ('44907000-0000-4000-c000-000000000004', '44907000-0000-4000-9000-000000000010', '44907000-0000-4000-8000-000000000004', 'scanner', now()),
  ('44907000-0000-4000-c000-000000000007', '44907000-0000-4000-9000-000000000010', '44907000-0000-4000-8000-000000000007', 'event_manager', now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44907000-0000-4000-9000-0000000000a1', '44907000-0000-4000-9000-000000000010', 'gamelandp24490', 'Gameland P2', 6.45, 3.40, 'play', 'verified', 'NG'),
  ('44907000-0000-4000-9000-0000000000a2', '44907000-0000-4000-9000-000000000010', 'arcadep24490', 'Arcade P2', 6.45, 3.41, 'play', 'verified', 'NG'),
  ('44907000-0000-4000-9000-0000000000a3', '44907000-0000-4000-9000-000000000010', 'stayp24490', 'Stay P2', 6.46, 3.42, 'stay', 'verified', 'NG');
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44907000-0000-4000-c000-000000000003', '44907000-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.check_in']::text[]);

-- Owner switches Entry on for both play venues.
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
DO $fe$
BEGIN
  PERFORM public.issue_4490_set_venue_feature('44907000-0000-4000-9000-0000000000a1', 'entry', true, NULL, NULL, NULL, 'p2-fx-entry-a1');
  PERFORM public.issue_4490_set_venue_feature('44907000-0000-4000-9000-0000000000a2', 'entry', true, NULL, NULL, NULL, 'p2-fx-entry-a2');
END
$fe$;

-- Owner builds the Gameland entry offer: pool 300 / 50, Walk-in N5,000 every
-- day, Student N4,000 Mon-Thu (ID at the gate), all day 12:00-00:00.
CREATE TEMP TABLE t4490_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490_ids TO PUBLIC;
DO $fx$
DECLARE
  v jsonb;
  v_pool uuid;
  v_offer uuid;
  v_ver bigint;
BEGIN
  v := public.issue_4490_manage_capacity_pool('create', '44907000-0000-4000-9000-0000000000a1',
    '{"name":"Gameland day","dailyLimit":300,"keptForWalkIns":50}'::jsonb, NULL, 'p2-fx-pool-1');
  v_pool := (v->>'id')::uuid;
  INSERT INTO t4490_ids VALUES ('pool', v_pool);
  v := public.issue_4490_manage_offer('create_draft', '44907000-0000-4000-9000-0000000000a1',
    '{"kind":"entry","name":"Entry","entryStyle":"walk_in"}'::jsonb, NULL, 'p2-fx-offer-1');
  v_offer := (v->>'id')::uuid; v_ver := (v->>'version')::bigint;
  INSERT INTO t4490_ids VALUES ('offer', v_offer);
  v := public.issue_4490_manage_offer('set_pool', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'poolId', v_pool), v_ver, 'p2-fx-offer-2');
  v_ver := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('upsert_price_option', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'name', 'Walk-in', 'unit', 'guest', 'guestMin', 1, 'guestMax', 20,
      'priceMinor', 500000), v_ver, 'p2-fx-offer-3');
  v_ver := (v->>'version')::bigint;
  INSERT INTO t4490_ids SELECT 'walkin', (o->>'id')::uuid FROM jsonb_array_elements(v->'options') o WHERE o->>'name' = 'Walk-in';
  v := public.issue_4490_manage_offer('upsert_price_option', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'name', 'Student & NYSC', 'unit', 'guest', 'guestMin', 1, 'guestMax', 20,
      'priceMinor', 400000, 'weekdays', jsonb_build_array(0, 1, 2, 3),
      'eligibility', jsonb_build_object('label', 'Student or NYSC ID', 'checkAtGate', true)), v_ver, 'p2-fx-offer-4');
  v_ver := (v->>'version')::bigint;
  INSERT INTO t4490_ids SELECT 'student', (o->>'id')::uuid FROM jsonb_array_elements(v->'options') o WHERE o->>'name' = 'Student & NYSC';
  v := public.issue_4490_manage_offer('set_policy', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'refundLadder', jsonb_build_array(
      jsonb_build_object('minMinutesBefore', 1440, 'refundBps', 10000),
      jsonb_build_object('minMinutesBefore', 0, 'refundBps', 5000)),
      'dateChangeRule', jsonb_build_object('allowedUntilMinutesBefore', 120, 'feeBps', 0)), v_ver, 'p2-fx-offer-5');
  v_ver := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('set_schedule', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'mode', 'full_day', 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
      'startTime', '00:00', 'endTime', '23:59'), v_ver, 'p2-fx-offer-6');
  v_ver := (v->>'version')::bigint;
  INSERT INTO t4490_ids VALUES ('offer_version_before_publish', NULL);
END
$fx$;
SELECT public.t4490_reset();

-- Helpers (as in the checkout suite).
CREATE FUNCTION public.t4490_win(p_offer uuid, p_date date)
RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM public.stay_place_windows WHERE offering_id = p_offer AND local_date = p_date ORDER BY starts_at LIMIT 1;
$f$;
CREATE FUNCTION public.t4490_key(p_seed text)
RETURNS text LANGUAGE sql AS $f$ SELECT encode(sha256(convert_to(p_seed, 'UTF8')), 'hex') $f$;
CREATE FUNCTION public.t4490_buy_paid(p_offer uuid, p_date date, p_lines jsonb, p_seed text)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_q jsonb;
  v_g jsonb;
  v_p jsonb;
  v_ref text;
BEGIN
  v_q := public.issue_4490_quote_offer(p_offer, public.t4490_win(p_offer, p_date), p_lines,
    public.t4490_key('cart:' || p_seed), NULL, 'quote-' || p_seed);
  v_g := public.issue_4490_create_offer_group(gen_random_uuid(), (v_q->>'quoteId')::uuid,
    jsonb_build_object('name', 'Guest ' || p_seed, 'email', 'g-' || p_seed || '@example.test'),
    public.t4490_key('cart:' || p_seed), NULL, sha256(convert_to('tok:' || p_seed, 'UTF8')), 'hold-' || p_seed);
  v_p := public.issue_4490_prepare_offer_payment((v_g->>'groupId')::uuid, sha256(convert_to('tok:' || p_seed, 'UTF8')), NULL,
    'pay-key-' || p_seed, (v_g->>'version')::bigint);
  v_ref := 'mingla_stay_' || replace(v_p->>'attemptId', '-', '');
  PERFORM public.issue_1389_bind_payment_attempt((v_p->>'attemptId')::uuid, v_ref, NULL, NULL);
  PERFORM public.issue_1389_finalize_payment('paystack', 'evt-' || p_seed, 'charge.success', v_ref, 'ch-' || p_seed,
    (v_p->>'amountMinor')::bigint, 'NGN', 0, NULL);
  RETURN (v_g->>'groupId')::uuid;
END
$f$;
CREATE FUNCTION public.t4490_qr(p_group uuid)
RETURNS text LANGUAGE sql AS $f$
  SELECT public.issue_4490_get_offer_booking(p_group, (SELECT buyer_token_hash FROM public.stay_reservation_groups WHERE id = p_group),
    NULL, 'p2-test-pepper-0123456789abcdef-4490')->'passes'->0->>'qrPayload';
$f$;
GRANT EXECUTE ON FUNCTION public.t4490_win(uuid, date), public.t4490_key(text), public.t4490_buy_paid(uuid, date, jsonb, text),
  public.t4490_qr(uuid) TO PUBLIC;

SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
DO $pub$
BEGIN
  PERFORM public.issue_4490_manage_offer('publish', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer')),
    (SELECT version FROM public.stay_offerings WHERE id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer')), 'p2-k-pub');
END
$pub$;
SELECT public.t4490_reset();
CREATE TEMP TABLE t4490_dates ON COMMIT DROP AS
SELECT public.issue_4490_venue_local_date('44907000-0000-4000-9000-0000000000a1') AS today;
GRANT SELECT ON t4490_dates TO PUBLIC;
CREATE TEMP TABLE t4490_groups (k text PRIMARY KEY, v uuid, qr text) ON COMMIT DROP;
GRANT ALL ON t4490_groups TO PUBLIC;

-- Bookings: 5 walk-ins today, 1 walk-in tomorrow, 2 walk-ins + 1 student today
-- (if today is Mon-Thu the Student option applies; else a 2nd walk-in party).
SELECT public.t4490_service();
DO $bk$
DECLARE
  v uuid;
  v_dow integer := extract(isodow FROM (SELECT today FROM t4490_dates))::integer;
BEGIN
  v := public.t4490_buy_paid((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), (SELECT today FROM t4490_dates),
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 5)), 'k-five');
  INSERT INTO t4490_groups VALUES ('five', v, public.t4490_qr(v));
  v := public.t4490_buy_paid((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), (SELECT today FROM t4490_dates) + 1,
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 1)), 'k-tomorrow');
  INSERT INTO t4490_groups VALUES ('tomorrow', v, public.t4490_qr(v));
  IF v_dow BETWEEN 1 AND 4 THEN
    v := public.t4490_buy_paid((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), (SELECT today FROM t4490_dates),
      jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 2),
                        jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'student'), 'guests', 1)), 'k-student');
  ELSE
    -- Weekend: mark the walk-in option as ID-checked for this run so the ID rule is still exercised.
    UPDATE public.venue_offer_price_options SET eligibility = '{"label":"Age 18+ ID","check_at_gate":true}'::jsonb
    WHERE id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin');
    v := public.t4490_buy_paid((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), (SELECT today FROM t4490_dates),
      jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 3)), 'k-student');
    UPDATE public.venue_offer_price_options SET eligibility = NULL WHERE id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin');
  END IF;
  INSERT INTO t4490_groups VALUES ('student', v, public.t4490_qr(v));
END
$bk$;

-- ===========================================================================
-- K-1 partial admits, already used, wrong day, ID check.
-- ===========================================================================
DO $k1$
DECLARE
  v jsonb;
  v_pepper text := 'p2-test-pepper-0123456789abcdef-4490';
  v_staff uuid := '44907000-0000-4000-8000-000000000003';
  v_log uuid;
BEGIN
  v := public.issue_4490_check_in_scan('44907000-0000-4000-9000-0000000000a1', (SELECT g.qr FROM t4490_groups g WHERE g.k = 'five'),
    2, false, v_staff, v_pepper);
  PERFORM public.t4490_ok(v->>'result' = 'admitted' AND (v->>'admitted')::int = 2 AND (v->'pass'->>'remaining')::int = 3
      AND (v->>'balanceDueMinor')::int = 0, 'K-1a check-in staff admit 2 of 5');
  v := public.issue_4490_check_in_scan('44907000-0000-4000-9000-0000000000a1', (SELECT g.qr FROM t4490_groups g WHERE g.k = 'five'),
    3, false, v_staff, v_pepper);
  PERFORM public.t4490_ok(v->>'result' = 'admitted' AND (v->'pass'->>'admittedCount')::int = 5, 'K-1b then 3 more');
  v_log := (v->>'logId')::uuid;
  INSERT INTO t4490_ids VALUES ('k1_log', v_log);
  v := public.issue_4490_check_in_scan('44907000-0000-4000-9000-0000000000a1', (SELECT g.qr FROM t4490_groups g WHERE g.k = 'five'),
    NULL, false, v_staff, v_pepper);
  PERFORM public.t4490_ok(v->>'result' = 'already_used' AND v->'pass'->>'lastAdmittedAt' IS NOT NULL,
    'K-1c a third scan -> already_used, with when they came in');
  v := public.issue_4490_check_in_scan('44907000-0000-4000-9000-0000000000a1', (SELECT g.qr FROM t4490_groups g WHERE g.k = 'tomorrow'),
    NULL, false, v_staff, v_pepper);
  PERFORM public.t4490_ok(v->>'result' = 'wrong_day' AND v->'pass'->>'dayLabel' IS NOT NULL
      AND (v->'pass'->>'admittedCount')::int = 0, 'K-1d tomorrow''s pass today -> wrong_day (' || (v->'pass'->>'dayLabel') || '), nothing admitted');
  v := public.issue_4490_check_in_scan('44907000-0000-4000-9000-0000000000a1', (SELECT g.qr FROM t4490_groups g WHERE g.k = 'student'),
    NULL, false, v_staff, v_pepper);
  PERFORM public.t4490_ok(v->>'result' = 'id_required' AND v->'pass'->>'idCheckLabel' IS NOT NULL
      AND (v->'pass'->>'admittedCount')::int = 0, 'K-1e an ID-checked pass waits for "ID checked?" (id_required, no admit)');
  v := public.issue_4490_check_in_scan('44907000-0000-4000-9000-0000000000a1', (SELECT g.qr FROM t4490_groups g WHERE g.k = 'student'),
    NULL, true, v_staff, v_pepper);
  PERFORM public.t4490_ok(v->>'result' = 'admitted' AND (v->'pass'->>'admittedCount')::int = 3 AND v->'pass'->>'idCheckedAt' IS NOT NULL,
    'K-1f confirmed -> all 3 admitted');
  v := public.issue_4490_check_in_scan('44907000-0000-4000-9000-0000000000a1',
    regexp_replace((SELECT g.qr FROM t4490_groups g WHERE g.k = 'five'), ':sig:.*$', ':sig:' || repeat('0', 64)),
    NULL, false, v_staff, v_pepper);
  PERFORM public.t4490_ok(v->>'result' = 'not_found', 'K-1g a forged signature -> not_found');
  v := public.issue_4490_check_in_scan('44907000-0000-4000-9000-0000000000a1', 'hello', NULL, false, v_staff, v_pepper);
  PERFORM public.t4490_ok(v->>'result' = 'not_found', 'K-1h a random code -> not_found');
END
$k1$;

-- ===========================================================================
-- K-2 undo; K-3 authority and venue scope; K-4 log append-only.
-- ===========================================================================
DO $k2$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_check_in_undo('44907000-0000-4000-9000-0000000000a1', (SELECT t.v FROM t4490_ids t WHERE t.k = 'k1_log'),
    '44907000-0000-4000-8000-000000000003');
  PERFORM public.t4490_ok(v->>'result' = 'undone' AND (v->>'undid')::int = 3 AND (v->'pass'->>'admittedCount')::int = 2,
    'K-2a undo the last admit (3) within 10 minutes -> 2 admitted');
  BEGIN
    PERFORM public.issue_4490_check_in_undo('44907000-0000-4000-9000-0000000000a1', (SELECT t.v FROM t4490_ids t WHERE t.k = 'k1_log'),
      '44907000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'T4490 FAIL: K-2b';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    PERFORM public.t4490_ok(SQLERRM = 'check_in_already_undone', 'K-2b the same admit cannot be undone twice');
  END;
END
$k2$;
SELECT public.t4490_reset();
INSERT INTO public.venue_check_in_log (venue_id, brand_id, pass_id, result, admitted_delta, method, local_date, created_at)
SELECT p.venue_id, p.brand_id, p.id, 'admitted', 1, 'scan', p.valid_local_date, now() - interval '11 minutes'
FROM public.venue_passes p WHERE p.group_id = (SELECT v FROM t4490_groups WHERE k = 'five')
RETURNING id AS old_log \gset
SELECT public.t4490_service();
SELECT public.t4490_expect(format($$SELECT public.issue_4490_check_in_undo('44907000-0000-4000-9000-0000000000a1', %L,
  '44907000-0000-4000-8000-000000000003')$$, :'old_log'), 'PT409', 'check_in_undo_too_late', 'K-2c an admit older than 10 minutes cannot be undone');
SELECT public.t4490_expect(format($$SELECT public.issue_4490_check_in_scan('44907000-0000-4000-9000-0000000000a1', %L, NULL, false,
  '44907000-0000-4000-8000-000000000005', 'p2-test-pepper-0123456789abcdef-4490')$$, (SELECT qr FROM t4490_groups WHERE k = 'five')),
  '42501', 'not_authorized', 'K-3a an outsider cannot check in');
SELECT public.t4490_ok((public.issue_4490_check_in_scan('44907000-0000-4000-9000-0000000000a1', (SELECT qr FROM t4490_groups WHERE k = 'tomorrow'),
    NULL, false, '44907000-0000-4000-8000-000000000004', 'p2-test-pepper-0123456789abcdef-4490')->>'result') = 'wrong_day',
  'K-3b a brand scanner (rank scanner) can check in');
SELECT public.t4490_expect(format($$SELECT public.issue_4490_check_in_scan('44907000-0000-4000-9000-0000000000a2', %L, NULL, false,
  '44907000-0000-4000-8000-000000000003', 'p2-test-pepper-0123456789abcdef-4490')$$, (SELECT qr FROM t4490_groups WHERE k = 'five')),
  '42501', 'not_authorized', 'K-3c venue staff granted check-in at one venue cannot check in at another');
SELECT public.t4490_ok((public.issue_4490_check_in_scan('44907000-0000-4000-9000-0000000000a2', (SELECT qr FROM t4490_groups WHERE k = 'five'),
    NULL, false, '44907000-0000-4000-8000-000000000004', 'p2-test-pepper-0123456789abcdef-4490')->>'result') = 'wrong_venue',
  'K-3d a Gameland pass scanned at Arcade -> wrong_venue');
SELECT public.t4490_expect(format($$SELECT public.issue_4490_check_in_scan('44907000-0000-4000-9000-0000000000a1', %L, NULL, false,
  '44907000-0000-4000-8000-000000000003', 'short')$$, (SELECT qr FROM t4490_groups WHERE k = 'five')),
  'P0001', 'qr_token_pepper_missing', 'K-3e the scan refuses to run without the ticket pepper');
SELECT public.t4490_reset();
SELECT public.t4490_as('44907000-0000-4000-8000-000000000003');
SELECT public.t4490_expect($$SELECT public.issue_4490_check_in_list('44907000-0000-4000-9000-0000000000a1', NULL, auth.uid())$$,
  '42501', NULL, 'K-3f the check-in RPCs are not callable from a client (edge function only)');
SELECT public.t4490_reset();
SELECT public.t4490_expect($$UPDATE public.venue_check_in_log SET admitted_delta = 99$$, '55000', 'check_in_log_append_only',
  'K-4a the check-in log cannot be edited');
SELECT public.t4490_expect($$DELETE FROM public.venue_check_in_log$$, '55000', 'check_in_log_append_only',
  'K-4b or deleted');

-- ===========================================================================
-- K-5 gate sale draws walk-in seats; the list and the Today numbers.
-- ===========================================================================
SELECT public.t4490_service();
DO $k5$
DECLARE
  v_before record;
  v_after record;
  v jsonb;
BEGIN
  SELECT * INTO v_before FROM public.issue_4490_pool_day_usage((SELECT t.v FROM t4490_ids t WHERE t.k = 'pool'), (SELECT today FROM t4490_dates));
  v := public.issue_4490_gate_sale('44907000-0000-4000-9000-0000000000a1', (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'),
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 2)),
    'cash', '{"name":"Door pair"}'::jsonb, 'p2-k5-gate-cash', '44907000-0000-4000-8000-000000000003');
  SELECT * INTO v_after FROM public.issue_4490_pool_day_usage((SELECT t.v FROM t4490_ids t WHERE t.k = 'pool'), (SELECT today FROM t4490_dates));
  PERFORM public.t4490_ok(v_after.kept_left = v_before.kept_left - 2 AND v_after.online_left = v_before.online_left,
    'K-5a a gate sale of 2 takes 2 kept-for-walk-ins seats; online stock unchanged (' || v_before.kept_left || ' -> ' || v_after.kept_left || ')');
  PERFORM public.t4490_ok(v->'admit'->>'result' = 'admitted' AND (v->'booking'->>'paymentCollection') = 'property'
      AND v->'booking'->>'state' = 'confirmed' AND (v->'booking'->>'paidMinor')::bigint = 0,
    'K-5b cash at the gate: confirmed, money with the venue (no provider payment), pass already admitted');
  PERFORM public.t4490_ok((SELECT count(*) FROM public.stay_payment_attempts a
      WHERE a.group_id = (v->'booking'->>'groupId')::uuid) = 0, 'K-5c no payment row is invented for cash');
  v := public.issue_4490_gate_sale('44907000-0000-4000-9000-0000000000a1', (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'),
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 2)),
    'cash', '{"name":"Door pair"}'::jsonb, 'p2-k5-gate-cash', '44907000-0000-4000-8000-000000000003');
  PERFORM public.t4490_ok((v->>'replayed')::boolean, 'K-5d a repeated gate sale (same key) is not sold twice');
  v := public.issue_4490_gate_sale('44907000-0000-4000-9000-0000000000a1', (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'),
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 1)),
    'pay_link', '{"name":"Phone payer","email":"phone-payer-4490@example.test"}'::jsonb, 'p2-k5-gate-link',
    '44907000-0000-4000-8000-000000000003', gen_random_uuid(), sha256('tok:k5-link'::bytea));
  PERFORM public.t4490_ok(v->'booking'->>'state' = 'instant_payment_pending' AND v->'booking'->>'paymentCollection' = 'mingla'
      AND (v->'booking'->>'amountDueNowMinor')::bigint > 0,
    'K-5e pay-by-code: a held walk-in booking the guest pays on their phone');
  PERFORM public.t4490_ok((public.issue_4490_prepare_offer_payment((v->'booking'->>'groupId')::uuid, sha256('tok:k5-link'::bytea), NULL,
      'pay-k5-link', (v->'booking'->>'version')::bigint)->>'provider') = 'paystack',
    'K-5f and the guest''s phone can pay it with the booking code');
  v := public.issue_4490_check_in_list('44907000-0000-4000-9000-0000000000a1', NULL, '44907000-0000-4000-8000-000000000003');
  PERFORM public.t4490_ok(jsonb_array_length(v->'passes') >= 3 AND (v->'totals'->>'admitted')::int >= 7,
    'K-5g the day''s list shows the passes and who is in');
END
$k5$;
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT public.t4490_ok((SELECT (p->>'walkInLeft')::int = 47 AND (p->>'soldAtGate')::int = 3 AND (p->>'dailyLimit')::int = 300
    FROM jsonb_array_elements(public.issue_4490_venue_day('44907000-0000-4000-9000-0000000000a1', NULL)->'pools') p),
  'K-5h Today: kept for walk-ins 50 -> 47 after 2 paid in cash and 1 held for pay-by-code (3 at the gate)');
SELECT public.t4490_as('44907000-0000-4000-8000-000000000005');
SELECT public.t4490_expect($$SELECT public.issue_4490_venue_day('44907000-0000-4000-9000-0000000000a1', NULL)$$,
  '42501', 'not_authorized', 'K-5i an outsider cannot read the venue day');
SELECT public.t4490_reset();

-- ===========================================================================
-- K-6 event tickets: delegated to biz_ticket_scan; another venue's event -> wrong_venue.
-- ===========================================================================
DO $k6$
DECLARE
  v_here uuid := gen_random_uuid();
  v_there uuid := gen_random_uuid();
  v_tt_here uuid;
  v_tt_there uuid;
  v_qr_here text;
  v_qr_there text;
  v jsonb;
  v_pepper text := 'p2-test-pepper-0123456789abcdef-4490';
  v_owner uuid := '44907000-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone, is_multi_date, is_recurring, venue_id)
  VALUES (v_here, '44907000-0000-4000-9000-000000000010', 'Karaoke Night', 'karaoke-' || v_here, 'event', 'draft', 'draft', 'UTC', false, false,
          '44907000-0000-4000-9000-0000000000a1'),
         (v_there, '44907000-0000-4000-9000-000000000010', 'Arcade Night', 'arcade-' || v_there, 'event', 'draft', 'draft', 'UTC', false, false,
          '44907000-0000-4000-9000-0000000000a2');
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
    (v_here, now() - interval '1 hour', now() + interval '5 hours', 'UTC', true),
    (v_there, now() - interval '1 hour', now() + interval '5 hours', 'UTC', true);
  INSERT INTO public.ticket_types(event_id, name, price_cents, is_free, quantity_total, min_purchase_qty, available_online, available_in_person, display_order)
  VALUES (v_here, 'Entry', 0, true, 20, 1, true, true, 0) RETURNING id INTO v_tt_here;
  INSERT INTO public.ticket_types(event_id, name, price_cents, is_free, quantity_total, min_purchase_qty, available_online, available_in_person, display_order)
  VALUES (v_there, 'Entry', 0, true, 20, 1, true, true, 0) RETURNING id INTO v_tt_there;
  PERFORM set_config('mingla.publish_free_only', 'on', true);
  UPDATE public.events SET status = 'scheduled', visibility = 'public', published_at = now() WHERE id IN (v_here, v_there);
  PERFORM set_config('mingla.publish_free_only', '', true);
  PERFORM public.biz_comp_issue(v_owner, v_here, v_tt_here, NULL,
    jsonb_build_array(jsonb_build_object('index', 0, 'name', 'Karaoke Guest')), NULL, gen_random_uuid(), v_pepper);
  PERFORM public.biz_comp_issue(v_owner, v_there, v_tt_there, NULL,
    jsonb_build_array(jsonb_build_object('index', 0, 'name', 'Arcade Guest')), NULL, gen_random_uuid(), v_pepper);
  SELECT t.qr_code INTO v_qr_here FROM public.tickets t WHERE t.event_id = v_here LIMIT 1;
  SELECT t.qr_code INTO v_qr_there FROM public.tickets t WHERE t.event_id = v_there LIMIT 1;
  PERFORM public.t4490_service();
  v := public.issue_4490_check_in_scan('44907000-0000-4000-9000-0000000000a1', v_qr_here, NULL, false, v_owner, v_pepper);
  PERFORM public.t4490_ok(v->>'result' = 'admitted' AND v->>'kind' = 'event_ticket' AND v->'ticket'->>'holderName' = 'Karaoke Guest',
    'K-6a an event ticket for an event at this venue is delegated to the ticket scan and admitted');
  v := public.issue_4490_check_in_scan('44907000-0000-4000-9000-0000000000a1', v_qr_here, NULL, false, v_owner, v_pepper);
  PERFORM public.t4490_ok(v->>'result' = 'already_used', 'K-6b scanned again -> already_used (ticket duplicate)');
  v := public.issue_4490_check_in_scan('44907000-0000-4000-9000-0000000000a1', v_qr_there, NULL, false, v_owner, v_pepper);
  PERFORM public.t4490_ok(v->>'result' = 'wrong_venue', 'K-6c a ticket for an event at another venue -> wrong_venue');
  PERFORM public.t4490_ok((SELECT count(*) FROM public.scan_events WHERE ticket_id IN (SELECT id FROM public.tickets WHERE event_id = v_there)) = 0,
    'K-6d and the other venue''s ticket is not touched');
  v := public.issue_4490_check_in_list('44907000-0000-4000-9000-0000000000a1', (now() AT TIME ZONE 'UTC')::date, v_owner);
  PERFORM public.t4490_ok(EXISTS (SELECT 1 FROM jsonb_array_elements(v->'tickets') t WHERE t->>'holderName' = 'Karaoke Guest'),
    'K-6e the day''s list includes event tickets for events at the venue');
  PERFORM public.t4490_reset();
END
$k6$;

-- K-7 a cancelled booking's pass is void at the gate.
SELECT public.t4490_as('44907000-0000-4000-8000-000000000002');
DO $k7$
DECLARE
  v_pv jsonb;
  v_ids uuid[];
BEGIN
  v_pv := public.issue_4490_cancel_preview((SELECT g.v FROM t4490_groups g WHERE g.k = 'tomorrow'));
  SELECT array_agg((x #>> '{}')::uuid) INTO v_ids FROM jsonb_array_elements(v_pv->'previewIds') x;
  PERFORM public.issue_4490_cancel(v_ids, v_pv->>'previewHash', 'p2-k7-cancel', 'Duplicate booking');
END
$k7$;
SELECT public.t4490_service();
SELECT public.t4490_ok((public.issue_4490_check_in_scan('44907000-0000-4000-9000-0000000000a1', (SELECT qr FROM t4490_groups WHERE k = 'tomorrow'),
    NULL, false, '44907000-0000-4000-8000-000000000003', 'p2-test-pepper-0123456789abcdef-4490')->>'result') = 'void',
  'K-7 a cancelled booking''s pass -> void');
SELECT public.t4490_reset();
ROLLBACK;
