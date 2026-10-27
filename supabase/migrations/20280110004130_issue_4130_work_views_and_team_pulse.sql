-- Issue #4130, Wave 1: the Work page's Today, This week and This month views,
-- and the Team dashboard's row of numbers.
--
-- Three read-only functions. Each returns counts and card titles that the
-- caller can already see on the Work board or the Team dashboard; none of
-- them writes anything.
--
--   * ops_events_since(p_since, p_owner): what changed on Work cards since a
--     moment (at most 62 days back), newest first, up to 200 lines, plus per
--     person counts (cards they closed since then as an owner, cards they
--     added, changes they made). Undone changes and removed cards are left
--     out. With p_owner, only changes that person made or that touched a
--     card they own. Same gate as ops_log_list: crm_ctx() (the crm area).
--   * ops_period_summary(p_from, p_to, p_owner, p_tz): the weekly and monthly
--     review. Cards closed (a "not needed" push back is not counted as
--     closed), opened, closed on or before their due date, carried into a new
--     sprint (once, and two or more times), overdue now; the same per person
--     (by current owner); closed per week by person (weeks start on Monday in
--     p_tz); the biggest things shipped (closed, written by a person, with a
--     linked GitHub issue or pull request first); what kept slipping (carried
--     two or more times in the period); and the review list (open cards that
--     are overdue, quiet for 7 days in progress, or have no owner). At most
--     120 days. Same gate as ops_log_list: crm_ctx().
--   * crm_team_pulse(p_from, p_to): the Team dashboard's numbers for a
--     period and the period of the same length before it: hosts contacted
--     (an outbound touch or a move to Contacted), hosts onboarded (a move to
--     Onboarded or Live), creator records moved into each stage, host
--     records moved into each stage, and beta leads that arrived. Distinct
--     records, never people's details. Same gate as crm_team_summary:
--     an owner or admin (is_admin_user()) with the crm area (crm_ctx()).
--
-- Every function is SECURITY DEFINER with a pinned search_path, runnable by
-- signed-in users only (the gate inside refuses everyone else), never by
-- anon or PUBLIC. Two internal helpers (ops_events_window, ops_period_cards)
-- hold the shared row sets and are callable by no client role.
--
-- ROLLBACK: DROP FUNCTION public.ops_events_since(timestamptz, text),
-- public.ops_events_window(timestamptz, text),
-- public.ops_period_cards(timestamptz, timestamptz, text),
-- public.ops_period_summary(timestamptz, timestamptz, text, text),
-- public.crm_team_pulse(timestamptz, timestamptz), and restore
-- public.ops_my_counts(date) from 20271201003980 (it gains one key,
-- waiting_on_person_mine). Nothing else changes.

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. What changed since a moment.
-- ---------------------------------------------------------------------------
-- Internal: the changes ops_events_since reads (not callable by clients).
CREATE OR REPLACE FUNCTION public.ops_events_window(p_since timestamptz, p_owner text)
RETURNS TABLE (id uuid, card_id uuid, at timestamptz, actor_email text, via text, action text, after_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT e.id, e.card_id, e.at, e.actor_email, e.via, e.action, CASE WHEN jsonb_typeof(e.after) = 'object' THEN e.after->>'status' END
    FROM public.ops_work_events e
    JOIN public.ops_work_cards w ON w.id = e.card_id AND w.archived_at IS NULL
   WHERE e.at >= p_since
     AND e.undone_at IS NULL AND e.action <> 'undone'
     AND (p_owner IS NULL OR e.actor_email = p_owner
          OR EXISTS (SELECT 1 FROM public.ops_work_people p WHERE p.card_id = e.card_id AND p.email = p_owner AND p.role = 'owner'))
$$;
REVOKE ALL ON FUNCTION public.ops_events_window(timestamptz, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ops_events_since(p_since timestamptz, p_owner text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v record;
  v_owner text;
  v_limit constant integer := 200;
  v_total integer;
  v_entries jsonb;
  v_people jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_since IS NULL OR p_since > now() + interval '1 minute' OR p_since < now() - interval '62 days' THEN
    RAISE EXCEPTION 'invalid_query: Pick a moment in the last 62 days.' USING ERRCODE = '22023';
  END IF;
  IF p_owner IS NOT NULL AND btrim(p_owner) <> '' THEN
    v_owner := COALESCE(public.ops_team_email(p_owner), lower(btrim(p_owner)));
  END IF;

  SELECT count(*) INTO v_total FROM public.ops_events_window(p_since, v_owner);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', x.id, 'at', x.at, 'action', x.action, 'via', x.via,
           'actor_email', x.actor_email, 'actor_name', public.ops_name(x.actor_email),
           'to_status', x.after_status,
           'card', jsonb_build_object('id', w.id, 'number', w.number, 'title', w.title, 'status', w.status))
         ORDER BY x.at DESC, x.id), '[]'::jsonb)
    INTO v_entries
    FROM (SELECT * FROM public.ops_events_window(p_since, v_owner) ORDER BY at DESC, id LIMIT v_limit) x
    JOIN public.ops_work_cards w ON w.id = x.card_id;

  -- Per person: cards closed since then that they own, cards they added,
  -- and changes they made.
  WITH closed AS (
    SELECT p.email, count(DISTINCT w.id) AS n
      FROM public.ops_work_cards w
      JOIN public.ops_work_people p ON p.card_id = w.id AND p.role = 'owner'
     WHERE w.archived_at IS NULL AND w.status = 'done' AND w.closed_at >= p_since
       AND COALESCE(w.close_kind, '') <> 'declined'
     GROUP BY p.email
  ), added AS (
    SELECT w.created_by AS email, count(*) AS n
      FROM public.ops_work_cards w
     WHERE w.archived_at IS NULL AND w.created_at >= p_since
     GROUP BY w.created_by
  ), acted AS (
    SELECT actor_email AS email, count(*) AS n FROM public.ops_events_window(p_since, v_owner) GROUP BY actor_email
  ), everyone AS (
    SELECT email FROM closed UNION SELECT email FROM added UNION SELECT email FROM acted
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'email', p.email, 'name', public.ops_name(p.email),
           'closed', COALESCE(c.n, 0), 'added', COALESCE(a.n, 0), 'changes', COALESCE(t.n, 0))
         ORDER BY COALESCE(c.n, 0) DESC, COALESCE(t.n, 0) DESC, p.email), '[]'::jsonb)
    INTO v_people
    FROM everyone p
    LEFT JOIN closed c ON c.email = p.email
    LEFT JOIN added a ON a.email = p.email
    LEFT JOIN acted t ON t.email = p.email
   WHERE p.email IS NOT NULL
     AND (v_owner IS NULL OR p.email = v_owner);

  RETURN jsonb_build_object('since', p_since, 'owner', v_owner, 'entries', v_entries, 'total', v_total,
                            'truncated', v_total > v_limit, 'by_person', v_people);
