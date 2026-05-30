-- ORCH-1006 Slice 3: public PER-TIER all-in pricing for the event DETAIL page.
-- ===================================================================
-- The detail-page tier list must show the SAME all-in price the cart charges
-- (WYSIWYP). This RPC adds NO new arithmetic — it composes the two shipped,
-- IMMUTABLE/STABLE primitives the lowest-tier display price in
-- `business_public_events_view` already uses (see
-- 20260802000001_orch_1006_pricing_views.sql lines 96-116):
--
--   public.resolve_effective_take_rate_bps(brand_id)  -> .effective_take_rate_bps
--   public.compute_all_in_cents(base, pass_mingla_fee, pass_service_fee, take_rate)
--
-- and the per-event resolved switches the view resolves inline:
--   pass_mingla_fee  = COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee)
--   pass_service_fee = COALESCE(e.pass_service_fee, b.default_pass_service_fee)
--   currency         = b.pricing_currency
--
-- The brief named `resolve_event_pricing_inputs(p_event_id)`; that function does
-- NOT exist in the codebase (verified: no migration defines it, and the live DB
-- has no such proc). The brief authorized the alternative — "OR by reading the
-- same resolved switches the view uses" — so this RPC mirrors the shipped view's
-- resolution path EXACTLY. Same inputs in, same compute_all_in_cents out =>
-- detail-page tier price == lowest-tier view display price == cart all-in.
--
-- Posture mirrors pg_public_trips_by_brand / the public anon RPCs:
--   SECURITY DEFINER, STABLE, SET search_path = public, GRANT to anon+authenticated.
-- Collision-checked: prefix 20260805000000 > max existing 20260803000001.

-- ============================================================================
-- pg_public_event_tier_allin — per-tier base + all-in for a public event
-- ============================================================================
CREATE OR REPLACE FUNCTION public.pg_public_event_tier_allin(p_event_id uuid)
RETURNS TABLE (
  ticket_type_id  uuid,
  base_cents      integer,
  all_in_cents    integer,
  currency        text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    tt.id AS ticket_type_id,
    GREATEST(0, COALESCE(tt.price_cents, 0)) AS base_cents,
    -- Free tiers (is_free OR null/0 price) => 0, never NaN. compute_all_in_cents
    -- floors the base at 0 and only grosses up a positive base by the passed
    -- fees, so a free tier already returns 0; the CASE makes that explicit and
    -- short-circuits the take-rate subquery for free rows.
    CASE
      WHEN COALESCE(tt.is_free, false) OR COALESCE(tt.price_cents, 0) = 0 THEN 0
      ELSE public.compute_all_in_cents(
             tt.price_cents,
             COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee),
             COALESCE(e.pass_service_fee, b.default_pass_service_fee),
             (SELECT r.effective_take_rate_bps
                FROM public.resolve_effective_take_rate_bps(b.id) AS r)
           )
    END AS all_in_cents,
    COALESCE(b.pricing_currency, tt.currency, 'usd') AS currency
  FROM public.ticket_types tt
  JOIN public.events e ON e.id = tt.event_id
  JOIN public.brands b ON b.id = e.brand_id
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL
    AND e.deleted_at IS NULL
    AND b.deleted_at IS NULL
  ORDER BY GREATEST(0, COALESCE(tt.price_cents, 0)) ASC, tt.id ASC;
$$;

COMMENT ON FUNCTION public.pg_public_event_tier_allin IS
  'ORCH-1006 Slice 3: per-tier all-in pricing for the public event detail page. base_cents + compute_all_in_cents over the SAME resolved switches/take-rate that business_public_events_view.display_price_cents uses. WYSIWYP parity with the cart — adds no fee math.';

GRANT EXECUTE ON FUNCTION public.pg_public_event_tier_allin(uuid) TO anon, authenticated;
