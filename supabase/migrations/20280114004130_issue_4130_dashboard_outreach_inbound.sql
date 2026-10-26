-- Issue #4130 (Wave 4a) — Dashboard, Notifications, Hosts and creators,
-- Inbound leads.
--
-- Read-mostly. Every function is SECURITY DEFINER with a pinned search_path,
-- refuses anon and PUBLIC, and checks who is asking before it reads anything:
--
--   admin_dashboard_summary(p_today)       owner/admin. The founder's morning
--       numbers: sign-ups and paid tickets (7 days vs the 7 before, and 8
--       weeks), hosts with and without a next event, support tickets waiting
--       for a first reply, and when the last inbound lead arrived. Counts are
--       taken here, server-side, so no per-user row security can shrink them
--       (the old Dashboard read tables the signed-in admin could only see a
--       slice of). Staff and test accounts are left out (Wave 3 rule).
--   admin_inbound_leads(p_show_test, p_limit)   owner/admin, or the
--       beta_leads area. Beta leads plus WEB free-tool leads only: tool runs
--       inside the Business app are product usage, not leads, and are never
--       listed or counted. Staff and test rows are hidden unless asked for.
--       Web tool leads are shown only to whoever could open the old Tool
--       leads page (owner/admin); merging never widens who sees what.
--   outreach_summary(p_today)              Hosts and Creators (crm area). Per
--       pipeline: cards per stage and the due chips (due today, this week,
--       stale, replied and waiting on us, no region, no due date), counted
--       over every card, not the page on screen.
--   outreach_reset_stale_due(p_pipeline, p_record_ids, p_new_due, p_today)
--       owner/admin, a person (never an agent). Sets a new due date on the
--       listed cards that are still stale (due before today, not Lost or
--       Passed). Each change is written to the pipeline audit log.
--   team_inbox(p_alert_types, p_limit)     an active teammate, own rows only.
--       Mentions split into real mentions (a note or comment that names you)
--       and Work updates (card changes, grouped on the page), each with who
--       did it; support alerts with whether their ticket is already resolved
--       (a resolved ticket's alert is no longer "new").
--   team_inbox_mark_read(p_scope, p_alert_types)  an active teammate, own
--       rows only. Mark all read, per tab.
--   calendar_runway(p_from, p_to, p_today)  Calendar (crm area). The event
--       runway rows of ops_runway_report, each with the event's own start
--       time and time zone (so it is shown in local time, not the viewer's)
--       and whether its brand is staff or test (hidden by default).
--
-- MINGLA-INVARIANT: I-4130-DASHBOARD-ADMIN-AGGREGATES | issue #4130 | the Dashboard numbers come from one admin-only aggregate; a failed read is shown as failed, never as 0.
-- MINGLA-INVARIANT: I-4130-INBOUND-EXCLUDES-APP-RUNS | issue #4130 | Inbound leads list and count beta leads and web tool leads only; app-lane tool runs are never leads.

--------------------------------------------------------------------------------
-- 0. Is a lead a staff or test row? (internal helper, no client grant)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inbound_lead_is_test(p_email text, p_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.admin_internal_email_rule(p_email)
      OR COALESCE(p_name, '') ~* '\m(test|testing|demo|example|asdf)\M'
      OR EXISTS (SELECT 1 FROM public.admin_users au
                  WHERE lower(btrim(au.email)) = lower(btrim(COALESCE(p_email, ''))))
$$;
REVOKE ALL ON FUNCTION public.inbound_lead_is_test(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inbound_lead_is_test(text, text) TO service_role;

--------------------------------------------------------------------------------
-- 1. Dashboard
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_dashboard_summary(p_today date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now    timestamptz := now();
  v_today  date := COALESCE(p_today, (now() AT TIME ZONE 'UTC')::date);
  v_week0  timestamptz := date_trunc('week', now(), 'UTC') - interval '7 weeks';
  v_from   timestamptz;
  v_next   jsonb;
  v_last   timestamptz;
  v_out    jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  v_from := LEAST(v_week0, v_now - interval '14 days');

  -- Host cards that should have something coming up (the same rule Work and
  -- the Calendar use: Replied, Meeting, Onboarded or Live).
  v_next := public.ops_host_next_rows(ARRAY(
    SELECT c.id FROM public.crm_records c
     WHERE c.pipeline = 'hosts' AND c.deleted_at IS NULL
       AND c.stage IN ('replied', 'meeting', 'onboarded', 'live')), v_today);

  SELECT max(x.at) INTO v_last FROM (
    SELECT l.created_at AS at FROM public.tool_leads l
     WHERE l.lane = 'web' AND NOT public.inbound_lead_is_test(l.email, l.input ->> 'name')
    UNION ALL
    SELECT b.created_at FROM public.beta_access_leads b
     WHERE NOT public.inbound_lead_is_test(b.email, b.brand_name)) x;

  WITH su AS MATERIALIZED (
    SELECT p.created_at AS at
      FROM public.profiles p
     WHERE p.created_at >= v_from
       AND COALESCE(p.is_seed, false) = false
       AND NOT public.admin_account_is_internal(p.id)
  ), tk AS MATERIALIZED (
    SELECT o.created_at AS at
      FROM public.tickets t
      JOIN public.orders o ON o.id = t.order_id
     WHERE o.created_at >= v_from
       AND o.payment_status IN ('paid', 'partial_refund')
       AND COALESCE(o.buyer_total_cents, o.total_cents, 0) > 0
  ), wk AS (
    SELECT gs AS week_start FROM generate_series(v_week0, date_trunc('week', v_now, 'UTC'), interval '1 week') gs
  )
  SELECT jsonb_build_object(
    'today', v_today,
    'signups', jsonb_build_object(
      'last7', (SELECT count(*) FROM su WHERE at >= v_now - interval '7 days'),
      'prev7', (SELECT count(*) FROM su WHERE at >= v_now - interval '14 days' AND at < v_now - interval '7 days')),
    'paid_tickets', jsonb_build_object(
      'last7', (SELECT count(*) FROM tk WHERE at >= v_now - interval '7 days'),
      'prev7', (SELECT count(*) FROM tk WHERE at >= v_now - interval '14 days' AND at < v_now - interval '7 days')),
    'weekly', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'week_start', (w.week_start AT TIME ZONE 'UTC')::date,
        'signups', (SELECT count(*) FROM su WHERE su.at >= w.week_start AND su.at < w.week_start + interval '1 week'),
        'paid_tickets', (SELECT count(*) FROM tk WHERE tk.at >= w.week_start AND tk.at < w.week_start + interval '1 week'))
        ORDER BY w.week_start), '[]'::jsonb) FROM wk w),
    'hosts', jsonb_build_object(
      'with_next', (SELECT count(*) FROM jsonb_array_elements(v_next) r WHERE r -> 'next' IS NOT NULL AND r -> 'next' <> 'null'::jsonb),
      'without_next', (SELECT count(*) FROM jsonb_array_elements(v_next) r WHERE (r ->> 'needs_next')::boolean)),
    'support', jsonb_build_object(
      'waiting_first_reply', (SELECT count(*) FROM public.support_tickets s
                               WHERE s.status IN ('new', 'open') AND s.first_response_at IS NULL),
      'oldest_waiting_at', (SELECT min(s.created_at) FROM public.support_tickets s
                             WHERE s.status IN ('new', 'open') AND s.first_response_at IS NULL),
      'open', (SELECT count(*) FROM public.support_tickets s WHERE s.status IN ('new', 'open', 'pending'))),
    'inbound', jsonb_build_object(
      'last_lead_at', v_last,
      'days_since_last', CASE WHEN v_last IS NULL THEN NULL ELSE (v_today - (v_last AT TIME ZONE 'UTC')::date) END),
    'as_of', v_now
  ) INTO v_out;

  RETURN v_out;
END;
$$;
COMMENT ON FUNCTION public.admin_dashboard_summary(date) IS
  'Issue #4130: the Dashboard''s numbers in one admin-only read. Sign-ups (non-seed, staff and test left out) and paid tickets (tickets of paid or partly refunded orders with money paid), 7 days vs the 7 before and 8 weeks; host cards with and without a next event (ops_host_next_rows); support tickets waiting for a first reply; the last non-test inbound lead.';
REVOKE ALL ON FUNCTION public.admin_dashboard_summary(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_summary(date) TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 2. Inbound leads
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_inbound_leads(
  p_show_test boolean DEFAULT false,
  p_limit integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tools boolean;
  v_beta  boolean;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000);
  v_out   jsonb;
BEGIN
  IF NOT (public.is_admin_user() OR COALESCE(public.admin_team_can('beta_leads'), false)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  -- Each half only to whoever could open its old page.
  v_tools := public.is_admin_user();
  v_beta  := v_tools OR COALESCE(public.admin_team_can('beta_leads'), false);

  WITH leads AS MATERIALIZED (
    SELECT b.id, 'beta'::text AS source, b.created_at, NULLIF(btrim(b.brand_name), '') AS business,
           NULLIF(btrim(b.city), '') AS city, NULL::text AS tool,
           (NULLIF(btrim(b.email), '') IS NOT NULL) AS has_email,
           public.inbound_lead_is_test(b.email, b.brand_name) AS is_test,
           COALESCE(
             (SELECT jsonb_build_object('id', r.id, 'name', r.name, 'stage', r.stage)
                FROM public.crm_records r
               WHERE r.pipeline = 'hosts' AND r.deleted_at IS NULL AND r.beta_lead_id = b.id LIMIT 1),
             (SELECT jsonb_build_object('id', r.id, 'name', r.name, 'stage', r.stage)
                FROM public.crm_records r
               WHERE r.pipeline = 'hosts' AND r.deleted_at IS NULL
                 AND r.name_key = public.crm_name_key(b.brand_name) LIMIT 1)) AS host
      FROM public.beta_access_leads b
     WHERE v_beta
    UNION ALL
    SELECT l.id, 'tool', l.created_at, NULLIF(btrim(l.input ->> 'name'), ''),
           NULLIF(btrim(l.input ->> 'city'), ''), l.tool,
           (NULLIF(btrim(l.email), '') IS NOT NULL),
           public.inbound_lead_is_test(l.email, l.input ->> 'name'),
           CASE WHEN NULLIF(btrim(l.input ->> 'name'), '') IS NULL THEN NULL ELSE
             (SELECT jsonb_build_object('id', r.id, 'name', r.name, 'stage', r.stage)
                FROM public.crm_records r
               WHERE r.pipeline = 'hosts' AND r.deleted_at IS NULL
                 AND r.name_key = public.crm_name_key(l.input ->> 'name') LIMIT 1) END
      FROM public.tool_leads l
     WHERE v_tools AND l.lane = 'web'
  ), real AS (
    SELECT * FROM leads WHERE NOT is_test
  )
  SELECT jsonb_build_object(
    'can_see', jsonb_build_object('beta', v_beta, 'tools', v_tools),
    'summary', jsonb_build_object(
      'total', (SELECT count(*) FROM real),
      'beta', (SELECT count(*) FROM real WHERE source = 'beta'),
      'tools', (SELECT count(*) FROM real WHERE source = 'tool'),
      'with_email', (SELECT count(*) FROM real WHERE has_email),
      'in_hosts', (SELECT count(*) FROM real WHERE host IS NOT NULL),
      'last_30_days', (SELECT count(*) FROM real WHERE created_at >= now() - interval '30 days'),
      'last_lead_at', (SELECT max(created_at) FROM real),
      'test_hidden', (SELECT count(*) FROM leads WHERE is_test)),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', x.id, 'source', x.source, 'created_at', x.created_at, 'business', x.business,
        'city', x.city, 'tool', x.tool, 'has_email', x.has_email, 'is_test', x.is_test, 'host', x.host)
        ORDER BY x.created_at DESC, x.id)
      FROM (SELECT * FROM leads WHERE p_show_test OR NOT is_test
             ORDER BY created_at DESC, id LIMIT v_limit) x), '[]'::jsonb),
    'truncated', (SELECT count(*) FROM leads WHERE p_show_test OR NOT is_test) > v_limit,
    'as_of', now()
  ) INTO v_out;

  RETURN v_out;
