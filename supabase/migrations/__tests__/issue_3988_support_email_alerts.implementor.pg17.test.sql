-- #3988 Support email alerts, executable PostgreSQL 17 proof (implementor happy path).
-- MINGLA-INVARIANT: I-3988-ALERT-RECIPIENTS-ARE-ON-TEAM | issue #3988 | Every support and product alert is enqueued only for a current Mingla teammate; a support_staff row on someone off the team never receives one.
-- MINGLA-INVARIANT: I-3988-ALERT-ONCE-PER-EVENT | issue #3988 | Each alert has one idempotency key per event and recipient, so a repeated call or sweep never sends a second copy.
-- MINGLA-INVARIANT: I-3988-ALERT-PAYLOAD-NO-BODY | issue #3988 | Support and product alert payloads carry IDs, subject or title, priority and a link only, never a message body or problem statement.
-- Runs after the complete migration replay and rolls every fixture back.
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

CREATE TEMP TABLE t3988a_people (
  who text PRIMARY KEY,
  id uuid NOT NULL,
  email text NOT NULL
) ON COMMIT DROP;

INSERT INTO t3988a_people VALUES
  ('owner',     '39880000-0000-4000-a300-000000000001', 'issue3988a-owner@test.local'),
  ('admin',     '39880000-0000-4000-a300-000000000002', 'issue3988a-admin@test.local'),
  ('lead',      '39880000-0000-4000-a300-000000000003', 'issue3988a-lead@test.local'),
  ('lead2',     '39880000-0000-4000-a300-000000000004', 'issue3988a-lead2@test.local'),
  ('avail',     '39880000-0000-4000-a300-000000000005', 'issue3988a-avail@test.local'),
  ('away',      '39880000-0000-4000-a300-000000000006', 'issue3988a-away@test.local'),
  ('offteam',   '39880000-0000-4000-a300-000000000007', 'issue3988a-offteam@test.local'),
  ('disabled',  '39880000-0000-4000-a300-000000000008', 'issue3988a-disabled@test.local'),
  ('requester', '39880000-0000-4000-a300-000000000009', 'issue3988a-requester@test.local');

INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT id, email, now() FROM t3988a_people;

INSERT INTO public.admin_users (email, role, status, accepted_at) VALUES
  ('issue3988a-owner@test.local', 'owner', 'active', now()),
  ('issue3988a-admin@test.local', 'admin', 'active', now());

INSERT INTO public.admin_team_members (email, role, status, accepted_at) VALUES
  ('issue3988a-lead@test.local', 'growth', 'active', now()),
  ('issue3988a-lead2@test.local', 'growth', 'active', now()),
  ('issue3988a-avail@test.local', 'growth', 'active', now()),
  ('issue3988a-away@test.local', 'growth', 'active', now()),
  ('issue3988a-offteam@test.local', 'growth', 'revoked', now()),
  ('issue3988a-disabled@test.local', 'growth', 'active', now());

-- Earlier suites may leave rows behind; this proof owns the roster.
UPDATE public.support_staff SET enabled = false, available = false
 WHERE user_id NOT IN (SELECT id FROM t3988a_people);

-- The owner and the admin are NOT on the rota (Owners/Admins stay off unless they opt in).
INSERT INTO public.support_staff (user_id, enabled, available, role) VALUES
  ('39880000-0000-4000-a300-000000000003', true, false, 'lead'),
  ('39880000-0000-4000-a300-000000000004', true, false, 'lead'),
  ('39880000-0000-4000-a300-000000000005', true, true,  'staff'),
  ('39880000-0000-4000-a300-000000000006', true, false, 'staff'),
  ('39880000-0000-4000-a300-000000000007', true, true,  'staff'),
  ('39880000-0000-4000-a300-000000000008', false, false, 'staff');

CREATE FUNCTION pg_temp.t3988a_id(p_who text) RETURNS uuid
LANGUAGE sql AS $$ SELECT id FROM t3988a_people WHERE who = p_who $$;

