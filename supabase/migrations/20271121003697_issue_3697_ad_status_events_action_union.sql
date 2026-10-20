-- Issue #3697 — restore every audited ad action on ad_status_events.
--
-- 20270111001184_issue_1184_video_prepare_lifecycle.sql added the video
-- preparation and preview audit actions. The v1.4 control plane
-- (20271101003697_issue_3697_v14_control_plane.sql) redefined the same CHECK
-- with only the campaign and stop/settlement actions, which silently dropped
-- them. Since then admin-ad-creative-prepare fails its first audit write
-- (`prepare_begin`) with 500 audit_write_failed, and admin-ad-preview cannot
-- record its preview_* events: no video can be prepared for any provider.
--
-- The constraint becomes the UNION of every action any edge function or SQL
-- function writes. It only widens what is accepted, so every existing row
-- remains valid and no writer changes.

BEGIN;

ALTER TABLE public.ad_status_events
  DROP CONSTRAINT IF EXISTS ad_status_events_action_check;
ALTER TABLE public.ad_status_events
  ADD CONSTRAINT ad_status_events_action_check CHECK (action IN (
    -- campaign lifecycle (#862, #3697 v1.4)
    'create','launch','pause','sync','create_failed','rollback',
    'stop_requested','stop_confirmed','settlement',
    -- provider-native video preparation (#1184, admin-ad-creative-prepare)
    'prepare_begin','prepare_begin_failed','prepare_ref_saved','prepare_check',
    'prepare_ready','prepare_failed','prepare_timeout',
    -- provider previews (#1184, admin-ad-preview)
    'preview_request','preview_ready','preview_failed'
  ));

COMMENT ON CONSTRAINT ad_status_events_action_check ON public.ad_status_events IS
  'Issue #3697: union of every audited ad action. Widen only; a writer whose action is missing here fails its audit write. Guarded by supabase/functions/_shared/__tests__/issue_3697_ad_status_events_actions.test.ts.';

-- Self-verify inside the transaction: the preparation action the live failure
-- needed is accepted, and an unknown action is still refused.
DO $verify$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
  FROM pg_constraint c
  WHERE c.conname = 'ad_status_events_action_check'
    AND c.conrelid = 'public.ad_status_events'::regclass;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'issue3697: ad_status_events_action_check missing';
  END IF;
  IF position('''prepare_begin''' IN v_def) = 0
     OR position('''preview_failed''' IN v_def) = 0
     OR position('''settlement''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue3697: ad_status_events_action_check is not the full union: %', v_def;
  END IF;
  IF position('''not_an_action''' IN v_def) > 0 THEN
    RAISE EXCEPTION 'issue3697: ad_status_events_action_check must stay closed';
  END IF;
END;
$verify$;

COMMIT;
