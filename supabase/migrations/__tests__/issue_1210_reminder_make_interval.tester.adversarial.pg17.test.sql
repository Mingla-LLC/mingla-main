-- #1210 — tester adversarial: prove the numeric mins defect and guards.
\set ON_ERROR_STOP on
BEGIN;

DO $body$
DECLARE
  v_src text;
  v_raised boolean := false;
  v_msg text;
BEGIN
  -- Adversarial control: the exact failure mode from production.
  BEGIN
    PERFORM make_interval(mins => (30 / 2.0));
    RAISE EXCEPTION 'issue_1210_adversarial_numeric_mins_did_not_fail';
  EXCEPTION
    WHEN undefined_function THEN
      v_raised := true;
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      IF v_msg ILIKE '%make_interval%numeric%' OR v_msg ILIKE '%does not exist%' THEN
        v_raised := true;
      ELSE
        RAISE;
      END IF;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'issue_1210_adversarial_expected_numeric_mins_failure';
  END IF;

  -- Integer form must resolve.
  PERFORM make_interval(mins => (30 / 2)::int);

  SELECT prosrc INTO v_src
  FROM pg_proc
  WHERE oid = 'public.pg_notify_reminders_enqueue(int, text, int)'::regprocedure;

  IF v_src ~ '/\s*2\.0' THEN
    RAISE EXCEPTION 'issue_1210_adversarial_prosrc_contains_2_0';
  END IF;

  -- Invalid bucket still fails closed (unchanged contract).
  BEGIN
    PERFORM public.pg_notify_reminders_enqueue(24, '12h', 30);
    RAISE EXCEPTION 'issue_1210_adversarial_invalid_bucket_accepted';
  EXCEPTION
    WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      IF v_msg !~ 'invalid lead bucket' THEN
        RAISE EXCEPTION 'issue_1210_adversarial_unexpected_bucket_error_%', v_msg;
      END IF;
  END;

  -- Idempotent second call on empty universe returns 0 without error.
  IF public.pg_notify_reminders_enqueue(2, '2h', 30) < 0 THEN
    RAISE EXCEPTION 'issue_1210_adversarial_second_call_failed';
  END IF;

  -- country_code helper still referenced (#1529 must not regress).
  IF v_src !~* 'mingla_e164_country' THEN
    RAISE EXCEPTION 'issue_1210_adversarial_lost_country_helper';
  END IF;

  RAISE NOTICE 'issue_1210 tester adversarial PASS';
END
$body$;

ROLLBACK;
