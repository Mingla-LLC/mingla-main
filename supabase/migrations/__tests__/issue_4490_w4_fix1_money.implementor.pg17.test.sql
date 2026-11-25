-- #4490 spec 06 W4 fix 1 (20281203484490): executable PostgreSQL 17 proof. COMMITS its fixtures
-- (suite-owned database): N3-f runs two real sessions (dblink) on one booking.
--
-- MINGLA-INVARIANT: I-4490-ROW-PRICE-IS-THE-QUOTE | issue #4490 | the price an entry option shows for a chosen window (its own availability row, pg_venue_offer_availability with the option) is exactly the unit price the quote charges for that option and window (busy-time rules, weekday-only options and free options included), and an option the row refuses is refused by the quote.
-- MINGLA-INVARIANT: I-4490-PLAN-CHARGE-ONE-OWNER | issue #4490 | what a plan payment charges (VAT added or included, fees, monthly or yearly, first payment, approved request, renewal) is issue_4490_member_charge over the plan offering's fee lines; the member read (paymentDue.amountMinor, plan.charge), the public plan read (plans[].charge), the Host members list and the member emails show that number, and the payment page is asked for the same number.
-- MINGLA-INVARIANT: I-4490-ONE-LIVE-PAYMENT-PAGE | issue #4490 | a booking (or plan period) has at most one payment in flight: a second pay of the same stage and amount gets the open attempt and its remembered page, a different stage or amount at the same time is refused (offer_payment_mode_conflict), two concurrent sessions make one attempt, and a second successful first payment on an already paid booking is recorded as refund due and queued for refund without moving the paid booking.
--
-- N1 row price = quote. N2 plan charges. N3 one live payment page.
--
-- FAILS-ON-REVERT: without 20281203484490, N2-b fails (paymentDue.amountMinor is the plan price
-- 5,000,000, the page charges 5,375,000), N2-a fails (no plans[].charge), N3-a fails (a second
-- attempt is created), N3-f fails (two attempts), N3-g fails (the paid booking moves to
-- reconciliation_required).
\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS dblink;
-- Suite-owned database (#4490): this suite COMMITs its fixtures for the dblink
-- race, so it records the feature flags it switches on and, at the end,
-- removes everything it committed (see the cleanup block at the end).
CREATE TABLE public.t4490_cleanup_flags AS
SELECT k AS flag_key, f.is_enabled, f.flag_key IS NOT NULL AS existed
FROM unnest(ARRAY['VENUE_OFFERS_READS', 'VENUE_OFFERS_WRITES', 'STAY_RESERVE_READS', 'STAY_RESERVE_WRITES']) k
LEFT JOIN public.feature_flags f ON f.flag_key = k;
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;
INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS', 'VENUE_OFFERS_WRITES']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

CREATE FUNCTION public.t4490f_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490 FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490f_expect(p_sql text, p_state text, p_message text, p_label text)
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
CREATE FUNCTION public.t4490f_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', false);
  PERFORM set_config('request.jwt.claim.role', '', false);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), false);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN '{"role":"anon"}'
         ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, false);
  PERFORM set_config('role', CASE WHEN p_user IS NULL THEN 'anon' ELSE 'authenticated' END, false);
END
$f$;
CREATE FUNCTION public.t4490f_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', false);
  PERFORM set_config('request.jwt.claim.sub', '', false);
  PERFORM set_config('request.jwt.claim.role', 'service_role', false);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', false);
END
$f$;
CREATE FUNCTION public.t4490f_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', false);
  PERFORM set_config('request.jwt.claim.sub', '', false);
  PERFORM set_config('request.jwt.claim.role', '', false);
  PERFORM set_config('request.jwt.claims', '', false);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f_ok(boolean, text), public.t4490f_expect(text, text, text, text),
  public.t4490f_as(uuid), public.t4490f_service(), public.t4490f_reset() TO PUBLIC;

CREATE TABLE public.t4490f_ids (k text PRIMARY KEY, v uuid);
CREATE TABLE public.t4490f_json (k text PRIMARY KEY, v jsonb);
GRANT ALL ON public.t4490f_ids, public.t4490f_json TO PUBLIC;
CREATE FUNCTION public.t4490f_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$ SELECT v FROM public.t4490f_ids WHERE k = p_k $f$;
CREATE FUNCTION public.t4490f_key(p_seed text) RETURNS text LANGUAGE sql AS $f$ SELECT encode(sha256(convert_to(p_seed, 'UTF8')), 'hex') $f$;
CREATE FUNCTION public.t4490f_tok(p_seed text) RETURNS bytea LANGUAGE sql AS $f$ SELECT sha256(convert_to('tok:' || p_seed, 'UTF8')) $f$;
CREATE FUNCTION public.t4490f_day() RETURNS date LANGUAGE sql AS $f$ SELECT (now() AT TIME ZONE 'Africa/Lagos')::date + 3 $f$;
GRANT EXECUTE ON FUNCTION public.t4490f_id(text), public.t4490f_key(text), public.t4490f_tok(text), public.t4490f_day() TO PUBLIC;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
  ('44947000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'w4fix1-owner-4490@example.test', now(), now());
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44947000-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider, payout_hold_cutover_at, created_at, updated_at)
VALUES ('44947000-0000-4000-9000-000000000010', '44947000-0000-4000-8000-000000000001', 'W4 Fix 4490',
        'w4-fix-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44947000-0000-4000-9000-0000000000a1', '44947000-0000-4000-9000-000000000010', 'w4fixadded', 'W4 Added', 6.45, 3.40, 'play', 'verified', 'NG'),
  ('44947000-0000-4000-9000-0000000000a2', '44947000-0000-4000-9000-000000000010', 'w4fixincluded', 'W4 Included', 6.45, 3.41, 'coworking', 'verified', 'NG');