END;
$$;
COMMENT ON FUNCTION public.admin_inbound_leads(boolean, integer) IS
  'Issue #4130: Inbound leads. Beta leads (owner/admin or the beta_leads area) and WEB tool leads (owner/admin only); app-lane tool runs are product usage and never appear. Staff and test rows hidden unless asked for. Never returns an email address, only whether there is one.';
REVOKE ALL ON FUNCTION public.admin_inbound_leads(boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_inbound_leads(boolean, integer) TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 3. Hosts and creators: the funnel and the due chips over every card
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.outreach_summary(p_today date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v       record;
  v_today date := COALESCE(p_today, (now() AT TIME ZONE 'UTC')::date);
  v_out   jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();

  SELECT jsonb_build_object(
    'today', v_today,
    'pipelines', COALESCE(jsonb_object_agg(p.pipeline, p.body), '{}'::jsonb)
  ) INTO v_out
  FROM (
    SELECT c.pipeline, jsonb_build_object(
      'total', count(*),
      'stages', (SELECT COALESCE(jsonb_object_agg(s.stage, s.n), '{}'::jsonb) FROM (
          SELECT c2.stage, count(*) AS n FROM public.crm_records c2
           WHERE c2.pipeline = c.pipeline AND c2.deleted_at IS NULL GROUP BY c2.stage) s),
      'due_today', count(*) FILTER (WHERE c.due_on = v_today AND c.stage NOT IN ('lost', 'passed')),
      'due_week', count(*) FILTER (WHERE c.due_on >= v_today AND c.due_on <= v_today + 6 AND c.stage NOT IN ('lost', 'passed')),
      'stale', count(*) FILTER (WHERE c.due_on < v_today AND c.stage NOT IN ('lost', 'passed')),
      'replied', count(*) FILTER (WHERE c.stage = 'replied'),
      'no_region', count(*) FILTER (WHERE c.region_id IS NULL AND c.stage NOT IN ('lost', 'passed')),
      'no_due', count(*) FILTER (WHERE c.due_on IS NULL AND c.stage NOT IN ('lost', 'passed'))
    ) AS body
    FROM public.crm_records c
    WHERE c.deleted_at IS NULL
    GROUP BY c.pipeline
  ) p;

  RETURN v_out;
END;
$$;
COMMENT ON FUNCTION public.outreach_summary(date) IS
  'Issue #4130: Hosts and creators funnel and due chips, counted over every card of each pipeline. Stale = due before today and not Lost or Passed. Anyone with the crm area.';
REVOKE ALL ON FUNCTION public.outreach_summary(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.outreach_summary(date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.outreach_reset_stale_due(
  p_pipeline text,
  p_record_ids uuid[],
  p_new_due date,
  p_today date
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v      record;
  r      record;
  v_n    integer := 0;
  v_asked integer := COALESCE(cardinality(p_record_ids), 0);
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden: Only the owner or an admin can reset due dates in bulk.' USING ERRCODE = '42501';
  END IF;
  IF v.via IS NOT NULL THEN
    RAISE EXCEPTION 'field_not_for_agents: Only a person can reset due dates in bulk. Ask your person.' USING ERRCODE = '42501';
  END IF;
  IF p_pipeline IS NULL OR p_pipeline NOT IN ('hosts', 'creators') THEN
    RAISE EXCEPTION 'invalid_pipeline: Choose Hosts or Creators.' USING ERRCODE = '22023';
  END IF;
  IF p_today IS NULL OR p_new_due IS NULL OR p_new_due < p_today OR p_new_due > p_today + 365 THEN
    RAISE EXCEPTION 'invalid_due: Pick a new due date from today up to a year ahead.' USING ERRCODE = '22023';
  END IF;
  IF v_asked = 0 OR v_asked > 2000 THEN
    RAISE EXCEPTION 'invalid_records: Send between 1 and 2,000 cards.' USING ERRCODE = '22023';
  END IF;

  -- Only cards that are still stale: one changed or finished meanwhile is left alone.
  FOR r IN SELECT c.id, c.due_on FROM public.crm_records c
            WHERE c.id = ANY (p_record_ids) AND c.pipeline = p_pipeline AND c.deleted_at IS NULL
              AND c.due_on < p_today AND c.stage NOT IN ('lost', 'passed')
            ORDER BY c.id
            FOR UPDATE LOOP
    UPDATE public.crm_records
       SET due_on = p_new_due, updated_by = v.actor_email, updated_at = clock_timestamp()
     WHERE id = r.id;
    PERFORM public.crm_audit(v.actor_email, 'crm.record_update', 'crm_record', r.id::text,
      jsonb_build_object('bulk', 'stale_due_reset',
                         'before', jsonb_build_object('due_on', r.due_on),
                         'after', jsonb_build_object('due_on', p_new_due)));
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('reset', v_n, 'skipped', v_asked - v_n, 'due_on', p_new_due);
END;
$$;
COMMENT ON FUNCTION public.outreach_reset_stale_due(text, uuid[], date, date) IS
  'Issue #4130: bulk "reset due dates" for stale Hosts or Creators cards. Owner/admin, a person only. Changes only the listed cards that are still stale; each change goes to the pipeline audit log.';
REVOKE ALL ON FUNCTION public.outreach_reset_stale_due(text, uuid[], date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.outreach_reset_stale_due(text, uuid[], date, date) TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 4. Notifications inbox
--------------------------------------------------------------------------------
-- Which in-app alert types the inbox may read: support and product alerts only.
CREATE OR REPLACE FUNCTION public.team_inbox_alert_types(p_types text[])
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(array_agg(DISTINCT t), ARRAY[]::text[])
    FROM unnest(COALESCE(p_types, ARRAY[]::text[])) t
   WHERE t ~ '^(business\.support_|admin\.support_|admin\.product_signal_)[a-z_]{1,60}$'
$$;
REVOKE ALL ON FUNCTION public.team_inbox_alert_types(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_inbox_alert_types(text[]) TO service_role;

-- A mention row is a real mention (a note or comment naming you) or a Work update.
CREATE OR REPLACE FUNCTION public.team_inbox_kind(p_source_kind text, p_action text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN p_source_kind IS DISTINCT FROM 'work_card' OR p_action = 'note' THEN 'mention' ELSE 'work_update' END
$$;
REVOKE ALL ON FUNCTION public.team_inbox_kind(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_inbox_kind(text, text) TO service_role;

-- Is the support ticket an alert points at already resolved or closed?
CREATE OR REPLACE FUNCTION public.team_inbox_ticket_resolved(p_data jsonb)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.support_tickets s
     WHERE s.status IN ('resolved', 'closed')
       AND s.id::text = COALESCE(p_data ->> 'ticket_id', p_data ->> 'ticketId'))
$$;
REVOKE ALL ON FUNCTION public.team_inbox_ticket_resolved(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_inbox_ticket_resolved(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.team_inbox(
  p_alert_types text[] DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me    uuid := auth.uid();
  v_types text[];
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
BEGIN
  IF NOT public.issue_3720_active_team_member(v_me) THEN
    RAISE EXCEPTION 'team_access_required' USING ERRCODE = '42501';
  END IF;
  v_types := public.team_inbox_alert_types(p_alert_types);

  RETURN (
    WITH m AS MATERIALIZED (
      SELECT tm.id, tm.source_kind, tm.created_at, tm.read_at, tm.body_excerpt, tm.deep_link,
             e.card_id, e.action,
             public.team_inbox_kind(tm.source_kind, e.action) AS kind,
             COALESCE(
               CASE WHEN e.id IS NOT NULL THEN public.ops_actor_label(e.actor_email, e.via) END,
               public.crm_display_name(lower(btrim(u.email))),
               'A teammate') AS actor
        FROM public.team_mentions tm
        LEFT JOIN public.ops_work_events e ON tm.source_kind = 'work_card' AND e.id = tm.source_id
        LEFT JOIN auth.users u ON u.id = tm.actor_user_id
       WHERE tm.target_user_id = v_me
    ), a AS MATERIALIZED (
      SELECT n.id, n.type, n.title, n.body, n.deep_link, n.data, n.created_at, n.read_at,
             public.team_inbox_ticket_resolved(n.data) AS ticket_resolved
        FROM public.notifications n
       WHERE n.user_id = v_me AND n.type = ANY (v_types)
         AND n.deleted_at IS NULL AND n.in_app_suppressed_at IS NULL
    )
    SELECT jsonb_build_object(
      'mentions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', x.id, 'kind', x.kind, 'source_kind', x.source_kind, 'card_id', x.card_id, 'action', x.action,
          'actor_name', x.actor, 'body_excerpt', x.body_excerpt, 'deep_link', x.deep_link,
          'created_at', x.created_at, 'read_at', x.read_at) ORDER BY x.created_at DESC, x.id DESC)
        FROM (SELECT * FROM m ORDER BY created_at DESC, id DESC LIMIT v_limit) x), '[]'::jsonb),
      'alerts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', x.id, 'type', x.type, 'title', x.title, 'body', x.body, 'deep_link', x.deep_link,
          'data', x.data, 'created_at', x.created_at, 'read_at', x.read_at,
          'ticket_resolved', x.ticket_resolved) ORDER BY x.created_at DESC, x.id DESC)
        FROM (SELECT * FROM a ORDER BY created_at DESC, id DESC LIMIT v_limit) x), '[]'::jsonb),
      'unread', jsonb_build_object(
        'mentions', (SELECT count(*) FROM m WHERE kind = 'mention' AND read_at IS NULL),
        'work_updates', (SELECT count(*) FROM m WHERE kind = 'work_update' AND read_at IS NULL),
        'support', (SELECT count(*) FROM a WHERE read_at IS NULL AND NOT ticket_resolved))
    )
  );
END;
$$;
COMMENT ON FUNCTION public.team_inbox(text[], integer) IS
  'Issue #4130: the signed-in teammate''s own inbox. Mentions split into real mentions and Work updates with who did it; support alerts with whether their ticket is already resolved (then never unread). Own rows only.';
REVOKE ALL ON FUNCTION public.team_inbox(text[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_inbox(text[], integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.team_inbox_mark_read(
  p_scope text DEFAULT 'all',
  p_alert_types text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me    uuid := auth.uid();
  v_types text[];
  v_m     integer := 0;
  v_a     integer := 0;
BEGIN
  IF NOT public.issue_3720_active_team_member(v_me) THEN
    RAISE EXCEPTION 'team_access_required' USING ERRCODE = '42501';
  END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('all', 'mentions', 'work_updates', 'support') THEN
    RAISE EXCEPTION 'invalid_scope' USING ERRCODE = '22023';
  END IF;
  v_types := public.team_inbox_alert_types(p_alert_types);

  IF p_scope IN ('all', 'mentions', 'work_updates') THEN
    UPDATE public.team_mentions tm
       SET read_at = now()
      FROM (SELECT tm2.id, public.team_inbox_kind(tm2.source_kind, e.action) AS kind
              FROM public.team_mentions tm2
              LEFT JOIN public.ops_work_events e ON tm2.source_kind = 'work_card' AND e.id = tm2.source_id
             WHERE tm2.target_user_id = v_me AND tm2.read_at IS NULL) k
     WHERE tm.id = k.id
       AND (p_scope = 'all' OR (p_scope = 'mentions' AND k.kind = 'mention')
            OR (p_scope = 'work_updates' AND k.kind = 'work_update'));
    GET DIAGNOSTICS v_m = ROW_COUNT;
  END IF;

  IF p_scope IN ('all', 'support') THEN
    UPDATE public.notifications n
       SET read_at = now(), is_read = true
     WHERE n.user_id = v_me AND n.type = ANY (v_types) AND n.read_at IS NULL;
    GET DIAGNOSTICS v_a = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('mentions', v_m, 'alerts', v_a);
END;
$$;
COMMENT ON FUNCTION public.team_inbox_mark_read(text, text[]) IS
  'Issue #4130: Mark all read on the Notifications inbox (all, mentions, Work updates or support). Own rows only.';
REVOKE ALL ON FUNCTION public.team_inbox_mark_read(text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_inbox_mark_read(text, text[]) TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 5. Calendar: the runway in each event's own time, test brands marked
--------------------------------------------------------------------------------
-- Is a brand staff or test? Deleted, a staff/test owner (Wave 3 rule), or a
-- name that says test.
CREATE OR REPLACE FUNCTION public.calendar_brand_is_test(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((
    SELECT b.deleted_at IS NOT NULL
        OR (b.account_id IS NOT NULL AND public.admin_account_is_internal(b.account_id))
        OR COALESCE(b.name, '') ~* '\m(test|testing|demo)\M'
      FROM public.brands b WHERE b.id = p_brand_id), false)
$$;
REVOKE ALL ON FUNCTION public.calendar_brand_is_test(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_brand_is_test(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.calendar_runway(
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_today date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v        record;
  v_report jsonb;
  v_rows   jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_report := public.ops_runway_report(p_from, p_to, p_today);

  SELECT COALESCE(jsonb_agg(r.row || x.extra ORDER BY r.ord), '[]'::jsonb) INTO v_rows
    FROM jsonb_array_elements(v_report -> 'rows') WITH ORDINALITY AS r(row, ord)
    CROSS JOIN LATERAL (
      SELECT CASE WHEN r.row ->> 'anchor_kind' = 'event' THEN (
        SELECT jsonb_build_object(
          'brand_id', e.brand_id,
          'brand_name', (SELECT b.name FROM public.brands b WHERE b.id = e.brand_id),
          'is_test', public.calendar_brand_is_test(e.brand_id),
          'timezone', COALESCE(d.timezone, e.timezone),
          'start_at', d.start_at)
          FROM public.events e
          LEFT JOIN LATERAL (
            SELECT ed.start_at, ed.timezone FROM public.event_dates ed
             WHERE ed.event_id = e.id
               AND (ed.start_at AT TIME ZONE COALESCE(NULLIF(ed.timezone, ''), NULLIF(e.timezone, ''), 'UTC'))::date
                   = (r.row ->> 'start_on')::date
             ORDER BY ed.start_at LIMIT 1) d ON true
         WHERE e.id = (r.row ->> 'anchor_id')::uuid)
      ELSE (
        SELECT jsonb_build_object(
          'brand_id', c.brand_id,
          'brand_name', (SELECT b.name FROM public.brands b WHERE b.id = c.brand_id),
          'is_test', COALESCE(public.calendar_brand_is_test(c.brand_id), false),
          'timezone', NULL, 'start_at', NULL)
          FROM public.ops_expected_events x
          LEFT JOIN public.crm_records c ON c.id = x.record_id
         WHERE x.id = (r.row ->> 'anchor_id')::uuid)
      END AS extra
    ) x;

  RETURN (v_report - 'rows' - 'at_risk')
    || jsonb_build_object(
      'rows', v_rows,
      'test_hidden', (SELECT count(*) FROM jsonb_array_elements(v_rows) z WHERE (z ->> 'is_test')::boolean));
END;
$$;
COMMENT ON FUNCTION public.calendar_runway(date, date, date) IS
  'Issue #4130: the Calendar''s event runway (ops_runway_report rows) with each event''s own start time and time zone, and whether its brand is staff or test. Anyone with the crm area.';
REVOKE ALL ON FUNCTION public.calendar_runway(date, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_runway(date, date, date) TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 6. Self-check
--------------------------------------------------------------------------------
DO $w4a$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.admin_dashboard_summary(date)',
    'public.admin_inbound_leads(boolean,integer)',
    'public.outreach_summary(date)',
    'public.outreach_reset_stale_due(text,uuid[],date,date)',
    'public.team_inbox(text[],integer)',
    'public.team_inbox_mark_read(text,text[])',
    'public.calendar_runway(date,date,date)'
  ] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue #4130 wave 4a: % is executable by anon', v_fn;
    END IF;
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_fn::regprocedure) THEN
      RAISE EXCEPTION 'issue #4130 wave 4a: % is not SECURITY DEFINER', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.inbound_lead_is_test(text,text)',
    'public.team_inbox_alert_types(text[])',
    'public.team_inbox_kind(text,text)',
    'public.team_inbox_ticket_resolved(jsonb)',
    'public.calendar_brand_is_test(uuid)'
  ] LOOP
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE') OR has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue #4130 wave 4a: helper % is callable from the browser', v_fn;
    END IF;
  END LOOP;
END
$w4a$;
