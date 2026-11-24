-- #4490 spec 07 G: executable PostgreSQL 17 proof for request memberships
-- and dedicated desks. The suite owns its fixture and rolls every row back.
--
-- MINGLA-INVARIANT: I-4490-MEMBER-REQUEST-NO-MONEY | issue #4490 | asking to join creates no payment and consumes no member place; only Host approval opens a three-day first-period payment.
-- MINGLA-INVARIANT: I-4490-MEMBER-DESK-CLAIM | issue #4490 | one current member desk is one venue-space claim; an existing booking wins, and leaving the paid-up and grace states releases the claim.
--
-- FAILS-ON-REVERT: remove the request branch from issue_4490_membership_join
-- and G-3 fails because a payment period exists before Host approval.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t4490g_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490G FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490g_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490G FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490G FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t4490g_as(p_user uuid)
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
CREATE FUNCTION public.t4490g_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t4490g_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490g_ok(boolean, text), public.t4490g_expect(text, text, text, text),
  public.t4490g_as(uuid), public.t4490g_service(), public.t4490g_reset() TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS', 'VENUE_OFFERS_WRITES']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
  ('44907000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'g-owner@example.test', now(), now()),
  ('44907000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'g-outsider@example.test', now(), now());
INSERT INTO public.creator_accounts (id, created_at)
VALUES ('44907000-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (
  id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at
) VALUES (
  '44907000-0000-4000-9000-000000000010', '44907000-0000-4000-8000-000000000001',
  'Coworking G 4490', 'coworking-g-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now()
);
INSERT INTO public.venue_listings (
  id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code
) VALUES
  ('44907000-0000-4000-9000-0000000000a1', '44907000-0000-4000-9000-000000000010', 'korag4490', 'Kora Works', 6.45, 3.41, 'coworking', 'verified', 'NG'),
  ('44907000-0000-4000-9000-0000000000a2', '44907000-0000-4000-9000-000000000010', 'otherg4490', 'Other Works', 6.46, 3.42, 'coworking', 'verified', 'NG');

CREATE TEMP TABLE t4490g_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490g_ids TO PUBLIC;
CREATE FUNCTION public.t4490g_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$ SELECT v FROM t4490g_ids WHERE k = p_k $f$;
CREATE FUNCTION public.t4490g_hash(p_seed text) RETURNS text LANGUAGE sql AS $f$ SELECT encode(sha256(convert_to(p_seed, 'UTF8')), 'hex') $f$;
CREATE FUNCTION public.t4490g_tok(p_seed text) RETURNS bytea LANGUAGE sql AS $f$ SELECT sha256(convert_to('member:' || p_seed, 'UTF8')) $f$;
CREATE FUNCTION public.t4490g_join(p_seed text)
RETURNS jsonb LANGUAGE sql AS $f$
  SELECT public.issue_4490_membership_join(
    gen_random_uuid(), public.t4490g_id('plan'),
    jsonb_build_object('name', 'Member ' || p_seed, 'email', p_seed || '@example.test'), NULL,
    public.t4490g_hash('cart:' || p_seed), NULL, public.t4490g_tok(p_seed), 'join-g-' || p_seed
  );
$f$;
GRANT EXECUTE ON FUNCTION public.t4490g_id(text), public.t4490g_hash(text), public.t4490g_tok(text),
  public.t4490g_join(text) TO PUBLIC;

-- -------------------------------------------------------------------------
-- G-1: Host plan authoring exposes only spaces at this venue; the public
-- plan says only that an assigned desk is available, never which desks.
-- -------------------------------------------------------------------------
SELECT public.t4490g_as('44907000-0000-4000-8000-000000000001');
DO $g1$
DECLARE
  a1 constant uuid := '44907000-0000-4000-9000-0000000000a1';
  a2 constant uuid := '44907000-0000-4000-9000-0000000000a2';
  v jsonb;
  v_desk uuid;
  v_other uuid;
  v_plan uuid;
  v_public jsonb;
BEGIN
  v_desk := (public.issue_4490_manage_space('create', a1,
    '{"name":"Desk 12","setting":"indoor","capacity_seated":1}'::jsonb, NULL)->>'id')::uuid;
  v_other := (public.issue_4490_manage_space('create', a2,
    '{"name":"Other desk","setting":"indoor","capacity_seated":1}'::jsonb, NULL)->>'id')::uuid;
  INSERT INTO t4490g_ids VALUES ('desk', v_desk), ('other', v_other);

  PERFORM public.t4490g_expect(format($q$SELECT public.issue_4490_manage_membership_plan('create', %L,
      jsonb_build_object('name','Wrong venue','priceMinor',15000000,'joinMode','request','deskSpaceIds',jsonb_build_array(%L)),
      NULL, 'g-plan-wrong-desk')$q$, a1, v_other),
    '22023', 'plan_desks_invalid', 'G-1a a plan cannot name another venue''s desk');

  v := public.issue_4490_manage_membership_plan('create', a1,
    jsonb_build_object('name', 'Dedicated desk', 'summary', 'Your own desk', 'priceMinor', 15000000,
      'joinMode', 'request', 'deskSpaceIds', jsonb_build_array(v_desk), 'maxMembers', 1),
    NULL, 'g-plan-create');
  v_plan := (v->>'id')::uuid;
  INSERT INTO t4490g_ids VALUES ('plan', v_plan);
  PERFORM public.t4490g_ok(v->>'joinMode' = 'request' AND v->'deskSpaceIds' = jsonb_build_array(v_desk)
      AND v->'deskSpaces'->0->>'name' = 'Desk 12',
    'G-1b Host creates a by-request plan with an assignable desk');

  PERFORM public.issue_4490_set_venue_feature(a1, 'memberships', true, NULL, NULL, NULL, 'g-feature-on');
  v := public.issue_4490_manage_membership_plan('publish', a1, jsonb_build_object('planId', v_plan),
    (v->>'version')::bigint, 'g-plan-publish');
  PERFORM public.t4490g_ok(v->>'status' = 'live', 'G-1c the request plan is live');

  v := public.issue_4490_membership_plans(a1);
  PERFORM public.t4490g_ok(v->'spaces' @> jsonb_build_array(jsonb_build_object('id', v_desk, 'name', 'Desk 12')),
    'G-1d the Host editor receives this venue''s spaces');
  PERFORM public.t4490g_service();
  v_public := public.issue_4490_public_memberships(a1, ARRAY['memberships']);
  PERFORM public.t4490g_ok(v_public->'plans'->0->>'joinMode' = 'request'
      AND (v_public->'plans'->0->>'assignedDeskAvailable')::boolean
      AND NOT (v_public->'plans'->0 ? 'deskSpaceIds') AND position(v_desk::text IN v_public::text) = 0,
    'G-1e the public plan says a desk may be assigned but leaks no desk id');
END
$g1$;
SELECT public.t4490g_reset();

-- -------------------------------------------------------------------------
-- G-2/G-3: requests take no money or place; Host approval opens exactly one
-- first payment due in three days, and max-members is enforced at approval.
-- -------------------------------------------------------------------------
SELECT public.t4490g_service();
DO $g2$
DECLARE
  v_one jsonb;
  v_two jsonb;
  v_list jsonb;
BEGIN
  v_one := public.t4490g_join('ada');
  v_two := public.t4490g_join('bola');
  INSERT INTO t4490g_ids VALUES
    ('ada', (v_one->>'subscriptionId')::uuid),
    ('bola', (v_two->>'subscriptionId')::uuid);
  PERFORM public.t4490g_ok(v_one->>'status' = 'requested' AND v_one->>'requestReplyBy' IS NOT NULL
      AND v_one->'paymentDue' = 'null'::jsonb
      AND NOT (public.issue_4490_member_projection((v_one->>'subscriptionId')::uuid, 'guest', 'test-pepper') ? 'pass')
      AND NOT EXISTS (SELECT 1 FROM public.venue_membership_periods p
                      WHERE p.subscription_id IN ((v_one->>'subscriptionId')::uuid, (v_two->>'subscriptionId')::uuid)),
    'G-2a two people can ask for a one-place plan without paying, a pass or taking the place');
END
$g2$;
SELECT public.t4490g_reset();

SELECT public.t4490g_as('44907000-0000-4000-8000-000000000001');
DO $g3$
DECLARE
  a1 constant uuid := '44907000-0000-4000-9000-0000000000a1';
  v jsonb;
  v_period public.venue_membership_periods%ROWTYPE;
  v_bola_version bigint;
BEGIN
  v := public.issue_4490_venue_members(a1, 'requests');
  PERFORM public.t4490g_ok(jsonb_array_length(v->'members') = 2 AND (v->'tiles'->>'members')::integer = 0,
    'G-2b Requests is its own Host list and requests are not counted as members');

  v := public.issue_4490_manage_member(public.t4490g_id('ada'), 'approve_request', '{}'::jsonb, 1, 'g-approve-ada');
  SELECT * INTO v_period FROM public.venue_membership_periods WHERE subscription_id = public.t4490g_id('ada');
  PERFORM public.t4490g_ok(v->>'status' = 'pending' AND v_period.sequence = 1 AND v_period.status = 'link_sent'
      AND v_period.due_at BETWEEN now() + interval '2 days 23 hours' AND now() + interval '3 days 1 hour',
    'G-3a approval opens one first-period payment due in three days');
  PERFORM public.t4490g_ok((SELECT count(*) = 1 FROM public.venue_membership_periods
                            WHERE subscription_id = public.t4490g_id('ada')),
    'G-3b approval creates exactly one payment period');

  -- The request may have waited before approval. Its new three-day clock is
  -- measured from the decision, not from the original request.
  -- Keep the independent capacity contender open while the billing clock is
  -- advanced so G-3d exercises the full-plan guard rather than request expiry.
  PERFORM public.t4490g_reset();
  PERFORM public.t4490g_service();
  UPDATE public.venue_membership_subscriptions
  SET created_at = v_period.due_at
  WHERE id = public.t4490g_id('bola');
  PERFORM public.issue_4490_membership_billing_run(v_period.due_at - interval '1 minute', 500);
  PERFORM public.t4490g_reset();
  PERFORM public.t4490g_as('44907000-0000-4000-8000-000000000001');
  PERFORM public.t4490g_ok(
    (SELECT status = 'pending' FROM public.venue_membership_subscriptions WHERE id = public.t4490g_id('ada'))
      AND (SELECT status = 'link_sent' FROM public.venue_membership_periods WHERE id = v_period.id),
    'G-3c an approved request stays open for the promised three days');

  SELECT version INTO v_bola_version FROM public.venue_membership_subscriptions WHERE id = public.t4490g_id('bola');
  PERFORM public.t4490g_expect(format($q$SELECT public.issue_4490_manage_member(%L, 'approve_request', '{}'::jsonb,
      %s, 'g-approve-bola')$q$, public.t4490g_id('bola'), v_bola_version),
    'PT409', 'member_request_plan_full', 'G-3d the second request cannot be approved after the place is taken');
  v := public.issue_4490_manage_member(public.t4490g_id('bola'), 'decline_request',
    '{"reason":"No desks left"}'::jsonb, v_bola_version, 'g-decline-bola');
  PERFORM public.t4490g_ok(v->>'status' = 'declined'
      AND NOT EXISTS (SELECT 1 FROM public.venue_membership_periods WHERE subscription_id = public.t4490g_id('bola')),
    'G-3e declining takes no payment');
  v := public.issue_4490_venue_members(a1, 'ended');
  PERFORM public.t4490g_ok(EXISTS (SELECT 1 FROM jsonb_array_elements(v->'members') m
      WHERE m->>'subscriptionId' = public.t4490g_id('bola')::text AND m->>'status' = 'declined'),
    'G-3f a declined request is kept in the closed Host history');
END
$g3$;
SELECT public.t4490g_reset();

-- -------------------------------------------------------------------------
-- G-4: a desk becomes a claim only for a current member; another live member
-- cannot take it, future venue use caps it, and lapse releases it.
-- -------------------------------------------------------------------------
SELECT public.t4490g_service();
INSERT INTO public.venue_space_claims (
  space_id, source, booked_range, claim_range, state, block_reason
) VALUES (
  public.t4490g_id('desk'), 'block',
  tstzrange(now() + interval '60 days', now() + interval '61 days', '[)'),
  tstzrange(now() + interval '60 days', now() + interval '61 days', '[)'),
  'committed', 'Future venue use'
);
SELECT public.t4490g_reset();

SELECT public.t4490g_as('44907000-0000-4000-8000-000000000001');
DO $g4$
DECLARE
  v jsonb;
  v_version bigint;
  v_plan_version bigint;
  v_claim public.venue_space_claims%ROWTYPE;
BEGIN
  SELECT version INTO v_version FROM public.venue_membership_subscriptions WHERE id = public.t4490g_id('ada');
  PERFORM public.t4490g_expect(format($q$SELECT public.issue_4490_manage_member(%L, 'assign_desk',
      jsonb_build_object('spaceId', %L), %s, 'g-desk-before-pay')$q$,
      public.t4490g_id('ada'), public.t4490g_id('desk'), v_version),
    'PT409', 'member_desk_not_assignable', 'G-4a a desk cannot be assigned before the first payment');

  PERFORM public.t4490g_reset();
  UPDATE public.venue_membership_subscriptions
  SET status = 'active', started_at = now(), current_period_start = now(), current_period_end = now() + interval '30 days'
  WHERE id = public.t4490g_id('ada');
  PERFORM public.t4490g_as('44907000-0000-4000-8000-000000000001');
  SELECT version INTO v_version FROM public.venue_membership_subscriptions WHERE id = public.t4490g_id('ada');
  v := public.issue_4490_manage_member(public.t4490g_id('ada'), 'assign_desk',
    jsonb_build_object('spaceId', public.t4490g_id('desk')), v_version, 'g-desk-ada');
  SELECT * INTO v_claim FROM public.venue_space_claims c
  WHERE c.subscription_id = public.t4490g_id('ada') AND c.state = 'committed';
  PERFORM public.t4490g_ok(v->'assignedSpace'->>'name' = 'Desk 12' AND v_claim.id IS NOT NULL
      AND upper(v_claim.claim_range) BETWEEN now() + interval '59 days 23 hours' AND now() + interval '60 days 1 hour',
    'G-4b a paid member gets one desk claim capped before future venue use');

  SELECT version INTO v_plan_version FROM public.venue_membership_plans WHERE id = public.t4490g_id('plan');
  PERFORM public.t4490g_expect(format($q$SELECT public.issue_4490_manage_membership_plan('update',
      '44907000-0000-4000-9000-0000000000a1', jsonb_build_object('planId', %L, 'deskSpaceIds', '[]'::jsonb),
      %s, 'g-plan-remove-live-desk')$q$, public.t4490g_id('plan'), v_plan_version),
    'PT409', 'plan_desks_in_use', 'G-4c a desk held by a current member cannot be removed from the plan');

  PERFORM public.t4490g_reset();
  UPDATE public.venue_membership_subscriptions
  SET status = 'active', decline_reason = NULL, current_period_start = now(), current_period_end = now() + interval '30 days'
  WHERE id = public.t4490g_id('bola');
  PERFORM public.t4490g_as('44907000-0000-4000-8000-000000000001');
  v := public.issue_4490_venue_member(public.t4490g_id('bola'));
  PERFORM public.t4490g_ok(v->'plan'->'deskSpaces' = '[]'::jsonb,
    'G-4d the occupied desk is absent from another member''s picker');
  SELECT version INTO v_version FROM public.venue_membership_subscriptions WHERE id = public.t4490g_id('bola');
  PERFORM public.t4490g_expect(format($q$SELECT public.issue_4490_manage_member(%L, 'assign_desk',
      jsonb_build_object('spaceId', %L), %s, 'g-desk-bola')$q$,
      public.t4490g_id('bola'), public.t4490g_id('desk'), v_version),
    'PT409', 'desk_taken', 'G-4e a crafted request still cannot take the held desk');

  PERFORM public.t4490g_reset();
  UPDATE public.venue_membership_subscriptions SET status = 'lapsed' WHERE id = public.t4490g_id('ada');
  PERFORM public.t4490g_ok(EXISTS (SELECT 1 FROM public.venue_space_claims c
      WHERE c.subscription_id = public.t4490g_id('ada') AND c.state = 'released')
      AND (SELECT assigned_space_id IS NULL FROM public.venue_membership_subscriptions WHERE id = public.t4490g_id('ada')),
    'G-4f lapse releases the claim and clears the desk before a later payment');

  UPDATE public.venue_membership_subscriptions
  SET status = 'declined', current_period_start = NULL, current_period_end = NULL
  WHERE id = public.t4490g_id('bola');
  PERFORM public.t4490g_as('44907000-0000-4000-8000-000000000001');
  SELECT version INTO v_version FROM public.venue_membership_subscriptions WHERE id = public.t4490g_id('bola');
  PERFORM public.t4490g_expect(format($q$SELECT public.issue_4490_manage_member(%L, 'assign_desk',
      jsonb_build_object('spaceId', %L), %s, 'g-desk-declined')$q$,
      public.t4490g_id('bola'), public.t4490g_id('desk'), v_version),
    'PT409', 'member_desk_not_assignable', 'G-4g a declined person cannot be assigned a desk through the RPC');
END
$g4$;
SELECT public.t4490g_reset();

-- -------------------------------------------------------------------------
-- G-5: unanswered requests expire on the default 48-hour clock even when a
-- venue has no settings row. An outsider cannot read the Host request list.
-- -------------------------------------------------------------------------
SELECT public.t4490g_service();
DO $g5$
DECLARE
  v jsonb;
  v_run jsonb;
BEGIN
  v := public.t4490g_join('chi');
  INSERT INTO t4490g_ids VALUES ('chi', (v->>'subscriptionId')::uuid);
  DELETE FROM public.venue_booking_settings WHERE venue_id = '44907000-0000-4000-9000-0000000000a1';
  UPDATE public.venue_membership_subscriptions SET created_at = now() - interval '49 hours'
  WHERE id = public.t4490g_id('chi');
  v_run := public.issue_4490_membership_billing_run(now(), 100);
  PERFORM public.t4490g_ok((v_run->>'requestsExpired')::integer = 1
      AND (SELECT status = 'declined' AND decline_reason = 'expired'
           FROM public.venue_membership_subscriptions WHERE id = public.t4490g_id('chi')),
    'G-5a an unanswered request expires after the default 48 hours without a settings row');
END
$g5$;
SELECT public.t4490g_reset();

SELECT public.t4490g_as('44907000-0000-4000-8000-000000000005');
SELECT public.t4490g_expect($q$SELECT public.issue_4490_venue_members(
    '44907000-0000-4000-9000-0000000000a1', 'requests')$q$,
  '42501', 'not_authorized', 'G-5b an outsider cannot read membership requests or desk facts');
SELECT public.t4490g_reset();

ROLLBACK;