-- ===========================================================================
-- Fixture (owner). A1, VAT added: a timed Entry with the W3 fix-2 price shapes (a dearer busy
-- time, a cheaper busy time, a weekday-only price, a free price beside paid ones), and plans
-- (monthly, yearly, by request). A2, VAT included: a monthly plan.
-- ===========================================================================
SELECT public.t4490f_as('44947000-0000-4000-8000-000000000001');
DO $fx$
DECLARE
  a1 uuid := '44947000-0000-4000-9000-0000000000a1';
  a2 uuid := '44947000-0000-4000-9000-0000000000a2';
  every jsonb := '[0,1,2,3,4,5,6]'::jsonb;
  v jsonb;
  v_offer uuid;
  o jsonb;
  n int := 0;
BEGIN
  PERFORM public.issue_4490_set_venue_feature(a1, 'entry', true, NULL, NULL, NULL, 'f1-a1-entry');
  PERFORM public.issue_4490_set_venue_feature(a1, 'memberships', true, NULL, NULL, NULL, 'f1-a1-members');
  PERFORM public.issue_4490_set_venue_feature(a2, 'memberships', true, NULL, NULL, NULL, 'f1-a2-members');
  PERFORM public.issue_4490_save_booking_settings(a1, '{"vatMode":"added"}'::jsonb, NULL, 'f1-a1-vat');
  PERFORM public.issue_4490_save_booking_settings(a2, '{"vatMode":"included"}'::jsonb, NULL, 'f1-a2-vat');

  v := public.issue_4490_manage_offer('create_draft', a1, '{"kind":"entry","name":"Hours","entryStyle":"timed_session","sessionCapacity":25}'::jsonb, NULL, 'w4f1-fx-o-d');
  v_offer := (v->>'id')::uuid;
  INSERT INTO public.t4490f_ids VALUES ('hours', v_offer);
  v := public.issue_4490_manage_capacity_pool('create', a1, '{"name":"F1 pool","dailyLimit":400,"keptForWalkIns":0}'::jsonb, NULL, 'w4f1-fx-pool');
  v := public.issue_4490_manage_offer('set_pool', a1, jsonb_build_object('offerId', v_offer, 'poolId', (v->>'id')::uuid),
    (SELECT version FROM public.stay_offerings WHERE id = v_offer), 'w4f1-fx-o-p');
  v := public.issue_4490_manage_offer('set_schedule', a1, jsonb_build_object('offerId', v_offer, 'mode', 'sessions', 'weekdays', every,
    'startTime', '10:00', 'endTime', '18:00', 'sessionMinutes', 60, 'sessionEveryMinutes', 60),
    (SELECT version FROM public.stay_offerings WHERE id = v_offer), 'w4f1-fx-o-s');
  FOR o IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('name', 'Any time', 'unit', 'guest', 'guestMin', 1, 'guestMax', 6, 'priceMinor', 300000,
      'busyRules', jsonb_build_array(jsonb_build_object('weekdays', every, 'from', '16:00', 'to', '18:00', 'amount_minor', 450000))),
    jsonb_build_object('name', 'Lunch', 'unit', 'guest', 'guestMin', 1, 'guestMax', 6, 'priceMinor', 300000,
      'busyRules', jsonb_build_array(jsonb_build_object('weekdays', every, 'from', '12:00', 'to', '14:00', 'amount_minor', 150000))),
    jsonb_build_object('name', 'Weekday', 'unit', 'guest', 'guestMin', 1, 'guestMax', 6, 'priceMinor', 250000,
      'weekdays', '[0,1,2,3,4]'::jsonb),
    jsonb_build_object('name', 'Under 5', 'unit', 'guest', 'guestMin', 1, 'guestMax', 6, 'priceMinor', 0)))
  LOOP
    n := n + 1;
    v := public.issue_4490_manage_offer('upsert_price_option', a1, o || jsonb_build_object('offerId', v_offer),
      (SELECT version FROM public.stay_offerings WHERE id = v_offer), 'w4f1-fx-o-o' || n);
  END LOOP;
  INSERT INTO public.t4490f_ids SELECT 'opt_' || lower(replace(x->>'name', ' ', '_')), (x->>'id')::uuid
  FROM jsonb_array_elements(v->'options') x;
  v := public.issue_4490_manage_offer('set_policy', a1, jsonb_build_object('offerId', v_offer, 'refundLadder',
    jsonb_build_array(jsonb_build_object('minMinutesBefore', 0, 'refundBps', 10000))),
    (SELECT version FROM public.stay_offerings WHERE id = v_offer), 'w4f1-fx-o-pol');
  v := public.issue_4490_manage_offer('publish', a1, jsonb_build_object('offerId', v_offer),
    (SELECT version FROM public.stay_offerings WHERE id = v_offer), 'w4f1-fx-o-pub');
  PERFORM public.t4490f_ok(v->>'status' = 'live', 'fixture: the timed Entry is live');

  FOR o IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('k', 'flex', 'venue', a1, 'name', 'Flex desk', 'priceMinor', 5000000, 'period', 'month'),
    jsonb_build_object('k', 'year', 'venue', a1, 'name', 'Desk year', 'priceMinor', 60000000, 'period', 'year'),
    jsonb_build_object('k', 'ask', 'venue', a1, 'name', 'Ask desk', 'priceMinor', 5000000, 'period', 'month', 'joinMode', 'request'),
    jsonb_build_object('k', 'club', 'venue', a2, 'name', 'Club', 'priceMinor', 3000000, 'period', 'month')))
  LOOP
    v := public.issue_4490_manage_membership_plan('create', (o->>'venue')::uuid, (o - 'k' - 'venue')
      || jsonb_build_object('inclusions', jsonb_build_array('Every day'), 'graceDays', 7), NULL, 'f1-plan-' || (o->>'k'));
    INSERT INTO public.t4490f_ids VALUES ('plan_' || (o->>'k'), (v->>'id')::uuid);
    v := public.issue_4490_manage_membership_plan('publish', (o->>'venue')::uuid,
      jsonb_build_object('planId', (v->>'id')::uuid), 1, 'f1-plan-pub-' || (o->>'k'));
  END LOOP;
