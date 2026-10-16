-- Issue #3645 WS5 — Paystack dispute evidence happy path (PG17).
BEGIN;

DO $test$
DECLARE
  v_owner   constant uuid := '36450000-0000-4000-8000-0000000000f1';
  v_admin   constant uuid := '36450000-0000-4000-8000-0000000000f2';
  v_brand   constant uuid := '36450000-0000-4000-8000-0000000000f3';
  v_event   constant uuid := '36450000-0000-4000-8000-0000000000f4';
  v_order   constant uuid := '36450000-0000-4000-8000-0000000000f5';
  v_dispute uuid;
  v_now     timestamptz := timestamptz '2026-10-01 12:00:00+00';
  v_list    jsonb;
  v_detail  jsonb;
  v_sha     text;
  v_deadline timestamptz;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'owner-3645-ws5@example.test');
  INSERT INTO auth.users(id, email) VALUES (v_admin, 'admin-3645-ws5@example.test');
  INSERT INTO public.admin_users(email, role, status)
  VALUES ('admin-3645-ws5@example.test', 'admin', 'active')
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;

  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency
  ) VALUES (
    v_brand, v_owner, 'Issue 3645 WS5 Brand', 'issue-3645-ws5',
    'paystack', 'NG', 'NGN', 'NGN'
  );
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_event, v_brand, 'WS5 Event', 'issue-3645-ws5-ev', 'live', 'NGN');
  INSERT INTO public.orders(
    id, event_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, source, buyer_email
  ) VALUES (
    v_order, v_event, 8000, 'NGN', 'paid', 'psk_3645_ws5_ref', 'legacy',
    'buyer-ws5@example.test'
  );

  PERFORM public.record_paystack_dispute_outcome(
    'dsp_3645_ws5', 'psk_3645_ws5_ref', 'charge.dispute.create',
    'pending', NULL, 8000, 'ngn', 'chargeback', NULL,
    '{"id":"dsp_3645_ws5"}'::jsonb, v_now
  );
  SELECT id INTO v_dispute FROM public.paystack_disputes
   WHERE paystack_dispute_id = 'dsp_3645_ws5';
  IF v_dispute IS NULL THEN RAISE EXCEPTION 'ws5_dispute_missing'; END IF;

  v_deadline := public.paystack_dispute_internal_deadline(v_now, v_now + interval '16 hours');
  IF v_deadline IS DISTINCT FROM v_now + interval '4 hours' THEN
    RAISE EXCEPTION 'ws5_internal_deadline_expected_4h_got_%', v_deadline;
  END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

  v_list := public.admin_list_paystack_disputes(NULL, 'needs_review', 25, 0);
  IF coalesce((v_list->>'total')::int, 0) < 1 THEN
    RAISE EXCEPTION 'ws5_list_expected_row_got_%', v_list;
  END IF;

  v_detail := public.admin_get_paystack_dispute(v_dispute);
  IF v_detail->'dossier' IS NULL THEN RAISE EXCEPTION 'ws5_detail_missing_dossier'; END IF;
  v_sha := v_detail->>'dossier_sha256';
  IF v_sha IS NULL OR length(v_sha) <> 64 THEN
    RAISE EXCEPTION 'ws5_detail_bad_sha_%', v_sha;
  END IF;

  PERFORM public.admin_review_paystack_dispute_evidence(
    v_dispute, 'looks complete', 'ws5 happy review'
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.paystack_dispute_admin_state
     WHERE dispute_id = v_dispute AND evidence_reviewed_sha256 = v_sha
  ) THEN
    RAISE EXCEPTION 'ws5_review_state_missing';
  END IF;

  PERFORM public.admin_record_paystack_dispute_evidence_action(
    v_dispute, 'export', 'ws5 happy export'
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.paystack_dispute_evidence_events
     WHERE dispute_id = v_dispute AND action = 'export' AND dossier_sha256 = v_sha
  ) THEN
    RAISE EXCEPTION 'ws5_export_event_missing';
  END IF;

  PERFORM public.admin_record_paystack_dispute_evidence_action(
    v_dispute, 'submit_stub', 'ws5 happy submit stub'
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.paystack_dispute_evidence_events
     WHERE dispute_id = v_dispute AND action = 'submit_stub'
       AND provider_submit_status = 'not_sent_stub'
  ) THEN
    RAISE EXCEPTION 'ws5_submit_stub_missing';
  END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 'issue_3645_paystack_dispute_evidence_happy_pass';
END;
$test$;

ROLLBACK;
