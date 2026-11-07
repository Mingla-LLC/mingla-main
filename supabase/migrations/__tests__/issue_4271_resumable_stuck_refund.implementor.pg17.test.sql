-- Issue #4271 follow-up — a refund Stripe refuses (or never answers) no longer
-- blocks the order forever. Implementor happy path for
-- 20280426004271_issue_4271_resumable_stuck_refund.sql on the replayed PG17 schema.
--
-- MINGLA-INVARIANT: I-4271-STUCK-REFUND-RESUMABLE | issue #4271 | a pending refund with no Stripe refund recorded is resumed (same key, same Stripe idempotency key) by a retry of the same lines, never counted as a second refund that blocks it; a refund Stripe provably refused is committed failed and frees its tickets.
--
-- Cases:
--   1. Live repro: a 2-ticket order whose first refund row is stuck 'pending'
--      (Stripe threw). refund_preview for the same 2 tickets prices them
--      instead of raising line_overrefund (FAILS before the migration).
--   2. biz_refund_order under a NEW key still refuses (it must not create a
--      second refund); issue_4271_resumable_refund names the stuck row, its own
--      key, reason and original lines; replaying with them is an idempotent
--      replay of the SAME row (FAILS before: the function does not exist).
--   3. A different line selection is not resumable and still counts the row.
--   4. Once Stripe recorded a refund for the row (stripe_refund_id set) it is
--      no longer resumable and the preview counts it again.
--   5. A refund committed 'failed' (Stripe provably refused) frees the tickets:
--      the preview and a new biz_refund_order for the same tickets succeed.
--   6. The helpers are service-role only; the preview still refuses a caller
--      without payment rights.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner    constant uuid := '42710000-0000-4000-8000-0000000a0001';
  v_stranger constant uuid := '42710000-0000-4000-8000-0000000a0002';
  v_brand    constant uuid := '42710000-0000-4000-8000-0000000a0010';
  v_event    constant uuid := '42710000-0000-4000-8000-0000000a0020';
  v_tt       constant uuid := '42710000-0000-4000-8000-0000000a0030';
  v_order    constant uuid := '42710000-0000-4000-8000-0000000a0040';
  v_line     constant uuid := '42710000-0000-4000-8000-0000000a0050';
  v_lines2   jsonb;
  v_lines1   jsonb;
  v_r        jsonb;
  v_stuck    uuid;
  v_raised   text;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner), (v_stranger);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'owner-4271-refund@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency)
  VALUES (v_brand, v_owner, 'Issue 4271 refunds', 'issue-4271-refunds', 'stripe', 'GB', 'GBP', 'GBP');
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_event, v_brand, 'Issue 4271 refunds', 'issue-4271-refunds-ev', 'ended', 'GBP');
  INSERT INTO public.ticket_types(id, event_id, name, price_cents)
  VALUES (v_tt, v_event, 'General', 1000);
  INSERT INTO public.orders(id, event_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, stripe_charge_id, source, stripe_application_fee_amount_cents)
  VALUES (v_order, v_event, 2000, 'GBP', 'paid', 'pi_4271_stuck', 'ch_4271_stuck', 'legacy', 30);
  INSERT INTO public.order_line_items(id, order_id, ticket_type_id, quantity, unit_price_cents, total_cents)
  VALUES (v_line, v_order, v_tt, 2, 1000, 2000);

  v_lines2 := jsonb_build_array(jsonb_build_object('order_line_item_id', v_line, 'quantity', 2));
  v_lines1 := jsonb_build_array(jsonb_build_object('order_line_item_id', v_line, 'quantity', 1));
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);

  -- The host's first refund: the pending row refund-order writes before Stripe.
  v_r := public.biz_refund_order(v_order, v_lines2, 'Guest could not make it', 'issue-4271-first-key');
  v_stuck := (v_r->>'refund_id')::uuid;
  -- (Stripe threw with an unknown outcome; the row stays pending.)

  -- 1. The preview prices the same tickets instead of line_overrefund.
  v_r := public.refund_preview(v_order, v_lines2);
  IF (v_r->>'amount_cents')::bigint <> 2000 THEN
    RAISE EXCEPTION 'case 1: preview must price the stuck refund''s tickets (2000), got %', v_r;
  END IF;

  -- 2. A new key still refuses (no second refund) ...
  v_raised := NULL;
  BEGIN
    PERFORM public.biz_refund_order(v_order, v_lines2, 'Trying the refund again', 'issue-4271-second-key');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  IF v_raised IS NULL OR v_raised NOT LIKE 'line_overrefund%' THEN
    RAISE EXCEPTION 'case 2: a new key must not create a second refund, got %', coalesce(v_raised, 'success');
  END IF;
  -- ... and the resume lookup names the stuck row with its original request.
  v_r := public.issue_4271_resumable_refund(v_order, v_lines2);
  IF (v_r->>'refund_id')::uuid IS DISTINCT FROM v_stuck
     OR v_r->>'idempotency_key' <> 'issue-4271-first-key'
     OR v_r->>'reason' <> 'Guest could not make it' THEN
    RAISE EXCEPTION 'case 2: resumable lookup must return the stuck row, got %', v_r;
  END IF;
  v_r := public.biz_refund_order(v_order, v_r->'lines', v_r->>'reason', v_r->>'idempotency_key');
  IF (v_r->>'idempotent_replay')::boolean IS NOT TRUE OR (v_r->>'refund_id')::uuid IS DISTINCT FROM v_stuck
     OR (v_r->>'amount_cents')::bigint <> 2000 THEN
    RAISE EXCEPTION 'case 2: replaying the stored request must resume the same row, got %', v_r;
  END IF;
  IF (SELECT count(*) FROM public.refunds WHERE order_id = v_order) <> 1 THEN
    RAISE EXCEPTION 'case 2: resuming must not add a refund row';
  END IF;

  -- 3. A different selection is not this refund: the stuck row still counts.
  IF public.issue_4271_resumable_refund(v_order, v_lines1) IS NOT NULL THEN
    RAISE EXCEPTION 'case 3: a 1-ticket request must not resume the 2-ticket refund';
  END IF;
  v_raised := NULL;
  BEGIN
    PERFORM public.refund_preview(v_order, v_lines1);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  IF v_raised IS NULL OR v_raised NOT LIKE 'line_overrefund%' THEN
    RAISE EXCEPTION 'case 3: a different selection must still count the stuck row, got %', coalesce(v_raised, 'success');
  END IF;

  -- 4. Once Stripe recorded a refund, the row is real money: counted again.
  UPDATE public.refunds SET stripe_refund_id = 're_4271_recorded' WHERE id = v_stuck;
  IF public.issue_4271_resumable_refund(v_order, v_lines2) IS NOT NULL THEN
    RAISE EXCEPTION 'case 4: a row with a recorded Stripe refund is not resumable';
  END IF;
  v_raised := NULL;
  BEGIN
    PERFORM public.refund_preview(v_order, v_lines2);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  IF v_raised IS NULL OR v_raised NOT LIKE 'line_overrefund%' THEN
    RAISE EXCEPTION 'case 4: a recorded refund must count, got %', coalesce(v_raised, 'success');
  END IF;
  UPDATE public.refunds SET stripe_refund_id = NULL WHERE id = v_stuck;

  -- 5. Stripe provably refused: refund-order commits the row failed. The
  --    tickets are free again and a new refund goes through.
  v_r := public.biz_refund_order_commit(v_stuck, NULL, 0, 'failed');
  IF v_r->>'status' <> 'failed' THEN
    RAISE EXCEPTION 'case 5: commit failed returned %', v_r;
  END IF;
  IF public.issue_4271_resumable_refund(v_order, v_lines2) IS NOT NULL THEN
    RAISE EXCEPTION 'case 5: a failed row is not resumable';
  END IF;
  v_r := public.refund_preview(v_order, v_lines2);
  IF (v_r->>'amount_cents')::bigint <> 2000 THEN
    RAISE EXCEPTION 'case 5: preview after failure must price 2000, got %', v_r;
  END IF;
  v_r := public.biz_refund_order(v_order, v_lines2, 'Trying the refund again', 'issue-4271-second-key');
  IF (v_r->>'idempotent_replay')::boolean IS NOT FALSE OR (v_r->>'refund_id')::uuid = v_stuck
     OR (v_r->>'amount_cents')::bigint <> 2000 THEN
    RAISE EXCEPTION 'case 5: a new refund of the freed tickets must be created, got %', v_r;
  END IF;

  -- 6. The preview still refuses a caller without payment rights.
  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  v_raised := NULL;
  BEGIN
    PERFORM public.refund_preview(v_order, v_lines2);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  IF v_raised IS DISTINCT FROM 'permission_denied' THEN
    RAISE EXCEPTION 'case 6: stranger preview must be permission_denied, got %', coalesce(v_raised, 'success');
  END IF;
END
$test$;

-- 6. Grants: the resume helpers are service-role only.
DO $grants$
BEGIN
  IF has_function_privilege('authenticated', 'public.issue_4271_resumable_refund(uuid, jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_4271_resumable_refund(uuid, jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_4271_resumable_refund_id(uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'case 6: resume helpers must not be callable by app roles';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.issue_4271_resumable_refund(uuid, jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.refund_preview(uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'case 6: service_role resume / authenticated preview grants missing';
  END IF;
END
$grants$;

ROLLBACK;
