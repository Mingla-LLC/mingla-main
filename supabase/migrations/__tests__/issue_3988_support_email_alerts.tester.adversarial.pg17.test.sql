-- #3988 Support email alerts, adversarial PostgreSQL 17 proof.
-- Angles the happy path does not take: off-team and revoked people in every
-- role, forged messages, self-alerts, closed work, direct calls by clients,
-- and payloads stuffed with private text.
-- Exercises I-3988-ALERT-RECIPIENTS-ARE-ON-TEAM and I-3988-ALERT-PAYLOAD-NO-BODY,
-- both declared in issue_3988_support_email_alerts.implementor.pg17.test.sql.
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

CREATE TEMP TABLE t3988b_people (
  who text PRIMARY KEY,
  id uuid NOT NULL,
  email text NOT NULL
) ON COMMIT DROP;

INSERT INTO t3988b_people VALUES
  ('owner',        '39880000-0000-4000-a400-000000000001', 'issue3988b-owner@test.local'),
  ('exowner',      '39880000-0000-4000-a400-000000000002', 'issue3988b-exowner@test.local'),
  ('lead',         '39880000-0000-4000-a400-000000000003', 'issue3988b-lead@test.local'),
  ('exlead',       '39880000-0000-4000-a400-000000000004', 'issue3988b-exlead@test.local'),
  ('offlead',      '39880000-0000-4000-a400-000000000005', 'issue3988b-offlead@test.local'),
  ('mate',         '39880000-0000-4000-a400-000000000006', 'issue3988b-mate@test.local'),
  ('ghost',        '39880000-0000-4000-a400-000000000007', 'issue3988b-ghost@test.local'),
  ('requester',    '39880000-0000-4000-a400-000000000008', 'issue3988b-requester@test.local'),
  ('stranger',     '39880000-0000-4000-a400-000000000009', 'issue3988b-stranger@test.local');

INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT id, email, now() FROM t3988b_people;

INSERT INTO public.admin_users (email, role, status, accepted_at) VALUES
  ('issue3988b-owner@test.local', 'owner', 'active', now()),
  ('issue3988b-exowner@test.local', 'owner', 'revoked', now());

INSERT INTO public.admin_team_members (email, role, status, accepted_at) VALUES
  ('issue3988b-lead@test.local', 'growth', 'active', now()),
  ('issue3988b-exlead@test.local', 'growth', 'revoked', now()),
  ('issue3988b-offlead@test.local', 'growth', 'active', now()),
  ('issue3988b-mate@test.local', 'growth', 'active', now()),
  ('issue3988b-ghost@test.local', 'growth', 'revoked', now());

UPDATE public.support_staff SET enabled = false, available = false
 WHERE user_id NOT IN (SELECT id FROM t3988b_people);

INSERT INTO public.support_staff (user_id, enabled, available, role) VALUES
  ('39880000-0000-4000-a400-000000000002', true, true,  'lead'),   -- revoked owner on the rota
  ('39880000-0000-4000-a400-000000000003', true, false, 'lead'),
  ('39880000-0000-4000-a400-000000000004', true, true,  'lead'),   -- off the team
  ('39880000-0000-4000-a400-000000000005', false, true, 'lead'),   -- switched off
  ('39880000-0000-4000-a400-000000000006', true, true,  'staff'),
  ('39880000-0000-4000-a400-000000000007', true, true,  'staff');  -- off the team, "available"

CREATE FUNCTION pg_temp.t3988b_id(p_who text) RETURNS uuid
LANGUAGE sql AS $$ SELECT id FROM t3988b_people WHERE who = p_who $$;

CREATE FUNCTION pg_temp.t3988b_as(p_who text, p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
  v_email text;
  v_answer text;
BEGIN
  SELECT id, email INTO STRICT v_id, v_email FROM t3988b_people WHERE who = p_who;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_id::text, true);
  PERFORM set_config('request.jwt.claim.email', v_email, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SELECT (' || p_sql || ')::text' INTO v_answer;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  RETURN COALESCE(v_answer, 'NULL');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  RETURN 'ERR:' || SQLSTATE || ':' || SQLERRM;
END;
$$;

CREATE FUNCTION pg_temp.t3988b_recipients(p_category text, p_key_like text) RETURNS text
LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(p.who, ',' ORDER BY p.who), '')
  FROM public.notification_outbox o
  JOIN t3988b_people p ON p.id = o.user_id
  WHERE o.category_key = p_category AND o.idempotency_key LIKE p_key_like;
