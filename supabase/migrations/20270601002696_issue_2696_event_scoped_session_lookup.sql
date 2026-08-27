BEGIN;
-- ===========================================================================
-- issue #2696 — A SESSION IS ONLY EVER RESOLVED FOR THE EVENT IT BELONGS TO.
--
-- `biz_ticket_checkout_create_session` looked up an existing session by
-- idempotency key alone. The key carries a UNIQUE constraint with no event or
-- brand column, so its event-scoping lived entirely in the string the edge
-- happened to compose — an implicit property, not an enforced one.
--
-- WHAT THAT ALLOWED, with no secret of any kind. Disclosure of an order or a QR
-- payload still required the victim's 256-bit `buyer_status_token`, so this was
-- never a route to somebody's pass — that claim was investigated and withdrawn.
-- Two things were reachable without any token at all:
--
--   (a) A CROSS-EVENT EXISTENCE ORACLE. Naming any sellable public event, a
--       caller learned whether a completed free reservation existed for a given
--       email, phone and cart — including on PRIVATE and `named_buyers` events,
--       and events outside their sale window, all of which would have refused
--       them outright at this function's own gates had they named the event
--       honestly.
--
--   (b) A CROSS-EVENT TOKEN OVERWRITE. On an in-flight session the in-flight arm
--       returned the victim's envelope, the replay decision was computed against
--       the WRONG event's access mode, and the edge then overwrote that guest's
--       `buyer_status_token_hash` — killing their checkout on an event the
--       caller could not otherwise touch.
--
-- Both are availability and privacy failures rather than theft, and both stop
-- here. The paired edge change removes the caller-supplied key that made the
-- implicit scoping defeatable; this conjunct makes the scoping ENFORCED, so it
-- holds even if a colliding key arrives by some other route.
--
-- NOT A BEHAVIOUR CHANGE FOR ANY REAL TRAFFIC: 179 of 179 live sessions already
-- satisfy the relationship this now requires, and none violate it. There is no
-- evidence of prior exploitation.
--
-- Re-emitted from the INSTALLED definition via `pg_get_functiondef`, signature
-- byte-identical — not from the migration file, which can drift from what runs.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session(p_event_id uuid, p_buyer_user_id uuid, p_buyer_name text, p_buyer_email text, p_buyer_phone_e164 text, p_marketing_opt_in boolean, p_lines jsonb, p_idempotency_key text, p_expires_at timestamp with time zone, p_application_fee_amount_cents integer DEFAULT 0, p_payment_plan_choice text DEFAULT 'auto'::text, p_event_date_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_existing record;
  v_items jsonb := '[]'::jsonb;
  v_result jsonb;
  v_decision text;
  v_replay_decision text;
  v_snapshot jsonb;
  v_mode text;
  v_session_id uuid;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  -- #2101 A3.1 — brand lock immediately after the event lock.
  PERFORM 1 FROM public.brands
    WHERE id=v_event.brand_id AND deleted_at IS NULL FOR UPDATE;
  IF public.issue_1930_event_sale_reason(v_event)<>'sellable' THEN
    RAISE EXCEPTION 'event_not_selling';
  END IF;

  -- #2101 — fresh decision BEFORE the idempotency replay owner.
  v_decision := public.issue_2101_ticket_checkout_access_decision(
    p_event_id, p_buyer_user_id);
  IF v_decision='sign_in_required' THEN
    RAISE EXCEPTION 'checkout_sign_in_required';
  END IF;
  IF v_decision NOT IN ('allowed_unrestricted','allowed_named') THEN
    RAISE EXCEPTION 'checkout_restricted';
  END IF;
  v_snapshot := public.issue_2101_current_access_snapshot(p_event_id,p_buyer_user_id);
  v_mode := v_snapshot->>'mode';

  -- issue #2696 — SCOPED TO THE EVENT BEING BOUGHT.
  --
  -- This lookup resolved a session by idempotency key ALONE. The key is globally
  -- UNIQUE with no event or brand column, and its event-scoping was only ever an
  -- implicit property of how the edge composed it. That made it defeatable the
  -- moment a caller could supply their own key, which the edge accepted verbatim
  -- until #2696 removed it.
  --
  -- The conjunct here is the durable half of that fix: even a caller-supplied or
  -- colliding key can no longer return a session belonging to a different event.
  -- Without it, a request naming event B could be answered with event A's
  -- session, and every decision after this point — the #2101 access mode, the
  -- named-buyer cross-check, the status-token write — was then made against B's
  -- rules on A's row.
  --
  -- NOT A BEHAVIOUR CHANGE: all 179 live sessions already satisfy
  -- `idempotency_key LIKE 'ticket_checkout:' || event_id || ':%'`, and 0 do not.
  -- A legitimate resubmit derives the same key for the same event and still
  -- finds its row.
  SELECT *
    INTO v_existing
    FROM public.ticket_checkout_sessions
   WHERE idempotency_key=p_idempotency_key
     AND event_id=p_event_id;

  IF FOUND THEN
    -- ═══════════════════════════════════════════════════════════════════════
    -- issue #2150 — A COMPLETED **FREE** RESERVATION IS RETURNED, NOT REMINTED.
    --
    -- This block is evaluated BEFORE the ORCH-0791 terminal tombstone and
    -- before the ORCH-0829-B D-1 expiry tombstone, and it is the ONLY thing
    -- that changed in this function. Every conjunct is load-bearing:
    --
    --   status='free_completed'  the only status `biz_ticket_checkout_finalize`
    --                            assigns when `total_cents = 0`.
    --   total_cents = 0          independent proof this carried NO money, so
    --                            the paid arm cannot enter here even if a
    --                            status were corrupted. THIS is the conjunct
    --                            that scopes the change to the zero-total case.
    --   order_id IS NOT NULL     there is something to hand back.
    --   revoked_at IS NULL       the sale was not revoked (#2079 / #1930).
    --   buyer identity matches   an anonymous guest is (NULL,NULL) and matches
    --                            itself; a DIFFERENT signed-in user presenting
    --                            the same derived key falls through to today's
    --                            behaviour rather than being handed someone
    --                            else's passes.
    --   a live ticket exists     a cancelled / refunded / voided reservation is
    --                            NOT a reservation the guest still holds, so it
    --                            falls through and they can re-reserve.
    --
    -- On a match the guest's ORIGINAL session is returned untouched: the key is
    -- NOT renamed, no row is inserted, and `ticket-checkout-create` answers
    -- with that same order's already-issued tickets — one order, one ticket,
    -- one confirmation email and one SMS, however many times they submit.
    -- ═══════════════════════════════════════════════════════════════════════
    IF v_existing.status='free_completed'
       AND COALESCE(v_existing.total_cents,0)=0
       AND v_existing.order_id IS NOT NULL
       AND v_existing.revoked_at IS NULL
       AND v_existing.buyer_user_id IS NOT DISTINCT FROM p_buyer_user_id
       AND EXISTS(SELECT 1 FROM public.tickets t
                   WHERE t.order_id=v_existing.order_id
                     AND t.status IN ('valid','used','transferred')) THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ticketTypeId',i.ticket_type_id,
        'ticketName',i.ticket_name_at_purchase,
        'quantity',i.quantity,
        'unitPriceCents',i.unit_price_cents,
        'totalCents',i.total_cents
      ) ORDER BY i.created_at),'[]'::jsonb)
        INTO v_items
        FROM public.ticket_checkout_session_items i
       WHERE i.checkout_session_id=v_existing.id;

      RETURN jsonb_build_object(
        'checkoutSessionId',v_existing.id,
        'eventId',v_existing.event_id,
        'brandId',v_existing.brand_id,
        'status',v_existing.status,
        'totalCents',v_existing.total_cents,
        'subtotalCents',v_existing.total_cents,
        'currency',trim(v_existing.currency),
        'stripeAccountId',v_existing.stripe_account_id,
        'orderId',v_existing.order_id,
        'items',v_items,
        'lineItems',v_items,
        'installmentSchedule',v_existing.installment_schedule
      );
    END IF;

    IF v_existing.status IN ('paid_completed','free_completed','failed','expired')
       OR v_existing.expires_at < now() THEN
      UPDATE public.ticket_checkout_sessions
         SET idempotency_key=idempotency_key || ':tombstone:' || id::text,
             status=CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN status
               ELSE 'expired'
             END,
             failed_at=CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN failed_at
               WHEN status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect')
                 AND expires_at < now() THEN now()
               ELSE failed_at
             END,
             updated_at=now()
       WHERE id=v_existing.id;
    ELSE
      v_replay_decision := public.issue_2101_ticket_checkout_access_decision(
        p_event_id, v_existing.buyer_user_id,
        v_existing.checkout_access_mode_snapshot,
        v_existing.checkout_access_restrictive_epoch_snapshot,
        v_existing.checkout_access_membership_id_snapshot,
        v_existing.checkout_access_membership_epoch_snapshot);
      IF v_replay_decision NOT IN ('allowed_unrestricted','allowed_named')
         OR (v_mode='named_buyers'
             AND v_existing.buyer_user_id IS DISTINCT FROM p_buyer_user_id) THEN
        RAISE EXCEPTION 'checkout_restricted';
      END IF;

      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ticketTypeId',i.ticket_type_id,
        'ticketName',i.ticket_name_at_purchase,
        'quantity',i.quantity,
        'unitPriceCents',i.unit_price_cents,
        'totalCents',i.total_cents
      ) ORDER BY i.created_at),'[]'::jsonb)
        INTO v_items
        FROM public.ticket_checkout_session_items i
       WHERE i.checkout_session_id=v_existing.id;

      RETURN jsonb_build_object(
        'checkoutSessionId',v_existing.id,
        'eventId',v_existing.event_id,
        'brandId',v_existing.brand_id,
        'status',v_existing.status,
        'totalCents',v_existing.total_cents,
        'subtotalCents',v_existing.total_cents,
        'currency',trim(v_existing.currency),
        'stripeAccountId',v_existing.stripe_account_id,
        'orderId',v_existing.order_id,
        'items',v_items,
        'lineItems',v_items,
        'installmentSchedule',v_existing.installment_schedule
      );
    END IF;
  END IF;

  -- issue #2160 DELTA 2 of 2 — forward the day set. NOTHING ELSE IN THIS
  -- FUNCTION CHANGED: the #2150 free-completed exemption above, the ORCH-0791
  -- terminal tombstone, the ORCH-0829-B expiry tombstone, the #2101 fresh
  -- decision, the event -> brand lock order and the access snapshot write-back
  -- are byte-preserved from 20270419002150:158-358.
  v_result:=public.issue_1930_ticket_checkout_create_session_base(
    p_event_id,p_buyer_user_id,p_buyer_name,p_buyer_email,p_buyer_phone_e164,
    p_marketing_opt_in,p_lines,p_idempotency_key,p_expires_at,
    p_application_fee_amount_cents,p_payment_plan_choice,p_event_date_ids);

  v_session_id := (v_result->>'checkoutSessionId')::uuid;
  IF v_session_id IS NOT NULL THEN
    UPDATE public.ticket_checkout_sessions SET
      checkout_access_mode_snapshot=v_mode,
      checkout_access_restrictive_epoch_snapshot=
        COALESCE((v_snapshot->>'restrictiveEpoch')::bigint,0),
      checkout_access_membership_id_snapshot=
        NULLIF(v_snapshot->>'membershipId','')::uuid,
      checkout_access_membership_epoch_snapshot=
        NULLIF(v_snapshot->>'membershipEpoch','')::bigint
    WHERE id=v_session_id;
  END IF;

  RETURN jsonb_build_object(
    'checkoutSessionId',v_result->'checkoutSessionId',
    'eventId',v_result->'eventId',
    'brandId',v_result->'brandId',
    'status',v_result->'status',
    'totalCents',v_result->'totalCents',
    'subtotalCents',v_result->'subtotalCents',
    'currency',v_result->'currency',
    'stripeAccountId',v_result->'stripeAccountId',
    'orderId',v_result->'orderId',
    'items',v_result->'items',
    'lineItems',v_result->'lineItems',
    'installmentSchedule',v_result->'installmentSchedule'
  );
