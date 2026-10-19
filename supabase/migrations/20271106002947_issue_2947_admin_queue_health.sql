-- ===========================================================================
-- #2879 / #2947 — admin read surface for queue-health gauges
--
-- Exposes the existing service_role-only monitor rollup to Mingla admins via
-- one SECURITY DEFINER RPC. Read-only: does not invent Gate 0 arming numbers,
-- does not arm tiers, and does not weaken the service_role grants on observe.
-- ===========================================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.is_admin_user()') IS NULL THEN
    RAISE EXCEPTION 'issue_2947_is_admin_user_missing';
  END IF;
  IF to_regprocedure('public.issue_2947_queue_verdict(integer)') IS NULL THEN
    RAISE EXCEPTION 'issue_2947_queue_verdict_missing';
  END IF;
  IF to_regclass('public.ticket_queue_monitor_runs') IS NULL THEN
    RAISE EXCEPTION 'issue_2947_queue_monitor_runs_missing';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.admin_get_queue_health(
  p_hours integer DEFAULT 72
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_hours integer := GREATEST(COALESCE(p_hours, 72), 0);
  v_verdict jsonb;
  v_latest jsonb;
  v_recent jsonb;
  v_waiting integer;
  v_eligible integer;
  v_orphans integer;
  v_armed integer;
  v_armed_presale integer;
  v_paid_without_ticket integer;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_verdict := public.issue_2947_queue_verdict(v_hours);

  SELECT count(*)::integer INTO v_waiting
    FROM public.ticket_queue_entries q
   WHERE q.admitted_at IS NULL AND q.released_at IS NULL;

  v_eligible := public.issue_2947_queue_eligible_waiting_count();
  v_orphans := public.issue_2947_queue_orphan_infinity_count(interval '2 minutes');

  SELECT count(*)::integer INTO v_armed
    FROM public.ticket_queue_arming a
   WHERE a.disarmed_at IS NULL;

  SELECT count(*)::integer INTO v_armed_presale
    FROM public.ticket_queue_arming a
   WHERE a.disarmed_at IS NULL
     AND a.sale_opens_at IS NOT NULL
     AND a.sale_opens_at > clock_timestamp();

  SELECT count(*)::integer INTO v_paid_without_ticket
    FROM public.ticket_checkout_sessions s
   WHERE s.order_id IS NULL
     AND s.status IN (
       'processing_payment',
       'awaiting_web_redirect',
       'requires_payment',
       'pending_free'
     )
     AND s.stripe_payment_intent_id IS NOT NULL
     AND s.stripe_payment_intent_id LIKE 'mingla_%'
     AND s.expires_at < now();

  SELECT to_jsonb(r) INTO v_latest
    FROM public.ticket_queue_monitor_runs r
   ORDER BY r.observed_at DESC, r.id DESC
   LIMIT 1;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.observed_at DESC, x.id DESC), '[]'::jsonb)
    INTO v_recent
    FROM (
      SELECT *
        FROM public.ticket_queue_monitor_runs
       WHERE observed_at > now() - make_interval(hours => v_hours)
       ORDER BY observed_at DESC, id DESC
       LIMIT 48
    ) x;

  RETURN jsonb_build_object(
    'generatedAt', now(),
    'windowHours', v_hours,
    'verdict', v_verdict,
    'latestRun', v_latest,
    'recentRuns', v_recent,
    'live', jsonb_build_object(
      'waitingEntries', COALESCE(v_waiting, 0),
      'eligibleWaitingEntries', COALESCE(v_eligible, 0),
      'orphanInfinityCount', COALESCE(v_orphans, 0),
      'armedTiers', COALESCE(v_armed, 0),
      'armedPresaleTiers', COALESCE(v_armed_presale, 0)
    ),
    'crossSignals', jsonb_build_object(
      'paidWithoutTicketCount', COALESCE(v_paid_without_ticket, 0)
    )
  );
END
$fn$;

COMMENT ON FUNCTION public.admin_get_queue_health(integer) IS
  'issue #2947 / #2879 — admin read of queue monitor verdict + live gauges. '
  'Never invents Gate 0 arming numbers; read-only over existing monitor tables.';

REVOKE ALL ON FUNCTION public.admin_get_queue_health(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_queue_health(integer) TO authenticated, service_role;

DO $probe$
DECLARE
  v_def text;
BEGIN
  IF to_regprocedure('public.admin_get_queue_health(integer)') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: admin_get_queue_health missing';
  END IF;
  v_def := pg_get_functiondef('public.admin_get_queue_health(integer)'::regprocedure);
  IF position('is_admin_user' IN v_def) = 0 THEN
    RAISE EXCEPTION 'PROBE FAIL: admin_get_queue_health lost is_admin_user gate';
  END IF;
  IF has_function_privilege('anon', 'public.admin_get_queue_health(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL: anon must not execute admin_get_queue_health';
  END IF;
  RAISE NOTICE 'issue #2947 admin queue health probe: structural OK';
END
$probe$;

COMMIT;