$$;

-- ── A. Nobody off the team, revoked or switched off is ever a recipient ────
DO $people$
DECLARE v text;
BEGIN
  SELECT string_agg(p.who, ',' ORDER BY p.who) INTO v
  FROM public.issue_3988_support_roster() r JOIN t3988b_people p ON p.id = r.user_id;
  IF v IS DISTINCT FROM 'lead,mate' THEN RAISE EXCEPTION 'roster_admits_off_team:%', v; END IF;
  SELECT string_agg(p.who, ',' ORDER BY p.who) INTO v
  FROM public.issue_3988_support_leads() l JOIN t3988b_people p ON p.id = l;
  IF v IS DISTINCT FROM 'lead' THEN RAISE EXCEPTION 'leads_admit_off_team:%', v; END IF;
  SELECT string_agg(p.who, ',' ORDER BY p.who) INTO v
  FROM public.issue_3988_product_owners() o JOIN t3988b_people p ON p.id = o;
  IF v IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owners_admit_revoked:%', v; END IF;

  -- The single producer refuses an off-team person outright.
  IF public.issue_3988_enqueue_alert('admin.support_overdue', pg_temp.t3988b_id('ghost'),
       'adversarial:ghost', '{}'::jsonb)
     OR public.issue_3988_enqueue_alert('admin.support_overdue', pg_temp.t3988b_id('stranger'),
       'adversarial:stranger', '{}'::jsonb)
     OR public.issue_3988_enqueue_alert('admin.support_overdue', NULL, 'adversarial:null', '{}'::jsonb) THEN
    RAISE EXCEPTION 'enqueue_admits_off_team';
  END IF;
  IF EXISTS (SELECT 1 FROM public.notification_outbox WHERE idempotency_key LIKE 'adversarial:%') THEN
    RAISE EXCEPTION 'enqueue_wrote_off_team_row';
  END IF;
END;
$people$;

-- ── B. Host replies: forged messages, off-team assignee, sender = assignee ─
DO $reply$
DECLARE
  v text;
  v_ticket uuid;
  v_other uuid;
  v_conv uuid;
  v_other_conv uuid;
  v_msg uuid;
  v_foreign uuid;
  v_n integer;
