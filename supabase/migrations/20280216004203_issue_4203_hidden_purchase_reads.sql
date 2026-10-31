-- Issue #4203 — an authenticated buyer or current ticket holder must be able
-- to render their own purchase even when the Host keeps the event hidden from
-- Explorer discovery. This adds an ownership-only base-table read; it does not
-- alter visibility, public views, feeds, search, recommendations, or anon RLS.

BEGIN;

CREATE OR REPLACE FUNCTION public.consumer_can_read_event_for_caller(
  p_event_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.orders o
        WHERE o.event_id = p_event_id
          AND o.buyer_user_id = auth.uid()
          AND o.payment_status IN (
            'paid', 'pending', 'partial_refund', 'refunded', 'cancelled'
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.tickets t
        WHERE t.event_id = p_event_id
          -- The deliberately filtered pre-#1931 replay omits the later
          -- send-to-friend migration that adds holder_user_id. Reading the
          -- optional field through the whole-row JSON keeps that historical
          -- replay buildable while remaining exactly equivalent on the live
          -- schema, where the UUID column exists.
          AND to_jsonb(t)->>'holder_user_id' = auth.uid()::text
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.consumer_can_read_event_for_caller(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consumer_can_read_event_for_caller(uuid)
  TO authenticated, service_role;

-- #4202 — deleting an Explorer-only auth row detaches orders through the
-- buyer_user_id ON DELETE SET NULL foreign key. The live-attendance sweep
-- intentionally claims only usable admission inventory, so a retained ended or
-- cancelled purchase needs a separate history-only reconnect. This function
-- grants no ticket authority, joins no chat and accepts no client identifier:
-- it uses only contacts the replacement account proved server-side.
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
  '#4202 history-only reconnect after Explorer deletion. Uses server-verified account contacts; does not mint admission rights, join chats or expose inventory.';
REVOKE ALL ON FUNCTION public.issue_4202_reconnect_retained_orders(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4202_reconnect_retained_orders(uuid)
  TO service_role;

DROP POLICY IF EXISTS "Buyer or ticket holder can select purchased events"
  ON public.events;
CREATE POLICY "Buyer or ticket holder can select purchased events"
  ON public.events FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.consumer_can_read_event_for_caller(id)
  );

DROP POLICY IF EXISTS "Buyer or ticket holder can select purchased event dates"
  ON public.event_dates;
CREATE POLICY "Buyer or ticket holder can select purchased event dates"
  ON public.event_dates FOR SELECT TO authenticated
  USING (public.consumer_can_read_event_for_caller(event_id));

COMMIT;
