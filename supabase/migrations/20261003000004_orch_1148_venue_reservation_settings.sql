-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.0 — venue_reservation_settings  ⭐
-- ---------------------------------------------------------------------------
-- The ONLY table 2.0's UI writes. The single source for "is this venue
-- reservable" (the LOCKED single toggle, VISION dec 4) + the optional
-- reservation fee + cancel/no-show policy. ONE ROW PER BRAND: brand_id IS THE
-- PRIMARY KEY (not a synthetic id) so upsert-on-toggle is trivial and there is
-- exactly one row per brand (toggle race → idempotent upsert, no dup rows).
--
-- Paid-fee integrity (ORCH-1073/1075 lineage): a DB CHECK cannot read
-- brands.stripe_charges_enabled cross-row, so the paid-fee fail-close is
-- enforced at the service/RPC + UI layer (2.0 enforces it in the Settings UI;
-- the genuine server-side fail-close RPC is 2.1/2.2 — no charge path exists in
-- 2.0). This table's CHECK only validates amount >= 0.
--
-- Additive-only; RLS brand-member-read + manager-plus-write; per-table
-- updated_at trigger. MONOTONIC VERSION 20261003000004. Apply via the Supabase
-- Management API after REVIEW.
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.venue_reservation_settings (
  brand_id uuid PRIMARY KEY REFERENCES public.brands(id) ON DELETE CASCADE,
  place_pool_id uuid NULL REFERENCES public.place_pool(id) ON DELETE SET NULL,
  -- the LOCKED single toggle (VISION dec 4) — gates the whole booking band.
  reservations_enabled boolean NOT NULL DEFAULT false,
  fee_enabled boolean NOT NULL DEFAULT false,
  fee_amount_cents int NULL CHECK (fee_amount_cents IS NULL OR fee_amount_cents >= 0),
  fee_currency char(3) NULL,
  fee_refundable boolean NOT NULL DEFAULT true,
  cancel_cutoff_hours int NOT NULL DEFAULT 24
    CHECK (cancel_cutoff_hours >= 0 AND cancel_cutoff_hours <= 720),
  -- enforcement (auto no-show forfeit capture) is 2.2 (D3); 2.0 stores policy only.
  no_show_fee_policy text NOT NULL DEFAULT 'forfeit'
    CHECK (no_show_fee_policy IN ('forfeit','none')),
  -- NULL → inherit brands.default_pass_mingla_fee / default_pass_service_fee.
  pass_fee_override boolean NULL,
  -- NULL → inherit brands.default_pass_tax.
  pass_tax_override boolean NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2.2 consumer-deck "reservable" derivation reads this partial index.
CREATE INDEX IF NOT EXISTS venue_reservation_settings_enabled_idx
  ON public.venue_reservation_settings (brand_id) WHERE reservations_enabled;

CREATE OR REPLACE FUNCTION public.tg_venue_reservation_settings_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS venue_reservation_settings_set_updated_at ON public.venue_reservation_settings;
CREATE TRIGGER venue_reservation_settings_set_updated_at
  BEFORE UPDATE ON public.venue_reservation_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_venue_reservation_settings_set_updated_at();

ALTER TABLE public.venue_reservation_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "venue_reservation_settings brand member can read" ON public.venue_reservation_settings;
CREATE POLICY "venue_reservation_settings brand member can read" ON public.venue_reservation_settings
  FOR SELECT TO authenticated
  USING (public.biz_is_brand_member_for_read_for_caller(brand_id));

DROP POLICY IF EXISTS "venue_reservation_settings manager plus can write" ON public.venue_reservation_settings;
CREATE POLICY "venue_reservation_settings manager plus can write" ON public.venue_reservation_settings
  FOR ALL TO authenticated
  USING (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'))
  WITH CHECK (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_reservation_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_reservation_settings TO service_role;

COMMIT;
