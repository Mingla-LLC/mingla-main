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
          AND t.holder_user_id = auth.uid()
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.consumer_can_read_event_for_caller(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consumer_can_read_event_for_caller(uuid)
  TO authenticated, service_role;

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
