-- Issue #3524 — A ROTATION MUST NOT RETIRE THE LINK THAT WAS ALREADY SENT.
--
-- WHAT WAS WRONG. Two callers arm the same order's attendance claim, and either
-- can run second:
--
--   * `ticket-confirmation-dispatch` arms the order and EMAILS the link, with
--     `p_allow_retry_rotation = false`;
--   * the buyer's own confirmation screen arms it again for the surface in front
--     of them, with `p_allow_retry_rotation = true`.
--
-- The order carries exactly one active digest, so whichever call lands second
-- owned it and the other link stopped verifying against anything. Measured on a
-- live purchase: the confirmation screen armed at 23:20:12 and the dispatch ran
-- at 23:20:17, five seconds apart. Either ordering costs the guest their ticket
-- — one leaves the emailed link pointing at a digest the row no longer holds,
-- the other makes the dispatch read `already_issued` and send a mail with no
-- link in it.
--
-- WHY THE EXISTING SLOT DID NOT COVER IT. `attendance_claim_legacy_token_digest`
-- was added by #2979 for SECRET continuity — one token, read under either of two
-- peppers — and it is filled only on the `legacy_v1` arm. Live orders are
-- `governed_v2`, so a rotation overwrote the active digest and wrote nothing to
-- the second slot. The slot was right; it simply never covered TOKEN rotation.
--
-- THE ONE CHANGE HERE. When `issue_order_attendance_claim_proof_v2` rotates over
-- an EXISTING, UNCONSUMED proof, the outgoing digest moves into
-- `attendance_claim_legacy_token_digest` (with its own `created_at`) instead of
-- being dropped. Both outstanding links then verify: the one in the email and
-- the one on the screen. `claim_attendance_internal_v2` already compares that
-- slot and already retires BOTH slots on a successful claim, so single use stays
-- single use — the first of the two links to be redeemed consumes the order and
-- the other one is dead from that moment.
--
-- EVERYTHING ELSE IS PRESERVED EXACTLY: the argument list, the eligibility
-- checks, the `already_issued` early return, the `legacy_v1` arm (where the slot
-- keeps holding the NEW digest, because on that arm the active proof IS the
-- legacy proof), the recovery-item and delivery bookkeeping, and every returned
-- shape. The slot holds ONE digest, so a second rotation retires the oldest: at
-- most two links are live at a time, which is exactly the number of minters.
--
-- No secret material is stored here, and no digest is computed here.
BEGIN;

