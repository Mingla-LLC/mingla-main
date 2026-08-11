-- ===========================================================================
-- Issue #1846 — Phase 3 (#1791) rework: refund reconciliation, the double
-- refund, and the ordering-enable gate that was never actually a gate.
--
-- Found by the adversarial tester against the LIVE schema. Nothing here was
-- user-visible only because ordering is dark and no venue is enabled — that
-- is luck, not design, and it is the reason Phase 4 (#1793) is blocked on the
-- first two.
--
-- C-1 (CRITICAL, money, two halves)
--   (a) A guest cancels — 1050 refunded. A manager then taps Approve. A
--       SECOND full-value refund row is minted: 2100 requested against a 1050
--       charge. `biz_venue_order_refund_decision` checked only the caller's
--       rank; it never asked whether a refund had been REQUESTED, never asked
--       whether the order was already refunded, and the mint deduped per
--       refund_kind — so a different kind sailed straight past it.
--   (b) It could not self-correct, and that is the deeper bug:
--       `record_source_refund_provider_event` routed everything that was not
--       `venue_reservation` into `event_rsvp_contributions`, so a
--       `venue_menu_order` event updated ZERO rows. `refunded_amount_cents`
--       stayed 0 and `payment_status` stayed 'paid' forever after a real
--       refund. The amount guard was therefore dead code, every refunded
--       order read as paid on the staff queue, organiser liability
--       double-counted, and the unreconciled row blocked that order's payout
--       release permanently.
--
-- H-1 (HIGH) — the OQ-7 "mechanical gate" was fiction. #1789 gave
--   `venue_ordering_settings` a `FOR ALL` policy plus full DML grants to
--   `authenticated`, so a rank-40 event_manager could flip
--   `ordering_enabled = true` straight through PostgREST, bypassing the RPC's
--   `claim_status='verified'` check entirely. The same door wrote `paused_at`
--   with any user id it liked. Both "the ONLY writer" claims in #1791's
--   migration header were false. A strict-grep gate cannot see a PostgREST
--   verb, so the lock has to be in the grant table and the proof has to be a
--   live attempt.
--
-- M-1 — the escalation clock started at `created_at`, not at payment, so an
--   order whose checkout took over ten minutes got rung 3 as its FIRST and
--   LAST alert. The floor and the managers were never told at all.
--
-- M-2 — settled `venue_collected` orders were escalated despite #1791's own
--   comment claiming they were excluded, paging an owner about an order the
--   waiter is holding and in which Mingla holds no money.
--
-- MONOTONIC VERSION: 20270319001846 > the frontier at implement time
-- (20270318001828_issue_1828_qualify_digest_under_pinned_search_path.sql).
--
-- DO NOT run `supabase db push`. Applied via the Supabase Management API after
-- REVIEW (history drift makes a blind push unsafe).
-- ===========================================================================

BEGIN;

-- ===========================================================================
-- 1. C-1(b) — THE WRITE-BACK. Replaces the shipped
--    `record_source_refund_provider_event` (20270131001221:633) BYTE-FOR-BYTE
--    except for the subject-routing block, which is rewritten below and is the
--    only behavioural change in this function.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.record_source_refund_provider_event(
  p_refund_id uuid,p_leg_type text,p_attempt_no integer,p_event_key text,
  p_provider_event_type text,p_provider_event_id text,p_next_state text,
  p_amount_observed_cents integer,p_provider_operation_id text DEFAULT NULL,
  p_safe_reason_code text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v public.source_refunds%ROWTYPE; v_old text; v_attempt uuid; v_expected integer;
DECLARE v_event_id bigint;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_leg_type NOT IN ('buyer_refund','application_fee_reversal')
     OR p_next_state NOT IN (
       'queued','provider_pending','needs_attention','processed',
       'failed_retryable','failed_terminal'
     ) OR p_attempt_no<1 OR p_amount_observed_cents<0 THEN
    RAISE EXCEPTION 'invalid_provider_event';
  END IF;
  SELECT * INTO v FROM public.source_refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  SELECT id INTO v_attempt FROM public.source_refund_attempts
   WHERE refund_id=p_refund_id AND leg_type=p_leg_type AND attempt_no=p_attempt_no;
  IF v_attempt IS NULL THEN RAISE EXCEPTION 'attempt_not_found'; END IF;
  IF (p_leg_type='buyer_refund' AND p_attempt_no<>v.active_buyer_attempt_no)
     OR (p_leg_type='application_fee_reversal' AND p_attempt_no<>v.active_fee_attempt_no) THEN
    RAISE EXCEPTION 'stale_attempt';
  END IF;
  v_expected:=CASE WHEN p_leg_type='buyer_refund'
    THEN v.buyer_refund_requested_cents ELSE v.fee_reversal_required_cents END;
  IF p_next_state='processed' AND p_amount_observed_cents<>v_expected THEN
    RAISE EXCEPTION 'provider_amount_mismatch';
  END IF;
  v_old := CASE WHEN p_leg_type='buyer_refund' THEN v.buyer_state ELSE v.fee_state END;
  IF v_old='processed' AND p_next_state<>'processed' THEN
    RETURN public.issue_1221_source_refund_summary(v);
  END IF;
  INSERT INTO public.source_refund_events(
    refund_id,attempt_id,leg_type,event_key,event_type,from_state,to_state,
    amount_observed_cents,provider_event_type,provider_event_id,safe_reason_code,actor_type
  ) VALUES (
    p_refund_id,v_attempt,p_leg_type,p_event_key,
    CASE WHEN p_next_state='processed' THEN 'processed'
         WHEN p_next_state='needs_attention' THEN 'needs_attention'
         WHEN p_next_state LIKE 'failed%' THEN 'failed' ELSE 'provider_pending' END,
    v_old,p_next_state,p_amount_observed_cents,p_provider_event_type,p_provider_event_id,
    p_safe_reason_code,'provider'
  ) ON CONFLICT(event_key) DO NOTHING RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN
    SELECT id INTO v_event_id FROM public.source_refund_events
      WHERE event_key=p_event_key;
    RETURN public.issue_1221_source_refund_summary(v)
      ||jsonb_build_object('source_refund_event_id',v_event_id);
  END IF;
  UPDATE public.source_refund_attempts SET
    provider_operation_id=COALESCE(provider_operation_id,p_provider_operation_id),
    provider_status=p_next_state,
    first_submitted_at=COALESCE(first_submitted_at,now()),
    last_submitted_at=now(),
    reconcile_count=reconcile_count+1,
    terminal_observed_at=CASE WHEN p_next_state IN ('processed','failed_terminal')
      THEN COALESCE(terminal_observed_at,now()) ELSE terminal_observed_at END,
    last_error_code=CASE WHEN p_next_state LIKE 'failed%' OR p_next_state='needs_attention'
      THEN p_safe_reason_code ELSE NULL END,
    updated_at=now()
  WHERE id=v_attempt;
  IF p_leg_type='buyer_refund' THEN
    UPDATE public.source_refunds SET
      buyer_state=p_next_state,
      buyer_refund_processed_cents=CASE WHEN p_next_state='processed' THEN buyer_refund_requested_cents ELSE buyer_refund_processed_cents END,
      provider_refund_id=COALESCE(provider_refund_id,p_provider_operation_id),
      provider_status=p_next_state,provider_state_at=now(),
      last_error_code=CASE WHEN p_next_state LIKE 'failed%' OR p_next_state='needs_attention'
        THEN p_safe_reason_code ELSE NULL END,
      attention_generation=CASE
        WHEN p_next_state='needs_attention'
          THEN attention_generation+1 ELSE attention_generation END,
      attention_action_type=CASE
        WHEN p_next_state='needs_attention' AND provider='paystack'
          THEN 'paystack_customer_details' ELSE attention_action_type END,
      attention_expires_at=CASE
        WHEN p_next_state='needs_attention' THEN now()+interval '72 hours'
        ELSE attention_expires_at END,
      attention_message_code=CASE
        WHEN p_next_state='needs_attention' THEN 'refund_bank_details_required'
        ELSE attention_message_code END,
      attention_completed_at=CASE
        WHEN p_next_state='processed' THEN COALESCE(attention_completed_at,now())
        WHEN p_next_state='needs_attention' THEN NULL
        ELSE attention_completed_at END,
      attention_token_hash=NULL,
      attention_token_key_id=NULL,
      attention_submission_claim_id=NULL,
      attention_submission_claimed_at=NULL,
      attention_submission_claim_expires_at=NULL,
      attention_submission_claim_renewed_at=NULL,
      processed_at=CASE WHEN p_next_state='processed' THEN COALESCE(processed_at,now()) ELSE processed_at END,
      updated_at=now() WHERE id=p_refund_id RETURNING * INTO v;
  ELSE
    UPDATE public.source_refunds SET
      fee_state=p_next_state,
      fee_reversal_processed_cents=CASE WHEN p_next_state='processed' THEN fee_reversal_required_cents ELSE fee_reversal_processed_cents END,
      stripe_application_fee_refund_id=COALESCE(stripe_application_fee_refund_id,p_provider_operation_id),
      last_error_code=CASE WHEN p_next_state LIKE 'failed%' OR p_next_state='needs_attention'
        THEN p_safe_reason_code ELSE NULL END,
      updated_at=now() WHERE id=p_refund_id RETURNING * INTO v;
  END IF;
  IF p_leg_type='buyer_refund' AND p_next_state='processed' THEN
    UPDATE public.source_refund_ledger_allocations
      SET state='posted',posted_at=COALESCE(posted_at,now()),
        provider_effect_reference=COALESCE(provider_effect_reference,p_provider_operation_id)
    WHERE refund_id=v.id AND allocation_type='buyer_refund' AND state='prepared';
    PERFORM public.issue_1221_post_organizer_refund_liability(v.id,now());
    -- ===================================================================
    -- Issue #1846 C-1 — THE SUBJECT WRITE-BACK, ROUTED EXPLICITLY.
    --
    -- WHAT WAS BROKEN: this dispatch was `IF venue_reservation ... ELSE
    -- event_rsvp_contributions`, so EVERY other source_type fell into the
    -- rsvp branch and updated `event_rsvp_contributions WHERE id =
    -- <some other table's pk>` — zero rows, no error, no log. For
    -- `venue_menu_order` that meant a fully-processed refund left
    -- `venue_orders.refunded_amount_cents` at 0 and `payment_status` at
    -- 'paid' FOREVER: the amount guard in pg_venue_order_mint_refund became
    -- dead code, every refunded order read as paid on the staff queue,
    -- organiser liability double-counted in the ledger, and the unreconciled
    -- row blocked that order's payout release permanently.
    --
    -- Now every known source_type is named, and an UNKNOWN one is LOUD
    -- rather than silently writing the wrong table. A silent mis-route is
    -- what made this survive review twice.
    -- ===================================================================
    IF v.source_type='venue_reservation' THEN
      UPDATE public.reservations SET payment_status='refunded',updated_at=now()
      WHERE id=v.subject_id AND payment_status<>'refunded';
    ELSIF v.source_type='rsvp_contribution' THEN
      UPDATE public.event_rsvp_contributions
      SET refunded_amount_cents=LEAST(
            buyer_total_cents,refunded_amount_cents+v.buyer_refund_requested_cents
          ),
          status=CASE
            WHEN refunded_amount_cents+v.buyer_refund_requested_cents>=buyer_total_cents
              THEN 'refunded' ELSE 'partially_refunded' END,
          refund_reason=v.reason,updated_at=now()
      WHERE id=v.subject_id;
    ELSIF v.source_type='venue_menu_order' THEN
      -- The three SET expressions all read the PRE-UPDATE row, so
      -- `refunded_amount_cents + requested` means the same thing in each —
      -- the same shape the rsvp branch above has always used.
      --
      -- `money_path='mingla'` is in the predicate because P-3 CHECK 4 forbids
      -- a venue-collected order from carrying ANY refunded amount. Such an
      -- order can never have a source_refunds row (the mint refuses it), but
      -- if one ever appeared, writing here would raise a check violation and
      -- abort the provider event mid-transaction — losing the refund's own
      -- state as well. Fail quiet on the impossible row, loud on the unknown
      -- type.
      UPDATE public.venue_orders
      SET refunded_amount_cents=LEAST(
            total_cents,refunded_amount_cents+v.buyer_refund_requested_cents
          ),
          payment_status=CASE
            WHEN refunded_amount_cents+v.buyer_refund_requested_cents>=total_cents
              THEN 'refunded' ELSE 'partial_refund' END,
          -- A fully-refunded order that still reads "Delivered" on the queue
          -- is the same class of lie as one that still reads "paid". Only the
          -- refund rail may make the `delivered -> refunded` move that P-26's
          -- map reserves for it, and this IS the refund rail. Every other
          -- fulfillment state is left exactly as it is: a guest-cancelled
          -- order stays `cancelled` (terminal), and a live ticket is not
          -- yanked off the pass by a money event.
          fulfillment_status=CASE
            WHEN fulfillment_status='delivered'
             AND refunded_amount_cents+v.buyer_refund_requested_cents>=total_cents
              THEN 'refunded' ELSE fulfillment_status END,
          updated_at=now()
      WHERE id=v.subject_id AND money_path='mingla';
    ELSE
      -- No subject write-back exists for this source_type. Today that is
      -- `stay_reservation`, which reached the rsvp branch before this change
      -- and updated zero rows there — so behaviour is UNCHANGED, but it is
      -- now an explicit, logged no-op instead of a wrong-table write nobody
      -- could see. Registered for #1767's orchestrator rather than fixed
      -- here: a stay write-back needs its own contract, not a drive-by.
      RAISE LOG 'record_source_refund_provider_event: no subject write-back for source_type % (refund %)',
        v.source_type, v.id;
    END IF;
  END IF;
  IF p_leg_type='application_fee_reversal' AND p_next_state='processed' THEN
    UPDATE public.source_refund_ledger_allocations
      SET state='posted',posted_at=COALESCE(posted_at,now()),
        provider_effect_reference=COALESCE(provider_effect_reference,p_provider_operation_id)
    WHERE refund_id=v.id
      AND allocation_type='platform_application_fee_reversal' AND state='prepared';
  END IF;
  UPDATE public.source_refunds SET financial_state=CASE
    WHEN buyer_state='processed' AND fee_state IN ('processed','not_required') THEN 'reconciled'
    WHEN buyer_state='failed_terminal' OR fee_state='failed_terminal' THEN 'failed_terminal'
    WHEN buyer_state='needs_attention' OR fee_state='needs_attention' THEN 'needs_attention'
    ELSE 'pending' END, lease_owner=NULL,leased_at=NULL
  WHERE id=p_refund_id RETURNING * INTO v;
  RETURN public.issue_1221_source_refund_summary(v)
    ||jsonb_build_object(
      'source_refund_event_id',v_event_id,
      'attention_generation',v.attention_generation
    );
END $$;

-- ===========================================================================
-- 2. C-1(a) — THE MINT. Dedupe on the ORDER, not on the refund KIND.
--
-- The shipped guard looked for an existing row with the SAME `refund_kind`,
-- so `venue_order_guest_cancel` and `venue_order_venue_approved` were two
-- independent doors onto one charge. Now: one order, one live refund. The
-- amount is also netted against refunds already IN FLIGHT, not merely against
-- what has already been processed — between minting and the provider
-- confirming, `refunded_amount_cents` is still 0, so "already processed" is
-- exactly the wrong question during the window where a double actually
-- happens.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.pg_venue_order_mint_refund(
  p_order_id             uuid,
  p_refund_kind          text,
  p_requested_by_type    text,
  p_requested_by_user_id uuid,
  p_reason               text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_order      public.venue_orders%ROWTYPE;
  v_refund     public.source_refunds%ROWTYPE;
  v_fee        int;
  v_amount     int;
  v_reason     text;
  v_in_flight  int;
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_refund_kind NOT IN ('venue_order_guest_cancel', 'venue_order_venue_approved') THEN
    RAISE EXCEPTION 'invalid_refund_kind' USING ERRCODE = '22023';
  END IF;
  IF p_requested_by_type NOT IN ('guest', 'brand_staff') THEN
    RAISE EXCEPTION 'invalid_requested_by_type' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_order FROM public.venue_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_order.money_path <> 'mingla' OR v_order.payment_status NOT IN ('paid', 'partial_refund')
     OR v_order.total_cents <= 0 THEN
    RETURN jsonb_build_object('refundId', NULL, 'reason', 'no_mingla_money_to_return');
  END IF;

  -- ONE ORDER, ONE LIVE REFUND. Any kind, any non-terminal state. A caller
  -- asking for a second refund on a charge that already has one gets the
  -- FIRST one back — the honest answer, and the one that cannot double a
  -- guest's money.
  SELECT * INTO v_refund FROM public.source_refunds
   WHERE source_type = 'venue_menu_order' AND source_id = p_order_id
     AND buyer_state <> 'failed_terminal'
   ORDER BY created_at
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('refundId', v_refund.id, 'reason', 'already_requested',
                              'refundKind', v_refund.refund_kind);
  END IF;

  -- What is left to give back: the charge, minus what has already been
  -- returned, minus anything a live sibling row has already claimed.
  SELECT coalesce(sum(sr.buyer_refund_requested_cents - sr.buyer_refund_processed_cents), 0)
    INTO v_in_flight
    FROM public.source_refunds sr
   WHERE sr.source_type = 'venue_menu_order' AND sr.source_id = p_order_id
     AND sr.buyer_state NOT IN ('failed_terminal', 'processed');

  v_amount := greatest(
    0, v_order.total_cents - v_order.refunded_amount_cents - coalesce(v_in_flight, 0));
  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('refundId', NULL, 'reason', 'already_fully_refunded');
  END IF;
  v_fee := least(v_amount, coalesce(v_order.mingla_fee_cents, 0));

  -- source_refunds.reason is CHECK'd to 3..500 characters. A one-character
  -- note from a caller must not become a constraint violation on a money row.
  v_reason := left(btrim(coalesce(p_reason, '')), 480);
  IF length(v_reason) < 3 THEN
    v_reason := CASE WHEN p_refund_kind = 'venue_order_guest_cancel'
                     THEN 'Guest cancelled an unacknowledged venue order'
                     ELSE 'Venue approved a refund on a venue order' END;
  END IF;

  INSERT INTO public.source_refunds(
    source_type, source_id, subject_id, brand_id, venue_id, refund_kind,
    requested_by_type, requested_by_user_id, reason, provider, currency,
    original_charge_cents, buyer_refund_requested_cents,
    original_application_fee_cents, fee_reversal_required_cents,
    fee_state, fee_leg_kind, financial_state,
    organizer_refund_liability_cents, platform_fee_absorption_cents,
    provider_payment_reference, provider_account_reference, idempotency_key
  ) VALUES (
    'venue_menu_order', p_order_id, p_order_id, v_order.brand_id, v_order.venue_id,
    p_refund_kind, p_requested_by_type, p_requested_by_user_id, v_reason,
    coalesce(v_order.provider, 'stripe'), upper(v_order.currency),
    v_order.total_cents, v_amount,
    v_order.mingla_fee_cents, v_fee,
    CASE WHEN v_fee = 0 THEN 'not_required' ELSE 'queued' END,
    CASE WHEN v_fee = 0 THEN 'not_required'
         WHEN coalesce(v_order.provider, 'stripe') = 'stripe'
           THEN 'stripe_application_fee_refund'
         ELSE 'paystack_ledger_allocation' END,
    'pending',
    v_amount - v_fee, v_fee,
    coalesce(v_order.stripe_charge_id, v_order.stripe_payment_intent_id,
             v_order.paystack_reference, 'venue_order:' || p_order_id::text),
    v_order.stripe_account_id,
    p_refund_kind || ':' || p_order_id::text
  ) RETURNING * INTO v_refund;

  INSERT INTO public.source_refund_ledger_allocations(
    refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
  ) VALUES (
    v_refund.id, 'buyer_refund', v_refund.buyer_refund_requested_cents,
    v_refund.currency, v_refund.provider, 'prepared',
    'source-refund-allocation:buyer:' || v_refund.id);
  IF v_refund.organizer_refund_liability_cents > 0 THEN
    INSERT INTO public.source_refund_ledger_allocations(
      refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
    ) VALUES (
      v_refund.id, 'organizer_refund_liability', v_refund.organizer_refund_liability_cents,
      v_refund.currency, v_refund.provider, 'prepared',
      'source-refund-allocation:organizer:' || v_refund.id);
  END IF;
  IF v_refund.platform_fee_absorption_cents > 0 THEN
    INSERT INTO public.source_refund_ledger_allocations(
      refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
    ) VALUES (
      v_refund.id, 'platform_application_fee_reversal', v_refund.platform_fee_absorption_cents,
      v_refund.currency, v_refund.provider, 'prepared',
      'source-refund-allocation:platform:' || v_refund.id);
  END IF;
  INSERT INTO public.source_refund_events(
    refund_id, event_key, event_type, to_state, actor_type, safe_reason_code
  ) VALUES (
    v_refund.id, 'requested:' || v_refund.id, 'requested', 'queued',
    CASE WHEN p_requested_by_type = 'guest' THEN 'guest' ELSE 'operator' END,
    CASE WHEN p_refund_kind = 'venue_order_guest_cancel'
         THEN 'venue_order_guest_cancel' ELSE 'venue_order_venue_approved' END);

  RETURN jsonb_build_object('refundId', v_refund.id, 'reason', 'queued',
                            'amountCents', v_amount);
END;
$function$;

COMMENT ON FUNCTION public.pg_venue_order_mint_refund(uuid, text, text, uuid, text) IS
  'SPEC #1788 P-52, hardened at #1846 C-1 — the ONLY way a venue order gets a '
  'source_refunds row. ONE ORDER, ONE LIVE REFUND: deduped on the order rather '
  'than the refund_kind, because the guest-cancel and venue-approved kinds were '
  'otherwise two doors onto one charge. The amount is netted against in-flight '
  'siblings as well as processed ones.';

REVOKE ALL ON FUNCTION public.pg_venue_order_mint_refund(uuid, text, text, uuid, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_venue_order_mint_refund(uuid, text, text, uuid, text)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_venue_order_mint_refund(uuid, text, text, uuid, text)
  TO service_role;

-- ===========================================================================
-- 3. C-1(a) — THE DECISION. A decision answers a REQUEST.
--
-- The shipped version would approve a refund on an order nobody had asked
-- about, and on an order that had already been cancelled and refunded in full.
-- Both now refuse, ahead of the mint's own dedupe, so the caller gets a
-- specific error instead of a silent no-op.
--
-- DELIBERATE NARROWING, STATED: P-52 allows a venue to INITIATE a refund as
-- well as approve one. A decision RPC with no request to decide is the wrong
-- home for that act — it is what let the double happen — and no shipped
-- surface uses it: `VenueOrderDetailSheet` renders the approve/decline block
-- only when `hasOpenRefundRequest(order)` is true. A venue-initiated refund
-- needs its own named action with its own confirmation; registered for the
-- orchestrator rather than smuggled through this one.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.biz_venue_order_refund_decision(
  p_order_id uuid,
  p_decision text,
  p_note     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_order  public.venue_orders%ROWTYPE;
  v_uid    uuid := auth.uid();
  v_refund jsonb := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('approved', 'declined') THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;
  -- A DECLINE must say why. "No" with no reason is what makes a guest feel
  -- robbed; the copy the guest reads is this note.
  IF p_decision = 'declined' AND length(btrim(coalesce(p_note, ''))) < 3 THEN
    RAISE EXCEPTION 'decline_reason_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_order FROM public.venue_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Refunding is a money act: event_manager+, the same floor a cancel needs.
  IF public.biz_brand_effective_rank_for_caller(v_order.brand_id)
     < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_order.refund_decision IS NOT NULL THEN
    RETURN jsonb_build_object('orderId', p_order_id,
                              'decision', v_order.refund_decision, 'replayed', true);
  END IF;

  -- #1846 C-1 GUARD 1 — there must be something to decide.
  IF v_order.refund_requested_at IS NULL THEN
    RAISE EXCEPTION 'no_refund_requested' USING ERRCODE = 'P0001';
  END IF;

  -- #1846 C-1 GUARD 2 — the money is already gone back. This is the exact
  -- shape the tester reproduced: the guest cancelled (a full refund, no
  -- request), and a manager then tapped Approve on the same charge.
  IF v_order.payment_status IN ('refunded', 'cancelled')
     OR v_order.refunded_amount_cents >= v_order.total_cents
     OR EXISTS (
       SELECT 1 FROM public.source_refunds sr
        WHERE sr.source_type = 'venue_menu_order' AND sr.source_id = p_order_id
          AND sr.buyer_state <> 'failed_terminal') THEN
    RAISE EXCEPTION 'already_refunded' USING ERRCODE = 'P0001';
  END IF;

  IF p_decision = 'approved' THEN
    v_refund := public.pg_venue_order_mint_refund(
      p_order_id, 'venue_order_venue_approved', 'brand_staff', v_uid,
      coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Venue approved a refund'));
  END IF;

  UPDATE public.venue_orders
     SET refund_decision = p_decision,
         refund_decided_by_user_id = v_uid,
         metadata = CASE
           WHEN p_note IS NULL OR length(btrim(p_note)) = 0 THEN metadata
           ELSE metadata || jsonb_build_object('refund_decision_note',
                                               left(btrim(p_note), 280))
         END
   WHERE id = p_order_id;

  RETURN jsonb_build_object('orderId', p_order_id, 'decision', p_decision,
                            'refund', v_refund, 'replayed', false);
END;
$function$;

COMMENT ON FUNCTION public.biz_venue_order_refund_decision(uuid, text, text) IS
  'SPEC #1788 P-25 / P-52, hardened at #1846 C-1 — the venue''s approve-or-'
  'explain answer to a guest''s refund REQUEST. Refuses when nothing was asked '
  '(no_refund_requested) and when the charge has already been returned '
  '(already_refunded). A DECLINE must carry a reason: the guest reads it.';

REVOKE ALL ON FUNCTION public.biz_venue_order_refund_decision(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_venue_order_refund_decision(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_venue_order_refund_decision(uuid, text, text)
  TO authenticated, service_role;

-- ===========================================================================
-- 4. H-1 — LOCK THE ORDERING SETTINGS TABLE.
--
-- #1789 gave this table a `FOR ALL` policy AND full DML grants to
-- `authenticated`, so every "the ONLY writer is the RPC" claim about
-- `ordering_enabled` and `paused_at` was false the day it was written: a
-- rank-40 event_manager could PATCH the row through PostgREST and skip the
-- RPC's `claim_status='verified'` gate entirely, and could stamp
-- `paused_by_user_id` with any uuid at all.
--
-- The fix is the posture the ORDER tables already have (20270310001790):
-- SELECT to `authenticated` so the venue can still see its own switches, and
-- every write through the two SECURITY DEFINER RPCs, which take the actor from
-- `auth.uid()` and cannot be told otherwise. That also closes the
-- attribution hole without an FK on `paused_by_user_id` — an FK with
-- ON DELETE SET NULL would break the pause_shape CHECK the moment a staff
-- account was deleted, and every other actor column in this family is a
-- deliberate soft ref that survives departure.
--
-- A strict-grep gate cannot see a PostgREST verb, so the proof of this is a
-- LIVE attempt as a real rank-40 member (T-H1 in the sibling test file).
-- ===========================================================================
DROP POLICY IF EXISTS "venue_ordering_settings manager plus can write"
  ON public.venue_ordering_settings;

REVOKE INSERT, UPDATE, DELETE ON public.venue_ordering_settings FROM authenticated;
REVOKE ALL ON public.venue_ordering_settings FROM anon;
GRANT SELECT ON public.venue_ordering_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_ordering_settings TO service_role;

COMMENT ON COLUMN public.venue_ordering_settings.ordering_enabled IS
  'Issue #1789, LOCKED at #1846 H-1: DEFAULT FALSE, and the ONLY path to TRUE '
  'is biz_venue_ordering_set_enabled — which is now true in the grant table, '
  'not merely in prose. Direct DML by `authenticated` was revoked because the '
  'RPC''s claim_status=''verified'' gate was bypassable through PostgREST '
  '(orchestrator ruling OQ-7).';
COMMENT ON COLUMN public.venue_ordering_settings.paused_at IS
  'Issue #1789 (D-7b, I-PROPOSED-1767-NEVER-PAUSE-A-VENUE-FOR-THEM), LOCKED at '
  '#1846 H-1: exactly ONE writer — biz_venue_ordering_pause, which stamps '
  'paused_by_user_id from auth.uid(). No sweep, cron, webhook, admin action or '
  'PostgREST client can reach this column. Orders keep flowing while a venue is '
  'slow; the safety valve is the guest''s own way out, never a platform kill '
  'switch.';

-- ===========================================================================
-- 5. M-1 + M-2 — THE ESCALATION CLOCK AND WHOSE MONEY IS ON THE TABLE.
--
-- M-1: the clock ran from `created_at`, which is when the guest opened
-- checkout, not when they paid. An order whose checkout took eleven minutes
-- arrived already past every threshold and got rung 3 — the FINAL owner-only
-- alert — as its first and last word. The floor and the managers were never
-- told at all, which is the precise opposite of what the ladder is for. The
-- clock now starts at `confirmed_at` (set by the webhook finalize, and at
-- create for a zero-total order), falling back to `created_at` only if a paid
-- order somehow lacks one.
--
-- M-2: #1791's own comment claimed venue-collected orders were excluded
-- "because they are pending until settle" — but `biz_venue_tab_close` flips
-- them to `paid`, so a settled cash order sailed into the sweep and paged the
-- owner about a ticket the waiter was holding, in which Mingla holds nothing.
-- The predicate now says what the comment claimed.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.pg_venue_order_escalation_scan(
  p_now   timestamptz DEFAULT now(),
  p_limit int DEFAULT 50
) RETURNS TABLE (
  order_id            uuid,
  brand_id            uuid,
  venue_id            uuid,
  venue_name          text,
  rung                smallint,
  spot_label          text,
  pickup_code         text,
  buyer_name          text,
  currency            text,
  total_cents         int,
  placed_at           timestamptz,
  unacked_seconds     int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT o.id,
           coalesce(o.confirmed_at, o.created_at) AS paid_at,
           CASE
             WHEN p_now - coalesce(o.confirmed_at, o.created_at) >= interval '10 minutes' THEN 3
             WHEN p_now - coalesce(o.confirmed_at, o.created_at) >= interval '5 minutes'  THEN 2
             ELSE 1
           END::smallint AS target
      FROM public.venue_orders o
     WHERE o.acknowledged_at IS NULL
       AND o.fulfillment_status = 'placed'
       AND o.payment_status = 'paid'
       -- M-2: Mingla is holding this money. A venue-collected order is the
       -- waiter's cash and the waiter's problem, and paging an owner about it
       -- is noise with no money behind it.
       AND o.money_path = 'mingla'
       AND p_now - coalesce(o.confirmed_at, o.created_at) >= interval '2 minutes'
       AND o.escalation_level < CASE
             WHEN p_now - coalesce(o.confirmed_at, o.created_at) >= interval '10 minutes' THEN 3
             WHEN p_now - coalesce(o.confirmed_at, o.created_at) >= interval '5 minutes'  THEN 2
             ELSE 1
           END
     ORDER BY coalesce(o.confirmed_at, o.created_at)
     LIMIT greatest(1, coalesce(p_limit, 50))
     FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.venue_orders o
       SET escalation_level = due.target,
           escalated_at = p_now
      FROM due
     WHERE o.id = due.id
    RETURNING o.id, o.brand_id, o.venue_id, o.spot_label_at_order, o.pickup_code,
              o.buyer_name, o.currency, o.total_cents,
              due.paid_at AS paid_at, due.target AS target
  )
  SELECT c.id, c.brand_id, c.venue_id,
         coalesce(v.name, 'your venue')::text,
         c.target,
         c.spot_label_at_order, c.pickup_code, c.buyer_name,
         c.currency, c.total_cents, c.paid_at,
         extract(epoch FROM (p_now - c.paid_at))::int
    FROM claimed c
    LEFT JOIN public.venue_listings v ON v.id = c.venue_id
   ORDER BY c.paid_at;
END;
$function$;

COMMENT ON FUNCTION public.pg_venue_order_escalation_scan(timestamptz, int) IS
  'SPEC #1788 P-55, corrected at #1846 M-1/M-2 — the unacknowledged-order '
  'ladder. The clock starts at PAYMENT (confirmed_at), not at checkout-open, so '
  'a slow checkout can no longer skip the floor and the managers straight to '
  'the final owner alert. Only Mingla-path money escalates. Its ENTIRE write '
  'surface is still escalation_level + escalated_at: it never refunds, never '
  'cancels, never pauses a venue, and never sends an SMS.';

REVOKE ALL ON FUNCTION public.pg_venue_order_escalation_scan(timestamptz, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_venue_order_escalation_scan(timestamptz, int)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_venue_order_escalation_scan(timestamptz, int)
  TO service_role;

COMMIT;
