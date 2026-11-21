-- #4490 spec 07 M: executable PostgreSQL 17 proof for member door codes.
-- The suite owns its fixture and rolls every row back.
--
-- MINGLA-INVARIANT: I-4490-MEMBER-CODE-IDENTITY | issue #4490 | each usable membership has one unambiguous six-character code unique inside its brand; a request receives it only at approval.
-- MINGLA-INVARIANT: I-4490-MEMBER-CODE-DOOR | issue #4490 | typed codes resolve only at their own venue, reuse the member admission authority, log misses without a member match, and lock out repeated misses for ten minutes.
--
-- FAILS-ON-REVERT: remove member_code allocation from membership_join and
-- M-2 fails because an instant membership has no fallback door code.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t4490m_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490M FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490m_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490M FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490M FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t4490m_as(p_user uuid)
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
CREATE FUNCTION public.t4490m_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t4490m_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490m_ok(boolean, text), public.t4490m_expect(text, text, text, text),
  public.t4490m_as(uuid), public.t4490m_service(), public.t4490m_reset() TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS', 'VENUE_OFFERS_WRITES']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
  ('44909000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm-owner@example.test', now(), now()),
  ('44909000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm-outsider@example.test', now(), now());
INSERT INTO public.creator_accounts (id, created_at)
VALUES ('44909000-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (
  id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at
) VALUES (
  '44909000-0000-4000-9000-000000000010', '44909000-0000-4000-8000-000000000001',
  'Codes M 4490', 'codes-m-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now()
);
INSERT INTO public.venue_listings (
  id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code
) VALUES
  ('44909000-0000-4000-9000-0000000000a1', '44909000-0000-4000-9000-000000000010', 'membercodea1', 'Member Code One', 6.45, 3.41, 'coworking', 'verified', 'NG'),
  ('44909000-0000-4000-9000-0000000000a2', '44909000-0000-4000-9000-000000000010', 'membercodea2', 'Member Code Two', 6.46, 3.42, 'coworking', 'verified', 'NG'),
  ('44909000-0000-4000-9000-0000000000a3', '44909000-0000-4000-9000-000000000010', 'membercodea3', 'Member Code Three', 6.47, 3.43, 'coworking', 'verified', 'NG'),
  ('44909000-0000-4000-9000-0000000000a4', '44909000-0000-4000-9000-000000000010', 'membercodea4', 'Member Code Four', 6.48, 3.44, 'coworking', 'verified', 'NG');

CREATE TEMP TABLE t4490m_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490m_ids TO PUBLIC;
CREATE FUNCTION public.t4490m_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$ SELECT v FROM t4490m_ids WHERE k = p_k $f$;
CREATE FUNCTION public.t4490m_hash(p_seed text) RETURNS text LANGUAGE sql AS $f$ SELECT encode(sha256(convert_to(p_seed, 'UTF8')), 'hex') $f$;
CREATE FUNCTION public.t4490m_tok(p_seed text) RETURNS bytea LANGUAGE sql AS $f$ SELECT sha256(convert_to('code-member:' || p_seed, 'UTF8')) $f$;
GRANT EXECUTE ON FUNCTION public.t4490m_id(text), public.t4490m_hash(text), public.t4490m_tok(text) TO PUBLIC;

-- -------------------------------------------------------------------------
-- M-1: the alphabet is exactly the unambiguous display alphabet.
-- -------------------------------------------------------------------------
SELECT public.t4490m_service();
DO $m1$
DECLARE
  v_codes text[];
BEGIN
  SELECT array_agg(public.issue_4490_member_code_candidate()) INTO v_codes
  FROM generate_series(1, 100);
  PERFORM public.t4490m_ok(
    (SELECT bool_and(code ~ '^[2-9A-HJ-NP-Z]{6}$') FROM unnest(v_codes) code),
    'M-1a generated codes have six unambiguous uppercase characters');
  PERFORM public.t4490m_ok(
    NOT EXISTS (SELECT 1 FROM unnest(v_codes) code WHERE code ~ '[01IO]'),
    'M-1b generated codes never contain 0, 1, I or O');
END
$m1$;
SELECT public.t4490m_reset();

-- -------------------------------------------------------------------------
-- M-2: instant joins receive a brand-unique code; requests stay blank until
-- approval, which assigns a code before the approval email is queued.
-- -------------------------------------------------------------------------
SELECT public.t4490m_as('44909000-0000-4000-8000-000000000001');
DO $m2plans$
DECLARE
  a1 constant uuid := '44909000-0000-4000-9000-0000000000a1';
  v jsonb;
