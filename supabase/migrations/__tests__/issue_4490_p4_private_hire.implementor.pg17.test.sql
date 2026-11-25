-- #4490 P4-1 (private hire, requests, holds, space claims, calendar; 20281203154490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-NO-DOUBLE-HIRE | issue #4490 | venue_space_claims refuses overlapping live claims on one space (exclusion constraint over the claim range incl. setup and cleanup); a combination claims every part, so a combination blocks its parts and a part blocks the combination.
-- MINGLA-INVARIANT: I-4490-REQUEST-HOLDS-NOTHING | issue #4490 | a hire request (request_pending) has a timer-only hold: no hold slices, no space claims, no capacity; only approval takes the space and the day's capacity.
-- MINGLA-INVARIANT: I-4490-HIRE-CUT | issue #4490 | an approved private hire lowers that day's entry / package limit by the hired spaces' capacity (the whole venue hired closes entry); approval is refused when entry already sold more than the cut limit.
--
-- H-1 authoring: private hire built; spaces + combinations; price rows bounded by capacity; sessions; terms; request mode by default; publish.
-- H-2 D P4-3 numbers: The Lounge Side x120, N7,000,000 + VAT N525,000 = N7,525,000; deposit 50% = N3,762,500.
-- H-3 a request holds nothing (no slices, no claims, no hire cut); guest + host messages.
-- H-4 approve with a quote edit (N6,800,000): amendment, deposit on the new total, held claims with setup/cleanup, hire cut.
-- H-5 a second request for the combination: hire options say held by The Lounge Side; approve -> offer_space_taken; queue.
-- H-6 part vs combination and combination vs part; setup/cleanup buffers collide; [) boundary does not.
-- H-7 a lapsed (unswept) held claim never blocks.
-- H-8 deposit -> confirmed (claims committed, pass), balance paid (stage balance).
-- H-9 an unpaid hold expires by the sweep; the queued request is released (host told) and can be approved.
-- H-10 decline with reason and dates; withdraw by the guest (token only).
-- H-11 an unanswered request expires. H-12 extend hold; release hold.
-- H-13 hire cut: refused when entry sold beyond the cut limit; allowed when it fits; whole venue hired closes entry.
-- H-14 exclusive events claim their space (event_space_taken both ways).
-- H-15 Host reads: requests list tabs and counts, calendar (claims, combination blocks, requests, hire cut).
-- H-16 RLS and grants. H-17 cancel a confirmed hire frees the space. H-18 instant hire. H-19 late payment after expiry.
-- H-20 next free dates. H-21 a hire cannot change day or party online or by a booking change. H-22 Admin dispute view.
-- H-23 the ten booking states map to Requests tabs and read back.
--
-- FAILS-ON-REVERT (seen): drop venue_space_claims_no_overlap -> H-5c (the combination is approved over the held Lounge).
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

-- ===========================================================================
-- Checkout helpers (service role; they mirror what edge venue-offers does).
-- ===========================================================================
CREATE FUNCTION public.t4490_win(p_offer uuid, p_date date)
RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM public.stay_place_windows WHERE offering_id = p_offer AND local_date = p_date ORDER BY starts_at LIMIT 1;
$f$;
CREATE FUNCTION public.t4490_key(p_seed text)
RETURNS text LANGUAGE sql AS $f$ SELECT encode(sha256(convert_to(p_seed, 'UTF8')), 'hex') $f$;
CREATE FUNCTION public.t4490_buy(p_offer uuid, p_date date, p_lines jsonb, p_seed text, p_email text DEFAULT 'buyer-4490@example.test')
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_q jsonb;
  v_g jsonb;
BEGIN
  v_q := public.issue_4490_quote_offer(p_offer, public.t4490_win(p_offer, p_date), p_lines,
    public.t4490_key('cart:' || p_seed), NULL, 'quote-' || p_seed);
  v_g := public.issue_4490_create_offer_group(gen_random_uuid(), (v_q->>'quoteId')::uuid,
    jsonb_build_object('name', 'Guest ' || p_seed, 'email', p_email), public.t4490_key('cart:' || p_seed), NULL,
    sha256(convert_to('tok:' || p_seed, 'UTF8')), 'hold-' || p_seed);
  RETURN (v_g->>'groupId')::uuid;
END
$f$;
-- Pay: prepare + bind + finalize (the webhook / confirm_return path).
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
GRANT EXECUTE ON FUNCTION public.t4490_win(uuid, date), public.t4490_key(text), public.t4490_buy(uuid, date, jsonb, text, text),
  public.t4490_pay(uuid, text) TO PUBLIC;

