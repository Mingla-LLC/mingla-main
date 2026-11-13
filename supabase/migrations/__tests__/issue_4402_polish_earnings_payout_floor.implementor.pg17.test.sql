\set ON_ERROR_STOP on

-- #4402 polish PR, migration M4 (20280704304402): earnings held below the
-- payout floor are explained per currency, with the floor read from
-- payee_payout_currency_floors (item 31). Everything rolls back.
--
-- MINGLA-INVARIANT: I-4402-FLOOR-1 | issue #4402 | the payout floor shown to a creator is read from payee_payout_currency_floors, per currency

BEGIN;
CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
$$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email) VALUES
  ('44020400-0000-4000-8000-0000000000a1','i4402e-creator@mingla.test'),
  ('44020400-0000-4000-8000-0000000000a2','i4402e-empty@mingla.test');
INSERT INTO public.profiles(id,display_name) VALUES
  ('44020400-0000-4000-8000-0000000000a1','Floor Creator'),('44020400-0000-4000-8000-0000000000a2','No Shares') ON CONFLICT(id) DO NOTHING;
INSERT INTO public.payee_shares(id,order_kind,order_id,payee_kind,payee_user_id,rail,currency,gross_minor,mingla_fee_minor,net_minor,status,release_after) VALUES
  ('44020400-0000-4000-8000-000000000301','gig','44020400-0000-4000-8000-000000000901','gig_fee','44020400-0000-4000-8000-0000000000a1','paystack','NGN',10000,0,10000,'accumulating',now()),
  ('44020400-0000-4000-8000-000000000302','gig','44020400-0000-4000-8000-000000000902','gig_fee','44020400-0000-4000-8000-0000000000a1','stripe','USD',300,0,300,'accumulating',now()),
  ('44020400-0000-4000-8000-000000000303','gig','44020400-0000-4000-8000-000000000903','gig_fee','44020400-0000-4000-8000-0000000000a1','stripe','GBP',900,0,900,'paid',now());
SET LOCAL session_replication_role = origin;

DO $test$
DECLARE v_r jsonb; v_m jsonb; v_ngn jsonb; v_usd jsonb;
BEGIN
  PERFORM pg_temp.act('44020400-0000-4000-8000-0000000000a1');
  v_r := public.creator_earnings_summary();
  SELECT e INTO v_ngn FROM jsonb_array_elements(v_r->'held_below_floor') e WHERE e->>'currency' = 'NGN';
  SELECT e INTO v_usd FROM jsonb_array_elements(v_r->'held_below_floor') e WHERE e->>'currency' = 'USD';
  IF jsonb_array_length(v_r->'held_below_floor') <> 2
     OR (v_ngn->>'held_minor')::bigint <> 10000
     OR (v_ngn->>'floor_minor')::bigint IS DISTINCT FROM (SELECT floor_minor FROM public.payee_payout_currency_floors WHERE currency = 'NGN')
     OR (v_usd->>'held_minor')::bigint <> 300
     OR (v_usd->>'floor_minor')::bigint IS DISTINCT FROM (SELECT floor_minor FROM public.payee_payout_currency_floors WHERE currency = 'USD') THEN
    RAISE EXCEPTION 'T-M4 creator_earnings_summary.held_below_floor: %', v_r->'held_below_floor';
  END IF;
  v_m := public.issue_3872_my_earnings_summary();
  IF v_m->'held_below_floor' IS DISTINCT FROM v_r->'held_below_floor' THEN
    RAISE EXCEPTION 'T-M4 the referral wallet disagrees: %', v_m->'held_below_floor';
  END IF;
  PERFORM pg_temp.act('44020400-0000-4000-8000-0000000000a2');
  IF public.creator_earnings_summary()->'held_below_floor' <> '[]'::jsonb THEN RAISE EXCEPTION 'T-M4 no accumulating shares must be empty'; END IF;
  IF has_function_privilege('authenticated', 'public.issue_4402_held_below_floor(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T-M4 the helper can read another user''s balance';
  END IF;
END;
$test$;

ROLLBACK;
\echo 'issue #4402 polish M4 (payout floor) passed'