-- Run one SQL expression as a persona; returns its text value or ERR:<code>:<message>.
CREATE FUNCTION pg_temp.t3988a_as(p_who text, p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
  v_email text;
  v_answer text;
BEGIN
  SELECT id, email INTO STRICT v_id, v_email FROM t3988a_people WHERE who = p_who;
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

-- Recipients of one alert event, as a sorted list of persona names.
CREATE FUNCTION pg_temp.t3988a_recipients(p_category text, p_key_like text) RETURNS text
LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(p.who, ',' ORDER BY p.who), '')
  FROM public.notification_outbox o
  JOIN t3988a_people p ON p.id = o.user_id
  WHERE o.category_key = p_category AND o.idempotency_key LIKE p_key_like;
$$;

CREATE FUNCTION pg_temp.t3988a_count(p_category text, p_key_like text) RETURNS integer
LANGUAGE sql AS $$
  SELECT count(*)::integer FROM public.notification_outbox o
  WHERE o.category_key = p_category AND o.idempotency_key LIKE p_key_like;
$$;

-- ── 1. Roster helpers ──────────────────────────────────────────────────────
DO $roster$
DECLARE v text;
BEGIN
  SELECT string_agg(p.who, ',' ORDER BY p.who) INTO v
  FROM public.issue_3988_support_roster() r JOIN t3988a_people p ON p.id = r.user_id;
  IF v IS DISTINCT FROM 'avail,away,lead,lead2' THEN RAISE EXCEPTION 'roster_wrong:%', v; END IF;

  SELECT string_agg(p.who, ',' ORDER BY p.who) INTO v
  FROM public.issue_3988_support_leads() l JOIN t3988a_people p ON p.id = l;
  IF v IS DISTINCT FROM 'lead,lead2' THEN RAISE EXCEPTION 'leads_wrong:%', v; END IF;

  SELECT string_agg(p.who, ',' ORDER BY p.who) INTO v
  FROM public.issue_3988_product_owners() o JOIN t3988a_people p ON p.id = o;
  IF v IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owners_wrong:%', v; END IF;
END;
$roster$;

-- ── 2. Host reply on a ticket ──────────────────────────────────────────────
DO $reply$
DECLARE
  v_ticket uuid;
  v_conv uuid;
  v_msg uuid;
  v_msg2 uuid;
  v_n integer;
  v text;
