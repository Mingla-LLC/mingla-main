-- #3660 Phase 3 adversarial — event_manager refused; pending refused; soft-delete.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES
  ('00000000-3660-4000-8000-000000000101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue3660a-owner@example.test', now(), now()),
  ('00000000-3660-4000-8000-000000000102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue3660a-em@example.test', now(), now()),
  ('00000000-3660-4000-8000-000000000103', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue3660a-pending@example.test', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.creator_accounts (id, created_at)
VALUES ('00000000-3660-4000-8000-000000000101', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.brands (id, account_id, name, slug, created_at, updated_at)
VALUES (
  '00000000-3660-4000-8000-000000000110',
  '00000000-3660-4000-8000-000000000101',
  'Issue 3660 Adv',
  'issue3660adv',
  now(),
  now()
);

INSERT INTO public.brand_team_members
  (brand_id, user_id, role, accepted_at, invited_at)
VALUES
  ('00000000-3660-4000-8000-000000000110', '00000000-3660-4000-8000-000000000101',
   'brand_owner', now(), now()),
  ('00000000-3660-4000-8000-000000000110', '00000000-3660-4000-8000-000000000102',
   'event_manager', now(), now()),
  ('00000000-3660-4000-8000-000000000110', '00000000-3660-4000-8000-000000000103',
   'brand_admin', NULL, now())
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  v_brand uuid := '00000000-3660-4000-8000-000000000110';
  v_owner uuid := '00000000-3660-4000-8000-000000000101';
  v_em uuid := '00000000-3660-4000-8000-000000000102';
  v_pending uuid := '00000000-3660-4000-8000-000000000103';
BEGIN
  IF public.biz_can_mutate_payouts_for_brand(v_brand, v_em) THEN
    RAISE EXCEPTION 'ISSUE-3660 adv: event_manager must not mutate';
  END IF;
  IF public.biz_can_view_payments_for_brand(v_brand, v_em) THEN
    RAISE EXCEPTION 'ISSUE-3660 adv: event_manager must not view';
  END IF;
  IF public.biz_can_mutate_payouts_for_brand(v_brand, v_pending) THEN
    RAISE EXCEPTION 'ISSUE-3660 adv: pending admin must not mutate';
  END IF;
  IF public.biz_can_view_payments_for_brand(v_brand, v_pending) THEN
    RAISE EXCEPTION 'ISSUE-3660 adv: pending admin must not view';
  END IF;

  UPDATE public.brands SET deleted_at = now() WHERE id = v_brand;
  IF public.biz_can_mutate_payouts_for_brand(v_brand, v_owner) THEN
    RAISE EXCEPTION 'ISSUE-3660 adv: soft-deleted brand must deny mutate';
  END IF;
  IF public.biz_can_view_payments_for_brand(v_brand, v_owner) THEN
    RAISE EXCEPTION 'ISSUE-3660 adv: soft-deleted brand must deny view';
  END IF;

  RAISE NOTICE 'ISSUE-3660 payouts owner-only adversarial OK';
END $$;

ROLLBACK;
