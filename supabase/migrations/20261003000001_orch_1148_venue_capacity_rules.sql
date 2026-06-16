-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.0 — venue_capacity_rules (Smart Capacity Rules)
-- ---------------------------------------------------------------------------
-- The full rule-catalog schema. 2.0 writes NOTHING to this table; 2.1 evaluates
-- party_fit / deposit_threshold / blackout_scope (PRD §6). Additive-only; RLS
-- brand-member-read + manager-plus-write; per-table updated_at trigger.
--
-- MONOTONIC VERSION 20261003000001 (one greater than venue_tables). Apply via
-- the Supabase Management API after REVIEW; never `supabase db push`.
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.venue_capacity_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  place_pool_id uuid NULL REFERENCES public.place_pool(id) ON DELETE SET NULL,
  -- full catalog laid now; 2.1 evaluates party_fit / deposit_threshold / blackout_scope.
  kind text NOT NULL CHECK (kind IN (
    'party_fit','deposit_threshold','blackout_scope',
    'approval_required','walk_in_only','weekend_only'
  )),
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  table_id uuid NULL REFERENCES public.venue_tables(id) ON DELETE CASCADE,
  zone text NULL CHECK (zone IS NULL OR zone IN ('indoor','outdoor','private_room','bar','patio')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS venue_capacity_rules_brand_id_idx
  ON public.venue_capacity_rules (brand_id);
CREATE INDEX IF NOT EXISTS venue_capacity_rules_brand_active_idx
  ON public.venue_capacity_rules (brand_id) WHERE is_active;

CREATE OR REPLACE FUNCTION public.tg_venue_capacity_rules_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS venue_capacity_rules_set_updated_at ON public.venue_capacity_rules;
CREATE TRIGGER venue_capacity_rules_set_updated_at
  BEFORE UPDATE ON public.venue_capacity_rules
  FOR EACH ROW EXECUTE FUNCTION public.tg_venue_capacity_rules_set_updated_at();

ALTER TABLE public.venue_capacity_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "venue_capacity_rules brand member can read" ON public.venue_capacity_rules;
CREATE POLICY "venue_capacity_rules brand member can read" ON public.venue_capacity_rules
  FOR SELECT TO authenticated
  USING (public.biz_is_brand_member_for_read_for_caller(brand_id));

DROP POLICY IF EXISTS "venue_capacity_rules manager plus can write" ON public.venue_capacity_rules;
CREATE POLICY "venue_capacity_rules manager plus can write" ON public.venue_capacity_rules
  FOR ALL TO authenticated
  USING (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'))
  WITH CHECK (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_capacity_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_capacity_rules TO service_role;

COMMIT;