BEGIN
  PERFORM public.issue_4490_set_venue_feature(a1, 'memberships', true, NULL, NULL, NULL, 'm-feature-on');
  v := public.issue_4490_manage_membership_plan('create', a1,
    '{"name":"Door instant","priceMinor":2000000,"period":"month"}'::jsonb,
    NULL, 'm-instant-create');
  INSERT INTO t4490m_ids VALUES ('instant_plan', (v->>'id')::uuid);
  v := public.issue_4490_manage_membership_plan('publish', a1,
    jsonb_build_object('planId', public.t4490m_id('instant_plan')), (v->>'version')::bigint, 'm-instant-publish');

  v := public.issue_4490_manage_membership_plan('create', a1,
    '{"name":"Door request","priceMinor":2500000,"period":"month","joinMode":"request"}'::jsonb,
    NULL, 'm-request-create');
  INSERT INTO t4490m_ids VALUES ('request_plan', (v->>'id')::uuid);
  v := public.issue_4490_manage_membership_plan('publish', a1,
    jsonb_build_object('planId', public.t4490m_id('request_plan')), (v->>'version')::bigint, 'm-request-publish');
END
$m2plans$;
SELECT public.t4490m_reset();

SELECT public.t4490m_service();
DO $m2join$
DECLARE
  v_one jsonb;
  v_two jsonb;
  v_request jsonb;
  v_code text;
BEGIN
  v_one := public.issue_4490_membership_join(
    '44909000-0000-4000-a000-000000000001', public.t4490m_id('instant_plan'),
    '{"name":"Ada Code","email":"ada-code@example.test"}'::jsonb, NULL,
    public.t4490m_hash('cart-ada'), NULL, public.t4490m_tok('ada'), 'm-join-ada');
  v_two := public.issue_4490_membership_join(
    '44909000-0000-4000-a000-000000000002', public.t4490m_id('instant_plan'),
    '{"name":"Bola Code","email":"bola-code@example.test"}'::jsonb, NULL,
    public.t4490m_hash('cart-bola'), NULL, public.t4490m_tok('bola'), 'm-join-bola');
  v_request := public.issue_4490_membership_join(
    '44909000-0000-4000-a000-000000000003', public.t4490m_id('request_plan'),
    '{"name":"Chi Request","email":"chi-code@example.test"}'::jsonb, NULL,
    public.t4490m_hash('cart-chi'), NULL, public.t4490m_tok('chi'), 'm-join-chi');
  INSERT INTO t4490m_ids VALUES
    ('instant_one', (v_one->>'subscriptionId')::uuid),
    ('instant_two', (v_two->>'subscriptionId')::uuid),
    ('request', (v_request->>'subscriptionId')::uuid);
  SELECT member_code INTO v_code FROM public.venue_membership_subscriptions WHERE id = public.t4490m_id('instant_one');
  PERFORM public.t4490m_ok(v_code ~ '^[2-9A-HJ-NP-Z]{6}$'
      AND v_one->>'memberCode' = v_code
      AND (SELECT member_code IS NULL FROM public.venue_membership_subscriptions WHERE id = public.t4490m_id('request')),
    'M-2a instant joins expose a code while an undecided request has none');
  PERFORM public.t4490m_expect(format($q$UPDATE public.venue_membership_subscriptions
      SET member_code = %L WHERE id = %L$q$, v_code, public.t4490m_id('instant_two')),
    '23505', NULL, 'M-2b a brand cannot have two current memberships with the same code');
END
$m2join$;
SELECT public.t4490m_reset();

SELECT public.t4490m_as('44909000-0000-4000-8000-000000000001');
DO $m2approve$
DECLARE
  v jsonb;
  v_version bigint;
  v_code text;
BEGIN
  v_version := (public.issue_4490_venue_member(public.t4490m_id('request'))->>'version')::bigint;
  v := public.issue_4490_manage_member(public.t4490m_id('request'), 'approve_request', '{}'::jsonb,
    v_version, 'm-approve-chi');
  v_code := v->>'memberCode';
  PERFORM public.t4490m_reset();
  PERFORM public.t4490m_service();
  SELECT member_code INTO v_code FROM public.venue_membership_subscriptions WHERE id = public.t4490m_id('request');
  PERFORM public.t4490m_ok(v_code ~ '^[2-9A-HJ-NP-Z]{6}$' AND v->>'memberCode' = v_code
      AND EXISTS (SELECT 1 FROM public.notification_outbox
                  WHERE payload->>'subscription_id' = public.t4490m_id('request')::text
                    AND payload->>'step' = 'approval' AND payload->>'member_code' = v_code),
    'M-2c approval assigns the code before the approval email is queued');

  PERFORM public.t4490m_reset();
  PERFORM public.t4490m_as('44909000-0000-4000-8000-000000000001');
  PERFORM public.t4490m_ok(
    public.issue_4490_venue_member(public.t4490m_id('request'))->>'memberCode' = v_code,
    'M-2d the Host member panel receives the display code');
