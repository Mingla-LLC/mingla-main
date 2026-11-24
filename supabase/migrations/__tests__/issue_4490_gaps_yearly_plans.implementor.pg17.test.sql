-- #4490 spec 07 K: executable PostgreSQL 17 proof for yearly memberships.
-- The suite owns its fixture and rolls every row back.
--
-- MINGLA-INVARIANT: I-4490-MEMBER-PERIOD-SNAPSHOT | issue #4490 | every membership snapshots month/year at join; all first, renewed and late-paid periods use that calendar interval, which the plan cannot change after any request or join.
-- MINGLA-INVARIANT: I-4490-YEARLY-RENEWAL-NOTICES | issue #4490 | a yearly membership gets its configurable renewal email (30 days by default) and one idempotent reminder seven days before renewal; nothing is charged automatically.
--
-- FAILS-ON-REVERT: replace issue_4490_period_after with issue_4490_month_after
-- in membership_join and K-3 fails because the first yearly period is one month.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t4490k_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490K FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490k_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490K FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490K FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t4490k_as(p_user uuid)
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
CREATE FUNCTION public.t4490k_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t4490k_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490k_ok(boolean, text), public.t4490k_expect(text, text, text, text),
  public.t4490k_as(uuid), public.t4490k_service(), public.t4490k_reset() TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS', 'VENUE_OFFERS_WRITES']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
  ('44908000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'k-owner@example.test', now(), now()),
  ('44908000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'k-outsider@example.test', now(), now());
INSERT INTO public.creator_accounts (id, created_at)
VALUES ('44908000-0000-4000-8000-000000000001', now());
INSERT INTO public.admin_users (email, role, status)
VALUES ('k-owner@example.test', 'admin', 'active');
INSERT INTO public.brands (
  id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at
) VALUES (
  '44908000-0000-4000-9000-000000000010', '44908000-0000-4000-8000-000000000001',
  'Yearly K 4490', 'yearly-k-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now()
);
INSERT INTO public.venue_listings (
  id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code
) VALUES (
  '44908000-0000-4000-9000-0000000000a1', '44908000-0000-4000-9000-000000000010',
  'korak4490', 'Kora Works', 6.45, 3.41, 'coworking', 'verified', 'NG'
);

CREATE TEMP TABLE t4490k_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490k_ids TO PUBLIC;
CREATE FUNCTION public.t4490k_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$ SELECT v FROM t4490k_ids WHERE k = p_k $f$;
CREATE FUNCTION public.t4490k_hash(p_seed text) RETURNS text LANGUAGE sql AS $f$ SELECT encode(sha256(convert_to(p_seed, 'UTF8')), 'hex') $f$;
CREATE FUNCTION public.t4490k_tok(p_seed text) RETURNS bytea LANGUAGE sql AS $f$ SELECT sha256(convert_to('year-member:' || p_seed, 'UTF8')) $f$;
GRANT EXECUTE ON FUNCTION public.t4490k_id(text), public.t4490k_hash(text), public.t4490k_tok(text) TO PUBLIC;

-- -------------------------------------------------------------------------
-- K-1: calendar boundaries retain local time, including a DST change.
-- -------------------------------------------------------------------------
SELECT public.t4490k_service();
DO $k1$
DECLARE
  v_start timestamptz := '2027-03-14 01:30:00-05';
BEGIN
  PERFORM public.t4490k_ok(
    public.issue_4490_period_after(v_start, 'America/New_York', 'month') AT TIME ZONE 'America/New_York'
      = timestamp '2027-04-14 01:30:00',
    'K-1a a monthly period retains venue-local wall time across DST');
  PERFORM public.t4490k_ok(
    public.issue_4490_period_after(v_start, 'America/New_York', 'year') AT TIME ZONE 'America/New_York'
      = timestamp '2028-03-14 01:30:00',
    'K-1b a yearly period is one local calendar year');
  PERFORM public.t4490k_ok(
    public.issue_4490_period_after('2028-02-29 10:15:00+00', 'UTC', 'year')
      = timestamptz '2029-02-28 10:15:00+00',
    'K-1c a leap-day start ends on the last day of the next February');
  PERFORM public.t4490k_expect(
    $$SELECT public.issue_4490_period_after(now(), 'UTC', 'week')$$,
    '22023', 'plan_period_invalid', 'K-1d unknown periods are refused');
END
$k1$;
SELECT public.t4490k_reset();

-- -------------------------------------------------------------------------
-- K-2: Host creates yearly plans with annual limits/defaults. Monthly rules
-- are unchanged, and another account cannot author the plan.
-- -------------------------------------------------------------------------
SELECT public.t4490k_as('44908000-0000-4000-8000-000000000001');
DO $k2$
DECLARE
  a1 constant uuid := '44908000-0000-4000-9000-0000000000a1';
  v jsonb;
  v_month jsonb;
BEGIN
  PERFORM public.t4490k_expect(format($q$SELECT public.issue_4490_manage_membership_plan('create', %L,
      '{"name":"Too many yearly passes","priceMinor":2000000,"period":"year","guestPasses":1201}'::jsonb,
      NULL, 'k-too-many-passes')$q$, a1),
    '22023', 'plan_guest_passes_invalid', 'K-2a yearly guest passes stop at 1200');
  PERFORM public.t4490k_expect(format($q$SELECT public.issue_4490_manage_membership_plan('create', %L,
      '{"name":"Too many yearly hours","priceMinor":2000000,"period":"year","roomHours":8784.25}'::jsonb,
      NULL, 'k-too-many-hours')$q$, a1),
    '22023', 'plan_room_hours_invalid', 'K-2b yearly room hours stop at 8784');

  v := public.issue_4490_manage_membership_plan('create', a1,
    '{"name":"Studio year","priceMinor":200000000,"period":"year","roomHours":8784,"guestPasses":1200}'::jsonb,
    NULL, 'k-year-create');
  INSERT INTO t4490k_ids VALUES ('year_plan', (v->>'id')::uuid);
  PERFORM public.t4490k_ok(v->>'interval' = 'year' AND (v->>'minMonths')::integer = 12
      AND (v->>'renewalNoticeDays')::integer = 30 AND NOT (v->>'periodLocked')::boolean,
    'K-2c yearly create defaults to a 12-month minimum and 30-day email');
  PERFORM public.t4490k_ok((SELECT name = 'Yearly' FROM public.venue_offer_price_options
                            WHERE id = (SELECT price_option_id FROM public.venue_membership_plans WHERE id = public.t4490k_id('year_plan'))),
    'K-2d the hidden price option is labelled Yearly');

  v_month := public.issue_4490_manage_membership_plan('create', a1,
    '{"name":"Desk month","priceMinor":2000000,"period":"month","roomHours":744,"guestPasses":100}'::jsonb,
    NULL, 'k-month-create');
  PERFORM public.t4490k_ok(v_month->>'interval' = 'month' AND (v_month->>'minMonths')::integer = 1
      AND (v_month->>'renewalNoticeDays')::integer = 7,
    'K-2e monthly defaults and limits are unchanged');

  PERFORM public.issue_4490_set_venue_feature(a1, 'memberships', true, NULL, NULL, NULL, 'k-feature-on');
  v := public.issue_4490_manage_membership_plan('publish', a1,
    jsonb_build_object('planId', public.t4490k_id('year_plan')), (v->>'version')::bigint, 'k-year-publish');

  v := public.issue_4490_manage_membership_plan('create', a1,
    '{"name":"Year by request","priceMinor":220000000,"period":"year","joinMode":"request"}'::jsonb,
    NULL, 'k-request-create');
  INSERT INTO t4490k_ids VALUES ('request_plan', (v->>'id')::uuid);
  v := public.issue_4490_manage_membership_plan('publish', a1,
    jsonb_build_object('planId', public.t4490k_id('request_plan')), (v->>'version')::bigint, 'k-request-publish');
END
$k2$;
SELECT public.t4490k_reset();

SELECT public.t4490k_as('44908000-0000-4000-8000-000000000005');
SELECT public.t4490k_expect(format($q$SELECT public.issue_4490_manage_membership_plan('update', %L,
    jsonb_build_object('planId', %L, 'name', 'No'), 1, 'k-outsider')$q$,
    '44908000-0000-4000-9000-0000000000a1', public.t4490k_id('year_plan')),
  '42501', 'not_authorized', 'K-2f another account cannot change the plan');
SELECT public.t4490k_reset();

-- -------------------------------------------------------------------------
-- K-3: join snapshots year; first period, late payment and future renewal all
-- use one year. Once joined, the plan interval is locked.
-- -------------------------------------------------------------------------
SELECT public.t4490k_service();
DO $k3$
DECLARE
  v jsonb;
  v_sub uuid := '44908000-0000-4000-a000-000000000001';
  v_period public.venue_membership_periods%ROWTYPE;
  v_local_start timestamp;
  v_local_end timestamp;
BEGIN
  v := public.issue_4490_membership_join(
    v_sub, public.t4490k_id('year_plan'),
    '{"name":"Ada Year","email":"ada-year@example.test"}'::jsonb, NULL,
    public.t4490k_hash('cart-ada'), NULL, public.t4490k_tok('ada'), 'k-join-ada');
  INSERT INTO t4490k_ids VALUES ('year_sub', v_sub);
  SELECT * INTO v_period FROM public.venue_membership_periods WHERE subscription_id = v_sub;
  v_local_start := v_period.period_start AT TIME ZONE 'Africa/Lagos';
  v_local_end := v_period.period_end AT TIME ZONE 'Africa/Lagos';
  PERFORM public.t4490k_ok(v->'plan'->>'interval' = 'year'
      AND (SELECT terms->>'period' = 'year' FROM public.venue_membership_subscriptions WHERE id = v_sub)
      AND v_local_end = v_local_start + interval '1 year',
    'K-3a instant join snapshots year and opens one calendar-year period');
  PERFORM public.t4490k_ok((public.issue_4490_membership_plan_projection(public.t4490k_id('year_plan'))->>'periodLocked')::boolean,
    'K-3b the Host projection locks the interval after a join');

  UPDATE public.venue_membership_periods
  SET period_start = now() - interval '10 days', period_end = now() - interval '9 days'
  WHERE id = v_period.id;
  PERFORM public.t4490k_reset();
  PERFORM public.issue_4490_membership_period_paid(v_period.id, NULL, 'venue', 'transfer', 'test', NULL);
  PERFORM public.t4490k_service();
  SELECT * INTO v_period FROM public.venue_membership_periods WHERE id = v_period.id;
  PERFORM public.t4490k_ok(
    v_period.period_end AT TIME ZONE 'Africa/Lagos'
      = (v_period.period_start AT TIME ZONE 'Africa/Lagos') + interval '1 year',
    'K-3c a late first payment restarts a full calendar year');

  v := public.issue_4490_membership_join(
    '44908000-0000-4000-a000-000000000002', public.t4490k_id('request_plan'),
    '{"name":"Bola Request","email":"bola-request@example.test"}'::jsonb, NULL,
    public.t4490k_hash('cart-bola'), NULL, public.t4490k_tok('bola'), 'k-join-bola');
  INSERT INTO t4490k_ids VALUES ('request_sub', '44908000-0000-4000-a000-000000000002');
  PERFORM public.t4490k_ok(v->>'subscriptionId' = '44908000-0000-4000-a000-000000000002'
      AND v->>'status' = 'requested' AND v->'paymentDue' = 'null'::jsonb,
    'K-3d a yearly request still waits for approval without payment');
END
$k3$;
SELECT public.t4490k_reset();

SELECT public.t4490k_as('44908000-0000-4000-8000-000000000001');
DO $k3lock$
DECLARE
  v_version bigint;
BEGIN
  SELECT version INTO v_version FROM public.venue_membership_plans WHERE id = public.t4490k_id('year_plan');
  PERFORM public.t4490k_expect(format($q$SELECT public.issue_4490_manage_membership_plan('update', %L,
      jsonb_build_object('planId', %L, 'period', 'month'), %s, 'k-period-rewrite')$q$,
      '44908000-0000-4000-9000-0000000000a1', public.t4490k_id('year_plan'), v_version),
    'PT409', 'plan_period_locked', 'K-3e accepted billing periods cannot be rewritten');
END
$k3lock$;
SELECT public.t4490k_reset();

-- -------------------------------------------------------------------------
-- K-4: renewal is an email rail, with one initial notice and one extra yearly
-- reminder at seven days. Re-running either clock is idempotent.
-- -------------------------------------------------------------------------
SELECT public.t4490k_service();
DO $k4$
DECLARE
  v_end timestamptz;
  v_open uuid;
  v_steps text[];
BEGIN
  SELECT current_period_end INTO v_end FROM public.venue_membership_subscriptions WHERE id = public.t4490k_id('year_sub');
  -- Keep the independent approval fixture open while this block advances the
  -- billing clock almost a year for the active member.
  UPDATE public.venue_membership_subscriptions
  SET created_at = v_end
  WHERE id = public.t4490k_id('request_sub');
  PERFORM public.issue_4490_membership_billing_run(v_end - interval '30 days', 500);
  PERFORM public.issue_4490_membership_billing_run(v_end - interval '30 days', 500);
  SELECT id INTO v_open FROM public.venue_membership_periods
  WHERE subscription_id = public.t4490k_id('year_sub') AND sequence = 2;
  PERFORM public.t4490k_ok(v_open IS NOT NULL
      AND (SELECT count(*) = 1 FROM public.notification_outbox
           WHERE payload->>'subscription_id' = public.t4490k_id('year_sub')::text
             AND payload->>'step' = 'renewal'),
    'K-4a the default 30-day renewal email and next yearly period are created once');

  PERFORM public.issue_4490_membership_billing_run(v_end - interval '7 days', 500);
  PERFORM public.issue_4490_membership_billing_run(v_end - interval '7 days', 500);
  SELECT reminder_steps INTO v_steps FROM public.venue_membership_periods WHERE id = v_open;
  PERFORM public.t4490k_ok('year_reminder' = ANY(v_steps)
      AND (SELECT count(*) = 1 FROM public.notification_outbox
           WHERE payload->>'subscription_id' = public.t4490k_id('year_sub')::text
             AND payload->>'step' = 'year_reminder' AND payload->>'period' = 'year'),
    'K-4b the seven-day yearly reminder is sent once and carries the year noun');
END
$k4$;
SELECT public.t4490k_reset();

-- -------------------------------------------------------------------------
-- K-5: Admin projections provide display labels without replacing stable
-- machine values.
-- -------------------------------------------------------------------------
SELECT public.t4490k_as('44908000-0000-4000-8000-000000000001');
DO $k5$
DECLARE
  v jsonb := public.issue_4490_admin_memberships('44908000-0000-4000-9000-0000000000a1');
  v_host jsonb := public.issue_4490_venue_members('44908000-0000-4000-9000-0000000000a1', 'all');
BEGIN
  PERFORM public.t4490k_ok(EXISTS (
      SELECT 1 FROM jsonb_array_elements(v->'plans') p
      WHERE p->>'id' = public.t4490k_id('year_plan')::text
        AND p->>'interval' = 'year' AND p->>'periodLabel' = 'Yearly'),
    'K-5a Admin receives the Yearly label');
  PERFORM public.t4490k_ok(EXISTS (
      SELECT 1 FROM jsonb_array_elements(v->'members') m
      WHERE m->>'subscriptionId' = public.t4490k_id('request_sub')::text
        AND m->>'status' = 'requested' AND m->>'statusLabel' = 'Requested'),
    'K-5b Admin receives the Requested label');
  PERFORM public.t4490k_ok(EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_host->'members') m
      WHERE m->>'planPeriod' = 'year'),
    'K-5c Host member rows carry the yearly billing noun');
