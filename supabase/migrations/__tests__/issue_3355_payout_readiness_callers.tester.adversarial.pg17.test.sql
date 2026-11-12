-- Issue #3355 retest 7 (tester, adversarial) — the members-only payout
-- readiness check (20280702143355) from the angles the implementor suite
-- does not take:
--
--   T1  a pending invite (not accepted), a member of a DELETED brand, a
--       signed-in caller with no user id, and an unknown brand id are all
--       refused with the SAME SQLSTATE 42501 and the same message (no brand
--       enumeration, no "exists but not yours" signal);
--   T2  anon calling the wrapper over the API role is refused by privilege;
--   T3  the instalment trigger still answers for a signed-in event manager
--       after the predicate is revoked from them: a payout-ready brand's
--       scheduled trip accepts an instalment tier, a not-ready brand's is
--       refused with bank_required_for_installments (never "permission
--       denied for function");
--   T4  brand_readiness still answers can_be_paid_out for a scanner and an
--       event manager (members of every rank keep the readiness view).
-- Reverting 20280702143355's REVOKE makes T2's base-predicate probe pass for
-- anon; deleting the membership test makes T1 fail.

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email) VALUES
  ('33557000-0a70-4000-8000-000000000001','t7-owner@test.local'),
  ('33557000-0a70-4000-8000-000000000002','t7-pending@test.local'),
  ('33557000-0a70-4000-8000-000000000003','t7-evman@test.local'),
  ('33557000-0a70-4000-8000-000000000004','t7-scanner@test.local');
INSERT INTO public.creator_accounts(id,email,display_name,business_name) VALUES
  ('33557000-0a70-4000-8000-000000000001','t7-owner@test.local','T7 Owner','T7 Host');
INSERT INTO public.brands(id,account_id,name,slug,paystack_subaccount_code,default_currency) VALUES
  ('33557000-0a70-4000-8000-0000000000b1','33557000-0a70-4000-8000-000000000001','T7 Ready','t7-3355-ready','ACCT_t73355','NGN'),
  ('33557000-0a70-4000-8000-0000000000b2','33557000-0a70-4000-8000-000000000001','T7 Not Ready','t7-3355-not-ready',NULL,'NGN'),
  ('33557000-0a70-4000-8000-0000000000b3','33557000-0a70-4000-8000-000000000001','T7 Deleted','t7-3355-deleted','ACCT_t7del','NGN');
UPDATE public.brands SET deleted_at = now() WHERE id = '33557000-0a70-4000-8000-0000000000b3';
INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at,removed_at) VALUES
  ('33557000-0a70-4000-8000-0000000000b1','33557000-0a70-4000-8000-000000000002','brand_admin',NULL,NULL),
  ('33557000-0a70-4000-8000-0000000000b1','33557000-0a70-4000-8000-000000000003','event_manager',now(),NULL),
  ('33557000-0a70-4000-8000-0000000000b2','33557000-0a70-4000-8000-000000000003','event_manager',now(),NULL),
  ('33557000-0a70-4000-8000-0000000000b3','33557000-0a70-4000-8000-000000000003','event_manager',now(),NULL),
  ('33557000-0a70-4000-8000-0000000000b1','33557000-0a70-4000-8000-000000000004','scanner',now(),NULL);

CREATE OR REPLACE FUNCTION pg_temp.t7_as(p_user uuid, p_role text DEFAULT 'authenticated')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', p_role)::text, true);
END;
$$;

-- ── T1 every refusal looks the same ───────────────────────────────────────
DO $t1$
DECLARE
  v_user uuid;
  v_brand uuid;
  v_state text;
  v_msg text;
  v_seen text := NULL;
BEGIN
  FOR v_user, v_brand IN VALUES
    ('33557000-0a70-4000-8000-000000000002'::uuid, '33557000-0a70-4000-8000-0000000000b1'::uuid), -- pending invite
    ('33557000-0a70-4000-8000-000000000003'::uuid, '33557000-0a70-4000-8000-0000000000b3'::uuid), -- deleted brand
    (NULL::uuid,                                   '33557000-0a70-4000-8000-0000000000b1'::uuid), -- no user id
    ('33557000-0a70-4000-8000-000000000003'::uuid, '33557000-0a70-4000-8000-00000000ffff'::uuid)  -- unknown brand
  LOOP
    v_state := NULL;
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.t7_as(v_user);
    BEGIN
      PERFORM public.pg_brand_can_payout_for_caller(v_brand);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    RESET ROLE;
    IF v_state IS DISTINCT FROM '42501' THEN
      RAISE EXCEPTION 'T1 % / % was not refused with 42501 (got %)', v_user, v_brand, v_state;
    END IF;
    IF v_seen IS NOT NULL AND v_msg <> v_seen THEN
      RAISE EXCEPTION 'T1 refusals differ (% vs %): a caller can tell the cases apart', v_msg, v_seen;
    END IF;
    v_seen := v_msg;
  END LOOP;