BEGIN
  v_ticket := pg_temp.t3988b_as('requester', 'public.create_support_ticket(''Refund please'', NULL)')::uuid;
  v_other := pg_temp.t3988b_as('requester', 'public.create_support_ticket(''Another'', NULL)')::uuid;
  SELECT conversation_id INTO v_conv FROM public.support_tickets WHERE id = v_ticket;
  SELECT conversation_id INTO v_other_conv FROM public.support_tickets WHERE id = v_other;

  -- An off-team assignee is not alerted.
  UPDATE public.support_tickets SET assigned_staff_id = pg_temp.t3988b_id('ghost') WHERE id = v_ticket;
  INSERT INTO public.messages (conversation_id, sender_id, content, message_type)
  VALUES (v_conv, pg_temp.t3988b_id('requester'), 'card number 4242 and my address', 'text')
  RETURNING id INTO v_msg;
  INSERT INTO public.messages (conversation_id, sender_id, content, message_type)
  VALUES (v_other_conv, pg_temp.t3988b_id('requester'), 'other', 'text')
  RETURNING id INTO v_foreign;

  -- A message from another ticket, or claimed by someone else, is refused.
  BEGIN
    PERFORM public.issue_3988_enqueue_support_reply_alerts(v_ticket, v_foreign, pg_temp.t3988b_id('requester'));
    RAISE EXCEPTION 'foreign_message_accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.issue_3988_enqueue_support_reply_alerts(v_ticket, v_msg, pg_temp.t3988b_id('mate'));
    RAISE EXCEPTION 'spoofed_sender_accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.issue_3988_enqueue_support_reply_alerts(gen_random_uuid(), v_msg, pg_temp.t3988b_id('requester'));
    RAISE EXCEPTION 'missing_ticket_accepted';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;

  FOR i IN 1..3 LOOP
    v_n := public.issue_3988_enqueue_support_reply_alerts(v_ticket, v_msg, pg_temp.t3988b_id('requester'));
  END LOOP;
  v := pg_temp.t3988b_recipients('business.support_ticket_reply', '%:' || v_msg::text || ':%');
  IF v <> 'lead,mate' THEN RAISE EXCEPTION 'reply_reached_off_team:%', v; END IF;
  IF (SELECT count(*) FROM public.notification_outbox WHERE idempotency_key LIKE 'business.support_ticket_reply:' || v_msg::text || ':%') <> 2 THEN
    RAISE EXCEPTION 'reply_duplicated_on_retry';
  END IF;
  IF EXISTS (SELECT 1 FROM public.notification_outbox WHERE idempotency_key LIKE 'business.support_ticket_reply:' || v_msg::text || ':%'
       AND payload::text ~ '4242|address') THEN
    RAISE EXCEPTION 'reply_payload_carried_body';
  END IF;
  -- Away lead: no push. Available teammate: push.
  IF (SELECT string_agg(p.who || '=' || (o.payload->>'push'), ',' ORDER BY p.who)
      FROM public.notification_outbox o JOIN t3988b_people p ON p.id = o.user_id
      WHERE o.idempotency_key LIKE 'business.support_ticket_reply:' || v_msg::text || ':%') <> 'lead=false,mate=true' THEN
    RAISE EXCEPTION 'reply_push_ignores_availability';
  END IF;

  -- The assignee who is also the sender hears nothing about their own message.
  UPDATE public.support_tickets SET assigned_staff_id = pg_temp.t3988b_id('mate') WHERE id = v_other;
  INSERT INTO public.messages (conversation_id, sender_id, content, message_type)
  VALUES (v_other_conv, pg_temp.t3988b_id('mate'), 'staff note', 'text') RETURNING id INTO v_foreign;
  PERFORM public.issue_3988_enqueue_support_reply_alerts(v_other, v_foreign, pg_temp.t3988b_id('mate'));
  v := pg_temp.t3988b_recipients('business.support_ticket_reply', '%:' || v_foreign::text || ':%');
  IF v <> 'lead' THEN RAISE EXCEPTION 'assignee_sender_alerted:%', v; END IF;
END;
$reply$;

-- ── C. Staff tickets and signals: private text never travels, no self-alerts
DO $work$
DECLARE
  v text;
  v_thread uuid;
  v_signal uuid;
  v_item uuid;
