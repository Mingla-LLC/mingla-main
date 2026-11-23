-- #3281 S6 checkpoint 16: a guest's pass shows the add-ons on their own RSVP.
-- MINGLA-INVARIANT: I-ADDON-RSVP-PASS-OWNER-ONLY | issue #3281 | The add-ons stored with an RSVP are read for its pass only by the signed-in owner of that going, not-denied RSVP on a live event; anyone else, anon and service_role get nothing.
--
-- T-SHAPE      SECURITY DEFINER, pinned search_path, EXECUTE for authenticated only.
-- T-OWNER      the owner reads [{id, name, quantity}] in the host's order.
-- T-OTHER      another signed-in user reads [] for the same RSVP.
-- T-NO-USER    no signed-in user (no sub) reads [].
-- T-ANON       anon cannot call it (42501).
-- T-NOT-GOING  once the RSVP is not going, the owner reads [].
-- T-DENIED     a denied RSVP reads [].
-- T-CANCELLED  a cancelled event reads [].
--
-- FAILS-ON-REVERT: drop the `v.user_id = auth.uid()` predicate -> T-OTHER red;
-- drop the migration 20281202143281 -> every case red (function missing).
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #3281 my RSVP add-ons FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.err(p_sql text)
RETURNS text LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_sub text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_sub, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_sub IS NULL THEN '{}' ELSE json_build_object('sub', p_sub, 'role', 'authenticated')::text END,
    true);
END;
$fn$;

BEGIN;

CREATE TEMP TABLE t3281_ids (k text PRIMARY KEY, v uuid);
GRANT SELECT ON t3281_ids TO authenticated, anon;

DO $setup$
DECLARE
  v_owner uuid := '32816e00-0000-4000-8300-000000000001';
  v_brand uuid := '32816e00-0000-4000-8300-000000000002';
  v_rsvp uuid := '32816e00-0000-4000-8300-000000000005';
  v_guest uuid := '32816e00-0000-4000-8300-000000000021';
  v_other uuid := '32816e00-0000-4000-8300-000000000022';
  v_seat uuid; v_tee uuid;
  v_result jsonb;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'myaddons-owner@example.test'), (v_guest, 'myaddons-guest@example.test'),
    (v_other, 'myaddons-other@example.test');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'myaddons-owner@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider,
    payment_country, pricing_region, pricing_currency)
  VALUES (v_brand, v_owner, 'My add-ons brand', 'myaddons-brand', 'USD', 'stripe', 'US', 'US', 'USD');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, published_at, rsvp_allow_plus_ones, rsvp_plus_ones_max)
  VALUES (v_rsvp, v_brand, v_owner, 'My add-ons rsvp', 'myaddons-rsvp', 'rsvp', 'scheduled', 'public',
    'UTC', 'USD', now(), true, 3);
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (v_rsvp, now() + interval '6 days', now() + interval '6 days 3 hours', 'UTC', true);
  INSERT INTO public.ticket_add_ons(event_id, ticket_type_id, name, price_cents, quantity_total,
    is_unlimited, max_per_ticket, sort_order)
  VALUES (v_rsvp, NULL, 'Tee', 0, NULL, true, 2, 1) RETURNING id INTO v_tee;
  INSERT INTO public.ticket_add_ons(event_id, ticket_type_id, name, price_cents, quantity_total,
    is_unlimited, max_per_ticket, sort_order)
  VALUES (v_rsvp, NULL, 'Reserved seat', 0, 10, false, 1, 0) RETURNING id INTO v_seat;
  INSERT INTO public.ticket_add_on_links(add_on_id, event_id, target_kind, ticket_type_id) VALUES
    (v_seat, v_rsvp, 'rsvp', NULL), (v_tee, v_rsvp, 'rsvp', NULL);
  UPDATE public.add_on_rollout SET rsvp_enabled = true WHERE id;

  v_result := public.issue_3281_submit_rsvp_with_add_ons(v_rsvp, v_guest, 'Guest',
    'myaddons-guest@example.test', '+15553281221', 'going', 0, '[]', NULL, 'US', false, NULL,
    jsonb_build_array(jsonb_build_object('addOnId', v_tee, 'quantity', 2),
                      jsonb_build_object('addOnId', v_seat, 'quantity', 1)));
  INSERT INTO t3281_ids VALUES ('rsvp', (v_result->>'rsvpId')::uuid), ('event', v_rsvp),
    ('guest', v_guest), ('other', v_other), ('seat', v_seat), ('tee', v_tee);
  PERFORM pg_temp.ok((v_result->>'rsvpId') IS NOT NULL
    AND (SELECT count(*) FROM public.event_rsvp_add_ons WHERE rsvp_id = (v_result->>'rsvpId')::uuid) = 2,
    'setup: the guest RSVPed going with two free add-ons');

  -- ---- T-SHAPE ----
  PERFORM pg_temp.ok(EXISTS (
      SELECT 1 FROM pg_proc p
       WHERE p.oid = 'public.issue_3281_my_rsvp_add_ons(uuid)'::regprocedure
         AND p.prosecdef
         AND p.proconfig @> ARRAY['search_path=public, pg_temp']),
    'T-SHAPE security definer with a pinned search_path');
  PERFORM pg_temp.ok(
    has_function_privilege('authenticated', 'public.issue_3281_my_rsvp_add_ons(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_3281_my_rsvp_add_ons(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.issue_3281_my_rsvp_add_ons(uuid)', 'EXECUTE'),
    'T-SHAPE EXECUTE for authenticated only');