-- Publish the fixture offer, add a very expensive option for the cap check.
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
DO $pub$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_manage_offer('upsert_price_option', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), 'name', 'Whole floor buyout', 'unit', 'guest',
      'guestMin', 1, 'guestMax', 1, 'priceMinor', 2147483648),
    (SELECT version FROM public.stay_offerings WHERE id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer')), 'p2-c-cap-opt');
  INSERT INTO t4490_ids SELECT 'buyout', (o->>'id')::uuid FROM jsonb_array_elements(v->'options') o WHERE o->>'name' = 'Whole floor buyout';
  v := public.issue_4490_save_booking_settings('44907000-0000-4000-9000-0000000000a1', '{"vatMode":"added"}'::jsonb, NULL, 'p2-c-vat-added');
  v := public.issue_4490_manage_offer('publish', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer')),
    (SELECT version FROM public.stay_offerings WHERE id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer')), 'p2-c-pub');
  INSERT INTO t4490_ids VALUES ('today', NULL);
END
$pub$;
SELECT public.t4490_reset();
CREATE TEMP TABLE t4490_dates ON COMMIT DROP AS
SELECT public.issue_4490_venue_local_date('44907000-0000-4000-9000-0000000000a1') AS today,
       (SELECT min(d)::date FROM generate_series(public.issue_4490_venue_local_date('44907000-0000-4000-9000-0000000000a1') + 5,
          public.issue_4490_venue_local_date('44907000-0000-4000-9000-0000000000a1') + 11, interval '1 day') d
        WHERE extract(isodow FROM d) = 6) AS saturday,
       (SELECT min(d)::date FROM generate_series(public.issue_4490_venue_local_date('44907000-0000-4000-9000-0000000000a1') + 12,
          public.issue_4490_venue_local_date('44907000-0000-4000-9000-0000000000a1') + 18, interval '1 day') d
        WHERE extract(isodow FROM d) = 6) AS next_saturday,
       (SELECT min(d)::date FROM generate_series(public.issue_4490_venue_local_date('44907000-0000-4000-9000-0000000000a1') + 2,
          public.issue_4490_venue_local_date('44907000-0000-4000-9000-0000000000a1') + 9, interval '1 day') d
        WHERE extract(isodow FROM d) = 3) AS wednesday;
GRANT SELECT ON t4490_dates TO PUBLIC;

-- Pay helpers: a chosen pay mode, and a balance payment with the booking token.
CREATE FUNCTION public.t4490_pay_mode(p_group uuid, p_seed text, p_mode text)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_p jsonb;
  v_ref text;
BEGIN
  v_p := public.issue_4490_prepare_offer_payment(p_group, sha256(convert_to('tok:' || p_seed, 'UTF8')), NULL,
    'pay-' || p_mode || '-' || p_seed || '-' || (SELECT version FROM public.stay_reservation_groups WHERE id = p_group),
    (SELECT version FROM public.stay_reservation_groups WHERE id = p_group), p_mode);
  v_ref := 'mingla_stay_' || replace(v_p->>'attemptId', '-', '');
  PERFORM public.issue_1389_bind_payment_attempt((v_p->>'attemptId')::uuid, v_ref, NULL, NULL);
  PERFORM public.issue_1389_finalize_payment('paystack', 'evt-' || (v_p->>'attemptId'), 'charge.success', v_ref,
    'ch-' || (v_p->>'attemptId'), (v_p->>'amountMinor')::bigint, 'NGN', 0, NULL);
  RETURN v_p;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490_pay_mode(uuid, text, text) TO PUBLIC;

-- ===========================================================================
-- P4 helpers.
-- ===========================================================================
CREATE FUNCTION public.t4490_v(p_offer uuid) RETURNS bigint LANGUAGE sql AS $f$
  SELECT version FROM public.stay_offerings WHERE id = p_offer $f$;
CREATE FUNCTION public.t4490_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT v FROM t4490_ids WHERE k = p_k $f$;
CREATE FUNCTION public.t4490_hwin(p_offer uuid, p_date date, p_label text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT w.id FROM public.stay_place_windows w JOIN public.stay_place_schedule_rules r ON r.id = w.schedule_rule_id
  WHERE w.offering_id = p_offer AND w.local_date = p_date AND r.session_label = p_label AND NOT w.stop_sell $f$;
-- A guest sends a hire request (or holds an instant hire): quote + hold, as edge venue-offers does.
CREATE FUNCTION public.t4490_hire(p_option text, p_date date, p_label text, p_guests integer, p_seed text,
  p_answers jsonb DEFAULT '{"occasion":"Company day"}'::jsonb)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_q jsonb;
  v_g jsonb;
BEGIN
  v_q := public.issue_4490_quote_offer(public.t4490_id('hire'), public.t4490_hwin(public.t4490_id('hire'), p_date, p_label),
    jsonb_build_array(jsonb_build_object('priceOptionId', public.t4490_id(p_option), 'guests', p_guests)),
    public.t4490_key('cart:' || p_seed), NULL, 'hquote-' || p_seed, '[]'::jsonb, p_answers);
  v_g := public.issue_4490_create_offer_group(gen_random_uuid(), (v_q->>'quoteId')::uuid,
    jsonb_build_object('name', 'Hirer ' || p_seed, 'email', 'hire-' || p_seed || '@example.test'),
    public.t4490_key('cart:' || p_seed), NULL, sha256(convert_to('tok:' || p_seed, 'UTF8')), 'hhold-' || p_seed);
  RETURN (v_g->>'groupId')::uuid;
END
$f$;
-- A staff action through the edge path (service role acting for a verified user).
CREATE FUNCTION public.t4490_staff(p_user text, p_group uuid, p_action text, p_payload jsonb, p_key text)
RETURNS jsonb LANGUAGE sql AS $f$
  SELECT public.issue_4490_manage_request_for(('44907000-0000-4000-8000-0000000000' || p_user)::uuid, p_group, p_action,
    p_payload, (SELECT version FROM public.stay_reservation_groups WHERE id = p_group), p_key) $f$;
CREATE FUNCTION public.t4490_claims(p_group uuid, p_state text) RETURNS integer LANGUAGE sql AS $f$
  SELECT count(*)::integer FROM public.venue_space_claims WHERE group_id = p_group AND state = p_state $f$;
GRANT EXECUTE ON FUNCTION public.t4490_v(uuid), public.t4490_id(text), public.t4490_hwin(uuid, date, text),
  public.t4490_hire(text, date, text, integer, text, jsonb), public.t4490_staff(text, uuid, text, jsonb, text),
  public.t4490_claims(uuid, text) TO PUBLIC;

CREATE TEMP TABLE t4490_hd ON COMMIT DROP AS
SELECT d1, d1 + 7 AS d2, d1 + 14 AS d3, d1 + 21 AS d4, d1 + 28 AS d5, d1 + 35 AS d6, d1 + 42 AS d7
FROM (SELECT min(d)::date AS d1 FROM generate_series(
        public.issue_4490_venue_local_date('44907000-0000-4000-9000-0000000000a1') + 20,
        public.issue_4490_venue_local_date('44907000-0000-4000-9000-0000000000a1') + 26, interval '1 day') d
      WHERE extract(isodow FROM d) = 6) x;
GRANT SELECT ON t4490_hd TO PUBLIC;

-- ===========================================================================
-- H-1 the owner builds the Gameland hire: The Lounge Side (200 standing),
-- Green Area North and South (150 each), Whole Green Area (N+S) and
-- Green Area + Lounge (all three); Green North N4,000,000 50-100, Lounge
-- N7,000,000 60-150, Whole Green N7,000,000 100-250, Green + Lounge
-- N10,000,000 250-500; Full day 10:00-22:00 and Evening 18:00-23:00;
-- deposit 50%, balance 14 days before, setup 3 h, cleanup 2 h; reply within
-- 48 h, pay within 72 h.
-- ===========================================================================
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
DO $h1$
DECLARE
  v jsonb;
  v_offer uuid;
  a1 constant uuid := '44907000-0000-4000-9000-0000000000a1';
BEGIN
  PERFORM public.t4490_ok('private_hire' = ANY(public.issue_4490_built_features())
    AND 'private_hire' = ANY(public.issue_4490_built_offer_kinds()), 'H-1a private hire is a built feature and offer kind');
  INSERT INTO t4490_ids SELECT 'lounge', (public.issue_4490_manage_space('create', a1,
    '{"name":"The Lounge Side","setting":"covered","capacity_standing":200,"capacity_seated":80}'::jsonb)->>'id')::uuid;
  INSERT INTO t4490_ids SELECT 'north', (public.issue_4490_manage_space('create', a1,
    '{"name":"Green Area North","setting":"outdoor","capacity_standing":150}'::jsonb)->>'id')::uuid;
  INSERT INTO t4490_ids SELECT 'south', (public.issue_4490_manage_space('create', a1,
    '{"name":"Green Area South","setting":"outdoor","capacity_standing":150}'::jsonb)->>'id')::uuid;
  INSERT INTO t4490_ids SELECT 'wholegreen', (public.issue_4490_manage_space_combination('create', a1,
    jsonb_build_object('name', 'Whole Green Area', 'space_ids', jsonb_build_array(public.t4490_id('north'), public.t4490_id('south'))))->>'id')::uuid;
  INSERT INTO t4490_ids SELECT 'greenlounge', (public.issue_4490_manage_space_combination('create', a1,
    jsonb_build_object('name', 'Green Area + Lounge', 'space_ids',
      jsonb_build_array(public.t4490_id('north'), public.t4490_id('south'), public.t4490_id('lounge'))))->>'id')::uuid;
  PERFORM public.issue_4490_set_venue_feature(a1, 'private_hire', true, NULL, NULL, NULL, 'p4-h1-feature');
  v := public.issue_4490_manage_offer('create_draft', a1, '{"kind":"private_hire","name":"Private hire"}'::jsonb, NULL, 'p4-h1-draft');
  v_offer := (v->>'id')::uuid;
  INSERT INTO t4490_ids VALUES ('hire', v_offer);
  PERFORM public.t4490_ok(v->>'confirmationMode' = 'request' AND v->'hire'->>'bookingMode' = 'request',
    'H-1b a new private hire asks first (request) by default');
  v := public.issue_4490_manage_hire('set_spaces', a1, jsonb_build_object('offerId', v_offer,
    'spaceIds', jsonb_build_array(public.t4490_id('north'), public.t4490_id('south'), public.t4490_id('lounge')),
    'combinationIds', jsonb_build_array(public.t4490_id('wholegreen'), public.t4490_id('greenlounge'))),
    public.t4490_v(v_offer), 'p4-h1-spaces');
  PERFORM public.t4490_ok(jsonb_array_length(v->'hire'->'spaces') = 3 AND jsonb_array_length(v->'hire'->'combinations') = 2
    AND (SELECT (c->>'capacity')::integer FROM jsonb_array_elements(v->'hire'->'combinations') c WHERE c->>'name' = 'Green Area + Lounge') = 500,
    'H-1c three spaces and two combinations offered (Green + Lounge holds 500)');
  PERFORM public.t4490_expect(format($$SELECT public.issue_4490_manage_hire('set_price_row', %L::uuid,
      jsonb_build_object('offerId', %L::uuid, 'name', 'Green Area North', 'spaceId', %L::uuid, 'unit', 'booking',
        'guestMin', 50, 'guestMax', 200, 'priceMinor', 400000000), %s, 'p4-h1-over')$$,
      a1, v_offer, public.t4490_id('north'), public.t4490_v(v_offer)),
    '22023', 'option_over_space_capacity', 'H-1d a row larger than its space is refused ("More than Green Area North holds (150)")');
  v := public.issue_4490_manage_hire('set_price_row', a1, jsonb_build_object('offerId', v_offer, 'name', 'Green Area North',
    'spaceId', public.t4490_id('north'), 'unit', 'booking', 'guestMin', 50, 'guestMax', 100, 'priceMinor', 400000000),
    public.t4490_v(v_offer), 'p4-h1-row1');
  v := public.issue_4490_manage_hire('set_price_row', a1, jsonb_build_object('offerId', v_offer, 'name', 'Green Area South',
    'spaceId', public.t4490_id('south'), 'unit', 'booking', 'guestMin', 50, 'guestMax', 100, 'priceMinor', 400000000),
    public.t4490_v(v_offer), 'p4-h1-row1s');
  v := public.issue_4490_manage_hire('set_price_row', a1, jsonb_build_object('offerId', v_offer, 'name', 'The Lounge Side',
    'spaceId', public.t4490_id('lounge'), 'unit', 'booking', 'guestMin', 60, 'guestMax', 150, 'priceMinor', 700000000),
    public.t4490_v(v_offer), 'p4-h1-row2');
  v := public.issue_4490_manage_hire('set_price_row', a1, jsonb_build_object('offerId', v_offer, 'name', 'Whole Green Area',
    'combinationId', public.t4490_id('wholegreen'), 'unit', 'booking', 'guestMin', 100, 'guestMax', 250, 'priceMinor', 700000000),
    public.t4490_v(v_offer), 'p4-h1-row3');
  v := public.issue_4490_manage_hire('set_price_row', a1, jsonb_build_object('offerId', v_offer, 'name', 'Green Area + Lounge',
    'combinationId', public.t4490_id('greenlounge'), 'unit', 'booking', 'guestMin', 250, 'guestMax', 500, 'priceMinor', 1000000000),
    public.t4490_v(v_offer), 'p4-h1-row4');
  INSERT INTO t4490_ids SELECT CASE r->>'name' WHEN 'Green Area North' THEN 'o_north' WHEN 'The Lounge Side' THEN 'o_lounge'
      WHEN 'Whole Green Area' THEN 'o_wholegreen' WHEN 'Green Area South' THEN 'o_south' ELSE 'o_greenlounge' END, (r->>'optionId')::uuid
    FROM jsonb_array_elements(v->'hire'->'rows') r;
  PERFORM public.t4490_ok(jsonb_array_length(v->'hire'->'rows') = 5
    AND (SELECT (r->>'capacity')::integer FROM jsonb_array_elements(v->'hire'->'rows') r WHERE r->>'name' = 'Whole Green Area') = 300,
    'H-1e five price rows by space and group size, each with its place''s capacity');
  v := public.issue_4490_manage_hire('set_sessions', a1, jsonb_build_object('offerId', v_offer,
    'sessions', jsonb_build_array(jsonb_build_object('label', 'Full day', 'startTime', '10:00', 'endTime', '22:00'),
                                  jsonb_build_object('label', 'Evening', 'startTime', '18:00', 'endTime', '23:00')),
    'weekdays', jsonb_build_array(0, 1, 2, 3, 4, 5, 6)), public.t4490_v(v_offer), 'p4-h1-sessions');
  v := public.issue_4490_manage_hire('set_terms', a1, jsonb_build_object('offerId', v_offer, 'hireCharge', 'hire_fee',
    'depositKind', 'percent', 'depositValue', 5000, 'balanceDueDaysBefore', 14, 'setupMinutes', 180, 'cleanupMinutes', 120,
    'damageDepositMinor', 0, 'overtimeMinorPerHour', 30000000), public.t4490_v(v_offer), 'p4-h1-terms');
  v := public.issue_4490_manage_offer('set_policy', a1, jsonb_build_object('offerId', v_offer, 'refundLadder', jsonb_build_array(
      jsonb_build_object('minMinutesBefore', 43200, 'refundBps', 10000),
      jsonb_build_object('minMinutesBefore', 10080, 'refundBps', 5000))), public.t4490_v(v_offer), 'p4-h1-policy');
  v := public.issue_4490_manage_hire('set_booking', a1, jsonb_build_object('offerId', v_offer, 'mode', 'request',
    'requestResponseHours', 48, 'approvedPaymentMinutes', 4320), public.t4490_v(v_offer), 'p4-h1-booking');
  PERFORM public.t4490_ok((v->'hire'->>'requestResponseHours')::integer = 48 AND (v->'hire'->>'setupMinutes')::integer = 180
    AND jsonb_array_length(v->'hire'->'sessions') = 2, 'H-1f sessions, setup / cleanup and the venue''s reply / pay timers saved');
  PERFORM public.t4490_ok(v->'readiness' = '[]'::jsonb, 'H-1g the hire is ready to publish: ' || (v->'readiness')::text);
  v := public.issue_4490_manage_offer('publish', a1, jsonb_build_object('offerId', v_offer), public.t4490_v(v_offer), 'p4-h1-publish');
  PERFORM public.t4490_ok(v->>'status' = 'live' AND (v->>'windowsCreated')::integer > 300,
    'H-1h published: live with ' || (v->>'windowsCreated') || ' session windows');
END
$h1$;
SELECT public.t4490_reset();

-- ===========================================================================
-- H-2 / H-3 a stranger asks for The Lounge Side on a Saturday evening for 120.
-- ===========================================================================
SELECT public.t4490_service();
DO $h2$
DECLARE
  v_q jsonb;
  v_gid uuid;
  v_b jsonb;
BEGIN
  v_q := public.issue_4490_quote_offer(public.t4490_id('hire'),
    public.t4490_hwin(public.t4490_id('hire'), (SELECT d1 FROM t4490_hd), 'Evening'),
    jsonb_build_array(jsonb_build_object('priceOptionId', public.t4490_id('o_lounge'), 'guests', 120)),
    public.t4490_key('cart:h2'), NULL, 'hquote-h2-probe', '[]'::jsonb, '{"occasion":"Company day","siteVisit":true}'::jsonb);
  PERFORM public.t4490_ok(v_q->>'mode' = 'request' AND (v_q->>'subtotalMinor')::bigint = 700000000
    AND (v_q->>'taxMinor')::bigint = 52500000 AND (v_q->>'totalMinor')::bigint = 752500000,
    'H-2a The Lounge Side x120: N7,000,000 + VAT N525,000 = N7,525,000 (request mode)');
  PERFORM public.t4490_ok((v_q->'hire'->'payPlan'->>'depositMinor')::bigint = 376250000
    AND v_q->'hire'->>'placeStatus' = 'free' AND (v_q->'hire'->>'requestResponseHours')::integer = 48,
    'H-2b "If yes, N3,762,500 holds your date"; replies within 48 hours');
  PERFORM public.t4490_expect(format($$SELECT public.issue_4490_quote_offer(%L::uuid, %L::uuid,
      jsonb_build_array(jsonb_build_object('priceOptionId', %L::uuid, 'guests', 151)), %L, NULL, 'hquote-h2-big')$$,
      public.t4490_id('hire'), public.t4490_hwin(public.t4490_id('hire'), (SELECT d1 FROM t4490_hd), 'Evening'),
      public.t4490_id('o_lounge'), public.t4490_key('cart:h2')),
    '22023', 'offer_guests_out_of_range', 'H-2c 151 guests do not fit the Lounge row (no extra-guest price set)');
  PERFORM public.t4490_expect(format($$SELECT public.issue_4490_quote_offer(%L::uuid, %L::uuid,
      jsonb_build_array(jsonb_build_object('priceOptionId', %L::uuid, 'guests', 120)), %L, NULL, 'hquote-h2-ans',
      '[]'::jsonb, '{"color":"red"}'::jsonb)$$,
      public.t4490_id('hire'), public.t4490_hwin(public.t4490_id('hire'), (SELECT d1 FROM t4490_hd), 'Evening'),
      public.t4490_id('o_lounge'), public.t4490_key('cart:h2')),
    '22023', 'offer_answer_required', 'H-2d only the occasion, a note, a site visit and the venue''s own questions are answered');

  v_gid := public.t4490_hire('o_lounge', (SELECT d1 FROM t4490_hd), 'Evening', 120, 'h3', '{"occasion":"Company day","note":"Projector please"}'::jsonb);
  INSERT INTO t4490_ids VALUES ('g_a', v_gid);
  v_b := public.issue_4490_booking_projection(v_gid, NULL);
  PERFORM public.t4490_ok(v_b->>'state' = 'request_pending' AND v_b->>'requestDeadline' IS NOT NULL
    AND (v_b->>'amountDueNowMinor')::bigint = 0 AND v_b->'hire'->>'placeName' = 'The Lounge Side'
    AND v_b->'hire'->>'note' = 'Projector please' AND (v_b->'hire'->>'guests')::integer = 120,
    'H-3a request sent: request_pending, nothing to pay yet, the place and the note on the booking');
END
$h2$;
SELECT public.t4490_reset();
DO $h3$
DECLARE
  v_gid uuid := public.t4490_id('g_a');
BEGIN
  PERFORM public.t4490_ok((SELECT h.state = 'active' AND h.reason = 'request' FROM public.stay_inventory_holds h WHERE h.group_id = v_gid)
    AND NOT EXISTS (SELECT 1 FROM public.stay_inventory_hold_slices s JOIN public.stay_inventory_holds h ON h.id = s.hold_id
                    WHERE h.group_id = v_gid)
    AND NOT EXISTS (SELECT 1 FROM public.venue_space_claims c WHERE c.group_id = v_gid),
    'H-3b a request holds nothing: a timer-only hold, no slices, no space claims (ruling 4)');
  PERFORM public.t4490_ok((SELECT u.hire_cut FROM public.issue_4490_pool_day_usage(
      (SELECT p.id FROM public.venue_capacity_pools p WHERE p.venue_id = '44907000-0000-4000-9000-0000000000a1' AND p.name = 'Gameland day'),
      (SELECT d1 FROM t4490_hd)) u) = 0, 'H-3c a request does not cut the day''s entry limit');
  PERFORM public.t4490_ok(EXISTS (SELECT 1 FROM public.notification_outbox o WHERE o.category_key = 'venue_request_received'
      AND o.payload->>'venue_group_id' = v_gid::text AND o.contact = 'hire-h3@example.test')
    AND EXISTS (SELECT 1 FROM public.notification_outbox o WHERE o.category_key = 'venue_request_action_needed'
      AND o.payload->>'venue_group_id' = v_gid::text AND o.user_id = '44907000-0000-4000-8000-000000000001'),
    'H-3d the guest is told the request was sent; the venue''s people are asked to answer');
END
$h3$;

-- ===========================================================================
-- H-4 approve with the quote edited to N6,800,000.
-- ===========================================================================
SELECT public.t4490_service();
SELECT public.t4490_expect(format($$SELECT public.t4490_staff('03', %L::uuid, 'approve', '{}'::jsonb, 'p4-h4-door')$$,
  public.t4490_id('g_a')), '42501', 'not_authorized', 'H-4a check-in-only staff cannot answer requests');
SELECT public.t4490_expect(format($$SELECT public.t4490_staff('02', %L::uuid, 'approve', '{}'::jsonb, 'p4-h4-fin')$$,
  public.t4490_id('g_a')), '42501', 'not_authorized', 'H-4b a finance manager cannot answer requests (manage bookings needed)');
DO $h4$
DECLARE
  v jsonb;
  v_gid uuid := public.t4490_id('g_a');
  v_b jsonb;
  v_ver bigint := (SELECT version FROM public.stay_reservation_groups WHERE id = public.t4490_id('g_a'));
BEGIN
  v := public.t4490_staff('01', v_gid, 'approve', '{"quoteEdit":{"baseMinor":680000000,"note":"Including the projector"}}'::jsonb, 'p4-h4-approve');
  PERFORM public.t4490_ok(v->>'state' = 'approved_payment_required' AND (v->>'totalDueMinor')::bigint = 731000000
    AND (v->>'depositMinor')::bigint = 365500000 AND (v->>'replayed')::boolean = false,
    'H-4c approved with the quote edited: N6,800,000 + VAT N510,000 = N7,310,000; deposit N3,655,000');
  PERFORM public.t4490_ok((public.issue_4490_manage_request_for('44907000-0000-4000-8000-000000000001', v_gid, 'approve',
      '{"quoteEdit":{"baseMinor":680000000,"note":"Including the projector"}}'::jsonb, v_ver, 'p4-h4-approve')->>'replayed')::boolean,
    'H-4d the same approval key replays the first result');
  v_b := public.issue_4490_booking_projection(v_gid, NULL);
  PERFORM public.t4490_ok((v_b->>'amountDueNowMinor')::bigint = 365500000 AND v_b->>'holdUntil' IS NOT NULL
    AND jsonb_array_length(v_b->'payModes') = 2 AND v_b->'hire'->>'hostNote' = 'Including the projector'
    AND (v_b->>'paymentDeadline')::timestamptz BETWEEN now() + interval '71 hours' AND now() + interval '73 hours',
    'H-4e "On hold until <time>" (72 h): pay N3,655,000 to lock the date, or everything');
END
$h4$;
SELECT public.t4490_reset();
DO $h4b$
DECLARE
  v_gid uuid := public.t4490_id('g_a');
  v_claim public.venue_space_claims%ROWTYPE;
BEGIN
  SELECT * INTO v_claim FROM public.venue_space_claims WHERE group_id = v_gid;
  PERFORM public.t4490_ok(v_claim.state = 'held' AND v_claim.space_id = public.t4490_id('lounge')
    AND lower(v_claim.claim_range) = lower(v_claim.booked_range) - interval '3 hours'
    AND upper(v_claim.claim_range) = upper(v_claim.booked_range) + interval '2 hours'
    AND v_claim.held_until = (SELECT h.expires_at FROM public.stay_inventory_holds h WHERE h.group_id = v_gid),
    'H-4f approval holds The Lounge Side until the pay deadline, setup 3 h before and cleanup 2 h after');
  PERFORM public.t4490_ok((SELECT u.hire_cut = 200 AND u.limit_effective = 100 FROM public.issue_4490_pool_day_usage(
      (SELECT p.id FROM public.venue_capacity_pools p WHERE p.venue_id = '44907000-0000-4000-9000-0000000000a1' AND p.name = 'Gameland day'),
      (SELECT d1 FROM t4490_hd)) u), 'H-4g the hire cuts that day''s entry limit: 300 - 200 = 100');
  PERFORM public.t4490_ok((SELECT count(*) FROM public.venue_booking_amendments a WHERE a.group_id = v_gid
      AND a.kind = 'balance_adjust' AND a.price_delta_minor = -20000000 AND a.tax_delta_minor = -1500000) = 1,
    'H-4h the edited quote is one applied amendment (-N200,000, VAT -N15,000)');
  PERFORM public.t4490_ok(EXISTS (SELECT 1 FROM public.notification_outbox o WHERE o.category_key = 'venue_payment_required'
      AND o.payload->>'venue_group_id' = v_gid::text AND o.payload->>'amount_cents' = '365500000'),
    'H-4i the guest is told to pay the deposit (N3,655,000)');
END
$h4b$;

-- ===========================================================================
-- H-5 a second stranger asks for Green Area + Lounge the same evening.
-- ===========================================================================
SELECT public.t4490_service();
DO $h5$
DECLARE
  v_gid uuid;
  v_opt record;
BEGIN
  SELECT * INTO v_opt FROM public.pg_venue_hire_options(public.t4490_id('hire'),
    public.t4490_hwin(public.t4490_id('hire'), (SELECT d1 FROM t4490_hd), 'Evening'), 300) o
  WHERE o.price_option_id = public.t4490_id('o_greenlounge');
  PERFORM public.t4490_ok(v_opt.status = 'held' AND v_opt.reason = 'booking' AND v_opt.blocked_by = 'The Lounge Side',
    'H-5a Green Area + Lounge shows "held", blocked by The Lounge Side');
  PERFORM public.t4490_ok((SELECT o.status FROM public.pg_venue_hire_options(public.t4490_id('hire'),
      public.t4490_hwin(public.t4490_id('hire'), (SELECT d1 FROM t4490_hd), 'Evening'), 200) o
    WHERE o.price_option_id = public.t4490_id('o_wholegreen')) = 'available'
    AND (SELECT o.status FROM public.pg_venue_hire_options(public.t4490_id('hire'),
      public.t4490_hwin(public.t4490_id('hire'), (SELECT d1 FROM t4490_hd), 'Evening'), 200) o
    WHERE o.price_option_id = public.t4490_id('o_north')) = 'too_small',
    'H-5b the halves are still offered; a space too small for 200 is listed as too small');
  v_gid := public.t4490_hire('o_greenlounge', (SELECT d1 FROM t4490_hd), 'Evening', 300, 'h5');
  INSERT INTO t4490_ids VALUES ('g_b', v_gid);
END
$h5$;
SELECT public.t4490_expect(format($$SELECT public.t4490_staff('01', %L::uuid, 'approve', '{}'::jsonb, 'p4-h5-approve')$$,
  public.t4490_id('g_b')), 'PT409', 'offer_space_taken', 'H-5c approving the combination over the held Lounge -> offer_space_taken');
DO $h5b$
DECLARE
  v jsonb;
BEGIN
  PERFORM public.t4490_ok((SELECT state FROM public.stay_reservation_groups WHERE id = public.t4490_id('g_b')) = 'request_pending'
    AND NOT EXISTS (SELECT 1 FROM public.venue_space_claims WHERE group_id = public.t4490_id('g_b')),
    'H-5d the refused approval left nothing behind (still to answer, no claims)');
  v := public.t4490_staff('07', public.t4490_id('g_b'), 'queue', '{}'::jsonb, 'p4-h5-queue');
  PERFORM public.t4490_ok((v->>'position')::integer = 1 AND v->>'blockedByReference' LIKE 'VB-%'
    AND (v->>'replyBy')::timestamptz > (SELECT payment_deadline FROM public.stay_reservation_groups WHERE id = public.t4490_id('g_a')),
    'H-5e "Put her next in line": position 1 behind the hold; her reply deadline outlasts that hold');
END
$h5b$;
SELECT public.t4490_reset();

-- ===========================================================================
-- H-6 exclusion: part vs combination, combination vs part, buffers, boundary.
-- ===========================================================================
DO $h6$
DECLARE
  v_combo_claim uuid;
  v_range tstzrange := tstzrange(((SELECT d2 FROM t4490_hd) + time '18:00') AT TIME ZONE 'Africa/Lagos',
                                 ((SELECT d2 FROM t4490_hd) + time '23:00') AT TIME ZONE 'Africa/Lagos', '[)');
BEGIN
  INSERT INTO public.venue_space_claims (space_id, source, via_combination_id, booked_range, claim_range, state)
  SELECT s, 'block', public.t4490_id('wholegreen'), v_range, v_range, 'committed'
  FROM unnest(ARRAY[public.t4490_id('north'), public.t4490_id('south')]) s;
  BEGIN
    INSERT INTO public.venue_space_claims (space_id, source, booked_range, claim_range, state)
    VALUES (public.t4490_id('north'), 'block', v_range, v_range, 'committed');
    RAISE EXCEPTION 'T4490 FAIL: H-6a a part was claimed under its combination';
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE 'PASS  H-6a a part cannot be claimed while its combination is (exclusion constraint)';
  END;
  BEGIN
    INSERT INTO public.venue_space_claims (space_id, source, via_combination_id, booked_range, claim_range, state)
    SELECT s, 'block', public.t4490_id('greenlounge'), v_range, v_range, 'committed'
    FROM unnest(ARRAY[public.t4490_id('north'), public.t4490_id('south'), public.t4490_id('lounge')]) s;
    RAISE EXCEPTION 'T4490 FAIL: H-6b an overlapping combination was claimed';
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE 'PASS  H-6b a combination cannot be claimed over a claimed part';
  END;
END
$h6$;
SELECT public.t4490_service();
SELECT public.t4490_expect(format($$SELECT public.issue_4490_manage_block_for('44907000-0000-4000-8000-000000000001'::uuid,
    '44907000-0000-4000-9000-0000000000a1'::uuid, 'block', jsonb_build_object('spaceIds', jsonb_build_array(%L::uuid),
    'from', %L, 'to', %L), 'p4-h6-buffer')$$, public.t4490_id('lounge'),
    (((SELECT d1 FROM t4490_hd) + time '23:30') AT TIME ZONE 'Africa/Lagos')::text,
    (((SELECT d1 FROM t4490_hd) + 1 + time '02:00') AT TIME ZONE 'Africa/Lagos')::text),
  'PT409', 'offer_space_taken', 'H-6c a 23:30-02:00 block collides with an 18:00-23:00 hire through its 2-hour cleanup');
DO $h6c$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_manage_block_for('44907000-0000-4000-8000-000000000001', '44907000-0000-4000-9000-0000000000a1',
    'block', jsonb_build_object('spaceIds', jsonb_build_array(public.t4490_id('lounge')),
      'from', (((SELECT d1 FROM t4490_hd) + 1 + time '01:00') AT TIME ZONE 'Africa/Lagos')::text,
      'to', (((SELECT d1 FROM t4490_hd) + 1 + time '03:00') AT TIME ZONE 'Africa/Lagos')::text,
      'reason', 'Deep clean'), 'p4-h6-boundary');
  PERFORM public.t4490_ok(jsonb_array_length(v->'claimIds') = 1,
    'H-6d a block that starts exactly when the cleanup ends is allowed ([) ranges)');
  v := public.issue_4490_manage_block_for('44907000-0000-4000-8000-000000000001', '44907000-0000-4000-9000-0000000000a1',
    'unblock', jsonb_build_object('claimId', v->'claimIds'->>0), 'p4-h6-unblock');
  PERFORM public.t4490_ok(jsonb_array_length(v->'released') = 1, 'H-6e the block is lifted');
END
$h6c$;
SELECT public.t4490_expect(format($$SELECT public.issue_4490_manage_block_for('44907000-0000-4000-8000-000000000003'::uuid,
    '44907000-0000-4000-9000-0000000000a1'::uuid, 'block', jsonb_build_object('spaceIds', jsonb_build_array(%L::uuid),
    'from', now() + interval '400 days', 'to', now() + interval '401 days'), 'p4-h6-door')$$, public.t4490_id('lounge')),
  '42501', 'not_authorized', 'H-6f check-in-only staff cannot block spaces');
SELECT public.t4490_reset();

-- ===========================================================================
-- H-7 a lapsed (unswept) held claim never blocks: on d3 the Lounge is approved,
-- its pay deadline passes unswept, and another request is approved over it.
-- ===========================================================================
SELECT public.t4490_service();
DO $h7$
DECLARE
  v_c uuid;
  v_d uuid;
BEGIN
  v_c := public.t4490_hire('o_lounge', (SELECT d3 FROM t4490_hd), 'Evening', 100, 'h7c');
  PERFORM public.t4490_staff('01', v_c, 'approve', '{}'::jsonb, 'p4-h7-approve-c');
  INSERT INTO t4490_ids VALUES ('g_c', v_c);
  v_d := public.t4490_hire('o_greenlounge', (SELECT d3 FROM t4490_hd), 'Evening', 300, 'h7d');
  INSERT INTO t4490_ids VALUES ('g_d', v_d);
  PERFORM public.t4490_staff('01', v_d, 'queue', '{}'::jsonb, 'p4-h7-queue-d');
END
$h7$;
SELECT public.t4490_reset();
UPDATE public.stay_inventory_holds SET expires_at = now() - interval '1 minute' WHERE group_id = public.t4490_id('g_c');
SELECT public.t4490_ok((SELECT held_until < now() AND state = 'held' FROM public.venue_space_claims WHERE group_id = public.t4490_id('g_c')),
  'H-7a the first hold has lapsed but is not swept yet (its claim is still marked held)');
SELECT public.t4490_ok((SELECT s.status FROM public.issue_4490_spaces_status(ARRAY[public.t4490_id('lounge')],
    (SELECT claim_range FROM public.venue_space_claims WHERE group_id = public.t4490_id('g_c')), NULL) s) = 'free',
  'H-7b a lapsed held claim counts as free');

-- ===========================================================================
-- H-9 the sweep expires the unpaid hold; the queued request is released (the
-- host is told) and can now be approved.
-- ===========================================================================
SELECT public.t4490_service();
DO $h9$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_offer_sweep(200);
  PERFORM public.t4490_ok((SELECT state FROM public.stay_reservation_groups WHERE id = public.t4490_id('g_c')) = 'request_expired'
    AND public.issue_4490_closed_reason(public.t4490_id('g_c')) = 'not_paid',
    'H-9a the sweep expires the unpaid hold: Closed, not paid in time');
END
$h9$;
SELECT public.t4490_reset();
SELECT public.t4490_ok(public.t4490_claims(public.t4490_id('g_c'), 'held') = 0 AND public.t4490_claims(public.t4490_id('g_c'), 'released') = 1
    AND (SELECT released_at IS NOT NULL FROM public.venue_request_queue WHERE group_id = public.t4490_id('g_d'))
    AND EXISTS (SELECT 1 FROM public.stay_reservation_events e WHERE e.group_id = public.t4490_id('g_d')
                AND e.event_type = 'stay_offer_queue_released')
    AND EXISTS (SELECT 1 FROM public.notification_outbox o WHERE o.category_key = 'venue_request_action_needed'
                AND o.payload->>'venue_group_id' = public.t4490_id('g_d')::text AND o.payload->>'reminder_reason' = 'next_in_line')
    AND EXISTS (SELECT 1 FROM public.notification_outbox o WHERE o.category_key = 'venue_request_expired'
                AND o.payload->>'venue_group_id' = public.t4490_id('g_c')::text AND o.payload->>'reminder_reason' = 'not_paid'),
  'H-9b claim released; the queued request is next in line and the host is told; the guest hears the hold ended');
SELECT public.t4490_service();
SELECT public.t4490_ok((public.t4490_staff('01', public.t4490_id('g_d'), 'approve', '{}'::jsonb, 'p4-h9-approve-d')->>'state')
  = 'approved_payment_required', 'H-9c the request that waited in line is approved now');
SELECT public.t4490_reset();

-- ===========================================================================
-- H-8 the first guest pays the deposit, then the balance.
-- ===========================================================================
SELECT public.t4490_service();
DO $h8$
DECLARE
  v_gid uuid := public.t4490_id('g_a');
  v jsonb;
BEGIN
  v := public.t4490_pay_mode(v_gid, 'h3', 'deposit');
  PERFORM public.t4490_ok(v->>'stage' = 'deposit' AND (v->>'amountMinor')::bigint = 365500000,
    'H-8a the deposit charged is the server''s deposit (N3,655,000)');
  v := public.issue_4490_booking_projection(v_gid, NULL);
  PERFORM public.t4490_ok(v->>'state' = 'confirmed' AND (v->>'balanceDueMinor')::bigint = 365500000
    AND (v->'passes'->0->>'admits')::integer = 120 AND v->>'balanceDueAt' IS NOT NULL,
    'H-8b confirmed: balance N3,655,000 due 14 days before; one pass admits 120');
END
$h8$;
SELECT public.t4490_reset();
SELECT public.t4490_ok(public.t4490_claims(public.t4490_id('g_a'), 'committed') = 1 AND public.t4490_claims(public.t4490_id('g_a'), 'held') = 0,
  'H-8c the paid hold commits its claim');
SELECT public.t4490_service();
DO $h8b$
DECLARE
  v jsonb;
BEGIN
  v := public.t4490_pay_mode(public.t4490_id('g_a'), 'h3', 'full');
  PERFORM public.t4490_ok(v->>'stage' = 'balance' AND (v->>'amountMinor')::bigint = 365500000
    AND (public.issue_4490_booking_projection(public.t4490_id('g_a'), NULL)->>'balanceDueMinor')::bigint = 0,
    'H-8d the balance (N3,655,000) is paid online: nothing left to pay');
END
$h8b$;
SELECT public.t4490_reset();

-- ===========================================================================
-- H-10 decline with a reason and other dates; the guest withdraws another.
-- ===========================================================================
SELECT public.t4490_service();
DO $h10$
DECLARE
  v_e uuid;
  v_f uuid;
  v jsonb;
BEGIN
  v_e := public.t4490_hire('o_north', (SELECT d4 FROM t4490_hd), 'Full day', 80, 'h10e');
  INSERT INTO t4490_ids VALUES ('g_e', v_e);
  PERFORM public.t4490_expect(format($$SELECT public.t4490_staff('01', %L::uuid, 'decline', '{"reason":"no"}'::jsonb, 'p4-h10-short')$$, v_e),
    '22023', 'decline_reason_required', 'H-10a declining needs a reason (3+ characters)');
  v := public.t4490_staff('01', v_e, 'decline', jsonb_build_object('reason', 'We have a wedding that day',
    'alternatives', jsonb_build_array((SELECT d5 FROM t4490_hd)::text)), 'p4-h10-decline');
  v := public.issue_4490_booking_projection(v_e, NULL);
  PERFORM public.t4490_ok(v->>'state' = 'declined' AND v->'hire'->>'declineReason' = 'We have a wedding that day'
    AND jsonb_array_length(v->'hire'->'alternatives') = 1 AND v->'hire'->>'closedReason' = 'declined',
    'H-10b declined: the guest sees the reason and the other date');
  PERFORM public.t4490_ok(EXISTS (SELECT 1 FROM public.notification_outbox o WHERE o.category_key = 'venue_request_declined'
    AND o.payload->>'venue_group_id' = v_e::text), 'H-10c the guest is told');
  v_f := public.t4490_hire('o_south', (SELECT d4 FROM t4490_hd), 'Full day', 100, 'h10f');
  PERFORM public.t4490_expect(format($$SELECT public.issue_4490_withdraw_request(%L::uuid, sha256(convert_to('tok:wrong', 'UTF8')), NULL)$$, v_f),
    'P0002', 'offer_booking_not_found', 'H-10d a wrong token cannot withdraw a request');
  PERFORM public.t4490_expect(format($$SELECT public.issue_4490_withdraw_request(%L::uuid, NULL, '44907000-0000-4000-8000-000000000005'::uuid)$$, v_f),
    'P0002', 'offer_booking_not_found', 'H-10e a signed-in stranger without the token cannot withdraw it');
  v := public.issue_4490_withdraw_request(v_f, sha256(convert_to('tok:h10f', 'UTF8')), NULL);
  PERFORM public.t4490_ok(v->>'state' = 'request_expired' AND v->'hire'->>'closedReason' = 'withdrawn'
    AND (public.issue_4490_withdraw_request(v_f, sha256(convert_to('tok:h10f', 'UTF8')), NULL)->>'replayed')::boolean,
    'H-10f the guest withdraws with the booking token (a repeat replays)');
END
$h10$;
SELECT public.t4490_reset();

-- ===========================================================================
-- H-11 an unanswered request expires; H-12 extend and release a hold.
-- ===========================================================================
SELECT public.t4490_service();
DO $h11$
DECLARE
  v_g uuid;
  v_h uuid;
  v jsonb;
  v_until timestamptz;
BEGIN
  v_g := public.t4490_hire('o_north', (SELECT d5 FROM t4490_hd), 'Full day', 80, 'h11');
  INSERT INTO t4490_ids VALUES ('g_g', v_g);
  v_h := public.t4490_hire('o_south', (SELECT d5 FROM t4490_hd), 'Full day', 80, 'h12');
  INSERT INTO t4490_ids VALUES ('g_h', v_h);
  v := public.t4490_staff('07', v_h, 'approve', '{}'::jsonb, 'p4-h12-approve');
  v_until := (v->>'holdUntil')::timestamptz;
  PERFORM public.t4490_expect(format($$SELECT public.t4490_staff('07', %L::uuid, 'extend_hold', '{"hours":10}'::jsonb, 'p4-h12-bad')$$, v_h),
    '22023', 'extend_hours_invalid', 'H-12a give more time: 12, 24 or 48 hours only');
  v := public.t4490_staff('07', v_h, 'extend_hold', '{"hours":24}'::jsonb, 'p4-h12-extend');
  PERFORM public.t4490_ok((v->>'holdUntil')::timestamptz = v_until + interval '24 hours',
    'H-12b the hold is extended by 24 hours');
END
$h11$;
SELECT public.t4490_reset();
SELECT public.t4490_ok((SELECT held_until FROM public.venue_space_claims WHERE group_id = public.t4490_id('g_h') AND state = 'held')
  = (SELECT payment_deadline FROM public.stay_reservation_groups WHERE id = public.t4490_id('g_h')),
  'H-12c the space claim follows the longer hold');
UPDATE public.stay_inventory_holds SET expires_at = now() - interval '1 minute' WHERE group_id = public.t4490_id('g_g');
SELECT public.t4490_service();
SELECT public.issue_4490_offer_sweep(200);
DO $h11b$
DECLARE
  v jsonb;
BEGIN
  PERFORM public.t4490_ok(public.issue_4490_closed_reason(public.t4490_id('g_g')) = 'expired'
    AND (SELECT state FROM public.stay_reservation_groups WHERE id = public.t4490_id('g_g')) = 'request_expired',
    'H-11a an unanswered request expires (Closed, expired)');
  v := public.t4490_staff('07', public.t4490_id('g_h'), 'release_hold', '{"reason":"Guest called to cancel"}'::jsonb, 'p4-h12-release');
  PERFORM public.t4490_ok(v->>'state' = 'request_expired' AND public.issue_4490_closed_reason(public.t4490_id('g_h')) = 'released',
    'H-12d the host releases a hold early');
END
$h11b$;
SELECT public.t4490_reset();
SELECT public.t4490_ok(public.t4490_claims(public.t4490_id('g_h'), 'held') = 0
    AND EXISTS (SELECT 1 FROM public.notification_outbox o WHERE o.category_key = 'venue_request_expired'
                AND o.payload->>'venue_group_id' = public.t4490_id('g_g')::text AND o.payload->>'reminder_reason' = 'no_reply'),
  'H-12e the released hold frees the space; the expired request''s guest is told');

-- ===========================================================================
-- H-13 the hire cut and entry already sold (decision default 7: refuse).
-- d6: day limit 200 (kept 0), 60 entry sold; Green North (150) would leave 50.
-- ===========================================================================
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_capacity_override('44907000-0000-4000-9000-0000000000a1',
  (SELECT p.id FROM public.venue_capacity_pools p WHERE p.venue_id = '44907000-0000-4000-9000-0000000000a1' AND p.name = 'Gameland day'),
  (SELECT d6 FROM t4490_hd), 200, 0, false, false, 'p4-h13-limit');
SELECT public.t4490_reset();
SELECT public.t4490_service();
DO $h13$
DECLARE
  v_i uuid;
  v_n uuid;
  v_s uuid;
  n integer;
BEGIN
  FOR n IN 1..3 LOOP
    v_i := public.t4490_buy(public.t4490_id('offer'), (SELECT d6 FROM t4490_hd),
      jsonb_build_array(jsonb_build_object('priceOptionId', public.t4490_id('walkin'), 'guests', 20)), 'h13-entry-' || n);
    PERFORM public.t4490_pay(v_i, 'h13-entry-' || n);
  END LOOP;
  v_n := public.t4490_hire('o_north', (SELECT d6 FROM t4490_hd), 'Full day', 80, 'h13n');
  INSERT INTO t4490_ids VALUES ('g_n', v_n);
  PERFORM public.t4490_expect(format($$SELECT public.t4490_staff('01', %L::uuid, 'approve', '{}'::jsonb, 'p4-h13-approve')$$, v_n),
    'PT409', 'offer_capacity_conflict', 'H-13a 60 entry sold, the hire would leave 50: approval refused (offer_capacity_conflict)');
  PERFORM public.t4490_ok((SELECT state FROM public.stay_reservation_groups WHERE id = v_n) = 'request_pending'
    AND NOT EXISTS (SELECT 1 FROM public.venue_space_claims WHERE group_id = v_n),
    'H-13b the refusal rolled the claim back');
END
$h13$;
SELECT public.t4490_reset();
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_capacity_override('44907000-0000-4000-9000-0000000000a1',
  (SELECT p.id FROM public.venue_capacity_pools p WHERE p.venue_id = '44907000-0000-4000-9000-0000000000a1' AND p.name = 'Gameland day'),
  (SELECT d6 FROM t4490_hd), 400, 0, false, false, 'p4-h13-limit-2');
SELECT public.t4490_reset();
SELECT public.t4490_service();
DO $h13b$
DECLARE
  v jsonb;
  v_s uuid;
  v_usage record;
BEGIN
  v := public.t4490_staff('01', public.t4490_id('g_n'), 'approve', '{}'::jsonb, 'p4-h13-approve-2');
  SELECT * INTO v_usage FROM public.issue_4490_pool_day_usage(
    (SELECT p.id FROM public.venue_capacity_pools p WHERE p.venue_id = '44907000-0000-4000-9000-0000000000a1' AND p.name = 'Gameland day'),
    (SELECT d6 FROM t4490_hd));
  PERFORM public.t4490_ok(v->>'state' = 'approved_payment_required' AND v_usage.hire_cut = 150 AND v_usage.limit_effective = 250
    AND v_usage.used = 60, 'H-13c with a 400 limit the hire fits: entry limit 400 - 150 = 250, 60 sold');
  -- The other two spaces hired too: the whole venue is hired, entry closes.
  v_s := public.t4490_hire('o_south', (SELECT d6 FROM t4490_hd), 'Full day', 80, 'h13s');
  PERFORM public.t4490_staff('01', v_s, 'approve', '{}'::jsonb, 'p4-h13-approve-s');
  v_s := public.t4490_hire('o_lounge', (SELECT d6 FROM t4490_hd), 'Evening', 100, 'h13l');
  PERFORM public.t4490_expect(format($$SELECT public.t4490_staff('01', %L::uuid, 'approve', '{}'::jsonb, 'p4-h13-approve-l')$$, v_s),
    'PT409', 'offer_capacity_conflict', 'H-13d hiring the last space closes entry, but 60 already hold passes: refused');
END
$h13b$;
SELECT public.t4490_reset();

SELECT public.t4490_service();
DO $h13d$
DECLARE
  v_w uuid;
  v_usage record;
  v_avail record;
BEGIN
  v_w := public.t4490_hire('o_greenlounge', (SELECT d7 FROM t4490_hd), 'Full day', 300, 'h13w');
  PERFORM public.t4490_staff('01', v_w, 'approve', '{}'::jsonb, 'p4-h13-approve-w');
  SELECT * INTO v_usage FROM public.issue_4490_pool_day_usage(
    (SELECT p.id FROM public.venue_capacity_pools p WHERE p.venue_id = '44907000-0000-4000-9000-0000000000a1' AND p.name = 'Gameland day'),
    (SELECT d7 FROM t4490_hd));
  PERFORM public.t4490_ok(v_usage.venue_hired AND v_usage.closed AND v_usage.limit_effective = 0,
    'H-13e the whole venue is hired: entry is closed that day ("Close entry when the whole venue is hired")');
  SELECT * INTO v_avail FROM public.pg_venue_offer_availability(public.t4490_id('offer'), (SELECT d7 FROM t4490_hd), (SELECT d7 FROM t4490_hd));
  PERFORM public.t4490_ok(v_avail.status = 'closed' AND v_avail.reason = 'venue_hired',
    'H-13f the entry calendar says closed: venue hired');
  PERFORM public.t4490_expect(format($$SELECT public.issue_4490_quote_offer(%L::uuid, %L::uuid,
      jsonb_build_array(jsonb_build_object('priceOptionId', %L::uuid, 'guests', 2)), %L, NULL, 'h13-entry-closed')$$,
      public.t4490_id('offer'), public.t4490_win(public.t4490_id('offer'), (SELECT d7 FROM t4490_hd)),
      public.t4490_id('walkin'), public.t4490_key('cart:h13x')),
    'PT409', 'offer_day_closed', 'H-13g entry cannot be bought that day');
END
$h13d$;
SELECT public.t4490_reset();

-- ===========================================================================
-- H-14 exclusive events claim their space.
-- ===========================================================================
DO $h14$
DECLARE
  v_event uuid := gen_random_uuid();
  v_event2 uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.events (id, brand_id, created_by, title, slug, status, venue_id, space_id, space_use)
  VALUES (v_event, '44907000-0000-4000-9000-000000000010', '44907000-0000-4000-8000-000000000001', 'Karaoke & Games Night',
          'karaoke-p4-4490', 'scheduled', '44907000-0000-4000-9000-0000000000a1', public.t4490_id('lounge'), 'exclusive');
  BEGIN
    INSERT INTO public.event_dates (event_id, start_at, end_at)
    VALUES (v_event, ((SELECT d1 FROM t4490_hd) + time '19:00') AT TIME ZONE 'Africa/Lagos',
                     ((SELECT d1 FROM t4490_hd) + time '22:00') AT TIME ZONE 'Africa/Lagos');
    RAISE EXCEPTION 'T4490 FAIL: H-14a an exclusive event took a hired space';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    IF SQLERRM <> 'event_space_taken' THEN RAISE; END IF;
    RAISE NOTICE 'PASS  H-14a an exclusive event on the hired Lounge is refused (event_space_taken)';
  END;
  INSERT INTO public.events (id, brand_id, created_by, title, slug, status, venue_id, space_id, space_use)
  VALUES (v_event2, '44907000-0000-4000-9000-000000000010', '44907000-0000-4000-8000-000000000001', 'Design night',
          'design-p4-4490', 'scheduled', '44907000-0000-4000-9000-0000000000a1', public.t4490_id('lounge'), 'exclusive');
  INSERT INTO public.event_dates (event_id, start_at, end_at)
  VALUES (v_event2, ((SELECT d4 FROM t4490_hd) + time '19:00') AT TIME ZONE 'Africa/Lagos',
                    ((SELECT d4 FROM t4490_hd) + time '22:00') AT TIME ZONE 'Africa/Lagos');
  PERFORM public.t4490_ok((SELECT count(*) FROM public.venue_space_claims WHERE event_id = v_event2 AND state = 'committed') = 1,
    'H-14b an exclusive event on a free evening claims the Lounge');
  INSERT INTO t4490_ids VALUES ('event2', v_event2);
END
$h14$;
SELECT public.t4490_service();
SELECT public.t4490_expect(format($$SELECT public.t4490_hire('o_lounge', %L::date, 'Evening', 100, 'h14x')$$, (SELECT d4 FROM t4490_hd)),
  'PT409', 'offer_space_taken', 'H-14c the Lounge cannot be asked for during the exclusive event');
SELECT public.t4490_reset();
UPDATE public.events SET status = 'cancelled' WHERE id = public.t4490_id('event2');
SELECT public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.venue_space_claims WHERE event_id = public.t4490_id('event2') AND state = 'committed'),
  'H-14d cancelling the event frees the space');

-- ===========================================================================
-- H-15 Host reads: requests and calendar.
-- ===========================================================================
SELECT public.t4490_as('44907000-0000-4000-8000-000000000007');
DO $h15$
DECLARE
  v jsonb;
  v_row jsonb;
BEGIN
  v := public.issue_4490_requests_list('44907000-0000-4000-9000-0000000000a1', 'all');
  PERFORM public.t4490_ok((v->'counts'->>'toAnswer')::integer >= 1 AND (v->'counts'->>'waitingForDeposit')::integer >= 1
    AND (v->'counts'->>'confirmed')::integer >= 1 AND (v->'counts'->>'closed')::integer >= 3,
    'H-15a Requests counts: ' || (v->'counts')::text);
  SELECT r INTO v_row FROM jsonb_array_elements(v->'requests') r WHERE r->>'groupId' = public.t4490_id('g_b')::text;
  PERFORM public.t4490_ok(v_row->>'tab' = 'to_answer' AND (v_row->'queue'->>'position')::integer = 1
    AND v_row->>'placeStatus' = 'taken' AND v_row->>'placeName' = 'Green Area + Lounge',
    'H-15b the queued request shows its place in line and that its place is now booked');
  SELECT r INTO v_row FROM jsonb_array_elements(v->'requests') r WHERE r->>'groupId' = public.t4490_id('g_e')::text;
  PERFORM public.t4490_ok(v_row->>'tab' = 'closed' AND v_row->>'closedReason' = 'declined', 'H-15c a declined request is Closed');
  v := public.issue_4490_venue_calendar('44907000-0000-4000-9000-0000000000a1', (SELECT d1 FROM t4490_hd), (SELECT d1 FROM t4490_hd) + 1);
  PERFORM public.t4490_ok(EXISTS (SELECT 1 FROM jsonb_array_elements(v->'claims') c
      WHERE c->>'spaceId' = public.t4490_id('lounge')::text AND c->>'kind' = 'hire' AND c->>'guestName' = 'Hirer h3'
        AND (c->>'claimFrom')::timestamptz < (c->>'bookedFrom')::timestamptz),
    'H-15d the calendar shows the Lounge hire with its setup and cleanup');
  PERFORM public.t4490_ok(EXISTS (SELECT 1 FROM jsonb_array_elements(v->'combinationBlocks') b
      WHERE b->>'combinationId' = public.t4490_id('greenlounge')::text AND b->>'blockedBy' = 'The Lounge Side'),
    'H-15e Green Area + Lounge shows "Blocked by The Lounge Side"');
  PERFORM public.t4490_ok((SELECT (p->>'hireCut')::integer FROM jsonb_array_elements(v->'days'->0->'pools') p) = 200
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(v->'requests') r WHERE r->>'groupId' = public.t4490_id('g_b')::text AND (r->>'collides')::boolean),
    'H-15f the day row shows the reduced entry limit; the queued request is shown colliding');
END
$h15$;
SELECT public.t4490_reset();
SELECT public.t4490_as('44907000-0000-4000-8000-000000000005');
SELECT public.t4490_expect($$SELECT public.issue_4490_venue_calendar('44907000-0000-4000-9000-0000000000a1', current_date, current_date + 7)$$,
  '42501', 'not_authorized', 'H-15g an outsider cannot read the calendar');
SELECT public.t4490_expect($$SELECT public.issue_4490_requests_list('44907000-0000-4000-9000-0000000000a1', 'all')$$,
  '42501', 'not_authorized', 'H-15h an outsider cannot read requests');
SELECT public.t4490_reset();

-- ===========================================================================
-- H-16 RLS and grants.
-- ===========================================================================
SELECT public.t4490_as('44907000-0000-4000-8000-000000000005');
SELECT public.t4490_ok((SELECT count(*) FROM public.venue_space_claims) = 0, 'H-16a an outsider reads no claims');
SELECT public.t4490_expect(format($$INSERT INTO public.venue_space_claims (space_id, source, booked_range, claim_range, state)
  VALUES (%L::uuid, 'block', tstzrange(now(), now() + interval '1 hour'), tstzrange(now(), now() + interval '1 hour'), 'committed')$$,
  public.t4490_id('lounge')), '42501', NULL, 'H-16b nobody writes claims directly');
SELECT public.t4490_reset();
SELECT public.t4490_as('44907000-0000-4000-8000-000000000007');
SELECT public.t4490_ok((SELECT count(*) FROM public.venue_space_claims WHERE group_id = public.t4490_id('g_a')) = 1,
  'H-16c a venue member reads the venue''s claims');
SELECT public.t4490_reset();
DO $h16$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.issue_4490_manage_request_for(uuid,uuid,text,jsonb,bigint,text)',
    'public.issue_4490_manage_block_for(uuid,uuid,text,jsonb,text)',
    'public.issue_4490_withdraw_request(uuid,bytea,uuid)',
    'public.issue_4490_quote_hire_internal(uuid,uuid,jsonb,text,uuid,text,jsonb,jsonb)',
    'public.issue_4490_hold_hire_internal(uuid,uuid,jsonb,text,uuid,bytea,text)',
    'public.issue_4490_claim_spaces(uuid,uuid,uuid,uuid[],uuid,tstzrange,tstzrange,timestamp with time zone)'] LOOP
    PERFORM public.t4490_ok(NOT has_function_privilege('anon', v_fn, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', v_fn, 'EXECUTE'), 'H-16d not callable by clients: ' || v_fn);
  END LOOP;
  PERFORM public.t4490_ok(has_function_privilege('anon', 'public.pg_venue_hire_options(uuid,uuid,integer)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4490_venue_calendar(uuid,date,date)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4490_manage_hire(text,uuid,jsonb,bigint,text)', 'EXECUTE')
    AND NOT has_table_privilege('anon', 'public.venue_space_claims', 'SELECT')
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.venue_space_claims'::regclass)
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.venue_request_queue'::regclass),
    'H-16e hire options are public; calendar, authoring and claims are not; RLS is on');
  PERFORM public.t4490_ok(NOT EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid IN ('public.venue_space_claims'::regclass, 'public.venue_request_queue'::regclass,
                           'public.venue_offer_staff_receipts'::regclass)
        AND a.attname = 'venue_id' AND NOT a.attisdropped),
    'H-16f the new tables carry no venue_id lane (the #2099 pending-venue seal does not move)');
END
$h16$;
SELECT public.t4490_service();
SELECT public.t4490_expect(format($$SELECT public.issue_4490_manage_hire('set_terms', '44907000-0000-4000-9000-0000000000a1',
  jsonb_build_object('offerId', %L::uuid), 1, 'p4-h16-svc')$$, public.t4490_id('hire')),
  '42501', 'not_authorized', 'H-16g hire authoring needs a signed-in host');
SELECT public.t4490_reset();

-- ===========================================================================
-- H-17 the guest cancels the confirmed Lounge hire: ladder refund, space freed.
-- ===========================================================================
SELECT public.t4490_service();
DO $h17$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_cancel_preview(public.t4490_id('g_a'), sha256(convert_to('tok:h3', 'UTF8')), NULL);
  PERFORM public.t4490_ok((v->>'paidMinor')::bigint = 731000000 AND (v->>'refundMinor')::bigint = 365500000,
    'H-17a cancel preview: 20+ days before = the 50% rung (N3,655,000 of N7,310,000)');
  v := public.issue_4490_cancel(ARRAY(SELECT jsonb_array_elements_text(v->'previewIds')::uuid), v->>'previewHash', 'p4-h17-cancel',
    'Plans changed', sha256(convert_to('tok:h3', 'UTF8')), NULL);
  PERFORM public.t4490_ok(v->>'state' = 'cancelled', 'H-17b cancelled');
END
$h17$;
SELECT public.t4490_reset();
SELECT public.t4490_ok(public.t4490_claims(public.t4490_id('g_a'), 'committed') = 0
    AND (SELECT u.hire_cut FROM public.issue_4490_pool_day_usage(
      (SELECT p.id FROM public.venue_capacity_pools p WHERE p.venue_id = '44907000-0000-4000-9000-0000000000a1' AND p.name = 'Gameland day'),
      (SELECT d1 FROM t4490_hd)) u) = 0,
  'H-17c the cancelled hire frees the Lounge and the day''s entry limit');
SELECT public.t4490_service();
SELECT public.t4490_ok((public.t4490_staff('01', public.t4490_id('g_b'), 'approve', '{}'::jsonb, 'p4-h17-approve-b')->>'state')
  = 'approved_payment_required', 'H-17d the request queued behind it can now be approved');
SELECT public.t4490_reset();

-- ===========================================================================
-- H-18 instant hire: "Book instantly" holds the place at once.
-- ===========================================================================
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT public.issue_4490_manage_hire('set_booking', '44907000-0000-4000-9000-0000000000a1',
  jsonb_build_object('offerId', public.t4490_id('hire'), 'mode', 'instant'), public.t4490_v(public.t4490_id('hire')), 'p4-h18-instant');
SELECT public.t4490_reset();
SELECT public.t4490_service();
DO $h18$
DECLARE
  v_i uuid;
  v jsonb;
BEGIN
  v_i := public.t4490_hire('o_north', (SELECT d2 FROM t4490_hd) + 1, 'Full day', 80, 'h18');
  INSERT INTO t4490_ids VALUES ('g_i', v_i);
  v := public.issue_4490_booking_projection(v_i, NULL);
  PERFORM public.t4490_ok(v->>'state' = 'instant_payment_pending' AND (v->>'amountDueNowMinor')::bigint = 430000000
    AND public.t4490_claims(v_i, 'held') = 1, 'H-18a an instant hire holds Green Area North at once (N4,300,000 due)');
  PERFORM public.t4490_expect(format($$SELECT public.t4490_hire('o_wholegreen', %L::date, 'Full day', 200, 'h18b')$$,
      (SELECT d2 FROM t4490_hd) + 1), 'PT409', 'offer_space_taken', 'H-18b the combination cannot be booked instantly over it');
END
$h18$;
SELECT public.t4490_reset();

-- ===========================================================================
-- H-19 a deposit paid after the approved hold lapsed (not yet swept) goes to
-- refund due; the booking needs checking.
-- ===========================================================================
SELECT public.t4490_service();
DO $h19$
DECLARE
  v_p jsonb;
  v_ref text;
BEGIN
  v_p := public.issue_4490_prepare_offer_payment(public.t4490_id('g_d'), sha256(convert_to('tok:h7d', 'UTF8')), NULL,
    'pay-key-h19', (SELECT version FROM public.stay_reservation_groups WHERE id = public.t4490_id('g_d')), 'deposit');
  INSERT INTO t4490_ids VALUES ('att_h19', (v_p->>'attemptId')::uuid);
END
$h19$;
SELECT public.t4490_reset();
UPDATE public.stay_inventory_holds SET expires_at = now() - interval '1 minute' WHERE group_id = public.t4490_id('g_d');
SELECT public.t4490_service();
DO $h19b$
DECLARE
  v_ref text := 'mingla_stay_' || replace(public.t4490_id('att_h19')::text, '-', '');
BEGIN
  PERFORM public.issue_1389_bind_payment_attempt(public.t4490_id('att_h19'), v_ref, NULL, NULL);
  PERFORM public.issue_1389_finalize_payment('paystack', 'evt-h19', 'charge.success', v_ref, 'ch-h19',
    (SELECT amount_minor FROM public.stay_payment_attempts WHERE id = public.t4490_id('att_h19')), 'NGN', 0, NULL);
  PERFORM public.t4490_ok((SELECT state FROM public.stay_payment_attempts WHERE id = public.t4490_id('att_h19')) = 'refund_due'
    AND (SELECT state FROM public.stay_reservation_groups WHERE id = public.t4490_id('g_d')) = 'reconciliation_required',
    'H-19a a payment after the hold lapsed is refund due and the booking needs checking');
END
$h19b$;
SELECT public.t4490_reset();

-- ===========================================================================
-- H-20 next free dates skip booked evenings.
-- ===========================================================================
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
DO $h20$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_next_free_dates(public.t4490_id('hire'), public.t4490_id('o_greenlounge'), (SELECT d1 FROM t4490_hd), 3);
  PERFORM public.t4490_ok(jsonb_array_length(v) = 3
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE (x->>'localDate')::date = (SELECT d1 FROM t4490_hd)
                    AND x->>'sessionLabel' = 'Evening'),
    'H-20a next free dates for Green Area + Lounge skip the evening on hold');