BEGIN
  v := pg_temp.t3988a_as('requester', 'public.create_support_ticket(''Payout question'', NULL)');
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'ticket_create_failed:%', v; END IF;
  v_ticket := v::uuid;
  -- The Admin (not on the rota) is the assignee.
  UPDATE public.support_tickets SET assigned_staff_id = pg_temp.t3988a_id('admin'), priority = 'high'
   WHERE id = v_ticket RETURNING conversation_id INTO v_conv;

  INSERT INTO public.messages (conversation_id, sender_id, content, message_type)
  VALUES (v_conv, pg_temp.t3988a_id('requester'), 'PRIVATE HOST MESSAGE BODY', 'text')
  RETURNING id INTO v_msg;

  v_n := public.issue_3988_enqueue_support_reply_alerts(v_ticket, v_msg, pg_temp.t3988a_id('requester'));
  IF v_n <> 5 THEN RAISE EXCEPTION 'reply_alert_count:%', v_n; END IF;

  v := pg_temp.t3988a_recipients('business.support_ticket_reply', '%:' || v_msg::text || ':%');
  IF v <> 'admin,avail,away,lead,lead2' THEN RAISE EXCEPTION 'reply_recipients:%', v; END IF;

  -- Push only for the available roster and the assignee.
  SELECT string_agg(p.who, ',' ORDER BY p.who) INTO v
  FROM public.notification_outbox o JOIN t3988a_people p ON p.id = o.user_id
  WHERE o.category_key = 'business.support_ticket_reply'
    AND o.idempotency_key LIKE '%:' || v_msg::text || ':%'
    AND (o.payload->>'push')::boolean;
  IF v <> 'admin,avail' THEN RAISE EXCEPTION 'reply_push_recipients:%', v; END IF;

  -- Payload: IDs, subject, priority, links only.
  IF EXISTS (
    SELECT 1 FROM public.notification_outbox o
    WHERE o.category_key = 'business.support_ticket_reply'
      AND o.idempotency_key LIKE '%:' || v_msg::text || ':%'
      AND (o.payload::text LIKE '%PRIVATE HOST MESSAGE BODY%'
        OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(o.payload) k)
           <> ARRAY['admin_link','deep_link','message_id','priority','push','subject','ticket_id'])
  ) THEN
    RAISE EXCEPTION 'reply_payload_not_bounded';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.notification_outbox o
    WHERE o.category_key = 'business.support_ticket_reply'
      AND o.payload->>'deep_link' = 'mingla-business://support/' || v_ticket::text
      AND o.payload->>'admin_link' = 'https://admin.usemingla.com/#/community-support?tab=support&ticket=' || v_ticket::text
      AND o.payload->>'priority' = 'high'
  ) THEN
    RAISE EXCEPTION 'reply_payload_links_wrong';
  END IF;

  -- #1529: no SMS channel, so every row carries an explicit NULL country and no address.
  IF EXISTS (SELECT 1 FROM public.notification_outbox o
     WHERE o.category_key LIKE ANY (ARRAY['business.support_ticket_reply', 'admin.%'])
       AND o.idempotency_key LIKE '%:' || v_msg::text || ':%'
       AND (o.country_code IS NOT NULL OR o.contact IS NOT NULL)) THEN
    RAISE EXCEPTION 'alert_row_carries_country_or_contact';
  END IF;

  -- Double call: nothing new.
  v_n := public.issue_3988_enqueue_support_reply_alerts(v_ticket, v_msg, pg_temp.t3988a_id('requester'));
  IF v_n <> 0 OR pg_temp.t3988a_count('business.support_ticket_reply', '%:' || v_msg::text || ':%') <> 5 THEN
    RAISE EXCEPTION 'reply_not_idempotent:%', v_n;
  END IF;

  -- A second message is a new event; a roster member who sent it is excluded.
  INSERT INTO public.messages (conversation_id, sender_id, content, message_type)
  VALUES (v_conv, pg_temp.t3988a_id('away'), 'second', 'text') RETURNING id INTO v_msg2;
  PERFORM public.issue_3988_enqueue_support_reply_alerts(v_ticket, v_msg2, pg_temp.t3988a_id('away'));
  v := pg_temp.t3988a_recipients('business.support_ticket_reply', '%:' || v_msg2::text || ':%');
  IF v <> 'admin,avail,lead,lead2' THEN RAISE EXCEPTION 'reply_sender_not_excluded:%', v; END IF;
END;
$reply$;

-- ── 3. Staff ticket created and reassigned ─────────────────────────────────
DO $staff$
DECLARE
  v text;
  v_thread uuid;
  v_payload jsonb;
BEGIN
  v := pg_temp.t3988a_as('avail', $q$public.issue_3720_create_internal_thread(
    '39880000-0000-4000-c300-000000000001', 'Brand page broken', 'PRIVATE STAFF DETAILS',
    NULL, NULL, NULL, 'urgent', now() + interval '2 hours', 'Will check the logs')$q$);
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'thread_create_failed:%', v; END IF;
  v_thread := v::uuid;
  PERFORM set_config('t3988a.thread', v_thread::text, true);

  v := pg_temp.t3988a_recipients('admin.support_staff_ticket', '%:' || v_thread::text || ':%');
  IF v <> 'away,lead,lead2' THEN RAISE EXCEPTION 'staff_ticket_recipients:%', v; END IF;

  SELECT payload INTO v_payload FROM public.notification_outbox
   WHERE category_key = 'admin.support_staff_ticket' AND idempotency_key LIKE '%:' || v_thread::text || ':%' LIMIT 1;
  IF v_payload <> jsonb_build_object(
       'thread_id', v_thread, 'subject', 'Brand page broken', 'priority', 'urgent',
       'deep_link', 'https://admin.usemingla.com/#/community-support?tab=support&thread=' || v_thread::text) THEN
    RAISE EXCEPTION 'staff_ticket_payload:%', v_payload;
  END IF;

  -- Reassign to a lead: the lead hears about it once.
  UPDATE public.support_internal_threads
     SET assigned_staff_id = pg_temp.t3988a_id('lead'), revision = revision + 1
   WHERE id = v_thread;
  v := pg_temp.t3988a_recipients('admin.support_assigned', 'admin.support_assigned:' || v_thread::text || ':%');
  IF v <> 'lead' THEN RAISE EXCEPTION 'assigned_recipients:%', v; END IF;

  -- Saving the same assignee again is not a new assignment.
  UPDATE public.support_internal_threads
     SET assigned_staff_id = pg_temp.t3988a_id('lead'), revision = revision + 1
   WHERE id = v_thread;
  IF pg_temp.t3988a_count('admin.support_assigned', 'admin.support_assigned:' || v_thread::text || ':%') <> 1 THEN
    RAISE EXCEPTION 'same_assignee_alerted_again';
  END IF;
