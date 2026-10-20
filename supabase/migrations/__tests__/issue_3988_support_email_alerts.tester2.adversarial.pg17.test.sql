-- #3988 Support email alerts, second tester adversarial PostgreSQL 17 proof.
-- Written by the independent tester, attacking angles the implementor's two
-- suites do not take:
--   A. payload keys are an exact allowlist per category (no body, details,
--      problem statement, next step, journey, impact or reply draft key ever)
--   B. hostile subject/title text is stored as data, never as SQL, and never
--      reaches an idempotency key
--   C. a creator who is the only roster member produces zero rows, no error
--   D. a lead who is also the item's owner gets ONE overdue email, not two
--   E. a deadline moved later or earlier is reminded exactly once per value
--   F. resolved/closed threads and released/closed signals with long-past
--      deadlines stay quiet on their first ever sweep
--   G. a teammate removed between the owner reminder and the 24h escalation
--      gets nothing more, and a removed lead is not escalated to
--   H. bulk/backfill writes that do not change an assignee, owner or state
--      enqueue nothing (no alert storm from maintenance updates)
--   I. preferences: toggling email off after enqueue denies email at send
--      time only for that person and category; mentions stay opt-in; the
--      category key is matched exactly; nobody can write another person's
--      preference row, through the RPC or the table
--   J. exactly one overdue cron job, on the 15-minute schedule
-- MINGLA-INVARIANT: I-3988-MAINTENANCE-WRITES-ENQUEUE-NOTHING | issue #3988 | A write that leaves an assignee, signal owner, state or release verification unchanged enqueues no alert, and a lead who owns an overdue item receives one overdue alert per deadline, never an owner copy plus a lead copy.
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

CREATE TEMP TABLE t3988c_people (
  who text PRIMARY KEY,
  id uuid NOT NULL,
  email text NOT NULL
) ON COMMIT DROP;

INSERT INTO t3988c_people VALUES
  ('owner',  '39880000-0000-4000-b500-000000000001', 'issue3988c-owner@test.local'),
  ('lead1',  '39880000-0000-4000-b500-000000000002', 'issue3988c-lead1@test.local'),
  ('lead2',  '39880000-0000-4000-b500-000000000003', 'issue3988c-lead2@test.local'),
  ('mate',   '39880000-0000-4000-b500-000000000004', 'issue3988c-mate@test.local'),
  ('mate2',  '39880000-0000-4000-b500-000000000005', 'issue3988c-mate2@test.local'),
  ('outside','39880000-0000-4000-b500-000000000006', 'issue3988c-outside@test.local');

INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT id, email, now() FROM t3988c_people;

INSERT INTO public.admin_users (email, role, status, accepted_at) VALUES
  ('issue3988c-owner@test.local', 'owner', 'active', now());

INSERT INTO public.admin_team_members (email, role, status, accepted_at) VALUES
  ('issue3988c-lead1@test.local', 'growth', 'active', now()),
  ('issue3988c-lead2@test.local', 'growth', 'active', now()),
  ('issue3988c-mate@test.local',  'growth', 'active', now()),
  ('issue3988c-mate2@test.local', 'growth', 'active', now());

-- This proof owns the roster and the product-owner list for its lifetime.
UPDATE public.support_staff SET enabled = false, available = false
 WHERE user_id NOT IN (SELECT id FROM t3988c_people);
UPDATE public.admin_users SET status = 'revoked'
 WHERE role = 'owner' AND email <> 'issue3988c-owner@test.local';

INSERT INTO public.support_staff (user_id, enabled, available, role) VALUES
  ('39880000-0000-4000-b500-000000000002', true, true,  'lead'),
  ('39880000-0000-4000-b500-000000000003', true, false, 'lead'),
  ('39880000-0000-4000-b500-000000000004', true, true,  'staff'),
  ('39880000-0000-4000-b500-000000000005', true, true,  'staff');

CREATE FUNCTION pg_temp.t3988c_id(p_who text) RETURNS uuid
LANGUAGE sql AS $$ SELECT id FROM t3988c_people WHERE who = p_who $$;

