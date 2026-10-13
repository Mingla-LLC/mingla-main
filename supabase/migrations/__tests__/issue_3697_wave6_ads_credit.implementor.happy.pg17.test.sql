-- toward #3697 Wave 6 — Ads credit apply, FIFO withdraw, idempotency, immutability.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES
  ('00000000-3697-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue3697-w6-owner@example.test', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.creator_accounts (id, created_at)
VALUES ('00000000-3697-4000-8000-000000000001', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.brands (id, account_id, name, slug, created_at, updated_at)
VALUES (
  '00000000-3697-4000-8000-000000000010',
  '00000000-3697-4000-8000-000000000001',
  'Issue 3697 Wave6',
  'issue3697wave6credit',
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.brand_team_members
  (brand_id, user_id, role, accepted_at, invited_at)
VALUES
  ('00000000-3697-4000-8000-000000000010', '00000000-3697-4000-8000-000000000001',
   'brand_owner', now(), now())
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  v_brand uuid := '00000000-3697-4000-8000-000000000010';
  v_actor uuid := '00000000-3697-4000-8000-000000000001';
  v_first jsonb;
  v_replay jsonb;
  v_withdraw jsonb;
  v_bal bigint;
  v_refund bigint;
BEGIN
  IF to_regprocedure('public.ad_credit_apply(uuid,text,bigint,text,text,bigint,bigint,bigint,uuid,text,uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'ISSUE-3697 W6: ad_credit_apply missing';
  END IF;

  -- Odd top-up: floor(2501*0.85)=2125 credit, 376 fee.
  v_first := public.ad_credit_apply(
    v_brand, 'top_up', 2125, 'USD', 'w6-topup-2501-unique',
    376, 2501, NULL, NULL, 'pi_test_2501', v_actor, '{}'::jsonb
  );
  IF (v_first->>'replayed')::boolean THEN
    RAISE EXCEPTION 'ISSUE-3697 W6: first top-up should not replay';
  END IF;
  IF (v_first->>'balance_after_cents')::bigint <> 2125 THEN
    RAISE EXCEPTION 'ISSUE-3697 W6: balance after top-up %', v_first;
  END IF;

  v_replay := public.ad_credit_apply(
    v_brand, 'top_up', 2125, 'USD', 'w6-topup-2501-unique',
    376, 2501, NULL, NULL, 'pi_test_2501', v_actor, '{}'::jsonb
  );
  IF NOT (v_replay->>'replayed')::boolean THEN
    RAISE EXCEPTION 'ISSUE-3697 W6: idempotent replay required';
  END IF;
  IF (SELECT count(*) FROM public.ad_credit_ledger WHERE brand_id = v_brand) <> 1 THEN
    RAISE EXCEPTION 'ISSUE-3697 W6: replay must not insert a second ledger row';
  END IF;

  v_withdraw := public.ad_credit_apply(
    v_brand, 'withdraw', 2125, 'USD', 'w6-withdraw-all-unique',
    0, NULL, NULL, NULL, NULL, v_actor, '{}'::jsonb
  );
  v_refund := (v_withdraw->>'refund_cents')::bigint;
  IF v_refund <> 2501 THEN
    RAISE EXCEPTION 'ISSUE-3697 W6: FIFO refund must be 2501, got %', v_refund;
  END IF;
  SELECT balance_cents INTO v_bal FROM public.ad_credit_wallets WHERE brand_id = v_brand;
  IF v_bal <> 0 THEN
    RAISE EXCEPTION 'ISSUE-3697 W6: wallet should be empty after full withdraw';
  END IF;

  BEGIN
    UPDATE public.ad_credit_ledger SET fee_cents = 0 WHERE brand_id = v_brand;
    RAISE EXCEPTION 'ISSUE-3697 W6: ledger UPDATE should have been rejected';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;

  BEGIN
    DELETE FROM public.ad_credit_ledger WHERE brand_id = v_brand;
    RAISE EXCEPTION 'ISSUE-3697 W6: ledger DELETE should have been rejected';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;

  RAISE NOTICE 'ISSUE-3697 Wave 6 ads credit happy OK';
END $$;

ROLLBACK;
