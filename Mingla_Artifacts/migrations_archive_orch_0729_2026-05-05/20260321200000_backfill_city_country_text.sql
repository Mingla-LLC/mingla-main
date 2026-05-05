-- ═══════════════════════════════════════════════════════════════════════════════
-- CITY/COUNTRY CONTRACT FIX (Block 4 — hardened 2026-03-21)
-- Backfills NULL city/country rows and adds propagation trigger.
-- After this migration, all rows should have non-NULL city (where city_id exists).
-- Fixes GAP-1, GAP-2, GAP-3 from INVESTIGATION_CITY_COUNTRY_CONTRACT.md
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── STEP 1: Backfill place_pool.city ────────────────────────────────────────

-- Pass 1: From seeding_cities.name via city_id FK
UPDATE public.place_pool pp
SET city = sc.name
FROM public.seeding_cities sc
WHERE pp.city_id = sc.id
  AND pp.city IS NULL;

-- Pass 2: Extract locality from raw_google_data addressComponents
UPDATE public.place_pool pp
SET city = locality.value
FROM (
  SELECT
    pp2.id,
    comp->>'longText' AS value
  FROM public.place_pool pp2,
    jsonb_array_elements(pp2.raw_google_data->'addressComponents') AS comp
  WHERE pp2.city IS NULL
    AND pp2.raw_google_data->'addressComponents' IS NOT NULL
    AND comp->'types' ? 'locality'
) locality
WHERE pp.id = locality.id
  AND pp.city IS NULL;

-- Pass 3: Address heuristic — take 3rd-from-end part (matching TS extractLocality)
-- For 3-part "123 St, Raleigh, NC" → "Raleigh" (parts.length - 2 = index 1 → SPLIT_PART pos 1)
-- For 2-part "Raleigh, NC" → "Raleigh" (first part)
UPDATE public.place_pool
SET city = CASE
  WHEN array_length(string_to_array(address, ','), 1) >= 3
    THEN TRIM(SPLIT_PART(address, ',',
      GREATEST(1, array_length(string_to_array(address, ','), 1) - 2)
    ))
  WHEN array_length(string_to_array(address, ','), 1) = 2
    THEN TRIM(SPLIT_PART(address, ',', 1))
  ELSE NULL
END
WHERE city IS NULL
  AND address IS NOT NULL
  AND address LIKE '%,%';

-- ── STEP 2: Backfill place_pool.country (for upsertPlaceToPool rows) ───────

-- Pass 1: Extract country from raw_google_data addressComponents
UPDATE public.place_pool pp
SET country = country_comp.value
FROM (
  SELECT
    pp2.id,
    comp->>'longText' AS value
  FROM public.place_pool pp2,
    jsonb_array_elements(pp2.raw_google_data->'addressComponents') AS comp
  WHERE pp2.country IS NULL
    AND pp2.raw_google_data->'addressComponents' IS NOT NULL
    AND comp->'types' ? 'country'
) country_comp
WHERE pp.id = country_comp.id
  AND pp.country IS NULL;

-- Pass 2: Heuristic from address (last comma part)
UPDATE public.place_pool
SET country = TRIM(SPLIT_PART(address, ',', array_length(string_to_array(address, ','), 1)))
WHERE country IS NULL
  AND address IS NOT NULL
  AND address != '';

-- ── STEP 3: Backfill card_pool.city and card_pool.country ──────────────────

-- Single cards: from parent place
UPDATE public.card_pool cp
SET
  city = COALESCE(cp.city, pp.city),
  country = COALESCE(cp.country, pp.country)
FROM public.place_pool pp
WHERE cp.place_pool_id = pp.id
  AND cp.card_type = 'single'
  AND (cp.city IS NULL OR cp.country IS NULL);

-- Curated cards: from first stop's place
UPDATE public.card_pool cp
SET
  city = COALESCE(cp.city, pp.city),
  country = COALESCE(cp.country, pp.country)
FROM public.card_pool_stops cps
JOIN public.place_pool pp ON pp.id = cps.place_pool_id
WHERE cps.card_pool_id = cp.id
  AND cp.card_type = 'curated'
  AND (cp.city IS NULL OR cp.country IS NULL)
  AND cps.stop_order = (
    SELECT MIN(s2.stop_order)
    FROM public.card_pool_stops s2
    WHERE s2.card_pool_id = cp.id
  );

-- ── STEP 4: Propagation trigger ────────────────────────────────────────────

-- When place_pool.city or country changes, cascade to all card_pool rows
-- referencing that place (via place_pool_id for single, via card_pool_stops for curated)

CREATE OR REPLACE FUNCTION public.propagate_place_city_country()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.city IS DISTINCT FROM OLD.city OR NEW.country IS DISTINCT FROM OLD.country THEN
    -- Single cards: direct FK (card_type filter prevents latent corruption
    -- if curated cards ever get place_pool_id set)
    UPDATE public.card_pool
    SET
      city = NEW.city,
      country = NEW.country
    WHERE place_pool_id = NEW.id
      AND card_type = 'single';

    -- Curated cards: via card_pool_stops (only update if this place is the first stop)
    UPDATE public.card_pool cp
    SET
      city = NEW.city,
      country = NEW.country
    FROM public.card_pool_stops cps
    WHERE cps.place_pool_id = NEW.id
      AND cps.card_pool_id = cp.id
      AND cp.card_type = 'curated'
      AND cps.stop_order = (
        SELECT MIN(s2.stop_order)
        FROM public.card_pool_stops s2
        WHERE s2.card_pool_id = cp.id
      );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_propagate_place_city_country
AFTER UPDATE OF city, country ON public.place_pool
FOR EACH ROW
EXECUTE FUNCTION public.propagate_place_city_country();

-- ── STEP 5: Verification queries ───────────────────────────────────────────

-- Run these after migration to confirm zero NULLs:
-- SELECT COUNT(*) FROM place_pool WHERE city IS NULL AND is_active;
-- SELECT COUNT(*) FROM place_pool WHERE country IS NULL AND is_active;
-- SELECT COUNT(*) FROM card_pool WHERE city IS NULL AND is_active;
-- SELECT COUNT(*) FROM card_pool WHERE country IS NULL AND is_active;
