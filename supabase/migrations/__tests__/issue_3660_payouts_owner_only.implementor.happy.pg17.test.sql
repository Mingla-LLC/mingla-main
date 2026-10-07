-- #3660 Phase 3 — owner mutates payouts; admin/FM view.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES
  ('00000000-3660-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue3660-owner@example.test', now(), now()),
  ('00000000-3660-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue3660-admin@example.test', now(), now()),
  ('00000000-3660-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'issue3660-fm@example.test', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.creator_accounts (id, created_at)
VALUES ('00000000-3660-4000-8000-000000000001', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.brands (id, account_id, name, slug, created_at, updated_at)
VALUES (
  '00000000-3660-4000-8000-000000000010',
  '00000000-3660-4000-8000-000000000001',
  'Issue 3660 Payouts',
  'issue3660payouts',
  now(),
  now()
);

-- Owner row may already exist from the brands insert trigger; upsert-safe seed.
INSERT INTO public.brand_team_members
  (brand_id, user_id, role, accepted_at, invited_at)
VALUES
  ('00000000-3660-4000-8000-000000000010', '00000000-3660-4000-8000-000000000001',
   'brand_owner', now(), now()),
  ('00000000-3660-4000-8000-000000000010', '00000000-3660-4000-8000-000000000002',
   'brand_admin', now(), now()),
  ('00000000-3660-4000-8000-000000000010', '00000000-3660-4000-8000-000000000003',
   'finance_manager', now(), now())
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  v_brand uuid := '00000000-3660-4000-8000-000000000010';
  v_owner uuid := '00000000-3660-4000-8000-000000000001';
  v_admin uuid := '00000000-3660-4000-8000-000000000002';
  v_fm uuid := '00000000-3660-4000-8000-000000000003';
BEGIN
  IF NOT public.biz_can_mutate_payouts_for_brand(v_brand, v_owner) THEN
    RAISE EXCEPTION 'ISSUE-3660 happy: owner must mutate';
  END IF;
  IF public.biz_can_mutate_payouts_for_brand(v_brand, v_admin) THEN
    RAISE EXCEPTION 'ISSUE-3660 happy: admin must not mutate';
  END IF;
  IF public.biz_can_mutate_payouts_for_brand(v_brand, v_fm) THEN
    RAISE EXCEPTION 'ISSUE-3660 happy: finance_manager must not mutate';
  END IF;

  IF NOT public.biz_can_view_payments_for_brand(v_brand, v_owner) THEN
    RAISE EXCEPTION 'ISSUE-3660 happy: owner must view';
  END IF;
  IF NOT public.biz_can_view_payments_for_brand(v_brand, v_admin) THEN
    RAISE EXCEPTION 'ISSUE-3660 happy: admin must view';
  END IF;
  IF NOT public.biz_can_view_payments_for_brand(v_brand, v_fm) THEN
    RAISE EXCEPTION 'ISSUE-3660 happy: finance_manager must view';
  END IF;

  IF NOT public.biz_can_manage_payments_for_brand(v_brand, v_admin) THEN
    RAISE EXCEPTION 'ISSUE-3660 happy: legacy manage still admits admin';
  END IF;

  RAISE NOTICE 'ISSUE-3660 payouts owner-only happy OK';
END $$;

ROLLBACK;