END;
$staff$;

-- ── 4. Product signals ─────────────────────────────────────────────────────
DO $signal$
DECLARE
  v text;
  v_thread uuid := current_setting('t3988a.thread')::uuid;
  v_thread2 uuid;
  v_signal uuid;
  v_signal2 uuid;
  v_item uuid;
BEGIN
  v := pg_temp.t3988a_as('avail', format($q$public.issue_3720_create_product_signal(
    '39880000-0000-4000-c300-000000000002', 'internal_thread', %L::uuid, 'bug',
    'Brand page shows blank', 'PRIVATE PROBLEM STATEMENT', 'Brand pages', 'Open brand page',
    'Hosts cannot share', 3, 'high', now() + interval '3 hours', 'Reproduce', 'We are on it')$q$, v_thread));
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'signal_create_failed:%', v; END IF;
  v_signal := v::uuid;
  PERFORM set_config('t3988a.signal', v_signal::text, true);

  v := pg_temp.t3988a_recipients('admin.product_signal_new', '%:' || v_signal::text || ':%');
  IF v <> 'lead,lead2,owner' THEN RAISE EXCEPTION 'signal_new_recipients:%', v; END IF;
  IF EXISTS (
    SELECT 1 FROM public.notification_outbox
    WHERE category_key = 'admin.product_signal_new' AND idempotency_key LIKE '%:' || v_signal::text || ':%'
      AND ((payload->>'push')::boolean IS NOT TRUE OR payload::text LIKE '%PRIVATE PROBLEM STATEMENT%')
  ) THEN
    RAISE EXCEPTION 'high_signal_payload_wrong';
  END IF;

  -- A normal-priority signal raised by a lead: no push, the lead is excluded.
  v := pg_temp.t3988a_as('lead', $q$public.issue_3720_create_internal_thread(
    '39880000-0000-4000-c300-000000000003', 'Feature ask', 'details',
    NULL, NULL, NULL, 'normal', now() + interval '2 hours', 'Triage')$q$);
  v_thread2 := v::uuid;
  v := pg_temp.t3988a_as('lead', format($q$public.issue_3720_create_product_signal(
    '39880000-0000-4000-c300-000000000004', 'internal_thread', %L::uuid, 'feature',
    'Bulk export', 'problem', 'Exports', 'Export guests', 'Saves time', 1, 'normal',
    now() + interval '3 hours', 'Size it', 'Thanks')$q$, v_thread2));
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'signal2_create_failed:%', v; END IF;
  v_signal2 := v::uuid;
  v := pg_temp.t3988a_recipients('admin.product_signal_new', '%:' || v_signal2::text || ':%');
  IF v <> 'lead2,owner' THEN RAISE EXCEPTION 'signal2_recipients:%', v; END IF;
  IF EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key = 'admin.product_signal_new'
     AND idempotency_key LIKE '%:' || v_signal2::text || ':%' AND (payload->>'push')::boolean) THEN
    RAISE EXCEPTION 'normal_signal_pushed';
  END IF;

  -- Owner changed: the new owner hears about it.
  UPDATE public.support_product_signals SET owner_user_id = pg_temp.t3988a_id('away'), revision = revision + 1
   WHERE id = v_signal;
  v := pg_temp.t3988a_recipients('admin.product_signal_assigned', '%:' || v_signal::text || ':%');
  IF v <> 'away' THEN RAISE EXCEPTION 'signal_assigned_recipients:%', v; END IF;

  -- Linked to GitHub by a lead: whoever raised it gets an in-app note.
  INSERT INTO public.product_avengers_items (issue_number, issue_node_id, project_item_id, issue_url, issue_title, issue_state, board_status)
  VALUES (39881, 'I_issue3988a', 'PVTI_issue3988a', 'https://github.com/Mingla-LLC/mingla-main/issues/39881', 'Blank brand page', 'OPEN', 'Done')
  RETURNING id INTO v_item;
  INSERT INTO public.product_signal_avengers_links (signal_id, item_id, link_kind, linked_by)
  VALUES (v_signal, v_item, 'existing', pg_temp.t3988a_id('lead'));
  v := pg_temp.t3988a_recipients('admin.product_signal_progress', 'admin.product_signal_progress:linked:' || v_signal::text || ':%');
  IF v <> 'avail' THEN RAISE EXCEPTION 'linked_note_recipients:%', v; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key = 'admin.product_signal_progress'
     AND payload->>'event' = 'linked' AND (payload->>'issue_number')::int = 39881) THEN
    RAISE EXCEPTION 'linked_note_payload_wrong';
  END IF;

  -- Released, then release verified: one note.
  UPDATE public.support_product_signals SET state = 'released', revision = revision + 1 WHERE id = v_signal;
  UPDATE public.product_avengers_items SET release_verified_at = now(), release_verified_by = pg_temp.t3988a_id('owner')
   WHERE id = v_item;
  IF pg_temp.t3988a_count('admin.product_signal_progress', 'admin.product_signal_progress:released:' || v_signal::text || ':%') <> 1 THEN
    RAISE EXCEPTION 'released_note_not_once';
  END IF;