BEGIN
  v_thread := pg_temp.t3988b_as('lead', $q$public.issue_3720_create_internal_thread(
    '39880000-0000-4000-c400-000000000001', 'Account takeover report', 'SECRET DETAILS phone 555-0100',
    NULL, NULL, NULL, 'urgent', now() + interval '1 hour', 'Escalate')$q$)::uuid;
  v := pg_temp.t3988b_recipients('admin.support_staff_ticket', '%:' || v_thread::text || ':%');
  IF v <> 'mate' THEN RAISE EXCEPTION 'staff_ticket_recipients:%', v; END IF;
  IF EXISTS (SELECT 1 FROM public.notification_outbox WHERE payload::text LIKE '%SECRET DETAILS%') THEN
    RAISE EXCEPTION 'staff_ticket_details_leaked';
  END IF;

  -- Assigning to yourself, to someone off the team, or to nobody alerts no one.
  PERFORM set_config('request.jwt.claim.sub', pg_temp.t3988b_id('mate')::text, true);
  UPDATE public.support_internal_threads SET assigned_staff_id = pg_temp.t3988b_id('mate'), revision = revision + 1 WHERE id = v_thread;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  UPDATE public.support_internal_threads SET assigned_staff_id = pg_temp.t3988b_id('ghost'), revision = revision + 1 WHERE id = v_thread;
  UPDATE public.support_internal_threads SET assigned_staff_id = NULL, revision = revision + 1 WHERE id = v_thread;
  IF EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key = 'admin.support_assigned'
       AND idempotency_key LIKE 'admin.support_assigned:' || v_thread::text || ':%') THEN
    RAISE EXCEPTION 'self_or_off_team_assignment_alerted';
  END IF;

  v_signal := pg_temp.t3988b_as('mate', format($q$public.issue_3720_create_product_signal(
    '39880000-0000-4000-c400-000000000002', 'internal_thread', %L::uuid, 'trust_safety',
    'Takeover pattern', 'SECRET PROBLEM STATEMENT', 'Accounts', 'SECRET JOURNEY',
    'SECRET IMPACT', 2, 'urgent', now() + interval '2 hours', 'SECRET NEXT STEP', 'SECRET CUSTOMER DRAFT')$q$, v_thread))::uuid;
  v := pg_temp.t3988b_recipients('admin.product_signal_new', '%:' || v_signal::text || ':%');
  IF v <> 'lead,owner' THEN RAISE EXCEPTION 'signal_recipients_admit_revoked:%', v; END IF;
  IF EXISTS (SELECT 1 FROM public.notification_outbox WHERE payload::text LIKE '%SECRET%') THEN
    RAISE EXCEPTION 'signal_private_text_leaked';
  END IF;

  -- Taking a signal yourself is not news to you; linking your own signal is not either.
  PERFORM set_config('request.jwt.claim.sub', pg_temp.t3988b_id('lead')::text, true);
  UPDATE public.support_product_signals SET owner_user_id = pg_temp.t3988b_id('lead'), revision = revision + 1 WHERE id = v_signal;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key = 'admin.product_signal_assigned'
       AND idempotency_key LIKE '%:' || v_signal::text || ':%') THEN
    RAISE EXCEPTION 'self_take_alerted';
  END IF;
  INSERT INTO public.product_avengers_items (issue_number, issue_node_id, project_item_id, issue_url, issue_title, issue_state, board_status)
  VALUES (39882, 'I_issue3988b', 'PVTI_issue3988b', 'https://github.com/Mingla-LLC/mingla-main/issues/39882', 'Takeover', 'OPEN', 'In Progress')
  RETURNING id INTO v_item;
  INSERT INTO public.product_signal_avengers_links (signal_id, item_id, link_kind, linked_by)
  VALUES (v_signal, v_item, 'existing', pg_temp.t3988b_id('mate'));
  UPDATE public.product_signal_avengers_links SET link_kind = 'created' WHERE signal_id = v_signal;
  IF EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key = 'admin.product_signal_progress'
       AND idempotency_key LIKE '%' || v_signal::text || '%') THEN
    RAISE EXCEPTION 'own_link_or_relabel_noted';
  END IF;

  PERFORM set_config('t3988b.thread', v_thread::text, true);
  PERFORM set_config('t3988b.signal', v_signal::text, true);
END;
$work$;

-- ── D. Overdue: closed work is quiet; an off-team owner still escalates ────
DO $overdue$
DECLARE
  v_thread uuid := current_setting('t3988b.thread')::uuid;
  v_signal uuid := current_setting('t3988b.signal')::uuid;
  v_far timestamptz := now() + interval '30 days';
BEGIN
  UPDATE public.support_internal_threads SET assigned_staff_id = pg_temp.t3988b_id('ghost') WHERE id = v_thread;
  UPDATE public.support_product_signals SET state = 'closed', revision = revision + 1 WHERE id = v_signal;
  PERFORM public.issue_3988_support_overdue_sweep(v_far);
  PERFORM public.issue_3988_support_overdue_sweep(v_far);

  IF EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key = 'admin.support_overdue'
       AND idempotency_key LIKE 'admin.support_overdue:product_signal:' || v_signal::text || ':%') THEN
    RAISE EXCEPTION 'closed_signal_reminded';
  END IF;
  IF EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key = 'admin.support_overdue'
       AND idempotency_key LIKE 'admin.support_overdue:internal_thread:' || v_thread::text || ':%:owner:%') THEN
    RAISE EXCEPTION 'off_team_owner_reminded';
  END IF;
  IF pg_temp.t3988b_recipients('admin.support_overdue', 'admin.support_overdue:internal_thread:' || v_thread::text || ':%:lead:%') <> 'lead' THEN
    RAISE EXCEPTION 'off_team_owner_not_escalated';
  END IF;

  UPDATE public.support_internal_threads SET status = 'resolved' WHERE id = v_thread;
  UPDATE public.support_internal_threads SET next_update_at = next_update_at + interval '1 day' WHERE id = v_thread;
  PERFORM public.issue_3988_support_overdue_sweep(v_far + interval '1 day');
  IF (SELECT count(*) FROM public.notification_outbox WHERE category_key = 'admin.support_overdue'
       AND idempotency_key LIKE 'admin.support_overdue:internal_thread:' || v_thread::text || ':%') <> 1 THEN
    RAISE EXCEPTION 'resolved_thread_reminded';
  END IF;