END
$k5$;
SELECT public.t4490k_reset();
SELECT public.t4490k_service();
DO $k5d$
DECLARE
  v_door jsonb := public.issue_4490_check_in_list(
    '44908000-0000-4000-9000-0000000000a1',
    public.issue_4490_venue_local_date('44908000-0000-4000-9000-0000000000a1'),
    '44908000-0000-4000-8000-000000000001');
BEGIN
  PERFORM public.t4490k_ok(EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_door->'members') m
      WHERE m->>'planPeriod' = 'year'),
    'K-5d the service-only door list carries the yearly billing noun');
END
$k5d$;
SELECT public.t4490k_reset();

-- Host approval opens the request's first year, due in three days.
SELECT public.t4490k_as('44908000-0000-4000-8000-000000000001');
DO $k6$
DECLARE
  v_version bigint;
  v_period public.venue_membership_periods%ROWTYPE;
BEGIN
  SELECT version INTO v_version FROM public.venue_membership_subscriptions WHERE id = public.t4490k_id('request_sub');
  PERFORM public.issue_4490_manage_member(public.t4490k_id('request_sub'), 'approve_request', '{}'::jsonb,
    v_version, 'k-approve-bola');
  SELECT * INTO v_period FROM public.venue_membership_periods WHERE subscription_id = public.t4490k_id('request_sub');
  PERFORM public.t4490k_ok(
    v_period.period_end AT TIME ZONE 'Africa/Lagos'
      = (v_period.period_start AT TIME ZONE 'Africa/Lagos') + interval '1 year',
    'K-6a approval opens a full calendar-year period');
  PERFORM public.t4490k_ok(
    v_period.due_at BETWEEN now() + interval '2 days 23 hours' AND now() + interval '3 days 1 hour',
    'K-6b approval leaves the payment link open for three days');
  PERFORM public.t4490k_service();
  PERFORM public.t4490k_ok(
    EXISTS (SELECT 1 FROM public.notification_outbox
            WHERE payload->>'subscription_id' = public.t4490k_id('request_sub')::text
              AND payload->>'step' = 'approval' AND payload->>'period' = 'year'),
    'K-6c approval notification carries yearly copy data');
END
$k6$;
SELECT public.t4490k_reset();

ROLLBACK;