-- Run one SQL expression as a signed-in persona; returns text or ERR:<state>.
CREATE FUNCTION pg_temp.t3988c_as(p_who text, p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
  v_email text;
  v_answer text;
BEGIN
  SELECT id, email INTO STRICT v_id, v_email FROM t3988c_people WHERE who = p_who;
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

-- Run one DML statement as a signed-in persona; returns rows affected or ERR:<state>.
CREATE FUNCTION pg_temp.t3988c_exec(p_who text, p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
  v_n integer;
BEGIN
  SELECT id INTO STRICT v_id FROM t3988c_people WHERE who = p_who;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE p_sql;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  RETURN v_n::text;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  RETURN 'ERR:' || SQLSTATE || ':' || SQLERRM;
END;
$$;

-- Service-role style direct writes (the trigger path every writer shares).
CREATE FUNCTION pg_temp.t3988c_thread(p_creator text, p_subject text, p_status text DEFAULT 'open')
RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.support_internal_threads (
    client_request_id, subject, details, status, priority, next_update_at,
    next_update_note, created_by
  ) VALUES (
    gen_random_uuid(), p_subject, 'SECRET THREAD DETAILS 555-0199', p_status, 'high',
    now() + interval '1 hour', 'SECRET NOTE', pg_temp.t3988c_id(p_creator)
  ) RETURNING id
$$;

CREATE FUNCTION pg_temp.t3988c_signal(p_creator text, p_title text, p_state text DEFAULT 'needs_review')
RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.support_product_signals (
    client_request_id, signal_kind, state, title, problem_statement, product_area,
    user_journey, impact_summary, priority, next_update_at, next_step,
    customer_reply_draft, created_by, owner_user_id
  ) VALUES (
    gen_random_uuid(), 'bug', p_state, p_title, 'SECRET PROBLEM', 'SECRET AREA',
    'SECRET JOURNEY', 'SECRET IMPACT', 'urgent', now() + interval '1 hour',
    'SECRET NEXT STEP', 'SECRET DRAFT', pg_temp.t3988c_id(p_creator), pg_temp.t3988c_id(p_creator)
  ) RETURNING id
$$;

CREATE FUNCTION pg_temp.t3988c_rows(p_key_like text) RETURNS text
LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(p.who || '/' || COALESCE(o.payload->>'audience', '-'), ',' ORDER BY p.who, o.payload->>'audience'), '')
  FROM public.notification_outbox o
  JOIN t3988c_people p ON p.id = o.user_id
  WHERE o.idempotency_key LIKE p_key_like;
$$;

CREATE FUNCTION pg_temp.t3988c_count(p_key_like text) RETURNS integer
LANGUAGE sql AS $$
  SELECT count(*)::integer FROM public.notification_outbox WHERE idempotency_key LIKE p_key_like;
$$;

-- ── C. The creator is the only roster member: zero rows, no error ─────────
DO $solo$
DECLARE
  v_thread uuid;
BEGIN
  UPDATE public.support_staff SET enabled = false
   WHERE user_id IN (pg_temp.t3988c_id('lead1'), pg_temp.t3988c_id('lead2'), pg_temp.t3988c_id('mate2'));
  v_thread := pg_temp.t3988c_thread('mate', 'Only me here');
  IF pg_temp.t3988c_count('admin.support_staff_ticket:' || v_thread::text || ':%') <> 0 THEN
    RAISE EXCEPTION 'solo_creator_alerted:%', pg_temp.t3988c_rows('admin.support_staff_ticket:' || v_thread::text || ':%');
  END IF;
  UPDATE public.support_staff SET enabled = true
   WHERE user_id IN (pg_temp.t3988c_id('lead1'), pg_temp.t3988c_id('lead2'), pg_temp.t3988c_id('mate2'));
  -- Closed off so later sweeps ignore it.
  UPDATE public.support_internal_threads SET status = 'closed' WHERE id = v_thread;
END;
$solo$;

-- ── B. Hostile subject/title text is data, never SQL ──────────────────────
DO $hostile$
DECLARE
  v_subject text := $s$x'); DELETE FROM public.notification_outbox; -- %_\$s$;
  v_thread uuid;
  v_signal uuid;
  v_before integer;
BEGIN
  SELECT count(*) INTO v_before FROM public.notification_outbox;
  v_thread := pg_temp.t3988c_thread('mate', v_subject);
  v_signal := pg_temp.t3988c_signal('mate', v_subject);
  IF (SELECT count(*) FROM public.notification_outbox) <= v_before THEN
    RAISE EXCEPTION 'hostile_subject_lost_rows';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.notification_outbox
    WHERE idempotency_key LIKE '%:' || v_thread::text || ':%'
      AND payload->>'subject' IS DISTINCT FROM v_subject
  ) OR EXISTS (
    SELECT 1 FROM public.notification_outbox
    WHERE idempotency_key LIKE 'admin.product_signal_new:' || v_signal::text || ':%'
      AND payload->>'title' IS DISTINCT FROM v_subject
  ) THEN
    RAISE EXCEPTION 'hostile_subject_not_verbatim';
  END IF;
  IF EXISTS (SELECT 1 FROM public.notification_outbox WHERE idempotency_key LIKE '%DELETE%') THEN
    RAISE EXCEPTION 'subject_reached_idempotency_key';
  END IF;
  UPDATE public.support_internal_threads SET status = 'closed' WHERE id = v_thread;
  UPDATE public.support_product_signals SET state = 'closed', revision = revision + 1 WHERE id = v_signal;
