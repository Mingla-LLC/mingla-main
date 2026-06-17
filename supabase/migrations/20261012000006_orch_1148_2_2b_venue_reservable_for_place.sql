-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.2b — pg_venue_reservable_for_place (place→brand
-- reservable resolver for the consumer expanded-card Reserve affordance, OQ-1)
-- ---------------------------------------------------------------------------
-- The consumer deck card's `card.id` IS a place_pool.id (see discover-cards:
-- `id: row.place_id`). The "Reserve a table" affordance in ExpandedCardModal's
-- nightOut branch needs (a) whether the place's verified-claimed brand is a
-- reservable venue, and (b) the brand_id to call the availability engine +
-- venue-reservation-create. There is no anon read path for that today, so this
-- mirrors the SHIPPED anon `pg_brand_experiences_for_place` pattern EXACTLY:
--   - place→brand link = brands.place_pool_id = p_place_pool_id AND
--     claim_status = 'verified' AND not deleted (identical predicate).
--   - SECURITY DEFINER, STABLE, search_path locked to public/pg_temp.
--   - GRANT EXECUTE to anon + authenticated + service_role.
--
-- EXPOSURE: returns EXACTLY 3 fields — reservable (boolean derived from
-- venue_reservation_settings.reservations_enabled), brand_id (NOT a secret;
-- brand ids are already public via the deck/experiences RPCs), and currency
-- (the venue's display currency: reservation fee currency, else the brand's
-- pricing/default currency). NO reservation PII, NO fee amounts, NO cross-brand
-- data, NO other settings columns. A non-reservable / unclaimed place returns a
-- single row with reservable=false and a NULL brand_id (so the client renders
-- NO affordance — no dead tap). The availability ENGINE remains the authority
-- for actual open slots (this is a display gate only).
--
-- Additive, idempotent. Apply via the Supabase Management API after REVIEW
-- (CLI drift-wedged). MONOTONIC VERSION 20261012000006 (true global max was
-- 20261012000005 → this is higher). Deploy/apply ONLY from MERGED origin/main.
--
-- Invariant (DRAFT): I-PROPOSED-1148-RESERVABLE-RESOLVER-EXPOSES-ONLY-DISPLAY-GATE
-- — the resolver returns only {reservable, brand_id, currency}; it never leaks
-- reservation rows, fee amounts, or any other venue_* settings column, and it
-- only resolves a brand via the verified-claim place link.
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.pg_venue_reservable_for_place(p_place_pool_id uuid)
RETURNS TABLE (
  reservable boolean,
  brand_id   uuid,
  currency   text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    COALESCE(vrs.reservations_enabled, false) AS reservable,
    -- Only expose the brand_id when the venue is actually reservable; otherwise
    -- NULL so the client renders no Reserve affordance (no dead tap).
    CASE WHEN COALESCE(vrs.reservations_enabled, false)
         THEN b.id ELSE NULL END                AS brand_id,
    -- Display currency (WYSIWYP, currency-aware): the configured reservation fee
    -- currency wins, else the brand's settlement/pricing currency, else default.
    CASE WHEN COALESCE(vrs.reservations_enabled, false)
         THEN UPPER(COALESCE(
                NULLIF(vrs.fee_currency, ''),
                NULLIF(b.pricing_currency, ''),
                NULLIF(b.default_currency, '')
              ))
         ELSE NULL END                          AS currency
  FROM public.brands b
  LEFT JOIN public.venue_reservation_settings vrs ON vrs.brand_id = b.id
  WHERE b.place_pool_id = p_place_pool_id
    AND b.claim_status = 'verified'
    AND b.deleted_at IS NULL
  ORDER BY COALESCE(vrs.reservations_enabled, false) DESC
  LIMIT 1;
$function$;

-- Least privilege: REVOKE the default PUBLIC grant, then GRANT the buyer roles.
REVOKE ALL ON FUNCTION public.pg_venue_reservable_for_place(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_venue_reservable_for_place(uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.pg_venue_reservable_for_place(uuid) IS
  'META-ORCH-1148 2.2b (OQ-1): place_pool->verified-claimed-brand reservable resolver for the consumer expanded-card Reserve affordance. Returns exactly {reservable, brand_id, currency}; brand_id+currency are NULL unless reservations_enabled. NO reservation PII / fee amounts / other settings columns. Mirrors the anon pg_brand_experiences_for_place place->brand pattern. Display gate only — pg_venue_available_slots is the slot authority.';

COMMIT;
