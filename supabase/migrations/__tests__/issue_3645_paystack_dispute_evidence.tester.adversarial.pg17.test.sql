-- Issue #3645 WS5 — Paystack dispute evidence adversarial (PG17).
BEGIN;

DO $test$
DECLARE
  v_owner   constant uuid := '36450000-0000-4000-8000-0000000000a1';
  v_admin   constant uuid := '36450000-0000-4000-8000-0000000000a2';
  v_brand   constant uuid := '36450000-0000-4000-8000-0000000000a3';
  v_event   constant uuid := '36450000-0000-4000-8000-0000000000a4';
  v_order   constant uuid := '36450000-0000-4000-8000-0000000000a5';
  v_dispute uuid;
  v_now     timestamptz := timestamptz '2026-10-01 12:00:00+00';
  v_sha     text;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'owner-3645-ws5a@example.test');
  INSERT INTO auth.users(id, email) VALUES (v_admin, 'admin-3645-ws5a@example.test');
  INSERT INTO public.admin_users(email, role, status)
  VALUES ('admin-3645-ws5a@example.test', 'admin', 'active')
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency
  ) VALUES (
    v_brand, v_owner, 'Issue 3645 WS5 Adv', 'issue-3645-ws5a',
    'paystack', 'NG', 'NGN', 'NGN'
  );
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_event, v_brand, 'WS5 Adv', 'issue-3645-ws5a-ev', 'live', 'NGN');
  INSERT INTO public.orders(
    id, event_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, source
  ) VALUES (
    v_order, v_event, 3000, 'NGN', 'paid', 'psk_3645_ws5a_ref', 'legacy'
  );
  PERFORM public.record_paystack_dispute_outcome(
    'dsp_3645_ws5a', 'psk_3645_ws5a_ref', 'charge.dispute.create',
    'pending', NULL, 3000, 'ngn', 'chargeback', NULL,
    '{"id":"dsp_3645_ws5a"}'::jsonb, v_now
  );
  SELECT id INTO v_dispute FROM public.paystack_disputes
   WHERE paystack_dispute_id = 'dsp_3645_ws5a';

  -- Keep the open dispute inside the provider window for the early gates.
  UPDATE public.paystack_disputes
     SET response_due_by = now() + interval '16 hours'
   WHERE id = v_dispute;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  BEGIN
    PERFORM public.admin_get_paystack_dispute(v_dispute);
    RAISE EXCEPTION 'ws5_owner_get_should_fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%not_authorized%' THEN
      RAISE EXCEPTION 'ws5_owner_get_unexpected_%', SQLERRM;
    END IF;
  END;
  RESET ROLE;

  -- admin_state is service_role only (no GRANT to authenticated)
  IF has_table_privilege('authenticated', 'public.paystack_dispute_admin_state', 'SELECT') THEN
    RAISE EXCEPTION 'ws5_admin_state_must_not_grant_authenticated';
  END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

  BEGIN
    PERFORM public.admin_record_paystack_dispute_evidence_action(
      v_dispute, 'export', 'should fail'
    );
    RAISE EXCEPTION 'ws5_export_without_review_should_fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%review_required%' THEN
      RAISE EXCEPTION 'ws5_export_without_review_unexpected_%', SQLERRM;
    END IF;
  END;

  v_sha := public.admin_get_paystack_dispute(v_dispute)->>'dossier_sha256';
  PERFORM public.admin_review_paystack_dispute_evidence(
    v_dispute, NULL, 'adv review', v_sha
  );

  -- Fixture mutations are not granted to authenticated on paystack_disputes /
  -- orders; run them as the migration role, then restore the admin JWT.
  RESET ROLE;
  UPDATE public.paystack_disputes
     SET response_due_by = now() - interval '1 minute'
   WHERE id = v_dispute;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  BEGIN
    PERFORM public.admin_record_paystack_dispute_evidence_action(
      v_dispute, 'submit_stub', 'late'
    );
    RAISE EXCEPTION 'ws5_past_deadline_should_fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%past_provider_deadline%' THEN
      RAISE EXCEPTION 'ws5_past_deadline_unexpected_%', SQLERRM;
    END IF;
  END;

  RESET ROLE;
  UPDATE public.paystack_disputes
     SET response_due_by = now() + interval '10 hours'
   WHERE id = v_dispute;
  UPDATE public.orders SET buyer_email = 'changed-after-review@example.test'
   WHERE id = v_order;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  BEGIN
    PERFORM public.admin_record_paystack_dispute_evidence_action(
      v_dispute, 'export', 'stale'
    );
    RAISE EXCEPTION 'ws5_stale_review_should_fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%dossier_changed_since_review%' THEN
      RAISE EXCEPTION 'ws5_stale_review_unexpected_%', SQLERRM;
    END IF;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF has_function_privilege('anon', 'public.admin_list_paystack_disputes(text,text,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ws5_list_must_revoke_anon';
  END IF;
  IF has_function_privilege('authenticated', 'public.paystack_dispute_build_dossier(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ws5_build_dossier_must_not_be_authenticated';
  END IF;

  RAISE NOTICE 'issue_3645_paystack_dispute_evidence_adversarial_pass';
END;
$test$;

ROLLBACK;
