-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.0 (Venue Suite FOUNDATION) — venue_tables
-- ---------------------------------------------------------------------------
-- The table-inventory primitive for the venue reservation suite. 2.0 ships the
-- SCHEMA ONLY (no rows written by 2.0 UI); the Tables CRUD module is 2.1.
--
-- Additive-only. All objects guarded (CREATE TABLE IF NOT EXISTS / CREATE INDEX
-- IF NOT EXISTS / DROP POLICY IF EXISTS before CREATE POLICY). RLS ENABLED with
-- the proven brand-member-read + manager-plus-write gates (mirrors the events
-- pattern: biz_is_brand_member_for_read_for_caller / biz_brand_effective_rank_
-- for_caller >= biz_role_rank('event_manager')). $function$ dollar-tag closed
-- before GRANT per the safe-migration protocol.
--
-- MONOTONIC VERSION: 20261003000000 is strictly greater than the current max
-- migration prefix across anchor main + all sibling worktrees (20261002000000,
-- orch_1142_notifications_soft_delete.sql). Re-confirmed at IMPLEMENT by
-- scanning supabase/migrations/ + ~/Desktop/mingla-orchs/*/.
--
-- DO NOT run `supabase db push`. The orchestrator applies via the Supabase
-- Management API after REVIEW (CLI drift-wedged; MCP read-only).
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.venue_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  place_pool_id uuid NULL REFERENCES public.place_pool(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  capacity int NOT NULL CHECK (capacity > 0 AND capacity <= 100),
  min_party int NULL CHECK (min_party IS NULL OR min_party >= 1),
  max_party int NULL CHECK (max_party IS NULL OR max_party >= 1),
  zone text NULL CHECK (zone IS NULL OR zone IN ('indoor','outdoor','private_room','bar','patio')),
  seating_type text NULL CHECK (seating_type IS NULL OR seating_type IN ('high_top','booth','lounge','standard')),
  combinable boolean NOT NULL DEFAULT false,
  accessible boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  reservation_policy text NOT NULL DEFAULT 'reservable'
    CHECK (reservation_policy IN ('reservable','walk_in_only','approval_required')),
  sort_order int NOT NULL DEFAULT 0,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS venue_tables_brand_id_idx
  ON public.venue_tables (brand_id);
CREATE INDEX IF NOT EXISTS venue_tables_brand_active_idx
  ON public.venue_tables (brand_id) WHERE is_active;

-- updated_at trigger (per-table fn per the SPEC §4.1 convention tg_<t>_set_updated_at).
CREATE OR REPLACE FUNCTION public.tg_venue_tables_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS venue_tables_set_updated_at ON public.venue_tables;
CREATE TRIGGER venue_tables_set_updated_at
  BEFORE UPDATE ON public.venue_tables
  FOR EACH ROW EXECUTE FUNCTION public.tg_venue_tables_set_updated_at();

-- RLS — brand-member read + manager-plus write.
ALTER TABLE public.venue_tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "venue_tables brand member can read" ON public.venue_tables;
CREATE POLICY "venue_tables brand member can read" ON public.venue_tables
  FOR SELECT TO authenticated
  USING (public.biz_is_brand_member_for_read_for_caller(brand_id));

DROP POLICY IF EXISTS "venue_tables manager plus can write" ON public.venue_tables;
CREATE POLICY "venue_tables manager plus can write" ON public.venue_tables
  FOR ALL TO authenticated
  USING (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'))
  WITH CHECK (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_tables TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_tables TO service_role;

COMMIT;