END
$h20$;
SELECT public.t4490_reset();

-- ===========================================================================
-- H-21 a hire with no date-change rule offers the guest no move or party change.
-- ===========================================================================
SELECT public.t4490_service();
DO $h21$
DECLARE
  v_gid uuid := public.t4490_id('g_b');
BEGIN
  PERFORM public.t4490_pay_mode(v_gid, 'h5', 'deposit');
  PERFORM public.t4490_ok(NOT (public.issue_4490_change_rules(v_gid)->>'canMove')::boolean
    AND NOT (public.issue_4490_change_rules(v_gid)->>'canChangeGuests')::boolean,
    'H-21a the guest is not offered "move the day" or "change guests" on a hire');
END
$h21$;
SELECT public.t4490_reset();
SELECT set_config('t4490.ver', (SELECT version::text FROM public.stay_reservation_groups WHERE id = public.t4490_id('g_b')), false);
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
-- [TEST-MOD-APPROVED #4490] The P4 follow-up (20281203174490) lets staff change a hire's
-- party (claims and prices follow; proven in issue_4490_p4_hire_followups K-3/K-4), so
-- the change is no longer refused as "not allowed".
DO $h21b$
DECLARE
  v_err text;
BEGIN
  BEGIN
    PERFORM public.issue_4490_change_booking(public.t4490_id('g_b'), 'change_guests', '{"guests":320}'::jsonb, true);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM public.t4490_ok(v_err IS DISTINCT FROM 'offer_change_not_allowed',
    'H-21b staff may change a hire''s party now (preview: ' || COALESCE(v_err, 'ok') || ')');
END
$h21b$;
SELECT public.t4490_reset();

-- ===========================================================================
-- H-22 Admin: dispute view and force-expire (audited).
-- ===========================================================================
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES ('44907000-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'p4u8-4490@example.test', now(), now());
INSERT INTO public.admin_users (email, role, status) VALUES ('p4u8-4490@example.test', 'admin', 'active');
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT public.issue_4490_manage_hire('set_booking', '44907000-0000-4000-9000-0000000000a1',
  jsonb_build_object('offerId', public.t4490_id('hire'), 'mode', 'request'), public.t4490_v(public.t4490_id('hire')), 'p4-h22-request');
SELECT public.t4490_reset();
SELECT public.t4490_service();
DO $h22a$
DECLARE
  v_x uuid;
BEGIN
  v_x := public.t4490_hire('o_south', (SELECT d2 FROM t4490_hd) + 2, 'Full day', 80, 'h22');
  PERFORM public.t4490_staff('01', v_x, 'approve', '{}'::jsonb, 'p4-h22-approve');
  INSERT INTO t4490_ids VALUES ('g_x', v_x);
END
$h22a$;
SELECT public.t4490_reset();
SELECT public.t4490_as('44907000-0000-4000-8000-000000000008');
DO $h22$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_admin_booking(public.t4490_id('g_b'));
  PERFORM public.t4490_ok(jsonb_array_length(v->'timeline') >= 4 AND v->'policySnapshot' ? 'refundLadder'
    AND jsonb_array_length(v->'claims') = 3, 'H-22a Admin sees the timeline, the policy snapshot and the space claims');
  v := public.issue_4490_admin_force_expire_hold(public.t4490_id('g_x'), 'Guest asked support to drop it');
  PERFORM public.t4490_ok(v->>'state' = 'request_expired' AND v->'hire'->>'closedReason' = 'expired'
    AND jsonb_array_length(v->'claims') = 1 AND v->'claims'->0->>'state' = 'released'
    AND EXISTS (SELECT 1 FROM public.admin_audit_log l WHERE l.action = 'venue_hold_force_expire'
                AND l.target_id = public.t4490_id('g_x')::text),
    'H-22b Admin force-expires a hold with a reason: space freed, audit row written');
END
$h22$;
SELECT public.t4490_reset();

-- ===========================================================================
-- H-23 the ten booking states read back and map to the Requests tabs.
-- (finalizing and partially_cancelled are set directly: a one-line hire
-- passes through finalizing inside one transaction and is never partly
-- cancelled.)
-- ===========================================================================
UPDATE public.stay_reservation_groups SET state = 'finalizing' WHERE id = public.t4490_id('g_i');
UPDATE public.stay_reservation_groups SET state = 'partially_cancelled' WHERE id = public.t4490_id('g_b');
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
DO $h23$
DECLARE
  v jsonb;
  v_states text[];
  v_tab record;
BEGIN
  v := public.issue_4490_requests_list('44907000-0000-4000-9000-0000000000a1', 'all');
  SELECT array_agg(DISTINCT r->>'state' ORDER BY r->>'state') INTO v_states FROM jsonb_array_elements(v->'requests') r;
  PERFORM public.t4490_ok(v_states @> ARRAY['approved_payment_required', 'cancelled', 'declined', 'finalizing',
      'partially_cancelled', 'reconciliation_required', 'request_expired', 'request_pending'],
    'H-23a hire bookings listed in eight more states (instant_payment_pending: H-18a, confirmed: H-8b): ' || array_to_string(v_states, ', '));
  FOR v_tab IN SELECT r->>'state' AS state, r->>'tab' AS tab FROM jsonb_array_elements(v->'requests') r LOOP
    IF v_tab.tab <> (CASE
         WHEN v_tab.state = 'request_pending' THEN 'to_answer'
         WHEN v_tab.state IN ('approved_payment_required', 'finalizing', 'instant_payment_pending') THEN 'waiting_for_deposit'
         WHEN v_tab.state IN ('confirmed', 'partially_cancelled') THEN 'confirmed'
         ELSE 'closed' END) THEN
      RAISE EXCEPTION 'T4490 FAIL: H-23b % is on tab %', v_tab.state, v_tab.tab;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS  H-23b each state is on its tab (To answer, Waiting for deposit, Confirmed, Closed; Needs checking in Closed)';
  PERFORM public.t4490_ok((public.issue_4490_get_booking(public.t4490_id('g_d'))->>'state') = 'reconciliation_required'
    AND (public.issue_4490_get_booking(public.t4490_id('g_e'))->'hire'->>'closedReason') = 'declined',
    'H-23c the staff booking read carries the state and the hire facts');
END
$h23$;
SELECT public.t4490_reset();
SELECT public.t4490_service();
SELECT public.t4490_ok((public.issue_4490_booking_projection(public.t4490_id('g_x'), NULL)->>'state') = 'request_expired'
  AND public.issue_4490_booking_projection(public.t4490_id('g_x'), NULL) ? 'hire',
  'H-23d the guest read renders every state (here: expired) with the hire block');
-- N150 (#4490): issue_4490_enqueue_offer_event is a #1529 populating producer that writes an
-- explicit NULL country_code (the row's contact is an email; no SMS leg can
-- reach a handset from it). Assert it on the rows this suite enqueued.
SELECT public.t4490_service();
SELECT public.t4490_ok((SELECT count(*) FROM public.notification_outbox WHERE category_key IN ('venue_request_received','venue_request_action_needed','venue_payment_required','venue_request_declined','venue_request_expired')) > 0
  AND NOT EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key IN ('venue_request_received','venue_request_action_needed','venue_payment_required','venue_request_declined','venue_request_expired') AND country_code IS NOT NULL),
  'H-24 the #4490 outbox rows carry an explicit NULL country_code (#1529)');
SELECT public.t4490_reset();
ROLLBACK;
