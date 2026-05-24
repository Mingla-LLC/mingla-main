-- ORCH-0946 [Buyer-web sold-out gate]
--
-- Problem: buyer-web checkout pages (trip + event) gate the "Sold out" banner
-- and QuantityRow "+" cap on `ticket_types.quantity_total` (total capacity),
-- not on remaining capacity. The total never decreases, so the banner never
-- shows and the buyer only fails at the final "Pay" tap with a 409
-- `ticket_capacity_exceeded` from `biz_ticket_checkout_create_session`.
--
-- Fix: expose remaining-capacity per ticket_type as an anon-callable
-- SECURITY DEFINER RPC. Returns only derived counts — no buyer/order data
-- leaks. Sold-count matches the formula already used inside the checkout
-- RPC (status IN ('valid','used','transferred')) so the two stay consistent.
--
-- Used by `getPublicTripById` and `getPublicEventById` to thread a
-- `ticketsRemaining` field through to the buyer-checkout mappers.

BEGIN;

CREATE OR REPLACE FUNCTION public.pg_public_ticket_types_remaining(
  p_event_id uuid
)
RETURNS TABLE (
  ticket_type_id uuid,
  sold           integer,
  remaining      integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    tt.id AS ticket_type_id,
    COALESCE(s.sold, 0)::int AS sold,
    CASE
      WHEN tt.is_unlimited THEN NULL
      WHEN tt.quantity_total IS NULL THEN NULL
      ELSE GREATEST(tt.quantity_total - COALESCE(s.sold, 0), 0)::int
    END AS remaining
  FROM public.ticket_types tt
  LEFT JOIN (
    SELECT t.ticket_type_id, COUNT(*)::int AS sold
    FROM public.tickets t
    WHERE t.status IN ('valid', 'used', 'transferred')
    GROUP BY t.ticket_type_id
  ) s ON s.ticket_type_id = tt.id
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.pg_public_ticket_types_remaining(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_ticket_types_remaining(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.pg_public_ticket_types_remaining(uuid) IS
  'ORCH-0946: anon-callable per-event ticket_type remaining counts for the buyer-web sold-out gate. Sold formula matches biz_ticket_checkout_create_session: tickets.status IN (valid, used, transferred).';

COMMIT;
