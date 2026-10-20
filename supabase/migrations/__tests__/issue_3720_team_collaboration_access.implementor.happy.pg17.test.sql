-- #3720 Completion Wave 6 — executable team collaboration happy path.
-- MINGLA-INVARIANT: I-3720-TEAM-ACTIVE-IDENTITY | issue #3720 | Collaboration capabilities are derived from an accepted, non-removed, named team record without widening full-admin authority.
-- [TEST-MOD-APPROVED #3988] Support is an explicit role: a teammate without an
-- enabled Support row is not Support staff (supersedes the all-roles rule).
-- MINGLA-INVARIANT: I-3720-MENTION-EMAIL-OPT-IN | issue #3720 | Team mentions are available in-app by default, while email is sent only after that recipient explicitly opts in.
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
  ('37200000-0000-4000-8000-000000000601','wave6-growth@test.local',now()),
  ('37200000-0000-4000-8000-000000000602','wave6-partner@test.local',now()),
  ('37200000-0000-4000-8000-000000000603','wave6-admin@test.local',now());
INSERT INTO public.admin_team_members(email,role,status,accepted_at) VALUES
  ('wave6-growth@test.local','growth','active',now()),
  ('wave6-partner@test.local','partner','active',now());
INSERT INTO public.admin_users(email,role,status) VALUES
  ('wave6-admin@test.local','admin','active');

DO $proof$
DECLARE
  v_growth constant uuid := '37200000-0000-4000-8000-000000000601';
  v_partner constant uuid := '37200000-0000-4000-8000-000000000602';
  v_admin constant uuid := '37200000-0000-4000-8000-000000000603';
  v_card uuid;
  v_result jsonb;
  v_mention uuid;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',v_growth::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  IF public.is_support_staff(v_growth) THEN RAISE EXCEPTION 'growth_without_support_role_passed_support_gate'; END IF;
  v_result := public.issue_3720_team_my_permissions();
  IF v_result #>> '{permissions,support_read_reply_assign}' <> 'true'
     OR v_result #>> '{permissions,support_money_or_account_changes}' <> 'false'
     OR v_result #>> '{permissions,data_room}' <> 'false'
     OR (v_result->'operational_areas') ? 'admin_console' THEN
    RAISE EXCEPTION 'growth_permission_matrix_invalid:%',v_result;
  END IF;
  IF public.can_send(v_growth,'admin.team_mention','email','wave6-growth@test.local') THEN
    RAISE EXCEPTION 'mention_email_was_default_on';
  END IF;
  IF NOT public.can_send(v_growth,'offering_invitation','email','wave6-growth@test.local') THEN
    RAISE EXCEPTION 'legacy_default_on_marketing_semantics_changed';
  END IF;
  RESET ROLE;
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  IF public.issue_3720_notification_denial_reason(
    v_growth,'admin.team_mention','email','wave6-growth@test.local'
  ) <> 'preference_off' THEN
    RAISE EXCEPTION 'mention_email_opt_in_reason_missing';
  END IF;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',v_growth::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM public.issue_3720_set_team_mention_email(true);
  IF NOT public.can_send(v_growth,'admin.team_mention','email','wave6-growth@test.local') THEN
    RAISE EXCEPTION 'mention_email_opt_in_ignored';
  END IF;
  v_result := public.content_calendar_create('Wave Six Mention Card','wave6create01');
  v_card := (v_result->'item'->>'id')::uuid;
  v_result := public.content_calendar_comment_add_with_mentions(
    v_card,'Partner, please review this plan.',ARRAY['wave6-partner@test.local'],'wave6comment01'
  );
  IF jsonb_array_length(v_result->'mention_ids') <> 1 THEN RAISE EXCEPTION 'mention_not_created:%',v_result; END IF;
  RESET ROLE;

  SELECT id INTO v_mention FROM public.team_mentions
  WHERE target_user_id=v_partner AND source_kind='content_calendar_comment';
  IF v_mention IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.notification_outbox
    WHERE category_key='admin.team_mention' AND user_id=v_partner
      AND idempotency_key='admin.team_mention:'||v_mention::text
      AND country_code IS NULL
  ) THEN RAISE EXCEPTION 'mention_outbox_missing'; END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',v_partner::text,true);
  v_result := public.issue_3720_team_my_permissions();
  IF v_result #>> '{permissions,data_room}' <> 'true'
     OR v_result #>> '{permissions,data_room_audit}' <> 'false' THEN
    RAISE EXCEPTION 'partner_data_room_matrix_invalid:%',v_result;
  END IF;
  v_result := public.issue_3720_list_team_mentions(50,NULL);
  IF v_result->>'unread' <> '1' OR jsonb_array_length(v_result->'mentions') <> 1 THEN
    RAISE EXCEPTION 'partner_mention_missing:%',v_result;
  END IF;
  IF NOT public.issue_3720_mark_team_mention_read(v_mention) THEN RAISE EXCEPTION 'mention_not_marked_read'; END IF;
  RESET ROLE;

  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM public.issue_3720_log_data_room_access(v_partner,'room_open',NULL,true);
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  v_result := public.issue_3720_list_data_room_access(10);
  IF jsonb_array_length(v_result) <> 1 OR v_result #>> '{0,role}' <> 'partner' THEN
    RAISE EXCEPTION 'data_room_audit_missing:%',v_result;
  END IF;
  RESET ROLE;
END;
$proof$;
ROLLBACK;