END
$m2approve$;
SELECT public.t4490m_reset();

-- -------------------------------------------------------------------------
-- M-3: entry normalises case, spaces and dashes, resolves only at its venue,
-- and reuses the ordinary member admission path.
-- -------------------------------------------------------------------------
SELECT public.t4490m_service();
DO $m3$
DECLARE
  a1 constant uuid := '44909000-0000-4000-9000-0000000000a1';
  a2 constant uuid := '44909000-0000-4000-9000-0000000000a2';
  owner constant uuid := '44909000-0000-4000-8000-000000000001';
  v_code text;
  v_display text;
  v_result jsonb;
BEGIN
  UPDATE public.venue_membership_subscriptions
  SET status = 'active', started_at = now(), current_period_start = now() - interval '1 day',
      current_period_end = now() + interval '29 days'
  WHERE id = public.t4490m_id('instant_one');
  SELECT member_code INTO v_code FROM public.venue_membership_subscriptions WHERE id = public.t4490m_id('instant_one');
  v_display := lower(substr(v_code, 1, 3) || ' - ' || substr(v_code, 4));
  v_result := public.issue_4490_admit_member_by_code(a1, v_display, 0, owner);
  PERFORM public.t4490m_ok(v_result->>'result' = 'admitted' AND v_result->>'kind' = 'member'
      AND v_result->'member'->>'memberCode' = v_code
      AND EXISTS (SELECT 1 FROM public.venue_check_in_log
                  WHERE id = (v_result->>'logId')::uuid AND subscription_id = public.t4490m_id('instant_one')
                    AND method = 'manual'),
    'M-3a display spacing and lowercase resolve through ordinary member admission');

  v_result := public.issue_4490_admit_member_by_code(a2, v_code, 0, owner);
  PERFORM public.t4490m_ok(v_result->>'result' = 'not_found'
      AND EXISTS (SELECT 1 FROM public.venue_check_in_log
                  WHERE id = (v_result->>'logId')::uuid AND subscription_id IS NULL
                    AND result = 'not_found' AND method = 'manual'
                    AND detail = '{"via":"code"}'::jsonb),
    'M-3b the same brand code is not recognised at another venue and logs only a miss');
END
$m3$;
SELECT public.t4490m_reset();

-- -------------------------------------------------------------------------
-- M-4: five misses by one staff member or thirty at one venue stop further
-- guesses for the rolling ten-minute window. Only service_role can call it.
-- -------------------------------------------------------------------------
SELECT public.t4490m_service();
DO $m4staff$
DECLARE
  a3 constant uuid := '44909000-0000-4000-9000-0000000000a3';
  owner constant uuid := '44909000-0000-4000-8000-000000000001';
  i integer;
BEGIN
  FOR i IN 1..5 LOOP
    PERFORM public.issue_4490_admit_member_by_code(a3, 'ZZZ99' || (i + 1)::text, 0, owner);
  END LOOP;
  PERFORM public.t4490m_expect(format($q$SELECT public.issue_4490_admit_member_by_code(%L, 'ZZZ992', 0, %L)$q$, a3, owner),
    'PT429', 'member_code_rate_limited', 'M-4a the sixth wrong code by one staff member is refused');
END
$m4staff$;

DO $m4venue$
DECLARE
  a4 constant uuid := '44909000-0000-4000-9000-0000000000a4';
  brand constant uuid := '44909000-0000-4000-9000-000000000010';
  owner constant uuid := '44909000-0000-4000-8000-000000000001';
BEGIN
  INSERT INTO public.venue_check_in_log (
    venue_id, brand_id, result, admitted_delta, method, scanner_user_id, local_date, detail
  )
  SELECT a4, brand, 'not_found', 0, 'manual', gen_random_uuid(),
    public.issue_4490_venue_local_date(a4), '{"via":"code"}'::jsonb
  FROM generate_series(1, 30);
  PERFORM public.t4490m_expect(format($q$SELECT public.issue_4490_admit_member_by_code(%L, 'ZZZ992', 0, %L)$q$, a4, owner),
    'PT429', 'member_code_rate_limited', 'M-4b the thirty-first wrong code at one venue is refused');
END
$m4venue$;
SELECT public.t4490m_reset();

SELECT public.t4490m_ok(
  NOT has_function_privilege('authenticated',
        'public.issue_4490_admit_member_by_code(uuid,text,integer,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon',
        'public.issue_4490_admit_member_by_code(uuid,text,integer,uuid)', 'EXECUTE'),
  'M-4c signed-in and signed-out callers cannot bypass the staff edge function');

ROLLBACK;
