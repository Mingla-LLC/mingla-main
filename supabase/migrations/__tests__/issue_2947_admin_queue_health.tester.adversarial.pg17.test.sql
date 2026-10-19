-- #2879 / #2947 — admin queue-health adversarial.
--
--   A-01  Non-admin caller is rejected.
--   A-02  Response never includes Gate 0 setting fields.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.i2947aqa_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #2947 admin queue health ADV FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

BEGIN;
DO $a01$
DECLARE
  v_user constant uuid := '29470000-0000-4000-a100-000000000202';
  v_raised boolean := false;
BEGIN
  INSERT INTO auth.users(id, email)
    VALUES (v_user, 'user-2947-queue-health@example.test');

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  BEGIN
    PERFORM public.admin_get_queue_health(72);
  EXCEPTION WHEN OTHERS THEN
    v_raised := (SQLERRM = 'not_authorized');
  END;
  RESET ROLE;

  PERFORM pg_temp.i2947aqa_assert(v_raised,
    'A-01 non-admin receives not_authorized');
END
$a01$;
ROLLBACK;

BEGIN;
DO $a02$
DECLARE
  v jsonb;
  v_admin constant uuid := '29470000-0000-4000-a100-000000000203';
BEGIN
  INSERT INTO auth.users(id, email)
    VALUES (v_admin, 'admin-2947-queue-health-a02@example.test');
  INSERT INTO public.admin_users(email, role, status)
    VALUES ('admin-2947-queue-health-a02@example.test', 'admin', 'active');

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v := public.admin_get_queue_health(24);
  RESET ROLE;

  PERFORM pg_temp.i2947aqa_assert(
    position('arm_threshold' IN lower(v::text)) = 0
      AND position('admission_rate_per_sec' IN lower(v::text)) = 0
      AND position('max_concurrent_live_holds' IN lower(v::text)) = 0,
    'A-02 payload never carries Gate 0 admission settings');
END
$a02$;
ROLLBACK;
