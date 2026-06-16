-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.0 — venue_blackouts
-- ---------------------------------------------------------------------------
-- Closure / blackout windows that the 2.1 availability engine subtracts. 2.0
-- ships schema only. Additive-only; RLS brand-member-read + manager-plus-write;
-- per-table updated_at trigger.
--
-- MONOTONIC VERSION 20261003000003. Apply via the Supabase Management API.
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.venue_blackouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  place_pool_id uuid NULL REFERENCES public.place_pool(id) ON DELETE SET NULL,
  date_start date NOT NULL,
  date_end date NOT NULL CHECK (date_end >= date_start),
  reason text NULL,
  applies_to text NOT NULL DEFAULT 'all'
    CHECK (applies_to IN ('all','zone','table')),
  zone text NULL CHECK (zone IS NULL OR zone IN ('indoor','outdoor','private_room','bar','patio')),
  table_id uuid NULL REFERENCES public.venue_tables(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS venue_blackouts_brand_id_idx
  ON public.venue_blackouts (brand_id);
CREATE INDEX IF NOT EXISTS venue_blackouts_brand_dates_idx
  ON public.venue_blackouts (brand_id, date_start, date_end);

CREATE OR REPLACE FUNCTION public.tg_venue_blackouts_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS venue_blackouts_set_updated_at ON public.venue_blackouts;
CREATE TRIGGER venue_blackouts_set_updated_at
  BEFORE UPDATE ON public.venue_blackouts
  FOR EACH ROW EXECUTE FUNCTION public.tg_venue_blackouts_set_updated_at();

ALTER TABLE public.venue_blackouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "venue_blackouts brand member can read" ON public.venue_blackouts;
CREATE POLICY "venue_blackouts brand member can read" ON public.venue_blackouts
  FOR SELECT TO authenticated
  USING (public.biz_is_brand_member_for_read_for_caller(brand_id));

DROP POLICY IF EXISTS "venue_blackouts manager plus can write" ON public.venue_blackouts;
CREATE POLICY "venue_blackouts manager plus can write" ON public.venue_blackouts
  FOR ALL TO authenticated
  USING (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'))
  WITH CHECK (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_blackouts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_blackouts TO service_role;

COMMIT;
