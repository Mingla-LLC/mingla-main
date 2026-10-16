-- #1210 — implementor happy path: enqueue RPC accepts integer half-window.
-- Transaction-contained; rolls back. Never run on production.
\set ON_ERROR_STOP on
BEGIN;

DO $body$
DECLARE
  v_src text;
  v_n   int;
BEGIN
  SELECT prosrc INTO v_src
  FROM pg_proc
  WHERE oid = 'public.pg_notify_reminders_enqueue(int, text, int)'::regprocedure;

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'issue_1210_enqueue_fn_missing';
  END IF;

  -- Tip definition must not pass numeric into make_interval(mins => …).
  IF v_src ~ 'make_interval\(mins\s*=>\s*[^)]*/\s*2\.0' THEN
    RAISE EXCEPTION 'issue_1210_prosrc_still_divides_by_2_0_numeric';
  END IF;

  IF v_src !~* 'v_half_mins|/\s*2\)\s*::\s*int' THEN
    RAISE EXCEPTION 'issue_1210_prosrc_missing_integer_half_window';
  END IF;

  -- Empty-data calls must succeed (the live defect raised before any SELECT).
  v_n := public.pg_notify_reminders_enqueue(24, '24h', 30);
  IF v_n IS NULL OR v_n < 0 THEN
    RAISE EXCEPTION 'issue_1210_24h_enqueue_bad_return_%', v_n;
  END IF;

  v_n := public.pg_notify_reminders_enqueue(2, '2h', 30);
  IF v_n IS NULL OR v_n < 0 THEN
    RAISE EXCEPTION 'issue_1210_2h_enqueue_bad_return_%', v_n;
  END IF;

  -- Odd window floors; still must not raise make_interval type error.
  v_n := public.pg_notify_reminders_enqueue(24, '24h', 31);
  IF v_n IS NULL OR v_n < 0 THEN
    RAISE EXCEPTION 'issue_1210_odd_window_enqueue_bad_return_%', v_n;
  END IF;

  RAISE NOTICE 'issue_1210 implementor happy PASS';
END
$body$;

ROLLBACK;
