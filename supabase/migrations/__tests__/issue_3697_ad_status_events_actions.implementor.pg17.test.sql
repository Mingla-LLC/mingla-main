-- Issue #3697: every audited ad action is accepted by ad_status_events.
-- MINGLA-INVARIANT: I-3697-AD-AUDIT-ACTIONS-UNION | issue #3697 | ad_status_events_action_check accepts every action any edge or SQL writer records; a constraint rewrite may only widen it
--
-- Live failure (2026-10-20 02:01 UTC): admin-ad-creative-prepare returned 500
-- audit_write_failed because the v1.4 control-plane migration had redefined
-- this CHECK without the #1184 prepare_* and preview_* actions.
--
-- Proves, against the real schema after a full replay:
--   A1  each prepare_* and preview_* action inserts (creative_ref entity)
--   A2  each campaign lifecycle and stop/settlement action still inserts
--   A3  an unknown action is still refused with check_violation
--
-- FAILS ON REVERT: delete 20271121003697_issue_3697_ad_status_events_action_union.sql
-- and A1 raises check_violation on 'prepare_begin'.
BEGIN;

DO $test$
DECLARE
  v_action text;
  v_n integer;
BEGIN
  FOREACH v_action IN ARRAY ARRAY[
    'prepare_begin','prepare_begin_failed','prepare_ref_saved','prepare_check',
    'prepare_ready','prepare_failed','prepare_timeout',
    'preview_request','preview_ready','preview_failed'
  ] LOOP
    INSERT INTO public.ad_status_events (platform, entity, action, from_status, to_status)
    VALUES ('meta', 'creative_ref', v_action, 'pending', 'uploading');
  END LOOP;

  FOREACH v_action IN ARRAY ARRAY[
    'create','launch','pause','sync','create_failed','rollback',
    'stop_requested','stop_confirmed','settlement'
  ] LOOP
    INSERT INTO public.ad_status_events (platform, entity, action)
    VALUES ('meta', 'campaign', v_action);
  END LOOP;

  SELECT count(*) INTO v_n FROM public.ad_status_events
  WHERE platform = 'meta' AND action IN (
    'prepare_begin','prepare_begin_failed','prepare_ref_saved','prepare_check',
    'prepare_ready','prepare_failed','prepare_timeout',
    'preview_request','preview_ready','preview_failed',
    'create','launch','pause','sync','create_failed','rollback',
    'stop_requested','stop_confirmed','settlement'
  ) AND created_at = now();
  IF v_n <> 19 THEN
    RAISE EXCEPTION 'A1/A2: expected 19 audit rows, got %', v_n;
  END IF;

  BEGIN
    INSERT INTO public.ad_status_events (platform, entity, action)
    VALUES ('meta', 'campaign', 'not_an_action');
    RAISE EXCEPTION 'A3: an unknown action must be refused';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$test$;

ROLLBACK;

\echo 'issue_3697_ad_status_events_actions.implementor.pg17: PASS'
