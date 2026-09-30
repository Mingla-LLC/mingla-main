-- #3645 PR1 — payment+24h maturity (implementor happy).

DO $$
DECLARE
  v_def text;
  v_con text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_con
  FROM pg_constraint c
  WHERE c.conrelid = 'public.brand_payout_releases'::regclass
    AND c.conname = 'brand_payout_release_anchor_order';
  IF v_con IS NULL OR position('1 day' IN v_con) = 0 THEN
    RAISE EXCEPTION 'issue_3645 FAIL: brand_payout_release_anchor_order must use 1 day, got %', v_con;
  END IF;
  IF position('3 days' IN v_con) > 0 THEN
    RAISE EXCEPTION 'issue_3645 FAIL: brand_payout_release_anchor_order still mentions 3 days';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'attach_payout_release'
  ORDER BY p.oid DESC
  LIMIT 1;
  IF position('interval ''1 day''' IN coalesce(v_def, '')) = 0 THEN
    RAISE EXCEPTION 'issue_3645 FAIL: attach_payout_release missing 1 day maturity';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'refresh_pending_payout_release_truth'
  ORDER BY p.oid DESC
  LIMIT 1;
  IF position('event_dates' IN coalesce(v_def, '')) > 0 THEN
    RAISE EXCEPTION 'issue_3645 FAIL: refresh must not re-read event_dates for maturity';
  END IF;

  RAISE NOTICE 'issue_3645 implementor happy PASS';
END $$;
