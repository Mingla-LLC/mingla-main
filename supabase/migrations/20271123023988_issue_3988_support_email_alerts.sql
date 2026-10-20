-- Issue #3988 — every support alert reaches the people who need it.
--
-- All alerts ride the existing notification_outbox -> notify-outbox-drain ->
-- notify-dispatch (v2) pipeline. Nothing here sends anything itself.
--
-- Who is who (one rule, three helpers):
--   roster  = support_staff.enabled AND is_support_staff(user_id)
--             (is_support_staff already requires current Mingla team
--             membership, so an off-team row never receives anything)
--   leads   = roster members whose support_staff.role = 'lead'
--   owners  = active admin_users rows with role 'owner' (the product owner)
--
-- Alerts added (all transactional, email on by default, per-category email
-- opt-out through notification_channel_prefs):
--   business.support_ticket_reply   Host replied on a ticket -> roster +
--                                   assignee, minus the sender. Push only for
--                                   people marked available and the assignee.
--   admin.support_staff_ticket      staff ticket created -> roster minus creator
--   admin.support_assigned          staff ticket reassigned -> new assignee
--   admin.support_overdue           "next update by" passed -> owner/assignee
--                                   once; 24h later -> Support leads once
--   admin.product_signal_new        signal created -> owners + leads minus
--                                   creator; push too when high or urgent
--   admin.product_signal_assigned   signal owner changed -> new owner
--   admin.product_signal_progress   signal linked to GitHub or released ->
--                                   in-app note to whoever raised it
--
-- PII boundary: payloads carry IDs, subject/title, priority, due time and a
-- link only. Never a Host message body, staff ticket details or a signal's
-- problem statement.
--
-- MINGLA-INVARIANT: I-3988-ALERT-RECIPIENTS-ARE-ON-TEAM | issue #3988 | Every support and product alert is enqueued only for a current Mingla teammate; a support_staff row on someone off the team never receives one.
-- MINGLA-INVARIANT: I-3988-ALERT-ONCE-PER-EVENT | issue #3988 | Each alert has one idempotency key per event and recipient, so a repeated call or sweep never sends a second copy.
-- MINGLA-INVARIANT: I-3988-ALERT-PAYLOAD-NO-BODY | issue #3988 | Support and product alert payloads carry IDs, subject or title, priority and a link only, never a message body or problem statement.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Categories.
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO public.notification_categories (
  key, section, is_transactional, urgency, default_channels, reach_mode, active
) VALUES
  ('business.support_ticket_reply', 'support', true, 'high',
    ARRAY['inapp', 'push', 'email']::text[], 'reach_once', true),
  ('admin.support_staff_ticket', 'support', true, 'normal',
    ARRAY['inapp', 'email']::text[], 'reach_once', true),
  ('admin.support_assigned', 'support', true, 'normal',
    ARRAY['inapp', 'email']::text[], 'reach_once', true),
  ('admin.support_overdue', 'support', true, 'high',
    ARRAY['inapp', 'email']::text[], 'reach_once', true),
  ('admin.product_signal_new', 'product', true, 'high',
    ARRAY['inapp', 'push', 'email']::text[], 'reach_once', true),
  ('admin.product_signal_assigned', 'product', true, 'normal',
    ARRAY['inapp', 'email']::text[], 'reach_once', true),
  ('admin.product_signal_progress', 'product', true, 'normal',
    ARRAY['inapp']::text[], 'reach_once', true)
ON CONFLICT (key) DO UPDATE SET
  section = EXCLUDED.section,
  is_transactional = EXCLUDED.is_transactional,
  urgency = EXCLUDED.urgency,
  default_channels = EXCLUDED.default_channels,
  reach_mode = EXCLUDED.reach_mode,
  active = EXCLUDED.active;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Recipient helpers (service role only).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_3988_support_roster()
