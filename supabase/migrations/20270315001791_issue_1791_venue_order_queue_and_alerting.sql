-- ===========================================================================
-- Issue #1791 — Phase 3 of #1767: the Orders queue and the ALERTING SPINE.
-- Consumes SPEC #1788 P-5, P-6, P-25, P-26, P-53, P-54, P-55, P-66 and the
-- orchestrator rulings OQ-4 (ack floor = ANY brand member) and OQ-7 (the RPC
-- that can set `ordering_enabled = true` ships HERE, not before).
--
-- WHAT THIS IS: the server half of the queue. Phase 2 built the order family
-- and the money; nothing yet let a HUMAN move an order, and nothing yet told
-- anyone an order had arrived. This file adds exactly that, and nothing that
-- moves money on its own.
--
-- FOUR PROMISES MADE STRUCTURAL RATHER THAN TESTED
--   1. `acknowledged` requires a human user id. The CHECK from #1790 already
--      makes a timestamp without a person unwritable; the transition RPC is
--      the only writer and it takes the id from `auth.uid()`, never from its
--      arguments. A render can never imply a tap.
--      (I-PROPOSED-1767-ACK-IS-A-HUMAN-TAP)
--   2. NOTHING here refunds, cancels, or pauses on a timer. The escalation
--      scan's ENTIRE write surface is `escalation_level` + `escalated_at`, and
--      that is enforced by its own strict-grep gate.
--      (I-PROPOSED-1767-NO-MONEY-ON-A-TIMER / -NEVER-PAUSE-A-VENUE-FOR-THEM)
--   3. `venue_ordering_settings.paused_at` has EXACTLY ONE writer:
--      `biz_venue_ordering_pause`, which requires a verified staff user id.
--      No sweep, cron, webhook or failure path can reach it. (D-7b)
--   4. A rung of the ladder fires AT MOST ONCE. `escalation_level` is
--      monotonic and the scan claims a row by raising it in the same UPDATE it
--      returns from, so two concurrent sweeps cannot double-push, and rung 3 is
--      terminal — the ladder STOPS rather than nagging forever. (D-7 / P-55)
--
-- ORDERING DEPENDENCY: this migration references `public.venue_orders`,
-- `public.venue_order_sessions` (#1790) and `public.venue_ordering_settings`
-- (#1789). Its filename sorts after both.
--
-- MONOTONIC VERSION: 20270315001791 > the frontier at implement time
-- (20270313001812_issue_1812_brand_people_export_search_normalization.sql).
--
-- DO NOT run `supabase db push`. Applied via the Supabase Management API after
-- REVIEW (history drift makes a blind push unsafe).
-- ===========================================================================

BEGIN;

-- ===========================================================================
-- 1. THE LEGAL-TRANSITION MAP (P-26) — one implementation, mirrored client-side.
-- ===========================================================================
-- The twin of pg_reservation_transition_is_legal
-- (20261010000001_orch_1148_reservation_lifecycle_rpcs.sql:36-59). The CLIENT
-- mirror in mingla-business/src/components/venue/venueOrderViews.ts only hides
-- illegal buttons; THIS is the authority.
--
-- `delivered -> refunded` is in the map because P-26 puts it there, but the
-- staff transition RPC below REFUSES to write it: a `fulfillment_status` of
-- 'refunded' is a claim that money went back to a guest, and only the refund
-- rail may make that claim. See §4.
CREATE OR REPLACE FUNCTION public.pg_venue_order_transition_is_legal(
  p_from text,
  p_to   text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE p_from
    WHEN 'placed'       THEN p_to IN ('acknowledged', 'cancelled')
    WHEN 'acknowledged' THEN p_to IN ('in_progress', 'ready', 'cancelled')
    WHEN 'in_progress'  THEN p_to IN ('ready', 'cancelled')
    WHEN 'ready'        THEN p_to IN ('delivered', 'cancelled')
    WHEN 'delivered'    THEN p_to IN ('refunded')
    -- 'cancelled' and 'refunded' are terminal.
    ELSE false
  END
$function$;

COMMENT ON FUNCTION public.pg_venue_order_transition_is_legal(text, text) IS
  'SPEC #1788 P-26 — the venue-order lifecycle map. placed -> acknowledged -> '
  'in_progress -> ready -> delivered, cancellable until delivered, refundable '
  'after. Terminal states are terminal. The client mirror is '
  'mingla-business/src/components/venue/venueOrderViews.ts and drifting from '
  'this function is what its unit test exists to catch.';

REVOKE ALL ON FUNCTION public.pg_venue_order_transition_is_legal(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_venue_order_transition_is_legal(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.pg_venue_order_transition_is_legal(text, text)
  TO authenticated, service_role;

-- ===========================================================================
-- 2. THE ACK / ADVANCE RPC (P-26, OQ-4) — the only writer of the lifecycle.
-- ===========================================================================
-- ROLE FLOOR, per orchestrator ruling OQ-4, stated so nobody "hardens" it away:
--   * acknowledged / in_progress / ready / delivered  -> ANY active brand
--     member (rank > 0). Acknowledging is not a money act, and a real floor
--     waiter is often a rank-10 scanner. Raising this floor would mean the
--     person actually holding the ticket cannot say they have it.
--   * cancelled -> event_manager+. Cancelling a PAID order is the front half
--     of a refund; that is a money act.
--   * refunded -> refused here entirely (see §4).
CREATE OR REPLACE FUNCTION public.biz_venue_order_transition(
  p_order_id uuid,
  p_to       text,
  p_reason   text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_order public.venue_orders%ROWTYPE;
  v_uid   uuid := auth.uid();
  v_rank  int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_to IS NULL OR p_to NOT IN (
    'acknowledged', 'in_progress', 'ready', 'delivered', 'cancelled'
  ) THEN
    -- 'refunded' lands here on purpose: it is a MONEY claim, and the refund
    -- rail (§4) is the only thing allowed to make it.
    RAISE EXCEPTION 'transition_not_allowed' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_order FROM public.venue_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_rank := public.biz_brand_effective_rank_for_caller(v_order.brand_id);
  IF v_rank <= 0 THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_to = 'cancelled' AND v_rank < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT public.pg_venue_order_transition_is_legal(v_order.fulfillment_status, p_to) THEN
    RAISE EXCEPTION 'transition_not_allowed' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.venue_orders
     SET fulfillment_status = p_to,
         -- THE HUMAN TAP. Both columns are written from auth.uid(), never from
         -- an argument, so no caller can attribute an acknowledgement to
         -- someone who did not make it, and the #1790 CHECK makes a timestamp
         -- without a person unwritable in the first place.
         acknowledged_at = CASE WHEN p_to = 'acknowledged'
                                THEN coalesce(acknowledged_at, now())
                                ELSE acknowledged_at END,
         acknowledged_by_user_id = CASE WHEN p_to = 'acknowledged'
                                        THEN coalesce(acknowledged_by_user_id, v_uid)
                                        ELSE acknowledged_by_user_id END,
         in_progress_at = CASE WHEN p_to = 'in_progress'
                               THEN coalesce(in_progress_at, now()) ELSE in_progress_at END,
         ready_at       = CASE WHEN p_to = 'ready'
                               THEN coalesce(ready_at, now()) ELSE ready_at END,
         delivered_at   = CASE WHEN p_to = 'delivered'
                               THEN coalesce(delivered_at, now()) ELSE delivered_at END,
         cancelled_at   = CASE WHEN p_to = 'cancelled'
                               THEN coalesce(cancelled_at, now()) ELSE cancelled_at END,
         metadata = CASE
           WHEN p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN metadata
           ELSE metadata || jsonb_build_object(
             'last_transition_reason', left(btrim(p_reason), 280))
         END
   WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'orderId', p_order_id,
    'fulfillmentStatus', p_to,
    'actorUserId', v_uid
  );
END;
$function$;

COMMENT ON FUNCTION public.biz_venue_order_transition(uuid, text, text) IS
  'SPEC #1788 P-26 / ruling OQ-4 — the ONLY path that advances a venue order. '
  'Ack floor is ANY active brand member (a floor waiter is often rank 10); '
  'cancel is event_manager+ because cancelling a paid order is the front half '
  'of a refund; `refunded` is refused outright because only the refund rail '
  'may claim money went back. acknowledged_by_user_id comes from auth.uid(), '
  'never from an argument (I-PROPOSED-1767-ACK-IS-A-HUMAN-TAP).';

REVOKE ALL ON FUNCTION public.biz_venue_order_transition(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_venue_order_transition(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_venue_order_transition(uuid, text, text)
  TO authenticated, service_role;

-- ===========================================================================
-- 3. THE VENUE'S OWN SWITCHES (P-16, D-7b, ruling OQ-7).
-- ===========================================================================
-- `biz_venue_ordering_pause` is the ONLY writer of paused_at /
-- paused_by_user_id in the entire system. That is D-7b made structural: Mingla
-- never switches off a venue's ordering on their behalf, so no sweep, cron,
-- webhook, admin action or failure path may reach these two columns. The
-- strict-grep gate `issue-1791-pause-and-escalation-single-writer.mjs` fails
-- the build if a second writer ever appears.
CREATE OR REPLACE FUNCTION public.biz_venue_ordering_pause(
  p_venue_id uuid,
  p_paused   boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_brand uuid;
  v_uid   uuid := auth.uid();
  v_paused_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_paused IS NULL THEN
    RAISE EXCEPTION 'paused_required' USING ERRCODE = '22023';
  END IF;
  SELECT brand_id INTO v_brand FROM public.venue_listings WHERE id = p_venue_id;
  IF v_brand IS NULL THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF public.biz_brand_effective_rank_for_caller(v_brand)
     < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.venue_ordering_settings (venue_id, brand_id)
  VALUES (p_venue_id, v_brand)
  ON CONFLICT (venue_id) DO NOTHING;

  UPDATE public.venue_ordering_settings
     SET paused_at = CASE WHEN p_paused THEN coalesce(paused_at, now()) ELSE NULL END,
         paused_by_user_id = CASE WHEN p_paused THEN coalesce(paused_by_user_id, v_uid) ELSE NULL END
   WHERE venue_id = p_venue_id
  RETURNING paused_at INTO v_paused_at;

  RETURN jsonb_build_object(
    'venueId', p_venue_id,
    'paused', v_paused_at IS NOT NULL,
    'pausedAt', v_paused_at,
    'pausedByUserId', CASE WHEN v_paused_at IS NULL THEN NULL ELSE v_uid END
  );
END;
$function$;

COMMENT ON FUNCTION public.biz_venue_ordering_pause(uuid, boolean) IS
  'SPEC #1788 P-16 / DESIGN D-7b — the venue''s OWN pause switch and the only '
  'writer of venue_ordering_settings.paused_at anywhere. Mingla never pauses a '
  'venue''s ordering for them; a slow venue is a service problem for that venue '
  'to answer. (I-PROPOSED-1767-NEVER-PAUSE-A-VENUE-FOR-THEM)';

-- Ruling OQ-7 — THE PHASE-3 -> PHASE-4 GATE, made mechanical rather than
-- procedural. This is the ONLY function in the schema that can set
-- `ordering_enabled = true`, and it ships in the same PR as the queue that
-- watches the orders it lets in. Before this migration there was literally no
-- code path to switch a venue on, so money could not arrive unwatched — not by
-- policy, by absence.
CREATE OR REPLACE FUNCTION public.biz_venue_ordering_set_enabled(
  p_venue_id uuid,
  p_enabled  boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_brand  uuid;
  v_uid    uuid := auth.uid();
  v_claim  text;
  v_row    public.venue_ordering_settings%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'enabled_required' USING ERRCODE = '22023';
  END IF;
  SELECT brand_id, claim_status INTO v_brand, v_claim
    FROM public.venue_listings WHERE id = p_venue_id;
  IF v_brand IS NULL THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF public.biz_brand_effective_rank_for_caller(v_brand)
     < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  -- The same gate order-create applies (SPEC P-22 gate 2), applied one step
  -- earlier so a venue is never switched on into a state where every guest
  -- order would be rejected.
  IF p_enabled AND coalesce(v_claim, '') <> 'verified' THEN
    RAISE EXCEPTION 'venue_not_orderable' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.venue_ordering_settings (venue_id, brand_id, ordering_enabled)
  VALUES (p_venue_id, v_brand, p_enabled)
  ON CONFLICT (venue_id) DO UPDATE SET ordering_enabled = EXCLUDED.ordering_enabled
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'venueId', p_venue_id,
    'orderingEnabled', v_row.ordering_enabled,
    'paused', v_row.paused_at IS NOT NULL
  );
END;
$function$;

COMMENT ON FUNCTION public.biz_venue_ordering_set_enabled(uuid, boolean) IS
  'Orchestrator ruling OQ-7 — the ONLY path that can set '
  'venue_ordering_settings.ordering_enabled = true, shipped in #1791 (Phase 3) '
  'so the switch physically does not exist until the Orders queue that watches '
  'it does. Money must never arrive where nobody is watching.';

REVOKE ALL ON FUNCTION public.biz_venue_ordering_pause(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_venue_ordering_pause(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_venue_ordering_pause(uuid, boolean)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.biz_venue_ordering_set_enabled(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_venue_ordering_set_enabled(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_venue_ordering_set_enabled(uuid, boolean)
  TO authenticated, service_role;

-- ===========================================================================
-- 4. THE REFUND RAIL (P-25, P-52, D-7a) — money moves only when a PERSON decides.
-- ===========================================================================
-- The mint is cloned from pg_prepare_guest_venue_cancellation_refund
-- (20270131001221_issue_1221_source_refund_control_plane.sql:1281-1370): the
-- same source_refunds row, the same three ledger allocations, the same
-- `requested` event. Nothing about the refund STATE MACHINE is re-invented —
-- source-refund-sweep and source-refund-action drive it from here exactly as
-- they drive a reservation cancellation.
--
-- There are exactly TWO refund kinds and there is no third, because there is no
-- AUTOMATIC one (P-52). Both are minted by a decision a human made.
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
  v_order  public.venue_orders%ROWTYPE;
  v_refund public.source_refunds%ROWTYPE;
  v_fee    int;
  v_amount int;
  v_reason text;
BEGIN
  -- Two layers: EXECUTE is granted to service_role only, AND the caller must
  -- be running as postgres or service_role. A SECURITY DEFINER RPC owned by
  -- postgres (the venue/guest paths below) satisfies the second.
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

  -- A venue-collected order never touched Mingla, so there is nothing here to
  -- reverse. Saying so honestly beats minting a refund row for money we never
  -- held. (I-PROPOSED-1767-VENUE-COLLECTED-IS-NOT-MINGLA-MONEY)
  IF v_order.money_path <> 'mingla' OR v_order.payment_status <> 'paid'
     OR v_order.total_cents <= 0 THEN
    RETURN jsonb_build_object('refundId', NULL, 'reason', 'no_mingla_money_to_return');
  END IF;

  SELECT * INTO v_refund FROM public.source_refunds
   WHERE source_type = 'venue_menu_order' AND source_id = p_order_id
     AND refund_kind = p_refund_kind;
  IF FOUND THEN
    RETURN jsonb_build_object('refundId', v_refund.id, 'reason', 'already_requested');
  END IF;

  -- FULL amount including the tip: nothing was served, so nothing was earned.
  v_amount := greatest(0, v_order.total_cents - v_order.refunded_amount_cents);
  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('refundId', NULL, 'reason', 'already_fully_refunded');
  END IF;
  v_fee := least(v_amount, coalesce(v_order.mingla_fee_cents, 0));

  -- source_refunds.reason is CHECK'd to 3..500 characters. A one-character
  -- note from a caller must not become a constraint violation on a money row,
  -- so anything under the floor degrades to the honest default rather than
  -- aborting the refund.
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
    -- provider_payment_reference is NOT NULL. A paid Mingla-path order always
    -- carries one of these three, but the fallback keeps a money row writable
    -- (and traceable) rather than aborting a refund on a NULL.
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
  'SPEC #1788 P-52 — the ONLY way a venue order gets a source_refunds row. Two '
  'kinds, both started by a person; there is no automatic third '
  '(I-PROPOSED-1767-NO-MONEY-ON-A-TIMER). Cloned from '
  'pg_prepare_guest_venue_cancellation_refund so the shipped refund state '
  'machine drives it unchanged.';

REVOKE ALL ON FUNCTION public.pg_venue_order_mint_refund(uuid, text, text, uuid, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_venue_order_mint_refund(uuid, text, text, uuid, text)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_venue_order_mint_refund(uuid, text, text, uuid, text)
  TO service_role;

-- --------------------------------------------------------------------------
-- 4a. THE GUEST'S WAY OUT (P-25 / D-7a) — token-authenticated, no venue needed.
-- --------------------------------------------------------------------------
-- `cancel` is legal ONLY while nobody has picked the order up. Then it is an
-- instant, automatic, FULL refund including the tip: nothing was started, so
-- nothing was earned. After acknowledgement the guest can still ask, but the
-- kitchen may already have fired it — so it becomes a REQUEST the venue
-- decides, and no money moves until they do.
CREATE OR REPLACE FUNCTION public.pg_venue_order_guest_action(
  p_order_id      uuid,
  p_guest_token   text,
  p_action        text,
  p_reason        text DEFAULT NULL,
  p_owner_user_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- `extensions` is in the path because pgcrypto lives there
-- (20260505000000_baseline_squash_orch_0729.sql:105 — `WITH SCHEMA "extensions"`)
-- and this function hashes the guest's cancel token with `digest()`. A pinned
-- `public, pg_temp` path silently loses the function and the guest's way out
-- fails at the moment they try to use it. The house shape for a definer that
-- needs pgcrypto is exactly this three-element path
-- (20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql:529).
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_order  public.venue_orders%ROWTYPE;
  v_hash   text;
  v_refund jsonb;
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('cancel', 'request_refund') THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;

  -- TWO possession proofs, ONE code path. A guest on the web holds the token;
  -- a signed-in app user IS the owner and never had to keep one. The second
  -- mode is why `p_owner_user_id` exists: the edge function proves the JWT with
  -- auth.getUser BEFORE passing the id, and only service_role can call this at
  -- all. Both modes converge here so there is exactly one implementation of
  -- "cancel an order and refund it".
  --
  -- The token shape is the shipped anon-possession one: `v1:<sha256 hex>`,
  -- written by venue-order-create (index.ts:481). A caller with neither proof
  -- gets nothing.
  v_hash := 'v1:' || encode(digest(coalesce(p_guest_token, ''), 'sha256'), 'hex');
  SELECT * INTO v_order FROM public.venue_orders
   WHERE id = p_order_id
     AND (
       (coalesce(p_guest_token, '') <> '' AND guest_cancel_token_hash = v_hash)
       OR (p_owner_user_id IS NOT NULL AND buyer_user_id = p_owner_user_id)
     )
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  IF p_action = 'cancel' THEN
    -- Idempotent: a double-tap on a flaky connection returns the same answer
    -- rather than a second refund.
    IF v_order.fulfillment_status = 'cancelled' THEN
      RETURN jsonb_build_object('orderId', p_order_id, 'action', 'cancel',
                                'fulfillmentStatus', 'cancelled', 'refund', NULL,
                                'replayed', true);
    END IF;
    IF v_order.acknowledged_at IS NOT NULL
       OR NOT public.pg_venue_order_transition_is_legal(v_order.fulfillment_status, 'cancelled') THEN
      RAISE EXCEPTION 'transition_not_allowed' USING ERRCODE = 'P0001';
    END IF;

    v_refund := public.pg_venue_order_mint_refund(
      p_order_id, 'venue_order_guest_cancel', 'guest', v_order.buyer_user_id,
      coalesce(nullif(btrim(coalesce(p_reason, '')), ''),
               'Guest cancelled before the venue picked the order up'));

    UPDATE public.venue_orders
       SET fulfillment_status = 'cancelled',
           cancelled_at = coalesce(cancelled_at, now()),
           payment_status = CASE WHEN payment_status = 'pending'
                                 THEN 'cancelled' ELSE payment_status END
     WHERE id = p_order_id;

    RETURN jsonb_build_object('orderId', p_order_id, 'action', 'cancel',
                              'fulfillmentStatus', 'cancelled',
                              'refund', v_refund, 'replayed', false);
  END IF;

  -- request_refund: the ticket grows a decision. NO money moves.
  IF v_order.fulfillment_status NOT IN ('acknowledged', 'in_progress', 'ready') THEN
    RAISE EXCEPTION 'refund_window_closed' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.refund_requested_at IS NOT NULL THEN
    RETURN jsonb_build_object('orderId', p_order_id, 'action', 'request_refund',
                              'refundRequestedAt', v_order.refund_requested_at,
                              'replayed', true);
  END IF;

  UPDATE public.venue_orders
     SET refund_requested_at = now(),
         metadata = metadata || jsonb_build_object(
           'guest_refund_reason',
           left(btrim(coalesce(p_reason, '')), 280))
   WHERE id = p_order_id;

  RETURN jsonb_build_object('orderId', p_order_id, 'action', 'request_refund',
                            'refundRequestedAt', now(), 'replayed', false);
END;
$function$;

COMMENT ON FUNCTION public.pg_venue_order_guest_action(uuid, text, text, text, uuid) IS
  'SPEC #1788 P-25 / DESIGN D-7a — the guest always has a way out while the '
  'order is unserved. Cancel before acknowledgement is an instant full refund '
  'including the tip; after acknowledgement it becomes a request the VENUE '
  'decides, because the kitchen may already have fired it. The system never '
  'decides for either of them.';

REVOKE ALL ON FUNCTION public.pg_venue_order_guest_action(uuid, text, text, text, uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_venue_order_guest_action(uuid, text, text, text, uuid)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_venue_order_guest_action(uuid, text, text, text, uuid)
  TO service_role;

-- --------------------------------------------------------------------------
-- 4b. THE VENUE'S DECISION (P-25, P-52) — approve-or-explain, on the ticket.
-- --------------------------------------------------------------------------
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
  'SPEC #1788 P-25 / P-52 — the venue''s approve-or-explain decision on a '
  'guest refund request (or a venue-initiated refund). A DECLINE must carry a '
  'reason: the guest reads it. event_manager+ because it moves money.';

REVOKE ALL ON FUNCTION public.biz_venue_order_refund_decision(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_venue_order_refund_decision(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_venue_order_refund_decision(uuid, text, text)
  TO authenticated, service_role;

-- ===========================================================================
-- 5. THE ESCALATION LADDER (P-55, D-7/D-7a/D-7b/D-7c) — it only notifies PEOPLE.
-- ===========================================================================
-- The scan's ENTIRE write surface is `escalation_level` and `escalated_at`. It
-- does not refund, does not cancel, does not pause, does not send an SMS, and
-- does not touch venue_ordering_settings. Everything else it does is SELECT.
--
-- WHY IT CLAIMS THE ROW IN THE SAME STATEMENT IT RETURNS FROM: two sweeps that
-- overlap (a slow HTTP call, a retry, a manual invocation) must not both push
-- rung 2. The UPDATE ... RETURNING with a FOR UPDATE SKIP LOCKED sub-select
-- makes "decide the rung" and "claim the rung" one atomic act, so a rung fires
-- AT MOST ONCE, ever.
--
-- WHY RUNG 3 IS TERMINAL: `escalation_level` maxes at 3 and the rung target
-- maxes at 3, so `target > escalation_level` is false forever after. The
-- ladder STOPS. No infinite nagging (D-7). The ticket stays in the queue, the
-- guest keeps their refund control, and orders keep arriving.
--
-- WHY payment_status = 'paid' IS IN THE PREDICATE (a deliberate narrowing of
-- P-55, stated rather than buried): the rule this ladder exists to serve is
-- "money must never arrive where nobody is watching". A `pending` order is a
-- guest who never finished checkout — nothing arrived, and paging a kitchen
-- about it is noise. A staff-taken venue-collected order is `pending` until
-- settle, and a waiter standing at the table IS the watcher. Both are excluded
-- for the same reason: nobody is waiting on the other end.
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
           CASE
             WHEN p_now - o.created_at >= interval '10 minutes' THEN 3
             WHEN p_now - o.created_at >= interval '5 minutes'  THEN 2
             ELSE 1
           END::smallint AS target
      FROM public.venue_orders o
     WHERE o.acknowledged_at IS NULL
       AND o.fulfillment_status = 'placed'
       AND o.payment_status = 'paid'
       AND p_now - o.created_at >= interval '2 minutes'
       AND o.escalation_level < CASE
             WHEN p_now - o.created_at >= interval '10 minutes' THEN 3
             WHEN p_now - o.created_at >= interval '5 minutes'  THEN 2
             ELSE 1
           END
     ORDER BY o.created_at
     LIMIT greatest(1, coalesce(p_limit, 50))
     FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.venue_orders o
       SET escalation_level = due.target,
           escalated_at = p_now
      FROM due
     WHERE o.id = due.id
    RETURNING o.id, o.brand_id, o.venue_id, o.spot_label_at_order, o.pickup_code,
              o.buyer_name, o.currency, o.total_cents, o.created_at,
              due.target AS target
  )
  SELECT c.id, c.brand_id, c.venue_id,
         coalesce(v.name, 'your venue')::text,
         c.target,
         c.spot_label_at_order, c.pickup_code, c.buyer_name,
         c.currency, c.total_cents, c.created_at,
         extract(epoch FROM (p_now - c.created_at))::int
    FROM claimed c
    LEFT JOIN public.venue_listings v ON v.id = c.venue_id
   ORDER BY c.created_at;
END;
$function$;

COMMENT ON FUNCTION public.pg_venue_order_escalation_scan(timestamptz, int) IS
  'SPEC #1788 P-55 / DESIGN D-7,D-7a,D-7b,D-7c — the unacknowledged-order '
  'ladder. T+2 re-push, T+5 managers and owner (and the guest is told), T+10 '
  'one final owner alert, then STOP. Its ENTIRE write surface is '
  'escalation_level + escalated_at: it never refunds, never cancels, never '
  'pauses a venue, and never sends an SMS. Claims each rung in the same '
  'statement it returns from, so a rung fires at most once.';

REVOKE ALL ON FUNCTION public.pg_venue_order_escalation_scan(timestamptz, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_venue_order_escalation_scan(timestamptz, int)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_venue_order_escalation_scan(timestamptz, int)
  TO service_role;

-- ===========================================================================
-- 6. THE PUSH TYPES (P-54) — and the reason there is no 'sms' in either array.
-- ===========================================================================
-- DESIGN D-7c drops SMS from the venue-alerting path entirely: it reaches one
-- handset, costs per message, and the NG rail is dark. Push reaches everyone on
-- shift at once and lands in the in-app centre for whoever missed it. Encoding
-- that in `default_channels` makes it STRUCTURAL rather than a code convention
-- — `can_send()` evaluates this matrix, and only rows carrying 'sms' can ever
-- reach the SMS rail. `send-venue-sms` stays exactly where it is: a
-- guest-facing waitlist "your table's ready" tool, not repurposed for staff.
INSERT INTO public.notification_categories
  (key, section, is_transactional, urgency, default_channels, reach_mode)
VALUES
  ('business.venue_order_placed', 'Venue orders', true, 'high',
    ARRAY['inapp', 'push'], 'reach_once'),
  ('business.venue_order_unacknowledged', 'Venue orders', true, 'high',
    ARRAY['inapp', 'push'], 'escalate_on_no_engagement')
ON CONFLICT (key) DO UPDATE SET
  section = EXCLUDED.section,
  is_transactional = EXCLUDED.is_transactional,
  urgency = EXCLUDED.urgency,
  default_channels = EXCLUDED.default_channels,
  reach_mode = EXCLUDED.reach_mode,
  active = true;

COMMIT;