END
$fx$;
SELECT public.t4490f_reset();
COMMIT;

-- ===========================================================================
-- N1 (W4-N1): each option's own availability row prices a window exactly as the quote does.
-- ===========================================================================
SELECT public.t4490f_service();
DO $n1$
DECLARE
  r record;
  v_q jsonb;
  v_priced int := 0;
  v_refused int := 0;
  v_prices bigint[] := '{}';
  v_err text;
  i int := 0;
BEGIN
  FOR r IN
    SELECT o.id AS opt, o.name, a.window_id, a.status, a.price_minor
    FROM public.venue_offer_price_options o
    CROSS JOIN LATERAL public.pg_venue_offer_availability(public.t4490f_id('hours'), public.t4490f_day(),
      public.t4490f_day() + 6, NULL, o.id) a
    WHERE o.offering_id = public.t4490f_id('hours') AND o.status = 'active'
    ORDER BY a.starts_at, o.name
  LOOP
    i := i + 1;
    IF r.status = 'available' THEN
      v_q := public.issue_4490_quote_offer(public.t4490f_id('hours'), r.window_id,
        jsonb_build_array(jsonb_build_object('priceOptionId', r.opt, 'guests', 1)),
        public.t4490f_key('cart:n1'), NULL, 'f1-n1-q-' || i);
      IF (v_q->'lines'->0->>'unitPriceMinor')::bigint IS DISTINCT FROM r.price_minor THEN
        RAISE EXCEPTION 'T4490 FAIL: N1-a % at window %: row says %, quote charges %', r.name, r.window_id,
          r.price_minor, v_q->'lines'->0->>'unitPriceMinor';
      END IF;
      v_priced := v_priced + 1;
      v_prices := v_prices || r.price_minor;
    ELSIF r.status = 'wrong_weekday' THEN
      v_err := NULL;
      BEGIN
        PERFORM public.issue_4490_quote_offer(public.t4490f_id('hours'), r.window_id,
          jsonb_build_array(jsonb_build_object('priceOptionId', r.opt, 'guests', 1)),
          public.t4490f_key('cart:n1'), NULL, 'f1-n1-q-' || i);
      EXCEPTION WHEN OTHERS THEN
        v_err := SQLERRM;
      END;
      IF v_err IS NULL OR v_err NOT LIKE 'offer_wrong_%' THEN
        RAISE EXCEPTION 'T4490 FAIL: N1-b % at window % refused by the row but the quote said %', r.name, r.window_id, v_err;
      END IF;
      v_refused := v_refused + 1;
    END IF;
  END LOOP;
  PERFORM public.t4490f_ok(v_priced >= 40 AND 450000 = ANY(v_prices) AND 150000 = ANY(v_prices)
      AND 300000 = ANY(v_prices) AND 250000 = ANY(v_prices) AND 0 = ANY(v_prices),
    'N1-a ' || v_priced || ' option/window rows: each row price equals the quote''s unit price (dearer busy 4,500, cheaper busy 1,500, list 3,000, weekday 2,500, free 0)');
  PERFORM public.t4490f_ok(v_refused >= 8,
    'N1-b ' || v_refused || ' weekend rows refuse the weekday-only price, and so does the quote');
END
$n1$;
SELECT public.t4490f_reset();

-- ===========================================================================
-- N2 (W4-N2): a plan's charge, one owner, every reader.
-- ===========================================================================
SELECT public.t4490f_service();
DO $n2a$
DECLARE
  v jsonb := public.issue_4490_public_memberships('44947000-0000-4000-9000-0000000000a1', ARRAY['memberships']);
  w jsonb := public.issue_4490_public_memberships('44947000-0000-4000-9000-0000000000a2', ARRAY['memberships']);
  flex jsonb;
  yr jsonb;
  club jsonb;