END;
$overdue$;

-- ── E. Clients cannot reach the producers; preferences are per person ──────
DO $clients$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'public.issue_3988_enqueue_alert(''admin.support_overdue'', ''39880000-0000-4000-a400-000000000003''::uuid, ''x'', ''{}''::jsonb)',
    'public.issue_3988_enqueue_support_reply_alerts(gen_random_uuid(), gen_random_uuid(), NULL)',
    'public.issue_3988_support_overdue_sweep(now())',
    '(SELECT count(*) FROM public.issue_3988_product_owners())',
    '(SELECT count(*) FROM public.issue_3988_support_leads())',
    'public.issue_3988_signal_progress_note(gen_random_uuid(), ''linked'', ''x'', NULL, NULL)'
  ] LOOP
    IF pg_temp.t3988b_as('mate', v) NOT LIKE 'ERR:42501:%' THEN
      RAISE EXCEPTION 'client_reached_producer:%', v;
    END IF;
  END LOOP;

  IF pg_temp.t3988b_as('ghost', 'public.issue_3988_my_email_alert_preferences()') NOT LIKE 'ERR:42501:%'
     OR pg_temp.t3988b_as('stranger', 'public.issue_3988_set_email_alert_preference(''admin.support_overdue'', false)') NOT LIKE 'ERR:42501:%' THEN
    RAISE EXCEPTION 'off_team_reached_preferences';
  END IF;
  IF pg_temp.t3988b_as('mate', 'public.issue_3988_set_email_alert_preference(''buyer_order_paid'', false)') NOT LIKE 'ERR:22023:%unknown_alert_category%'
     OR pg_temp.t3988b_as('mate', 'public.issue_3988_set_email_alert_preference(''admin.product_signal_progress'', false)') NOT LIKE 'ERR:22023:%'
     OR pg_temp.t3988b_as('mate', 'public.issue_3988_set_email_alert_preference(''admin.support_overdue'', NULL)') NOT LIKE 'ERR:22023:%' THEN
    RAISE EXCEPTION 'preference_accepts_bad_input';
  END IF;

  PERFORM pg_temp.t3988b_as('mate', 'public.issue_3988_set_email_alert_preference(''business.support_ticket_reply'', false)');
  IF EXISTS (SELECT 1 FROM public.notification_channel_prefs WHERE user_id <> pg_temp.t3988b_id('mate')
       AND category_key = 'business.support_ticket_reply' AND user_id IN (SELECT id FROM t3988b_people)) THEN
    RAISE EXCEPTION 'preference_written_for_someone_else';
  END IF;
  -- Opting out of email keeps the in-app alert and push; only email is denied.
  IF public.can_send(pg_temp.t3988b_id('mate'), 'business.support_ticket_reply', 'email', 'issue3988b-mate@test.local')
     OR public.can_send(pg_temp.t3988b_id('mate'), 'business.support_ticket_reply', 'push', NULL) IS NOT TRUE THEN
    RAISE EXCEPTION 'email_opt_out_scope_wrong';
  END IF;
  -- An unrelated category still reports its old denial code.
  IF public.issue_3720_notification_denial_reason(pg_temp.t3988b_id('mate'), 'buyer_order_paid', 'email', NULL) <> 'policy_denied' THEN
    RAISE EXCEPTION 'denial_reason_widened';
  END IF;
END;
$clients$;

ROLLBACK;