END;
$hostile$;

-- ── D/E. Overdue: lead == owner, deadlines moved later and earlier ────────
DO $overdue$
DECLARE
  v_thread uuid;
  v_due timestamptz;
  v text;
BEGIN
  v_thread := pg_temp.t3988c_thread('mate', 'Lead owns this');
  UPDATE public.support_internal_threads SET assigned_staff_id = pg_temp.t3988c_id('lead1'),
         revision = revision + 1 WHERE id = v_thread;
  SELECT next_update_at INTO v_due FROM public.support_internal_threads WHERE id = v_thread;

  -- 25h past the deadline on the very first sweep: owner copy and lead copies at once.
  PERFORM public.issue_3988_support_overdue_sweep(v_due + interval '25 hours');
  PERFORM public.issue_3988_support_overdue_sweep(v_due + interval '25 hours');
  v := pg_temp.t3988c_rows('admin.support_overdue:internal_thread:' || v_thread::text || ':%');
  IF v <> 'lead1/owner,lead2/lead' THEN
    RAISE EXCEPTION 'lead_owner_double_or_wrong:%', v;
  END IF;

  -- Moved LATER: nothing until the new deadline passes, then exactly one more.
  UPDATE public.support_internal_threads SET next_update_at = v_due + interval '30 hours' WHERE id = v_thread;
  PERFORM public.issue_3988_support_overdue_sweep(v_due + interval '29 hours');
  IF pg_temp.t3988c_count('admin.support_overdue:internal_thread:' || v_thread::text || ':%') <> 2 THEN
    RAISE EXCEPTION 'moved_later_fired_early';
  END IF;
  PERFORM public.issue_3988_support_overdue_sweep(v_due + interval '31 hours');
  PERFORM public.issue_3988_support_overdue_sweep(v_due + interval '31 hours 15 minutes');
  IF pg_temp.t3988c_count('admin.support_overdue:internal_thread:' || v_thread::text || ':%:owner:%') <> 2 THEN
    RAISE EXCEPTION 'moved_later_not_exactly_once';
  END IF;

  -- Moved EARLIER (to a new, already-past value): exactly one more owner copy.
  UPDATE public.support_internal_threads SET next_update_at = v_due + interval '20 hours' WHERE id = v_thread;
  PERFORM public.issue_3988_support_overdue_sweep(v_due + interval '31 hours 30 minutes');
  PERFORM public.issue_3988_support_overdue_sweep(v_due + interval '31 hours 45 minutes');
  IF pg_temp.t3988c_count('admin.support_overdue:internal_thread:' || v_thread::text || ':%:owner:%') <> 3 THEN
    RAISE EXCEPTION 'moved_earlier_not_exactly_once';
  END IF;
  -- Never two rows for the same person, deadline and audience.
  IF EXISTS (
    SELECT 1 FROM public.notification_outbox
    WHERE idempotency_key LIKE 'admin.support_overdue:internal_thread:' || v_thread::text || ':%'
    GROUP BY user_id, payload->>'due_at', payload->>'audience' HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'overdue_duplicate_per_deadline';
  END IF;
  -- Lead1 never got a lead copy of an item lead1 owns.
  IF EXISTS (
    SELECT 1 FROM public.notification_outbox
    WHERE idempotency_key LIKE 'admin.support_overdue:internal_thread:' || v_thread::text || ':%:lead:%'
      AND user_id = pg_temp.t3988c_id('lead1')
  ) THEN
    RAISE EXCEPTION 'owner_lead_got_lead_copy';
  END IF;
  UPDATE public.support_internal_threads SET status = 'closed' WHERE id = v_thread;
END;
$overdue$;

-- ── F. Long-past deadlines on finished work: quiet on the first sweep ─────
DO $finished$
DECLARE
  v_resolved uuid := pg_temp.t3988c_thread('mate', 'Already resolved', 'resolved');
  v_closed uuid := pg_temp.t3988c_thread('mate', 'Already closed', 'closed');
  v_released uuid := pg_temp.t3988c_signal('mate', 'Already released', 'released');
  v_sclosed uuid := pg_temp.t3988c_signal('mate', 'Already closed signal', 'closed');
BEGIN
  PERFORM public.issue_3988_support_overdue_sweep(now() + interval '90 days');
  IF pg_temp.t3988c_count('admin.support_overdue:internal_thread:' || v_resolved::text || ':%')
   + pg_temp.t3988c_count('admin.support_overdue:internal_thread:' || v_closed::text || ':%')
   + pg_temp.t3988c_count('admin.support_overdue:product_signal:' || v_released::text || ':%')
   + pg_temp.t3988c_count('admin.support_overdue:product_signal:' || v_sclosed::text || ':%') <> 0 THEN
    RAISE EXCEPTION 'finished_work_reminded';
  END IF;
END;
$finished$;

-- ── G. Removed between the owner reminder and the 24h escalation ──────────
DO $removed$
DECLARE
  v_thread uuid := pg_temp.t3988c_thread('lead1', 'Mate owns, then leaves');
  v_due timestamptz;
  v text;
BEGIN
  UPDATE public.support_internal_threads SET assigned_staff_id = pg_temp.t3988c_id('mate2'),
         revision = revision + 1 WHERE id = v_thread;
  SELECT next_update_at INTO v_due FROM public.support_internal_threads WHERE id = v_thread;
  PERFORM public.issue_3988_support_overdue_sweep(v_due + interval '1 hour');
  IF pg_temp.t3988c_rows('admin.support_overdue:internal_thread:' || v_thread::text || ':%') <> 'mate2/owner' THEN
    RAISE EXCEPTION 'owner_reminder_missing';
  END IF;

  -- mate2 leaves the team; lead2 leaves the team; lead1 stays.
  UPDATE public.admin_team_members SET status = 'revoked'
   WHERE email IN ('issue3988c-mate2@test.local', 'issue3988c-lead2@test.local');
  PERFORM public.issue_3988_support_overdue_sweep(v_due + interval '25 hours');
  v := pg_temp.t3988c_rows('admin.support_overdue:internal_thread:' || v_thread::text || ':%');
  IF v <> 'lead1/lead,mate2/owner' THEN
    RAISE EXCEPTION 'removed_teammate_still_alerted:%', v;
  END IF;
  -- And a new deadline for the departed owner reaches nobody but the leads.
  UPDATE public.support_internal_threads SET next_update_at = v_due + interval '2 days' WHERE id = v_thread;
  PERFORM public.issue_3988_support_overdue_sweep(v_due + interval '4 days');
  IF EXISTS (
    SELECT 1 FROM public.notification_outbox
    WHERE idempotency_key LIKE 'admin.support_overdue:internal_thread:' || v_thread::text || ':%'
      AND user_id IN (pg_temp.t3988c_id('mate2'), pg_temp.t3988c_id('lead2'))
      AND payload->>'due_at' <> (to_jsonb(v_due) #>> '{}')
  ) THEN
    RAISE EXCEPTION 'departed_teammate_got_new_deadline';
  END IF;

  UPDATE public.admin_team_members SET status = 'active'
   WHERE email IN ('issue3988c-mate2@test.local', 'issue3988c-lead2@test.local');
  UPDATE public.support_internal_threads SET status = 'closed' WHERE id = v_thread;
END;
$removed$;

-- ── H. Maintenance writes enqueue nothing ─────────────────────────────────
DO $bulk$
DECLARE
  v_before integer;
  v_thread uuid := pg_temp.t3988c_thread('mate', 'Bulk target');
  v_signal uuid := pg_temp.t3988c_signal('mate', 'Bulk signal');
BEGIN
  SELECT count(*) INTO v_before FROM public.notification_outbox;
  -- Same-value writes to the watched columns, across every row.
  UPDATE public.support_internal_threads SET assigned_staff_id = assigned_staff_id, revision = revision + 1;
  UPDATE public.support_product_signals SET owner_user_id = owner_user_id, state = state, revision = revision + 1;
  UPDATE public.product_avengers_items SET release_verified_at = release_verified_at;
  -- Writes to columns the triggers do not watch.
  UPDATE public.support_internal_threads SET priority = 'low', updated_at = now();
  UPDATE public.support_product_signals SET priority = 'low', updated_at = now();
  IF (SELECT count(*) FROM public.notification_outbox) <> v_before THEN
    RAISE EXCEPTION 'maintenance_write_enqueued:%', (SELECT count(*) FROM public.notification_outbox) - v_before;
  END IF;
  UPDATE public.support_internal_threads SET status = 'closed' WHERE id = v_thread;
  UPDATE public.support_product_signals SET state = 'closed' WHERE id = v_signal;
END;
$bulk$;

-- ── A. Payload keys are an exact allowlist per category ───────────────────
DO $payload$
DECLARE
  v_ticket uuid;
  v_conv uuid;
  v_msg uuid;
  v_thread uuid;
  v_signal uuid;
  v_item uuid;
  v_bad text;
BEGIN
  -- Make one of every category.
  v_ticket := pg_temp.t3988c_as('outside', 'public.create_support_ticket(''Payload probe'', NULL)')::uuid;
  SELECT conversation_id INTO v_conv FROM public.support_tickets WHERE id = v_ticket;
  INSERT INTO public.messages (conversation_id, sender_id, content, message_type)
  VALUES (v_conv, pg_temp.t3988c_id('outside'), 'SECRET HOST BODY', 'text') RETURNING id INTO v_msg;
  PERFORM public.issue_3988_enqueue_support_reply_alerts(v_ticket, v_msg, pg_temp.t3988c_id('outside'));

  v_thread := pg_temp.t3988c_thread('mate', 'Payload thread');
  UPDATE public.support_internal_threads SET assigned_staff_id = pg_temp.t3988c_id('mate2'),
         revision = revision + 1 WHERE id = v_thread;
  v_signal := pg_temp.t3988c_signal('mate', 'Payload signal');
  UPDATE public.support_product_signals SET owner_user_id = pg_temp.t3988c_id('lead2'),
         revision = revision + 1 WHERE id = v_signal;
  INSERT INTO public.product_avengers_items (issue_number, issue_node_id, project_item_id, issue_url, issue_title, issue_state, board_status)
  VALUES (39883, 'I_issue3988c', 'PVTI_issue3988c', 'https://github.com/Mingla-LLC/mingla-main/issues/39883', 'Probe', 'OPEN', 'In Progress')
  RETURNING id INTO v_item;
  INSERT INTO public.product_signal_avengers_links (signal_id, item_id, link_kind, linked_by)
  VALUES (v_signal, v_item, 'existing', pg_temp.t3988c_id('lead1'));
  UPDATE public.support_product_signals SET state = 'released', revision = revision + 1 WHERE id = v_signal;
  PERFORM public.issue_3988_support_overdue_sweep(now() + interval '3 hours');

  IF (SELECT count(DISTINCT category_key) FROM public.notification_outbox o
      JOIN t3988c_people p ON p.id = o.user_id
      WHERE o.category_key IN (
        'business.support_ticket_reply', 'admin.support_staff_ticket', 'admin.support_assigned',
        'admin.support_overdue', 'admin.product_signal_new', 'admin.product_signal_assigned',
        'admin.product_signal_progress')) <> 7 THEN
    RAISE EXCEPTION 'not_every_category_produced';
  END IF;

  SELECT string_agg(DISTINCT o.category_key || '.' || k.key, ',') INTO v_bad
  FROM public.notification_outbox o
  JOIN t3988c_people p ON p.id = o.user_id
  CROSS JOIN LATERAL jsonb_object_keys(o.payload) AS k(key)
  WHERE o.category_key IN (
      'business.support_ticket_reply', 'admin.support_staff_ticket', 'admin.support_assigned',
      'admin.support_overdue', 'admin.product_signal_new', 'admin.product_signal_assigned',
      'admin.product_signal_progress')
    AND NOT (k.key = ANY (CASE o.category_key
      WHEN 'business.support_ticket_reply' THEN ARRAY['ticket_id','message_id','subject','priority','push','deep_link','admin_link']
      WHEN 'admin.support_staff_ticket' THEN ARRAY['thread_id','subject','priority','deep_link']
      WHEN 'admin.support_assigned' THEN ARRAY['thread_id','subject','priority','deep_link']
      WHEN 'admin.support_overdue' THEN ARRAY['kind','item_id','title','priority','due_at','deep_link','audience']
      WHEN 'admin.product_signal_new' THEN ARRAY['signal_id','title','signal_kind','priority','deep_link','push']
      WHEN 'admin.product_signal_assigned' THEN ARRAY['signal_id','title','signal_kind','priority','deep_link']
      WHEN 'admin.product_signal_progress' THEN ARRAY['signal_id','title','signal_kind','priority','deep_link','event','issue_number']
    END));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'payload_key_outside_allowlist:%', v_bad;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.notification_outbox o JOIN t3988c_people p ON p.id = o.user_id
    WHERE o.payload::text LIKE '%SECRET%'
  ) THEN
    RAISE EXCEPTION 'payload_carried_private_text';
  END IF;
  -- Every link the producers wrote is one the dispatcher's allowlist accepts.
  IF EXISTS (
    SELECT 1 FROM public.notification_outbox o JOIN t3988c_people p ON p.id = o.user_id
    WHERE o.category_key LIKE 'admin.%' AND o.category_key <> 'admin.team_mention'
      AND o.payload->>'deep_link' !~ '^https://admin\.usemingla\.com/#/community-support\?tab=(support&thread|product&signal)=[0-9a-f-]{36}$'
  ) THEN
    RAISE EXCEPTION 'admin_link_shape_wrong';
  END IF;
END;
$payload$;

-- ── I. Preferences ────────────────────────────────────────────────────────
DO $prefs$
DECLARE
  v text;
BEGIN
  -- A row is already queued for mate; mate then turns that email off.
  IF NOT EXISTS (SELECT 1 FROM public.notification_outbox
                 WHERE category_key = 'admin.support_staff_ticket' AND user_id = pg_temp.t3988c_id('mate2')
                   AND status = 'pending') THEN
    RAISE EXCEPTION 'precondition_no_pending_row';
  END IF;
  v := pg_temp.t3988c_as('mate2', 'public.issue_3988_set_email_alert_preference(''admin.support_staff_ticket'', false)');
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'opt_out_failed:%', v; END IF;
  IF public.can_send(pg_temp.t3988c_id('mate2'), 'admin.support_staff_ticket', 'email', 'issue3988c-mate2@test.local')
     OR public.can_send(pg_temp.t3988c_id('mate2'), 'admin.support_staff_ticket', 'inapp', NULL) IS NOT TRUE
     OR public.can_send(pg_temp.t3988c_id('mate2'), 'admin.support_assigned', 'email', 'issue3988c-mate2@test.local') IS NOT TRUE
     OR public.can_send(pg_temp.t3988c_id('lead1'), 'admin.support_staff_ticket', 'email', 'issue3988c-lead1@test.local') IS NOT TRUE THEN
    RAISE EXCEPTION 'opt_out_scope_wrong';
  END IF;
  IF public.issue_3720_notification_denial_reason(pg_temp.t3988c_id('mate2'), 'admin.support_staff_ticket', 'email', NULL) <> 'preference_off' THEN
    RAISE EXCEPTION 'opt_out_reason_wrong';
  END IF;
  -- Back on: email allowed again.
  PERFORM pg_temp.t3988c_as('mate2', 'public.issue_3988_set_email_alert_preference(''admin.support_staff_ticket'', true)');
  IF public.can_send(pg_temp.t3988c_id('mate2'), 'admin.support_staff_ticket', 'email', 'issue3988c-mate2@test.local') IS NOT TRUE THEN
    RAISE EXCEPTION 'opt_back_in_ignored';
  END IF;

  -- Mentions: off with no row, on only after an explicit true, off again after false.
  IF public.can_send(pg_temp.t3988c_id('mate'), 'admin.team_mention', 'email', 'issue3988c-mate@test.local')
     OR public.issue_3720_notification_denial_reason(pg_temp.t3988c_id('mate'), 'admin.team_mention', 'email', NULL) <> 'preference_off' THEN
    RAISE EXCEPTION 'mention_email_not_opt_in';
  END IF;
  v := pg_temp.t3988c_as('mate', 'public.issue_3988_my_email_alert_preferences()');
  IF (v::jsonb @> '[{"category_key":"admin.team_mention","email_enabled":false}]'::jsonb) IS NOT TRUE
     OR jsonb_array_length(v::jsonb) <> 8 THEN
    RAISE EXCEPTION 'mention_default_shown_on:%', v;
  END IF;
  PERFORM pg_temp.t3988c_as('mate', 'public.issue_3988_set_email_alert_preference(''admin.team_mention'', true)');
  IF public.can_send(pg_temp.t3988c_id('mate'), 'admin.team_mention', 'email', 'issue3988c-mate@test.local') IS NOT TRUE THEN
    RAISE EXCEPTION 'mention_opt_in_ignored';
  END IF;
  PERFORM pg_temp.t3988c_as('mate', 'public.issue_3988_set_email_alert_preference(''admin.team_mention'', false)');
  IF public.can_send(pg_temp.t3988c_id('mate'), 'admin.team_mention', 'email', 'issue3988c-mate@test.local') THEN
    RAISE EXCEPTION 'mention_opt_out_ignored';
  END IF;

  -- The category key is matched exactly.
  FOREACH v IN ARRAY ARRAY['ADMIN.SUPPORT_OVERDUE', 'admin.support_overdue ', ' admin.support_overdue',
                           'admin.support_overdue''--', '', 'admin.%'] LOOP
    IF pg_temp.t3988c_as('mate', format('public.issue_3988_set_email_alert_preference(%L, false)', v))
       NOT LIKE 'ERR:22023:%unknown_alert_category%' THEN
      RAISE EXCEPTION 'loose_category_match:%', v;
    END IF;
  END LOOP;
  IF pg_temp.t3988c_as('mate', 'public.issue_3988_set_email_alert_preference(NULL, false)') NOT LIKE 'ERR:22023:%' THEN
    RAISE EXCEPTION 'null_category_accepted';
  END IF;

  -- Nobody writes someone else's preference: not via the table, not via an update.
  v := pg_temp.t3988c_exec('mate', format(
    $q$INSERT INTO public.notification_channel_prefs (user_id, category_key, channel, enabled)
       VALUES (%L::uuid, 'admin.support_overdue', 'email', false)$q$,
    pg_temp.t3988c_id('lead1')));
  IF v NOT LIKE 'ERR:42501:%' THEN RAISE EXCEPTION 'foreign_pref_insert:%', v; END IF;
  PERFORM pg_temp.t3988c_as('lead1', 'public.issue_3988_set_email_alert_preference(''admin.support_overdue'', true)');
  v := pg_temp.t3988c_exec('mate', format(
    $q$UPDATE public.notification_channel_prefs SET enabled = false WHERE user_id = %L::uuid$q$,
    pg_temp.t3988c_id('lead1')));
  IF v <> '0' THEN RAISE EXCEPTION 'foreign_pref_update:%', v; END IF;
  IF (SELECT enabled FROM public.notification_channel_prefs
      WHERE user_id = pg_temp.t3988c_id('lead1') AND category_key = 'admin.support_overdue' AND channel = 'email') IS NOT TRUE THEN
    RAISE EXCEPTION 'foreign_pref_changed';
  END IF;
  -- Someone off the team cannot set anything.
  IF pg_temp.t3988c_as('outside', 'public.issue_3988_set_email_alert_preference(''admin.support_overdue'', false)') NOT LIKE 'ERR:42501:%' THEN
    RAISE EXCEPTION 'outsider_set_preference';
  END IF;
END;
$prefs$;

-- ── J. One overdue cron job on the 15-minute schedule ─────────────────────
DO $cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron absent; cron assertion skipped';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'issue_3988_support_overdue_sweep') <> 1
     OR (SELECT count(*) FROM cron.job WHERE command LIKE '%issue_3988_support_overdue_sweep%') <> 1
     OR (SELECT schedule FROM cron.job WHERE jobname = 'issue_3988_support_overdue_sweep') <> '*/15 * * * *' THEN
    RAISE EXCEPTION 'overdue_cron_not_single_15m_job';
  END IF;
END;
$cron$;

ROLLBACK;