END;
$$;
REVOKE ALL ON FUNCTION public.ops_events_since(timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_events_since(timestamptz, text) TO authenticated;
COMMENT ON FUNCTION public.ops_events_since(timestamptz, text) IS
  'Issue #4130. Work › Today: what changed on Work cards since a moment (at most 62 days back), newest 200, plus per person closed/added/changes. Gate: crm_ctx(), as ops_log_list.';

-- ---------------------------------------------------------------------------
-- 2. The weekly and monthly review.
-- ---------------------------------------------------------------------------
-- Internal: the cards ops_period_summary counts (not removed; owned by
-- p_owner when given), with how often each was carried in the period.
CREATE OR REPLACE FUNCTION public.ops_period_cards(p_from timestamptz, p_to timestamptz, p_owner text)
RETURNS TABLE (id uuid, number bigint, title text, status text, due_on date, created_at timestamptz, closed_at timestamptz,
               close_kind text, updated_at timestamptz, auto boolean, carried_in integer, has_github boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT w.id, w.number, w.title, w.status, w.due_on, w.created_at, w.closed_at, w.close_kind, w.updated_at, w.auto_key IS NOT NULL,
         (SELECT count(*) FROM public.ops_work_events e
           WHERE e.card_id = w.id AND e.action = 'carried' AND e.undone_at IS NULL AND e.at >= p_from AND e.at < p_to)::integer,
         EXISTS (SELECT 1 FROM public.ops_work_github g WHERE g.card_id = w.id)
    FROM public.ops_work_cards w
   WHERE w.archived_at IS NULL
     AND (p_owner IS NULL OR EXISTS (SELECT 1 FROM public.ops_work_people p WHERE p.card_id = w.id AND p.email = p_owner AND p.role = 'owner'))
$$;
REVOKE ALL ON FUNCTION public.ops_period_cards(timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ops_period_summary(p_from timestamptz, p_to timestamptz, p_owner text DEFAULT NULL, p_tz text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v record;
  v_owner text;
  v_tz text := 'UTC';
  v_today date;
  v_totals jsonb;
  v_people jsonb;
  v_weeks jsonb;
  v_shipped jsonb;
  v_slipping jsonb;
  v_review jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '120 days'
     OR p_to > now() + interval '1 day' THEN
    RAISE EXCEPTION 'invalid_query: Pick a period of at most 120 days that has started.' USING ERRCODE = '22023';
  END IF;
  IF p_tz IS NOT NULL AND btrim(p_tz) <> '' THEN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = p_tz) THEN
      RAISE EXCEPTION 'invalid_query: That time zone is not known.' USING ERRCODE = '22023';
    END IF;
    v_tz := p_tz;
  END IF;
  IF p_owner IS NOT NULL AND btrim(p_owner) <> '' THEN
    v_owner := COALESCE(public.ops_team_email(p_owner), lower(btrim(p_owner)));
  END IF;
  v_today := (now() AT TIME ZONE v_tz)::date;

  SELECT jsonb_build_object(
           'closed', count(*) FILTER (WHERE c.status = 'done' AND c.closed_at >= p_from AND c.closed_at < p_to AND COALESCE(c.close_kind, '') <> 'declined'),
           'on_time', count(*) FILTER (WHERE c.status = 'done' AND c.closed_at >= p_from AND c.closed_at < p_to AND COALESCE(c.close_kind, '') <> 'declined'
                                         AND (c.closed_at AT TIME ZONE v_tz)::date <= c.due_on),
           'opened', count(*) FILTER (WHERE c.created_at >= p_from AND c.created_at < p_to),
           'overdue_now', count(*) FILTER (WHERE c.status <> 'done' AND c.due_on < v_today),
           'open_now', count(*) FILTER (WHERE c.status <> 'done'),
           'carried', count(*) FILTER (WHERE c.carried_in >= 1),
           'carried_twice', count(*) FILTER (WHERE c.carried_in >= 2))
    INTO v_totals
    FROM public.ops_period_cards(p_from, p_to, v_owner) c;

  WITH owned AS (
    SELECT p.email, c.*
      FROM public.ops_period_cards(p_from, p_to, v_owner) c
      JOIN public.ops_work_people p ON p.card_id = c.id AND p.role = 'owner'
     WHERE v_owner IS NULL OR p.email = v_owner
  )
  SELECT COALESCE(jsonb_agg(x.row_ ORDER BY (x.row_->>'closed')::integer DESC, x.row_->>'name'), '[]'::jsonb) INTO v_people
    FROM (
      SELECT jsonb_build_object(
               'email', o.email, 'name', public.ops_name(o.email),
               'closed', count(*) FILTER (WHERE o.status = 'done' AND o.closed_at >= p_from AND o.closed_at < p_to AND COALESCE(o.close_kind, '') <> 'declined'),
               'on_time', count(*) FILTER (WHERE o.status = 'done' AND o.closed_at >= p_from AND o.closed_at < p_to AND COALESCE(o.close_kind, '') <> 'declined'
                                             AND (o.closed_at AT TIME ZONE v_tz)::date <= o.due_on),
               'opened', count(*) FILTER (WHERE o.created_at >= p_from AND o.created_at < p_to),
               'open_now', count(*) FILTER (WHERE o.status <> 'done'),
               'late_now', count(*) FILTER (WHERE o.status <> 'done' AND o.due_on < v_today),
               'quiet_now', count(*) FILTER (WHERE o.status = 'doing' AND o.updated_at < now() - interval '7 days'),
               'carried', count(*) FILTER (WHERE o.carried_in >= 1)) AS row_
        FROM owned o
       GROUP BY o.email
    ) x;

  -- Closed per week, weeks starting Monday in the caller's time zone.
  WITH weeks AS (
    SELECT gs AS starts_local
      FROM generate_series(date_trunc('week', p_from AT TIME ZONE v_tz), (p_to - interval '1 microsecond') AT TIME ZONE v_tz, interval '7 days') gs
  ), closed AS (
    SELECT date_trunc('week', c.closed_at AT TIME ZONE v_tz) AS wk, p.email
      FROM public.ops_period_cards(p_from, p_to, v_owner) c
      LEFT JOIN public.ops_work_people p ON p.card_id = c.id AND p.role = 'owner' AND (v_owner IS NULL OR p.email = v_owner)
     WHERE c.status = 'done' AND c.closed_at >= p_from AND c.closed_at < p_to AND COALESCE(c.close_kind, '') <> 'declined'
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'week', w.starts_local::date,
           'closed', (SELECT count(*) FROM public.ops_period_cards(p_from, p_to, v_owner) c
                       WHERE c.status = 'done' AND COALESCE(c.close_kind, '') <> 'declined'
                         AND c.closed_at >= GREATEST(p_from, w.starts_local AT TIME ZONE v_tz)
                         AND c.closed_at < LEAST(p_to, (w.starts_local + interval '7 days') AT TIME ZONE v_tz)),
           'by_person', COALESCE((SELECT jsonb_object_agg(k.email, k.n) FROM (
                            SELECT cl.email, count(*) AS n FROM closed cl
                             WHERE cl.wk = w.starts_local AND cl.email IS NOT NULL GROUP BY cl.email) k), '{}'::jsonb))
         ORDER BY w.starts_local), '[]'::jsonb)
    INTO v_weeks
    FROM weeks w;

  SELECT COALESCE(jsonb_agg(s.row_ ORDER BY s.github DESC, s.closed_at DESC), '[]'::jsonb) INTO v_shipped
    FROM (
      SELECT c.has_github AS github, c.closed_at,
             jsonb_build_object('id', c.id, 'number', c.number, 'title', c.title, 'closed_at', c.closed_at, 'github', c.has_github,
               'owners', COALESCE((SELECT jsonb_agg(public.ops_name(p.email) ORDER BY p.added_at, p.email)
                                     FROM public.ops_work_people p WHERE p.card_id = c.id AND p.role = 'owner'), '[]'::jsonb)) AS row_
        FROM public.ops_period_cards(p_from, p_to, v_owner) c
       WHERE c.status = 'done' AND c.close_kind = 'done' AND NOT c.auto AND c.closed_at >= p_from AND c.closed_at < p_to
       ORDER BY c.has_github DESC, c.closed_at DESC
       LIMIT 8
    ) s;

  SELECT COALESCE(jsonb_agg(s.row_ ORDER BY s.times DESC, s.number), '[]'::jsonb) INTO v_slipping
    FROM (
      SELECT c.carried_in AS times, c.number,
             jsonb_build_object('id', c.id, 'number', c.number, 'title', c.title, 'status', c.status, 'times', c.carried_in,
               'first_carried_at', (SELECT min(e.at) FROM public.ops_work_events e
                                     WHERE e.card_id = c.id AND e.action = 'carried' AND e.undone_at IS NULL AND e.at >= p_from AND e.at < p_to),
               'owners', COALESCE((SELECT jsonb_agg(public.ops_name(p.email) ORDER BY p.added_at, p.email)
                                     FROM public.ops_work_people p WHERE p.card_id = c.id AND p.role = 'owner'), '[]'::jsonb)) AS row_
        FROM public.ops_period_cards(p_from, p_to, v_owner) c
       WHERE c.carried_in >= 2
       ORDER BY c.carried_in DESC, c.number
       LIMIT 10
    ) s;

  -- Talk about these in the weekly: open cards that are late, quiet or have no owner.
  SELECT COALESCE(jsonb_agg(r.row_ ORDER BY r.late_days DESC NULLS LAST, r.number), '[]'::jsonb) INTO v_review
    FROM (
      SELECT c.number, GREATEST(v_today - c.due_on, 0) AS late_days,
             jsonb_build_object('id', c.id, 'number', c.number, 'title', c.title, 'status', c.status, 'due_on', c.due_on,
               'updated_at', c.updated_at,
               'late_days', CASE WHEN c.due_on < v_today THEN v_today - c.due_on END,
               'quiet_days', CASE WHEN c.status = 'doing' AND c.updated_at < now() - interval '7 days'
                                  THEN (extract(epoch FROM now() - c.updated_at) / 86400)::integer END,
               'no_owner', c.status <> 'person' AND NOT EXISTS (SELECT 1 FROM public.ops_work_people p WHERE p.card_id = c.id AND p.role = 'owner'),
               'owners', COALESCE((SELECT jsonb_agg(public.ops_name(p.email) ORDER BY p.added_at, p.email)
                                     FROM public.ops_work_people p WHERE p.card_id = c.id AND p.role = 'owner'), '[]'::jsonb)) AS row_
        FROM public.ops_period_cards(p_from, p_to, v_owner) c
       WHERE c.status <> 'done'
         AND (c.due_on < v_today
              OR (c.status = 'doing' AND c.updated_at < now() - interval '7 days')
              OR (c.status <> 'person' AND NOT EXISTS (SELECT 1 FROM public.ops_work_people p WHERE p.card_id = c.id AND p.role = 'owner')))
       ORDER BY GREATEST(v_today - c.due_on, 0) DESC, c.number
       LIMIT 30
    ) r;

  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'tz', v_tz, 'today', v_today, 'owner', v_owner,
    'totals', v_totals, 'by_person', v_people, 'weeks', v_weeks, 'shipped', v_shipped, 'slipping', v_slipping, 'review', v_review);
