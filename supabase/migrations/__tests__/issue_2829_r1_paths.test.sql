-- #2829 R1 P12 — weekly website-plan reminder (pg17, replay database).
-- Fails on revert: the category, service-only grant, cron, rank filter,
-- rolling-seven-day cap, safe copy, and direct plan deep link all disappear.
\set ON_ERROR_STOP on
BEGIN;

DO $r1$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_marketing uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_count integer;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'r1-owner@2829.invalid'),
    (v_admin, 'r1-admin@2829.invalid'),
    (v_marketing, 'r1-marketing@2829.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at)
  VALUES (v_owner, now(), now());
  INSERT INTO public.brands(id, account_id, name, slug)
  VALUES (v_brand, v_owner, 'R1 Reminder Brand', 'r1-reminder-brand');
  INSERT INTO public.brand_team_members(
    brand_id, user_id, role, accepted_at
  ) VALUES
    (v_brand, v_admin, 'brand_admin', now()),
    (v_brand, v_marketing, 'marketing_manager', now());
  INSERT INTO public.brand_site_plans(
    brand_id, offerings_selected, started_by, updated_by, updated_at
  ) VALUES (
    v_brand, ARRAY[]::text[], v_owner, v_owner,
    now() - interval '8 days'
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.notification_categories
    WHERE key = 'business.site_plan_reminder'
      AND default_channels = ARRAY['inapp', 'push']::text[]
      AND reach_mode = 'reach_once'
      AND active
  ) THEN
    RAISE EXCEPTION 'weekly reminder category is absent or unsafe';
  END IF;
  IF has_function_privilege(
      'authenticated', 'public.brand_site_plan_reminder_sweep()', 'EXECUTE'
    ) OR has_function_privilege(
      'anon', 'public.brand_site_plan_reminder_sweep()', 'EXECUTE'
    ) OR NOT has_function_privilege(
      'service_role', 'public.brand_site_plan_reminder_sweep()', 'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'weekly reminder sweep is not service-only';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'brand-site-plan-reminders'
      AND schedule = '37 14 * * *'
      AND command = 'SELECT public.brand_site_plan_reminder_sweep();'
  ) THEN
    RAISE EXCEPTION 'weekly reminder sweep is not scheduled';
  END IF;

  v_count := public.brand_site_plan_reminder_sweep();
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'owner and brand admin were not reminded: %', v_count;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.notification_outbox
    WHERE category_key = 'business.site_plan_reminder'
      AND brand_id = v_brand
      AND user_id = v_marketing
  ) THEN
    RAISE EXCEPTION 'rank-20 teammate received an admin reminder';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.notification_outbox
    WHERE category_key = 'business.site_plan_reminder'
      AND brand_id = v_brand
      AND (
        payload->>'title' <> 'Finish your website'
        OR payload->>'body' <> 'R1 Reminder Brand: continue with Ari at your brand.'
        OR payload->>'deep_link' <>
          'mingla-business://brand/' || v_brand || '/website/plan'
      )
  ) THEN
    RAISE EXCEPTION 'weekly reminder copy or deep link drifted';
  END IF;
  IF public.brand_site_plan_reminder_sweep() <> 0 THEN
    RAISE EXCEPTION 'a second sweep repeated the reminder inside seven days';
  END IF;

  UPDATE public.notification_outbox
  SET created_at = now() - interval '8 days',
      idempotency_key = idempotency_key || ':old'
  WHERE category_key = 'business.site_plan_reminder'
    AND brand_id = v_brand;
  IF public.brand_site_plan_reminder_sweep() <> 2 THEN
    RAISE EXCEPTION 'the weekly reminder did not become eligible after seven days';
  END IF;

  RAISE NOTICE 'ISSUE_2829_R1_PATHS_OK';
END;
$r1$;

ROLLBACK;
