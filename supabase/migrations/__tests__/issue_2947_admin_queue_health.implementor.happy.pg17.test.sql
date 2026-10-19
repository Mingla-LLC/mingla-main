-- MINGLA-INVARIANT: I-PROPOSED-2947-ADMIN-QUEUE-HEALTH-IS-ADMIN-GATED | issue #2947 | admin_get_queue_health requires is_admin_user and returns verdict + live gauges without inventing Gate 0 numbers.
-- #2879 / #2947 — admin queue-health RPC happy path.
--
--   C-01  Function exists, authenticated+service_role may execute, anon may not.
--   C-02  Source gates on is_admin_user.
--   C-03  As admin, returns verdict + live + crossSignals keys (no Gate 0 fields).
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.i2947aq_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #2947 admin queue health FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

BEGIN;
DO $c01$
BEGIN
  PERFORM pg_temp.i2947aq_assert(
    to_regprocedure('public.admin_get_queue_health(integer)') IS NOT NULL,
    'C-01a admin_get_queue_health(integer) exists');
  PERFORM pg_temp.i2947aq_assert(
    NOT has_function_privilege('anon', 'public.admin_get_queue_health(integer)', 'EXECUTE'),
    'C-01b anon cannot execute');
  PERFORM pg_temp.i2947aq_assert(
    has_function_privilege('authenticated', 'public.admin_get_queue_health(integer)', 'EXECUTE'),
    'C-01c authenticated can execute');
  PERFORM pg_temp.i2947aq_assert(
    has_function_privilege('service_role', 'public.admin_get_queue_health(integer)', 'EXECUTE'),
    'C-01d service_role can execute');
END
$c01$;
ROLLBACK;

BEGIN;
DO $c02$
DECLARE
  v_src text;
BEGIN
  SELECT p.prosrc INTO v_src
    FROM pg_proc p
   WHERE p.oid = 'public.admin_get_queue_health(integer)'::regprocedure;
  PERFORM pg_temp.i2947aq_assert(
    v_src ~ 'is_admin_user',
    'C-02 source calls is_admin_user');
END
$c02$;
ROLLBACK;

BEGIN;
DO $c03$
DECLARE
  v jsonb;
  v_admin constant uuid := '29470000-0000-4000-a100-000000000201';
BEGIN
  INSERT INTO auth.users(id, email)
    VALUES (v_admin, 'admin-2947-queue-health@example.test');
  INSERT INTO public.admin_users(email, role, status)
    VALUES ('admin-2947-queue-health@example.test', 'admin', 'active');

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v := public.admin_get_queue_health(72);
  RESET ROLE;

  PERFORM pg_temp.i2947aq_assert(v ? 'verdict', 'C-03a returns verdict');
  PERFORM pg_temp.i2947aq_assert(v ? 'live', 'C-03b returns live gauges');
  PERFORM pg_temp.i2947aq_assert(v ? 'crossSignals', 'C-03c returns crossSignals');
  PERFORM pg_temp.i2947aq_assert(v ? 'recentRuns', 'C-03d returns recentRuns');
  PERFORM pg_temp.i2947aq_assert(
    (v->'live') ? 'waitingEntries'
      AND (v->'live') ? 'eligibleWaitingEntries'
      AND (v->'live') ? 'orphanInfinityCount'
      AND (v->'live') ? 'armedTiers',
    'C-03e live carries waiting/eligible/orphan/armed keys');
  PERFORM pg_temp.i2947aq_assert(
    NOT (v ? 'armThreshold') AND NOT (v ? 'maxConcurrentLiveHolds'),
    'C-03f does not invent Gate 0 arming numbers');
  PERFORM pg_temp.i2947aq_assert(
    (v->'verdict'->>'verdict') IN (
      'clean', 'stalled', 'orphaned', 'insufficient_evidence'
    ),
    'C-03g verdict is one of the four known states (got '
      || COALESCE(v->'verdict'->>'verdict', 'null') || ')');
END
$c03$;
ROLLBACK;