CREATE OR REPLACE FUNCTION public.issue_order_attendance_claim_proof_v2(
  p_order_id uuid,
  p_event_id uuid,
  p_digest bytea,
  p_generation text,
  p_allow_retry_rotation boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_secondary boolean;
  -- #3524 — read off the pre-update snapshot taken FOR UPDATE below, so it
  -- describes the proof this call is about to replace rather than the one it is
  -- installing.
  v_rotating boolean := false;
BEGIN
  IF p_order_id IS NULL OR p_event_id IS NULL
     OR p_digest IS NULL OR octet_length(p_digest) <> 32
     OR p_generation NOT IN ('legacy_v1', 'governed_v2') THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  SELECT o.* INTO v_order FROM public.orders o
   WHERE o.id = p_order_id AND o.event_id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_order.buyer_user_id IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'ineligible');
  END IF;

  SELECT e.* INTO v_event FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
   WHERE e.id = p_event_id
     AND e.event_type IN ('event', 'trip', 'experience')
     AND e.visibility = 'public'
     AND e.deleted_at IS NULL
     AND b.deleted_at IS NULL
     AND e.status IN ('scheduled', 'live');
  IF NOT FOUND OR v_order.payment_status NOT IN ('paid', 'partial_refund')
     OR NOT EXISTS (
       SELECT 1 FROM public.tickets t
        WHERE t.order_id = v_order.id
          AND t.approval_status IN ('auto', 'approved')
          AND ((v_event.status = 'scheduled' AND t.status = 'valid')
            OR (v_event.status = 'live' AND t.status IN ('valid', 'used')))
     ) THEN
    RETURN jsonb_build_object('result', 'ineligible');
  END IF;

  IF v_order.attendance_claim_token_digest IS NOT NULL
     AND v_order.attendance_claim_token_consumed_at IS NULL
     AND NOT p_allow_retry_rotation THEN
    RETURN jsonb_build_object(
      'result', 'already_issued',
      'generation', v_order.attendance_claim_token_generation
    );
  END IF;

  -- #3524 — THE ROTATION THIS CALL IS ABOUT TO PERFORM. Reaching here with a
  -- live proof in the row means the caller allowed rotation, so the outgoing
  -- digest is a link somebody already has.
  v_rotating := v_order.attendance_claim_token_digest IS NOT NULL
    AND v_order.attendance_claim_token_consumed_at IS NULL;

  UPDATE public.orders
     SET attendance_claim_token_digest = p_digest,
         attendance_claim_token_generation = p_generation,
         attendance_claim_token_created_at = now(),
         attendance_claim_token_consumed_at = NULL,
         -- #3524 — the `legacy_v1` arm is FIRST and unchanged: on that
         -- generation the active proof IS the legacy proof, so the slot holds
         -- the new digest. Otherwise, a rotation carries the OUTGOING digest
         -- across so the link already in the guest's hands keeps verifying;
         -- with nothing outgoing the slot is left exactly as it was.
         attendance_claim_legacy_token_digest = CASE
           WHEN p_generation = 'legacy_v1' THEN p_digest
           WHEN v_rotating THEN v_order.attendance_claim_token_digest
           ELSE attendance_claim_legacy_token_digest END,
         attendance_claim_legacy_token_created_at = CASE
           WHEN p_generation = 'legacy_v1' THEN now()
           WHEN v_rotating THEN coalesce(
             v_order.attendance_claim_token_created_at, now())
           ELSE attendance_claim_legacy_token_created_at END
   WHERE id = v_order.id;

  IF p_generation = 'legacy_v1'
     AND EXISTS (
       SELECT 1 FROM public.ticket_checkout_sessions s
        WHERE s.order_id = v_order.id
          AND s.status IN ('paid_completed', 'free_completed')
     )
     AND (btrim(coalesce(v_order.buyer_email, '')) <> ''
       OR coalesce(v_order.buyer_phone_e164, '') ~ '^\+[1-9][0-9]{1,14}$') THEN
    v_secondary := btrim(coalesce(v_order.buyer_email, '')) = '' OR EXISTS (
      SELECT 1 FROM public.ticket_order_notifications n
       WHERE n.order_id = v_order.id
         AND n.channel = 'email'
         AND n.status = 'failed_terminal'
    );
    INSERT INTO public.attendance_claim_recovery_items(
      order_id, selected_token_created_at, requires_secondary_delivery
    ) VALUES (v_order.id, now(), v_secondary)
    ON CONFLICT (order_id) DO UPDATE SET
      selected_token_created_at = excluded.selected_token_created_at,
      requires_secondary_delivery =
        public.attendance_claim_recovery_items.requires_secondary_delivery
          OR excluded.requires_secondary_delivery,
      updated_at = now();
    INSERT INTO public.attendance_claim_deliveries(
      kind, source_id, event_id, status, next_attempt_at, last_error_code
    ) VALUES (
      'order_recovery_email', v_order.id, v_order.event_id,
      CASE WHEN v_secondary THEN 'failed_terminal' ELSE 'pending' END,
      CASE WHEN v_secondary THEN NULL ELSE now() END,
      CASE WHEN v_secondary THEN 'historical_or_unavailable_email' ELSE NULL END
    ) ON CONFLICT (kind, source_id) DO NOTHING;
    UPDATE public.attendance_claim_recovery_items r
       SET primary_delivery_id = d.id, updated_at = now()
      FROM public.attendance_claim_deliveries d
     WHERE r.order_id = v_order.id
       AND d.kind = 'order_recovery_email' AND d.source_id = v_order.id;
    IF v_secondary THEN
      INSERT INTO public.attendance_claim_deliveries(
        kind, source_id, event_id, status, next_attempt_at
      ) VALUES (
        'order_recovery_sms', v_order.id, v_order.event_id, 'pending', now()
      ) ON CONFLICT (kind, source_id) DO NOTHING;
      UPDATE public.attendance_claim_recovery_items r
         SET secondary_delivery_id = d.id, updated_at = now()
        FROM public.attendance_claim_deliveries d
       WHERE r.order_id = v_order.id
         AND d.kind = 'order_recovery_sms' AND d.source_id = v_order.id;
    END IF;
  ELSIF p_generation = 'governed_v2' THEN
    UPDATE public.attendance_claim_recovery_items
       SET state = 'replacement_issued',
           replacement_issued_at = now(),
           updated_at = now()
     WHERE order_id = v_order.id
       AND state IN ('selected', 'replacement_issued');
  END IF;

  RETURN jsonb_build_object('result', 'issued', 'generation', p_generation);
END;
$function$;

COMMENT ON FUNCTION public.issue_order_attendance_claim_proof_v2(
  uuid, uuid, bytea, text, boolean) IS
  '#2979 + #3524: arms one order attendance proof. Two callers arm the same order — the confirmation email and the buyer''s own confirmation screen — and either can run second, so a rotation over a live, unconsumed proof now carries the OUTGOING digest into attendance_claim_legacy_token_digest instead of dropping it. Both outstanding links then verify, and claim_attendance_internal_v2 retires both slots together on the first successful claim, so single use is unchanged. The slot holds one digest, so a third arming retires the oldest. The legacy_v1 arm is untouched: on that generation the active proof IS the legacy proof.';

REVOKE ALL ON FUNCTION public.issue_order_attendance_claim_proof_v2(
  uuid, uuid, bytea, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_order_attendance_claim_proof_v2(
  uuid, uuid, bytea, text, boolean) TO service_role;

COMMIT;