BEGIN
  SELECT p INTO flex FROM jsonb_array_elements(v->'plans') p WHERE p->>'name' = 'Flex desk';
  SELECT p INTO yr FROM jsonb_array_elements(v->'plans') p WHERE p->>'name' = 'Desk year';
  SELECT p INTO club FROM jsonb_array_elements(w->'plans') p WHERE p->>'name' = 'Club';
  PERFORM public.t4490f_ok((flex->>'priceMinor')::bigint = 5000000
      AND flex->'charge' @> '{"unit":"minor","baseMinor":5000000,"taxMinor":375000,"feeMinor":0,"totalMinor":5375000,"vatMode":"added"}'::jsonb
      AND (flex->'charge'->>'vatRatePct')::numeric = 7.5,
    'N2-a VAT added, monthly: the plan read says 50,000 a month and its charge is 53,750 (VAT 3,750 at 7.5%)');
  PERFORM public.t4490f_ok(yr->'charge' @> '{"baseMinor":60000000,"taxMinor":4500000,"totalMinor":64500000,"vatMode":"added"}'::jsonb,
    'N2-a2 VAT added, yearly: 600,000 a year charges 645,000');
  PERFORM public.t4490f_ok(club->'charge' @> '{"baseMinor":3000000,"taxMinor":209302,"totalMinor":3000000,"vatMode":"included"}'::jsonb,
    'N2-a3 VAT included: 30,000 a month charges 30,000 (of which VAT 2,093.02)');
END
$n2a$;

