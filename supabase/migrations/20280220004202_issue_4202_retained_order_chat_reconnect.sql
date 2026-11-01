-- Issue #4202 — Explorer-only deletion removes consumer conversation
-- membership, but a retained Host/Creator login keeps its auth id and owned
-- orders. When that login reactivates Explorer, restore the event chat only
-- for an order it already owned before this sweep and for which it still holds
-- usable admission. A replacement account that reconnects old history in this
-- same call does not inherit an old chat.

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_4202_reconnect_retained_orders(
  p_user_id uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_emails text[];
  v_phones text[];
  v_order record;
  v_reconnected integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_user';
  END IF;

  SELECT
    coalesce(array_agg(DISTINCT value) FILTER (WHERE kind = 'email'), '{}'::text[]),
    coalesce(array_agg(DISTINCT value) FILTER (WHERE kind = 'phone'), '{}'::text[])
    INTO v_emails, v_phones
    FROM (
      SELECT kind, value
        FROM public.verified_account_identifiers(p_user_id)
      UNION
      SELECT 'phone'::text, phone_e164
        FROM public.verified_phone_identities
       WHERE user_id = p_user_id
      UNION
      SELECT channel, value
        FROM public.account_claim_contacts
       WHERE user_id = p_user_id AND revoked_at IS NULL
    ) identifiers;

  IF coalesce(array_length(v_emails, 1), 0) = 0
     AND coalesce(array_length(v_phones, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  -- This pass deliberately runs before the history reconnect below. It repairs
  -- membership deleted from a retained shared identity; it cannot grant an old
  -- chat to a replacement identity merely because the email or phone matches.
  FOR v_order IN
    SELECT o.id, o.event_id
      FROM public.orders o
      JOIN public.events e ON e.id = o.event_id
      JOIN public.brands b ON b.id = e.brand_id
     WHERE o.buyer_user_id = p_user_id
       AND o.payment_status IN ('paid', 'partial_refund')
       AND e.event_type IN ('event', 'trip')
       AND e.status IN ('scheduled', 'live', 'ended')
       AND e.deleted_at IS NULL
       AND b.deleted_at IS NULL
       AND (
         lower(btrim(o.buyer_email)) = ANY(v_emails)
         OR o.buyer_phone_e164 = ANY(v_phones)
       )
       AND public.account_owns_contact(
         p_user_id, o.buyer_email, o.buyer_phone_e164
       )
       AND EXISTS (
         SELECT 1
           FROM public.tickets t
          WHERE t.order_id = o.id
            AND t.approval_status IN ('auto', 'approved')
            AND t.status IN ('valid', 'used')
            AND (t.holder_user_id IS NULL OR t.holder_user_id = p_user_id)
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.conversations c
           JOIN public.conversation_participants cp
             ON cp.conversation_id = c.id
            AND cp.user_id = p_user_id
          WHERE c.event_id = o.event_id
            AND c.linked_entity_type IN ('trip', 'event')
       )
     ORDER BY o.created_at, o.id
  LOOP
    PERFORM public.add_buyer_to_event_chat(
      v_order.event_id, p_user_id, v_order.id, NULL
    );
  END LOOP;

  -- Preserve #4203's history-only reconnect. These rows did not belong to this
  -- auth id at function entry, so they intentionally miss the chat pass above.
  UPDATE public.orders o
     SET buyer_user_id = p_user_id
    FROM public.events e
   WHERE e.id = o.event_id
     AND e.deleted_at IS NULL
     AND o.buyer_user_id IS NULL
     AND o.payment_status IN (
       'paid', 'partial_refund', 'refunded', 'cancelled'
     )
     AND (
       e.status IN ('ended', 'cancelled')
       OR o.payment_status IN ('refunded', 'cancelled')
     )
     AND (
       lower(btrim(o.buyer_email)) = ANY(v_emails)
       OR o.buyer_phone_e164 = ANY(v_phones)
     )
     AND public.account_owns_contact(
       p_user_id, o.buyer_email, o.buyer_phone_e164
     );

  GET DIAGNOSTICS v_reconnected = ROW_COUNT;
  RETURN v_reconnected;
END;
$function$;

COMMENT ON FUNCTION public.issue_4202_reconnect_retained_orders(uuid) IS
  '#4202 post-auth repair after Explorer deletion. It restores an already-owned paid order chat only while the user still holds a valid/used ticket, then reconnects ended/cancelled history without admission or chat authority. Inputs come only from server-verified account contacts.';
REVOKE ALL ON FUNCTION public.issue_4202_reconnect_retained_orders(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4202_reconnect_retained_orders(uuid)
  TO service_role;

COMMIT;