END;
$signal$;

-- ── 5. Overdue sweep ───────────────────────────────────────────────────────
DO $overdue$
DECLARE
  v_thread uuid := current_setting('t3988a.thread')::uuid;
  v_due timestamptz;
  v text;
BEGIN
  SELECT next_update_at INTO v_due FROM public.support_internal_threads WHERE id = v_thread;

  -- Not yet due: nothing.
  PERFORM public.issue_3988_support_overdue_sweep(v_due - interval '1 minute');
  IF pg_temp.t3988a_count('admin.support_overdue', 'admin.support_overdue:internal_thread:' || v_thread::text || ':%') <> 0 THEN
    RAISE EXCEPTION 'overdue_fired_early';
  END IF;

  -- Due: the assignee (lead) once, however often the sweep runs.
  PERFORM public.issue_3988_support_overdue_sweep(v_due + interval '1 minute');
  PERFORM public.issue_3988_support_overdue_sweep(v_due + interval '16 minutes');
  v := pg_temp.t3988a_recipients('admin.support_overdue', 'admin.support_overdue:internal_thread:' || v_thread::text || ':%');
  IF v <> 'lead' THEN RAISE EXCEPTION 'overdue_owner_recipients:%', v; END IF;

  -- 24h later: the other Support leads once (the owner is not told twice).
  PERFORM public.issue_3988_support_overdue_sweep(v_due + interval '25 hours');
  PERFORM public.issue_3988_support_overdue_sweep(v_due + interval '26 hours');
  v := pg_temp.t3988a_recipients('admin.support_overdue', 'admin.support_overdue:internal_thread:' || v_thread::text || ':%:lead:%');
  IF v <> 'lead2' THEN RAISE EXCEPTION 'overdue_lead_recipients:%', v; END IF;
  IF pg_temp.t3988a_count('admin.support_overdue', 'admin.support_overdue:internal_thread:' || v_thread::text || ':%') <> 2 THEN
    RAISE EXCEPTION 'overdue_not_once_per_deadline';
  END IF;

  -- A new deadline is a new reminder.
  UPDATE public.support_internal_threads SET next_update_at = v_due + interval '30 hours' WHERE id = v_thread;
  PERFORM public.issue_3988_support_overdue_sweep(v_due + interval '31 hours');
  IF pg_temp.t3988a_count('admin.support_overdue', 'admin.support_overdue:internal_thread:' || v_thread::text || ':%:owner:%') <> 2 THEN
    RAISE EXCEPTION 'new_deadline_not_reminded';
  END IF;
END;
$overdue$;