END;
$$;
REVOKE ALL ON FUNCTION public.ops_period_summary(timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_period_summary(timestamptz, timestamptz, text, text) TO authenticated;
COMMENT ON FUNCTION public.ops_period_summary(timestamptz, timestamptz, text, text) IS
  'Issue #4130. Work › This week / This month: closed, opened, on time, carried, overdue, per person, closed per week, shipped, slipping and the review list for at most 120 days. Gate: crm_ctx(), as ops_log_list.';

-- ---------------------------------------------------------------------------
-- 3. The Team dashboard's numbers for a period.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_team_pulse(p_from timestamptz, p_to timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v record;
  v_len interval;
  v_now jsonb;
  v_before jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden: Only an owner or admin can open the team dashboard.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.crm_ctx();
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '92 days' OR p_to > now() + interval '1 day' THEN
    RAISE EXCEPTION 'invalid_query: Pick a period of at most 92 days that has started.' USING ERRCODE = '22023';
  END IF;
  v_len := p_to - p_from;

  SELECT jsonb_object_agg(k.which, k.body) INTO v_now FROM (
    SELECT b.which, jsonb_build_object(
      'hosts_contacted', (SELECT count(DISTINCT a.record_id) FROM public.crm_activity a JOIN public.crm_records r ON r.id = a.record_id
                           WHERE r.pipeline = 'hosts' AND r.deleted_at IS NULL AND a.created_at >= b.f AND a.created_at < b.t
                             AND ((a.kind = 'touch' AND a.direction = 'outbound') OR (a.kind = 'stage_move' AND a.to_stage = 'contacted'))),
      'hosts_onboarded', (SELECT count(DISTINCT a.record_id) FROM public.crm_activity a JOIN public.crm_records r ON r.id = a.record_id
                           WHERE r.pipeline = 'hosts' AND r.deleted_at IS NULL AND a.kind = 'stage_move' AND a.to_stage IN ('onboarded', 'live')
                             AND a.created_at >= b.f AND a.created_at < b.t),
      'moves', jsonb_build_object(
        'hosts', COALESCE((SELECT jsonb_object_agg(m.to_stage, m.n) FROM (
                    SELECT a.to_stage, count(DISTINCT a.record_id) AS n FROM public.crm_activity a JOIN public.crm_records r ON r.id = a.record_id
                     WHERE r.pipeline = 'hosts' AND r.deleted_at IS NULL AND a.kind = 'stage_move' AND a.created_at >= b.f AND a.created_at < b.t
                     GROUP BY a.to_stage) m), '{}'::jsonb),
        'creators', COALESCE((SELECT jsonb_object_agg(m.to_stage, m.n) FROM (
                    SELECT a.to_stage, count(DISTINCT a.record_id) AS n FROM public.crm_activity a JOIN public.crm_records r ON r.id = a.record_id
                     WHERE r.pipeline = 'creators' AND r.deleted_at IS NULL AND a.kind = 'stage_move' AND a.created_at >= b.f AND a.created_at < b.t
                     GROUP BY a.to_stage) m), '{}'::jsonb)),
      'beta_leads', (SELECT count(*) FROM public.beta_access_leads l WHERE l.created_at >= b.f AND l.created_at < b.t)) AS body
    FROM (VALUES ('now', p_from, p_to), ('before', p_from - v_len, p_from)) b(which, f, t)
  ) k;
  v_before := v_now->'before';
  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'now', v_now->'now', 'before', v_before);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_team_pulse(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_team_pulse(timestamptz, timestamptz) TO authenticated;
COMMENT ON FUNCTION public.crm_team_pulse(timestamptz, timestamptz) IS
  'Issue #4130. Team dashboard: hosts contacted, hosts onboarded, stage moves per pipeline and beta leads for a period and the one before it. Distinct record counts only. Gate: is_admin_user() and crm_ctx(), as crm_team_summary.';

-- ---------------------------------------------------------------------------
-- 3b. One definition of "Waiting on a person".
-- ---------------------------------------------------------------------------
-- A card is waiting on a person when it is open (not archived) and its status
-- is 'person', whatever the reason: a "send" card counts whether or not its
-- draft is ready. "Yours" means you are an owner, exactly as the Work board's
-- who=mine. The Dashboard KPI, the Work menu count, the Work board column and
-- the Team dashboard all count this; ops_work_list counts.person is the same
-- rule for the whole team. The older keys stay as they were for the agent
-- tool (my_work), which reads them by name.
CREATE OR REPLACE FUNCTION public.ops_my_counts(p_today date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_today date := public.ops_today(p_today); v_review jsonb := public.ops_review_list(p_today);
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  RETURN (SELECT jsonb_build_object(
    'open_mine', count(*) FILTER (WHERE w.status <> 'done' AND p.role = 'owner'),
    'waiting_on_person_mine', count(*) FILTER (WHERE w.status = 'person' AND p.role = 'owner'),
    -- A wording card is listed under Spend or publish and on What hosts are
    -- told; it is counted once, as wording.
    'needs_person_mine', (SELECT count(*) FROM jsonb_array_elements(v_review->'cards') c
                           WHERE c->>'auto_kind' IS DISTINCT FROM 'roadmap_shipped'
                              OR jsonb_array_length(v_review->'wording') = 0),
    'draft_needed_mine', jsonb_array_length(v_review->'draft_needed'),
    'wording_mine', jsonb_array_length(v_review->'wording'),
    'overdue_mine', count(*) FILTER (WHERE w.status <> 'done' AND p.role = 'owner' AND w.due_on < v_today),
    'watching_open', count(*) FILTER (WHERE w.status <> 'done' AND p.role = 'watcher'))
    FROM public.ops_work_cards w JOIN public.ops_work_people p ON p.card_id = w.id AND p.email = v.actor_email
   WHERE w.archived_at IS NULL);
END;
$$;
-- CREATE OR REPLACE keeps the grants ops_my_counts already has.

-- ---------------------------------------------------------------------------
-- 4. Self-check. The apply stops here if anything above is not as stated.
-- ---------------------------------------------------------------------------
DO $check4130w1$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid, p.oid::regprocedure::text AS sig, p.prosecdef, p.provolatile, p.proconfig
             FROM pg_catalog.pg_proc p
            WHERE p.oid IN ('public.ops_events_since(timestamptz,text)'::regprocedure,
                            'public.ops_period_summary(timestamptz,timestamptz,text,text)'::regprocedure,
                            'public.crm_team_pulse(timestamptz,timestamptz)'::regprocedure) LOOP
    IF NOT r.prosecdef OR r.provolatile <> 's' OR NOT ('search_path=public, pg_temp' = ANY (r.proconfig)) THEN
      RAISE EXCEPTION 'issue 4130 wave 1 self-check: % attributes are not as stated', r.sig;
    END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE')
       OR (SELECT bool_or(a.grantee = 0) FROM pg_catalog.pg_proc p2, aclexplode(COALESCE(p2.proacl, acldefault('f', p2.proowner))) a WHERE p2.oid = r.oid)
       OR NOT has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 4130 wave 1 self-check: % grants are not as stated', r.sig;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'public.ops_events_window(timestamptz,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.ops_events_window(timestamptz,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.ops_period_cards(timestamptz,timestamptz,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.ops_period_cards(timestamptz,timestamptz,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue 4130 wave 1 self-check: an internal helper is callable by clients';
  END IF;
END;
$check4130w1$;

COMMIT;

NOTIFY pgrst, 'reload schema';