CREATE FUNCTION public.t4490f_join(p_plan uuid, p_seed text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT public.issue_4490_membership_join(gen_random_uuid(), p_plan,
    jsonb_build_object('name', 'Member ' || p_seed, 'email', p_seed || '@example.org'), NULL,
    public.t4490f_key('cart:' || p_seed), NULL, sha256(convert_to('mtok:' || p_seed, 'UTF8')), 'f1-join-' || p_seed);
$f$;
CREATE FUNCTION public.t4490f_mprep(p_sub uuid, p_seed text, p_key text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT public.issue_4490_membership_prepare_payment(p_sub, sha256(convert_to('mtok:' || p_seed, 'UTF8')), NULL, p_key);
$f$;
CREATE FUNCTION public.t4490f_mget(p_sub uuid, p_seed text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT public.issue_4490_membership_get(p_sub, sha256(convert_to('mtok:' || p_seed, 'UTF8')), NULL, NULL);
$f$;
CREATE FUNCTION public.t4490f_mpaid(p_prep jsonb, p_evt text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v_ref text := 'mingla_stay_' || replace(p_prep->>'attemptId', '-', '');
BEGIN
  PERFORM public.issue_1389_bind_payment_attempt((p_prep->>'attemptId')::uuid, v_ref, NULL, NULL);
  PERFORM public.issue_1389_finalize_payment('paystack', p_evt, 'charge.success', v_ref, 'ch-' || p_evt,
    (p_prep->>'amountMinor')::bigint, 'NGN', 0, NULL);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f_join(uuid, text), public.t4490f_mprep(uuid, text, text),
  public.t4490f_mget(uuid, text), public.t4490f_mpaid(jsonb, text) TO PUBLIC;

DO $n2b$
DECLARE
  j jsonb;
  p jsonb;
  g jsonb;
  v_sub uuid;
BEGIN
  -- Monthly, VAT added, instant.
  j := public.t4490f_join(public.t4490f_id('plan_flex'), 'flex1');
  v_sub := (j->>'subscriptionId')::uuid;
  INSERT INTO public.t4490f_ids VALUES ('sub_flex1', v_sub);
  PERFORM public.t4490f_ok((j->'paymentDue'->>'amountMinor')::bigint = 5375000
      AND j->'paymentDue' @> '{"baseMinor":5000000,"taxMinor":375000,"totalMinor":5375000,"vatMode":"added","unit":"minor"}'::jsonb
      AND (j->'plan'->'charge'->>'totalMinor')::bigint = 5375000 AND (j->'plan'->>'priceMinor')::bigint = 5000000,
    'N2-b the join answer''s amount due is 53,750 with VAT 3,750 (was the plan price 50,000); plan.charge agrees');
  p := public.t4490f_mprep(v_sub, 'flex1', 'f1-mpay-flex1-a');
  PERFORM public.t4490f_ok((p->>'amountMinor')::bigint = (j->'paymentDue'->>'amountMinor')::bigint,
    'N2-c the payment page is asked for exactly the amount the join answer showed (' || (p->>'amountMinor') || ')');
  g := public.t4490f_mget(v_sub, 'flex1');
  PERFORM public.t4490f_ok((g->'paymentDue'->>'amountMinor')::bigint = (p->>'amountMinor')::bigint,
    'N2-c2 with the payment open, the member read still shows the open payment''s own amount');
  INSERT INTO public.t4490f_json VALUES ('prep_flex1', p);

  -- Yearly, VAT added.
  j := public.t4490f_join(public.t4490f_id('plan_year'), 'year1');
  p := public.t4490f_mprep((j->>'subscriptionId')::uuid, 'year1', 'f1-mpay-year1-a');
  PERFORM public.t4490f_ok((j->'paymentDue'->>'amountMinor')::bigint = 64500000 AND (p->>'amountMinor')::bigint = 64500000,
    'N2-d yearly: amount due 645,000 = the page''s amount');

  -- Monthly, VAT included.
  j := public.t4490f_join(public.t4490f_id('plan_club'), 'club1');
  p := public.t4490f_mprep((j->>'subscriptionId')::uuid, 'club1', 'f1-mpay-club1-a');
  PERFORM public.t4490f_ok((j->'paymentDue'->>'amountMinor')::bigint = 3000000 AND (p->>'amountMinor')::bigint = 3000000
      AND j->'paymentDue' @> '{"vatMode":"included","taxMinor":209302,"baseMinor":3000000}'::jsonb,
    'N2-e VAT included: amount due 30,000 = the page''s amount, VAT 2,093.02 inside it');
END
$n2b$;
SELECT public.t4490f_reset();

-- By request: nothing due until the venue says yes; then the same charge.
SELECT public.t4490f_service();
DO $n2f1$
DECLARE j jsonb;
BEGIN
  j := public.t4490f_join(public.t4490f_id('plan_ask'), 'ask1');
  INSERT INTO public.t4490f_ids VALUES ('sub_ask1', (j->>'subscriptionId')::uuid);
  PERFORM public.t4490f_ok(j->>'status' = 'requested' AND j->'paymentDue' = 'null'::jsonb
      AND (j->'plan'->'charge'->>'totalMinor')::bigint = 5375000,
    'N2-f1 a by-request plan: nothing due on asking; plan.charge already says 53,750');
END
$n2f1$;
SELECT public.t4490f_as('44947000-0000-4000-8000-000000000001');
SELECT public.issue_4490_manage_member(public.t4490f_id('sub_ask1'), 'approve_request', '{}'::jsonb,
  (SELECT version FROM public.venue_membership_subscriptions WHERE id = public.t4490f_id('sub_ask1')), 'f1-approve-ask1');
DO $n2h$
DECLARE
  v jsonb := public.issue_4490_venue_members('44947000-0000-4000-9000-0000000000a1', 'all');
  m jsonb;
BEGIN
  SELECT x INTO m FROM jsonb_array_elements(v->'members') x WHERE (x->>'subscriptionId')::uuid = public.t4490f_id('sub_flex1');
  PERFORM public.t4490f_ok((m->>'amountDueMinor')::bigint = 5375000,
    'N2-h the Host members list shows the member''s amount due as the page charges it (53,750)');
END
$n2h$;
SELECT public.t4490f_service();
DO $n2f2$
DECLARE
  g jsonb := public.t4490f_mget(public.t4490f_id('sub_ask1'), 'ask1');
  p jsonb;
BEGIN
  p := public.t4490f_mprep(public.t4490f_id('sub_ask1'), 'ask1', 'f1-mpay-ask1-a');
  PERFORM public.t4490f_ok((g->'paymentDue'->>'amountMinor')::bigint = 5375000 AND (p->>'amountMinor')::bigint = 5375000,
    'N2-f2 approved: the first payment due is 53,750 and the page is asked for 53,750');
  PERFORM public.t4490f_ok(EXISTS (SELECT 1 FROM public.notification_outbox ob
      WHERE ob.payload->>'subscription_id' = public.t4490f_id('sub_ask1')::text AND ob.payload ? 'total_cents')
    AND NOT EXISTS (SELECT 1 FROM public.notification_outbox ob
      WHERE ob.payload->>'subscription_id' = public.t4490f_id('sub_ask1')::text AND ob.payload ? 'total_cents'
        AND ((ob.payload->>'total_cents')::bigint <> 5375000 OR (ob.payload->>'vat_cents')::bigint <> 375000
             OR (ob.payload->>'amount_cents')::bigint <> 5000000)),
    'N2-f3 the approval email''s money lines: 50,000 + VAT 3,750 = 53,750');
END
$n2f2$;

-- Renewal: the first month paid; the next month's amount due, page and email agree.
DO $n2g$
DECLARE
  v_sub uuid := public.t4490f_id('sub_flex1');
  v_end timestamptz;
  g jsonb;
  p jsonb;
BEGIN
  PERFORM public.t4490f_mpaid((SELECT v FROM public.t4490f_json WHERE k = 'prep_flex1'), 'evt-f1-flex1-1');
  PERFORM public.t4490f_ok((SELECT status FROM public.venue_membership_subscriptions WHERE id = v_sub) = 'active',
    'N2-g0 the first month is paid (active)');
  SELECT current_period_end INTO v_end FROM public.venue_membership_subscriptions WHERE id = v_sub;
  PERFORM public.issue_4490_membership_billing_run(v_end - interval '7 days', 500);
  g := public.t4490f_mget(v_sub, 'flex1');
  p := public.t4490f_mprep(v_sub, 'flex1', 'f1-mpay-flex1-b');
  PERFORM public.t4490f_ok((g->'paymentDue'->>'amountMinor')::bigint = 5375000 AND (p->>'amountMinor')::bigint = 5375000,
    'N2-g renewal: the next month''s amount due is 53,750 and its page is asked for 53,750');
  PERFORM public.t4490f_ok(EXISTS (SELECT 1 FROM public.notification_outbox ob
      WHERE ob.payload->>'subscription_id' = v_sub::text AND ob.payload->>'step' = 'renewal'
        AND (ob.payload->>'total_cents')::bigint = 5375000 AND (ob.payload->>'vat_cents')::bigint = 375000),
    'N2-g2 the renewal email says 53,750 (VAT 3,750)');
  PERFORM public.t4490f_ok(
    (SELECT (pp->>'amountMinor')::bigint FROM jsonb_array_elements(g->'payments') pp LIMIT 1) = 5000000
      AND (SELECT (pp->>'paidMinor')::bigint FROM jsonb_array_elements(g->'payments') pp LIMIT 1) = 5375000,
    'N2-g3 the paid month keeps its plan price and records what was paid (53,750)');
END
$n2g$;
SELECT public.t4490f_reset();

-- ===========================================================================
-- N3 (W4-N3): one live payment page per booking.
-- ===========================================================================
CREATE FUNCTION public.t4490f_hold(p_seed text, p_hhmm text DEFAULT '10:00') RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_win uuid;
  v_q jsonb;
  v_g jsonb;
BEGIN
  SELECT w.id INTO v_win FROM public.stay_place_windows w
  WHERE w.offering_id = public.t4490f_id('hours') AND w.local_date = public.t4490f_day()
    AND (w.starts_at AT TIME ZONE 'Africa/Lagos')::time = p_hhmm::time;
  v_q := public.issue_4490_quote_offer(public.t4490f_id('hours'), v_win,
    jsonb_build_array(jsonb_build_object('priceOptionId', public.t4490f_id('opt_any_time'), 'guests', 2)),
    public.t4490f_key('cart:' || p_seed), NULL, 'f1-q-' || p_seed);
  v_g := public.issue_4490_create_offer_group(gen_random_uuid(), (v_q->>'quoteId')::uuid,
    jsonb_build_object('name', 'Guest ' || p_seed, 'email', p_seed || '@example.org'),
    public.t4490f_key('cart:' || p_seed), NULL, public.t4490f_tok(p_seed), 'f1-hold-' || p_seed);
  RETURN (v_g->>'groupId')::uuid;
END
$f$;
CREATE FUNCTION public.t4490f_pay(p_group uuid, p_seed text, p_key text, p_mode text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT public.issue_4490_prepare_offer_payment(p_group, public.t4490f_tok(p_seed), NULL, p_key,
    (SELECT version FROM public.stay_reservation_groups WHERE id = p_group), p_mode);
$f$;
GRANT EXECUTE ON FUNCTION public.t4490f_hold(text, text), public.t4490f_pay(uuid, text, text, text) TO PUBLIC;

SELECT public.t4490f_service();
DO $n3a$
DECLARE
  v_g uuid := public.t4490f_hold('n3a');
  a jsonb;
  b jsonb;
  v_ref text;
BEGIN
  INSERT INTO public.t4490f_ids VALUES ('g_n3a', v_g);
  a := public.t4490f_pay(v_g, 'n3a', 'f1-pay-n3a-1');
  v_ref := 'mingla_stay_' || replace(a->>'attemptId', '-', '');
  PERFORM public.issue_1389_bind_payment_attempt((a->>'attemptId')::uuid, v_ref, NULL, NULL);
  PERFORM public.t4490f_ok(public.issue_4490_record_payment_page((a->>'attemptId')::uuid, 'https://checkout.paystack.com/f1n3apage'),
    'N3-a0 the open page is remembered for its attempt');
  b := public.t4490f_pay(v_g, 'n3a', 'f1-pay-n3a-2');
  PERFORM public.t4490f_ok((b->>'reused')::boolean AND b->>'attemptId' = a->>'attemptId'
      AND b->>'checkoutUrl' = 'https://checkout.paystack.com/f1n3apage' AND b->>'providerPaymentRef' = v_ref,
    'N3-a a second pay (another key, another device) gets the SAME attempt and page');
  PERFORM public.t4490f_ok((SELECT count(*) FROM public.stay_payment_attempts WHERE group_id = v_g) = 1,
    'N3-a2 one attempt for the booking');
  PERFORM public.t4490f_ok(NOT public.issue_4490_record_payment_page((a->>'attemptId')::uuid, 'https://evil.example/pay'),
    'N3-a3 only a Paystack page can be remembered');
END
$n3a$;

-- Another stage or amount while that page is open: refused.
ALTER TABLE public.stay_payment_attempts DISABLE TRIGGER USER;
UPDATE public.stay_payment_attempts SET stage = 'deposit' WHERE group_id = public.t4490f_id('g_n3a');
ALTER TABLE public.stay_payment_attempts ENABLE TRIGGER USER;
SELECT public.t4490f_expect(format($q$SELECT public.t4490f_pay(%L, 'n3a', 'f1-pay-n3a-3')$q$, public.t4490f_id('g_n3a')),
  'PT409', 'offer_payment_mode_conflict', 'N3-b a different way of paying while another is open is refused (offer_payment_mode_conflict)');

-- A page older than 15 minutes is not handed out again (the edge asks the provider first).
ALTER TABLE public.stay_payment_attempts DISABLE TRIGGER USER;
UPDATE public.stay_payment_attempts SET stage = 'full', created_at = now() - interval '16 minutes'
WHERE group_id = public.t4490f_id('g_n3a');
ALTER TABLE public.stay_payment_attempts ENABLE TRIGGER USER;
SELECT public.t4490f_expect(format($q$SELECT public.t4490f_pay(%L, 'n3a', 'f1-pay-n3a-4')$q$, public.t4490f_id('g_n3a')),
  'PT409', 'offer_payment_already_pending', 'N3-d an old open page is not reused: in progress (the edge settles it with the provider first)');

-- A payment still talking to the provider ('created') counts as in flight.
DO $n3c$
DECLARE v_g uuid := public.t4490f_hold('n3c', '11:00');
BEGIN
  INSERT INTO public.t4490f_ids VALUES ('g_n3c', v_g);
  PERFORM public.t4490f_pay(v_g, 'n3c', 'f1-pay-n3c-1');
END
$n3c$;
SELECT public.t4490f_expect(format($q$SELECT public.t4490f_pay(%L, 'n3c', 'f1-pay-n3c-2')$q$, public.t4490f_id('g_n3c')),
  'PT409', 'offer_payment_already_pending', 'N3-c a second pay while the first is still opening its page: in progress, no second attempt');
SELECT public.t4490f_ok((SELECT count(*) FROM public.stay_payment_attempts WHERE group_id = public.t4490f_id('g_n3c')) = 1,
  'N3-c2 still one attempt');

-- The same key again is today's replay (unchanged).
SELECT public.t4490f_ok((public.t4490f_pay(public.t4490f_id('g_n3c'), 'n3c', 'f1-pay-n3c-1')->>'attemptId')
  = (SELECT id::text FROM public.stay_payment_attempts WHERE group_id = public.t4490f_id('g_n3c')),
  'N3-c3 the same key replays the same attempt');

-- Nobody but the service role writes or reads the remembered pages.
SELECT public.t4490f_ok(NOT has_function_privilege('anon', 'public.issue_4490_record_payment_page(uuid, text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.issue_4490_record_payment_page(uuid, text)', 'EXECUTE')
    AND NOT has_table_privilege('anon', 'public.issue_4490_payment_pages', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.issue_4490_payment_pages', 'SELECT')
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.issue_4490_payment_pages'::regclass),
  'N3-e remembered pages: RLS on, no anon or signed-in read, write only by the service role');

-- Backstop: two attempts both succeed at the provider.
DO $n3g$
DECLARE
  v_g uuid := public.t4490f_hold('n3g', '13:00');
  a jsonb;
  b jsonb;
  v_ra text;
  v_rb text;
BEGIN
  a := public.t4490f_pay(v_g, 'n3g', 'f1-pay-n3g-1');
  v_ra := 'mingla_stay_' || replace(a->>'attemptId', '-', '');
  PERFORM public.issue_1389_bind_payment_attempt((a->>'attemptId')::uuid, v_ra, NULL, NULL);
  -- The guest closed page A (closed as abandoned), opened page B on another device ...
  PERFORM public.issue_1389_record_payment_create_failure((a->>'attemptId')::uuid, 'provider_abandoned', false);
  b := public.t4490f_pay(v_g, 'n3g', 'f1-pay-n3g-2');
  v_rb := 'mingla_stay_' || replace(b->>'attemptId', '-', '');
  PERFORM public.issue_1389_bind_payment_attempt((b->>'attemptId')::uuid, v_rb, NULL, NULL);
  -- ... and BOTH pages were paid.
  PERFORM public.issue_1389_finalize_payment('paystack', 'evt-f1-n3g-b', 'charge.success', v_rb, 'ch-f1-n3g-b',
    (b->>'amountMinor')::bigint, 'NGN', 0, NULL);
  PERFORM public.t4490f_ok((SELECT state FROM public.stay_reservation_groups WHERE id = v_g) = 'confirmed',
    'N3-g0 page B confirmed the booking');
  PERFORM public.issue_1389_finalize_payment('paystack', 'evt-f1-n3g-a', 'charge.success', v_ra, 'ch-f1-n3g-a',
    (a->>'amountMinor')::bigint, 'NGN', 0, NULL);
  PERFORM public.t4490f_ok((SELECT state FROM public.stay_reservation_groups WHERE id = v_g) = 'confirmed'
      AND (SELECT state || '/' || failure_code FROM public.stay_payment_attempts WHERE id = (a->>'attemptId')::uuid) = 'refund_due/duplicate_payment',
    'N3-g the second success is recorded as a duplicate, refund due; the paid booking stays confirmed');
  PERFORM public.t4490f_ok(EXISTS (SELECT 1 FROM public.stay_refunds r
        WHERE r.payment_attempt_id = (a->>'attemptId')::uuid AND r.amount_minor = (a->>'amountMinor')::bigint AND r.state = 'submitted')
      AND EXISTS (SELECT 1 FROM public.source_refunds s JOIN public.stay_refunds r ON r.source_refund_id = s.id
        WHERE r.payment_attempt_id = (a->>'attemptId')::uuid AND s.buyer_refund_requested_cents = (a->>'amountMinor')::bigint)
      AND EXISTS (SELECT 1 FROM public.stay_reservation_events e WHERE e.group_id = v_g AND e.event_type = 'stay_payment_duplicate_refund_due')
      AND EXISTS (SELECT 1 FROM public.stay_money_ledger l WHERE l.payment_attempt_id = (a->>'attemptId')::uuid
        AND l.entry_type = 'charge_succeeded' AND (l.metadata->>'duplicate')::boolean),
    'N3-g2 the duplicate is in the money ledger and its full refund is queued (stay_refunds + source_refunds), never kept silently');
END
$n3g$;

-- Plans: the period's open payment is handed back too.
DO $n3h$
DECLARE
  j jsonb := public.t4490f_join(public.t4490f_id('plan_flex'), 'flex2');
  a jsonb;
  b jsonb;
BEGIN
  a := public.t4490f_mprep((j->>'subscriptionId')::uuid, 'flex2', 'f1-mpay-flex2-a');
  PERFORM public.issue_1389_bind_payment_attempt((a->>'attemptId')::uuid, 'mingla_stay_' || replace(a->>'attemptId', '-', ''), NULL, NULL);
  PERFORM public.issue_4490_record_payment_page((a->>'attemptId')::uuid, 'https://checkout.paystack.com/f1flex2');
  b := public.t4490f_mprep((j->>'subscriptionId')::uuid, 'flex2', 'f1-mpay-flex2-b');
  PERFORM public.t4490f_ok((b->>'reused')::boolean AND b->>'attemptId' = a->>'attemptId'
      AND b->>'checkoutUrl' = 'https://checkout.paystack.com/f1flex2' AND b->>'periodId' = a->>'periodId',
    'N3-h a plan''s second pay gets the same attempt and page');
END
$n3h$;
SELECT public.t4490f_reset();

-- ===========================================================================
-- N3-f two real sessions pay one booking at the same moment with different keys.
-- ===========================================================================
SELECT public.t4490f_service();
DO $n3fx$ BEGIN INSERT INTO public.t4490f_ids VALUES ('g_n3f', public.t4490f_hold('n3f', '14:00')); END $n3fx$;
SELECT public.t4490f_reset();
DO $race$
DECLARE
  v_conn text := format('dbname=%s user=%s host=127.0.0.1 port=%s', current_database(), current_user,
                        current_setting('port'));
  v_g uuid := public.t4490f_id('g_n3f');
  v_a text;
  v_b text;
  v_b_err text;
  v_busy integer;
BEGIN
  PERFORM dblink_connect('f1_a', v_conn);
  PERFORM dblink_connect('f1_b', v_conn);
  PERFORM dblink_exec('f1_a', $s$SET request.jwt.claims TO '{"role":"service_role"}'$s$);
  PERFORM dblink_exec('f1_b', $s$SET request.jwt.claims TO '{"role":"service_role"}'$s$);
  PERFORM dblink_send_query('f1_a', format($q$
    SELECT (public.t4490f_pay(%L, 'n3f', 'f1-pay-n3f-a')->>'attemptId')
      || CASE WHEN pg_sleep(1) IS NULL THEN '' ELSE '' END
  $q$, v_g));
  PERFORM pg_sleep(0.2);
  PERFORM dblink_send_query('f1_b', format($q$
    SELECT public.t4490f_pay(%L, 'n3f', 'f1-pay-n3f-b')->>'attemptId'
  $q$, v_g));
  PERFORM pg_sleep(0.2);
  v_busy := dblink_is_busy('f1_b');
  SELECT r INTO v_a FROM dblink_get_result('f1_a') AS t(r text);
  BEGIN
    SELECT r INTO v_b FROM dblink_get_result('f1_b') AS t(r text);
  EXCEPTION WHEN OTHERS THEN
    v_b_err := SQLERRM;
  END;
  PERFORM dblink_disconnect('f1_a');
  PERFORM dblink_disconnect('f1_b');
  PERFORM public.t4490f_ok(v_busy = 1, 'N3-f1 the second pay waited for the first (one payment at a time per booking)');
  PERFORM public.t4490f_ok(v_a IS NOT NULL AND v_b IS NULL AND v_b_err LIKE '%offer_payment_already_pending%',
    'N3-f2 one attempt made; the other session was told a payment is in progress (A=' || COALESCE(v_a, '-') || ' err=' || COALESCE(v_b_err, '-') || ')');
  PERFORM public.t4490f_ok((SELECT count(*) FROM public.stay_payment_attempts WHERE group_id = v_g) = 1,
    'N3-f3 exactly one attempt for the booking');
END
$race$;

-- Suite-owned cleanup (#4490). The fixtures were COMMITted for the race, and
-- later suites in the same replayed database reuse the same fixture ids,
-- helper names and slugs. Remove every row whose uuid columns name the
-- fixture namespace (44947000-...), then, round by round, every row that
-- points at a removed row, so nothing this suite made (or left orphaned)
-- survives; drop the helpers and restore the feature flags as they were.
DO $cleanup$
DECLARE
  r record;
  v_cond text;
  v_deleted integer;
  v_total integer;
  v_round integer := 0;
BEGIN
  SET LOCAL session_replication_role = replica;
  CREATE TEMP TABLE t4490_gone (id uuid PRIMARY KEY) ON COMMIT DROP;
  LOOP
    v_round := v_round + 1;
    v_total := 0;
    FOR r IN
      SELECT n.nspname, c.relname,
             array_agg(a.attname::text ORDER BY a.attnum) AS cols,
             bool_or(a.attname = 'id') AS has_id
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        AND a.atttypid = 'uuid'::regtype
      WHERE c.relkind = 'r' AND n.nspname IN ('public', 'auth')
      GROUP BY n.nspname, c.relname
    LOOP
      SELECT string_agg(format('(%1$I::text LIKE %2$L OR %1$I IN (SELECT g.id FROM t4490_gone g))', col, '44947000-%'), ' OR ')
        INTO v_cond FROM unnest(r.cols) col;
      IF r.has_id THEN
        EXECUTE format(
          'WITH d AS (DELETE FROM %I.%I WHERE %s RETURNING id) INSERT INTO t4490_gone SELECT id FROM d WHERE id IS NOT NULL ON CONFLICT DO NOTHING',
          r.nspname, r.relname, v_cond);
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
      ELSE
        EXECUTE format('DELETE FROM %I.%I WHERE %s', r.nspname, r.relname, v_cond);
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
      END IF;
      v_total := v_total + v_deleted;
    END LOOP;
    EXIT WHEN v_total = 0 OR v_round >= 25;
  END LOOP;
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 't4490f\_%'
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
  FOR r IN
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 't4490f\_%'
      AND c.relname <> 't4490_cleanup_flags'
  LOOP
    EXECUTE format('DROP TABLE public.%I', r.relname);
  END LOOP;
  DELETE FROM public.feature_flags f
  USING public.t4490_cleanup_flags s WHERE s.flag_key = f.flag_key AND NOT s.existed;
  UPDATE public.feature_flags f SET is_enabled = s.is_enabled
  FROM public.t4490_cleanup_flags s WHERE s.flag_key = f.flag_key AND s.existed;
  DROP TABLE public.t4490_cleanup_flags;
END
$cleanup$;
