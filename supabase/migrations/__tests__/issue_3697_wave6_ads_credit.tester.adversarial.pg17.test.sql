-- toward #3697 Wave 6 — adversarial: insufficient credit, bad currency, kind.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES
  ('00000000-3697-4000-8000-000000000101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue3697-w6-adv@example.test', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.creator_accounts (id, created_at)
VALUES ('00000000-3697-4000-8000-000000000101', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.brands (id, account_id, name, slug, created_at, updated_at)
VALUES (
  '00000000-3697-4000-8000-000000000110',
  '00000000-3697-4000-8000-000000000101',
  'Issue 3697 Wave6 Adv',
  'issue3697wave6adv',
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_brand uuid := '00000000-3697-4000-8000-000000000110';
  v_actor uuid := '00000000-3697-4000-8000-000000000101';
BEGIN
  PERFORM public.ad_credit_apply(
    v_brand, 'top_up', 8500, 'USD', 'w6-adv-topup',
    1500, 10000, NULL, NULL, 'pi_adv', v_actor, '{}'::jsonb
  );

  BEGIN
    PERFORM public.ad_credit_apply(
      v_brand, 'withdraw', 9000, 'USD', 'w6-adv-overdraw',
      0, NULL, NULL, NULL, NULL, v_actor, '{}'::jsonb
    );
    RAISE EXCEPTION 'ISSUE-3697 W6 adv: overdraw should fail';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    NULL;
  END;

  BEGIN
    PERFORM public.ad_credit_apply(
      v_brand, 'top_up', 8500, 'JPY', 'w6-adv-jpy',
      1500, 10000, NULL, NULL, 'pi_jpy', v_actor, '{}'::jsonb
    );
    RAISE EXCEPTION 'ISSUE-3697 W6 adv: unsupported currency should fail';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  BEGIN
    PERFORM public.ad_credit_apply(
      v_brand, 'campaign_hold', 100, 'USD', 'w6-adv-hold',
      0, NULL, NULL, NULL, NULL, v_actor, '{}'::jsonb
    );
    RAISE EXCEPTION 'ISSUE-3697 W6 adv: campaign_hold must be refused this wave';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  IF (SELECT balance_cents FROM public.ad_credit_wallets WHERE brand_id = v_brand) <> 8500 THEN
    RAISE EXCEPTION 'ISSUE-3697 W6 adv: balance corrupted by refused applies';
  END IF;

  RAISE NOTICE 'ISSUE-3697 Wave 6 ads credit adversarial OK';
END $$;

ROLLBACK;
