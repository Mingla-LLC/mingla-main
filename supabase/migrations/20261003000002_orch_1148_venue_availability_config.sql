-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.0 — venue_availability_config
-- ---------------------------------------------------------------------------
-- One row per brand (UNIQUE brand_id). Seeds from place_pool.opening_hours
-- later; reservation-specific config is editable in 2.1 (the Availability
-- module editor). 2.0 ships schema only. Additive-only; RLS brand-member-read +
-- manager-plus-write; per-table updated_at trigger.
--
-- MONOTONIC VERSION 20261003000002. Apply via the Supabase Management API.
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.venue_availability_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  place_pool_id uuid NULL REFERENCES public.place_pool(id) ON DELETE SET NULL,
  -- [{name,days:[0..6],start:'HH:MM',end:'HH:MM',type}]
  service_periods jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- {"p2":75,"p4":90,"p6":120} minutes by party bucket
  turn_times jsonb NOT NULL DEFAULT '{}'::jsonb,
  buffer_minutes int NOT NULL DEFAULT 0
    CHECK (buffer_minutes >= 0 AND buffer_minutes <= 240),
  max_reservations_per_slot int NULL
    CHECK (max_reservations_per_slot IS NULL OR max_reservations_per_slot > 0),
  slot_granularity_minutes int NOT NULL DEFAULT 15
    CHECK (slot_granularity_minutes IN (5,10,15,20,30,60)),
  advance_window_days int NOT NULL DEFAULT 30
    CHECK (advance_window_days BETWEEN 0 AND 365),
  min_notice_minutes int NOT NULL DEFAULT 0
    CHECK (min_notice_minutes >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_availability_config_brand_id_key UNIQUE (brand_id)
);

CREATE INDEX IF NOT EXISTS venue_availability_config_brand_id_idx
  ON public.venue_availability_config (brand_id);

CREATE OR REPLACE FUNCTION public.tg_venue_availability_config_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS venue_availability_config_set_updated_at ON public.venue_availability_config;
CREATE TRIGGER venue_availability_config_set_updated_at
  BEFORE UPDATE ON public.venue_availability_config
  FOR EACH ROW EXECUTE FUNCTION public.tg_venue_availability_config_set_updated_at();

ALTER TABLE public.venue_availability_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "venue_availability_config brand member can read" ON public.venue_availability_config;
CREATE POLICY "venue_availability_config brand member can read" ON public.venue_availability_config
  FOR SELECT TO authenticated
  USING (public.biz_is_brand_member_for_read_for_caller(brand_id));

DROP POLICY IF EXISTS "venue_availability_config manager plus can write" ON public.venue_availability_config;
CREATE POLICY "venue_availability_config manager plus can write" ON public.venue_availability_config
  FOR ALL TO authenticated
  USING (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'))
  WITH CHECK (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_availability_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_availability_config TO service_role;

COMMIT;
