-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.0 — reservations (the heart; schema-only in 2.0)
-- ---------------------------------------------------------------------------
-- The reservation primitive. Full 8-state lifecycle CHECK shipped now (D2) so
-- 2.1 builds ONLY transitions. 2.0 schema-only; 2.1 lifecycle RPCs; 2.2 the
-- consumer write RPC + the consumer "see my own reservation" SELECT policy
-- (consumer_user_id = auth.uid()) — NOT in 2.0 (no consumer surface this ship).
--
-- D1 seam: event_date_id is a NULLABLE column with NO FK (forward seam letting
-- 2.2 pivot the slot model if Seth reverses; reservations stay a separate
-- primitive, the optional fee rides ticket-checkout-create via an additive
-- `reservation` mode in 2.2 — NOT a synthetic event_dates row).
--
-- Additive-only; RLS brand-member-read + manager-plus-write ONLY in 2.0;
-- per-table updated_at trigger. MONOTONIC VERSION 20261003000005. FKs
-- venue_tables (must exist first — earlier prefix). Apply via the Supabase
-- Management API after REVIEW.
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  place_pool_id uuid NULL REFERENCES public.place_pool(id) ON DELETE SET NULL,
  table_id uuid NULL REFERENCES public.venue_tables(id) ON DELETE SET NULL,
  -- slot start (venue-local resolved via place_pool.utc_offset_minutes in 2.1).
  reserved_for timestamptz NOT NULL,
  party_size int NOT NULL CHECK (party_size >= 1 AND party_size <= 100),
  -- full 8-state lifecycle (D2): 2.1 builds only the transitions.
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN (
    'requested','confirmed','seated','completed','no_show',
    'cancelled_by_guest','cancelled_by_venue','waitlisted'
  )),
  source text NOT NULL DEFAULT 'phone'
    CHECK (source IN ('mingla','phone','walk_in','website','instagram')),
  created_via text NOT NULL DEFAULT 'operator'
    CHECK (created_via IN ('operator','consumer')),
  guest_name text NULL,
  guest_phone_e164 text NULL,
  guest_email text NULL,
  -- set when source='mingla' (2.2 seam).
  consumer_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  occasion text NULL,
  guest_notes text NULL,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  fee_cents int NULL CHECK (fee_cents IS NULL OR fee_cents >= 0),
  fee_currency char(3) NULL,
  payment_intent_id text NULL,
  payment_status text NOT NULL DEFAULT 'none'
    CHECK (payment_status IN ('none','paid','refunded')),
  -- D1 forward seam: NULLABLE, NO FK.
  event_date_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reservations_brand_reserved_for_idx
  ON public.reservations (brand_id, reserved_for);
CREATE INDEX IF NOT EXISTS reservations_brand_status_idx
  ON public.reservations (brand_id, status);
CREATE INDEX IF NOT EXISTS reservations_consumer_idx
  ON public.reservations (consumer_user_id) WHERE consumer_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tg_reservations_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS reservations_set_updated_at ON public.reservations;
CREATE TRIGGER reservations_set_updated_at
  BEFORE UPDATE ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.tg_reservations_set_updated_at();

-- 2.0 RLS = brand-member read + manager-plus write ONLY. The consumer
-- "see my own reservation" SELECT policy is added in 2.2 with the consumer
-- write RPC (consumer_user_id = auth.uid()) — NOT here.
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reservations brand member can read" ON public.reservations;
CREATE POLICY "reservations brand member can read" ON public.reservations
  FOR SELECT TO authenticated
  USING (public.biz_is_brand_member_for_read_for_caller(brand_id));

DROP POLICY IF EXISTS "reservations manager plus can write" ON public.reservations;
CREATE POLICY "reservations manager plus can write" ON public.reservations
  FOR ALL TO authenticated
  USING (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'))
  WITH CHECK (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reservations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reservations TO service_role;

COMMIT;
