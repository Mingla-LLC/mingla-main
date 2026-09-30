-- #3645 PR1 — adversarial: event+3d maturity must be gone from live payout helpers.

DO $$
DECLARE
  v_def text;
  v_con text;
  v_json jsonb;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_con
  FROM pg_constraint c
  WHERE c.conrelid = 'public.brand_payout_releases'::regclass
    AND c.conname = 'brand_payout_release_anchor_order';
  IF position('3 days' IN coalesce(v_con, '')) > 0 THEN
    RAISE EXCEPTION 'issue_3645 ADV FAIL: CHECK still encodes 3 days: %', v_con;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'attach_payout_release'
  ORDER BY p.oid DESC
  LIMIT 1;
  IF position('interval ''3 days''' IN coalesce(v_def, '')) > 0 THEN
    RAISE EXCEPTION 'issue_3645 ADV FAIL: attach_payout_release still uses 3 days';
  END IF;
  IF position('interval ''1 day''' IN coalesce(v_def, '')) = 0 THEN
    RAISE EXCEPTION 'issue_3645 ADV FAIL: attach_payout_release missing 1 day maturity';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'refresh_pending_payout_release_truth'
  ORDER BY p.oid DESC
  LIMIT 1;
  IF position('event_dates' IN coalesce(v_def, '')) > 0 THEN
    RAISE EXCEPTION 'issue_3645 ADV FAIL: refresh still re-anchors via event_dates';
  END IF;

  v_json := public.paystack_payout_float_obligation(-5, now());
  IF coalesce((v_json->>'horizon_days')::integer, -1) <> 1 THEN
    RAISE EXCEPTION 'issue_3645 ADV FAIL: negative horizon must clamp to 1 day, got %', v_json->>'horizon_days';
  END IF;

  RAISE NOTICE 'issue_3645 adversarial PASS';
END $$;
