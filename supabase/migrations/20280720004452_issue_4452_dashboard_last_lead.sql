-- Issue #4452 (follow-up B8) — the Dashboard's "No inbound lead for N days".
--
-- admin_dashboard_summary read the last lead from tool_leads (web lane) and
-- beta_access_leads only, so form and book-a-call leads never counted (the
-- Dashboard said 74 days while book-a-call leads arrived that week). #4452
-- put every lead in public.leads (one row per email) with one
-- public.lead_events row per source row, each marked is_test by
-- inbound_lead_is_test. The last real lead is now the newest non-test event
-- of a non-test lead. Nothing else in the function changes; the signature,
-- SECURITY DEFINER, search_path, owner/admin check and grants are the same.
--
-- Invariant (declared in the pg17 test): I-4452-DASHBOARD-LAST-LEAD-ALL-SOURCES | issue #4452 | the Dashboard's last inbound lead is the newest non-test lead event of any source in public.lead_events.

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

  -- #4452 (B8): every lead (forms, book-a-call, web tools, beta, explorer)
  -- is one row in public.leads with its events in public.lead_events. The
  -- last real lead is the newest event that is not a test row, of a lead
  -- that is not a test lead (both flags come from inbound_lead_is_test).
  SELECT max(e.occurred_at) INTO v_last
    FROM public.lead_events e
    JOIN public.leads l ON l.id = e.lead_id
   WHERE NOT e.is_test AND NOT l.is_test;

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
  'Issue #4130: the Dashboard''s numbers in one admin-only read. Sign-ups (non-seed, staff and test left out) and paid tickets (tickets of paid or partly refunded orders with money paid), 7 days vs the 7 before and 8 weeks; host cards with and without a next event (ops_host_next_rows); support tickets waiting for a first reply; the last non-test inbound lead. #4452: read from public.leads / lead_events, every lead source.';
REVOKE ALL ON FUNCTION public.admin_dashboard_summary(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_summary(date) TO authenticated, service_role;