RETURNS TABLE(user_id uuid, available boolean, is_lead boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT s.user_id, s.available, s.role = 'lead'
  FROM public.support_staff s
  WHERE s.enabled = true
    AND public.is_support_staff(s.user_id)
  ORDER BY s.user_id;
$function$;
REVOKE ALL ON FUNCTION public.issue_3988_support_roster() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3988_support_roster() TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3988_support_leads()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT r.user_id FROM public.issue_3988_support_roster() r
  WHERE r.is_lead
  ORDER BY r.user_id;
$function$;
REVOKE ALL ON FUNCTION public.issue_3988_support_leads() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3988_support_leads() TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3988_product_owners()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT DISTINCT identity.id
  FROM public.admin_users owner_row
  JOIN auth.users identity
    ON lower(btrim(identity.email)) = lower(btrim(owner_row.email))
  WHERE owner_row.role = 'owner'
    AND owner_row.status = 'active'
    AND public.issue_3720_active_team_member(identity.id)
  ORDER BY identity.id;
$function$;
REVOKE ALL ON FUNCTION public.issue_3988_product_owners() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3988_product_owners() TO service_role;

-- The single producer every alert below goes through. It refuses anyone who
-- is not a current teammate, so no caller can alert an off-team row.
CREATE OR REPLACE FUNCTION public.issue_3988_enqueue_alert(
  p_category_key text,
  p_user_id uuid,
  p_idempotency_key text,
  p_payload jsonb
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_rows integer;
BEGIN
  IF p_user_id IS NULL OR NOT public.is_support_staff(p_user_id) THEN
    RETURN false;
  END IF;
  INSERT INTO public.notification_outbox (
    category_key, user_id, brand_id, country_code, payload, idempotency_key, status
  ) VALUES (
    p_category_key, p_user_id, NULL, NULL, COALESCE(p_payload, '{}'::jsonb),
    p_idempotency_key, 'pending'
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3988_enqueue_alert(text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3988_enqueue_alert(text, uuid, text, jsonb) TO service_role;

-- Admin web links (hash routes in mingla-admin).
CREATE OR REPLACE FUNCTION public.issue_3988_admin_link(p_kind text, p_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  SELECT 'https://admin.usemingla.com/#/community-support?tab='
    || CASE p_kind WHEN 'product_signal' THEN 'product' ELSE 'support' END
    || '&'
    || CASE p_kind
         WHEN 'product_signal' THEN 'signal'
         WHEN 'internal_thread' THEN 'thread'
         ELSE 'ticket'
       END
    || '=' || p_id::text;
$function$;
REVOKE ALL ON FUNCTION public.issue_3988_admin_link(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3988_admin_link(text, uuid) TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Host reply on a ticket. Called by notify-support (support-send) for a
--    requester reply. One outbox row per message and recipient.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_3988_enqueue_support_reply_alerts(
  p_ticket_id uuid,
  p_message_id uuid,
  p_sender_user_id uuid
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
  v_count integer := 0;
  v_recipient record;
BEGIN
  IF p_ticket_id IS NULL OR p_message_id IS NULL THEN
    RAISE EXCEPTION 'ticket_and_message_required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- The message must be this ticket's, from this sender.
  IF NOT EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = p_message_id
      AND m.conversation_id = v_ticket.conversation_id
      AND m.sender_id IS NOT DISTINCT FROM p_sender_user_id
  ) THEN
    RAISE EXCEPTION 'message_not_on_ticket' USING ERRCODE = '22023';
  END IF;

  FOR v_recipient IN
    SELECT people.user_id, bool_or(people.push) AS push
    FROM (
      SELECT r.user_id, r.available AS push FROM public.issue_3988_support_roster() r
      UNION ALL
      SELECT v_ticket.assigned_staff_id, true
      WHERE v_ticket.assigned_staff_id IS NOT NULL
    ) people
    WHERE people.user_id IS DISTINCT FROM p_sender_user_id
    GROUP BY people.user_id
    ORDER BY people.user_id
  LOOP
    IF public.issue_3988_enqueue_alert(
      'business.support_ticket_reply',
      v_recipient.user_id,
      'business.support_ticket_reply:' || p_message_id::text || ':' || v_recipient.user_id::text,
      jsonb_build_object(
        'ticket_id', v_ticket.id,
        'message_id', p_message_id,
        'subject', v_ticket.subject,
        'priority', v_ticket.priority,
        'push', v_recipient.push,
        'deep_link', 'mingla-business://support/' || v_ticket.id::text,
        'admin_link', public.issue_3988_admin_link('support_ticket', v_ticket.id)
      )
    ) THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3988_enqueue_support_reply_alerts(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3988_enqueue_support_reply_alerts(uuid, uuid, uuid) TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Staff tickets (support_internal_threads). Triggers, so every write path
--    (RPC or service role) alerts the same way.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_3988_staff_ticket_payload(p_thread public.support_internal_threads)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'thread_id', p_thread.id,
    'subject', p_thread.subject,
    'priority', p_thread.priority,
    'deep_link', public.issue_3988_admin_link('internal_thread', p_thread.id)
  );
$function$;
REVOKE ALL ON FUNCTION public.issue_3988_staff_ticket_payload(public.support_internal_threads) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3988_staff_ticket_payload(public.support_internal_threads) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3988_staff_ticket_created_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user uuid;
BEGIN
  FOR v_user IN
    SELECT r.user_id FROM public.issue_3988_support_roster() r
    WHERE r.user_id IS DISTINCT FROM NEW.created_by
  LOOP
    PERFORM public.issue_3988_enqueue_alert(
      'admin.support_staff_ticket',
      v_user,
      'admin.support_staff_ticket:' || NEW.id::text || ':' || v_user::text,
      public.issue_3988_staff_ticket_payload(NEW)
    );
  END LOOP;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3988_staff_ticket_created_alert() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.issue_3988_staff_ticket_assigned_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.assigned_staff_id IS NULL
     OR NEW.assigned_staff_id IS NOT DISTINCT FROM OLD.assigned_staff_id
     OR NEW.assigned_staff_id IS NOT DISTINCT FROM auth.uid() THEN
    RETURN NULL;
  END IF;
  PERFORM public.issue_3988_enqueue_alert(
    'admin.support_assigned',
    NEW.assigned_staff_id,
    'admin.support_assigned:' || NEW.id::text || ':' || NEW.assigned_staff_id::text
      || ':' || NEW.revision::text,
    public.issue_3988_staff_ticket_payload(NEW)
  );
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3988_staff_ticket_assigned_alert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_3988_staff_ticket_created_alert ON public.support_internal_threads;
CREATE TRIGGER issue_3988_staff_ticket_created_alert
  AFTER INSERT ON public.support_internal_threads
  FOR EACH ROW EXECUTE FUNCTION public.issue_3988_staff_ticket_created_alert();

DROP TRIGGER IF EXISTS issue_3988_staff_ticket_assigned_alert ON public.support_internal_threads;
CREATE TRIGGER issue_3988_staff_ticket_assigned_alert
  AFTER UPDATE OF assigned_staff_id ON public.support_internal_threads
  FOR EACH ROW EXECUTE FUNCTION public.issue_3988_staff_ticket_assigned_alert();

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Product signals.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_3988_signal_payload(p_signal public.support_product_signals)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'signal_id', p_signal.id,
    'title', p_signal.title,
    'signal_kind', p_signal.signal_kind,
    'priority', p_signal.priority,
    'deep_link', public.issue_3988_admin_link('product_signal', p_signal.id)
  );
$function$;
REVOKE ALL ON FUNCTION public.issue_3988_signal_payload(public.support_product_signals) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3988_signal_payload(public.support_product_signals) TO service_role;

-- In-app note to whoever raised the signal, once per event.
CREATE OR REPLACE FUNCTION public.issue_3988_signal_progress_note(
  p_signal_id uuid,
  p_event text,
  p_event_key text,
  p_actor uuid,
  p_issue_number integer
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_signal public.support_product_signals%ROWTYPE;
BEGIN
  IF p_event NOT IN ('linked', 'released') THEN
    RAISE EXCEPTION 'invalid_progress_event' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_signal FROM public.support_product_signals WHERE id = p_signal_id;
  IF NOT FOUND OR v_signal.created_by IS NOT DISTINCT FROM p_actor THEN
    RETURN false;
  END IF;
  RETURN public.issue_3988_enqueue_alert(
    'admin.product_signal_progress',
    v_signal.created_by,
    'admin.product_signal_progress:' || p_event_key || ':' || v_signal.created_by::text,
    public.issue_3988_signal_payload(v_signal)
      || jsonb_build_object('event', p_event)
      || CASE WHEN p_issue_number IS NULL THEN '{}'::jsonb
              ELSE jsonb_build_object('issue_number', p_issue_number) END
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3988_signal_progress_note(uuid, text, text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3988_signal_progress_note(uuid, text, text, uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3988_signal_created_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user uuid;
  v_payload jsonb := public.issue_3988_signal_payload(NEW)
    || jsonb_build_object('push', NEW.priority IN ('high', 'urgent'));
BEGIN
  FOR v_user IN
    SELECT DISTINCT people.user_id
    FROM (
      SELECT owner_id AS user_id FROM public.issue_3988_product_owners() owner_id
      UNION
      SELECT lead_id FROM public.issue_3988_support_leads() lead_id
    ) people
    WHERE people.user_id IS DISTINCT FROM NEW.created_by
    ORDER BY people.user_id
  LOOP
    PERFORM public.issue_3988_enqueue_alert(
      'admin.product_signal_new',
      v_user,
      'admin.product_signal_new:' || NEW.id::text || ':' || v_user::text,
      v_payload
    );
  END LOOP;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3988_signal_created_alert() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.issue_3988_signal_changed_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.owner_user_id IS NOT NULL
     AND NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     AND NEW.owner_user_id IS DISTINCT FROM auth.uid() THEN
    PERFORM public.issue_3988_enqueue_alert(
      'admin.product_signal_assigned',
      NEW.owner_user_id,
      'admin.product_signal_assigned:' || NEW.id::text || ':' || NEW.owner_user_id::text
        || ':' || NEW.revision::text,
      public.issue_3988_signal_payload(NEW)
    );
  END IF;
  IF NEW.state = 'released' AND OLD.state IS DISTINCT FROM 'released' THEN
    PERFORM public.issue_3988_signal_progress_note(
      NEW.id, 'released', 'released:' || NEW.id::text, auth.uid(), NULL
    );
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3988_signal_changed_alert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_3988_signal_created_alert ON public.support_product_signals;
CREATE TRIGGER issue_3988_signal_created_alert
  AFTER INSERT ON public.support_product_signals
  FOR EACH ROW EXECUTE FUNCTION public.issue_3988_signal_created_alert();

DROP TRIGGER IF EXISTS issue_3988_signal_changed_alert ON public.support_product_signals;
CREATE TRIGGER issue_3988_signal_changed_alert
  AFTER UPDATE OF owner_user_id, state ON public.support_product_signals
  FOR EACH ROW EXECUTE FUNCTION public.issue_3988_signal_changed_alert();

-- Linked to a GitHub issue (Avengers bridge).
CREATE OR REPLACE FUNCTION public.issue_3988_signal_linked_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_issue integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.item_id IS NOT DISTINCT FROM OLD.item_id THEN
    RETURN NULL;
  END IF;
  SELECT i.issue_number INTO v_issue FROM public.product_avengers_items i WHERE i.id = NEW.item_id;
  PERFORM public.issue_3988_signal_progress_note(
    NEW.signal_id, 'linked', 'linked:' || NEW.signal_id::text || ':' || NEW.item_id::text,
    NEW.linked_by, v_issue
  );
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3988_signal_linked_alert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_3988_signal_linked_alert ON public.product_signal_avengers_links;
CREATE TRIGGER issue_3988_signal_linked_alert
  AFTER INSERT OR UPDATE OF item_id ON public.product_signal_avengers_links
  FOR EACH ROW EXECUTE FUNCTION public.issue_3988_signal_linked_alert();

-- Release verified on the linked GitHub issue. Shares the 'released' key with
-- the state change above, so a signal is announced released once.
CREATE OR REPLACE FUNCTION public.issue_3988_signal_release_verified_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_signal uuid;
BEGIN
  IF NEW.release_verified_at IS NULL OR OLD.release_verified_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  FOR v_signal IN
    SELECT l.signal_id FROM public.product_signal_avengers_links l
    WHERE l.item_id = NEW.id ORDER BY l.signal_id
  LOOP
    PERFORM public.issue_3988_signal_progress_note(
      v_signal, 'released', 'released:' || v_signal::text, NEW.release_verified_by, NEW.issue_number
    );
  END LOOP;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3988_signal_release_verified_alert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_3988_signal_release_verified_alert ON public.product_avengers_items;
CREATE TRIGGER issue_3988_signal_release_verified_alert
  AFTER UPDATE OF release_verified_at ON public.product_avengers_items
  FOR EACH ROW EXECUTE FUNCTION public.issue_3988_signal_release_verified_alert();

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Overdue sweep. Each deadline fires once for its owner and, 24 hours
--    later, once for the Support leads. The key carries the deadline, so a
--    new "next update by" time is a new deadline.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_3988_support_overdue_sweep(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_item record;
  v_lead uuid;
  v_owner_sent integer := 0;
  v_lead_sent integer := 0;
  v_due text;
  v_payload jsonb;
BEGIN
  FOR v_item IN
    SELECT 'internal_thread'::text AS kind, t.id, t.subject AS title, t.priority,
           t.next_update_at, COALESCE(t.assigned_staff_id, t.created_by) AS owner_id
    FROM public.support_internal_threads t
    WHERE t.status NOT IN ('resolved', 'closed')
      AND t.next_update_at <= p_now
    UNION ALL
    SELECT 'product_signal'::text, s.id, s.title, s.priority,
           s.next_update_at, COALESCE(s.owner_user_id, s.created_by)
    FROM public.support_product_signals s
    WHERE s.state NOT IN ('released', 'closed')
      AND s.next_update_at <= p_now
    ORDER BY 5, 2
  LOOP
    v_due := to_char(v_item.next_update_at AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS');
    v_payload := jsonb_build_object(
      'kind', v_item.kind,
      'item_id', v_item.id,
      'title', v_item.title,
      'priority', v_item.priority,
      'due_at', v_item.next_update_at,
      'deep_link', public.issue_3988_admin_link(v_item.kind, v_item.id)
    );

    IF public.issue_3988_enqueue_alert(
      'admin.support_overdue',
      v_item.owner_id,
      'admin.support_overdue:' || v_item.kind || ':' || v_item.id::text || ':' || v_due
        || ':owner:' || COALESCE(v_item.owner_id::text, 'none'),
      v_payload || jsonb_build_object('audience', 'owner')
    ) THEN
      v_owner_sent := v_owner_sent + 1;
    END IF;

    IF v_item.next_update_at <= p_now - interval '24 hours' THEN
      FOR v_lead IN
        SELECT lead_id FROM public.issue_3988_support_leads() lead_id
        WHERE lead_id IS DISTINCT FROM v_item.owner_id
      LOOP
        IF public.issue_3988_enqueue_alert(
          'admin.support_overdue',
          v_lead,
          'admin.support_overdue:' || v_item.kind || ':' || v_item.id::text || ':' || v_due
            || ':lead:' || v_lead::text,
          v_payload || jsonb_build_object('audience', 'lead')
        ) THEN
          v_lead_sent := v_lead_sent + 1;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('owner_alerts', v_owner_sent, 'lead_alerts', v_lead_sent);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3988_support_overdue_sweep(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3988_support_overdue_sweep(timestamptz) TO service_role;

DO $cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'issue3988_overdue_cron_not_registered';
    RETURN;
  END IF;
  PERFORM cron.unschedule(j.jobid)
  FROM cron.job j
  WHERE j.jobname = 'issue_3988_support_overdue_sweep';
  PERFORM cron.schedule(
    'issue_3988_support_overdue_sweep',
    '*/15 * * * *',
    $job$SELECT public.issue_3988_support_overdue_sweep()$job$
  );
END;
$cron$;

-- ───────────────────────────────────────────────────────────────────────────
-- 7. Dispatcher diagnostics learn the new categories (bounded codes only).
--    Same body as 20271102003720 with the category list extended.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_3720_notification_denial_reason(
  p_user_id uuid,
  p_category_key text,
  p_channel text,
  p_contact text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cat public.notification_categories%ROWTYPE;
  v_suppression_reason text;
BEGIN
  IF p_category_key NOT IN (
    'business.community_announcement',
    'business.community_roadmap_updated',
    'business.support_new_ticket',
    'business.brand_group_message',
    'admin.team_mention',
    'business.support_ticket_reply',
    'admin.support_staff_ticket',
    'admin.support_assigned',
    'admin.support_overdue',
    'admin.product_signal_new',
    'admin.product_signal_assigned',
    'admin.product_signal_progress'
  ) THEN
    RETURN 'policy_denied';
  END IF;

  SELECT * INTO v_cat
  FROM public.notification_categories
  WHERE key = p_category_key;
  IF NOT FOUND OR v_cat.active IS NOT TRUE THEN RETURN 'category_inactive'; END IF;
  IF NOT (p_channel = ANY(v_cat.default_channels)) THEN RETURN 'channel_inactive'; END IF;

  IF p_category_key = 'admin.team_mention' AND p_channel = 'email'
     AND NOT EXISTS (
       SELECT 1 FROM public.notification_channel_prefs pref
       WHERE pref.user_id = p_user_id
         AND pref.category_key = p_category_key
         AND pref.channel = p_channel
         AND pref.enabled = true
     ) THEN
    RETURN 'preference_off';
  END IF;
  IF p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.notification_channel_prefs pref
    WHERE pref.user_id = p_user_id
      AND pref.category_key = p_category_key
      AND pref.channel = p_channel
      AND pref.enabled = false
  ) THEN
    RETURN 'preference_off';
  END IF;

  IF p_channel IN ('email', 'sms') THEN
    SELECT suppression.reason INTO v_suppression_reason
    FROM public.channel_suppressions suppression
    WHERE suppression.channel = p_channel
      AND suppression.scope IN (
        CASE WHEN v_cat.is_transactional THEN 'transactional' ELSE 'marketing' END,
        'all'
      )
      AND (
        (p_user_id IS NOT NULL AND suppression.user_id = p_user_id)
        OR (p_contact IS NOT NULL AND lower(suppression.contact) = lower(p_contact))
      )
    ORDER BY CASE suppression.reason
      WHEN 'complaint' THEN 1
      WHEN 'bounce' THEN 2
      ELSE 3
    END, suppression.created_at DESC
    LIMIT 1;

    IF v_suppression_reason = 'complaint' THEN RETURN 'complaint'; END IF;
    IF v_suppression_reason = 'bounce' THEN RETURN 'hard_bounce'; END IF;
    IF v_suppression_reason IS NOT NULL THEN RETURN 'legal_suppression'; END IF;
  END IF;

  RETURN 'policy_denied';
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_notification_denial_reason(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3720_notification_denial_reason(uuid, text, text, text)
  TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 8. Email alert preferences for the signed-in teammate. New categories are
--    on unless the person turns them off; @mention email stays opt-in (its
--    can_send rule is unchanged).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_3988_email_alert_categories()
RETURNS TABLE(category_key text, default_on boolean, sort_order integer)
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  SELECT * FROM (VALUES
    ('business.support_new_ticket', true, 1),
    ('business.support_ticket_reply', true, 2),
    ('admin.support_staff_ticket', true, 3),
    ('admin.support_assigned', true, 4),
    ('admin.support_overdue', true, 5),
    ('admin.product_signal_new', true, 6),
    ('admin.product_signal_assigned', true, 7),
    ('admin.team_mention', false, 8)
  ) AS c(category_key, default_on, sort_order);
$function$;
REVOKE ALL ON FUNCTION public.issue_3988_email_alert_categories() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3988_email_alert_categories() TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3988_my_email_alert_preferences()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT public.issue_3720_active_team_member(auth.uid()) THEN
    RAISE EXCEPTION 'team_access_required' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'category_key', c.category_key,
      'default_on', c.default_on,
      'email_enabled', COALESCE(pref.enabled, c.default_on)
    ) ORDER BY c.sort_order)
    FROM public.issue_3988_email_alert_categories() c
    LEFT JOIN public.notification_channel_prefs pref
      ON pref.user_id = auth.uid()
     AND pref.category_key = c.category_key
     AND pref.channel = 'email'
  ), '[]'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3988_my_email_alert_preferences() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3988_my_email_alert_preferences() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_3988_set_email_alert_preference(
  p_category_key text,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT public.issue_3720_active_team_member(auth.uid()) THEN
    RAISE EXCEPTION 'team_access_required' USING ERRCODE = '42501';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'enabled_required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.issue_3988_email_alert_categories() c
    WHERE c.category_key = p_category_key
  ) THEN
    RAISE EXCEPTION 'unknown_alert_category' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.notification_channel_prefs AS pref (
    user_id, category_key, channel, enabled, updated_at
  ) VALUES (auth.uid(), p_category_key, 'email', p_enabled, now())
  ON CONFLICT (user_id, category_key, channel) DO UPDATE
    SET enabled = EXCLUDED.enabled, updated_at = now();
  RETURN public.issue_3988_my_email_alert_preferences();
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3988_set_email_alert_preference(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3988_set_email_alert_preference(text, boolean) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 9. Guards.
-- ───────────────────────────────────────────────────────────────────────────
DO $guard$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.issue_3988_support_roster()',
    'public.issue_3988_support_leads()',
    'public.issue_3988_product_owners()',
    'public.issue_3988_enqueue_alert(text,uuid,text,jsonb)',
    'public.issue_3988_enqueue_support_reply_alerts(uuid,uuid,uuid)',
    'public.issue_3988_signal_progress_note(uuid,text,text,uuid,integer)',
    'public.issue_3988_support_overdue_sweep(timestamptz)',
    'public.issue_3988_email_alert_categories()',
    'public.issue_3988_admin_link(text,uuid)'
  ] LOOP
    IF has_function_privilege('anon', v_signature, 'EXECUTE')
       OR has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue3988_alert_helper_acl_invalid:%', v_signature;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.issue_3988_my_email_alert_preferences()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_3988_set_email_alert_preference(text,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue3988_alert_preferences_acl_invalid';
  END IF;
  IF (SELECT count(*) FROM public.notification_categories
      WHERE key IN (
        'business.support_ticket_reply', 'admin.support_staff_ticket',
        'admin.support_assigned', 'admin.support_overdue',
        'admin.product_signal_new', 'admin.product_signal_assigned',
        'admin.product_signal_progress'
      ) AND is_transactional AND active) <> 7 THEN
    RAISE EXCEPTION 'issue3988_alert_categories_missing';
  END IF;
END;
$guard$;

NOTIFY pgrst, 'reload schema';
COMMIT;
