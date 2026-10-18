-- Issue #3697 v1.4 revisioned server-draft contract.
-- MINGLA-INVARIANT: I-3697-REVISIONED-DRAFTS | issue #3697 | Mutable Admin, Host and Ari form state is server durable, actor-owned and non-executable; stale revisions cannot silently overwrite newer device state.

\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_user constant uuid := '36971100-0000-4000-8000-000000000001';
  v_draft constant uuid := '36971100-0000-4000-8000-000000000002';
  v_failed boolean := false;
BEGIN
  INSERT INTO auth.users (id, email)
  VALUES (v_user, 'issue-3697-draft@example.test');

  INSERT INTO public.ad_plan_drafts (
    id, client_kind, owner_kind, created_by, current_step, draft_state
  ) VALUES (
    v_draft, 'admin', 'mingla', v_user, 'audience',
    '{"audience":{"countries":["NG"]}}'::jsonb
  );

  UPDATE public.ad_plan_drafts
  SET revision = revision + 1,
      draft_state = '{"audience":{"countries":["NG"],"ageMin":21}}'::jsonb
  WHERE id = v_draft AND revision = 1;

  IF NOT EXISTS (
    SELECT 1 FROM public.ad_plan_drafts
    WHERE id = v_draft AND revision = 2
      AND draft_state #>> '{audience,ageMin}' = '21'
  ) THEN
    RAISE EXCEPTION 'revisioned_draft_update_missing';
  END IF;

  IF has_table_privilege('authenticated', 'public.ad_plan_drafts', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated_direct_draft_update_granted';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.ad_plan_drafts', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated_draft_read_missing';
  END IF;

  BEGIN
    INSERT INTO public.ad_plan_drafts (
      id, client_kind, owner_kind, created_by, current_step, draft_state
    ) VALUES (
      gen_random_uuid(), 'host', 'host', v_user, 'promote', '{}'::jsonb
    );
  EXCEPTION WHEN check_violation THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'host_draft_without_brand_accepted';
  END IF;
END;
$test$;

ROLLBACK;
