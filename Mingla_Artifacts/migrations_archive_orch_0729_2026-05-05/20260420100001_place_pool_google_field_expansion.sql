-- ORCH-0550.1 — place_pool schema expansion for Google Places v1 enriched FieldMask
-- Additive only: no data destruction, no drops, no type changes to existing columns.
-- Companion: admin-seed-places + admin-refresh-places + admin-place-search edge fn updates
-- map new Google fields into these columns.
--
-- Invariants established by this migration:
--   I-PLACE-POOL-ADDITIVE-SCHEMA        — no destructive changes
--   I-REFRESH-NEVER-DEGRADES            — refresh writes are a superset of seed writes
--   I-BUSINESS-STATUS-AUTHORITATIVE     — business_status is first-class (was inside raw_google_data)
--   I-FIELD-MASK-SINGLE-OWNER           — seed FieldMask is the authoritative list
--
-- Rollback SQL lives in SPEC_ORCH-0550_1_SEED_EXPANSION.md §6.

-- ── Content fields ──────────────────────────────────────────────────────────

ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS generative_summary TEXT,
  ADD COLUMN IF NOT EXISTS primary_type_display_name TEXT,
  ADD COLUMN IF NOT EXISTS google_maps_uri TEXT,
  ADD COLUMN IF NOT EXISTS national_phone_number TEXT,
  ADD COLUMN IF NOT EXISTS secondary_opening_hours JSONB,
  ADD COLUMN IF NOT EXISTS reviews JSONB;
  -- reviews stores array of up to 5 review objects:
  -- [{ text: { text, languageCode }, rating, relativePublishTimeDescription,
  --    authorAttribution: { displayName, uri, photoUri } }]

-- ── Price range (fine-grained supplement to price_level) ────────────────────

ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS price_range_currency TEXT,
  ADD COLUMN IF NOT EXISTS price_range_start_cents INTEGER,
  ADD COLUMN IF NOT EXISTS price_range_end_cents INTEGER;

-- ── Meal service booleans ──────────────────────────────────────────────────

ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS serves_brunch BOOLEAN,
  ADD COLUMN IF NOT EXISTS serves_lunch BOOLEAN,
  ADD COLUMN IF NOT EXISTS serves_dinner BOOLEAN,
  ADD COLUMN IF NOT EXISTS serves_breakfast BOOLEAN,
  ADD COLUMN IF NOT EXISTS serves_beer BOOLEAN,
  ADD COLUMN IF NOT EXISTS serves_wine BOOLEAN,
  ADD COLUMN IF NOT EXISTS serves_cocktails BOOLEAN,
  ADD COLUMN IF NOT EXISTS serves_coffee BOOLEAN,
  ADD COLUMN IF NOT EXISTS serves_dessert BOOLEAN,
  ADD COLUMN IF NOT EXISTS serves_vegetarian_food BOOLEAN;

-- ── Ambience & amenities ───────────────────────────────────────────────────

ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS outdoor_seating BOOLEAN,
  ADD COLUMN IF NOT EXISTS live_music BOOLEAN,
  ADD COLUMN IF NOT EXISTS good_for_groups BOOLEAN,
  ADD COLUMN IF NOT EXISTS good_for_children BOOLEAN,
  ADD COLUMN IF NOT EXISTS good_for_watching_sports BOOLEAN,
  ADD COLUMN IF NOT EXISTS allows_dogs BOOLEAN,
  ADD COLUMN IF NOT EXISTS has_restroom BOOLEAN,
  ADD COLUMN IF NOT EXISTS reservable BOOLEAN,
  ADD COLUMN IF NOT EXISTS menu_for_children BOOLEAN;

-- ── Service options ────────────────────────────────────────────────────────

ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS dine_in BOOLEAN,
  ADD COLUMN IF NOT EXISTS takeout BOOLEAN,
  ADD COLUMN IF NOT EXISTS delivery BOOLEAN,
  ADD COLUMN IF NOT EXISTS curbside_pickup BOOLEAN;

-- ── Access & facilities (JSONB because nested structure) ───────────────────

ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS accessibility_options JSONB,
  -- { wheelchairAccessibleParking, wheelchairAccessibleEntrance,
  --   wheelchairAccessibleRestroom, wheelchairAccessibleSeating }

  ADD COLUMN IF NOT EXISTS parking_options JSONB,
  -- { freeParkingLot, paidParkingLot, freeStreetParking,
  --   paidStreetParking, valetParking, freeGarageParking, paidGarageParking }

  ADD COLUMN IF NOT EXISTS payment_options JSONB;
  -- { acceptsCreditCards, acceptsDebitCards, acceptsCashOnly, acceptsNfc }

-- ── Enforce business_status as first-class ────────────────────────────────

ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS business_status TEXT;
-- values: 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY' | NULL

-- Backfill business_status from existing raw_google_data where available.
-- Idempotent: only touches rows where business_status IS NULL.
UPDATE public.place_pool
SET business_status = raw_google_data->>'businessStatus'
WHERE business_status IS NULL
  AND raw_google_data IS NOT NULL
  AND raw_google_data->>'businessStatus' IS NOT NULL;

-- ── Indexes (selective — only on columns used for filtering) ───────────────

CREATE INDEX IF NOT EXISTS idx_place_pool_business_status_active
  ON public.place_pool (business_status)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_place_pool_serves_brunch
  ON public.place_pool (city_id)
  WHERE serves_brunch = true AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_place_pool_serves_dinner
  ON public.place_pool (city_id)
  WHERE serves_dinner = true AND is_active = true;

-- Note: more vibe-specific indexes may be added by ORCH-0550.3 when we know
-- exact query patterns for vibe filtering. Don't over-index yet.