END
$t1$;

-- ── T2 anon is refused by privilege, for the wrapper and the base ──────────
DO $t2$
DECLARE
  v_state text;
BEGIN
  FOR i IN 1..2 LOOP
    v_state := NULL;
    SET LOCAL ROLE anon;
    PERFORM pg_temp.t7_as(NULL, 'anon');
    BEGIN
      IF i = 1 THEN
        PERFORM public.pg_brand_can_payout_for_caller('33557000-0a70-4000-8000-0000000000b1');
      ELSE
        PERFORM public.pg_brand_can_payout('33557000-0a70-4000-8000-0000000000b1');
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      v_state := '42501';
    END;
    RESET ROLE;
    IF v_state IS DISTINCT FROM '42501' THEN
      RAISE EXCEPTION 'T2 anon reached payout readiness (call %)', i;
    END IF;
  END LOOP;
  -- And a signed-in member cannot call the base predicate directly.
  v_state := NULL;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t7_as('33557000-0a70-4000-8000-000000000001');
  BEGIN
    PERFORM public.pg_brand_can_payout('33557000-0a70-4000-8000-0000000000b1');
  EXCEPTION WHEN insufficient_privilege THEN
    v_state := '42501';
  END;
  RESET ROLE;
  IF v_state IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'T2 a signed-in owner can still EXECUTE the base predicate';
  END IF;
END
$t2$;

-- ── T3 the instalment trigger still works for a signed-in event manager ────
SET LOCAL session_replication_role = replica; -- fixture only: skip publish guards
INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency) VALUES
  ('33557000-0a70-4000-8000-0000000000e1','33557000-0a70-4000-8000-0000000000b1','33557000-0a70-4000-8000-000000000001','T7 Ready Trip','t7-3355-ready-trip','trip','scheduled','public','Africa/Lagos','NGN'),
  ('33557000-0a70-4000-8000-0000000000e2','33557000-0a70-4000-8000-0000000000b2','33557000-0a70-4000-8000-000000000001','T7 Not Ready Trip','t7-3355-not-ready-trip','trip','scheduled','public','Africa/Lagos','NGN');
INSERT INTO public.ticket_types(id,event_id,name) VALUES
  ('33557000-0a70-4000-8000-0000000000f1','33557000-0a70-4000-8000-0000000000e1','Package'),
  ('33557000-0a70-4000-8000-0000000000f2','33557000-0a70-4000-8000-0000000000e2','Package');
SET LOCAL session_replication_role = origin;

DO $t3$
DECLARE
  v_state text;
  v_msg text;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t7_as('33557000-0a70-4000-8000-000000000003');
  INSERT INTO public.trip_pricing_tiers(event_id,ticket_type_id,tier_name,tier_metadata) VALUES
    ('33557000-0a70-4000-8000-0000000000e1','33557000-0a70-4000-8000-0000000000f1','Pay in parts',
     '{"installments":{"count":2}}'::jsonb);
  BEGIN
    INSERT INTO public.trip_pricing_tiers(event_id,ticket_type_id,tier_name,tier_metadata) VALUES
      ('33557000-0a70-4000-8000-0000000000e2','33557000-0a70-4000-8000-0000000000f2','Pay in parts',
       '{"installments":{"count":2}}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  IF v_msg IS DISTINCT FROM 'bank_required_for_installments' THEN
    RAISE EXCEPTION 'T3 the not-ready brand''s instalment tier was not refused by the payout trigger (% %)', v_state, v_msg;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.trip_pricing_tiers WHERE event_id = '33557000-0a70-4000-8000-0000000000e1') THEN
    RAISE EXCEPTION 'T3 the payout-ready brand''s instalment tier was not saved';
  END IF;
END
$t3$;

-- ── T4 brand_readiness keeps answering for lower ranks ─────────────────────
DO $t4$
DECLARE
  v_user uuid;
  v_ready jsonb;
BEGIN
  FOREACH v_user IN ARRAY ARRAY[
    '33557000-0a70-4000-8000-000000000003'::uuid,
    '33557000-0a70-4000-8000-000000000004'::uuid
  ] LOOP
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.t7_as(v_user);
    v_ready := public.brand_readiness('33557000-0a70-4000-8000-0000000000b1', NULL);
    RESET ROLE;
    IF v_ready::text NOT LIKE '%"can_be_paid_out": true%' THEN
      RAISE EXCEPTION 'T4 brand_readiness lost can_be_paid_out for %: %', v_user, left(v_ready::text, 300);
    END IF;
    IF public.pg_brand_can_payout('33557000-0a70-4000-8000-0000000000b1') IS NOT TRUE THEN
      RAISE EXCEPTION 'T4 fixture: brand b1 should be payout ready';
    END IF;
  END LOOP;
END
$t4$;

ROLLBACK;