END;
$setup$;

-- ---- T-OWNER / T-OTHER / T-NO-USER, as the authenticated role ----
SET LOCAL ROLE authenticated;
DO $owner$
DECLARE
  v_rsvp uuid := (SELECT v FROM t3281_ids WHERE k = 'rsvp');
  v_got jsonb;
BEGIN
  PERFORM pg_temp.as_user((SELECT v FROM t3281_ids WHERE k = 'guest')::text);
  v_got := public.issue_3281_my_rsvp_add_ons(v_rsvp);
  PERFORM pg_temp.ok(v_got = jsonb_build_array(
      jsonb_build_object('id', (SELECT v FROM t3281_ids WHERE k = 'seat'), 'name', 'Reserved seat', 'quantity', 1),
      jsonb_build_object('id', (SELECT v FROM t3281_ids WHERE k = 'tee'), 'name', 'Tee', 'quantity', 2)),
    'T-OWNER the owner reads their add-ons in the host''s order: ' || v_got::text);

  PERFORM pg_temp.as_user((SELECT v FROM t3281_ids WHERE k = 'other')::text);
  v_got := public.issue_3281_my_rsvp_add_ons(v_rsvp);
  PERFORM pg_temp.ok(v_got = '[]'::jsonb, 'T-OTHER another user reads nothing: ' || v_got::text);

  PERFORM pg_temp.as_user(NULL);
  v_got := public.issue_3281_my_rsvp_add_ons(v_rsvp);
  PERFORM pg_temp.ok(v_got = '[]'::jsonb, 'T-NO-USER no signed-in user reads nothing: ' || v_got::text);
END;
$owner$;
RESET ROLE;

-- ---- T-ANON ----
SET LOCAL ROLE anon;
DO $anon$
DECLARE
  v_error text := pg_temp.err(format('SELECT public.issue_3281_my_rsvp_add_ons(%L)',
    (SELECT v FROM t3281_ids WHERE k = 'rsvp')));
BEGIN
  PERFORM pg_temp.ok(v_error LIKE '42501:%', 'T-ANON anon cannot call it: ' || v_error);
END;
$anon$;
RESET ROLE;

-- ---- T-NOT-GOING / T-DENIED / T-CANCELLED ----
DO $states$
DECLARE
  v_rsvp uuid := (SELECT v FROM t3281_ids WHERE k = 'rsvp');
  v_event uuid := (SELECT v FROM t3281_ids WHERE k = 'event');
  v_guest text := (SELECT v FROM t3281_ids WHERE k = 'guest')::text;
  v_got jsonb;
BEGIN
  UPDATE public.event_rsvps SET rsvp_status = 'not_going' WHERE id = v_rsvp;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user(v_guest);
  v_got := public.issue_3281_my_rsvp_add_ons(v_rsvp);
  RESET ROLE;
  PERFORM pg_temp.ok(v_got = '[]'::jsonb, 'T-NOT-GOING a not-going RSVP reads nothing: ' || v_got::text);

  UPDATE public.event_rsvps SET rsvp_status = 'going', approval_status = 'denied' WHERE id = v_rsvp;
  SET LOCAL ROLE authenticated;
  v_got := public.issue_3281_my_rsvp_add_ons(v_rsvp);
  RESET ROLE;
  PERFORM pg_temp.ok(v_got = '[]'::jsonb, 'T-DENIED a denied RSVP reads nothing: ' || v_got::text);

  UPDATE public.event_rsvps SET approval_status = 'approved' WHERE id = v_rsvp;
  SET LOCAL ROLE authenticated;
  v_got := public.issue_3281_my_rsvp_add_ons(v_rsvp);
  RESET ROLE;
  PERFORM pg_temp.ok(jsonb_array_length(v_got) = 2, 'setup: approved again, the owner reads two');

  UPDATE public.events SET status = 'cancelled' WHERE id = v_event;
  SET LOCAL ROLE authenticated;
  v_got := public.issue_3281_my_rsvp_add_ons(v_rsvp);
  RESET ROLE;
  PERFORM pg_temp.ok(v_got = '[]'::jsonb, 'T-CANCELLED a cancelled event reads nothing: ' || v_got::text);
END;
$states$;

ROLLBACK;
