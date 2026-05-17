-- ORCH-0859 — Tr2 Minimum Viable Trip: 3 sidecar tables for trip-specific
-- per-day itinerary, pricing-tier-to-ticket-type join, inclusions/exclusions.
--
-- Pre-state (verified 2026-05-17 via MCP probes):
--   public.events admits event_type='trip' (post-ORCH-0826 [Hub Foundation + universal-plus creator] M0)
--   public.brands.kind admits 'trip_planner' (post-ORCH-0855 [Tr1 Trip Planner Brand Onboarding])
--   public.ticket_types reusable for single-tier trip pricing (27 columns including
--     price_cents, currency, quantity_total, is_unlimited)
--   No pre-existing trip_days / trip_pricing_tiers / trip_inclusions tables
--   Helper function `biz_is_brand_member_for_read_for_caller(brand_id)` exists
--     (verified via pg_proc probe — per Tr1 investigation §C-3)
--
-- Per I-1.2-UNIFIED-EVENT-TYPE: trips are events rows, NOT a separate `trips`
-- table. These 3 sidecar tables hang OFF events.id via FK ON DELETE CASCADE.
--
-- Per I-PROPOSED-TR2-TRIP-SIDECAR-RLS-PUBLISHED-ONLY (DRAFT → ACTIVE on
-- ORCH-0859 CLOSE): anon SELECT gated on parent events.status IN
-- ('scheduled','live'); brand members SELECT all (including drafts); only
-- brand members may INSERT/UPDATE/DELETE.
--
-- SPEC: Mingla_Artifacts/specs/SPEC_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md §4.1
-- Investigation: Mingla_Artifacts/reports/INVESTIGATION_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md
--
-- SPEC deviation note: updated_at column on trip_days is present but NO
-- BEFORE UPDATE trigger is installed. Codebase uses per-table tg_<table>_set_updated_at
-- pattern (no generic helper). For Tr2 the upsertTripDays service uses
-- DELETE-then-INSERT (SPEC §4.6) so updated_at == created_at always — the
-- trigger would be a no-op. Future ORCH that switches to ON CONFLICT upsert
-- pattern can add the per-table trigger then.

BEGIN;

-- ---------------- trip_days ----------------
CREATE TABLE public.trip_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  ordinal smallint NOT NULL CHECK (ordinal > 0),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  narrative text,
  date date,
  stops jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, ordinal)
);

COMMENT ON TABLE public.trip_days IS
  'ORCH-0859 (Tr2): per-day itinerary for event_type=''trip'' events. ordinal is 1-based day index. stops jsonb reserved for Tr8 [AI itinerary scaffolding] structured-stop data — Tr2 keeps it empty array default. updated_at has no trigger; tripsService uses DELETE-then-INSERT upsert.';

CREATE INDEX idx_trip_days_event_ordinal ON public.trip_days(event_id, ordinal);

ALTER TABLE public.trip_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY trip_days_read_published_or_member ON public.trip_days FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = trip_days.event_id
        AND e.deleted_at IS NULL
        AND (
          e.status IN ('scheduled', 'live')
          OR biz_is_brand_member_for_read_for_caller(e.brand_id)
        )
    )
  );

CREATE POLICY trip_days_write_brand_members ON public.trip_days FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = trip_days.event_id
        AND biz_is_brand_member_for_read_for_caller(e.brand_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = trip_days.event_id
        AND biz_is_brand_member_for_read_for_caller(e.brand_id)
    )
  );

-- ---------------- trip_pricing_tiers ----------------
CREATE TABLE public.trip_pricing_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  ticket_type_id uuid NOT NULL REFERENCES public.ticket_types(id) ON DELETE CASCADE,
  tier_name text NOT NULL CHECK (length(trim(tier_name)) > 0),
  tier_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.trip_pricing_tiers IS
  'ORCH-0859 (Tr2): joins event_type=''trip'' events to ticket_types with tier_name + reserved tier_metadata jsonb. Tr2 ships SINGLE row per trip (single full-price tier). Tr3 [Installment Payments] will populate tier_metadata = {installments: [...]}.';

CREATE INDEX idx_trip_pricing_tiers_event ON public.trip_pricing_tiers(event_id);
CREATE UNIQUE INDEX idx_trip_pricing_tiers_event_ticket ON public.trip_pricing_tiers(event_id, ticket_type_id);

ALTER TABLE public.trip_pricing_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY trip_pricing_tiers_read_published_or_member ON public.trip_pricing_tiers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = trip_pricing_tiers.event_id
        AND e.deleted_at IS NULL
        AND (
          e.status IN ('scheduled', 'live')
          OR biz_is_brand_member_for_read_for_caller(e.brand_id)
        )
    )
  );

CREATE POLICY trip_pricing_tiers_write_brand_members ON public.trip_pricing_tiers FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = trip_pricing_tiers.event_id
        AND biz_is_brand_member_for_read_for_caller(e.brand_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = trip_pricing_tiers.event_id
        AND biz_is_brand_member_for_read_for_caller(e.brand_id)
    )
  );

-- ---------------- trip_inclusions ----------------
CREATE TABLE public.trip_inclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('included', 'excluded')),
  item text NOT NULL CHECK (length(trim(item)) > 0),
  ordinal smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.trip_inclusions IS
  'ORCH-0859 (Tr2): per-trip included/excluded items list. kind discriminates lists. ordinal preserves operator-defined order within each kind.';

CREATE INDEX idx_trip_inclusions_event_kind ON public.trip_inclusions(event_id, kind, ordinal);

ALTER TABLE public.trip_inclusions ENABLE ROW LEVEL SECURITY;

CREATE POLICY trip_inclusions_read_published_or_member ON public.trip_inclusions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = trip_inclusions.event_id
        AND e.deleted_at IS NULL
        AND (
          e.status IN ('scheduled', 'live')
          OR biz_is_brand_member_for_read_for_caller(e.brand_id)
        )
    )
  );

CREATE POLICY trip_inclusions_write_brand_members ON public.trip_inclusions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = trip_inclusions.event_id
        AND biz_is_brand_member_for_read_for_caller(e.brand_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = trip_inclusions.event_id
        AND biz_is_brand_member_for_read_for_caller(e.brand_id)
    )
  );

-- ---------------- Self-verification probe ----------------
DO $$
DECLARE
  table_count int;
  policy_count int;
  index_count int;
BEGIN
  SELECT count(*) INTO table_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('trip_days', 'trip_pricing_tiers', 'trip_inclusions');
  IF table_count != 3 THEN
    RAISE EXCEPTION 'ORCH-0859 migration: expected 3 sidecar tables, got %', table_count;
  END IF;

  SELECT count(*) INTO policy_count
  FROM pg_policy
  WHERE polrelid IN (
    'public.trip_days'::regclass,
    'public.trip_pricing_tiers'::regclass,
    'public.trip_inclusions'::regclass
  );
  IF policy_count != 6 THEN
    RAISE EXCEPTION 'ORCH-0859 migration: expected 6 RLS policies (2 per table), got %', policy_count;
  END IF;

  SELECT count(*) INTO index_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname IN (
      'idx_trip_days_event_ordinal',
      'idx_trip_pricing_tiers_event',
      'idx_trip_pricing_tiers_event_ticket',
      'idx_trip_inclusions_event_kind'
    );
  IF index_count != 4 THEN
    RAISE EXCEPTION 'ORCH-0859 migration: expected 4 indexes, got %', index_count;
  END IF;

  RAISE NOTICE 'ORCH-0859 migration complete: 3 sidecar tables + 6 RLS policies + 4 indexes';
END $$;

COMMIT;
