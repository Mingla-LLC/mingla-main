-- MINGLA-INVARIANT: I-PROPOSED-2829-17 | issue #2829 | An unfinished website plan may remind only the brand owner and rank-50+ teammates with accepted membership, at most once per recipient per brand in any rolling seven-day window; the sweep never mutates the plan or site.
-- #2829 R1 independent adversarial proof (pg17, replay database).
-- A weekly nudge must not become a broad or mutating sweep: fresh plans,
-- deleted brands, revoked entitlements, and inactive teammates stay quiet.
\set ON_ERROR_STOP on
BEGIN;

DO $tester$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_removed uuid := gen_random_uuid();
  v_unaccepted uuid := gen_random_uuid();
  v_marketing uuid := gen_random_uuid();
  v_live uuid := gen_random_uuid();
  v_fresh uuid := gen_random_uuid();
  v_revoked uuid := gen_random_uuid();
  v_deleted uuid := gen_random_uuid();
  v_before jsonb;
  v_after jsonb;
  v_inserted integer;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'r1-tester-owner@2829.invalid'),
    (v_admin, 'r1-tester-admin@2829.invalid'),
    (v_removed, 'r1-tester-removed@2829.invalid'),
    (v_unaccepted, 'r1-tester-unaccepted@2829.invalid'),
    (v_marketing, 'r1-tester-marketing@2829.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at)
  VALUES (v_owner, now(), now());
  INSERT INTO public.brands(id, account_id, name, slug) VALUES
    (v_live, v_owner, 'R1 Tester Live', 'r1-tester-live'),
    (v_fresh, v_owner, 'R1 Tester Fresh', 'r1-tester-fresh'),
    (v_revoked, v_owner, 'R1 Tester Revoked', 'r1-tester-revoked'),
    (v_deleted, v_owner, 'R1 Tester Deleted', 'r1-tester-deleted');
  UPDATE public.brands SET deleted_at = now() WHERE id = v_deleted;

  INSERT INTO public.brand_team_members(
    brand_id, user_id, role, accepted_at, removed_at
  ) VALUES
    (v_live, v_admin, 'brand_admin', now(), NULL),
    (v_live, v_removed, 'brand_admin', now(), now()),
    (v_live, v_unaccepted, 'brand_admin', NULL, NULL),
    (v_live, v_marketing, 'marketing_manager', now(), NULL);

  UPDATE public.brand_site_entitlements
  SET status = 'revoked', source = 'admin', revoked_by = v_owner,
      revoked_at = now(), reason_code = 'owner_request'
  WHERE brand_id = v_revoked;
  INSERT INTO public.brand_site_plans(
    brand_id, offerings_selected, started_by, updated_by, updated_at
  ) VALUES
    (v_live, ARRAY[]::text[], v_owner, v_owner, now() - interval '30 days'),
    (v_fresh, ARRAY[]::text[], v_owner, v_owner, now() - interval '6 days 23 hours'),
    (v_revoked, ARRAY[]::text[], v_owner, v_owner, now() - interval '30 days'),
    (v_deleted, ARRAY[]::text[], v_owner, v_owner, now() - interval '30 days');

  -- An earlier owner notice inside the rolling window blocks only that owner;
  -- it must not suppress the other eligible recipient for the same brand.
  INSERT INTO public.notification_outbox(
    category_key, user_id, brand_id, payload, idempotency_key, created_at
  ) VALUES (
    'business.site_plan_reminder', v_owner, v_live, '{}'::jsonb,
    'r1-tester-prior-owner', now() - interval '6 days 23 hours'
  );
  SELECT to_jsonb(plan) INTO v_before
  FROM public.brand_site_plans plan WHERE brand_id = v_live;

  v_inserted := public.brand_site_plan_reminder_sweep();
  IF v_inserted <> 1 THEN
    RAISE EXCEPTION 'rolling cap did not isolate one eligible admin: %', v_inserted;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.notification_outbox
    WHERE category_key = 'business.site_plan_reminder'
      AND brand_id = v_live AND user_id = v_admin
  ) THEN
    RAISE EXCEPTION 'active brand admin did not receive the one eligible reminder';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.notification_outbox
    WHERE category_key = 'business.site_plan_reminder'
      AND brand_id = v_live
      AND user_id IN (v_removed, v_unaccepted, v_marketing)
  ) THEN
    RAISE EXCEPTION 'an inactive or rank-20 teammate received the reminder';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.notification_outbox
    WHERE category_key = 'business.site_plan_reminder'
      AND brand_id IN (v_fresh, v_revoked, v_deleted)
  ) THEN
    RAISE EXCEPTION 'a fresh, revoked, or deleted brand received a reminder';
  END IF;

  SELECT to_jsonb(plan) INTO v_after
  FROM public.brand_site_plans plan WHERE brand_id = v_live;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'the reminder sweep mutated the website plan';
  END IF;
  IF public.brand_site_plan_reminder_sweep() <> 0 THEN
    RAISE EXCEPTION 'an immediate replay inserted another reminder';
  END IF;

  -- Once the owner's own prior notice is older than seven days, that owner is
  -- eligible even though the admin's newer notice still is not.
  UPDATE public.notification_outbox
  SET created_at = now() - interval '7 days 1 second'
  WHERE idempotency_key = 'r1-tester-prior-owner';
  v_inserted := public.brand_site_plan_reminder_sweep();
  IF v_inserted <> 1 THEN
    RAISE EXCEPTION 'recipient did not re-arm after the rolling window: %', v_inserted;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.notification_outbox
    WHERE category_key = 'business.site_plan_reminder'
      AND brand_id = v_live AND user_id = v_owner
      AND idempotency_key <> 'r1-tester-prior-owner'
  ) THEN
    RAISE EXCEPTION 're-armed recipient has no new outbox row';
  END IF;

  RAISE NOTICE 'ISSUE_2829_R1_PATHS_TESTER_ADVERSARIAL_OK';
END;
$tester$;

ROLLBACK;