-- ── 6. Preferences: default on, opt-out, mentions stay opt-in ──────────────
DO $prefs$
DECLARE v text;
BEGIN
  v := pg_temp.t3988a_as('away', $q$(SELECT string_agg((e->>'category_key') || '=' || (e->>'email_enabled'), ',')
    FROM jsonb_array_elements(public.issue_3988_my_email_alert_preferences()) e)$q$);
  IF v <> 'business.support_new_ticket=true,business.support_ticket_reply=true,admin.support_staff_ticket=true,admin.support_assigned=true,admin.support_overdue=true,admin.product_signal_new=true,admin.product_signal_assigned=true,admin.team_mention=false' THEN
    RAISE EXCEPTION 'default_preferences_wrong:%', v;
  END IF;

  IF public.can_send(pg_temp.t3988a_id('away'), 'admin.support_overdue', 'email', 'issue3988a-away@test.local') IS NOT TRUE THEN
    RAISE EXCEPTION 'default_email_not_on';
  END IF;

  v := pg_temp.t3988a_as('away', $q$(SELECT e->>'email_enabled' FROM jsonb_array_elements(
    public.issue_3988_set_email_alert_preference('admin.support_overdue', false)) e
    WHERE e->>'category_key' = 'admin.support_overdue')$q$);
  IF v <> 'false' THEN RAISE EXCEPTION 'opt_out_not_saved:%', v; END IF;
  IF public.can_send(pg_temp.t3988a_id('away'), 'admin.support_overdue', 'email', 'issue3988a-away@test.local') THEN
    RAISE EXCEPTION 'opt_out_not_honoured';
  END IF;
  IF public.issue_3720_notification_denial_reason(pg_temp.t3988a_id('away'), 'admin.support_overdue', 'email', NULL) <> 'preference_off' THEN
    RAISE EXCEPTION 'opt_out_reason_wrong';
  END IF;
  -- Other categories and other people are untouched.
  IF public.can_send(pg_temp.t3988a_id('away'), 'business.support_ticket_reply', 'email', 'issue3988a-away@test.local') IS NOT TRUE
     OR public.can_send(pg_temp.t3988a_id('lead'), 'admin.support_overdue', 'email', 'issue3988a-lead@test.local') IS NOT TRUE THEN
    RAISE EXCEPTION 'opt_out_leaked';
  END IF;

  -- Mentions: still opt-in, and the toggle turns them on.
  IF public.can_send(pg_temp.t3988a_id('away'), 'admin.team_mention', 'email', 'issue3988a-away@test.local') THEN
    RAISE EXCEPTION 'mention_email_default_on';
  END IF;
  PERFORM pg_temp.t3988a_as('away', $q$public.issue_3988_set_email_alert_preference('admin.team_mention', true)$q$);
  IF public.can_send(pg_temp.t3988a_id('away'), 'admin.team_mention', 'email', 'issue3988a-away@test.local') IS NOT TRUE THEN
    RAISE EXCEPTION 'mention_opt_in_not_honoured';
  END IF;
END;
$prefs$;

-- ── 7. Helpers are service-role only ───────────────────────────────────────
DO $acl$
DECLARE v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.issue_3988_support_roster()',
    'public.issue_3988_support_leads()',
    'public.issue_3988_product_owners()',
    'public.issue_3988_enqueue_alert(text,uuid,text,jsonb)',
    'public.issue_3988_enqueue_support_reply_alerts(uuid,uuid,uuid)',
    'public.issue_3988_support_overdue_sweep(timestamptz)'
  ] LOOP
    IF has_function_privilege('authenticated', v_sig, 'EXECUTE') OR has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'helper_executable_by_client:%', v_sig;
    END IF;
    IF NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'helper_not_service_role:%', v_sig;
    END IF;
  END LOOP;
  IF pg_temp.t3988a_as('lead', '(SELECT count(*) FROM public.issue_3988_support_roster())') NOT LIKE 'ERR:42501:%' THEN
    RAISE EXCEPTION 'authenticated_called_roster';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'issue_3988_support_overdue_sweep' AND schedule = '*/15 * * * *') THEN
    RAISE EXCEPTION 'overdue_cron_not_scheduled';
  END IF;
END;
$acl$;

ROLLBACK;