END $function$;

DO $probe$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='biz_ticket_checkout_create_session';

  IF position('AND event_id=p_event_id' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2696: the session lookup is not scoped to the event';
  END IF;

  -- The #2150 free-completed exemption and the ORCH-0791 tombstone must both
  -- survive; this function owns both and a careless re-emit would drop them.
  --
  -- The first draft of this probe asserted `buyer_status_token_hash` here and
  -- fired immediately — that comparison lives in
  -- `issue_2150_free_replay_disclosure_authorized`, NOT in this function. The
  -- probe was right to refuse; the assertion was about the wrong subject. These
  -- three are markers this function genuinely carries.
  IF position('free_completed' IN v_def) = 0
     OR position('buyer_user_id IS NOT DISTINCT FROM' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2696: the #2150 free-completed exemption was lost';
  END IF;
  IF position('tombstone' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2696: the ORCH-0791 tombstone arm was lost';
  END IF;
  IF position('checkout_restricted' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #2696: the #2101 access fence was lost';
  END IF;

  -- Every live row must still resolve under the stricter rule. If this ever
  -- fails, a real session has an idempotency key that does not name its event
  -- and the conjunct would strand it.
  IF EXISTS (
    SELECT 1 FROM public.ticket_checkout_sessions
     WHERE idempotency_key NOT LIKE 'ticket_checkout:' || event_id::text || '%'
  ) THEN
    RAISE EXCEPTION 'issue #2696: a live session key does not name its own event';
  END IF;
END $probe$;

COMMIT;
