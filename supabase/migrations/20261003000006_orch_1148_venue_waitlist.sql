-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.0 — venue_waitlist (MVP; DISTINCT from waitlist_entries)
-- ---------------------------------------------------------------------------
-- A RESTAURANT waitlist is a different shape from the event-ticket-scoped
-- public.waitlist_entries (FKs event_id / ticket_type_id, qty_requested, a drain
-- trigger on tickets.status — orch_0948_waitlist_feature.sql). DO NOT overload
-- that table. This is a new table that reuses ONLY the status-vocabulary idea +
-- the RLS shape. notify_via / notified_at are D4 notification seams (push-only
-- is 2.1; SMS is 2.1/2.2). 2.0 ships schema only.
--
-- Additive-only; RLS brand-member-read + manager-plus-write; per-table
-- updated_at trigger. MONOTONIC VERSION 20261003000006. FKs reservations (must
-- exist first — earlier prefix). Apply via the Supabase Management API.
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.venue_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  place_pool_id uuid NULL REFERENCES public.place_pool(id) ON DELETE SET NULL,
  guest_name text NULL,
  guest_phone_e164 text NULL,
  guest_email text NULL,
  party_size int NOT NULL CHECK (party_size >= 1 AND party_size <= 100),
  preferred_zone text NULL
    CHECK (preferred_zone IS NULL OR preferred_zone IN ('indoor','outdoor','private_room','bar','patio')),
  quoted_wait_minutes int NULL
    CHECK (quoted_wait_minutes IS NULL OR quoted_wait_minutes >= 0),
  status text NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting','notified','converted','expired','lost')),
  -- D4 notification seam.
  notify_via text NOT NULL DEFAULT 'push'
    CHECK (notify_via IN ('push','sms','none')),
  notified_at timestamptz NULL,
  expires_at timestamptz NULL,
  converted_reservation_id uuid NULL REFERENCES public.reservations(id) ON DELETE SET NULL,
  consumer_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS venue_waitlist_brand_id_idx
  ON public.venue_waitlist (brand_id);
-- FIFO queue (2.1).
CREATE INDEX IF NOT EXISTS venue_waitlist_queue_idx
  ON public.venue_waitlist (brand_id, status, created_at);

CREATE OR REPLACE FUNCTION public.tg_venue_waitlist_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS venue_waitlist_set_updated_at ON public.venue_waitlist;
CREATE TRIGGER venue_waitlist_set_updated_at
  BEFORE UPDATE ON public.venue_waitlist
  FOR EACH ROW EXECUTE FUNCTION public.tg_venue_waitlist_set_updated_at();

ALTER TABLE public.venue_waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "venue_waitlist brand member can read" ON public.venue_waitlist;
CREATE POLICY "venue_waitlist brand member can read" ON public.venue_waitlist
  FOR SELECT TO authenticated
  USING (public.biz_is_brand_member_for_read_for_caller(brand_id));

DROP POLICY IF EXISTS "venue_waitlist manager plus can write" ON public.venue_waitlist;
CREATE POLICY "venue_waitlist manager plus can write" ON public.venue_waitlist
  FOR ALL TO authenticated
  USING (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'))
  WITH CHECK (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_waitlist TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_waitlist TO service_role;

COMMIT;
