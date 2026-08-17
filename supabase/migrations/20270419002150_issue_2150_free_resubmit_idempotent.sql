-- issue #2150 — a guest can mint duplicate free tickets by resubmitting.
--
-- ── THE DEFECT ─────────────────────────────────────────────────────────────
-- `biz_ticket_checkout_create_session` tombstones any session whose status is
-- terminal, by renaming its `idempotency_key`. `free_completed` IS terminal, so
-- an identical resubmit from the same guest — which derives the SAME
-- deterministic key from (eventId, buyerEmail, buyerPhoneE164, lines,
-- paymentPlanChoice) in `ticket-checkout-create` — found the completed session,
-- tombstoned it, and minted a brand new one. The #2136 tester measured it on
-- real PostgreSQL: one guest, one cart, 4 submits -> 4 orders, 4 tickets and
-- 8 `ticket_order_notifications` rows (a duplicate confirmation email AND SMS
-- on every repeat).
--
-- The mechanism is pre-existing (#2101 / #1930). It was unreachable only
-- because free checkout had never once completed before #2136.
--
-- ── THE SEMANTICS CHOSEN (issue option 1) ──────────────────────────────────
-- A guest double-submitting a FREE reservation means "did that work?", not
-- "give me another one". A completed ZERO-TOTAL session is therefore NOT
-- tombstoned: the RPC returns the existing session envelope — same
-- checkoutSessionId, same orderId, status `free_completed` — and the Edge
-- function answers with that same order's already-issued tickets without
-- re-finalizing and without re-dispatching a confirmation.
--
-- Option 2 (make the free arm's idempotency key survive completion) was NOT
-- chosen: the key already survives completion — it is this function that
-- destroys it. Preserving it is exactly what "do not tombstone" means, and
-- doing it here keeps the day-aware key #2160 needs (`lineKey` gains the
-- occurrence) working with no further change, because the key is still derived
-- purely from the cart.
--
-- ── SCOPED TO ZERO-TOTAL. THE PAID PATH IS UNTOUCHED. ──────────────────────
-- The exemption fires ONLY when ALL of the following hold:
--     status = 'free_completed'          -- set by finalize only when total=0
--   AND total_cents = 0                  -- independent proof of no value
--   AND order_id IS NOT NULL             -- there is an order to hand back
--   AND revoked_at IS NULL               -- the sale was not revoked
--   AND buyer_user_id IS NOT DISTINCT FROM p_buyer_user_id
--   AND the order still holds a live ticket ('valid'/'used'/'transferred')
-- `paid_completed`, `failed` and `expired` keep the ORCH-0791 tombstone
-- verbatim, and the ORCH-0829-B D-1 `expires_at < now()` tombstone for
-- non-terminal abandoned sessions is likewise unchanged — an expired or failed
-- provider session must stay re-creatable. The `total_cents = 0` conjunct means
-- that even a status corrupted to 'free_completed' on a money session cannot
-- route into the replay.
--
-- The two extra liveness conjuncts exist so a guest whose reservation was
-- cancelled, refunded or revoked is NOT handed back a dead pass: those sessions
-- fall through to today's tombstone-and-remint behaviour, which is the correct
-- answer for them.
--
-- ── WHAT IS RE-EMITTED ─────────────────────────────────────────────────────
-- `public.biz_ticket_checkout_create_session` is re-emitted VERBATIM from
-- 20270414002101_issue_2101_named_buyer_checkout_access.sql:1270-1411 with the
-- single additive block below. The #2101 fresh-decision-before-replay ordering,
-- the event -> brand lock order, the access snapshot write-back, the in-flight
-- short-circuit and the terminal/expiry tombstone are byte-preserved.
--
-- The base RPC `issue_1930_ticket_checkout_create_session_base` is deliberately
-- NOT touched. It carries its own copy of the idempotency lookup + tombstone,
-- but it is only ever reached AFTER this wrapper has decided to mint fresh — so
-- the wrapper's early return is sufficient, and leaving the base alone keeps
-- #2160's verbatim re-emit of it free of this concern.
--
-- Strict-grep: `.github/scripts/strict-grep/orch-0791-checkout-session-never-
-- reused-post-terminal.mjs` still passes unchanged against this file — the
-- terminal-status set check, the `idempotency_key || ':tombstone:' || id::text`
-- UPDATE and the two `RETURN jsonb_build_object` sites all survive. A second
-- gate, `issue-2150-free-completed-session-returned-not-tombstoned.mjs`,
-- asserts this exemption so a silent revert is caught at CI.
--
-- ── DISCLOSURE IS A SEPARATE DECISION FROM IDEMPOTENCY ─────────────────────
-- NOT minting a duplicate and HANDING BACK the existing order are two different
-- things, and only the first is safe to do for an unidentified caller. The
-- idempotency key is derived from (eventId, buyerEmail, buyerPhoneE164, lines,
-- paymentPlanChoice) — all of which an attacker who knows a guest's email and
-- phone can simply type into the form. If completing that form returned the
-- guest's order and QR payloads, the attacker could attend on the guest's pass;
-- `biz_ticket_scan` marks it `used`, and the real guest is refused at the door
-- as a `duplicate`. That is a DENIAL OF ADMISSION against the guest which did
-- NOT exist before this issue — pre-#2150 the same attacker minted their own
-- separate ticket and the guest's pass still worked. It is worse in kind, not
-- merely in degree, and it is not acceptable in service of a fix whose primary
-- use case is anonymous free reservations.
--
-- So the exemption below still refuses to mint a duplicate for ANY caller — that
-- is the defect being fixed and it is not a disclosure — while this function
-- decides, separately, whether the caller has proven they are the guest and may
-- be handed the order id and the passes. `ticket-checkout-create` calls it
-- before it discloses anything.
--
-- PROOF OF POSSESSION, NOT PROOF OF KNOWLEDGE:
--   * A session with a `buyer_user_id` is bound to an authenticated identity.
--     The JWT is the possession proof; the caller must be that user.
--   * An ANONYMOUS session is bound to `buyer_status_token_hash` — the same
--     secret that already gates `ticket-checkout-status`
--     (`ticket-checkout-status/index.ts:58` -> 403 `buyer_status_token_invalid`),
--     minted per session and returned exactly once to the browser that created
--     it. The caller must present the token itself.
--
-- The comparison is over the SHA-256 hash, never the token, so it is not a
-- timing oracle worth defending against: a perfect one would leak bits of a
-- hash that cannot be inverted, and the token is 256 bits of crypto randomness.
-- `buyer_status_token_hash IS NOT NULL` is required explicitly so a session with
-- no hash can never be matched by an empty presented hash.
--
-- FAIL CLOSED ON DISCLOSURE, FAIL SAFE ON STATE. When possession is not proven
-- the Edge refuses to disclose — it does NOT fall back to tombstone-and-mint.
-- Falling back would hand the attacker nothing but would hand the GUEST a
-- duplicate order, pass and confirmation, which is the entire defect. Refusing
-- the disclosure costs the unproven caller a re-render of a screen; falling back
-- costs the guest a duplicate. Nothing is minted and nothing is destroyed.
CREATE OR REPLACE FUNCTION public.issue_2150_free_replay_disclosure_authorized(
  p_session_id uuid,
  p_buyer_user_id uuid,
  p_buyer_status_token_hash text
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE v_session public.ticket_checkout_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_session FROM public.ticket_checkout_sessions WHERE id=p_session_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- Only a completed, live, zero-total reservation is ever disclosable here.
  -- Mirrors the create-session exemption so the two cannot drift apart.
  IF v_session.status<>'free_completed'
     OR COALESCE(v_session.total_cents,0)<>0
     OR v_session.order_id IS NULL
     OR v_session.revoked_at IS NOT NULL THEN
    RETURN false;
  END IF;

  -- Signed-in reservation: the authenticated identity IS the possession proof.
  IF v_session.buyer_user_id IS NOT NULL THEN
    RETURN v_session.buyer_user_id = p_buyer_user_id;
  END IF;

  -- Anonymous reservation: the buyer status token must be PRESENTED, not known.
  RETURN v_session.buyer_status_token_hash IS NOT NULL
     AND COALESCE(p_buyer_status_token_hash,'')<>''
     AND v_session.buyer_status_token_hash = p_buyer_status_token_hash;
END $function$;
REVOKE ALL ON FUNCTION public.issue_2150_free_replay_disclosure_authorized(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2150_free_replay_disclosure_authorized(uuid,uuid,text)
  TO service_role;

COMMENT ON FUNCTION public.issue_2150_free_replay_disclosure_authorized(uuid,uuid,text) IS
  '#2150: may this caller be handed the completed FREE reservation''s order id and QR payloads? '
  'A signed-in session requires the matching buyer_user_id; an ANONYMOUS session requires the '
  'buyer status token to be PRESENTED (email + phone + cart are knowledge, not possession, and '
  'must never be sufficient). Refusing disclosure never mints a duplicate — the create-session '
  'exemption declines to tombstone regardless of who is asking.';

-- INVARIANT: I-PROPOSED-2150-FREE-COMPLETED-SESSION-IDEMPOTENT (DRAFT).
-- INVARIANT: I-PROPOSED-2150-ANON-FREE-REPLAY-REQUIRES-POSSESSION (DRAFT).

CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session(
  p_event_id uuid,p_buyer_user_id uuid,p_buyer_name text,p_buyer_email text,
  p_buyer_phone_e164 text,p_marketing_opt_in boolean,p_lines jsonb,
  p_idempotency_key text,p_expires_at timestamptz,
  p_application_fee_amount_cents integer DEFAULT 0,p_payment_plan_choice text DEFAULT 'auto'
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
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

  SELECT *
    INTO v_existing
    FROM public.ticket_checkout_sessions
   WHERE idempotency_key=p_idempotency_key;

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

  v_result:=public.issue_1930_ticket_checkout_create_session_base(
    p_event_id,p_buyer_user_id,p_buyer_name,p_buyer_email,p_buyer_phone_e164,
    p_marketing_opt_in,p_lines,p_idempotency_key,p_expires_at,
    p_application_fee_amount_cents,p_payment_plan_choice);

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
REVOKE ALL ON FUNCTION public.biz_ticket_checkout_create_session(
  uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_create_session(
  uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text) TO service_role;

COMMENT ON FUNCTION public.biz_ticket_checkout_create_session(
  uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text) IS
  '#2150: a COMPLETED ZERO-TOTAL (free) session is returned as-is instead of being '
  'tombstoned, so a guest resubmitting an identical free reservation gets their '
  'existing order back rather than a duplicate order, ticket and confirmation. '
  'ORCH-0791 terminal tombstoning is unchanged for paid_completed / failed / expired '
  'and for the ORCH-0829-B D-1 past-expiry case: an expired or failed provider '
  'session must remain re-creatable.';
