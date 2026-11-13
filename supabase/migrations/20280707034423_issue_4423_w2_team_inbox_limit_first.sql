-- #4423 Wave 2 (W2.5): team_inbox limits first and labels after.
--
-- Before: a MATERIALIZED CTE computed an actor label (ops_actor_label, about
-- 0.6 ms each) and a chat-read check for EVERY push mention the user ever got,
-- then kept the latest 100. For the busiest user that was 1,283 labels and
-- about 1.3 s, growing with history.
--
-- After (same response contract: mentions, alerts, unread{mentions,
-- work_updates, support}, the same keys inside each row; the Host app reads it):
--   1. The page: push mentions for the caller, readable (a team message counts
--      only while not deleted and in a thread the caller can read), newest
--      first, LIMIT. The chat-read check is resolved once per request (the
--      caller's open thread memberships, if the caller is chat staff), which
--      is exactly what team_chat_can_read checks per row.
--   2. Labels for the page only: actor names once per distinct email.
--   3. Unread counts over unread rows only (cost bounded by unread, not history).
--   4. Alerts: LIMIT before team_inbox_ticket_resolved; the support unread
--      count runs on unread rows only.
--
-- New index team_mentions_target_push_recent serves step 1 in order. The table
-- is small (about 4,600 rows in production), so a plain CREATE INDEX inside the
-- migration is safe.
--
-- Invariant I-TEAM-INBOX-LIMIT-BEFORE-LABEL is declared in
-- __tests__/issue_4423_w2_team_inbox.implementor.pg17.test.sql.
--
-- Rollback: re-apply team_inbox from
-- 20280626014398_issue_4398_review_and_notices.sql, then
-- DROP INDEX IF EXISTS public.team_mentions_target_push_recent.

BEGIN;

CREATE INDEX IF NOT EXISTS team_mentions_target_push_recent
  ON public.team_mentions (target_user_id, created_at DESC, id DESC) WHERE push;

CREATE OR REPLACE FUNCTION public.team_inbox(p_alert_types text[] DEFAULT NULL::text[], p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_me      uuid := auth.uid();
  v_types   text[];
  v_limit   integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
  v_threads uuid[];
  v_names   jsonb;
  v_anon    text := public.ops_name(NULL);
  v_ids     uuid[];
  v_page    jsonb;
  v_alerts  jsonb;
  v_unread_mentions bigint;
  v_unread_updates  bigint;
  v_unread_support  bigint;
BEGIN
  IF NOT public.issue_3720_active_team_member(v_me) THEN
    RAISE EXCEPTION 'team_access_required' USING ERRCODE = '42501';
  END IF;
  v_types := public.team_inbox_alert_types(p_alert_types);
  -- team_chat_can_read(thread) for this caller, once: an open membership and chat staff.
  v_threads := CASE WHEN public.team_chat_staff(v_me)
                    THEN ARRAY(SELECT tmm.thread_id FROM public.team_thread_members tmm
                                WHERE tmm.user_id = v_me AND tmm.left_at IS NULL)
                    ELSE ARRAY[]::uuid[] END;

  -- 1. The page, newest first, before any label (ids only).
  SELECT COALESCE(array_agg(pg.id ORDER BY pg.created_at DESC, pg.id DESC), ARRAY[]::uuid[]) INTO v_ids
    FROM (SELECT tm.id, tm.created_at
            FROM public.team_mentions tm
            LEFT JOIN public.team_messages tmsg ON tm.source_kind = 'team_message' AND tmsg.id = tm.source_id
           WHERE tm.target_user_id = v_me
             AND tm.push
             AND (tm.source_kind <> 'team_message'
                  OR (tmsg.deleted_at IS NULL AND tmsg.thread_id = ANY (v_threads)))
           ORDER BY tm.created_at DESC, tm.id DESC
           LIMIT v_limit) pg;

  -- 2. Labels for the page only.
  SELECT COALESCE(jsonb_object_agg(n.email, n.name), '{}'::jsonb) INTO v_names
    FROM public.ops_names_for(ARRAY(
      SELECT e.actor_email FROM public.team_mentions x
        JOIN public.ops_work_events e ON x.source_kind = 'work_card' AND e.id = x.source_id
       WHERE x.id = ANY (v_ids)
      UNION
      SELECT p.email FROM public.team_mentions x
        JOIN public.ops_work_events e ON x.source_kind = 'work_card' AND e.id = x.source_id
        JOIN public.ops_work_people p ON p.card_id = e.card_id AND p.role IN ('owner', 'watcher')
       WHERE x.id = ANY (v_ids))) n;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', x.id, 'kind', public.team_inbox_kind(x.source_kind, e.action), 'source_kind', x.source_kind,
      'card_id', e.card_id, 'action', e.action,
      'thread_id', tmsg.thread_id, 'message_id', tmsg.id, -- #4255 W1b
      -- #4398 retest (P3): a decision or an ask stands only while it is still open.
      'decision', x.decision AND wc.status IS DISTINCT FROM 'done'
                  AND (x.event_kind IS DISTINCT FROM 'review' OR wc.review_requested_at IS NOT NULL),
      'event_kind', x.event_kind,
      'needs_you', CASE WHEN x.event_kind = 'review' THEN wc.status IS DISTINCT FROM 'done' AND wc.review_requested_at IS NOT NULL
                        WHEN x.event_kind = 'sent_back' THEN wc.status IS DISTINCT FROM 'done' AND wc.review_requested_at IS NULL
                        ELSE false END,
      'card', CASE WHEN wc.id IS NOT NULL THEN jsonb_build_object('number', wc.number, 'title', wc.title, 'status', wc.status,
                 'due_on', wc.due_on, 'closed_at', wc.closed_at, 'column', st.name, 'in_review', wc.review_requested_at IS NOT NULL,
                 'owner', CASE WHEN pp.owner_email IS NULL THEN v_anon ELSE v_names->>pp.owner_email END,
                 'watcher', CASE WHEN pp.watcher_email IS NULL THEN v_anon ELSE v_names->>pp.watcher_email END,
                 'owner_email', pp.owner_email,
                 'watcher_email', pp.watcher_email,
                 'parent', CASE WHEN par.id IS NOT NULL THEN jsonb_build_object('number', par.number, 'title', par.title) END) END,
      'actor_name', COALESCE(
                      CASE WHEN x.source_kind = 'work_due' THEN 'Mingla' END, -- #4255 rework F
                      CASE WHEN e.id IS NOT NULL THEN (v_names->>e.actor_email)
                             || CASE e.via WHEN 'claude' THEN '''s Claude' WHEN 'codex' THEN '''s Codex'
                                           WHEN 'system' THEN ' (Mingla)' ELSE '' END END,
                      public.crm_display_name(lower(btrim(u.email))),
                      'A teammate'),
      'body_excerpt', x.body_excerpt, 'deep_link', x.deep_link,
      'created_at', x.created_at, 'read_at', x.read_at) ORDER BY o.ord), '[]'::jsonb)
    INTO v_page
    FROM unnest(v_ids) WITH ORDINALITY o(id, ord)
    JOIN public.team_mentions x ON x.id = o.id
    LEFT JOIN public.team_messages tmsg ON x.source_kind = 'team_message' AND tmsg.id = x.source_id
    LEFT JOIN public.ops_work_events e ON x.source_kind = 'work_card' AND e.id = x.source_id
    LEFT JOIN public.ops_work_cards wc ON wc.id = e.card_id
    LEFT JOIN public.ops_work_statuses st ON st.id = wc.status_id
    LEFT JOIN public.ops_work_cards par ON par.id = wc.parent_id
    LEFT JOIN LATERAL (SELECT min(p.email) FILTER (WHERE p.role = 'owner') AS owner_email,
                              min(p.email) FILTER (WHERE p.role = 'watcher') AS watcher_email
                         FROM public.ops_work_people p WHERE p.card_id = wc.id) pp ON true
    LEFT JOIN auth.users u ON u.id = x.actor_user_id;

  -- 3. Unread counts over unread rows only.
  SELECT count(*) FILTER (WHERE public.team_inbox_kind(tm.source_kind, e.action) = 'mention'),
         count(*) FILTER (WHERE public.team_inbox_kind(tm.source_kind, e.action) = 'work_update')
    INTO v_unread_mentions, v_unread_updates
    FROM public.team_mentions tm
    LEFT JOIN public.ops_work_events e ON tm.source_kind = 'work_card' AND e.id = tm.source_id
    LEFT JOIN public.team_messages tmsg ON tm.source_kind = 'team_message' AND tmsg.id = tm.source_id
   WHERE tm.target_user_id = v_me
     AND tm.push
     AND tm.read_at IS NULL
     AND (tm.source_kind <> 'team_message'
          OR (tmsg.deleted_at IS NULL AND tmsg.thread_id = ANY (v_threads)));

  -- 4. Alerts: the page first, then the ticket check for those rows only.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', x.id, 'type', x.type, 'title', x.title, 'body', x.body, 'deep_link', x.deep_link,
      'data', x.data, 'created_at', x.created_at, 'read_at', x.read_at,
      'ticket_resolved', public.team_inbox_ticket_resolved(x.data)) ORDER BY x.created_at DESC, x.id DESC), '[]'::jsonb)
    INTO v_alerts
    FROM (SELECT n.id, n.type, n.title, n.body, n.deep_link, n.data, n.created_at, n.read_at
            FROM public.notifications n
           WHERE n.user_id = v_me AND n.type = ANY (v_types)
             AND n.deleted_at IS NULL AND n.in_app_suppressed_at IS NULL
           ORDER BY n.created_at DESC, n.id DESC
           LIMIT v_limit) x;
  SELECT count(*) INTO v_unread_support
    FROM public.notifications n
   WHERE n.user_id = v_me AND n.type = ANY (v_types)
     AND n.deleted_at IS NULL AND n.in_app_suppressed_at IS NULL
     AND n.read_at IS NULL
     AND NOT public.team_inbox_ticket_resolved(n.data);

  RETURN jsonb_build_object(
    'mentions', v_page,
    'alerts', v_alerts,
    'unread', jsonb_build_object('mentions', v_unread_mentions, 'work_updates', v_unread_updates, 'support', v_unread_support));
END;
$function$;

COMMIT;
